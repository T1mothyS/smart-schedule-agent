"""Safely reconcile a legacy chat.db main file with an adjacent SQLite WAL.

The application uses sql.js and therefore cannot consume a WAL created by a
native SQLite client.  This maintenance command keeps the current sql.js main
database as the canonical schema, merges rows visible through the WAL, maps
duplicate e-mail accounts to the current account id, and only replaces the
database after integrity checks pass.

Dry-run is the default:
    python scripts/reconcile_chat_wal.py --data-dir data

Apply after reviewing the summary:
    python scripts/reconcile_chat_wal.py --data-dir data --apply
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import pathlib
import shutil
import sqlite3
import tempfile
import uuid
from typing import Any


def rows(connection: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    connection.row_factory = sqlite3.Row
    return [dict(row) for row in connection.execute(f'SELECT * FROM "{table}"')]


def table_names(connection: sqlite3.Connection) -> set[str]:
    return {
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
    }


def column_names(connection: sqlite3.Connection, table: str) -> list[str]:
    return [str(row[1]) for row in connection.execute(f'PRAGMA table_info("{table}")')]


def insert_row(
    connection: sqlite3.Connection,
    table: str,
    row: dict[str, Any],
    *,
    replace: bool = False,
) -> None:
    allowed = set(column_names(connection, table))
    values = {key: value for key, value in row.items() if key in allowed}
    columns = list(values)
    placeholders = ', '.join('?' for _ in columns)
    verb = 'INSERT OR REPLACE' if replace else 'INSERT'
    connection.execute(
        f'{verb} INTO "{table}" ({", ".join(columns)}) VALUES ({placeholders})',
        [values[column] for column in columns],
    )


def existing_ids(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[0]) for row in connection.execute(f'SELECT id FROM "{table}"')}


def unique_id(preferred: str, occupied: set[str]) -> str:
    if preferred not in occupied:
        occupied.add(preferred)
        return preferred
    candidate = str(uuid.uuid4())
    while candidate in occupied:
        candidate = str(uuid.uuid4())
    occupied.add(candidate)
    return candidate


def count(connection: sqlite3.Connection, table: str) -> int:
    return int(connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])


def reconcile(main_path: pathlib.Path, output_path: pathlib.Path) -> dict[str, Any]:
    main_uri = f'file:{main_path.as_posix()}?mode=ro&immutable=1'
    wal_uri = f'file:{main_path.as_posix()}?mode=ro'
    source_main = sqlite3.connect(main_uri, uri=True)
    source_wal = sqlite3.connect(wal_uri, uri=True)
    try:
        if source_main.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('chat.db main file failed integrity_check')
        if source_wal.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('chat.db WAL view failed integrity_check')

        shutil.copy2(main_path, output_path)
        target = sqlite3.connect(output_path)
        target.row_factory = sqlite3.Row
        target.execute('PRAGMA journal_mode = DELETE')
        target.execute('PRAGMA foreign_keys = OFF')
        target_tables = table_names(target)
        wal_tables = table_names(source_wal)

        user_id_map: dict[str, str] = {}
        target_users_by_email = {
            str(row['email']).strip().lower(): dict(row)
            for row in target.execute('SELECT * FROM users').fetchall()
        }
        occupied_user_ids = existing_ids(target, 'users')
        wal_users = rows(source_wal, 'users') if 'users' in wal_tables else []
        for user in wal_users:
            source_id = str(user['id'])
            email_key = str(user['email']).strip().lower()
            current = target_users_by_email.get(email_key)
            if current:
                user_id_map[source_id] = str(current['id'])
                continue
            target_id = unique_id(source_id, occupied_user_ids)
            copied = {**user, 'id': target_id}
            insert_row(target, 'users', copied)
            target_users_by_email[email_key] = copied
            user_id_map[source_id] = target_id

        canonical_admin_id = next(
            (
                user_id_map[str(user['id'])]
                for user in sorted(wal_users, key=lambda item: str(item.get('created_at') or ''))
                if user.get('role') == 'admin'
            ),
            next(iter(occupied_user_ids), 'default'),
        )

        session_id_map: dict[str, str] = {}
        if 'sessions' in target_tables and 'sessions' in wal_tables:
            occupied_session_ids = existing_ids(target, 'sessions')
            target_session_columns = set(column_names(target, 'sessions'))
            for session in rows(source_wal, 'sessions'):
                source_id = str(session['id'])
                if source_id in occupied_session_ids:
                    session_id_map[source_id] = source_id
                    continue
                target_id = unique_id(source_id, occupied_session_ids)
                source_owner = str(session.get('user_id') or '')
                owner = user_id_map.get(source_owner, canonical_admin_id)
                copied = {**session, 'id': target_id}
                if 'user_id' in target_session_columns:
                    copied['user_id'] = owner
                insert_row(target, 'sessions', copied)
                session_id_map[source_id] = target_id

        if 'messages' in target_tables and 'messages' in wal_tables:
            occupied_message_ids = existing_ids(target, 'messages')
            for message in rows(source_wal, 'messages'):
                source_id = str(message['id'])
                if source_id in occupied_message_ids:
                    continue
                source_session = str(message.get('session_id') or '')
                target_session = session_id_map.get(source_session, source_session)
                if not target.execute('SELECT 1 FROM sessions WHERE id = ?', (target_session,)).fetchone():
                    continue
                target_id = unique_id(source_id, occupied_message_ids)
                insert_row(target, 'messages', {**message, 'id': target_id, 'session_id': target_session})

        for table in ('reminders', 'user_api_keys'):
            if table not in target_tables or table not in wal_tables:
                continue
            for item in rows(source_wal, table):
                source_owner = str(item.get('user_id') or '')
                target_owner = user_id_map.get(source_owner)
                if not target_owner:
                    continue
                if target.execute(f'SELECT 1 FROM "{table}" WHERE user_id = ?', (target_owner,)).fetchone():
                    continue
                copied = {**item, 'user_id': target_owner}
                if table == 'reminders':
                    copied.update(
                        {
                            'reminder_email': copied.get('reminder_email'),
                            'email_enabled': copied.get('email_enabled', 1),
                            'in_app_enabled': copied.get('in_app_enabled', 1),
                            'browser_enabled': copied.get('browser_enabled', 1),
                            'timezone': copied.get('timezone') or 'Asia/Shanghai',
                            'quiet_hours_enabled': copied.get('quiet_hours_enabled', 0),
                            'quiet_start': copied.get('quiet_start') or '22:00',
                            'quiet_end': copied.get('quiet_end') or '08:00',
                        }
                    )
                insert_row(target, table, copied)

        if 'email_codes' in target_tables and 'email_codes' in wal_tables:
            occupied_code_ids = existing_ids(target, 'email_codes')
            for code in rows(source_wal, 'email_codes'):
                source_id = str(code['id'])
                if source_id in occupied_code_ids:
                    continue
                insert_row(target, 'email_codes', {**code, 'id': unique_id(source_id, occupied_code_ids)})

        target.commit()
        target.execute('PRAGMA journal_mode = DELETE')
        integrity = target.execute('PRAGMA integrity_check').fetchone()[0]
        if integrity != 'ok':
            raise RuntimeError(f'reconciled database failed integrity_check: {integrity}')
        summary = {
            table: count(target, table)
            for table in sorted(target_tables)
            if table in {'users', 'sessions', 'messages', 'reminders', 'user_api_keys', 'ai_schedule_messages'}
        }
        target.close()
        return {'integrity': integrity, 'counts': summary, 'mappedUsers': len(user_id_map)}
    finally:
        source_main.close()
        source_wal.close()


def main() -> int:
    parser = argparse.ArgumentParser(description='Reconcile chat.db with a legacy WAL safely.')
    parser.add_argument('--data-dir', default='data')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()

    data_dir = pathlib.Path(args.data_dir).resolve()
    main_path = data_dir / 'chat.db'
    wal_path = data_dir / 'chat.db-wal'
    shm_path = data_dir / 'chat.db-shm'
    if not main_path.is_file():
        raise SystemExit(f'chat database does not exist: {main_path}')
    if not wal_path.is_file() or wal_path.stat().st_size == 0:
        print('No non-empty chat.db-wal was found; nothing to reconcile.')
        return 0

    with tempfile.TemporaryDirectory(prefix='aicalendar-chat-reconcile-') as temp_dir:
        candidate = pathlib.Path(temp_dir) / 'chat.db'
        summary = reconcile(main_path, candidate)
        print('Reconciled candidate:', summary)
        if not args.apply:
            print('Dry-run only. Re-run with --apply after reviewing the counts.')
            return 0

        stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
        backup_dir = data_dir / 'pre-fix-backups' / f'chat-wal-recovery-{stamp}'
        backup_dir.mkdir(parents=True, exist_ok=False)
        for source in (main_path, wal_path, shm_path):
            if source.exists():
                shutil.copy2(source, backup_dir / source.name)

        replacement = data_dir / f'chat.db.reconciled-{os.getpid()}.tmp'
        shutil.copy2(candidate, replacement)
        os.replace(replacement, main_path)
        if wal_path.exists():
            os.replace(wal_path, backup_dir / 'chat.db-wal.consumed')
        if shm_path.exists():
            os.replace(shm_path, backup_dir / 'chat.db-shm.consumed')

        verify = sqlite3.connect(f'file:{main_path.as_posix()}?mode=ro', uri=True)
        try:
            integrity = verify.execute('PRAGMA integrity_check').fetchone()[0]
            if integrity != 'ok':
                raise RuntimeError(f'installed database failed integrity_check: {integrity}')
        finally:
            verify.close()
        print(f'Applied safely. Original files are preserved in: {backup_dir}')
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
