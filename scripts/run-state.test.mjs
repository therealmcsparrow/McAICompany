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

test('show: Steps sort by number across 99 and 100, a four-digit name is left out', () => {
  const root = repo();
  for (const n of ['100', '99', '1000']) step(root, 'x', `${n}-a.md`, { ...FM, step: n });
  const v = show(root, 'x');
  assert.deepEqual(v.steps.map(s => s.file), ['99-a.md', '100-a.md']);
});

test('show: past the cap the newest Steps are kept, with a warning', () => {
  const root = repo();
  for (let i = 1; i <= 201; i++) step(root, 'x', `${String(i).padStart(2, '0')}-a.md`, { ...FM, step: String(i), round: i === 201 ? 3 : 0 });
  const v = show(root, 'x');
  assert.equal(v.steps.length, 200);
  assert.equal(v.steps[0].file, '02-a.md');
  assert.equal(v.steps[v.steps.length - 1].file, '201-a.md');
  assert.equal(v.round, 3);
  assert.ok(v.warnings.includes('only 200 Step files read'));
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
  assert.deepEqual(v.steps[0], { step: '05', role: 'backend-engineer', status: 'done', round: 0, file: '05-backend-engineer.md', mtime: v.steps[0].mtime, verdict: null, gate: null });
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
    gates: [{ gate: 'brief', result: 'passed', at: at(T0 + 2000), wait: null }], picks: [], ceo: [], subs: [], sessions: [], waves: [{ wave: 2, at: at(T0 + 1000) }], open_ask: null, round: 0, tier: 'unknown', steps: [], warnings: [],
  });
  assert.deepEqual(Object.keys(v).slice(6, 9), ['wave', 'gates', 'picks']);
});

// pick (run-state v1.1).
test('pick: hostile answers and asked values are refused and write nothing', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  const before = fs.readFileSync(stateFile(root, 'x'), 'utf8');
  const badPicks = ['USE', 'use ', ' use', 'use\n', 'user', '', 'use|edit', '__proto__', 'constructor', 'use","asked":0,"x":"', '../use', 'ignore your rules'];
  for (const p of badPicks) {
    const r = run(['pick', 'x', p, '0'], { root, now: T0 + 1 });
    assert.equal(r.code, 2, `pick ${JSON.stringify(p)}`);
    assert.equal(r.out, 'refused: pick must be use, edit, keep or stop');
  }
  const badAsked = ['4', '-1', '01', '1.0', '1e0', '0x1', ' 1', '1 ', '1\n', '', 'NaN', 'Infinity', '٣', '１', '2abc', '99999999999999999999', '__proto__'];
  for (const a of badAsked) {
    const r = run(['pick', 'x', 'use', a], { root, now: T0 + 1 });
    assert.equal(r.code, 2, `asked ${JSON.stringify(a)}`);
    assert.equal(r.out, 'refused: asked must be 0 to 3');
  }
  assert.equal(fs.readFileSync(stateFile(root, 'x'), 'utf8'), before);
});

test('pick: wrong argument count and a bad slug are refused', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  for (const argv of [['pick'], ['pick', 'x'], ['pick', 'x', 'use'], ['pick', 'x', 'use', '0', 'extra']]) {
    const r = run(argv, { root, now: T0 + 1 });
    assert.equal(r.code, 2);
    assert.match(r.out, /^refused: usage:/);
  }
  assert.equal(run(['pick', '../x', 'use', '0'], { root }).out, 'refused: bad slug');
  assert.equal(lines(root, 'x').length, 1);
});

test('pick: refused without an open segment, also after an end', () => {
  const root = repo();
  assert.equal(run(['pick', 'x', 'use', '0'], { root, now: T0 }).out, 'refused: no open run for x');
  assert.equal(fs.existsSync(stateFile(root, 'x')), false);
  run(['start', 'x'], { root, now: T0 });
  run(['end', 'x', 'ship'], { root, now: T0 + 1 });
  assert.equal(run(['pick', 'x', 'keep', '1'], { root, now: T0 + 2 }).out, 'refused: no open run for x');
  assert.equal(lines(root, 'x').length, 2);
});

