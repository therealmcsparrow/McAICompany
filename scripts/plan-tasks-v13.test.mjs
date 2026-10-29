import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, readParallel } from './plan-tasks.mjs';

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const FIXTURES = path.join(import.meta.dirname, '..', 'tests', 'fixtures', 'plan-tasks-v13');
const HANDOVER = 120000;

const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function env(planText, { policy } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-tasks-v13-'));
  roots.push(base);
  const home = path.join(base, 'home');
  const product = path.join(base, 'product');
  const pluginRoot = path.join(base, 'plugin');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  for (const a of ['backend-engineer', 'frontend-engineer', 'qa']) fs.writeFileSync(path.join(pluginRoot, 'agents', `${a}.md`), 'agent\n');
  if (policy) fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ aico_settings: { version: 1, plan_check: { policy } } }));
  const dir = path.join(product, '.company', 'work', 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '02-plan.md'), planText);
  const run = (...args) => main(args, { now: NOW, root: product, pluginRoot, home });
  const record = path.join(dir, 'parallel.jsonl');
  const events = () => fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { run, record, events, dir, product };
}

const ARROW = '→';
const DASH = '—';

function task(id, o = {}) {
  const files = o.files ?? `${id.toLowerCase()}/file.js`;
  const first = files.split(',')[0].trim();
  const lines = [`### ${id} title of ${id}`, '- role: backend-engineer', `- files: ${files}`, `- depends-on: ${o.deps ?? 'none'}`, '- parallel: yes'];
  if (o.context !== null) lines.push(`- context: ${o.context ?? '20k'}`);
  if (o.slice !== null) lines.push(`- slice: ${o.slice ?? `a user submits the form ${ARROW} the page shows the saved row ${DASH} demo: ${first}`}`);
  if (o.seams !== null) lines.push(`- seams: ${o.seams ?? `${first}#run`}`);
  for (const extra of o.extra ?? []) lines.push(extra);
  return `${lines.join('\n')}\n`;
}

const plan = (...tasks) => `${['# Plan', '', '## Tasks', '', ...tasks].join('\n')}\n`;
const check = (e, handover = HANDOVER, mode = 'parallel') => e.run('check', 'demo', '02-plan.md', '--cap', '3', '--mode', mode, '--handover', String(handover));
const errorsOf = (r) => r.lines.filter((l) => l.startsWith('ERROR '));

describe('v1.2 output without --handover', () => {
  const fixturePlan = fs.readFileSync(path.join(FIXTURES, 'v12-plan.md'), 'utf8');
  const golden = fs.readFileSync(path.join(FIXTURES, 'v12-golden.txt'), 'utf8');

  function transcript(e) {
    const out = [];
    const step = (...a) => {
      const r = e.run(...a);
      out.push(`$ ${a.join(' ')}`, `exit ${r.code}`, ...r.lines);
    };
    step('check', 'demo', '02-plan.md', '--cap', '3', '--mode', 'parallel');
    step('begin', 'demo', '02-plan.md', '--cap', '3', '--mode', 'parallel');
    step('next', 'demo');
    step('start', 'demo', 'T1');
    step('start', 'demo', 'T2');
    step('next', 'demo', '--json');
    step('done', 'demo', 'T1');
    step('read', 'demo');
    return `${out.join('\n')}\n`;
  }

  test('a v1.2 plan prints and records byte for byte as v1.2', () => {
    assert.equal(transcript(env(fixturePlan)), golden);
  });

  test('context, slice and seams lines, repeated or malformed, change nothing without --handover', () => {
    const noisy = fixturePlan
      .replace('- parallel: yes\n\n### T2', '- parallel: yes\n- context: 0k\n- context: 999999\n- slice: x\n- slice: y\n- seams: none\n- seams: none\n\n### T2');
    assert.notEqual(noisy, fixturePlan);
    const a = transcript(env(fixturePlan));
    const b = transcript(env(noisy));
    const strip = (t) => t.replace(/"hash":"[0-9a-f]{12}",/, '');
    assert.equal(strip(b), strip(a));
  });
});

describe('--handover flag', () => {
  for (const bad of ['9999', '1000001', '12e4', '010000', '', '-1', '1e5', '100000.5', 'abc']) {
    test(`refuses ${JSON.stringify(bad)}`, () => {
      const e = env(plan(task('T1')));
      const r = e.run('check', 'demo', '02-plan.md', '--cap', '3', '--mode', 'parallel', '--handover', bad);
      assert.equal(r.code, 3);
      assert.equal(r.lines.length, 1);
      assert.match(r.lines[0], /^refused: /);
    });
  }

  test('takes the bounds 10000 and 1000000', () => {
    const e = env(plan(task('T1', { context: '5k' })));
    assert.equal(check(e, 10000).code, 0);
    assert.equal(check(e, 1000000).code, 0);
  });

  test('a repeated flag is refused', () => {
    const e = env(plan(task('T1')));
    assert.equal(e.run('check', 'demo', '02-plan.md', '--cap', '3', '--mode', 'parallel', '--handover', '20000', '--handover', '30000').code, 3);
  });

  test('a clean plan prints the v1.2 lines, then the count line, exit 0', () => {
    const e = env(plan(task('T1'), task('T2')));
    const r = check(e);
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, [
      'plan-tasks: 2 tasks, 2 marked, 0 alone, cap 3 (parallel)', 'wave 1: T1, T2', 'plan-tasks: 0 errors (handover 120000)'
    ]);
  });
});

