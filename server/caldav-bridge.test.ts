import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bridgeConfig, createCaldavBridge, createDavTransport, type BridgeConfig, type DavTransport, type SourceSnapshot } from './caldav-bridge.js';
import { icalHash, projectEvent } from './caldav-projection.js';
import type { Schedule } from './schedule-store.js';
const config: BridgeConfig = { userId: 'owner', calendarIds: ['owner:personal'], collectionUrl: 'https://caldav.example.invalid/poc-reader/poc/', username: 'synthetic', password: 'synthetic-only', timezone: 'Asia/Shanghai', alarms: false, writeEnabled: true, includeCompleted: false };
function event(overrides: Partial<Schedule> = {}): Schedule {
  return { id: 'one', user_id: 'owner', calendar_id: 'owner:personal', type: 'event', title: '会议 📅', start_time: '2026-09-20T14:00:00', end_time: '2026-09-20T15:00:00', all_day: false, category: 'work', priority: 'medium', is_completed: false, is_repeated: false, is_high_risk: false, reminders: [], created_at: '2026-09-18T00:00:00Z', updated_at: '2026-09-18T01:00:00Z', ...overrides };
}
function fixture() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aical-caldav-unit-')), 'state.json');
  const source: SourceSnapshot = { complete: true, calendars: ['owner:personal'], schedules: [event()] };
  const remote = new Map<string, { etag: string; hash: string }>(); let sequence = 0;
  const calls: string[] = [];
  const transport: DavTransport = {
    async get(key) { calls.push('GET'); return remote.get(key) || null; },
    async put(key, ical, tag) { calls.push('PUT'); assert.equal(remote.get(key)?.etag || null, tag); remote.set(key, { etag: `"${++sequence}"`, hash: icalHash(ical) }); },
    async delete(key, tag) { calls.push('DELETE'); assert.equal(remote.get(key)?.etag, tag); remote.delete(key); },
  };
  return { source, remote, calls, file, transport, bridge: createCaldavBridge(config, file, () => source, transport) };
}
async function apply(bridge: ReturnType<typeof createCaldavBridge>) { return bridge.sync((await bridge.preview()).planToken); }

