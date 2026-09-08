import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const reportRootValue = process.env.DAILY_REPORT_V2_ROOT?.trim();
if (!reportRootValue) {
  throw new Error('跨项目日报测试需要设置 DAILY_REPORT_V2_ROOT，例如 C:\\Users\\Elysia\\Documents\\Codex\\2026-08-27\\日报-v2');
}
const reportRoot = path.resolve(reportRootValue);
const publisherPath = path.join(reportRoot, 'scripts', 'publish_report.py');
if (!fs.existsSync(publisherPath)) throw new Error(`日报 V2 publisher 不存在：${publisherPath}`);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-cross-project-'));
process.env.DATA_DIR = tempDir;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.APP_URL = 'http://127.0.0.1:0';
process.env.SMTP_HOST = 'smtp.163.com';
process.env.SMTP_USER = 'aicalendarofficial@163.com';
process.env.SMTP_PASS = 'test-only-smtp-placeholder';

const api = await import('../server/index.js');
const db = await import('../server/db.js');
const activity = await import('../server/activity-store.js');
const email = await import('../server/email-service.js');
const notification = await import('../server/notification-service.js');
const dailyReportTokens = await import('../server/daily-report-token-service.js');

await api.initializeServer();

const userId = 'daily-report-cross-project-user';
const now = new Date().toISOString();
db.createUser({
  id: userId,
  email: 'cross-project@example.com',
  password_hash: 'not-a-real-password',
  role: 'user',
  disabled: 0,
  created_at: now,
  updated_at: now,
});
db.upsertReminder({
  id: 'cross-project-reminder',
  user_id: userId,
  enabled: 0,
  hour: 8,
  minute: 0,
  reminder_email: 'cross-project@example.com',
  report_email_enabled: 1,
  created_at: now,
  updated_at: now,
});

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

test('V2 Publisher → AI Calendar → 假 SMTP 形成一次隔离端到端链路', async () => {
  const server = http.createServer(api.app);
  const port = await listen(server);
  const reportDate = '2026-09-01';
  const token = dailyReportTokens.generateDailyReportToken(userId).token;
  const reportPath = path.join(tempDir, `${reportDate}.md`);
  const configPath = path.join(tempDir, 'calendar.toml');
  const headings = [
    '# 一、今日值得搞明白的事',
    '# 二、邮箱与今天要做的事',
    '# 三、市场与我的雷达',
    '# 四、AI 与技术',
    '# 五、每日一个为什么',
    '# 六、今日行动',
  ];
  const sectionBody = `${'跨项目测试资料。 '.repeat(25)}来源 <script>alert(1)</script> [危险](javascript:alert(1))`;
  const markdown = headings.map(heading => `${heading}\n\n${sectionBody}\n`).join('\n');
  fs.writeFileSync(reportPath, markdown, 'utf8');
  fs.writeFileSync(configPath, `[calendar]\napi_base_url = "http://127.0.0.1:${port}"\ntoken = "${token}"\ntimeout_seconds = 5\ntimezone = "Asia/Shanghai"\n`, 'utf8');

  const sentMessages: Array<Record<string, unknown>> = [];
  email.setEmailTransportForTests({
    sendMail: async options => {
      sentMessages.push(options);
      return {
        accepted: [String(options.to || '')],
        rejected: [],
        pending: [],
        response: '250 test accepted',
        messageId: 'test-message-id',
        envelope: { from: String(options.from || ''), to: [String(options.to || '')] },
      };
    },
  });

  try {
    const { stdout } = await execFileAsync('python', [
      '-X', 'utf8', publisherPath,
      '--report', reportPath,
      '--date', reportDate,
      '--config', configPath,
    ], { encoding: 'utf8', cwd: reportRoot });
    const publishResult = JSON.parse(stdout);
    assert.equal(publishResult.status, 'PUBLISHED');
    assert.equal(publishResult.report_status, 'CREATED');
    assert.equal(publishResult.email_status, 'QUEUED');

    const queued = activity.listNotifications(userId).filter(item => item.kind === 'daily_report');
    assert.equal(queued.length, 1);
    assert.equal(queued[0].maxAttempts, 1);
    assert.equal(queued[0].body, markdown);

    const firstCycle = await notification.processNotificationQueue();
    assert.equal(firstCycle.sent, 1);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].subject, `个人情报日报 · ${reportDate}`);
    assert.doesNotMatch(String(sentMessages[0].html), /<script/i);
    assert.doesNotMatch(String(sentMessages[0].html), /javascript:/i);
    assert.match(String(sentMessages[0].html), /&lt;script&gt;/);

    const updatedMarkdown = `${markdown}\n\n后续修订版本`;
    const updatedResponse = await fetch(`http://127.0.0.1:${port}/api/integrations/daily-report/reports/${reportDate}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: updatedMarkdown }),
    });
    const updatedPayload = await updatedResponse.json();
    assert.equal(updatedResponse.status, 200);
    assert.equal(updatedPayload.reportStatus, 'UPDATED');
    assert.equal(updatedPayload.emailStatus, 'QUEUED');
    const updatedQueue = activity.listNotifications(userId).filter(item => item.kind === 'daily_report');
    assert.equal(updatedQueue.length, 2);
    assert.equal(updatedQueue[0].body, updatedMarkdown);

    const updateCycle = await notification.processNotificationQueue();
    assert.equal(updateCycle.sent, 1);
    assert.equal(sentMessages.length, 2);
    assert.match(String(sentMessages[1].html), /后续修订版本/);

    const secondCycle = await notification.processNotificationQueue();
    assert.equal(secondCycle.scanned, 0);
    assert.equal(sentMessages.length, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
