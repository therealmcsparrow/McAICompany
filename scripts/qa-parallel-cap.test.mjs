import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main as planTasks } from './plan-tasks.mjs';
import { main as ledger, validateRecord } from './ledger.mjs';
import { main as planCheckVerdict } from './plan-check-verdict.mjs';
import { validateLayer } from './settings.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const settingsScript = path.join(import.meta.dirname, 'settings.mjs');
const NOW = Date.parse('2026-10-28T12:00:00Z');
const DAY = 86400000;
const SLUG = 'demo';
const PLAN = '02-plan.md';

// ---------- helpers ----------

function tmp(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const task = (id, o = {}) => {
  const lines = [`### ${id} title of ${id}`];
  if (o.role !== null) lines.push(`- role: ${o.role ?? 'backend-engineer'}`);
  if (o.files !== null) lines.push(`- files: ${o.files ?? `${id.toLowerCase()}/file.js`}`);
  if (o.deps !== null) lines.push(`- depends-on: ${o.deps ?? 'none'}`);
  if (o.parallel !== null) lines.push(`- parallel: ${o.parallel ?? 'yes'}`);
  return `${lines.join('\n')}\n`;
};
const plan = (...tasks) => `${['# Plan', '', '## Tasks', '', ...tasks].join('\n')}\n`;
const ids = (n) => Array.from({ length: n }, (_, i) => `T${i + 1}`);
const sixTasks = () => plan(...ids(6).map((id) => task(id)));

// A product root with a plan. Every call goes through the public main() of plan-tasks.
function fixture(t, planText, { slug = SLUG } = {}) {
  const root = tmp(t, 'qa-parcap');
  const dir = path.join(root, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  if (planText !== null) fs.writeFileSync(path.join(dir, PLAN), planText);
  const run = (...args) => planTasks(args, { now: NOW, root });
  const begin = (cap = 4, mode = 'parallel') => run('begin', slug, PLAN, '--cap', String(cap), '--mode', mode);
  const check = (cap = 4, mode = 'parallel') => run('check', slug, PLAN, '--cap', String(cap), '--mode', mode);
  const next = () => run('next', slug);
  const starts = () => next().lines.filter((l) => l.startsWith('start ')).map((l) => l.split(' ')[1]);
  const waits = () => Object.fromEntries(next().lines.filter((l) => l.startsWith('wait ')).map((l) => {
    const [, id, reason, on] = l.split(' ');
    return [id, on ? `${reason} ${on}` : reason];
  }));
  const start = (id) => run('start', slug, id);
  const done = (id) => run('done', slug, id);
  const view = () => JSON.parse(run('read', slug).lines.join('\n'));
  const recordFile = path.join(dir, 'parallel.jsonl');
  return { root, dir, run, begin, check, next, starts, waits, start, done, view, recordFile, slug };
}

function startAll(fx) {
  for (const id of fx.starts()) assert.equal(fx.start(id).code, 0, `start ${id}`);
}

// ---------- the setting ----------

function settingsFx(t) {
  const base = tmp(t, 'qa-parcap-settings');
  const home = path.join(base, 'home');
  const cwd = path.join(base, 'repo');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(cwd, '.company'), { recursive: true });
  const get = (...args) => {
    const r = spawnSync(process.execPath, [settingsScript, 'get', ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home, HOME: home, USERPROFILE: home }
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const user = (pipeline) => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ aico_settings: { version: 1, pipeline } }));
  const project = (pipeline) => fs.writeFileSync(path.join(cwd, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, pipeline } }));
  return { get, user, project, home };
}

test('AC1 parallel_cap resolves to 4 by default, bare and inside the pipeline object', (t) => {
  const s = settingsFx(t);
  assert.equal(s.get('pipeline.parallel_cap').out.trim(), '4');
  const all = JSON.parse(s.get().out);
  assert.equal(all.pipeline.parallel_cap, 4);
  assert.equal(all.pipeline.dispatch, 'parallel');
  assert.deepEqual(all.warnings, []);
});

test('AC1 hostile stored values fall back to 4 with one warning that does not echo the value', (t) => {
  const hostile = [2, 6, 0, -4, 4.5, '4', '__proto__', null, true, [4], { a: 1 }, 1e9, 'x'.repeat(10000), '5\n', '$(id)'];
  for (const value of hostile) {
    const s = settingsFx(t);
    s.user({ parallel_cap: value });
    const r = s.get('pipeline.parallel_cap');
    assert.equal(r.code, 0, JSON.stringify(value).slice(0, 30));
    assert.equal(r.out.trim(), '4', JSON.stringify(value).slice(0, 30));
    const warnings = r.err.split('\n').filter((l) => l.startsWith('warning:'));
    assert.equal(warnings.length, 1, JSON.stringify(value).slice(0, 30));
    assert.ok(warnings[0].length < 300);
    if (typeof value === 'string' && value.length > 8) assert.ok(!warnings[0].includes(value.slice(0, 8)));
  }
});

test('AC1 each whole number from 3 to 5 is kept, and project beats user', (t) => {
  for (const n of [3, 4, 5]) {
    const s = settingsFx(t);
    s.user({ parallel_cap: n });
    const r = s.get('pipeline.parallel_cap');
    assert.equal(r.out.trim(), String(n));
    assert.equal(r.err, '');
  }
  const s = settingsFx(t);
  s.user({ parallel_cap: 3 });
  s.project({ parallel_cap: 5 });
  assert.equal(s.get('pipeline.parallel_cap').out.trim(), '5');
});

test('AC1 a refused layer names the setting and the range', () => {
  for (const bad of [2, 6, 4.5, '4', null, '__proto__']) {
    const reasons = validateLayer({ version: 1, pipeline: { parallel_cap: bad } }, new Set(['qa']));
    assert.equal(reasons.length, 1, String(bad));
    assert.match(reasons[0], /pipeline\.parallel_cap must be a whole number from 3 to 5/);
  }
  assert.deepEqual(validateLayer({ version: 1, pipeline: { parallel_cap: 3 } }, new Set(['qa'])), []);
});

test('AC1 the settings page row is labelled, described and reachable by keyboard', () => {
  const html = read('scripts/settings-page.html');
  const body = html.slice(html.indexOf('function parallelCapRow'), html.indexOf('function planLink'));
  assert.match(body, /el\('label', \{ for: id \}/);
  assert.match(body, /'aria-describedby', 'parallel-cap-hint'/);
  assert.match(body, /selectFor\(\[3, 4, 5\], null\)/);
  assert.ok(!/tabindex/i.test(body), 'native controls only');
  const contract = read('docs/contracts/aico-settings.md');
  const hint = html.match(/const PARALLEL_CAP_HINT = '([^']+)'/)[1];
  assert.ok(contract.includes(hint), 'the hint is the Contract text');
  assert.match(html, /id: 'parallel-cap-hint'/);
  const dispatch = html.indexOf("selectFor(['parallel', 'sequential']");
  assert.ok(dispatch > 0 && html.indexOf('parallelCapRow(tbody, defaults.parallel_cap)') > dispatch, 'the row follows Dispatch');
});

// ---------- sequential ----------

test('AC2 a mode other than the two words is refused and nothing is written', (t) => {
  for (const mode of ['Sequential', 'sequential ', 'sequential\n', 'seq', '', '__proto__', 'parallel;sequential']) {
    const fx = fixture(t, sixTasks());
    const r = fx.begin(4, mode);
    assert.equal(r.code, 3, JSON.stringify(mode));
    assert.ok(!fs.existsSync(fx.recordFile), JSON.stringify(mode));
  }
});