describe('context', () => {
  test('130k with handover 120000 is an ERROR and exit 2', () => {
    const r = check(env(plan(task('T1', { context: '130k' }))));
    assert.equal(r.code, 2);
    assert.deepEqual(errorsOf(r), ['ERROR T1: context: 130k above handover 120000']);
    assert.equal(r.lines.at(-1), 'plan-tasks: 1 errors (handover 120000)');
  });

  test('120k is at the handover and passes', () => {
    assert.equal(check(env(plan(task('T1', { context: '120k' })))).code, 0);
  });

  for (const bad of ['0k', '130000', '01k', '1001k', '-5k', '20K', '20 k', '20kk', '1e3k', '', '99999k', '٢٠k']) {
    test(`${JSON.stringify(bad)} is a bad value`, () => {
      const r = check(env(plan(task('T1', { context: bad }))));
      assert.equal(r.code, 2);
      assert.deepEqual(errorsOf(r), ['ERROR T1: context: bad value']);
    });
  }

  test('a missing context line is an ERROR', () => {
    assert.deepEqual(errorsOf(check(env(plan(task('T1', { context: null }))))), ['ERROR T1: context: missing']);
  });

  test('1000k passes under the largest handover', () => {
    assert.equal(check(env(plan(task('T1', { context: '1000k' }))), 1000000).code, 0);
  });
});

