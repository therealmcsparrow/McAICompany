// Tests for run-state v2.1: `runSlugs`, and `list` / `active` over a tree with v3 projects and v2 folders.
// Slugs may now hold one `/`: `<ID>/<NN>-<playbook>`.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as rs from './run-state.mjs';

const SCRIPT = fileURLToPath(new URL('./run-state.mjs', import.meta.url));
const REPO = path.join(path.dirname(SCRIPT), '..');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-v2-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const T0 = Date.parse('2026-11-09T12:00:00Z');
const MIN = 60 * 1000;
const ID1 = 'P20261109.000001';
const ID2 = 'P20261109.000002';
const ID3 = 'P20261109.000003';
const V2_1 = `${ID1}-10.00.00`;
const V2_3 = `${ID3}-10.00.00`;

let n = 0;
function repo() {
  const root = path.join(base, `r${n++}`);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}
const work = root => path.join(root, '.company', 'work');
const go = (root, args, ms = 0) => rs.run(args, { root, now: T0 + ms });
const mk = (root, ...parts) => fs.mkdirSync(path.join(work(root), ...parts), { recursive: true });
// A v3 project folder with run folders.
function v3(root, id, runs) {
  mk(root, id);
  fs.writeFileSync(path.join(work(root), id, '00-project.md'), 'A project\n');
  for (const r of runs) mk(root, id, r);
}
const startRun = (root, slug, ms) => assert.equal(go(root, ['start', slug], ms).code, 0);
// NN 100..(100 + count - 1): three-digit run numbers are the only ones that keep the same width past 99.
const manyRuns = count => Array.from({ length: count }, (_, i) => `${100 + i}-feature`);

describe('runSlugs (run-state v2.1)', () => {
  test('is exported; an empty or missing work folder gives no slugs', () => {
    assert.equal(typeof rs.runSlugs, 'function');
    const root = repo();
    assert.deepEqual(rs.runSlugs(root), { slugs: [], capped: false });
    const none = path.join(base, 'no-company');
    fs.mkdirSync(none);
    assert.deepEqual(rs.runSlugs(none), { slugs: [], capped: false });
  });

  test('v2, legacy and v3 runs in reverse top-level name order; a v3 project expands in place, NN descending', () => {
    const root = repo();
    mk(root, V2_1);
    mk(root, 'demo-run');
    mk(root, V2_3);
    v3(root, ID2, ['01-feature', '02-fix', '10-draft']);
    assert.deepEqual(rs.runSlugs(root), {
      slugs: ['demo-run', V2_3, `${ID2}/10-draft`, `${ID2}/02-fix`, `${ID2}/01-feature`, V2_1],
      capped: false,
    });
  });

  test('skips files, bad sub folder names and a project folder without runs', () => {
    const root = repo();
    v3(root, ID1, ['01-feature', '1-feature', '01-Feature', '00-notes', 'scratch']);
    fs.writeFileSync(path.join(work(root), ID1, '02-fix'), 'a file, not a folder');
    v3(root, ID2, []);
    fs.writeFileSync(path.join(work(root), ID3), 'a file named like a project');
    assert.deepEqual(rs.runSlugs(root).slugs, [`${ID1}/01-feature`]);
  });

  test('skips a link to a project folder and a link to a run folder', () => {
    const root = repo();
    const outside = path.join(base, `outside${n++}`);
    fs.mkdirSync(path.join(outside, '01-feature'), { recursive: true });
    fs.mkdirSync(path.join(outside, 'x'), { recursive: true });
    v3(root, ID1, ['01-feature']);
    fs.symlinkSync(outside, path.join(work(root), ID2), 'junction');
    mk(root, ID3);
    fs.symlinkSync(path.join(outside, 'x'), path.join(work(root), ID3, '01-linked'), 'junction');
    assert.deepEqual(rs.runSlugs(root).slugs, [`${ID1}/01-feature`]);
  });

  test('a .company/work link pointing out of the root yields nothing', () => {
    const root = path.join(base, `r${n++}`);
    const outside = path.join(base, `outside${n++}`);
    fs.mkdirSync(path.join(outside, ID1, '01-feature'), { recursive: true });
    fs.mkdirSync(path.join(root, '.company'), { recursive: true });
    fs.symlinkSync(outside, path.join(root, '.company', 'work'), 'junction');
    assert.deepEqual(rs.runSlugs(root).slugs, []);
  });

  test('max counts runs, not top folders: the newest runs are kept and capped is true', () => {
    const root = repo();
    mk(root, V2_1);
    v3(root, ID2, ['01-feature', '02-fix', '03-fix']);
    mk(root, V2_3);
    assert.deepEqual(rs.runSlugs(root, { max: 3 }), { slugs: [V2_3, `${ID2}/03-fix`, `${ID2}/02-fix`], capped: true });
    const five = rs.runSlugs(root, { max: 5 });
    assert.equal(five.slugs.length, 5);
    assert.equal(five.capped, false);
  });

  test('default cap is 200 runs: 200 pass, 201 are capped to the newest 200', () => {
    const root = repo();
    v3(root, ID1, manyRuns(200));
    const exact = rs.runSlugs(root);
    assert.equal(exact.slugs.length, 200);
    assert.equal(exact.capped, false);
    mk(root, ID1, '300-feature');
    const over = rs.runSlugs(root);
    assert.equal(over.slugs.length, 200);
    assert.equal(over.capped, true);
    assert.equal(over.slugs[0], `${ID1}/300-feature`);
    assert.equal(over.slugs[199], `${ID1}/101-feature`);
  });

  test('200 v2 folders plus one v3 run: the cap keeps the newest 200 across both layouts', () => {
    const root = repo();
    for (let i = 0; i < 200; i++) mk(root, `P20261108.${String(i + 1).padStart(6, '0')}-10.00.00`);
    v3(root, ID1, ['01-feature']);
    const r = rs.runSlugs(root);
    assert.equal(r.slugs.length, 200);
    assert.equal(r.capped, true);
    assert.equal(r.slugs[0], `${ID1}/01-feature`);
  });
});

