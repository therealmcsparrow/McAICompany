import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.join(import.meta.dirname, 'stable.mjs');

// Every git call in these tests runs against temp repos with an isolated config.
function envFor(base, extra = {}) {
  const gitConfig = path.join(base, 'gitconfig');
  if (!fs.existsSync(gitConfig)) fs.writeFileSync(gitConfig, '');
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: 't@example.com',
    ...extra
  };
}

function sandbox(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const origin = path.join(base, 'origin.git');
  const root = path.join(base, 'work');
  fs.mkdirSync(root);
  const env = envFor(base);
  const g = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  g(base, 'init', '--bare', '--quiet', '--initial-branch=main', origin);
  g(root, 'init', '--quiet', '--initial-branch=main');
  for (const [k, v] of [['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'], ['core.autocrlf', 'false']]) g(root, 'config', k, v);
  g(root, 'remote', 'add', 'origin', origin);
  const commit = (name) => {
    fs.writeFileSync(path.join(root, name), name);
    g(root, 'add', '--', name);
    g(root, 'commit', '--quiet', `--message=add ${name}`);
    return g(root, 'rev-parse', 'HEAD');
  };
  const c1 = commit('a.txt');
  g(root, 'tag', '-a', 'v0.1.0', '-m', 'v0.1.0');
  const c2 = commit('b.txt');
  g(root, 'tag', '-a', 'v0.2.0', '-m', 'v0.2.0');
  g(root, 'push', '--quiet', 'origin', 'refs/heads/main:refs/heads/main');
  const remote = (...args) => g(origin, ...args);
  const run = (version, extra = {}) =>
    spawnSync(process.execPath, version === undefined ? [script] : [script, version], { cwd: root, encoding: 'utf8', env: envFor(base, extra) });
  return { base, origin, root, g, c1, c2, commit, remote, run };
}

const remoteRef = (s, ref) => s.remote('for-each-ref', '--format=%(objectname)', ref);

test('stable pushes the annotated tag and moves stable to its commit, first run', (t) => {
  const s = sandbox(t);
  const r = s.run('0.2.0');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.stdout.trim(), `stable -> v0.2.0 (${s.c2.slice(0, 7)})`);
  assert.equal(s.remote('rev-parse', 'refs/heads/stable'), s.c2);
  assert.equal(s.remote('cat-file', '-t', 'refs/tags/v0.2.0'), 'tag');
  assert.equal(s.remote('rev-parse', 'refs/tags/v0.2.0^{commit}'), s.c2);
  assert.equal(remoteRef(s, 'refs/tags/v0.1.0'), '', 'only the requested tag is pushed');
});

test('a second run is a no-op and an earlier tag moves stable back (rollback)', (t) => {
  const s = sandbox(t);
  assert.equal(s.run('0.2.0').status, 0);
  const again = s.run('0.2.0');
  assert.equal(again.status, 0, again.stderr);
  assert.equal(s.remote('rev-parse', 'refs/heads/stable'), s.c2);
  const back = s.run('0.1.0');
  assert.equal(back.status, 0, back.stderr);
  assert.equal(s.remote('rev-parse', 'refs/heads/stable'), s.c1);
  assert.equal(s.remote('rev-parse', 'refs/tags/v0.2.0^{commit}'), s.c2, 'a pushed tag stays where it was');
});

test('the stable push uses the explicit lease with the sha it read, full refspecs and no bare force', (t) => {
  const s = sandbox(t);
  assert.equal(s.run('0.2.0').status, 0);
  const trace = path.join(s.base, 'trace.txt');
  const r = s.run('0.1.0', { GIT_TRACE: trace });
  assert.equal(r.status, 0, r.stderr);
  const pushes = fs.readFileSync(trace, 'utf8').split(String.fromCharCode(10)).filter((l) => / git push /.test(l));
  const push = pushes.find((l) => l.includes('refs/heads/stable'));
  assert.ok(push, 'no push of stable in trace');
  assert.ok(push.includes(` --force-with-lease=refs/heads/stable:${s.c2} `), push);
  assert.ok(push.endsWith(` ${s.c1}:refs/heads/stable`), push);
  assert.ok(!/ --force | -f | [+]/.test(push), push);
});

test('stable refuses a lightweight tag', (t) => {
  const s = sandbox(t);
  s.g(s.root, 'tag', 'v0.3.0');
  const r = s.run('0.3.0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not an annotated tag/);
  assert.equal(remoteRef(s, 'refs/tags/v0.3.0'), '');
  assert.equal(remoteRef(s, 'refs/heads/stable'), '');
});

test('stable refuses a missing tag', (t) => {
  const s = sandbox(t);
  const r = s.run('9.9.9');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /v9\.9\.9/);
  assert.equal(remoteRef(s, 'refs/heads/stable'), '');
});