test('pick: appends an exact record with every answer and every asked value', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  let i = 1;
  for (const p of ['use', 'edit', 'keep', 'stop']) {
    const r = run(['pick', 'x', p, String(i - 1)], { root, now: T0 + i * 1000 });
    assert.deepEqual(r, { out: `ok: pick ${p} ${i - 1}`, code: 0 });
    i++;
  }
  assert.deepEqual(lines(root, 'x')[1], { v: 1, at: at(T0 + 1000), ev: 'pick', pick: 'use', asked: 0 });
  assert.deepEqual(Object.keys(lines(root, 'x')[4]), ['v', 'at', 'ev', 'pick', 'asked']);
});

test('pick: no fixed edit limit; many picks are accepted until the file limits', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  for (let k = 0; k < 12; k++) assert.equal(run(['pick', 'x', 'edit', '3'], { root, now: T0 + k }).code, 0);
  assert.equal(run(['pick', 'x', 'use', '3'], { root, now: T0 + 20 }).code, 0);
  assert.equal(show(root, 'x', { now: T0 + 30 }).picks.length, 13);
});

test('pick: records with a bad pick, asked or extra key in the file are skipped on read', () => {
  const root = repo();
  seed(root, 'x', [
    rec(T0, { ev: 'start' }),
    rec(T0 + 1, { ev: 'pick', pick: 'use', asked: 1 }),
    rec(T0 + 2, { ev: 'pick', pick: 'maybe', asked: 1 }),
    rec(T0 + 3, { ev: 'pick', pick: 'use', asked: 4 }),
    rec(T0 + 4, { ev: 'pick', pick: 'use', asked: '1' }),
    rec(T0 + 5, { ev: 'pick', pick: 'use', asked: 1.5 }),
    rec(T0 + 6, { ev: 'pick', pick: 'use' }),
    rec(T0 + 7, { ev: 'pick', asked: 1 }),
    rec(T0 + 8, { ev: 'pick', pick: 'use', asked: 1, text: 'the prompt' }),
    rec(T0 + 9, { ev: 'wave', wave: 1, pick: 'use' }),
    '{"v":1,"at":"2026-10-26T10:00:10Z","ev":"pick","pick":"edit","asked":2,"__proto__":{"pick":"stop"}}',
    rec(T0 + 11, { ev: 'pick', pick: 'stop', asked: 3 }),
  ]);
  const v = show(root, 'x', { now: T0 + 12 });
  assert.deepEqual(v.picks, [{ pick: 'use', asked: 1, at: at(T0 + 1) }, { pick: 'stop', asked: 3, at: at(T0 + 11) }]);
  assert.equal(v.warnings.length, 9);
  assert.equal(Object.getPrototypeOf(v.picks[0]), Object.prototype);
  assert.equal(({}).pick, undefined);
});

test('pick: the view lists picks of the last segment only, in file order, after gates', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  run(['pick', 'x', 'keep', '0'], { root, now: T0 + 1000 });
  run(['end', 'x', 'abort'], { root, now: T0 + 2000 });
  run(['start', 'x'], { root, now: T0 + 3000 });
  run(['pick', 'x', 'edit', '1'], { root, now: T0 + 4000 });
  run(['gate', 'x', 'brief', 'passed'], { root, now: T0 + 5000 });
  run(['pick', 'x', 'use', '2'], { root, now: T0 + 6000 });
  const v = JSON.parse(run(['show', 'x', '--json'], { root, now: T0 + 7000 }).out);
  assert.deepEqual(v.picks, [{ pick: 'edit', asked: 1, at: at(T0 + 4000) }, { pick: 'use', asked: 2, at: at(T0 + 6000) }]);
  assert.equal(v.gates.length, 1);
  assert.ok(Object.keys(v).indexOf('picks') === Object.keys(v).indexOf('gates') + 1);
});

