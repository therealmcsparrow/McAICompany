import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main as planTasks, parsePlan } from './plan-tasks.mjs';
import { main as planCheck, scanText, loadPatterns } from './plan-check.mjs';
import { verdict } from './plan-check-verdict.mjs';

const NOW = Date.UTC(2026, 10, 8, 21, 30, 0);
const P1 = 'P20261108.000001';
const P2 = 'P20261108.000002';
const F1 = `${P1}-22.25.00`;
const F1_LATER = `${P1}-23.10.05`;
const F2 = `${P2}-22.30.00`;
const V11 = '2026-10-28 22.25 - Demo';
const LEGACY = 'demo';
const { patterns: PATTERNS } = loadPatterns(path.join(import.meta.dirname, 'plan-check-patterns.json'));

const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function tmp(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  roots.push(dir);
  return dir;
}

// A product root with a temp home and a plugin root that lists the agent files.
function env(folders) {
  const base = tmp('ticket-id-plan');
  const home = path.join(base, 'home');
  const product = path.join(base, 'product');
  const pluginRoot = path.join(base, 'plugin');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  for (const a of ['backend-engineer', 'qa']) fs.writeFileSync(path.join(pluginRoot, 'agents', `${a}.md`), 'agent\n');
  for (const [name, text] of Object.entries(folders)) {
    const dir = path.join(product, '.company', 'work', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '02-plan.md'), text);
  }
  const ctx = { now: NOW, root: product, pluginRoot, home };
  return {
    product,
    home,
    run: (...args) => planTasks(args, ctx),
    verify: (...args) => planCheck(args, ctx)
  };
}

const ARROW = '→';
const DASH = '—';
const fileOf = (id) => `src/${id.replace(/[^A-Za-z0-9]/g, '-')}.js`;

function task(id, { deps = 'none' } = {}) {
  const f = fileOf(id);
  return [
    `### ${id} title of the task`,
    '- role: backend-engineer',
    `- files: ${f}`,
    `- depends-on: ${deps}`,
    '- parallel: yes',
    '- context: 20k',
    `- slice: a user submits the form ${ARROW} the page shows the saved row ${DASH} demo: ${f}`,
    `- seams: ${f}#run`,
    ''
  ].join('\n');
}

const plan = (...tasks) => `${['# Plan', '', '## Tasks', '', ...tasks].join('\n')}\n`;
const AGENTS = ['backend-engineer', 'qa'];
const idsOf = (parsed) => parsed.tasks.map((t) => t.id);
const check = (e, folder) => e.run('check', folder, '02-plan.md', '--cap', '3', '--mode', 'parallel');
const begin = (e, folder) => e.run('begin', folder, '02-plan.md', '--cap', '3', '--mode', 'parallel');
const taskCount = (r) => {
  const m = /^plan-tasks: (\d+) tasks?,/.exec(r.lines[0] ?? '');
  return m ? Number(m[1]) : 0;
};

