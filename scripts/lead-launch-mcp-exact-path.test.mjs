// Regression for S-4 (security nit, P20261115.000001/01-fix/30-security.md): lead-launch-mcp.mjs newSession ignores the
// exactWorkPath result, so the arm write relies on the earlier `handover read`. A non-'exact' result must give `refused: error`
// and write no arm file. Suspected Module: scripts/lead-launch-mcp.mjs (newSession), not mods/lib/work-folder.mjs.
// Seam: exactWorkPath reads the folders with fs.readdirSync; for the one call made directly by newSession it is made to fail,
// so exactWorkPath answers 'missing' while the folder (and the earlier hand-over read) are fine. Nothing real is started.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newSession } from './lead-launch-mcp.mjs';

const SLUG = 'P20261109.000001/01-feature';
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-mcp-s4-'));
  tmps.push(root);
  const work = path.join(root, '.company', 'work');
  const dir = path.join(work, ...SLUG.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(work, SLUG.split('/')[0], '00-project.md'), 'Demo project\n');
  const now = Date.now();
  const id = '000000000001';
  const rows = [{ v: 1, at: iso(now - 60000), ev: 'start' }, { v: 1, at: iso(now - 50000), ev: 'sub', role: 'backend-engineer', id, phase: 'start' },
    { v: 1, at: iso(now - 40000), ev: 'sub', role: 'backend-engineer', id, phase: 'stop' }];
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const ev = { v: 1, n: 1, at: iso(now - 1000), ev: 'handover', file: 'lead-handoff-1.md', tokens: 85600, window: null, trigger: 'context', session: 'abcdef012345' };
  fs.writeFileSync(path.join(dir, 'lead-handover.jsonl'), `${JSON.stringify(ev)}\n`);
  return { root, dir, now };
}

// True when the frame after exactWorkPath is lead-launch-mcp.mjs, i.e. the direct call in newSession.
function directCall() {
  const frames = String(new Error().stack).split('\n').map((l) => l.trim());
  const i = frames.findIndex((l) => l.startsWith('at exactWorkPath'));
  return i !== -1 && /lead-launch-mcp\.mjs/.test(frames[i + 1] ?? '') && !/lead-launch-mcp-exact-path/.test(frames[i + 1] ?? '');
}

function withFailingExactPath(fn) {
  const real = fs.readdirSync;
  let hits = 0;
  fs.readdirSync = function (...a) {
    if (directCall()) { hits += 1; throw Object.assign(new Error('seam'), { code: 'ENOENT' }); }
    return real.apply(this, a);
  };
  const d = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try { return { r: fn(), hits: () => hits }; } finally { fs.readdirSync = real; Object.defineProperty(process, 'platform', d); }
}

test('S-4: exactWorkPath not "exact" in newSession gives refused: error, no arm file, no helper', () => {
  const fx = fixture();
  const calls = [];
  const { r, hits } = withFailingExactPath(() => newSession(fx.root, fx.now, { start: (argv) => { calls.push(argv); } }));
  assert.ok(hits() > 0, 'the seam hit the exactWorkPath call made by newSession');
  assert.equal(r.isError, true, `expected a refusal, got ${JSON.stringify(r)}`);
  assert.equal(r.content[0].text, 'refused: error');
  assert.ok(!fs.existsSync(path.join(fx.dir, 'lead-replace.json')), 'no arm file written');
  assert.equal(calls.length, 0, 'helper not started');
});
