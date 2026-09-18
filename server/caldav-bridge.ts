import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from './persistence.js';
import { CaldavError, digest, icalHash, projectEvent, type ProjectedEvent } from './caldav-projection.js';
import type { Schedule } from './schedule-store.js';

export interface BridgeConfig {
  userId: string; calendarIds: string[]; collectionUrl: string;
  username: string; password: string; timezone: string; alarms: boolean; writeEnabled: boolean; includeCompleted: boolean;
}
export interface SourceSnapshot { complete: true; calendars: string[]; schedules: Schedule[] }
interface Entry { hash: string; etag: string | null; sourceId: string; pending?: boolean; previousHash?: string }
interface Ledger { version: 1; binding: string; entries: Record<string, Entry> }
type Action = 'create' | 'update' | 'delete' | 'unchanged' | 'recover';
interface Operation { key: string; sourceId: string; action: Action; etag: string | null; remoteHash?: string; desired?: ProjectedEvent }
export interface BridgePlan {
  planToken: string; operations: Array<{ key: string; sourceId: string; action: Action }>;
  issues: Array<{ sourceId: string; code: string }>; excluded: number;
}
export interface DavTransport {
  get(key: string): Promise<{ etag: string; hash: string } | null>;
  put(key: string, ical: string, etag: string | null): Promise<void>;
  delete(key: string, etag: string): Promise<void>;
}
const KEY = /^aical-[a-f0-9]{64}\.ics$/;
const HASH = /^[a-f0-9]{64}$/;
const strongEtag = (value: unknown): value is string => typeof value === 'string' && /^"[^"\r\n]+"$/.test(value);

export function bridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig | null {
  if (env.CALDAV_BRIDGE_ENABLED !== 'true') return null;
  const calendarIds = [...new Set((env.CALDAV_BRIDGE_CALENDAR_IDS || '').split(',').map(s => s.trim()).filter(Boolean))].sort();
  const result = {
    userId: env.CALDAV_BRIDGE_USER_ID || '', calendarIds, collectionUrl: env.CALDAV_BRIDGE_COLLECTION_URL || '',
    username: env.CALDAV_BRIDGE_USERNAME || '', password: env.CALDAV_BRIDGE_PASSWORD || '',
    timezone: env.CALDAV_BRIDGE_TIMEZONE || 'Asia/Shanghai', alarms: env.CALDAV_BRIDGE_ALARMS_ENABLED === 'true',
    writeEnabled: env.CALDAV_BRIDGE_WRITE_ENABLED === 'true', includeCompleted: env.CALDAV_BRIDGE_INCLUDE_COMPLETED === 'true',
  };
  let url: URL;
  try { url = new URL(result.collectionUrl); } catch { throw new CaldavError('INVALID_BRIDGE_CONFIG', 503); }
  if (!result.userId || !calendarIds.length || calendarIds.length > 10 || !result.username || !result.password
    || /[:\r\n]/.test(result.username) || url.username || url.password || url.search || url.hash
    || url.protocol !== 'https:' || url.pathname === '/' || !url.pathname.endsWith('/')
    || !['Asia/Shanghai', 'Asia/Hong_Kong', 'UTC'].includes(result.timezone)) throw new CaldavError('INVALID_BRIDGE_CONFIG', 503);
  result.collectionUrl = url.href;
  return result;
}

