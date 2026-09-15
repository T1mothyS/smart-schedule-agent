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
let pending: Set<string> | null = null;
let blocked = false;
const JOURNAL = '.persistence-undo.json';
const DATABASES = new Set(['chat.db', 'schedule.db', 'reminder.db', 'activity.db']);

export function assertPersistenceReady(): void {
  if (blocked) throw new Error('持久化恢复未完成，已停止数据库访问；请检查磁盘并重启服务。');
}

/** Called before opening any database. An interrupted transaction has not acknowledged success. */
export function recoverPersistence(directory: string): void {
  const journal = path.join(directory, JOURNAL);
  if (!fs.existsSync(journal)) return;
  blocked = true;
  const entries = JSON.parse(fs.readFileSync(journal, 'utf8')) as Record<string, string>;
  if (!entries || Array.isArray(entries) || Object.keys(entries).some(name => !DATABASES.has(name))) {
    throw new Error('持久化恢复记录不正确，拒绝启动');
  }
  for (const [name, base64] of Object.entries(entries)) {
    if (typeof base64 !== 'string') throw new Error('持久化恢复数据不正确');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.subarray(0, 16).toString('binary') !== 'SQLite format 3\0') throw new Error('持久化恢复数据库不正确');
    atomicWriteFile(path.join(directory, name), bytes);
  }
  fs.unlinkSync(journal);
  blocked = false;
}

/** Synchronous only: no network/await inside the callback. Nested calls act as savepoints. */
export function withPersistenceTransaction<T>(callback: () => T): T {
  assertPersistenceReady();
  const before = new Map([...stores].map(([file, store]) => [file, store.snapshot().slice()]));
  const parent = pending;
  const changed = new Set<string>();
  pending = changed;
  let journal: string | undefined;
  try {
    const result = callback();
    if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('持久化事务不允许异步回调');
    if (parent) {
      changed.forEach(file => parent.add(file));
      return result;
    }
    if (!changed.size) return result;
    const files = [...changed];
    const directory = path.dirname(files[0]);
    if (files.some(file => path.dirname(file) !== directory || !DATABASES.has(path.basename(file)))) throw new Error('跨库目录不一致');
    const undo = Object.fromEntries(files.map(file => [path.basename(file), Buffer.from(before.get(file)!).toString('base64')]));
    journal = path.join(directory, JOURNAL);
    atomicWriteFile(journal, Buffer.from(JSON.stringify(undo)));
    for (const file of files) atomicWriteFile(file, stores.get(file)!.snapshot());
    // This removal is the commit point. A crash before it rolls all stores back on startup.
    fs.unlinkSync(journal);
    journal = undefined;
    for (const file of files) stores.get(file)!.committed = stores.get(file)!.snapshot().slice();
    return result;
  } catch (error) {
    for (const [file, bytes] of before) stores.get(file)!.restore(bytes);
    if (journal && fs.existsSync(journal)) {
      try { recoverPersistence(path.dirname(journal)); }
      catch { blocked = true; throw new Error('跨库保存失败且回滚未完成；恢复记录已保留，请检查磁盘并重启服务。', { cause: error }); }
    }
    throw error;
  } finally {
    pending = parent;
  }
}

export function registerPersistence(target: string, snapshot: Store['snapshot'], restore: Store['restore']): void {
  stores.set(target, { snapshot, restore, committed: snapshot().slice() });
}

export function persistDatabase(target: string): void {
  assertPersistenceReady();
  const store = stores.get(target);
  if (!store) throw new Error('数据库尚未注册');
  if (pending) { pending.add(target); return; }
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
