"""Run actual AI Calendar CRUD/API -> bridge -> fresh Radicale, never public POC."""
import json
import os
from pathlib import Path
import subprocess
from test_poc import ServerTests
from probe import seed, read_checks


def main():
    ServerTests.setUpClass()
    try:
        seed(ServerTests.client)
        env = {**os.environ, 'CALDAV_FIXTURE_URL': ServerTests.client.base,
               'CALDAV_FIXTURE_CREDENTIALS': json.dumps(ServerTests.creds)}
        result = subprocess.run(['node', '--import', 'tsx', 'server/caldav-radicale.fixture.ts'],
                                cwd=Path(__file__).resolve().parents[2], env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
        output = result.stdout.decode('utf-8', errors='replace')
        assert all(secret not in output for secret in ServerTests.creds.values()), 'unsafe fixture output suppressed'
        (ServerTests.runtime / 'bridge-smoke.log').write_text(output, encoding='utf-8')
        if result.returncode:
            print(output[-5000:])
            raise SystemExit(result.returncode)
        assert read_checks(ServerTests.client)['objects'] == 9, 'unowned seed resources changed'
        for line in output.splitlines():
            if line.startswith('SMOKE_RESULT:'):
                print(line)
        print('Original 9 synthetic resources preserved: PASS')
    finally:
        ServerTests.tearDownClass()


if __name__ == '__main__':
    main()