test('AC2 sequential mode starts one task at a time whatever the cap is', (t) => {
  for (const cap of [3, 4, 5]) {
    const fx = fixture(t, sixTasks());
    assert.equal(fx.begin(cap, 'sequential').code, 0);
    for (const id of ids(6)) {
      assert.deepEqual(fx.starts(), [id], `cap ${cap}`);
      assert.equal(fx.start(id).code, 0);
      assert.equal(fx.view().running.length, 1);
      assert.equal(fx.start(ids(6).find((x) => x > id) ?? 'T9').code, 3);
      assert.equal(fx.done(id).code, 0);
    }
    assert.equal(fx.view().effective_cap, 1);
    assert.equal(fx.view().peak, 1);
  }
});

test('AC2 the check block and the pipeline text name the cap as ignored in sequential mode', (t) => {
  const fx = fixture(t, sixTasks());
  const block = fx.check(5, 'sequential').lines;
  assert.equal(block[0], 'plan-tasks: 6 tasks, 6 marked, 0 alone, cap 5 (sequential)');
  assert.deepEqual(block.filter((l) => l.startsWith('wave 1')), ['wave 1: T1']);
  assert.match(read('skills/pipeline/SKILL.md'), /`pipeline\.dispatch` `sequential` → 1/);
  assert.match(read('skills/pipeline/references/parallel.md'), /`<mode>` = `sequential` when `pipeline\.dispatch` is `sequential`/);
});

// ---------- eligible ----------

test('AC3 a marked task with a valid file list starts, and one with an open dependency waits', (t) => {
  const fx = fixture(t, plan(task('T1'), task('T2', { deps: 'T1' }), task('T3', { deps: 'T1, T2' })));
  assert.equal(fx.begin().code, 0);
  assert.deepEqual(fx.starts(), ['T1']);
  assert.deepEqual(fx.waits(), { T2: 'depends T1', T3: 'depends T1' });
  fx.start('T1');
  assert.deepEqual(fx.starts(), [], 'T2 needs T1 committed and done, not just running');
  fx.done('T1');
  assert.deepEqual(fx.starts(), ['T2']);
  fx.start('T2');
  fx.done('T2');
  assert.deepEqual(fx.starts(), ['T3']);
});

test('AC3 an unknown or hostile dependency never makes a task eligible and is not echoed as text', (t) => {
  const hostile = ['T99', '__proto__', '**T1**', '[T1](x.md)', 'T1 and then some', 'T1;rm -rf /', '`T1`x'];
  for (const dep of hostile) {
    const fx = fixture(t, plan(task('T1'), task('T2', { deps: dep })));
    const block = fx.check().lines.join('\n');
    assert.match(block, /warning T2: runs alone: .*depends-on/, dep);
    assert.ok(!block.includes('rm -rf') && !block.includes('(x.md)') && !block.includes('__proto__'), dep);
    assert.equal(fx.check().code, 0);
  }
});

test('AC3 a dependency on a later task is normal: T1 depends-on T3 starts only after T3 is done, no warning', (t) => {
  const fx = fixture(t, plan(task('T1', { deps: 'T3' }), task('T2'), task('T3')));
  const checked = fx.check();
  assert.equal(checked.code, 0);
  assert.deepEqual(checked.lines.filter((l) => l.startsWith('warning ')), []);
  fx.begin();
  assert.ok(!fx.starts().includes('T1'), 'T1 waits for T3');
  assert.equal(fx.waits().T1, 'depends T3');
  assert.equal(fx.run('start', SLUG, 'T1').code, 3);
  startAll(fx);
  assert.deepEqual(fx.view().running.sort(), ['T2', 'T3']);
  assert.ok(!fx.starts().includes('T1'), 'T3 running is not enough');
  fx.done('T3');
  assert.deepEqual(fx.starts(), ['T1']);
  assert.equal(fx.start('T1').code, 0);
  fx.done('T1');
  fx.done('T2');
  assert.deepEqual(fx.view().running, []);
});

test('AC4 a real cycle falls back to alone: one warning per cyclic task, and the plan still runs to the end', (t) => {
  const fx = fixture(t, plan(task('T1'), task('T2', { deps: 'T3' }), task('T3', { deps: 'T2' }), task('T4')));
  const checked = fx.check();
  assert.equal(checked.code, 0);
  const warned = checked.lines.filter((l) => l.startsWith('warning ')).map((l) => l.split(':')[0]);
  assert.ok(warned.includes('warning T2') || warned.includes('warning T3'), checked.lines.join('\n'));
  assert.ok(checked.lines.some((l) => /^warning T[23]: runs alone: .*depends-on/.test(l)));
  fx.begin();
  const finished = [];
  for (let guard = 0; guard < 12 && finished.length < 4; guard += 1) {
    const now = fx.starts();
    for (const id of now) {
      if (id === 'T2' || id === 'T3') {
        assert.deepEqual(now, [id], `${id} starts alone`);
        assert.deepEqual(fx.view().running, [], `${id} starts with nothing running`);
      }
      assert.equal(fx.start(id).code, 0);
    }
    const first = fx.view().running[0];
    assert.ok(first, 'a cycle must not hang the plan');
    assert.equal(fx.done(first).code, 0);
    finished.push(first);
  }
  assert.deepEqual([...finished].sort(), ['T1', 'T2', 'T3', 'T4']);
});

test('AC6 a trailing dot on a segment is no way round the rules: refused, or it overlaps the plain path', (t) => {
  const refused = fixture(t, plan(task('T1', { files: 'a/one.js' }), task('T2', { files: '.git./hooks/x' }), task('T3', { files: 'c/three.js' })));
  const r = refused.check();
  assert.equal(r.code, 0);
  assert.ok(r.lines.some((l) => /^warning T2: runs alone: /.test(l)), r.lines.join('\n'));
  refused.begin();
  for (let guard = 0; guard < 6 && refused.view().done['0']?.length !== 3; guard += 1) {
    const now = refused.starts();
    if (now.includes('T2')) assert.deepEqual(now, ['T2']);
    for (const id of now) refused.start(id);
    for (const id of refused.view().running) refused.done(id);
  }
  const alias = fixture(t, plan(task('T1', { files: 'scripts/x.mjs' }), task('T2', { files: 'Scripts./X.MJS' }), task('T3', { files: 'free/c.js' })));
  alias.begin();
  assert.ok(!alias.starts().includes('T2') || !alias.starts().includes('T1'), 'T1 and T2 never start together');
  const why = alias.waits().T2;
  assert.ok(why === 'overlap T1' || /^alone/.test(why ?? ''), `T2 waits: ${why}`);
  assert.equal(alias.run('start', SLUG, 'T2').code, 3);
  alias.start('T1');
  assert.ok(!alias.starts().includes('T2'), 'running is not enough');
  alias.done('T1');
  assert.ok(alias.starts().includes('T2') || Object.keys(alias.waits()).includes('T2'));
});

// ---------- runs alone ----------

