import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireBridgeLock, bridgeLockStatus } from './caldav-lock.js';

const fixture = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-lock-')), 'state.lock');
test('live owners block writes; stale owner is quarantined and obsolete release cannot remove replacement', async () => {
  const file = fixture(); const releaseOld = acquireBridgeLock(file);
  assert.equal(bridgeLockStatus(file), 'active');
  assert.throws(() => acquireBridgeLock(file), /BRIDGE_LOCKED/);
  const releaseNew = acquireBridgeLock(file, () => false);
  await releaseOld(); assert.equal(bridgeLockStatus(file), 'active');
  assert.equal(fs.readdirSync(path.dirname(file)).filter(s => s.includes('quarantine')).length, 1);
  await releaseNew(); assert.equal(bridgeLockStatus(file), 'free');
});
test('empty, foreign, unknown process and abandoned guard fail closed', async () => {
  const file = fixture();
  for (const raw of ['', 'bad', JSON.stringify({ version: 1, host: 'foreign', pid: 2 })]) {
    fs.writeFileSync(file, raw); assert.throws(() => acquireBridgeLock(file), /BRIDGE_LOCKED/); assert.equal(fs.readFileSync(file, 'utf8'), raw);
  }
  fs.unlinkSync(file); const release = acquireBridgeLock(file);
  assert.throws(() => acquireBridgeLock(file, () => undefined), /BRIDGE_LOCKED/);
  fs.writeFileSync(file + '.guard', ''); assert.equal(bridgeLockStatus(file), 'maintenance');
  assert.throws(() => acquireBridgeLock(file, () => false), /BRIDGE_LOCKED/);
  await assert.rejects(release(), /BRIDGE_LOCKED/); fs.unlinkSync(file + '.guard'); await release();
});
test('filesystem failures are distinguished from contention', () => {
  const file = fixture(); fs.mkdirSync(file);
  assert.throws(() => acquireBridgeLock(file), /BRIDGE_LOCK_IO_ERROR/);
  assert.equal(bridgeLockStatus(file), 'io-error');
});

test('release waits for a short competing guard instead of abandoning a live-owned lock', async () => {
  const file = fixture(); const release = acquireBridgeLock(file);
  fs.writeFileSync(file + '.guard', '');
  setTimeout(() => fs.unlinkSync(file + '.guard'), 50);
  await release(); assert.equal(bridgeLockStatus(file), 'free');
});
