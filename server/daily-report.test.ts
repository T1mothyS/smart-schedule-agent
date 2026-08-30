import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-test-'));
process.env.DATA_DIR = tempDir;
process.env.APP_TIMEZONE = 'Asia/Shanghai';

const db = await import('./db.js');
const activity = await import('./activity-store.js');
const reports = await import('./daily-report-service.js');
const renderer = await import('./markdown-renderer.js');

await db.initDb();
await activity.initActivityDb();

const userId = 'daily-report-user';
const otherUserId = 'daily-report-other-user';
const now = new Date().toISOString();
for (const [id, email] of [[userId, 'daily-report@example.com'], [otherUserId, 'other-report@example.com']] as const) {
  db.createUser({
    id,
    email,
    password_hash: 'not-a-real-password',
    role: 'user',
    disabled: 0,
    created_at: now,
    updated_at: now,
  });
}
db.upsertReminder({
  id: 'daily-report-reminder',
  user_id: userId,
  enabled: 0,
  hour: 8,
  minute: 0,
  reminder_email: 'daily-report@example.com',
  report_email_enabled: 1,
  created_at: now,
  updated_at: now,
});
db.upsertReminder({
  id: 'daily-report-other-reminder',
  user_id: otherUserId,
  enabled: 0,
  hour: 8,
  minute: 0,
  reminder_email: 'other-report@example.com',
  created_at: now,
  updated_at: now,
});

test('日报 Markdown 会转义 HTML，并拒绝危险链接', () => {
  const html = renderer.renderMarkdown([
    '# 标题 <script>alert(1)</script>',
    '',
    '**重点** [安全来源](https://example.com/source) [危险](javascript:alert(1)) [协议相对地址](//evil.example)',
    '',
    '| 项目 | 状态 |',
    '| --- | --- |',
    '| A | 已完成 |',
  ].join('\n'));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /href="https:\/\/example\.com\/source"/);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /href="\/\/evil\.example"/i);
  assert.match(html, /<table>/);
});

test('日报展示会生成彩色卡片和静态章节跳转', () => {
  const html = renderer.renderMarkdown([
    '# 一、今日值得搞明白的事',
    '',
    '1. **第一条重点。** 这是需要快速扫读的解释，==风险数字==需要特别留意。',
    '',
    '# 二、邮箱与今天要做的事',
    '',
    '| 优先级 | 事项 | 截止 | 要做什么 |',
    '| --- | --- | --- | --- |',
    '| 高 | 核对通知 | 今天 | 查看原邮件 |',
  ].join('\n'));
  assert.match(html, /id="report-toc"/);
  assert.match(html, /href="#section-1"/);
  assert.match(html, /href="#section-2"/);
  assert.match(html, /href="#report-toc"/);
  assert.match(html, /daily-report-brief-card/);
  assert.match(html, /daily-report-data-card/);
  assert.match(html, /background:#fff1f2/);
  assert.match(html, /color:#b42318/);
  assert.doesNotMatch(html, /<script/i);
});

test('日报发布按账号和日期幂等，更新正文但不重复发信', () => {
  const firstMarkdown = '# 2026-08-30\n\n第一版日报';
  const first = reports.publishDailyReport(userId, '2026-08-30', firstMarkdown);
  assert.equal(first.reportStatus, 'CREATED');
  assert.equal(first.emailStatus, 'QUEUED');
  const firstNotification = activity.listNotifications(userId)[0];
  assert.ok(firstNotification);
  assert.equal(firstNotification.kind, 'daily_report');
  assert.equal(firstNotification.maxAttempts, 1);
  assert.equal(firstNotification.body, firstMarkdown);

  const unchanged = reports.publishDailyReport(userId, '2026-08-30', firstMarkdown);
  assert.equal(unchanged.reportStatus, 'UNCHANGED');
  assert.equal(unchanged.emailStatus, 'ALREADY_QUEUED');
  assert.equal(unchanged.report.emailNotificationId, firstNotification.id);
  assert.equal(activity.listNotifications(userId).length, 1);

  const updatedMarkdown = '# 2026-08-30\n\n修订版日报';
  const updated = reports.publishDailyReport(userId, '2026-08-30', updatedMarkdown);
  assert.equal(updated.reportStatus, 'UPDATED');
  assert.equal(updated.emailStatus, 'ALREADY_QUEUED');
  assert.equal(activity.listNotifications(userId).length, 1);
  assert.equal(activity.listNotifications(userId)[0].body, firstMarkdown);
  assert.equal(reports.getDailyReportView(userId, '2026-08-30')?.markdown, updatedMarkdown);
  assert.equal(reports.getDailyReportView(otherUserId, '2026-08-30'), null);
});

test('日报邮件失败后不自动重试，但允许显式手动重试', () => {
  const notification = activity.listNotifications(userId)[0];
  assert.ok(notification);
  assert.equal(activity.claimNotification(notification.id), true);
  activity.markNotificationFailed(notification.id, 'fake SMTP failure');
  const failed = activity.getNotification(notification.id, userId)!;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.nextRetryAt, null);
  assert.equal(activity.listDueNotifications().some(item => item.id === notification.id), false);
  assert.equal(reports.getDailyReportView(userId, '2026-08-30')?.emailStatus, 'FAILED');

  const retried = activity.retryNotification(notification.id, userId);
  assert.equal(retried?.status, 'pending');
  assert.equal(reports.getDailyReportView(userId, '2026-08-30')?.emailStatus, 'QUEUED');
});

test('日报包含在活动导出、删除和恢复链路中', () => {
  const exported = activity.exportUserActivity(userId);
  assert.equal((exported.dailyReports || []).length, 1);
  const deleted = activity.deleteUserActivity(userId);
  assert.equal(deleted.dailyReports, 1);
  assert.equal(activity.listDailyReports(userId).length, 0);
  const restored = activity.restoreUserActivity(userId, exported as Record<string, any[]>, 'merge');
  assert.equal(restored.dailyReports, 1);
  assert.equal(activity.listDailyReports(userId).length, 1);
});