const ALONE_CASES = [
  ['no parallel mark', { parallel: null }],
  ['parallel: no', { parallel: 'no' }],
  ['parallel with text', { parallel: 'yes please' }],
  ['parallel as a float', { parallel: '1.5' }],
  ['parallel in capitals', { parallel: 'YES' }],
  ['files missing', { files: null }],
  ['files empty', { files: '' }],
  ['files with ..', { files: 'a/../b.js' }],
  ['files with a leading ..', { files: '../etc/passwd' }],
  ['files with a drive path', { files: 'C:/x/a.js' }],
  ['files with a leading slash', { files: '/etc/passwd' }],
  ['files with a backslash drive path', { files: 'C:\\x\\a.js' }],
  ['files with .git', { files: '.git/config' }],
  ['files with .env', { files: '.env' }],
  ['files with .env.local', { files: 'src/.env.local' }],
  ['files with a glob', { files: 'src/*.js' }],
  ['files with a brace glob', { files: 'src/{a,b}.js' }],
  ['files with a 201-character path', { files: 'a'.repeat(201) }],
  ['files with a quote', { files: 'a".js' }],
  ['files with a dollar sign', { files: '$HOME/a.js' }],
  ['files with a space', { files: 'a b.js' }],
  ['files with 41 items', { files: Array.from({ length: 41 }, (_, i) => `f${i}.js`).join(', ') }],
  ['unknown role', { role: 'not-a-role' }],
  ['missing role', { role: null }],
  ['unknown dependency', { deps: 'T77' }],
  ['dependency on itself', { deps: 'T2' }],
  ['trailing dot in a directory name', { files: '.git./hooks/x' }],
  ['trailing dot in a directory name, capitals', { files: 'Scripts./X.MJS' }]
];

for (const [label, over] of ALONE_CASES) {
  test(`AC4 ${label}: one warning line, exit 0, and the task runs with nothing else running`, (t) => {
    const fx = fixture(t, plan(task('T1', { files: 'a/one.js' }), task('T2', { files: 'b/two.js', ...over }), task('T3', { files: 'c/three.js' })));
    const checked = fx.check();
    assert.equal(checked.code, 0, 'the Plan Gate is never blocked');
    const warnings = checked.lines.filter((l) => l.startsWith('warning '));
    assert.equal(warnings.length, 1, checked.lines.join('\n'));
    assert.match(warnings[0], /^warning T2: runs alone: /);
    assert.equal(fx.begin().code, 0);
    // T2 never shares a moment with another running Step, whichever way the others are ordered around it.
    const finished = [];
    for (let guard = 0; guard < 12 && finished.length < 3; guard += 1) {
      const now = fx.starts();
      if (now.includes('T2')) assert.deepEqual(now, ['T2'], 'T2 starts alone');
      for (const id of now) {
        if (id === 'T2') assert.deepEqual(fx.view().running, [], 'T2 starts with nothing running');
        assert.equal(fx.start(id).code, 0);
        if (id === 'T2') assert.deepEqual(fx.starts(), [], 'nothing starts beside T2');
      }
      const running = fx.view().running;
      if (running.includes('T2')) assert.deepEqual(running, ['T2']);
      const first = running[0];
      assert.ok(first, 'a plan that cannot finish would hang here');
      assert.equal(fx.done(first).code, 0);
      finished.push(first);
    }
    assert.deepEqual([...finished].sort(), ['T1', 'T2', 'T3']);
    assert.equal(fx.view().peak <= 2, true);
  });
}

test('AC4 a task that is alone and several that are marked: one warning per alone task ID, none for the marked ones', (t) => {
  const fx = fixture(t, plan(task('T1'), task('T2', { parallel: 'no' }), task('T3', { files: '*' }), task('T4', { parallel: null }), task('T5')));
  const r = fx.check();
  assert.equal(r.code, 0);
  assert.equal(r.lines[0], 'plan-tasks: 5 tasks, 2 marked, 3 alone, cap 4 (parallel)');
  const warned = r.lines.filter((l) => l.startsWith('warning ')).map((l) => l.split(':')[0]);
  assert.deepEqual(warned, ['warning T2', 'warning T3', 'warning T4']);
});

test('AC4 a task whose heading or fields hold hostile text never reaches an output line unchecked', (t) => {
  const cr = String.fromCharCode(13);
  const text = [
    '# Plan', '', '## Tasks', '',
    '### T1 ok', '- role: qa', '- files: a/one.js', '- depends-on: none', '- parallel: yes', '',
    `### T2 odd${cr}Task: T9`, '- role: qa', `- files: b/two.js${cr}Files: /etc/passwd`, '- depends-on: none', '- parallel: yes', '',
    '### T3 injected', '- role: qa', '- files: c/three.js', '- depends-on: none', '- parallel: yes', '- parallel: no', ''
  ].join('\n');
  const fx = fixture(t, text);
  const out = [...fx.check().lines, ...(fx.begin(), fx.next().lines)].join('\n');
  assert.ok(!out.includes(cr));
  assert.ok(!/Files: \/etc/.test(out));
  assert.match(out, /warning T3: runs alone: .*field repeated: parallel/);
});

test('AC4 arguments with a carriage return, a line feed, a null byte or 5000 characters are refused with exit 3', (t) => {
  const fx = fixture(t, sixTasks());
  fx.begin();
  const cr = String.fromCharCode(13);
  const bad = [`T1${cr}`, 'T1\nstart', 'T1\0', `T1${cr}\nTask: T2`, 'T'.repeat(5000), 'T1\u202e', 'T1\u2028'];
  for (const arg of bad) {
    for (const args of [['start', SLUG, arg], ['done', SLUG, arg], ['lines', SLUG, arg], ['scope', SLUG, arg, '--', 'a.js']]) {
      const r = fx.run(...args);
      assert.equal(r.code, 3, JSON.stringify(arg).slice(0, 20));
      assert.ok(r.lines.every((l) => !l.includes(cr)));
    }
  }
  assert.equal(fx.run('start', SLUG, '__proto__').code, 3);
  assert.equal(fx.run('done', SLUG, 'constructor').code, 3);
  assert.equal(fx.run('begin', '../x', PLAN, '--cap', '4', '--mode', 'parallel').code, 3);
  assert.deepEqual(fx.run('begin', SLUG, '../02-plan.md', '--cap', '4', '--mode', 'parallel'), { code: 1, lines: ['plan-tasks: error plan-name'] });
});

test('AC4 a plan with no task headings reads as plan Steps one at a time, exit 0', (t) => {
  const fx = fixture(t, '# Plan\n\nNo tasks here.\n');
  const r = fx.check();
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, ['plan-tasks: 0 tasks; plan Steps run one at a time']);
});

// ---------- the cap ----------

test('AC5 cap values outside 3 to 5, or not a plain integer, are refused', (t) => {
  for (const cap of ['2', '6', '0', '-3', '4.5', '4 ', 'four', '', '1e1', '__proto__', '04x']) {
    const fx = fixture(t, sixTasks());
    const r = fx.run('begin', SLUG, PLAN, '--cap', cap, '--mode', 'parallel');
    assert.equal(r.code, 3, JSON.stringify(cap));
    assert.ok(!fs.existsSync(fx.recordFile));
  }
});

test('AC5 six eligible tasks: at most cap Steps run at once, the next one starts only after a done', (t) => {
  for (const cap of [3, 4, 5]) {
    const fx = fixture(t, sixTasks());
    assert.equal(fx.begin(cap).code, 0);
    assert.deepEqual(fx.starts(), ids(6).slice(0, cap), `cap ${cap}`);
    startAll(fx);
    assert.equal(fx.view().running.length, cap);
    assert.equal(fx.run('start', SLUG, `T${cap + 1}`).code, 3, 'a start beyond the cap is refused');
    assert.equal(fx.view().running.length, cap);
    assert.equal(fx.waits()[`T${cap + 1}`], 'cap');
    assert.deepEqual(fx.starts(), []);
    assert.equal(fx.done('T1').code, 0);
    assert.deepEqual(fx.starts(), [`T${cap + 1}`]);
    startAll(fx);
    assert.equal(fx.view().peak, cap);
    assert.equal(fx.view().running.length, cap);
  }
});

