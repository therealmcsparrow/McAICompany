// Regression: the Stop hook (`lead-handover.mjs measure`) timed out in 22 of 25 runs (5 s limit, ~6.5 s typical).
// Cause: measure -> findRun -> run-state.active() fully loads EVERY run folder (all records and every Step file),
// so cost grows with the run history. These tests are deterministic (no wall clock): a child process counts the
// files the hook opens under .company/work while it handles one Stop payload, with many old runs on disk.
// The bound is independent of how many old runs exist, so a fix must skip runs that cannot be active.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const here = import.meta.dirname;
const SCRIPT = path.join(here, 'lead-handover.mjs');
const OLD_RUNS = 120;
const STEPS_PER_RUN = 12;
// Files the hook may open under .company/work: the active run's own files plus a small allowance. Far below
// OLD_RUNS * (STEPS_PER_RUN + 1) = 1560, which is what the unfixed code opens.
const OPEN_BUDGET = 40;
// Stat calls: about 7 per run (runSlugs folder checks, state file, folder mtime); far below the 2400+ of a full walk.
const STAT_BUDGET = OLD_RUNS * 8;

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const HOUR = 3600 * 1000;

function stepFile(n, role) {
  return `---\nstep: ${String(n).padStart(2, '0')}\nrole: ${role}\ntask: t\nstatus: done\nround: 0\nrisk-tier: medium\n---\nBy: ${role}\n## Did\n- x\n`;
}

// OLD_RUNS finished-long-ago runs (every file older than the 12 h stale limit); optionally one live run.
function fixture({ live }) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'stop-cost-')));
  tmps.push(base);
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const work = path.join(root, '.company', 'work');
  fs.mkdirSync(path.join(claudeDir, 'projects', 'p1'), { recursive: true });
  const old = Date.now() - 48 * HOUR;
  for (let i = 0; i < OLD_RUNS; i++) {
    const id = `P2026010${i % 9 + 1}.${String(i + 1).padStart(6, '0')}`;
    const dir = path.join(work, id, '01-fix');
    fs.mkdirSync(dir, { recursive: true });
    const rs = path.join(dir, 'run-state.jsonl');
    fs.writeFileSync(rs, `${JSON.stringify({ v: 1, at: iso(old), ev: 'start' })}\n`);
    fs.utimesSync(rs, old / 1000, old / 1000);
    for (let s = 1; s <= STEPS_PER_RUN; s++) {
      const f = path.join(dir, `${String(s).padStart(2, '0')}-qa.md`);
      fs.writeFileSync(f, stepFile(s, 'qa', old));
      fs.utimesSync(f, old / 1000, old / 1000);
    }
    fs.utimesSync(dir, old / 1000, old / 1000); // the folder mtime moves on file creation: age it too
  }
  if (live) {
    const dir = path.join(work, 'P20261126.000001', '01-fix');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now() - 60000), ev: 'start' })}\n`);
    fs.writeFileSync(path.join(dir, '01-qa.md'), stepFile(1, 'qa', Date.now()));
  }
  const transcript = path.join(claudeDir, 'projects', 'p1', 'session.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000 } } })}\n`);
  return { root, claudeDir, work, transcript };
}

// Child: counts every file open / whole-file read under .company/work while measure() runs once.
const CHILD = `
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
const [work, payload, root, claudeDir, script] = process.argv.slice(1);
const seen = new Set(); let calls = 0; let stats = 0;
for (const name of ['openSync', 'readFileSync', 'opendirSync']) {
  const orig = fs[name];
  fs[name] = function (p, ...rest) { if (typeof p === 'string' && p.startsWith(work)) { calls++; seen.add(p); } return orig.call(this, p, ...rest); };
}
for (const name of ['lstatSync', 'statSync']) {
  const orig = fs[name];
  fs[name] = function (p, ...rest) { if (typeof p === 'string' && p.startsWith(work)) stats++; return orig.call(this, p, ...rest); };
}
syncBuiltinESMExports();
const { measure } = await import(pathToFileURL(script).href);
const t0 = performance.now();
measure(payload, { root, claudeDir, env: {} });
console.log(JSON.stringify({ calls, stats, files: seen.size, ms: Math.round(performance.now() - t0) }));
`;

