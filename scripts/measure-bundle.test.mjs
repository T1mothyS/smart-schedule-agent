import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { measureBundle } from './measure-bundle.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-bundle-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.vite'));
  for (const file of ['entry.js', 'shared.js', 'lazy.js', 'global.css', 'lazy.css']) {
    fs.writeFileSync(path.join(root, file), `synthetic ${file}\n`);
  }
  const manifest = {
    'index.html': { file: 'entry.js', isEntry: true, imports: ['shared'], dynamicImports: ['lazy'], css: ['global.css'] },
    shared: { file: 'shared.js', imports: ['index.html'] },
    lazy: { file: 'lazy.js', imports: ['shared'], css: ['lazy.css'] },
  };
  const write = () => fs.writeFileSync(path.join(root, '.vite/manifest.json'), JSON.stringify(manifest));
  write();
  return { root, manifest, write };
}

test('static closure handles cycles and shared imports without counting lazy JS/CSS as initial', t => {
  const { root } = fixture(t);
  const result = measureBundle(root);
  assert.equal(result.totals.initialJs.count, 2);
  assert.equal(result.totals.nonInitialJs.count, 1);
  assert.equal(result.totals.initialCss.count, 1);
  assert.equal(result.totals.allCss.count, 2);
  assert.equal(result.files.length, 5);
  assert.equal(result.files.find(item => item.file === 'entry.js').gzipBytes, gzipSync(fs.readFileSync(path.join(root, 'entry.js'))).length);
  assert.deepEqual(measureBundle(root), result);
});

test('multiple HTML entries use the union, not duplicate shared resources', t => {
  const { root, manifest, write } = fixture(t);
  manifest.lazy.isEntry = true;
  write();
  const result = measureBundle(root);
  assert.equal(result.totals.initialJs.count, 3);
  assert.equal(result.totals.initialCss.count, 2);
});

test('missing chunks or files fail instead of reporting a misleading baseline', t => {
  const { root, manifest, write } = fixture(t);
  delete manifest.lazy;
  write();
  assert.throws(() => measureBundle(root), /Missing manifest chunk/);
  manifest['index.html'].dynamicImports = [];
  write();
  fs.unlinkSync(path.join(root, 'shared.js'));
  assert.throws(() => measureBundle(root), /ENOENT/);
});

test('manifest references cannot escape the build directory', t => {
  const { root, manifest, write } = fixture(t);
  manifest.shared.file = '../outside.js';
  write();
  assert.throws(() => measureBundle(root), /escapes build directory/);
});
