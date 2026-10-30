import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { main, readWorktrees, isGitattributesName } from './worktree.mjs';
import { readParallel } from './plan-tasks.mjs';

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const SLUG = 'demo';

// The script's own git calls read the user config through HOME, so it points at an empty folder for the whole file.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-home-'));
const SAVED = {};
for (const key of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'APPDATA']) {
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

const setupEnv = () => ({ ...process.env, GIT_CONFIG_GLOBAL: GLOBAL_CONFIG, GIT_CONFIG_NOSYSTEM: '1' });

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: setupEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\n$/, '');
}

// linked: the repo is reached through a symlinked folder (a junction on win32); the script must print and use real paths.
function makeRepo({ name = 'repo', linked = false } = {}) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-')));
  bases.push(base);
  let parent = base;
  let realParent = base;
  if (linked) {
    realParent = path.join(base, 'real');
    parent = path.join(base, 'link');
    fs.mkdirSync(realParent);
    fs.symlinkSync(realParent, parent, process.platform === 'win32' ? 'junction' : 'dir');
  }
  const repo = path.join(parent, name);
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', `--initial-branch=aico/${SLUG}`);
  for (const [k, v] of [['user.name', 'Test'], ['user.email', 'test@example.com'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) {
    git(repo, 'config', k, v);
  }
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'bee\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '--message=base');
  fs.mkdirSync(path.join(repo, '.company', 'work', SLUG), { recursive: true });
  const calls = [];
  const hooks = {};
  const hook = (n, d) => {
    if (n === 'git') calls.push(d);
    hooks[n]?.(d);
  };
  const r = {
    base, repo, calls, hooks,
    g: (...a) => git(repo, ...a),
    at: (dir, ...a) => git(dir, ...a),
    head: () => git(repo, 'rev-parse', 'HEAD'),
    wtRoot: path.join(realParent, `${name}.aico-wt`),
    run: (...args) => main(args, { root: repo, now: NOW, hook }),
    runWith: (opts, ...args) => main(args, { root: repo, now: NOW, hook, ...opts }),
    record: () => path.join(repo, '.company', 'work', SLUG, 'worktrees.jsonl'),
    events: () => (fs.existsSync(path.join(repo, '.company', 'work', SLUG, 'worktrees.jsonl'))
      ? fs.readFileSync(path.join(repo, '.company', 'work', SLUG, 'worktrees.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [])
  };
  return r;
}

// The plan-tasks record of an open wave: the tasks start in the order given, the plan lists them by number.
function writeWave(r, ids) {
  const at = '2026-10-29T10:00:00Z';
  const dir = path.join(r.repo, '.company', 'work', SLUG);
  const byNumber = [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const planText = `# Plan\n\n## Tasks\n\n${byNumber.map((id) => `### ${id} title of ${id}\n`).join('\n')}`;
  fs.writeFileSync(path.join(dir, '02-plan.md'), planText);
  const hash = crypto.createHash('sha256').update(planText).digest('hex').slice(0, 12);
  const lines = [{ v: 1, at, ev: 'begin', plan: '02-plan.md', hash, cap: 3, mode: 'waves', tasks: ids.length, ow: [] }];
  for (const id of ids) lines.push({ v: 1, at, ev: 'start', task: id, round: 0, ow: [] });
  fs.writeFileSync(path.join(r.repo, '.company', 'work', SLUG, 'parallel.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

// Adds the worktree and commits one file in it. Returns the worktree path.
function task(r, id, file, content) {
  const res = r.run('add', SLUG, id, '--base', r.head());
  assert.equal(res.code, 0, res.lines.join('\n'));
  const wt = res.lines[0].replace(/^Worktree: /, '');
  if (file) {
    fs.mkdirSync(path.dirname(path.join(wt, file)), { recursive: true });
    fs.writeFileSync(path.join(wt, file), content);
    r.at(wt, 'add', '-A');
    r.at(wt, 'commit', '--quiet', `--message=${id}`);
  }
  return wt;
}

const FORBIDDEN = new Set(['-X', '-s', '--strategy', '--strategy-option', '--ours', '--theirs', 'reset', 'checkout', 'stash']);

describe('add', () => {
  test('prints the one line, records the add and makes branch and folder', () => {
    const r = makeRepo();
    const base = r.head();
    const res = r.run('add', SLUG, 't1', '--base', base);
    const wt = path.join(r.wtRoot, SLUG, 't1');
    assert.deepEqual(res, { code: 0, lines: [`Worktree: ${wt}`] });
    assert.ok(fs.existsSync(path.join(wt, 'a.txt')));
    assert.equal(r.g('rev-parse', '--verify', `aico-wt/${SLUG}/t1`), base);
    const [ev] = r.events();
    assert.deepEqual({ ...ev, at: undefined }, { v: 1, at: undefined, ev: 'add', task: 't1', base });
    const view = readWorktrees(r.repo, SLUG);
    assert.equal(view.state, 'on');
    assert.equal(view.events.length, 1);
  });

  test('refuses an existing branch', () => {
    const r = makeRepo();
    r.g('branch', `aico-wt/${SLUG}/t1`);
    const res = r.run('add', SLUG, 't1', '--base', r.head());
    assert.equal(res.code, 3);
    assert.match(res.lines[0], /^refused: branch exists/);
    assert.equal(r.events().length, 0);
  });

  test('refuses an existing path', () => {
    const r = makeRepo();
    fs.mkdirSync(path.join(r.wtRoot, SLUG, 't1'), { recursive: true });
    assert.equal(r.run('add', SLUG, 't1', '--base', r.head()).code, 3);
    assert.equal(r.g('for-each-ref', 'refs/heads/aico-wt/'), '');
  });

  test('refuses a linked segment', () => {
    const r = makeRepo();
    const elsewhere = path.join(r.base, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.mkdirSync(r.wtRoot);
    fs.symlinkSync(elsewhere, path.join(r.wtRoot, SLUG), 'junction');
    const res = r.run('add', SLUG, 't1', '--base', r.head());
    assert.equal(res.code, 3);
    assert.match(res.lines[0], /link or not a folder/);
    assert.deepEqual(fs.readdirSync(elsewhere), []);
    assert.equal(r.g('for-each-ref', 'refs/heads/aico-wt/'), '');
  });

  test('refuses a worktree root that is a file', () => {
    const r = makeRepo();
    fs.writeFileSync(r.wtRoot, 'x');
    assert.equal(r.run('add', SLUG, 't1', '--base', r.head()).code, 3);
  });

  test('refuses when HEAD is off the run ref', () => {
    const r = makeRepo();
    const base = r.head();
    r.g('checkout', '--quiet', '-b', 'other');
    const res = r.run('add', SLUG, 't1', '--base', base);
    assert.equal(res.code, 3);
    assert.match(res.lines[0], /HEAD is not refs\/heads\/aico\/demo/);
  });

  test('refuses a base that is not the run branch commit, and a bad base', () => {
    const r = makeRepo();
    const old = r.head();
    fs.writeFileSync(path.join(r.repo, 'c.txt'), 'c\n');
    r.g('add', '-A');
    r.g('commit', '--quiet', '--message=next');
    assert.equal(r.run('add', SLUG, 't1', '--base', old).code, 3);
    assert.equal(r.run('add', SLUG, 't1', '--base', 'HEAD').code, 3);
    assert.equal(r.run('add', SLUG, 't1', '--base', old.slice(0, 10)).code, 3);
  });

  test('proto takes any base that is an ancestor of the run branch', () => {
    const r = makeRepo();
    const old = r.head();
    fs.writeFileSync(path.join(r.repo, 'c.txt'), 'c\n');
    r.g('add', '-A');
    r.g('commit', '--quiet', '--message=next');
    const res = r.run('add', SLUG, 'proto', '--base', old);
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.equal(r.g('rev-parse', `aico-wt/${SLUG}/proto`), old);
    assert.equal(r.run('add', SLUG, 'proto', '--base', '0'.repeat(40)).code, 3);
  });

  test('refuses a 201-character path and accepts 200', () => {
    const probe = makeRepo({ name: 'r' });
    const fixed = path.join(path.dirname(probe.repo), 'r.aico-wt', SLUG, 't1').length;
    const longName = 'r'.repeat(1 + 201 - fixed);
    const r = makeRepo({ name: longName });
    assert.equal(path.join(r.wtRoot, SLUG, 't1').length, 201);
    const res = r.run('add', SLUG, 't1', '--base', r.head());
    assert.equal(res.code, 3);
    assert.match(res.lines[0], /over 200 characters/);
    const ok = makeRepo({ name: longName.slice(1) });
    assert.equal(path.join(ok.wtRoot, SLUG, 't1').length, 200);
    assert.equal(ok.run('add', SLUG, 't1', '--base', ok.head()).code, 0);
  });

  test('refuses a second add of a live id', () => {
    const r = makeRepo();
    task(r, 't1');
    assert.equal(r.run('add', SLUG, 't1', '--base', r.head()).code, 3);
  });

  test('refuses a root that is not the repository top level', () => {
    const r = makeRepo();
    const sub = path.join(r.repo, 'sub');
    fs.mkdirSync(sub);
    const res = main(['add', SLUG, 't1', '--base', r.head()], { root: sub, now: NOW });
    assert.equal(res.code, 3);
  });

  test('hostile arguments are refused before any git call', () => {
    const r = makeRepo();
    const base = r.head();
    const bad = [
      ['add', 'Bad_Slug', 't1', '--base', base], ['add', SLUG, 'T1', '--base', base], ['add', SLUG, 't1x2', '--base', base],
      ['add', SLUG, 't1', '--base', base, '--base', base], ['add', SLUG, 't1', '--force', '--base', base],
      ['add', SLUG, 't1'], ['add', SLUG, 't1', '--base'], ['add', `${SLUG}\u0000`, 't1', '--base', base],
      ['add', SLUG, 't1', '--base', `${base}\n`], ['add', SLUG, 't1', '--base', 'a'.repeat(5000)],
      ['add', SLUG, 't1', '--base', `${base}‮`], ['nope'], [], ['cleanup', SLUG, '--archive', '--archive'],
      ['cleanup', SLUG, '--force'], ['leftovers', 'x'], ['merge'], ['protocheck', '../x'], [7]
    ];
    for (const args of bad) {
      r.calls.length = 0;
      const res = r.run(...args);
      assert.equal(res.code, 3, JSON.stringify(args).slice(0, 80));
      assert.equal(r.calls.length, 0);
    }
  });
});

describe('changed', () => {
  test('lists modified, untracked and both sides of a rename', () => {
    const r = makeRepo();
    const wt = task(r, 't1');
    fs.writeFileSync(path.join(wt, 'a.txt'), 'changed\n');
    fs.writeFileSync(path.join(wt, 'new.txt'), 'new\n');
    fs.mkdirSync(path.join(wt, 'dir'));
    fs.writeFileSync(path.join(wt, 'dir', 'deep.txt'), 'deep\n');
    r.at(wt, 'mv', 'b.txt', 'b2.txt');
    const res = r.run('changed', SLUG, 't1');
    assert.equal(res.code, 0);
    assert.deepEqual([...res.lines].sort(), ['a.txt', 'b.txt', 'b2.txt', 'dir/deep.txt', 'new.txt']);
  });

  test('refuses an id without a live worktree', () => {
    const r = makeRepo();
    assert.equal(r.run('changed', SLUG, 't1').code, 3);
  });
});

describe('merge', () => {
  test('follows plan order, not start order, and records commit and tip', () => {
    const r = makeRepo();
    task(r, 't2', 'two.txt', '2\n');
    task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T2', 'T1']);
    const tip2 = r.g('rev-parse', `aico-wt/${SLUG}/t2`);
    const tip1 = r.g('rev-parse', `aico-wt/${SLUG}/t1`);
    assert.deepEqual(readParallel(r.repo, SLUG).open_wave, ['T2', 'T1']);
    const res = r.run('merge', SLUG);
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.match(res.lines[0], /^merged T1 [0-9a-f]{7}$/);
    assert.match(res.lines[1], /^merged T2 [0-9a-f]{7}$/);
    assert.equal(res.lines[2], 'merge: 2 of 2');
    const merges = r.events().filter((e) => e.ev === 'merge');
    assert.deepEqual(merges.map((e) => e.task), ['t1', 't2']);
    assert.deepEqual(merges.map((e) => e.tip), [tip1, tip2]);
    assert.equal(r.g('rev-parse', `refs/heads/aico/${SLUG}^2`), tip2);
    assert.equal(r.g('rev-parse', `refs/heads/aico/${SLUG}`), merges[1].commit);
    assert.ok(fs.existsSync(path.join(r.repo, 'one.txt')) && fs.existsSync(path.join(r.repo, 'two.txt')));
    // nothing is deleted
    assert.equal(r.g('for-each-ref', '--format=%(refname)', 'refs/heads/aico-wt/').split('\n').length, 2);
    assert.ok(fs.existsSync(path.join(r.wtRoot, SLUG, 't1')));
  });

  test('a conflict aborts with conflict lines, exit 2, and keeps the earlier merge', () => {
    const r = makeRepo();
    task(r, 't1', 'a.txt', 'one\nTWO-from-t1\nthree\n');
    task(r, 't2', 'a.txt', 'one\nTWO-from-t2\nthree\n');
    task(r, 't3', 'c.txt', 'c\n');
    writeWave(r, ['T1', 'T2', 'T3']);
    const res = r.run('merge', SLUG);
    assert.equal(res.code, 2);
    assert.match(res.lines[0], /^merged T1 /);
    assert.deepEqual(res.lines.slice(1), ['conflict T2 a.txt', 'merge: stopped at T2', 'merge: 1 of 3']);
    assert.equal(r.g('status', '--porcelain=v1', '--untracked-files=no'), '');
    assert.equal(fs.readFileSync(path.join(r.repo, 'a.txt'), 'utf8'), 'one\nTWO-from-t1\nthree\n');
    assert.ok(!fs.existsSync(path.join(r.repo, 'c.txt')));
    const evs = r.events().map((e) => `${e.ev}:${e.task}`);
    assert.deepEqual(evs, ['add:t1', 'add:t2', 'add:t3', 'merge:t1', 'conflict:t2']);
    assert.deepEqual(r.events().at(-1).paths, ['a.txt']);
  });

  test('an id with no worktree prints main-tree', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1', 'T9']);
    const res = r.run('merge', SLUG);
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.match(res.lines[0], /^merged T1 /);
    assert.equal(res.lines[1], 'main-tree T9');
    assert.equal(res.lines.at(-1), 'merge: 2 of 2');
  });

  test('refuses a dirty main tree and a main tree off the run ref', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    fs.writeFileSync(path.join(r.repo, 'stray.txt'), 'x');
    assert.equal(r.run('merge', SLUG).code, 3);
    fs.rmSync(path.join(r.repo, 'stray.txt'));
    r.g('checkout', '--quiet', '-b', 'other');
    assert.equal(r.run('merge', SLUG).code, 3);
    assert.equal(r.events().filter((e) => e.ev === 'merge').length, 0);
  });

  test('every git call has the three leading options, --end-of-options before revisions, and no forbidden option', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    task(r, 't2', 'a.txt', 'changed\n');
    writeWave(r, ['T1', 'T2']);
    r.calls.length = 0;
    assert.equal(r.run('merge', SLUG).code, 0);
    assert.equal(r.run('cleanup', SLUG).code, 0);
    assert.equal(r.run('leftovers').code, 0);
    assert.ok(r.calls.length > 20);
    for (const { args } of r.calls) {
      assert.deepEqual(args.slice(0, 4), ['--no-replace-objects', '--no-optional-locks', '-c', 'core.fsmonitor=false'], args.join(' '));
      for (const a of args) assert.ok(!FORBIDDEN.has(a), `forbidden ${a}: ${args.join(' ')}`);
      const eoo = args.indexOf('--end-of-options');
      args.forEach((a, i) => {
        const revLike = /^[0-9a-f]{40}(?:\^.*)?$/.test(a) || /^refs\/heads\//.test(a) || /^aico-wt\//.test(a);
        if (revLike && args[i - 1] !== '-b') assert.ok(eoo !== -1 && eoo < i, `${a} before --end-of-options: ${args.join(' ')}`);
      });
    }
  });

  test('the environment holds no GIT_ key but the two fixed ones, and a parent GIT_ key reaches no call', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    const keep = { ...process.env };
    process.env.Git_Dir = path.join(r.base, 'nowhere');
    process.env.GIT_WORK_TREE = path.join(r.base, 'nowhere');
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'merge.x.driver';
    process.env.GIT_CONFIG_VALUE_0 = 'true';
    process.env.GIT_GRAFT_FILE = path.join(r.base, 'grafts');
    try {
      const res = r.run('merge', SLUG);
      assert.equal(res.code, 0, res.lines.join('\n'));
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
      Object.assign(process.env, keep);
    }
    for (const { env } of r.calls) {
      const keys = Object.keys(env).filter((k) => k.toUpperCase().startsWith('GIT_'));
      assert.ok(keys.every((k) => ['GIT_NO_REPLACE_OBJECTS', 'GIT_GRAFT_FILE'].includes(k)), keys.join());
      if (env.GIT_GRAFT_FILE) assert.ok(!fs.existsSync(env.GIT_GRAFT_FILE) && env.GIT_GRAFT_FILE !== path.join(r.base, 'grafts'));
    }
  });

  test('a branch.<name>.mergeOptions of -s ours: driver risk, exit 2, nothing merged, cleanup keeps the branch', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    fs.appendFileSync(path.join(r.repo, '.git', 'config'), `[branch "aico/${SLUG}"]\n\tmergeOptions = -s ours\n`);
    const res = r.run('merge', SLUG);
    assert.equal(res.code, 2);
    assert.equal(res.lines[0], 'merge: driver risk branch-mergeoptions T1');
    assert.ok(!fs.existsSync(path.join(r.repo, 'one.txt')));
    assert.equal(r.events().filter((e) => e.ev === 'merge').length, 0);
    const c = r.run('cleanup', SLUG);
    assert.equal(c.code, 2);
    assert.deepEqual(c.lines, ['kept t1: unmerged work']);
    assert.equal(r.g('rev-parse', '--verify', `aico-wt/${SLUG}/t1`).length, 40);
  });

  test('T2 started first, T1 still merges first; a plan that changed after begin refuses the merge', () => {
    const r = makeRepo();
    task(r, 't2', 'two.txt', '2\n');
    task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T2', 'T1']);
    const planFile = path.join(r.repo, '.company', 'work', SLUG, '02-plan.md');
    const planText = fs.readFileSync(planFile, 'utf8');
    fs.writeFileSync(planFile, `${planText}\nchanged\n`);
    const refused = r.run('merge', SLUG);
    assert.equal(refused.code, 3);
    assert.match(refused.lines[0], /^refused: /);
    assert.equal(r.events().filter((e) => e.ev === 'merge').length, 0);
    fs.writeFileSync(planFile, planText);
    const res = r.run('merge', SLUG);
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.deepEqual(res.lines.map((l) => l.split(' ').slice(0, 2).join(' ')), ['merged T1', 'merged T2', 'merge: 2']);
  });

  test('a pull.twohead or pull.octopus setting in the repo config: driver risk pull-strategy, exit 2, nothing merged, cleanup keeps the branch', () => {
    for (const [key, value] of [['pull.twohead', 'ours'], ['pull.octopus', 'ours'], ['pull.twohead', 'ort']]) {
      const r = makeRepo();
      task(r, 't1', 'one.txt', '1\n');
      writeWave(r, ['T1']);
      r.g('config', key, value);
      const res = r.run('merge', SLUG);
      assert.equal(res.code, 2, `${key} ${value}`);
      assert.equal(res.lines[0], 'merge: driver risk pull-strategy T1');
      assert.ok(!fs.existsSync(path.join(r.repo, 'one.txt')));
      assert.equal(r.events().filter((e) => e.ev === 'merge').length, 0);
      assert.ok(!r.calls.some((c) => c.args.includes('--no-ff')));
      assert.deepEqual(r.run('cleanup', SLUG), { code: 2, lines: ['kept t1: unmerged work'] });
      assert.equal(r.g('rev-parse', '--verify', `aico-wt/${SLUG}/t1`).length, 40);
    }
  });

  test('pull.twohead ours in the global config reaches the script through HOME: driver risk, nothing merged', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    const file = path.join(HOME, '.gitconfig');
    fs.writeFileSync(file, '[pull]\n\ttwohead = ours\n');
    try {
      const res = r.run('merge', SLUG);
      assert.equal(res.code, 2, res.lines.join('\n'));
      assert.equal(res.lines[0], 'merge: driver risk pull-strategy T1');
      assert.ok(!fs.existsSync(path.join(r.repo, 'one.txt')));
      assert.equal(r.events().filter((e) => e.ev === 'merge').length, 0);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  test('a commit made in the worktree after tip-read: the merge takes the tip read, cleanup keeps the branch', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    r.hooks['tip-read'] = () => {
      fs.writeFileSync(path.join(wt, 'late.txt'), 'late\n');
      r.at(wt, 'add', '-A');
      r.at(wt, 'commit', '--quiet', '--message=late');
    };
    assert.equal(r.run('merge', SLUG).code, 0);
    assert.deepEqual(r.run('cleanup', SLUG), { code: 2, lines: ['kept t1: unmerged work'] });
    assert.ok(fs.existsSync(wt));
    assert.equal(r.g('for-each-ref', '--format=%(refname)', 'refs/heads/aico-wt/'), `refs/heads/aico-wt/${SLUG}/t1`);
  });

  test('a branch and worktree with no add line in the record: record mismatch, not main-tree; strays are named', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    task(r, 't2', 'two.txt', '2\n');
    writeWave(r, ['T1', 'T2']);
    const kept = fs.readFileSync(r.record(), 'utf8').split('\n').filter((l) => l.includes('"t2"')).join('\n');
    fs.writeFileSync(r.record(), `${kept}\n`);
    const res = r.run('merge', SLUG);
    assert.deepEqual(res, { code: 2, lines: ['record mismatch t1'] });
    assert.ok(!fs.existsSync(path.join(r.repo, 'one.txt')) && !fs.existsSync(path.join(r.repo, 'two.txt')));
    assert.deepEqual(r.run('cleanup', SLUG, '--archive'), { code: 2, lines: ['record mismatch t1'] });
    assert.ok(fs.existsSync(path.join(r.wtRoot, SLUG, 't1')));
    r.g('branch', `aico-wt/${SLUG}/t5`);
    r.g('branch', `aico-wt/${SLUG}/x`);
    assert.deepEqual([...r.run('merge', SLUG).lines].sort(), ['record mismatch ?', 'record mismatch t1', 'record mismatch t5']);
  });

  const riskCases = {
    'info/attributes': ['info-attributes', (r) => {
      fs.mkdirSync(path.join(r.repo, '.git', 'info'), { recursive: true });
      fs.writeFileSync(path.join(r.repo, '.git', 'info', 'attributes'), '*.txt merge=union\n');
    }],
    'a merge.x.driver config': ['merge-driver', (r) => r.g('config', 'merge.x.driver', 'true')],
    'a merge.default config': ['merge-default', (r) => r.g('config', 'merge.default', 'x')],
    'a merge attribute on a changed path from the main tree': ['merge-attribute', (r) => {
      fs.writeFileSync(path.join(r.repo, '.gitattributes'), '*.txt merge=union\n');
      r.g('add', '-A');
      r.g('commit', '--quiet', '--message=attrs');
    }]
  };
  for (const [name, [reason, arrange]] of Object.entries(riskCases)) {
    test(`${name}: driver risk, exit 2, nothing merged`, () => {
      const r = makeRepo();
      arrange(r);
      // the base moves for the attribute case, so the task starts after the arrangement
      task(r, 't1', 'one.txt', '1\n');
      writeWave(r, ['T1']);
      const res = r.run('merge', SLUG);
      assert.equal(res.code, 2, res.lines.join('\n'));
      assert.equal(res.lines[0], `merge: driver risk ${reason} T1`);
      assert.equal(r.events().filter((e) => e.ev === 'merge').length, 0);
      assert.ok(!fs.existsSync(path.join(r.repo, 'one.txt')));
    });
  }

  test('a wave branch committing .gitattributes with merge=union: driver risk, nothing merged', () => {
    const r = makeRepo();
    task(r, 't1', '.gitattributes', '*.txt merge=union\n');
    writeWave(r, ['T1']);
    const res = r.run('merge', SLUG);
    assert.equal(res.code, 2);
    assert.equal(res.lines[0], 'merge: driver risk gitattributes-changed T1');
    assert.ok(!fs.existsSync(path.join(r.repo, '.gitattributes')));
  });

  test('the checks run per merge: .gitattributes on the second branch only', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    task(r, 't2', 'sub/.gitattributes', '*.txt merge=union\n');
    task(r, 't3', 'three.txt', '3\n');
    writeWave(r, ['T1', 'T2', 'T3']);
    const res = r.run('merge', SLUG);
    assert.equal(res.code, 2);
    assert.match(res.lines[0], /^merged T1 /);
    assert.equal(res.lines[1], 'merge: driver risk gitattributes-changed T2');
    assert.equal(res.lines.at(-1), 'merge: 1 of 3');
    assert.deepEqual(r.events().filter((e) => e.ev === 'merge').map((e) => e.task), ['t1']);
  });

  test('config risk that appears between merges stops the later merge', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    task(r, 't2', 'two.txt', '2\n');
    writeWave(r, ['T1', 'T2']);
    r.hooks['tip-read'] = ({ id }) => { if (id === 't2') r.g('config', 'merge.x.driver', 'true'); };
    const res = r.run('merge', SLUG);
    assert.equal(res.code, 2);
    assert.equal(res.lines[1], 'merge: driver risk merge-driver T2');
  });

  test('.gitattributes names, with case, trailing dot or space and short-name aliases', () => {
    for (const n of ['.gitattributes', '.GitAttributes', 'a/b/.gitattributes.', '.gitattributes ', '.gitattributes . ', 'x\\GITATT~1', 'GITATT~2', '.gitattributes::$DATA', '.git‌attributes']) {
      assert.equal(isGitattributesName(n), true, JSON.stringify(n));
    }
    for (const n of ['gitattributes', '.gitattributes.txt', 'a.gitattributes', 'GITATT~', 'docs/.gitignore', '']) {
      assert.equal(isGitattributesName(n), false, JSON.stringify(n));
    }
  });

  test('hooks never run: the merge argv holds an absent hooksPath, rerere off and renormalize off', () => {
    const r = makeRepo();
    const hooksDir = path.join(r.base, 'hooks');
    fs.mkdirSync(hooksDir);
    const marker = path.join(r.base, 'ran.txt');
    for (const h of ['post-merge', 'pre-merge-commit', 'commit-msg', 'prepare-commit-msg']) {
      fs.writeFileSync(path.join(hooksDir, h), `#!/bin/sh\necho ${h} >> "${marker.replaceAll('\\', '/')}"\n`);
      fs.chmodSync(path.join(hooksDir, h), 0o755);
    }
    r.g('config', 'core.hooksPath', hooksDir);
    r.g('config', 'rerere.enabled', 'true');
    task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    // a plain merge runs the hook, so the check below means something
    r.g('branch', 'probe');
    r.g('commit', '--quiet', '--allow-empty', '--message=ahead');
    r.g('merge', '--quiet', '--no-ff', '--no-edit', 'probe');
    assert.ok(fs.existsSync(marker), 'the hook runs in a plain merge');
    fs.rmSync(marker);
    r.calls.length = 0;
    const res = r.run('merge', SLUG);
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.ok(!fs.existsSync(marker), 'the hook did not run');
    const m = r.calls.find((c) => c.args.includes('merge') && c.args.includes('--no-ff')).args;
    const hp = m.find((a) => a.startsWith('core.hooksPath='));
    assert.ok(hp && !fs.existsSync(hp.slice('core.hooksPath='.length)));
    assert.ok(m.includes('merge.renormalize=false') && m.includes('rerere.enabled=false') && m.includes('--no-verify'));
    const pins = m.filter((a, i) => m[i - 1] === '-c');
    assert.ok(pins.includes('pull.twohead=ort') && pins.includes('pull.octopus=octopus'), m.join(' '));
    assert.ok(!m.some((a) => /^-s/.test(a) || a.startsWith('--strategy')), m.join(' '));
  });

  test('the task tip read is the one merged when the branch moves after the read', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    const tip = r.g('rev-parse', `aico-wt/${SLUG}/t1`);
    r.hooks['tip-read'] = () => {
      fs.writeFileSync(path.join(wt, 'late.txt'), 'late\n');
      r.at(wt, 'add', '-A');
      r.at(wt, 'commit', '--quiet', '--message=late');
    };
    const res = r.run('merge', SLUG);
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.notEqual(r.g('rev-parse', `aico-wt/${SLUG}/t1`), tip);
    assert.equal(r.g('rev-parse', `refs/heads/aico/${SLUG}^2`), tip);
    assert.equal(r.events().find((e) => e.ev === 'merge').tip, tip);
    assert.ok(!fs.existsSync(path.join(r.repo, 'late.txt')));
  });

  test('a forged remove line for a live worktree: record mismatch, exit 2, nothing merged', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    const head = r.g('rev-parse', `aico-wt/${SLUG}/t1`);
    fs.appendFileSync(r.record(), `${JSON.stringify({ v: 1, at: '2026-10-29T12:00:00Z', ev: 'remove', task: 't1', commit: head })}\n`);
    const res = r.run('merge', SLUG);
    assert.deepEqual(res, { code: 2, lines: ['record mismatch t1'] });
    assert.ok(!fs.existsSync(path.join(r.repo, 'one.txt')));
    const c = r.run('cleanup', SLUG, '--archive');
    assert.deepEqual(c, { code: 2, lines: ['record mismatch t1'] });
    assert.ok(fs.existsSync(path.join(r.wtRoot, SLUG, 't1')));
  });

  test('a recorded worktree that is gone from git is a record mismatch', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    r.g('worktree', 'remove', '--force', wt);
    assert.deepEqual(r.run('merge', SLUG), { code: 2, lines: ['record mismatch t1'] });
  });

  test('a grafts file: merge and cleanup exit 1 with nothing merged or removed, protocheck says unknown', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    task(r, 'proto', 'p.txt', 'p\n');
    writeWave(r, ['T1']);
    fs.mkdirSync(path.join(r.repo, '.git', 'info'), { recursive: true });
    fs.writeFileSync(path.join(r.repo, '.git', 'info', 'grafts'), '');
    const m = r.run('merge', SLUG);
    assert.equal(m.code, 1);
    assert.ok(!fs.existsSync(path.join(r.repo, 'one.txt')));
    const c = r.run('cleanup', SLUG, '--archive');
    assert.equal(c.code, 1);
    assert.ok(fs.existsSync(path.join(r.wtRoot, SLUG, 't1')));
    assert.equal(r.events().filter((e) => e.ev !== 'add').length, 0);
    assert.deepEqual(r.run('protocheck', SLUG), { code: 2, lines: ['prototype: unknown'] });
  });
});