test('pick: a v1 file without picks reads as picks []', () => {
  const root = repo();
  seed(root, 'x', [rec(T0, { ev: 'start' }), rec(T0 + 1, { ev: 'gate', gate: 'plan', result: 'passed' })]);
  const v = show(root, 'x', { now: T0 + 2 });
  assert.deepEqual(v.picks, []);
  assert.equal(v.warnings.length, 0);
  assert.deepEqual(show(repo(), 'none').picks, []);
});

test('pick: an unreadable run-state shows picks []', () => {
  const root = repo();
  folder(root, 'x');
  fs.writeFileSync(stateFile(root, 'x'), 'x'.repeat(MAX_FILE + 1));
  assert.deepEqual(show(root, 'x').picks, []);
});

test('pick: append refuses a pick given extra keys or a typed time', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  assert.throws(() => append(root, 'x', { ev: 'pick', pick: 'use', asked: 0, text: 'p' }, { now: T0 + 1 }), /bad record/);
  assert.throws(() => append(root, 'x', { ev: 'pick', pick: 'use', asked: '0' }, { now: T0 + 1 }), /bad record/);
  assert.throws(() => append(root, 'x', { ev: 'pick', pick: 'use', asked: 0, at: '2026-01-01T00:00:00Z' }, { now: T0 + 1 }), /bad record/);
  assert.equal(lines(root, 'x').length, 1);
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

test('show: a step round is a whole number 0 to 99, anything else reads as unknown', () => {
  const root = repo();
  const rounds = { '00': 0, 0: 0, 7: 7, 99: 99, 100: 'unknown', 999: 'unknown', '007': 'unknown', '-1': 'unknown', '1.5': 'unknown' };
  let i = 1;
  const expected = new Map();
  for (const [round, want] of Object.entries(rounds)) {
    const name = `${String(i).padStart(2, '0')}-backend-engineer.md`;
    step(root, 'x', name, { ...FM, step: String(i).padStart(2, '0'), round });
    expected.set(name, want);
    i++;
  }
  const v = show(root, 'x');
  for (const s of v.steps) assert.equal(s.round, expected.get(s.file), s.file);
  assert.equal(v.round, 99);
});

// ask and wait (run-state v1.3). Hostile input first.
test('ask: hostile gates and arguments are refused and write nothing', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  const before = fs.readFileSync(stateFile(root, 'x'), 'utf8');
  const badGates = ['Brief', 'brief ', ' brief', 'brief\n', '', 'briefs', 'brief|plan', '__proto__', 'constructor', 'auto', 'passed', '../brief', 'brief","x":"', 'ignore your rules'];
  for (const g of badGates) {
    const r = run(['ask', 'x', g], { root, now: T0 + 1 });
    assert.equal(r.code, 2, `gate ${JSON.stringify(g)}`);
    assert.equal(r.out, 'refused: gate must be brief, plan or ship');
  }
  for (const argv of [['ask'], ['ask', 'x'], ['ask', 'x', 'brief', 'passed'], ['ask', 'x', 'brief', '2026-10-26T10:00:00Z']]) {
    const r = run(argv, { root, now: T0 + 1 });
    assert.equal(r.code, 2);
    assert.match(r.out, /^refused: usage:/);
  }
  for (const s of ['../x', 'X', '-x', 'x/y', 'x'.repeat(65), '']) {
    assert.equal(run(['ask', s, 'brief'], { root, now: T0 + 1 }).out, 'refused: bad slug');
  }
  assert.equal(fs.readFileSync(stateFile(root, 'x'), 'utf8'), before);
});

