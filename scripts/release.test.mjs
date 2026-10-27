import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.join(import.meta.dirname, 'release.mjs');

const CHANGELOG = [
  '# Changelog',
  '',
  'All notable changes.',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '- A new thing.',
  '',
  '## [0.10.0] - 2026-10-26',
  '',
  '### Added',
  '- Old thing.',
  ''
].join('\n');

// Same isolation as stable.test.mjs: empty global config, no system config, fixed identity.
function envFor(base, extra = {}) {
  const gitConfig = path.join(base, 'gitconfig');
  if (!fs.existsSync(gitConfig)) fs.writeFileSync(gitConfig, '');
  // A fake home too: the real one would add its global ignore file and any installed claude config.
  const home = path.join(base, 'home');
  fs.mkdirSync(home, { recursive: true });
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    XDG_CONFIG_HOME: home,
    CLAUDE_CONFIG_DIR: home,
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: 't@example.com',
    ...extra
  };
}

// The sandbox dir is the cwd of the bare/base calls and the parent of the work dir.
const baseOf = (cwd) => (path.basename(cwd) === 'work' ? path.dirname(cwd) : cwd);

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: envFor(baseOf(cwd)) });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(root, rel, text) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

// A temp git repo with a bare "origin" and a pre-push hook that leaves a marker, so any push is caught twice.
function sandbox(t, { changelog = CHANGELOG, marketplace = null } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const origin = path.join(base, 'origin.git');
  const root = path.join(base, 'work');
  fs.mkdirSync(root);
  git(base, 'init', '--bare', '-q', origin);
  git(root, 'init', '-q');
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@example.com'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'], ['core.autocrlf', 'false']])
    git(root, 'config', k, v);
  git(root, 'remote', 'add', 'origin', origin);
  write(root, '.claude-plugin/plugin.json', '{\n  "name": "aico",\n  "version": "0.10.0",\n  "description": "x"\n}\n');
  if (marketplace) write(root, '.claude-plugin/marketplace.json', marketplace);
  write(root, 'documentation/README.md', '# Docs\n\n**Current: 0.10.0** (32 Role agents).\n');
  write(root, 'CHANGELOG.md', changelog);
  write(root, 'scripts/check.mjs', "import fs from 'node:fs';\nif (fs.existsSync('FAIL')) { console.error('check failed'); process.exit(1); }\nconsole.log('check ok');\n");
  write(root, 'scripts/ok.mjs', 'console.log("tests ok");\n');
  write(root, 'package.json', '{ "name": "t", "type": "module", "scripts": { "test": "node scripts/ok.mjs" } }\n');
  const marker = path.join(base, 'PUSHED');
  write(root, '.git/hooks/pre-push', `#!/bin/sh\necho pushed > "${marker.split(path.sep).join('/')}"\nexit 1\n`);
  fs.chmodSync(path.join(root, '.git/hooks/pre-push'), 0o755);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  const claude = path.join(base, 'fake-claude.mjs');
  const claudeLog = path.join(base, 'claude-args.json');
  write(base, 'fake-claude.mjs', FAKE_CLAUDE);
  return { root, origin, marker, claude, claudeLog };
}

// A stand-in for the claude CLI: records its arguments and exits with FAKE_CLAUDE_EXIT.
const FAKE_CLAUDE = [
  "import fs from 'node:fs';",
  'fs.writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(process.argv.slice(2)));',
  "console.log(process.env.FAKE_CLAUDE_EXIT === '0' ? 'Validation passed' : 'Validation failed');",
  "process.exit(Number(process.env.FAKE_CLAUDE_EXIT ?? 0));",
  ''
].join('\n');

function run(root, ...args) {
  return runWith(root, {}, ...args);
}

function runWith(root, env, ...args) {
  const base = path.dirname(root);
  const full = { ...envFor(base), AICO_CLAUDE_BIN: path.join(base, 'fake-claude.mjs'), FAKE_CLAUDE_LOG: path.join(base, 'claude-args.json'), FAKE_CLAUDE_EXIT: '0', ...env };
  for (const k of Object.keys(full)) if (full[k] === undefined) delete full[k];
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env: full });
}

