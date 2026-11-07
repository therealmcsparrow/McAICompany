import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRecord, main } from './ledger.mjs';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const FLOOR = { release: '0.16.0', floor: { architect: 'opus' }, protected: ['architect'], downgraded: [], warnings: [] };

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-qa-first-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pluginRoot = path.join(dir, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'aico', version: '0.18.0' }));
  return { dir, pluginRoot };
}

const jl = (...recs) => `${recs.map((r) => JSON.stringify(r)).join('\n')}\n`;
const ledgerDir = (sb) => path.join(sb.dir, '.company', 'ledger');
const ledgerFile = (sb, name) => path.join(ledgerDir(sb), `${name}.jsonl`);
const readLines = (sb, name) => fs.readFileSync(ledgerFile(sb, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const opts = (sb) => ({ now: NOW, root: sb.dir, pluginRoot: sb.pluginRoot, loadFloor: () => FLOOR });
const shipCmd = (sb, args) => main(['ship', ...args], opts(sb));
const report = (sb, args = []) => main(['qa-first-report', ...args], opts(sb));

// ---------- the ship key qa, hostile cases first ----------

const shipRec = (over = {}) => ({ v: 1, run: 'demo', kind: 'ship', acs: 4, fix_rounds: 1, high_blockers: 2, ...over });

test('validateRecord refuses every qa value except the integers 0 and 1', () => {
  for (const value of [2, -1, 0.5, 1.0000001, '1', '0', '', 'true', true, false, null, [1], { a: 1 }, NaN, 1e3, '1\n']) {
    assert.equal(validateRecord(shipRec({ qa: value })).ok, false, JSON.stringify(value));
  }
});

test('validateRecord accepts qa 0 and qa 1 on ship, with and without the other optional keys', () => {
  assert.equal(validateRecord(shipRec()).ok, true);
  assert.equal(validateRecord(shipRec({ qa: 0 })).ok, true);
  assert.equal(validateRecord(shipRec({ qa: 1 })).ok, true);
  assert.equal(validateRecord(shipRec({ qa: 1, path: 'full', raised: 1, tier: 'high' })).ok, true);
});

test('validateRecord refuses qa on every kind except ship', () => {
  const others = [
    { v: 1, run: 'demo', kind: 'step', id: '01', role: 'qa', agent: 'a1', src: 'notification', ctx_end: 5 },
    { v: 1, run: 'demo', kind: 'step', id: '01', role: 'qa', agent: 'a1', src: 'transcript', tokens: { in: 1, cache_write: 2, cache_read: 3, out: 4 } },
    { v: 1, run: 'demo', kind: 'meta', aico: '0.27.0', floor: '0.16.0', pb: 'feature', sets: 2 },
    { v: 1, run: 'demo', kind: 'par', cap: 4, peak: 3, waits: 1, out: 0 }
  ];
  for (const rec of others) {
    assert.equal(validateRecord(rec).ok, true, `${rec.kind} base`);
    for (const value of [0, 1]) assert.equal(validateRecord({ ...rec, qa: value }).ok, false, `${rec.kind} qa ${value}`);
  }
});

// ---------- ship writes qa from the parallel record ----------

const at = '2026-10-28T10:00:00Z';
const begin = (extra = {}) => ({ v: 1, at, ev: 'begin', plan: '02-plan.md', hash: 'abcdef012345', cap: 4, mode: 'parallel', tasks: 3, ow: [], ...extra });
const start = (task) => ({ v: 1, at, ev: 'start', task, round: 0, ow: [] });
const done = (task) => ({ v: 1, at, ev: 'done', task, round: 0, ow: [] });
function writeParallel(sb, slug, ...events) {
  const dir = path.join(sb.dir, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'parallel.jsonl'), jl(...events));
}
const shipOf = (sb, run) => readLines(sb, run).find((x) => x.kind === 'ship');

test('a reader error writes no qa key, counts one warning and ship still succeeds', (t) => {
  const bad = [
    '{ not json\n',
    'x'.repeat(2 * 1024 * 1024),
    `${JSON.stringify(begin({ qa: true }))}\n${JSON.stringify({ ...start('T1'), cap: 'x' })}\n`,
    `${JSON.stringify(begin({ qa: 'yes' }))}\n`
  ];
  for (const body of bad) {
    const sb = sandbox(t);
    const dir = path.join(sb.dir, '.company', 'work', 'broken');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'parallel.jsonl'), body);
    const r = shipCmd(sb, ['broken', '2']);
    assert.equal(r.code, 0, body.slice(0, 20));
    assert.match(r.lines[0], / \| warnings: 1 \| cost: not recorded$/, body.slice(0, 20));
    assert.equal('qa' in shipOf(sb, 'broken'), false, body.slice(0, 20));
  }
});

