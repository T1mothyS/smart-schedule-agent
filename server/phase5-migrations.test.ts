import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { applyChatSchema } from './database/schema.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-phase5-migration-'));
process.env.DATA_DIR = root;
const SQL = await initSqlJs();
const fixture = new SQL.Database();
function queries(db: InstanceType<typeof SQL.Database>) {
  function queryAll<T>(sql: string, params: any[] = []): T[] {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params); const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally { stmt.free(); }
  }
  return { queryAll, queryOne<T>(sql: string, params?: any[]) { return queryAll<T>(sql, params)[0]; } };
}
applyChatSchema(fixture, queries(fixture));
fixture.run("INSERT INTO users (id,email,password_hash,role,created_at,updated_at) VALUES ('owner','owner@example.invalid','synthetic','admin','2020-01-01','2020-01-01')");
fixture.run("INSERT INTO sessions (id,user_id,title,model,created_at,updated_at) VALUES ('legacy-session','owner','preserved','synthetic','2020-01-01','2020-01-01')");
fixture.run("INSERT INTO reminders (id,user_id,created_at,updated_at) VALUES ('legacy-pref','owner','2020-01-01','2020-01-01')");
fixture.run("INSERT INTO note_items (id,user_id,content,created_at,updated_at) VALUES ('legacy-note','owner','preserve this','2020-01-01','2020-01-01')");
fixture.run('DROP INDEX idx_sessions_user_id');
for (const [table, columns] of Object.entries({ users: ['auth_version', 'preferred_model', 'admin_shared_api_enabled'], sessions: ['user_id'], reminders: ['daily_report_delivery_sources', 'home_timezone'], note_items: ['color'], ai_schedule_messages: ['knowledge_sources'], library_entry_versions: ['relations_json'] })) {
  for (const column of columns) fixture.run(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}
const databasePath = path.join(root, 'chat.db');
const original = Buffer.from(fixture.export()); fixture.close();
fs.writeFileSync(databasePath, original);
const db = await import('./db.js');

test('legacy migration retains rows, defaults and ownership, and is stable after reopening', async () => {
  await db.initDb();
  assert.equal(db.getUserById('owner')?.auth_version, 0);
  assert.equal(db.getUserById('owner')?.admin_shared_api_enabled, 0);
  assert.equal(db.getSession('legacy-session', 'owner')?.title, 'preserved');
  assert.equal(db.getSession('legacy-session', 'other'), undefined);
  assert.equal(db.getNoteItem('legacy-note', 'owner')?.color, 'neutral');
  assert.equal(db.getReminder('owner')?.daily_report_delivery_sources, '["local"]');
  const dump = (bytes: Buffer) => {
    const image = new SQL.Database(bytes);
    try {
      const q = queries(image);
      const tables = q.queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
      return { schema: q.queryAll("SELECT type,name,sql FROM sqlite_master ORDER BY type,name"), rows: tables.map(t => q.queryAll(`SELECT * FROM "${t.name}" ORDER BY rowid`)) };
    } finally { image.close(); }
  };
  const once = dump(db.exportChatDb());
  await db.initDb();
  assert.deepEqual(dump(db.exportChatDb()), once);
  assert.deepEqual(dump(fs.readFileSync(databasePath)), once);
});

test('unreconciled WAL is rejected before migrated state can overwrite it', async () => {
  const before = fs.readFileSync(databasePath);
  const wal = databasePath + '-wal';
  fs.writeFileSync(wal, 'synthetic pending WAL');
  try {
    await assert.rejects(db.initDb(), /WAL/);
    assert.deepEqual(fs.readFileSync(databasePath), before);
  } finally { fs.unlinkSync(wal); }
});

test('migration write failure preserves the old disk and can be retried', async t => {
  fs.writeFileSync(databasePath, original);
  const rename = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to) === databasePath) throw new Error('injected migration replacement failure');
    return rename(from, to);
  });
  try { await assert.rejects(db.initDb(), /injected/); }
  finally { mock.mock.restore(); }
  assert.deepEqual(fs.readFileSync(databasePath), original);
  await db.initDb();
  assert.equal(db.getNoteItem('legacy-note', 'owner')?.content, 'preserve this');
  assert.equal(db.getSession('legacy-session', 'other'), undefined);
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
