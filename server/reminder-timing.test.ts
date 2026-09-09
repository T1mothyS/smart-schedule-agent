import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-reminder-timing-'));
process.env.DATA_DIR = tempDir;
process.env.APP_TIMEZONE = 'Asia/Shanghai';

const SQL = await initSqlJs();
const seed = new SQL.Database();
seed.run(`
  CREATE TABLE reminder_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('credit_card', 'sim')),
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    config TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);
seed.run(
  `INSERT INTO reminder_tasks (id, user_id, type, name, enabled, timezone, config, created_at, updated_at)
   VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  [
    'migration-task',
    'migration-user',
    'sim',
    '迁移前任务',
    'UTC',
    JSON.stringify({
      provider: '测试运营商',
      numberMasked: '138****0000',
      region: '中国大陆',
      intervalDays: 30,
      lastOperationDate: '2026-09-01',
      actionGuide: '测试',
      reminderOffsets: [0],
      reminderTime: '09:00',
      priority: 'medium',
    }),
    '2026-09-01T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
  ],
);
fs.writeFileSync(path.join(tempDir, 'reminder.db'), Buffer.from(seed.export()));

const reminders = await import('./reminder-store.js');
await reminders.initReminderDb();

test('周期提醒一次性迁移为上海时区 12:00 并在重复启动时保持幂等', async () => {
  const task = reminders.listReminderTasks('migration-user')[0];
  assert.equal(task.timezone, reminders.DEFAULT_CYCLE_REMINDER_TIMEZONE);
  assert.equal((task.config as { reminderTime: string }).reminderTime, reminders.DEFAULT_CYCLE_REMINDER_TIME);

  const backupDir = path.join(tempDir, 'migration-backups');
  const firstBackups = fs.readdirSync(backupDir).filter(name => name.startsWith('reminder-cycle-defaults-'));
  assert.equal(firstBackups.length, 1);
  assert.equal(await reminders.applyCycleReminderDefaultsMigration(), false);

  await reminders.initReminderDb();
  const secondBackups = fs.readdirSync(backupDir).filter(name => name.startsWith('reminder-cycle-defaults-'));
  assert.deepEqual(secondBackups, firstBackups);
});

test('周期提醒在上海时间 12:00 前不入队，到点后所有渠道共用同一触发点', () => {
  const today = reminders.todayInTimezone(reminders.DEFAULT_CYCLE_REMINDER_TIMEZONE, new Date());
  const task = reminders.createReminderTask({
    userId: 'timing-user',
    type: 'generic',
    name: '中午触发测试',
    timezone: reminders.DEFAULT_CYCLE_REMINDER_TIMEZONE,
    config: {
      templateKey: 'custom',
      rule: { frequency: 'once', anchorDate: today, advancePolicy: 'calendar' },
      reminderOffsets: [0],
      reminderTime: reminders.DEFAULT_CYCLE_REMINDER_TIME,
      actionGuide: '测试',
      priority: 'medium',
    },
  });

  const beforeNoon = reminders.getDueReminders(new Date(`${today}T03:59:00.000Z`)).filter(item => item.task.id === task.id);
  assert.equal(beforeNoon.length, 0);

  const atNoon = reminders.getDueReminders(new Date(`${today}T04:00:00.000Z`)).filter(item => item.task.id === task.id);
  assert.equal(atNoon.length, 1);
  assert.equal(atNoon[0].delayed, false);
});

test('服务中断跨过日期时立即补发并保留延迟标记', () => {
  const today = reminders.todayInTimezone(reminders.DEFAULT_CYCLE_REMINDER_TIMEZONE, new Date());
  const task = reminders.createReminderTask({
    userId: 'late-user',
    type: 'generic',
    name: '延迟补发测试',
    timezone: reminders.DEFAULT_CYCLE_REMINDER_TIMEZONE,
    config: {
      templateKey: 'custom',
      rule: { frequency: 'once', anchorDate: today, advancePolicy: 'calendar' },
      reminderOffsets: [0],
      reminderTime: reminders.DEFAULT_CYCLE_REMINDER_TIME,
      actionGuide: '测试',
      priority: 'medium',
    },
  });

  const nextDay = reminders.addDays(today, 1);
  const delayed = reminders.getDueReminders(new Date(`${nextDay}T04:00:00.000Z`)).filter(item => item.task.id === task.id);
  assert.equal(delayed.length, 1);
  assert.equal(delayed[0].delayed, true);
});

test('手动设置 00:00 仍合法并在上海本地午夜触发', () => {
  const today = reminders.todayInTimezone(reminders.DEFAULT_CYCLE_REMINDER_TIMEZONE, new Date());
  const tomorrow = reminders.addDays(today, 1);
  const task = reminders.createReminderTask({
    userId: 'midnight-user',
    type: 'generic',
    name: '手动午夜测试',
    timezone: reminders.DEFAULT_CYCLE_REMINDER_TIMEZONE,
    config: {
      templateKey: 'custom',
      rule: { frequency: 'once', anchorDate: tomorrow, advancePolicy: 'calendar' },
      reminderOffsets: [0],
      reminderTime: '00:00',
      actionGuide: '测试',
      priority: 'low',
    },
  });

  const beforeMidnight = reminders.getDueReminders(new Date(`${today}T15:59:00.000Z`)).filter(item => item.task.id === task.id);
  assert.equal(beforeMidnight.length, 0);
  const atMidnight = reminders.getDueReminders(new Date(`${today}T16:00:00.000Z`)).filter(item => item.task.id === task.id);
  assert.equal(atMidnight.length, 1);
  assert.equal(atMidnight[0].delayed, false);
});
