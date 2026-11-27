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
import { active } from './run-state.mjs';

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

test('active() skips a run whose Step file was edited in place while the folder mtime is old', () => {
  const { root, work } = root2();
  const now = Date.now();
  const slug = mkRun(work, 'P20260106.000001', { recAt: now - 20 * HOUR, rsMtime: now - 20 * HOUR, step: now - 60000 });
  const old = (now - 20 * HOUR) / 1000;
  fs.utimesSync(path.join(work, slug.split('/')[0], '01-fix'), old, old);
  assert.equal(active(root, { now }).slug, null);
});

test('active() skips a run whose folder is fresh but every file is stale', () => {
  const { root, work } = root2();
  const now = Date.now();
  mkRun(work, 'P20260107.000001', { recAt: now - 30 * HOUR, rsMtime: now - 30 * HOUR, step: now - 30 * HOUR });
  // folder mtime is fresh from file creation: leave it
  assert.equal(active(root, { now }).slug, null);
});

// Name cap (MAX_NAMES = 1000 in run-state.mjs). Filler names start with "0a", so they sort BEFORE every Step name and
// before the state file in readdir order: a plain readdir().slice(0, 1000) would drop the fresh Step.
const CAP = 1000;
// Fillers are aged 20 h: a dropped Step must not be masked by a fresh filler mtime.
const fillers = (dir, n) => {
  const old = (Date.now() - 20 * HOUR) / 1000;
  for (let i = 0; i < n; i++) {
    const f = path.join(dir, `0a${String(i).padStart(4, '0')}.txt`);
    fs.writeFileSync(f, 'x');
    fs.utimesSync(f, old, old);
  }
};

test('active() still finds a fresh Step file in a folder with more files than the name cap', () => {
  const { root, work } = root2();
  const now = Date.now();
  const slug = mkRun(work, 'P20260108.000001', { recAt: now - 20 * HOUR, rsMtime: now - 20 * HOUR });
  const dir = path.join(work, 'P20260108.000001', '01-fix');
  fillers(dir, CAP + 100);
  fs.writeFileSync(path.join(dir, '99-qa.md'), stepFile(99, 'qa'));
  assert.equal(active(root, { now })?.slug, slug);
});

// Child: counts lstat/stat calls on names inside the run folder while active() runs once.
const CAP_CHILD = `
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
const [root, dir, script] = process.argv.slice(1);
let n = 0;
for (const name of ['lstatSync', 'statSync']) {
  const orig = fs[name];
  fs[name] = function (p, ...rest) { if (typeof p === 'string' && p.startsWith(dir) && p.length > dir.length) n++; return orig.call(this, p, ...rest); };
}
syncBuiltinESMExports();
const { active } = await import(pathToFileURL(script).href);
const r = active(root, { now: Date.now() });
console.log(JSON.stringify({ slug: r.slug, stats: n }));
`;

test('active() stats at most the name cap of names in an over-cap run folder', () => {
  const { root, work } = root2();
  const now = Date.now();
  mkRun(work, 'P20260109.000001', { recAt: now - 20 * HOUR, rsMtime: now - 20 * HOUR });
  const dir = path.join(work, 'P20260109.000001', '01-fix');
  fillers(dir, CAP + 500);
  fs.writeFileSync(path.join(dir, '99-qa.md'), stepFile(99, 'qa'));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CAP_CHILD, root, dir, path.join(here, 'run-state.mjs')], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(m.slug, 'P20260109.000001/01-fix');
  // CAP names plus the state-file prefilter stat and slack; an uncapped walk is 1600+.
  assert.ok(m.stats <= CAP + 10, `active() made ${m.stats} stat calls inside the folder; cap ${CAP} (+10)`);
  assert.ok(m.stats >= 100, `counter saw only ${m.stats} stat calls: the probe is not measuring the folder walk`);
});

