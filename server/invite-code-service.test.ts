import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-invite-codes-'));
process.env.DATA_DIR = tempDir;
process.env.APP_ENV = 'development';

const db = await import('./db.js');
const inviteCodes = await import('./invite-code-service.js');
await db.initDb();

const adminCode = 'legacy-admin-code-for-test';
const userCode = 'legacy-user-code-for-test';
inviteCodes.initializeInviteCodes({ adminCode, userCode, isProduction: true });

test('邀请码首次从环境变量导入哈希，状态接口数据不含明文', () => {
  const adminRecord = db.getInviteCode('admin');
  const userRecord = db.getInviteCode('user');
  assert.ok(adminRecord);
  assert.ok(userRecord);
  assert.notEqual(adminRecord.code_hash, adminCode);
  assert.notEqual(userRecord.code_hash, userCode);
  assert.equal(inviteCodes.getInviteCodeRole(adminCode), 'admin');
  assert.equal(inviteCodes.getInviteCodeRole(userCode), 'user');

  const statuses = inviteCodes.listInviteCodeStatuses();
  assert.equal(statuses.length, 2);
  assert.equal(JSON.stringify(statuses).includes(adminCode), false);
  assert.equal(JSON.stringify(statuses).includes(userCode), false);
  assert.deepEqual(statuses.map(status => status.version), [1, 1]);
});

test('邀请码按角色轮换，旧值立即失效且数据库重载后新值仍生效', async () => {
  const rotated = inviteCodes.rotateInviteCode('user');
  assert.equal(rotated.role, 'user');
  assert.ok(rotated.code.length >= 12);
  assert.notEqual(rotated.code, userCode);
  assert.equal(inviteCodes.getInviteCodeRole(userCode), null);
  assert.equal(inviteCodes.getInviteCodeRole(rotated.code), 'user');
  assert.equal(rotated.status.version, 2);

  const stored = db.getInviteCode('user');
  assert.ok(stored);
  assert.equal(stored.version, 2);
  assert.equal(stored.code_hash.includes(rotated.code), false);

  await db.initDb();
  assert.equal(inviteCodes.getInviteCodeRole(userCode), null);
  assert.equal(inviteCodes.getInviteCodeRole(rotated.code), 'user');

  inviteCodes.initializeInviteCodes({
    adminCode: 'stale-admin-env-value',
    userCode: 'stale-user-env-value',
    isProduction: true,
  });
  assert.equal(inviteCodes.getInviteCodeRole(rotated.code), 'user');
  assert.equal(inviteCodes.getInviteCodeRole('stale-user-env-value'), null);
  assert.doesNotThrow(() => inviteCodes.initializeInviteCodes({
    adminCode: 'short',
    userCode: 'short',
    isProduction: true,
  }));
});
