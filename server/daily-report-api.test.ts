import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-api-test-'));
process.env.DATA_DIR = tempDir;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.APP_URL = 'http://127.0.0.1:0';

const api = await import('./index.js');
const db = await import('./db.js');
const activity = await import('./activity-store.js');
const dailyReportTokens = await import('./daily-report-token-service.js');
const dailyReportMedia = await import('./daily-report-media-service.js');

await api.initializeServer();

const userId = 'daily-report-api-user';
const otherUserId = 'daily-report-api-other';
const now = new Date().toISOString();
const user = db.createUser({
  id: userId,
  email: 'api-report@example.com',
  password_hash: 'not-a-real-password',
  role: 'user',
  disabled: 0,
  created_at: now,
  updated_at: now,
});
const otherUser = db.createUser({
  id: otherUserId,
  email: 'api-report-other@example.com',
  password_hash: 'not-a-real-password',
  role: 'user',
  disabled: 0,
  created_at: now,
  updated_at: now,
});
for (const [id, email] of [[userId, 'api-report@example.com'], [otherUserId, 'api-report-other@example.com']] as const) {
  db.upsertReminder({ id: `reminder-${id}`, user_id: id, enabled: 0, hour: 8, minute: 0, reminder_email: email, created_at: now, updated_at: now });
}
const reportToken = dailyReportTokens.generateDailyReportToken(userId).token;
const userToken = api.signUserToken(user);
const otherToken = api.signUserToken(otherUser);

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('测试服务器没有端口'));
      resolve(address.port);
    });
  });
}