describe('slice', () => {
  const sliceOf = (text, files) => check(env(plan(task('T1', { slice: text, files }))));

  test('tasks "all data models" and "all API routes" both name a layer', () => {
    const e = env(fs.readFileSync(path.join(FIXTURES, 'layers-plan.md'), 'utf8'));
    const r = check(e);
    assert.equal(r.code, 2);
    assert.deepEqual(errorsOf(r), [
      'ERROR T1: slice: names a layer, not a behaviour',
      'ERROR T2: slice: names a layer, not a behaviour'
    ]);
  });

  test('a layer word beside a behaviour word is a behaviour', () => {
    const r = sliceOf(`a visitor posts a comment ${ARROW} the api route returns 201 ${DASH} demo: t1/file.js`);
    assert.equal(r.code, 0);
  });

  test('stop words alone leave no behaviour', () => {
    const r = sliceOf(`all of the ${ARROW} layers in the ${DASH} demo: t1/file.js`);
    assert.deepEqual(errorsOf(r), ['ERROR T1: slice: names a layer, not a behaviour']);
  });

  test('the ASCII arrow works', () => {
    assert.equal(sliceOf(`user clicks save -> the toast shows saved ${DASH} demo: t1/file.js`).code, 0);
  });

  test('a demo path outside files is an ERROR', () => {
    const r = sliceOf(`user clicks save ${ARROW} the toast shows saved ${DASH} demo: other/place.js`);
    assert.deepEqual(errorsOf(r), ['ERROR T1: slice: no demo in files']);
  });

  test('a demo path under a files directory passes, with a test name', () => {
    const r = sliceOf(`user clicks save ${ARROW} the toast shows saved ${DASH} demo: src/ui/save.test.js#shows the toast`, 'src/ui/');
    assert.equal(r.code, 0);
  });

  const shapes = [
    ['no demo marker', `user clicks save ${ARROW} the toast shows saved`],
    ['no arrow', `user clicks save then the toast shows saved ${DASH} demo: t1/file.js`],
    ['arrow without a right side', `user clicks save and waits ${ARROW}  ${DASH} demo: t1/file.js`],
    ['behaviour too short', `a ${ARROW} b ${DASH} demo: t1/file.js`],
    ['behaviour too long', `${'user clicks save '.repeat(14)}${ARROW} it works ${DASH} demo: t1/file.js`],
    ['demo path with a glob', `user clicks save ${ARROW} the toast shows saved ${DASH} demo: t1/*.js`],
    ['demo path with dot segments', `user clicks save ${ARROW} the toast shows saved ${DASH} demo: ../t1/file.js`],
    ['empty test name', `user clicks save ${ARROW} the toast shows saved ${DASH} demo: t1/file.js#`],
    ['test name with a semicolon', `user clicks save ${ARROW} the toast shows saved ${DASH} demo: t1/file.js#a;b`],
    ['test name with a second hash', `user clicks save ${ARROW} the toast shows saved ${DASH} demo: t1/file.js#a#b`],
    ['test name over 120 characters', `user clicks save ${ARROW} the toast shows saved ${DASH} demo: t1/file.js#${'n'.repeat(121)}`],
    ['control character', `user clicks save ${ARROW} the toast\u001b[31m shows saved ${DASH} demo: t1/file.js`],
    ['empty', '']
  ];
  for (const [name, text] of shapes) {
    test(`bad shape: ${name}`, () => {
      assert.deepEqual(errorsOf(sliceOf(text)), ['ERROR T1: slice: bad shape']);
    });
  }

  test('a test name of 120 characters passes', () => {
    assert.equal(sliceOf(`user clicks save ${ARROW} the toast shows saved ${DASH} demo: t1/file.js#${'n'.repeat(120)}`).code, 0);
  });

  test('a missing slice line is an ERROR', () => {
    assert.deepEqual(errorsOf(check(env(plan(task('T1', { slice: null }))))), ['ERROR T1: slice: missing']);
  });

  const reason = 'the module split touches every caller, so it moves in expand then contract steps';

  test('wide-refactor with a reason is a warning only, cut to 60 characters', () => {
    const r = sliceOf(`wide-refactor ${DASH} ${reason}`);
    assert.equal(r.code, 0);
    assert.deepEqual(errorsOf(r), []);
    assert.deepEqual(r.lines.filter((l) => l.startsWith('warning ')), [`warning T1: wide-refactor: ${reason.slice(0, 60)}`]);
    assert.equal(r.lines.at(-1), 'plan-tasks: 0 errors (handover 120000)');
  });

  test('warnings come after the ERROR lines and before the count line', () => {
    const e = env(plan(task('T1', { slice: `wide-refactor ${DASH} ${reason}` }), task('T2', { context: '0k' })));
    const r = check(e);
    const at = (prefix) => r.lines.findIndex((l) => l.startsWith(prefix));
    assert.ok(at('ERROR T2') < at('warning T1: wide'));
    assert.equal(at('plan-tasks: 1 errors'), r.lines.length - 1);
  });

  for (const [name, text] of [
    ['short reason', `wide-refactor ${DASH} too short`],
    ['long reason', `wide-refactor ${DASH} ${'x'.repeat(301)}`],
    ['no reason', 'wide-refactor'],
    ['control character in the reason', `wide-refactor ${DASH} ${reason}‮`]
  ]) {
    test(`wide-refactor: ${name} is a bad shape`, () => {
      assert.deepEqual(errorsOf(sliceOf(text)), ['ERROR T1: slice: bad shape']);
    });
  }
});