describe('cleanup', () => {
  test('removes merged worktrees and branches after worktree merge', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    task(r, 't2', 'two.txt', '2\n');
    writeWave(r, ['T1', 'T2']);
    assert.equal(r.run('merge', SLUG).code, 0);
    const res = r.run('cleanup', SLUG);
    assert.deepEqual(res, { code: 0, lines: ['removed t1', 'removed t2'] });
    assert.equal(r.g('for-each-ref', 'refs/heads/aico-wt/'), '');
    assert.ok(!fs.existsSync(path.join(r.wtRoot, SLUG, 't1')));
    assert.deepEqual(r.events().filter((e) => e.ev === 'remove').map((e) => e.task), ['t1', 't2']);
    assert.deepEqual(r.run('leftovers'), { code: 0, lines: ['leftovers: none'] });
  });

  test('keeps unmerged work without --archive, and writes the patch with it', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'uncommitted\n');
    const no = r.run('cleanup', SLUG);
    assert.deepEqual(no, { code: 2, lines: ['kept t1: unmerged work'] });
    assert.ok(fs.existsSync(wt));
    const base = r.head();
    const yes = r.run('cleanup', SLUG, '--archive');
    assert.equal(yes.code, 0, yes.lines.join('\n'));
    const patch = path.join(r.repo, '.company', 'work', SLUG, 'worktrees', 't1-20261029T120000Z.patch');
    assert.equal(yes.lines[0], `archived t1 ${patch}`);
    const text = fs.readFileSync(patch, 'utf8');
    assert.match(text, /one\.txt/);
    assert.match(text, /dirty\.txt/);
    assert.ok(!fs.existsSync(wt));
    assert.equal(r.g('for-each-ref', 'refs/heads/aico-wt/'), '');
    const arch = r.events().find((e) => e.ev === 'archive');
    assert.equal(arch.patch, 't1-20261029T120000Z.patch');
    assert.equal(arch.commit.length, 40);
    assert.equal(r.head(), base);
  });

  test('skips a path that is not in all three sources', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    // not in git's list: the branch stays, so the record check names it first
    r.g('worktree', 'remove', '--force', wt);
    assert.equal(r.run('cleanup', SLUG, '--archive').code, 2);
    assert.ok(r.events().every((e) => e.ev === 'add'));
  });

  test('a junction swapped in at <id> after add: skip, nothing removed', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    const elsewhere = path.join(r.base, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, 'keep.txt'), 'keep\n');
    fs.rmSync(wt, { recursive: true, force: true });
    fs.symlinkSync(elsewhere, wt, 'junction');
    const res = r.run('cleanup', SLUG, '--archive');
    assert.equal(res.code, 2);
    assert.deepEqual(res.lines, ['skip t1']);
    assert.ok(fs.existsSync(path.join(elsewhere, 'keep.txt')));
    assert.equal(r.g('rev-parse', '--verify', `aico-wt/${SLUG}/t1`).length, 40);
    assert.ok(r.events().every((e) => e.ev === 'add'));
  });

  test('a branch reached by reachability alone is not removed: a replace ref cannot make it look merged', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    const tip = r.g('rev-parse', `aico-wt/${SLUG}/t1`);
    r.g('replace', tip, r.head());
    const res = r.run('cleanup', SLUG);
    assert.deepEqual(res, { code: 2, lines: ['kept t1: unmerged work'] });
    assert.ok(fs.existsSync(path.join(r.wtRoot, SLUG, 't1')));
    assert.equal(r.g('for-each-ref', '--format=%(refname)', 'refs/heads/aico-wt/'), `refs/heads/aico-wt/${SLUG}/t1`);
  });

  test('a branch merged by hand with -s ours: kept without --archive, archived with it', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    r.g('merge', '--quiet', '-s', 'ours', '--no-edit', `aico-wt/${SLUG}/t1`);
    assert.deepEqual(r.run('cleanup', SLUG), { code: 2, lines: ['kept t1: unmerged work'] });
    const res = r.run('cleanup', SLUG, '--archive');
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.match(res.lines[0], /^archived t1 /);
    assert.ok(!fs.existsSync(wt));
  });

  test('a forged merge line whose tip is the head but whose commit has another ^2: path (b)', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    const head = r.g('rev-parse', `aico-wt/${SLUG}/t1`);
    const forged = r.g('rev-parse', `refs/heads/aico/${SLUG}`);
    fs.appendFileSync(r.record(), `${JSON.stringify({ v: 1, at: '2026-10-29T12:00:00Z', ev: 'merge', task: 't1', commit: forged, tip: head })}\n`);
    assert.deepEqual(r.run('cleanup', SLUG), { code: 2, lines: ['kept t1: unmerged work'] });
    // a merge commit with the wrong second parent
    fs.writeFileSync(path.join(r.repo, 'x.txt'), 'x\n');
    r.g('add', '-A');
    r.g('commit', '--quiet', '--message=other');
    fs.appendFileSync(r.record(), `${JSON.stringify({ v: 1, at: '2026-10-29T12:00:01Z', ev: 'merge', task: 't1', commit: r.head(), tip: head })}\n`);
    assert.deepEqual(r.run('cleanup', SLUG), { code: 2, lines: ['kept t1: unmerged work'] });
  });

  test('a merged branch that gained a commit after the merge: path (b)', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    assert.equal(r.run('merge', SLUG).code, 0);
    fs.writeFileSync(path.join(wt, 'after.txt'), 'after\n');
    r.at(wt, 'add', '-A');
    r.at(wt, 'commit', '--quiet', '--message=after');
    assert.deepEqual(r.run('cleanup', SLUG), { code: 2, lines: ['kept t1: unmerged work'] });
    const yes = r.run('cleanup', SLUG, '--archive');
    assert.match(yes.lines[0], /^archived t1 /);
    assert.match(fs.readFileSync(path.join(r.repo, '.company', 'work', SLUG, 'worktrees', 't1-20261029T120000Z.patch'), 'utf8'), /after\.txt/);
  });

  test('a merged branch with an uncommitted change keeps its work', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    assert.equal(r.run('merge', SLUG).code, 0);
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'dirty\n');
    assert.deepEqual(r.run('cleanup', SLUG), { code: 2, lines: ['kept t1: unmerged work'] });
    assert.ok(fs.existsSync(path.join(wt, 'dirty.txt')));
  });

  test('a worktree switched to another branch: kept, nothing deleted', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    assert.equal(r.run('merge', SLUG).code, 0);
    r.at(wt, 'switch', '--quiet', '--create', 'elsewhere');
    const res = r.run('cleanup', SLUG, '--archive');
    assert.deepEqual(res, { code: 2, lines: ['kept t1: worktree not on its branch'] });
    assert.ok(fs.existsSync(wt));
    assert.equal(r.g('rev-parse', '--verify', `aico-wt/${SLUG}/t1`).length, 40);
  });

  test('a binary file in an archived worktree: git apply of the patch on the base gives the same tree', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    const bytes = Buffer.alloc(512);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    fs.writeFileSync(path.join(wt, 'blob.bin'), bytes);
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'dirty\n');
    const base = r.head();
    r.at(wt, 'add', '-A');
    const want = r.at(wt, 'write-tree');
    const res = r.run('cleanup', SLUG, '--archive');
    assert.equal(res.code, 0, res.lines.join('\n'));
    const patch = res.lines[0].replace(/^archived t1 /, '');
    const scratch = path.join(r.base, 'scratch');
    r.g('worktree', 'add', '--quiet', '--detach', scratch, base);
    r.at(scratch, 'apply', '--index', patch);
    assert.equal(r.at(scratch, 'write-tree'), want);
  });

  test('a patch over the cap: kept, patch not written, worktree and branch still there', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', 'x'.repeat(2000));
    const res = r.runWith({ patchCap: 100 }, 'cleanup', SLUG, '--archive');
    assert.deepEqual(res, { code: 2, lines: ['kept t1: patch not written'] });
    assert.ok(fs.existsSync(wt));
    assert.equal(r.g('rev-parse', '--verify', `aico-wt/${SLUG}/t1`).length, 40);
    assert.ok(r.events().every((e) => e.ev === 'add'));
  });

  test('a read-back mismatch: kept, the patch file stays, worktree and branch still there', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    r.hooks['patch-written'] = ({ file }) => fs.appendFileSync(file, 'tampered');
    const res = r.run('cleanup', SLUG, '--archive');
    assert.deepEqual(res, { code: 2, lines: ['kept t1: patch not written'] });
    const folder = path.join(r.repo, '.company', 'work', SLUG, 'worktrees');
    assert.equal(fs.readdirSync(folder).length, 1);
    assert.ok(fs.existsSync(wt));
    assert.equal(r.g('rev-parse', '--verify', `aico-wt/${SLUG}/t1`).length, 40);
    assert.ok(r.events().every((e) => e.ev === 'add'));
  });

  test('a patch file that cannot be created (name taken): kept, patch not written', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    const folder = path.join(r.repo, '.company', 'work', SLUG, 'worktrees');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 't1-20261029T120000Z.patch'), 'planted');
    assert.deepEqual(r.run('cleanup', SLUG, '--archive'), { code: 2, lines: ['kept t1: patch not written'] });
    assert.equal(fs.readFileSync(path.join(folder, 't1-20261029T120000Z.patch'), 'utf8'), 'planted');
    assert.ok(fs.existsSync(wt));
  });

  test('a commit made between the archive and the deletion: kept, changed during archive', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    r.hooks['archive-verified'] = () => {
      fs.writeFileSync(path.join(wt, 'late.txt'), 'late\n');
      r.at(wt, 'add', '-A');
      r.at(wt, 'commit', '--quiet', '--message=late');
    };
    const res = r.run('cleanup', SLUG, '--archive');
    assert.deepEqual(res, { code: 2, lines: ['kept t1: changed during archive'] });
    assert.ok(fs.existsSync(wt));
    assert.equal(r.g('for-each-ref', '--format=%(refname)', 'refs/heads/aico-wt/'), `refs/heads/aico-wt/${SLUG}/t1`);
  });

  test('a commit made after the archive event: kept, changed during archive, nothing deleted', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    r.hooks['archive-recorded'] = () => {
      fs.writeFileSync(path.join(wt, 'late.txt'), 'late\n');
      r.at(wt, 'add', '-A');
      r.at(wt, 'commit', '--quiet', '--message=late');
    };
    const res = r.run('cleanup', SLUG, '--archive');
    assert.deepEqual(res, { code: 2, lines: ['kept t1: changed during archive'] });
    assert.ok(fs.existsSync(wt));
    assert.equal(r.g('for-each-ref', '--format=%(refname)', 'refs/heads/aico-wt/'), `refs/heads/aico-wt/${SLUG}/t1`);
  });

  test('the patch opens with O_NOFOLLOW only where it is defined', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    let flags;
    r.hooks['patch-open'] = (d) => { flags = d.flags; };
    assert.equal(r.run('cleanup', SLUG, '--archive').code, 0);
    const want = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0);
    assert.equal(flags, want);
    if (process.platform === 'win32') assert.equal(fs.constants.O_NOFOLLOW, undefined);
  });

  test('the proto worktree is always archived, never removed as merged', () => {
    const r = makeRepo();
    task(r, 'proto', 'p.txt', 'p\n');
    assert.deepEqual(r.run('cleanup', SLUG), { code: 2, lines: ['kept proto: unmerged work'] });
    const res = r.run('cleanup', SLUG, '--archive');
    assert.match(res.lines[0], /^archived proto /);
  });
});

