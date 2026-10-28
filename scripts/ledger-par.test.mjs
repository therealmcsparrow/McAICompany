import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateRecord, main } from './ledger.mjs';

const script = path.join(import.meta.dirname, 'ledger.mjs');
const NOW = Date.parse('2026-10-28T12:00:00Z');
const DAY = 86400000;
const FLOOR = { release: '0.16.0', floor: { architect: 'opus' }, protected: ['architect'], downgraded: [], warnings: [] };
const floorOf = (over = {}) => () => ({ ...FLOOR, ...over });
const boom = () => {
  throw new Error('no floor');
};

function sandbox(t, version = '0.18.0') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-par-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pluginRoot = path.join(dir, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'aico', version }));
  return { dir, pluginRoot };
}

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const jl = (...recs) => `${recs.map((r) => JSON.stringify(r)).join('\n')}\n`;
const ledgerFile = (sb, name) => path.join(sb.dir, '.company', 'ledger', `${name}.jsonl`);
const readLines = (sb, name) => fs.readFileSync(ledgerFile(sb, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const writeLedger = (sb, name, ...recs) => {
  fs.mkdirSync(path.dirname(ledgerFile(sb, name)), { recursive: true });
  fs.writeFileSync(ledgerFile(sb, name), jl(...recs));
};
const ship = (sb, args, loadFloor = floorOf()) => main(['ship', ...args], { now: NOW, root: sb.dir, pluginRoot: sb.pluginRoot, loadFloor });

// ---------- the par record, hostile cases first ----------

const par = (over = {}) => ({ v: 1, run: 'demo', kind: 'par', cap: 4, peak: 3, waits: 1, out: 0, ...over });

test('validateRecord refuses text, negatives, floats and out-of-range values in par', () => {
  const bad = {
    cap: ['4', '', -1, 0, 6, 4.5, 1e3, NaN, null, true, [4], { a: 1 }, '4\n'],
    peak: ['3', -1, 101, 2.5, null, undefined],
    waits: ['1', -1, 10001, 0.1, null, undefined],
    out: ['0', -1, 10001, 1.0000001, null, undefined]
  };
  for (const [key, list] of Object.entries(bad)) {
    for (const value of list) assert.equal(validateRecord(par({ [key]: value })).ok, false, `${key} ${JSON.stringify(value)}`);
  }
  assert.equal(validateRecord(par({ v: 2 })).ok, false);
  assert.equal(validateRecord(par({ run: 'Bad Run' })).ok, false);
});

test('validateRecord refuses any key outside the seven, such as a task id, a path or text', () => {
  for (const key of ['task', 'id', 'path', 'paths', 'note', 'role', 'src', 'tokens', 'acs', 'aico', 'floor', 'sibling', 'extra', '__proto__x']) {
    assert.equal(validateRecord({ ...par(), [key]: 'T1' }).ok, false, key);
    assert.equal(validateRecord({ ...par(), [key]: 1 }).ok, false, key);
  }
  for (const key of ['cap', 'peak', 'waits', 'out']) {
    const rec = par();
    delete rec[key];
    assert.equal(validateRecord(rec).ok, false, `missing ${key}`);
  }
});

test('validateRecord accepts the range edges of par', () => {
  assert.equal(validateRecord(par()).ok, true);
  assert.equal(validateRecord(par({ cap: 1, peak: 0, waits: 0, out: 0 })).ok, true);
  assert.equal(validateRecord(par({ cap: 5, peak: 100, waits: 10000, out: 10000 })).ok, true);
});

test('the par keys are refused on every other kind, floor only on meta', () => {
  const step = { v: 1, run: 'demo', kind: 'step', id: '01', role: 'architect', agent: 'a1', src: 'notification', ctx_end: 5 };
  assert.equal(validateRecord(step).ok, true);
  for (const key of ['cap', 'peak', 'waits', 'out', 'floor']) assert.equal(validateRecord({ ...step, [key]: 1 }).ok, false, key);
  const shipRec = { v: 1, run: 'demo', kind: 'ship', acs: 2 };
  for (const key of ['cap', 'peak', 'waits', 'out']) assert.equal(validateRecord({ ...shipRec, [key]: 1 }).ok, false, key);
  assert.equal(validateRecord({ ...shipRec, floor: '0.16.0' }).ok, false);
  assert.equal(validateRecord({ ...par(), floor: '0.16.0' }).ok, false);
});

// ---------- ship writes the par line ----------

const at = '2026-10-28T10:00:00Z';
const begin = (cap = 4, mode = 'parallel') => ({ v: 1, at, ev: 'begin', plan: '02-plan.md', hash: 'abcdef012345', cap, mode, tasks: 3, ow: [] });
const start = (task, ow = []) => ({ v: 1, at, ev: 'start', task, round: 0, ow });
const done = (task, ow = []) => ({ v: 1, at, ev: 'done', task, round: 0, ow });
const outEv = (task, extra = [], sibling = []) => ({ v: 1, at, ev: 'out', task, round: 0, extra, sibling });
function writeRecord(sb, slug, ...events) {
  const dir = path.join(sb.dir, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'parallel.jsonl'), jl(...events));
}

test('ship writes meta, then par, then ship, with the four integers of the record', (t) => {
  const sb = sandbox(t);
  writeRecord(sb, 'demo', begin(4), start('T1'), start('T2', ['T3']), start('T4'), outEv('T1', ['x/a.js', '?'], ['x/b.js']), done('T1'), done('T2'), done('T4'));
  const r = ship(sb, ['demo', '3', '1', '0']);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 1, 'one printed line');
  assert.doesNotMatch(r.lines[0], /warnings:/);
  const recs = readLines(sb, 'demo');
  assert.deepEqual(recs.map((x) => x.kind), ['meta', 'par', 'ship']);
  assert.deepEqual(recs[1], { v: 1, run: 'demo', kind: 'par', cap: 4, peak: 3, waits: 1, out: 3 });
  assert.deepEqual(Object.keys(recs[1]), ['v', 'run', 'kind', 'cap', 'peak', 'waits', 'out']);
  const text = fs.readFileSync(ledgerFile(sb, 'demo'), 'utf8');
  assert.doesNotMatch(text, /T1|T2|a\.js|b\.js|02-plan/, 'no task id, path or plan name in the ledger');
});