// Directory of the git executable, so a PATH without claude still finds git.
function gitDir() {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' });
  return path.dirname(probe.stdout.split('\n')[0].trim());
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('release bumps every version field, rolls the changelog, commits and tags locally', (t) => {
  const s = sandbox(t, { marketplace: '{\n  "name": "aico",\n  "plugins": [\n    { "name": "aico", "version": "0.10.0" }\n  ]\n}\n' });
  const r = run(s.root, '0.11.0');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(read(s.root, '.claude-plugin/plugin.json'), /"version": "0\.11\.0"/);
  assert.match(read(s.root, '.claude-plugin/marketplace.json'), /"version": "0\.11\.0"/);
  assert.match(read(s.root, 'documentation/README.md'), /\*\*Current: 0\.11\.0\*\* \(32 Role agents\)\./);
  const log = read(s.root, 'CHANGELOG.md');
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(log.includes(`## [Unreleased]\n\n## [0.11.0] - ${today}\n\n### Added\n- A new thing.\n\n## [0.10.0]`), log);
  assert.equal(git(s.root, 'tag', '--list', 'v0.11.0'), 'v0.11.0');
  assert.equal(git(s.root, 'status', '--porcelain'), '');
  assert.equal(git(s.root, 'log', '-1', '--format=%s'), 'chore: release v0.11.0');
  assert.equal(git(s.root, 'rev-list', '-n', '1', 'v0.11.0'), git(s.root, 'rev-parse', 'HEAD'));
});

test('release runs npm test without a shell', () => {
  const src = fs.readFileSync(script, 'utf8');
  assert.ok(!/shell:\s*true/.test(src), 'release.mjs must not use shell: true');
});

test('release never pushes', (t) => {
  const s = sandbox(t);
  const r = run(s.root, '0.10.1');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(s.marker), false, 'pre-push hook ran');
  assert.equal(git(s.origin, 'for-each-ref'), '', 'origin received refs');
  const src = fs.readFileSync(script, 'utf8');
  assert.ok(!/\bpush\b/i.test(src), 'release.mjs must not mention push');
});

test('release writes LF only and refuses CRLF inputs', (t) => {
  const s = sandbox(t);
  assert.equal(run(s.root, '0.11.0').status, 0);
  for (const f of ['.claude-plugin/plugin.json', 'documentation/README.md', 'CHANGELOG.md'])
    assert.ok(!read(s.root, f).includes('\r'), `${f} has CR`);
  const c = sandbox(t, { changelog: CHANGELOG.replaceAll('\n', '\r\n') });
  const r = run(c.root, '0.11.0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /CR/);
  assert.equal(git(c.root, 'tag', '--list'), '');
});

test('release refuses a dirty tree', (t) => {
  const s = sandbox(t);
  write(s.root, 'untracked.txt', 'x');
  const r = run(s.root, '0.11.0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /dirty/);
  assert.match(read(s.root, '.claude-plugin/plugin.json'), /0\.10\.0/);
});

test('release refuses anything that is not plain semver, and never reaches a shell', (t) => {
  const s = sandbox(t);
  const bad = ['', '1.2', 'v1.2.3', '1.2.3-beta', '01.2.3', '1.2.3 ', '1.2.3; touch PWNED', '$(touch PWNED)', '1.2.3\n9.9.9'];
  for (const v of bad) {
    const r = run(s.root, v);
    assert.notEqual(r.status, 0, `accepted ${JSON.stringify(v)}`);
    assert.match(r.stderr, /semver|usage/);
  }
  assert.equal(fs.existsSync(path.join(s.root, 'PWNED')), false);
  assert.equal(git(s.root, 'status', '--porcelain'), '');
  assert.notEqual(run(s.root).status, 0);
  assert.notEqual(run(s.root, '0.11.0', 'extra').status, 0);
});

test('release refuses an equal or lower version and an existing tag', (t) => {
  const s = sandbox(t);
  for (const v of ['0.10.0', '0.9.9', '0.2.0']) {
    const r = run(s.root, v);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not higher/);
  }
  git(s.root, 'tag', 'v0.11.0');
  const r = run(s.root, '0.11.0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /tag v0\.11\.0 exists/);
});

test('release compares numerically, not as text', (t) => {
  const s = sandbox(t);
  assert.equal(run(s.root, '0.100.0').status, 0);
});

test('release refuses a CHANGELOG with no Unreleased entries', (t) => {
  const empty = '# Changelog\n\n## [Unreleased]\n\n## [0.10.0] - 2026-10-26\n\n- x\n';
  const missing = '# Changelog\n\n## [0.10.0] - 2026-10-26\n\n- x\n';
  for (const changelog of [empty, missing]) {
    const s = sandbox(t, { changelog });
    const r = run(s.root, '0.11.0');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Unreleased/);
    assert.equal(git(s.root, 'status', '--porcelain'), '');
  }
});

test('a failing check restores every file and leaves no commit or tag', (t) => {
  const s = sandbox(t);
  write(s.root, 'FAIL', '1');
  git(s.root, 'add', '-A');
  git(s.root, 'commit', '-q', '-m', 'make check fail');
  const head = git(s.root, 'rev-parse', 'HEAD');
  const r = run(s.root, '0.11.0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /check failed/);
  assert.equal(git(s.root, 'status', '--porcelain'), '');
  assert.equal(git(s.root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(s.root, 'tag', '--list'), '');
});

test('release runs claude plugin validate --strict . after the bump', (t) => {
  const s = sandbox(t);
  const r = run(s.root, '0.11.0');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.claudeLog, 'utf8')), ['plugin', 'validate', '--strict', '.']);
  assert.equal(git(s.root, 'tag', '--list', 'v0.11.0'), 'v0.11.0');
});