describe('cleanup branch delete', () => {
  test('a task branch made a symref to the run branch: kept, the run branch is intact', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    const runTip = r.head();
    r.g('symbolic-ref', `refs/heads/aico-wt/${SLUG}/t1`, `refs/heads/aico/${SLUG}`);
    for (const args of [['cleanup', SLUG], ['cleanup', SLUG, '--archive']]) {
      const res = r.run(...args);
      assert.deepEqual(res, { code: 2, lines: ['kept t1: branch is a symbolic ref'] });
      assert.ok(fs.existsSync(wt));
      assert.equal(r.g('rev-parse', '--verify', `refs/heads/aico/${SLUG}`), runTip);
    }
    assert.ok(r.events().every((e) => e.ev === 'add'));
  });

  test('a symref swapped in after the worktree is removed: the run branch is kept and no remove event is written', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    assert.equal(r.run('merge', SLUG).code, 0);
    const runTip = r.head();
    r.hooks.git = ({ args }) => {
      if (args.includes('remove') && args.includes('worktree')) r.g('symbolic-ref', `refs/heads/aico-wt/${SLUG}/t1`, `refs/heads/aico/${SLUG}`);
    };
    const res = r.run('cleanup', SLUG);
    r.hooks.git = undefined;
    assert.deepEqual(res, { code: 2, lines: ['kept t1: branch is a symbolic ref'] });
    assert.equal(r.g('rev-parse', '--verify', `refs/heads/aico/${SLUG}`), runTip);
    assert.ok(!r.events().some((e) => e.ev === 'remove'));
  });

  test('the branch moves between the worktree removal and the delete: branch moved, branch kept, no event', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    assert.equal(r.run('merge', SLUG).code, 0);
    const moved = r.head();
    r.hooks.git = ({ args }) => {
      if (args.includes('update-ref')) r.g('update-ref', `refs/heads/aico-wt/${SLUG}/t1`, moved);
    };
    const res = r.run('cleanup', SLUG);
    r.hooks.git = undefined;
    assert.deepEqual(res, { code: 2, lines: ['kept t1: branch moved'] });
    assert.equal(r.g('rev-parse', '--verify', `refs/heads/aico-wt/${SLUG}/t1`), moved);
    assert.ok(!r.events().some((e) => e.ev === 'remove'));
    assert.deepEqual(r.run('cleanup', SLUG), { code: 2, lines: ['record mismatch t1'] });
  });

  test('a commit made in the worktree after the head was read: the update-ref old-value check fails and the branch is kept', () => {
    const r = makeRepo();
    const wt = task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    assert.equal(r.run('merge', SLUG).code, 0);
    let late;
    r.hooks.git = ({ args }) => {
      if (args.includes('worktree') && args.includes('remove') && !late) {
        fs.writeFileSync(path.join(wt, 'late.txt'), 'late\n');
        r.at(wt, 'add', '-A');
        r.at(wt, 'commit', '--quiet', '--message=late');
        late = r.at(wt, 'rev-parse', 'HEAD');
      }
    };
    const res = r.run('cleanup', SLUG);
    r.hooks.git = undefined;
    assert.equal(res.code, 2, res.lines.join('\n'));
    assert.ok(res.lines[0] === 'kept t1: branch moved' || res.lines[0].startsWith('kept t1:'), res.lines[0]);
    assert.equal(r.g('rev-parse', '--verify', `refs/heads/aico-wt/${SLUG}/t1`), late);
    assert.ok(!r.events().some((e) => e.ev === 'remove'));
  });

  test('the branch is deleted with update-ref --no-deref -d and the checked head, never branch -D', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    task(r, 't2', 'two.txt', '2\n');
    writeWave(r, ['T1']);
    assert.equal(r.run('merge', SLUG).code, 0);
    const head = r.g('rev-parse', `aico-wt/${SLUG}/t1`);
    r.calls.length = 0;
    assert.equal(r.run('cleanup', SLUG, '--archive').code, 0);
    assert.ok(!r.calls.some((c) => c.args.includes('branch')));
    const del = r.calls.find((c) => c.args.includes('update-ref') && c.args.includes('-d')).args;
    const at = del.indexOf('update-ref');
    assert.deepEqual(del.slice(at), ['update-ref', '--no-deref', '-d', '--end-of-options', `refs/heads/aico-wt/${SLUG}/t1`, head]);
    assert.ok(r.calls.some((c) => c.args.includes('symbolic-ref') && c.args.includes(`refs/heads/aico-wt/${SLUG}/t1`)));
  });
});

