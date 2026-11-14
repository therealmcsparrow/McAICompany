import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// T20 (P20261114.000001), rewritten red-first for `run-state` v3.0: the cap is no longer frozen per run.
// `runCap(root, slug, { home })` returns { cap, handover, from: 'snapshot'|'default' }: the `threshold` of the
// project's Lead snapshot (`mod-hook` v1 "Snapshot": <home>/hook-snapshots/<root12>/lead.json, root12 = first 12 hex
// of SHA-256 of the real project root), else the plugin default. `start` stops writing `cap`; an old `cap` in a
// record is ignored on read; the view keys `cap` and `handover` carry the runCap value.
// QA assumption: `home` is the MCSPARROW_HOME folder (the snapshot folder lives under it); the child processes get
// MCSPARROW_HOME too.
const here = import.meta.dirname;
const runState = path.join(here, 'run-state.mjs');
const PROJECT = 'P20261112.000001';
const slugOf = (n) => `${PROJECT}/${String(n).padStart(2, '0')}-feature`;

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

function sandbox() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'run-cap-')));
  tmps.push(dir);
  const home = path.join(dir, 'home');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, '.company', 'work', PROJECT), { recursive: true });
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, MCSPARROW_HOME: home };
  const state = (slug) => path.join(repo, '.company', 'work', ...slug.split('/'), 'run-state.jsonl');
  const records = (slug) => fs.readFileSync(state(slug), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const root12 = crypto.createHash('sha256').update(fs.realpathSync.native(repo)).digest('hex').slice(0, 12);
  const snapFile = path.join(home, 'hook-snapshots', root12, 'lead.json');
  return {
    dir, home, repo, state, records, snapFile,
    // A valid Lead snapshot with this threshold (raw value, so a hostile one can be written).
    snapshot(threshold, extra = {}) {
      fs.mkdirSync(path.dirname(snapFile), { recursive: true });
      fs.writeFileSync(snapFile, JSON.stringify({ v: 1, at: '2026-11-14T10:00:00Z', threshold, savers: {}, floor: {}, drift: false, settingsWarnings: [], ...extra }));
    },
    rs: (...args) => {
      const r = spawnSync(process.execPath, [runState, ...args], { cwd: repo, encoding: 'utf8', env });
      return { code: r.status, out: r.stdout, err: r.stderr };
    },
    view(slug) {
      const r = this.rs('show', slug, '--json');
      assert.equal(r.code, 0, r.out + r.err);
      return JSON.parse(r.out);
    }
  };
}

const runCapOf = async () => (await import('./run-cap.mjs')).runCap;
const startLine = (extra = {}) => `${JSON.stringify({ v: 1, at: '2026-11-13T10:00:00Z', ev: 'start', ...extra })}\n`;
const writeState = (sb, slug, text) => { fs.mkdirSync(path.dirname(sb.state(slug)), { recursive: true }); fs.writeFileSync(sb.state(slug), text); };

test('with no snapshot, runCap gives 180000 and 162000 from default', async () => {
  const sb = sandbox();
  const runCap = await runCapOf();
  assert.deepEqual(runCap(sb.repo, slugOf(1), { home: sb.home }), { cap: 180000, handover: 162000, from: 'default' });
});

test('with a Lead snapshot, runCap gives its threshold from snapshot, handover floor(cap x 0.9)', async () => {
  const sb = sandbox();
  const runCap = await runCapOf();
  sb.snapshot(150000);
  assert.deepEqual(runCap(sb.repo, slugOf(1), { home: sb.home }), { cap: 150000, handover: 135000, from: 'snapshot' });
  sb.snapshot(100001);
  assert.deepEqual(runCap(sb.repo, slugOf(1), { home: sb.home }), { cap: 100001, handover: 90000, from: 'snapshot' });
});

test('the bounds 60000 and 250000 are valid, one outside either is not', async () => {
  const runCap = await runCapOf();
  for (const [cap, handover] of [[60000, 54000], [250000, 225000]]) {
    const sb = sandbox();
    sb.snapshot(cap);
    assert.deepEqual(runCap(sb.repo, slugOf(1), { home: sb.home }), { cap, handover, from: 'snapshot' });
  }
  for (const cap of [59999, 250001, 1000000]) {
    const sb = sandbox();
    sb.snapshot(cap);
    assert.deepEqual(runCap(sb.repo, slugOf(1), { home: sb.home }), { cap: 180000, handover: 162000, from: 'default' }, String(cap));
  }
});

test('the cap is not frozen per run: a snapshot change moves runCap and the view of a started run', async () => {
  const sb = sandbox();
  const slug = slugOf(1);
  const runCap = await runCapOf();
  sb.snapshot(150000);
  assert.equal(sb.rs('start', slug).code, 0);
  assert.equal(sb.view(slug).cap, 150000);
  sb.snapshot(200000);
  assert.deepEqual(runCap(sb.repo, slug, { home: sb.home }), { cap: 200000, handover: 180000, from: 'snapshot' });
  const view = sb.view(slug);
  assert.equal(view.cap, 200000);
  assert.equal(view.handover, 180000);
});

