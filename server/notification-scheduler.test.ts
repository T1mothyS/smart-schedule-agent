import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-notification-scheduler-'));
process.env.DATA_DIR = tempDir;
process.env.APP_TIMEZONE = 'Asia/Shanghai';

const db = await import('./db.js');
const schedules = await import('./schedule-store.js');
const activity = await import('./activity-store.js');
const scheduler = await import('./notification-scheduler.js');

await db.initDb();
await schedules.initScheduleDb();
await activity.initActivityDb();

function createUser(id: string, disabled = 0): void {
  const now = new Date().toISOString();
  db.createUser({
    id,
    email: `${id}@example.com`,
    password_hash: 'not-a-real-password',
    role: 'user',
    disabled,
    created_at: now,
    updated_at: now,
  });
}

function saveReminder(userId: string, overrides: Partial<Parameters<typeof db.upsertReminder>[0]> = {}): void {
  const now = new Date().toISOString();
  db.upsertReminder({
    id: `reminder-${userId}`,
    user_id: userId,
    enabled: 0,
    hour: 8,
    minute: 0,
    reminder_email: `${userId}@example.com`,
    email_enabled: 1,
    in_app_enabled: 1,
    browser_enabled: 1,
    timezone: 'Asia/Shanghai',
    quiet_hours_enabled: 0,
    quiet_start: '22:00',
    quiet_end: '08:00',
    created_at: now,
    updated_at: now,
    ...overrides,
  });
}

function createSchedule(
  userId: string,
  id: string,
  startTime: string,
  overrides: Partial<Parameters<typeof schedules.createSchedule>[0]> = {},
): void {
  schedules.createSchedule({
    id,
    user_id: userId,
    calendar_id: 'personal',
    type: 'event',
    title: id,
    description: undefined,
    start_time: startTime,
    end_time: undefined,
    all_day: false,
    is_unscheduled: false,
    location: undefined,
    notes: undefined,
    category: 'other',
    priority: 'high',
    is_completed: false,
    is_repeated: false,
    repeat_rule: undefined,
    reminders: [],
    is_high_risk: false,
    ...overrides,
  });
}

test('日程本地时间按 Asia/Shanghai 解析，并支持跨午夜', () => {
  assert.equal(
    scheduler.parseScheduleStart('2026-08-27T08:10:00', 'Asia/Shanghai')?.toISOString(),
    '2026-08-27T00:10:00.000Z',
  );
  assert.equal(
    scheduler.parseScheduleStart('2026-08-28T00:05:00', 'Asia/Shanghai')?.toISOString(),
    '2026-08-27T16:05:00.000Z',
  );
  assert.equal(
    scheduler.parseScheduleStart('2026-08-27T08:10:00Z', 'Asia/Shanghai')?.toISOString(),
    '2026-08-27T08:10:00.000Z',
  );
  assert.equal(scheduler.parseScheduleStart('2026-02-30T08:10:00', 'Asia/Shanghai'), null);
});

test('每日摘要按同一配置时间幂等，修改当天时间可以再次入队', () => {
  const userId = 'daily-scheduler-user';
  createUser(userId);
  saveReminder(userId, { enabled: 1, hour: 8, minute: 0, email_enabled: 1, in_app_enabled: 0, browser_enabled: 0 });

  const atEight = new Date('2026-08-27T00:00:20.000Z');
  const first = scheduler.enqueueDueDailyDigestNotifications(atEight);
  const second = scheduler.enqueueDueDailyDigestNotifications(atEight);
  assert.equal(first.created, 1);
  assert.equal(first.deduplicated, 0);
  assert.equal(second.created, 0);
  assert.equal(second.deduplicated, 1);
  assert.equal(activity.listNotifications(userId).length, 1);
  assert.equal(activity.listNotifications(userId)[0]?.kind, 'daily_digest');

  saveReminder(userId, { enabled: 1, hour: 9, minute: 0, email_enabled: 1, in_app_enabled: 0, browser_enabled: 0 });
  const atNine = new Date('2026-08-27T01:00:20.000Z');
  const third = scheduler.enqueueDueDailyDigestNotifications(atNine);
  assert.equal(third.created, 1);
  assert.equal(third.deduplicated, 0);
  assert.equal(activity.listNotifications(userId).length, 2);

  scheduler.enqueueDueDailyDigestNotifications(new Date('2026-08-28T01:00:20.000Z'));
  assert.equal(activity.listNotifications(userId).length, 3);
  assert.deepEqual(
    activity.listNotifications(userId).map(item => item.dedupeKey).sort(),
    [
      `daily:${userId}:2026-08-27:Asia/Shanghai:08:00:email`,
      `daily:${userId}:2026-08-27:Asia/Shanghai:09:00:email`,
      `daily:${userId}:2026-08-28:Asia/Shanghai:09:00:email`,
    ].sort(),
  );
});

