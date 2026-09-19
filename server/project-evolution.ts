import fs from 'node:fs';
import express, { type RequestHandler } from 'express';
import type { EvolutionData } from '../src/types/project-evolution.js';

const idPattern = /^[a-z][a-z0-9-]*$/;
export function validateEvolution(value: unknown): asserts value is EvolutionData {
  const data = value as EvolutionData;
  const fail = (message: string): never => { throw new Error(`Evolution: ${message}`); };
  const keys = (item: object, allowed: string[]) => { if (Object.keys(item).some(key => !allowed.includes(key))) fail('unexpected field'); };
  if (!data || data.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(data.baseline) || data.metricRules !== 'source-nonempty-v1') fail('invalid header');
  keys(data, ['schemaVersion', 'metricRules', 'baseline', 'stages', 'milestones', 'snapshots', 'facts']);
  if (!Array.isArray(data.stages) || data.stages.length !== 5 || data.stages.some(s => typeof s !== 'string')) fail('invalid stages');
  const unique = (items: { id: string }[], name: string) => {
    if (!Array.isArray(items)) fail(`invalid ${name}`);
    const ids = new Set<string>();
    for (const item of items) { if (!item || !idPattern.test(item.id) || ids.has(item.id)) fail(`duplicate/invalid ${name} ID`); ids.add(item.id); }
    return ids;
  };
  const milestones = unique(data.milestones, 'milestone');
  const snapshots = unique(data.snapshots, 'snapshot');
  const facts = unique(data.facts, 'fact');
  if (facts.size !== milestones.size) fail('fact count');
  for (const m of data.milestones) {
    keys(m, ['id', 'stage', 'title', 'summary', 'engineering', 'commit', 'evidencePaths', 'featureAreas', 'snapshot', 'tests']);
    if (![m.title, m.summary, m.engineering, m.commit].every(s => typeof s === 'string' && s.length > 0) || !/^[a-f0-9]{40}$/.test(m.commit)) fail('milestone content');
    if (!Number.isInteger(m.stage) || m.stage < 0 || m.stage > 4 || !snapshots.has(m.snapshot) || !facts.has(m.id)) fail('milestone reference');
    if (!Array.isArray(m.featureAreas) || m.featureAreas.some(x => !idPattern.test(x)) || !Array.isArray(m.evidencePaths) || !m.evidencePaths.length || m.evidencePaths.some(p => !/^(src|server|electron|docs)\//.test(p) || p.includes('..'))) fail('invalid evidence/features');
    if (m.tests !== null && (!Number.isInteger(m.tests?.count) || m.tests.count < 0 || !m.tests.evidence)) fail('test evidence');
    if (m.tests) keys(m.tests, ['count', 'evidence']);
  }
  let previousDate = '';
  for (const m of data.milestones) {
    const f = data.facts.find(f => f.id === m.id)!;
    keys(f, ['id', 'commit', 'date', 'version', 'tags', 'warnings', 'trackedFiles', 'sourceLoc', 'commitsTotal']);
    if (f.commit !== m.commit || !Number.isFinite(Date.parse(f.date)) || (previousDate && Date.parse(f.date) < Date.parse(previousDate))) fail('commit/date mismatch');
    previousDate = f.date;
    if (f.version !== null && !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(f.version)) fail('invalid version');
    for (const n of [f.sourceLoc, f.trackedFiles, f.commitsTotal]) if (!Number.isSafeInteger(n) || n < 0) fail('invalid metric');
    if (!Array.isArray(f.tags) || !Array.isArray(f.warnings) || [...f.tags, ...f.warnings].some(x => typeof x !== 'string')) fail('invalid tags/warnings');
  }
  const positions = new Map<string, string>();
  let lastSnapshotMilestone = -1;
  for (const snapshot of data.snapshots) {
    keys(snapshot, ['id', 'milestone', 'nodes', 'edges']);
    if (!milestones.has(snapshot.milestone)) fail('snapshot milestone');
    const milestoneIndex = data.milestones.findIndex(m => m.id === snapshot.milestone);
    if (milestoneIndex <= lastSnapshotMilestone || data.milestones[milestoneIndex].snapshot !== snapshot.id) fail('snapshot order');
    lastSnapshotMilestone = milestoneIndex;
    const nodes = unique(snapshot.nodes, 'node'); unique(snapshot.edges, 'edge');
    for (const n of snapshot.nodes) {
      keys(n, ['id', 'label', 'group', 'description', 'x', 'y']);
      if (!['client', 'server', 'data', 'external'].includes(n.group) || !n.label || !n.description || !Number.isFinite(n.x) || !Number.isFinite(n.y) || n.x < 0 || n.x > 900 || n.y < 40) fail('invalid node');
      const position = `${n.x},${n.y}`;
      if (positions.has(n.id) && positions.get(n.id) !== position) fail('unstable node position');
      positions.set(n.id, position);
    }
    for (const e of snapshot.edges) { keys(e, ['id', 'source', 'target', 'label']); if (!nodes.has(e.source) || !nodes.has(e.target) || typeof e.label !== 'string') fail('dangling edge'); }
  }
  for (const m of data.milestones) {
    const owner = data.snapshots.find(s => s.id === m.snapshot)!;
    if (data.milestones.findIndex(x => x.id === owner.milestone) > data.milestones.indexOf(m)) fail('future snapshot reference');
  }
}

export function createProjectEvolutionRouter({ authenticate, file }: { authenticate: RequestHandler; file: string }) {
  const router = express.Router();
  router.get('/api/project-evolution', authenticate, (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      validateEvolution(data);
      res.json(data);
    } catch { res.status(503).json({ error: '项目成长记录暂不可用，请稍后重试' }); }
  });
  return router;
}
