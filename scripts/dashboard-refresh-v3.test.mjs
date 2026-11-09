// refreshActive rebuilds the project card when the active run is a v3 run in that card's runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { board, refreshActive } from './dashboard-data.mjs';
import { makeDeps, view, entry, NOW } from './dashboard-board-fixtures.mjs';

const PROJ = 'P20261109.000009';
const R1 = `${PROJ}/01-feature`;
const R2 = `${PROJ}/02-fix`;
const all = (b) => b.columns.flatMap((c) => c.cards);

test('a running v3 run whose stage changes: refreshActive rebuilds the project card', async () => {
  const first = makeDeps({
    runs: [entry(R2, { started: '2026-11-09T11:00:00Z' }), entry(R1, { state: 'ended', started: '2026-11-09T09:00:00Z', ended: '2026-11-09T10:00:00Z' })],
    views: { [R2]: view(), [R1]: view({ state: 'ended' }) },
    active: R2,
    stages: { [R2]: { state: 'recorded', stage: 'plan' } },
  });
  const prev = await board('/x', { now: NOW, deps: first.deps });
  const before = JSON.stringify(prev);
  const p0 = all(prev).find((c) => c.kind === 'project');
  assert.equal(prev.active, R2);
  assert.equal(p0.column, 'plan');

  const later = makeDeps({
    runs: [], active: R2,
    views: { [R2]: view() },
    stages: { [R2]: { state: 'recorded', stage: 'build' } },
  });
  const next = await refreshActive('/x', prev, { now: NOW + 1000, deps: later.deps });
  const cards = all(next);
  assert.equal(cards.length, 1);
  const p1 = cards[0];
  assert.equal(p1.column, 'build');
  assert.deepEqual(next.columns.find((c) => c.id === 'build').cards.map((c) => c.id), [PROJ]);
  assert.deepEqual(next.columns.find((c) => c.id === 'plan').cards, []);
  for (const k of ['kind', 'id', 'slug', 'title', 'description', 'runs']) assert.deepEqual(p1[k], p0[k], k);
  assert.equal(next.active, R2);
  assert.equal(JSON.stringify(prev), before);
});
