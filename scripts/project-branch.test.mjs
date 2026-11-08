import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { main as worktree } from './worktree.mjs';
import { main as tierSet } from './tier-set.mjs';
import { runRef } from './rule-check.mjs';
import { isRunName } from '../mods/lib/reprompt-gate.mjs';

// v2 project runs: the run branch, the worktree refs and the readers that take a run name.
const ID = 'P20261108.000001';
const RUN = `${ID}-22.25.00`;
const T1 = `${ID}-T1`;
const T2 = `${ID}-T2`;
const LEGACY = 'demo';
const V11 = '2026-11-08 22.25 - Login Idea';
const V11_BRANCH = '2026-11-08-2225-login-idea';
const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

// The scripts read the user config through HOME; every home variable points at an empty folder for the whole file.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'project-branch-home-'));
const SAVED = {};
for (const key of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'APPDATA', 'MCSPARROW_HOME']) {
  SAVED[key] = process.env[key];
  process.env[key] = HOME;
}
const GLOBAL_CONFIG = path.join(HOME, 'gitconfig');
fs.writeFileSync(GLOBAL_CONFIG, '');

const bases = [HOME];
after(() => {
  for (const key of Object.keys(SAVED)) {
    if (SAVED[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED[key];
  }
  for (const b of bases) fs.rmSync(b, { recursive: true, force: true });
});

const gitEnv = () => ({ ...process.env, GIT_CONFIG_GLOBAL: GLOBAL_CONFIG, GIT_CONFIG_NOSYSTEM: '1' });

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: gitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\n$/, '');
}

