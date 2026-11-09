// QA-first red tests for dashboard v2.0 (AC8 board data, AC16 api/run with an encoded v3 slug, AC7 old runs unchanged).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { board } from './dashboard-data.mjs';
import { readLedger } from './dashboard-tokens.mjs';
import { startServer } from './dashboard-server.mjs';
import { raw, emptyBoard } from './dashboard-server-helpers.mjs';
import { makeDeps, view, entry, cardsOf, NOW, NEW } from './dashboard-board-fixtures.mjs';

const PROJ = 'P20261109.000009';
const PROJ2 = 'P20261108.000003';
const R1 = `${PROJ}/01-feature`;
const R2 = `${PROJ}/02-fix`;
const R3 = `${PROJ2}/01-draft`;
const LEGACY = 'old-run-one';
const OLD_KEYS = ['slug', 'title', 'state', 'started', 'ended', 'elapsedS', 'live', 'tier', 'round', 'needsCeo', 'column', 'stageNote', 'readable', 'tokens', 'usd'];

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-v2-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const work = path.join(root, '.company', 'work');
  for (const slug of [R1, R2, R3, NEW, LEGACY]) fs.mkdirSync(path.join(work, slug), { recursive: true });
  fs.writeFileSync(path.join(work, PROJ, '00-project.md'), 'Dashboard shows projects\n\nSiblings: none\n');
  fs.writeFileSync(path.join(work, PROJ2, '00-project.md'), 'Second project here\n');
  return root;
}

const OLD_ENDED = { state: 'ended', started: '2026-11-01T09:00:00Z', ended: '2026-11-01T10:00:00Z' };

// Mixed tree as run-state v2.0 `list` returns it: newest first, v3 slugs hold one `/`.
function mixed() {
  const runs = [
    entry(R2, { started: '2026-11-09T11:00:00Z' }),
    entry(R1, { state: 'ended', started: '2026-11-09T09:00:00Z', ended: '2026-11-09T10:00:00Z' }),
    entry(R3, { state: 'ended', started: '2026-11-08T09:00:00Z', ended: '2026-11-08T10:00:00Z' }),
    entry(NEW, { started: '2026-11-04T11:00:00Z' }),
    entry(LEGACY, OLD_ENDED),
  ];
  const views = Object.fromEntries(runs.map((r) => [r.slug, view({ state: r.state, started: r.started, ended: r.ended })]));
  return makeDeps({ runs, views });
}

const allCards = (b) => b.columns.flatMap((c) => c.cards);

test('AC8: a v3 project is one project card; its runs get no own card', async (t) => {
  const root = makeRoot(t);
  const b = await board(root, { now: NOW, deps: mixed().deps });
  const cards = allCards(b);
  const projects = cards.filter((c) => c.kind === 'project');
  assert.deepEqual(projects.map((c) => c.id).sort(), [PROJ, PROJ2].sort());
  for (const slug of [R1, R2, R3]) assert.equal(cards.some((c) => c.slug === slug), false, `${slug} has an own card`);
  assert.equal(cards.length, 4, 'two project cards plus two old runs');
});

test('AC8: the project card holds description, runs newest first and the newest run state', async (t) => {
  const root = makeRoot(t);
  const b = await board(root, { now: NOW, deps: mixed().deps });
  const p = allCards(b).find((c) => c.kind === 'project' && c.id === PROJ);
  assert.ok(p, 'project card exists');
  assert.equal(p.description, 'Dashboard shows projects');
  assert.deepEqual(p.runs, [R2, R1]);
  assert.equal(p.state, 'running', 'state of the newest run (02-fix, running)');
  const q = allCards(b).find((c) => c.kind === 'project' && c.id === PROJ2);
  assert.ok(q, 'second project card exists');
  assert.deepEqual(q.runs, [R3]);
  assert.equal(q.state, 'ended');
  assert.equal(q.description, 'Second project here');
});

test('AC8: an ended newest run puts the project card in done, a running one does not', async (t) => {
  const root = makeRoot(t);
  const b = await board(root, { now: NOW, deps: mixed().deps });
  assert.ok(cardsOf(b).done.includes(PROJ2));
  assert.equal(cardsOf(b).done.includes(PROJ), false, 'newest run of PROJ still runs');
  assert.ok(allCards(b).some((c) => c.kind === 'project' && c.id === PROJ), 'project card is on the board');
});

test('AC7: v2 and legacy runs keep own cards with the same keys and no kind, beside a project card', async (t) => {
  const root = makeRoot(t);
  const b = await board(root, { now: NOW, deps: mixed().deps });
  const cards = allCards(b);
  assert.ok(cards.some((c) => c.kind === 'project'), 'mixed tree has a project card');
  for (const slug of [NEW, LEGACY]) {
    const c = cards.find((x) => x.slug === slug);
    assert.ok(c, `${slug} has own card`);
    assert.equal('kind' in c, false, `${slug} has no kind`);
    assert.deepEqual(Object.keys(c), OLD_KEYS);
  }
});

