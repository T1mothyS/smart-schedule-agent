"""Loopback-only POC gateway. Only allowlisted protocol metadata reaches stdout.

Radicale/Waitress raw logs are disabled, not collected then redacted. No application
imports, database access, or integration with AI Calendar. TLS terminates at nginx.
"""
import argparse
import hashlib
import io
import json
import logging
import re
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from defusedxml import ElementTree as ET

MAX_BODY = 1024 * 1024
METHODS = {'OPTIONS', 'PROPFIND', 'REPORT', 'GET', 'HEAD', 'PUT', 'DELETE',
           'MKCALENDAR', 'MKCOL', 'PROPPATCH'}
XML_NAMES = {'propfind', 'prop', 'allprop', 'propname', 'current-user-principal',
             'principal-URL', 'calendar-home-set', 'displayname', 'resourcetype',
             'supported-calendar-component-set', 'calendar-query', 'calendar-multiget',
             'calendar-data', 'filter', 'comp-filter', 'time-range', 'sync-collection',
             'sync-token', 'sync-level', 'getetag', 'getcontenttype', 'href',
             'current-user-privilege-set', 'supported-report-set', 'getctag'}
LOCK = threading.Lock()


def fingerprint(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()[:16] if value else None


def safe_path(path):
    # Never echo unknown paths, query strings, calendar names, or object IDs.
    if path in ('/', '/.well-known/caldav', '/.well-known/caldav/'):
        return path
    match = re.fullmatch(r'/(poc-reader|poc-phone|poc-writer|poc-outsider)(/poc)?(/[^/]+)?/?', path)
    if not match:
        return '[other]'
    principal, calendar, item = match.groups()
    return '/' + principal + (calendar or '') + ('/[item]' if item else '/')


def xml_shape(body):
    if not body:
        return []
    try:
        root = ET.fromstring(body)
        return sorted({node.tag.split('}', 1)[-1] for node in root.iter()
                       if isinstance(node.tag, str) and node.tag.split('}', 1)[-1] in XML_NAMES})
    except Exception:
        return ['[invalid-or-non-xml]']


def audit_record(environ, body, status, headers):
    response = {k.lower(): v for k, v in headers}
    depth = environ.get('HTTP_DEPTH')
    ctype = environ.get('CONTENT_TYPE', '').split(';')[0].lower()
    return {
        'at': datetime.now(timezone.utc).isoformat(),
        'method': environ.get('REQUEST_METHOD') if environ.get('REQUEST_METHOD') in METHODS else '[other]',
        'path': safe_path(environ.get('PATH_INFO', '')),
        'status': int(status.split()[0]),
        'depth': depth if depth in ('0', '1', 'infinity') else None,
        'content_type': ctype if ctype in ('application/xml', 'text/xml', 'text/calendar') else None,
        'basic_auth_present': environ.get('HTTP_AUTHORIZATION', '').startswith('Basic '),
        'if_match_present': bool(environ.get('HTTP_IF_MATCH')),
        'if_match_fingerprint': fingerprint(environ.get('HTTP_IF_MATCH')),
        'if_none_match_present': bool(environ.get('HTTP_IF_NONE_MATCH')),
        'etag_fingerprint': fingerprint(response.get('etag')),
        'dav_present': 'dav' in response,
        'xml_elements': xml_shape(body) if environ.get('REQUEST_METHOD') in ('PROPFIND', 'REPORT', 'PROPPATCH', 'MKCALENDAR') else [],
    }


class SafeAudit:
    def __init__(self, app, emit=None):
        self.app = app
        self.emit = emit or self.write

    @staticmethod
    def write(record):
        with LOCK:
            print(json.dumps(record, ensure_ascii=True), flush=True)

    def __call__(self, environ, start_response):
        length = int(environ.get('CONTENT_LENGTH') or 0)
        if length < 0 or length > MAX_BODY:
            start_response('413 Payload Too Large', [('Content-Length', '0')])
            return [b'']
        body = environ['wsgi.input'].read(length)
        environ['wsgi.input'] = io.BytesIO(body)
        captured = {}

        def capture(status, headers, exc_info=None):
            captured.update(status=status, headers=headers)
            return start_response(status, headers, exc_info)

        # Radicale is a buffered WSGI app. Waitress owns connection bounds/timeouts.
        result = self.app(environ, capture)
        self.emit(audit_record(environ, body, captured['status'], captured['headers']))
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--port', type=int, default=5232)
    args = parser.parse_args()
    # Do not persist raw errors, HTTP auth values, body dumps or third-party logs.
    logging.disable(logging.CRITICAL)
    from radicale import Application, config
    from waitress import serve
    application = Application(config.load([(str(args.config.resolve()), False)]))
    serve(SafeAudit(application), host='127.0.0.1', port=args.port, threads=4,
          connection_limit=32, channel_timeout=30, max_request_body_size=MAX_BODY,
          trusted_proxy='127.0.0.1', trusted_proxy_headers={'x-forwarded-proto'},
          clear_untrusted_proxy_headers=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('POC_START_FAILED: check config, permissions and pinned runtime', file=sys.stderr)
        raise SystemExit(1)
