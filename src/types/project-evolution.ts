export type EvolutionNode = { id: string; label: string; group: 'client' | 'server' | 'data' | 'external'; description: string; x: number; y: number };
export type EvolutionEdge = { id: string; source: string; target: string; label: string };
export type EvolutionSnapshot = { id: string; milestone: string; nodes: EvolutionNode[]; edges: EvolutionEdge[] };
export type EvolutionMilestone = {
  id: string; stage: number; title: string; summary: string; engineering: string;
  commit: string; evidencePaths: string[]; featureAreas: string[]; snapshot: string;
  tests: { count: number; evidence: string } | null;
};
export type EvolutionFact = { id: string; commit: string; date: string; version: string | null; tags: string[]; warnings: string[]; trackedFiles: number; sourceLoc: number; commitsTotal: number };
export type EvolutionData = {
  schemaVersion: 1; metricRules: string; baseline: string; stages: string[];
  milestones: EvolutionMilestone[]; snapshots: EvolutionSnapshot[]; facts: EvolutionFact[];
};

export function architectureChanges(previous: EvolutionSnapshot | undefined, current: EvolutionSnapshot) {
  const status = <T extends { id: string }>(before: T[], after: T[]) => {
    const old = new Map(before.map(item => [item.id, item]));
    const next = new Map(after.map(item => [item.id, item]));
    return [...after, ...before.filter(item => !next.has(item.id))].map(item => ({
      ...item, change: !next.has(item.id) ? 'removed' : !old.has(item.id) ? 'added' : JSON.stringify(old.get(item.id)) !== JSON.stringify(item) ? 'changed' : 'unchanged',
    }));
  };
  return { nodes: status(previous?.nodes ?? [], current.nodes), edges: status(previous?.edges ?? [], current.edges) };
}