describe('seams', () => {
  const seamsOf = (text) => check(env(plan(task('T1', { seams: text }))));

  test('none with a reason passes', () => {
    assert.equal(seamsOf(`none ${DASH} docs only, no code`).code, 0);
  });

  test('a none reason under 10 characters is a bad value', () => {
    assert.deepEqual(errorsOf(seamsOf(`none ${DASH} docs only`)), ['ERROR T1: seams: bad value']);
  });

  test('none without a reason is a bad value', () => {
    assert.deepEqual(errorsOf(seamsOf('none')), ['ERROR T1: seams: bad value']);
  });

  test('refs with and without symbols pass; the path need not be in files', () => {
    assert.equal(seamsOf('other/place.mjs#parsePlan, `scripts/x.mjs`, a/b.js#Foo.bar-baz').code, 0);
  });

  test('a bad path names its item and reason', () => {
    assert.deepEqual(errorsOf(seamsOf('a/ok.js, /abs.js, b/*.js, ../c.js')), [
      'ERROR T1: seams item 2: absolute', 'ERROR T1: seams item 3: glob', 'ERROR T1: seams item 4: dot segment'
    ]);
  });

  test('a bad symbol is a bad character', () => {
    assert.deepEqual(errorsOf(seamsOf('a/ok.js#1abc, a/ok.js#a b')), [
      'ERROR T1: seams item 1: bad character', 'ERROR T1: seams item 2: bad character'
    ]);
  });

  test('ten refs pass, eleven do not', () => {
    const refs = (n) => Array.from({ length: n }, (_, i) => `s/f${i}.js`).join(', ');
    assert.equal(seamsOf(refs(10)).code, 0);
    assert.deepEqual(errorsOf(seamsOf(refs(11))), ['ERROR T1: seams: more than 10']);
  });

  test('a missing seams line is an ERROR', () => {
    assert.deepEqual(errorsOf(check(env(plan(task('T1', { seams: null }))))), ['ERROR T1: seams: missing']);
  });

  test('an empty ref is a bad character', () => {
    assert.deepEqual(errorsOf(seamsOf('a/ok.js,')), ['ERROR T1: seams item 2: bad character']);
  });
});

describe('repeated fields and hostile input', () => {
  test('a repeated context, slice or seams line is an ERROR', () => {
    const e = env(plan(task('T1', { extra: ['- context: 10k', '- slice: again', '- seams: none'] })));
    assert.deepEqual(errorsOf(check(e)), [
      'ERROR T1: context: bad value', 'ERROR T1: slice: bad shape', 'ERROR T1: seams: bad value'
    ]);
  });

  test('a repeated handover field does not make the task run alone', () => {
    const e = env(plan(task('T1', { extra: ['- context: 10k'] }), task('T2')));
    assert.match(check(e).lines[0], /2 marked, 0 alone/);
  });

  test('a field line of 4000 characters is read and stays linear', () => {
    const long = `${'a/b.js,'.repeat(570)}x`.slice(0, 3980);
    const e = env(plan(task('T1', { seams: long })));
    const start = process.hrtime.bigint();
    const r = check(e);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.deepEqual(errorsOf(r), ['ERROR T1: seams: more than 10']);
    assert.ok(ms < 2000, `took ${ms} ms`);
  });

  test('a 4000-character slice line is checked in linear time', () => {
    const word = 'data ';
    const slice = `${word.repeat(795)}${ARROW} x ${DASH} demo: t1/file.js`.slice(0, 3990);
    const e = env(plan(task('T1', { slice })));
    const start = process.hrtime.bigint();
    const r = check(e);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.deepEqual(errorsOf(r), ['ERROR T1: slice: bad shape']);
    assert.ok(ms < 2000, `took ${ms} ms`);
  });

  test('a line over 4000 characters is never read as a field', () => {
    const e = env(plan(task('T1', { seams: `${'a'.repeat(4001)}` })));
    assert.deepEqual(errorsOf(check(e)), ['ERROR T1: seams: missing']);
  });

  test('output holds only fixed words, ids and numbers whatever the plan says', () => {
    const hostile = task('T1', {
      context: '\u001b[2J99k', slice: `\u0007${ARROW}​`, seams: `\u001b]0;x\u0007, ../../etc/passwd, a b`
    });
    const r = check(env(plan(hostile)));
    for (const line of r.lines) assert.match(line, /^(ERROR T1: [a-z0-9: -]+|plan-tasks: [^\u0000-\u001f​]+|wave 1: T1)$/);
    assert.ok(!r.lines.join('\n').includes('\u001b'));
  });

  test('check never writes a record', () => {
    const e = env(plan(task('T1', { context: '0k' })));
    check(e);
    assert.equal(fs.existsSync(e.record), false);
  });

  test('a plan with no task prints the single v1.2 line and the count line', () => {
    const r = check(env('# Plan\n\nnothing here\n'));
    assert.deepEqual(r.lines, ['plan-tasks: 0 tasks; plan Steps run one at a time', 'plan-tasks: 0 errors (handover 120000)']);
    assert.equal(r.code, 0);
  });

  test('every problem of every task is listed, in plan order', () => {
    const e = env(plan(task('T1', { context: '0k', slice: null }), task('T2', { seams: null })));
    assert.deepEqual(errorsOf(check(e)), [
      'ERROR T1: context: bad value', 'ERROR T1: slice: missing', 'ERROR T2: seams: missing'
    ]);
  });
});

