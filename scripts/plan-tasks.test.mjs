import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePlan, schedule, normalizePath, overlaps, readParallel, ParallelRecordError, main } from './plan-tasks.mjs';

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const ROLES = ['backend-engineer', 'frontend-engineer', 'ai-data-engineer', 'qa', 'writer'];
const AGENTS = new Set(ROLES);

const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function fixture(planText, { slug = 'demo', name = '02-plan.md' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-tasks-'));
  roots.push(root);
  const pluginRoot = path.join(root, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  for (const a of ROLES) fs.writeFileSync(path.join(pluginRoot, 'agents', `${a}.md`), 'agent\n');
  const dir = path.join(root, 'product', '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  if (planText !== null) fs.writeFileSync(path.join(dir, name), planText);
  const product = path.join(root, 'product');
  const run = (...args) => main(args, { now: NOW, root: product, pluginRoot });
  const record = path.join(dir, 'parallel.jsonl');
  const events = () => fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { root: product, pluginRoot, dir, run, slug, name, record, events, plan: path.join(dir, name) };
}

function task(id, o = {}) {
  const lines = [`### ${id} title of ${id}`];
  if (o.role !== null) lines.push(`- role: ${o.role ?? 'backend-engineer'}`);
  if (o.files !== null) lines.push(`- files: ${o.files ?? `${id.toLowerCase()}/file.js`}`);
  if (o.deps !== null) lines.push(`- depends-on: ${o.deps ?? 'none'}`);
  if (o.parallel !== null) lines.push(`- parallel: ${o.parallel ?? 'yes'}`);
  return `${lines.join('\n')}\n`;
}

const plan = (...tasks) => `${['# Plan', '', '## Tasks', '', ...tasks].join('\n')}\n`;
const parse = (text) => parsePlan(text, { agents: AGENTS });
const six = () => plan(...['T1', 'T2', 'T3', 'T4', 'T5', 'T6'].map((id) => task(id)));
const begin = (fx, cap = 4, mode = 'parallel') => fx.run('begin', fx.slug, fx.name, '--cap', String(cap), '--mode', mode);

describe('path rule', () => {
  const bad = [
    ['/etc/passwd', 'absolute'], ['\\x', 'absolute'], ['C:/x', 'absolute'], ['c:\\x', 'absolute'], ['C:x', 'absolute'],
    ['*.js', 'glob'], ['a/b?.js', 'glob'], ['a[1]', 'glob'], ['a{b}', 'glob'], ['/*', 'absolute'],
    ['..', 'dot segment'], ['a/../b', 'dot segment'], ['./a', 'dot segment'], ['a/.', 'dot segment'],
    ['.git', 'git'], ['a/.GIT/config', 'git'], ['.Git/', 'git'],
    ['.git.', 'git'], ['.GIT./config', 'git'], ['a/.git../hooks/pre-commit', 'git'], ['.git./hooks/pre-commit', 'git'],
    ['scripts/x.mjs.', 'bad character'], ['a/b.', 'bad character'], ['scripts./x.mjs', 'bad character'],
    ['a/b.../c', 'bad character'], ['a/b./', 'bad character'], ['a/b /c', 'bad character'],
    ['.env', 'env'], ['a/.ENV.local', 'env'], ['.envrc', 'env'],
    ['con', 'device name'], ['CON', 'device name'], ['prn', 'device name'], ['aux', 'device name'], ['nul', 'device name'],
    ['com1', 'device name'], ['COM9', 'device name'], ['lpt1', 'device name'], ['Lpt9', 'device name'],
    ['con.txt', 'device name'], ['src/NUL.md', 'device name'], ['a/aux.tar.gz/b', 'device name'], ['com5.x', 'device name'],
    ['docs/con/', 'device name'], ['con.', 'device name'], ['a/prn.', 'device name'], ['con .txt', 'device name'],
    ['a'.repeat(201), 'too long'],
    ['a b', 'bad character'], ['a//b', 'bad character'], ['', 'bad character'], ['-x', 'bad character'], ['a/-b', 'bad character'],
    ['caf\u00e9', 'bad character'], ['a\nb', 'bad character'], ['ab:c', 'bad character'], ['a\u202eb', 'bad character']
  ];
  for (const [item, reason] of bad) {
    test(`refuses ${JSON.stringify(item).slice(0, 30)} as ${reason}`, () => {
      assert.deepEqual(normalizePath(item), { ok: false, reason });
    });
  }

  test('refuses a non-string', () => {
    assert.equal(normalizePath(undefined).ok, false);
    assert.equal(normalizePath({}).ok, false);
  });

  test('accepts allowed paths and reports key and directory flag', () => {
    assert.deepEqual(normalizePath('Scripts\\Plan-Tasks.mjs'), { ok: true, path: 'Scripts/Plan-Tasks.mjs', key: 'scripts/plan-tasks.mjs', dir: false });
    assert.deepEqual(normalizePath('docs/'), { ok: true, path: 'docs/', key: 'docs', dir: true });
    assert.equal(normalizePath('.github/workflows/ci.yml').ok, true);
    assert.equal(normalizePath('.gitignore').ok, true);
    assert.equal(normalizePath('a'.repeat(200)).ok, true);
    assert.equal(normalizePath('@scope/pkg+x_1.2').ok, true);
    assert.equal(normalizePath('a:b').reason, 'absolute');
  });

  test('names that only start like a device name stay allowed', () => {
    for (const p of ['console.js', 'src/connect.mjs', 'com0', 'com10.txt', 'lpt0', 'nulls/x', 'a/auxiliary.md', 'prn-x', 'x.con', 'docs/com.md']) {
      assert.equal(normalizePath(p).ok, true, p);
    }
  });

  test('a device name in a files: item alone-flags the task with a reason', () => {
    const t = parse(plan(task('T1', { files: 'src/NUL.txt' }))).tasks[0];
    assert.equal(t.alone, true);
    assert.deepEqual(t.reasons, ['files item 1: device name']);
  });

  test('a long hostile string is judged in linear time', () => {
    const started = Date.now();
    normalizePath(`${'a/'.repeat(5000)}!`);
    normalizePath('a'.repeat(100000));
    assert.ok(Date.now() - started < 500);
  });
});

describe('overlaps', () => {
  test('case-only, slash and directory differences', () => {
    assert.equal(overlaps('Scripts/A.mjs', 'scripts/a.MJS'), true);
    assert.equal(overlaps('a\\b', 'a/b'), true);
    assert.equal(overlaps('docs', 'docs/x.md'), true);
    assert.equal(overlaps('docs/', 'docs/x.md'), true);
    assert.equal(overlaps('docs/x.md', 'docs'), true);
    assert.equal(overlaps('docs/', 'docs'), true);
    assert.equal(overlaps('docs', 'docs2/x.md'), false);
    assert.equal(overlaps('a/b', 'a/bc'), false);
    assert.equal(overlaps('a/b', 'a/c'), false);
  });

  test('names the filesystem treats as one file overlap', () => {
    assert.equal(overlaps('scripts/x.mjs', 'scripts/x.mjs.'), true);
    assert.equal(overlaps('scripts/x.mjs', 'Scripts./X.MJS'), true);
    assert.equal(overlaps('docs', 'docs./x.md'), true);
    assert.equal(overlaps('a/b ', 'a/b'), true);
    assert.equal(overlaps('a/b', 'a/c.'), false);
  });

  test('a plan cannot start two spellings of one file together', () => {
    const body = (f) => ({ files: f });
    const t = parse(plan(task('T1', body('scripts/x.mjs')), task('T2', body('scripts/x.mjs.')), task('T3', body('Scripts./X.MJS')), task('T4', body('.git./hooks/pre-commit')))).tasks;
    assert.deepEqual(t.map((x) => x.filesValid), [true, false, false, false]);
    const s = schedule(t, [], [], 5).filter((e) => e.outcome === 'start').map((e) => e.id);
    assert.deepEqual(s, ['T1']);
  });
});

describe('parsePlan', () => {
  test('reads a marked task', () => {
    const { tasks, tooMany } = parse(plan(task('T1', { files: '`a/one.js`, B\\two.js, docs/' })));
    assert.equal(tooMany, false);
    assert.equal(tasks.length, 1);
    const t = tasks[0];
    assert.equal(t.id, 'T1');
    assert.equal(t.role, 'backend-engineer');
    assert.deepEqual(t.items, ['a/one.js', 'B/two.js', 'docs/']);
    assert.deepEqual(t.keys, ['a/one.js', 'b/two.js', 'docs']);
    assert.equal(t.filesValid, true);
    assert.deepEqual(t.deps, []);
    assert.equal(t.marked, true);
    assert.equal(t.alone, false);
    assert.deepEqual(t.reasons, []);
  });

  test('reports each alone reason in the contract order', () => {
    const body = [
      task('T1', { parallel: null }),
      task('T2', { parallel: 'no' }),
      task('T3', { files: null }),
      '### T4 empty files\n- role: qa\n- files:\n- depends-on: none\n- parallel: yes\n',
      task('T5', { files: '../x, C:/x, *.js, .git/x, .env, a b, ' }),
      task('T6', { role: null }),
      task('T7', { role: 'ghost' }),
      task('T8', { deps: 'T99, **bold**' }),
      task('T9'),
      task('T9'),
      '### T10 repeated\n- role: qa\n- files: a.js\n- files: b.js\n- depends-on: none\n- parallel: yes\n',
      task('T11', { files: Array.from({ length: 41 }, (_, i) => `f${i}.js`).join(', ') }),
      task('T12', { deps: null }),
      task('T13', { parallel: 'maybe' })
    ];
    const t = Object.fromEntries(parse(plan(...body)).tasks.map((x) => [x.id, x]));
    assert.deepEqual(t.T1.reasons, ['no parallel mark']);
    assert.deepEqual(t.T2.reasons, ['parallel: no']);
    assert.deepEqual(t.T3.reasons, ['files: missing']);
    assert.deepEqual(t.T4.reasons, ['files: empty']);
    assert.deepEqual(t.T5.reasons, [
      'files item 1: dot segment', 'files item 2: absolute', 'files item 3: glob', 'files item 4: git', 'files item 5: env',
      'files item 6: bad character', 'files item 7: bad character'
    ]);
    assert.deepEqual(t.T6.reasons, ['role: missing']);
    assert.deepEqual(t.T7.reasons, ['role: unknown']);
    assert.deepEqual(t.T8.reasons, ['depends-on: unknown T99', 'depends-on: unknown ?']);
    assert.deepEqual(t.T9.reasons, []);
    assert.deepEqual(t['T9-dup1'].reasons, ['duplicate id']);
    assert.deepEqual(t.T10.reasons, ['field repeated: files']);
    assert.deepEqual(t.T11.reasons, ['files: more than 40']);
    assert.deepEqual(t.T12.reasons, ['depends-on: unknown ?']);
    assert.deepEqual(t.T13.reasons, ['no parallel mark']);
    for (const id of ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T10', 'T11']) assert.equal(t[id].alone, true, id);
    assert.equal(t.T3.filesValid, false);
    assert.equal(t.T5.filesValid, false);
  });

  test('a duplicate id keeps the first block and renames the later ones', () => {
    const { tasks } = parse(plan(task('T1'), task('T1'), task('T1')));
    assert.deepEqual(tasks.map((t) => t.id), ['T1', 'T1-dup1', 'T1-dup2']);
    assert.equal(tasks[0].marked, true);
    assert.equal(tasks[2].alone, true);
  });

  test('an unknown depends-on token is echoed only when it is a task id', () => {
    const text = plan(task('T1', { deps: 'T7, [x](http://e.test) \u001b[31m, `T8`, T9z, T4\nevil' }));
    const t = parse(text).tasks[0];
    for (const r of t.reasons) assert.equal(/[\u0000-\u001f]/.test(r), false);
    assert.deepEqual(t.reasons, ['depends-on: unknown T7', 'depends-on: unknown ?', 'depends-on: unknown T8', 'depends-on: unknown T9z', 'depends-on: unknown T4']);
  });

  test('an unknown or cyclic dependency becomes every earlier task', () => {
    const { tasks } = parse(plan(task('T1'), task('T2'), task('T3', { deps: 'T50' })));
    assert.deepEqual(tasks[2].deps, ['T1', 'T2']);
    assert.equal(tasks[2].alone, true);
  });

  test('a flagged task keeps its valid later dependencies', () => {
    const { tasks } = parse(plan(task('T1', { deps: 'T9, T3' }), task('T2'), task('T3')));
    assert.deepEqual(tasks.map((x) => x.id), ['T2', 'T3', 'T1']);
    assert.deepEqual(tasks[2].deps, ['T2', 'T3']);
    assert.equal(tasks[2].alone, true);
  });

  test('a task on a cycle skips only dependencies on its own cycle', () => {
    const { tasks } = parse(plan(task('T1', { deps: 'T1, T3' }), task('T2'), task('T3', { deps: 'T3, T2' })));
    assert.deepEqual(tasks.map((x) => x.id), ['T2', 'T1', 'T3']);
  });

  test('cycles and self dependencies run alone; a dependency on a later task is not a cycle', () => {
    const cyc = parse(plan(task('T1', { deps: 'T2' }), task('T2', { deps: 'T1' }), task('T3', { deps: 'T3' }), task('T4', { deps: 'T5' }), task('T5')));
    const t = Object.fromEntries(cyc.tasks.map((x) => [x.id, x]));
    for (const id of ['T1', 'T2', 'T3']) {
      assert.deepEqual(t[id].reasons, ['depends-on: cycle'], id);
      assert.equal(t[id].alone, true, id);
    }
    assert.deepEqual(t.T4.reasons, []);
    assert.equal(t.T4.marked, true);
    assert.equal(t.T5.marked, true);
    assert.deepEqual(t.T4.deps, ['T5']);
    assert.deepEqual(t.T1.deps, []);
    assert.deepEqual(t.T2.deps, ['T1']);
    assert.deepEqual(t.T3.deps, ['T1', 'T2']);
    assert.deepEqual(cyc.tasks.map((x) => x.id), ['T1', 'T2', 'T3', 'T5', 'T4']);
  });

  test('the order is stable: plan order, except that a task follows what it depends on', () => {
    const ids = (text) => parse(text).tasks.map((x) => x.id);
    assert.deepEqual(ids(plan(task('T1', { deps: 'T3' }), task('T2'), task('T3'))), ['T2', 'T3', 'T1']);
    assert.deepEqual(ids(plan(task('T1', { deps: 'T2, T3' }), task('T2', { deps: 'T3' }), task('T3'), task('T4'))), ['T3', 'T2', 'T1', 'T4']);
    assert.deepEqual(ids(plan(task('T1'), task('T2'), task('T3'))), ['T1', 'T2', 'T3']);
  });

  test('a task that depends on a cyclic later task still follows it', () => {
    const t = parse(plan(task('T1', { deps: 'T2' }), task('T2', { deps: 'T3' }), task('T3', { deps: 'T2' }))).tasks;
    assert.deepEqual(t.map((x) => x.id), ['T2', 'T1', 'T3']);
    assert.deepEqual(t.map((x) => x.alone), [true, false, true]);
    assert.deepEqual(t[1].deps, ['T2']);
  });

  test('heading levels, id forms and block ends', () => {
    const text = [
      '# Plan', '## Tasks',
      '## T1 level two', '- role: qa', '- files: a.js', '- depends-on: none', '- parallel: yes',
      '#### T2: level four', '- role: qa', '- files: b.js', '- depends-on: none', '- parallel: yes',
      '##### T3 level five is not a task',
      '# T4 level one is not a task',
      '### T5a. suffix', '- role: qa', '- files: d.js', '- depends-on: none', '- parallel: yes',
      '### T6-x dash', '### T7) paren', '### T1234 too long', '### Tx no', '### T8x1 no',
      '### Other heading', '- role: writer', '- files: z.js', '- parallel: yes', ''
    ].join('\n');
    const { tasks } = parse(text);
    assert.deepEqual(tasks.map((t) => t.id), ['T1', 'T2', 'T5a', 'T6', 'T7']);
    assert.equal(tasks[0].marked, true);
    assert.equal(tasks[1].marked, true);
    assert.equal(tasks[2].marked, true);
    assert.deepEqual(tasks[3].reasons.includes('role: missing'), true);
  });

  test('a deeper heading stays inside the block and a same-level heading ends it', () => {
    const text = ['## Tasks', '### T1 a', '- role: qa', '##### notes', '- files: a.js', '- depends-on: none', '### Next', '- parallel: yes', ''].join('\n');
    const t = parse(text).tasks[0];
    assert.equal(t.filesValid, true);
    assert.deepEqual(t.reasons, ['no parallel mark']);
  });

  test('fenced headings and fields are ignored', () => {
    const text = [
      '## Tasks', '### T1 real', '- role: qa', '- files: a.js', '- depends-on: none',
      '```', '- parallel: yes', '### T2 fake', '```', '~~~~', '### T3 fake', '~~~', '- parallel: yes', '~~~~', ''
    ].join('\n');
    const { tasks } = parse(text);
    assert.deepEqual(tasks.map((t) => t.id), ['T1']);
    assert.deepEqual(tasks[0].reasons, ['no parallel mark']);
  });

  test('field lines follow the exact shape', () => {
    const text = [
      '## Tasks', '### T1 a',
      '* role: qa', '   - files: a.js', '    - depends-on: none', '- Parallel: yes', '-parallel: yes', ''
    ].join('\n');
    const t = parse(text).tasks[0];
    assert.equal(t.role, 'qa');
    assert.equal(t.filesValid, true);
    assert.deepEqual(t.reasons, ['no parallel mark', 'depends-on: unknown ?']);
  });

  test('line endings do not change the result', () => {
    const lf = plan(task('T1'), task('T2'));
    assert.deepEqual(parse(lf.replaceAll('\n', '\r\n')), parse(lf));
  });

  test('stops at 100 tasks', () => {
    const many = plan(...Array.from({ length: 101 }, (_, i) => task(`T${i + 1}`)));
    const r = parse(many);
    assert.equal(r.tooMany, true);
    assert.equal(r.tasks.length, 100);
    assert.equal(parse(plan(...Array.from({ length: 100 }, (_, i) => task(`T${i + 1}`)))).tooMany, false);
  });

  test('an empty or task-less plan has no tasks', () => {
    assert.deepEqual(parse('').tasks, []);
    assert.deepEqual(parse('# Plan\n\nNo tasks here.\n').tasks, []);
  });

  test('a role is known only when it is in the agent set', () => {
    const t = parsePlan(plan(task('T1')), { agents: new Set(['qa']) }).tasks[0];
    assert.equal(t.role, null);
    assert.deepEqual(t.reasons, ['role: unknown']);
    assert.equal(parsePlan(plan(task('T1'))).tasks[0].role, null);
  });
});

describe('schedule', () => {
  const T = (...tasks) => parse(plan(...tasks)).tasks;
  const view = (s) => s.map((e) => `${e.outcome}:${e.id}${e.reason ? `:${e.reason}` : ''}${e.on ? `:${e.on}` : ''}`);
  const ids = (n) => Array.from({ length: n }, (_, i) => task(`T${i + 1}`));

  for (const cap of [3, 4, 5]) {
    test(`six marked tasks start ${cap} at cap ${cap}`, () => {
      const s = schedule(T(...ids(6)), [], [], cap);
      assert.equal(s.filter((e) => e.outcome === 'start').length, cap);
      assert.deepEqual(s.filter((e) => e.outcome === 'wait').map((e) => e.reason), Array(6 - cap).fill('cap'));
    });
  }

  test('running tasks count against the cap and the next one starts after a done', () => {
    const tasks = T(...ids(6));
    assert.deepEqual(view(schedule(tasks, [], ['T1', 'T2', 'T3', 'T4'], 4)).slice(4), ['wait:T5:cap', 'wait:T6:cap']);
    assert.deepEqual(view(schedule(tasks, ['T1'], ['T2', 'T3', 'T4'], 4)).slice(3), ['start:T5', 'wait:T6:cap']);
  });

  test('sequential cap 1 starts one task at a time', () => {
    const s = schedule(T(...ids(3)), [], [], 1);
    assert.deepEqual(view(s), ['start:T1', 'wait:T2:cap', 'wait:T3:cap']);
  });

  test('a dependency that is not done holds a task back', () => {
    const tasks = T(task('T1'), task('T2', { deps: 'T1' }), task('T3'));
    assert.deepEqual(view(schedule(tasks, [], [], 4)), ['start:T1', 'wait:T2:depends:T1', 'start:T3']);
    assert.deepEqual(view(schedule(tasks, [], ['T1'], 4)), ['running:T1', 'wait:T2:depends:T1', 'start:T3']);
    assert.deepEqual(view(schedule(tasks, ['T1'], [], 4)), ['start:T2', 'start:T3']);
  });

  test('overlapping tasks run in plan order whatever the case, slash or directory form', () => {
    const tasks = T(task('T1', { files: 'Scripts/A.mjs' }), task('T2', { files: 'scripts\\a.mjs' }), task('T3', { files: 'docs/' }), task('T4', { files: 'docs/x.md' }), task('T5', { files: 'z.md' }));
    assert.deepEqual(view(schedule(tasks, [], [], 4)), ['start:T1', 'wait:T2:overlap:T1', 'start:T3', 'wait:T4:overlap:T3', 'start:T5']);
    assert.deepEqual(view(schedule(tasks, [], ['T1'], 4)).slice(0, 2), ['running:T1', 'wait:T2:overlap:T1']);
    assert.deepEqual(view(schedule(tasks, ['T1', 'T3'], [], 4)), ['start:T2', 'start:T4', 'start:T5']);
  });

  test('a later task waits for an earlier overlapping task that is not ready yet', () => {
    const tasks = T(task('T1', { files: 'x.md' }), task('T2', { files: 'a.md', deps: 'T1' }), task('T3', { files: 'a.md' }));
    assert.deepEqual(view(schedule(tasks, [], [], 4)), ['start:T1', 'wait:T2:depends:T1', 'wait:T3:overlap:T2']);
  });

  test('a forward dependency finishes in dependency order, with an overlap too', () => {
    const tasks = T(task('T1', { files: 'a.md', deps: 'T3' }), task('T2', { files: 'a.md' }), task('T3', { files: 'b.md' }));
    assert.deepEqual(view(schedule(tasks, [], [], 4)), ['start:T2', 'start:T3', 'wait:T1:depends:T3']);
    assert.deepEqual(view(schedule(tasks, ['T3'], ['T2'], 4)), ['running:T2', 'wait:T1:overlap:T2']);
    assert.deepEqual(view(schedule(tasks, ['T2', 'T3'], [], 4)), ['start:T1']);
    const alone = T(task('T1', { deps: 'T2' }), task('T2'));
    assert.deepEqual(view(schedule(alone, [], [], 4)), ['start:T2', 'wait:T1:depends:T2']);
  });

  test('a plan with a cycle still runs to the end', () => {
    const tasks = T(task('T1', { deps: 'T2' }), task('T2', { deps: 'T1' }), task('T3'));
    const done = new Set();
    for (let guard = 0; done.size < 3 && guard < 10; guard++) {
      const starts = schedule(tasks, done, [], 4).filter((e) => e.outcome === 'start');
      assert.ok(starts.length > 0);
      for (const e of starts) done.add(e.id);
    }
    assert.equal(done.size, 3);
  });

  test('a task with an invalid file list overlaps every other task', () => {
    const tasks = T(task('T1', { files: '*.js' }), task('T2', { files: 'a.md' }));
    assert.deepEqual(view(schedule(tasks, [], [], 4)), ['start:T1', 'wait:T2:overlap:T1']);
    const tasks2 = T(task('T1', { files: 'a.md' }), task('T2', { files: '*.js' }));
    assert.deepEqual(view(schedule(tasks2, [], [], 4)), ['start:T1', 'wait:T2:overlap:T1']);
  });

  test('an alone task starts only when nothing runs and holds later tasks back', () => {
    const tasks = T(task('T1'), task('T2', { parallel: 'no' }), task('T3'), task('T4'));
    assert.deepEqual(view(schedule(tasks, [], [], 4)), ['start:T1', 'wait:T2:alone:T1', 'wait:T3:barrier:T2', 'wait:T4:barrier:T2']);
    assert.deepEqual(view(schedule(tasks, ['T1'], [], 4)), ['start:T2', 'wait:T3:barrier:T2', 'wait:T4:barrier:T2']);
    assert.deepEqual(view(schedule(tasks, ['T1', 'T2'], [], 4)), ['start:T3', 'start:T4']);
  });

  test('a running alone task makes every other task wait', () => {
    const tasks = T(task('T1', { parallel: 'no' }), task('T2'), task('T3'));
    assert.deepEqual(view(schedule(tasks, [], ['T1'], 4)), ['running:T1', 'wait:T2:alone:T1', 'wait:T3:alone:T1']);
  });

  test('an alone task that is not ready does not hold later tasks back', () => {
    const tasks = T(task('T1'), task('T2', { parallel: 'no', deps: 'T1' }), task('T3'));
    assert.deepEqual(view(schedule(tasks, [], [], 4)), ['start:T1', 'wait:T2:depends:T1', 'start:T3']);
  });

  test('accepts arrays and sets for done and running', () => {
    const tasks = T(...ids(3));
    assert.deepEqual(view(schedule(tasks, new Set(['T1']), new Set(['T2']), 4)), view(schedule(tasks, ['T1'], ['T2'], 4)));
  });

  test('done tasks produce no outcome', () => {
    assert.deepEqual(schedule(T(...ids(2)), ['T1', 'T2'], [], 4), []);
  });
});

describe('arguments', () => {
  test('control characters in any argument are refused and nothing is written', () => {
    const fx = fixture(six());
    for (const c of ['\n', '\r', '\u001b', '\u0000', '\u007f', '\u2028', '\u2029', '\u202e', '\u200b']) {
      const cases = [
        ['check', 'demo', `02-plan.md${c}`, '--cap', '4', '--mode', 'parallel'],
        ['begin', 'demo', fx.name, '--cap', `4${c}`, '--mode', 'parallel'],
        ['begin', 'demo', fx.name, '--cap', '4', '--mode', `parallel${c}`],
        ['begin', `de${c}mo`, fx.name, '--cap', '4', '--mode', 'parallel'],
        ['start', 'demo', `T1${c}`],
        ['done', 'demo', `T1${c}`],
        ['lines', 'demo', `T1${c}`],
        ['scope', 'demo', 'T1', '--', `a/b${c}c`],
        ['round', 'demo', '1', '--', `a/b${c}c`],
        ['next', 'demo', `--json${c}`]
      ];
      for (const args of cases) {
        const r = fx.run(...args);
        assert.equal(r.code, 3, JSON.stringify(args));
        assert.equal(r.lines.length, 1);
        assert.match(r.lines[0], /^refused: /);
        assert.equal(r.lines[0].includes(c), false);
      }
    }
    assert.equal(fs.existsSync(fx.record), false);
  });

  test('non-string arguments and unknown commands are refused', () => {
    const fx = fixture(six());
    assert.equal(fx.run().code, 3);
    assert.equal(fx.run('nope').code, 3);
    assert.equal(fx.run('check', 'demo', 7).code, 3);
    assert.equal(fx.run('__proto__').code, 3);
    assert.equal(fx.run('constructor').code, 3);
    assert.equal(main('check', { root: fx.root }).code, 3);
  });

  test('bad slug, cap, mode, ids and repeated flags are refused', () => {
    const fx = fixture(six());
    const bad = [
      ['check', '../demo', fx.name, '--cap', '4', '--mode', 'parallel'],
      ['check', 'Demo', fx.name, '--cap', '4', '--mode', 'parallel'],
      ['check', 'demo', fx.name, '--cap', '2', '--mode', 'parallel'],
      ['check', 'demo', fx.name, '--cap', '6', '--mode', 'parallel'],
      ['check', 'demo', fx.name, '--cap', '4.5', '--mode', 'parallel'],
      ['check', 'demo', fx.name, '--cap', '04', '--mode', 'parallel'],
      ['check', 'demo', fx.name, '--cap', '4', '--mode', 'fast'],
      ['check', 'demo', fx.name, '--cap', '4'],
      ['check', 'demo', fx.name, '--mode', 'parallel'],
      ['check', 'demo', fx.name, '--cap', '4', '--cap', '4', '--mode', 'parallel'],
      ['check', 'demo', fx.name, '--cap', '4', '--mode', 'parallel', '--extra'],
      ['check', 'demo', '--cap', '4', '--mode', 'parallel'],
      ['start', 'demo', '__proto__'],
      ['start', 'demo', 't1'],
      ['start', 'demo', 'T1234'],
      ['start', 'demo'],
      ['next', 'demo', '--json', '--json'],
      ['round', 'demo', 'x', '--', 'a.js'],
      ['round', 'demo', '1', '--loose', '101', '--', 'a.js'],
      ['round', 'demo', '1', '--loose', 'x', '--', 'a.js'],
      ['round', 'demo', '1', '--', '../a.js'],
      ['round', 'demo', '1', '--', 'a b.js'],
      ['scope', 'demo', 'T1', 'a.js']
    ];
    for (const args of bad) assert.equal(fx.run(...args).code, 3, JSON.stringify(args));
  });
});

describe('check', () => {
  const p = () => plan(
    task('T1', { files: 'a/one.js' }), task('T2', { files: 'b/two.js' }), task('T3', { files: 'A\\One.js' }),
    task('T4', { files: 'd/' }), task('T5', { files: 'd/file.js' }), task('T6', { files: 'e.js', parallel: null })
  );

  test('prints the Gate block with waves and warnings', () => {
    const fx = fixture(p());
    const r = fx.run('check', 'demo', fx.name, '--cap', '4', '--mode', 'parallel');
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, [
      'plan-tasks: 6 tasks, 5 marked, 1 alone, cap 4 (parallel)',
      'wave 1: T1, T2, T4',
      'wave 2: T3 overlap T1, T5 overlap T4',
      'wave 3: T6 alone T3',
      'warning T6: runs alone: no parallel mark'
    ]);
    assert.equal(fs.existsSync(fx.record), false);
  });

  test('waves follow the cap and the mode', () => {
    const fx = fixture(six());
    assert.deepEqual(fx.run('check', 'demo', fx.name, '--cap', '3', '--mode', 'parallel').lines, [
      'plan-tasks: 6 tasks, 6 marked, 0 alone, cap 3 (parallel)', 'wave 1: T1, T2, T3', 'wave 2: T4 cap, T5 cap, T6 cap'
    ]);
    assert.deepEqual(fx.run('check', 'demo', fx.name, '--cap', '5', '--mode', 'sequential').lines.slice(0, 3), [
      'plan-tasks: 6 tasks, 6 marked, 0 alone, cap 5 (sequential)', 'wave 1: T1', 'wave 2: T2 cap'
    ]);
  });

  test('dependency waves name the reason and the blocking task', () => {
    const fx = fixture(plan(task('T1'), task('T2', { deps: 'T1' }), task('T3', { deps: 'T2' })));
    assert.deepEqual(fx.run('check', 'demo', fx.name, '--cap', '4', '--mode', 'parallel').lines, [
      'plan-tasks: 3 tasks, 3 marked, 0 alone, cap 4 (parallel)', 'wave 1: T1', 'wave 2: T2 depends T1', 'wave 3: T3 depends T2'
    ]);
  });

  test('warnings never change the exit code and echo only checked text', () => {
    const fx = fixture(plan(
      task('T1', { deps: 'T9, \u001b[2Jevil', files: '../x, a b' }), task('T2', { parallel: 'no' }), task('T3', { role: 'x\u001b[0m' })
    ));
    const r = fx.run('check', 'demo', fx.name, '--cap', '4', '--mode', 'parallel');
    assert.equal(r.code, 0);
    assert.ok(r.lines.some((l) => l === 'warning T1: runs alone: files item 1: dot segment; files item 2: bad character; depends-on: unknown T9; depends-on: unknown ?'));
    for (const l of r.lines) assert.equal(/[\u0000-\u001f\u007f]/.test(l), false);
  });

  test('a plan with no task, and plans that cannot be read', () => {
    let fx = fixture('# Plan\n\nProse only.\n');
    assert.deepEqual(fx.run('check', 'demo', fx.name, '--cap', '4', '--mode', 'parallel'), { code: 0, lines: ['plan-tasks: 0 tasks; plan Steps run one at a time'] });
    fx = fixture(null);
    assert.deepEqual(fx.run('check', 'demo', fx.name, '--cap', '4', '--mode', 'parallel'), { code: 1, lines: ['plan-tasks: error plan-missing'] });
    assert.deepEqual(fx.run('check', 'demo', 'notes.md', '--cap', '4', '--mode', 'parallel'), { code: 1, lines: ['plan-tasks: error plan-name'] });
    assert.deepEqual(fx.run('check', 'other', fx.name, '--cap', '4', '--mode', 'parallel'), { code: 1, lines: ['plan-tasks: error plan-missing'] });
    fx = fixture(`# Plan\n${'x'.repeat(256 * 1024)}\n`);
    assert.deepEqual(fx.run('check', 'demo', fx.name, '--cap', '4', '--mode', 'parallel'), { code: 1, lines: ['plan-tasks: error plan-too-large'] });
    fx = fixture(null);
    fs.writeFileSync(fx.plan, Buffer.from([0xff, 0xfe, 0x41]));
    assert.deepEqual(fx.run('check', 'demo', fx.name, '--cap', '4', '--mode', 'parallel'), { code: 1, lines: ['plan-tasks: error plan-unreadable'] });
    fx = fixture(plan(...Array.from({ length: 101 }, (_, i) => task(`T${i + 1}`))));
    assert.equal(fx.run('check', 'demo', fx.name, '--cap', '4', '--mode', 'parallel').code, 1);
  });

  test('a plan that is a directory or a link is refused as unreadable', () => {
    const fx = fixture(null);
    fs.mkdirSync(fx.plan);
    assert.deepEqual(fx.run('check', 'demo', fx.name, '--cap', '4', '--mode', 'parallel'), { code: 1, lines: ['plan-tasks: error plan-unreadable'] });
  });
});

describe('begin, next, start, done', () => {
  test('begin writes the record and prints the first line and begun', () => {
    const fx = fixture(six());
    const r = begin(fx);
    assert.deepEqual(r, { code: 0, lines: ['plan-tasks: 6 tasks, 6 marked, 0 alone, cap 4 (parallel)', 'begun'] });
    const [e] = fx.events();
    assert.deepEqual(Object.keys(e), ['v', 'at', 'ev', 'plan', 'hash', 'cap', 'mode', 'tasks', 'ow']);
    assert.equal(e.at, '2026-10-28T12:00:00Z');
    assert.match(e.hash, /^[0-9a-f]{12}$/);
    assert.deepEqual({ ev: e.ev, plan: e.plan, cap: e.cap, mode: e.mode, tasks: e.tasks, ow: e.ow }, { ev: 'begin', plan: '02-plan.md', cap: 4, mode: 'parallel', tasks: 6, ow: [] });
    assert.equal(fs.readFileSync(fx.record, 'utf8').includes('\r'), false);
  });

  test('six marked tasks at cap 4: four start, the fifth only after a done', () => {
    const fx = fixture(six());
    begin(fx);
    assert.deepEqual(fx.run('next', 'demo'), {
      code: 0,
      lines: [
        'next: round 0, running 0 of cap 4', 'start T1 backend-engineer', 'start T2 backend-engineer', 'start T3 backend-engineer',
        'start T4 backend-engineer', 'wait T5 cap', 'wait T6 cap', 'done 0 of 6'
      ]
    });
    for (const id of ['T1', 'T2', 'T3', 'T4']) assert.deepEqual(fx.run('start', 'demo', id), { code: 0, lines: [`started ${id}`] });
    assert.deepEqual(fx.run('next', 'demo').lines, [
      'next: round 0, running 4 of cap 4', 'running T1', 'running T2', 'running T3', 'running T4', 'wait T5 cap', 'wait T6 cap', 'done 0 of 6'
    ]);
    assert.deepEqual(fx.run('start', 'demo', 'T5'), { code: 3, lines: ['refused: not a start line of next'] });
    assert.deepEqual(fx.run('done', 'demo', 'T2'), { code: 0, lines: ['done T2'] });
    assert.deepEqual(fx.run('next', 'demo').lines, [
      'next: round 0, running 3 of cap 4', 'running T1', 'running T3', 'running T4', 'start T5 backend-engineer', 'wait T6 cap', 'done 1 of 6'
    ]);
    assert.equal(fx.run('start', 'demo', 'T5').code, 0);
    for (const id of ['T1', 'T3', 'T4', 'T5']) fx.run('done', 'demo', id);
    assert.equal(fx.run('start', 'demo', 'T6').code, 0);
    assert.equal(fx.run('done', 'demo', 'T6').code, 0);
    assert.deepEqual(fx.run('next', 'demo').lines, ['next: round 0, running 0 of cap 4', 'next: round 0 complete']);
    assert.equal(readParallel(fx.root, 'demo').peak, 4);
  });

  test('sequential mode starts one task at a time', () => {
    const fx = fixture(six());
    begin(fx, 5, 'sequential');
    assert.deepEqual(fx.run('next', 'demo').lines.slice(0, 3), ['next: round 0, running 0 of cap 1', 'start T1 backend-engineer', 'wait T2 cap']);
    assert.equal(readParallel(fx.root, 'demo').effective_cap, 1);
  });

  test('a role outside the agent set prints as ?', () => {
    const fx = fixture(plan(task('T1', { role: 'ghost' }), task('T2')));
    begin(fx);
    assert.deepEqual(fx.run('next', 'demo').lines.slice(1, 3), ['start T1 ?', 'wait T2 barrier T1']);
  });

  test('json output', () => {
    const fx = fixture(six());
    begin(fx, 3, 'parallel');
    fx.run('start', 'demo', 'T1');
    const r = fx.run('next', 'demo', '--json');
    assert.deepEqual(JSON.parse(r.lines[0]), {
      v: 1, round: 0, cap: 3, running: 1,
      start: [{ task: 'T2', role: 'backend-engineer' }, { task: 'T3', role: 'backend-engineer' }],
      wait: [{ task: 'T4', reason: 'cap', on: null }, { task: 'T5', reason: 'cap', on: null }, { task: 'T6', reason: 'cap', on: null }],
      done: 0, total: 6, complete: false
    });
    assert.equal(r.lines.length, 1);
  });

  test('the same plan and record give byte-identical next output', () => {
    const fx = fixture(plan(task('T1', { files: 'a' }), task('T2', { files: 'A/b' }), task('T3'), task('T4', { parallel: 'no' }), task('T5')));
    begin(fx);
    fx.run('start', 'demo', 'T1');
    const outs = [1, 2, 3].map(() => JSON.stringify([fx.run('next', 'demo'), fx.run('next', 'demo', '--json')]));
    assert.equal(outs[0], outs[1]);
    assert.equal(outs[1], outs[2]);
    const again = fixture(fs.readFileSync(fx.plan, 'utf8'));
    fs.copyFileSync(fx.record, again.record);
    assert.equal(JSON.stringify([again.run('next', 'demo'), again.run('next', 'demo', '--json')]), outs[0]);
  });

  test('overlap waits are recorded in ow and counted once per task and round', () => {
    const fx = fixture(plan(task('T1', { files: 'a.js' }), task('T2', { files: 'b.js' }), task('T3', { files: 'A.JS' })));
    begin(fx);
    assert.deepEqual(fx.events()[0].ow, ['T3']);
    fx.run('start', 'demo', 'T1');
    assert.deepEqual(fx.events()[1].ow, ['T3']);
    fx.run('start', 'demo', 'T2');
    fx.run('done', 'demo', 'T1');
    const last = fx.events().at(-1);
    assert.deepEqual([last.ev, last.task, last.round, last.ow], ['done', 'T1', 0, []]);
    const view = readParallel(fx.root, 'demo');
    assert.equal(view.waits, 1);
    assert.equal(view.peak, 2);
  });

  test('an unknown or running task cannot be started, a task that is not running cannot be done', () => {
    const fx = fixture(six());
    begin(fx);
    assert.equal(fx.run('start', 'demo', 'T77').code, 3);
    assert.equal(fx.run('done', 'demo', 'T1').code, 3);
    fx.run('start', 'demo', 'T1');
    assert.equal(fx.run('start', 'demo', 'T1').code, 3);
    assert.equal(fx.run('done', 'demo', 'T2').code, 3);
    assert.equal(fx.events().length, 2);
  });

  test('begin is refused while a task runs and can be repeated after a done', () => {
    const fx = fixture(six());
    begin(fx);
    fx.run('start', 'demo', 'T1');
    assert.equal(begin(fx).code, 3);
    fx.run('done', 'demo', 'T1');
    assert.equal(begin(fx, 5, 'parallel').code, 0);
    const view = readParallel(fx.root, 'demo');
    assert.equal(view.cap, 5);
    assert.deepEqual(view.done, { 0: ['T1'] });
    assert.deepEqual(fx.run('next', 'demo').lines.slice(0, 3), ['next: round 0, running 0 of cap 5', 'start T2 backend-engineer', 'start T3 backend-engineer']);
  });

  test('commands that need a begin refuse before one', () => {
    const fx = fixture(six());
    for (const args of [['next', 'demo'], ['start', 'demo', 'T1'], ['done', 'demo', 'T1'], ['lines', 'demo', 'T1'], ['scope', 'demo', 'T1', '--'], ['round', 'demo', '1', '--', 'a.js']]) {
      assert.deepEqual(fx.run(...args), { code: 3, lines: ['refused: no begin record for this run'] }, args[0]);
    }
  });

  test('a plan changed since begin refuses next, start and lines but not done', () => {
    const fx = fixture(six());
    begin(fx);
    fx.run('start', 'demo', 'T1');
    fs.appendFileSync(fx.plan, 'one more line\n');
    for (const args of [['next', 'demo'], ['start', 'demo', 'T2'], ['lines', 'demo', 'T1']]) {
      assert.deepEqual(fx.run(...args), { code: 3, lines: ['refused: plan changed since begin'] }, args[0]);
    }
    assert.equal(fx.events().length, 2);
    assert.equal(fx.run('done', 'demo', 'T1').code, 0);
    assert.deepEqual(fx.events().at(-1).ow, []);
  });

  test('a missing plan after begin is an error, not a refusal', () => {
    const fx = fixture(six());
    begin(fx);
    fs.rmSync(fx.plan);
    assert.deepEqual(fx.run('next', 'demo'), { code: 1, lines: ['plan-tasks: error plan-missing'] });
  });

  test('a plan with no task begins an empty run that is complete', () => {
    const fx = fixture('# Plan\n');
    assert.equal(begin(fx).code, 0);
    assert.deepEqual(fx.run('next', 'demo').lines, ['next: round 0, running 0 of cap 4', 'next: round 0 complete']);
  });
});

describe('lines', () => {
  test('prints the Task and Files lines', () => {
    const fx = fixture(plan(task('T1', { files: 'Scripts\\A.mjs, docs/, `x/y.md`' }), task('T2', { files: '*.js' })));
    begin(fx);
    assert.deepEqual(fx.run('lines', 'demo', 'T1'), { code: 0, lines: ['Task: T1', 'Files: Scripts/A.mjs, docs/, x/y.md'] });
    assert.deepEqual(fx.run('lines', 'demo', 'T2'), { code: 0, lines: ['Task: T2', 'Files: none'] });
    assert.equal(fx.run('lines', 'demo', 'T9').code, 3);
    assert.equal(fx.events().length, 1);
  });
});

describe('brief', () => {
  const full = [
    '# Plan', '', 'Settled choices carry `Decided:` lines.', '',
    '## Core', '- Decided: the script is a Module.', '',
    '## Core, Modules and Contracts', '| Contract | Version |', '| x | v1 |', '### Contract changes', 'x gains a field', '',
    '## Rules', '1. Decided: numbered rule.', '   + Decided: plus rule.', '```', 'Decided: fenced, not a rule.', '```', '',
    '## Tasks', '',
    task('T1', { files: 'a.js' }).trimEnd(), 'Build a.', 'Decided: a stays small.', '#### T1 notes', 'more for T1', '',
    task('T10', { files: 'b.js' }).trimEnd(), 'Build b.', 'Decided: b is T10 only.', '',
    '## Delta A (T1 pastes it)', '```', '## not a heading', '```', '',
    '## Delta B (T10 pastes it)', 'for T10', 'Decided: T10 delta rule.', '',
    '## Delta C contract (T10 pastes it)', 'contract text for T10', '',
    '## Rollback', 'Decided: revert by tag.', ''
  ].join('\n');

  test('writes only the task slice and prints its path', () => {
    const fx = fixture(full);
    begin(fx);
    assert.deepEqual(fx.run('brief', 'demo', 'T1'), { code: 0, lines: ['Task brief: .company/work/demo/tasks/T1.md'] });
    const text = fs.readFileSync(path.join(fx.dir, 'tasks', 'T1.md'), 'utf8');
    for (const want of ['# Task brief: T1 (from 02-plan.md)', '### T1 title of T1', 'Build a.', 'Decided: a stays small.', '#### T1 notes',
      '## Core, Modules and Contracts', '| x | v1 |', '### Contract changes', 'x gains a field',
      '## Decided (plan-wide)', '- Decided: the script is a Module.', 'Decided: revert by tag.', '1. Decided: numbered rule.', '   + Decided: plus rule.',
      '## Delta A (T1 pastes it)', '## not a heading']) {
      assert.ok(text.includes(want), want);
    }
    for (const unwanted of ['T10 title', 'Build b.', 'Decided: b is T10 only.', 'Delta B', 'for T10', 'Settled choices', 'Decided: fenced',
      'Decided: T10 delta rule.', 'Delta C', 'contract text for T10']) {
      assert.ok(!text.includes(unwanted), unwanted);
    }
  });

  test('never prints plan text and refuses unknown or changed plans', () => {
    const fx = fixture(full);
    begin(fx);
    const r = fx.run('brief', 'demo', 'T10');
    assert.equal(r.lines.join('\n').includes('Build b.'), false);
    assert.equal(fx.run('brief', 'demo', 'T9').code, 3);
    fs.appendFileSync(fx.plan, 'changed\n');
    assert.equal(fx.run('brief', 'demo', 'T1').code, 3);
  });

  test('refuses a tasks path that is a file or a link, U1 and an unclosed fence', () => {
    const fx = fixture(full);
    begin(fx);
    fs.writeFileSync(path.join(fx.dir, 'tasks'), 'x\n');
    assert.equal(fx.run('brief', 'demo', 'T1').code, 3);
    fs.rmSync(path.join(fx.dir, 'tasks'));
    const away = path.join(fx.root, 'away');
    fs.mkdirSync(away);
    let linked = true;
    try {
      fs.symlinkSync(away, path.join(fx.dir, 'tasks'), 'junction');
    } catch {
      linked = false;
    }
    if (linked) {
      assert.equal(fx.run('brief', 'demo', 'T1').code, 3);
      assert.deepEqual(fs.readdirSync(away), []);
      fs.rmSync(path.join(fx.dir, 'tasks'), { recursive: false, force: true });
    }

    const fu = fixture(full);
    begin(fu);
    assert.equal(fu.run('round', 'demo', '1', '--loose', '1', '--').code, 0);
    assert.match(fu.run('brief', 'demo', 'U1').lines[0], /^refused: task has no plan block/);

    const ff = fixture(`${full}\`\`\`\nnever closed\n`);
    begin(ff);
    assert.match(ff.run('brief', 'demo', 'T1').lines[0], /^refused: task has no plan block or the plan has an unclosed fence/);
  });

  test('refuses a linked brief file', () => {
    const fx = fixture(full);
    begin(fx);
    fs.mkdirSync(path.join(fx.dir, 'tasks'));
    const target = path.join(fx.root, 'outside.md');
    fs.writeFileSync(target, 'keep\n');
    try {
      fs.linkSync(target, path.join(fx.dir, 'tasks', 'T1.md'));
    } catch {
      return;
    }
    assert.equal(fx.run('brief', 'demo', 'T1').code, 3);
    assert.equal(fs.readFileSync(target, 'utf8'), 'keep\n');
  });
});

describe('scope', () => {
  function started() {
    const fx = fixture(plan(task('T1', { files: 'a/one.js, docs/' }), task('T2', { files: 'b/two.js' }), task('T3', { files: 'c.js' })));
    begin(fx);
    fx.run('start', 'demo', 'T1');
    fx.run('start', 'demo', 'T2');
    return fx;
  }

  test('sorts the candidates into in, extra and sibling', () => {
    const fx = started();
    const r = fx.run('scope', 'demo', 'T1', '--', '.company/work/demo/04-x.md', 'A/One.js', 'docs/guide/x.md', 'b/two.js', 'c.js', 'new/File.js', 'a/../x', 'has space.md', 'C:/x');
    assert.deepEqual(r, {
      code: 0,
      lines: [
        'in .company/work/demo/04-x.md', 'in A/One.js', 'in docs/guide/x.md', 'sibling T2 b/two.js', 'extra c.js', 'extra new/File.js',
        'extra ?', 'extra ?', 'extra ?', 'scope: 5 extra, 1 sibling'
      ]
    });
    const out = fx.events().at(-1);
    assert.deepEqual(out, {
      v: 1, at: '2026-10-28T12:00:00Z', ev: 'out', task: 'T1', round: 0,
      extra: ['c.js', 'new/file.js', '?', '?', '?'], sibling: ['b/two.js']
    });
    const view = readParallel(fx.root, 'demo');
    assert.equal(view.out, 6);
    assert.equal(view.sibling, 1);
  });

  test('an earlier extra of the task counts as its own set', () => {
    const fx = started();
    fx.run('scope', 'demo', 'T1', '--', 'new/file.js');
    assert.deepEqual(fx.run('scope', 'demo', 'T1', '--', 'NEW/file.js').lines, ['in NEW/file.js', 'scope: 0 extra, 0 sibling']);
  });

  test('the work folder of another run is not in', () => {
    const fx = started();
    assert.deepEqual(fx.run('scope', 'demo', 'T1', '--', '.company/work/other/x.md').lines, ['extra .company/work/other/x.md', 'scope: 1 extra, 0 sibling']);
    assert.deepEqual(fx.run('scope', 'demo', 'T1', '--', '.company/work/demo/../other/x.md').lines, ['extra ?', 'scope: 1 extra, 0 sibling']);
  });

  test('an empty candidate list still records an out event', () => {
    const fx = started();
    const n = fx.events().length;
    assert.deepEqual(fx.run('scope', 'demo', 'T1', '--'), { code: 0, lines: ['scope: 0 extra, 0 sibling'] });
    assert.equal(fx.events().length, n + 1);
    assert.deepEqual(fx.events().at(-1).extra, []);
  });

  test('refuses a task that is not running and more than 100 paths', () => {
    const fx = started();
    assert.deepEqual(fx.run('scope', 'demo', 'T3', '--', 'a.js'), { code: 3, lines: ['refused: task is not running'] });
    assert.equal(fx.run('scope', 'demo', 'T1', '--', ...Array.from({ length: 101 }, (_, i) => `f${i}.js`)).code, 3);
    assert.equal(fx.events().length, 3);
  });

  test('does not read the plan hash: scope works after a plan edit', () => {
    const fx = started();
    fs.appendFileSync(fx.plan, 'edit\n');
    assert.equal(fx.run('scope', 'demo', 'T1', '--', 'a/one.js').code, 0);
  });
});

describe('round', () => {
  function finished(cap = 4, planText = plan(task('T1', { files: 'a/one.js' }), task('T2', { files: 'b/' }), task('T3', { files: 'c.js' }))) {
    const fx = fixture(planText);
    begin(fx, cap);
    fx.run('start', 'demo', 'T3');
    fx.run('scope', 'demo', 'T3', '--', 'z/extra.js');
    for (const id of ['T1', 'T2']) fx.run('start', 'demo', id);
    for (const id of ['T1', 'T2', 'T3']) fx.run('done', 'demo', id);
    return fx;
  }

  test('gives each path to its owner, then the extra owner, then U1', () => {
    const fx = finished();
    const r = fx.run('round', 'demo', '1', '--loose', '2', '--', 'a/one.js', 'B/x.js', 'Z/Extra.js', 'q/none.js');
    assert.deepEqual(r, { code: 0, lines: ['round 1: T1 (+1 paths), T2 (+1 paths), T3 (+1 paths), U1 (+1 paths)', 'unowned q/none.js'] });
    const e = fx.events().at(-1);
    assert.deepEqual(e.sets, { T1: ['a/one.js'], T2: ['b/x.js'], T3: ['z/extra.js'], U1: ['q/none.js'] });
    assert.equal(e.loose, 2);
    assert.equal(e.round, 1);
    assert.deepEqual(fx.run('next', 'demo').lines, [
      'next: round 1, running 0 of cap 4', 'start T1 backend-engineer', 'start T2 backend-engineer', 'start T3 backend-engineer', 'wait U1 alone T1', 'done 0 of 4'
    ]);
    assert.deepEqual(fx.run('lines', 'demo', 'T2').lines, ['Task: T2', 'Files: b/, b/x.js']);
    assert.deepEqual(fx.run('lines', 'demo', 'U1').lines, ['Task: U1', 'Files: q/none.js']);
    const view = readParallel(fx.root, 'demo');
    assert.equal(view.round, 1);
    assert.deepEqual(view.done, { 0: ['T1', 'T2', 'T3'] });
  });

  test('loose items alone make U1 with no paths', () => {
    const fx = finished();
    assert.deepEqual(fx.run('round', 'demo', '1', '--loose', '3', '--', 'a/one.js').lines, ['round 1: T1 (+1 paths), U1 (+0 paths)']);
    assert.deepEqual(fx.run('lines', 'demo', 'U1').lines, ['Task: U1', 'Files: none']);
  });

  test('U1 runs alone, after the others, and a round completes when all its tasks are done', () => {
    const fx = finished();
    fx.run('round', 'demo', '1', '--', 'a/one.js', 'q/none.js');
    assert.deepEqual(fx.run('next', 'demo').lines, ['next: round 1, running 0 of cap 4', 'start T1 backend-engineer', 'wait U1 alone T1', 'done 0 of 2']);
    assert.equal(fx.run('start', 'demo', 'T1').code, 0);
    assert.equal(fx.run('start', 'demo', 'U1').code, 3);
    assert.equal(fx.run('done', 'demo', 'T1').code, 0);
    assert.deepEqual(fx.run('next', 'demo').lines, ['next: round 1, running 0 of cap 4', 'start U1 ?', 'done 1 of 2']);
    assert.equal(fx.run('start', 'demo', 'U1').code, 0);
    assert.equal(fx.run('done', 'demo', 'U1').code, 0);
    assert.deepEqual(fx.run('next', 'demo').lines, ['next: round 1, running 0 of cap 4', 'next: round 1 complete']);
    assert.equal(fx.run('round', 'demo', '2', '--', 'a/one.js').code, 0);
  });

  test('the overlap rule holds inside a round', () => {
    const fx = finished(4, plan(task('T1', { files: 'a/one.js' }), task('T2', { files: 'a/' }), task('T3', { files: 'c.js' })));
    fx.run('round', 'demo', '1', '--', 'a/one.js', 'a/other.js');
    assert.deepEqual(fx.run('next', 'demo').lines.slice(1, 3), ['start T1 backend-engineer', 'wait T2 overlap T1']);
  });

  test('the cap holds inside a round', () => {
    const fx = finished(3, plan(task('T1', { files: 'a.js' }), task('T2', { files: 'b.js' }), task('T3', { files: 'c.js' }), task('T4', { files: 'd.js' })));
    fx.run('round', 'demo', '1', '--', 'a.js', 'b.js', 'c.js', 'd.js');
    const lines = fx.run('next', 'demo').lines;
    assert.equal(lines.filter((l) => l.startsWith('start ')).length, 3);
    assert.ok(lines.includes('wait T4 cap'));
  });

  test('dependencies are ignored inside a round', () => {
    const fx = fixture(plan(task('T1', { files: 'a.js' }), task('T2', { files: 'b.js', deps: 'T1' })));
    begin(fx);
    for (const id of ['T1', 'T2']) {
      fx.run('start', 'demo', id);
      fx.run('done', 'demo', id);
    }
    fx.run('round', 'demo', '1', '--', 'a.js', 'b.js');
    assert.deepEqual(fx.run('next', 'demo').lines.slice(1, 3), ['start T1 backend-engineer', 'start T2 backend-engineer']);
  });

  test('refuses a wrong number, a running task, no paths, and the sixth round', () => {
    const fx = finished();
    assert.deepEqual(fx.run('round', 'demo', '2', '--', 'a/one.js'), { code: 3, lines: ['refused: round must be 1'] });
    assert.deepEqual(fx.run('round', 'demo', '1', '--'), { code: 3, lines: ['refused: nothing to send back'] });
    assert.equal(fx.run('round', 'demo', '1', '--loose', '0', '--').code, 3);
    assert.equal(fx.run('round', 'demo', '1', '--', ...Array.from({ length: 101 }, (_, i) => `f${i}.js`)).code, 3);
    for (let n = 1; n <= 5; n++) assert.equal(fx.run('round', 'demo', String(n), '--', 'a/one.js').code, 0, String(n));
    assert.equal(fx.run('round', 'demo', '6', '--', 'a/one.js').code, 3);
    const running = fixture(six());
    begin(running);
    running.run('start', 'demo', 'T1');
    assert.deepEqual(running.run('round', 'demo', '1', '--', 'a.js'), { code: 3, lines: ['refused: a task is running'] });
  });

  test('a task id in a round must be one of the round tasks', () => {
    const fx = finished();
    fx.run('round', 'demo', '1', '--', 'a/one.js');
    assert.equal(fx.run('start', 'demo', 'T2').code, 3);
    assert.equal(fx.run('lines', 'demo', 'T2').code, 3);
  });
});

describe('record reader', () => {
  const at = '2026-10-28T12:00:00Z';
  const begin0 = { v: 1, at, ev: 'begin', plan: '02-plan.md', hash: 'abcdef012345', cap: 4, mode: 'parallel', tasks: 3, ow: [] };
  const start = (task, round = 0, ow = []) => ({ v: 1, at, ev: 'start', task, round, ow });
  const done = (task, round = 0, ow = []) => ({ v: 1, at, ev: 'done', task, round, ow });
  const out = (task, extra = [], sibling = [], round = 0) => ({ v: 1, at, ev: 'out', task, round, extra, sibling });
  const round1 = (sets = { T1: ['a.js'] }, loose = 0) => ({ v: 1, at, ev: 'round', round: 1, sets, loose, ow: [] });

  function write(fx, recs) {
    fs.writeFileSync(fx.record, recs.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
  }
  const reads = (recs) => {
    const fx = fixture(null);
    write(fx, recs);
    return readParallel(fx.root, 'demo');
  };
  const bad = (recs, line, text) => {
    const fx = fixture(null);
    write(fx, recs);
    assert.throws(() => readParallel(fx.root, 'demo'), (e) => e instanceof ParallelRecordError && e.message === `parallel record demo line ${line}: ${text}`, JSON.stringify(recs).slice(0, 120));
  };

  test('no file reads as none', () => {
    const fx = fixture(null);
    assert.deepEqual(readParallel(fx.root, 'demo'), { v: 1, slug: 'demo', state: 'none' });
    assert.deepEqual(readParallel(path.join(fx.root, 'missing'), 'demo'), { v: 1, slug: 'demo', state: 'none' });
    assert.deepEqual(fx.run('read', 'demo'), { code: 0, lines: [JSON.stringify({ v: 1, slug: 'demo', state: 'none' })] });
  });

  test('rejects a bad slug', () => {
    assert.throws(() => readParallel('x', '../demo'), TypeError);
    assert.throws(() => readParallel('x', 7), TypeError);
  });

  test('builds the view', () => {
    const view = reads([begin0, start('T1'), start('T2', 0, ['T3']), out('T2', ['x.js', '?'], ['y.js']), done('T1'), start('T3'), done('T2')]);
    assert.deepEqual(view, {
      v: 1, slug: 'demo', state: 'on', plan: '02-plan.md', hash: 'abcdef012345', cap: 4, mode: 'parallel', effective_cap: 4, round: 0,
      running: ['T3'], done: { 0: ['T1', 'T2'] }, peak: 2, waits: 1, out: 3, sibling: 1
    });
  });

  test('the sequential effective cap is 1', () => {
    assert.equal(reads([{ ...begin0, mode: 'sequential' }]).effective_cap, 1);
  });

  test('bad lines name the line and the reason', () => {
    bad([start('T1')], 1, 'first line is not begin');
    bad([begin0, start('T1'), start('T1')], 3, 'task already running');
    bad([begin0, done('T1')], 2, 'task is not running');
    bad([begin0, start('T1'), round1()], 3, 'round while a task runs');
    bad([begin0, start('T1'), { ...begin0 }], 3, 'begin while a task runs');
    bad([begin0, start('T1'), done('T1'), start('T1')], 4, 'task already done in this round');
    bad([begin0, start('U1')], 2, 'U1 outside a round');
    bad([begin0, start('T1', 1)], 2, 'round does not match');
    bad([begin0, out('T1')], 2, 'task is not running');
    bad([begin0, { ...round1(), round: 2 }], 2, 'round must follow the last round');
    bad([begin0, round1({ T1: ['a.js'] }), start('T2', 1)], 3, 'task is not in the round');
    bad([begin0, { ...start('T1'), extra: 1 }], 2, 'unknown key extra');
    bad([begin0, { v: 1, at, ev: 'start', task: 'T1', ow: [] }], 2, 'missing key round');
    bad([begin0, `{"v":1,"at":"${at}","ev":"start","task":"T1","round":0,"ow":[],"__proto__":1}`], 2, 'unknown key __proto__');
    bad([begin0, start('__proto__')], 2, 'task is not a task id');
    bad([begin0, start('T1', 0, ['__proto__'])], 2, 'ow holds a bad task id');
    bad([begin0, `{"v":1,"at":"${at}","ev":"round","round":1,"sets":{"__proto__":["a.js"]},"loose":0,"ow":[]}`], 2, 'sets holds a bad task id');
    bad([begin0, round1({ T1: ['../a.js'] })], 2, 'sets holds a bad path');
    bad([begin0, round1({ T1: ['A.js'] })], 2, 'sets holds a bad path');
    bad([begin0, round1({ T1: Array.from({ length: 101 }, (_, i) => `f${i}.js`) })], 2, 'sets holds more than 100 paths');
    bad([begin0, start('T1'), out('T1', ['a'.repeat(201)])], 3, 'extra holds a bad path');
    bad([begin0, start('T1'), out('T1', [], ['?'])], 3, 'sibling holds a bad path');
    bad([begin0, start('T1'), out('T1', Array.from({ length: 101 }, (_, i) => `f${i}.js`))], 3, 'extra holds more than 100 paths');
    bad([begin0, { ...round1(), loose: 101 }], 2, 'loose must be an integer 0 to 100');
    bad([begin0, { ...round1(), loose: 1.5 }], 2, 'loose must be an integer 0 to 100');
    bad([{ ...begin0, at: '2026-10-28 12:00:00' }], 1, 'at is not a UTC time');
    bad([{ ...begin0, at: '2026-13-28T12:00:00Z' }], 1, 'at is not a UTC time');
    bad([{ ...begin0, cap: 2 }], 1, 'cap must be an integer 3 to 5');
    bad([{ ...begin0, cap: '4' }], 1, 'cap must be an integer 3 to 5');
    bad([{ ...begin0, cap: 4.5 }], 1, 'cap must be an integer 3 to 5');
    bad([{ ...begin0, mode: 'fast' }], 1, 'mode is not allowed');
    bad([{ ...begin0, hash: 'ABCDEF012345' }], 1, 'hash must be 12 lowercase hex');
    bad([{ ...begin0, plan: '../plan.md' }], 1, 'plan is not a plan name');
    bad([{ ...begin0, tasks: 101 }], 1, 'tasks must be an integer 0 to 100');
    bad([{ ...begin0, v: 2 }], 1, 'v must be 1');
    bad([{ ...begin0, ev: 'stop' }], 1, 'ev is not allowed');
    bad([{ ...begin0, ev: '__proto__' }], 1, 'ev is not allowed');
    bad([[1]], 1, 'not an object');
    bad([null], 1, 'not an object');
    bad(['{nope'], 1, 'not valid JSON');
    bad([begin0, ''], 2, 'blank line');
    bad([begin0, `${JSON.stringify(start('T1'))}\r`], 2, 'carriage return');
  });

  test('file level problems', () => {
    let fx = fixture(null);
    fs.writeFileSync(fx.record, JSON.stringify(begin0));
    assert.throws(() => readParallel(fx.root, 'demo'), /parallel record demo line 1: no line feed at the end/);
    fs.writeFileSync(fx.record, '');
    assert.throws(() => readParallel(fx.root, 'demo'), /line 0: file is empty/);
    fs.writeFileSync(fx.record, Buffer.from([0xff, 0x0a]));
    assert.throws(() => readParallel(fx.root, 'demo'), /line 0: not valid UTF-8/);
    fs.writeFileSync(fx.record, `${JSON.stringify({ ...begin0, ow: ['T1'.padEnd(9000, 'x')] })}\n`);
    assert.throws(() => readParallel(fx.root, 'demo'), /line 1: line over 8 KiB/);
    fs.writeFileSync(fx.record, `${' '.repeat(1024 * 1024)}\n`);
    assert.throws(() => readParallel(fx.root, 'demo'), /line 0: file over 1 MiB/);
    const many = [begin0];
    for (let i = 0; i < 2500; i++) {
      const id = `T${(i % 999) + 1}${String.fromCharCode(97 + Math.floor(i / 999))}`;
      many.push(start(id), done(id));
    }
    write(fx, many);
    assert.throws(() => readParallel(fx.root, 'demo'), /line 0: file over 5000 lines/);
    many.pop();
    many.pop();
    write(fx, many);
    assert.equal(readParallel(fx.root, 'demo').state, 'on');
    fx = fixture(null);
    fs.mkdirSync(fx.record);
    assert.throws(() => readParallel(fx.root, 'demo'), /line 0: record is a link or not a file/);
  });

  test('a record that is a link is refused', (t) => {
    const fx = fixture(null);
    const target = path.join(fx.dir, 'real.jsonl');
    fs.writeFileSync(target, `${JSON.stringify(begin0)}\n`);
    try {
      fs.symlinkSync(target, fx.record);
    } catch {
      t.skip('links are not allowed here');
      return;
    }
    assert.throws(() => readParallel(fx.root, 'demo'), /line 0: record is a link or not a file/);
    assert.equal(fx.run('read', 'demo').code, 1);
    assert.equal(begin(fx).code, 1);
  });

  test('a record with a second hard link is refused on read and on append', (t) => {
    const fx = fixture(six());
    begin(fx);
    try {
      fs.linkSync(fx.record, path.join(fx.dir, 'alias.jsonl'));
    } catch {
      t.skip('hard links are not allowed here');
      return;
    }
    const before = fs.readFileSync(fx.record, 'utf8');
    assert.throws(() => readParallel(fx.root, 'demo'), /line 0: record is a link or not a file/);
    assert.equal(fx.run('read', 'demo').code, 1);
    assert.equal(fx.run('start', 'demo', 'T1').code, 1);
    assert.equal(fs.readFileSync(fx.record, 'utf8'), before);
  });

  test('a plan with a second hard link is refused as unreadable', (t) => {
    const fx = fixture(six());
    try {
      fs.linkSync(fx.plan, path.join(fx.dir, 'alias.md'));
    } catch {
      t.skip('hard links are not allowed here');
      return;
    }
    assert.deepEqual(fx.run('check', 'demo', fx.name, '--cap', '4', '--mode', 'parallel'), { code: 1, lines: ['plan-tasks: error plan-unreadable'] });
    assert.equal(begin(fx).code, 1);
  });

  test('a run folder that is a link is refused', (t) => {
    const fx = fixture(null);
    const real = path.join(fx.root, '.company', 'work', 'real');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'parallel.jsonl'), `${JSON.stringify(begin0)}\n`);
    try {
      fs.symlinkSync(real, path.join(fx.root, '.company', 'work', 'linked'), 'junction');
    } catch {
      t.skip('links are not allowed here');
      return;
    }
    assert.throws(() => readParallel(fx.root, 'linked'), /run folder is a link or not a folder/);
  });

  test('a broken record gives exit 1 and nothing is appended', () => {
    const fx = fixture(six());
    begin(fx);
    const good = fs.readFileSync(fx.record, 'utf8');
    fs.appendFileSync(fx.record, '{nope\n');
    const damaged = fs.readFileSync(fx.record, 'utf8');
    for (const args of [['next', 'demo'], ['start', 'demo', 'T1'], ['done', 'demo', 'T1'], ['read', 'demo'], ['lines', 'demo', 'T1'], ['scope', 'demo', 'T1', '--'], ['round', 'demo', '1', '--', 'a.js'], ['begin', 'demo', fx.name, '--cap', '4', '--mode', 'parallel']]) {
      assert.deepEqual(fx.run(...args), { code: 1, lines: ['parallel record demo line 2: not valid JSON'] }, args[0]);
    }
    assert.equal(fs.readFileSync(fx.record, 'utf8'), damaged);
    assert.ok(damaged.startsWith(good));
  });

  test('read prints the view', () => {
    const fx = fixture(six());
    begin(fx);
    const r = fx.run('read', 'demo');
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.lines[0]), readParallel(fx.root, 'demo'));
  });

  test('the script runs as a program', async () => {
    const { spawnSync } = await import('node:child_process');
    const fx = fixture(six());
    const script = path.join(import.meta.dirname, 'plan-tasks.mjs');
    const res = spawnSync(process.execPath, [script, 'check', 'demo', fx.name, '--cap', '4', '--mode', 'parallel'], { cwd: fx.root, encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^plan-tasks: 6 tasks, 6 marked, 0 alone, cap 4 \(parallel\)\n/);
    const refused = spawnSync(process.execPath, [script, 'start', 'demo', 'T1\nstart T9'], { cwd: fx.root, encoding: 'utf8' });
    assert.equal(refused.status, 3);
    assert.equal(refused.stdout, 'refused: argument holds a control character\n');
  });
});