test('a sequential run writes cap 1', (t) => {
  const sb = sandbox(t);
  writeRecord(sb, 'seq', begin(5, 'sequential'), start('T1'), done('T1'), start('T2'), done('T2'));
  assert.equal(ship(sb, ['seq', '2']).code, 0);
  const rec = readLines(sb, 'seq').find((x) => x.kind === 'par');
  assert.deepEqual(rec, { v: 1, run: 'seq', kind: 'par', cap: 1, peak: 1, waits: 0, out: 0 });
});

test('no parallel record: no par line and no warning', (t) => {
  const sb = sandbox(t);
  const r = ship(sb, ['plain', '2']);
  assert.deepEqual(readLines(sb, 'plain').map((x) => x.kind), ['meta', 'ship']);
  assert.doesNotMatch(r.lines[0], /warnings:/);
});

test('a reader error writes no par line, counts one warning and never writes a partial line', (t) => {
  const bad = [
    '{ not json\n',
    'x'.repeat(2 * 1024 * 1024),
    `${JSON.stringify(begin())}\n${JSON.stringify({ ...start('T1'), cap: 'x' })}\n`,
    `${JSON.stringify(begin())}`,
    ''
  ];
  for (const body of bad) {
    const sb = sandbox(t);
    const dir = path.join(sb.dir, '.company', 'work', 'broken');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'parallel.jsonl'), body);
    const r = ship(sb, ['broken', '2']);
    assert.equal(r.code, 0, body.slice(0, 20));
    assert.equal(r.lines.length, 1);
    assert.match(r.lines[0], / \| warnings: 1$/, body.slice(0, 20));
    assert.deepEqual(readLines(sb, 'broken').map((x) => x.kind), ['meta', 'ship']);
  }
});

test('brainstorm, replay and baseline runs get no par line', (t) => {
  const sb = sandbox(t);
  for (const run of ['brainstorm-20261028-1000', 'replay-x', 'baseline-y']) {
    writeRecord(sb, run, begin(), start('T1'));
    assert.deepEqual(ship(sb, [run, '2']).lines, ['ship recorded (excluded run)']);
    assert.deepEqual(readLines(sb, run).map((x) => x.kind), ['ship'], run);
  }
});

// ---------- report and scorecard ignore par ----------

function steps(run) {
  const note = { v: 1, run, kind: 'step', id: '01', role: 'architect', agent: 'a1', src: 'notification', ctx_end: 100 };
  const count = { ...note, src: 'transcript', tokens: { in: 10, cache_write: 20, cache_read: 5, out: 30 }, ctx_end: undefined };
  return [note, count];
}