test('AC5 a Step is not freed by the Lead guessing: start refuses an id that is not a start line', (t) => {
  const fx = fixture(t, sixTasks());
  fx.begin(3);
  assert.equal(fx.run('start', SLUG, 'T5').code, 3);
  assert.equal(fx.run('start', SLUG, 'T99').code, 3);
  assert.equal(fx.run('done', SLUG, 'T1').code, 3, 'done needs a running task');
  assert.deepEqual(fx.view().running, []);
  assert.match(read('skills/pipeline/references/parallel.md'), /A new plan Step starts only after a running one is linted, ledgered, committed and done\./);
});

test('AC5 other pipeline Steps are capped by the same number, read-only fan-outs are not', () => {
  const text = read('skills/pipeline/references/parallel.md');
  assert.match(text, /\*\*Other Steps\*\*[^\n]*at most `<cap>` at once \(1 when sequential\)/);
  assert.match(text, /Read-only fan-outs \(brainstorm, research, cooler, usability-test Personas\) are not capped/);
  assert.match(read('skills/pipeline/SKILL.md'), /\*\*Parallel, capped\.\*\* At most `<cap>` Steps/);
});

// ---------- overlap ----------

const OVERLAPS = [
  ['case only', 'src/App.js', 'SRC/app.JS'],
  ['backslash against slash', 'src/lib/a.js', 'src\\lib\\a.js'],
  ['directory contains a file', 'src/', 'src/lib/a.js'],
  ['directory without the trailing slash', 'src', 'src/lib/a.js'],
  ['file inside a directory listed second', 'src/lib/a.js', 'src/'],
  ['directory contains a directory', 'src/', 'SRC\\lib\\'],
  ['the same file among several', 'x/one.js, src/a.js', 'y/two.js, Src/A.js']
];

for (const [label, first, second] of OVERLAPS) {
  test(`AC6 ${label}: the later task waits until the earlier one is done`, (t) => {
    const fx = fixture(t, plan(task('T1', { files: first }), task('T2', { files: second }), task('T3', { files: 'free/c.js' })));
    fx.begin();
    assert.deepEqual(fx.starts(), ['T1', 'T3']);
    assert.equal(fx.waits().T2, 'overlap T1');
    assert.equal(fx.run('start', SLUG, 'T2').code, 3);
    fx.start('T1');
    assert.equal(fx.waits().T2, 'overlap T1', 'running is not enough');
    fx.done('T1');
    assert.deepEqual(fx.starts(), ['T2', 'T3']);
  });
}

test('AC6 neighbours that only share a name prefix do not overlap', (t) => {
  const fx = fixture(t, plan(task('T1', { files: 'src/a' }), task('T2', { files: 'src/ab.js' }), task('T3', { files: 'src2/' }), task('T4', { files: 'SRC/AB.JS' })));
  fx.begin();
  assert.deepEqual(fx.starts(), ['T1', 'T2', 'T3']);
  assert.equal(fx.waits().T4, 'overlap T2');
});

test('AC6 a task that waits for a dependency still blocks a later overlapping task', (t) => {
  const fx = fixture(t, plan(task('T1', { files: 'a/x.js' }), task('T2', { files: 'shared/s.js', deps: 'T1' }), task('T3', { files: 'shared/' })));
  fx.begin();
  assert.deepEqual(fx.starts(), ['T1']);
  assert.deepEqual(fx.starts(), ['T1']);
  assert.deepEqual(fx.waits(), { T2: 'depends T1', T3: 'overlap T2' });
});

test('AC6 a task whose file list is invalid overlaps every later task, and a prototype name is only text', (t) => {
  const fx = fixture(t, plan(task('T1', { files: '__proto__/x.js' }), task('T2', { files: '../x' }), task('T3', { files: 'z/z.js' })));
  fx.begin();
  assert.deepEqual(fx.starts(), ['T1']);
  assert.deepEqual(fx.waits(), { T2: 'overlap T1', T3: 'overlap T2' });
});

// ---------- deterministic ----------

test('AC7 the same plan and the same committed set give byte-identical output, in separate folders', (t) => {
  const text = plan(task('T1', { files: 'a/' }), task('T2', { files: 'A/x.js' }), task('T3', { deps: 'T1' }), task('T4', { parallel: 'no' }), task('T5'), task('T6'), task('T7'));
  const outputs = [];
  for (let i = 0; i < 3; i += 1) {
    const fx = fixture(t, text);
    fx.begin(4);
    const first = fx.next().lines.join('\n');
    startAll(fx);
    fx.done('T1');
    outputs.push(`${first}\n--\n${fx.next().lines.join('\n')}\n--\n${fx.check().lines.join('\n')}`);
  }
  assert.equal(outputs[1], outputs[0]);
  assert.equal(outputs[2], outputs[0]);
  const fx = fixture(t, text);
  fx.begin(4);
  const once = fx.next().lines.join('\n');
  for (let i = 0; i < 3; i += 1) assert.equal(fx.next().lines.join('\n'), once);
});

test('AC7 the choice reads plan text only: prose, Role names and field order do not change it', (t) => {
  const a = fixture(t, plan(task('T1'), task('T2'), task('T3')));
  const reordered = [
    '# Plan', '', 'Some other prose about the tasks.', '', '## Tasks', '',
    '### T1 title', '- parallel: yes', '- depends-on: none', '- files: t1/file.js', '- role: qa', '',
    '### T2 title', '- parallel: yes', '- depends-on: none', '- files: t2/file.js', '- role: writer', '',
    '### T3 title', 'Prose that says T3 must wait for everything.', '- parallel: yes', '- depends-on: none', '- files: t3/file.js', '- role: backend-engineer', ''
  ].join('\n');
  const b = fixture(t, reordered);
  a.begin();
  b.begin();
  assert.deepEqual(a.starts(), b.starts());
  assert.deepEqual(a.waits(), b.waits());
});

test('AC7 a plan edited after begin is refused by next, start and lines', (t) => {
  const fx = fixture(t, sixTasks());
  fx.begin();
  fx.start('T1');
  fs.appendFileSync(path.join(fx.dir, PLAN), '\nA late edit.\n');
  for (const r of [fx.next(), fx.start('T2'), fx.run('lines', SLUG, 'T1')]) {
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: plan changed since begin/);
  }
  assert.equal(fx.done('T1').code, 0, 'a running task can still finish');
});

// ---------- the Plan Gate block ----------

test('AC8 the block shows the waves and why a task waits: overlap, dependency, unmarked', (t) => {
  const fx = fixture(t, plan(
    task('T1', { files: 'a/x.js' }),
    task('T2', { files: 'A/X.js' }),
    task('T3', { files: 'c/c.js', deps: 'T1' }),
    task('T4', { files: 'd/d.js', parallel: null }),
    task('T5', { files: 'e/e.js' })
  ));
  const r = fx.check(4);
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, [
    'plan-tasks: 5 tasks, 4 marked, 1 alone, cap 4 (parallel)',
    'wave 1: T1',
    'wave 2: T2 overlap T1, T3 depends T1',
    'wave 3: T4 alone T2',
    'wave 4: T5 barrier T4',
    'warning T4: runs alone: no parallel mark'
  ]);
  assert.ok(!fs.existsSync(fx.recordFile), 'check writes nothing');
});

test('AC8 a lower cap than eligible tasks shows the cap as the reason', (t) => {
  const fx = fixture(t, sixTasks());
  assert.deepEqual(fx.check(3).lines, [
    'plan-tasks: 6 tasks, 6 marked, 0 alone, cap 3 (parallel)',
    'wave 1: T1, T2, T3',
    'wave 2: T4 cap, T5 cap, T6 cap'
  ]);
  assert.deepEqual(fx.check(5).lines.slice(1), ['wave 1: T1, T2, T3, T4, T5', 'wave 2: T6 cap']);
});