describe('cleanup ignored files', () => {
  const ARCHIVE = (r) => path.join(r.repo, '.company', 'work', SLUG, 'worktrees', 't1-20261029T120000Z.ignored');

  function ignoredTask(r) {
    const wt = task(r, 't1', '.gitignore', '*.local\n');
    fs.writeFileSync(path.join(wt, '.env.local'), 'KEY=secret\n');
    fs.mkdirSync(path.join(wt, 'config', 'x'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'config', 'x', 'y.local'), Buffer.from([0, 1, 2, 255]));
    return wt;
  }

  const kept = (reason) => ({ code: 2, lines: [`kept t1: ${reason}`] });
  const notArchived = kept('ignored files not archived');

  test('path (a): ignored files are archived under a git-ignored folder, byte for byte, then the worktree is removed', () => {
    const r = makeRepo();
    const wt = ignoredTask(r);
    writeWave(r, ['T1']);
    assert.equal(r.run('merge', SLUG).code, 0);
    const res = r.run('cleanup', SLUG);
    assert.deepEqual(res, { code: 0, lines: ['removed t1 ignored 2'] });
    assert.ok(!fs.existsSync(wt));
    const dir = ARCHIVE(r);
    assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '*\n');
    assert.equal(fs.readFileSync(path.join(dir, '.env.local'), 'utf8'), 'KEY=secret\n');
    assert.deepEqual(fs.readFileSync(path.join(dir, 'config', 'x', 'y.local')), Buffer.from([0, 1, 2, 255]));
    assert.ok(!r.g('status', '--porcelain=v1', '--untracked-files=all').includes('.ignored'));
    const ev = r.events().find((e) => e.ev === 'remove');
    assert.equal(ev.ignored, 't1-20261029T120000Z.ignored');
    assert.equal(readWorktrees(r.repo, SLUG).events.at(-1).ignored, ev.ignored);
    assert.ok(!res.lines.join('\n').includes('secret') && !res.lines.join('\n').includes('.env'));
  });

  test('path (b): the ignored files are archived with the patch and the archive event names the folder', () => {
    const r = makeRepo();
    const wt = ignoredTask(r);
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'dirty\n');
    const res = r.run('cleanup', SLUG, '--archive');
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.match(res.lines[0], /^archived t1 .*\.patch ignored 2$/);
    assert.equal(fs.readFileSync(path.join(ARCHIVE(r), '.env.local'), 'utf8'), 'KEY=secret\n');
    const ev = r.events().find((e) => e.ev === 'archive');
    assert.equal(ev.ignored, 't1-20261029T120000Z.ignored');
    assert.ok(!fs.existsSync(wt));
  });

  test('no ignored files: no folder and no ignored key', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    writeWave(r, ['T1']);
    assert.equal(r.run('merge', SLUG).code, 0);
    assert.deepEqual(r.run('cleanup', SLUG), { code: 0, lines: ['removed t1'] });
    assert.ok(!fs.existsSync(ARCHIVE(r)));
    assert.ok(!('ignored' in r.events().find((e) => e.ev === 'remove')));
  });

  test('a record line with a bad ignored key is refused', () => {
    const r = makeRepo();
    task(r, 't1', 'one.txt', '1\n');
    for (const bad of ['../x.ignored', 't2-20261029T120000Z.ignored', 7, 't1-20261029T120000Z.patch']) {
      fs.appendFileSync(r.record(), `${JSON.stringify({ v: 1, at: '2026-10-29T12:00:00Z', ev: 'remove', task: 't1', commit: r.head(), ignored: bad })}\n`);
      assert.throws(() => readWorktrees(r.repo, SLUG), /worktree record demo line 2/);
      fs.writeFileSync(r.record(), fs.readFileSync(r.record(), 'utf8').split('\n')[0] + '\n');
    }
  });

  const hostile = {
    'a hard-linked ignored file': (r, wt) => fs.linkSync(path.join(wt, '.env.local'), path.join(r.base, 'second-name')),
    'a file over the per-file cap': (r, wt) => fs.writeFileSync(path.join(wt, '.env.local'), 'x'.repeat(100)),
    'a read-back mismatch': (r) => { r.hooks['ignored-written'] = ({ file }) => fs.appendFileSync(file, 'tampered'); },
    'an archive folder that already exists': (r) => {
      const dir = ARCHIVE(r);
      fs.mkdirSync(dir, { recursive: true });
    }
  };
  for (const [name, arrange] of Object.entries(hostile)) {
    test(`path (a), ${name}: kept, worktree and branch stay`, () => {
      const r = makeRepo();
      const wt = ignoredTask(r);
      writeWave(r, ['T1']);
      assert.equal(r.run('merge', SLUG).code, 0);
      arrange(r, wt);
      const res = r.runWith({ ignoredCap: { file: 50 } }, 'cleanup', SLUG);
      assert.deepEqual(res, notArchived);
      assert.ok(fs.existsSync(path.join(wt, '.env.local')));
      assert.equal(r.g('rev-parse', '--verify', `aico-wt/${SLUG}/t1`).length, 40);
      assert.ok(!r.events().some((e) => e.ev === 'remove'));
    });
    test(`path (b), ${name}: kept, no archive event`, () => {
      const r = makeRepo();
      const wt = ignoredTask(r);
      arrange(r, wt);
      const res = r.runWith({ ignoredCap: { file: 50 } }, 'cleanup', SLUG, '--archive');
      assert.deepEqual(res, notArchived);
      assert.ok(fs.existsSync(path.join(wt, '.env.local')));
      assert.equal(r.g('rev-parse', '--verify', `aico-wt/${SLUG}/t1`).length, 40);
      assert.ok(!r.events().some((e) => e.ev === 'archive' || e.ev === 'remove'));
    });
  }

  test('an ignored symlink keeps the worktree', (t) => {
    const r = makeRepo();
    const wt = ignoredTask(r);
    try {
      fs.symlinkSync(path.join(r.base, 'elsewhere.txt'), path.join(wt, 'config', 'link.local'));
    } catch {
      t.skip('symlinks cannot be created here');
      return;
    }
    writeWave(r, ['T1']);
    assert.equal(r.run('merge', SLUG).code, 0);
    assert.deepEqual(r.run('cleanup', SLUG), notArchived);
    assert.ok(fs.existsSync(wt));
  });

  test('the file count cap and the total cap keep the worktree', () => {
    for (const cap of [{ files: 1 }, { total: 10 }]) {
      const r = makeRepo();
      const wt = ignoredTask(r);
      writeWave(r, ['T1']);
      assert.equal(r.run('merge', SLUG).code, 0);
      assert.deepEqual(r.runWith({ ignoredCap: cap }, 'cleanup', SLUG), notArchived, JSON.stringify(cap));
      assert.ok(fs.existsSync(wt));
    }
  });

  test('an ignored file written after the archive: kept, changed during archive', () => {
    const r = makeRepo();
    const wt = ignoredTask(r);
    writeWave(r, ['T1']);
    assert.equal(r.run('merge', SLUG).code, 0);
    r.hooks['ignored-verified'] = () => fs.writeFileSync(path.join(wt, 'config', 'new.local'), 'late\n');
    assert.deepEqual(r.run('cleanup', SLUG), kept('changed during archive'));
    assert.ok(fs.existsSync(wt));
    assert.equal(r.g('rev-parse', '--verify', `aico-wt/${SLUG}/t1`).length, 40);
    assert.ok(!r.events().some((e) => e.ev === 'remove'));
  });
});