describe('parsePlan headings', () => {
  test('a v2 slug opens only that project IDs', () => {
    const text = plan(
      task(`${P1}-T1`),
      task(`${P1}-T2`, { deps: `${P1}-T1` }),
      task(`${P2}-T1`),
      task('T3'),
      task(`${P1}-T1000`),
      task('p20261108.000001-T4'),
      task(`${P1}-T5_junk`),
      task(`${P1}-T6abc`),
      task('P20261108X000001-T7')
    );
    const parsed = parsePlan(text, { agents: AGENTS, slug: F1 });
    assert.deepEqual(idsOf(parsed), [`${P1}-T1`, `${P1}-T2`]);
    assert.deepEqual(parsed.tasks[1].deps, [`${P1}-T1`]);
    assert.equal(parsed.tasks[1].alone, false);
  });

  test('a bare T<n> is not a task in a v2 slug, and a bare depends-on there is unknown', () => {
    const text = plan(task('T1'), task(`${P1}-T2`, { deps: 'T1' }));
    const parsed = parsePlan(text, { agents: AGENTS, slug: F1 });
    assert.deepEqual(idsOf(parsed), [`${P1}-T2`]);
    assert.equal(parsed.tasks[0].alone, true);
    assert.ok(parsed.tasks[0].reasons.some((r) => r.startsWith('depends-on')));
  });

  test('a repeated v2 heading gets the -dup<n> id', () => {
    const text = plan(task(`${P1}-T1`), task(`${P1}-T1`), task(`${P1}-T1`));
    const parsed = parsePlan(text, { agents: AGENTS, slug: F1 });
    assert.deepEqual(idsOf(parsed), [`${P1}-T1`, `${P1}-T1-dup1`, `${P1}-T1-dup2`]);
    assert.ok(parsed.tasks[1].reasons.includes('duplicate id'));
  });

  test('a v2 heading with a very long title does not throw and opens at most that task', () => {
    const long = `### ${P1}-T1 ${'x'.repeat(6000)}\n- role: qa\n`;
    const parsed = parsePlan(`# Plan\n\n## Tasks\n\n${long}\n${task(`${P1}-T2`)}`, { agents: AGENTS, slug: F1 });
    assert.ok(idsOf(parsed).includes(`${P1}-T2`));
    assert.ok(idsOf(parsed).length <= 2);
  });

  test('without a slug either form opens and depends-on resolves against what was found', () => {
    const text = plan(task('T1'), task(`${P1}-T2`, { deps: 'T1' }), task(`${P1}-T3`, { deps: `${P1}-T2` }), task('p20261108.000001-T4'));
    const parsed = parsePlan(text, { agents: AGENTS });
    assert.deepEqual(idsOf(parsed), ['T1', `${P1}-T2`, `${P1}-T3`]);
    assert.deepEqual(parsed.tasks[1].deps, ['T1']);
    assert.deepEqual(parsed.tasks[2].deps, [`${P1}-T2`]);
  });

  test('a legacy and a v1.1 slug read a bare plan like a call without a slug', () => {
    const text = plan(task('T1'), task('T2', { deps: 'T1' }));
    const base = parsePlan(text, { agents: AGENTS });
    for (const slug of [LEGACY, V11]) assert.deepEqual(parsePlan(text, { agents: AGENTS, slug }), base);
    assert.deepEqual(idsOf(base), ['T1', 'T2']);
    const v2 = parsePlan(plan(task(`${P1}-T1`), task(`${P1}-T2`, { deps: `${P1}-T1` })), { agents: AGENTS, slug: F1 });
    assert.deepEqual(v2.tasks.map((t) => [t.alone, t.deps.length]), base.tasks.map((t) => [t.alone, t.deps.length]));
  });
});

