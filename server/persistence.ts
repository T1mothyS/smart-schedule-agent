import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Same-directory replacement: the live file is never opened for truncation. */
export function atomicWriteFile(target: string, bytes: Uint8Array): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.pending-${crypto.randomUUID()}`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, target);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

interface Store {
  snapshot: () => Uint8Array;
  restore: (bytes: Uint8Array) => void;
  committed: Uint8Array;
}
const stores = new Map<string, Store>();

export function registerPersistence(target: string, snapshot: Store['snapshot'], restore: Store['restore']): void {
  stores.set(target, { snapshot, restore, committed: snapshot().slice() });
}

export function persistDatabase(target: string): void {
  const store = stores.get(target);
  if (!store) throw new Error('数据库尚未注册');
  try {
    const bytes = store.snapshot();
    atomicWriteFile(target, bytes);
    store.committed = bytes;
  } catch (error) {
    // SQL was already changed in memory. Do not expose or later flush that failed write.
    store.restore(store.committed);
    throw error;
  }
}
