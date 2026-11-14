import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// A run keeps the cap it started with: run-state start records it, the view and runCap read it back.
const here = import.meta.dirname;
const runState = path.join(here, 'run-state.mjs');
const PROJECT = 'P20261112.000001';
const slugOf = (n) => `${PROJECT}/${String(n).padStart(2, '0')}-feature`;

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

// One repo and one home per test; the real user home is never read.
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
  return {
    dir, home, repo, state, records,
    user: (pipeline) => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ aico_settings: { version: 1, pipeline } })),
    project: (pipeline) => fs.writeFileSync(path.join(repo, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, pipeline } })),
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

test('AC1: with no stored cap, start records 180000 and the view shows cap 180000 and handover 162000', async () => {
  const sb = sandbox();
  const slug = slugOf(1);
  assert.equal(sb.rs('start', slug).code, 0);
  const view = sb.view(slug);
  assert.equal(view.cap, 180000);
  assert.equal(view.handover, 162000);
  const [start] = sb.records(slug);
  assert.equal(start.ev, 'start');
  assert.equal(start.cap, 180000);
  assert.deepEqual(Object.keys(start).sort(), ['at', 'cap', 'ev', 'v']);
  const runCap = await runCapOf();
  assert.deepEqual(runCap(sb.repo, slug, { home: sb.home }), { cap: 180000, handover: 162000, from: 'run' });
});

test('AC1: the aico version argument still works and a cap is recorded beside it', () => {
  const sb = sandbox();
  const slug = slugOf(1);
  assert.equal(sb.rs('start', slug, '0.38.1').code, 0);
  const [start] = sb.records(slug);
  assert.equal(start.aico, '0.38.1');
  assert.equal(start.cap, 180000);
});

test('AC8: a setting change after start leaves the view and runCap on the first cap; the next run uses the new one', async () => {
  const sb = sandbox();
  const first = slugOf(1);
  sb.user({ context_cap: 150000 });
  assert.equal(sb.rs('start', first).code, 0);
  assert.equal(sb.view(first).cap, 150000);
  sb.user({ context_cap: 200000 });
  sb.project({ context_cap: 100000 });
  const view = sb.view(first);
  assert.equal(view.cap, 150000);
  assert.equal(view.handover, 135000);
  const runCap = await runCapOf();
  assert.deepEqual(runCap(sb.repo, first, { home: sb.home }), { cap: 150000, handover: 135000, from: 'run' });
  const second = slugOf(2);
  assert.equal(sb.rs('start', second).code, 0);
  assert.equal(sb.view(second).cap, 100000);
  assert.equal(sb.view(second).handover, 90000);
  assert.deepEqual(runCap(sb.repo, first, { home: sb.home }), { cap: 150000, handover: 135000, from: 'run' });
});

test('AC8: end then a new start keeps the first cap and writes no second one', async () => {
  const sb = sandbox();
  const slug = slugOf(1);
  sb.user({ context_cap: 150000 });
  assert.equal(sb.rs('start', slug).code, 0);
  assert.equal(sb.rs('end', slug, 'ship').code, 0);
  sb.user({ context_cap: 250000 });
  assert.equal(sb.rs('start', slug).code, 0);
  const starts = sb.records(slug).filter((r) => r.ev === 'start');
  assert.equal(starts.length, 2);
  assert.equal(starts[0].cap, 150000);
  assert.equal('cap' in starts[1], false);
  const view = sb.view(slug);
  assert.equal(view.cap, 150000);
  assert.equal(view.handover, 135000);
  const runCap = await runCapOf();
  assert.deepEqual(runCap(sb.repo, slug, { home: sb.home }), { cap: 150000, handover: 135000, from: 'run' });
});

test('AC8: a start record from before the cap existed gives a null view and runCap reads the setting', async () => {
  const sb = sandbox();
  const slug = slugOf(1);
  fs.mkdirSync(path.dirname(sb.state(slug)), { recursive: true });
  fs.writeFileSync(sb.state(slug), `${JSON.stringify({ v: 1, at: '2026-11-13T10:00:00Z', ev: 'start' })}\n`);
  const view = sb.view(slug);
  assert.equal(view.cap, null);
  assert.equal(view.handover, null);
  const runCap = await runCapOf();
  const bare = runCap(sb.repo, slug, { home: sb.home });
  assert.equal(bare.cap, 180000);
  assert.equal(bare.handover, 162000);
  assert.notEqual(bare.from, 'run');
  sb.user({ context_cap: 120000 });
  assert.deepEqual(runCap(sb.repo, slug, { home: sb.home }), { cap: 120000, handover: 108000, from: 'settings' });
});

