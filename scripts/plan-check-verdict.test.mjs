import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { main, median, catBlobArgs } from './plan-check-verdict.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-check-verdict-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

// git must never read the real user or system configuration.
const gitConfig = path.join(base, 'gitconfig');
fs.writeFileSync(gitConfig, '');
process.env.GIT_CONFIG_GLOBAL = gitConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CEILING_DIRECTORIES = base;
const script = path.join(import.meta.dirname, 'plan-check-verdict.mjs');

let n = 0;
function git(root, args, date) {
  const env = { ...process.env };
  if (date) { env.GIT_AUTHOR_DATE = date; env.GIT_COMMITTER_DATE = date; }
  const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function repo({ init = true } = {}) {
  const root = path.join(base, `r${n++}`);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  fs.mkdirSync(path.join(root, '.company', 'ledger'), { recursive: true });
  if (init) {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'core.excludesFile', gitConfig]);
    git(root, ['commit', '--quiet', '--allow-empty', '--message=init'], '2026-10-01T00:00:00Z');
  }
  return root;
}
const put = (root, rel, text) => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
function commit(root, date) {
  git(root, ['add', '--all'], date);
  git(root, ['commit', '--quiet', '--message=x', '--allow-empty'], date);
}
const stepText = round => `---\nstep: 03\nrole: backend-engineer\ntask: x\nstatus: done\nround: ${round}\nbase-commit: abc1234\nrisk-tier: medium\n---\n## Did\n`;
const touch = (root, rel, iso) => { const t = new Date(iso); fs.utimesSync(path.join(root, ...rel.split('/')), t, t); };
const day = order => `2026-10-${String(10 + order).padStart(2, '0')}`;

// One finished run. side: 'on' | 'off' | 'none'. fix: the recorded ledger value (null = no ledger line).
// rounds: the round of each Step file. late: rounds of Step files committed after the ship gate answer.
function addRun(root, { slug, order, side = 'none', fix, rounds, late = [], findings = 0, waved = 0, ledgerText }) {
  const d = day(order);
  const dir = `.company/work/${slug}`;
  put(root, `${dir}/00-summary.md`, '# done\n');
  put(root, `${dir}/02-plan.md`, '# Plan\n');
  rounds.forEach((r, i) => {
    const rel = `${dir}/${String(3 + i).padStart(2, '0')}-backend-engineer.md`;
    put(root, rel, stepText(r));
    touch(root, rel, `${d}T10:00:00Z`);
  });
  put(root, `${dir}/run-state.jsonl`, [
    { v: 1, at: `${d}T08:00:00Z`, ev: 'start' },
    { v: 1, at: `${d}T09:00:00Z`, ev: 'gate', gate: 'plan', result: 'passed' },
    { v: 1, at: `${d}T12:00:00Z`, ev: 'gate', gate: 'ship', result: late.length ? 'changed' : 'passed' }
  ].map(o => JSON.stringify(o)).join('\n') + '\n');
  if (side === 'on') {
    put(root, `${dir}/plan-check.jsonl`, [
      { v: 1, at: `${d}T08:30:00Z`, ev: 'scan', policy: 'warn', plan: '02-plan.md', patterns: 'abcdef012345', findings, decided: 0 },
      { v: 1, at: `${d}T08:40:00Z`, ev: 'wave', waved }
    ].map(o => JSON.stringify(o)).join('\n') + '\n');
  } else if (side === 'off') {
    put(root, `${dir}/plan-check.jsonl`, `${JSON.stringify({ v: 1, at: `${d}T08:30:00Z`, ev: 'off', policy: 'off' })}\n`);
  }
  if (ledgerText !== undefined) put(root, `.company/ledger/${slug}.jsonl`, ledgerText);
  else if (fix !== null && fix !== undefined) {
    put(root, `.company/ledger/${slug}.jsonl`, `${JSON.stringify({ v: 1, run: slug, kind: 'ship', acs: 3, fix_rounds: fix })}\n`);
  }
  commit(root, `${d}T10:00:00Z`);
  if (late.length) {
    late.forEach((r, i) => {
      const rel = `${dir}/${String(40 + i).padStart(2, '0')}-backend-engineer.md`;
      put(root, rel, stepText(r));
      touch(root, rel, `${d}T14:00:00Z`);
    });
    commit(root, `${d}T14:00:00Z`);
  }
}
// A side of `count` runs with the given recorded values (and matching Step rounds).
function addSide(root, side, prefix, values, firstOrder, extra = []) {
  values.forEach((v, i) => addRun(root, { slug: `${prefix}-${i}`, order: firstOrder + i, side, fix: v, rounds: [0, v], ...(extra[i] ?? {}) }));
}
const run = (root, args) => main(args, { root });
const oneLine = r => { assert.equal(r.lines.length, 1); return r.lines[0]; };

function treeHash(root) {
  const h = crypto.createHash('sha256');
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else { h.update(path.relative(root, f)); h.update(fs.readFileSync(f)); }
    }
  };
  walk(root);
  return h.digest('hex');
}

test('median: middle value, mean of the two middle values for an even count', () => {
  assert.equal(median([]), null);
  assert.equal(median([3]), 3);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 2, 4]), 2);
  assert.equal(median([1, 2]), 1.5);
});