test('AC7: old runs give the same cards in a mixed tree as in an old-only tree', async (t) => {
  const root = makeRoot(t);
  const oldOnly = makeDeps({
    runs: [entry(NEW), entry(LEGACY, OLD_ENDED)],
    views: { [NEW]: view(), [LEGACY]: view(OLD_ENDED) },
  });
  const a = await board(root, { now: NOW, deps: mixed().deps });
  const b = await board(root, { now: NOW, deps: oldOnly.deps });
  const pick = (x) => allCards(x).filter((c) => c.kind !== 'project').sort((p, q) => (p.slug < q.slug ? -1 : 1));
  assert.equal(allCards(a).filter((c) => c.kind === 'project').length, 2, 'mixed tree has project cards');
  assert.deepEqual(pick(a), pick(b));
});

test('AC8: a project id is never read as a run (no show or cost call for it)', async (t) => {
  const root = makeRoot(t);
  const m = mixed();
  const b = await board(root, { now: NOW, deps: m.deps });
  assert.ok(allCards(b).some((c) => c.kind === 'project'));
  assert.equal(m.calls.show.includes(PROJ), false);
  assert.equal(m.calls.cost.includes(PROJ), false);
});

test('dashboard v2.0: the ledger read of a v3 run finds the runKey file', async (t) => {
  const root = makeRoot(t);
  fs.mkdirSync(path.join(root, '.company', 'ledger'), { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'ledger', `${PROJ}~01-feature.jsonl`), '{"v":1}\n');
  const out = JSON.stringify({ v: 1, rows: [], totals: { spend: 10, cache_read: 20 } });
  const calls = [];
  const spawn = (file, args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => { child.stdout.emit('data', Buffer.from(out)); child.emit('close', 0); });
    return child;
  };
  const r = await readLedger(root, R1, { spawn, cache: new Map() });
  assert.equal(r.state, 'ok');
  assert.equal(calls.length, 1);
});

// AC16 through the server: the raw %2F stays one path part.
async function serve(t, root) {
  const calls = { run: [], lookup: [] };
  const deps = {
    board: async () => ({ ...emptyBoard }),
    refreshActive: async (_r, prev) => prev,
    run: async (_r, slug) => { calls.run.push(slug); return { v: 1, slug }; },
    lookup: async (_r, slug) => { calls.lookup.push(slug); return { v: 1, slug, links: [] }; },
  };
  const h = await startServer({ root, deps });
  t.after(() => h.close());
  return { h, calls, base: `/t/${h.token}/` };
}

test('AC16: api/run/<ID>%2F<NN>-<pb> returns that run (also %2f and /links)', async (t) => {
  const root = makeRoot(t);
  const { h, calls, base } = await serve(t, root);
  const r = await raw(h.port, { target: `${base}api/run/${PROJ}%2F01-feature` });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).slug, R1);
  const lower = await raw(h.port, { target: `${base}api/run/${PROJ}%2f02-fix` });
  assert.equal(lower.status, 200);
  assert.equal(JSON.parse(lower.body).slug, R2);
  const links = await raw(h.port, { target: `${base}api/run/${PROJ}%2F01-feature/links` });
  assert.equal(links.status, 200);
  assert.deepEqual(calls.run, [R1, R2]);
  assert.deepEqual(calls.lookup, [R1]);
});

test('AC16: malformed or escaping v3 slugs are 404 and never read', async (t) => {
  const root = makeRoot(t);
  const { h, calls, base } = await serve(t, root);
  // A control request proves the server serves a valid v3 slug, so the 404s below are refusals.
  const ok = await raw(h.port, { target: `${base}api/run/${PROJ}%2F01-feature` });
  assert.equal(ok.status, 200);
  calls.run.length = 0;
  const bad = [
    `${PROJ}%252F01-feature`, `${PROJ}%2F01-feature%2Fx`, `${PROJ}%2F..`, `${PROJ}%2F%2E%2E`, `..%2F01-feature`,
    `${PROJ}%5C01-feature`, `${PROJ}%2F01-feature%20`, `${PROJ}%2F09-nothere`, `%2F01-feature`, `${PROJ}%2F`,
    `${PROJ}%2F01-Feature`, `${PROJ}%2Fx1-feature`,
  ];
  for (const part of bad) {
    for (const suffix of ['', '/links']) {
      const r = await raw(h.port, { target: `${base}api/run/${part}${suffix}` });
      assert.equal(r.status, 404, `${part}${suffix}`);
    }
  }
  assert.deepEqual(calls.run, []);
  assert.deepEqual(calls.lookup, []);
});

test('AC16: a v3 run reached through a project folder linked outside the product is 404 and never read', async (t) => {
  const root = makeRoot(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-v2-out-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(outside, '03-fix'));
  try {
    fs.rmSync(path.join(root, '.company', 'work', PROJ2), { recursive: true });
    fs.symlinkSync(outside, path.join(root, '.company', 'work', PROJ2), 'junction');
  } catch (error) {
    t.skip(`links not permitted: ${error.code}`);
    return;
  }
  const { h, calls, base } = await serve(t, root);
  const good = await raw(h.port, { target: `${base}api/run/${PROJ}%2F01-feature` });
  assert.equal(good.status, 200);
  calls.run.length = 0;
  const r = await raw(h.port, { target: `${base}api/run/${PROJ2}%2F03-fix` });
  assert.equal(r.status, 404);
  assert.deepEqual(calls.run, []);
});