test('a failing validate restores every file and leaves no commit or tag', (t) => {
  const s = sandbox(t);
  const head = git(s.root, 'rev-parse', 'HEAD');
  const r = runWith(s.root, { FAKE_CLAUDE_EXIT: '1' }, '0.11.0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /validate failed/);
  assert.equal(git(s.root, 'status', '--porcelain'), '');
  assert.equal(git(s.root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(s.root, 'tag', '--list'), '');
  assert.match(read(s.root, '.claude-plugin/plugin.json'), /0\.10\.0/);
});

test('a missing claude CLI fails closed with no commit and no tag', (t) => {
  const s = sandbox(t);
  const head = git(s.root, 'rev-parse', 'HEAD');
  const empty = path.join(path.dirname(s.root), 'empty-bin');
  fs.mkdirSync(empty);
  const r = runWith(s.root, {
    AICO_CLAUDE_BIN: undefined,
    Path: undefined,
    PATH: [empty, gitDir(), path.dirname(process.execPath)].join(path.delimiter)
  }, '0.11.0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /validate/);
  assert.equal(git(s.root, 'status', '--porcelain'), '');
  assert.equal(git(s.root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(s.root, 'tag', '--list'), '');
  assert.match(read(s.root, '.claude-plugin/plugin.json'), /0\.10\.0/);
});

test('AICO_CLAUDE_BIN must be absolute, existing and not a .cmd or .bat', (t) => {
  const s = sandbox(t);
  const base = path.dirname(s.root);
  write(base, 'shim.cmd', '@echo off\n');
  write(base, 'shim.bat', '@echo off\n');
  for (const bin of ['claude', 'fake-claude.mjs', path.join(base, 'shim.cmd'), path.join(base, 'shim.bat'), path.join(base, 'SHIM.CMD'), path.join(base, 'nope.mjs'), base]) {
    const r = runWith(s.root, { AICO_CLAUDE_BIN: bin }, '0.11.0');
    assert.notEqual(r.status, 0, `accepted ${bin}`);
    assert.match(r.stderr, /AICO_CLAUDE_BIN/);
    assert.equal(git(s.root, 'status', '--porcelain'), '');
    assert.equal(git(s.root, 'tag', '--list'), '');
  }
});

test('a validate that prints far too much output is bounded and fails closed', (t) => {
  const s = sandbox(t);
  const base = path.dirname(s.root);
  write(base, 'noisy.mjs', "process.stdout.write('x'.repeat(50 * 1024 * 1024));\n");
  const r = runWith(s.root, { AICO_CLAUDE_BIN: path.join(base, 'noisy.mjs') }, '0.11.0');
  assert.notEqual(r.status, 0);
  assert.equal(git(s.root, 'tag', '--list'), '');
  assert.equal(git(s.root, 'status', '--porcelain'), '');
});

test('test git calls use an isolated config and a fixed committer identity', (t) => {
  const s = sandbox(t);
  assert.equal(git(s.root, 'config', '--global', '--list'), '');
  assert.equal(git(s.root, 'log', '-1', '--format=%ce'), 't@example.com');
});

test('release.mjs names the validate command in full and has no shell', () => {
  const src = fs.readFileSync(script, 'utf8');
  assert.ok(src.includes("'plugin', 'validate', '--strict', '.'"));
  assert.ok(!/shell:\s*(true|process)/.test(src));
  assert.ok(!/\bexec(Sync)?\(/.test(src));
});