test('ship writes qa 1 when the parallel record has a QA-first begin', (t) => {
  const sb = sandbox(t);
  writeParallel(sb, 'demo', begin({ qa: true }), start('T1'), done('T1'));
  const r = shipCmd(sb, ['demo', '3', '1', '0']);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 1);
  assert.doesNotMatch(r.lines[0], /warnings:/);
  const rec = shipOf(sb, 'demo');
  assert.equal(rec.qa, 1);
  assert.equal(rec.acs, 3);
  assert.equal(rec.fix_rounds, 1);
});

test('ship writes qa 0 when the parallel record has no qa on begin', (t) => {
  const sb = sandbox(t);
  writeParallel(sb, 'demo', begin(), start('T1'), done('T1'));
  assert.equal(shipCmd(sb, ['demo', '3']).code, 0);
  assert.equal(shipOf(sb, 'demo').qa, 0);
});

test('ship writes qa 0 for a sequential run without qa', (t) => {
  const sb = sandbox(t);
  writeParallel(sb, 'demo', begin({ cap: 5, mode: 'sequential' }), start('T1'), done('T1'));
  assert.equal(shipCmd(sb, ['demo', '3']).code, 0);
  assert.equal(shipOf(sb, 'demo').qa, 0);
});

test('ship writes no qa key when there is no parallel record', (t) => {
  const sb = sandbox(t);
  const r = shipCmd(sb, ['plain', '2']);
  assert.equal(r.code, 0);
  assert.equal('qa' in shipOf(sb, 'plain'), false);
  assert.deepEqual(readLines(sb, 'plain').map((x) => x.kind), ['meta', 'ship']);
});

test('brainstorm, replay and baseline runs get no qa key', (t) => {
  const sb = sandbox(t);
  for (const run of ['brainstorm-20261028-1000', 'replay-x', 'baseline-y']) {
    writeParallel(sb, run, begin({ qa: true }), start('T1'));
    assert.deepEqual(shipCmd(sb, [run, '2']).lines, ['ship recorded (excluded run)']);
    assert.deepEqual(readLines(sb, run).map((x) => x.kind), ['ship'], run);
    assert.equal('qa' in shipOf(sb, run), false, run);
  }
});

test('the scorecard of a ship with qa 1 matches that of a ship with qa 0', (t) => {
  const sb = sandbox(t);
  writeParallel(sb, 'with', begin({ qa: true }), start('T1'), done('T1'));
  writeParallel(sb, 'without', begin(), start('T1'), done('T1'));
  shipCmd(sb, ['with', '3', '1', '0']);
  shipCmd(sb, ['without', '3', '1', '0']);
  assert.equal(shipOf(sb, 'with').qa, 1);
  const a = main(['scorecard', 'with'], opts(sb));
  const b = main(['scorecard', 'without'], opts(sb));
  assert.equal(a.code, 0);
  assert.deepEqual(a.lines.map((l) => l.replace('with', 'X')), b.lines.map((l) => l.replace('without', 'X')));
});

// ---------- qa-first-report ----------

let counter = 0;
const stamp = () => {
  counter += 1;
  return `2026-11-${String(1 + (counter % 28)).padStart(2, '0')} ${String(counter % 24).padStart(2, '0')}.${String(counter % 60).padStart(2, '0')}`;
};
const step = (run) => ({ v: 1, run, kind: 'step', id: '01', role: 'qa', agent: 'a81462be729924978', src: 'notification', ctx_end: 40565, tool_uses: 14, ms: 48615, t1: '2026-11-06T05:59:22Z', t0: '2026-11-06T05:58:34Z' });
const prefixed = /^(brainstorm|replay|baseline)-/;
function addRun(sb, title, ship, ...extra) {
  const run = prefixed.test(title) ? title : `${stamp()} - ${title}`;
  fs.mkdirSync(ledgerDir(sb), { recursive: true });
  const last = { v: 1, run, kind: 'ship', acs: 5, high_blockers: 0, path: 'full', raised: 0, tier: 'high', ...ship };
  fs.writeFileSync(ledgerFile(sb, run), jl(step(run), ...extra, ...(ship === null ? [] : [last])));
  return run;
}
const TAIL = 'after: insufficient (n=0)';

test('the report refuses any argument with exit 2 and prints the one line', (t) => {
  const sb = sandbox(t);
  for (const args of [['x'], ['--json'], ['--runs', '3'], [''], ['a', 'b']]) {
    const r = report(sb, args);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.deepEqual(r.lines, ['refused: qa-first-report takes no arguments'], JSON.stringify(args));
  }
});