test('verdict passes at a drop of exactly 1', () => {
  const root = repo();
  addSide(root, 'none', 'b', [2, 2, 2], 0);
  addSide(root, 'on', 'o', [1, 1, 1], 3);
  const r = run(root, ['verdict', '--runs', '3']);
  assert.equal(r.code, 0);
  assert.equal(oneLine(r), 'plan-check verdict: pass | check on: median 1.0 (n=3) | baseline: median 2.0 (n=3) | waved off n/a');
});

test('verdict fails at a drop of 0.5 and says the default should become off', () => {
  const root = repo();
  addSide(root, 'none', 'b', [2, 2, 2, 2], 0);
  addSide(root, 'on', 'o', [1, 2, 1, 2], 4);
  const line = oneLine(run(root, ['verdict', '--runs', '4']));
  assert.equal(line, 'plan-check verdict: fail | check on: median 1.5 (n=4) | baseline: median 2.0 (n=4) | waved off n/a | default should become off');
});

test('verdict fails when the check-on side is worse', () => {
  const root = repo();
  addSide(root, 'none', 'b', [1, 1, 1], 0);
  addSide(root, 'on', 'o', [3, 3, 3], 3);
  assert.match(oneLine(run(root, ['verdict', '--runs', '3'])), /^plan-check verdict: fail \|/);
});

test('verdict is insufficient when one side is short; the off side counts as baseline', () => {
  const root = repo();
  addSide(root, 'off', 'b', [2, 2, 2], 0);
  addSide(root, 'on', 'o', [1, 1], 3);
  const line = oneLine(run(root, ['verdict', '--runs', '3']));
  assert.match(line, /^plan-check verdict: insufficient \(n=2\) \| check on: median 1\.0 \(n=2\) \| baseline: median 2\.0 \(n=3\)/);
  assert.doesNotMatch(line, /default should become off/);
});

test('verdict with no runs at all is insufficient and shows ? for the medians', () => {
  const root = repo();
  assert.equal(oneLine(run(root, ['verdict'])), 'plan-check verdict: insufficient (n=0) | check on: median ? (n=0) | baseline: median ? (n=0) | waved off n/a');
});

test('the default is 5 runs per side and only the newest runs count', () => {
  const root = repo();
  addSide(root, 'none', 'old', [9, 9], 0);
  addSide(root, 'none', 'b', [2, 2, 2, 2, 2], 2);
  addSide(root, 'on', 'o', [1, 1, 1, 1, 1], 7);
  assert.equal(oneLine(run(root, ['verdict'])), 'plan-check verdict: pass | check on: median 1.0 (n=5) | baseline: median 2.0 (n=5) | waved off n/a');
});

test('waved-off share: 31 percent gets retune, 30 percent does not', () => {
  for (const [waved, expected] of [[[20, 10, 1], 'waved off 31% retune'], [[20, 10, 0], 'waved off 30%']]) {
    const root = repo();
    addSide(root, 'none', 'b', [2, 2, 2], 0);
    addSide(root, 'on', 'o', [1, 1, 1], 3, [50, 30, 20].map((findings, i) => ({ findings, waved: waved[i] })));
    const line = oneLine(run(root, ['verdict', '--runs', '3']));
    assert.ok(line.endsWith(expected), line);
  }
});

test('a run whose recorded value differs from its work files is left out with a warning', () => {
  const root = repo();
  addSide(root, 'none', 'b', [2, 2, 2], 0);
  addSide(root, 'on', 'o', [1, 1, 1], 3);
  addRun(root, { slug: 'odd', order: 6, side: 'on', fix: 1, rounds: [0, 3] });
  const r = run(root, ['verdict', '--runs', '3']);
  assert.match(oneLine(r), /^plan-check verdict: pass .* \| warnings: 1$/);
  assert.deepEqual(r.warnings, ['odd: fix rounds 1 vs handoffs 3']);
});

test('a run with no ledger value, or a ledger with no ship line, is left out', () => {
  const root = repo();
  addSide(root, 'none', 'b', [2, 2, 2], 0);
  addSide(root, 'on', 'o', [1, 1, 1], 3);
  addRun(root, { slug: 'noledger', order: 6, side: 'on', fix: null, rounds: [0, 1] });
  addRun(root, { slug: 'noship', order: 7, side: 'on', rounds: [0, 1], ledgerText: `${JSON.stringify({ v: 1, run: 'noship', kind: 'total', id: 'abcdef01', role: 'lead', src: 'transcript', tokens: { in: 1, cache_write: 0, cache_read: 0, out: 1 }, dispatches: 1 })}\n` });
  addRun(root, { slug: 'nokey', order: 8, side: 'on', rounds: [0, 1], ledgerText: `${JSON.stringify({ v: 1, run: 'nokey', kind: 'ship', acs: 1 })}\n` });
  const r = run(root, ['verdict', '--runs', '3']);
  assert.deepEqual(r.warnings.sort(), ['nokey: fix rounds none vs handoffs 1', 'noledger: fix rounds none vs handoffs 1', 'noship: fix rounds none vs handoffs 1']);
  assert.match(oneLine(r), /warnings: 3$/);
});