describe('repo under a symlinked parent folder', () => {
  const linkedRepo = (t) => {
    try {
      return makeRepo({ linked: true });
    } catch (error) {
      if (error.code === 'EPERM') {
        t.skip(`symlink needs a privilege here: ${error.code}`);
        return null;
      }
      throw error;
    }
  };

  test('add prints the real worktree path and the folder is made beside the real repo', (t) => {
    const r = linkedRepo(t);
    if (!r) return;
    const res = r.run('add', SLUG, 't1', '--base', r.head());
    assert.deepEqual(res, { code: 0, lines: [`Worktree: ${path.join(r.wtRoot, SLUG, 't1')}`] });
    assert.ok(fs.existsSync(path.join(r.wtRoot, SLUG, 't1', 'a.txt')));
  });

  test('add, merge and cleanup path (a) with ignored files give the outcomes of an unlinked root', (t) => {
    const r = linkedRepo(t);
    if (!r) return;
    const wt = task(r, 't1', '.gitignore', '*.local\nnode_modules/\n');
    fs.writeFileSync(path.join(wt, '.env.local'), 'KEY=secret\n');
    fs.mkdirSync(path.join(wt, 'node_modules', 'p'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'node_modules', 'p', 'i.js'), 'x');
    writeWave(r, ['T1']);
    const merged = r.run('merge', SLUG);
    assert.equal(merged.code, 0, merged.lines.join('\n'));
    assert.deepEqual(r.run('cleanup', SLUG), { code: 0, lines: ['removed t1 ignored 1'] });
    assert.ok(!fs.existsSync(wt));
    const dir = path.join(r.repo, '.company', 'work', SLUG, 'worktrees', 't1-20261029T120000Z.ignored');
    assert.equal(fs.readFileSync(path.join(dir, '.env.local'), 'utf8'), 'KEY=secret\n');
    assert.equal(r.g('for-each-ref', 'refs/heads/aico-wt/'), '');
  });

  test('add and cleanup path (b) with --archive give the outcomes of an unlinked root', (t) => {
    const r = linkedRepo(t);
    if (!r) return;
    const wt = task(r, 't1', '.gitignore', '*.local\n');
    fs.writeFileSync(path.join(wt, '.env.local'), 'KEY=secret\n');
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'dirty\n');
    const res = r.run('cleanup', SLUG, '--archive');
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.match(res.lines[0], /^archived t1 .*\.patch ignored 1$/);
    assert.ok(!fs.existsSync(wt));
    assert.equal(r.g('for-each-ref', 'refs/heads/aico-wt/'), '');
  });

  test('a link inside the root still refuses: a linked slug folder is not followed', (t) => {
    const r = linkedRepo(t);
    if (!r) return;
    const elsewhere = fs.mkdtempSync(path.join(r.base, 'else-'));
    fs.mkdirSync(r.wtRoot);
    fs.symlinkSync(elsewhere, path.join(r.wtRoot, SLUG), process.platform === 'win32' ? 'junction' : 'dir');
    const res = r.run('add', SLUG, 't1', '--base', r.head());
    assert.equal(res.code, 3, res.lines.join('\n'));
    assert.deepEqual(fs.readdirSync(elsewhere), []);
  });
});

