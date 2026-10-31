import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readRecord, verifyPlans, main as checkMain } from './plan-check.mjs';
import { main as verdictMain } from './plan-check-verdict.mjs';
import { main as tasksMain, readParallel, sortByVisit } from './plan-tasks.mjs';

const NOW = Date.UTC(2026, 9, 30, 22, 42, 0);
const NEW = '2026-10-30 22.42 - Build Draft Flow';
const NEW_TWO = '2026-10-30 22.43 - Plan Gate 2';
const HELPER = '2026-10-30 22.42 - Build Draft Flow Draft 3';
const LEGACY = 'demo';
const ROLES = ['backend-engineer', 'qa'];

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-plan-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const gitConfig = path.join(base, 'gitconfig');
fs.writeFileSync(gitConfig, '');
process.env.GIT_CONFIG_GLOBAL = gitConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CEILING_DIRECTORIES = base;

let n = 0;
function project(folders = [NEW]) {
  const root = path.join(base, `p${n++}`);
  const pluginRoot = path.join(root, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  for (const a of ROLES) fs.writeFileSync(path.join(pluginRoot, 'agents', `${a}.md`), 'agent\n');
  const product = path.join(root, 'product');
  fs.mkdirSync(path.join(product, '.company', 'work'), { recursive: true });
  for (const f of folders) fs.mkdirSync(path.join(product, '.company', 'work', f), { recursive: true });
  return { product, pluginRoot };
}
const dirOf = (product, name) => path.join(product, '.company', 'work', name);
const put = (product, name, file, text) => fs.writeFileSync(path.join(dirOf(product, name), file), text);

const PLAN = [
  '# Plan', '', '## Tasks', '',
  '### T1 first', '- role: backend-engineer', '- files: a/one.js', '- depends-on: none', '- parallel: yes', '',
  '### T2 second', '- role: backend-engineer', '- files: a/two.js', '- depends-on: none', '- parallel: yes', ''
].join('\n');
const STEP = ['---', 'step: 03', 'role: backend-engineer', 'task: x', 'status: done', 'round: 1', 'base-commit: abc1234', 'risk-tier: medium', '---', '## Did', ''].join('\n');
const DIRTY = `${PLAN}\n## Steps\n- decide later TBD\n`;

const tasks = (product, pluginRoot, ...args) => tasksMain(args, { now: NOW, root: product, pluginRoot });
const check = (product, ...args) => checkMain(args, { now: NOW, root: product });

const HOSTILE = [
  '2026-10-30 22.42 - build draft flow',
  '2026-10-30 22.42 - Build Draft Flow ',
  ' 2026-10-30 22.42 - Build Draft Flow',
  '2026-10-30 22.42 - Build Draft Flow\n',
  '2026-10-30 22.42 - Build Draft Flow\r',
  '2026-10-30 22.42 - Build/../Flow',
  '2026-10-30 22.42 - Build\\Flow',
  '2026-10-30 22.42 - Flow Build 2',
  '2026-10-30 22.42 - Flow  Other',
  '2026-10-30 22.42 - Flow Draft 1',
  '2026-10-30  22.42 - Flow',
  '2026-10-30 22:42 - Flow',
  '2026-13-30 22.42 - Flow',
  '2026-10-30 25.42 - Flow',
  '2026-10-30 22.42 - Flow‮',
  '2026-10-30 22.42 - Flöw',
  '2026-10-30 22.42 - ',
  '../escape',
  '.',
  'Demo',
  'demo name',
  `2026-10-30 22.42 - ${'Flow '.repeat(2000)}`,
  'A'.repeat(100000),
  '',
  null,
  42
];

describe('plan-check on a new-name folder', () => {
  test('gate, read, verify, wave and off behave as on a legacy folder', () => {
    for (const name of [NEW, NEW_TWO, HELPER, LEGACY]) {
      const { product } = project([name]);
      put(product, name, '02-plan.md', DIRTY);
      const gate = check(product, 'gate', name, '02-plan.md', '--policy', 'warn');
      assert.equal(gate.code, 0, `${name}: ${gate.lines.join('|')}`);
      const view = readRecord(product, name);
      assert.equal(view.state, 'on');
      assert.equal(view.slug, name);
      assert.equal(view.plan, '02-plan.md');
      assert.ok(view.findings >= 1);
      assert.equal(fs.existsSync(path.join(dirOf(product, name), 'plan-check.jsonl')), true);
      assert.equal(check(product, 'wave', name, '1').code, 0);
      assert.equal(readRecord(product, name).waved, 1);
      assert.equal(check(product, 'off', name).code, 0);
      assert.equal(readRecord(product, name).state, 'off');
      const verify = verifyPlans({ root: product, home: base, slug: name });
      assert.ok(verify && typeof verify === 'object');
    }
  });

  test('a clean plan in a new-name folder scans clean', () => {
    const { product } = project();
    put(product, NEW, '02-plan.md', PLAN);
    const gate = check(product, 'gate', NEW, '02-plan.md', '--policy', 'warn');
    assert.equal(gate.code, 0);
    assert.equal(readRecord(product, NEW).findings, 0);
  });

  test('a record for one new-name folder never lands in another', () => {
    const { product } = project([NEW, NEW_TWO]);
    put(product, NEW, '02-plan.md', DIRTY);
    check(product, 'gate', NEW, '02-plan.md', '--policy', 'warn');
    assert.equal(readRecord(product, NEW_TWO).state, 'none');
  });

  test('a new-name folder that is a link is unsafe, as for a legacy folder', () => {
    const { product } = project([]);
    const real = path.join(path.dirname(product), 'outside');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, '02-plan.md'), PLAN);
    fs.symlinkSync(real, dirOf(product, NEW), 'junction');
    assert.notEqual(check(product, 'gate', NEW, '02-plan.md', '--policy', 'warn').code, 0);
    assert.equal(fs.existsSync(path.join(real, 'plan-check.jsonl')), false);
  });
});

