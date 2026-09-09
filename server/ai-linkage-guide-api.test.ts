import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-ai-guide-api-'));
process.env.DATA_DIR = tempDir;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.APP_URL = 'http://127.0.0.1:0';
process.env.JWT_SECRET = 'ai-guide-api-test-jwt-secret';

const api = await import('./index.js');
const db = await import('./db.js');
await api.initializeServer();

const now = new Date().toISOString();
const user = db.createUser({
  id: 'ai-guide-api-user',
  email: 'ai-guide-api@example.com',
  password_hash: 'test',
  role: 'user',
  disabled: 0,
  created_at: now,
  updated_at: now,
});
const token = api.signUserToken(user);

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

test('AI 联动指南接口必须登录且不返回动态上下文或密钥', async () => {
  const server = http.createServer(api.app);
  const port = await listen(server);
  try {
    const unauthenticated = await fetch(`http://127.0.0.1:${port}/api/ai-linkage-guides`);
    assert.equal(unauthenticated.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/api/ai-linkage-guides`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const guide = await response.json();
    assert.match(guide.version, /^ai-linkage-/);
    assert.equal(guide.items.length, 8);
    assert.ok(guide.examples.length >= 3);
    assert.doesNotMatch(JSON.stringify(guide), /scheduleItems|dynamic|apiKey\s*[:=]\s*[^<]/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
