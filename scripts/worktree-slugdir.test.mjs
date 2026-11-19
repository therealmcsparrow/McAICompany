// Regression tests: `worktree cleanup <slug>` leaves the empty `<root>.aico-wt/<ProjectID>` folder behind once the run has
// no live add and no registered worktree. Temp repos only, never the real .company.
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

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-slugdir-home-'));
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
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-slugdir-')));
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
  fs.mkdirSync(path.join(repo, '.company', 'work', ID, '01-feature'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.company', 'work', ID, '00-project.md'), '# Project\n');
  return {
    repo,
    slugDir: path.join(base, 'repo.aico-wt', ID),
    wt: (id) => path.join(base, 'repo.aico-wt', ID, id),
    head: () => git(repo, 'rev-parse', 'HEAD'),
    run: (...args) => worktree(args, { root: repo, now: NOW })
  };
}

describe('worktree cleanup slug folder', () => {
  test('bug: cleanup of the last live add removes the then-empty <ProjectID> folder', () => {
    const r = makeRepo();
    const add = r.run('add', RUN, 'proto', '--base', r.head());
    assert.equal(add.code, 0, add.lines.join('\n'));
    const res = r.run('cleanup', RUN, '--archive');
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.equal(fs.existsSync(r.wt('proto')), false, 'worktree folder gone');
    assert.equal(fs.existsSync(r.slugDir), false, `empty slug folder left behind: ${r.slugDir}`);
  });

  test('bug: after reconcile of a hand-removed proto, cleanup exits 0 and drops the empty <ProjectID> folder', () => {
    const r = makeRepo();
    assert.equal(r.run('add', RUN, 'proto', '--base', r.head()).code, 0);
    git(r.repo, 'worktree', 'remove', '--force', r.wt('proto'));
    git(r.repo, 'branch', '-D', `aico-wt/${ID}/proto`);
    assert.equal(r.run('reconcile', RUN, 'proto').code, 0);
    const res = r.run('cleanup', RUN);
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.equal(fs.existsSync(r.slugDir), false, `empty slug folder left behind: ${r.slugDir}`);
  });

  test('guard: a slug folder that still holds a foreign entry is kept', () => {
    const r = makeRepo();
    assert.equal(r.run('add', RUN, 'proto', '--base', r.head()).code, 0);
    fs.mkdirSync(path.join(r.slugDir, 'keep-me'));
    const res = r.run('cleanup', RUN, '--archive');
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.equal(fs.existsSync(path.join(r.slugDir, 'keep-me')), true);
  });

  test('guard: a <ProjectID> folder that is a link or junction to an empty folder is not removed', (t) => {
    const r = makeRepo();
    assert.equal(r.run('add', RUN, 'proto', '--base', r.head()).code, 0);
    git(r.repo, 'worktree', 'remove', '--force', r.wt('proto'));
    git(r.repo, 'branch', '-D', `aico-wt/${ID}/proto`);
    assert.equal(r.run('reconcile', RUN, 'proto').code, 0);
    // The slug folder is now empty; swap it for a link to an empty folder elsewhere.
    const target = path.join(path.dirname(r.slugDir), 'link-target');
    fs.mkdirSync(target);
    fs.rmdirSync(r.slugDir);
    let kind = null;
    for (const type of process.platform === 'win32' ? ['junction', 'dir'] : ['dir']) {
      try { fs.symlinkSync(target, r.slugDir, type); kind = type; break; } catch { /* try next */ }
    }
    if (!kind) { t.skip('cannot create a symlink or junction on this OS/account'); return; }
    assert.equal(fs.lstatSync(r.slugDir).isSymbolicLink(), true, 'setup: slug folder is a link');
    const res = r.run('cleanup', RUN);
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.equal(fs.lstatSync(r.slugDir).isSymbolicLink(), true, 'link was removed');
    assert.equal(fs.existsSync(target), true, 'link target was removed');
  });

  test('guard: cleanup that ends in a record mismatch exits 2 and keeps the empty <ProjectID> folder', () => {
    const r = makeRepo();
    assert.equal(r.run('add', RUN, 'proto', '--base', r.head()).code, 0);
    // Hand-remove worktree and branch, no reconcile: the record still lists proto.
    git(r.repo, 'worktree', 'remove', '--force', r.wt('proto'));
    git(r.repo, 'branch', '-D', `aico-wt/${ID}/proto`);
    assert.equal(fs.existsSync(r.slugDir), true, 'setup: empty slug folder exists');
    assert.equal(fs.readdirSync(r.slugDir).length, 0, 'setup: slug folder is empty');
    const res = r.run('cleanup', RUN);
    assert.equal(res.code, 2, res.lines.join('\n'));
    assert.match(res.lines.join('\n'), /record mismatch proto/);
    assert.equal(fs.existsSync(r.slugDir), true, 'slug folder dropped after a record mismatch');
  });
});