test('日报 HTTP API 使用令牌发布、账号隔离并支持更新后重发与详情手动发送', async () => {
  const server = http.createServer(api.app);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = async (pathname: string, init: RequestInit = {}) => fetch(baseUrl + pathname, init);
  const json = (token: string, body: unknown) => ({
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  try {
    const mediaFilename = `${'c'.repeat(64)}.png`;
    fs.writeFileSync(path.join(dailyReportMedia.dailyReportMediaRoot(), mediaFilename), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const mediaResponse = await request(`/daily-report-media/${mediaFilename}`);
    assert.equal(mediaResponse.status, 200);
    assert.match(mediaResponse.headers.get('content-type') || '', /^image\/png/);
    assert.match(mediaResponse.headers.get('cache-control') || '', /immutable/);

    const uploadBody = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    const uploadHash = crypto.createHash('sha256').update(uploadBody).digest('hex');
    const uploadFilename = `${uploadHash}.png`;
    const uploaded = await request(`/api/integrations/daily-report/reports/2026-08-30/media/${uploadFilename}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${reportToken}`, 'Content-Type': 'image/png' },
      body: uploadBody,
    });
    assert.equal(uploaded.status, 200);
    assert.equal((await uploaded.json()).status, 'READY');
    const uploadedMedia = await request(`/daily-report-media/${uploadFilename}`);
    assert.equal(uploadedMedia.status, 200);

    const externalMediaReport = await request('/api/integrations/daily-report/reports/2026-09-02', {
      method: 'PUT',
      ...json(reportToken, { markdown: '# Daily Digest\n<!-- daily-digest.v1 -->\n图片：https://images.example/news.png' }),
    });
    assert.equal(externalMediaReport.status, 400);

    const missingMediaReport = await request('/api/integrations/daily-report/reports/2026-09-03', {
      method: 'PUT',
      ...json(reportToken, { markdown: `# Daily Digest\n<!-- daily-digest.v1 -->\n图片：/daily-report-media/${'d'.repeat(64)}.png` }),
    });
    assert.equal(missingMediaReport.status, 400);

    const invalidAuth = await request('/api/integrations/daily-report/reports/2026-08-30', {
      method: 'PUT',
      ...json('invalid-token', { markdown: '# nope' }),
    });
    assert.equal(invalidAuth.status, 401);

    const created = await request('/api/integrations/daily-report/reports/2026-08-30', {
      method: 'PUT',
      ...json(reportToken, { markdown: '# 第一版日报' }),
    });
    assert.equal(created.status, 201);
    const createdPayload = await created.json();
    assert.equal(createdPayload.date, '2026-08-30');
    assert.equal(createdPayload.reportStatus, 'CREATED');
    assert.equal(createdPayload.emailStatus, 'DISABLED');
    assert.match(createdPayload.contentHash, /^[0-9a-f]{64}$/);

    const forbiddenFields = await request('/api/integrations/daily-report/reports/2026-08-31', {
      method: 'PUT',
      ...json(reportToken, { markdown: '# 日报', userId: otherUserId }),
    });
    assert.equal(forbiddenFields.status, 400);

    const list = await request('/api/daily-reports', { headers: { Authorization: `Bearer ${userToken}` } });
    assert.equal(list.status, 200);
    assert.equal((await list.json()).reports.length, 1);

    const otherList = await request('/api/daily-reports', { headers: { Authorization: `Bearer ${otherToken}` } });
    assert.equal((await otherList.json()).reports.length, 0);
    const otherDetail = await request('/api/daily-reports/2026-08-30', { headers: { Authorization: `Bearer ${otherToken}` } });
    assert.equal(otherDetail.status, 404);

    const manualWhileDisabled = await request('/api/daily-reports/2026-08-30/send', {
      method: 'POST',
      ...json(userToken, { confirm: true }),
    });
    const manualWhileDisabledPayload = await manualWhileDisabled.json();
    assert.equal(manualWhileDisabled.status, 202);
    assert.equal(manualWhileDisabledPayload.emailStatus, 'QUEUED');
    assert.equal(activity.listNotifications(userId).filter(item => item.kind === 'daily_report').length, 1);

    const reminder = db.getReminder(userId)!;
    db.upsertReminder({ ...reminder, report_email_enabled: 1, updated_at: new Date().toISOString() });
    const queued = await request('/api/integrations/daily-report/reports/2026-08-31', {
      method: 'PUT',
      ...json(reportToken, { markdown: '# 第二版日报' }),
    });
    const queuedPayload = await queued.json();
    assert.equal(queued.status, 201);
    assert.equal(queuedPayload.emailStatus, 'QUEUED');

    const duplicate = await request('/api/integrations/daily-report/reports/2026-08-31', {
      method: 'PUT',
      ...json(reportToken, { markdown: '# 第二版日报' }),
    });
    const duplicatePayload = await duplicate.json();
    assert.equal(duplicatePayload.reportStatus, 'UNCHANGED');
    assert.equal(duplicatePayload.emailStatus, 'ALREADY_QUEUED');
    assert.equal(activity.listNotifications(userId).filter(item => item.kind === 'daily_report').length, 2);

    const updated = await request('/api/integrations/daily-report/reports/2026-08-31', {
      method: 'PUT',
      ...json(reportToken, { markdown: '# 第二版日报\n\n后续修订' }),
    });
    const updatedPayload = await updated.json();
    assert.equal(updated.status, 200);
    assert.equal(updatedPayload.reportStatus, 'UPDATED');
    assert.equal(updatedPayload.emailStatus, 'QUEUED');
    assert.equal(activity.listNotifications(userId).filter(item => item.kind === 'daily_report').length, 3);

    const notification = activity.listNotifications(userId).find(item => item.kind === 'daily_report' && item.sourceId === '2026-08-31' && item.body.includes('后续修订'))!;
    assert.ok(notification);
    assert.equal(activity.claimNotification(notification.id), true);
    activity.markNotificationFailed(notification.id, 'fake SMTP failure');
    const detailAfterFailure = await request('/api/daily-reports/2026-08-31', { headers: { Authorization: `Bearer ${userToken}` } });
    assert.equal((await detailAfterFailure.json()).report.emailStatus, 'FAILED');
    const withoutConfirmation = await request(`/api/notifications/${notification.id}/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(withoutConfirmation.status, 400);
    const confirmed = await request(`/api/notifications/${notification.id}/retry`, {
      method: 'POST',
      ...json(userToken, { confirm: true }),
    });
    assert.equal(confirmed.status, 200);

    const otherManual = await request('/api/daily-reports/2026-08-31/send', {
      method: 'POST',
      ...json(otherToken, { confirm: true }),
    });
    assert.equal(otherManual.status, 404);

    const manualWithoutConfirmation = await request('/api/daily-reports/2026-08-31/send', {
      method: 'POST',
      ...json(userToken, {}),
    });
    assert.equal(manualWithoutConfirmation.status, 400);

    const manual = await request('/api/daily-reports/2026-08-31/send', {
      method: 'POST',
      ...json(userToken, { confirm: true }),
    });
    const manualPayload = await manual.json();
    assert.equal(manual.status, 202);
    assert.equal(manualPayload.emailStatus, 'QUEUED');
    assert.equal(activity.listNotifications(userId).filter(item => item.kind === 'daily_report').length, 4);
    assert.equal(activity.listNotifications(userId)[0].id, manualPayload.notificationId);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
