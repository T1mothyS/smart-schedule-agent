import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-user-mail-test-'));
process.env.DATA_DIR = tempDir;
process.env.MAIL_CREDENTIALS_ENCRYPTION_KEY = 'test-only-mail-encryption-key';

const db = await import('./db.js');
const mail = await import('./user-mail-service.js');

await db.initDb();

const userId = 'user-mail-test-user';
const now = new Date().toISOString();
db.createUser({
  id: userId,
  email: 'mail-test@example.com',
  password_hash: 'not-a-real-password',
  role: 'user',
  disabled: 0,
  created_at: now,
  updated_at: now,
});

test('用户 QQ 邮箱授权码加密保存，状态接口不返回秘密', () => {
  const saved = mail.saveUserMailAccount(userId, {
    username: 'reader@qq.com',
    authCode: 'secret-auth-code',
    enabled: true,
  });
  assert.equal(saved.configured, true);
  assert.equal(saved.username, 'reader@qq.com');
  assert.doesNotMatch(JSON.stringify(saved), /secret-auth-code/);
  assert.notEqual(db.getUserMailAccount(userId)?.encrypted_auth_code, 'secret-auth-code');
  assert.match(db.getUserMailAccount(userId)?.encrypted_auth_code || '', /^v1\./);
});

test('日报邮箱读取只读收件箱并返回标准化摘要', async () => {
  let released = false;
  const source = Buffer.from(
    'Subject: =?utf-8?b?5rWL6K+V?=\r\n' +
    'From: sender@example.com\r\n' +
    'Date: Thu, 27 Aug 2026 10:00:00 +0800\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n\r\n' +
    '请核对内容',
    'utf8',
  );
  const fakeClient = {
    async connect() {},
    async getMailboxLock() {
      return { release: () => { released = true; } };
    },
    async search() { return [7, 8]; },
    async fetchAll() {
      return [{ uid: 8, source }];
    },
    async logout() {},
  };
  const result = await mail.readUserMail(userId, 1, () => fakeClient as any);
  assert.equal(result.status, 'OK');
  assert.equal(result.unreadCount, 1);
  assert.equal(result.messages[0].subject, '测试');
  assert.equal(result.messages[0].snippet, '请核对内容');
  assert.equal(released, true);
  assert.doesNotMatch(JSON.stringify(result), /secret-auth-code/);
});

test('删除邮箱配置后日报读取返回未配置', async () => {
  const status = mail.deleteUserMailAccount(userId);
  assert.equal(status.configured, false);
  const result = await mail.readUserMail(userId);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.messages.length, 0);
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
