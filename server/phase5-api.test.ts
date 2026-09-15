import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-phase5-api-'));
process.env.DATA_DIR = root;
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'development';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
const api = await import('./index.js');
await api.initializeServer();
const db = await import('./db.js');
const now = new Date().toISOString();
const tokens = ['owner', 'other'].map(id => api.signUserToken(db.createUser({ id, email: id + '@example.invalid', password_hash: 'synthetic', role: 'user', disabled: 0, created_at: now, updated_at: now })));

test('schedule reminder completion routers retain ownership and repeat-completion contracts', async () => {
  const server = api.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const request = (url: string, user = 0, method = 'GET', body?: unknown) => fetch(base + url, {
    method, headers: { Authorization: 'Bearer ' + tokens[user], 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    for (const url of ['/api/schedules', '/api/cycle-reminders', '/api/history', '/api/notifications']) assert.equal((await fetch(base + url)).status, 401);
    const created = await request('/api/schedules', 0, 'POST', { title: 'phase5 fixture', type: 'todo', start_time: '2026-12-20T09:00:00' });
    assert.equal(created.status, 200);
    const id = (await created.json()).schedule.id;
    assert.equal((await request('/api/schedules/' + id, 1)).status, 403);
    assert.equal((await request('/api/schedules/' + id, 1, 'PATCH', { title: 'forbidden' })).status, 403);
    assert.equal((await request('/api/schedules/' + id, 1, 'DELETE')).status, 403);
    assert.equal((await request('/api/completions', 1, 'POST', { sourceType: 'schedule', sourceId: id })).status, 404);
    const complete = () => request('/api/completions', 0, 'POST', { sourceType: 'schedule', sourceId: id });
    const first = await complete(); assert.equal(first.status, 200);
    const completion = (await first.json()).completion;
    assert.equal((await (await complete()).json()).completion.id, completion.id);
    assert.equal((await request('/api/completions/' + completion.id + '/reopen', 1, 'POST', {})).status, 404);
    assert.equal((await request('/api/completions/' + completion.id + '/reopen', 0, 'POST', {})).status, 200);
    assert.equal((await (await request('/api/schedules/' + id)).json()).schedule.is_completed, false);
    for (const url of ['/api/schedules/date/2026-12-20', '/api/schedules/by-date/2026-12-20']) assert.equal((await request(url)).status, 200);
    const cycle = await request('/api/cycle-reminders', 0, 'POST', { type: 'generic', name: 'fixture cycle', config: { rule: { frequency: 'monthly', anchorDate: '2026-12-20', dayOfMonth: 20 } } });
    assert.equal(cycle.status, 200);
    const taskId = (await cycle.json()).task.id;
    assert.equal((await request('/api/cycle-reminders/' + taskId, 1, 'PATCH', { enabled: false })).status, 404);
    assert.equal((await request('/api/cycle-reminders/' + taskId, 1, 'DELETE')).status, 404);
    assert.equal((await request('/api/cycle-reminders/' + taskId, 0, 'DELETE')).status, 200);
    assert.equal((await request('/api/schedules/' + id, 0, 'DELETE')).status, 200);
    assert.equal((await request('/api/schedules/' + id)).status, 404);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