describe('cleanup ignored folders', () => {
  const kept = (reason) => ({ code: 2, lines: [`kept t1: ${reason}`] });
  const notArchived = kept('ignored files not archived');
  const ARCHIVE = (r) => path.join(r.repo, '.company', 'work', SLUG, 'worktrees', 't1-20261029T120000Z.ignored');

  function mergedTask(r, ignore) {
    const wt = task(r, 't1', '.gitignore', ignore);
    writeWave(r, ['T1']);
    assert.equal(r.run('merge', SLUG).code, 0);
    return wt;
  }
  function fill(dir, n) {
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < n; i++) fs.writeFileSync(path.join(dir, `f${i}.js`), 'x');
  }

  test('node_modules/ with 2000 files is skipped: worktree removed, branch deleted, nothing copied', () => {
    const r = makeRepo();
    const wt = mergedTask(r, 'node_modules/\n');
    fill(path.join(wt, 'node_modules', 'pkg'), 2000);
    assert.deepEqual(r.run('cleanup', SLUG), { code: 0, lines: ['removed t1'] });
    assert.ok(!fs.existsSync(wt));
    assert.equal(r.g('for-each-ref', '--format=%(refname)', `refs/heads/aico-wt/${SLUG}/t1`), '');
    assert.ok(!fs.existsSync(ARCHIVE(r)));
  });

  test('path (b): a rebuildable folder is skipped and a loose .env.local is still archived', () => {
    const r = makeRepo();
    const wt = task(r, 't1', '.gitignore', 'node_modules/\n.env.local\n');
    fill(path.join(wt, 'node_modules'), 1500);
    fs.writeFileSync(path.join(wt, '.env.local'), 'KEY=secret\n');
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'dirty\n');
    const res = r.run('cleanup', SLUG, '--archive');
    assert.match(res.lines[0], /^archived t1 .*\.patch ignored 1$/);
    assert.equal(fs.readFileSync(path.join(ARCHIVE(r), '.env.local'), 'utf8'), 'KEY=secret\n');
    assert.ok(!fs.existsSync(path.join(ARCHIVE(r), 'node_modules')));
    assert.ok(!fs.existsSync(wt));
  });

  test('the file cap counts archived files only, not skipped folders', () => {
    const r = makeRepo();
    const wt = mergedTask(r, 'node_modules/\n.env.local\n');
    fill(path.join(wt, 'node_modules'), 5);
    fs.writeFileSync(path.join(wt, '.env.local'), 'k\n');
    assert.deepEqual(r.runWith({ ignoredCap: { files: 1 } }, 'cleanup', SLUG), { code: 0, lines: ['removed t1 ignored 1'] });
  });

  for (const [name, dir, ignore] of [
    ['an ignored secrets/ folder', 'secrets', 'secrets/\n'],
    ['Node_Modules/ (case differs)', 'Node_Modules', 'Node_Modules/\n'],
    ['a nested folder not on the list', path.join('a', 'logs'), 'logs/\n']
  ]) {
    test(`${name} keeps the worktree and the branch`, () => {
      const r = makeRepo();
      const wt = mergedTask(r, ignore);
      fill(path.join(wt, dir), 3);
      assert.deepEqual(r.run('cleanup', SLUG), notArchived);
      assert.ok(fs.existsSync(path.join(wt, dir, 'f0.js')));
      assert.equal(r.g('rev-parse', '--verify', `aico-wt/${SLUG}/t1`).length, 40);
      assert.ok(!r.events().some((e) => e.ev === 'remove'));
    });
  }

  test('a nested rebuildable folder is skipped by its last segment', () => {
    const r = makeRepo();
    const wt = mergedTask(r, 'node_modules/\n');
    fill(path.join(wt, 'pkg', 'node_modules'), 3);
    assert.deepEqual(r.run('cleanup', SLUG), { code: 0, lines: ['removed t1'] });
    assert.ok(!fs.existsSync(wt));
  });

  test('node_modules as a link or junction keeps the worktree', (t) => {
    const r = makeRepo();
    const wt = mergedTask(r, 'node_modules\n');
    const target = path.join(r.base, 'elsewhere');
    fill(target, 2);
    try {
      fs.symlinkSync(target, path.join(wt, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      t.skip('links cannot be created here');
      return;
    }
    assert.deepEqual(r.run('cleanup', SLUG), notArchived);
    assert.ok(fs.existsSync(wt));
    assert.ok(fs.existsSync(path.join(target, 'f0.js')));
  });

  for (const [name, args] of [['path (a)', []], ['path (b)', ['--archive']]]) {
    const setup = (r, ignore = 'node_modules/\n') => (args.length ? task(r, 't1', '.gitignore', ignore) : mergedTask(r, ignore));

    test(`${name}: a junction inside node_modules/ is never followed`, () => {
      const r = makeRepo();
      const wt = setup(r);
      const outside = path.join(r.base, 'outside');
      fill(outside, 2);
      fill(path.join(wt, 'node_modules', 'pkg'), 2);
      fs.symlinkSync(outside, path.join(wt, 'node_modules', 'junc'), 'junction');
      const res = r.run('cleanup', SLUG, ...args);
      assert.equal(res.code, 0);
      assert.ok(!fs.existsSync(wt));
      assert.equal(fs.readFileSync(path.join(outside, 'f1.js'), 'utf8'), 'x');
    });

    test(`${name}: the folder swapped for a junction before removal: target kept, worktree kept`, () => {
      const r = makeRepo();
      const wt = setup(r);
      const outside = path.join(r.base, 'outside');
      fill(outside, 2);
      fill(path.join(wt, 'node_modules'), 2);
      r.hooks['rebuildable-remove'] = ({ path: p }) => {
        fs.rmSync(p, { recursive: true });
        fs.symlinkSync(outside, p, 'junction');
      };
      const res = r.run('cleanup', SLUG, ...args);
      assert.deepEqual(res, kept('rebuildable folder not removed'));
      assert.ok(fs.existsSync(wt));
      assert.equal(fs.readFileSync(path.join(outside, 'f0.js'), 'utf8'), 'x');
      assert.ok(!r.events().some((e) => e.ev === 'remove'));
    });

    test(`${name}: a parent swapped for a junction before removal: target kept, worktree kept`, () => {
      const r = makeRepo();
      const wt = setup(r, 'out/\n');
      const outside = path.join(r.base, 'outside');
      fill(path.join(outside, 'out'), 2);
      fill(path.join(wt, 'src', 'out'), 1);
      r.hooks['rebuildable-remove'] = () => {
        fs.rmSync(path.join(wt, 'src'), { recursive: true });
        fs.symlinkSync(outside, path.join(wt, 'src'), 'junction');
      };
      const res = r.run('cleanup', SLUG, ...args);
      assert.deepEqual(res, kept('rebuildable folder not removed'));
      assert.ok(fs.existsSync(wt));
      assert.equal(fs.readFileSync(path.join(outside, 'out', 'f0.js'), 'utf8'), 'x');
    });

    test(`${name}: a throw while removing keeps the worktree, branch and record`, () => {
      const r = makeRepo();
      const wt = setup(r);
      fill(path.join(wt, 'node_modules'), 2);
      r.hooks['rebuildable-remove'] = () => { throw new Error('locked'); };
      assert.deepEqual(r.run('cleanup', SLUG, ...args), kept('rebuildable folder not removed'));
      assert.ok(fs.existsSync(wt));
      assert.equal(r.g('rev-parse', '--verify', `aico-wt/${SLUG}/t1`).length, 40);
      assert.ok(!r.events().some((e) => e.ev === 'remove'));
    });

    test(`${name}: a folder gone before the removal (no force) keeps the worktree`, () => {
      const r = makeRepo();
      const wt = setup(r);
      fill(path.join(wt, 'node_modules'), 2);
      r.hooks['rebuildable-remove'] = ({ path: p }) => fs.rmSync(p, { recursive: true });
      assert.deepEqual(r.run('cleanup', SLUG, ...args), kept('rebuildable folder not removed'));
      assert.ok(fs.existsSync(wt));
    });
  }

  test('a symlink inside node_modules/ pointing outside: target kept, worktree removed', (t) => {
    const r = makeRepo();
    const wt = mergedTask(r, 'node_modules/\n');
    const outside = path.join(r.base, 'outside');
    fill(outside, 2);
    fill(path.join(wt, 'node_modules', 'pkg'), 2);
    try {
      fs.symlinkSync(outside, path.join(wt, 'node_modules', 'link'), 'dir');
      fs.symlinkSync(path.join(outside, 'f0.js'), path.join(wt, 'node_modules', 'flink'), 'file');
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
      t.skip(`symlink needs a privilege here: ${error.code}`);
      return;
    }
    assert.deepEqual(r.run('cleanup', SLUG), { code: 0, lines: ['removed t1'] });
    assert.ok(!fs.existsSync(wt));
    assert.equal(fs.readFileSync(path.join(outside, 'f1.js'), 'utf8'), 'x');
  });

  test('a folder ignored whole that appears after the archive: changed during archive', () => {
    const r = makeRepo();
    const wt = mergedTask(r, 'dist/\n.env.local\n');
    fs.writeFileSync(path.join(wt, '.env.local'), 'k\n');
    r.hooks['ignored-verified'] = () => fill(path.join(wt, 'dist'), 1);
    assert.deepEqual(r.run('cleanup', SLUG), kept('changed during archive'));
    assert.ok(fs.existsSync(wt));
  });
});

