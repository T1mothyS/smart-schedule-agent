import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFile } from './persistence.js';
import { CaldavError } from './caldav-projection.js';

export const caldavRoot = () => path.join(process.env.DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data'), 'caldav-bridge');
export interface CaldavControl {
  version: 1; enabled: boolean; confirmedScope?: string; verifiedScope?: string;
  lastSuccess?: string; lastError?: string; failures: number; nextAttempt?: number;
  summary?: { counts?: Record<string, number>; exclusions?: Record<string, number>; breakdown?: Record<string, number>; issues: Array<{ sourceId: string; code: string }>; complete?: boolean };
}
export function readControl(root = caldavRoot()): CaldavControl {
  const file = path.join(root, 'control.json');
  if (!fs.existsSync(file)) return { version: 1, enabled: false, failures: 0 };
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.version !== 1 || typeof value.enabled !== 'boolean' || !Number.isInteger(value.failures) || value.failures < 0
      || ['confirmedScope', 'verifiedScope'].some(key => value[key] !== undefined && !/^[a-f0-9]{64}$/.test(value[key]))
      || (value.nextAttempt !== undefined && !Number.isFinite(value.nextAttempt))) throw new Error();
    return value;
  } catch { throw new CaldavError('BRIDGE_CONTROL_INVALID'); }
}
export function writeControl(control: CaldavControl, root = caldavRoot()) {
  fs.mkdirSync(root, { recursive: true });
  atomicWriteFile(path.join(root, 'control.json'), Buffer.from(JSON.stringify(control)));
}

// Shared process guard for HTTP, background work and restore. No store imports.
let active: Promise<unknown> | undefined;
let restoring = false;
export function bridgeActive() { return !!active; }
export async function withBridgeWork<T>(run: () => Promise<T>): Promise<T> {
  if (restoring || process.env.MAINTENANCE_MODE === 'true') throw new CaldavError('BRIDGE_MAINTENANCE_MODE', 503);
  if (active) throw new CaldavError('BRIDGE_BUSY');
  const work = Promise.resolve().then(run); active = work;
  try { return await work; } finally { active = undefined; }
}
export function pauseForRestoreSync(userId?: string) {
  if (userId && userId !== process.env.CALDAV_BRIDGE_USER_ID) return;
  if (active || fs.existsSync(path.join(caldavRoot(), 'state.json.lock'))) throw new CaldavError('BRIDGE_BUSY');
  if (fs.existsSync(caldavRoot())) {
    // Recovery must be possible even when the old control file is corrupt.
    writeControl({ version: 1, enabled: false, failures: 0, lastError: 'RESTORE_REVIEW_REQUIRED' });
  }
}
export async function withBridgeRestore<T>(run: () => T | Promise<T>, userId?: string): Promise<T> {
  if (userId && userId !== process.env.CALDAV_BRIDGE_USER_ID) return run();
  return withBridgeSnapshot(() => { pauseForRestoreSync(userId); return run(); });
}
// Backups wait for in-flight writes without revoking the automation setting.
export async function withBridgeSnapshot<T>(run: () => T | Promise<T>): Promise<T> {
  if (restoring) throw new CaldavError('BRIDGE_BUSY');
  restoring = true;
  try { await active?.catch(() => undefined); return await run(); }
  finally { restoring = false; }
}
export function captureBridgeState(): Record<string, string> | undefined {
  if (active || fs.existsSync(path.join(caldavRoot(), 'state.json.lock'))) throw new CaldavError('BRIDGE_BUSY');
  if (!fs.existsSync(caldavRoot())) return undefined;
  const result: Record<string, string> = {};
  for (const name of ['state.json', 'control.json']) {
    const file = path.join(caldavRoot(), name);
    if (fs.existsSync(file)) result[name] = fs.readFileSync(file, 'utf8');
  }
  return result;
}
