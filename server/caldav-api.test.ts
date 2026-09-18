import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aical-caldav-api-'));
Object.assign(process.env, { DATA_DIR: root, NODE_ENV: 'test', APP_ENV: 'development', BACKGROUND_JOBS_ENABLED: 'false', CALDAV_BRIDGE_ENABLED: 'true', CALDAV_BRIDGE_WRITE_ENABLED: 'false', CALDAV_BRIDGE_USER_ID: 'bridge-owner', CALDAV_BRIDGE_CALENDAR_IDS: 'bridge-owner:personal', CALDAV_BRIDGE_COLLECTION_URL: 'https://fixture.invalid/reader/calendar/', CALDAV_BRIDGE_USERNAME: 'synthetic', CALDAV_BRIDGE_PASSWORD: 'synthetic-only' });
const api = await import('./index.js'); await api.initializeServer();
const db = await import('./db.js'); const schedules = await import('./schedule-store.js'); const now = new Date().toISOString();
const tokens = ['bridge-owner', 'other'].map(id => api.signUserToken(db.createUser({ id, email: id + '@example.invalid', password_hash: 'synthetic', role: 'user', disabled: 0, created_at: now, updated_at: now })));
schedules.getAllCalendars('bridge-owner');
test('bridge API authentication, account isolation, input and pure read preview', async () => {
  const server = api.app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/integrations/caldav/`;
  const request = (action: string, token?: string, body = {}) => fetch(base + action, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await request('preview')).status, 401); assert.equal((await request('preview', tokens[1])).status, 403);
    assert.equal((await request('preview', tokens[0], { userId: 'other' })).status, 400);
    const before = schedules.exportScheduleDb(); const preview = await request('preview', tokens[0]); assert.equal(preview.status, 200);
    const result = await preview.json(); assert.deepEqual(result.operations, []); assert.deepEqual(schedules.exportScheduleDb(), before); assert(!fs.existsSync(path.join(root, 'caldav-bridge')));
    assert.equal((await request('sync', tokens[0])).status, 400); assert.equal((await request('sync', tokens[0], { planToken: result.planToken })).status, 403);
    process.env.MAINTENANCE_MODE = 'true'; assert.equal((await request('preview', tokens[0])).status, 503);
  } finally { delete process.env.MAINTENANCE_MODE; await new Promise<void>(resolve => server.close(() => resolve())); }
});
