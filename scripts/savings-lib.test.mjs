// The pure lib behind the Savings pane, mods/lib/savings.mjs.
// aico-mods v2.2 (Savings saver), token-ledger v1.14 (baseline).
// The export names below are the seam this task pins: GUARDS_SINCE, currentFigures, baselineFigures, safeText.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as lib from '../mods/lib/savings.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const step = (id, tokens, state = 'reconciled') => ({ kind: 'step', id, role: 'qa', agent: `a${id}`, state, tokens, spend: null, ctx_end: 1, ms: 1, model: 'm' });
const T = (n) => ({ in: n, cache_write: 0, cache_read: 0, out: 0 });
const report = (rows) => ({ v: 1, run: 'demo', rows, totals: {}, per_ac: {}, not_reconciled: 0, warnings: [] });

// ---------- GUARDS_SINCE ----------

test('AC24: GUARDS_SINCE is one x.y.z constant at or below the plugin version', () => {
  assert.match(lib.GUARDS_SINCE, /^\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const num = (v) => v.split('.').map(Number);
  const [a, b] = [num(lib.GUARDS_SINCE), num(ver)];
  const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  assert.ok(cmp <= 0, `GUARDS_SINCE ${lib.GUARDS_SINCE} is above plugin version ${ver}`);
});

// ---------- current figures: median real tokens per Step ----------

test('AC24: median of the summed four counts per Step; odd count', () => {
  const r = report([
    step('01', { in: 100, cache_write: 200, cache_read: 300, out: 400 }), // 1000
    step('02', T(5000)),
    step('03', T(2000)),
  ]);
  const f = lib.currentFigures(r);
  assert.equal(f.state, 'ok');
  assert.equal(f.median, 2000);
  assert.equal(f.counted, 3);
  assert.equal(f.total, 3);
  assert.equal(f.unmeasured, 0);
});

test('AC24: even count takes the middle pair mean', () => {
  const f = lib.currentFigures(report([step('01', T(10)), step('02', T(20))]));
  assert.equal(f.median, 15);
});

test('AC24: empty report or no Step rows is no-data, never NaN or 0', () => {
  for (const input of [report([]), null, undefined, {}, { rows: null }]) {
    const f = lib.currentFigures(input);
    assert.equal(f.state, 'no-data', JSON.stringify(input));
    assert.equal(f.median, null);
  }
});

test('AC24: Steps without a count only is unmeasured, median null', () => {
  const f = lib.currentFigures(report([step('01', null, 'unreconciled'), step('02', null, 'unreconciled')]));
  assert.equal(f.state, 'unmeasured');
  assert.equal(f.median, null);
  assert.equal(f.counted, 0);
  assert.equal(f.total, 2);
  assert.equal(f.unmeasured, 2);
});

test('AC24: partial rows never zero-fill; median over the counted Steps', () => {
  const f = lib.currentFigures(report([step('01', T(100)), step('02', null, 'unreconciled'), step('03', T(300)), step('04', null, 'unreconciled')]));
  assert.equal(f.state, 'ok');
  assert.equal(f.median, 200);
  assert.equal(f.counted, 2);
  assert.equal(f.total, 4);
  assert.equal(f.unmeasured, 2);
});

test('AC24: only Step rows count; reflect and round rows are left out', () => {
  const rows = [
    step('01', T(100)),
    { ...step('RT', T(9_000_000)), kind: 'reflect', id: 'RT' },
    { ...step('R1', T(9_000_000)), kind: 'round', id: 'R1' },
  ];
  const f = lib.currentFigures(report(rows));
  assert.equal(f.median, 100);
  assert.equal(f.total, 1);
});

test('AC24: bad counts (NaN, negative, fraction, string, missing key) are unmeasured, never NaN', () => {
  const bad = [
    { in: NaN, cache_write: 0, cache_read: 0, out: 0 },
    { in: -1, cache_write: 0, cache_read: 0, out: 0 },
    { in: 1.5, cache_write: 0, cache_read: 0, out: 0 },
    { in: '12', cache_write: 0, cache_read: 0, out: 0 },
    { in: 1, cache_write: 0, cache_read: 0 },
    { in: Infinity, cache_write: 0, cache_read: 0, out: 0 },
  ];
  const f = lib.currentFigures(report([...bad.map((t, i) => step(String(10 + i), t)), step('90', T(40))]));
  assert.equal(f.median, 40);
  assert.equal(f.counted, 1);
  assert.equal(f.unmeasured, bad.length);
  assert.ok(!JSON.stringify(f).includes('NaN'));
});

test('AC24: the figures hold only real counts: no estimate field leaks into them', () => {
  const f = lib.currentFigures(report([step('01', T(10))]));
  for (const key of Object.keys(f)) assert.doesNotMatch(key, /estimate/i);
});

// ---------- baseline figures from `ledger.mjs baseline --json` ----------

test('AC24: baseline ok keeps median and run count (1-9 runs are never padded)', () => {
  for (const runs of [1, 6, 9, 10]) {
    const b = lib.baselineFigures({ state: 'ok', median: 51000, runs, steps: 30, unknown: 0 });
    assert.equal(b.state, 'ok');
    assert.equal(b.median, 51000);
    assert.equal(b.runs, runs);
  }
});

test('AC24: baseline no-data, unmeasured and unknown carry a null median', () => {
  for (const state of ['no-data', 'unmeasured', 'unknown']) {
    const b = lib.baselineFigures({ state, median: null, runs: 0, steps: 0, unknown: state === 'unknown' ? 3 : 0 });
    assert.equal(b.state, state);
    assert.equal(b.median, null);
  }
});

test('AC24: a malformed baseline answer is an error state, never a number', () => {
  const bad = [
    null, undefined, 'x', [], {},
    { state: 'weird', median: 1, runs: 1, steps: 1, unknown: 0 },
    { state: 'ok', median: null, runs: 1, steps: 1, unknown: 0 },
    { state: 'ok', median: NaN, runs: 1, steps: 1, unknown: 0 },
    { state: 'ok', median: '51000', runs: 1, steps: 1, unknown: 0 },
    { state: 'ok', median: -4, runs: 1, steps: 1, unknown: 0 },
    { state: 'ok', median: 5, runs: 11, steps: 1, unknown: 0 },
    { state: 'ok', median: 5, runs: 0, steps: 1, unknown: 0 },
  ];
  for (const input of bad) {
    const b = lib.baselineFigures(input);
    assert.equal(b.state, 'error', JSON.stringify(input));
    assert.equal(b.median, null);
  }
});

// ---------- escaped text ----------

test('AC24: safeText strips control and escape characters and truncates to 40 with ...', () => {
  const hostile = `a\x1b[31mred\x07\x00b\r\nc<script>`;
  const out = lib.safeText(hostile);
  assert.doesNotMatch(out, /[\x00-\x08\x0b-\x1f\x7f]/);
  assert.doesNotMatch(out, /\x1b/);
  const long = lib.safeText('x'.repeat(200));
  assert.ok(long.length <= 43 && long.endsWith('...'), long);
  assert.equal(lib.safeText('demo-run'), 'demo-run');
  assert.equal(lib.safeText(undefined), '');
  assert.equal(lib.safeText({ a: 1 }), '');
});