test('refused files are excluded: non-JSON line, fix_rounds as a string, unknown key, oversized file', (t) => {
  const sb = sandbox(t);
  fs.mkdirSync(ledgerDir(sb), { recursive: true });
  const ok = { v: 1, kind: 'ship', acs: 2, fix_rounds: 7 };
  const a = `${stamp()} - Garbage Line`;
  fs.writeFileSync(ledgerFile(sb, a), `${jl(step(a), { ...ok, run: a })}{ not json\n`);
  const b = `${stamp()} - String Rounds`;
  fs.writeFileSync(ledgerFile(sb, b), jl(step(b), { ...ok, run: b, fix_rounds: '7' }));
  const c = `${stamp()} - Unknown Key`;
  fs.writeFileSync(ledgerFile(sb, c), jl(step(c), { ...ok, run: c, note: 'free text' }));
  const d = `${stamp()} - Huge File`;
  fs.writeFileSync(ledgerFile(sb, d), `${jl(step(d), { ...ok, run: d })}${'x'.repeat(2 * 1024 * 1024)}\n`);
  addRun(sb, 'Fine Run', { fix_rounds: 1 });
  const r = report(sb);
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, ['before: median 1 (n=1)', TAIL, 'excluded: 4']);
});

test('a symlinked ledger file is not counted as a run', (t) => {
  const sb = sandbox(t);
  const target = path.join(sb.dir, 'elsewhere.jsonl');
  const run = `${stamp()} - Linked Run`;
  fs.writeFileSync(target, jl(step(run), { v: 1, run, kind: 'ship', acs: 2, fix_rounds: 8 }));
  fs.mkdirSync(ledgerDir(sb), { recursive: true });
  try {
    fs.symlinkSync(target, ledgerFile(sb, run));
  } catch {
    t.skip('symlinks not available here');
    return;
  }
  addRun(sb, 'Fine Run', { fix_rounds: 1 });
  const r = report(sb);
  assert.equal(r.lines[0], 'before: median 1 (n=1)');
  assert.equal(r.lines[1], TAIL);
});

test('files with an invalid run name or another extension are not in the set', (t) => {
  const sb = sandbox(t);
  fs.mkdirSync(ledgerDir(sb), { recursive: true });
  fs.writeFileSync(path.join(ledgerDir(sb), 'Bad Name!.jsonl'), jl({ v: 1, run: 'x', kind: 'ship', acs: 2, fix_rounds: 8 }));
  fs.writeFileSync(path.join(ledgerDir(sb), 'notes.txt'), 'fix_rounds 9');
  addRun(sb, 'Fine Run', { fix_rounds: 1 });
  assert.deepEqual(report(sb).lines, ['before: median 1 (n=1)', TAIL, 'excluded: 0']);
});

test('no ledger files print before median ? (n=0), after insufficient (n=0) and excluded 0', (t) => {
  const sb = sandbox(t);
  const r = report(sb);
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, ['before: median ? (n=0)', TAIL, 'excluded: 0']);
});

test('the report is read-only', (t) => {
  const sb = sandbox(t);
  addRun(sb, 'Alpha Run', { fix_rounds: 2 });
  const snap = () => fs.readdirSync(ledgerDir(sb)).map((f) => [f, fs.readFileSync(path.join(ledgerDir(sb), f), 'utf8')]);
  const before = snap();
  report(sb);
  assert.deepEqual(snap(), before);
});

test('an odd count takes the middle value and runs with qa 0 or no qa go to before', (t) => {
  const sb = sandbox(t);
  for (const n of [5, 1, 3]) addRun(sb, `Plain ${n}`, { fix_rounds: n });
  addRun(sb, 'Zero Qa', { fix_rounds: 100, qa: 0 });
  assert.deepEqual(report(sb).lines, ['before: median 4 (n=4)', TAIL, 'excluded: 0']);
  addRun(sb, 'Five', { fix_rounds: 2, qa: 0 });
  assert.equal(report(sb).lines[0], 'before: median 3 (n=5)');
});

test('an even count averages the two middle values, one decimal, trailing .0 dropped', (t) => {
  const cases = [
    [[1, 2, 3, 4], 'before: median 2.5 (n=4)'],
    [[1, 3], 'before: median 2 (n=2)'],
    [[0, 1], 'before: median 0.5 (n=2)'],
    [[0], 'before: median 0 (n=1)']
  ];
  for (const [values, line] of cases) {
    const sb = sandbox(t);
    values.forEach((n, i) => addRun(sb, `Run ${'ABCDEF'[i]}`, { fix_rounds: n }));
    assert.equal(report(sb).lines[0], line);
  }
});