describe('plan-check refuses AC12 names', () => {
  for (const [i, bad] of HOSTILE.entries()) {
    test(`hostile name ${i}`, () => {
      const { product } = project([]);
      for (const cmd of [['gate', bad, '02-plan.md', '--policy', 'warn'], ['off', bad], ['wave', bad, '1'], ['verify', bad], ['read', bad]]) {
        if (typeof bad !== 'string' || bad === '') continue;
        const r = check(product, ...cmd);
        assert.equal(r.code, 3, `${cmd[0]}: ${r.lines.join('|')}`);
        assert.deepEqual(r.lines, ['refused: bad slug']);
      }
      assert.throws(() => readRecord(product, bad), TypeError);
      assert.throws(() => verifyPlans({ root: product, home: base, slug: bad }), TypeError);
      assert.deepEqual(fs.readdirSync(path.join(product, '.company', 'work')), []);
    });
  }
});

describe('plan-tasks on a new-name folder', () => {
  test('check, begin, next, start, brief, scope, done, read and merged work as on a legacy folder', () => {
    for (const name of [NEW, HELPER, LEGACY]) {
      const { product, pluginRoot } = project([name]);
      put(product, name, '02-plan.md', PLAN);
      const c = tasks(product, pluginRoot, 'check', name, '02-plan.md', '--cap', '4', '--mode', 'parallel');
      assert.equal(c.code, 0, `${name}: ${c.lines.join('|')}`);
      const b = tasks(product, pluginRoot, 'begin', name, '02-plan.md', '--cap', '4', '--mode', 'parallel');
      assert.equal(b.code, 0, b.lines.join('|'));
      assert.equal(readParallel(product, name).state, 'on');
      assert.equal(readParallel(product, name).slug, name);
      const next = tasks(product, pluginRoot, 'next', name);
      assert.equal(next.code, 0);
      assert.ok(next.lines.some(l => l.startsWith('start T1')));
      assert.equal(tasks(product, pluginRoot, 'start', name, 'T1').code, 0);
      const brief = tasks(product, pluginRoot, 'brief', name, 'T1');
      assert.equal(brief.code, 0, brief.lines.join('|'));
      assert.deepEqual(brief.lines, [`Task brief: .company/work/${name}/tasks/T1.md`]);
      assert.equal(fs.existsSync(path.join(dirOf(product, name), 'tasks', 'T1.md')), true);
      assert.deepEqual(sortByVisit(product, name, ['T2', 'T1']).slice().sort(), ['T1', 'T2']);
      assert.equal(tasks(product, pluginRoot, 'done', name, 'T1').code, 0);
      assert.equal(tasks(product, pluginRoot, 'read', name).code, 0);
    }
  });

  test('scope treats a file in the run folder as in scope whatever the capitals', () => {
    const { product, pluginRoot } = project();
    put(product, NEW, '02-plan.md', PLAN);
    tasks(product, pluginRoot, 'begin', NEW, '02-plan.md', '--cap', '4', '--mode', 'parallel');
    tasks(product, pluginRoot, 'start', NEW, 'T1');
    const r = tasks(product, pluginRoot, 'scope', NEW, 'T1', '--', `.company/work/${NEW}/23-backend-engineer.md`, 'z/other.js');
    assert.equal(r.code, 0, r.lines.join('|'));
    assert.deepEqual(r.lines, [`in .company/work/${NEW}/23-backend-engineer.md`, 'extra z/other.js', 'scope: 1 extra, 0 sibling']);
  });

});

