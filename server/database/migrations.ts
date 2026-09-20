import type { Database } from 'sql.js';

export interface SchemaQueries {
  queryAll<T>(sql: string, params?: any[]): T[];
  queryOne<T>(sql: string, params?: any[]): T | undefined;
}

export function migrateAiHistory(db: Database, { queryAll, queryOne }: SchemaQueries): void {
  const aiScheduleMessageColumns = queryAll<{ name: string }>('PRAGMA table_info(ai_schedule_messages)');
  if (!aiScheduleMessageColumns.some(column => column.name === 'knowledge_sources')) {
    db.run('ALTER TABLE ai_schedule_messages ADD COLUMN knowledge_sources TEXT');
  }

}

export function migrateUsers(db: Database, { queryAll, queryOne }: SchemaQueries): void {
  const userColumns = queryAll<{ name: string }>('PRAGMA table_info(users)');
  if (!userColumns.some(column => column.name === 'auth_version')) {
    db.run('ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0');
  }
  if (!userColumns.some(column => column.name === 'preferred_model')) {
    db.run('ALTER TABLE users ADD COLUMN preferred_model TEXT');
  }
  if (!userColumns.some(column => column.name === 'admin_shared_api_enabled')) {
    db.run('ALTER TABLE users ADD COLUMN admin_shared_api_enabled INTEGER NOT NULL DEFAULT 0');
  }

}

export function migrateSessions(db: Database, { queryAll, queryOne }: SchemaQueries): void {
  const sessionColumns = queryAll<{ name: string }>('PRAGMA table_info(sessions)');
  if (!sessionColumns.some(column => column.name === 'user_id')) {
    db.run('ALTER TABLE sessions ADD COLUMN user_id TEXT');
  }
  const legacySessionOwner = queryOne<{ id: string }>(
    "SELECT id FROM users ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at ASC LIMIT 1"
  );
  if (legacySessionOwner) {
    db.run("UPDATE sessions SET user_id = ? WHERE user_id IS NULL OR user_id = ''", [legacySessionOwner.id]);
  }

}

export function migratePreferences(db: Database, { queryAll, queryOne }: SchemaQueries): void {
  const reminderColumns = queryAll<{ name: string }>('PRAGMA table_info(reminders)');
  if (!reminderColumns.some(column => column.name === 'reminder_email')) {
    db.run('ALTER TABLE reminders ADD COLUMN reminder_email TEXT');
  }
  const reminderMigrations: Array<[string, string]> = [
    ['email_enabled', "INTEGER NOT NULL DEFAULT 1"],
    ['report_email_enabled', "INTEGER NOT NULL DEFAULT 0"],
    ['daily_report_delivery_sources', "TEXT NOT NULL DEFAULT '[\"local\"]'"],
    ['in_app_enabled', "INTEGER NOT NULL DEFAULT 1"],
    ['browser_enabled', "INTEGER NOT NULL DEFAULT 1"],
    ['timezone', "TEXT NOT NULL DEFAULT 'Asia/Shanghai'"],
    ['quiet_hours_enabled', "INTEGER NOT NULL DEFAULT 0"],
    ['quiet_start', "TEXT NOT NULL DEFAULT '22:00'"],
    ['quiet_end', "TEXT NOT NULL DEFAULT '08:00'"],
    ['home_location_name', 'TEXT'],
    ['home_location_admin1', 'TEXT'],
    ['home_location_country', 'TEXT'],
    ['home_latitude', 'REAL'],
    ['home_longitude', 'REAL'],
    ['home_timezone', 'TEXT'],
  ];
  for (const [name, definition] of reminderMigrations) {
    if (!reminderColumns.some(column => column.name === name)) db.run(`ALTER TABLE reminders ADD COLUMN ${name} ${definition}`);
  }
}

export function migrateNotes(db: Database, { queryAll, queryOne }: SchemaQueries): void {
  const noteColumns = queryAll<{ name: string }>('PRAGMA table_info(note_items)');
  if (!noteColumns.some(column => column.name === 'color')) {
    // 旧版本没有颜色列，新增列使用中性灰作为安全默认值；SQLite 旧表无法原地补 CHECK 约束，API 层仍会严格校验写入值。
    db.run("ALTER TABLE note_items ADD COLUMN color TEXT NOT NULL DEFAULT 'neutral'");
  }
  const noteMigrations: Array<[string, string]> = [
    ['is_optimized', 'INTEGER NOT NULL DEFAULT 0'],
    ['optimization_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['optimization_previous_content', 'TEXT'],
    ['content_revision', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [name, definition] of noteMigrations) {
    if (!noteColumns.some(column => column.name === name)) db.run(`ALTER TABLE note_items ADD COLUMN ${name} ${definition}`);
  }
  db.run("UPDATE note_items SET color = 'neutral' WHERE color IS NULL OR color NOT IN ('neutral', 'purple', 'blue', 'green', 'amber', 'rose')");
  db.run('UPDATE note_items SET optimization_count = 0 WHERE optimization_count IS NULL OR optimization_count < 0');
  db.run('UPDATE note_items SET content_revision = 0 WHERE content_revision IS NULL OR content_revision < 0');
  db.run(`UPDATE note_items
    SET is_optimized = 0, optimization_previous_content = NULL
    WHERE is_optimized IS NULL OR is_optimized NOT IN (0, 1)
      OR is_optimized = 1 AND (optimization_previous_content IS NULL OR trim(optimization_previous_content) = '')`);
  db.run('UPDATE note_items SET optimization_previous_content = NULL WHERE is_optimized = 0');

}

export function migrateLibraryEntries(db: Database, { queryAll, queryOne }: SchemaQueries): void {
  const libraryEntryColumns = queryAll<{ name: string }>('PRAGMA table_info(library_entries)');
  const libraryEntryMigrations: Array<[string, string]> = [
    ['kind', "TEXT NOT NULL DEFAULT 'fragment'"],
    ['type', "TEXT NOT NULL DEFAULT 'knowledge'"],
    ['source_id', 'TEXT'],
    ['slug', 'TEXT'],
    ['summary', "TEXT NOT NULL DEFAULT ''"],
    ['tags_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['status', "TEXT NOT NULL DEFAULT 'active'"],
    ['source_type', "TEXT NOT NULL DEFAULT 'manual'"],
    ['source_ref', 'TEXT'],
    ['source_url', 'TEXT'],
    ['metadata_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['relations_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['content_hash', "TEXT NOT NULL DEFAULT ''"],
    ['published_at', 'TEXT'],
    ['archived_at', 'TEXT'],
  ];
  for (const [name, definition] of libraryEntryMigrations) {
    if (!libraryEntryColumns.some(column => column.name === name)) {
      db.run(`ALTER TABLE library_entries ADD COLUMN ${name} ${definition}`);
    }
  }

}

export function migrateLibraryVersions(db: Database, { queryAll, queryOne }: SchemaQueries): void {
  const libraryVersionColumns = queryAll<{ name: string }>('PRAGMA table_info(library_entry_versions)');
  if (!libraryVersionColumns.some(column => column.name === 'relations_json')) {
    db.run("ALTER TABLE library_entry_versions ADD COLUMN relations_json TEXT NOT NULL DEFAULT '[]'");
  }

}
