import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main as worktree } from './worktree.mjs';

const ID = 'P20261108.000001';
const RUN = `${ID}-22.25.00`;
const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-full-id-home-'));
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
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-full-id-')));
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
  fs.mkdirSync(path.join(repo, '.company', 'work', RUN), { recursive: true });
  return { base, repo, head: () => git(repo, 'rev-parse', 'HEAD'), run: (...args) => worktree(args, { root: repo, now: NOW }) };
}

test('add takes the full ticket ID of its own project and makes the local worktree', () => {
  const r = makeRepo();
  const res = r.run('add', RUN, `${ID}-T1`, '--base', r.head());
  assert.equal(res.code, 0, res.lines.join('\n'));
  assert.equal(res.lines[0], `Worktree: ${path.join(r.base, 'repo.aico-wt', ID, 't1')}`);
  assert.ok(git(r.repo, 'rev-parse', `refs/heads/aico-wt/${ID}/t1`));
});

test('add refuses the full ticket ID of another project', () => {
  const r = makeRepo();
  const res = r.run('add', RUN, 'P20261108.000002-T1', '--base', r.head());
  assert.notEqual(res.code, 0);
});