test('report and scorecard are identical with and without par and floor lines', (t) => {
  const plain = sandbox(t);
  const rich = sandbox(t);
  const shipRec = { v: 1, run: 'demo', kind: 'ship', acs: 2, fix_rounds: 0, high_blockers: 0, t_start: '2026-10-28T09:00:00Z', t_ship: '2026-10-28T10:00:00Z', wait: 60 };
  writeLedger(plain, 'demo', ...steps('demo'), { v: 1, run: 'demo', kind: 'meta', aico: '0.17.0' }, shipRec);
  writeLedger(rich, 'demo', ...steps('demo'), { v: 1, run: 'demo', kind: 'meta', aico: '0.17.0', floor: '0.16.0' }, par(), shipRec);
  for (const args of [['report', 'demo'], ['report', 'demo', '--json'], ['report', 'demo', '--acs', '5'], ['scorecard', 'demo']]) {
    const a = main(args, { now: NOW, root: plain.dir });
    const b = main(args, { now: NOW, root: rich.dir });
    assert.deepEqual(a, b, args.join(' '));
    assert.equal(a.lines.some((l) => /warning: line|warnings: [1-9]/.test(l)), false);
  }
});

test('a v1.2 file gives the same model verdict with the par and floor lines added', (t) => {
  const plain = sandbox(t);
  const rich = sandbox(t);
  for (const sb of [plain, rich]) {
    for (let i = 0; i < 4; i += 1) {
      const name = `run-${i}`;
      const end = NOW - (i + 1) * DAY;
      const shipRec = { v: 1, run: name, kind: 'ship', acs: 2, fix_rounds: 0, high_blockers: 0, t_start: iso(end - 3600000), t_ship: iso(end) };
      const metaLine = { v: 1, run: name, kind: 'meta', aico: '0.17.0' };
      if (sb === plain) writeLedger(sb, name, ...steps(name), metaLine, shipRec);
      else writeLedger(sb, name, ...steps(name), { ...metaLine, floor: '0.16.0' }, par({ run: name }), shipRec);
    }
  }
  const run = (sb) => main(['model-verdict', '--runs', '3'], { now: NOW, root: sb.dir, loadFloor: floorOf({ downgraded: ['architect'] }) });
  const a = run(plain);
  assert.equal(a.code, 0);
  assert.match(a.lines[0], /^model verdict: insufficient \(n=4\) \| runs 3 v0.17, 0 v0.16 \(plan check none\)/);
  assert.deepEqual(run(rich), a);
});

// ---------- parallel-verdict ----------

const BUILDERS = ['backend-engineer', 'frontend-engineer'];
function writePlanCheck(sb, name, plan) {
  if (plan === 'none') return;
  const dir = path.join(sb.dir, '.company', 'work', name);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = '2026-10-01T10:00:00Z';
  const body = {
    off: jl({ v: 1, at: stamp, ev: 'off', policy: 'off' }),
    warn: jl({ v: 1, at: stamp, ev: 'scan', policy: 'warn', plan: 'plan.md', patterns: 'abcdef012345', findings: 0, decided: 0 }),
    block: jl({ v: 1, at: stamp, ev: 'scan', policy: 'block', plan: 'plan.md', patterns: 'abcdef012345', findings: 0, decided: 0 })
  }[plan];
  fs.writeFileSync(path.join(dir, 'plan-check.jsonl'), body);
}

// One shipped run. side '18' (meta 0.18.0, floor, par) or '17' (meta 0.17.0, no floor key) or a meta text.
function mk(sb, name, {
  side = '18', age = 0, time = 1800, wait = 0, fix = 0, high = 0, rej = 0, acs = 4, spend = 1000, builders = 2, cap = 4,
  out = 0, floor, plan = 'warn', withPar = true, unreconciled = false, shipExtra = {}
} = {}) {
  const end = NOW - (age + 1) * DAY;
  const aico = side === '18' ? '0.18.0' : side === '17' ? '0.17.0' : side;
  const lines = [];
  for (let i = 0; i < builders; i += 1) {
    const id = `0${i + 1}`;
    const base = { v: 1, run: name, kind: 'step', id, role: BUILDERS[i % 2], agent: `a${i}` };
    lines.push({ ...base, src: 'notification', ctx_end: 100 });
    lines.push({ ...base, src: 'transcript', tokens: { in: i === 0 ? spend : 0, cache_write: 0, cache_read: 50, out: 0 } });
  }
  lines.push({ v: 1, run: name, kind: 'step', id: '09', role: 'qa', agent: 'q1', src: 'notification', ctx_end: 100 });
  if (!unreconciled) lines.push({ v: 1, run: name, kind: 'step', id: '09', role: 'qa', agent: 'q1', src: 'transcript', tokens: { in: 0, cache_write: 0, cache_read: 0, out: 0 } });
  if (aico !== 'none') {
    const floorKey = floor === undefined ? (side === '18' ? '0.16.0' : null) : floor;
    lines.push({ v: 1, run: name, kind: 'meta', aico, ...(floorKey ? { floor: floorKey } : {}) });
  }
  if (withPar) lines.push({ v: 1, run: name, kind: 'par', cap, peak: Math.min(cap, 3), waits: 0, out });
  lines.push({
    v: 1, run: name, kind: 'ship', acs, fix_rounds: fix, high_blockers: high, t_start: iso(end - (time + wait) * 1000), t_ship: iso(end),
    wait, rej_ship: rej, ...shipExtra
  });
  writeLedger(sb, name, ...lines);
  writePlanCheck(sb, name, plan);
}