test('a work file committed after the first ship gate answer does not raise the work-file value', () => {
  const root = repo();
  addSide(root, 'none', 'b', [2, 2, 2], 0);
  addSide(root, 'on', 'o', [1, 1], 3);
  addRun(root, { slug: 'late', order: 5, side: 'on', fix: 1, rounds: [0, 1], late: [2] });
  const r = run(root, ['verdict', '--runs', '3']);
  assert.deepEqual(r.warnings, []);
  assert.match(oneLine(r), /^plan-check verdict: pass \| check on: median 1\.0 \(n=3\)/);
});

test('without a ship gate entry every work file counts', () => {
  const root = repo();
  addRun(root, { slug: 'open', order: 1, fix: 1, rounds: [0, 3] });
  fs.rmSync(path.join(root, '.company', 'work', 'open', 'run-state.jsonl'));
  const r = run(root, ['verdict']);
  assert.deepEqual(r.warnings, ['open: fix rounds 1 vs handoffs 3']);
});

test('an untracked work file uses its mtime: before the ship gate answer it counts, after it does not', () => {
  const root = repo();
  addSide(root, 'none', 'b', [2, 2, 2], 0);
  addSide(root, 'on', 'o', [1, 1], 3);
  addRun(root, { slug: 'early', order: 5, side: 'on', fix: 1, rounds: [0, 1] });
  addRun(root, { slug: 'late', order: 6, side: 'on', fix: 1, rounds: [0, 1] });
  put(root, '.company/work/early/41-backend-engineer.md', stepText(2));
  touch(root, '.company/work/early/41-backend-engineer.md', '2026-10-15T11:59:59Z');
  put(root, '.company/work/late/41-backend-engineer.md', stepText(2));
  touch(root, '.company/work/late/41-backend-engineer.md', '2026-10-16T12:00:01Z');
  const r = run(root, ['verdict', '--runs', '3']);
  assert.deepEqual(r.warnings, ['early: fix rounds 1 vs handoffs 2']);
});

test('an untracked work file at exactly the ship gate time counts; the mtime is floored to whole seconds', () => {
  const root = repo();
  addRun(root, { slug: 'edge', order: 1, fix: 1, rounds: [0, 1] });
  put(root, '.company/work/edge/41-backend-engineer.md', stepText(2));
  touch(root, '.company/work/edge/41-backend-engineer.md', '2026-10-11T12:00:00.900Z');
  assert.deepEqual(run(root, ['verdict']).warnings, ['edge: fix rounds 1 vs handoffs 2']);
});

test('a tracked work file uses its git add time, not its mtime', () => {
  const root = repo();
  addRun(root, { slug: 'tr', order: 1, fix: 1, rounds: [0, 1], late: [2] });
  touch(root, '.company/work/tr/40-backend-engineer.md', '2026-10-11T08:00:00Z');
  assert.deepEqual(run(root, ['verdict']).warnings, []);
});

test('the real mtime of a work file is used: every file of a run in the same minute counts when no ship gate entry exists', () => {
  const root = repo();
  addRun(root, { slug: 'open', order: 1, fix: 3, rounds: [0, 3] });
  fs.rmSync(path.join(root, '.company', 'work', 'open', 'run-state.jsonl'));
  assert.deepEqual(run(root, ['verdict']).warnings, []);
});

test('a run in plan-check error state is left out with a warning', () => {
  const root = repo();
  addSide(root, 'none', 'b', [2, 2, 2], 0);
  addSide(root, 'on', 'o', [1, 1, 1], 3);
  addRun(root, { slug: 'bad', order: 6, fix: 1, rounds: [0, 1] });
  put(root, '.company/work/bad/plan-check.jsonl', `${JSON.stringify({ v: 1, at: '2026-10-16T08:30:00Z', ev: 'error', policy: 'warn', reason: 'patterns' })}\n`);
  const r = run(root, ['verdict', '--runs', '3']);
  assert.deepEqual(r.warnings, ['bad: plan-check record in error state']);
});

