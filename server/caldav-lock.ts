import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { CaldavError } from './caldav-projection.js';

interface Owner { version: 1; host: string; pid: number; createdAt: string; owner: string }
export type LockStatus = 'free' | 'active' | 'stale' | 'unknown' | 'maintenance' | 'io-error';
type Probe = (pid: number) => boolean | undefined;
const probe: Probe = pid => {
  try { process.kill(pid, 0); return true; }
  catch (e: any) { return e.code === 'ESRCH' ? false : undefined; }
};
function read(file: string): string | undefined {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (e: any) { if (e.code === 'ENOENT') return undefined; throw e; }
}
function classify(raw: string | undefined, alive: Probe): LockStatus {
  if (raw === undefined) return 'free';
  try {
    const v = JSON.parse(raw) as Owner;
    if (v.version !== 1 || v.host !== os.hostname() || !Number.isInteger(v.pid) || v.pid <= 0
      || typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt))
      || typeof v.owner !== 'string' || !/^[a-f0-9-]{36}$/.test(v.owner)) return 'unknown';
    const exists = alive(v.pid);
    return exists === false ? 'stale' : exists === true ? 'active' : 'unknown';
  } catch { return 'unknown'; }
}
export function bridgeLockStatus(file: string, alive: Probe = probe): LockStatus {
  try {
    if (fs.existsSync(file + '.guard')) return 'maintenance';
    return classify(read(file), alive);
  } catch { return 'io-error'; }
}
// All writers use this short, synchronous guard. An abandoned guard is never stolen.
function guarded<T>(file: string, run: () => T): T {
  let fd: number;
  try { fd = fs.openSync(file + '.guard', 'wx', 0o600); }
  catch (e: any) { throw new CaldavError(e.code === 'EEXIST' ? 'BRIDGE_LOCKED' : 'BRIDGE_LOCK_IO_ERROR'); }
  try { return run(); }
  catch (e) { if (e instanceof CaldavError) throw e; throw new CaldavError('BRIDGE_LOCK_IO_ERROR'); }
  finally {
    try { fs.closeSync(fd); fs.unlinkSync(file + '.guard'); }
    catch { throw new CaldavError('BRIDGE_LOCK_IO_ERROR'); }
  }
}
export function acquireBridgeLock(file: string, alive: Probe = probe): () => Promise<void> {
  const metadata: Owner = { version: 1, host: os.hostname(), pid: process.pid, createdAt: new Date().toISOString(), owner: randomUUID() };
  const serialized = JSON.stringify(metadata);
  guarded(file, () => {
    const raw = read(file);
    const status = classify(raw, alive);
    if (status !== 'free' && status !== 'stale') throw new CaldavError('BRIDGE_LOCKED');
    if (status === 'stale') {
      if (read(file) !== raw) throw new CaldavError('BRIDGE_LOCKED');
      fs.renameSync(file, `${file}.quarantine-${Date.now()}-${randomUUID()}`);
    }
    fs.writeFileSync(file, serialized, { flag: 'wx', mode: 0o600 });
  });
  return async () => {
    // A competing process can briefly inspect this lock while its owner finishes.
    // Retry release rather than leaving a lock owned by this still-live process.
    for (let attempt = 0; ; attempt++) {
      try { return guarded(file, () => { if (read(file) === serialized) fs.unlinkSync(file); }); }
      catch (e) {
        if (!(e instanceof CaldavError) || e.code !== 'BRIDGE_LOCKED' || attempt >= 20) throw e;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  };
}
