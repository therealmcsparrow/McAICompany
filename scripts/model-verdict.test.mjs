import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from './ledger.mjs';

const script = path.join(import.meta.dirname, 'ledger.mjs');
const NOW = Date.parse('2026-10-28T12:00:00Z');
const DAY = 86400000;

const FLOOR = {
  release: '0.16.0',
  floor: { architect: 'opus', 'tech-researcher': 'opus', 'senior-engineer': 'opus', 'backend-engineer': 'sonnet' },
  protected: ['architect'],
  downgraded: ['tech-researcher', 'senior-engineer'],
  warnings: []
};
const floorOf = (over = {}) => () => ({ ...FLOOR, ...over });

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-verdict-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, n: 0 };
}

const verdict = (sb, args = [], loadFloor = floorOf()) => main(['model-verdict', ...args], { now: NOW, root: sb.dir, loadFloor });
const segments = (result) => {
  assert.equal(result.lines.length, 1, 'one line');
  return result.lines[0].split(' | ');
};
const seg = (result, prefix) => segments(result).find((s) => s.startsWith(prefix));

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const jl = (...recs) => `${recs.map((r) => JSON.stringify(r)).join('\n')}\n`;

// One shipped run. side: '17' (meta 0.17.0), '16' (no meta) or a meta text. Ship times step back one day per run
// so that a higher `age` is older.
function mk(sb, name, {
  side = '17', age = 0, acs = 4, fix = 0, high = 0, plan = 'warn', other = 400, down = 100, senior = 0, lowerModel = true,
  reconciled = true, timed = true, shipExtra = {}, noShip = false, noTranscript = false
} = {}) {
  const end = NOW - (age + 1) * DAY;
  const rec = (id, role, agent, tokens, model) => [
    { v: 1, run: name, kind: 'step', id, role, agent, src: 'notification', ctx_end: 100 },
    { v: 1, run: name, kind: 'step', id, role, agent, src: 'transcript', tokens: { in: tokens, cache_write: 0, cache_read: 1000, out: 0 }, ...(model ? { model } : {}) }
  ];
  const lines = [];
  if (!noTranscript) {
    lines.push(...rec('01', 'architect', 'a1', other, 'claude-opus-4-1'));
    lines.push(...rec('02', 'tech-researcher', 'a2', down, lowerModel ? 'claude-sonnet-4-5' : 'claude-opus-4-1'));
    if (senior) lines.push(...rec('03', 'senior-engineer', 'a3', senior, 'claude-sonnet-4-5'));
  }
  if (!reconciled) lines.push({ v: 1, run: name, kind: 'step', id: '09', role: 'qa', agent: 'zz9', src: 'notification', ctx_end: 5 });
  if (side === '17') lines.push({ v: 1, run: name, kind: 'meta', aico: '0.17.0' });
  else if (side !== '16') lines.push({ v: 1, run: name, kind: 'meta', aico: side });
  if (!noShip) {
    lines.push({
      v: 1, run: name, kind: 'ship', acs, fix_rounds: fix, high_blockers: high,
      ...(timed ? { t_start: iso(end - 3600000), t_ship: iso(end) } : {}), ...shipExtra
    });
  }
  const file = path.join(sb.dir, '.company', 'ledger', `${name}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, jl(...lines));
  writePlanCheck(sb, name, plan);
}

function writePlanCheck(sb, name, plan) {
  if (plan === 'none') return;
  const dir = path.join(sb.dir, '.company', 'work', name);
  fs.mkdirSync(dir, { recursive: true });
  const at = '2026-10-01T10:00:00Z';
  const body = {
    off: jl({ v: 1, at, ev: 'off', policy: 'off' }),
    warn: jl({ v: 1, at, ev: 'scan', policy: 'warn', plan: 'plan.md', patterns: 'abcdef012345', findings: 0, decided: 0 }),
    block: jl({ v: 1, at, ev: 'scan', policy: 'block', plan: 'plan.md', patterns: 'abcdef012345', findings: 0, decided: 0 }),
    error: jl({ v: 1, at, ev: 'error', policy: 'warn', reason: 'patterns' }),
    broken: '{ not json\n'
  }[plan];
  fs.writeFileSync(path.join(dir, 'plan-check.jsonl'), body);
}

// Ten v0.17 runs and five v0.16 runs that pass.
function passing(sb, over17 = {}, over16 = {}) {
  for (let i = 0; i < 10; i += 1) mk(sb, `new-${i}`, { side: '17', age: i, down: 80, ...over17 });
  for (let i = 0; i < 5; i += 1) mk(sb, `old-${i}`, { side: '16', age: 20 + i, down: 100, ...over16 });
}

// ---------- states ----------

test('pass: the whole line, segment by segment', (t) => {
  const sb = sandbox(t);
  passing(sb);
  const r = verdict(sb);
  assert.equal(r.code, 0);
  assert.deepEqual(segments(r), [
    'model verdict: pass',
    'runs 10 v0.17, 5 v0.16 (plan check warn)',
    'spend/AC 120 (v0.16 125)',
    'downgraded spend/AC 20 (v0.16 25)',
    'fix rounds median 0.0 (v0.16 0.0)',
    'high blockers median 0.0 (v0.16 0.0)',
    'downgraded: senior-engineer, tech-researcher',
    'lower model: 10 of 10',
    'excluded: 0',
    'not counted: 0'
  ]);
});

test('insufficient: fewer than 10 v0.17 runs, fewer than 5 v0.16 runs, nothing downgraded', (t) => {
  const few17 = sandbox(t);
  for (let i = 0; i < 9; i += 1) mk(few17, `new-${i}`, { side: '17', age: i, down: 80 });
  for (let i = 0; i < 5; i += 1) mk(few17, `old-${i}`, { side: '16', age: 20 + i });
  assert.equal(seg(verdict(few17), 'model verdict'), 'model verdict: insufficient (n=9)');

  const few16 = sandbox(t);
  for (let i = 0; i < 10; i += 1) mk(few16, `new-${i}`, { side: '17', age: i, down: 80 });
  for (let i = 0; i < 4; i += 1) mk(few16, `old-${i}`, { side: '16', age: 20 + i });
  assert.equal(seg(verdict(few16), 'model verdict'), 'model verdict: insufficient (n=10)');

  const none = sandbox(t);
  passing(none);
  const r = verdict(none, [], floorOf({ downgraded: [] }));
  assert.equal(seg(r, 'model verdict'), 'model verdict: insufficient (n=10)');
  assert.equal(seg(r, 'downgraded:'), 'downgraded: none');
});

test('insufficient: a side with no downgraded spend', (t) => {
  const sb = sandbox(t);
  passing(sb, {}, { down: 0 });
  assert.equal(seg(verdict(sb), 'model verdict'), 'model verdict: insufficient (n=10)');
});

test('empty folder: insufficient with question marks, exit 0', (t) => {
  const sb = sandbox(t);
  const r = verdict(sb);
  assert.equal(r.code, 0);
  assert.equal(seg(r, 'model verdict'), 'model verdict: insufficient (n=0)');
  assert.equal(seg(r, 'spend/AC'), 'spend/AC ? (v0.16 ?)');
  assert.equal(seg(r, 'runs'), 'runs 0 v0.17, 0 v0.16 (plan check ?)');
});

test('fail by total spend alone: downgraded spend is lower, every downgraded Role rolls back', (t) => {
  const sb = sandbox(t);
  // downgraded 80 vs 100 (lower), total 510 vs 500 (higher): only the total-spend guard trips.
  passing(sb, { down: 80, other: 430 });
  const r = verdict(sb);
  assert.equal(seg(r, 'model verdict'), 'model verdict: fail');
  assert.equal(seg(r, 'roll back:'), 'roll back: senior-engineer, tech-researcher');
});

test('fail by Fix rounds median: every downgraded Role rolls back', (t) => {
  const sb = sandbox(t);
  passing(sb, { fix: 2 });
  const r = verdict(sb);
  assert.equal(seg(r, 'model verdict'), 'model verdict: fail');
  assert.equal(seg(r, 'fix rounds median'), 'fix rounds median 2.0 (v0.16 0.0)');
  assert.equal(seg(r, 'roll back:'), 'roll back: senior-engineer, tech-researcher');
});

test('fail by high blockers median: every downgraded Role rolls back', (t) => {
  const sb = sandbox(t);
  passing(sb, { high: 1 });
  assert.equal(seg(verdict(sb), 'roll back:'), 'roll back: senior-engineer, tech-researcher');
});

test('fail with the guards held: only the Roles whose own spend is not lower roll back', (t) => {
  const sb = sandbox(t);
  // tech-researcher: 100 vs 80 (not lower); senior-engineer: 60 vs 80 (lower); the rest got cheaper.
  passing(sb, { down: 100, senior: 60, other: 100 }, { down: 80, senior: 80, other: 400 });
  const r = verdict(sb);
  assert.equal(seg(r, 'model verdict'), 'model verdict: fail');
  assert.equal(seg(r, 'roll back:'), 'roll back: tech-researcher');
});

test('no roll back segment unless the state is fail', (t) => {
  const sb = sandbox(t);
  passing(sb);
  assert.equal(seg(verdict(sb), 'roll back'), undefined);
});

test('medians: the existing middle-value rule, one decimal', (t) => {
  const sb = sandbox(t);
  for (let i = 0; i < 10; i += 1) mk(sb, `new-${i}`, { side: '17', age: i, down: 80, fix: i < 4 ? 0 : 1 });
  for (let i = 0; i < 5; i += 1) mk(sb, `old-${i}`, { side: '16', age: 20 + i, down: 100, fix: i });
  const r = verdict(sb);
  assert.equal(seg(r, 'fix rounds median'), 'fix rounds median 1.0 (v0.16 2.0)');
});

// ---------- pass-rule boundaries ----------

test('boundary: equal downgraded spend per AC is not lower, so it fails', (t) => {
  const sb = sandbox(t);
  passing(sb, { down: 100, other: 400 });
  const r = verdict(sb);
  assert.equal(seg(r, 'downgraded spend/AC'), 'downgraded spend/AC 25 (v0.16 25)');
  assert.equal(seg(r, 'model verdict'), 'model verdict: fail');
});

test('boundary: equal total spend per AC is not higher, so it passes', (t) => {
  const sb = sandbox(t);
  passing(sb, { down: 80, other: 420 });
  const r = verdict(sb);
  assert.equal(seg(r, 'spend/AC'), 'spend/AC 125 (v0.16 125)');
  assert.equal(seg(r, 'model verdict'), 'model verdict: pass');
});

test('boundary: a little more total spend per AC fails', (t) => {
  const sb = sandbox(t);
  passing(sb, { down: 80, other: 424 });
  assert.equal(seg(verdict(sb), 'model verdict'), 'model verdict: fail');
});

test('boundary: equal Fix rounds median passes', (t) => {
  const sb = sandbox(t);
  passing(sb, { fix: 1 }, { fix: 1 });
  assert.equal(seg(verdict(sb), 'model verdict'), 'model verdict: pass');
});

test('boundary: equal high blockers median passes', (t) => {
  const sb = sandbox(t);
  passing(sb, { high: 1 }, { high: 1 });
  assert.equal(seg(verdict(sb), 'model verdict'), 'model verdict: pass');
});

test('medians are compared unrounded: v0.16 [0,1] vs v0.17 [1,1] fails on Fix rounds', (t) => {
  const sb = sandbox(t);
  for (let i = 0; i < 10; i += 1) mk(sb, `new-${i}`, { side: '17', age: i, down: 80, fix: 1 });
  for (let i = 0; i < 6; i += 1) mk(sb, `old-${i}`, { side: '16', age: 20 + i, down: 100, fix: i < 3 ? 0 : 1 });
  const r = verdict(sb);
  assert.equal(seg(r, 'fix rounds median'), 'fix rounds median 1.0 (v0.16 0.5)');
  assert.equal(seg(r, 'model verdict'), 'model verdict: fail');
});

test('medians are compared unrounded: v0.16 [0,1] vs v0.17 [1,1] fails on high blockers', (t) => {
  const sb = sandbox(t);
  for (let i = 0; i < 10; i += 1) mk(sb, `new-${i}`, { side: '17', age: i, down: 80, high: 1 });
  for (let i = 0; i < 6; i += 1) mk(sb, `old-${i}`, { side: '16', age: 20 + i, down: 100, high: i < 3 ? 0 : 1 });
  const r = verdict(sb);
  assert.equal(seg(r, 'high blockers median'), 'high blockers median 1.0 (v0.16 0.5)');
  assert.equal(seg(r, 'model verdict'), 'model verdict: fail');
});

// ---------- sets, sides and the plan-check key ----------

test('--runs limits both sets to the newest runs', (t) => {
  const sb = sandbox(t);
  passing(sb);
  const r = verdict(sb, ['--runs', '3']);
  assert.equal(seg(r, 'runs'), 'runs 3 v0.17, 3 v0.16 (plan check warn)');
  assert.equal(seg(r, 'model verdict'), 'model verdict: pass', 'five v0.16 runs exist, so the baseline is enough');
});

test('--runs: the newest runs by ship time are taken, older ones are left out', (t) => {
  const sb = sandbox(t);
  for (let i = 0; i < 4; i += 1) mk(sb, `new-${i}`, { side: '17', age: i, down: 80, fix: i >= 2 ? 9 : 0 });
  for (let i = 0; i < 5; i += 1) mk(sb, `old-${i}`, { side: '16', age: 20 + i });
  assert.equal(seg(verdict(sb, ['--runs', '3']), 'fix rounds median'), 'fix rounds median 0.0 (v0.16 0.0)');
  assert.equal(seg(verdict(sb, ['--runs', '4']), 'fix rounds median'), 'fix rounds median 4.5 (v0.16 0.0)');
});

test('AC9: runs whose plan-check policy differs are left out and counted in excluded', (t) => {
  const sb = sandbox(t);
  passing(sb);
  mk(sb, 'new-block', { side: '17', age: 30, plan: 'block' });
  mk(sb, 'old-block', { side: '16', age: 40, plan: 'block' });
  mk(sb, 'old-off', { side: '16', age: 41, plan: 'off' });
  mk(sb, 'old-none', { side: '16', age: 42, plan: 'none' });
  const r = verdict(sb);
  assert.equal(seg(r, 'excluded:'), 'excluded: 4');
  assert.equal(seg(r, 'runs'), 'runs 10 v0.17, 5 v0.16 (plan check warn)');
  assert.equal(seg(r, 'model verdict'), 'model verdict: pass');
});

test('the reference plan-check key is the newest counted v0.17 run, and none and off are keys', (t) => {
  const sb = sandbox(t);
  for (let i = 0; i < 10; i += 1) mk(sb, `new-${i}`, { side: '17', age: i, down: 80, plan: 'none' });
  for (let i = 0; i < 5; i += 1) mk(sb, `old-${i}`, { side: '16', age: 20 + i, plan: 'none' });
  mk(sb, 'old-warn', { side: '16', age: 40, plan: 'warn' });
  const r = verdict(sb);
  assert.equal(seg(r, 'runs'), 'runs 10 v0.17, 5 v0.16 (plan check none)');
  assert.equal(seg(r, 'excluded:'), 'excluded: 1');
  const off = sandbox(t);
  mk(off, 'new-a', { side: '17', age: 0, plan: 'off' });
  mk(off, 'new-b', { side: '17', age: 1, plan: 'warn' });
  assert.equal(seg(verdict(off), 'runs'), 'runs 1 v0.17, 0 v0.16 (plan check off)');
  assert.equal(seg(verdict(off), 'excluded:'), 'excluded: 1');
});

test('side comes from the last meta line: 0.17.0 or later is v0.17, no meta is v0.16, anything else is not counted', (t) => {
  const sb = sandbox(t);
  mk(sb, 'a-new', { side: '0.17.0', age: 0 });
  mk(sb, 'b-later', { side: '0.18.2', age: 1 });
  mk(sb, 'c-major', { side: '1.0.0', age: 2 });
  mk(sb, 'd-old', { side: '16', age: 3 });
  mk(sb, 'e-meta16', { side: '0.16.0', age: 4 });
  mk(sb, 'f-meta1610', { side: '0.9.9', age: 5 });
  const r = verdict(sb);
  assert.equal(seg(r, 'runs'), 'runs 3 v0.17, 1 v0.16 (plan check warn)');
  assert.equal(seg(r, 'not counted:'), 'not counted: 2');
});

test('the last meta line wins when a run shipped twice', (t) => {
  const sb = sandbox(t);
  const metaLine = (aico) => JSON.stringify({ v: 1, run: 'twice', kind: 'meta', aico });
  const put = (first, second) => {
    mk(sb, 'twice', { side: '16' });
    const file = path.join(sb.dir, '.company', 'ledger', 'twice.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    lines.splice(lines.length - 1, 0, metaLine(first), metaLine(second));
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
  };
  put('0.16.0', '0.17.0');
  assert.equal(seg(verdict(sb), 'runs'), 'runs 1 v0.17, 0 v0.16 (plan check warn)');
  put('0.17.0', '0.16.0');
  assert.equal(seg(verdict(sb), 'runs'), 'runs 0 v0.17, 0 v0.16 (plan check ?)');
});

// ---------- which runs count ----------

test('a run is not counted unless timed, with ACs, both quality values, transcripts, all reconciled and a readable plan check', (t) => {
  const sb = sandbox(t);
  mk(sb, 'good', { age: 0 });
  mk(sb, 'untimed', { age: 1, timed: false });
  mk(sb, 'zero-acs', { age: 2, acs: 0 });
  mk(sb, 'unreconciled', { age: 3, reconciled: false });
  mk(sb, 'no-transcript', { age: 4, noTranscript: true });
  mk(sb, 'no-ship', { age: 5, noShip: true });
  mk(sb, 'broken-plan', { age: 6, plan: 'broken' });
  mk(sb, 'error-plan', { age: 7, plan: 'error' });
  mk(sb, 'no-fix', { age: 8 });
  const file = path.join(sb.dir, '.company', 'ledger', 'no-fix.jsonl');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"fix_rounds":0,', ''));
  const r = verdict(sb);
  assert.equal(seg(r, 'runs'), 'runs 1 v0.17, 0 v0.16 (plan check warn)');
  assert.equal(seg(r, 'not counted:'), 'not counted: 8');
});

test('brainstorm, replay and baseline ledgers are skipped and not counted', (t) => {
  const sb = sandbox(t);
  for (const name of ['brainstorm-20261028-1000', 'replay-x', 'baseline-y']) mk(sb, name);
  const r = verdict(sb);
  assert.equal(seg(r, 'not counted:'), 'not counted: 0');
  assert.equal(seg(r, 'runs'), 'runs 0 v0.17, 0 v0.16 (plan check ?)');
});

test('lower model counts only dispatches that ran on a model below the floor', (t) => {
  const sb = sandbox(t);
  passing(sb);
  for (const n of [0, 1, 2]) mk(sb, `new-${n}`, { side: '17', age: n, down: 80, lowerModel: false });
  assert.equal(seg(verdict(sb), 'lower model:'), 'lower model: 7 of 10');
});

test('a counted record without a model id is in the total but never in the lower count', (t) => {
  const sb = sandbox(t);
  mk(sb, 'new-0', { side: '17' });
  const file = path.join(sb.dir, '.company', 'ledger', 'new-0.jsonl');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(',"model":"claude-sonnet-4-5"', ''));
  assert.equal(seg(verdict(sb), 'lower model:'), 'lower model: 0 of 1');
});

// ---------- arguments ----------

test('--runs takes digits from 3 to 50 only', (t) => {
  const sb = sandbox(t);
  for (const bad of [[ '--runs' ], ['--runs', ''], ['--runs', '2'], ['--runs', '51'], ['--runs', '03x'], ['--runs', '1e1'], ['--runs', '+5'],
    ['--runs', '5.0'], ['--runs', '-5'], ['--runs', ' 5'], ['--runs', '١٠'], ['--runs', '0005000'], ['--runs', '5', '--runs', '6'], ['5'], ['--run', '5'], ['--runs=5'], ['--runs', '5', 'x']]) {
    const r = verdict(sb, bad);
    assert.equal(r.code, 2, JSON.stringify(bad));
    assert.match(r.lines.join('\n'), /^refused: /, JSON.stringify(bad));
  }
  for (const ok of ['3', '10', '50']) assert.equal(verdict(sb, ['--runs', ok]).code, 0, ok);
});

test('the command is in the usage text and runs with no arguments', (t) => {
  const sb = sandbox(t);
  assert.match(main([], { root: sb.dir }).lines.join('\n'), /model-verdict \[--runs <3-50>\]/);
  assert.equal(verdict(sb).code, 0);
});

// ---------- hostile input ----------

test('Role names come only from the floor loader, never from ledger text', (t) => {
  const sb = sandbox(t);
  passing(sb);
  const file = path.join(sb.dir, '.company', 'ledger', 'new-0.jsonl');
  fs.appendFileSync(file, jl({ v: 1, run: 'new-0', kind: 'step', id: '05', role: 'evil-role', agent: 'ev1', src: 'transcript', tokens: { in: 5, cache_write: 0, cache_read: 0, out: 0 }, model: 'claude-haiku-4' }));
  const r = verdict(sb, [], floorOf({ downgraded: ['tech-researcher', 'bad role\nwith | pipe', '__proto__', 'x'.repeat(200)] }));
  assert.equal(r.lines[0].includes('evil-role'), false);
  assert.equal(r.lines[0].includes('\n'), false);
  assert.equal(seg(r, 'downgraded:'), 'downgraded: tech-researcher');
});

test('the line holds no percent, currency or saving word', (t) => {
  const sb = sandbox(t);
  passing(sb, { down: 120 });
  for (const r of [verdict(sb), verdict(sandbox(t))]) {
    assert.doesNotMatch(r.lines[0], /[%$€£]|sav|cheap|cost|money|euro|dollar|price/i);
  }
});

test('hostile ledger text is skipped: bad lines, prototype keys, odd file names, directories', (t) => {
  const sb = sandbox(t);
  passing(sb);
  const dir = path.join(sb.dir, '.company', 'ledger');
  fs.writeFileSync(path.join(dir, 'Bad Name.jsonl'), 'x\n');
  fs.writeFileSync(path.join(dir, 'note.txt'), 'x\n');
  fs.mkdirSync(path.join(dir, 'dir-run.jsonl'));
  fs.writeFileSync(path.join(dir, 'junk.jsonl'), `{"__proto__":{"kind":"ship"}}\n{"v":1,"run":"junk","kind":"ship","acs":1,"__proto__":1}\nnot json\n`);
  const r = verdict(sb);
  assert.equal(seg(r, 'model verdict'), 'model verdict: pass');
  assert.match(seg(r, 'warnings:'), /^warnings: \d+$/);
});

test('a ledger over 1 MiB is not read and counts in not counted', (t) => {
  const sb = sandbox(t);
  passing(sb);
  fs.writeFileSync(path.join(sb.dir, '.company', 'ledger', 'huge.jsonl'), 'x'.repeat(1024 * 1024 + 1));
  const r = verdict(sb);
  assert.equal(seg(r, 'not counted:'), 'not counted: 1');
  assert.equal(seg(r, 'model verdict'), 'model verdict: pass');
});

test('the total read is bounded: files past the byte cap are not read but counted', (t) => {
  const sb = sandbox(t);
  const dir = path.join(sb.dir, '.company', 'ledger');
  fs.mkdirSync(dir, { recursive: true });
  const body = 'x'.repeat(1024 * 1024);
  for (let i = 0; i < 40; i += 1) fs.writeFileSync(path.join(dir, `fat-${String(i).padStart(2, '0')}.jsonl`), body);
  const r = verdict(sb);
  assert.equal(seg(r, 'not counted:'), 'not counted: 40');
  const warned = Number(/^warnings: (\d+)$/.exec(seg(r, 'warnings:'))?.[1] ?? 0);
  assert.ok(warned < 40, `files past the cap are not read, warnings ${warned}`);
});

test('at most 500 ledger files are read', (t) => {
  const sb = sandbox(t);
  const dir = path.join(sb.dir, '.company', 'ledger');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 510; i += 1) fs.writeFileSync(path.join(dir, `run-${i}.jsonl`), 'x\n');
  const r = verdict(sb);
  assert.equal(seg(r, 'not counted:'), 'not counted: 500');
});

test('a floor loader that fails or warns gives insufficient and a warnings segment, never a throw', (t) => {
  const sb = sandbox(t);
  passing(sb);
  const boom = () => {
    throw new Error('no floor');
  };
  const r = verdict(sb, [], boom);
  assert.equal(r.code, 0);
  assert.equal(seg(r, 'model verdict'), 'model verdict: insufficient (n=10)');
  assert.equal(seg(r, 'warnings:'), 'warnings: 1');
  const warned = verdict(sb, [], floorOf({ warnings: ['a', 'b'] }));
  assert.equal(seg(warned, 'warnings:'), 'warnings: 2');
});

// ---------- read only, CLI ----------

test('model-verdict writes nothing', (t) => {
  const sb = sandbox(t);
  passing(sb);
  const snap = () => fs.readdirSync(sb.dir, { recursive: true }).sort().map((f) => `${f}:${fs.statSync(path.join(sb.dir, f)).mtimeMs}`);
  const before = snap();
  verdict(sb);
  assert.deepEqual(snap(), before);
});

test('the CLI prints one line and exits 0; a bad --runs exits 2', (t) => {
  const sb = sandbox(t);
  const home = path.join(sb.dir, 'home');
  fs.mkdirSync(home);
  const env = { PATH: process.env.PATH, MCSPARROW_HOME: home, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: home };
  const ok = spawnSync(process.execPath, [script, 'model-verdict'], { cwd: sb.dir, encoding: 'utf8', env });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.split('\n').filter(Boolean).length, 1);
  assert.match(ok.stdout, /^model verdict: insufficient \(n=0\)/);
  const bad = spawnSync(process.execPath, [script, 'model-verdict', '--runs', '2'], { cwd: sb.dir, encoding: 'utf8', env });
  assert.equal(bad.status, 2);
  assert.match(bad.stdout, /^refused: /);
});

test('this test file is LF only', () => {
  assert.equal(fs.readFileSync(import.meta.filename).includes(13), false);
});