describe('plan-tasks in a v2 folder', () => {
  const planV2 = plan(task(`${P1}-T1`), task(`${P1}-T2`, { deps: `${P1}-T1` }));

  test('check passes and prints the full ticket IDs', () => {
    const e = env({ [F1]: planV2 });
    const r = check(e, F1);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(r.lines[0], 'plan-tasks: 2 tasks, 2 marked, 0 alone, cap 3 (parallel)');
    assert.deepEqual(r.lines.slice(1), [`wave 1: ${P1}-T1`, `wave 2: ${P1}-T2 depends ${P1}-T1`]);
  });

  test('begin, next, start and lines carry the full ticket ID and Task: prints it', () => {
    const e = env({ [F1]: planV2 });
    const b = begin(e, F1);
    assert.equal(b.code, 0, b.lines.join('\n'));
    const next = e.run('next', F1);
    assert.ok(next.lines.includes(`start ${P1}-T1 backend-engineer`), next.lines.join('\n'));
    assert.ok(next.lines.includes(`wait ${P1}-T2 depends ${P1}-T1`), next.lines.join('\n'));
    assert.deepEqual(e.run('start', F1, `${P1}-T1`).lines, [`started ${P1}-T1`]);
    const lines = e.run('lines', F1, `${P1}-T1`);
    assert.equal(lines.code, 0);
    assert.deepEqual(lines.lines, [`Task: ${P1}-T1`, `Files: ${fileOf(`${P1}-T1`)}`]);
    assert.equal(e.run('done', F1, `${P1}-T1`).code, 0);
  });

  test('a bare T<n> and a foreign ticket ID are refused as task IDs', () => {
    const e = env({ [F1]: planV2 });
    begin(e, F1);
    assert.equal(e.run('start', F1, 'T1').code, 3);
    assert.equal(e.run('start', F1, `${P2}-T1`).code, 3);
    assert.equal(e.run('lines', F1, `${P2}-T1`).code, 3);
    assert.equal(e.run('start', F1, `${P1}-T1`).code, 0);
    assert.equal(e.run('lines', F1, 'T1').code, 3);
    assert.equal(e.run('lines', F1, `${P1.toLowerCase()}-T1`).code, 3);
  });

  test('a plan whose other headings are bare or foreign opens only the own ticket', () => {
    const hostile = [task('T1'), task(`${P2}-T1`), task(`${P1}-T1000`), task('p20261108.000001-T1')];
    const e = env({ [F1]: plan(task(`${P1}-T1`), ...hostile), [F2]: plan(...hostile) });
    const r = check(e, F1);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(taskCount(r), 1, r.lines.join('\n'));
    assert.deepEqual(r.lines.slice(1), [`wave 1: ${P1}-T1`]);
    const none = check(e, F2);
    assert.equal(taskCount(none), 1, none.lines.join('\n'));
    assert.deepEqual(none.lines.slice(1), [`wave 1: ${P2}-T1`]);
  });

  test('a repeated heading is flagged duplicate id and still works as -dup1', () => {
    const e = env({ [F1]: plan(task(`${P1}-T1`), task(`${P1}-T1`)) });
    const r = check(e, F1);
    assert.equal(taskCount(r), 2, r.lines.join('\n'));
    assert.ok(r.lines.some((l) => l.includes(`${P1}-T1-dup1`)), r.lines.join('\n'));
  });

  test('a ticket ID that heads a plan in another folder of the same project is refused', () => {
    const e = env({ [F1]: planV2, [F1_LATER]: plan(task(`${P1}-T2`), task(`${P1}-T3`)) });
    const r = check(e, F1_LATER);
    assert.notEqual(r.code, 0);
    assert.ok(r.lines.join('\n').includes('ticket-reused'), r.lines.join('\n'));
    assert.notEqual(begin(e, F1_LATER).code, 0);
  });

  test('numbers that continue after the earlier folder pass, and another project never clashes', () => {
    const e = env({ [F1]: planV2, [F1_LATER]: plan(task(`${P1}-T3`)), [F2]: plan(task(`${P2}-T1`)) });
    assert.equal(check(e, F1_LATER).code, 0);
    const other = check(e, F2);
    assert.equal(other.code, 0, other.lines.join('\n'));
    assert.deepEqual(other.lines.slice(1), [`wave 1: ${P2}-T1`]);
  });

  test('a legacy and a v1.1 folder print the same lines as a v2 folder once the project prefix is dropped', () => {
    const bare = plan(task('T1'), task('T2', { deps: 'T1' }));
    const e = env({ [F1]: planV2, [LEGACY]: bare, [V11]: bare });
    const v2 = check(e, F1);
    assert.equal(v2.code, 0, v2.lines.join('\n'));
    const expected = v2.lines.map((l) => l.replaceAll(`${P1}-`, ''));
    for (const folder of [LEGACY, V11]) {
      const r = check(e, folder);
      assert.equal(r.code, 0, r.lines.join('\n'));
      assert.deepEqual(r.lines, expected);
    }
    assert.equal(begin(e, LEGACY).code, 0);
    assert.deepEqual(e.run('start', LEGACY, 'T1').lines, ['started T1']);
    assert.deepEqual(e.run('lines', LEGACY, 'T1').lines, ['Task: T1', `Files: ${fileOf('T1')}`]);
  });

  test('a linked plan file stays refused in a v2 folder', (t) => {
    const e = env({ [F1]: planV2 });
    const dir = path.join(e.product, '.company', 'work', F1);
    assert.equal(check(e, F1).code, 0);
    const outside = path.join(tmp('ticket-id-link'), 'plan.md');
    fs.writeFileSync(outside, planV2);
    fs.rmSync(path.join(dir, '02-plan.md'));
    try {
      fs.symlinkSync(outside, path.join(dir, '02-plan.md'));
    } catch {
      t.skip('symlinks are not available here');
      return;
    }
    const r = check(e, F1);
    assert.notEqual(r.code, 0);
    assert.equal(taskCount(r), 0);
  });
});