describe('list over a mixed tree', () => {
  test('a v3 run appears with its nested slug; the v2 run keeps its entry exactly', () => {
    const root = repo();
    mk(root, V2_1);
    v3(root, ID2, ['01-feature']);
    startRun(root, V2_1, 0);
    startRun(root, `${ID2}/01-feature`, 5 * MIN);
    const out = rs.list(root, { now: T0 + 6 * MIN });
    assert.deepEqual(out, {
      v: 1,
      warnings: [],
      runs: [
        { slug: `${ID2}/01-feature`, state: 'running', started: '2026-11-09T12:05:00Z', ended: null, outcome: null, tier: 'unknown', round: 0 },
        { slug: V2_1, state: 'running', started: '2026-11-09T12:00:00Z', ended: null, outcome: null, tier: 'unknown', round: 0 },
      ],
    });
  });

  test('a v3 folder without run-state is not listed; an ended v3 run is', () => {
    const root = repo();
    v3(root, ID1, ['01-feature', '02-fix']);
    startRun(root, `${ID1}/02-fix`, 0);
    assert.equal(go(root, ['end', `${ID1}/02-fix`, 'ship'], MIN).code, 0);
    const runs = rs.list(root, { now: T0 + 2 * MIN }).runs;
    assert.deepEqual(runs.map(r => [r.slug, r.state, r.outcome]), [[`${ID1}/02-fix`, 'ended', 'ship']]);
  });

  test('list lists the good v3 run and skips a linked project, a linked run, bad sub names and files, though each has run-state', () => {
    const root = repo();
    const outside = path.join(base, `outside${n++}`);
    const line = `${JSON.stringify({ v: 1, at: '2026-11-09T12:00:00Z', ev: 'start' })}\n`;
    fs.mkdirSync(path.join(outside, '01-feature'), { recursive: true });
    fs.writeFileSync(path.join(outside, '01-feature', 'run-state.jsonl'), line);
    v3(root, ID1, ['01-feature', '1-feature', '01-Feature']);
    for (const r of ['01-feature', '1-feature', '01-Feature']) fs.writeFileSync(path.join(work(root), ID1, r, 'run-state.jsonl'), line);
    fs.symlinkSync(outside, path.join(work(root), ID2), 'junction');
    mk(root, ID3);
    fs.symlinkSync(path.join(outside, '01-feature'), path.join(work(root), ID3, '01-linked'), 'junction');
    assert.deepEqual(rs.list(root, { now: T0 }).runs.map(r => r.slug), [`${ID1}/01-feature`]);
  });

  test('an unreadable nested state file is one unreadable entry with the nested slug', () => {
    const root = repo();
    v3(root, ID1, ['01-feature']);
    fs.mkdirSync(path.join(work(root), ID1, '01-feature', 'run-state.jsonl'));
    assert.deepEqual(rs.list(root).runs, [
      { slug: `${ID1}/01-feature`, state: 'unreadable', started: null, ended: null, outcome: null, tier: null, round: null },
    ]);
  });

  test('legacy and v2 beside a v3 project: the old entries keep their shape and slugs', () => {
    const root = repo();
    mk(root, 'demo-run');
    mk(root, V2_3);
    v3(root, ID2, ['01-feature']);
    startRun(root, 'demo-run', 0);
    startRun(root, V2_3, MIN);
    startRun(root, `${ID2}/01-feature`, 2 * MIN);
    const out = rs.list(root, { now: T0 + 3 * MIN });
    assert.deepEqual(out.runs.map(r => r.slug), [`${ID2}/01-feature`, V2_3, 'demo-run']);
    for (const r of out.runs) assert.deepEqual(Object.keys(r), ['slug', 'state', 'started', 'ended', 'outcome', 'tier', 'round']);
    assert.deepEqual(out.warnings, []);
  });

  test('over 200 runs: the newest 200 are listed with the `over 200 runs` warning, v3 runs counted one each', () => {
    const root = repo();
    const runs = manyRuns(201);
    v3(root, ID1, runs);
    for (const r of runs) fs.writeFileSync(path.join(work(root), ID1, r, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: '2026-11-09T12:00:00Z', ev: 'start' })}\n`);
    const out = rs.list(root, { now: T0 });
    assert.equal(out.runs.length, 200);
    assert.deepEqual(out.warnings, ['over 200 runs']);
    assert.ok(out.runs.every(r => r.slug.startsWith(`${ID1}/`)));
    assert.ok(!out.runs.some(r => r.slug === `${ID1}/100-feature`));
  });

  test('the CLI `list --json` prints the nested slug', () => {
    const root = repo();
    v3(root, ID1, ['01-feature']);
    startRun(root, `${ID1}/01-feature`, 0);
    const r = spawnSync(process.execPath, [SCRIPT, 'list', '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).runs.map(x => x.slug), [`${ID1}/01-feature`]);
  });
});

describe('active over a mixed tree', () => {
  test('a running v3 run is the active run, slug `<ID>/<NN>-<pb>`', () => {
    const root = repo();
    v3(root, ID1, ['01-feature']);
    startRun(root, `${ID1}/01-feature`, 0);
    const a = rs.active(root, { now: T0 + MIN });
    assert.equal(a.slug, `${ID1}/01-feature`);
    assert.equal(a.view.slug, `${ID1}/01-feature`);
    assert.equal(a.view.state, 'running');
  });

  test('the newest activity wins between a v2 run and a v3 run, in both orders', () => {
    const root = repo();
    mk(root, V2_1);
    v3(root, ID2, ['01-feature']);
    startRun(root, V2_1, 0);
    startRun(root, `${ID2}/01-feature`, 5 * MIN);
    assert.equal(rs.active(root, { now: T0 + 6 * MIN }).slug, `${ID2}/01-feature`);
    assert.equal(go(root, ['wave', V2_1, '2'], 8 * MIN).code, 0);
    assert.equal(rs.active(root, { now: T0 + 9 * MIN }).slug, V2_1);
  });

  test('an ended v3 run is not active; a running v2 run still is', () => {
    const root = repo();
    mk(root, V2_1);
    v3(root, ID2, ['01-feature']);
    startRun(root, V2_1, 0);
    startRun(root, `${ID2}/01-feature`, MIN);
    go(root, ['end', `${ID2}/01-feature`, 'abort'], 2 * MIN);
    assert.equal(rs.active(root, { now: T0 + 3 * MIN }).slug, V2_1);
  });

  test('no running run: slug null, view null', () => {
    const root = repo();
    v3(root, ID1, ['01-feature']);
    assert.deepEqual(rs.active(root), { slug: null, view: null });
  });

  test('the CLI `active --json` prints the nested slug', () => {
    const root = repo();
    v3(root, ID1, ['01-feature']);
    startRun(root, `${ID1}/01-feature`, 0);
    // The CLI uses the real clock: write a fresh start line so the run is running now.
    const file = path.join(work(root), ID1, '01-feature', 'run-state.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ v: 1, at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), ev: 'start' })}\n`);
    const r = spawnSync(process.execPath, [SCRIPT, 'active', '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).slug, `${ID1}/01-feature`);
  });
});

describe('the Contract', () => {
  test('the doc is v2.1 and says v2, v1.1 and legacy names behave as before', () => {
    const text = fs.readFileSync(path.join(REPO, 'docs', 'contracts', 'run-state.md'), 'utf8');
    assert.match(text, /^# Contract: run-state v2\.1\r?$/m);
    assert.ok(text.includes('runSlugs'));
    assert.match(text, /byte-identical/);
  });
});