test('AC8 the pipeline text puts the block under the Plan Gate summary and says it never blocks', () => {
  const text = read('skills/pipeline/references/parallel.md');
  assert.match(text, /\*\*Plan Gate\.\*\* Before the form run `check/);
  assert.match(text, /paste stdout unchanged, inside a code fence, as a \*\*Parallel plan\*\* block under the summary/);
  assert.match(text, /Warnings never block\./);
  assert.match(read('skills/pipeline/SKILL.md'), /Plan Gate\*\* also shows the Parallel plan block/);
});

// ---------- dispatch text and shared-tree rules ----------

test('AC9 lines prints exactly the Task and Files lines, with the plan written form and the slash style', (t) => {
  const fx = fixture(t, plan(task('T1', { files: 'Src\\Lib\\A.js, docs/' }), task('T2', { files: 'z/z.js' })));
  fx.begin();
  const r = fx.run('lines', SLUG, 'T1');
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, ['Task: T1', 'Files: Src/Lib/A.js, docs/']);
  assert.equal(fx.run('lines', SLUG, 'T99').code, 3);
  assert.equal(fx.run('lines', SLUG, '__proto__').code, 3);
  assert.equal(fx.run('lines', SLUG).code, 3);
});

test('AC9 the handoff rule forbids stash, killing by image name and full test runs', () => {
  const text = read('skills/handoff/SKILL.md');
  const rule = text.slice(text.indexOf('**Task: and Files:**'));
  assert.match(rule, /Never `git stash`/);
  assert.match(rule, /`taskkill \/IM`/);
  assert.match(rule, /`pkill`/);
  assert.match(rule, /stop only PIDs you started/);
  assert.match(rule, /Run only the test files for your paths; the Lead runs the full suite once/);
  assert.match(rule, /Change only the paths in `Files:`/);
});

test('AC9 the dispatch Contract and the pipeline block carry Task and Files after the rule slice', () => {
  const contract = read('docs/contracts/dispatch-prompt.md');
  assert.match(contract, /Lines added in v3\.5/);
  assert.match(contract, /`Task: <id>`/);
  assert.match(contract, /`Files: <path>/);
  const pipeline = read('skills/pipeline/SKILL.md');
  const slice = pipeline.indexOf('Rule slice:');
  const taskAt = pipeline.indexOf('Task: <id>');
  const filesAt = pipeline.indexOf('Files: <paths | none>');
  assert.ok(slice > 0 && taskAt > slice && filesAt > taskAt);
  assert.match(read('skills/pipeline/references/parallel.md'), /put its two lines into the dispatch as `Task:` and `Files:`/);
});

// ---------- out-of-list paths ----------

test('AC10 scope sorts paths into in, extra and sibling, and a sibling-owned path is not committed', (t) => {
  const fx = fixture(t, plan(task('T1', { files: 'src/a.js' }), task('T2', { files: 'src/b.js' }), task('T3', { files: 'lib/c.js' })));
  fx.begin();
  startAll(fx);
  fx.done('T3');
  const r = fx.run('scope', SLUG, 'T1', '--', 'src/a.js', 'SRC\\B.js', 'docs/new.md', '.company/work/demo/01-x.md', 'lib/c.js');
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, [
    'in src/a.js',
    'sibling T2 SRC/B.js',
    'extra docs/new.md',
    'in .company/work/demo/01-x.md',
    'extra lib/c.js',
    'scope: 2 extra, 1 sibling'
  ]);
  const v = fx.view();
  assert.equal(v.out, 3);
  assert.equal(v.sibling, 1);
});

test('AC10 hostile commit candidates are never echoed', (t) => {
  const fx = fixture(t, plan(task('T1', { files: 'src/a.js' }), task('T2', { files: 'src/b.js' })));
  fx.begin();
  startAll(fx);
  const hostile = ['../outside.js', 'C:/x/y.js', '/etc/passwd', '.git/config', '.env', 'src/*.js', 'a'.repeat(201), 'a"b', '$HOME/x', '__proto__', 'a b'];
  const r = fx.run('scope', SLUG, 'T1', '--', ...hostile);
  assert.equal(r.code, 0);
  const text = r.lines.join('\n');
  for (const bad of ['outside', 'C:/x', 'passwd', '.git/config', '.env', '*', 'aaaa', '"', '$HOME', 'a b']) assert.ok(!text.includes(bad), bad);
  assert.ok(r.lines.filter((l) => l === 'extra ?').length >= hostile.length - 1);
  const ev = fs.readFileSync(fx.recordFile, 'utf8');
  assert.ok(!ev.includes('passwd') && !ev.includes('$HOME') && !ev.includes('outside'));
});

test('AC10 a path with a carriage return or line feed is refused and the record is unchanged', (t) => {
  const fx = fixture(t, plan(task('T1', { files: 'src/a.js' }), task('T2', { files: 'src/b.js' })));
  fx.begin();
  startAll(fx);
  const before = fs.readFileSync(fx.recordFile, 'utf8');
  const cr = String.fromCharCode(13);
  for (const p of [`a.js${cr}`, 'a.js\nin src/b.js', `x${cr}\nsibling T9 y`]) {
    const r = fx.run('scope', SLUG, 'T1', '--', p);
    assert.equal(r.code, 3);
  }
  assert.equal(fs.readFileSync(fx.recordFile, 'utf8'), before);
});

test('AC10 scope is refused for a task that is not running', (t) => {
  const fx = fixture(t, plan(task('T1'), task('T2')));
  fx.begin();
  assert.equal(fx.run('scope', SLUG, 'T1', '--', 'a.js').code, 3);
  fx.start('T1');
  fx.done('T1');
  assert.equal(fx.run('scope', SLUG, 'T1', '--', 'a.js').code, 3);
});

test('AC10 the out-of-list count reaches the ledger as one integer, the reviewer is told, no path is stored', (t) => {
  const fx = fixture(t, plan(task('T1', { files: 'src/a.js' }), task('T2', { files: 'src/b.js' })));
  fx.begin();
  startAll(fx);
  fx.run('scope', SLUG, 'T1', '--', 'src/b.js', 'docs/new.md', 'more/extra.md');
  fx.done('T1');
  fx.done('T2');
  const r = ledger(['ship', SLUG, '2', '0', '0'], { now: NOW, root: fx.root });
  assert.equal(r.code, 0);
  const file = path.join(fx.root, '.company', 'ledger', `${SLUG}.jsonl`);
  const recs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const parRec = recs.find((x) => x.kind === 'par');
  assert.equal(parRec.out, 3);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!/src\/|docs\/|more\/|T1|T2/.test(text));
  const parallel = read('skills/pipeline/references/parallel.md');
  assert.match(parallel, /`sibling` path is not committed/);
  assert.match(parallel, /records each as a `\[spec\]` blocker/);
  assert.match(parallel, /name each `extra` line to the CEO/);
});

// ---------- Fix rounds ----------

test('AC11 round maps blocker paths to their owners, sends the rest to U1 alone, and the cap still holds', (t) => {
  const fx = fixture(t, sixTasks());
  fx.begin(3);
  for (let i = 0; i < 6; i += 1) {
    startAll(fx);
    for (const id of fx.view().running) fx.done(id);
  }
  assert.equal(fx.view().done['0'].length, 6);
  const r = fx.run('round', SLUG, '1', '--loose', '1', '--', 't1/file.js', 't2/file.js', 't3/file.js', 't4/file.js', 't5/file.js', 'nowhere/else.js');
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.match(r.lines.join('\n'), /^round 1: T1 \(\+1 paths\), T2 \(\+1 paths\), T3 \(\+1 paths\), T4 \(\+1 paths\), T5 \(\+1 paths\), U1 \(\+1 paths\)$/m);
  assert.ok(r.lines.some((l) => l === 'unowned nowhere/else.js'));
  assert.deepEqual(fx.starts(), ['T1', 'T2', 'T3'], 'the cap of 3 holds inside the round');
  startAll(fx);
  assert.equal(fx.view().running.length, 3);
  assert.equal(fx.run('start', SLUG, 'T4').code, 3);
});