describe('plan-tasks refuses AC12 names', () => {
  for (const [i, bad] of HOSTILE.entries()) {
    test(`hostile name ${i}`, () => {
      const { product, pluginRoot } = project([]);
      if (typeof bad === 'string' && bad !== '') {
        for (const cmd of [
          ['check', bad, '02-plan.md', '--cap', '4', '--mode', 'parallel'],
          ['begin', bad, '02-plan.md', '--cap', '4', '--mode', 'parallel'],
          ['next', bad], ['start', bad, 'T1'], ['done', bad, 'T1'], ['lines', bad, 'T1'], ['brief', bad, 'T1'],
          ['merged', bad, 'T1'], ['scope', bad, 'T1', '--', 'a.js'], ['round', bad, '1', '--', 'a.js'], ['read', bad]
        ]) {
          const r = tasks(product, pluginRoot, ...cmd);
          assert.equal(r.code, 3, `${cmd[0]}: ${r.lines.join('|')}`);
          assert.equal(r.lines.length, 1);
          assert.doesNotMatch(r.lines[0], /Flow|Flöw|escape|Demo|demo name/);
        }
      }
      assert.throws(() => readParallel(product, bad), TypeError);
      assert.throws(() => sortByVisit(product, bad, ['T1']), TypeError);
      assert.deepEqual(fs.readdirSync(path.join(product, '.company', 'work')), []);
    });
  }
});