const verdict = (sb, args = [], loadFloor = floorOf()) => main(['parallel-verdict', ...args], { now: NOW, root: sb.dir, pluginRoot: sb.pluginRoot, loadFloor });
const segments = (result) => {
  assert.equal(result.lines.length, 1, 'one line');
  return result.lines[0].split(' | ');
};
const seg = (result, prefix) => segments(result).find((s) => s.startsWith(prefix));
const state = (result) => seg(result, 'parallel verdict:');

// Ten v0.18 runs at half the v0.17 time, everything else equal.
function passing(sb, over18 = {}, over17 = {}, n = 10) {
  for (let i = 0; i < n; i += 1) mk(sb, `new-${i}`, { side: '18', age: i, time: 1800, ...over18 });
  for (let i = 0; i < n; i += 1) mk(sb, `old-${i}`, { side: '17', age: 20 + i, time: 3600, ...over17 });
}

test('pass: the whole line, segment by segment', (t) => {
  const sb = sandbox(t);
  passing(sb);
  const r = verdict(sb);
  assert.equal(r.code, 0);
  assert.deepEqual(segments(r), [
    'parallel verdict: pass',
    'runs 10 v0.18, 10 v0.17 (plan check warn, floor 0.16.0)',
    'time minus CEO wait median 30m (v0.17 1h00m)',
    'wall clock median 30m (v0.17 1h00m)',
    'fix rounds median 0.0 (v0.17 0.0)',
    'high blockers median 0.0 (v0.17 0.0)',
    'gate rejects median 0.0 (v0.17 0.0)',
    'spend/AC 250 (v0.17 250)',
    'out-of-list median 0.0',
    'cap median 4.0',
    'excluded: 0',
    'not counted: 0'
  ]);
});

test('empty folder: insufficient with question marks, exit 0', (t) => {
  const sb = sandbox(t);
  const r = verdict(sb);
  assert.equal(r.code, 0);
  assert.deepEqual(segments(r), [
    'parallel verdict: insufficient (n=0)',
    'runs 0 v0.18, 0 v0.17 (plan check ?, floor 0.16.0)',
    'time minus CEO wait median ? (v0.17 ?)',
    'wall clock median ? (v0.17 ?)',
    'fix rounds median ? (v0.17 ?)',
    'high blockers median ? (v0.17 ?)',
    'gate rejects median ? (v0.17 ?)',
    'spend/AC ? (v0.17 ?)',
    'out-of-list median ?',
    'cap median ?',
    'excluded: 0',
    'not counted: 0'
  ]);
});

test('insufficient: n is the size of the smaller set, either side short', (t) => {
  const sb = sandbox(t);
  passing(sb, {}, {}, 9);
  assert.equal(state(verdict(sb)), 'parallel verdict: insufficient (n=9)');
  assert.equal(state(verdict(sb, ['--runs', '9'])), 'parallel verdict: pass');
  const lopsided = sandbox(t);
  for (let i = 0; i < 10; i += 1) mk(lopsided, `new-${i}`, { side: '18', age: i });
  for (let i = 0; i < 4; i += 1) mk(lopsided, `old-${i}`, { side: '17', age: 20 + i, time: 3600 });
  assert.equal(state(verdict(lopsided)), 'parallel verdict: insufficient (n=4)');
});

test('a floor that cannot be loaded never reads as a pass', (t) => {
  const sb = sandbox(t);
  passing(sb);
  for (const loader of [boom, floorOf({ release: null }), floorOf({ release: '0.16' }), floorOf({ release: 16 }), () => null, () => ({})]) {
    const r = verdict(sb, [], loader);
    assert.equal(r.code, 0);
    assert.match(state(r), /^parallel verdict: insufficient \(n=\d+\)$/);
    assert.match(seg(r, 'runs'), /floor \?\)$/);
    assert.doesNotMatch(r.lines[0], /pass/);
  }
});

