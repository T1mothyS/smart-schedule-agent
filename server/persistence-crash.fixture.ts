// Executed only by persistence-crash.test.ts in a marked temporary directory.
import fs from 'node:fs';
import path from 'node:path';
const root = process.env.DATA_DIR;
if (!root || !fs.existsSync(path.join(root, '.synthetic-crash-test'))) throw new Error('Synthetic fixture directory required');
const db = await import('./db.js');
const schedule = await import('./schedule-store.js');
const reminder = await import('./reminder-store.js');
const activity = await import('./activity-store.js');
const persistence = await import('./persistence.js');
await db.initDb(); await schedule.initScheduleDb(); await reminder.initReminderDb(); await activity.initActivityDb();
const names = ['chat.db', 'schedule.db', 'reminder.db', 'activity.db'];
const make = (id: string) => schedule.createSchedule({ id, user_id: 'synthetic', title: id, calendar_id: 'personal', type: 'todo', start_time: '2026-09-15T09:00:00', all_day: false, category: 'other', priority: 'medium', is_completed: false, is_repeated: false, reminders: [], is_high_risk: false });
const rename = fs.renameSync;
if (process.argv[2] === 'transaction') {
  fs.writeFileSync(path.join(root, 'expected.json'), JSON.stringify(Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(root, name)).toString('base64')]))));
  fs.renameSync = ((from, to) => { rename(from, to); if (String(to) === path.join(root, 'schedule.db')) process.exit(86); }) as typeof fs.renameSync;
  persistence.withPersistenceTransaction(() => { make('interrupted'); activity.createCompletion({ userId: 'synthetic', sourceType: 'schedule', sourceId: 'interrupted' }); });
} else {
  process.env.BACKUP_ENCRYPTION_KEY = 'synthetic-crash-password';
  process.env.MAINTENANCE_MODE = 'true';
  const backups = await import('./backup-service.js');
  const attachments = path.join(root, 'attachments'); fs.mkdirSync(attachments, { recursive: true });
  fs.writeFileSync(path.join(attachments, 'proof.txt'), 'snapshot');
  const bridgeRoot = path.join(root, 'caldav-bridge');
  if (process.argv[2] === 'caldav-restore') {
    fs.mkdirSync(bridgeRoot); fs.writeFileSync(path.join(bridgeRoot, 'state.json'), JSON.stringify({ version: 2, binding: 'snapshot', entries: {} }));
  }
  const snapshot = backups.createSystemSnapshot(false);
  const encrypted = fs.readFileSync(snapshot.path);
  // system-restore exercises old snapshots with no bridge field; they preserve existing ownership.
  fs.mkdirSync(bridgeRoot, { recursive: true });
  fs.writeFileSync(path.join(bridgeRoot, 'state.json'), JSON.stringify({ version: 2, binding: 'preserve-current', entries: {} }));
  fs.writeFileSync(path.join(bridgeRoot, 'control.json'), JSON.stringify({ version: 1, enabled: true, failures: 0 }));
  make('preserve-before-restore');
  fs.writeFileSync(path.join(attachments, 'proof.txt'), 'preserve current file');
  fs.writeFileSync(path.join(root, 'expected.json'), JSON.stringify(Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(root, name)).toString('base64')]))));
  fs.renameSync = ((from, to) => { rename(from, to); if (String(from).includes('.restore-') && String(to) === path.join(root, process.argv[2] === 'caldav-restore' ? 'caldav-bridge' : 'schedule.db')) process.exit(86); }) as typeof fs.renameSync;
  backups.restoreSystemSnapshot(encrypted, 'RESTORE AI CALENDAR');
}
throw new Error('Crash point was not reached');
