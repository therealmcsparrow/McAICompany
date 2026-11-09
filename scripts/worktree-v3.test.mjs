// QA-first red tests for T25 (AC19): worktree and step-split on a v3 run slug `<ID>/<NN>-<pb>`.
// Refs and worktree folders carry the project ID only (`aico-wt/<ID>/t<n>`, no run part); the record lives in the run folder.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main as worktree } from './worktree.mjs';
import { main as stepSplit } from './step-split.mjs';

const ID = 'P20261109.000009';
const RUN = `${ID}/01-feature`;
const RUN2 = `${ID}/02-fix`;
const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const SHA = 'a'.repeat(40);

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-v3-home-'));
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

function git(cwd, ...args) {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: GLOBAL_CONFIG, GIT_CONFIG_NOSYSTEM: '1' };
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\n$/, '');
}

function makeRepo() {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-v3-')));
  bases.push(base);
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', `--initial-branch=aico/${ID}`);
  for (const [k, v] of [['user.name', 'Test'], ['user.email', 'test@example.com'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) {
    git(repo, 'config', k, v);
  }
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '--message=base');
  const work = path.join(repo, '.company', 'work', ID);
  fs.mkdirSync(path.join(work, '01-feature'), { recursive: true });
  fs.mkdirSync(path.join(work, '02-fix'), { recursive: true });
  fs.writeFileSync(path.join(work, '00-project.md'), '# Project\n\nA v3 project\n');
  return {
    base, repo, work,
    wtRoot: path.join(base, 'repo.aico-wt'),
    head: () => git(repo, 'rev-parse', 'HEAD'),
    run: (...args) => worktree(args, { root: repo, now: NOW })
  };
}

const wtBranches = (r) => git(r.repo, 'branch', '--list', 'aico-wt/*').split('\n').filter(Boolean);

describe('worktree on a v3 run slug (AC19)', () => {
  test('add makes aico-wt/<ID>/t<n> and a worktree folder without a run part', () => {
    const r = makeRepo();
    const res = r.run('add', RUN, 't1', '--base', r.head());
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.equal(res.lines[0], `Worktree: ${path.join(r.wtRoot, ID, 't1')}`);
    assert.equal(git(r.repo, 'rev-parse', `refs/heads/aico-wt/${ID}/t1`), r.head());
    assert.equal(wtBranches(r).length, 1);
    assert.ok(fs.existsSync(path.join(r.wtRoot, ID, 't1', 'a.txt')));
  });

  test('the record is worktrees.jsonl in the v3 run folder', () => {
    const r = makeRepo();
    assert.equal(r.run('add', RUN, 't1', '--base', r.head()).code, 0);
    const file = path.join(r.work, '01-feature', 'worktrees.jsonl');
    assert.ok(fs.existsSync(file), 'record in run folder');
    const [ev] = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(ev.ev, 'add');
    assert.equal(ev.task, 't1');
    assert.ok(!fs.existsSync(path.join(r.work, 'worktrees.jsonl')), 'none in the project folder');
  });

  test('add takes the full ticket ID of its own project; another project is refused', () => {
    const r = makeRepo();
    const ok = r.run('add', RUN, `${ID}-T2`, '--base', r.head());
    assert.equal(ok.code, 0, ok.lines.join('\n'));
    assert.ok(git(r.repo, 'rev-parse', `refs/heads/aico-wt/${ID}/t2`));
    assert.notEqual(r.run('add', RUN, 'P20261109.000010-T3', '--base', r.head()).code, 0);
  });

  test('two runs of one project share one ref namespace: the same task id collides', () => {
    const r = makeRepo();
    assert.equal(r.run('add', RUN, 't1', '--base', r.head()).code, 0);
    assert.notEqual(r.run('add', RUN2, 't1', '--base', r.head()).code, 0);
    assert.equal(r.run('add', RUN2, 't2', '--base', r.head()).code, 0);
    assert.equal(wtBranches(r).length, 2);
  });

  test('changed lists the files of a v3 worktree', () => {
    const r = makeRepo();
    const wt = r.run('add', RUN, 't1', '--base', r.head()).lines[0].replace(/^Worktree: /, '');
    fs.writeFileSync(path.join(wt, 'new.txt'), 'n\n');
    const res = r.run('changed', RUN, 't1');
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.deepEqual(res.lines, ['new.txt']);
  });

  test('cleanup removes the worktree and its ref', () => {
    const r = makeRepo();
    assert.equal(r.run('add', RUN, 't1', '--base', r.head()).code, 0);
    const res = r.run('cleanup', RUN);
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.equal(git(r.repo, 'branch', '--list', 'aico-wt/*'), '');
    assert.ok(!fs.existsSync(path.join(r.wtRoot, ID, 't1')));
  });

  test('a v3 slug whose folder is missing, badly spelled or malformed is refused and writes nothing', () => {
    const r = makeRepo();
    for (const slug of [`${ID}/09-feature`, `${ID}/01-FEATURE`, `${ID}/../x`, `${ID}/01-feature/x`, `${ID}\\01-feature`]) {
      assert.notEqual(r.run('add', slug, 't1', '--base', r.head()).code, 0, slug);
    }
    assert.equal(git(r.repo, 'branch', '--list', 'aico-wt/*'), '');
    assert.ok(!fs.existsSync(r.wtRoot));
    // the same call with the real slug works, so the refusals above are about the slug and not about v3 in general
    assert.equal(r.run('add', RUN, 't1', '--base', r.head()).code, 0);
  });
});

describe('step-split on a v3 run slug (AC19)', () => {
  function stubbed() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-v3-'));
    bases.push(d);
    fs.mkdirSync(path.join(d, '.company', 'work', ID, '01-feature'), { recursive: true });
    fs.writeFileSync(path.join(d, '.company', 'work', ID, '00-project.md'), '# P\n');
    const calls = [];
    const answer = { v: 1, source: 'base', base: SHA, tier: 'unknown', depth: 'standard', paths: [{ path: 'a/b/x.mjs', categories: [], module: null, lines: 10 }], reasons: [], truncated: false };
    const exec = (file, args) => {
      calls.push([file, ...args]);
      return JSON.stringify(answer);
    };
    return { d, calls, exec };
  }

  test('review accepts the slug, passes it whole to review-depth and writes split/r1 in the run folder', () => {
    const { d, calls, exec } = stubbed();
    const r = stepSplit(['review', RUN, SHA, '1'], { root: d, exec });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^groups: 1\n/);
    assert.ok(fs.existsSync(path.join(d, '.company', 'work', ID, '01-feature', 'split', 'r1', 'g1.txt')));
    const argv = calls[0];
    assert.equal(argv[argv.indexOf('--run') + 1], RUN);
    assert.ok(r.out.includes(`.company/work/${RUN}/split/r1/g1.txt`), r.out);
  });

  test('show reads the split back by v3 slug', () => {
    const { d, exec } = stubbed();
    assert.equal(stepSplit(['review', RUN, SHA, '1'], { root: d, exec }).code, 0);
    const r = stepSplit(['show', RUN, 'r1'], { root: d });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /x\.mjs/);
  });

  test('a v3 slug without a run folder, or a malformed one, is refused', () => {
    const { d, exec } = stubbed();
    assert.equal(stepSplit(['review', RUN, SHA, '9'], { root: d, exec }).code, 0, 'the real slug is accepted');
    for (const slug of [`${ID}/07-feature`, `${ID}/../x`, `${ID}/01-feature/x`, `${ID}\\01-feature`]) {
      const r = stepSplit(['review', slug, SHA, '1'], { root: d, exec });
      assert.equal(r.code, 2, slug);
      assert.match(r.out, /^refused: /);
    }
    assert.deepEqual(fs.readdirSync(path.join(d, '.company', 'work', ID, '01-feature', 'split')), ['r9']);
  });
});
