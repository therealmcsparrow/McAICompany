import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { main } from './worktree.mjs';

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const SLUG = 'iso';

// The plan-tasks record of an open wave, with the plan it hashes.
function writeWave(r, ids) {
  const at = '2026-10-29T10:00:00Z';
  const dir = path.join(r.repo, '.company', 'work', SLUG);
  const planText = `# Plan\n\n## Tasks\n\n${ids.map((id) => `### ${id} title of ${id}\n`).join('\n')}`;
  fs.writeFileSync(path.join(dir, '02-plan.md'), planText);
  const hash = crypto.createHash('sha256').update(planText).digest('hex').slice(0, 12);
  const rows = [{ v: 1, at, ev: 'begin', plan: '02-plan.md', hash, cap: 3, mode: 'waves', tasks: ids.length, ow: [] },
    ...ids.map((t) => ({ v: 1, at, ev: 'start', task: t, round: 0, ow: [] }))];
  fs.writeFileSync(path.join(dir, 'parallel.jsonl'), `${rows.map((x) => JSON.stringify(x)).join('\n')}\n`);
}

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-iso-home-'));
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

function git(cwd, ...args) {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: GLOBAL_CONFIG, GIT_CONFIG_NOSYSTEM: '1' };
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\n$/, '');
}

function makeRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-iso-'));
  bases.push(base);
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', `--initial-branch=aico/${SLUG}`);
  for (const [k, v] of [['user.name', 'Test'], ['user.email', 'test@example.com'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) {
    git(repo, 'config', k, v);
  }
  for (const f of ['a.txt', 'b.txt', 'main.txt']) fs.writeFileSync(path.join(repo, f), `${f} base\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '--message=base');
  fs.mkdirSync(path.join(repo, '.company', 'work', SLUG), { recursive: true });
  const argv = [];
  return {
    base, repo, argv,
    g: (...a) => git(repo, ...a),
    run: (...args) => main(args, { root: repo, now: NOW, hook: (n, d) => { if (n === 'git') argv.push(d.args); } })
  };
}

const FORBIDDEN = new Set(['-X', '-s', '--strategy', '--strategy-option', '--ours', '--theirs', 'reset', 'checkout', 'stash']);

function snapshot(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (f === '.git') continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile()) out[f] = fs.readFileSync(p, 'utf8');
  }
  return { files: out, status: git(dir, 'status', '--porcelain=v1', '--untracked-files=all'), head: git(dir, 'rev-parse', 'HEAD') };
}

describe('two worktrees are isolated from each other and from the main tree', () => {
  test('git stash, reset --hard and checkout -- . in A leave B and the main tree intact', () => {
    const r = makeRepo();
    const base = r.g('rev-parse', 'HEAD');
    const wtOf = (id) => r.run('add', SLUG, id, '--base', base).lines[0].replace(/^Worktree: /, '');
    const a = wtOf('t1');
    const b = wtOf('t2');
    // both builders have committed and uncommitted work
    for (const [wt, name] of [[a, 'alpha'], [b, 'beta']]) {
      fs.writeFileSync(path.join(wt, `${name}.txt`), `${name} committed\n`);
      git(wt, 'add', '-A');
      git(wt, 'commit', '--quiet', `--message=${name}`);
      fs.writeFileSync(path.join(wt, 'a.txt'), `${name} dirty\n`);
      fs.writeFileSync(path.join(wt, `${name}-new.txt`), `${name} untracked\n`);
    }
    fs.writeFileSync(path.join(r.repo, 'main.txt'), 'main dirty\n');
    const beforeB = snapshot(b);
    const beforeMain = snapshot(r.repo);
    const beforeA = snapshot(a);
    assert.ok(beforeB.status.includes('a.txt'));

    // what a careless builder in A could run
    git(a, 'stash', '--include-untracked');
    git(a, 'reset', '--hard', 'HEAD~1');
    git(a, 'checkout', '--', '.');

    assert.deepEqual(snapshot(b), beforeB);
    assert.deepEqual(snapshot(r.repo), beforeMain);
    assert.notDeepEqual(snapshot(a), beforeA);
    assert.equal(fs.readFileSync(path.join(b, 'a.txt'), 'utf8'), 'beta dirty\n');
    assert.equal(fs.readFileSync(path.join(r.repo, 'main.txt'), 'utf8'), 'main dirty\n');
    assert.equal(r.g('rev-parse', `aico-wt/${SLUG}/t2`), beforeB.head);
  });

  test('the script itself never runs a command that touches another tree: the full flow holds no forbidden argument', () => {
    const r = makeRepo();
    const base = r.g('rev-parse', 'HEAD');
    const mk = (id, file, text) => {
      const wt = r.run('add', SLUG, id, '--base', base).lines[0].replace(/^Worktree: /, '');
      fs.writeFileSync(path.join(wt, file), text);
      git(wt, 'add', '-A');
      git(wt, 'commit', '--quiet', `--message=${id}`);
      return wt;
    };
    mk('t1', 'a.txt', 'one\n');
    mk('t2', 'a.txt', 'two\n');
    mk('t3', 'c.txt', 'c\n');
    mk('proto', 'p.txt', 'p\n');
    writeWave(r, ['T1', 'T2', 'T3']);
    assert.equal(r.run('changed', SLUG, 't1').code, 0);
    assert.equal(r.run('merge', SLUG).code, 2);
    assert.equal(r.run('cleanup', SLUG).code, 2);
    assert.equal(r.run('cleanup', SLUG, '--archive').code, 0);
    assert.equal(r.run('leftovers').code, 0);
    assert.equal(r.run('protocheck', SLUG).code, 0);
    assert.ok(r.argv.length > 40);
    for (const args of r.argv) {
      assert.deepEqual(args.slice(0, 4), ['--no-replace-objects', '--no-optional-locks', '-c', 'core.fsmonitor=false']);
      for (const a of args) assert.ok(!FORBIDDEN.has(a), `${a} in ${args.join(' ')}`);
      assert.ok(!args.includes('--force') || (args.includes('worktree') && args.includes('remove')), args.join(' '));
    }
    // no call changed the process working folder: every worktree call names its folder with -C and an absolute path
    for (const args of r.argv) {
      const i = args.indexOf('-C');
      if (i !== -1) assert.ok(path.isAbsolute(args[i + 1]), args.join(' '));
    }
  });

  test('a conflict leaves the main tree exactly as before the failed merge', () => {
    const r = makeRepo();
    const base = r.g('rev-parse', 'HEAD');
    for (const [id, text] of [['t1', 'one\n'], ['t2', 'two\n']]) {
      const wt = r.run('add', SLUG, id, '--base', base).lines[0].replace(/^Worktree: /, '');
      fs.writeFileSync(path.join(wt, 'a.txt'), text);
      git(wt, 'add', '-A');
      git(wt, 'commit', '--quiet', `--message=${id}`);
    }
    writeWave(r, ['T1', 'T2']);
    const res = r.run('merge', SLUG);
    assert.equal(res.code, 2);
    const mergedHead = r.g('rev-parse', 'HEAD');
    assert.equal(r.g('status', '--porcelain=v1', '--untracked-files=no'), '');
    assert.equal(fs.readFileSync(path.join(r.repo, 'a.txt'), 'utf8'), 'one\n');
    assert.equal(r.g('rev-parse', 'HEAD'), mergedHead);
    assert.ok(!fs.existsSync(path.join(r.repo, '.git', 'MERGE_HEAD')));
  });
});