describe('leftovers', () => {
  test('finds a stray worktree and a stray branch', () => {
    const r = makeRepo();
    assert.deepEqual(r.run('leftovers'), { code: 0, lines: ['leftovers: none'] });
    task(r, 't1');
    r.g('branch', 'aico-wt/other/t3');
    const res = r.run('leftovers');
    assert.equal(res.code, 0);
    assert.deepEqual([...res.lines].sort(), ['leftover branch aico-wt/demo/t1', 'leftover branch aico-wt/other/t3', 'leftover worktree demo/t1']);
  });
});

describe('protocheck', () => {
  test('no proto add: none; an unmerged prototype: not in diff', () => {
    const r = makeRepo();
    assert.deepEqual(r.run('protocheck', SLUG), { code: 0, lines: ['prototype: none'] });
    task(r, 'proto', 'p.txt', 'p\n');
    assert.deepEqual(r.run('protocheck', SLUG), { code: 0, lines: ['prototype: not in diff'] });
  });

  test('exit 2 after a prototype commit is merged into the run ref', () => {
    const r = makeRepo();
    task(r, 'proto', 'p.txt', 'p\n');
    r.g('merge', '--quiet', '--no-ff', '--no-edit', `aico-wt/${SLUG}/proto`);
    assert.deepEqual(r.run('protocheck', SLUG), { code: 2, lines: ['prototype: 1 commits in the run branch'] });
  });

  test('a cherry-picked prototype commit is counted', () => {
    const r = makeRepo();
    task(r, 'proto', 'p.txt', 'p\n');
    r.g('cherry-pick', `aico-wt/${SLUG}/proto`);
    assert.deepEqual(r.run('protocheck', SLUG), { code: 2, lines: ['prototype: 1 commits in the run branch'] });
  });

  test('uses the head recorded on the archive when the branch is gone', () => {
    const r = makeRepo();
    task(r, 'proto', 'p.txt', 'p\n');
    assert.equal(r.run('cleanup', SLUG, '--archive').code, 0);
    assert.deepEqual(r.run('protocheck', SLUG), { code: 0, lines: ['prototype: not in diff'] });
  });

  test('a proto add whose branch is gone with no head recorded: unknown', () => {
    const r = makeRepo();
    const wt = task(r, 'proto', 'p.txt', 'p\n');
    r.g('worktree', 'remove', '--force', wt);
    r.g('branch', '-D', `aico-wt/${SLUG}/proto`);
    assert.deepEqual(r.run('protocheck', SLUG), { code: 2, lines: ['prototype: unknown'] });
  });
});

