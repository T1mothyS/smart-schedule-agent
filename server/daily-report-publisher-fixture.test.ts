import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishDailyReportFixture } from './daily-report-publisher-fixture.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-fixture-'));
process.env.DATA_DIR = tempDir;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.APP_URL = 'http://127.0.0.1:0';
process.env.SMTP_HOST = 'smtp.163.com';
process.env.SMTP_USER = 'aicalendarofficial@163.com';
process.env.SMTP_PASS = 'test-only-smtp-placeholder';

const api = await import('./index.js');
const db = await import('./db.js');
const activity = await import('./activity-store.js');
const email = await import('./email-service.js');
const notification = await import('./notification-service.js');
const dailyReportTokens = await import('./daily-report-token-service.js');

await api.initializeServer();

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

test('项目内日报 publisher fixture 覆盖发布、队列、SMTP、安全过滤和幂等', async () => {
  const userId = 'daily-report-publisher-fixture-user';
  const now = new Date().toISOString();
  db.createUser({
    id: userId,
    email: 'fixture-report@example.com',
    password_hash: 'not-a-real-password',
    role: 'user',
    disabled: 0,
    created_at: now,
    updated_at: now,
  });
  db.upsertReminder({
    id: 'daily-report-publisher-fixture-reminder',
    user_id: userId,
    enabled: 0,
    hour: 8,
    minute: 0,
    reminder_email: 'fixture-report@example.com',
    report_email_enabled: 1,
    created_at: now,
    updated_at: now,
  });

  const server = http.createServer(api.app);
  const port = await listen(server);
  const reportDate = '2026-09-01';
  const token = dailyReportTokens.generateDailyReportToken(userId).token;
  const markdown = [
    '# 今日日报',
    '',
    '跨项目契约夹具。 <script>alert(1)</script> [危险](javascript:alert(1))',
  ].join('\n');
  const sentMessages: Array<Record<string, unknown>> = [];
  email.setEmailTransportForTests({
    sendMail: async options => {
      sentMessages.push(options);
      return {
        accepted: [String(options.to || '')],
        rejected: [],
        pending: [],
        response: '250 test accepted',
        messageId: 'fixture-message-id',
        envelope: { from: String(options.from || ''), to: [String(options.to || '')] },
      };
    },
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const first = await publishDailyReportFixture(baseUrl, token, reportDate, markdown);
    assert.equal(first.status, 'PUBLISHED');
    assert.equal(first.report_status, 'CREATED');
    assert.equal(first.email_status, 'QUEUED');
    assert.equal(activity.listNotifications(userId).filter(item => item.kind === 'daily_report').length, 1);

    const cycle = await notification.processNotificationQueue();
    assert.equal(cycle.sent, 1);
    assert.equal(sentMessages.length, 1);
    assert.doesNotMatch(String(sentMessages[0].html), /<script/i);
    assert.doesNotMatch(String(sentMessages[0].html), /javascript:/i);
    assert.match(String(sentMessages[0].html), /&lt;script&gt;/);

    const duplicate = await publishDailyReportFixture(baseUrl, token, reportDate, markdown);
    assert.equal(duplicate.status, 'PUBLISHED');
    assert.equal(duplicate.report_status, 'UNCHANGED');
    assert.equal(duplicate.email_status, 'ALREADY_SENT');
    assert.equal(activity.listNotifications(userId).filter(item => item.kind === 'daily_report').length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
