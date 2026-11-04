import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from './dashboard-server.mjs';
import { raw, emptyBoard } from './dashboard-server-helpers.mjs';

const SERVER = path.join(import.meta.dirname, 'dashboard-server.mjs');

async function start(t, opts = {}) {
  const calls = [];
  const deps = { board: async (...a) => { calls.push(a); return { ...emptyBoard }; }, refreshActive: async (_r, prev) => prev };
  const h = await startServer({ root: os.tmpdir(), deps, ...opts });
  t.after(() => h.close());
  return { h, calls, base: `/t/${h.token}/` };
}

test('default mode binds 127.0.0.1 only and api/board has lan false', async (t) => {
  const { h, calls, base } = await start(t);
  assert.equal(h.server.address().address, '127.0.0.1');
  assert.equal(h.server.address().family, 'IPv4');
  const r = await raw(h.port, { target: `${base}api/board` });
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.lan, false);
  assert.equal(body.v, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 2, 'board(root, options) only');
  assert.equal(JSON.stringify(calls[0]).includes('lan'), false);
  assert.equal(h.warning, null);
  assert.equal(h.urls.length, 1);
  assert.equal(h.urls[0], `aico dashboard: http://127.0.0.1:${h.port}${base}`);
});

test('--lan binds 0.0.0.0, lan true, extra hosts allowed, URL lines and warning', async (t) => {
  const interfaces = () => ({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    eth: [{ address: '192.168.1.5', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }]
  });
  const { h, calls, base } = await start(t, { lan: true, interfaces });
  assert.equal(h.server.address().address, '0.0.0.0');
  const body = JSON.parse((await raw(h.port, { target: `${base}api/board` })).body);
  assert.equal(body.lan, true);
  assert.equal(JSON.stringify(calls[0]).includes('lan'), false);
  assert.equal((await raw(h.port, { target: `${base}api/board`, host: `192.168.1.5:${h.port}` })).status, 200);
  assert.equal((await raw(h.port, { target: `${base}api/board`, host: `fe80::1:${h.port}` })).status, 421);
  assert.deepEqual(h.urls, [
    `aico dashboard: http://127.0.0.1:${h.port}${base}`,
    `aico dashboard (LAN): http://192.168.1.5:${h.port}${base}`
  ]);
  assert.match(h.warning, /^WARNING: LAN mode has no login beyond this link\./);
});

test('421 for a wrong Host, 405 for other methods, 404 for unknown paths, fixed bodies and headers', async (t) => {
  const { h, base } = await start(t);
  const bad = await raw(h.port, { target: `${base}api/board`, host: 'evil.example' });
  assert.equal(bad.status, 421);
  const post = await raw(h.port, { method: 'POST', target: `${base}api/board` });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  const missing = await raw(h.port, { target: `${base}nope/x` });
  assert.equal(missing.status, 404);
  const noSlash = await raw(h.port, { target: `/t/${h.token}` });
  assert.equal(noSlash.status, 404);
  for (const r of [bad, post, missing, noSlash]) {
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['content-security-policy'], /script-src 'self'; /);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    assert.equal(r.body.includes(h.token), false);
    assert.equal(r.body.includes('nope'), false);
  }
  assert.deepEqual(JSON.parse(missing.body), { error: 'not_found', message: 'Not found' });
});

test('page assets are served, ETag gives 304, HEAD has no body', async (t) => {
  const { h, base } = await start(t);
  for (const name of ['', 'board.js', 'drawer.js', 'live.js']) {
    const r = await raw(h.port, { target: base + name });
    assert.equal(r.status, 200, name);
    assert.ok(r.body.length > 0);
    assert.equal(r.body.includes(h.token), false);
  }
  assert.match((await raw(h.port, { target: base })).headers['content-type'], /text\/html/);
  const first = await raw(h.port, { target: `${base}api/board` });
  assert.match(first.headers.etag, /^"[\w-]+"$/);
  const again = await raw(h.port, { target: `${base}api/board`, headers: { 'If-None-Match': first.headers.etag } });
  assert.equal(again.status, 304);
  const head = await raw(h.port, { method: 'HEAD', target: `${base}api/board` });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers.etag, first.headers.etag);
});

test('a board failure answers a fixed 500 without detail', async (t) => {
  const err = t.mock.method(process.stderr, 'write', () => true);
  const h = await startServer({ root: os.tmpdir(), deps: { board: async () => { throw new Error('C:\\secret\\path'); } } });
  t.after(() => h.close());
  const r = await raw(h.port, { target: `/t/${h.token}/api/board` });
  assert.equal(r.status, 500);
  assert.equal(r.body.includes('secret'), false);
  assert.equal(err.mock.calls.every((c) => !String(c.arguments[0]).includes('secret') && !String(c.arguments[0]).includes(h.token)), true);
});

test('server source imports only node: built-ins and the three dashboard modules, reads only the page assets', () => {
  const src = fs.readFileSync(SERVER, 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  for (const i of imports) assert.ok(i.startsWith('node:') || ['./dashboard-data.mjs', './dashboard-run.mjs', './pr-links.mjs'].includes(i), i);
  const fsCalls = [...src.matchAll(/fs\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(fsCalls, ['readFileSync']);
  assert.equal(/writeFile|appendFile|mkdir|unlink|rmSync/.test(src), false);
});

function cli(t, args) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-cli-'));
  const child = spawn(process.execPath, [SERVER, ...args], {
    cwd: home, env: { ...process.env, MCSPARROW_HOME: home, HOME: home, USERPROFILE: home }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const gone = new Promise((r) => child.once('exit', r));
      child.kill();
      await gone;
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  return { child, out: () => out };
}
const until = async (fn) => {
  for (let i = 0; i < 100; i += 1) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timeout');
};
const URL_LINE = /^aico dashboard: http:\/\/127\.0\.0\.1:(\d+)\/t\/([A-Za-z0-9_-]{43})\/$/m;

test('serve prints one token URL; serve --lan adds the warning; tokens differ per start', async (t) => {
  const a = cli(t, ['serve']);
  await until(() => a.out().includes('\n'));
  const m = URL_LINE.exec(a.out());
  assert.ok(m, a.out());
  assert.equal(a.out().includes('WARNING'), false);
  assert.equal((await raw(Number(m[1]), { target: `/t/${m[2]}/api/board` })).status, 200);
  const b = cli(t, ['serve', '--lan']);
  await until(() => b.out().includes('WARNING'));
  const m2 = URL_LINE.exec(b.out());
  assert.ok(m2);
  assert.notEqual(m[2], m2[2]);
  assert.match(b.out(), /WARNING: LAN mode has no login beyond this link\./);
  assert.equal(JSON.parse((await raw(Number(m2[1]), { target: `/t/${m2[2]}/api/board` })).body).lan, true);
});

test('bad flags exit 2 with usage on stderr', async (t) => {
  for (const args of [[], ['serve', '--bogus'], ['serve', '--port', '80'], ['serve', '--port', 'x'], ['serve', '--port']]) {
    const { child } = cli(t, args);
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const code = await new Promise((r) => child.on('exit', r));
    assert.equal(code, 2, args.join(' '));
    assert.match(err, /^usage: node scripts\/dashboard-server\.mjs serve/);
  }
});
