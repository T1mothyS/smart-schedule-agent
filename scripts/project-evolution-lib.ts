import { execFileSync } from 'node:child_process';
import type { EvolutionData, EvolutionFact } from '../src/types/project-evolution.js';
export function git(...args: string[]) { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim(); }
export function isSource(file: string) {
  return /^(src|server|electron|scripts)\//.test(file) && /\.(ts|tsx|js|jsx|mjs|cjs|css|html|ps1)$/.test(file)
    && !/(^|\/)(node_modules|dist|build|coverage|generated|vendor|data|backup)(\/|$)|\.min\.|^server\/public\/|project-?evolution/i.test(file);
}
export function nonemptyLines(content: string) { return content.split(/\r?\n/).filter(line => line.trim()).length; }
function sourceLines(commit: string, files: string[]) {
  if (!files.length) return 0;
  const bytes = execFileSync('git', ['cat-file', '--batch'], { input: files.map(f => `${commit}:${f}`).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024 });
  let offset = 0, total = 0;
  for (const _file of files) {
    const end = bytes.indexOf(10, offset);
    const size = Number(bytes.subarray(offset, end).toString().split(' ')[2]);
    if (!Number.isSafeInteger(size)) throw new Error('Invalid git blob');
    offset = end + 1;
    total += nonemptyLines(bytes.subarray(offset, offset + size).toString('utf8'));
    offset += size + 1;
  }
  return total;
}
export function collectFact(id: string, commit: string): EvolutionFact {
  const files = git('ls-tree', '-r', '--name-only', '-z', commit).split('\0').filter(Boolean);
  const tags = git('tag', '--points-at', commit).split('\n').filter(t => /^[vV]?\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(t));
  let version: string | null = null;
  try { version = JSON.parse(git('show', `${commit}:package.json`)).version ?? null; } catch { /* missing historical package */ }
  const warnings = tags.filter(t => t.replace(/^[vV]/, '') !== version).map(t => `VERSION_MISMATCH: ${t} / ${version}`);
  return { id, commit, date: git('show', '-s', '--format=%cI', commit), version, tags, warnings,
    trackedFiles: files.length, sourceLoc: sourceLines(commit, files.filter(isSource)),
    commitsTotal: Number(git('rev-list', '--count', commit)) };
}
export function verifyHistory(data: EvolutionData) {
  git('merge-base', '--is-ancestor', data.baseline, 'HEAD');
  for (const m of data.milestones) {
    git('merge-base', '--is-ancestor', m.commit, data.baseline);
    for (const p of m.evidencePaths) git('cat-file', '-e', `${m.commit}:${p}`);
    if (m.tests) {
      const evidencePath = m.tests.evidence.split('（')[0];
      if (!evidencePath.startsWith('docs/') || evidencePath.includes('..')) throw new Error('Invalid test evidence path');
      const evidence = git('show', `${m.commit}:${evidencePath}`);
      if (!evidence.includes(`${m.tests.count}/${m.tests.count}`)) throw new Error(`Missing recorded test count: ${m.id}`);
    }
    const actual = collectFact(m.id, m.commit);
    if (JSON.stringify(actual) !== JSON.stringify(data.facts.find(f => f.id === m.id))) throw new Error(`Historical facts changed: ${m.id}`);
  }
}