test('a broken plan-check record stops the verdict with the reader message', () => {
  const root = repo();
  addSide(root, 'none', 'b', [2, 2, 2], 0);
  addRun(root, { slug: 'broken', order: 4, fix: 1, rounds: [0, 1] });
  put(root, '.company/work/broken/plan-check.jsonl', 'not json\n');
  const r = run(root, ['verdict']);
  assert.equal(r.code, 1);
  assert.match(oneLine(r), /^plan-check verdict: error \(plan-check record broken line 1: /);
});

test('folders that are not runs are ignored: no summary, no plan, bad name', () => {
  const root = repo();
  put(root, '.company/work/live/02-plan.md', '# Plan\n');
  put(root, '.company/work/noplan/00-summary.md', 'x\n');
  put(root, '.company/work/Bad_Name/00-summary.md', 'x\n');
  put(root, '.company/work/Bad_Name/02-plan.md', 'x\n');
  put(root, '.company/work/notplan/00-summary.md', 'x\n');
  put(root, '.company/work/notplan/02-notes.md', 'x\n');
  commit(root, '2026-10-10T10:00:00Z');
  const r = run(root, ['verdict']);
  assert.deepEqual(r.warnings, []);
  assert.match(oneLine(r), /^plan-check verdict: insufficient \(n=0\)/);
});

test('ledger lines are checked: over 512 bytes, invalid, another run and a later invalid ship line are not used', () => {
  const root = repo();
  const ship = (run_, fix) => JSON.stringify({ v: 1, run: run_, kind: 'ship', acs: 1, fix_rounds: fix });
  const text = [ship('x', 1), ship('other', 7), JSON.stringify({ v: 1, run: 'x', kind: 'ship', acs: 1, fix_rounds: -4 }), `{"pad":"${'a'.repeat(600)}"}`, '{broken'].join('\n') + '\n';
  addRun(root, { slug: 'x', order: 1, rounds: [0, 1], ledgerText: text });
  assert.deepEqual(run(root, ['verdict']).warnings, []);
  const huge = repo();
  addRun(huge, { slug: 'x', order: 1, rounds: [0, 1], ledgerText: `${ship('x', 1)}\n${' '.repeat(1024 * 1024 + 1)}` });
  assert.deepEqual(run(huge, ['verdict']).warnings, ['x: fix rounds none vs handoffs 1']);
});

test('the last valid ship line decides', () => {
  const root = repo();
  const ship = fix => JSON.stringify({ v: 1, run: 'x', kind: 'ship', acs: 1, fix_rounds: fix });
  addRun(root, { slug: 'x', order: 1, rounds: [0, 2], ledgerText: `${ship(1)}\n${ship(2)}\n` });
  assert.deepEqual(run(root, ['verdict']).warnings, []);
});

const shipLine = (slug, extra = {}) => JSON.stringify({ v: 1, run: slug, kind: 'ship', acs: 3, fix_rounds: 0, ...extra });

test('a run whose last valid ship line has path short is on neither side and adds no warning', () => {
  const root = repo();
  addSide(root, 'none', 'b', [2, 2, 2], 0);
  addSide(root, 'on', 'o', [1, 1, 1], 3);
  // Short runs on both sides, one with fix rounds that disagree with its Handoffs, one in plan-check error state.
  addRun(root, { slug: 's-base', order: 6, rounds: [0, 0], ledgerText: `${shipLine('s-base', { path: 'short', tier: 'low' })}\n` });
  addRun(root, { slug: 's-on', order: 7, side: 'on', rounds: [0, 3], ledgerText: `${shipLine('s-on', { path: 'short', fix_rounds: 0 })}\n` });
  addRun(root, { slug: 's-err', order: 8, rounds: [0], ledgerText: `${shipLine('s-err', { path: 'short' })}\n` });
  put(root, '.company/work/s-err/plan-check.jsonl', '{"v":99}\n');
  const r = run(root, ['verdict', '--runs', '3']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.runs.on.map(x => x.slug).sort(), ['o-0', 'o-1', 'o-2']);
  assert.deepEqual(r.runs.base.map(x => x.slug).sort(), ['b-0', 'b-1', 'b-2']);
  assert.equal(oneLine(r), 'plan-check verdict: pass | check on: median 1.0 (n=3) | baseline: median 2.0 (n=3) | waved off n/a');
});

test('short runs do not change a verdict line compared with a ledger that never had them', () => {
  const plain = repo();
  addSide(plain, 'none', 'b', [2, 2, 2, 2], 0);
  addSide(plain, 'on', 'o', [1, 2, 1, 2], 4);
  const mixed = repo();
  addSide(mixed, 'none', 'b', [2, 2, 2, 2], 0);
  addSide(mixed, 'on', 'o', [1, 2, 1, 2], 4);
  addRun(mixed, { slug: 's1', order: 9, rounds: [0, 0], ledgerText: `${shipLine('s1', { path: 'short' })}\n` });
  addRun(mixed, { slug: 's2', order: 10, side: 'on', rounds: [0, 0], ledgerText: `${shipLine('s2', { path: 'short' })}\n` });
  assert.equal(oneLine(run(mixed, ['verdict', '--runs', '4'])), oneLine(run(plain, ['verdict', '--runs', '4'])));
});

test('only path equal to short leaves a run out: full, no path and an unknown path count as before', () => {
  const root = repo();
  addRun(root, { slug: 'full', order: 1, rounds: [0, 1], ledgerText: `${shipLine('full', { path: 'full', fix_rounds: 1 })}\n` });
  addRun(root, { slug: 'nopath', order: 2, rounds: [0, 1], ledgerText: `${shipLine('nopath', { fix_rounds: 1 })}\n` });
  // An unknown path value makes the line invalid: it is skipped, so the run has no recorded value and is left out by the old rule.
  addRun(root, { slug: 'odd', order: 3, rounds: [0, 1], ledgerText: `${shipLine('odd', { path: 'Short', fix_rounds: 1 })}\n` });
  const r = run(root, ['verdict']);
  assert.deepEqual(r.runs.base.map(x => x.slug).sort(), ['full', 'nopath']);
  assert.deepEqual(r.warnings, ['odd: fix rounds none vs handoffs 1']);
});

test('the last valid ship line decides whether a run is short', () => {
  const root = repo();
  addRun(root, { slug: 'was-short', order: 1, rounds: [0, 1], ledgerText: `${shipLine('was-short', { path: 'short' })}\n${shipLine('was-short', { path: 'full', fix_rounds: 1 })}\n` });
  addRun(root, { slug: 'now-short', order: 2, rounds: [0, 1], ledgerText: `${shipLine('now-short', { path: 'full', fix_rounds: 1 })}\n${shipLine('now-short', { path: 'short' })}\n` });
  // A later invalid line, a later line of another run and an over-long line do not count as the last ship line.
  const pad = JSON.stringify({ v: 1, run: 'ignored', kind: 'ship', acs: 1, path: 'short', pad: 'a'.repeat(600) });
  addRun(root, { slug: 'guarded', order: 3, rounds: [0, 1], ledgerText: [shipLine('guarded', { path: 'full', fix_rounds: 1 }), shipLine('other', { path: 'short' }), shipLine('guarded', { path: 'short', fix_rounds: -1 }), pad, '{broken'].join('\n') + '\n' });
  const r = run(root, ['verdict']);
  assert.deepEqual(r.runs.base.map(x => x.slug).sort(), ['guarded', 'was-short']);
  assert.deepEqual(r.warnings, []);
});

test('a short mark in a ledger file over 1 MiB is not read, so the run is left out by the old rule', () => {
  const root = repo();
  addRun(root, { slug: 'huge', order: 1, rounds: [0, 1], ledgerText: `${shipLine('huge', { path: 'short' })}\n${' '.repeat(1024 * 1024 + 1)}` });
  assert.deepEqual(run(root, ['verdict']).warnings, ['huge: fix rounds none vs handoffs 1']);
});

test('--runs is refused outside 3 to 50 and unknown arguments are refused', () => {
  const root = repo();
  for (const args of [['verdict', '--runs', '2'], ['verdict', '--runs', '51'], ['verdict', '--runs', 'x'], ['verdict', '--runs'], ['verdict', 'extra'], ['nope'], [], ['history', '--bogus'], ['history', '--limit', '0'], ['history', '--limit', '201'], ['history', '--labels']]) {
    const r = run(root, args);
    assert.equal(r.code, 3, args.join(' '));
    assert.match(r.lines[0], /^refused: /);
  }
});

test('the unknown-argument refusal never echoes the argument', () => {
  const root = repo();
  for (const args of [['history', '--bogus-\u001b[31mX'], ['verdict', 'extra-secret']]) {
    const r = run(root, args);
    assert.equal(r.code, 3);
    assert.ok(!r.lines.join('\n').includes(args[1]), args.join(' '));
  }
});

test('the labels sha message says 7 to 64 hex characters', () => {
  const root = repo();
  const file = path.join(root, 'labels.json');
  fs.writeFileSync(file, JSON.stringify({ v: 1, labels: [{ path: '.company/work/a/plan.md', sha: 'zz', line: 1, label: 'fp' }] }));
  const r = run(root, ['history', '--labels', file]);
  assert.equal(r.code, 3);
  assert.match(r.lines[0], /7 to 64 lowercase hex/);
});

test('catBlobArgs puts --end-of-options before the revision', () => {
  const args = catBlobArgs('abcdef1', '.company/work/a/plan.md');
  assert.deepEqual(args, ['cat-file', 'blob', '--end-of-options', 'abcdef1:.company/work/a/plan.md']);
});

test('without git, runs are ordered by file time, every work file uses its mtime and one warning is added', () => {
  const root = repo();
  addSide(root, 'none', 'b', [2, 2, 2], 0);
  addRun(root, { slug: 'late', order: 4, fix: 1, rounds: [0, 1], late: [2] });
  fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
  const r = run(root, ['verdict', '--runs', '3']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.warnings, ['git unavailable: runs ordered by file time']);
  assert.match(oneLine(r), /baseline: median 2\.0 \(n=3\)/);
});

test('verdict and history write nothing: the whole tree, index included, is unchanged', () => {
  const root = repo();
  addSide(root, 'none', 'b', [2, 2, 2], 0);
  addSide(root, 'on', 'o', [1, 1, 1], 3);
  put(root, '.company/work/o-0/02-plan.md', '# Plan\n## Tasks\n- build it, TBD\n');
  commit(root, '2026-10-20T10:00:00Z');
  const before = treeHash(root);
  const status = git(root, ['status', '--porcelain']);
  run(root, ['verdict']);
  run(root, ['history']);
  run(root, ['history', '--json']);
  assert.equal(treeHash(root), before);
  assert.equal(git(root, ['status', '--porcelain']), status);
  assert.equal(fs.existsSync(path.join(root, '.company', 'ledger', 'x.jsonl')), false);
});

// ---------- history ----------

const PLAN_A = '# Plan\nTBD outside any section\n## Tasks\n- build it, TBD\n- Decided: json because simple\n- pick a or b?\n';
const PLAN_B = '# Plan\n## Steps\n1. decide later which db\n2. fine\n';

function historyRepo() {
  const root = repo();
  put(root, '.company/work/alpha/02-plan.md', PLAN_A);
  commit(root, '2026-10-11T10:00:00Z');
  put(root, '.company/work/beta/02-architect-plan.md', PLAN_B);
  commit(root, '2026-10-12T10:00:00Z');
  put(root, '.company/work/alpha/02-plan.md', '# Plan\n## Tasks\n- all settled\n');
  commit(root, '2026-10-13T10:00:00Z');
  return root;
}
const sha = (root, rel) => git(root, ['log', '--diff-filter=A', '--format=%H', '--', rel]).trim();

test('history scans the oldest version of every plan, newest first, and prints counts', () => {
  const root = historyRepo();
  const a = sha(root, '.company/work/alpha/02-plan.md').slice(0, 7);
  const b = sha(root, '.company/work/beta/02-architect-plan.md').slice(0, 7);
  const r = run(root, ['history']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, [
    `.company/work/beta/02-architect-plan.md@${b}: 1 findings`,
    '  3 | decide later | a choice put off past the Plan Gate | unlabeled',
    `.company/work/alpha/02-plan.md@${a}: 2 findings`,
    '  4 | TBD | a placeholder: the plan does not say what to build here | unlabeled',
    '  6 | - pick a or b? | an open either-or question: the plan has not picked one | unlabeled',
    'history: 2 plans, 3 findings, false-positive rate: no labels'
  ]);
});

test('history with labels prints the rate; only a matching path, line and sha count', () => {
  const root = historyRepo();
  const a = sha(root, '.company/work/alpha/02-plan.md');
  const b = sha(root, '.company/work/beta/02-architect-plan.md');
  const labels = path.join(base, 'labels-ok.json');
  fs.writeFileSync(labels, JSON.stringify({ v: 1, labels: [
    { path: '.company/work/alpha/02-plan.md', sha: a.slice(0, 7), line: 4, label: 'tp' },
    { path: '.company/work/alpha/02-plan.md', sha: a, line: 6, label: 'fp' },
    { path: '.company/work/beta/02-architect-plan.md', sha: b.slice(0, 7), line: 99, label: 'fp' },
    { path: '.company/work/alpha/02-plan.md', sha: 'deadbee', line: 3, label: 'fp' }
  ] }));
  const r = run(root, ['history', '--labels', labels]);
  assert.equal(r.code, 0);
  assert.ok(r.lines.includes('  4 | TBD | a placeholder: the plan does not say what to build here | tp'));
  assert.ok(r.lines.includes('  6 | - pick a or b? | an open either-or question: the plan has not picked one | fp'));
  assert.ok(r.lines.includes('  3 | decide later | a choice put off past the Plan Gate | unlabeled'));
  assert.equal(r.lines.at(-1), 'history: 2 plans, 3 findings, labeled 2, false positives 1 (50%)');
  const j = JSON.parse(run(root, ['history', '--labels', labels, '--json']).lines[0]);
  assert.deepEqual([j.v, j.findings, j.labeled, j.falsePositives, j.rate, j.plans.length], [1, 3, 2, 1, 50, 2]);
});

test('history --limit keeps the newest plans', () => {
  const root = historyRepo();
  const r = run(root, ['history', '--limit', '1']);
  assert.match(r.lines[0], /beta\/02-architect-plan\.md@/);
  assert.equal(r.lines.at(-1), 'history: 1 plans, 1 findings, false-positive rate: no labels');
});

test('history lists only plan files at the plan path', () => {
  const root = repo();
  put(root, '.company/work/Bad_Slug/02-plan.md', '## Tasks\n- TBD\n');
  put(root, '.company/work/ok/notes.md', '## Tasks\n- TBD\n');
  put(root, '.company/work/ok/sub/02-plan.md', '## Tasks\n- TBD\n');
  put(root, 'docs/02-plan.md', '## Tasks\n- TBD\n');
  commit(root, '2026-10-11T10:00:00Z');
  const r = run(root, ['history']);
  assert.deepEqual(r.lines, ['history: 0 plans, 0 findings, false-positive rate: no labels']);
});

test('history skips a plan over 256 KiB with a warning', () => {
  const root = repo();
  put(root, '.company/work/big/02-plan.md', `## Tasks\n${'- fine\n'.repeat(50000)}`);
  put(root, '.company/work/small/02-plan.md', '## Tasks\n- TBD\n');
  commit(root, '2026-10-11T10:00:00Z');
  const r = run(root, ['history']);
  assert.equal(r.code, 0);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /big\/02-plan\.md@[0-9a-f]{7}: skipped/);
  assert.equal(r.lines.at(-1), 'history: 1 plans, 1 findings, false-positive rate: no labels');
});

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

