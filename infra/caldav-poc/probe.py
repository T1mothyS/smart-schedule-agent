"""Bounded POC client. Read-only default; mutations require --allow-write.

Credentials are prompted, never accepted as command-line values. No redirect is
followed (especially with Basic auth). Never disable certificate verification.
"""
import argparse
import getpass
import json
import uuid
from datetime import date
from urllib.parse import urlsplit
import requests
from defusedxml import ElementTree as ET
from fixtures import fixtures

D = '{DAV:}'
C = '{urn:ietf:params:xml:ns:caldav}'
PROPS = b'''<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>
<d:current-user-principal/><c:calendar-home-set/><d:resourcetype/><d:displayname/>
<d:current-user-privilege-set/><d:supported-report-set/><d:sync-token/><d:getetag/>
</d:prop></d:propfind>'''
QUERY = b'''<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
<d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR">
<c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>'''


class CheckFailure(Exception):
    pass


def expect(condition, label):
    if not condition:
        raise CheckFailure(label)


class Client:
    def __init__(self, base, credentials):
        parts = urlsplit(base)
        if parts.username or parts.password or parts.query or parts.fragment:
            raise ValueError('Base URL must not contain credentials, query or fragment')
        if parts.scheme != 'https' and not (parts.scheme == 'http' and parts.hostname in ('127.0.0.1', '::1', 'localhost')):
            raise ValueError('HTTPS required except loopback synthetic tests')
        if parts.path not in ('', '/', '/caldav-poc/'):
            raise ValueError('Use dedicated host root or /caldav-poc/')
        self.base = base.rstrip('/')
        self.credentials = credentials
        self.session = requests.Session()
        self.session.trust_env = False

    def request(self, method, path='/', user='poc-reader', data=None, headers=None):
        if not (path == '/' or path.startswith(('/poc-reader/', '/poc-phone/', '/poc-outsider/'))):
            raise ValueError('Outside fixed POC namespace')
        return self.session.request(method, self.base + path,
            auth=(user, self.credentials[user]) if user else None, data=data,
            headers=headers or {}, timeout=15, allow_redirects=False)


def create_collection(client, principal, user):
    # Only the writer creates parent collections. A reader login must not need W.
    parent = client.request('MKCOL', '/' + principal + '/', 'poc-writer')
    expect(parent.status_code in (201, 405), 'principal create')
    body = b'''<c:mkcalendar xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:set><d:prop>
<d:displayname>Honor POC synthetic</d:displayname><c:supported-calendar-component-set>
<c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>'''
    response = client.request('MKCALENDAR', '/' + principal + '/poc/', user, body, {'Content-Type': 'application/xml'})
    expect(response.status_code in (201, 405, 409), 'collection create')
    # A pre-existing collection must bear our marker before any further mutation.
    response = client.request('PROPFIND', '/' + principal + '/poc/', user, PROPS, {'Depth': '0', 'Content-Type': 'application/xml'})
    expect(response.status_code == 207, 'collection inspect')
    root = ET.fromstring(response.content)
    expect(any(node.text == 'Honor POC synthetic' for node in root.iter(D + 'displayname')), 'POC collection marker')


def read_checks(client, user='poc-reader'):
    principal = 'poc-phone' if user == 'poc-phone' else 'poc-reader'
    root = client.request('PROPFIND', '/', user, PROPS, {'Depth': '0', 'Content-Type': 'application/xml'})
    expect(root.status_code == 207, 'principal discovery')
    xml = ET.fromstring(root.content)
    expect(any(principal in (n.text or '') for n in xml.iter(D + 'href')), 'principal href')
    home = client.request('PROPFIND', '/' + principal + '/', user, PROPS, {'Depth': '1', 'Content-Type': 'application/xml'})
    expect(home.status_code == 207, 'home discovery')
    expect(ET.fromstring(home.content).find('.//' + C + 'calendar') is not None, 'calendar discovered')
    listing = client.request('REPORT', '/' + principal + '/poc/', user, QUERY, {'Depth': '1', 'Content-Type': 'application/xml'})
    expect(listing.status_code == 207, 'calendar query')
    return {'discovery': 'PASS', 'calendar_query': 'PASS', 'objects': len(ET.fromstring(listing.content).findall(D + 'response'))}


