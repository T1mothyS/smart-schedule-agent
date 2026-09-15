import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-persistence-'));
process.env.DATA_DIR = root;
const db = await import('./db.js');
const schedule = await import('./schedule-store.js');
const reminder = await import('./reminder-store.js');
const activity = await import('./activity-store.js');
const { atomicWriteFile } = await import('./persistence.js');
await db.initDb(); await schedule.initScheduleDb(); await reminder.initReminderDb(); await activity.initActivityDb();

test('atomic replacement preserves previous file on flush and rename failure', t => {
  const file = path.join(root, 'atomic-test');
  atomicWriteFile(file, Buffer.from('before'));
  for (const method of ['fsyncSync', 'renameSync'] as const) {
    const mock = t.mock.method(fs, method, () => { throw new Error('injected disk failure'); });
    assert.throws(() => atomicWriteFile(file, Buffer.from('after')), /injected/);
    mock.mock.restore();
    assert.equal(fs.readFileSync(file, 'utf8'), 'before');
    assert.equal(fs.readdirSync(root).some(name => name.startsWith('atomic-test.pending-')), false);
  }
});

test('all four stores restore memory after a failed replacement; failed mutation is not flushed later', t => {
  const cases = [
    { name: 'chat.db', bytes: db.exportChatDb, mutate: () => db.createUser({ id: 'failed', email: 'failed@example.invalid', password_hash: 'synthetic', role: 'user', disabled: 0, created_at: '2026-09-15', updated_at: '2026-09-15' }) },
    { name: 'schedule.db', bytes: schedule.exportScheduleDb, mutate: () => schedule.createSchedule({ id: 'failed', user_id: 'u', title: 'failed', calendar_id: 'personal', type: 'todo', start_time: '2026-09-15T09:00:00', all_day: false, category: 'other', priority: 'medium', is_completed: false, is_repeated: false, reminders: [], is_high_risk: false }) },
    { name: 'reminder.db', bytes: reminder.exportReminderDb, mutate: () => reminder.createReminderTask({ userId: 'u', type: 'generic', name: 'failed', config: { templateKey: 'custom', rule: { frequency: 'once', anchorDate: '2026-09-15', advancePolicy: 'calendar' }, reminderOffsets: [0], reminderTime: '09:00', actionGuide: '', priority: 'medium' } }) },
    { name: 'activity.db', bytes: activity.exportActivityDb, mutate: () => activity.createCompletion({ userId: 'u', sourceType: 'schedule', sourceId: 'failed' }) },
  ];
  for (const item of cases) {
    const before = item.bytes();
    const disk = fs.readFileSync(path.join(root, item.name));
    const rename = fs.renameSync;
    const mock = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => { if (String(to) === path.join(root, item.name)) throw new Error('injected disk failure'); return rename(from, to); });
    assert.throws(item.mutate, /injected/);
    mock.mock.restore();
    assert.deepEqual(item.bytes(), before, item.name + ' memory');
    assert.deepEqual(fs.readFileSync(path.join(root, item.name)), disk, item.name + ' disk');
  }
});

