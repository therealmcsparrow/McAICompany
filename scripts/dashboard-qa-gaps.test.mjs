// QA gap tests: AC3 under --lan, AC5 (35 s bound for other and new runs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './dashboard-server.mjs';
import { raw, emptyBoard } from './dashboard-server-helpers.mjs';
import { NEW, NEW2, view, makeDeps, entry } from './dashboard-board-fixtures.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugs = (b) => b.columns.flatMap((c) => c.cards).map((x) => x.slug);

test('AC3: under --lan unknown paths 404, other methods 405, nothing is read or changed', async (t) => {
  let boards = 0;
  const deps = { board: async () => { boards += 1; return { ...emptyBoard }; }, refreshActive: async (_r, p) => p };
  const h = await startServer({ root: os.tmpdir(), deps, lan: true, interfaces: () => ({}) });
  t.after(() => h.close());
  const base = `/t/${h.token}/`;
  const before = boards;
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = await raw(h.port, { method, target: `${base}api/board` });
    assert.equal(r.status, 405, method);
    assert.equal(r.body.includes('api/board'), false);
  }
  const miss = await raw(h.port, { target: `${base}secret-path` });
  assert.equal(miss.status, 404);
  assert.equal(miss.body.includes('secret-path'), false);
  assert.equal(boards, before, 'refused requests do not trigger a board read');
  const bad = await raw(h.port, { target: `${base}api/board`, host: 'evil.example' });
  assert.equal(bad.status, 421);
  assert.equal(bad.body.includes('evil.example'), false);
});

test('AC5: a change to another run and a new run show up in api/board by the next full refresh', async (t) => {
  const views = { [NEW]: view(), [NEW2]: view({ round: 0 }) };
  let runs = [entry(NEW)];
  const { deps } = makeDeps({ runs, views, active: NEW });
  deps.list = () => ({ runs });
  const h = await startServer({ root: os.tmpdir(), boardDeps: deps, fullMs: 60, activeMs: 20 });
  t.after(() => h.close());
  const target = `/t/${h.token}/api/board`;
  const first = await raw(h.port, { target });
  assert.deepEqual(slugs(JSON.parse(first.body)), [NEW]);
  runs = [entry(NEW), entry(NEW2)];
  let seen = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 3000 && !seen) {
    const r = await raw(h.port, { target });
    const b = JSON.parse(r.body);
    if (slugs(b).includes(NEW2)) seen = b;
    else await sleep(30);
  }
  assert.ok(seen, 'new run appears after a full refresh');
});

test('AC5: the shipped full-refresh interval is within 35 s and the active one within 5 s', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, 'dashboard-server.mjs'), 'utf8');
  assert.ok(Number(/FULL_MS = (\d+)/.exec(src)[1]) <= 35000 - 2000 * 2);
  assert.ok(Number(/ACTIVE_MS = (\d+)/.exec(src)[1]) <= 5000 - 2000 * 1.5);
});
