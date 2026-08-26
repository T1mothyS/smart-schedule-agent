import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-admin-api-sharing-'));
process.env.DATA_DIR = tempDir;

const db = await import('./db.js');
await db.initDb();

const now = new Date().toISOString();
db.createUser({
  id: 'sharing-admin',
  email: 'sharing-admin@example.com',
  password_hash: 'not-a-real-password',
  role: 'admin',
  disabled: 0,
  created_at: now,
  updated_at: now,
});
db.createUser({
  id: 'sharing-user',
  email: 'sharing-user@example.com',
  password_hash: 'not-a-real-password',
  role: 'user',
  disabled: 0,
  created_at: now,
  updated_at: now,
});

test('管理员 API 共享权限按用户持久化且公开用户数据不包含 API Key', () => {
  const before = db.getUsersPaginated(1, 10, '').users.find(user => user.id === 'sharing-user');
  assert.equal(before?.admin_shared_api_enabled, false);
  assert.equal('api_key' in (before || {}), false);

  db.upsertUserApiKey({
    id: 'sharing-admin-key',
    user_id: 'sharing-admin',
    api_key: 'admin-secret-for-test',
    base_url: null,
    created_at: now,
    updated_at: now,
  });

  assert.equal(db.updateUserAdminApiSharing('sharing-user', 1), true);
  const enabled = db.getUsersPaginated(1, 10, '').users.find(user => user.id === 'sharing-user');
  assert.equal(enabled?.admin_shared_api_enabled, true);
  assert.equal(db.getAdminSharedApiKey()?.user_id, 'sharing-admin');

  assert.equal(db.updateUserAdminApiSharing('sharing-user', 0), true);
  const disabled = db.getUsersPaginated(1, 10, '').users.find(user => user.id === 'sharing-user');
  assert.equal(disabled?.admin_shared_api_enabled, false);
});

test('管理员账号不能被写入普通用户的共享 API 权限', () => {
  assert.equal(db.updateUserAdminApiSharing('sharing-admin', 1), false);
  assert.equal(db.getUserById('sharing-admin')?.admin_shared_api_enabled, 0);
});