test('active() keeps the numerically newest 3-digit Step when Step files exceed the name cap (R-14)', () => {
  const { root, work } = root2();
  const now = Date.now();
  const slug = mkRun(work, 'P20260110.000001', { recAt: now - 20 * HOUR, rsMtime: now - 20 * HOUR });
  const dir = path.join(work, 'P20260110.000001', '01-fix');
  const old = (now - 20 * HOUR) / 1000;
  // Steps 10..100 x 12 roles = 1092 Step files (> CAP). Lexicographic order ranks 99-* above 100-*, so a
  // lexicographic keep-1000 drops every 100-* file; numeric order keeps 100 first.
  for (let n = 10; n <= 100; n++) {
    for (let r = 1; r <= 12; r++) {
      const f = path.join(dir, `${n}-r${String(r).padStart(2, '0')}.md`);
      fs.writeFileSync(f, stepFile(n, 'qa'));
      fs.utimesSync(f, old, old);
    }
  }
  fs.utimesSync(path.join(dir, '100-r01.md'), now / 1000, now / 1000); // the only fresh file
  assert.equal(active(root, { now })?.slug, slug);
});

// R-15: the state file decides first. A stale state file in a stale folder ends the check with no walk over the Step
// files, however many there are. Asserted by outcome and by stat calls inside the folder (not wall-clock time).
function oldStepRun(id, steps) {
  const { root, work } = root2();
  const now = Date.now();
  mkRun(work, id, { recAt: now - 20 * HOUR, rsMtime: now - 20 * HOUR });
  const dir = path.join(work, id, '01-fix');
  const old = (now - 20 * HOUR) / 1000;
  // Real Step names (NN-role.md, 2 or 3 digits): Steps 10..93 x 12 roles (1000 files: Step 93 has 4).
  for (let i = 0; i < steps; i++) {
    const n = 10 + Math.floor(i / 12);
    const f = path.join(dir, `${n}-r${String(i % 12 + 1).padStart(2, '0')}.md`);
    fs.writeFileSync(f, stepFile(n, 'qa'));
    fs.utimesSync(f, old, old);
  }
  return { root, dir, old };
}
const statsOf = (root, dir) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CAP_CHILD, root, dir, path.join(here, 'run-state.mjs')], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};

test('active() decides from run-state.jsonl and does no per-file stat over 1000 Step files (R-15)', () => {
  const { root, dir, old } = oldStepRun('P20260111.000001', 1000);
  fs.utimesSync(dir, old, old); // folder aged like the state file: the cheap checks decide
  const m = statsOf(root, dir);
  assert.equal(m.slug, null);
  assert.ok(m.stats <= 5, `active() made ${m.stats} stat calls inside the folder; the state file alone should decide`);
});

test('active() keeps a run active when only run-state.jsonl is fresh: aged folder, 1000 aged Step files (R-1)', () => {
  const { root, dir, old } = oldStepRun('P20260113.000001', 1000);
  const now = Date.now();
  const rs = path.join(dir, 'run-state.jsonl');
  fs.writeFileSync(rs, `${JSON.stringify({ v: 1, at: iso(now - 60000), ev: 'start' })}\n`);
  fs.utimesSync(rs, (now - 60000) / 1000, (now - 60000) / 1000);
  fs.utimesSync(dir, old, old); // appending a record does not move the folder mtime: only the state file is fresh
  assert.equal(active(root, { now })?.slug, 'P20260113.000001/01-fix');
});

test('active() probe sees the Step-file walk when the folder is fresh over 1000 Step files (R-15 control)', () => {
  const { root, dir } = oldStepRun('P20260112.000001', 1000); // folder mtime is fresh from file creation
  const m = statsOf(root, dir);
  assert.equal(m.slug, null); // every file is stale: still idle, but only after the walk
  assert.ok(m.stats >= 900, `counter saw only ${m.stats} stat calls: the probe is not measuring the folder walk`);
});