describe('plan-check verdict and history with new-name folders', () => {
  const git = (root, args, date) => {
    const env = { ...process.env };
    if (date) { env.GIT_AUTHOR_DATE = date; env.GIT_COMMITTER_DATE = date; }
    const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  function repoWith(folders) {
    const { product } = project([]);
    fs.mkdirSync(path.join(product, '.company', 'ledger'), { recursive: true });
    git(product, ['init', '--quiet']);
    git(product, ['config', 'user.name', 'Test']);
    git(product, ['config', 'user.email', 'test@example.com']);
    git(product, ['config', 'core.excludesFile', gitConfig]);
    for (const name of folders) {
      fs.mkdirSync(dirOf(product, name), { recursive: true });
      put(product, name, '00-summary.md', '# done\n');
      put(product, name, '02-plan.md', '# Plan\n\n## Steps\n- keep TBD\n');
    }
    git(product, ['add', '--all'], '2026-10-11T10:00:00Z');
    git(product, ['commit', '--quiet', '--message=x'], '2026-10-11T10:00:00Z');
    return product;
  }

  test('history lists plans of a new-name folder, from git and from the working tree', () => {
    const product = repoWith([NEW, LEGACY]);
    put(product, NEW, '03-plan.md', '# Plan\n');
    const r = verdictMain(['history', '--json'], { root: product });
    assert.equal(r.code, 0, r.lines.join('|'));
    const text = r.lines.join('\n');
    assert.ok(text.includes(`.company/work/${NEW}/02-plan.md`));
    assert.ok(text.includes(`.company/work/${NEW}/03-plan.md`));
    assert.ok(text.includes('.company/work/demo/02-plan.md'));
  });

  test('a labels file may name a plan in a new-name folder and refuses a hostile one', () => {
    const product = repoWith([NEW]);
    const labels = (p) => {
      const f = path.join(base, `labels-${n++}.json`);
      fs.writeFileSync(f, JSON.stringify({ v: 1, labels: [{ path: p, sha: 'abcdef0', line: 3, label: 'fp' }] }));
      return f;
    };
    const ok = verdictMain(['history', '--labels', labels(`.company/work/${NEW}/02-plan.md`)], { root: product });
    assert.equal(ok.code, 0, ok.lines.join('|'));
    for (const bad of [
      '.company/work/2026-10-30 22.42 - build draft flow/02-plan.md',
      `.company/work/${NEW}/../x/02-plan.md`,
      `.company/work/${NEW}/sub/02-plan.md`,
      `.company/work/${NEW} /02-plan.md`,
      `.company/work/${NEW}\n/02-plan.md`,
      `.company/work/${'A'.repeat(100000)}/02-plan.md`
    ]) {
      const r = verdictMain(['history', '--labels', labels(bad)], { root: product });
      assert.equal(r.code, 3, bad.slice(0, 60));
      assert.doesNotMatch(r.lines.join('|'), /build draft flow|AAAA/);
    }
  });

  test('verdict counts runs in new-name folders and ignores a hostile folder name', () => {
    const names = ['2026-10-11 10.00 - Edge One', '2026-10-12 10.00 - Edge Two', '2026-10-13 10.00 - Edge Three'];
    const product = repoWith(names);
    for (const name of names) {
      put(product, name, 'plan-check.jsonl', `${JSON.stringify({ v: 1, at: '2026-10-11T08:30:00Z', ev: 'scan', policy: 'warn', plan: '02-plan.md', patterns: 'abcdef012345', findings: 1, decided: 0 })}\n`);
      put(product, name, 'run-state.jsonl', `${JSON.stringify({ v: 1, at: '2026-10-11T08:00:00Z', ev: 'start' })}\n`);
      put(product, name, '03-backend-engineer.md', STEP);
      fs.writeFileSync(path.join(product, '.company', 'ledger', `${name}.jsonl`), `${JSON.stringify({ v: 1, run: name, kind: 'ship', acs: 3, fix_rounds: 1 })}\n`);
    }
    const r = verdictMain(['verdict', '--runs', '3'], { root: product });
    assert.equal(r.code, 0, r.lines.join('|'));
    assert.match(r.lines[0], /check on: median [\d.?]+ \(n=3\)/);
    const hostile = '2026-10-14 10.00 - edge four';
    fs.mkdirSync(dirOf(product, hostile), { recursive: true });
    put(product, hostile, '00-summary.md', '# x\n');
    put(product, hostile, '02-plan.md', '# Plan\n');
    const again = verdictMain(['verdict', '--runs', '5'], { root: product });
    assert.doesNotMatch(again.lines.join('|'), /edge four/);
    assert.match(again.lines[0], /\(n=3\)/);
  });
});

test('the CLI entry prints a refusal for a hostile name without echo', () => {
  const { product } = project([]);
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'plan-check.mjs'), 'read', '2026-10-30 22.42 - bad name x'], { cwd: product, encoding: 'utf8' });
  assert.equal(r.status, 3);
  assert.doesNotMatch(r.stdout + r.stderr, /bad name x/);
});

