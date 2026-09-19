import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from './persistence.js';
import { CaldavError, digest, icalHash, projectEvent, type ProjectedEvent } from './caldav-projection.js';
import type { Schedule } from './schedule-store.js';
import type { ReminderTask, ReminderCycle } from './reminder-store.js';

export interface BridgeConfig {
  userId: string; calendarIds: string[]; collectionUrl: string;
  username: string; password: string; timezone: string; alarms: boolean; writeEnabled: boolean; includeCompleted: boolean;
  scope?: 'selected' | 'all';
}
export interface SourceSnapshot { complete: true; calendars: string[]; schedules: Schedule[]; cycles?: Array<{ task: ReminderTask; cycle: ReminderCycle | null; current?: boolean }> }
export interface SourceMapping { sourceId: string; cycleId: string; taskId: string; derivedSourceIds: string[]; current: boolean; status: string; enabled: boolean; included: boolean }
interface Entry { hash: string; etag: string | null; sourceId: string; pending?: boolean; previousHash?: string }
interface Ledger { version: 1 | 2; binding: string; entries: Record<string, Entry> }
type Action = 'create' | 'update' | 'delete' | 'unchanged' | 'recover' | 'held';
interface Operation { key: string; sourceId: string; action: Action; etag: string | null; remoteHash?: string; desired?: ProjectedEvent }
export interface BridgePlan {
  planToken: string; operations: Array<{ key: string; sourceId: string; action: Action }>;
  issues: Array<{ sourceId: string; code: string }>; excluded: number;
  counts?: Record<string, number>; exclusions?: Record<string, number>; scopeVersion?: string;
  breakdown?: Record<string, number>; sourceMappings?: SourceMapping[];
  migrationRequired?: boolean; requiresDeleteConfirmation?: boolean; complete?: boolean;
}
export interface DavTransport {
  get(key: string): Promise<{ etag: string; hash: string; ical?: string } | null>;
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
    scope: (env.CALDAV_BRIDGE_SCOPE || 'all') as 'selected' | 'all',
  };
  let url: URL;
  try { url = new URL(result.collectionUrl); } catch { throw new CaldavError('INVALID_BRIDGE_CONFIG', 503); }
  if (!result.userId || (result.scope === 'selected' && !calendarIds.length) || calendarIds.length > 10 || !result.username || !result.password
    || !['all', 'selected'].includes(result.scope)
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
      if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw new CaldavError('CALDAV_AUTH_FAILED', 502); }
      if (response.status !== 200 || !strongEtag(etag)) { await response.body?.cancel(); throw new CaldavError('CALDAV_READ_FAILED', 502); }
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        if (response.body) for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
          size += chunk.length; if (size > 128 * 1024) throw new Error('size'); chunks.push(chunk);
        }
      } catch { throw new CaldavError('CALDAV_BODY_FAILED', 502); }
      const ical = Buffer.concat(chunks).toString('utf8');
      return { etag, hash: icalHash(ical), ical };
    },
    async put(key, ical, etag) {
      const response = await request('PUT', key, { 'Content-Type': 'text/calendar; charset=utf-8', ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }) }, ical);
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new CaldavError('CALDAV_AUTH_FAILED', 502);
      if (![201, 204].includes(response.status)) throw new CaldavError(response.status === 412 ? 'CALDAV_CONFLICT' : 'CALDAV_WRITE_FAILED', 502);
    },
    async delete(key, etag) {
      const response = await request('DELETE', key, { 'If-Match': etag }); await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new CaldavError('CALDAV_AUTH_FAILED', 502);
      if (![200, 204, 404].includes(response.status)) throw new CaldavError(response.status === 412 ? 'CALDAV_CONFLICT' : 'CALDAV_DELETE_FAILED', 502);
    },
  };
}

