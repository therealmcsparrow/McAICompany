// Fake readers for the dashboard board tests.
export const NOW = Date.parse('2026-11-04T12:00:00Z');
export const NEW = '2026-11-04 01.19 - Board Topic';
export const NEW2 = '2026-11-03 10.00 - Other Topic Draft 2';

export const view = (extra = {}) => ({
  v: 1, state: 'running', started: '2026-11-04T11:00:00Z', ended: null, gates: [], subs: [], steps: [], waves: [],
  open_ask: null, round: 0, tier: 'high', warnings: [], ...extra,
});

export function makeDeps({ runs, views = {}, stages = {}, active = null, cost = {}, ledger = {}, intake = [], roadmap = [] }) {
  const calls = { cost: [], ledger: [], show: [] };
  const deps = {
    list: () => ({ runs }),
    active: () => ({ slug: active, view: active ? views[active] : null }),
    show: (_r, slug) => {
      calls.show.push(slug);
      const v = views[slug];
      if (v instanceof Error) throw v;
      return v;
    },
    readStage: (_r, slug) => stages[slug] ?? { state: 'none', stage: null },
    readCost: (_r, slug) => {
      calls.cost.push(slug);
      return cost[slug] ?? { state: 'none' };
    },
    readLedger: async (_r, slug) => {
      calls.ledger.push(slug);
      return ledger[slug] ?? { state: 'none', totals: null, overCap: [] };
    },
    listIntake: () => ({ items: intake }),
    listRoadmap: () => ({ items: roadmap }),
  };
  return { deps, calls };
}

export const entry = (slug, extra = {}) => ({
  slug, state: 'running', started: '2026-11-04T11:00:00Z', ended: null, outcome: null, tier: 'high', round: 0, ...extra,
});
export const cardsOf = (b) => Object.fromEntries(b.columns.map((c) => [c.id, c.cards.map((x) => x.slug ?? x.id)]));
