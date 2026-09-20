import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-note-color-migration-'));
process.env.DATA_DIR = tempDir;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';

const SQL = await initSqlJs();
const oldDatabase = new SQL.Database();
oldDatabase.run(`
  CREATE TABLE note_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    linked_schedule_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);
oldDatabase.run(`
  INSERT INTO note_items (id, user_id, content, completed, completed_at, linked_schedule_ids, created_at, updated_at)
  VALUES ('legacy-note', 'legacy-user', '旧数据库记事', 0, NULL, '["old-schedule"]', '2026-09-03T10:00:00.000Z', '2026-09-03T10:00:00.000Z')
`);
fs.writeFileSync(path.join(tempDir, 'chat.db'), Buffer.from(oldDatabase.export()));

const db = await import('./db.js');
const noteItems = await import('./note-item-service.js');
await db.initDb();

test('旧 note_items 数据库迁移后使用中性灰并保留历史关联字段', () => {
  const [item] = noteItems.listNoteItems('legacy-user');
  assert.ok(item);
  assert.equal(item.color, 'neutral');
  assert.deepEqual(item.linkedScheduleIds, ['old-schedule']);
  assert.equal(item.isOptimized, false);
  assert.equal(item.optimizationCount, 0);
  assert.equal(item.contentRevision, 0);
});
