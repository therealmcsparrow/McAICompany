import test from 'node:test';
import assert from 'node:assert/strict';
import { board, refreshActive } from './dashboard-data.mjs';
import { NOW, NEW, NEW2, view, makeDeps, entry } from './dashboard-board-fixtures.mjs';

const card = (b, slug) => b.columns.flatMap((c) => c.cards).find((x) => x.slug === slug);
const col = (b, id) => b.columns.find((c) => c.id === id).cards.map((x) => x.slug);

test('title: text after the stamp for a new name, the slug for a legacy slug', async () => {
  const views = { [NEW]: view(), [NEW2]: view(), 'old-legacy-slug': view() };
  const { deps } = makeDeps({ runs: [entry(NEW), entry(NEW2), entry('old-legacy-slug')], views });
  const b = await board('/x', { now: NOW, deps });
  assert.equal(card(b, NEW).title, 'Board Topic');
  assert.equal(card(b, NEW2).title, 'Other Topic Draft 2');
  assert.equal(card(b, 'old-legacy-slug').title, 'old-legacy-slug');
});

test('elapsedS: started to ended, or to now while running, null without start', async () => {
  const runs = [
    entry('e', { state: 'ended', started: '2026-11-04T10:00:00Z', ended: '2026-11-04T10:01:30.900Z' }),
    entry('r', { started: '2026-11-04T11:00:00Z' }),
    entry('n', { state: 'none', started: null }),
  ];
  const views = { e: view({ state: 'ended' }), r: view(), n: view({ state: 'none', started: null }) };
  const { deps } = makeDeps({ runs, views });
  const b = await board('/x', { now: NOW, deps });
  assert.equal(card(b, 'e').elapsedS, 90);
  assert.equal(card(b, 'r').elapsedS, 3600);
  assert.equal(card(b, 'n').elapsedS, null);
  assert.equal(card(b, 'r').live, true);
  assert.equal(card(b, 'e').live, false);
});

test('fields: tier and round from the view, tokens, usd', async () => {
  const views = { a: view({ tier: 'medium', round: 3 }) };
  const ledger = { a: { state: 'ok', totals: { spend: 1000, cacheRead: 500 }, overCap: [] } };
  const cost = { a: { state: 'recorded', micros: 420000 } };
  const { deps } = makeDeps({ runs: [entry('a', { tier: 'high', round: 2 })], views, ledger, cost });
  const c = card(await board('/x', { now: NOW, deps }), 'a');
  assert.equal(c.tier, 'medium');
  assert.equal(c.round, 3);
  assert.deepEqual(c.tokens, { spend: 1000, cacheRead: 500 });
  assert.equal(c.usd, 0.42);
});

test('tokens null unless the ledger state is ok; usd null for state none', async () => {
  const ledger = { a: { state: 'unavailable', totals: null, overCap: [] } };
  const { deps } = makeDeps({ runs: [entry('a')], views: { a: view() }, ledger });
  const c = card(await board('/x', { now: NOW, deps }), 'a');
  assert.equal(c.tokens, null);
  assert.equal(c.usd, null);
});

test('needsCeo: from open_ask, from a needs-ceo highest Step, not from an older Step', async () => {
  const st = (step, status) => ({ step, role: 'qa', status });
  const views = {
    ask: view({ open_ask: { gate: 'plan', at: 'x' } }),
    step: view({ steps: [st('05', 'done'), st('10', 'needs-ceo')] }),
    old: view({ steps: [st('05', 'needs-ceo'), st('10', 'done')] }),
    no: view({ steps: [st('05', 'done')] }),
  };
  const { deps } = makeDeps({ runs: ['ask', 'step', 'old', 'no'].map((s) => entry(s)), views });
  const b = await board('/x', { now: NOW, deps });
  assert.equal(card(b, 'ask').needsCeo, true);
  assert.equal(card(b, 'step').needsCeo, true);
  assert.equal(card(b, 'old').needsCeo, false);
  assert.equal(card(b, 'no').needsCeo, false);
  assert.equal(card(b, 'step').column, 'needs-ceo');
});

test('an ended run usd is read once across boards', async () => {
  const runs = [entry('end-once', { state: 'ended', ended: '2026-11-04T11:30:00Z' })];
  const { deps, calls } = makeDeps({ runs, views: { 'end-once': view({ state: 'ended' }) }, cost: { 'end-once': { state: 'recorded', micros: 5000000 } } });
  const a = await board('/x', { now: NOW, deps });
  const b = await board('/x', { now: NOW + 5000, deps });
  assert.equal(card(a, 'end-once').usd, 5);
  assert.equal(card(b, 'end-once').usd, 5);
  assert.equal(calls.cost.length, 1);
});

test('a running run usd is read on every board', async () => {
  const { deps, calls } = makeDeps({ runs: [entry('live-usd')], views: { 'live-usd': view() }, cost: { 'live-usd': { state: 'recorded', micros: 1000000 } } });
  await board('/x', { now: NOW, deps });
  await board('/x', { now: NOW, deps });
  assert.equal(calls.cost.length, 2);
});

test('refreshActive changes only the active card, active and inflight', async () => {
  const stage = { state: 'recorded', stage: 'plan' };
  const first = makeDeps({ runs: [entry('a1'), entry('b1')], views: { a1: view(), b1: view() }, active: 'a1', stages: { a1: stage, b1: stage } });
  const prev = await board('/x', { now: NOW, deps: first.deps });
  assert.equal(prev.active, 'a1');
  const before = JSON.stringify(prev);
  const later = makeDeps({
    runs: [], active: 'a1',
    views: { a1: view({ open_ask: { gate: 'ship', at: 'x' } }), b1: new Error('must not be read') },
    stages: { a1: { state: 'recorded', stage: 'build' } },
  });
  const next = await refreshActive('/x', prev, { now: NOW + 1000, deps: later.deps });
  assert.deepEqual(later.calls.show, ['a1']);
  assert.equal(card(next, 'a1').column, 'needs-ceo');
  assert.deepEqual(card(next, 'b1'), card(prev, 'b1'));
  assert.deepEqual(next.roadmap, prev.roadmap);
  assert.deepEqual(col(next, 'plan'), ['b1']);
  assert.deepEqual(col(next, 'needs-ceo'), ['a1']);
  assert.equal(JSON.stringify(prev), before);
});

test('refreshActive without an active run returns an equal board', async () => {
  const { deps } = makeDeps({ runs: [entry('z', { state: 'stale' })], views: { z: view({ state: 'stale' }) } });
  const prev = await board('/x', { now: NOW, deps });
  const next = await refreshActive('/x', prev, { now: NOW, deps });
  assert.deepEqual(next.columns, prev.columns);
  assert.equal(next.active, null);
});

test('refreshActive clears active and inflight when the active run is gone or unknown', async () => {
  const first = makeDeps({ runs: [entry('a2')], views: { a2: view() }, active: 'a2' });
  const prev = await board('/x', { now: NOW, deps: first.deps });
  assert.equal(prev.active, 'a2');
  const gone = makeDeps({ runs: [], active: null, views: { a2: view({ state: 'ended' }) } });
  const next = await refreshActive('/x', prev, { now: NOW + 1000, deps: gone.deps });
  assert.equal(next.active, null);
  assert.equal(next.inflight, 0);
  const unknown = makeDeps({ runs: [], active: 'not-on-board', views: { a2: view() } });
  const other = await refreshActive('/x', prev, { now: NOW + 1000, deps: unknown.deps });
  assert.equal(other.active, null);
  assert.equal(other.inflight, 0);
});