test('CalDAV projection: stable UID, UTC, cross-day, all-day, recurrence and UTF-8 folding', () => {
  const a = projectEvent(event({ notes: '多行; , \\ \n' + '中文📅'.repeat(50), is_repeated: true, repeat_rule: 'weekly' }), config);
  assert.match(a.ical, /DTSTART:20260920T060000Z/); assert.match(a.ical, /RRULE:FREQ=WEEKLY/);
  assert(a.ical.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert.equal(projectEvent(event({ title: 'new' }), config).key, a.key);
  assert.notEqual(projectEvent(event({ user_id: 'other' }), config).key, a.key);
  assert.match(projectEvent(event({ all_day: true, start_time: '2026-09-20T00:00:00', end_time: undefined }), config).ical, /DTEND;VALUE=DATE:20260921/);
  assert.match(projectEvent(event({ start_time: '2026-09-20T23:30:00+08:00', end_time: '2026-09-21T00:30:00+08:00' }), config).ical, /DTEND:20260920T163000Z/);
  assert.match(projectEvent(event({ end_time: undefined }), config).ical, /DTEND:20260920T070000Z/);
  assert.equal(projectEvent(event({ start_time: '2026-09-20T06:00:00Z' }), config).hash, projectEvent(event(), config).hash);
});
test('unsupported semantics fail explicitly; alarm mapping is opt-in', () => {
  for (const overrides of [{ is_repeated: true, repeat_rule: 'monthly' }, { start_time: '2026-02-30T10:00:00' }, { all_day: true }, { repeat_rule: 'RRULE:FREQ=DAILY' }]) assert.throws(() => projectEvent(event(overrides), config));
  assert.throws(() => projectEvent(event(), { ...config, timezone: 'America/New_York' }));
  assert.doesNotMatch(projectEvent(event({ reminders: ['10'] }), config).ical, /VALARM/);
  assert.match(projectEvent(event({ reminders: ['10'] }), { ...config, alarms: true }).ical, /TRIGGER:-PT10M/);
  for (const reminders of [['bad'], ['5', '10']]) assert.throws(() => projectEvent(event({ reminders }), { ...config, alarms: true }));
});
test('preview has no mutations; sync is idempotent and removes only ledger-owned objects', async () => {
  const f = fixture(); const p = await f.bridge.preview(); assert(!fs.existsSync(f.file)); assert.deepEqual(f.calls, ['GET']);
  await f.bridge.sync(p.planToken); await apply(f.bridge); assert.equal(f.calls.filter(c => c === 'PUT').length, 1);
  f.remote.set('seed.ics', { etag: '"seed"', hash: 'seed' }); f.source.schedules[0].title = 'changed'; await apply(f.bridge);
  f.source.schedules = []; await apply(f.bridge); assert.equal(f.remote.size, 1); assert(f.remote.has('seed.ics'));
});
test('completed source events are excluded and existing projections are retired', async () => {
  const f = fixture(); await apply(f.bridge); assert.equal(f.remote.size, 1);
  f.source.schedules[0].is_completed = true;
  const preview = await f.bridge.preview();
  assert.equal(preview.excluded, 1); assert.equal(preview.operations[0].action, 'delete');
  await f.bridge.sync(preview.planToken); assert.equal(f.remote.size, 0);
});
test('source gaps, unsupported events and stale preview cannot delete', async () => {
  const f = fixture(); await apply(f.bridge); f.source.calendars = []; await assert.rejects(f.bridge.preview(), /SOURCE_SNAPSHOT_INCOMPLETE/);
  f.source.calendars = config.calendarIds; f.source.schedules[0].is_repeated = true; f.source.schedules[0].repeat_rule = 'monthly';
  assert.equal((await f.bridge.preview()).planToken, ''); await assert.rejects(f.bridge.sync(''), /PREVIEW_CHANGED/);
  f.source.schedules = [event()]; const p = await f.bridge.preview(); f.source.schedules[0].title = 'changed';
  await assert.rejects(f.bridge.sync(p.planToken), /PREVIEW_CHANGED/); assert(!f.calls.includes('DELETE'));
});
test('network read/write failure prevents delete phase and preserves state', async () => {
  const f = fixture(); await apply(f.bridge); f.source.schedules = [event({ id: 'two' })];
  const get = f.transport.get; f.transport.get = async () => { throw new Error('synthetic outage'); };
  await assert.rejects(f.bridge.preview()); f.transport.get = get; const p = await f.bridge.preview();
  f.transport.put = async () => { throw new Error('synthetic write outage'); };
  await assert.rejects(f.bridge.sync(p.planToken)); assert(!f.calls.includes('DELETE')); assert.equal(f.remote.size, 1); assert(fs.existsSync(f.file));
});
test('ambiguous successful PUT recovers after restart without duplication', async () => {
  const f = fixture(); const put = f.transport.put; f.transport.put = async (...args) => { await put(...args); throw new Error('response lost'); };
  await assert.rejects(apply(f.bridge)); f.transport.put = put;
  const restarted = createCaldavBridge(config, f.file, () => f.source, f.transport);
  assert.equal((await restarted.preview()).operations[0].action, 'recover'); await apply(restarted);
  assert.equal(f.calls.filter(c => c === 'PUT').length, 1); assert.equal((await restarted.preview()).operations[0].action, 'unchanged');
});
test('external edits, absent/corrupt ledger and scope change fail closed', async () => {
  const f = fixture(); await apply(f.bridge); f.remote.values().next().value!.etag = '"external"'; await assert.rejects(f.bridge.preview(), /REMOTE_CHANGED/);
  await assert.rejects(createCaldavBridge(config, f.file + '.new', () => f.source, f.transport).preview(), /UNMANAGED_RESOURCE_COLLISION/);
  await assert.rejects(createCaldavBridge({ ...config, collectionUrl: 'https://example.invalid/other/' }, f.file, () => f.source, f.transport).preview(), /BRIDGE_STATE_INVALID/);
  fs.writeFileSync(f.file, '{broken'); await assert.rejects(f.bridge.preview(), /BRIDGE_STATE_INVALID/);
});
test('lock blocks other writers; disabled sync creates no state', async () => {
  const f = fixture(); fs.writeFileSync(f.file + '.lock', 'synthetic'); await assert.rejects(f.bridge.sync('invalid'), /BRIDGE_LOCKED/);
  await assert.rejects(createCaldavBridge({ ...config, writeEnabled: false }, f.file + '.off', () => f.source, f.transport).sync('invalid'), /BRIDGE_WRITES_DISABLED/);
  assert(!fs.existsSync(f.file + '.off'));
});
test('unsafe configuration URLs and sensitive transport errors are rejected', async () => {
  assert.equal(bridgeConfig({}), null);
  const env = { CALDAV_BRIDGE_ENABLED: 'true', CALDAV_BRIDGE_USER_ID: 'owner', CALDAV_BRIDGE_CALENDAR_IDS: 'owner:personal', CALDAV_BRIDGE_USERNAME: 'writer', CALDAV_BRIDGE_PASSWORD: 'not-real' };
  for (const url of ['http://localhost/c/', 'https://name:secret@example.invalid/c/', 'https://example.invalid/', 'https://example.invalid/c/?secret=foo']) assert.throws(() => bridgeConfig({ ...env, CALDAV_BRIDGE_COLLECTION_URL: url }));
  const transport = createDavTransport(config, (async (_url, init) => { assert.equal(init?.redirect, 'error'); assert(init?.signal); throw new Error('secret-upstream-body'); }) as typeof fetch);
  await assert.rejects(transport.get(projectEvent(event(), config).key), error => String(error).includes('CALDAV_NETWORK_ERROR') && !String(error).includes('secret-upstream-body'));
});

test('failed pending update can change again before retry without losing ownership', async () => {
  const f = fixture(); await apply(f.bridge); const put = f.transport.put;
  f.source.schedules[0].title = 'first revision'; f.transport.put = async () => { throw new Error('before send'); };
  await assert.rejects(apply(f.bridge)); f.source.schedules[0].title = 'second revision'; f.transport.put = put;
  await apply(f.bridge); assert.equal((await f.bridge.preview()).operations[0].action, 'unchanged');
});

test('source exceptions and crossed account snapshots cause no remote access', async () => {
  const f = fixture();
  await assert.rejects(createCaldavBridge(config, f.file, () => { throw new Error('read failed'); }, f.transport).preview());
  f.source.schedules[0].user_id = 'other'; await assert.rejects(f.bridge.preview(), /SOURCE_SNAPSHOT_INCOMPLETE/);
  assert.equal(f.calls.length, 0);
});

test('pilot limit includes retiring resources before any remote mutation', async () => {
  const f = fixture(); await apply(f.bridge); const before = fs.readFileSync(f.file, 'utf8'); f.calls.length = 0;
  f.source.schedules = Array.from({ length: 500 }, (_, index) => event({ id: `replacement-${index}` }));
  await assert.rejects(f.bridge.preview(), /PILOT_LIMIT_EXCEEDED/);
  assert.equal(f.calls.length, 0); assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});