// Working tree only: a repository whose work folder is not tracked.
function localPlans(files) {
  const root = repo();
  commit(root, '2026-10-01T01:00:00Z');
  for (const [rel, text, iso] of files) { put(root, rel, text); touch(root, rel, iso); }
  return root;
}

test('history reads plans from the working tree when git has none, marks them and uses the content hash', () => {
  const root = localPlans([
    ['.company/work/alpha/02-plan.md', PLAN_A, '2026-10-11T10:00:00Z'],
    ['.company/work/beta/02-architect-plan.md', PLAN_B, '2026-10-12T10:00:00Z']
  ]);
  const a = sha256(PLAN_A).slice(0, 7);
  const b = sha256(PLAN_B).slice(0, 7);
  const r = run(root, ['history']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.lines.filter(l => !l.startsWith(' ')), [
    `.company/work/beta/02-architect-plan.md@${b} (working tree): 1 findings`,
    `.company/work/alpha/02-plan.md@${a} (working tree): 2 findings`,
    'history: 2 plans, 3 findings, false-positive rate: no labels'
  ]);
  const j = JSON.parse(run(root, ['history', '--json']).lines[0]);
  assert.deepEqual(j.plans.map(p => [p.path, p.source, p.rev]), [
    ['.company/work/beta/02-architect-plan.md', 'working-tree', sha256(PLAN_B)],
    ['.company/work/alpha/02-plan.md', 'working-tree', sha256(PLAN_A)]
  ]);
});

