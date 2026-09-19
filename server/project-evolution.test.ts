import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { createProjectEvolutionRouter, validateEvolution } from './project-evolution.js';
import { architectureChanges, type EvolutionData } from '../src/types/project-evolution.js';
import { collectFact, isSource, nonemptyLines } from '../scripts/project-evolution-lib.js';

const readData = () => JSON.parse(fs.readFileSync('project-evolution/generated.json', 'utf8')) as EvolutionData;
test('evolution curated record validates and metrics retain unknown tests', () => {
  const data = readData(); validateEvolution(data);
  assert.equal(data.milestones.length, 15);
  assert.equal(data.milestones[0].tests, null);
  assert.equal(data.facts[0].version, '1.0.0');
});
test('evolution rejects duplicate IDs, dangling edges, bad references and metrics', () => {
  const mutations = [
    (d: EvolutionData) => { d.milestones[1].id = d.milestones[0].id; },
    (d: EvolutionData) => { d.snapshots[0].edges[0].target = 'missing'; },
    (d: EvolutionData) => { d.milestones[0].snapshot = 'missing'; },
    (d: EvolutionData) => { d.facts[0].version = 'invented'; },
    (d: EvolutionData) => { d.facts[0].sourceLoc = -1; },
    (d: EvolutionData) => { d.facts[0].commit = 'bad'; },
    (d: EvolutionData) => { d.milestones[0].tests = { count: 25, evidence: '' }; },
    (d: EvolutionData) => { d.milestones[0].evidencePaths = ['../../.env']; },
    (d: EvolutionData) => { d.snapshots[1].nodes[0].x += 10; },
    (d: EvolutionData) => { Object.assign(d, { privateEmail: 'not allowed' }); },
  ];
  for (const mutate of mutations) { const data = readData(); mutate(data); assert.throws(() => validateEvolution(data)); }
});
test('LOC rule excludes generated and non-source files and counts nonempty lines', () => {
  for (const p of ['src/App.tsx', 'server/routes/example.ts', 'scripts/example.ps1']) assert.ok(isSource(p));
  for (const p of ['data/chat.db', 'package-lock.json', 'dist/app.js', 'server/public/assets/index-built.js', 'src/generated/data.ts', 'src/vendor/lib.js', 'src/foo.min.js', 'scripts/project-evolution-lib.ts', 'src/pages/ProjectEvolutionPage.tsx']) assert.ok(!isSource(p));
  assert.equal(nonemptyLines('a\r\n \r\n// comment\n'), 2);
});
test('architecture diff detects additions, removals and content changes with stable positions', () => {
  const before = readData().snapshots[0]; const after = structuredClone(before);
  after.nodes[0].description = 'Updated role'; after.nodes.splice(1, 1); after.edges = [];
  after.nodes.push({ ...before.nodes[1], id: 'new-service' });
  const diff = architectureChanges(before, after);
  assert.equal(diff.nodes.find(n => n.id === before.nodes[0].id)?.change, 'changed');
  assert.equal(diff.nodes.find(n => n.id === before.nodes[1].id)?.change, 'removed');
  assert.equal(diff.nodes.find(n => n.id === 'new-service')?.change, 'added');
  assert.equal(diff.nodes[0].x, before.nodes[0].x);
  assert.ok(diff.edges.every(e => e.change === 'removed'));
});
test('historical collection is deterministic and ignores current working files', t => {
  const data = readData(), milestone = data.milestones[0];
  // Run only when this old object is available (ordinary shallow test checkouts lack it).
  try { execFileSync('git', ['cat-file', '-e', milestone.commit], { stdio: 'ignore' }); } catch { t.skip('Historical object unavailable in shallow checkout'); return; }
  const first = collectFact(milestone.id, milestone.commit);
  assert.deepEqual(first, collectFact(milestone.id, milestone.commit));
  assert.deepEqual(first, data.facts[0]);
});
test('evolution API requires valid active account, shares only project facts and handles corrupt data', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'evolution-api-'));
  const file = path.join(temp, 'generated.json'); fs.copyFileSync('project-evolution/generated.json', file);
  const users = ['one', 'two'].map(id => ({ id, email: `${id}@example.invalid`, role: 'user' as const, disabled: 0, auth_version: 0, created_at: '', updated_at: '' }));
  const auth = createAuth({ secret: 'evolution-test-secret', getUserById: id => users.find(u => u.id === id) });
  const app = createApp({ isProduction: false, isReady: () => true });
  app.use(createProjectEvolutionRouter({ authenticate: auth.authenticate, file }));
  const listener = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => listener.once('listening', resolve));
  const url = `http://127.0.0.1:${(listener.address() as { port: number }).port}/api/project-evolution`;
  const request = (token: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await request('invalid')).status, 401);
    const token = auth.signUserToken(users[0]);
    const response = await request(token); assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control')!, /private, no-store/);
    const data = await response.json();
    assert.deepEqual(data, await (await request(auth.signUserToken(users[1]))).json());
    users[0].disabled = 1; assert.notEqual((await request(token)).status, 200); users[0].disabled = 0;
    users[0].auth_version++; assert.notEqual((await request(token)).status, 200);
    fs.writeFileSync(file, '{}');
    const failed = await request(auth.signUserToken(users[1])); assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: '项目成长记录暂不可用，请稍后重试' });
  } finally { listener.closeAllConnections(); await new Promise<void>(resolve => listener.close(() => resolve())); fs.rmSync(temp, { recursive: true, force: true }); }
});
