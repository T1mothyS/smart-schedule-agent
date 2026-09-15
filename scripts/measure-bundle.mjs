import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, constants as zlibConstants } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Observe an existing Vite production build. No build, env loading, or network I/O.
export function measureBundle(directory) {
  const root = fs.realpathSync(directory);
  function localFile(relative) {
    if (typeof relative !== 'string' || !relative || relative.includes('\\')) {
      throw new Error('Invalid manifest asset path');
    }
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) throw new Error('Manifest path escapes build directory');
    let cursor = root;
    for (const part of path.relative(root, target).split(path.sep)) {
      cursor = path.join(cursor, part);
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Build symlinks are not supported');
    }
    if (!fs.statSync(target).isFile()) throw new Error('Manifest asset is not a file');
    return target;
  }
  const manifest = JSON.parse(fs.readFileSync(localFile('.vite/manifest.json'), 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid Vite manifest');
  const entries = Object.keys(manifest).filter(key => manifest[key]?.isEntry === true).sort();
  if (!entries.length) throw new Error('Manifest has no entry; rebuild with --manifest');
  const initial = new Set();
  const visited = new Set();
  function references(chunk, field) {
    const values = chunk[field] ?? [];
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) {
      throw new Error(`Invalid manifest ${field}`);
    }
    return values;
  }
  // Validate all references, including optional routes, to reject stale builds.
  for (const chunk of Object.values(manifest)) {
    if (!chunk || typeof chunk !== 'object') throw new Error('Invalid manifest chunk');
    localFile(chunk.file);
    for (const file of [...references(chunk, 'css'), ...references(chunk, 'assets')]) localFile(file);
    for (const key of [...references(chunk, 'imports'), ...references(chunk, 'dynamicImports')]) {
      if (!Object.hasOwn(manifest, key)) throw new Error(`Missing manifest chunk: ${key}`);
    }
  }
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    initial.add(chunk.file);
    for (const css of references(chunk, 'css')) initial.add(css);
    for (const dependency of references(chunk, 'imports')) visit(dependency);
  }
  for (const entry of entries) visit(entry);
  const files = [];
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('Build symlinks are not supported');
      const target = path.join(directory, item.name);
      if (item.isDirectory()) walk(target);
      else if (item.isFile()) {
        const file = path.relative(root, target).split(path.sep).join('/');
        if (file.startsWith('.vite/') || file.endsWith('.map')) continue;
        const bytes = fs.readFileSync(target);
        const kind = file.endsWith('.js') ? 'js' : file.endsWith('.css') ? 'css' : 'other';
        files.push({
          file, kind,
          loading: kind === 'other' ? 'asset' : initial.has(file) ? 'initial' : 'non-initial',
          rawBytes: bytes.length,
          gzipBytes: gzipSync(bytes, { level: zlibConstants.Z_DEFAULT_COMPRESSION }).length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
  }
  walk(root);
  files.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  const summarize = selected => ({
    count: selected.length,
    rawBytes: selected.reduce((sum, item) => sum + item.rawBytes, 0),
    gzipBytes: selected.reduce((sum, item) => sum + item.gzipBytes, 0),
  });
  return {
    schemaVersion: 1,
    measurement: 'Vite manifest static-import closure; gzip default compression; bytes per file',
    scope: 'Union of manifest entries; non-initial is not necessarily loaded on every async route. Excludes .vite metadata and source maps. No browser timing or server compression claim.',
    entries: entries.map(key => ({ key, file: manifest[key].file })),
    totals: {
      initialJs: summarize(files.filter(item => item.kind === 'js' && item.loading === 'initial')),
      initialCss: summarize(files.filter(item => item.kind === 'css' && item.loading === 'initial')),
      nonInitialJs: summarize(files.filter(item => item.kind === 'js' && item.loading === 'non-initial')),
      allJs: summarize(files.filter(item => item.kind === 'js')),
      allCss: summarize(files.filter(item => item.kind === 'css')),
    },
    top10: [...files].filter(item => !item.file.endsWith('.html'))
      .sort((a, b) => b.rawBytes - a.rawBytes || (a.file < b.file ? -1 : 1)).slice(0, 10),
    files,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args[0]?.startsWith('-') && args[0] !== '--help')) {
      throw new Error('Usage: node scripts/measure-bundle.mjs [dist-directory]');
    }
    if (args[0] === '--help') {
      console.log('Build with npm run build:client -- --manifest, then run node scripts/measure-bundle.mjs [dist-directory]. Outputs JSON; does not build or write files.');
    } else {
      console.log(JSON.stringify(measureBundle(args[0] || 'dist'), null, 2));
    }
  } catch (error) {
    console.error(`Bundle measurement failed: ${error.message}`);
    process.exitCode = 1;
  }
}
