import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-notification-service-'));
process.env.DATA_DIR = tempDir;
process.env.APP_TIMEZONE = 'Asia/Shanghai';

const db = await import('./db.js');
const activity = await import('./activity-store.js');
const notifications = await import('./notification-service.js');

await db.initDb();
await activity.initActivityDb();

test('通知队列会记录领取、非邮件处理和最终状态', async () => {
  const userId = 'notification-service-user';
  const now = new Date().toISOString();
  db.createUser({
    id: userId,
    email: 'notification-service@example.com',
    password_hash: 'not-a-real-password',
    role: 'user',
    disabled: 0,
    created_at: now,
    updated_at: now,
  });
  db.upsertReminder({
    id: 'notification-service-reminder',
    user_id: userId,
    enabled: 1,
    hour: 8,
    minute: 0,
    reminder_email: 'notification-service@example.com',
    email_enabled: 0,
    in_app_enabled: 1,
    browser_enabled: 0,
    timezone: 'Asia/Shanghai',
    quiet_hours_enabled: 0,
    quiet_start: '22:00',
    quiet_end: '08:00',
    created_at: now,
    updated_at: now,
  });
  notifications.enqueueUserNotification({
    userId,
    sourceType: 'schedule',
    sourceId: 'notification-service-schedule',
    kind: 'test_notification',
    title: '测试通知',
    body: '测试内容',
    scheduledAt: now,
    dedupePrefix: 'notification-service-test',
  });

  const events: Array<{ message: string; error?: unknown; data?: Record<string, unknown> }> = [];
  const result = await notifications.processNotificationQueue((message, error, data) => {
    events.push({ message, error, data });
  });
  const stored = activity.listNotifications(userId)[0];

  assert.deepEqual(result, { scanned: 1, claimed: 1, claimSkipped: 0, sent: 1, failed: 0 });
  assert.equal(stored?.status, 'sent');
  assert.deepEqual(
    events.map(event => event.data?.event),
    ['notification_queue_scan_started', 'notification_claimed', 'non_email_notification_marked_sent', 'notification_sent', 'notification_queue_completed'],
  );
  assert.equal(events[1]?.data?.notificationId, stored?.id);
  assert.equal(events[3]?.data?.sentAt != null, true);
});

test('邮件配置错误会记录错误码、失败状态和下一次重试时间', async () => {
  const userId = 'notification-service-invalid-email-user';
  const now = new Date().toISOString();
  db.createUser({
    id: userId,
    email: 'notification-service-invalid@example.com',
    password_hash: 'not-a-real-password',
    role: 'user',
    disabled: 0,
    created_at: now,
    updated_at: now,
  });
  db.upsertReminder({
    id: 'notification-service-invalid-email-reminder',
    user_id: userId,
    enabled: 1,
    hour: 8,
    minute: 0,
    reminder_email: 'not-an-email',
    email_enabled: 1,
    in_app_enabled: 0,
    browser_enabled: 0,
    timezone: 'Asia/Shanghai',
    quiet_hours_enabled: 0,
    quiet_start: '22:00',
    quiet_end: '08:00',
    created_at: now,
    updated_at: now,
  });
  notifications.enqueueUserEmailNotification({
    userId,
    sourceType: 'schedule',
    sourceId: 'notification-service-invalid-email-schedule',
    kind: 'high_priority_schedule',
    title: '测试高优先级邮件',
    body: '测试内容',
    scheduledAt: now,
    dedupeKey: 'notification-service-invalid-email-test',
  });

  const events: Array<{ message: string; error?: unknown; data?: Record<string, unknown> }> = [];
  const result = await notifications.processNotificationQueue((message, error, data) => {
    events.push({ message, error, data });
  });
  const stored = activity.listNotifications(userId)[0];
  const failure = events.find(event => event.data?.event === 'notification_failed');

  assert.deepEqual(result, { scanned: 1, claimed: 1, claimSkipped: 0, sent: 0, failed: 1 });
  assert.equal(stored?.status, 'failed');
  assert.equal(stored?.lastError, '收件邮箱格式不正确，请在“设置”中检查提醒邮箱');
  assert.ok(stored?.nextRetryAt);
  assert.equal(failure?.data?.errorCode, 'EMAIL_CONFIG');
  assert.equal(failure?.data?.statusAfterFailure, 'failed');
  assert.equal(failure?.data?.retryScheduled, true);
  assert.ok(failure?.data?.nextRetryAt);
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
