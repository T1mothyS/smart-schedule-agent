"""Real isolated HTTP integration tests. Runtime files live in a new temp folder."""
import io
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import date

import bcrypt
import vobject
from fixtures import fixtures
from probe import Client, PROPS, QUERY, cycle_checks, read_checks, seed
from serve import SafeAudit, audit_record, safe_path

ROOT = Path(__file__).resolve().parent


class PrivacyTests(unittest.TestCase):
    def test_untrusted_fields_never_appear_in_audit(self):
        sentinel = 'DO-NOT-LOG-private-secret'
        env = {'PATH_INFO': '/' + sentinel, 'QUERY_STRING': sentinel,
               'REQUEST_METHOD': 'REPORT', 'CONTENT_TYPE': 'application/xml',
               'HTTP_AUTHORIZATION': 'Basic ' + sentinel, 'HTTP_COOKIE': sentinel,
               'HTTP_USER_AGENT': sentinel, 'HTTP_DEPTH': sentinel, 'HTTP_IF_MATCH': sentinel}
        xml = ('<d:sync-collection xmlns:d="DAV:"><d:sync-token>' + sentinel + '</d:sync-token></d:sync-collection>').encode()
        record = audit_record(env, xml, '207 Multi-Status', [('ETag', sentinel), ('Set-Cookie', sentinel)])
        self.assertNotIn(sentinel, json.dumps(record))
        self.assertEqual(record['xml_elements'], ['sync-collection', 'sync-token'])
        self.assertEqual(safe_path('/poc-reader/poc/' + sentinel), '/poc-reader/poc/[item]')

    def test_xml_entities_not_expanded(self):
        record = audit_record({'REQUEST_METHOD': 'REPORT'}, b'<!DOCTYPE x [<!ENTITY e SYSTEM "file:///private">]><x>&e;</x>', '400 Error', [])
        self.assertEqual(record['xml_elements'], ['[invalid-or-non-xml]'])

    def test_audit_preserves_request_stream_and_limits_size(self):
        seen = []
        def app(env, start):
            self.assertEqual(env['wsgi.input'].read(), PROPS)
            start('207 Multi-Status', [])
            return [b'ok']
        wrapped = SafeAudit(app, seen.append)
        env = {'REQUEST_METHOD': 'PROPFIND', 'CONTENT_LENGTH': str(len(PROPS)), 'wsgi.input': io.BytesIO(PROPS)}
        self.assertEqual(wrapped(env, lambda *args: None), [b'ok'])
        self.assertEqual(len(seen), 1)
        env['CONTENT_LENGTH'] = str(2 * 1024 * 1024)
        statuses = []
        wrapped(env, lambda status, headers: statuses.append(status))
        self.assertEqual(statuses, ['413 Payload Too Large'])

    def test_url_safety(self):
        for url in ('http://example.com', 'https://user:secret@example.com', 'https://example.com/?token=secret', 'https://example.com/api'):
            with self.assertRaises(ValueError):
                Client(url, {})

    def test_fixtures_are_valid_utf8_icalendar(self):
        for name, body in fixtures(date(2026, 9, 20)).items():
            with self.subTest(name=name):
                self.assertTrue(all(len(line) <= 75 for line in body.split(b'\r\n')))
                item = vobject.readOne(body.decode('utf-8'))
                self.assertEqual(item.name, 'VCALENDAR')
                self.assertTrue(item.validate())
                if name == 'all-day':
                    self.assertEqual((item.vevent.dtend.value - item.vevent.dtstart.value).days, 1)
                if name == 'exception':
                    self.assertEqual(len(item.vevent_list), 2)


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Keep synthetic failure evidence on disk. Never remove arbitrary paths.
        cls.runtime = Path(tempfile.mkdtemp(prefix='ai-calendar-caldav-test-'))
        cls.creds = {user: secrets.token_urlsafe(24) for user in ('poc-writer', 'poc-reader', 'poc-phone', 'poc-outsider')}
        users = cls.runtime / 'users'
        users.write_text('\n'.join(user + ':' + bcrypt.hashpw(value.encode(), bcrypt.gensalt(rounds=4)).decode() for user, value in cls.creds.items()), encoding='utf-8')
        users.chmod(0o600)
        template = (ROOT / 'config.example').read_text(encoding='utf-8')
        template = template.replace('/var/lib/ai-calendar-caldav-poc/users', users.as_posix())
        template = template.replace('/opt/ai-calendar-caldav-poc/rights', (ROOT / 'rights').as_posix())
        template = template.replace('/var/lib/ai-calendar-caldav-poc/collections', (cls.runtime / 'collections').as_posix())
        (cls.runtime / 'config').write_text(template, encoding='utf-8')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.audit = (cls.runtime / 'audit.jsonl').open('ab')
        cls.client = Client(f'http://127.0.0.1:{cls.port}', cls.creds)
        cls.start()

    @classmethod
    def start(cls):
        cls.process = subprocess.Popen([sys.executable, '-X', 'utf8', str(ROOT / 'serve.py'), '--config', str(cls.runtime / 'config'), '--port', str(cls.port)],
            stdout=cls.audit, stderr=cls.audit, env={**os.environ, 'PYTHONUNBUFFERED': '1'})
        for _ in range(50):
            if cls.process.poll() is not None:
                raise RuntimeError('POC server startup failed (sanitized log retained)')
            try:
                if cls.client.request('OPTIONS', user=None).status_code == 200:
                    return
            except Exception:
                pass
            time.sleep(.1)
        cls.process.terminate()
        cls.process.wait(timeout=10)
        raise RuntimeError('POC server startup timeout')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.audit.close()
        cls.client.session.close()

    def test_protocol_permissions_and_restart(self):
        self.assertEqual(seed(self.client)['seed'], 'PASS')
        self.assertEqual(read_checks(self.client)['objects'], 9)
        self.assertEqual(read_checks(self.client, 'poc-phone')['objects'], 9)
        self.assertEqual(cycle_checks(self.client)['readonly'], 'PASS')
        # Read-only calendar creation/deletion cannot bypass item-level restrictions.
        self.assertEqual(self.client.request('MKCALENDAR', '/poc-reader/blocked/').status_code, 403)
        self.assertEqual(self.client.request('DELETE', '/poc-reader/poc/').status_code, 403)
        self.assertEqual(self.client.request('PROPPATCH', '/poc-reader/poc/', data=b'<d:propertyupdate xmlns:d="DAV:"/>', headers={'Content-Type': 'application/xml'}).status_code, 403)
        # Verify prefix handling at the WSGI boundary (not a real nginx TLS test).
        prefixed = self.client.request('PROPFIND', '/', data=PROPS, headers={'Depth': '0', 'Content-Type': 'application/xml', 'X-Script-Name': '/caldav-poc'})
        self.assertEqual(prefixed.status_code, 207)
        self.assertIn(b'/caldav-poc/poc-reader/', prefixed.content)
        # Repeated seed preserves existing resources, including ETags.
        before = self.client.request('GET', '/poc-reader/poc/ordinary.ics').headers['ETag']
        seed(self.client)
        self.assertEqual(before, self.client.request('GET', '/poc-reader/poc/ordinary.ics').headers['ETag'])
        # A phone-writable synthetic calendar is isolated from the read-only feed.
        body = fixtures()['ordinary'].replace(b'poc-ordinary@', b'poc-phone-roundtrip@')
        path = '/poc-phone/poc/phone-roundtrip.ics'
        self.assertEqual(self.client.request('PUT', path, 'poc-phone', body, {'Content-Type': 'text/calendar', 'If-None-Match': '*'}).status_code, 201)
        etag = self.client.request('GET', path, 'poc-phone').headers['ETag']
        self.assertEqual(self.client.request('PUT', path, 'poc-phone', body.replace(b'POC ordinary', b'POC phone update'), {'Content-Type': 'text/calendar', 'If-Match': etag}).status_code, 204)
        self.assertEqual(self.client.request('DELETE', path, 'poc-phone').status_code, 200)
        self.assertEqual(self.client.request('GET', '/poc-reader/poc/ordinary.ics', 'poc-phone').status_code, 403)
        # Probe both REPORT types; client usage remains NOT TESTED until phone traces.
        multiget = b'<c:calendar-multiget xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:prop><d:getetag/><c:calendar-data/></d:prop><d:href>/poc-reader/poc/ordinary.ics</d:href></c:calendar-multiget>'
        for body in (multiget, b'<d:sync-collection xmlns:d="DAV:"><d:sync-token/><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>'):
            self.assertEqual(self.client.request('REPORT', '/poc-reader/poc/', data=body, headers={'Content-Type': 'application/xml'}).status_code, 207)
        self.process.terminate()
        self.process.wait(timeout=10)
        self.start()
        self.assertEqual(read_checks(self.client)['objects'], 9)
        self.assertEqual(before, self.client.request('GET', '/poc-reader/poc/ordinary.ics').headers['ETag'])
        self.audit.flush()
        records = (self.runtime / 'audit.jsonl').read_text(encoding='utf-8')
        for secret in self.creds.values():
            self.assertNotIn(secret, records)
        import base64
        for user, secret in self.creds.items():
            self.assertNotIn(base64.b64encode(f'{user}:{secret}'.encode()).decode(), records)
        self.assertNotIn('SUMMARY', records)
        for line in records.splitlines():
            self.assertIn('status', json.loads(line))


if __name__ == '__main__':
    unittest.main(verbosity=2)