test('a floor loader without downgraded Roles still gives a verdict', (t) => {
  const sb = sandbox(t);
  passing(sb);
  assert.equal(state(verdict(sb, [], floorOf({ downgraded: [] }))), 'parallel verdict: pass');
});

// ---------- the guards and their edges ----------

test('edge: exactly 0.75 of the v0.17 time passes, one second more fails', (t) => {
  const sb = sandbox(t);
  passing(sb, { time: 3000 }, { time: 4000 });
  assert.equal(state(verdict(sb)), 'parallel verdict: pass');
  const over = sandbox(t);
  passing(over, { time: 3001 }, { time: 4000 });
  assert.equal(state(verdict(over)), 'parallel verdict: fail');
});

test('time is the Ship Gate time minus the CEO wait, wall clock keeps it', (t) => {
  const sb = sandbox(t);
  passing(sb, { time: 3000, wait: 3000 }, { time: 4000, wait: 100 });
  const r = verdict(sb);
  assert.equal(state(r), 'parallel verdict: pass');
  assert.equal(seg(r, 'time minus CEO wait'), 'time minus CEO wait median 50m (v0.17 1h07m)');
  assert.equal(seg(r, 'wall clock'), 'wall clock median 1h40m (v0.17 1h08m)');
  const slow = sandbox(t);
  passing(slow, { time: 3001, wait: 0 }, { time: 4000, wait: 0 });
  assert.equal(state(verdict(slow)), 'parallel verdict: fail');
});

test('the time medians are exact: an even count averages the two middle values without rounding', (t) => {
  const sb = sandbox(t);
  [3000, 3000, 3001, 3001].forEach((time, i) => mk(sb, `new-${i}`, { side: '18', age: i, time }));
  [4000, 4000, 4002, 4002].forEach((time, i) => mk(sb, `old-${i}`, { side: '17', age: 20 + i, time }));
  // 3000.5 against 0.75 x 4001 = 3000.75 passes; rounded medians (3001 against 3000.75) would fail
  assert.equal(state(verdict(sb, ['--runs', '4'])), 'parallel verdict: pass');
});

test('edge: spend per AC at 1.10 times passes, a little more fails', (t) => {
  const sb = sandbox(t);
  passing(sb, { spend: 1100 }, { spend: 1000 });
  assert.equal(state(verdict(sb)), 'parallel verdict: pass');
  const over = sandbox(t);
  passing(over, { spend: 1101 }, { spend: 1000 });
  assert.equal(state(verdict(over)), 'parallel verdict: fail');
  const fewer = sandbox(t);
  passing(fewer, { spend: 1000, acs: 3 }, { spend: 1000, acs: 4 });
  assert.equal(state(verdict(fewer)), 'parallel verdict: fail');
});

test('Fix rounds, high blockers and Gate rejects not higher: equal passes, higher fails', (t) => {
  for (const [key, shipKey] of [['fix', 'fix'], ['high', 'high'], ['rej', 'rej']]) {
    const eq = sandbox(t);
    passing(eq, { [shipKey]: 1 }, { [shipKey]: 1 });
    assert.equal(state(verdict(eq)), 'parallel verdict: pass', `${key} equal`);
    const up = sandbox(t);
    passing(up, { [shipKey]: 2 }, { [shipKey]: 1 });
    assert.equal(state(verdict(up)), 'parallel verdict: fail', `${key} higher`);
    const down = sandbox(t);
    passing(down, { [shipKey]: 0 }, { [shipKey]: 1 });
    assert.equal(state(verdict(down)), 'parallel verdict: pass', `${key} lower`);
  }
});

test('a Gate reject count counts every rej key and an absent key as 0', (t) => {
  const sb = sandbox(t);
  passing(sb, { shipExtra: { rej_brief: 1, rej_plan: 1, rej_ship: 1 } }, { shipExtra: { rej_ship: 3 } });
  const r = verdict(sb);
  assert.equal(seg(r, 'gate rejects'), 'gate rejects median 3.0 (v0.17 3.0)');
  assert.equal(state(r), 'parallel verdict: pass');
  const more = sandbox(t);
  passing(more, { shipExtra: { rej_brief: 1, rej_plan: 1, rej_ship: 2 } }, { shipExtra: { rej_ship: 3 } });
  assert.equal(state(verdict(more)), 'parallel verdict: fail');
});