test('AC11 inside a round a path goes to the first task that owns it and U1 waits to run alone', (t) => {
  const fx = fixture(t, plan(task('T1', { files: 'a/x.js, shared/' }), task('T2', { files: 'shared/y.js' }), task('T3', { files: 'c/c.js' })));
  fx.begin();
  for (let i = 0; i < 3; i += 1) {
    startAll(fx);
    for (const id of fx.view().running) fx.done(id);
  }
  const r = fx.run('round', SLUG, '1', '--', 'a/x.js', 'shared/y.js', 'c/c.js', 'unowned/z.js');
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.equal(r.lines[0], 'round 1: T1 (+2 paths), T3 (+1 paths), U1 (+1 paths)');
  assert.deepEqual(fx.next().lines.slice(1, 4), ['start T1 backend-engineer', 'start T3 backend-engineer', 'wait U1 alone T1']);
});

test('AC11 round refuses a wrong number, a running task and hostile paths', (t) => {
  const fx = fixture(t, sixTasks());
  fx.begin(3);
  fx.start('T1');
  assert.equal(fx.run('round', SLUG, '1', '--', 't1/file.js').code, 3, 'a task is still running');
  fx.done('T1');
  for (const bad of ['2', '0', '-1', '1.5', 'one', '6']) assert.equal(fx.run('round', SLUG, bad, '--', 't1/file.js').code, 3, bad);
  for (const bad of ['../x', 'C:/x', '*', '.git/x', 'a\nb', `a${String.fromCharCode(13)}b`]) {
    const r = fx.run('round', SLUG, '1', '--', bad);
    assert.equal(r.code, 3, JSON.stringify(bad));
    assert.ok(!r.lines.join(' ').includes(String.fromCharCode(13)));
  }
});

test('AC11 the pipeline text sends builders back through round and next under the same rules', () => {
  const text = read('skills/pipeline/references/parallel.md');
  assert.match(text, /\*\*Fix round\.\*\*[^\n]*Run `round '<slug>' '<n>' --loose '<k>' -- '<p1>' …`/);
  assert.match(text, /Then steps 4 and 5 run for the round's tasks/);
  assert.match(read('skills/pipeline/SKILL.md'), /under the same cap and overlap rules/);
});

// ---------- the ledger record ----------

const par = (over = {}) => ({ v: 1, run: SLUG, kind: 'par', cap: 4, peak: 3, waits: 1, out: 0, ...over });

test('AC12 par accepts integers in range only, refuses text, floats and extra keys', () => {
  assert.equal(validateRecord(par()).ok, true);
  const bad = { cap: ['4', 4.5, 0, 6, null, '4\n', NaN], peak: [-1, 101, '3', 1.5], waits: ['x', -1, 10001, 0.5], out: ['0', -1, 10001, 2.2] };
  for (const [key, list] of Object.entries(bad)) for (const v of list) assert.equal(validateRecord(par({ [key]: v })).ok, false, `${key} ${String(v)}`);
  for (const key of ['task', 'path', 'paths', 'note', 'plan', 'extra', 'sibling', 'role', '__proto__x']) {
    assert.equal(validateRecord({ ...par(), [key]: 'T1' }).ok, false, key);
  }
  for (const key of ['cap', 'peak', 'waits', 'out']) {
    assert.equal(validateRecord({ v: 1, run: SLUG, kind: 'step', id: '01', role: 'qa', agent: 'a', src: 'notification', ctx_end: 1, [key]: 1 }).ok, false, `${key} on a step`);
  }
});

test('AC12 ship writes one par line of four integers after meta and before ship, and no task ID or path', (t) => {
  const fx = fixture(t, plan(task('T1', { files: 'src/a.js' }), task('T2', { files: 'SRC/A.js' }), task('T3', { files: 'c/c.js' })));
  fx.begin(4);
  startAll(fx);
  fx.run('scope', SLUG, 'T1', '--', 'src/a.js', 'extra/one.md');
  fx.done('T1');
  fx.done('T3');
  startAll(fx);
  fx.done('T2');
  assert.equal(ledger(['ship', SLUG, '3', '1', '0'], { now: NOW, root: fx.root }).code, 0);
  const file = path.join(fx.root, '.company', 'ledger', `${SLUG}.jsonl`);
  const recs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(recs.map((x) => x.kind), ['meta', 'par', 'ship']);
  assert.deepEqual(recs[1], { v: 1, run: SLUG, kind: 'par', cap: 4, peak: 2, waits: 1, out: 1 });
  assert.ok(Object.values(recs[1]).every((v) => typeof v === 'number' || v === SLUG || v === 'par'));
  assert.ok(!/T1|T2|src|extra|02-plan/.test(fs.readFileSync(file, 'utf8')));
});

test('AC12 a broken or hostile record writes no par line and counts a warning', (t) => {
  const fx = fixture(t, sixTasks());
  fx.begin();
  fs.appendFileSync(fx.recordFile, '{"__proto__":{"ev":"start"}}\n');
  const r = ledger(['ship', SLUG, '2'], { now: NOW, root: fx.root });
  assert.equal(r.code, 0);
  assert.match(r.lines[0], /warnings: 1/);
  const file = path.join(fx.root, '.company', 'ledger', `${SLUG}.jsonl`);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('"par"'));
});

test('AC12 a run without a parallel record, and a brainstorm run, get no par line', (t) => {
  const root = tmp(t, 'qa-parcap-ledger');
  assert.equal(ledger(['ship', 'plain', '1'], { now: NOW, root }).code, 0);
  const file = path.join(root, '.company', 'ledger', 'plain.jsonl');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('"par"'));
  const fx = fixture(t, sixTasks(), { slug: 'brainstorm-x' });
  fx.run('begin', 'brainstorm-x', PLAN, '--cap', '4', '--mode', 'parallel');
  ledger(['ship', 'brainstorm-x', '1'], { now: NOW, root: fx.root });
  assert.ok(!fs.readFileSync(path.join(fx.root, '.company', 'ledger', 'brainstorm-x.jsonl'), 'utf8').includes('"par"'));
});

test('AC12 report and scorecard print the same lines for a v1.2 file with and without the par line', (t) => {
  const a = tmp(t, 'qa-parcap-plain');
  const b = tmp(t, 'qa-parcap-rich');
  const step = (id, extra) => ({ v: 1, run: 'demo', kind: 'step', id, role: 'qa', agent: 'a1', ...extra });
  const common = [
    step('01', { src: 'notification', ctx_end: 100 }),
    step('01', { src: 'transcript', tokens: { in: 10, cache_write: 20, cache_read: 5, out: 30 } })
  ];
  const meta = { v: 1, run: 'demo', kind: 'meta', aico: '0.17.0' };
  const shipRec = { v: 1, run: 'demo', kind: 'ship', acs: 2, fix_rounds: 0, high_blockers: 0, t_start: '2026-10-28T09:00:00Z', t_ship: '2026-10-28T10:00:00Z', wait: 60 };
  const write = (root, recs) => {
    fs.mkdirSync(path.join(root, '.company', 'ledger'), { recursive: true });
    fs.writeFileSync(path.join(root, '.company', 'ledger', 'demo.jsonl'), `${recs.map((r) => JSON.stringify(r)).join('\n')}\n`);
  };
  write(a, [...common, meta, shipRec]);
  write(b, [...common, { ...meta, floor: '0.16.0' }, par(), shipRec]);
  for (const args of [['report', 'demo'], ['report', 'demo', '--json'], ['scorecard', 'demo']]) {
    assert.deepEqual(ledger(args, { now: NOW, root: a }), ledger(args, { now: NOW, root: b }), args.join(' '));
  }
});

