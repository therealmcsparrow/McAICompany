import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, show, list, active } from './run-state.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-list-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

let n = 0;
function repo() {
  const root = path.join(base, `r${n++}`);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}
const T0 = Date.parse('2026-11-04T10:00:00Z');
const go = (root, args, ms = 0) => run(args, { root, now: T0 + ms });
const dir = (root, slug) => path.join(root, '.company', 'work', slug);
const SLUG_A = '2026-11-01 10.00 - Alpha Build';
const SLUG_B = '2026-11-02 10.00 - Beta Build';
const SLUG_C = '2026-11-03 10.00 - Gamma Build';

function step(root, slug, file, extra = '') {
  const num = file.slice(0, 2);
  fs.writeFileSync(path.join(dir(root, slug), file),
    `---\nstep: ${num}\nrole: qa\nstatus: done\nround: 0\n${extra}---\nBody\n`);
}

test('list gives runs newest first, an oversize one unreadable', () => {
  const root = repo();
  go(root, ['start', SLUG_A], 0);
  go(root, ['start', SLUG_B], 60000);
  go(root, ['end', SLUG_B, 'ship'], 61000);
  fs.mkdirSync(dir(root, SLUG_C), { recursive: true });
  fs.writeFileSync(path.join(dir(root, SLUG_C), 'run-state.jsonl'), 'x'.repeat(70 * 1024));
  const r = list(root, { now: T0 + 120000 });
  assert.equal(r.v, 1);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.runs.map(x => x.slug), [SLUG_B, SLUG_A, SLUG_C]);
  assert.equal(r.runs[0].state, 'ended');
  assert.equal(r.runs[0].outcome, 'ship');
  assert.equal(r.runs[1].state, 'running');
  assert.deepEqual(r.runs[2], { slug: SLUG_C, state: 'unreadable', started: null, ended: null, outcome: null, tier: null, round: null });
  const cli = JSON.parse(go(root, ['list', '--json'], 120000).out);
  assert.deepEqual(cli, r);
  assert.equal(go(root, ['list']).code, 2);
});

test('list: a linked state file is unreadable and a missing work folder is empty', t => {
  const root = repo();
  fs.mkdirSync(dir(root, SLUG_A), { recursive: true });
  const target = path.join(base, 'target.jsonl');
  fs.writeFileSync(target, '');
  try { fs.symlinkSync(target, path.join(dir(root, SLUG_A), 'run-state.jsonl')); } catch { t.skip('no symlink right'); return; }
  const r = list(root, { now: T0 });
  assert.equal(r.runs.length, 1);
  assert.equal(r.runs[0].state, 'unreadable');
});

test('list: no work folder gives an empty list', () => {
  const empty = path.join(base, 'empty');
  fs.mkdirSync(empty);
  assert.deepEqual(list(empty), { v: 1, runs: [], warnings: [] });
});

test('list caps at 200 folders with a warning', () => {
  const root = repo();
  for (let i = 0; i < 205; i++) {
    const slug = `2026-10-01 ${String(Math.floor(i / 60)).padStart(2, '0')}.${String(i % 60).padStart(2, '0')} - Run Build`;
    fs.mkdirSync(dir(root, slug), { recursive: true });
    fs.writeFileSync(path.join(dir(root, slug), 'run-state.jsonl'), '');
  }
  const r = list(root, { now: T0 });
  assert.ok(r.runs.length <= 200);
  assert.deepEqual(r.warnings, ['over 200 runs']);
});

test('list over the cap keeps the newest runs', () => {
  const root = repo();
  for (let i = 0; i < 201; i++) {
    const slug = `2026-10-01 ${String(Math.floor(i / 60)).padStart(2, '0')}.${String(i % 60).padStart(2, '0')} - Run Build`;
    fs.mkdirSync(dir(root, slug), { recursive: true });
    fs.writeFileSync(path.join(dir(root, slug), 'run-state.jsonl'), '');
  }
  const newest = '2026-11-03 09.00 - Newest Build';
  fs.mkdirSync(dir(root, newest), { recursive: true });
  go(root, ['start', newest], 0);
  const r = list(root, { now: T0 + 1000 });
  assert.equal(r.runs.length, 200);
  assert.ok(r.runs.some(x => x.slug === newest));
  assert.equal(active(root, { now: T0 + 1000 }).slug, newest);
});