export function createDavTransport(config: BridgeConfig, fetcher: typeof fetch = fetch): DavTransport {
  const auth = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
  async function request(method: string, key: string, headers: Record<string, string> = {}, body?: string) {
    if (!KEY.test(key)) throw new CaldavError('INVALID_RESOURCE_KEY');
    try {
      return await fetcher(new URL(key, config.collectionUrl), {
        method, headers: { Authorization: auth, ...headers }, body, redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new CaldavError('CALDAV_NETWORK_ERROR', 502); }
  }
  return {
    async get(key) {
      const response = await request('GET', key);
      if (response.status === 404) { await response.body?.cancel(); return null; }
      const etag = response.headers.get('etag');
      if (response.status !== 200 || !strongEtag(etag)) { await response.body?.cancel(); throw new CaldavError('CALDAV_READ_FAILED', 502); }
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        if (response.body) for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
          size += chunk.length; if (size > 128 * 1024) throw new Error('size'); chunks.push(chunk);
        }
      } catch { throw new CaldavError('CALDAV_BODY_FAILED', 502); }
      return { etag, hash: icalHash(Buffer.concat(chunks).toString('utf8')) };
    },
    async put(key, ical, etag) {
      const response = await request('PUT', key, { 'Content-Type': 'text/calendar; charset=utf-8', ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }) }, ical);
      await response.body?.cancel();
      if (![201, 204].includes(response.status)) throw new CaldavError(response.status === 412 ? 'CALDAV_CONFLICT' : 'CALDAV_WRITE_FAILED', 502);
    },
    async delete(key, etag) {
      const response = await request('DELETE', key, { 'If-Match': etag }); await response.body?.cancel();
      if (![200, 204, 404].includes(response.status)) throw new CaldavError(response.status === 412 ? 'CALDAV_CONFLICT' : 'CALDAV_DELETE_FAILED', 502);
    },
  };
}