// ---------- the parallel verdict ----------

const BUILDERS = ['backend-engineer', 'frontend-engineer'];
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const FLOOR = { release: '0.16.0', floor: { architect: 'opus' }, protected: ['architect'], downgraded: [], warnings: [] };
const floorOf = () => () => ({ ...FLOOR });

function writeRun(root, name, recs) {
  const dir = path.join(root, '.company', 'ledger');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.jsonl`), `${recs.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const work = path.join(root, '.company', 'work', name);
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, 'plan-check.jsonl'), `${JSON.stringify({ v: 1, at: '2026-10-01T10:00:00Z', ev: 'scan', policy: 'warn', plan: 'plan.md', patterns: 'abcdef012345', findings: 0, decided: 0 })}\n`);
}

function mk(root, name, { side = '18', age = 0, time = 1800, wait = 0, fix = 0, high = 0, rej = 0, acs = 4, spend = 1000, builders = 2, cap = 4, out = 0 } = {}) {
  const end = NOW - (age + 1) * DAY;
  const recs = [];
  for (let i = 0; i < builders; i += 1) {
    const base = { v: 1, run: name, kind: 'step', id: `0${i + 1}`, role: BUILDERS[i % 2], agent: `a${i}` };
    recs.push({ ...base, src: 'notification', ctx_end: 100 });
    recs.push({ ...base, src: 'transcript', tokens: { in: i === 0 ? spend : 0, cache_write: 0, cache_read: 50, out: 0 } });
  }
  recs.push({ v: 1, run: name, kind: 'meta', aico: side === '18' ? '0.18.0' : '0.17.0', ...(side === '18' ? { floor: '0.16.0' } : {}) });
  if (side === '18') recs.push({ v: 1, run: name, kind: 'par', cap, peak: Math.min(cap, 3), waits: 0, out });
  recs.push({ v: 1, run: name, kind: 'ship', acs, fix_rounds: fix, high_blockers: high, t_start: iso(end - (time + wait) * 1000), t_ship: iso(end), wait, rej_ship: rej });
  writeRun(root, name, recs);
}

function passing(root, over18 = {}, over17 = {}, n = 10) {
  for (let i = 0; i < n; i += 1) mk(root, `new-${i}`, { side: '18', age: i, time: 1800, ...over18 });
  for (let i = 0; i < n; i += 1) mk(root, `old-${i}`, { side: '17', age: 20 + i, time: 3600, ...over17 });
}

const verdict = (root, args = []) => ledger(['parallel-verdict', ...args], { now: NOW, root, loadFloor: floorOf() });
const stateOf = (r) => {
  assert.equal(r.lines.length, 1);
  return r.lines[0].split(' | ')[0];
};

test('AC13 --runs takes digits from 3 to 50 only; anything else is refused with exit 2', (t) => {
  const root = tmp(t, 'qa-parcap-v');
  for (const bad of ['2', '51', '1e1', '10 ', '-1', '0x10', '', 'ten', '__proto__', '10\n']) {
    const r = verdict(root, ['--runs', bad]);
    assert.equal(r.code, 2, JSON.stringify(bad));
    assert.match(r.lines[0], /^refused: /);
  }
  assert.equal(verdict(root, ['--runs', '3']).code, 0);
  assert.equal(verdict(root, ['--runs', '50']).code, 0);
});

test('AC13 with no runs, or fewer than ten on a side, the verdict is insufficient and exits 0', (t) => {
  const root = tmp(t, 'qa-parcap-v');
  assert.equal(stateOf(verdict(root)), 'parallel verdict: insufficient (n=0)');
  passing(root, {}, {}, 9);
  const r = verdict(root);
  assert.equal(r.code, 0);
  assert.equal(stateOf(r), 'parallel verdict: insufficient (n=9)');
  assert.equal(stateOf(verdict(root, ['--runs', '9'])), 'parallel verdict: pass');
});

test('AC13 pass: ten v0.18 runs at half the time, nothing else worse', (t) => {
  const root = tmp(t, 'qa-parcap-v');
  passing(root);
  const r = verdict(root);
  assert.equal(r.code, 0);
  assert.equal(stateOf(r), 'parallel verdict: pass');
  assert.ok(!/next step/.test(r.lines[0]));
  assert.match(r.lines[0], /time minus CEO wait median 30m \(v0\.17 1h00m\)/);
});

test('AC13 the time is the Ship Gate time minus the CEO wait, and the edge is exactly 25 percent', (t) => {
  let root = tmp(t, 'qa-parcap-v');
  passing(root, { time: 2700 });
  assert.equal(stateOf(verdict(root)), 'parallel verdict: pass');
  root = tmp(t, 'qa-parcap-v');
  passing(root, { time: 2701 });
  assert.equal(stateOf(verdict(root)), 'parallel verdict: fail');
  root = tmp(t, 'qa-parcap-v');
  passing(root, { time: 2700, wait: 5000 }, { time: 3600, wait: 0 });
  assert.equal(stateOf(verdict(root)), 'parallel verdict: pass', 'a long CEO wait does not count');
});

test('AC13 each guard fails the verdict: Fix rounds, high blockers, Gate rejects, spend over 10 percent, out-of-list above 0', (t) => {
  const cases = [
    ['fix rounds', { fix: 1 }, {}],
    ['high blockers', { high: 1 }, {}],
    ['gate rejects', { rej: 1 }, {}],
    ['spend', { spend: 1101 }, {}],
    ['out of list', { out: 1 }, {}]
  ];
  for (const [label, over18, over17] of cases) {
    const root = tmp(t, 'qa-parcap-v');
    passing(root, over18, over17);
    assert.equal(stateOf(verdict(root)), 'parallel verdict: fail', label);
  }
  const root = tmp(t, 'qa-parcap-v');
  passing(root, { spend: 1100 });
  assert.equal(stateOf(verdict(root)), 'parallel verdict: pass', 'exactly 10 percent more is allowed');
});

test('AC13 runs with fewer than two builder Steps, or with a cap of 1, are not counted', (t) => {
  const root = tmp(t, 'qa-parcap-v');
  passing(root, {}, {}, 9);
  for (let i = 0; i < 5; i += 1) mk(root, `one-${i}`, { side: '18', age: i, builders: 1 });
  for (let i = 0; i < 5; i += 1) mk(root, `seq-${i}`, { side: '18', age: i, cap: 1 });
  const r = verdict(root);
  assert.equal(stateOf(r), 'parallel verdict: insufficient (n=9)');
  assert.match(r.lines[0], /not counted: 10/);
});

test('AC13 hostile ledger files are skipped and never become a pass', (t) => {
  const root = tmp(t, 'qa-parcap-v');
  passing(root, {}, {}, 4);
  const dir = path.join(root, '.company', 'ledger');
  fs.writeFileSync(path.join(dir, 'junk.jsonl'), '{"__proto__":{"kind":"ship"}}\nnot json\n{"v":1,"run":"junk","kind":"par","cap":"9","peak":1,"waits":1,"out":1}\n');
  fs.writeFileSync(path.join(dir, 'Bad Name.jsonl'), 'x\n');
  fs.mkdirSync(path.join(dir, 'dir-run.jsonl'));
  const r = verdict(root);
  assert.equal(r.code, 0);
  assert.equal(stateOf(r), 'parallel verdict: insufficient (n=4)');
});

