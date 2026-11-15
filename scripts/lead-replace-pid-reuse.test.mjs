import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// QA regression for S-1 (.company/work/P20261115.000001/01-fix/30-security.md): scripts/lead-replace.mjs never re-checks claudePid
// after start, so a reused pid gets /clear + Enter. Seams pinned here (new, optional deps):
//   turnOver({ ..., claudePid, alive })  -> 'failed: session gone' once alive(claudePid) is false, checked every poll.
//   typeInto(text, { ..., alive, identify, baseline }) -> before EACH send: !alive(pid) -> 'failed: session gone';
//     identify(pid) -> { image, created } differing from baseline -> 'failed: session gone'. No keystrokes (run) in either case.
const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, 'lead-replace.mjs');
const load = () => import(pathToFileURL(SCRIPT).href);

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const T0 = Date.parse('2026-11-15T10:00:00Z');
const FROZEN = 'abcdef012345';
const CLAUDE = 4242;

function runDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-replace-pid-'));
  tmps.push(dir);
  return dir;
}
const reading = (dir, session, atMs) => fs.writeFileSync(path.join(dir, 'lead-context.json'),
  `${JSON.stringify({ v: 1, session, ctx: 1000, peak: 170000, at: iso(atMs), ttl: null })}\n`);

function clock(onSleep = () => {}) {
  const c = { t: T0, calls: 0 };
  c.now = () => c.t;
  c.sleep = async (ms) => {
    c.calls += 1;
    if (c.calls > 400) throw new Error('runaway loop');
    c.t += ms;
    onSleep(c);
  };
  return c;
}

describe('S-1 PID reuse', () => {
  test('turnOver stops with failed: session gone when claude dies while waiting', async () => {
    const { turnOver } = await load();
    const dir = runDir();
    let up = true;
    const c = clock((k) => { if (k.calls >= 2) up = false; });
    const r = await turnOver({ dir, session: FROZEN, armAt: iso(T0), claudePid: CLAUDE, alive: () => up, now: c.now, sleep: c.sleep });
    assert.equal(r, 'failed: session gone');
  });

  test('typeInto types nothing when the pid died before /clear', async () => {
    const { typeInto } = await load();
    const dir = runDir();
    const sent = [];
    const c = clock();
    const r = await typeInto('hello', {
      platform: 'win32', run: async (a, i) => { sent.push(String(i)); return { status: 0 }; },
      dir, session: FROZEN, claudePid: CLAUDE, alive: () => false, now: c.now, sleep: c.sleep,
    });
    assert.equal(r, 'failed: session gone');
    assert.deepEqual(sent, []);
  });

  test('typeInto does not send the hand-over text when the pid died after /clear', async () => {
    const { typeInto } = await load();
    const dir = runDir();
    const sent = [];
    let up = true;
    const c = clock();
    reading(dir, 'newsession0001', T0);
    const r = await typeInto('hello', {
      platform: 'win32', run: async (a, i) => { sent.push(String(i)); up = false; return { status: 0 }; },
      dir, session: FROZEN, claudePid: CLAUDE, alive: () => up, now: c.now, sleep: c.sleep,
    });
    assert.equal(r, 'failed: session gone');
    assert.deepEqual(sent, ['/clear\r']);
  });

  test('typeInto refuses when the pid now has another creation time (reuse)', async () => {
    const { typeInto } = await load();
    const dir = runDir();
    const sent = [];
    const c = clock();
    const r = await typeInto('hello', {
      platform: 'win32', run: async (a, i) => { sent.push(String(i)); return { status: 0 }; },
      dir, session: FROZEN, claudePid: CLAUDE, alive: () => true,
      baseline: { image: 'claude.exe', created: T0 }, identify: async () => ({ image: 'claude.exe', created: T0 + 99999 }),
      now: c.now, sleep: c.sleep,
    });
    assert.equal(r, 'failed: session gone');
    assert.deepEqual(sent, []);
  });
});
