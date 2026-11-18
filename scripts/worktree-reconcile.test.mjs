// Regression tests for `worktree reconcile <slug> <id>`: a record that still holds a live add after the
// worktree and branch were removed by hand. Temp repos only, never the real .company.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main as worktree } from './worktree.mjs';

const ID = 'P20261117.000001';
const RUN = `${ID}/01-feature`;
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-reconcile-home-'));
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
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-reconcile-')));
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
  fs.writeFileSync(path.join(work, '00-project.md'), '# Project\n');
  const r = {
    repo,
    record: path.join(work, '01-feature', 'worktrees.jsonl'),
    wt: (id) => path.join(base, 'repo.aico-wt', ID, id),
    ref: (id) => `refs/heads/aico-wt/${ID}/${id}`,
    head: () => git(repo, 'rev-parse', 'HEAD'),
    run: (...args) => worktree(args, { root: repo, now: NOW }),
    events: () => fs.readFileSync(r.record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  };
  return r;
}

// A live add proto, then the worktree and branch removed by hand (the CEO's case).
function withProto(r, { dropTree = true, dropBranch = true } = {}) {
  const add = r.run('add', RUN, 'proto', '--base', r.head());
  assert.equal(add.code, 0, add.lines.join('\n'));
  if (dropTree) git(r.repo, 'worktree', 'remove', '--force', r.wt('proto'));
  if (dropBranch) git(r.repo, 'branch', '-D', `aico-wt/${ID}/proto`);
}

describe('worktree reconcile', () => {
  test('bug: cleanup refuses a hand-removed proto; reconcile then appends remove and cleanup exits 0', () => {
    const r = makeRepo();
    withProto(r);
    const before = r.run('cleanup', RUN);
    assert.equal(before.code, 2);
    assert.deepEqual(before.lines, ['record mismatch proto']);

    const res = r.run('reconcile', RUN, 'proto');
    assert.equal(res.code, 0, res.lines.join('\n'));
    const ev = r.events();
    assert.equal(ev.length, 2);
    assert.equal(ev[1].ev, 'remove');
    assert.equal(ev[1].task, 'proto');
    assert.match(ev[1].commit, /^[0-9a-f]{40}$/);

    const after = r.run('cleanup', RUN);
    assert.equal(after.code, 0, after.lines.join('\n'));
  });

  test('refuses when the branch still exists (worktree folder gone)', () => {
    const r = makeRepo();
    withProto(r, { dropBranch: false });
    const res = r.run('reconcile', RUN, 'proto');
    assert.notEqual(res.code, 0);
    assert.notDeepEqual(res.lines, []);
    assert.doesNotMatch(res.lines.join('\n'), /usage: worktree <command>/, 'reconcile must be a known command');
    assert.equal(r.events().length, 1, 'record unchanged');
    assert.equal(r.events()[0].ev, 'add');
  });

  test('refuses when the worktree still exists (branch ref deleted)', () => {
    const r = makeRepo();
    withProto(r, { dropTree: false, dropBranch: false });
    git(r.repo, 'update-ref', '-d', r.ref('proto'));
    assert.ok(fs.existsSync(r.wt('proto')));
    const res = r.run('reconcile', RUN, 'proto');
    assert.notEqual(res.code, 0);
    assert.doesNotMatch(res.lines.join('\n'), /usage: worktree <command>/, 'reconcile must be a known command');
    assert.equal(r.events().length, 1, 'record unchanged');
  });

  test('refuses when both worktree and branch still exist (healthy live add)', () => {
    const r = makeRepo();
    withProto(r, { dropTree: false, dropBranch: false });
    const res = r.run('reconcile', RUN, 'proto');
    assert.notEqual(res.code, 0);
    assert.doesNotMatch(res.lines.join('\n'), /usage: worktree <command>/, 'reconcile must be a known command');
    assert.equal(r.events().length, 1);
    assert.ok(fs.existsSync(r.wt('proto')), 'worktree untouched');
    assert.equal(r.run('cleanup', RUN).code, 0);
  });

  test('refuses an id with no live add and writes nothing', () => {
    const r = makeRepo();
    withProto(r);
    assert.equal(r.run('reconcile', RUN, 'proto').code, 0);
    const again = r.run('reconcile', RUN, 'proto');
    assert.notEqual(again.code, 0);
    assert.doesNotMatch(again.lines.join('\n'), /usage: worktree <command>/);
    assert.equal(r.events().length, 2, 'no second remove');
    const unknown = r.run('reconcile', RUN, 't9');
    assert.notEqual(unknown.code, 0);
    assert.equal(r.events().length, 2);
  });

  test('reconcile touches only the named id; another live worktree stays', () => {
    const r = makeRepo();
    withProto(r);
    assert.equal(r.run('add', RUN, 't1', '--base', r.head()).code, 0);
    assert.equal(r.run('reconcile', RUN, 'proto').code, 0);
    assert.ok(fs.existsSync(r.wt('t1')));
    assert.equal(r.events().filter((e) => e.ev === 'remove').length, 1);
    assert.equal(r.events().at(-1).task, 'proto');
  });

  test('bad usage is refused', () => {
    const r = makeRepo();
    for (const res of [r.run('reconcile', RUN), r.run('reconcile')]) {
      assert.notEqual(res.code, 0);
      assert.match(res.lines.join('\n'), /reconcile <slug> <id>/, 'usage lists reconcile');
    }
  });
});