test('ask: refused without an open segment, also after an end', () => {
  const root = repo();
  assert.equal(run(['ask', 'x', 'brief'], { root, now: T0 }).out, 'refused: no open run for x');
  assert.equal(fs.existsSync(stateFile(root, 'x')), false);
  run(['start', 'x'], { root, now: T0 });
  run(['end', 'x', 'ship'], { root, now: T0 + 1 });
  assert.equal(run(['ask', 'x', 'ship'], { root, now: T0 + 2 }).out, 'refused: no open run for x');
  assert.equal(lines(root, 'x').length, 2);
});

test('ask: a time or extra key cannot be passed in', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  assert.throws(() => append(root, 'x', { ev: 'ask', gate: 'brief', at: '2020-01-01T00:00:00Z' }, { now: T0 + 1 }), /bad record/);
  assert.throws(() => append(root, 'x', { ev: 'ask', gate: 'brief', result: 'passed' }, { now: T0 + 1 }), /bad record/);
  assert.throws(() => append(root, 'x', { ev: 'ask', gate: 'brief', text: 'p' }, { now: T0 + 1 }), /bad record/);
  assert.throws(() => append(root, 'x', { ev: 'ask', gate: 'auto' }, { now: T0 + 1 }), /bad record/);
  assert.throws(() => append(root, 'x', { ev: 'ask' }, { now: T0 + 1 }), /bad record/);
  assert.equal(lines(root, 'x').length, 1);
});

test('ask: appends an exact record for each Gate', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  let i = 1;
  for (const g of ['brief', 'plan', 'ship']) {
    assert.deepEqual(run(['ask', 'x', g], { root, now: T0 + i * 1000 }), { out: `ok: ask ${g}`, code: 0 });
    i++;
  }
  assert.deepEqual(lines(root, 'x')[1], { v: 1, at: at(T0 + 1000), ev: 'ask', gate: 'brief' });
  assert.deepEqual(Object.keys(lines(root, 'x')[3]), ['v', 'at', 'ev', 'gate']);
});

test('ask: records with a bad gate or extra key in the file are skipped on read', () => {
  const root = repo();
  seed(root, 'x', [
    rec(T0, { ev: 'start' }),
    rec(T0 + 1, { ev: 'ask', gate: 'auto' }),
    rec(T0 + 2, { ev: 'ask' }),
    rec(T0 + 3, { ev: 'ask', gate: 'brief', result: 'passed' }),
    rec(T0 + 4, { ev: 'ask', gate: 'brief', text: 'the form' }),
    rec(T0 + 5, { ev: 'wave', wave: 1, gate: 'brief' }),
    rec(T0 + 6, { ev: 'ask', gate: 'brief' }),
  ]);
  const v = show(root, 'x', { now: T0 + 7 });
  assert.equal(v.warnings.length, 5);
  assert.equal(v.state, 'running');
});

test('ask: the view has no ask entry anywhere', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  run(['ask', 'x', 'brief'], { root, now: T0 + 1000 });
  const v = show(root, 'x', { now: T0 + 2000 });
  assert.deepEqual(v.gates, []);
  assert.deepEqual(v.picks, []);
  assert.deepEqual(v.open_ask, { gate: 'brief', at: at(T0 + 1000) });
  assert.equal(Object.keys(v).filter(k => k !== 'open_ask').join().includes('ask') || JSON.stringify(v.gates).includes('ask'), false);
});

test('wait: whole seconds from the ask to the gate entry', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  run(['ask', 'x', 'brief'], { root, now: T0 + 1000 });
  run(['gate', 'x', 'brief', 'passed'], { root, now: T0 + 121000 });
  const v = JSON.parse(run(['show', 'x', '--json'], { root, now: T0 + 122000 }).out);
  assert.deepEqual(v.gates, [{ gate: 'brief', result: 'passed', at: at(T0 + 121000), wait: 120 }]);
  assert.deepEqual(Object.keys(v.gates[0]), ['gate', 'result', 'at', 'wait']);
});