function run(fx) {
  const payload = JSON.stringify({ hook_event_name: 'Stop', transcript_path: fx.transcript, session_id: 'sess-1' });
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD, fx.work, payload, fx.root, fx.claudeDir, SCRIPT], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('Stop measure with one live run opens a bounded number of files, not every old run', () => {
  const fx = fixture({ live: true });
  const m = run(fx);
  assert.ok(m.calls <= OPEN_BUDGET, `measure opened ${m.calls} files (${m.files} distinct) under .company/work with ${OLD_RUNS} old runs; budget ${OPEN_BUDGET} (took ${m.ms} ms)`);
  // sanity: it still found the live run and stored the reading
  assert.ok(fs.existsSync(path.join(fx.work, 'P20261126.000001', '01-fix', 'lead-context.json')), 'reading not written for the live run');
});

test('Stop measure with no live run opens a bounded number of files, not every old run', () => {
  const fx = fixture({ live: false });
  const m = run(fx);
  assert.ok(m.calls <= OPEN_BUDGET, `measure opened ${m.calls} files (${m.files} distinct) with ${OLD_RUNS} stale runs and no live run; budget ${OPEN_BUDGET} (took ${m.ms} ms)`);
  // Idle runs cost O(1) stats: the unfixed walk does OLD_RUNS * (STEPS_PER_RUN + 1) = 1560 or more.
  assert.ok(m.stats <= STAT_BUDGET, `measure made ${m.stats} stat calls with ${OLD_RUNS} stale runs; budget ${STAT_BUDGET}`);
});

// Edge coverage for the stat-only prefilter in run-state active(): it must never hide a run that is really active.
import { active } from './run-state.mjs';

function mkRun(work, id, { recAt, rsMtime, step }) {
  const dir = path.join(work, id, '01-fix');
  fs.mkdirSync(dir, { recursive: true });
  const rs = path.join(dir, 'run-state.jsonl');
  fs.writeFileSync(rs, `${JSON.stringify({ v: 1, at: iso(recAt), ev: 'start' })}\n`);
  fs.utimesSync(rs, rsMtime / 1000, rsMtime / 1000);
  if (step !== undefined) {
    const f = path.join(dir, '01-qa.md');
    fs.writeFileSync(f, stepFile(1, 'qa', step));
    fs.utimesSync(f, step / 1000, step / 1000);
  }
  return `${id}/01-fix`;
}

function root2() {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'stop-edge-')));
  tmps.push(base);
  return { root: base, work: path.join(base, '.company', 'work') };
}

test('active() still finds a recently active run with an old-named id', () => {
  const { root, work } = root2();
  const now = Date.now();
  const slug = mkRun(work, 'P20260101.000001', { recAt: now - 60000, rsMtime: now - 60000 });
  assert.equal(active(root, { now })?.slug, slug);
});

test('active() still finds a run whose state file is old but a Step file is fresh', () => {
  const { root, work } = root2();
  const now = Date.now();
  const slug = mkRun(work, 'P20260102.000001', { recAt: now - 20 * HOUR, rsMtime: now - 20 * HOUR, step: now - 60000 });
  assert.equal(active(root, { now })?.slug, slug);
});

test('active() picks the most recently active run among old-named and new-named runs', () => {
  const { root, work } = root2();
  const now = Date.now();
  mkRun(work, 'P20260103.000001', { recAt: now - 3000, rsMtime: now - 3000 });
  mkRun(work, 'P20261126.000009', { recAt: now - 5 * HOUR, rsMtime: now - 5 * HOUR });
  mkRun(work, 'P20260104.000001', { recAt: now - 40 * HOUR, rsMtime: now - 40 * HOUR });
  assert.equal(active(root, { now })?.slug, 'P20260103.000001/01-fix');
});

test('active() returns null when every run is older than the stale window', () => {
  const { root, work } = root2();
  const now = Date.now();
  mkRun(work, 'P20260105.000001', { recAt: now - 30 * HOUR, rsMtime: now - 30 * HOUR, step: now - 30 * HOUR });
  assert.equal(active(root, { now }).slug, null);
});