def seed(client, day=None):
    for principal, user in [('poc-reader', 'poc-writer'), ('poc-phone', 'poc-phone')]:
        create_collection(client, principal, user)
        for name, payload in fixtures(day).items():
            response = client.request('PUT', f'/{principal}/poc/{name}.ics', user, payload,
                {'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*'})
            expect(response.status_code in (201, 412), 'seed create-only ' + name)
    return {'seed': 'PASS', 'existing_items': 'preserved (412); alarm is not rescheduled'}


def cycle_checks(client):
    """Only create/update/delete a fresh UUID resource; never mutate seed/user items."""
    path = '/poc-reader/poc/probe-' + uuid.uuid4().hex + '.ics'
    payload = fixtures()['ordinary'].replace(b'poc-ordinary@', ('poc-' + uuid.uuid4().hex + '@').encode())
    headers = {'Content-Type': 'text/calendar', 'If-None-Match': '*'}
    expect(client.request('PUT', path, 'poc-writer', payload, headers).status_code == 201, 'writer create')
    original = client.request('GET', path)
    expect(original.status_code == 200 and original.headers.get('ETag'), 'reader GET and ETag')
    tag = original.headers['ETag']
    for method in ('PUT', 'DELETE'):
        response = client.request(method, path, 'poc-reader', payload if method == 'PUT' else None, {'Content-Type': 'text/calendar'})
        expect(response.status_code == 403, 'reader denied ' + method)
    denied_path = '/poc-reader/poc/denied-' + uuid.uuid4().hex + '.ics'
    expect(client.request('PUT', denied_path, 'poc-reader', payload, headers).status_code == 403, 'reader cannot create')
    expect(client.request('GET', path, 'poc-outsider').status_code == 403, 'account isolation')
    expect(client.request('GET', path, None).status_code == 401, 'anonymous denied')
    expect(client.request('GET', path).headers['ETag'] == tag, 'denied writes leave object unchanged')
    changed = payload.replace(b'POC ordinary', b'POC changed')
    expect(client.request('PUT', path, 'poc-writer', changed, {'Content-Type': 'text/calendar', 'If-Match': '"stale"'}).status_code == 412, 'stale ETag rejected')
    expect(client.request('PUT', path, 'poc-writer', changed, {'Content-Type': 'text/calendar', 'If-Match': tag}).status_code == 204, 'conditional update')
    updated = client.request('GET', path)
    expect(updated.headers['ETag'] != tag and b'POC changed' in updated.content, 'reader sees update')
    expect(client.request('DELETE', path, 'poc-writer', headers={'If-Match': tag}).status_code == 412, 'stale delete rejected')
    expect(client.request('DELETE', path, 'poc-writer', headers={'If-Match': updated.headers['ETag']}).status_code == 200, 'conditional delete')
    expect(client.request('GET', path).status_code == 404, 'reader sees delete')
    read_checks(client)
    return {'crud': 'PASS', 'readonly': 'PASS', 'ownership': 'PASS', 'etag': 'PASS'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--mode', choices=('read', 'seed', 'cycle'), default='read')
    parser.add_argument('--allow-write', action='store_true')
    parser.add_argument('--date', type=date.fromisoformat)
    args = parser.parse_args()
    if args.mode != 'read' and not args.allow_write:
        parser.error('seed/cycle require --allow-write; use ONLY isolated POC service')
    users = ('poc-reader',) if args.mode == 'read' else ('poc-writer', 'poc-reader', 'poc-phone', 'poc-outsider')
    credentials = {user: getpass.getpass(user + ' password: ') for user in users}
    client = Client(args.url, credentials)
    result = read_checks(client) if args.mode == 'read' else seed(client, args.date) if args.mode == 'seed' else cycle_checks(client)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except CheckFailure as error:
        print(json.dumps({'result': 'FAIL', 'check': str(error)}))
        raise SystemExit(1)
    except Exception:
        print('{"result":"FAIL","reason":"connection/config/protocol error; raw details suppressed"}')
        raise SystemExit(1)