test('a median out-of-list count above 0 fails; the median, not one run, decides', (t) => {
  const sb = sandbox(t);
  passing(sb, { out: 1 });
  const r = verdict(sb);
  assert.equal(state(r), 'parallel verdict: fail');
  assert.equal(seg(r, 'out-of-list'), 'out-of-list median 1.0');
  const one = sandbox(t);
  for (let i = 0; i < 10; i += 1) mk(one, `new-${i}`, { side: '18', age: i, out: i === 0 ? 4 : 0 });
  for (let i = 0; i < 10; i += 1) mk(one, `old-${i}`, { side: '17', age: 20 + i, time: 3600 });
  assert.equal(state(verdict(one)), 'parallel verdict: pass');
});

// ---------- the next step line ----------

test('fail below cap 5 names raising the cap to 5', (t) => {
  const sb = sandbox(t);
  passing(sb, { time: 3600, cap: 4 });
  const r = verdict(sb);
  assert.equal(state(r), 'parallel verdict: fail');
  assert.equal(seg(r, 'next step:'), 'next step: set pipeline.parallel_cap to 5');
  const mid = sandbox(t);
  for (let i = 0; i < 10; i += 1) mk(mid, `x-${i}`, { side: '18', age: i, time: 3600, cap: i % 2 ? 5 : 4 });
  for (let i = 0; i < 10; i += 1) mk(mid, `old-${i}`, { side: '17', age: 20 + i, time: 3600 });
  const m = verdict(mid);
  assert.equal(seg(m, 'cap median'), 'cap median 4.5');
  assert.equal(seg(m, 'next step:'), 'next step: set pipeline.parallel_cap to 5');
});

test('fail with the cap median already 5 names sequential dispatch', (t) => {
  const sb = sandbox(t);
  passing(sb, { time: 3600, cap: 5 });
  const r = verdict(sb);
  assert.equal(state(r), 'parallel verdict: fail');
  assert.equal(seg(r, 'cap median'), 'cap median 5.0');
  assert.equal(seg(r, 'next step:'), 'next step: set pipeline.dispatch to sequential');
});

test('no next step on pass or insufficient', (t) => {
  const sb = sandbox(t);
  passing(sb);
  assert.equal(seg(verdict(sb), 'next step:'), undefined);
  assert.equal(seg(verdict(sandbox(t)), 'next step:'), undefined);
});

test('next step sits before warnings', (t) => {
  const sb = sandbox(t);
  passing(sb, { time: 3600 });
  const r = verdict(sb, [], floorOf({ warnings: ['w'] }));
  const parts = segments(r);
  assert.match(parts.at(-2), /^next step:/);
  assert.equal(parts.at(-1), 'warnings: 1');
});

// ---------- which runs count, sides and keys ----------

test('side: 0.18.0 or later with a par record of cap 2 or more is v0.18, 0.17.x is v0.17, the rest is not counted', (t) => {
  const sb = sandbox(t);
  mk(sb, 'a-new', { side: '18', age: 0 });
  mk(sb, 'b-later', { side: '0.19.3', age: 1, floor: '0.16.0' });
  mk(sb, 'c-cap2', { side: '18', age: 2, cap: 2 });
  mk(sb, 'd-cap1', { side: '18', age: 3, cap: 1 });
  mk(sb, 'e-nopar', { side: '18', age: 4, withPar: false });
  mk(sb, 'f-17', { side: '0.17.5', age: 5 });
  mk(sb, 'g-1700', { side: '0.17.0', age: 6 });
  mk(sb, 'h-16', { side: '0.16.9', age: 7 });
  mk(sb, 'i-nometa', { side: 'none', age: 8, withPar: false });
  mk(sb, 'j-nometa-par', { side: 'none', age: 9 });
  mk(sb, 'k-17par', { side: '0.17.2', age: 10 });
  const r = verdict(sb);
  assert.equal(seg(r, 'runs'), 'runs 3 v0.18, 3 v0.17 (plan check warn, floor 0.16.0)');
  assert.equal(seg(r, 'not counted:'), 'not counted: 5');
});

test('a counted run needs two distinct builder Steps', (t) => {
  const sb = sandbox(t);
  mk(sb, 'one-builder', { side: '18', builders: 1 });
  mk(sb, 'no-builder', { side: '18', age: 1, builders: 0 });
  mk(sb, 'two-builders', { side: '18', age: 2, builders: 2 });
  mk(sb, 'old-one', { side: '17', age: 3, builders: 1 });
  const r = verdict(sb);
  assert.equal(seg(r, 'runs'), 'runs 1 v0.18, 0 v0.17 (plan check warn, floor 0.16.0)');
  assert.equal(seg(r, 'not counted:'), 'not counted: 3');
});

