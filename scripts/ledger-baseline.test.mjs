// Tests for `ledger.mjs baseline --before <x.y.z> --json` (token-ledger v1.14, planned).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './ledger.mjs';

const NOW = Date.parse('2026-11-14T12:00:00Z');

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-baseline-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pluginRoot = path.join(dir, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'aico', version: '0.39.0' }));
  return { dir, pluginRoot };
}
const call = (sb, args) => main(args, { now: NOW, root: sb.dir, pluginRoot: sb.pluginRoot });
const baseline = (sb, before = '0.40.0') => {
  const r = call(sb, ['baseline', '--before', before, '--json']);
  assert.equal(r.code, 0, r.lines.join('\n'));
  return JSON.parse(r.lines.join('\n'));
};
const file = (sb, run) => path.join(sb.dir, '.company', 'ledger', `${run}.jsonl`);

const stepRec = (run, id, n) => ({ v: 1, run, kind: 'step', id, role: 'qa', agent: `ag${id}`, src: 'transcript', tokens: { in: n, cache_write: 0, cache_read: 0, out: 0 } });
const noteRec = (run, id) => ({ v: 1, run, kind: 'step', id, role: 'qa', agent: `ag${id}`, src: 'notification', ctx_end: 500 });
const metaRec = (run, aico) => ({ v: 1, run, kind: 'meta', aico });
const shipRec = (run, day) => ({ v: 1, run, kind: 'ship', acs: 1, fix_rounds: 0, high_blockers: 0, t_start: `2026-10-${day}T10:00:00Z`, t_ship: `2026-10-${day}T11:00:00Z` });

// One shipped run. `aico` null = no meta line. `day` orders runs (also the file mtime).
function putRun(sb, run, { aico = '0.30.0', counts = [], notes = [], day = '10', ship = true, extra = [] } = {}) {
  const recs = [
    ...counts.map((n, i) => stepRec(run, String(i + 1).padStart(2, '0'), n)),
    ...notes.map((_, i) => noteRec(run, String(50 + i))),
    ...extra,
  ];
  if (aico !== null) recs.push(metaRec(run, aico));
  if (ship) recs.push(shipRec(run, day));
  fs.mkdirSync(path.dirname(file(sb, run)), { recursive: true });
  fs.writeFileSync(file(sb, run), `${recs.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`);
  const when = new Date(`2026-10-${day}T11:00:00Z`);
  fs.utimesSync(file(sb, run), when, when);
}

// ---------- hostile arguments first ----------

test('AC24: a bad --before is refused with exit 2 and writes nothing', (t) => {
  const sb = sandbox(t);
  for (const args of [['baseline', '--json'], ['baseline', '--before', '--json'], ...['1.2', '1.2.3.4', 'x', '1.2.x', '-1.0.0', '1000.0.0', '', '../1.2.3', '1.2.3\n'].map((v) => ['baseline', '--before', v, '--json'])]) {
    const r = call(sb, args);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.ok(r.lines.join('\n').includes('refused: --before must be x.y.z'), JSON.stringify(args));
  }
  assert.equal(fs.existsSync(path.join(sb.dir, '.company')), false);
});

// ---------- states ----------

test('AC24: no ledger folder or no run below the version is no-data', (t) => {
  const sb = sandbox(t);
  assert.deepEqual(baseline(sb), { state: 'no-data', median: null, runs: 0, steps: 0, unknown: 0 });
  putRun(sb, 'new-run', { aico: '0.40.0', counts: [100] });
  assert.deepEqual(baseline(sb), { state: 'no-data', median: null, runs: 0, steps: 0, unknown: 0 });
});

test('AC24: median over the Steps of the shipped runs below the version; at or above is out', (t) => {
  const sb = sandbox(t);
  putRun(sb, 'a', { aico: '0.9.0', counts: [100, 300], day: '01' });
  putRun(sb, 'b', { aico: '0.39.0', counts: [200], day: '02' });
  putRun(sb, 'at', { aico: '0.40.0', counts: [9_000_000], day: '03' }); // equal: not below
  putRun(sb, 'above', { aico: '0.40.1', counts: [9_000_000], day: '04' });
  const r = baseline(sb, '0.40.0');
  assert.deepEqual(r, { state: 'ok', median: 200, runs: 2, steps: 3, unknown: 0 });
});

test('AC24: version compare is numeric, not text: 0.9.0 is below 0.10.0 and 0.100.0 is not', (t) => {
  const sb = sandbox(t);
  putRun(sb, 'a', { aico: '0.9.0', counts: [10], day: '01' });
  putRun(sb, 'b', { aico: '0.100.0', counts: [999], day: '02' });
  const r = baseline(sb, '0.10.0');
  assert.equal(r.runs, 1);
  assert.equal(r.median, 10);
});