export function createCaldavBridge(config: BridgeConfig, stateFile: string, readSource: () => SourceSnapshot, transport = createDavTransport(config)) {
  const binding = digest(JSON.stringify([config.userId, config.calendarIds, config.collectionUrl]));
  let busy = false;
  function readLedger(): Ledger {
    if (!fs.existsSync(stateFile)) return { version: 1, binding, entries: {} };
    try {
      const ledger = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Ledger;
      if (ledger.version !== 1 || ledger.binding !== binding || !ledger.entries || Array.isArray(ledger.entries) || typeof ledger.entries !== 'object') throw new Error();
      if (Object.keys(ledger.entries).length > 500) throw new Error();
      for (const [key, entry] of Object.entries(ledger.entries)) {
        if (!KEY.test(key) || !entry || !HASH.test(entry.hash) || typeof entry.sourceId !== 'string'
          || !(entry.etag === null || strongEtag(entry.etag)) || (entry.pending !== undefined && entry.pending !== true)
          || (entry.previousHash !== undefined && !HASH.test(entry.previousHash)) || (!entry.pending && !entry.etag)) throw new Error();
      }
      return ledger;
    } catch { throw new CaldavError('BRIDGE_STATE_INVALID_OR_BINDING_CHANGED'); }
  }
  const save = (ledger: Ledger) => atomicWriteFile(stateFile, Buffer.from(JSON.stringify(ledger)));
  function snapshot() {
    const source = readSource();
    if (source.complete !== true || config.calendarIds.some(id => !source.calendars.includes(id)) || source.schedules.some(row => row.user_id !== config.userId)) throw new CaldavError('SOURCE_SNAPSHOT_INCOMPLETE');
    const desired = new Map<string, ProjectedEvent>(); const issues: BridgePlan['issues'] = []; let excluded = 0;
    const ids = new Set<string>();
    for (const row of source.schedules) {
      if (ids.has(row.id)) throw new CaldavError('DUPLICATE_SOURCE_ID'); ids.add(row.id);
      if (!config.calendarIds.includes(row.calendar_id) || row.type !== 'event' || row.is_unscheduled
        || row.id.startsWith('reminder-cycle:') || (!config.includeCompleted && row.is_completed)) { excluded++; continue; }
      try {
        const projected = projectEvent(row, config); desired.set(projected.key, projected);
        if (!config.alarms && row.reminders.length) issues.push({ sourceId: row.id, code: 'ALARMS_DISABLED' });
      } catch (error) { issues.push({ sourceId: row.id, code: error instanceof CaldavError ? error.code : 'INVALID_SOURCE_EVENT' }); }
    }
    if (desired.size > 500) throw new CaldavError('PILOT_LIMIT_EXCEEDED');
    const signature = digest(JSON.stringify({ desired: [...desired].sort(), issues, excluded }));
    return { desired, issues, excluded, signature };
  }
  async function prepare() {
    const source = snapshot(); const ledger = readLedger(); const operations: Operation[] = [];
    if (source.issues.some(issue => issue.code !== 'ALARMS_DISABLED')) return { source, ledger, operations, publicPlan: { planToken: '', operations: [], issues: source.issues, excluded: source.excluded } satisfies BridgePlan };
    const keys = [...new Set([...source.desired.keys(), ...Object.keys(ledger.entries)])].sort();
    // Include retiring resources: upserts precede deletes and their pending state must remain readable.
    if (keys.length > 500) throw new CaldavError('PILOT_LIMIT_EXCEEDED');
    for (const key of keys) {
      const desired = source.desired.get(key); const old = ledger.entries[key]; const remote = await transport.get(key);
      if (remote && !old) throw new CaldavError('UNMANAGED_RESOURCE_COLLISION');
      if (remote && old) {
        const recovered = old.pending && remote.hash === old.hash;
        if (!recovered && (remote.etag !== old.etag || remote.hash !== (old.previousHash || old.hash))) throw new CaldavError('REMOTE_CHANGED');
      }
      const action: Action = desired
        ? !remote ? 'create' : remote.hash === desired.hash ? (old?.pending ? 'recover' : 'unchanged') : 'update'
        : 'delete';
      operations.push({ key, sourceId: desired?.sourceId || old.sourceId, action, etag: remote?.etag || null, remoteHash: remote?.hash, desired });
    }
    const planToken = digest(JSON.stringify([binding, source.signature, ledger, operations]));
    const publicPlan: BridgePlan = { planToken, operations: operations.map(({ key, sourceId, action }) => ({ key, sourceId, action })), issues: source.issues, excluded: source.excluded };
    return { source, ledger, operations, publicPlan };
  }
  async function run(planToken?: string) {
    if (busy) throw new CaldavError('BRIDGE_BUSY'); busy = true;
    let lock: number | undefined;
    try {
      if (planToken !== undefined) {
        if (!config.writeEnabled) throw new CaldavError('BRIDGE_WRITES_DISABLED', 403);
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        try { lock = fs.openSync(stateFile + '.lock', 'wx', 0o600); }
        catch { throw new CaldavError('BRIDGE_LOCKED'); }
      }
      const prepared = await prepare();
      if (planToken === undefined) return prepared.publicPlan;
      if (!prepared.publicPlan.planToken || planToken !== prepared.publicPlan.planToken) throw new CaldavError('PREVIEW_CHANGED_OR_BLOCKED');
      const { source, ledger, operations } = prepared;
      // Only start deletions after all upserts have succeeded. Never purge a collection.
      for (const op of [...operations.filter(op => op.action !== 'delete'), ...operations.filter(op => op.action === 'delete')]) {
        if (snapshot().signature !== source.signature) throw new CaldavError('SOURCE_CHANGED_RETRY_PREVIEW');
        if (op.action === 'unchanged') continue;
        if (op.action === 'delete') {
          if (op.etag) await transport.delete(op.key, op.etag);
          delete ledger.entries[op.key]; save(ledger);
        } else if (op.action === 'recover') {
          ledger.entries[op.key] = { hash: op.desired!.hash, etag: op.etag, sourceId: op.sourceId }; save(ledger);
        } else {
          // Durable intent precedes remote mutation; ambiguous responses are reconciled by GET.
          ledger.entries[op.key] = { hash: op.desired!.hash, etag: op.etag, sourceId: op.sourceId,
            pending: true, previousHash: op.remoteHash }; save(ledger);
          await transport.put(op.key, op.desired!.ical, op.etag);
          const stored = await transport.get(op.key);
          if (!stored || stored.hash !== op.desired!.hash) throw new CaldavError('REMOTE_REPRESENTATION_MISMATCH');
          ledger.entries[op.key] = { hash: stored.hash, etag: stored.etag, sourceId: op.sourceId }; save(ledger);
        }
      }
      return { ...prepared.publicPlan, applied: true as const };
    } finally {
      try {
        if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(stateFile + '.lock'); }
      } finally { busy = false; }
    }
  }
  return { preview: () => run(), sync: (token: string) => run(token) };
}
