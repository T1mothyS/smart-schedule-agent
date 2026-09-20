import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readToolsManifest } from '../server/protected-tools.js';

const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function checkProtectedTools(sourceRoot: string, packageRoot = sourceRoot) {
  const manifest = readToolsManifest(sourceRoot);
  if (hash(path.join(sourceRoot, 'manifest.json')) !== hash(path.join(packageRoot, 'manifest.json'))) throw new Error('Tools 发布包清单与源码不一致');
  return manifest.tools.filter(t => t.enabled).map(tool => {
    const relative = path.join(tool.slug, 'index.html');
    const expected = hash(path.join(sourceRoot, relative));
    if (hash(path.join(packageRoot, relative)) !== expected) throw new Error(`Tools 发布包内容不一致: ${tool.slug}`);
    return { slug: tool.slug, sha256: expected };
  });
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/check-protected-tools.ts')) {
  const result = checkProtectedTools(path.resolve('protected-tools'), path.resolve(process.argv[2] || 'protected-tools'));
  console.log(JSON.stringify({ tools: result }, null, 2));
}
