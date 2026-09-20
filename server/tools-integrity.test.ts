import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkProtectedTools } from '../scripts/check-protected-tools.js';
test('all enabled source Tools ship unchanged; missing or mismatched package fails', () => {
  const root = path.resolve('protected-tools');
  const result = checkProtectedTools(root);
  assert(result.some(t => t.slug === 'codex-usage-dashboard-v3-1'));
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-package-'));
  fs.copyFileSync(path.join(root, 'manifest.json'), path.join(stage, 'manifest.json'));
  for (const tool of result) {
    fs.mkdirSync(path.join(stage, tool.slug));
    fs.copyFileSync(path.join(root, tool.slug, 'index.html'), path.join(stage, tool.slug, 'index.html'));
  }
  assert.deepEqual(checkProtectedTools(root, stage), result);
  const target = path.join(stage, result[0].slug, 'index.html');
  fs.writeFileSync(target, 'different'); assert.throws(() => checkProtectedTools(root, stage), /不一致/);
  fs.unlinkSync(target); assert.throws(() => checkProtectedTools(root, stage));
});