test('history merges both sources by path: git wins for a path in both, a path only in git is kept', () => {
  const root = historyRepo();
  put(root, '.company/work/gamma/02-plan.md', '## Tasks\n- TODO\n');
  touch(root, '.company/work/gamma/02-plan.md', '2026-10-20T10:00:00Z');
  git(root, ['rm', '--quiet', '--force', '.company/work/beta/02-architect-plan.md'], '2026-10-14T10:00:00Z');
  git(root, ['commit', '--quiet', '--message=rm'], '2026-10-14T10:00:00Z');
  const a = sha(root, '.company/work/alpha/02-plan.md').slice(0, 7);
  const b = sha(root, '.company/work/beta/02-architect-plan.md').slice(0, 7);
  const g = sha256('## Tasks\n- TODO\n').slice(0, 7);
  const r = run(root, ['history']);
  assert.deepEqual(r.lines.filter(l => !l.startsWith(' ')), [
    `.company/work/gamma/02-plan.md@${g} (working tree): 1 findings`,
    `.company/work/beta/02-architect-plan.md@${b}: 1 findings`,
    `.company/work/alpha/02-plan.md@${a}: 2 findings`,
    'history: 3 plans, 4 findings, false-positive rate: no labels'
  ]);
  const j = JSON.parse(run(root, ['history', '--json']).lines[0]);
  assert.deepEqual(j.plans.map(p => p.source), ['working-tree', 'git', 'git']);
  assert.equal(j.plans[0].rev, sha256('## Tasks\n- TODO\n'));
  assert.equal(j.plans[1].rev.length, 40);
});