describe('plan-check sections', () => {
  const open = (heading, level = '###') => `# Plan\n\n## Background\n\n${level} ${heading}\n- slice: TBD\n`;
  const scan = (text) => scanText(text, PATTERNS, { file: '02-plan.md' }).findings;

  test('a v2 ticket heading opens a task section, with each ending a heading may have', () => {
    for (const tail of ['', ' title', ': title', '. title', ') title', '-title']) {
      const findings = scan(open(`${P1}-T1${tail}`));
      assert.equal(findings.length, 1, `heading tail ${JSON.stringify(tail)}`);
      assert.equal(findings[0].id, 'tbd');
    }
    assert.equal(scan(open(`${P1}-T12a title`)).length, 1);
    assert.equal(scan(open(`${P2}-T1 title`, '##')).length, 1);
  });

  test('a heading that is not a ticket ID does not open a section', () => {
    const heads = [`${P1}-T1000 title`, 'p20261108.000001-T1 title', `${P1}-T1_x title`, `${P1}-T1abc title`, 'P20261108X000001-T1 title', `${P1}-T title`, `${P1}-t1 title`, 'P20261108.00001-T1 title'];
    for (const head of heads) assert.deepEqual(scan(open(head)), [], head);
    assert.deepEqual(scan(open(`${P1}-T1 title`, '####')), []);
  });

  test('a section opened by a v2 ticket ends at the next heading of its level', () => {
    const text = `# Plan\n\n### ${P1}-T1 title\n- slice: fine\n\n### Notes\nTBD later\n`;
    assert.deepEqual(scan(text), []);
    const second = `# Plan\n\n### ${P1}-T1 title\n- slice: fine\n\n### ${P1}-T2 title\nTBD here\n`;
    assert.deepEqual(scan(second).map((f) => [f.id, f.line]), [['tbd', 7]]);
  });

  test('a legacy heading and a title that opens a section today still open it', () => {
    assert.equal(scan(open('T1 title')).length, 1);
    assert.equal(scan(open('Tasks')).length, 1);
    assert.equal(scan(open(`${P1}-T1 title`)).length, 1);
    assert.deepEqual(scan(open('Background notes')), []);
  });

  test('verify reads a plan of a v2 folder and counts the open task', () => {
    const e = env({ [F1]: open(`${P1}-T1 title`), [LEGACY]: open('T1 title') });
    const v2 = e.verify('verify', F1, '02-plan.md', '--json');
    assert.equal(v2.code, 0, v2.lines.join('\n'));
    const body = JSON.parse(v2.lines[0]);
    assert.equal(body.state, 'open');
    assert.equal(body.count, 1);
    const old = JSON.parse(e.verify('verify', LEGACY, '02-plan.md', '--json').lines[0]);
    assert.equal(old.count, body.count);
  });
});