test('a re-dispatched builder Step is one Step', (t) => {
  const sb = sandbox(t);
  mk(sb, 'redo', { side: '18', builders: 1 });
  const file = ledgerFile(sb, 'redo');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const again = { v: 1, run: 'redo', kind: 'step', id: '01', role: 'backend-engineer', agent: 'a9', src: 'notification', ctx_end: 5 };
  const countAgain = { ...again, src: 'transcript', ctx_end: undefined, tokens: { in: 1, cache_write: 0, cache_read: 0, out: 0 } };
  lines.splice(2, 0, again, countAgain);
  fs.writeFileSync(file, jl(...lines));
  assert.equal(seg(verdict(sb), 'runs'), 'runs 0 v0.18, 0 v0.17 (plan check ?, floor 0.16.0)');
});

test('the other counted-run rules of the model verdict hold', (t) => {
  const sb = sandbox(t);
  mk(sb, 'ok', { side: '18' });
  mk(sb, 'untimed-acs', { side: '18', age: 1, acs: 0 });
  mk(sb, 'unrec', { side: '18', age: 2, unreconciled: true });
  mk(sb, 'no-fix', { side: '18', age: 3, shipExtra: { fix_rounds: undefined } });
  mk(sb, 'bad-plan', { side: '18', age: 4 });
  fs.writeFileSync(path.join(sb.dir, '.company', 'work', 'bad-plan', 'plan-check.jsonl'), '{ not json\n');
  const r = verdict(sb);
  assert.equal(seg(r, 'runs'), 'runs 1 v0.18, 0 v0.17 (plan check warn, floor 0.16.0)');
  assert.equal(seg(r, 'not counted:'), 'not counted: 4');
});

test('keys: another plan check key or floor release is excluded, a 0.17.x run without a floor key reads as 0.16.0', (t) => {
  const sb = sandbox(t);
  mk(sb, 'a-new', { side: '18', age: 0, plan: 'warn' });
  mk(sb, 'b-other-plan', { side: '18', age: 1, plan: 'block' });
  mk(sb, 'c-other-floor', { side: '18', age: 2, floor: '0.15.0' });
  mk(sb, 'd-no-floor-key', { side: '18', age: 3, floor: null });
  mk(sb, 'e-old', { side: '17', age: 4 });
  mk(sb, 'f-old-floor', { side: '0.17.1', age: 5, floor: '0.16.0' });
  mk(sb, 'g-old-other-floor', { side: '17', age: 6, floor: '0.15.0' });
  mk(sb, 'h-old-plan', { side: '17', age: 7, plan: 'off' });
  const r = verdict(sb);
  assert.equal(seg(r, 'runs'), 'runs 1 v0.18, 2 v0.17 (plan check warn, floor 0.16.0)');
  assert.equal(seg(r, 'excluded:'), 'excluded: 5');
});

test('the floor key reference is the current release, not the oldest run', (t) => {
  const sb = sandbox(t);
  passing(sb, { floor: '0.16.0' }, {});
  const r = verdict(sb, [], floorOf({ release: '0.18.0' }));
  assert.equal(seg(r, 'runs'), 'runs 0 v0.18, 0 v0.17 (plan check warn, floor 0.18.0)');
  assert.equal(seg(r, 'excluded:'), 'excluded: 20');
});

test('the plan check key reference is the newest counted v0.18 run by ship time', (t) => {
  const sb = sandbox(t);
  mk(sb, 'new-block', { side: '18', age: 0, plan: 'block' });
  mk(sb, 'new-warn', { side: '18', age: 1, plan: 'warn' });
  mk(sb, 'old-block', { side: '17', age: 2, plan: 'block' });
  mk(sb, 'old-warn', { side: '17', age: 3, plan: 'warn' });
  const r = verdict(sb);
  assert.equal(seg(r, 'runs'), 'runs 1 v0.18, 1 v0.17 (plan check block, floor 0.16.0)');
  assert.equal(seg(r, 'excluded:'), 'excluded: 2');
});

test('--runs takes the newest runs of each side', (t) => {
  const sb = sandbox(t);
  for (let i = 0; i < 5; i += 1) mk(sb, `new-${i}`, { side: '18', age: i, time: i < 3 ? 1000 : 9000 });
  for (let i = 0; i < 5; i += 1) mk(sb, `old-${i}`, { side: '17', age: 20 + i, time: 4000 });
  const r = verdict(sb, ['--runs', '3']);
  assert.equal(state(r), 'parallel verdict: pass');
  assert.equal(seg(r, 'runs'), 'runs 3 v0.18, 3 v0.17 (plan check warn, floor 0.16.0)');
  assert.equal(seg(r, 'time minus'), 'time minus CEO wait median 17m (v0.17 1h07m)');
});

