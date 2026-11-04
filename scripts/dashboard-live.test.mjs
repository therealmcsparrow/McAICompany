import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { startServer } from './dashboard-server.mjs';
import { raw, emptyBoard } from './dashboard-server-helpers.mjs';
import { NEW, view, makeDeps, entry } from './dashboard-board-fixtures.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const card = (b) => b.columns.flatMap((c) => c.cards).find((x) => x.slug === NEW);

test('a changed run-state line of the active run shows in api/board within 5 s', async (t) => {
  const views = { [NEW]: view({ round: 0 }) };
  const { deps } = makeDeps({ runs: [entry(NEW)], views, active: NEW });
  const h = await startServer({ root: os.tmpdir(), boardDeps: deps });
  t.after(() => h.close());
  const target = `/t/${h.token}/api/board`;
  const first = await raw(h.port, { target });
  assert.equal(card(JSON.parse(first.body)).round, 0);
  views[NEW] = view({ round: 3 });
  const started = Date.now();
  let seen = null;
  while (Date.now() - started < 5000) {
    const r = await raw(h.port, { target, headers: { 'If-None-Match': first.headers.etag } });
    if (r.status === 200) {
      seen = JSON.parse(r.body);
      break;
    }
    await sleep(500);
  }
  assert.ok(seen, 'board changed within 5 s');
  assert.equal(card(seen).round, 3);
});

test('refresh stops when no request came for a minute', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let full = 0;
  const h = await startServer({
    root: os.tmpdir(), fullMs: 20, activeMs: 10,
    deps: { board: async () => { full += 1; return { ...emptyBoard }; }, refreshActive: async (_r, p) => p }
  });
  t.after(() => h.close());
  await raw(h.port, { target: `/t/${h.token}/api/board` });
  await sleep(150);
  assert.ok(full > 1, 'full refresh ran while active');
  t.mock.timers.tick(61000);
  await sleep(80);
  const after = full;
  await sleep(150);
  assert.equal(full, after, 'no refresh after idle');
});