test('stable refuses a tag whose commit is not on origin/main', (t) => {
  const s = sandbox(t);
  s.commit('c.txt');
  s.g(s.root, 'tag', '-a', 'v0.3.0', '-m', 'v0.3.0');
  const r = s.run('0.3.0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not merged/);
  assert.equal(remoteRef(s, 'refs/tags/v0.3.0'), '', 'the tag is not pushed either');
  assert.equal(remoteRef(s, 'refs/heads/stable'), '');
});

test('stable refuses when the remote tag is a different object, and never moves it', (t) => {
  const s = sandbox(t);
  assert.equal(s.run('0.2.0').status, 0);
  const before = remoteRef(s, 'refs/tags/v0.2.0');
  s.g(s.root, 'tag', '-d', 'v0.2.0');
  s.g(s.root, 'tag', '-a', 'v0.2.0', '-m', 'recreated', s.c2);
  const r = s.run('0.2.0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /differs/);
  assert.equal(remoteRef(s, 'refs/tags/v0.2.0'), before);
});

test('stable fails closed when origin cannot be fetched', (t) => {
  const s = sandbox(t);
  s.g(s.root, 'remote', 'set-url', 'origin', path.join(s.base, 'does-not-exist.git'));
  const r = s.run('0.2.0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /stable:/);
  assert.equal(remoteRef(s, 'refs/heads/stable'), '');
});

test('a stale lease is rejected: stable moved on the remote after it was read', (t) => {
  const s = sandbox(t);
  assert.equal(s.run('0.2.0').status, 0);
  // A pre-receive-free race: a hook-less bare repo cannot move mid-run, so check git's own behavior with the same flag form.
  const other = s.commit('d.txt');
  s.g(s.root, 'push', '--quiet', 'origin', `${other}:refs/heads/stable`, '--force');
  const stale = spawnSync('git', ['push', `--force-with-lease=refs/heads/stable:${s.c2}`, 'origin', `${s.c1}:refs/heads/stable`], {
    cwd: s.root,
    encoding: 'utf8',
    env: envFor(s.base)
  });
  assert.notEqual(stale.status, 0);
  assert.equal(s.remote('rev-parse', 'refs/heads/stable'), other);
});

test('stable accepts only plain semver and never reaches git or a shell with anything else', (t) => {
  const s = sandbox(t);
  const bad = ['', '1.2', 'v0.2.0', '0.2.0-beta', '00.2.0', '0.2.0 ', '--help', '-1.2.3', '0.2.0; touch PWNED', '$(touch PWNED)', '0.2.0\n0.1.0', 'refs/tags/v0.2.0', '0.2.0'.padEnd(5000, '0')];
  for (const v of bad) {
    const r = s.run(v);
    assert.notEqual(r.status, 0, `accepted ${JSON.stringify(v.slice(0, 40))}`);
    assert.match(r.stderr, /semver|usage/);
  }
  assert.equal(fs.existsSync(path.join(s.root, 'PWNED')), false);
  assert.notEqual(s.run().status, 0);
  assert.notEqual(spawnSync(process.execPath, [script, '0.2.0', 'extra'], { cwd: s.root, encoding: 'utf8', env: envFor(s.base) }).status, 0);
  assert.equal(remoteRef(s, 'refs/heads/stable'), '');
});

test('stable.mjs source follows the git rules: no shell, explicit lease, full refspecs, exit codes read exactly', () => {
  const src = fs.readFileSync(script, 'utf8');
  assert.ok(!/shell:\s*(true|process)/.test(src));
  assert.ok(!/\bexec(Sync)?\(/.test(src));
  assert.ok(/--force-with-lease=refs\/heads\/stable:/.test(src));
  assert.ok(!/'--force'|'-f'|`\+|'\+/.test(src));
  assert.ok(src.includes('GIT_TERMINAL_PROMPT'));
  assert.ok(src.includes('--end-of-options'));
  assert.ok(src.includes('--is-ancestor'));
  assert.ok(src.includes('refs/tags/v${version}:refs/tags/v${version}'));
  assert.ok(src.includes(':refs/heads/stable'));
});

test('npm run stable is wired to scripts/stable.mjs', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.stable, 'node scripts/stable.mjs');
});

test('stable writes LF only', () => {
  const src = fs.readFileSync(script, 'utf8');
  assert.ok(!src.includes('\r'));
});