// ---------- arguments ----------

test('--runs takes digits from 3 to 50 only, anything else exits 2 with refused', (t) => {
  const sb = sandbox(t);
  for (const bad of [['--runs'], ['--runs', '2'], ['--runs', '51'], ['--runs', '3.0'], ['--runs', ' 5'], ['--runs', '05x'], ['--runs', '-3'], ['--runs', '1e1'], ['--runs', '٣'], ['--runs', '100'], ['--runs', ''], ['--runs', '5', 'x'], ['5'], ['--run', '5'], ['x']]) {
    const r = verdict(sb, bad);
    assert.equal(r.code, 2, JSON.stringify(bad));
    assert.match(r.lines[0], /^refused: /, JSON.stringify(bad));
    assert.doesNotMatch(r.lines[0], /pass/);
  }
  for (const ok of ['3', '10', '50', '03']) assert.equal(verdict(sb, ['--runs', ok]).code, 0, ok);
});

test('the command is in the usage text', () => {
  const r = main([]);
  assert.equal(r.code, 2);
  assert.match(r.lines[0], /parallel-verdict \[--runs <3-50>\]/);
});

// ---------- bounds and hostile text ----------

test('the line holds no percent, currency or saving word', (t) => {
  const sb = sandbox(t);
  passing(sb, { time: 3600 });
  for (const r of [verdict(sb), verdict(sandbox(t)), verdict(sb, [], boom)]) {
    assert.doesNotMatch(r.lines[0], /[%$€£]|sav|cheap|cost|money|euro|dollar|price/i);
  }
});

test('hostile ledger text is skipped: bad lines, prototype keys, odd names, directories, forged par', (t) => {
  const sb = sandbox(t);
  passing(sb);
  const dir = path.join(sb.dir, '.company', 'ledger');
  fs.writeFileSync(path.join(dir, 'Bad Name.jsonl'), 'x\n');
  fs.mkdirSync(path.join(dir, 'dir-run.jsonl'));
  fs.writeFileSync(path.join(dir, 'junk.jsonl'), `{"__proto__":{"kind":"ship"}}\n{"v":1,"run":"junk","kind":"par","cap":"9","peak":1,"waits":1,"out":1}\nnot json\n`);
  const r = verdict(sb);
  assert.equal(state(r), 'parallel verdict: pass');
  assert.match(seg(r, 'warnings:'), /^warnings: \d+$/);
});

test('a ledger over 1 MiB is not read; the total read and the file count are bounded as in the model verdict', (t) => {
  const sb = sandbox(t);
  passing(sb);
  fs.writeFileSync(ledgerFile(sb, 'huge'), 'x'.repeat(1024 * 1024 + 1));
  const r = verdict(sb);
  assert.equal(seg(r, 'not counted:'), 'not counted: 1');
  assert.equal(state(r), 'parallel verdict: pass');

  const fat = sandbox(t);
  const dir = path.join(fat.dir, '.company', 'ledger');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 40; i += 1) fs.writeFileSync(path.join(dir, `fat-${String(i).padStart(2, '0')}.jsonl`), 'x'.repeat(1024 * 1024));
  const f = verdict(fat);
  assert.equal(seg(f, 'not counted:'), 'not counted: 40');
  assert.ok(Number(/^warnings: (\d+)$/.exec(seg(f, 'warnings:'))?.[1] ?? 0) < 40);

  const many = sandbox(t);
  const manyDir = path.join(many.dir, '.company', 'ledger');
  fs.mkdirSync(manyDir, { recursive: true });
  for (let i = 0; i < 510; i += 1) fs.writeFileSync(path.join(manyDir, `run-${i}.jsonl`), 'x\n');
  assert.equal(seg(verdict(many), 'not counted:'), 'not counted: 500');
});

test('parallel-verdict writes nothing', (t) => {
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
  const ok = spawnSync(process.execPath, [script, 'parallel-verdict'], { cwd: sb.dir, encoding: 'utf8', env });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.split('\n').filter(Boolean).length, 1);
  assert.match(ok.stdout, /^parallel verdict: insufficient \(n=0\)/);
  const bad = spawnSync(process.execPath, [script, 'parallel-verdict', '--runs', '2'], { cwd: sb.dir, encoding: 'utf8', env });
  assert.equal(bad.status, 2);
  assert.match(bad.stdout, /^refused: /);
});

test('this test file is LF only', () => {
  assert.equal(fs.readFileSync(import.meta.filename).includes(13), false);
});