test('a run that never started (no run-state) uses the current setting, else 180000', async () => {
  const sb = sandbox();
  const runCap = await runCapOf();
  const none = runCap(sb.repo, slugOf(7), { home: sb.home });
  assert.equal(none.cap, 180000);
  assert.equal(none.handover, 162000);
  assert.notEqual(none.from, 'run');
  sb.user({ context_cap: 123457 });
  assert.deepEqual(runCap(sb.repo, slugOf(7), { home: sb.home }), { cap: 123457, handover: 111111, from: 'settings' });
});

test('start takes the cap from settings only: a typed number is refused and nothing is written', () => {
  const sb = sandbox();
  const slug = slugOf(1);
  for (const args of [[slug, '120000'], [slug, '0.38.1', '120000'], [slug, '--cap=120000']]) {
    const r = sb.rs('start', ...args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.out, /^refused: /);
    assert.equal(fs.existsSync(sb.state(slug)), false, args.join(' '));
  }
});

test('settings that cannot be read still give a start with a valid cap', () => {
  const sb = sandbox();
  const slug = slugOf(1);
  fs.writeFileSync(path.join(sb.home, 'config.json'), '{ not json');
  assert.equal(sb.rs('start', slug).code, 0);
  const view = sb.view(slug);
  assert.equal(view.cap, 180000);
  assert.equal(view.handover, 162000);
});

test('hostile recorded caps never reach the view or runCap; the bounds 60000 and 1000000 do', async () => {
  const runCap = await runCapOf();
  const bad = ['120000', 120000.5, 59999, 1000001, -0, null, [], {}, '150000​', true, -1, 9e21];
  for (const cap of bad) {
    const sb = sandbox();
    const slug = slugOf(1);
    sb.user({ context_cap: 150000 });
    fs.mkdirSync(path.dirname(sb.state(slug)), { recursive: true });
    fs.writeFileSync(sb.state(slug), `${JSON.stringify({ v: 1, at: '2026-11-13T10:00:00Z', ev: 'start', cap })}\n`);
    let result;
    assert.doesNotThrow(() => { result = runCap(sb.repo, slug, { home: sb.home }); }, JSON.stringify(cap));
    assert.notEqual(result.from, 'run', JSON.stringify(cap));
    assert.equal(result.cap, 150000, JSON.stringify(cap));
    const shown = sb.rs('show', slug, '--json');
    if (shown.code === 0) assert.equal(JSON.parse(shown.out).cap, null, JSON.stringify(cap));
  }
  for (const [cap, handover] of [[60000, 54000], [1000000, 900000]]) {
    const sb = sandbox();
    const slug = slugOf(1);
    fs.mkdirSync(path.dirname(sb.state(slug)), { recursive: true });
    fs.writeFileSync(sb.state(slug), `${JSON.stringify({ v: 1, at: '2026-11-13T10:00:00Z', ev: 'start', cap })}\n`);
    assert.deepEqual(runCap(sb.repo, slug, { home: sb.home }), { cap, handover, from: 'run' });
    assert.equal(sb.view(slug).handover, handover);
  }
});

test('a garbage run-state file gives runCap an integer cap and no throw', async () => {
  const sb = sandbox();
  const slug = slugOf(1);
  fs.mkdirSync(path.dirname(sb.state(slug)), { recursive: true });
  fs.writeFileSync(sb.state(slug), '\u0000\u0000 not json\n{"v":1\n');
  const runCap = await runCapOf();
  let result;
  assert.doesNotThrow(() => { result = runCap(sb.repo, slug, { home: sb.home }); });
  assert.ok(Number.isInteger(result.cap) && result.cap >= 60000 && result.cap <= 1000000, JSON.stringify(result));
  assert.equal(result.handover, Math.floor(result.cap * 9 / 10));
});
