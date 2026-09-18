import fs from 'node:fs';
import path from 'node:path';

export const SYSTEM_RESTORE_JOURNAL = '.system-restore.json';
export interface RestoreEntry { target: string; previous: string; existed: boolean }

/** Repeatable undo: copy old files, never consume the only recovery copy. */
export function recoverSystemRestore(directory: string): void {
  const marker = path.join(directory, SYSTEM_RESTORE_JOURNAL);
  if (!fs.existsSync(marker)) return;
  const entries = JSON.parse(fs.readFileSync(marker, 'utf8')) as RestoreEntry[];
  const allowed = new Set(['chat.db', 'schedule.db', 'reminder.db', 'activity.db', 'attachments', 'daily-report-media', 'caldav-bridge']);
  if (!Array.isArray(entries) || !entries.length) throw new Error('全站恢复记录不正确');
  for (const entry of entries) {
    if (!allowed.has(entry.target) || !entry.previous.startsWith(`.${entry.target}.pre-restore-`)
      || path.basename(entry.previous) !== entry.previous || typeof entry.existed !== 'boolean') throw new Error('全站恢复记录包含非法路径');
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.target);
    const previous = path.join(directory, entry.previous);
    if (entry.existed && !fs.existsSync(previous) && !fs.existsSync(target)) {
      throw new Error(`恢复所需的 ${entry.target} 与恢复副本均缺失，拒绝创建空数据库。`);
    }
    if (fs.existsSync(previous)) {
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(previous, target, { recursive: true });
    } else if (!entry.existed) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  fs.unlinkSync(marker);
  // Old recovery copies may remain after a crash; preserve them for inspection.
}