test('start writes no cap: a start record holds v, at and ev only (and aico when given)', () => {
  const sb = sandbox();
  const slug = slugOf(1);
  sb.snapshot(150000);
  assert.equal(sb.rs('start', slug).code, 0);
  const [start] = sb.records(slug);
  assert.equal(start.ev, 'start');
  assert.equal('cap' in start, false);
  assert.deepEqual(Object.keys(start).sort(), ['at', 'ev', 'v']);
  const slug2 = slugOf(2);
  assert.equal(sb.rs('start', slug2, '0.38.1').code, 0);
  const [start2] = sb.records(slug2);
  assert.equal(start2.aico, '0.38.1');
  assert.equal('cap' in start2, false);
});

test('the view with no snapshot shows cap 180000 and handover 162000 (never null)', () => {
  const sb = sandbox();
  const slug = slugOf(1);
  assert.equal(sb.rs('start', slug).code, 0);
  const view = sb.view(slug);
  assert.equal(view.cap, 180000);
  assert.equal(view.handover, 162000);
});

test('an old cap recorded on a start line is ignored on read: runCap and the view follow the snapshot', async () => {
  const runCap = await runCapOf();
  for (const old of [120000, 60000, 1000000, '120000', null]) {
    const sb = sandbox();
    const slug = slugOf(1);
    writeState(sb, slug, startLine({ cap: old }));
    assert.deepEqual(runCap(sb.repo, slug, { home: sb.home }), { cap: 180000, handover: 162000, from: 'default' }, JSON.stringify(old));
    sb.snapshot(150000);
    assert.deepEqual(runCap(sb.repo, slug, { home: sb.home }), { cap: 150000, handover: 135000, from: 'snapshot' }, JSON.stringify(old));
    assert.equal(sb.view(slug).cap, 150000);
  }
});

test('a second start after end writes no cap either', () => {
  const sb = sandbox();
  const slug = slugOf(1);
  assert.equal(sb.rs('start', slug).code, 0);
  assert.equal(sb.rs('end', slug, 'ship').code, 0);
  assert.equal(sb.rs('start', slug).code, 0);
  assert.ok(sb.records(slug).filter((r) => r.ev === 'start').every((r) => !('cap' in r)));
});

test('start takes no typed cap: a number argument is refused and nothing is written', () => {
  const sb = sandbox();
  const slug = slugOf(1);
  for (const args of [[slug, '120000'], [slug, '0.38.1', '120000'], [slug, '--cap=120000']]) {
    const r = sb.rs('start', ...args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.out, /^refused: /);
    assert.equal(fs.existsSync(sb.state(slug)), false, args.join(' '));
  }
});

test('hostile snapshot thresholds never reach runCap or the view', async () => {
  const runCap = await runCapOf();
  const bad = ['120000', '150000​', 120000.5, -0, null, [], {}, true, -1, 9e21, 0, 'x'.repeat(300)];
  for (const threshold of bad) {
    const sb = sandbox();
    const slug = slugOf(1);
    sb.snapshot(threshold);
    let result;
    assert.doesNotThrow(() => { result = runCap(sb.repo, slug, { home: sb.home }); }, JSON.stringify(threshold));
    assert.deepEqual(result, { cap: 180000, handover: 162000, from: 'default' }, JSON.stringify(threshold).slice(0, 30));
  }
});

test('an unreadable, partial or oversized snapshot gives the default and never throws', async () => {
  const runCap = await runCapOf();
  for (const body of ['', '{ not json', '{"v":1,"threshold":15', '\u0000\u0000', 'null', '[]', `{"v":1,"threshold":150000,"pad":"${'x'.repeat(8000)}"}`]) {
    const sb = sandbox();
    fs.mkdirSync(path.dirname(sb.snapFile), { recursive: true });
    fs.writeFileSync(sb.snapFile, body);
    let result;
    assert.doesNotThrow(() => { result = runCap(sb.repo, slugOf(1), { home: sb.home }); });
    assert.equal(result.from, 'default', body.slice(0, 20));
    assert.equal(result.cap, 180000);
    assert.equal(result.handover, 162000);
  }
});

test('a snapshot of another project is not used', async () => {
  const sb = sandbox();
  const runCap = await runCapOf();
  const other = path.join(path.dirname(sb.snapFile), '..', '0123456789ab', 'lead.json');
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(other, JSON.stringify({ v: 1, at: 'x', threshold: 100000, savers: {}, floor: {}, drift: false, settingsWarnings: [] }));
  assert.equal(runCap(sb.repo, slugOf(1), { home: sb.home }).from, 'default');
});

test('a garbage run-state file gives runCap an integer cap within 60000-250000 and no throw', async () => {
  const sb = sandbox();
  const slug = slugOf(1);
  writeState(sb, slug, '\u0000\u0000 not json\n{"v":1\n');
  const runCap = await runCapOf();
  let result;
  assert.doesNotThrow(() => { result = runCap(sb.repo, slug, { home: sb.home }); });
  assert.ok(Number.isInteger(result.cap) && result.cap >= 60000 && result.cap <= 250000, JSON.stringify(result));
  assert.equal(result.handover, Math.floor(result.cap * 9 / 10));
});

test('runCap takes the number from the cap rule module, not from a literal of its own (AC13)', () => {
  const src = fs.readFileSync(path.join(here, 'run-cap.mjs'), 'utf8');
  assert.doesNotMatch(src, /\b180000\b|\b162000\b/);
  assert.doesNotMatch(src, /recordedCap/, 'the per-run frozen cap is gone');
});
