import fs from 'node:fs';
import { collectFact, verifyHistory } from './project-evolution-lib.js';
import { validateEvolution } from '../server/project-evolution.js';
import type { EvolutionData } from '../src/types/project-evolution.js';
const source = 'project-evolution/curated.json';
const output = 'project-evolution/generated.json';
if (process.argv.includes('--generate')) {
  const curated = JSON.parse(fs.readFileSync(source, 'utf8')) as Omit<EvolutionData, 'facts'>;
  const data = { ...curated, facts: curated.milestones.map(m => collectFact(m.id, m.commit)) };
  validateEvolution(data); verifyHistory(data);
  fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
  console.log(`Generated ${data.milestones.length} verified milestones`);
} else {
  const data: unknown = JSON.parse(fs.readFileSync(output, 'utf8'));
  validateEvolution(data);
  const { facts: _facts, ...curated } = data;
  if (JSON.stringify(curated) !== JSON.stringify(JSON.parse(fs.readFileSync(source, 'utf8')))) throw new Error('Curated data changed: regenerate evolution');
  if (process.argv.includes('--history')) verifyHistory(data);
  console.log('Project evolution validation passed');
}
