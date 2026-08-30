import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-user-mail-api-test-'));
process.env.DATA_DIR = tempDir;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.APP_URL = 'http://127.0.0.1:0';
process.env.MAIL_CREDENTIALS_ENCRYPTION_KEY = 'test-only-mail-encryption-key';

const api = await import('./index.js');
const db = await import('./db.js');
const dailyReportTokens = await import('./daily-report-token-service.js');

await api.initializeServer();

const userId = 'user-mail-api-user';
const now = new Date().toISOString();
const user = db.createUser({
  id: userId,
  email: 'user-mail-api@example.com',
  password_hash: 'not-a-real-password',
  role: 'user',
  disabled: 0,
  created_at: now,
  updated_at: now,
});
db.upsertReminder({ id: 'user-mail-api-reminder', user_id: userId, enabled: 0, hour: 8, minute: 0, reminder_email: user.email, created_at: now, updated_at: now });
const userToken = api.signUserToken(user);
const reportToken = dailyReportTokens.generateDailyReportToken(userId).token;

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

test('网页邮箱配置按账号保存，日报 API 只返回摘要状态而不返回授权码', async () => {
  const server = http.createServer(api.app);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const auth = (token: string, body?: unknown) => ({
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  try {
    const saved = await fetch(`${baseUrl}/api/user-mail-account`, {
      method: 'PUT',
      ...auth(userToken, { username: 'reader@qq.com', authCode: 'secret-auth-code', enabled: true }),
    });
    assert.equal(saved.status, 200);
    const savedPayload = await saved.json();
    assert.equal(savedPayload.account.username, 'reader@qq.com');
    assert.doesNotMatch(JSON.stringify(savedPayload), /secret-auth-code/);
    assert.match(db.getUserMailAccount(userId)?.encrypted_auth_code || '', /^v1\./);

    const status = await fetch(`${baseUrl}/api/user-mail-account`, { headers: auth(userToken).headers });
    const statusPayload = await status.json();
    assert.equal(statusPayload.account.configured, true);
    assert.equal(statusPayload.account.enabled, true);
    assert.doesNotMatch(JSON.stringify(statusPayload), /secret-auth-code/);

    const disabled = await fetch(`${baseUrl}/api/user-mail-account`, {
      method: 'PUT',
      ...auth(userToken, { username: 'reader@qq.com', enabled: false }),
    });
    assert.equal(disabled.status, 200);
    assert.equal((await disabled.json()).account.enabled, false);
    assert.match(db.getUserMailAccount(userId)?.encrypted_auth_code || '', /^v1\./);

    const invalidToken = await fetch(`${baseUrl}/api/integrations/daily-report/mail`, {
      headers: auth('invalid-report-token').headers,
    });
    assert.equal(invalidToken.status, 401);

    const invalidLimit = await fetch(`${baseUrl}/api/integrations/daily-report/mail?limit=0`, {
      headers: auth(reportToken).headers,
    });
    assert.equal(invalidLimit.status, 400);

    const removed = await fetch(`${baseUrl}/api/user-mail-account`, {
      method: 'DELETE',
      headers: auth(userToken).headers,
    });
    assert.equal(removed.status, 200);
    const remoteRead = await fetch(`${baseUrl}/api/integrations/daily-report/mail?limit=1`, {
      headers: auth(reportToken).headers,
    });
    assert.equal(remoteRead.status, 200);
    const remotePayload = await remoteRead.json();
    assert.equal(remotePayload.status, 'UNAVAILABLE');
    assert.deepEqual(remotePayload.messages, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
