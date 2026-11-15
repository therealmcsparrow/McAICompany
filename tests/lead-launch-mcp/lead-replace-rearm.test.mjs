import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { contextHandover } from '../../scripts/lead-handover.mjs';
import { newSession } from '../../scripts/lead-launch-mcp.mjs';

// A second hand-over in one run arms and starts again; a turn that starts after the last background task ended is not typed into.

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-rearm-'));
  tmps.push(root);
  const slug = 'demo-run';
  const dir = path.join(root, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const id = '000000000001';
  const rows = [{ v: 1, at: iso(now - 60000), ev: 'start' }, { v: 1, at: iso(now - 50000), ev: 'sub', role: 'backend-engineer', id, phase: 'start' }, { v: 1, at: iso(now - 40000), ev: 'sub', role: 'backend-engineer', id, phase: 'stop' }];
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return { root, slug, dir };
}
function call(root, start) {
  const d = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try { return newSession(root, Date.now(), { start }); } finally { Object.defineProperty(process, 'platform', d); }
}

describe('lead_new_session arms per session', () => {
  test('a second hand-over with a new session replaces the arm file and starts a second helper', () => {
    const fx = fixture();
    const calls = [];
    const start = (argv) => { calls.push(argv); };
    contextHandover(fx.root, fx.slug, { tokens: 85600, session: 'aaaaaaaaaaaa' });
    assert.equal(call(fx.root, start).isError, undefined);
    fs.writeFileSync(path.join(fx.dir, 'lead-replace.json'), `${JSON.stringify({ v: 1, session: 'aaaaaaaaaaaa', armAt: iso(Date.now()), state: 'typed' })}\n`);
    contextHandover(fx.root, fx.slug, { tokens: 85700, session: 'bbbbbbbbbbbb' });
    const r = call(fx.root, start);
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.equal(calls.length, 2, 'second helper started');
    const a = JSON.parse(fs.readFileSync(path.join(fx.dir, 'lead-replace.json'), 'utf8'));
    assert.equal(a.session, 'bbbbbbbbbbbb');
    assert.equal(a.state, 'waiting-background');
    assert.deepEqual(fs.readdirSync(fx.dir).filter((f) => f.endsWith('.tmp')), [], 'no temp file left');
  });

  test('the same session twice starts one helper only', () => {
    const fx = fixture();
    const calls = [];
    contextHandover(fx.root, fx.slug, { tokens: 85600, session: 'aaaaaaaaaaaa' });
    call(fx.root, (a) => calls.push(a));
    call(fx.root, (a) => calls.push(a));
    assert.equal(calls.length, 1);
  });
});

describe('turnOver idle seam', () => {
  const T0 = Date.parse('2026-11-15T10:00:00Z');
  const FROZEN = 'abcdef012345';
  const load = () => import(pathToFileURL(path.join(repo, 'scripts', 'lead-replace.mjs')).href);
  const reading = (dir, atMs) => fs.writeFileSync(path.join(dir, 'lead-context.json'), `${JSON.stringify({ v: 1, session: FROZEN, ctx: 1, peak: 2, at: iso(atMs), ttl: null })}\n`);
  function clock(onTick) {
    const c = { t: T0 + 100000 };
    c.now = () => c.t;
    c.sleep = async (ms) => { c.t += ms; onTick(c.t); };
    return c;
  }

  test('the Stop reading from before the idle moment does not count; a newer one does', async () => {
    const { turnOver } = await load();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-idle-'));
    tmps.push(dir);
    reading(dir, T0 + 5000);                     // turn that called the tool
    const idleAt = T0 + 100000;                  // last background task seen ended
    const c = clock((t) => { if (t >= T0 + 160000) reading(dir, T0 + 160000); });  // the turn started by the completion notice stops
    assert.equal(await turnOver({ dir, session: FROZEN, armAt: iso(T0), idleAt, now: c.now, sleep: c.sleep }), 'done');
    assert.ok(c.t >= T0 + 160000, 'must wait for the later Stop');
  });

  test('without a later Stop it fails after 10 minutes', async () => {
    const { turnOver } = await load();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-idle-'));
    tmps.push(dir);
    reading(dir, T0 + 5000);
    const c = clock(() => {});
    assert.equal(await turnOver({ dir, session: FROZEN, armAt: iso(T0), idleAt: T0 + 100000, now: c.now, sleep: c.sleep }), 'failed: turn');
  });
});
