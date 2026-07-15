import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-test-'));
process.env.DATA_DIR = tempDir;
process.env.APP_TIMEZONE = 'Asia/Shanghai';

const db = await import('./db.js');
const schedules = await import('./schedule-store.js');
const reminders = await import('./reminder-store.js');
const reminderCalendarSync = await import('./reminder-calendar-sync.js');
const activity = await import('./activity-store.js');
const attachments = await import('./attachment-service.js');
const backups = await import('./backup-service.js');
const actionCenter = await import('./action-center.js');
const email = await import('./email-service.js');

await db.initDb();
await schedules.initScheduleDb();
await reminders.initReminderDb();
await activity.initActivityDb();

const userId = 'test-user';
db.createUser({
  id: userId,
  email: 'test@example.com',
  password_hash: 'not-a-real-password',
  role: 'user',
  disabled: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

test('不存在的账单日按该月最后一天计算', () => {
  assert.equal(reminders.clampDateForMonth(2025, 2, 31), '2025-02-28');
  assert.equal(reminders.clampDateForMonth(2024, 2, 31), '2024-02-29');
  assert.equal(reminders.clampDateForMonth(2026, 4, 31), '2026-04-30');
});

test('邮件测试时间按 GMT+8 输出', () => {
  assert.equal(
    email.formatDateTimeInTimezone(new Date('2026-07-15T15:11:00.000Z'), 'Asia/Shanghai'),
    '2026-07-15 23:11:00 GMT+8',
  );
});

test('日历按用户隔离并自动迁移默认日历', () => {
  const own = schedules.getAllCalendars(userId);
  const other = schedules.getAllCalendars('other-user');
  assert.ok(own.length >= 3);
  assert.ok(own.every(item => item.user_id === userId));
  assert.ok(other.every(item => item.user_id === 'other-user'));
  assert.equal(own.some(item => other.some(candidate => candidate.id === item.id)), false);
});

test('通用周期任务、逾期手动完成和下一周期生成', () => {
  const task = reminders.createReminderTask({
    userId,
    type: 'generic',
    name: '测试房租',
    config: {
      templateKey: 'rent',
      rule: { frequency: 'monthly', anchorDate: '2026-01-31', dayOfMonth: 31, interval: 1, advancePolicy: 'calendar' },
      reminderOffsets: [3, 1, 0],
      reminderTime: '09:00',
      actionGuide: '支付房租',
      priority: 'high',
      currency: 'CNY',
    },
  });
  assert.ok(task.currentCycle);
  const linked = reminderCalendarSync.syncReminderTaskToCalendar(task);
  assert.equal(linked?.all_day, true);
  assert.equal(linked?.type, 'todo');
  assert.equal(linked?.start_time.slice(0, 10), task.currentCycle?.dueDate);
  assert.equal(actionCenter.getActionCenter(userId, 14).today.some(item => item.sourceId === linked?.id), false);
  const firstCycle = task.currentCycle!;
  const completed = reminders.completeReminderCycle(task.id, userId, task.currentCycle!.id, task.currentCycle!.dueDate, '已支付');
  assert.equal(completed?.currentCycle?.status, 'pending');
  assert.notEqual(completed?.currentCycle?.id, task.currentCycle?.id);
  const completedCycle = reminders.getReminderHistory(task.id, userId).find(cycle => cycle.id === firstCycle.id)!;
  reminderCalendarSync.syncReminderCycleToCalendar(completed!, completedCycle);
  reminderCalendarSync.syncReminderTaskToCalendar(completed!);
  assert.equal(schedules.getSchedule(reminderCalendarSync.reminderScheduleId(firstCycle.id))?.is_completed, true);
  assert.ok(schedules.getSchedule(reminderCalendarSync.reminderScheduleId(completed!.currentCycle!.id)));
  const expiredTask = reminders.createReminderTask({
    userId,
    type: 'generic',
    name: '过期证件',
    config: {
      templateKey: 'document',
      rule: { frequency: 'once', anchorDate: '2020-01-01', advancePolicy: 'calendar' },
      reminderOffsets: [7, 1],
      reminderTime: '09:00',
      actionGuide: '补办证件',
      priority: 'high',
      currency: 'CNY',
    },
  });
  assert.equal(expiredTask.currentCycle?.status, 'expired');
  const expiredCycleId = expiredTask.currentCycle!.id;
  reminders.completeReminderCycle(expiredTask.id, userId, expiredCycleId, reminders.todayInTimezone(), '逾期后补办');
  activity.createCompletion({ userId, sourceType: 'reminder', sourceId: expiredTask.id, instanceId: expiredCycleId, note: '逾期后手动完成' });
  assert.ok(actionCenter.getActionCenter(userId, 7).completedToday.some(item => item.instanceId === expiredCycleId));
});

test('行动中心聚合待办并记录完成证明', () => {
  const schedule = schedules.createSchedule({
    id: 'schedule-one', user_id: userId, calendar_id: 'personal', type: 'todo', title: '测试待办',
    description: undefined, start_time: new Date().toISOString().slice(0, 10) + 'T09:00:00', end_time: undefined,
    all_day: false, location: undefined, notes: undefined, category: 'other', priority: 'high', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  const center = actionCenter.getActionCenter(userId, 7);
  assert.ok(center.today.some(item => item.sourceId === schedule.id));
  const completion = activity.createCompletion({ userId, sourceType: 'schedule', sourceId: schedule.id, note: '完成证明' });
  schedules.updateSchedule(schedule.id, { is_completed: true });
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const file = attachments.saveBase64Attachment({ userId, completionId: completion.id, originalName: 'proof.png', mimeType: 'image/png', base64: pngHeader.toString('base64') });
  assert.equal(attachments.readAttachment(file).equals(pngHeader), true);
  assert.equal(activity.listAttachments(userId, completion.id).length, 1);
  assert.equal(activity.getAttachment(file.id, 'other-user'), null);
  const updated = activity.updateCompletion(completion.id, userId, { note: '更新后的证明', amountCents: 12345 });
  assert.equal(updated?.note, '更新后的证明');
  assert.equal(updated?.amountCents, 12345);
});

test('通知队列幂等且可重试', () => {
  const input = { userId, sourceType: 'test', sourceId: 'one', channel: 'in_app' as const, kind: 'test', title: '测试通知', body: '内容', scheduledAt: new Date().toISOString(), dedupeKey: 'test:one' };
  const first = activity.enqueueNotification(input);
  const second = activity.enqueueNotification(input);
  assert.equal(first.id, second.id);
  assert.equal(activity.claimNotification(first.id), true);
  activity.markNotificationFailed(first.id, 'temporary');
  const failed = activity.getNotification(first.id);
  assert.equal(failed?.attempts, 1);
  assert.ok(failed?.nextRetryAt);
  assert.equal(activity.retryNotification(first.id, userId)?.status, 'pending');
});

test('用户加密备份可检查并合并恢复', () => {
  const password = 'test-password-123';
  const encrypted = backups.createUserBackup(userId, password);
  const preview = backups.inspectUserBackup(encrypted, password) as any;
  assert.ok(preview.counts.schedules >= 1);
  assert.ok(preview.counts.attachments >= 1);
  assert.throws(() => backups.inspectUserBackup(encrypted, 'wrong-password'), /密码错误|损坏/);
  const damaged = Buffer.from(encrypted);
  damaged[damaged.length - 1] ^= 0xff;
  assert.throws(() => backups.inspectUserBackup(damaged, password), /密码错误|损坏/);
  const restored = backups.restoreUserBackup(userId, encrypted, password, 'merge') as any;
  assert.equal(restored.mode, 'merge');
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
