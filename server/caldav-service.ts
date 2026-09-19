import path from 'node:path';
import { bridgeConfig, createCaldavBridge, type BridgePlan } from './caldav-bridge.js';
import { CaldavError } from './caldav-projection.js';
import { caldavRoot, readControl, writeControl, withBridgeWork, bridgeActive } from './caldav-control.js';
import { getAllSchedules, readOwnedCalendars } from './schedule-store.js';
import { readReminderProjectionSources } from './reminder-store.js';
import { getUserById } from './db.js';

export function createCaldavController(bridge: ReturnType<typeof createCaldavBridge>, root: string,
  canWrite: () => boolean, canAutomate: () => boolean, now: () => number = Date.now) {
  const save = (value: ReturnType<typeof readControl>) => writeControl(value, root);
  const state = () => readControl(root);
  async function sync(token: string) {
    if (!canWrite()) throw new CaldavError('BRIDGE_WRITES_DISABLED', 403);
    const result = await bridge.sync(token);
    const control = state();
    control.lastSuccess = new Date(now()).toISOString(); control.lastError = undefined; control.failures = 0; control.nextAttempt = undefined;
    if (result.complete) control.confirmedScope = bridge.scopeVersion;
    control.summary = { counts: result.counts, exclusions: result.exclusions, breakdown: result.breakdown, issues: result.issues, complete: result.complete };
    if (!result.complete) control.lastError = 'INCOMPLETE_PROJECTION';
    save(control); return result;
  }
  return {
    status: () => ({ ...state(), scopeVersion: bridge.scopeVersion, includeCompleted: bridge.includeCompleted, writeEnabled: canWrite(), automationAvailable: canAutomate(), busy: bridge.busy || bridgeActive() }),
    preview: () => bridge.preview(), sync,
    automation(enabled: boolean, scopeVersion?: string, phoneVerified?: boolean) {
      const control = state();
      if (enabled) {
        if (!canAutomate() || !canWrite()) throw new CaldavError('AUTOMATION_NOT_AVAILABLE', 403);
        if (scopeVersion !== bridge.scopeVersion || control.confirmedScope !== scopeVersion) throw new CaldavError('SCOPE_CONFIRMATION_REQUIRED');
        if (phoneVerified !== true && control.verifiedScope !== scopeVersion) throw new CaldavError('PHONE_VERIFICATION_REQUIRED');
        control.verifiedScope = scopeVersion;
      }
      control.enabled = enabled; control.nextAttempt = undefined; control.failures = 0; save(control);
      return this.status();
    },
    async tick() {
      const control = state();
      if (!control.enabled || !canAutomate() || !canWrite() || (control.nextAttempt || 0) > now()) return;
      if (control.confirmedScope !== bridge.scopeVersion || control.verifiedScope !== bridge.scopeVersion) {
        save({ ...control, enabled: false, lastError: 'SCOPE_CONFIRMATION_REQUIRED' }); return;
      }
      try {
        const plan: BridgePlan = await bridge.preview();
        if (plan.migrationRequired || plan.requiresDeleteConfirmation) throw new CaldavError('MANUAL_CONFIRMATION_REQUIRED');
        await sync(plan.planToken);
      } catch (error) {
        const code = error instanceof CaldavError ? error.code : 'CALDAV_BRIDGE_FAILED';
        if (code === 'BRIDGE_BUSY') return;
        control.lastError = code; control.failures++;
        if (['CALDAV_NETWORK_ERROR', 'CALDAV_READ_FAILED', 'CALDAV_BODY_FAILED', 'CALDAV_WRITE_FAILED', 'CALDAV_DELETE_FAILED', 'SOURCE_CHANGED_RETRY_PREVIEW', 'PREVIEW_CHANGED_OR_BLOCKED'].includes(code)) {
          control.nextAttempt = now() + [5, 10, 20, 30][Math.min(control.failures - 1, 3)] * 60_000;
        } else { control.enabled = false; control.nextAttempt = undefined; }
        save(control);
      }
    },
  };
}

let singleton: ReturnType<typeof createCaldavController> | undefined;
let config: ReturnType<typeof bridgeConfig> | undefined;
export function getCaldavService() {
  config ??= bridgeConfig();
  if (!config) throw new CaldavError('CALDAV_BRIDGE_DISABLED', 404);
  const bound = config;
  singleton ??= createCaldavController(createCaldavBridge(bound, path.join(caldavRoot(), 'state.json'), () => {
    const owner = getUserById(bound.userId);
    if (!owner || owner.disabled) throw new CaldavError('SOURCE_ACCOUNT_UNAVAILABLE');
    return { complete: true, calendars: readOwnedCalendars(bound.userId).map(c => c.id), schedules: getAllSchedules(bound.userId),
      cycles: bound.scope === 'all' ? readReminderProjectionSources(bound.userId) : undefined };
  }), caldavRoot(), () => bound.writeEnabled, () => process.env.CALDAV_BRIDGE_AUTOMATION_ALLOWED === 'true' && process.env.BACKGROUND_JOBS_ENABLED === 'true');
  return { service: singleton, config: bound };
}
export async function runCaldavTick() {
  if (process.env.CALDAV_BRIDGE_ENABLED !== 'true' || process.env.MAINTENANCE_MODE === 'true' || bridgeActive()) return;
  try { await withBridgeWork(() => getCaldavService().service.tick()); }
  catch (error) { if (error instanceof CaldavError && ['BRIDGE_BUSY', 'BRIDGE_MAINTENANCE_MODE'].includes(error.code)) return; throw new CaldavError('CALDAV_AUTOMATION_FAILED'); }
}