describe('begin --handover', () => {
  const begin = (e, ...more) => e.run('begin', 'demo', '02-plan.md', '--cap', '3', '--mode', 'parallel', ...more);

  test('an ERROR refuses begin, exit 3, and writes no record line', () => {
    const e = env(plan(task('T1'), task('T2', { context: '130k' }), task('T3', { slice: null })));
    const r = begin(e, '--handover', String(HANDOVER));
    assert.equal(r.code, 3);
    assert.deepEqual(r.lines, ['refused: 2 task errors']);
    assert.equal(fs.existsSync(e.record), false);
  });

  test('a clean plan begins as in v1.2', () => {
    const e = env(plan(task('T1'), task('T2')));
    const r = begin(e, '--handover', String(HANDOVER));
    assert.deepEqual(r, { code: 0, lines: ['plan-tasks: 2 tasks, 2 marked, 0 alone, cap 3 (parallel)', 'begun'] });
    assert.equal(e.events().length, 1);
  });

  test('without --handover a plan with ERRORs still begins', () => {
    const e = env(plan(task('T1', { context: '130k' })));
    assert.equal(begin(e).code, 0);
  });

  test('a bad handover value is refused before anything is written', () => {
    const e = env(plan(task('T1')));
    assert.equal(begin(e, '--handover', '5').code, 3);
    assert.equal(fs.existsSync(e.record), false);
  });

  test('the plan Gate under block still refuses first', () => {
    const e = env(`# Plan\n\n## Steps\nTBD which store\n\n${plan(task('T1')).replace('# Plan\n\n', '')}`, { policy: 'block' });
    const r = begin(e, '--handover', String(HANDOVER));
    assert.deepEqual(r, { code: 3, lines: ['refused: plan gate: 1 open decisions in 02-plan.md'] });
    assert.equal(fs.existsSync(e.record), false);
    assert.equal(e.run('next', 'demo').code, 3);
  });
});