test('history --limit applies to the merged list, newest first', () => {
  const root = historyRepo();
  put(root, '.company/work/gamma/02-plan.md', '## Tasks\n- TODO\n');
  touch(root, '.company/work/gamma/02-plan.md', '2026-10-20T10:00:00Z');
  const two = run(root, ['history', '--limit', '2']);
  assert.deepEqual(two.lines.filter(l => !l.startsWith(' ')).map(l => l.split('@')[0]), [
    '.company/work/gamma/02-plan.md', '.company/work/beta/02-architect-plan.md', 'history: 2 plans, 2 findings, false-positive rate: no labels'.split('@')[0]
  ]);
});

test('history without git scans the working tree alone with one warning and exits 0', () => {
  const root = localPlans([['.company/work/alpha/02-plan.md', PLAN_A, '2026-10-11T10:00:00Z']]);
  fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
  const r = run(root, ['history']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.warnings, ['git unavailable: working tree only']);
  assert.equal(r.lines.at(-1), 'history: 1 plans, 2 findings, false-positive rate: no labels');
  assert.match(r.lines[0], /^\.company\/work\/alpha\/02-plan\.md@[0-9a-f]{7} \(working tree\): 2 findings$/);
});

test('history exits 1 only when neither source can be read', () => {
  const root = path.join(base, `none${n++}`);
  fs.mkdirSync(root, { recursive: true });
  const r = run(root, ['history']);
  assert.equal(r.code, 1);
  assert.deepEqual(r.lines, ['history: git unavailable']);
});

test('working-tree plans are read with lstat: a linked plan file and a plan folder that is a file are ignored', t => {
  const root = localPlans([['.company/work/real/02-plan.md', '## Tasks\n- TBD\n', '2026-10-11T10:00:00Z']]);
  put(root, '.company/work/afile', 'not a folder');
  put(root, '.company/outside.md', '## Tasks\n- TBD\n');
  try {
    fs.symlinkSync(path.join(root, '.company', 'outside.md'), path.join(root, '.company', 'work', 'real', '03-plan.md'));
  } catch { t.diagnostic('symlinks not permitted here'); }
  const r = run(root, ['history']);
  assert.equal(r.lines.filter(l => !l.startsWith(' ')).length, 2);
  assert.match(r.lines[0], /real\/02-plan\.md@/);
});