test('AC13 the verdict writes nothing and its line holds no saving word', (t) => {
  const root = tmp(t, 'qa-parcap-v');
  passing(root);
  const before = fs.readdirSync(path.join(root, '.company', 'ledger')).map((f) => fs.readFileSync(path.join(root, '.company', 'ledger', f), 'utf8'));
  const r = verdict(root);
  const after = fs.readdirSync(path.join(root, '.company', 'ledger')).map((f) => fs.readFileSync(path.join(root, '.company', 'ledger', f), 'utf8'));
  assert.deepEqual(after, before);
  assert.ok(!/%|saving|saved|faster|\$|EUR/i.test(r.lines[0]));
});

test('AC13 the feedback Playbook quotes the line unchanged and never stops on it', () => {
  const text = read('skills/feedback/SKILL.md');
  assert.match(text, /parallel-verdict/);
  assert.match(text, /## Parallel/);
  assert.match(text, /It never stops the run; an error is quoted as it is, never read as a pass\./);
});

// ---------- the other verdicts ----------

test('AC14 the model verdict gives the same line for v0.17 files with and without par and floor lines', (t) => {
  const plain = tmp(t, 'qa-parcap-mv');
  const rich = tmp(t, 'qa-parcap-mv');
  for (const [root, extra] of [[plain, false], [rich, true]]) {
    for (let i = 0; i < 4; i += 1) {
      const name = `run-${i}`;
      const end = NOW - (i + 1) * DAY;
      const recs = [
        { v: 1, run: name, kind: 'step', id: '01', role: 'backend-engineer', agent: 'a', src: 'notification', ctx_end: 100 },
        { v: 1, run: name, kind: 'step', id: '01', role: 'backend-engineer', agent: 'a', src: 'transcript', tokens: { in: 100, cache_write: 0, cache_read: 5, out: 0 } },
        { v: 1, run: name, kind: 'meta', aico: '0.17.0', ...(extra ? { floor: '0.16.0' } : {}) },
        ...(extra ? [par({ run: name })] : []),
        { v: 1, run: name, kind: 'ship', acs: 2, fix_rounds: 0, high_blockers: 0, t_start: iso(end - 3600000), t_ship: iso(end) }
      ];
      writeRun(root, name, recs);
    }
  }
  const run = (root) => ledger(['model-verdict', '--runs', '3'], { now: NOW, root, loadFloor: floorOf() });
  const a = run(plain);
  assert.equal(a.code, 0);
  assert.deepEqual(run(rich), a);
});

test('AC14 a run from 0.18.0 on is not on the v0.17 side of the model verdict', (t) => {
  const root = tmp(t, 'qa-parcap-mv');
  for (let i = 0; i < 9; i += 1) mk(root, `old-${i}`, { side: '17', age: 10 + i });
  const before = ledger(['model-verdict'], { now: NOW, root, loadFloor: floorOf() });
  mk(root, 'newer', { side: '18', age: 0 });
  const after = ledger(['model-verdict'], { now: NOW, root, loadFloor: floorOf() });
  assert.deepEqual(after.lines.map((l) => l.replace(/not counted: \d+/, '')), before.lines.map((l) => l.replace(/not counted: \d+/, '')));
  assert.match(after.lines[0], /^model verdict: insufficient \(n=9\)/);
});

test('AC14 v0.18 runs stay out of the v0.17 side while the parallel verdict counts them on their own', (t) => {
  const root = tmp(t, 'qa-parcap-mv');
  passing(root);
  assert.equal(stateOf(verdict(root)), 'parallel verdict: pass');
  const mv = ledger(['model-verdict'], { now: NOW, root, loadFloor: floorOf() });
  assert.match(mv.lines[0], /runs 10 v0\.17, 0 v0\.16/);
});

test('AC14 the plan check verdict is unchanged by par and floor lines', (t) => {
  const plain = tmp(t, 'qa-parcap-pc');
  const rich = tmp(t, 'qa-parcap-pc');
  for (const [root, side] of [[plain, '17'], [rich, '18']]) {
    for (let i = 0; i < 6; i += 1) mk(root, `r-${i}`, { side: i < 3 ? side : '17', age: i, fix: i % 2 });
  }
  const a = planCheckVerdict(['verdict'], { root: plain });
  const b = planCheckVerdict(['verdict'], { root: rich });
  assert.equal(a.code, b.code);
  assert.deepEqual(a.lines, b.lines);
});

// ---------- rollback ----------

test('AC15 a fail below cap 5 names raising the cap to 5, and nothing else', (t) => {
  const root = tmp(t, 'qa-parcap-rb');
  passing(root, { fix: 1, cap: 4 });
  const r = verdict(root);
  assert.equal(stateOf(r), 'parallel verdict: fail');
  const segments = r.lines[0].split(' | ');
  assert.ok(segments.includes('next step: set pipeline.parallel_cap to 5'));
  assert.equal(segments.filter((s) => s.startsWith('next step')).length, 1);
});

test('AC15 a fail with the cap median already 5 names sequential dispatch', (t) => {
  const root = tmp(t, 'qa-parcap-rb');
  passing(root, { fix: 1, cap: 5 });
  const r = verdict(root);
  assert.equal(stateOf(r), 'parallel verdict: fail');
  assert.ok(r.lines[0].split(' | ').includes('next step: set pipeline.dispatch to sequential'));
});

test('AC15 pass and insufficient name no next step', (t) => {
  const a = tmp(t, 'qa-parcap-rb');
  passing(a);
  assert.ok(!/next step/.test(verdict(a).lines[0]));
  const b = tmp(t, 'qa-parcap-rb');
  assert.ok(!/next step/.test(verdict(b).lines[0]));
});

test('AC15 the rollback step is the same in the docs, the Contract and the settings the step names', (t) => {
  const concepts = read('documentation/concepts.md');
  assert.match(concepts, /\*\*Rolling back\.\*\* When the verdict says `fail`, set `pipeline\.parallel_cap` to 5 in `\/aico:settings`/);
  assert.match(concepts, /set `pipeline\.dispatch` to `sequential` instead/);
  assert.match(concepts, /Reviewer, QA and Security verdicts and the Gates do not change\./);
  const contract = read('docs/contracts/token-ledger.md');
  assert.match(contract, /next step: set pipeline\.parallel_cap to 5/);
  assert.match(contract, /next step: set pipeline\.dispatch to sequential/);
  // The step it names is a value the settings accept, and 5 is the top of the range.
  const s = settingsFx(t);
  s.user({ parallel_cap: 5, dispatch: 'sequential' });
  assert.equal(s.get('pipeline.parallel_cap').out.trim(), '5');
  assert.equal(s.get('pipeline.dispatch').out.trim(), 'sequential');
});

test('AC15 the Gates and the review lanes are still in the pipeline text', () => {
  const text = read('skills/pipeline/SKILL.md');
  assert.match(text, /At \*\*Brief\*\*, \*\*Plan\*\* and \*\*Ship\*\*, stop\./);
  assert.match(text, /A Gate is never skipped/);
  assert.match(text, /\*\*One Fix round\*\* = dispatch the builder with \*all\* blocking reviewer Handoffs as input/);
  assert.match(text, /by default at most 2 rounds/);
  const parallel = read('skills/pipeline/references/parallel.md');
  assert.match(parallel, /Then re-dispatch every reviewer that blocked/);
});

test('this test file is LF only', () => {
  const bytes = fs.readFileSync(import.meta.filename);
  assert.equal(bytes.includes(13), false);
});