describe('waves', () => {
  const wavesPlan = () => plan(task('T1'), task('T2'), task('T3', { deps: 'T1' }));
  const beginWaves = (e) => e.run('begin', 'demo', '02-plan.md', '--cap', '3', '--mode', 'waves');

  test('check accepts the mode and prints the same waves as parallel', () => {
    const e = env(wavesPlan());
    const a = e.run('check', 'demo', '02-plan.md', '--cap', '3', '--mode', 'waves');
    const b = e.run('check', 'demo', '02-plan.md', '--cap', '3', '--mode', 'parallel');
    assert.equal(a.code, 0);
    assert.deepEqual(a.lines.slice(1), b.lines.slice(1));
    assert.equal(a.lines[0], 'plan-tasks: 3 tasks, 3 marked, 0 alone, cap 3 (waves)');
  });

  test('two tasks start together, the third waits for the merge', () => {
    const e = env(wavesPlan());
    assert.equal(beginWaves(e).code, 0);
    assert.equal(e.events()[0].mode, 'waves');
    assert.deepEqual(e.run('next', 'demo').lines.slice(1, 4), ['start T1 backend-engineer', 'start T2 backend-engineer', 'wait T3 depends T1']);
    assert.equal(e.run('start', 'demo', 'T1').code, 0);
    assert.equal(e.run('start', 'demo', 'T2').code, 0);
    assert.deepEqual(e.run('next', 'demo').lines.slice(1, 4), ['running T1', 'running T2', 'wait T3 wave T1']);
    e.run('done', 'demo', 'T1');
    e.run('done', 'demo', 'T2');
    assert.deepEqual(e.run('next', 'demo').lines.slice(1), ['wait T3 wave T1', 'done 2 of 3']);
    assert.equal(e.run('start', 'demo', 'T3').code, 3);
    assert.deepEqual(e.run('merged', 'demo', 'T1,T2'), { code: 0, lines: ['merged 2 tasks'] });
    assert.deepEqual(e.run('next', 'demo').lines.slice(1, 2), ['start T3 backend-engineer']);
    assert.equal(e.run('start', 'demo', 'T3').code, 0);
  });

  test('the merged event holds the round and the ids', () => {
    const e = env(wavesPlan());
    beginWaves(e);
    for (const id of ['T1', 'T2']) e.run('start', 'demo', id);
    for (const id of ['T1', 'T2']) e.run('done', 'demo', id);
    e.run('merged', 'demo', 'T2,T1');
    const last = e.events().at(-1);
    assert.deepEqual(Object.keys(last), ['v', 'at', 'ev', 'round', 'tasks']);
    assert.deepEqual({ ev: last.ev, round: last.round, tasks: last.tasks }, { ev: 'merged', round: 0, tasks: ['T1', 'T2'] });
  });

  test('merged with a task still running is refused and writes nothing', () => {
    const e = env(wavesPlan());
    beginWaves(e);
    e.run('start', 'demo', 'T1');
    e.run('start', 'demo', 'T2');
    e.run('done', 'demo', 'T1');
    const before = fs.readFileSync(e.record, 'utf8');
    assert.deepEqual(e.run('merged', 'demo', 'T1,T2'), { code: 3, lines: ['refused: a task is running'] });
    assert.equal(fs.readFileSync(e.record, 'utf8'), before);
  });

  test('merged refuses ids that differ from the open wave', () => {
    const e = env(wavesPlan());
    beginWaves(e);
    for (const id of ['T1', 'T2']) e.run('start', 'demo', id);
    for (const id of ['T1', 'T2']) e.run('done', 'demo', id);
    for (const ids of ['T1', 'T1,T2,T3', 'T1,T3', 'T1,T1', 'T1,T2,T2']) {
      assert.deepEqual(e.run('merged', 'demo', ids), { code: 3, lines: ['refused: ids do not equal the open wave'] }, ids);
    }
    assert.equal(e.run('merged', 'demo', 'T1,bad').code, 3);
    assert.equal(e.events().at(-1).ev, 'done');
  });

  test('merged with no open wave, or twice, is refused', () => {
    const e = env(wavesPlan());
    beginWaves(e);
    assert.deepEqual(e.run('merged', 'demo', 'T1'), { code: 3, lines: ['refused: no open wave'] });
    for (const id of ['T1', 'T2']) e.run('start', 'demo', id);
    for (const id of ['T1', 'T2']) e.run('done', 'demo', id);
    assert.equal(e.run('merged', 'demo', 'T1,T2').code, 0);
    assert.deepEqual(e.run('merged', 'demo', 'T1,T2'), { code: 3, lines: ['refused: no open wave'] });
  });

  test('merged is refused outside waves mode', () => {
    const e = env(wavesPlan());
    e.run('begin', 'demo', '02-plan.md', '--cap', '3', '--mode', 'parallel');
    e.run('start', 'demo', 'T1');
    e.run('done', 'demo', 'T1');
    assert.deepEqual(e.run('merged', 'demo', 'T1'), { code: 3, lines: ['refused: not a waves run'] });
  });

  test('merged with a bad argument count or more than 100 ids is refused', () => {
    const e = env(wavesPlan());
    beginWaves(e);
    assert.equal(e.run('merged', 'demo').code, 3);
    assert.equal(e.run('merged', 'demo', 'T1', 'T2').code, 3);
    assert.deepEqual(e.run('merged', 'demo', Array.from({ length: 101 }, (_, i) => `T${i}`).join(',')), { code: 3, lines: ['refused: more than 100 tasks'] });
  });

  test('round is refused while the open wave is not merged, then allowed', () => {
    const e = env(wavesPlan());
    beginWaves(e);
    for (const id of ['T1', 'T2']) e.run('start', 'demo', id);
    for (const id of ['T1', 'T2']) e.run('done', 'demo', id);
    assert.deepEqual(e.run('round', 'demo', '1', '--', 't1/file.js'), { code: 3, lines: ['refused: the open wave is not merged'] });
    e.run('merged', 'demo', 'T1,T2');
    assert.equal(e.run('round', 'demo', '1', '--', 't1/file.js').code, 0);
  });

  test('a round record written by hand while a wave is open is a bad line', () => {
    const e = env(wavesPlan());
    beginWaves(e);
    e.run('start', 'demo', 'T1');
    e.run('done', 'demo', 'T1');
    const line = JSON.stringify({ v: 1, at: '2026-10-28T12:00:00Z', ev: 'round', round: 1, sets: { T1: [] }, loose: 0, ow: [] });
    fs.appendFileSync(e.record, `${line}\n`);
    assert.throws(() => readParallel(e.product, 'demo'), /round while a wave is open/);
  });

  test('a hand-written merged line that skips a wave task is a bad line', () => {
    const e = env(wavesPlan());
    beginWaves(e);
    e.run('start', 'demo', 'T1');
    e.run('start', 'demo', 'T2');
    e.run('done', 'demo', 'T1');
    e.run('done', 'demo', 'T2');
    const line = JSON.stringify({ v: 1, at: '2026-10-28T12:00:00Z', ev: 'merged', round: 0, tasks: ['T1'] });
    fs.appendFileSync(e.record, `${line}\n`);
    assert.throws(() => readParallel(e.product, 'demo'), /tasks do not equal the open wave/);
  });

  test('a merged line outside waves mode is a bad line', () => {
    const e = env(wavesPlan());
    e.run('begin', 'demo', '02-plan.md', '--cap', '3', '--mode', 'parallel');
    const line = JSON.stringify({ v: 1, at: '2026-10-28T12:00:00Z', ev: 'merged', round: 0, tasks: ['T1'] });
    fs.appendFileSync(e.record, `${line}\n`);
    assert.throws(() => readParallel(e.product, 'demo'), /merged outside waves mode/);
  });

  test('the view holds merged and open_wave in start order, only in waves mode', () => {
    const e = env(wavesPlan());
    beginWaves(e);
    assert.deepEqual(readParallel(e.product, 'demo').open_wave, []);
    e.run('start', 'demo', 'T2');
    e.run('start', 'demo', 'T1');
    const open = readParallel(e.product, 'demo');
    assert.deepEqual(open.open_wave, ['T2', 'T1']);
    assert.deepEqual(open.merged, {});
    assert.equal(open.effective_cap, 3);
    e.run('done', 'demo', 'T2');
    e.run('done', 'demo', 'T1');
    e.run('merged', 'demo', 'T1,T2');
    const closed = readParallel(e.product, 'demo');
    assert.deepEqual(closed.open_wave, []);
    assert.deepEqual(closed.merged, { 0: ['T2', 'T1'] });
    assert.equal(JSON.parse(e.run('read', 'demo').lines[0]).open_wave.length, 0);

    const p = env(wavesPlan());
    p.run('begin', 'demo', '02-plan.md', '--cap', '3', '--mode', 'parallel');
    assert.equal(Object.hasOwn(readParallel(p.product, 'demo'), 'open_wave'), false);
  });

  test('a task outside the first start set cannot join the open wave', () => {
    const e = env(plan(task('T1'), task('T2', { files: 't1/file.js' }), task('T3')));
    beginWaves(e);
    assert.deepEqual(e.run('next', 'demo').lines.slice(1, 4), ['start T1 backend-engineer', 'wait T2 overlap T1', 'start T3 backend-engineer']);
    e.run('start', 'demo', 'T1');
    assert.deepEqual(e.run('next', 'demo').lines.slice(1, 4), ['running T1', 'wait T2 wave T1', 'start T3 backend-engineer']);
    assert.equal(e.run('start', 'demo', 'T2').code, 3);
  });

  test('--json reports the wave reason', () => {
    const e = env(wavesPlan());
    beginWaves(e);
    e.run('start', 'demo', 'T1');
    const body = JSON.parse(e.run('next', 'demo', '--json').lines[0]);
    assert.deepEqual(body.wait, [{ task: 'T3', reason: 'wave', on: 'T1' }]);
    assert.deepEqual(body.start.map((s) => s.task), ['T2']);
  });

  test('--handover works with waves', () => {
    const e = env(plan(task('T1', { context: '0k' })));
    const r = e.run('begin', 'demo', '02-plan.md', '--cap', '3', '--mode', 'waves', '--handover', '120000');
    assert.deepEqual(r, { code: 3, lines: ['refused: 1 task errors'] });
  });
});

describe('record first write', () => {
  test('begin twice appends two lines to one record', () => {
    const e = env(plan(task('T1')));
    assert.equal(e.run('begin', 'demo', '02-plan.md', '--cap', '3', '--mode', 'parallel').code, 0);
    assert.equal(e.events().length, 1);
    assert.equal(e.run('begin', 'demo', '02-plan.md', '--cap', '3', '--mode', 'parallel').code, 0);
    assert.equal(e.events().length, 2);
  });
});