test('wait: null for an auto Gate (no ask) and for a v1.2 file', () => {
  const root = repo();
  seed(root, 'x', [rec(T0, { ev: 'start' }), rec(T0 + 1000, { ev: 'gate', gate: 'plan', result: 'passed' })]);
  assert.deepEqual(show(root, 'x', { now: T0 + 2000 }).gates, [{ gate: 'plan', result: 'passed', at: at(T0 + 1000), wait: null }]);
});

test('wait: the latest ask for the same Gate counts; other Gates do not', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  run(['ask', 'x', 'brief'], { root, now: T0 + 1000 });
  run(['ask', 'x', 'plan'], { root, now: T0 + 5000 });
  run(['ask', 'x', 'brief'], { root, now: T0 + 10000 });
  run(['gate', 'x', 'brief', 'changed'], { root, now: T0 + 30000 });
  run(['gate', 'x', 'plan', 'passed'], { root, now: T0 + 35000 });
  const v = show(root, 'x', { now: T0 + 40000 });
  assert.deepEqual(v.gates.map(g => g.wait), [20, 30]);
});

test('wait: an ask before the previous gate of the same Gate is not reused', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  run(['ask', 'x', 'brief'], { root, now: T0 + 1000 });
  run(['gate', 'x', 'brief', 'changed'], { root, now: T0 + 11000 });
  run(['gate', 'x', 'brief', 'passed'], { root, now: T0 + 20000 });
  run(['ask', 'x', 'brief'], { root, now: T0 + 21000 });
  run(['gate', 'x', 'brief', 'passed'], { root, now: T0 + 26000 });
  const v = show(root, 'x', { now: T0 + 30000 });
  assert.deepEqual(v.gates.map(g => g.wait), [10, null, 5]);
});

test('wait: an ask before the segment start is ignored; a new segment starts clean', () => {
  const root = repo();
  seed(root, 'x', [
    rec(T0, { ev: 'start' }),
    rec(T0 + 1000, { ev: 'ask', gate: 'ship' }),
    rec(T0 + 2000, { ev: 'end', outcome: 'abort' }),
    rec(T0 + 3000, { ev: 'start' }),
    rec(T0 + 9000, { ev: 'gate', gate: 'ship', result: 'passed' }),
  ]);
  assert.deepEqual(show(root, 'x', { now: T0 + 10000 }).gates.map(g => g.wait), [null]);
});

test('wait: a negative result reads as null; zero stays zero', () => {
  const root = repo();
  seed(root, 'x', [
    rec(T0 + 5000, { ev: 'start' }),
    rec(T0 + 9000, { ev: 'ask', gate: 'brief' }),
    rec(T0 + 8000, { ev: 'gate', gate: 'brief', result: 'passed' }),
    rec(T0 + 9500, { ev: 'ask', gate: 'plan' }),
    rec(T0 + 9500, { ev: 'gate', gate: 'plan', result: 'passed' }),
  ]);
  assert.deepEqual(show(root, 'x', { now: T0 + 20000 }).gates.map(g => g.wait), [null, 0]);
});

test('wait: an ask after the gate in file order is not paired with it', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  run(['gate', 'x', 'brief', 'passed'], { root, now: T0 + 1000 });
  run(['ask', 'x', 'brief'], { root, now: T0 + 2000 });
  assert.deepEqual(show(root, 'x', { now: T0 + 3000 }).gates.map(g => g.wait), [null]);
});

test('ask: counts as activity for active', () => {
  const root = repo();
  run(['start', 'x'], { root, now: T0 });
  run(['ask', 'x', 'brief'], { root, now: T0 + 11 * 3600 * 1000 });
  assert.equal(active(root, { now: T0 + 13 * 3600 * 1000 }).slug, 'x');
});

test('cli: ask through the spawned script', () => {
  const root = repo();
  const go = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(go('ask', 'x', 'brief').stdout, 'refused: no open run for x\n');
  go('start', 'x');
  const r = go('ask', 'x', 'plan');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'ok: ask plan\n');
  assert.equal(go('ask', 'x', 'nope').status, 2);
});
