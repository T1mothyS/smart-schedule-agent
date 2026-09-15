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


const transactions = await import('./persistence.js');
const completionService = await import('./schedule-completion-service.js');
const makeSchedule = (id: string) => schedule.createSchedule({ id, user_id: 'u', title: id, calendar_id: 'personal', type: 'todo', start_time: '2026-09-15T09:00:00', all_day: false, category: 'other', priority: 'medium', is_completed: false, is_repeated: false, reminders: [], is_high_risk: false });

test('completion second-file failure rolls back both databases and retry creates one proof', t => {
  makeSchedule('completion-failure');
  let failed = false;
  const rename = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (!failed && String(to) === path.join(root, 'activity.db')) { failed = true; throw new Error('second database failure'); }
    return rename(from, to);
  });
  assert.throws(() => completionService.toggleScheduleCompletion('completion-failure', 'u'), /second database/);
  mock.mock.restore();
  assert.equal(schedule.getSchedule('completion-failure')?.is_completed, false);
  assert.equal(activity.listCompletions('u', { sourceId: 'completion-failure' }).length, 0);
  assert.equal(fs.existsSync(path.join(root, '.persistence-undo.json')), false);
  assert.equal(completionService.toggleScheduleCompletion('completion-failure', 'foreign'), null);
  assert.equal(completionService.toggleScheduleCompletion('completion-failure', 'u')?.is_completed, true);
  assert.equal(activity.listCompletions('u', { sourceId: 'completion-failure' }).length, 1);
});

test('nested operation failure restores its savepoint without discarding earlier operation', () => {
  transactions.withPersistenceTransaction(() => {
    makeSchedule('kept-operation');
    assert.throws(() => transactions.withPersistenceTransaction(() => { makeSchedule('discarded-operation'); throw new Error('invalid operation'); }));
  });
  assert.ok(schedule.getSchedule('kept-operation'));
  assert.equal(schedule.getSchedule('discarded-operation'), null);
});

test('startup undo record restores all affected disk files before opening stores', async () => {
  const beforeSchedule = schedule.exportScheduleDb();
  const beforeActivity = activity.exportActivityDb();
  fs.writeFileSync(path.join(root, '.persistence-undo.json'), JSON.stringify({ 'schedule.db': beforeSchedule.toString('base64'), 'activity.db': beforeActivity.toString('base64') }));
  fs.writeFileSync(path.join(root, 'schedule.db'), Buffer.from('simulated interrupted replace'));
  transactions.recoverPersistence(root);
  await schedule.initScheduleDb(); await activity.initActivityDb();
  assert.ok(schedule.getSchedule('kept-operation'));
  assert.equal(activity.listCompletions('u', { sourceId: 'completion-failure' }).length, 1);
});

const operations = await import('./operation-service.js');
test('execution receipt failure rolls back business changes; retry and reload replay the same result', async t => {
  let once = false;
  const rename = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (!once && String(to) === path.join(root, 'chat.db')) { once = true; throw new Error('receipt failure'); }
    return rename(from, to);
  });
  assert.throws(() => operations.executeOnce('u', 'ai-plan', 'plan-1', () => { makeSchedule('receipt-schedule'); return { id: 'receipt-schedule' }; }), /receipt failure/);
  mock.mock.restore();
  assert.equal(schedule.getSchedule('receipt-schedule'), null);
  assert.equal(db.getOperationResult('u', 'ai-plan', 'plan-1'), undefined);
  const result = operations.executeOnce('u', 'ai-plan', 'plan-1', () => { makeSchedule('receipt-schedule'); return { id: 'receipt-schedule' }; });
  await db.initDb(); await schedule.initScheduleDb();
  assert.deepEqual(operations.executeOnce('u', 'ai-plan', 'plan-1', () => { throw new Error('must not execute twice'); }), result);
  assert.equal(db.getOperationResult('foreign', 'ai-plan', 'plan-1'), undefined);
});

const backups = await import('./backup-service.js');
const attachments = await import('./attachment-service.js');
test('user restore rolls back four stores on a later write failure and preserves old attachment files', t => {
  db.createUser({ id: 'restore-user', email: 'restore@example.invalid', password_hash: 'synthetic', role: 'user', disabled: 0, created_at: '2026-09-15', updated_at: '2026-09-15' });
  const proof = activity.createCompletion({ userId: 'restore-user', sourceType: 'schedule', sourceId: 'old' });
  const file = attachments.saveBase64Attachment({ userId: 'restore-user', completionId: proof.id, originalName: 'proof.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.4 synthetic proof').toString('base64') });
  const encrypted = backups.createUserBackup('restore-user', 'synthetic-password');
  const before = [db.exportChatDb(), schedule.exportScheduleDb(), reminder.exportReminderDb(), activity.exportActivityDb()];
  let failed = false; const rename = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => { if (!failed && String(to) === path.join(root, 'activity.db')) { failed = true; throw new Error('restore second file failure'); } return rename(from, to); });
  assert.throws(() => backups.restoreUserBackup('restore-user', encrypted, 'synthetic-password', 'replace'), /restore second file/);
  mock.mock.restore();
  assert.deepEqual([db.exportChatDb(), schedule.exportScheduleDb(), reminder.exportReminderDb(), activity.exportActivityDb()], before);
  assert.equal(fs.existsSync(path.join(root, file.storagePath)), true);
  const restored = backups.restoreUserBackup('restore-user', encrypted, 'synthetic-password', 'replace');
  assert.equal(restored.partial, false);
  assert.equal(attachments.readAttachment(activity.listAttachments('restore-user')[0]).toString(), '%PDF-1.4 synthetic proof');
});

test('legacy user backup reports damaged attachments and missing hosted media as partial with details', () => {
  const encrypted = backups.createUserBackup('restore-user', 'synthetic-password');
  const payload = backups.decryptBackup<any>(encrypted, 'synthetic-password');
  delete payload.noteItems; delete payload.libraryEntries; delete payload.dailyReportCloudContext;
  payload.files.push({ completionId: null, importId: null, originalName: 'broken.pdf', mimeType: 'application/pdf', base64: Buffer.from('invalid pdf').toString('base64') });
  payload.activity.dailyReports = [{ id: 'missing-media', report_date: '2026-09-15', source: 'local', markdown: '![](/daily-report-media/' + 'a'.repeat(64) + '.png)', content_hash: 'synthetic', published_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
  const result = backups.restoreUserBackup('restore-user', backups.encryptBackup(payload, 'synthetic-password'), 'synthetic-password', 'merge') as any;
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.attachmentFailures[0].originalName, 'broken.pdf');
  assert.equal(result.missingMedia.length, 1);
});

test('failed compensation retains recovery record and blocks queries until recovery', t => {
  makeSchedule('blocked-failure');
  const rename = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to) === path.join(root, 'activity.db')) throw new Error('persistent disk failure');
    return rename(from, to);
  });
  assert.throws(() => completionService.toggleScheduleCompletion('blocked-failure', 'u'), /回滚未完成/);
  assert.throws(() => schedule.getSchedule('blocked-failure'), /已停止数据库访问/);
  assert.equal(fs.existsSync(path.join(root, '.persistence-undo.json')), true);
  mock.mock.restore();
  transactions.recoverPersistence(root);
  assert.equal(schedule.getSchedule('blocked-failure')?.is_completed, false);
});
