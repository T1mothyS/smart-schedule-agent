import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-policy-test-'));
process.env.DATA_DIR = tempDir;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';

const db = await import('./db.js');
const activity = await import('./activity-store.js');
const reports = await import('./daily-report-service.js');
const policy = await import('./daily-report-delivery-policy.js');

await db.initDb();
await activity.initActivityDb();

const userId = 'daily-report-delivery-policy-user';
const now = new Date().toISOString();
db.createUser({
  id: userId,
  email: 'daily-report-policy@example.com',
  password_hash: 'not-a-real-password',
  role: 'user',
  disabled: 0,
  created_at: now,
  updated_at: now,
});
db.upsertReminder({
  id: 'daily-report-policy-reminder',
  user_id: userId,
  enabled: 0,
  hour: 8,
  minute: 0,
  reminder_email: 'daily-report-policy@example.com',
  report_email_enabled: 1,
  created_at: now,
  updated_at: now,
});

test('来源策略覆盖四种接收状态，Cloud 未勾选仍正式落库为候选', async () => {
  assert.deepEqual(policy.getDailyReportDeliveryPolicy(userId).sources, ['local']);
  const reminder = db.getReminder(userId)!;
  db.upsertReminder({ ...reminder, daily_report_delivery_sources: '["unexpected"]', updated_at: new Date().toISOString() });
  assert.deepEqual(policy.getDailyReportDeliveryPolicy(userId).sources, ['local']);

  const localOnly = await reports.publishDailyReport(userId, '2026-10-01', '# local-only\n\n本地日报');
  const cloudCandidate = await reports.publishDailyReport(userId, '2026-10-01', '# cloud-candidate\n\nCloud 日报', { source: 'cloud' });
  assert.equal(localOnly.status, 'PUBLISHED');
  assert.equal(localOnly.report.source, 'local');
  assert.equal(localOnly.report.deliveryStatus, 'RECEIVED');
  assert.equal(cloudCandidate.status, 'PUBLISHED');
  assert.equal(cloudCandidate.report.source, 'cloud');
  assert.equal(cloudCandidate.report.deliveryStatus, 'CANDIDATE');
  assert.equal(activity.listDailyReportsForDate(userId, '2026-10-01').length, 2);
  assert.equal(activity.listDailyReports(userId, 100).filter(item => item.reportDate === '2026-10-01').length, 1);
  assert.equal(activity.listNotifications(userId).filter(item => item.kind === 'daily_report').length, 1);

  policy.setDailyReportDeliveryPolicy(userId, ['cloud']);
  const promoted = await reports.publishDailyReport(userId, '2026-10-01', '# cloud-candidate\n\nCloud 日报', { source: 'cloud' });
  assert.equal(promoted.reportStatus, 'UPDATED');
  assert.equal(promoted.report.deliveryStatus, 'RECEIVED');
  assert.equal(activity.listDailyReportsForDate(userId, '2026-10-01').filter(item => item.source === 'cloud').length, 1);
  assert.equal(activity.listNotifications(userId).filter(item => item.kind === 'daily_report').length, 2);

  policy.setDailyReportDeliveryPolicy(userId, []);
  const neitherLocal = await reports.publishDailyReport(userId, '2026-10-02', '# local-candidate\n\n本地候选');
  const neitherCloud = await reports.publishDailyReport(userId, '2026-10-02', '# cloud-candidate\n\nCloud 候选', { source: 'cloud' });
  assert.equal(neitherLocal.report.deliveryStatus, 'CANDIDATE');
  assert.equal(neitherCloud.report.deliveryStatus, 'CANDIDATE');

  policy.setDailyReportDeliveryPolicy(userId, ['local', 'cloud']);
  const bothLocal = await reports.publishDailyReport(userId, '2026-10-03', '# local\n\n本地正式');
  const bothCloud = await reports.publishDailyReport(userId, '2026-10-03', '# cloud\n\nCloud 正式', { source: 'cloud' });
  assert.equal(bothLocal.report.deliveryStatus, 'RECEIVED');
  assert.equal(bothCloud.report.deliveryStatus, 'RECEIVED');
  assert.equal(activity.listDailyReportsForDate(userId, '2026-10-03').length, 2);
  assert.equal(activity.listDailyReports(userId, 100).filter(item => item.reportDate === '2026-10-03').length, 2);
  assert.notEqual(bothLocal.report.contentHash, bothCloud.report.contentHash);
  assert.notEqual(
    activity.listNotifications(userId).find(item => item.body.includes('本地正式'))?.dedupeKey,
    activity.listNotifications(userId).find(item => item.body.includes('Cloud 正式'))?.dedupeKey,
  );
});

test('候选对照和来源级分页只暴露当前账号的最新版本', async () => {
  const candidatePage = activity.listDailyReportsPage(userId, 100, 0, 'candidates');
  assert.ok(candidatePage.reports.some(item => item.reportDate === '2026-10-02' && item.source === 'local' && item.deliveryStatus === 'candidate'));
  assert.ok(candidatePage.reports.some(item => item.reportDate === '2026-10-02' && item.source === 'cloud' && item.deliveryStatus === 'candidate'));
  assert.equal(candidatePage.reports.filter(item => item.reportDate === '2026-10-03').length, 0);
  const bundle = reports.getDailyReportViewsForDate(userId, '2026-10-03');
  assert.equal(bundle.reports.length, 2);
  assert.ok(bundle.report);
  assert.equal(bundle.report.deliveryStatus, 'RECEIVED');
});
