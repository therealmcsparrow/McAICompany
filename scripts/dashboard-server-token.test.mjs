import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './dashboard-server.mjs';
import { raw, emptyBoard } from './dashboard-server-helpers.mjs';

const SLUG = '2026-11-04 01.19 - Token Topic';

async function start(t, root = os.tmpdir()) {
  const deps = {
    board: async () => ({ ...emptyBoard }),
    run: async () => ({ v: 1, slug: SLUG }),
    lookup: async () => ({ v: 1, state: 'none' })
  };
  const h = await startServer({ root, deps });
  t.after(() => h.close());
  return h;
}

test('no prefix, wrong, shorter, old and query-string tokens give 404 on page, asset and api/board', async (t) => {
  const first = await startServer({ root: os.tmpdir(), deps: { board: async () => ({ ...emptyBoard }) } });
  const oldToken = first.token;
  await first.close();
  const h = await start(t);
  const flipped = (h.token[0] === 'A' ? 'B' : 'A') + h.token.slice(1);
  const tokens = [null, flipped, h.token.slice(0, 20), oldToken, `${h.token}x`];
  for (const name of ['', 'live.js', 'api/board']) {
    for (const tk of tokens) {
      const target = tk === null ? `/${name}` : `/t/${tk}/${name}`;
      const r = await raw(h.port, { target });
      assert.equal(r.status, 404, target);
      assert.equal(r.body.includes(h.token), false);
    }
    assert.equal((await raw(h.port, { target: `/t/${h.token}/${name}?x=1` })).status, 404);
    assert.equal((await raw(h.port, { target: `/t/${h.token}/${name}?` })).status, 404);
    assert.equal((await raw(h.port, { target: `/t/${h.token}/${name}` })).status, 200);
  }
});

test('two starts print different tokens of 43 base64url characters', async (t) => {
  const a = await start(t);
  const b = await start(t);
  assert.match(a.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.token, b.token);
  assert.equal(b.urls.every((u) => !u.includes(a.token)), true);
  assert.equal((await raw(b.port, { target: `/t/${a.token}/api/board` })).status, 404);
});

test('the token never appears in a response body or header', async (t) => {
  const h = await start(t);
  const targets = ['', 'board.js', 'drawer.js', 'live.js', 'api/board', 'zzz'].map((n) => `/t/${h.token}/${n}`);
  targets.push('/', `/t/${h.token}`);
  for (const target of targets) {
    const r = await raw(h.port, { target });
    assert.equal(r.body.includes(h.token), false, target);
    assert.equal(JSON.stringify(r.headers).includes(h.token), false, target);
  }
});

test('run slug cases give 404 over HTTP and echo nothing; a real run gives 200', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-token-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.company', 'work', SLUG), { recursive: true });
  const h = await start(t, root);
  const base = `/t/${h.token}/api/run/`;
  const enc = encodeURIComponent;
  const bad = [
    '..', enc('..'), enc('../x'), '%2e%2e', `${enc(SLUG)}%2f..`, enc(SLUG.toLowerCase()), enc('2026-11-04 01.19 - Missing Topic'),
    '%E0%A4%A', `${enc(SLUG)}%00`, 'a'.repeat(301), enc(`${SLUG}/..`), '%252e%252e', 'CON'
  ];
  for (const s of bad) {
    for (const suffix of ['', '/links']) {
      const r = await raw(h.port, { target: `${base}${s}${suffix}` });
      assert.equal(r.status, 404, s);
      assert.deepEqual(JSON.parse(r.body), { error: 'not_found', message: 'Not found' });
    }
  }
  assert.equal((await raw(h.port, { target: `${base}${enc(SLUG)}` })).status, 200);
  assert.equal((await raw(h.port, { target: `${base}${enc(SLUG)}/links` })).status, 200);
  assert.equal((await raw(h.port, { target: `${base}${enc(SLUG)}/other` })).status, 404);
});