export function createCaldavBridge(config: BridgeConfig, stateFile: string, readSource: () => SourceSnapshot, transport = createDavTransport(config)) {
  const legacyBinding = digest(JSON.stringify([config.userId, config.calendarIds, config.collectionUrl]));
  const binding = digest(JSON.stringify([config.userId, config.collectionUrl]));
  const scopeVersion = digest(JSON.stringify([binding, config.scope || 'selected', config.scope === 'all' ? [] : config.calendarIds, config.includeCompleted, config.timezone, config.alarms, 'projection-v3-history']));
  let busy = false;
  function readLedger(): Ledger {
    if (!fs.existsSync(stateFile)) return { version: 2, binding, entries: {} };
    try {
      const ledger = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Ledger;
      if ((ledger.version === 1 ? ledger.binding !== legacyBinding : ledger.version !== 2 || ledger.binding !== binding) || !ledger.entries || Array.isArray(ledger.entries) || typeof ledger.entries !== 'object') throw new Error();
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
    const selected = config.scope === 'all' ? source.calendars : config.calendarIds;
    if (source.complete !== true || selected.some(id => !source.calendars.includes(id)) || source.schedules.some(row => row.user_id !== config.userId || !source.calendars.includes(row.calendar_id))
      || (config.scope === 'all' && !Array.isArray(source.cycles))) throw new CaldavError('SOURCE_SNAPSHOT_INCOMPLETE');
    const desired = new Map<string, ProjectedEvent>(); const issues: BridgePlan['issues'] = []; let excluded = 0;
    const held = new Set<string>(); const counts = { event: 0, todo: 0, cycle: 0 };
    const breakdown = { completed: 0, pending: 0, current_cycle: 0, historical_cycle: 0, disabled_cycle: 0, cancelled_cycle: 0, merged_copy: 0 };
    const sourceMappings: SourceMapping[] = [];
    const cycleSources = new Map<string, SourceMapping>();
    const exclusions: Record<string, number> = {};
    const exclude = (reason: string) => { excluded++; exclusions[reason] = (exclusions[reason] || 0) + 1; };
    const ids = new Set<string>();
    const rows = [...source.schedules];
    if (config.scope === 'all') for (const { task, cycle, current } of source.cycles!) {
      if (task.userId !== config.userId || (cycle && cycle.taskId !== task.id)) throw new CaldavError('SOURCE_SNAPSHOT_INCOMPLETE');
      if (!cycle) { if (task.enabled) throw new CaldavError('SOURCE_SNAPSHOT_INCOMPLETE'); continue; }
      if (cycleSources.has(cycle.id) || !['pending', 'expired', 'completed', 'cancelled'].includes(cycle.status)) throw new CaldavError('SOURCE_SNAPSHOT_INCOMPLETE');
      const mapping = { sourceId: `caldav-cycle:${cycle.id}`, cycleId: cycle.id, taskId: task.id, derivedSourceIds: [] as string[], current: current !== false, status: cycle.status, enabled: task.enabled, included: config.includeCompleted || cycle.status !== 'completed' };
      cycleSources.set(cycle.id, mapping); sourceMappings.push(mapping);
      if (!config.includeCompleted && cycle.status === 'completed') { exclude('completed_cycle'); continue; }
      breakdown[current === false ? 'historical_cycle' : 'current_cycle']++;
      if (!task.enabled) breakdown.disabled_cycle++;
      if (cycle.status === 'cancelled') breakdown.cancelled_cycle++;
      const state = [!task.enabled ? '已停用' : '', cycle.status === 'cancelled' ? '已取消' : ''].filter(Boolean);
      rows.push({ id: mapping.sourceId, user_id: task.userId, calendar_id: '@cycles', type: 'event', title: `${state.map(s => `【${s}】`).join('')}周期事务：${task.name}`,
        start_time: cycle.dueDate, all_day: true, is_completed: cycle.status === 'completed', is_repeated: false, reminders: [],
        description: `${current === false ? '历史' : '当前'}周期到期日；使用当前事务名称。${state.join('；')}。请在 AI Calendar 周期事务中登记完成。`, category: 'other', priority: 'medium', is_high_risk: false,
        created_at: cycle.createdAt, updated_at: [cycle.updatedAt, task.updatedAt].sort().at(-1)! });
    }
    for (const row of rows) {
      if (ids.has(row.id)) throw new CaldavError('DUPLICATE_SOURCE_ID'); ids.add(row.id);
      const isCycle = row.id.startsWith('caldav-cycle:') && row.calendar_id === '@cycles';
      if (row.id.startsWith('reminder-cycle:')) {
        if (config.scope !== 'all') { exclude('derived_cycle'); continue; }
        const mapping = cycleSources.get(row.id.slice('reminder-cycle:'.length));
        if (!mapping) throw new CaldavError('ORPHANED_CYCLE_COPY');
        mapping.derivedSourceIds.push(row.id); breakdown.merged_copy++; continue;
      }
      if (!isCycle && !selected.includes(row.calendar_id)) { exclude('outside_scope'); continue; }
      if (row.is_unscheduled) { exclude('unscheduled'); continue; }
      if (!config.includeCompleted && row.is_completed) { exclude('completed'); continue; }
      if (row.type !== 'event' && (row.type !== 'todo' || config.scope !== 'all')) { exclude('unsupported_type'); continue; }
      counts[isCycle ? 'cycle' : row.type === 'todo' ? 'todo' : 'event']++;
      breakdown[row.is_completed ? 'completed' : 'pending']++;
      try {
        const alarms = !row.is_completed && config.alarms && !row.all_day && row.reminders.length === 1 && /^\d{1,5}$/.test(row.reminders[0]) && +row.reminders[0] <= 10080;
        const title = `${row.is_completed ? '【已完成】' : ''}${row.type === 'todo' ? '待办：' : ''}${row.title}`;
        const description = [row.is_completed ? `状态：已完成${row.is_repeated ? '（系列级状态，不代表单次完成历史）' : ''}。` : '', row.description].filter(Boolean).join('\n');
        const projected = projectEvent({ ...row, title, description }, { ...config, alarms }); desired.set(projected.key, projected);
        if (!alarms && row.reminders.length && !row.is_completed) issues.push({ sourceId: row.id, code: 'ALARMS_DISABLED' });
      } catch (error) { held.add(row.id); issues.push({ sourceId: row.id, code: error instanceof CaldavError ? error.code : 'INVALID_SOURCE_EVENT' }); }
    }
    if (desired.size > 500 || Object.values(counts).reduce((sum, count) => sum + count, 0) > 500) throw new CaldavError('PILOT_LIMIT_EXCEEDED');
    const signature = digest(JSON.stringify({ desired: [...desired].sort(), issues, excluded, sourceMappings, breakdown, calendars: [...source.calendars].sort() }));
    return { desired, issues, excluded, signature, held, counts, exclusions, breakdown, sourceMappings };
  }
  async function prepare() {
    const source = snapshot(); const ledger = readLedger(); const operations: Operation[] = [];
    const migrationBackup: Record<string, { etag: string; ical: string }> = {};
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
      if (ledger.version === 1 && old) {
        if (!remote?.ical) throw new CaldavError('MIGRATION_RESOURCE_MISSING');
        migrationBackup[key] = { etag: remote.etag, ical: remote.ical };
      }
      const action: Action = old && source.held.has(old.sourceId) ? 'held' : desired
        ? !remote ? 'create' : remote.hash === desired.hash ? (old?.pending ? 'recover' : 'unchanged') : 'update'
        : 'delete';
      operations.push({ key, sourceId: desired?.sourceId || old.sourceId, action, etag: remote?.etag || null, remoteHash: remote?.hash, desired });
    }
    const planToken = digest(JSON.stringify([scopeVersion, source.signature, ledger, operations]));
    const deletions = operations.filter(op => op.action === 'delete').length; const owned = Object.keys(ledger.entries).length;
    const publicPlan: BridgePlan = { planToken, operations: operations.map(({ key, sourceId, action }) => ({ key, sourceId, action })), issues: source.issues, excluded: source.excluded,
      counts: source.counts, exclusions: source.exclusions, breakdown: source.breakdown, sourceMappings: source.sourceMappings, scopeVersion, migrationRequired: ledger.version === 1,
      requiresDeleteConfirmation: (deletions >= 10 && deletions >= owned * 0.2) || (owned >= 5 && deletions === owned),
      complete: !source.issues.some(issue => issue.code !== 'ALARMS_DISABLED') };
    return { source, ledger, operations, publicPlan, migrationBackup };
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
      if (ledger.version === 1) {
        const backup = path.join(path.dirname(stateFile), `migration-${Date.now()}.json`);
        fs.writeFileSync(backup, JSON.stringify({ ledger, resources: prepared.migrationBackup }), { flag: 'wx', mode: 0o600 });
        ledger.version = 2; ledger.binding = binding; save(ledger);
      }
      // Only start deletions after all upserts have succeeded. Never purge a collection.
      for (const op of [...operations.filter(op => op.action !== 'delete'), ...operations.filter(op => op.action === 'delete')]) {
        if (snapshot().signature !== source.signature) throw new CaldavError('SOURCE_CHANGED_RETRY_PREVIEW');
        if (op.action === 'unchanged' || op.action === 'held') continue;
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
  return { preview: () => run(), sync: (token: string) => run(token), scopeVersion, includeCompleted: config.includeCompleted, get busy() { return busy; } };
}
