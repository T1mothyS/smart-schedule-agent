import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { recoverPersistence } from './persistence.js';
for (const mode of ['transaction', 'system-restore']) {
  test('process interruption recovers ' + mode + ' before database initialization', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-crash-'));
    fs.writeFileSync(path.join(root, '.synthetic-crash-test'), 'synthetic');
    const child = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./persistence-crash.fixture.ts', import.meta.url)), mode], { env: { ...process.env, DATA_DIR: root }, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 86, child.stderr + child.stdout);
    const before = JSON.parse(fs.readFileSync(path.join(root, 'expected.json'), 'utf8'));
    recoverPersistence(root);
    recoverPersistence(root); // Repeated startup recovery is harmless.
    for (const [name, base64] of Object.entries(before)) assert.equal(fs.readFileSync(path.join(root, name)).toString('base64'), base64, name);
    if (mode === 'system-restore') assert.equal(fs.readFileSync(path.join(root, 'attachments/proof.txt'), 'utf8'), 'preserve current file');
    assert.equal(fs.existsSync(path.join(root, '.persistence-undo.json')), false);
    assert.equal(fs.existsSync(path.join(root, '.system-restore.json')), false);
    fs.rmSync(root, { recursive: true, force: true });
  });
}
