import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { board } from './dashboard-data.mjs';
import { NOW, view, makeDeps, entry, cardsOf } from './dashboard-board-fixtures.mjs';

const IDS = ['intake', 'brief', 'plan', 'build', 'review', 'ship-gate', 'needs-ceo', 'done'];
const allCards = (b) => b.columns.flatMap((x) => x.cards);

test('eight columns in order, generated is UTC, roadmap passes through', async () => {
  const { deps } = makeDeps({ runs: [], roadmap: [{ file: 'a.md' }] });
  const b = await board('/x', { now: NOW, deps });
  assert.equal(b.v, 1);
  assert.deepEqual(b.columns.map((c) => c.id), IDS);
  assert.equal(b.generated, '2026-11-04T12:00:00Z');
  assert.deepEqual(b.roadmap, [{ file: 'a.md' }]);
  assert.equal(b.active, null);
  assert.equal(b.inflight, 0);
});

test('column precedence: done, needs-ceo, stage, then gates', async () => {
  const runs = [
    entry('r-done', { state: 'ended', ended: '2026-11-04T11:30:00Z' }),
    entry('r-ask'), entry('r-stage'), entry('r-ship'), entry('r-plan'), entry('r-brief'), entry('r-none'),
  ];
  const views = {
    'r-done': view({ state: 'ended', ended: '2026-11-04T11:30:00Z', open_ask: { gate: 'ship', at: 'x' } }),
    'r-ask': view({ open_ask: { gate: 'plan', at: 'x' } }),
    'r-stage': view({ gates: [{ gate: 'ship', result: 'passed' }] }),
    'r-ship': view({ gates: [{ gate: 'brief', result: 'passed' }, { gate: 'ship', result: 'changed' }] }),
    'r-plan': view({ gates: [{ gate: 'brief', result: 'passed' }, { gate: 'plan', result: 'passed' }] }),
    'r-brief': view({ gates: [{ gate: 'brief', result: 'passed' }] }),
    'r-none': view(),
  };
  const stages = { 'r-stage': { state: 'recorded', stage: 'review' }, 'r-ask': { state: 'recorded', stage: 'build' } };
  const { deps } = makeDeps({ runs, views, stages });
  const b = await board('/x', { now: NOW, deps });
  const c = cardsOf(b);
  assert.deepEqual(c.done, ['r-done']);
  assert.deepEqual(c['needs-ceo'], ['r-ask']);
  assert.deepEqual(c.review, ['r-stage']);
  assert.deepEqual(c['ship-gate'], ['r-ship']);
  assert.deepEqual(c.build, ['r-plan']);
  assert.deepEqual(c.plan, ['r-brief']);
  assert.deepEqual(c.brief, ['r-none']);
  assert.equal(allCards(b).length, runs.length);
  const by = Object.fromEntries(allCards(b).map((x) => [x.slug, x]));
  assert.equal(by['r-stage'].stageNote, null);
  assert.equal(by['r-ship'].stageNote, 'stage not recorded');
  assert.equal(by['r-done'].stageNote, null);
  assert.equal(by['r-done'].column, 'done');
});

test('stale run keeps its column', async () => {
  const { deps } = makeDeps({ runs: [entry('s', { state: 'stale' })], views: { s: view({ state: 'stale' }) }, stages: { s: { state: 'recorded', stage: 'build' } } });
  const b = await board('/x', { now: NOW, deps });
  const card = b.columns.find((c) => c.id === 'build').cards[0];
  assert.equal(card.slug, 's');
  assert.equal(card.state, 'stale');
  assert.equal(card.live, false);
});

test('a bad source isolates its card; a throwing reader never fails the board', async () => {
  const runs = [entry('bad', { state: 'unreadable', started: null, tier: null, round: null }), entry('boom'), entry('ok'), entry('empty', { state: 'none', started: null })];
  const views = { boom: new Error('x'), ok: view(), empty: view({ state: 'none', started: null }) };
  const { deps } = makeDeps({ runs, views });
  deps.readStage = (_r, slug) => {
    if (slug === 'ok') throw new Error('stage');
    return { state: 'none' };
  };
  deps.readCost = () => { throw new Error('cost'); };
  deps.readLedger = async () => { throw new Error('ledger'); };
  deps.listIntake = () => { throw new Error('intake'); };
  deps.listRoadmap = () => { throw new Error('roadmap'); };
  const b = await board('/x', { now: NOW, deps });
  const cards = Object.fromEntries(allCards(b).map((x) => [x.slug, x]));
  assert.equal(cards.bad.readable, false);
  assert.equal(cards.bad.state, 'unreadable');
  assert.equal(cards.boom.readable, false);
  assert.equal(cards.ok.readable, true);
  assert.equal(cards.ok.stageNote, 'stage not recorded');
  assert.equal(cards.ok.usd, null);
  assert.equal(cards.ok.tokens, null);
  assert.equal(cards.empty.readable, 'not recorded');
  assert.deepEqual(b.roadmap, []);
  assert.deepEqual(b.columns[0].cards, []);
  assert.equal(allCards(b).length, 4);
});

test('Intake lane: needs-info first, then rejected, others dropped', async () => {
  const intake = [
    { id: 'a', outcome: 'rejected', topic: 'T1', slug: null, at: '2026-11-04T10:00:00Z' },
    { id: 'b', outcome: 'needs-info', topic: 'T2', slug: null, at: '2026-11-04T09:00:00Z' },
    { id: 'c', outcome: 'started', topic: 'T3', slug: 'x', at: '2026-11-04T08:00:00Z' },
    { id: 'd', outcome: 'needs-info', topic: 'T4', slug: null, at: '2026-11-04T07:00:00Z' },
  ];
  const { deps } = makeDeps({ runs: [], intake });
  const b = await board('/x', { now: NOW, deps });
  assert.deepEqual(b.columns[0].cards, [
    { id: 'b', topic: 'T2', outcome: 'needs-info', at: '2026-11-04T09:00:00Z' },
    { id: 'd', topic: 'T4', outcome: 'needs-info', at: '2026-11-04T07:00:00Z' },
    { id: 'a', topic: 'T1', outcome: 'rejected', at: '2026-11-04T10:00:00Z' },
  ]);
});

test('a real empty root gives an empty board', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-board-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const b = await board(root, { now: NOW });
  assert.equal(b.columns.length, 8);
  assert.equal(allCards(b).length, 0);
});