describe('record', () => {
  test('a broken record line fails loud with exit 1', () => {
    const r = makeRepo();
    task(r, 't1');
    fs.appendFileSync(r.record(), '{"v":1,"ev":"nope"}\n');
    assert.equal(r.run('leftovers').code, 0);
    assert.equal(r.run('cleanup', SLUG).code, 1);
    assert.throws(() => readWorktrees(r.repo, SLUG), /worktree record demo line 2/);
  });

  test('the record file is append-only LF, one line per event, within the caps', () => {
    const r = makeRepo();
    task(r, 't1');
    const text = fs.readFileSync(r.record(), 'utf8');
    assert.ok(text.endsWith('\n') && !text.includes('\r'));
    assert.ok(text.split('\n').every((l) => Buffer.byteLength(l) <= 512));
  });

  test('a record file with a second hard link is refused', () => {
    const r = makeRepo();
    const target = path.join(r.base, 'target.jsonl');
    fs.writeFileSync(target, '');
    fs.linkSync(target, r.record());
    const res = r.run('add', SLUG, 't1', '--base', r.head());
    assert.equal(res.code, 1);
  });

  test('readWorktrees reports none without a record and rejects a bad slug', () => {
    const r = makeRepo();
    assert.equal(readWorktrees(r.repo, SLUG).state, 'none');
    assert.throws(() => readWorktrees(r.repo, '../x'), TypeError);
  });
});
