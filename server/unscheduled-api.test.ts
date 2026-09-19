import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aical-unscheduled-'));
Object.assign(process.env, { DATA_DIR: root, NODE_ENV: 'test', APP_ENV: 'development', BACKGROUND_JOBS_ENABLED: 'false' });
const api = await import('./index.js'); await api.initializeServer();
const db = await import('./db.js'); const store = await import('./schedule-store.js'); const reminders = await import('./reminder-store.js');
const now = new Date().toISOString();
const users = ['owner', 'other'].map(id => db.createUser({ id, email: id + '@example.invalid', password_hash: 'synthetic', role: 'user', disabled: 0, created_at: now, updated_at: now }));
const tokens = users.map(api.signUserToken);

test('unscheduled pure read includes completion history, isolates accounts, and survives toggle', async () => {
  const server = api.app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/schedules`;
  const request = (suffix = '', method = 'GET', body?: object, owner = 0) => fetch(base + suffix, { method, headers: { Authorization: 'Bearer ' + tokens[owner], 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  try {
    assert.equal((await fetch(base + '/unscheduled')).status, 401);
    const input = { type: 'todo', title: 'Synthetic archive', is_unscheduled: true, start_time: '2020-01-01T09:00:00', is_completed: true };
    const created = await (await request('', 'POST', input)).json(); assert(created.schedule);
    await request('', 'POST', input, 1);
    const before = store.exportScheduleDb(), cycles = reminders.exportReminderDb();
    const list = await (await request('/unscheduled')).json(); assert.equal(list.schedules.length, 1); assert.equal(list.schedules[0].id, created.schedule.id);
    assert.deepEqual(store.exportScheduleDb(), before); assert.deepEqual(reminders.exportReminderDb(), cycles);
    assert.equal((await request('/' + created.schedule.id, 'PATCH', { title: 'other' }, 1)).status, 403);
    await request('/' + created.schedule.id + '/toggle', 'POST');
    assert.equal((await (await request('/unscheduled')).json()).schedules[0].is_completed, false);
    assert.equal((await request('', 'POST', { ...input, is_unscheduled: false, all_day: true })).status, 400);
    const singleDay = await request('', 'POST', { ...input, is_unscheduled: false, all_day: true, start_time: '2026-09-20T00:00:00' });
    assert.equal(singleDay.status, 200); assert.equal((await singleDay.json()).schedule.end_time, undefined);
    assert.equal((await request('/' + created.schedule.id, 'PATCH', { is_unscheduled: false, start_time: '2026-09-20T09:00:00' })).status, 200);
    assert.deepEqual((await (await request('/unscheduled')).json()).schedules, []);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});

test('shared write validation rejects ambiguous AI/batch input; legacy restore remains readable', () => {
  const row = { id: 'legacy', user_id: 'owner', calendar_id: 'owner:personal', type: 'todo' as const, title: 'Legacy synthetic', start_time: '2026-09-20T09:00:00', all_day: true, is_completed: false, is_repeated: false, reminders: [], is_high_risk: false, category: 'other', priority: 'medium' as const };
  assert.throws(() => store.createSchedulesBatch([row]), /全天/);
  store.restoreUserScheduleData('owner', { schedules: [{ ...row, created_at: now, updated_at: now }], calendars: [], categories: [] }, 'merge');
  assert.equal(store.getSchedule('legacy')?.all_day, true);
  assert.equal(store.updateSchedule('legacy', { all_day: false })?.start_time, row.start_time);
});
