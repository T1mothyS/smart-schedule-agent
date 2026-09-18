"""Create a NEW htpasswd file interactively; passwords are never echoed or logged."""
import argparse
import getpass
from pathlib import Path
import bcrypt

USERS = ('poc-writer', 'poc-reader', 'poc-phone', 'poc-outsider')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Refusing to overwrite existing users file')
    rows = []
    for user in USERS:
        password = getpass.getpass(user + ' new password (16-72 UTF-8 bytes): ')
        if not 16 <= len(password.encode()) <= 72:
            parser.error('Password length must be 16-72 UTF-8 bytes')
        if password != getpass.getpass('Confirm: '):
            parser.error('Passwords do not match')
        rows.append(user + ':' + bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode())
    with args.output.open('x', encoding='utf-8', newline='\n') as stream:
        args.output.chmod(0o600)
        stream.write('\n'.join(rows) + '\n')
    print('Created hash-only credentials. Restrict directory permissions too.')


if __name__ == '__main__':
    main()
