import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-phase4-api-'));
process.env.DATA_DIR = root;
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'development';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
const api = await import('./index.js');
await Promise.all([api.initializeServer(), api.initializeServer()]);
const db = await import('./db.js');
const stamp = new Date().toISOString();
const users = ['owner', 'other'].map(id => db.createUser({ id, email: id + '@example.invalid', password_hash: 'synthetic', role: 'user', disabled: 0, created_at: stamp, updated_at: stamp }));
const tokens = users.map(api.signUserToken);

test('extracted routes preserve auth, search isolation and ownership errors', async () => {
  const listener = api.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => listener.once('listening', resolve));
  const base = 'http://127.0.0.1:' + (listener.address() as { port: number }).port;
  const request = (url: string, user = 0, method = 'GET', body?: unknown) => fetch(base + url, {
    method, headers: { Authorization: 'Bearer ' + tokens[user], 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    for (const url of ['/api/ai-linkage-guides', '/api/search?q=fixture', '/api/note-items']) {
      assert.equal((await fetch(base + url)).status, 401);
      assert.equal((await request(url)).status, 200);
    }
    assert.equal((await request('/api/admin/users')).status, 403);
    const created = await request('/api/note-items', 0, 'POST', { content: 'phase4owner note' });
    assert.equal(created.status, 201);
    const id = (await created.json()).items[0].id;
    assert.equal((await request('/api/note-items/' + id, 1, 'PATCH', { completed: true })).status, 404);
    assert.equal((await request('/api/note-items/' + id, 1, 'DELETE')).status, 404);
    const own = await (await request('/api/search?q=phase4owner&scope=note')).json();
    assert.equal(own.results.length, 1); assert.equal(own.results[0].id, id);
    const other = await (await request('/api/search?q=phase4owner&scope=note', 1)).json();
    assert.equal(other.results.length, 0);
    assert.equal((await request('/api/search?q=fixture&scope=invalid')).status, 400);
  } finally { await new Promise<void>(resolve => listener.close(() => resolve())); }
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