test('高优先级固定邮件绕过渠道开关和免打扰，且重复扫描与改期均正确去重', () => {
  const userId = 'priority-scheduler-user';
  const disabledUserId = 'disabled-scheduler-user';
  createUser(userId);
  createUser(disabledUserId, 1);
  saveReminder(userId, {
    enabled: 0,
    email_enabled: 0,
    in_app_enabled: 0,
    browser_enabled: 0,
    quiet_hours_enabled: 1,
    quiet_start: '00:00',
    quiet_end: '23:59',
  });

  createSchedule(userId, 'priority-event', '2026-08-27T08:10:00', { type: 'event' });
  createSchedule(userId, 'priority-todo', '2026-08-27T08:12:00', { type: 'todo' });
  createSchedule(userId, 'medium-event', '2026-08-27T08:10:00', { priority: 'medium' });
  createSchedule(userId, 'completed-event', '2026-08-27T08:10:00', { is_completed: true });
  createSchedule(userId, 'all-day-event', '2026-08-27T08:10:00', { all_day: true });
  createSchedule(userId, 'unscheduled-event', '2026-08-27T08:10:00', { is_unscheduled: true });
  createSchedule(userId, 'already-started-event', '2026-08-27T07:59:00');
  createSchedule(disabledUserId, 'disabled-user-event', '2026-08-27T08:10:00');

  const atEight = new Date('2026-08-27T00:00:30.000Z');
  const events: Array<{ message: string; data?: Record<string, unknown> }> = [];
  const first = scheduler.enqueueDueHighPriorityScheduleEmails(atEight, (message, _error, data) => {
    events.push({ message, data });
  });
  const second = scheduler.enqueueDueHighPriorityScheduleEmails(atEight, (message, _error, data) => {
    events.push({ message, data });
  });
  let notifications = activity.listNotifications(userId);
  assert.equal(first.created, 2);
  assert.equal(first.deduplicated, 0);
  assert.equal(second.created, 0);
  assert.equal(second.deduplicated, 2);
  assert.equal(events.filter(event => event.data?.event === 'high_priority_email_enqueue').length, 4);
  assert.equal(notifications.length, 2);
  assert.ok(notifications.every(item => item.channel === 'email' && item.kind === 'high_priority_schedule'));
  assert.deepEqual(
    notifications.map(item => item.dedupeKey).sort(),
    [
      'high-priority:priority-event:2026-08-27T08:10:00',
      'high-priority:priority-todo:2026-08-27T08:12:00',
    ].sort(),
  );
  assert.equal(activity.listNotifications(disabledUserId).length, 0);

  schedules.updateSchedule('priority-event', { start_time: '2026-08-27T08:20:00' });
  scheduler.enqueueDueHighPriorityScheduleEmails(new Date('2026-08-27T00:05:30.000Z'));
  notifications = activity.listNotifications(userId);
  assert.equal(notifications.length, 3);
  assert.equal(new Set(notifications.map(item => item.dedupeKey)).size, 3);

  scheduler.enqueueDueHighPriorityScheduleEmails(new Date('2026-08-27T00:21:00.000Z'));
  assert.equal(activity.listNotifications(userId).length, 3);
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