test('after is insufficient below 3 runs and a median from 3 runs, qa 1 only', (t) => {
  const sb = sandbox(t);
  addRun(sb, 'Before One', { fix_rounds: 6 });
  addRun(sb, 'After One', { fix_rounds: 0, qa: 1 });
  addRun(sb, 'After Two', { fix_rounds: 4, qa: 1 });
  assert.deepEqual(report(sb).lines, ['before: median 6 (n=1)', 'after: insufficient (n=2)', 'excluded: 0']);
  addRun(sb, 'After Three', { fix_rounds: 1, qa: 1 });
  assert.deepEqual(report(sb).lines, ['before: median 6 (n=1)', 'after: median 1 (n=3)', 'excluded: 0']);
  addRun(sb, 'After Four', { fix_rounds: 2, qa: 1 });
  assert.deepEqual(report(sb).lines, ['before: median 6 (n=1)', 'after: median 1.5 (n=4)', 'excluded: 0']);
});

test('the last ship record of a file decides its bucket and its value', (t) => {
  const sb = sandbox(t);
  const run = `${stamp()} - Two Ships`;
  fs.mkdirSync(ledgerDir(sb), { recursive: true });
  fs.writeFileSync(ledgerFile(sb, run), jl(step(run), { v: 1, run, kind: 'ship', acs: 2, fix_rounds: 9, qa: 1 }, { v: 1, run, kind: 'ship', acs: 2, fix_rounds: 3, qa: 0 }));
  assert.deepEqual(report(sb).lines, ['before: median 3 (n=1)', TAIL, 'excluded: 0']);
});

test('a file with no ship record is not counted at all, not even as excluded', (t) => {
  const sb = sandbox(t);
  addRun(sb, 'Unfinished', null);
  addRun(sb, 'Done Run', { fix_rounds: 2 });
  assert.deepEqual(report(sb).lines, ['before: median 2 (n=1)', TAIL, 'excluded: 0']);
});

test('brainstorm, replay and baseline files are excluded and counted', (t) => {
  const sb = sandbox(t);
  addRun(sb, 'brainstorm-20261027-1140', { fix_rounds: 50 });
  addRun(sb, 'replay-spike', { fix_rounds: 50 });
  addRun(sb, 'baseline-v0-3', { fix_rounds: 50, qa: 1 });
  addRun(sb, 'Normal Run', { fix_rounds: 1 });
  assert.deepEqual(report(sb).lines, ['before: median 1 (n=1)', TAIL, 'excluded: 3']);
});

test('release runs are excluded by name in any case, other names starting with release stay', (t) => {
  const sb = sandbox(t);
  addRun(sb, 'Release Version 0 26 0', { fix_rounds: 40 });
  addRun(sb, 'Release Next', { fix_rounds: 40 });
  addRun(sb, 'RELEASE', { fix_rounds: 40, qa: 1 });
  addRun(sb, 'Release Next Version', { fix_rounds: 40 });
  addRun(sb, 'Releasing Docs', { fix_rounds: 2 });
  addRun(sb, 'Prerelease Check', { fix_rounds: 4 });
  assert.deepEqual(report(sb).lines, ['before: median 3 (n=2)', TAIL, 'excluded: 4']);
});

test('a ship with no fix_rounds is excluded, a fix_rounds of 0 is a value', (t) => {
  const sb = sandbox(t);
  addRun(sb, 'No Rounds', {});
  addRun(sb, 'No Rounds Qa', { qa: 1 });
  addRun(sb, 'Zero Rounds', { fix_rounds: 0 });
  assert.deepEqual(report(sb).lines, ['before: median 0 (n=1)', TAIL, 'excluded: 2']);
});

test('a file whose last ship has no fix_rounds is excluded even when an earlier ship has one', (t) => {
  const sb = sandbox(t);
  const run = `${stamp()} - Late Bare`;
  fs.mkdirSync(ledgerDir(sb), { recursive: true });
  fs.writeFileSync(ledgerFile(sb, run), jl(step(run), { v: 1, run, kind: 'ship', acs: 2, fix_rounds: 9 }, { v: 1, run, kind: 'ship', acs: 2 }));
  assert.deepEqual(report(sb).lines, ['before: median ? (n=0)', TAIL, 'excluded: 1']);
});

test('before, after and excluded runs together print exactly three lines', (t) => {
  const sb = sandbox(t);
  for (const [i, n] of [2, 2, 4].entries()) addRun(sb, `Old ${'ABC'[i]}`, { fix_rounds: n, qa: 0 });
  for (const [i, n] of [0, 1, 0].entries()) addRun(sb, `New ${'ABC'[i]}`, { fix_rounds: n, qa: 1 });
  addRun(sb, 'Release Gate Tool', { fix_rounds: 9 });
  addRun(sb, 'replay-x', { fix_rounds: 9 });
  const r = report(sb);
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, ['before: median 2 (n=3)', 'after: median 0 (n=3)', 'excluded: 2']);
});