describe('plan-check-verdict and v2 run folders', () => {
  const base = tmp('ticket-id-verdict');
  const gitConfig = path.join(base, 'gitconfig');
  fs.writeFileSync(gitConfig, '');
  const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: base };
  let n = 0;

  function git(root, args, date) {
    const e = { ...gitEnv };
    if (date) {
      e.GIT_AUTHOR_DATE = date;
      e.GIT_COMMITTER_DATE = date;
    }
    const r = spawnSync('git', args, { cwd: root, env: e, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  }

  function repo() {
    const root = path.join(base, `r${n++}`);
    fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
    fs.mkdirSync(path.join(root, '.company', 'ledger'), { recursive: true });
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['commit', '--quiet', '--allow-empty', '--message=init'], '2026-10-01T00:00:00Z');
    return root;
  }

  const put = (root, rel, text) => {
    const f = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  };
  const stepText = (round) => `---\nstep: 03\nrole: backend-engineer\ntask: x\nstatus: done\nround: ${round}\nbase-commit: abc1234\nrisk-tier: medium\n---\n## Did\n`;
  const ship = (slug, extra = {}) => `${JSON.stringify({ v: 1, run: slug, kind: 'ship', acs: 3, fix_rounds: 1, ...extra })}\n`;

  // ledger: undefined writes a valid ship record with fix_rounds 1, null writes none, a string is written as is.
  function addRun(root, slug, day, ledger) {
    const dir = `.company/work/${slug}`;
    put(root, `${dir}/00-summary.md`, '# done\n');
    put(root, `${dir}/02-plan.md`, '# Plan\n');
    for (const [i, r] of [0, 1].entries()) {
      const rel = `${dir}/${String(3 + i).padStart(2, '0')}-backend-engineer.md`;
      put(root, rel, stepText(r));
      const t = new Date(`${day}T10:00:00Z`);
      fs.utimesSync(path.join(root, ...rel.split('/')), t, t);
    }
    put(root, `${dir}/run-state.jsonl`, [
      { v: 1, at: `${day}T08:00:00Z`, ev: 'start' },
      { v: 1, at: `${day}T09:00:00Z`, ev: 'gate', gate: 'plan', result: 'passed' },
      { v: 1, at: `${day}T12:00:00Z`, ev: 'gate', gate: 'ship', result: 'passed' }
    ].map((o) => JSON.stringify(o)).join('\n') + '\n');
    if (ledger === undefined) put(root, `.company/ledger/${slug}.jsonl`, ship(slug));
    else if (ledger !== null) put(root, `.company/ledger/${slug}.jsonl`, ledger);
    git(root, ['add', '--all'], `${day}T10:00:00Z`);
    git(root, ['commit', '--quiet', '--allow-empty', '--message=x'], `${day}T10:00:00Z`);
  }

  test('a v2 run with a ship record is counted by its folder name', () => {
    const root = repo();
    addRun(root, F1, '2026-11-02');
    const r = verdict(root, 3);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.deepEqual(r.runs.base.map((x) => x.slug), [F1]);
    assert.deepEqual(r.warnings, []);
  });

  test('a v2 run without a valid ship record is skipped with no warning, a legacy and a v1.1 run warn as before', () => {
    const root = repo();
    addRun(root, F1, '2026-11-02');
    addRun(root, F1_LATER, '2026-11-03', null);
    addRun(root, F2, '2026-11-04', 'not json\n');
    const wrong = `${P2}-23.45.10`;
    addRun(root, wrong, '2026-11-05', ship(wrong, { acs: 'x' }));
    const other = `${P2}-23.50.10`;
    addRun(root, other, '2026-11-05', ship(`${P1}-10.00.00`));
    addRun(root, LEGACY, '2026-11-06', null);
    addRun(root, V11, '2026-11-07', null);
    const r = verdict(root, 3);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.deepEqual(r.runs.base.map((x) => x.slug), [F1]);
    assert.deepEqual(r.warnings.filter((w) => w.includes('P2026')), []);
    assert.equal(r.warnings.filter((w) => w.startsWith(`${LEGACY}:`)).length, 1);
    assert.equal(r.warnings.filter((w) => w.startsWith(`${V11}:`)).length, 1);
    assert.equal(r.warnings.length, 2, r.warnings.join('\n'));
  });
});