test('show has waves in file order', () => {
  const root = repo();
  go(root, ['start', SLUG_A], 0);
  assert.deepEqual(show(root, SLUG_A, { now: T0 }).waves, []);
  go(root, ['wave', SLUG_A, '1'], 1000);
  go(root, ['wave', SLUG_A, '2'], 2000);
  const v = show(root, SLUG_A, { now: T0 + 3000 });
  assert.equal(v.wave, 2);
  assert.deepEqual(v.waves, [{ wave: 1, at: '2026-11-04T10:00:01Z' }, { wave: 2, at: '2026-11-04T10:00:02Z' }]);
});

test('open_ask is null, set, null again, and the latest of two', () => {
  const root = repo();
  go(root, ['start', SLUG_A], 0);
  assert.equal(show(root, SLUG_A, { now: T0 }).open_ask, null);
  go(root, ['ask', SLUG_A, 'plan'], 1000);
  assert.deepEqual(show(root, SLUG_A, { now: T0 + 2000 }).open_ask, { gate: 'plan', at: '2026-11-04T10:00:01Z' });
  go(root, ['gate', SLUG_A, 'plan', 'passed'], 3000);
  assert.equal(show(root, SLUG_A, { now: T0 + 4000 }).open_ask, null);
  go(root, ['ask', SLUG_A, 'brief'], 5000);
  go(root, ['ask', SLUG_A, 'ship'], 6000);
  assert.deepEqual(show(root, SLUG_A, { now: T0 + 7000 }).open_ask, { gate: 'ship', at: '2026-11-04T10:00:06Z' });
  go(root, ['gate', SLUG_A, 'ship', 'passed'], 8000);
  assert.deepEqual(show(root, SLUG_A, { now: T0 + 9000 }).open_ask, { gate: 'brief', at: '2026-11-04T10:00:05Z' });
});

test('open_ask does not carry over into a new segment', () => {
  const root = repo();
  go(root, ['start', SLUG_A], 0);
  go(root, ['ask', SLUG_A, 'plan'], 1000);
  go(root, ['end', SLUG_A, 'abort'], 2000);
  go(root, ['start', SLUG_A], 5000);
  assert.equal(show(root, SLUG_A, { now: T0 + 6000 }).open_ask, null);
});

test('step verdict and gate are enums or null', () => {
  const root = repo();
  go(root, ['start', SLUG_A], 0);
  step(root, SLUG_A, '01-a.md', 'verdict: approve\ngate: pass\n');
  step(root, SLUG_A, '02-b.md', 'verdict: changes\ngate: fail\n');
  step(root, SLUG_A, '03-c.md', 'verdict: blocked\n');
  step(root, SLUG_A, '04-d.md', 'verdict: <b>x\ngate: maybe\n');
  step(root, SLUG_A, '05-e.md');
  step(root, SLUG_A, '06-f.md', 'verdict: Approve\n');
  const s = show(root, SLUG_A, { now: T0 + 1000 }).steps;
  const by = f => s.find(x => x.file === f);
  assert.deepEqual([by('01-a.md').verdict, by('01-a.md').gate], ['approve', 'pass']);
  assert.deepEqual([by('02-b.md').verdict, by('02-b.md').gate], ['changes', 'fail']);
  assert.deepEqual([by('03-c.md').verdict, by('03-c.md').gate], ['blocked', null]);
  assert.deepEqual([by('04-d.md').verdict, by('04-d.md').gate], [null, null]);
  assert.deepEqual([by('05-e.md').verdict, by('05-e.md').gate], [null, null]);
  assert.equal(by('06-f.md').verdict, null);
});

test('verdict in the body is not read', () => {
  const root = repo();
  go(root, ['start', SLUG_A], 0);
  fs.writeFileSync(path.join(dir(root, SLUG_A), '01-a.md'), '---\nstep: 01\nrole: qa\nstatus: done\nround: 0\n---\nverdict: approve\ngate: pass\n');
  const s = show(root, SLUG_A, { now: T0 + 1000 }).steps[0];
  assert.deepEqual([s.verdict, s.gate], [null, null]);
});

test('active is exported and matches active --json', () => {
  const root = repo();
  go(root, ['start', SLUG_A], 0);
  const a = active(root, { now: T0 + 1000 });
  assert.equal(a.slug, SLUG_A);
  assert.deepEqual(JSON.parse(go(root, ['active', '--json'], 1000).out), a);
});
