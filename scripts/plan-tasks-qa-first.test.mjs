import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, readParallel } from './plan-tasks.mjs';

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const HANDOVER = 120000;
const ARROW = '→';
const DASH = '—';

const roots = [];
const savedHome = process.env.MCSPARROW_HOME;
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  if (savedHome === undefined) delete process.env.MCSPARROW_HOME;
  else process.env.MCSPARROW_HOME = savedHome;
});

function env(planText) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-tasks-qa-first-'));
  roots.push(base);
  const home = path.join(base, 'home');
  const product = path.join(base, 'product');
  const pluginRoot = path.join(base, 'plugin');
  fs.mkdirSync(home, { recursive: true });
  process.env.MCSPARROW_HOME = home;
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  for (const a of ['backend-engineer', 'qa']) fs.writeFileSync(path.join(pluginRoot, 'agents', `${a}.md`), 'agent\n');
  const dir = path.join(product, '.company', 'work', 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '02-plan.md'), planText);
  const run = (...args) => main(args, { now: NOW, root: product, pluginRoot, home });
  const record = path.join(dir, 'parallel.jsonl');
  const events = () => fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { run, record, events, product };
}

// A task block; every field can be overridden or dropped with null.
function task(id, o = {}) {
  const files = o.files === undefined ? `${id.toLowerCase()}/file.js` : o.files;
  const first = String(files).split(',')[0].trim();
  const lines = [`### ${id} title of ${id}`, `- role: ${o.role ?? 'backend-engineer'}`];
  if (files !== null) lines.push(`- files: ${files}`);
  lines.push(`- depends-on: ${o.deps ?? 'none'}`, '- parallel: yes');
  if (o.context !== null) lines.push(`- context: ${o.context ?? '20k'}`);
  lines.push(`- slice: a user submits the form ${ARROW} the page shows the saved row ${DASH} demo: ${first}`);
  if (o.seams !== null) lines.push(`- seams: ${o.seams ?? `${first}#run`}`);
  for (const extra of o.extra ?? []) lines.push(extra);
  return `${lines.join('\n')}\n`;
}

const qa = (id, files = 'tests/a.test.mjs', o = {}) => task(id, { role: 'qa', seams: 'none — tests only, no code', ...o, files });
const plan = (...tasks) => `${['# Plan', '', '## Tasks', '', ...tasks].join('\n')}\n`;
const ARGS = ['demo', '02-plan.md', '--cap', '3', '--mode', 'parallel'];
const check = (e, ...more) => e.run('check', ...ARGS, '--qa-first', ...more);
const begin = (e, ...more) => e.run('begin', ...ARGS, '--qa-first', ...more);
const errorsOf = (r) => r.lines.filter((l) => l.startsWith('ERROR '));

const covered = plan(qa('T1'), task('T2', { deps: 'T1', files: 'src/a.mjs' }));

describe('hostile plans', () => {
  test('a missing seams line counts as code and needs a qa task', () => {
    const e = env(plan(task('T1', { seams: null })));
    const r = check(e);
    assert.equal(r.code, 2);
    assert.deepEqual(errorsOf(r), ['ERROR T1: qa-first: no qa task']);
  });

  test('a repeated seams line counts as code and needs a qa task', () => {
    const e = env(plan(task('T1', { seams: 'none — docs only change here', extra: ['- seams: none — docs only change here'] })));
    const r = check(e);
    assert.equal(r.code, 2);
    assert.deepEqual(errorsOf(r), ['ERROR T1: qa-first: no qa task']);
  });

  test('a bad seams value counts as code and needs a qa task', () => {
    const e = env(plan(task('T1', { seams: 'none — short' })));
    assert.deepEqual(errorsOf(check(e)), ['ERROR T1: qa-first: no qa task']);
  });

  test('a dependency on an unknown or malformed id does not cover a build task', () => {
    const e = env(plan(qa('T1'), task('T2', { deps: 'T9', files: 'src/a.mjs' }), task('T3', { deps: 'T1x9;rm', files: 'src/b.mjs' })));
    const r = check(e);
    assert.deepEqual(errorsOf(r), ['ERROR T2: qa-first: no qa task', 'ERROR T3: qa-first: no qa task']);
    assert.ok(!r.lines.join('\n').includes('rm'), 'the hostile token is never echoed');
  });

  test('a dependency on a cycle with the qa task does not cover a build task', () => {
    const e = env(plan(qa('T1', 'tests/a.test.mjs', { deps: 'T2' }), task('T2', { deps: 'T1', files: 'src/a.mjs' })));
    assert.deepEqual(errorsOf(check(e)), ['ERROR T2: qa-first: no qa task']);
  });

  test('a dependency on another build task does not cover', () => {
    const e = env(plan(qa('T1'), task('T2', { deps: 'T1', files: 'src/a.mjs' }), task('T3', { deps: 'T2', files: 'src/b.mjs' })));
    assert.deepEqual(errorsOf(check(e)), ['ERROR T3: qa-first: no qa task']);
  });

  for (const [name, files] of [
    ['a parent path', '../outside/x.test.mjs'],
    ['an absolute path', '/etc/passwd'],
    ['a drive path', 'C:/Windows/x.test.mjs'],
    ['a glob', 'tests/*.test.mjs'],
    ['a dot segment', 'tests/./x.test.mjs'],
    ['an env file', 'tests/.env'],
    ['an empty list', ''],
    ['a missing list', null],
    ['forty-one items', Array.from({ length: 41 }, (_, i) => `tests/f${i}.test.mjs`).join(', ')]
  ]) {
    test(`qa files invalid for ${name}`, () => {
      const e = env(plan(qa('T1', files), task('T2', { deps: 'T1', files: 'src/a.mjs' })));
      const r = check(e);
      assert.equal(r.code, 2);
      assert.ok(errorsOf(r).includes('ERROR T1: qa-first: qa files invalid'), errorsOf(r).join('\n'));
      assert.ok(!errorsOf(r).some((l) => l.includes('files overlap')));
      assert.ok(!r.lines.join('\n').includes('outside'), 'the bad path is never echoed');
      assert.ok(!r.lines.join('\n').includes('passwd'), 'the bad path is never echoed');
    });
  }

  test('a covered build task with no files is refused with the exact missing-files line', () => {
    const e = env(plan(qa('T1'), task('T2', { deps: 'T1', files: null })));
    const r = check(e);
    assert.equal(r.code, 2);
    assert.deepEqual(errorsOf(r), ['ERROR T2: qa-first: files missing or invalid (overlaps every task, incl. qa task T1)']);
  });

  test('a qa task with invalid files is left out of the overlap rule', () => {
    const e = env(plan(qa('T1', 'tests/a.test.mjs, ../x'), task('T2', { deps: 'T1', files: 'tests/a.test.mjs' })));
    const lines = errorsOf(check(e));
    assert.deepEqual(lines, ['ERROR T1: qa-first: qa files invalid']);
  });
});

describe('check --qa-first', () => {
  test('a covered plan prints no error and exits 0', () => {
    const e = env(covered);
    const r = check(e);
    assert.equal(r.code, 0);
    assert.deepEqual(errorsOf(r), []);
    assert.equal(r.lines.at(-1), 'plan-tasks: 0 qa-first errors');
  });

  test('a build task with no qa task is an error and exit 2', () => {
    const e = env(plan(task('T1', { files: 'src/a.mjs' })));
    const r = check(e);
    assert.equal(r.code, 2);
    assert.deepEqual(errorsOf(r), ['ERROR T1: qa-first: no qa task']);
    assert.equal(r.lines.at(-1), 'plan-tasks: 1 qa-first errors');
  });

  test('a seams none task is exempt', () => {
    const e = env(plan(task('T1', { files: 'docs/a.md', seams: 'none — prose only, no code' })));
    const r = check(e);
    assert.equal(r.code, 0);
    assert.deepEqual(errorsOf(r), []);
    assert.equal(r.lines.at(-1), 'plan-tasks: 0 qa-first errors');
  });

  test('the qa task itself needs no qa task', () => {
    const e = env(plan(qa('T1')));
    assert.equal(check(e).code, 0);
  });

  test('a build task that overlaps the qa files names the first qa task in plan order', () => {
    const e = env(plan(qa('T1'), qa('T2', 'tests/b.test.mjs'), task('T3', { deps: 'T1, T2', files: 'tests/b.test.mjs, tests/a.test.mjs' })));
    const r = check(e);
    assert.equal(r.code, 2);
    assert.deepEqual(errorsOf(r), ['ERROR T3: qa-first: files overlap qa task T1']);
  });

  test('a directory qa file overlaps a path inside it', () => {
    const e = env(plan(qa('T1', 'tests/'), task('T2', { deps: 'T1', files: 'TESTS/sub/x.mjs' })));
    assert.deepEqual(errorsOf(check(e)), ['ERROR T2: qa-first: files overlap qa task T1']);
  });

  test('a seams none task that overlaps the qa files is an error', () => {
    const e = env(plan(qa('T1'), task('T2', { files: 'tests/a.test.mjs', seams: 'none — fixture text only' })));
    assert.deepEqual(errorsOf(check(e)), ['ERROR T2: qa-first: files overlap qa task T1']);
  });

  test('two qa tasks with overlapping files name the earlier one on the later one', () => {
    const e = env(plan(qa('T1'), qa('T2', 'tests/a.test.mjs, tests/other.test.mjs')));
    const r = check(e);
    assert.equal(r.code, 2);
    assert.deepEqual(errorsOf(r), ['ERROR T2: qa-first: files overlap qa task T1']);
    assert.equal(r.lines.at(-1), 'plan-tasks: 1 qa-first errors');
  });

  test('every reason of one task prints in rule order, tasks in plan order', () => {
    const e = env(plan(qa('T1'), task('T2', { files: 'src/a.mjs' }), task('T3', { files: 'tests/a.test.mjs' })));
    const r = check(e);
    assert.deepEqual(errorsOf(r), [
      'ERROR T2: qa-first: no qa task',
      'ERROR T3: qa-first: no qa task',
      'ERROR T3: qa-first: files overlap qa task T1'
    ]);
    assert.equal(r.lines.at(-1), 'plan-tasks: 3 qa-first errors');
  });

  test('the qa error lines follow the handover lines and both count toward exit 2', () => {
    const e = env(plan(qa('T1'), task('T2', { deps: 'T1', files: 'src/a.mjs', context: null }), task('T3', { files: 'src/b.mjs' })));
    const r = check(e, '--handover', String(HANDOVER));
    assert.equal(r.code, 2);
    const handoverEnd = r.lines.indexOf(`plan-tasks: 1 errors (handover ${HANDOVER})`);
    const first = r.lines.indexOf('ERROR T3: qa-first: no qa task');
    assert.ok(handoverEnd > 0, r.lines.join('\n'));
    assert.ok(r.lines.indexOf('ERROR T2: context: missing') < handoverEnd);
    assert.ok(first > handoverEnd);
    assert.equal(r.lines.at(-1), 'plan-tasks: 1 qa-first errors');
  });

  test('without the flag a plan with an uncovered task prints no qa line and exits 0, with it exit 2', () => {
    const text = plan(task('T1', { files: 'src/a.mjs' }));
    const plain = env(text).run('check', ...ARGS);
    assert.equal(plain.code, 0);
    assert.ok(!plain.lines.join('\n').includes('qa-first'));
    assert.equal(check(env(text)).code, 2);
  });

  test('the flag leaves the gate block lines unchanged', () => {
    const plain = env(covered).run('check', ...ARGS);
    const flagged = check(env(covered));
    assert.deepEqual(flagged.lines.slice(0, plain.lines.length), plain.lines);
    assert.equal(flagged.lines.length, plain.lines.length + 1);
  });
});

describe('begin --qa-first', () => {
  test('a covered plan begins and records qa true', () => {
    const e = env(covered);
    const r = begin(e);
    assert.equal(r.code, 0);
    assert.equal(r.lines.at(-1), 'begun');
    const [ev] = e.events();
    assert.equal(ev.ev, 'begin');
    assert.equal(ev.qa, true);
  });

  test('begin without the flag writes no qa key, with it a qa true key', () => {
    const e = env(covered);
    assert.equal(e.run('begin', ...ARGS).code, 0);
    assert.ok(!Object.hasOwn(e.events()[0], 'qa'));
    const f = env(covered);
    assert.equal(begin(f).code, 0);
    assert.deepEqual(Object.keys(f.events()[0]).filter((k) => !Object.hasOwn(e.events()[0], k)), ['qa']);
  });

  test('qa errors refuse the begin with exit 3 and write nothing', () => {
    const e = env(plan(task('T1', { files: 'src/a.mjs' }), task('T2', { files: 'src/b.mjs' })));
    const r = begin(e);
    assert.equal(r.code, 3);
    assert.deepEqual(r.lines, ['refused: 2 qa-first errors']);
    assert.ok(!fs.existsSync(e.record));
  });

  test('the handover refusal wins when both apply', () => {
    const e = env(plan(task('T1', { files: 'src/a.mjs', context: null })));
    const r = begin(e, '--handover', String(HANDOVER));
    assert.equal(r.code, 3);
    assert.deepEqual(r.lines, ['refused: 1 task errors']);
    assert.ok(!fs.existsSync(e.record));
  });

  test('a clean handover and qa check begins with qa true', () => {
    const e = env(covered);
    const r = begin(e, '--handover', String(HANDOVER));
    assert.equal(r.code, 0);
    assert.equal(e.events()[0].qa, true);
  });
});

describe('view', () => {
  test('a qa-first segment reads qa_first true', () => {
    const e = env(covered);
    begin(e);
    const view = readParallel(e.product, 'demo');
    assert.equal(view.state, 'on');
    assert.equal(view.qa_first, true);
  });

  test('a segment without the flag keeps the v1.6 key set, with it one more key', () => {
    const e = env(covered);
    e.run('begin', ...ARGS);
    const view = readParallel(e.product, 'demo');
    assert.equal(view.state, 'on');
    assert.ok(!Object.hasOwn(view, 'qa_first'));
    const f = env(covered);
    begin(f);
    const flagged = readParallel(f.product, 'demo');
    assert.deepEqual(Object.keys(flagged).filter((k) => !Object.hasOwn(view, k)), ['qa_first']);
  });

  test('a later begin without the flag ends the qa-first segment', () => {
    const e = env(covered);
    begin(e);
    assert.equal(readParallel(e.product, 'demo').qa_first, true);
    e.run('begin', ...ARGS);
    const view = readParallel(e.product, 'demo');
    assert.ok(!Object.hasOwn(view, 'qa_first'));
  });

  test('a later begin with the flag starts a qa-first segment again', () => {
    const e = env(covered);
    e.run('begin', ...ARGS);
    begin(e);
    assert.equal(readParallel(e.product, 'demo').qa_first, true);
  });

  test('read prints qa_first true for a qa-first segment', () => {
    const e = env(covered);
    begin(e);
    const r = e.run('read', 'demo');
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.lines.join('\n')).qa_first, true);
  });

  test('a qa value other than true on a begin line is a broken record', () => {
    const e = env(covered);
    begin(e);
    const lines = fs.readFileSync(e.record, 'utf8').replace('"qa":true', '"qa":"yes"');
    fs.writeFileSync(e.record, lines);
    const r = e.run('read', 'demo');
    assert.equal(r.code, 1);
    assert.match(r.lines[0], /^parallel record demo line 1: /);
  });
});
