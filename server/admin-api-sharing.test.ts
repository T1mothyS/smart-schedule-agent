import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-admin-api-sharing-'));
process.env.DATA_DIR = tempDir;
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'development';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.BACKUP_ENCRYPTION_KEY = 'local-test-backup-key';

const db = await import('./db.js');
await db.initDb();
const api = await import('./index.js');
await api.initializeServer();

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

test('管理员和普通用户都可以持久化共享 API 权限', () => {
  assert.equal(db.updateUserAdminApiSharing('sharing-admin', 1), true);
  assert.equal(db.getUserById('sharing-admin')?.admin_shared_api_enabled, 1);
  assert.equal(db.updateUserAdminApiSharing('sharing-admin', 0), true);
  assert.equal(db.getUserById('sharing-admin')?.admin_shared_api_enabled, 0);
});

test('其他管理员可以降级为普通用户，角色变更会刷新会话版本', () => {
  const before = db.getUserById('sharing-admin')?.auth_version;
  assert.equal(db.updateUserRole('sharing-admin', 'user'), true);
  const after = db.getUserById('sharing-admin');
  assert.equal(after?.role, 'user');
  assert.equal(after?.auth_version, (before || 0) + 1);
});

test('管理员 API 保护当前账户，并允许其他管理员完整降级后操作', async () => {
  const current = db.createUser({
    id: 'route-admin',
    email: 'route-admin@example.com',
    password_hash: 'not-a-real-password',
    role: 'admin',
    disabled: 0,
    created_at: now,
    updated_at: now,
  });
  const target = db.createUser({
    id: 'other-admin-route',
    email: 'other-admin-route@example.com',
    password_hash: 'not-a-real-password',
    role: 'admin',
    disabled: 0,
    created_at: now,
    updated_at: now,
  });
  const token = api.signUserToken(current);
  const server = api.app;
  const listener = server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    listener.once('listening', () => resolve());
    listener.once('error', reject);
  });
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;
  const request = (pathname: string, init: RequestInit = {}) => fetch(baseUrl + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });

  try {
    const selfRole = await request('/api/admin/users/route-admin/role', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    assert.equal(selfRole.status, 403);
    assert.equal((await selfRole.json()).error, '无法修改自己的管理员身份');

    for (const operation of [
      { path: '/api/admin/users/route-admin/disabled', method: 'PUT', body: { disabled: true } },
      { path: '/api/admin/users/route-admin/clear-data', method: 'POST', body: {} },
      { path: '/api/admin/users/route-admin', method: 'DELETE', body: {} },
    ]) {
      const response = await request(operation.path, {
        method: operation.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(operation.body),
      });
      assert.equal(response.status, 403);
    }

    const selfSharing = await request('/api/admin/users/route-admin/api-share', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(selfSharing.status, 200);
    assert.equal(db.getUserById('route-admin')?.admin_shared_api_enabled, 1);

    const targetSharing = await request(`/api/admin/users/${target.id}/api-share`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(targetSharing.status, 200);
    assert.equal(db.getUserById(target.id)?.admin_shared_api_enabled, 1);

    const downgrade = await request(`/api/admin/users/${target.id}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    assert.equal(downgrade.status, 200);
    assert.equal(db.getUserById(target.id)?.role, 'user');

    const disable = await request(`/api/admin/users/${target.id}/disabled`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    assert.equal(disable.status, 200);
    const clear = await request(`/api/admin/users/${target.id}/clear-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmEmail: target.email }),
    });
    assert.equal(clear.status, 200);
    const remove = await request(`/api/admin/users/${target.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmEmail: target.email }),
    });
    assert.equal(remove.status, 200);
    assert.equal(db.getUserById(target.id), undefined);
  } finally {
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  }
});
