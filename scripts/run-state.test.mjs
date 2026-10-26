import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, show, active, append, MAX_FILE } from './run-state.mjs';

const script = path.join(import.meta.dirname, 'run-state.mjs');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

let n = 0;
function repo() {
  const root = path.join(base, `r${n++}`);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}
const runDir = (root, slug) => path.join(root, '.company', 'work', slug);
const stateFile = (root, slug) => path.join(runDir(root, slug), 'run-state.jsonl');
function folder(root, slug) {
  fs.mkdirSync(runDir(root, slug), { recursive: true });
  return runDir(root, slug);
}
function step(root, slug, name, fm, body = '## Did\n') {
  const text = typeof fm === 'string' ? fm : `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}`;
  const f = path.join(folder(root, slug), name);
  fs.writeFileSync(f, text);
  return f;
}
const FM = { step: '05', role: 'backend-engineer', task: 'x', status: 'done', round: 0, 'base-commit': 'abc1234', 'risk-tier': 'medium' };
const lines = (root, slug) => fs.readFileSync(stateFile(root, slug), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const T0 = Date.parse('2026-10-26T10:00:00Z');
const at = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const rec = (ms, extra) => JSON.stringify({ v: 1, at: at(ms), ...extra });
function seed(root, slug, recs) {
  folder(root, slug);
  fs.writeFileSync(stateFile(root, slug), `${recs.join('\n')}\n`);
}

// Hostile input first.
test('show: CRLF Step file is parsed', () => {
  const root = repo();
  step(root, 'x', '05-backend-engineer.md', `---\r\n${Object.entries(FM).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n---\r\n## Did\r\n`);
  const v = show(root, 'x');
  assert.equal(v.steps.length, 1);
  assert.equal(v.steps[0].role, 'backend-engineer');
  assert.equal(v.steps[0].status, 'done');
  assert.equal(v.tier, 'medium');
});

test('show: a 9 KiB frontmatter is left out with a warning', () => {
  const root = repo();
  const fm = Object.entries(FM).map(([k, v]) => `${k}: ${v}`).join('\n');
  step(root, 'x', '05-backend-engineer.md', `---\n${fm}\nacceptance-ids: [${'A'.repeat(9000)}]\n---\n## Did\n`);
  const v = show(root, 'x');
  assert.deepEqual(v.steps, []);
  assert.ok(v.warnings.includes('05-backend-engineer.md skipped'));
});

test('show: a symlinked Step file is never followed', (t) => {
  const root = repo();
  const outside = path.join(base, 'outside.md');
  fs.writeFileSync(outside, `---\n${Object.entries(FM).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`);
  folder(root, 'x');
  try { fs.symlinkSync(outside, path.join(runDir(root, 'x'), '05-backend-engineer.md')); } catch { t.skip('no symlink right'); return; }
  const v = show(root, 'x');
  assert.deepEqual(v.steps, []);
  assert.ok(v.warnings.includes('05-backend-engineer.md skipped'));
});

test('show: bad risk-tier, status and round read as unknown', () => {
  const root = repo();
  step(root, 'x', '05-backend-engineer.md', { ...FM, 'risk-tier': 'extreme', status: 'weird', round: 'two' });
  const v = show(root, 'x');
  assert.equal(v.steps[0].status, 'unknown');
  assert.equal(v.steps[0].round, 'unknown');
  assert.equal(v.tier, 'unknown');
  assert.equal(v.round, 0);
});

test('show: files without step or role are left out; round and tier take the highest', () => {
  const root = repo();
  step(root, 'x', '01-architect.md', { ...FM, step: '01', role: 'architect', 'risk-tier': 'low', round: 0 });
  step(root, 'x', '02-qa.md', { ...FM, step: '02', role: 'qa', 'risk-tier': 'high', round: 2 });
  step(root, 'x', '03-nostep.md', { role: 'qa', task: 'x' });
  step(root, 'x', '04-norole.md', { step: '04', task: 'x' });
  step(root, 'x', '55-plan.md', 'no frontmatter at all\n');
  step(root, 'x', 'notes.md', { ...FM });
  const v = show(root, 'x');
  assert.deepEqual(v.steps.map(s => s.file), ['01-architect.md', '02-qa.md']);
  assert.equal(v.round, 2);
  assert.equal(v.tier, 'high');
  assert.equal(v.warnings.length, 3);
  assert.match(v.steps[0].mtime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('show: a prototype-pollution key in the frontmatter does nothing', () => {
  const root = repo();
  step(root, 'x', '05-backend-engineer.md', `---\n${Object.entries(FM).map(([k, v]) => `${k}: ${v}`).join('\n')}\n__proto__: x\nconstructor: y\n---\n`);
  const v = show(root, 'x');
  assert.equal(v.steps.length, 1);
  assert.equal({}.polluted, undefined);
});

test('show: bad lines are skipped with a warning, good ones kept', () => {
  const root = repo();
  seed(root, 'x', [
    rec(T0, { ev: 'start' }),
    'not json',
    rec(T0, { ev: 'wave', wave: 2, extra: 1 }),
    rec(T0, { ev: 'wave', wave: 100 }),
    rec(T0, { ev: 'gate', gate: 'nope', result: 'passed' }),
    `${rec(T0, { ev: 'wave', wave: 3 })}\r`,
    JSON.stringify({ v: 1, at: 'yesterday', ev: 'start' }),
    JSON.stringify({ v: 1, at: at(T0), ev: 'wave', wave: 1, __proto__: { x: 1 } }),
    rec(T0 + 1000, { ev: 'wave', wave: 4 }),
  ]);
  const v = show(root, 'x', { now: T0 + 2000 });
  assert.equal(v.wave, 4);
  assert.deepEqual(v.warnings, ['line 2 skipped', 'line 3 skipped', 'line 4 skipped', 'line 5 skipped', 'line 6 skipped', 'line 7 skipped']);
});

test('limits: a line over 256 bytes is skipped', () => {
  const root = repo();
  seed(root, 'x', [rec(T0, { ev: 'start' }), rec(T0, { ev: 'wave', wave: 2, pad: 'x'.repeat(300) }), rec(T0, { ev: 'wave', wave: 5 })]);
  const v = show(root, 'x', { now: T0 });
  assert.equal(v.wave, 5);
  assert.deepEqual(v.warnings, ['line 2 skipped']);
});

test('limits: a file over 64 KiB or a symlink reads as none and unreadable; writes refused', (t) => {
  const root = repo();
  folder(root, 'big');
  fs.writeFileSync(stateFile(root, 'big'), `${rec(T0, { ev: 'start' })}\n${' '.repeat(MAX_FILE)}\n`);
  const v = show(root, 'big');
  assert.equal(v.state, 'none');
  assert.deepEqual(v.warnings, ['run-state unreadable']);
  assert.equal(run(['wave', 'big', '1'], { root }).code, 2);
  const real = path.join(base, 'real.jsonl');
  fs.writeFileSync(real, `${rec(T0, { ev: 'start' })}\n`);
  folder(root, 'lnk');
  try { fs.symlinkSync(real, stateFile(root, 'lnk')); } catch { t.skip('no symlink right'); return; }
  assert.equal(show(root, 'lnk').state, 'none');
  assert.deepEqual(show(root, 'lnk').warnings, ['run-state unreadable']);
  const r = run(['end', 'lnk', 'ship'], { root });
  assert.equal(r.code, 2);
  assert.equal(fs.readFileSync(real, 'utf8'), `${rec(T0, { ev: 'start' })}\n`);
});

test('limits: a symlinked run folder is refused for writes and reads as unreadable', (t) => {
  const root = repo();
  const target = path.join(base, 'elsewhere');
  fs.mkdirSync(target, { recursive: true });
  try { fs.symlinkSync(target, runDir(root, 'x'), 'junction'); } catch { t.skip('no symlink right'); return; }
  assert.equal(run(['start', 'x'], { root }).code, 2);
  assert.deepEqual(fs.readdirSync(target), []);
  assert.deepEqual(show(root, 'x').warnings, ['run-state unreadable']);
});

test('limits: the file stops growing at 64 KiB and at 1000 lines', () => {
  const root = repo();
  run(['start', 'x'], { root });
  const f = stateFile(root, 'x');
  const w = JSON.stringify({ v: 1, at: at(T0), ev: 'wave', wave: 1 });
  fs.appendFileSync(f, `${`${w}\n`.repeat(998)}`);
  assert.equal(run(['wave', 'x', '2'], { root }).code, 0); // line 1000
  const r = run(['wave', 'x', '3'], { root });
  assert.equal(r.code, 2);
  assert.match(r.out, /^refused: /);
  assert.equal(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length, 1000);

  const root2 = repo();
  run(['start', 'y'], { root: root2 });
  const f2 = stateFile(root2, 'y');
  const pad = `${JSON.stringify({ v: 1, at: at(T0), ev: 'wave', wave: 1 })}\n`;
  const fill = Math.floor((MAX_FILE - fs.statSync(f2).size - 10) / pad.length);
  fs.appendFileSync(f2, pad.repeat(Math.min(fill, 900)));
  fs.appendFileSync(f2, `${' '.repeat(MAX_FILE - fs.statSync(f2).size - 5)}\n`.slice(0, MAX_FILE - fs.statSync(f2).size));
  const before = fs.statSync(f2).size;
  assert.equal(run(['wave', 'y', '2'], { root: root2 }).code, 2);
  assert.equal(fs.statSync(f2).size, before);
});

// Refusals: nothing is written.
test('refusals: bad input writes nothing', () => {
  const root = repo();
  folder(root, 'x');
  const cases = [
    ['start', 'X'], ['start', '-x'], ['start', '../x'], ['start', 'a/b'], ['start', 'a'.repeat(65)], ['start', ''], ['start'],
    ['start', 'x', 'extra'],
    ['bogus', 'x'], [],
  ];
  for (const argv of cases) {
    const r = run(argv, { root });
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.match(r.out, /^refused: /, JSON.stringify(argv));
  }
  assert.equal(fs.existsSync(stateFile(root, 'x')), false);
  assert.deepEqual(fs.readdirSync(path.join(root, '.company', 'work')), ['x']);
});

test('refusals: wave, gate, result and outcome are allow-listed', () => {
  const root = repo();
  assert.equal(run(['start', 'x'], { root }).code, 0);
  const bad = [
    ['wave', 'x', '0'], ['wave', 'x', '100'], ['wave', 'x', '-1'], ['wave', 'x', '1.5'], ['wave', 'x', '05'], ['wave', 'x', '1e1'],
    ['wave', 'x', ' 2'], ['wave', 'x', 'two'], ['wave', 'x'],
    ['gate', 'x', 'nope', 'passed'], ['gate', 'x', 'brief', 'nope'], ['gate', 'x', 'Brief', 'passed'], ['gate', 'x', 'brief'],
    ['gate', 'x', 'brief', 'passed', 'more'],
    ['end', 'x', 'done'], ['end', 'x', 'SHIP'], ['end', 'x'],
    ['show', 'x'], ['show', 'x', '--yaml'], ['show', 'BAD', '--json'], ['active'], ['active', '--yaml'],
  ];
  for (const argv of bad) assert.equal(run(argv, { root }).code, 2, JSON.stringify(argv));
  assert.equal(lines(root, 'x').length, 1);
});

test('refusals: no open segment', () => {
  const root = repo();
  for (const argv of [['wave', 'x', '1'], ['gate', 'x', 'brief', 'passed'], ['end', 'x', 'ship']]) {
    assert.equal(run(argv, { root }).code, 2, JSON.stringify(argv));
  }
  assert.equal(fs.existsSync(stateFile(root, 'x')), false);
  run(['start', 'x'], { root });
  run(['end', 'x', 'abort'], { root });
  for (const argv of [['wave', 'x', '1'], ['gate', 'x', 'brief', 'passed'], ['end', 'x', 'ship']]) {
    assert.equal(run(argv, { root }).code, 2, JSON.stringify(argv));
  }
  assert.equal(lines(root, 'x').length, 2);
});

test('refusals: a second start before an end', () => {
  const root = repo();
  assert.equal(run(['start', 'x'], { root }).code, 0);
  const r = run(['start', 'x'], { root });
  assert.deepEqual(r, { out: 'refused: run x already started', code: 2 });
  assert.equal(lines(root, 'x').length, 1);
});

// Append and segment rules.
test('append: records are exact, ordered, and `at` comes from the script clock', () => {
  const root = repo();
  const now = T0;
  run(['start', 'x'], { root, now });
  run(['wave', 'x', '2'], { root, now: now + 1000 });
  run(['gate', 'x', 'plan', 'changed'], { root, now: now + 2000 });
  run(['end', 'x', 'ship'], { root, now: now + 3000 });
  assert.deepEqual(lines(root, 'x'), [
    { v: 1, at: at(now), ev: 'start' },
    { v: 1, at: at(now + 1000), ev: 'wave', wave: 2 },
    { v: 1, at: at(now + 2000), ev: 'gate', gate: 'plan', result: 'changed' },
    { v: 1, at: at(now + 3000), ev: 'end', outcome: 'ship' },
  ]);
  assert.equal(fs.readFileSync(stateFile(root, 'x'), 'utf8').includes('\r'), false);
});

test('append: `at` cannot be typed in; the allow-list refuses unknown keys', () => {
  const root = repo();
  assert.equal(run(['start', 'x', '2020-01-01T00:00:00Z'], { root }).code, 2);
  assert.throws(() => append(root, 'x', { ev: 'start', note: 'hi' }), /bad record/);
  assert.throws(() => append(root, 'x', { ev: 'start', at: '2020-01-01T00:00:00Z' }), /bad record/);
  assert.equal(fs.existsSync(stateFile(root, 'x')), false);
});

test('append: a start after an end begins a new segment and the view uses only that one', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  run(['wave', 'x', '3'], { root, now: T0 + 1000 });
  run(['gate', 'x', 'brief', 'passed'], { root, now: T0 + 2000 });
  run(['end', 'x', 'abort'], { root, now: T0 + 3000 });
  assert.equal(run(['start', 'x'], { root, now: T0 + 4000 }).code, 0);
  let v = show(root, 'x', { now: T0 + 5000 });
  assert.equal(v.state, 'running');
  assert.equal(v.started, at(T0 + 4000));
  assert.equal(v.wave, null);
  assert.deepEqual(v.gates, []);
  assert.equal(v.ended, null);
  run(['wave', 'x', '1'], { root, now: T0 + 5000 });
  run(['end', 'x', 'ship'], { root, now: T0 + 6000 });
  v = show(root, 'x', { now: T0 + 7000 });
  assert.equal(v.state, 'ended');
  assert.equal(v.outcome, 'ship');
  assert.equal(v.ended, at(T0 + 6000));
  assert.equal(v.wave, 1);
});

test('append: a last line without a newline does not glue to the next', () => {
  const root = repo();
  folder(root, 'x');
  fs.writeFileSync(stateFile(root, 'x'), rec(T0, { ev: 'start' }));
  assert.equal(run(['wave', 'x', '1'], { root, now: T0 + 1000 }).code, 0);
  assert.equal(lines(root, 'x').length, 2);
});

test('append: the run folder is created when missing', () => {
  const root = repo();
  assert.equal(run(['start', 'fresh'], { root }).code, 0);
  assert.equal(lines(root, 'fresh').length, 1);
});

// show.
test('show: a missing file is state none with the Steps still listed; exit 0', () => {
  const root = repo();
  step(root, 'x', '05-backend-engineer.md', FM);
  const r = run(['show', 'x', '--json'], { root });
  assert.equal(r.code, 0);
  const v = JSON.parse(r.out);
  assert.equal(v.state, 'none');
  assert.deepEqual(v.gates, []);
  assert.equal(v.steps.length, 1);
  assert.deepEqual(v.steps[0], { step: '05', role: 'backend-engineer', status: 'done', round: 0, file: '05-backend-engineer.md', mtime: v.steps[0].mtime });
  assert.equal(run(['show', 'nothing-here', '--json'], { root }).code, 0);
});

test('show: view shape for a running run', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  run(['wave', 'x', '2'], { root, now: T0 + 1000 });
  run(['gate', 'x', 'brief', 'passed'], { root, now: T0 + 2000 });
  const v = JSON.parse(run(['show', 'x', '--json'], { root, now: T0 + 3000 }).out);
  assert.deepEqual(v, {
    v: 1, slug: 'x', state: 'running', started: at(T0), ended: null, outcome: null, wave: 2,
    gates: [{ gate: 'brief', result: 'passed', at: at(T0 + 2000) }], round: 0, tier: 'unknown', steps: [], warnings: [],
  });
});

// active.
test('active: newest open segment wins; ended runs are not candidates', () => {
  const root = repo();
  seed(root, 'old', [rec(T0, { ev: 'start' })]);
  seed(root, 'new', [rec(T0 + 60000, { ev: 'start' })]);
  seed(root, 'done', [rec(T0 + 120000, { ev: 'start' }), rec(T0 + 130000, { ev: 'end', outcome: 'ship' })]);
  const a = active(root, { now: T0 + 200000 });
  assert.equal(a.slug, 'new');
  assert.equal(a.view.slug, 'new');
  assert.equal(a.view.state, 'running');
});

test('active: newest Step file mtime counts as activity', () => {
  const root = repo();
  seed(root, 'a', [rec(T0, { ev: 'start' })]);
  seed(root, 'b', [rec(T0 - 1000, { ev: 'start' })]);
  const f = step(root, 'b', '05-backend-engineer.md', FM);
  fs.utimesSync(f, new Date(T0 + 5000), new Date(T0 + 5000));
  assert.equal(active(root, { now: T0 + 10000 }).slug, 'b');
});

test('active: a segment idle for 12 hours is stale and never active', () => {
  const root = repo();
  const H = 3600 * 1000;
  seed(root, 'stale', [rec(T0, { ev: 'start' })]);
  assert.deepEqual(active(root, { now: T0 + 12 * H + 1000 }), { slug: null, view: null });
  assert.equal(show(root, 'stale', { now: T0 + 12 * H + 1000 }).state, 'stale');
  assert.equal(active(root, { now: T0 + 12 * H }).slug, 'stale');
  seed(root, 'fresh', [rec(T0 + 11 * H, { ev: 'start' })]);
  assert.equal(active(root, { now: T0 + 13 * H }).slug, 'fresh');
});

test('active: no candidate, no work folder, symlinked state file', (t) => {
  const root = repo();
  assert.deepEqual(JSON.parse(run(['active', '--json'], { root }).out), { slug: null, view: null });
  assert.deepEqual(active(path.join(base, 'does-not-exist')), { slug: null, view: null });
  const real = path.join(base, 'real2.jsonl');
  fs.writeFileSync(real, `${rec(Date.now(), { ev: 'start' })}\n`);
  folder(root, 'lnk');
  try { fs.symlinkSync(real, stateFile(root, 'lnk')); } catch { t.skip('no symlink right'); return; }
  assert.equal(active(root).slug, null);
});

test('active: folders with a bad name are ignored', () => {
  const root = repo();
  seed(root, 'Bad_Name', [rec(Date.now(), { ev: 'start' })]);
  assert.equal(active(root).slug, null);
});

// CLI.
test('cli: spawned script prints refusals on stdout with exit 2 and views with exit 0', () => {
  const root = repo();
  const go = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  let r = go('start', 'x');
  assert.equal(r.status, 0);
  r = go('start', 'x');
  assert.equal(r.status, 2);
  assert.equal(r.stdout, 'refused: run x already started\n');
  r = go('wave', 'x', '2');
  assert.equal(r.status, 0);
  r = go('show', 'x', '--json');
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).wave, 2);
  r = go('active', '--json');
  assert.equal(JSON.parse(r.stdout).slug, 'x');
  r = go('nonsense');
  assert.equal(r.status, 2);
});

test('the script and its test are LF only', () => {
  for (const f of [script, path.join(import.meta.dirname, 'run-state.test.mjs')]) {
    assert.equal(fs.readFileSync(f).includes(13), false, f);
  }
});