test('labels: sha is a 7 to 64 hex prefix of the plan rev; a working-tree plan matches by content hash', () => {
  const root = localPlans([['.company/work/alpha/02-plan.md', PLAN_A, '2026-10-11T10:00:00Z']]);
  const full = sha256(PLAN_A);
  const entry = (sh, line, label) => ({ path: '.company/work/alpha/02-plan.md', sha: sh, line, label });
  const labels = path.join(base, 'labels-wt.json');
  fs.writeFileSync(labels, JSON.stringify({ v: 1, labels: [entry(full, 4, 'fp'), entry(full.slice(0, 20), 6, 'tp')] }));
  const r = run(root, ['history', '--labels', labels]);
  assert.equal(r.code, 0);
  assert.equal(r.lines.at(-1), 'history: 1 plans, 2 findings, labeled 2, false positives 1 (50%)');
  fs.writeFileSync(labels, JSON.stringify({ v: 1, labels: [entry('0'.repeat(7), 4, 'fp')] }));
  assert.equal(run(root, ['history', '--labels', labels]).lines.at(-1), 'history: 1 plans, 2 findings, false-positive rate: no labels');
});

test('labels: sha shorter than 7 or longer than 64 is refused; 64 is accepted', () => {
  const root = historyRepo();
  const f = path.join(base, 'labels-len.json');
  const withSha = sh => fs.writeFileSync(f, JSON.stringify({ v: 1, labels: [{ path: '.company/work/alpha/02-plan.md', sha: sh, line: 4, label: 'fp' }] }));
  withSha('a'.repeat(6));
  assert.match(run(root, ['history', '--labels', f]).lines[0], /^refused: labels entry 0: sha/);
  withSha('a'.repeat(65));
  assert.match(run(root, ['history', '--labels', f]).lines[0], /^refused: labels entry 0: sha/);
  withSha('a'.repeat(64));
  assert.equal(run(root, ['history', '--labels', f]).code, 0);
});

test('hostile labels files are refused with an entry-level message and exit 3', () => {
  const root = historyRepo();
  const good = { path: '.company/work/alpha/02-plan.md', sha: 'abcdef1', line: 4, label: 'fp' };
  const cases = [
    [{ v: 1, labels: [{ ...good, extra: 1 }] }, /^refused: labels entry 0: keys must be exactly/],
    [{ v: 1, labels: [{ path: good.path, sha: good.sha, line: good.line }] }, /^refused: labels entry 0: keys must be exactly/],
    [{ v: 1, labels: [good, { ...good, path: '../../etc/passwd' }] }, /^refused: labels entry 1: path is not a plan path/],
    [{ v: 1, labels: [{ ...good, sha: 'ABCDEF1' }] }, /^refused: labels entry 0: sha/],
    [{ v: 1, labels: [{ ...good, sha: '--output=x' }] }, /^refused: labels entry 0: sha/],
    [{ v: 1, labels: [{ ...good, line: 0 }] }, /^refused: labels entry 0: line/],
    [{ v: 1, labels: [{ ...good, line: '4' }] }, /^refused: labels entry 0: line/],
    [{ v: 1, labels: [{ ...good, label: 'maybe' }] }, /^refused: labels entry 0: label/],
    [{ v: 1, labels: [good, good] }, /^refused: labels entry 1: duplicate/],
    [{ v: 1, labels: ['x'] }, /^refused: labels entry 0: not an object/],
    [{ v: 2, labels: [] }, /^refused: labels file: expected/],
    [{ v: 1, labels: [], more: 1 }, /^refused: labels file: expected/],
    [[], /^refused: labels file: expected/]
  ];
  for (const [data, re] of cases) {
    const f = path.join(base, 'labels-bad.json');
    fs.writeFileSync(f, JSON.stringify(data));
    const r = run(root, ['history', '--labels', f]);
    assert.equal(r.code, 3, JSON.stringify(data));
    assert.match(r.lines[0], re);
  }
  const f = path.join(base, 'labels-bad.json');
  fs.writeFileSync(f, '{"v":1,"labels":[{"__proto__":{"label":"fp"},"path":"x","sha":"abcdef1","line":1}]}');
  assert.equal(run(root, ['history', '--labels', f]).code, 3);
  fs.writeFileSync(f, 'nope');
  assert.match(run(root, ['history', '--labels', f]).lines[0], /^refused: labels file: not JSON/);
  fs.writeFileSync(f, ' '.repeat(64 * 1024 + 1));
  assert.match(run(root, ['history', '--labels', f]).lines[0], /^refused: labels file: not a readable/);
  assert.match(run(root, ['history', '--labels', path.join(base, 'missing.json')]).lines[0], /^refused: labels file: not a readable/);
});

test('the command line prints the verdict line and sets the exit code', () => {
  const root = repo();
  addSide(root, 'none', 'b', [2, 2, 2], 0);
  const r = spawnSync(process.execPath, [script, 'verdict', '--runs', '3'], { cwd: root, encoding: 'utf8', env: process.env });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'plan-check verdict: insufficient (n=0) | check on: median ? (n=0) | baseline: median 2.0 (n=3) | waved off n/a\n');
  const bad = spawnSync(process.execPath, [script, 'verdict', '--runs', '1'], { cwd: root, encoding: 'utf8', env: process.env });
  assert.equal(bad.status, 3);
  assert.equal(bad.stdout, 'refused: --runs must be a whole number from 3 to 50\n');
});
