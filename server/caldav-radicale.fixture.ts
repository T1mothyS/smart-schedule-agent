// Only launched by the Python harness with a fresh synthetic service and store.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const target = new URL(process.env.CALDAV_FIXTURE_URL || '');
assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1');
const credentials = JSON.parse(process.env.CALDAV_FIXTURE_CREDENTIALS || '{}');
assert(credentials['poc-writer'] && credentials['poc-reader']);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aical-caldav-smoke-'));
Object.assign(process.env, { DATA_DIR: root, NODE_ENV: 'test', APP_ENV: 'development', BACKGROUND_JOBS_ENABLED: 'false',
  CALDAV_BRIDGE_ENABLED: 'true', CALDAV_BRIDGE_WRITE_ENABLED: 'true', CALDAV_BRIDGE_USER_ID: 'smoke-owner',
  CALDAV_BRIDGE_SCOPE: 'all',
  CALDAV_BRIDGE_CALENDAR_IDS: 'smoke-owner:personal', CALDAV_BRIDGE_COLLECTION_URL: 'https://caldav.fixture.invalid/poc-reader/poc/',
  CALDAV_BRIDGE_USERNAME: 'poc-writer', CALDAV_BRIDGE_PASSWORD: credentials['poc-writer'], CALDAV_BRIDGE_ALARMS_ENABLED: 'true', CALDAV_BRIDGE_TIMEZONE: 'Asia/Shanghai' });
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === 'https://caldav.fixture.invalid') return nativeFetch(new URL(url.pathname, target), init);
  assert.equal(url.hostname, '127.0.0.1'); return nativeFetch(input, init);
};
const api = await import('./index.js'); await api.initializeServer();
const db = await import('./db.js'); const store = await import('./schedule-store.js'); const now = new Date().toISOString();
const user = db.createUser({ id: 'smoke-owner', email: 'smoke@example.invalid', password_hash: 'synthetic', role: 'user', disabled: 0, created_at: now, updated_at: now });
store.getAllCalendars(user.id);
const reminders = await import('./reminder-store.js');
const cycleTask = reminders.createReminderTask({ userId: user.id, type: 'generic', name: '合成到期项目', config: { templateKey: 'custom', rule: { frequency: 'once', anchorDate: '2026-09-25', advancePolicy: 'calendar' }, reminderOffsets: [], reminderTime: '12:00', priority: 'medium', actionGuide: '' } });
const token = api.signUserToken(user);
const server = api.app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
async function call(route: string, body: object, method = 'POST') {
  const response = await fetch(base + route, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
}
async function sync() {
  const plan = await call('/api/integrations/caldav/preview', {});
  assert.deepEqual(plan.issues, []); return call('/api/integrations/caldav/sync', { planToken: plan.planToken });
}
async function reader(key: string, method = 'GET') {
  return fetch(new URL('/poc-reader/poc/' + key, target), { method, headers: { Authorization: 'Basic ' + Buffer.from('poc-reader:' + credentials['poc-reader']).toString('base64') } });
}
try {
  const seed: object = { calendar_id: 'smoke-owner:personal', type: 'event', title: 'Bridge 合成会议 📅', start_time: '2026-09-20T14:00:00', end_time: '2026-09-20T15:00:00' };
  const overrides = [{}, { all_day: true, start_time: '2026-09-20T00:00:00', end_time: undefined },
    { start_time: '2026-09-20T23:30:00', end_time: '2026-09-21T00:30:00' },
    { is_repeated: true, repeat_rule: 'daily' }, { is_repeated: true, repeat_rule: 'weekly' },
    { reminders: ['10'], notes: '中文,分号;换行\n& < > 📅' + '长文本'.repeat(70) },
    { type: 'todo', end_time: undefined }, { calendar_id: 'smoke-owner:work' }];
  const ids: string[] = [];
  for (const override of overrides) ids.push((await call('/api/schedules', { ...seed, ...override })).schedule.id);
  const sourceBefore = store.exportScheduleDb(); const reminderBefore = reminders.exportReminderDb();
  const initial = await sync(); assert.equal(initial.operations.filter((o: any) => o.action === 'create').length, 9);
  assert.deepEqual(store.exportScheduleDb(), sourceBefore); assert.deepEqual(reminders.exportReminderDb(), reminderBefore);
  assert.deepEqual(initial.counts, { event: 7, todo: 1, cycle: 1 });
  const key = initial.operations.find((o: any) => o.sourceId === ids[0]).key;
  const first = await reader(key); assert.equal(first.status, 200); const etag = first.headers.get('etag');
  assert.match(await first.text(), /DTSTART:20260920T060000Z/);
  const repeat = await sync(); assert(repeat.operations.every((o: any) => o.action === 'unchanged'));
  assert.equal((await reader(key)).headers.get('etag'), etag);
  assert.equal((await reader(key, 'DELETE')).status, 403);
  await call('/api/schedules/' + ids[0], { title: 'Bridge Changed' }, 'PATCH'); await sync();
  assert.match(await (await reader(key)).text(), /SUMMARY:Bridge Changed/);
  for (const id of ids) await call('/api/schedules/' + id, {}, 'DELETE');
  reminders.updateReminderTask(cycleTask.id, user.id, { enabled: false });
  await sync(); assert.equal((await reader(key)).status, 404);
  console.log('SMOKE_RESULT:' + JSON.stringify({ status: 'PASS', created: 9, updated: 1, deleted: 9, readonly: 'PASS', idempotency: 'PASS', pureSource: 'PASS', production: 'NOT_TESTED' }));
} finally { globalThis.fetch = nativeFetch; await new Promise<void>(resolve => server.close(() => resolve())); }
