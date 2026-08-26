import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-legacy-schedule-'));
const scheduleDbPath = path.join(tempDir, 'schedule.db');
process.env.DATA_DIR = tempDir;

const SQL = await initSqlJs();
const legacyDb = new SQL.Database();
legacyDb.run(`
  CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    user_id TEXT DEFAULT 'default',
    calendar_id TEXT DEFAULT 'personal',
    type TEXT DEFAULT 'event',
    title TEXT NOT NULL,
    description TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    all_day INTEGER DEFAULT 0,
    is_unscheduled INTEGER DEFAULT 0,
    location TEXT,
    notes TEXT,
    category TEXT DEFAULT 'other',
    priority TEXT DEFAULT 'medium',
    is_completed INTEGER DEFAULT 0,
    is_repeated INTEGER DEFAULT 0,
    repeat_rule TEXT,
    reminders TEXT,
    is_high_risk INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);
fs.writeFileSync(scheduleDbPath, Buffer.from(legacyDb.export()));

const schedules = await import('./schedule-store.js');
await schedules.initScheduleDb();

test('旧版 end_time 非空表可保存未指定结束时间的普通日程', () => {
  const startTime = '2026-08-27T09:00:00';
  const created = schedules.createSchedule({
    id: 'legacy-no-end-time',
    user_id: 'legacy-user',
    calendar_id: 'personal',
    type: 'event',
    title: '测量海报尺寸',
    start_time: startTime,
    end_time: undefined,
    all_day: false,
    is_unscheduled: false,
    category: 'work',
    priority: 'medium',
    is_completed: false,
    is_repeated: false,
    reminders: [],
    is_high_risk: false,
  });

  assert.equal(created.end_time, undefined);
  const persistedDb = new SQL.Database(fs.readFileSync(scheduleDbPath));
  const statement = persistedDb.prepare("SELECT start_time, end_time FROM schedules WHERE id = 'legacy-no-end-time'");
  assert.equal(statement.step(), true);
  assert.deepEqual(statement.getAsObject(), { start_time: startTime, end_time: '' });
  statement.free();
});

test('待办不保留结束时间并兼容旧版非空字段', () => {
  const startTime = '2026-08-27T11:00:00';
  const created = schedules.createSchedule({
    id: 'legacy-todo-point',
    user_id: 'legacy-user',
    calendar_id: 'personal',
    type: 'todo',
    title: '发送会议纪要',
    start_time: startTime,
    end_time: '2026-08-27T12:00:00',
    all_day: false,
    is_unscheduled: false,
    category: 'work',
    priority: 'medium',
    is_completed: false,
    is_repeated: false,
    reminders: [],
    is_high_risk: false,
  });

  assert.equal(created.end_time, undefined);
  const persistedDb = new SQL.Database(fs.readFileSync(scheduleDbPath));
  const statement = persistedDb.prepare("SELECT start_time, end_time, type FROM schedules WHERE id = 'legacy-todo-point'");
  assert.equal(statement.step(), true);
  assert.deepEqual(statement.getAsObject(), { start_time: startTime, end_time: '', type: 'todo' });
  statement.free();

  const updated = schedules.updateSchedule(created.id, { end_time: '2026-08-27T13:00:00' });
  assert.equal(updated?.end_time, undefined);
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