// A repo whose first branch is the run branch of `branch`; the run folder `folder` sits under .company/work.
function makeRepo({ folder = RUN, branch = ID } = {}) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'project-branch-')));
  bases.push(base);
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', `--initial-branch=aico/${branch}`);
  for (const [k, v] of [['user.name', 'Test'], ['user.email', 'test@example.com'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) {
    git(repo, 'config', k, v);
  }
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '--message=base');
  const dir = path.join(repo, '.company', 'work', folder);
  fs.mkdirSync(dir, { recursive: true });
  const calls = [];
  const hook = (n, d) => {
    if (n === 'git') calls.push(d);
  };
  const eventsFile = path.join(dir, 'worktrees.jsonl');
  return {
    base, repo, dir, calls,
    g: (...a) => git(repo, ...a),
    at: (d, ...a) => git(d, ...a),
    head: () => git(repo, 'rev-parse', 'HEAD'),
    wtRoot: path.join(base, 'repo.aico-wt'),
    run: (...args) => worktree(args, { root: repo, now: NOW, hook }),
    events: () => (fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  };
}

// The plan-tasks record of an open wave whose records hold full ticket IDs; the plan lists them by number.
function writeWave(r, ids) {
  const at = '2026-11-08T10:00:00Z';
  const num = (id) => Number(id.slice(id.lastIndexOf('-T') + 2));
  const byNumber = [...ids].sort((a, b) => num(a) - num(b));
  const planText = `# Plan\n\n## Tasks\n\n${byNumber.map((id) => `### ${id} title of ${id}\n`).join('\n')}`;
  fs.writeFileSync(path.join(r.dir, '02-plan.md'), planText);
  const hash = crypto.createHash('sha256').update(planText).digest('hex').slice(0, 12);
  const lines = [{ v: 1, at, ev: 'begin', plan: '02-plan.md', hash, cap: 3, mode: 'waves', tasks: ids.length, ow: [] }];
  for (const id of ids) lines.push({ v: 1, at, ev: 'start', task: id, round: 0, ow: [] });
  fs.writeFileSync(path.join(r.dir, 'parallel.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

// Adds the worktree of a local task id and commits one file in it.
function task(r, slug, id, file) {
  const res = r.run('add', slug, id, '--base', r.head());
  assert.equal(res.code, 0, res.lines.join('\n'));
  const wt = res.lines[0].replace(/^Worktree: /, '');
  fs.writeFileSync(path.join(wt, file), `${id}\n`);
  r.at(wt, 'add', '-A');
  r.at(wt, 'commit', '--quiet', `--message=${id}`);
  return wt;
}

describe('worktree on a v2 run', () => {
  test('add: the worktree sits under the project ID and its branch is aico-wt/<ID>/t<n>', () => {
    const r = makeRepo();
    const base = r.head();
    const res = r.run('add', RUN, 't1', '--base', base);
    const wt = path.join(r.wtRoot, ID, 't1');
    assert.deepEqual(res, { code: 0, lines: [`Worktree: ${wt}`] });
    assert.ok(fs.existsSync(path.join(wt, 'a.txt')));
    assert.equal(r.g('rev-parse', '--verify', `refs/heads/aico-wt/${ID}/t1`), base);
    assert.equal(r.events()[0].task, 't1');
  });

  test('add: a second add of the same task is refused, and a run folder missing is refused', () => {
    const r = makeRepo();
    assert.equal(r.run('add', RUN, 't1', '--base', r.head()).code, 0);
    const again = r.run('add', RUN, 't1', '--base', r.head());
    assert.equal(again.code, 3);
    assert.match(again.lines[0], /already added/);
    const other = r.run('add', `${ID}-22.25.01`, 't2', '--base', r.head());
    assert.equal(other.code, 3);
    assert.equal(r.g('for-each-ref', `refs/heads/aico-wt/${ID}/t2`), '');
  });

  test('add: HEAD must be the run branch aico/<ID>', () => {
    const r = makeRepo();
    const base = r.head();
    r.g('checkout', '--quiet', '-b', 'other');
    const res = r.run('add', RUN, 't1', '--base', base);
    assert.equal(res.code, 3);
    assert.match(res.lines[0], new RegExp(`HEAD is not refs/heads/aico/${ID.replace('.', '\\.')}$`));
    assert.equal(r.g('for-each-ref', 'refs/heads/aico-wt/'), '');
  });

  test('add: names that are not a v2 run are refused before any git call', () => {
    const r = makeRepo();
    assert.equal(r.run('add', RUN, 't1', '--base', r.head()).code, 0, 'control: the exact v2 name is accepted');
    const before = r.calls.length;
    const hostile = [
      '-x', '..', 'P20261108.000001/../x', `${ID}.lock`, `${ID}-22.25.00/..`, `${ID}-22.25.00x`, `${ID}-25.00.00`,
      `${ID}-22.60.00`, `${ID}-22.25.60`, `${ID}-22.25`, `${ID}-22.25.00.lock`, 'p20261108.000001-22.25.00',
      'P20261108.000001-22.25.00 Build', 'P20261108.1-22.25.00', 'P20261108.000000-22.25.00', 'P20261308.000001-22.25.00',
      `${ID}-${'x'.repeat(113)}`, 'a'.repeat(129)
    ];
    for (const slug of hostile) {
      const res = r.run('add', slug, 't9', '--base', r.head());
      assert.equal(res.code, 3, slug);
    }
    assert.equal(r.calls.length, before, 'no git call for a refused name');
    assert.equal(r.g('for-each-ref', 'refs/heads/aico-wt/'), `${r.head()} commit\trefs/heads/aico-wt/${ID}/t1`);
  });

  test('add: a v2 folder typed in another letter case is refused and touches nothing', () => {
    const r = makeRepo();
    assert.equal(r.run('add', RUN, 't1', '--base', r.head()).code, 0, 'control');
    const wrong = r.run('add', RUN.toLowerCase(), 't2', '--base', r.head());
    assert.equal(wrong.code, 3);
    assert.equal(r.g('for-each-ref', '--format=%(refname)', 'refs/heads/aico-wt/'), `refs/heads/aico-wt/${ID}/t1`);
  });

  test('add and merge of a project with two runs share one branch id', () => {
    const r = makeRepo();
    fs.mkdirSync(path.join(r.repo, '.company', 'work', `${ID}-23.10.05`));
    const res = r.run('add', `${ID}-23.10.05`, 't3', '--base', r.head());
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.equal(res.lines[0], `Worktree: ${path.join(r.wtRoot, ID, 't3')}`);
  });

  test('merge: an open wave of full ticket IDs merges in plan order and records the local ids', () => {
    const r = makeRepo();
    task(r, RUN, 't2', 'two.txt');
    task(r, RUN, 't1', 'one.txt');
    writeWave(r, [T2, T1]);
    const res = r.run('merge', RUN);
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.equal(res.lines.at(-1), 'merge: 2 of 2');
    const merged = res.lines.filter((l) => l.startsWith('merged '));
    assert.equal(merged.length, 2);
    assert.match(merged[0], /^merged (?:P20261108\.000001-)?T1 [0-9a-f]{7}$/);
    assert.match(merged[1], /^merged (?:P20261108\.000001-)?T2 [0-9a-f]{7}$/);
    assert.deepEqual(r.events().filter((e) => e.ev === 'merge').map((e) => e.task), ['t1', 't2']);
    assert.equal(r.g('show', 'HEAD:one.txt'), 't1');
    assert.equal(r.g('show', 'HEAD:two.txt'), 't2');
    assert.equal(r.g('symbolic-ref', 'HEAD'), `refs/heads/aico/${ID}`);
  });

  test('merge: a task of another project in the wave is refused and nothing merges', () => {
    const r = makeRepo();
    task(r, RUN, 't1', 'one.txt');
    writeWave(r, [T1]);
    const control = r.run('merge', RUN);
    assert.equal(control.code, 0, 'control: the own project ticket merges');
    const r2 = makeRepo();
    task(r2, RUN, 't1', 'one.txt');
    writeWave(r2, [`P20261108.000002-T1`]);
    const res = r2.run('merge', RUN);
    assert.notEqual(res.code, 0);
    assert.equal(r2.events().filter((e) => e.ev === 'merge').length, 0);
  });

  test('leftovers: a v2 worktree and branch are shown by their shape, not by ?', () => {
    const r = makeRepo();
    task(r, RUN, 't1', 'one.txt');
    const res = r.run('leftovers');
    assert.equal(res.code, 0);
    assert.ok(res.lines.includes(`leftover worktree ${ID}/t1`), res.lines.join('\n'));
    assert.ok(res.lines.includes(`leftover branch aico-wt/${ID}/t1`), res.lines.join('\n'));
  });

  test('leftovers: a lowercase, dotted-wrong or task-less ref is shown as ?', () => {
    const r = makeRepo();
    task(r, RUN, 't1', 'one.txt');
    r.g('branch', 'aico-wt/p20261108.000001/t1');
    r.g('branch', `aico-wt/${ID}/zzz`);
    r.g('branch', `aico-wt/${ID}.lock/t1`);
    const res = r.run('leftovers');
    assert.equal(res.code, 0);
    assert.ok(res.lines.includes(`leftover branch aico-wt/${ID}/t1`), 'control: the valid ref is shown');
    assert.equal(res.lines.filter((l) => l === 'leftover branch ?').length, 3, res.lines.join('\n'));
  });

  test('legacy refs are unchanged: a legacy slug and a v1.1 name still use their own branch id', () => {
    const a = makeRepo({ folder: LEGACY, branch: LEGACY });
    const resA = a.run('add', LEGACY, 't1', '--base', a.head());
    assert.deepEqual(resA, { code: 0, lines: [`Worktree: ${path.join(a.wtRoot, LEGACY, 't1')}`] });
    assert.equal(a.g('rev-parse', '--verify', `refs/heads/aico-wt/${LEGACY}/t1`), a.head());
    assert.ok(a.run('leftovers').lines.includes(`leftover branch aico-wt/${LEGACY}/t1`));
    const b = makeRepo({ folder: V11, branch: V11_BRANCH });
    const resB = b.run('add', V11, 't1', '--base', b.head());
    assert.deepEqual(resB, { code: 0, lines: [`Worktree: ${path.join(b.wtRoot, V11_BRANCH, 't1')}`] });
    assert.ok(b.run('leftovers').lines.includes(`leftover branch aico-wt/${V11_BRANCH}/t1`));
  });
});

describe('tier-set on a v2 run', () => {
  const SHA = 'abcdef1234567';
  const RESOLVED = `${SHA}${'0'.repeat(27)}`;
  const PLAN = (head, files) => `# Plan\n## Tasks\n### ${head} a\n- role: backend-engineer\n- files: ${files}\n- depends-on: none\n- parallel: yes\n`;
  const BEGIN = ['--playbook', 'feature', '--triage', 'low', '--short', 'on', '--ceo', 'short'];
  const SHIPPED = path.join(path.resolve(import.meta.dirname, '..'), 'company', 'tier-sets.json');
  const PROJECT = '## Core\n- skills/pipeline: run setup\n- scripts/check.mjs: gate\n\n## Modules\n';

  const subOf = (args) => {
    let i = 0;
    while (i < args.length && (args[i] === '-c' || args[i].startsWith('--no-') || args[i] === '--literal-pathspecs')) i += args[i] === '-c' ? 2 : 1;
    return args.slice(i);
  };

  function fixture(slug = RUN) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-branch-tier-'));
    bases.push(root);
    const pluginRoot = path.join(root, 'plugin');
    fs.mkdirSync(path.join(pluginRoot, 'company'), { recursive: true });
    fs.copyFileSync(SHIPPED, path.join(pluginRoot, 'company', 'tier-sets.json'));
    const product = path.join(root, 'product');
    const dir = path.join(product, '.company', 'work', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(product, '.company', 'project.md'), PROJECT);
    const calls = [];
    const fakeGit = (args) => {
      const sub = subOf(args);
      calls.push(sub);
      if (sub[0] === 'rev-parse' && sub[1] === '--show-toplevel') return Buffer.from(`${product}\n`);
      if (sub[0] === 'rev-parse' && sub[1] === '--git-path') return Buffer.from('.git/info/grafts\n');
      if (sub[0] === 'symbolic-ref') return Buffer.from(`refs/heads/aico/${ID}\n`);
      if (sub[0] === 'rev-parse' && sub[1] === '--verify') return Buffer.from(`${RESOLVED}\n`);
      if (sub[0] === 'rev-parse' && sub[1] === '--show-object-format') return Buffer.from('sha1\n');
      if (sub[0] === 'rev-parse' && typeof sub[1] === 'string' && sub[1].startsWith('--disambiguate=')) return Buffer.from(`${RESOLVED}\n`);
      if (sub[0] === 'cat-file' && sub[1] === '-t') return Buffer.from('commit\n');
      if (sub[0] === 'cat-file' && sub[1] === 'blob') return Buffer.from(PROJECT);
      return Buffer.alloc(0);
    };
    return {
      slug, dir, calls, product,
      record: path.join(dir, 'tier-path.jsonl'),
      run: (...args) => tierSet(args, { now: NOW, root: product, pluginRoot, git: fakeGit }),
      plan: (text) => fs.writeFileSync(path.join(dir, '02-plan.md'), text),
      lines: () => fs.readFileSync(path.join(dir, 'tier-path.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    };
  }

  test('begin and read accept the v2 run name and print it back', () => {
    const f = fixture();
    const begun = f.run('begin', f.slug, ...BEGIN, '--base', SHA);
    assert.equal(begun.code, 0, begun.lines.join('\n'));
    const view = JSON.parse(f.run('read', f.slug).lines[0]);
    assert.equal(view.slug, RUN);
    assert.equal(view.state, 'on');
  });

  test('--plan reads a plan whose task head is <ProjectID>-T<n>', () => {
    const f = fixture();
    assert.equal(f.run('begin', f.slug, ...BEGIN, '--base', SHA).code, 0);
    f.plan(PLAN(T1, 'docs/contracts/x.md, scripts/lessons.mjs'));
    const r = f.run('sync', f.slug, '--plan', '02-plan.md', '--base', SHA);
    assert.ok(r.lines.includes('check: high: contract docs/contracts/x.md'), r.lines.join('\n'));
    assert.deepEqual(f.lines()[1], { v: 1, at: '2026-11-08T12:00:00Z', ev: 'raise', tier: 'high', cause: 'plan' });
  });

  test('--plan: a clean v2 plan is none forced high; another project head is not a task of this run', () => {
    const f = fixture();
    assert.equal(f.run('begin', f.slug, ...BEGIN, '--base', SHA).code, 0);
    f.plan(PLAN(T1, 'scripts/lessons.mjs'));
    assert.equal(f.run('sync', f.slug, '--plan', '02-plan.md', '--base', SHA).lines.at(-1), 'check: 1 paths, none forced high');
    f.plan(PLAN(`P20261108.000002-T1`, 'scripts/lessons.mjs'));
    const other = f.run('sync', f.slug, '--plan', '02-plan.md', '--base', SHA);
    assert.ok(other.lines.includes('check: high: plan files unknown'), other.lines.join('\n'));
  });

  test('--diff reads the run branch refs/heads/aico/<ProjectID>', () => {
    const f = fixture();
    assert.equal(f.run('begin', f.slug, ...BEGIN, '--base', SHA).code, 0);
    f.calls.length = 0;
    const r = f.run('sync', f.slug, '--diff', '--base', SHA);
    assert.equal(r.code, 0, r.lines.join('\n'));
    const diff = f.calls.find((s) => s[0] === 'diff');
    assert.ok(diff, 'a committed diff was asked for');
    assert.ok(diff.includes(`refs/heads/aico/${ID}`), JSON.stringify(diff));
    assert.ok(f.calls.some((s) => s[0] === 'rev-parse' && s.includes(`refs/heads/aico/${ID}^{commit}`)));
  });

  test('near-miss run names are refused with exit 3 and write nothing', () => {
    const f = fixture();
    assert.equal(f.run('begin', f.slug, ...BEGIN, '--base', SHA).code, 0, 'control');
    for (const slug of ['p20261108.000001-22.25.00', `${ID}-22.25`, `${ID}.lock`, '..', '-x', `${ID}-22.25.00/../x`, 'a'.repeat(129)]) {
      const r = f.run('read', slug);
      assert.equal(r.code, 3, slug);
    }
    assert.equal(fs.readdirSync(path.join(f.product, '.company', 'work')).length, 1);
  });
});

describe('rule-check run ref', () => {
  test('a v2 run name gives refs/heads/aico/<ProjectID>', () => {
    assert.equal(runRef(RUN), `refs/heads/aico/${ID}`);
    assert.equal(runRef(`${ID}-00.00.00`), `refs/heads/aico/${ID}`);
    assert.equal(runRef('P20261108.123456789-09.05.07'), 'refs/heads/aico/P20261108.123456789');
  });

  test('near misses give null', () => {
    assert.equal(runRef(RUN), `refs/heads/aico/${ID}`, 'control');
    for (const name of [
      '-x', '..', 'P20261108.000001/../x', `${ID}.lock`, `${ID}-22.25`, `${ID}-22.25.60`, 'p20261108.000001-22.25.00',
      'P20261108.1-22.25.00', 'P20261108.000000-22.25.00', 'P20261308.000001-22.25.00', `${RUN}/..`, `${RUN} `, `${ID}-${'x'.repeat(113)}`,
      'a'.repeat(129), '', null, undefined, 7
    ]) assert.equal(runRef(name), null, String(name));
  });

  test('legacy and v1.1 refs are unchanged', () => {
    assert.equal(runRef(LEGACY), 'refs/heads/aico/demo');
    assert.equal(runRef(V11), `refs/heads/aico/${V11_BRANCH}`);
    assert.equal(runRef('2026-11-08 22.25 - Login Idea Draft 2'), 'refs/heads/aico/2026-11-08-2225-login-idea-draft-2');
  });
});

describe('reprompt gate run name', () => {
  test('a v2 name is a run name', () => {
    assert.equal(isRunName(RUN), true);
    assert.equal(isRunName('P20261231.999999-23.59.59'), true);
    assert.equal(isRunName('P20261108.1000000-00.00.00'), true);
  });

  test('legacy forms stay accepted', () => {
    assert.equal(isRunName(RUN), true, 'control');
    assert.equal(isRunName('reprompt-20261108-2225'), true);
    assert.equal(isRunName('2026-11-08 22.25 - Reprompt Login'), true);
  });

  test('near misses and hostile names are refused', () => {
    assert.equal(isRunName(RUN), true, 'control');
    for (const name of [
      'p20261108.000001-22.25.00', 'P20261108.000001', `${ID}-22.25`, `${ID}-22.25.60`, `${ID}-24.00.00`, `${ID}-22.25.00 Build`,
      `${ID}-22.25.00 Draft`, `${ID}-22.25.00/..`, `${ID}-22.25.00\n`, ` ${RUN}`, `${RUN}x`, `${ID}.lock-22.25.00`, 'P20261108.1-22.25.00',
      'P20261108.000000-22.25.00', 'P20261308.000001-22.25.00', `${ID}-${'x'.repeat(113)}`, '..', '-x', '', null, undefined, 7, {}
    ]) assert.equal(isRunName(name), false, String(name));
  });
});