test('AC24: the last meta line of a run decides its version', (t) => {
  const sb = sandbox(t);
  putRun(sb, 'a', { aico: '0.30.0', counts: [10], day: '01', extra: [metaRec('a', '0.50.0')] });
  assert.equal(baseline(sb, '0.40.0').state, 'ok'); // meta 0.30.0 is written after 0.50.0 by putRun
  putRun(sb, 'b', { aico: '0.50.0', counts: [10], day: '02', extra: [metaRec('b', '0.30.0')] });
  const r = baseline(sb, '0.40.0');
  assert.equal(r.runs, 1); // b's last meta is 0.50.0
});

test('AC24: an unshipped run is not a baseline run', (t) => {
  const sb = sandbox(t);
  putRun(sb, 'a', { aico: '0.30.0', counts: [10], day: '01', ship: false });
  assert.equal(baseline(sb).state, 'no-data');
});

test('AC24: runs but no counted Step is unmeasured, never 0', (t) => {
  const sb = sandbox(t);
  putRun(sb, 'a', { aico: '0.30.0', notes: [1, 2], day: '01' });
  putRun(sb, 'b', { aico: '0.31.0', notes: [1], day: '02' });
  assert.deepEqual(baseline(sb), { state: 'unmeasured', median: null, runs: 2, steps: 0, unknown: 0 });
});

test('AC24: runs with no meta line at all is unknown, never used as the baseline', (t) => {
  const sb = sandbox(t);
  putRun(sb, 'a', { aico: null, counts: [10], day: '01' });
  putRun(sb, 'b', { aico: null, counts: [20], day: '02' });
  assert.deepEqual(baseline(sb), { state: 'unknown', median: null, runs: 0, steps: 0, unknown: 2 });
});

test('AC24: no-meta runs sit beside meta runs: left out of the baseline, counted in unknown', (t) => {
  const sb = sandbox(t);
  putRun(sb, 'a', { aico: null, counts: [9_000_000], day: '01' });
  putRun(sb, 'b', { aico: '0.30.0', counts: [10, 30], day: '02' });
  assert.deepEqual(baseline(sb), { state: 'ok', median: 20, runs: 1, steps: 2, unknown: 1 });
});

// ---------- fixed baseline ----------

test('AC24: only the newest 10 shipped runs below the version are used', (t) => {
  const sb = sandbox(t);
  for (let i = 1; i <= 12; i++) {
    const day = String(i).padStart(2, '0');
    // runs 1-2 (oldest) carry a huge value; runs 3-12 carry 100
    putRun(sb, `run-${day}`, { aico: '0.30.0', counts: [i <= 2 ? 9_000_000 : 100], day });
  }
  const r = baseline(sb);
  assert.deepEqual(r, { state: 'ok', median: 100, runs: 10, steps: 10, unknown: 0 });
});

test('AC24: adding newer guarded runs never moves the baseline', (t) => {
  const sb = sandbox(t);
  for (let i = 1; i <= 10; i++) putRun(sb, `old-${i}`, { aico: '0.30.0', counts: [100 * i], day: String(i).padStart(2, '0') });
  const before = baseline(sb, '0.40.0');
  for (let i = 11; i <= 20; i++) putRun(sb, `new-${i}`, { aico: '0.40.0', counts: [1], day: String(i) });
  assert.deepEqual(baseline(sb, '0.40.0'), before);
});

// ---------- robustness ----------

test('AC24: a malformed or hostile line is skipped; the answer has no NaN and stays valid JSON', (t) => {
  const sb = sandbox(t);
  putRun(sb, 'a', {
    aico: '0.30.0',
    counts: [10, 30],
    day: '01',
    extra: ['{not json', JSON.stringify({ v: 1, run: 'a', kind: 'step', id: '77', role: 'qa', agent: 'z', src: 'transcript', tokens: { in: 'NaN', cache_write: 0, cache_read: 0, out: 0 } }), '"\\u001b[31m"'],
  });
  const r = call(sb, ['baseline', '--before', '0.40.0', '--json']);
  assert.equal(r.code, 0);
  const text = r.lines.join('\n');
  assert.ok(!/NaN|Infinity/.test(text));
  const out = JSON.parse(text);
  assert.equal(out.median, 20);
  assert.equal(out.steps, 2);
  assert.deepEqual(Object.keys(out).sort(), ['median', 'runs', 'state', 'steps', 'unknown']);
});

test('AC24: baseline is read only: the ledger folder is byte-identical after the call', (t) => {
  const sb = sandbox(t);
  putRun(sb, 'a', { aico: '0.30.0', counts: [10], day: '01' });
  const snap = () => fs.readdirSync(path.dirname(file(sb, 'a'))).sort().map((n) => [n, fs.readFileSync(path.join(path.dirname(file(sb, 'a')), n), 'utf8')]);
  const pre = snap();
  baseline(sb);
  assert.deepEqual(snap(), pre);
  assert.deepEqual(fs.readdirSync(sb.dir).sort(), ['.company', 'plugin']);
});

test('AC24: every v1.13 file stays valid: report on a run with a meta line still works', (t) => {
  const sb = sandbox(t);
  putRun(sb, 'a', { aico: '0.30.0', counts: [10], day: '01' });
  assert.equal(call(sb, ['report', 'a', '--json']).code, 0);
});
