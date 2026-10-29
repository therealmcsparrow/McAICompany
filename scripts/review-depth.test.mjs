import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { classify } from './review-depth.mjs';
// Remove the temp dirs this file made, once the run is over.
const __tmpDirs = [];
const __mkdtemp = fs.mkdtempSync;
const __rmTree = fs.rmSync;
fs.mkdtempSync = (...a) => { const d = __mkdtemp(...a); __tmpDirs.push(d); return d; };
process.on('exit', () => { for (const d of __tmpDirs) { try { __rmTree(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const script = path.join(import.meta.dirname, 'review-depth.mjs');
const SLUG = 'rd';
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-home-'));
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
const ENV = () => {
  const e = { ...process.env, HOME, USERPROFILE: HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(HOME, 'none') };
  delete e.NODE_TEST_CONTEXT;
  return e;
};
const CORE = ['skills/handoff', 'scripts/check.mjs'];

test('classify: plain source is standard', () => {
  assert.equal(classify(['src/util.mjs', 'README.md'], { core: CORE, risk: 'low' }).depth, 'standard');
});

test('classify: risk high forces full', () => {
  assert.equal(classify(['src/util.mjs'], { core: CORE, risk: 'high' }).depth, 'full');
});

test('classify: core file and core folder', () => {
  assert.equal(classify(['scripts/check.mjs'], { core: CORE }).depth, 'full');
  assert.equal(classify(['skills/handoff/SKILL.md'], { core: CORE }).depth, 'full');
  assert.equal(classify(['skills/handoffs/x.md'], { core: CORE }).depth, 'standard');
  assert.equal(classify(['scripts/check.mjs.bak'], { core: CORE }).depth, 'standard');
});

test('classify: contract paths', () => {
  for (const p of ['docs/contracts/x.md', 'a/contracts/y.ts', 'api/x.proto', 'openapi.yaml', 'a/asyncapi.json']) {
    assert.equal(classify([p], { core: [] }).depth, 'full', p);
  }
});

test('classify: security paths', () => {
  for (const p of ['src/auth.ts', 'src/Login/view.ts', 'lib/session-store.js', 'db/migrations/001.sql',
    '.github/workflows/ci.yml', 'agents/x.md', '.company/standards.md', '.company/standards/a.md',
    '.company/checks.json', '.company/settings.json', 'package.json', 'sub/package-lock.json', 'deps/a.txt',
    'src/payments/x.ts', 'src/permissions.ts', 'src/secret.ts', 'src/crypto.ts']) {
    assert.equal(classify([p], { core: [] }).depth, 'full', p);
  }
  assert.equal(classify(['agents/sub/x.txt'], { core: [] }).depth, 'standard');
});

test('classify: reasons list only the forcing paths', () => {
  const r = classify(['src/a.mjs', 'src/auth.mjs'], { core: [] });
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0], /^reason: src\/auth\.mjs — /);
});

function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-'));
  const g = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8', env: ENV() });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.excludesFile', os.devNull);
  fs.mkdirSync(path.join(d, '.company'));
  fs.writeFileSync(path.join(d, '.company/project.md'), '# P\n\n## Core\n<!-- c -->\n- skills/pipeline: wiring\n- scripts/check.mjs: gate\n\n## Modules\n- (none yet)\n');
  fs.writeFileSync(path.join(d, 'a.txt'), 'a\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  const base = g('rev-parse', 'HEAD').stdout.trim();
  g('checkout', '-q', '-b', `aico/${SLUG}`);
  const commit = (file) => {
    fs.mkdirSync(path.dirname(path.join(d, file)), { recursive: true });
    fs.writeFileSync(path.join(d, file), 'x\n');
    g('add', '-A');
    g('commit', '-q', '-m', 'c');
  };
  return { d, base, commit };
}
// A base id gets the run slug unless the test passes its own --run.
const run = (d, args) => {
  const withRun = /^[0-9a-f]{40}$/.test(args[0] ?? '') && !args.includes('--run') ? [args[0], '--run', SLUG, ...args.slice(1)] : args;
  return spawnSync('node', [script, ...withRun], { cwd: d, encoding: 'utf8', env: ENV() });
};

test('cli: standard for a plain diff', () => {
  const { d, base, commit } = repo();
  commit('src/util.mjs');
  const r = run(d, [base]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'standard\n');
});

test('cli: full with reason for a core path read from project.md', () => {
  const { d, base, commit } = repo();
  commit('skills/pipeline/SKILL.md');
  const r = run(d, [base]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.split('\n')[0], 'full');
  assert.match(r.stdout, /reason: skills\/pipeline\/SKILL\.md — core/);
});

test('cli: path with spaces is handled whole', () => {
  const { d, base, commit } = repo();
  commit('my docs/login page.md');
  assert.match(run(d, [base]).stdout, /reason: my docs\/login page\.md — /);
});

test('cli: --risk high forces full', () => {
  const { d, base, commit } = repo();
  commit('src/util.mjs');
  assert.equal(run(d, [base, '--risk', 'high']).stdout.split('\n')[0], 'full');
});

test('cli: refuses bad sha and bad risk with exit 2', () => {
  const { d, base } = repo();
  for (const args of [['zzzz'], ['HEAD; rm -rf'], [base, '--risk', 'extreme'], [base, '--risk'], []]) {
    const r = run(d, args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stdout, /^refused: /);
  }
});

test('cli: unreadable diff is full with diff unavailable', () => {
  const { d } = repo();
  const r = run(d, ['d'.repeat(40)]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'full\nreason: diff unavailable\n');
});

test('no CR bytes in output or source', () => {
  const { d, base, commit } = repo();
  commit('src/auth.mjs');
  assert.ok(!run(d, [base]).stdout.includes('\r'));
  assert.ok(!fs.readFileSync(script, 'utf8').includes('\r'));
});

// ---- staged, worktree, --repo, --json ----

const git = (d, ...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8', env: ENV() });
const put = (d, file, body = 'x\n') => {
  fs.mkdirSync(path.dirname(path.join(d, file)), { recursive: true });
  fs.writeFileSync(path.join(d, file), body);
};
const json = (d, args) => JSON.parse(run(d, [...args, '--json']).stdout);
const bare = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-nohead-'));
  git(d, 'init', '-q');
  git(d, 'config', 'user.email', 't@t');
  git(d, 'config', 'user.name', 't');
  git(d, 'config', 'core.excludesFile', os.devNull);
  return d;
};

test('text: output for a base diff is byte for byte the same', () => {
  const { d, base, commit } = repo();
  commit('src/util.mjs');
  commit('src/auth.mjs');
  commit('skills/pipeline/x.md');
  commit('docs/contracts/y.md');
  assert.equal(run(d, [base, '--risk', 'high']).stdout, [
    'full',
    'reason: risk tier — high',
    'reason: docs/contracts/y.md — contract path',
    'reason: skills/pipeline/x.md — core path',
    'reason: src/auth.mjs — security path',
    '',
  ].join('\n'));
});

test('staged: lists only staged paths', () => {
  const { d } = repo();
  put(d, 'src/a.mjs');
  put(d, 'src/auth.mjs');
  git(d, 'add', 'src/a.mjs');
  const r = run(d, ['--staged']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'standard\n');
  git(d, 'add', 'src/auth.mjs');
  assert.equal(run(d, ['--staged']).stdout, 'full\nreason: src/auth.mjs — security path\n');
});

test('staged: a repo with no HEAD yet lists every staged path', () => {
  const d = bare();
  put(d, 'a.txt');
  put(d, 'hooks/hooks.json');
  git(d, 'add', '-A');
  const j = json(d, ['--staged']);
  assert.equal(j.source, 'staged');
  assert.equal(j.base, null);
  assert.deepEqual(j.paths.map((p) => p.path).sort(), ['a.txt', 'hooks/hooks.json']);
  assert.equal(j.depth, 'full');
});

test('worktree: staged, unstaged and untracked files', () => {
  const { d } = repo();
  put(d, 'a.txt', 'changed\n');
  put(d, 'src/new.mjs');
  git(d, 'add', 'src/new.mjs');
  put(d, 'auth-untracked.txt');
  const j = json(d, ['--worktree']);
  assert.equal(j.source, 'worktree');
  assert.deepEqual(j.paths.map((p) => p.path).sort(), ['a.txt', 'auth-untracked.txt', 'src/new.mjs']);
  assert.equal(j.depth, 'full');
});

test('worktree: an untracked file in a Core folder or a new folder is listed, an ignored one is not', () => {
  const { d } = repo();
  put(d, 'skills/pipeline/new.md');
  put(d, 'deep/er/file.txt');
  put(d, 'ignored.log');
  fs.writeFileSync(path.join(d, '.gitignore'), '*.log\n');
  const j = json(d, ['--worktree']);
  assert.deepEqual(j.paths.map((p) => p.path).sort(), ['.gitignore', 'deep/er/file.txt', 'skills/pipeline/new.md']);
  assert.equal(j.depth, 'full');
});

test('worktree: untracked paths are relative to the top level when --repo is a subfolder', () => {
  const { d } = repo();
  put(d, 'sub/inner/x.txt');
  put(d, 'skills/pipeline/new.md');
  const j = json(d, ['--worktree', '--repo', path.join(d, 'sub')]);
  assert.deepEqual(j.paths.map((p) => p.path).sort(), ['skills/pipeline/new.md', 'sub/inner/x.txt']);
});

test('worktree: an untracked path with a space or a newline is listed whole', (t) => {
  const { d } = repo();
  put(d, 'with space/a b.txt');
  const want = ['with space/a b.txt'];
  try {
    put(d, 'skills/pipeline/new\nline.md');
    want.unshift('skills/pipeline/new\nline.md');
  } catch {
    t.diagnostic('no newline in file names');
  }
  assert.deepEqual(json(d, ['--worktree']).paths.map((p) => p.path).sort(), want.sort());
});

test('worktree: a path staged and then edited is listed once', () => {
  const { d } = repo();
  put(d, 'src/a.mjs');
  git(d, 'add', 'src/a.mjs');
  put(d, 'src/a.mjs', 'y\n');
  assert.deepEqual(json(d, ['--worktree']).paths.map((p) => p.path), ['src/a.mjs']);
});

test('worktree: no HEAD lists the staged and the untracked paths', () => {
  const d = bare();
  put(d, 'src/a.mjs');
  git(d, 'add', '-A');
  put(d, 'src/b.mjs');
  assert.deepEqual(json(d, ['--worktree']).paths.map((p) => p.path).sort(), ['src/a.mjs', 'src/b.mjs']);
});

test('staged: untracked files are not listed', () => {
  const { d } = repo();
  put(d, 'src/untracked.mjs');
  assert.deepEqual(json(d, ['--staged']).paths, []);
});

test('staged: empty index is standard with no paths', () => {
  const { d } = repo();
  const j = json(d, ['--staged']);
  assert.deepEqual(j.paths, []);
  assert.equal(j.depth, 'standard');
  assert.equal(j.truncated, false);
});

test('mode: exactly one of base-sha, --staged, --worktree', () => {
  const { d, base } = repo();
  for (const args of [[], ['--staged', '--worktree'], [base, '--staged'], [base, '--worktree'], ['--json']]) {
    const r = run(d, args);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stdout, 'refused: give one of <base>, --staged, --worktree\n', args.join(' '));
  }
});

test('args: hostile and malformed flags are refused', () => {
  const { d } = repo();
  for (const args of [['--staged', '--staged'], ['--staged', '--repo'], ['--staged', '--repo', '--json'], ['--staged', '--json', '--json'],
    ['--staged', '--repo', '.', '--repo', '.'], ['--staged', '--bogus'], ['--staged', 'extra']]) {
    const r = run(d, args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stdout, /^refused: /, args.join(' '));
  }
});

test('--repo: outside the project is refused', () => {
  const { d } = repo();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-other-'));
  git(other, 'init', '-q');
  for (const target of [other, path.join(d, '..'), path.join(d, 'no-such-dir')]) {
    const r = run(d, ['--staged', '--repo', target]);
    assert.equal(r.status, 2, target);
    assert.equal(r.stdout, 'refused: repo outside the project\n', target);
  }
});

test('--repo: a symlink that leaves the project is refused', (t) => {
  const { d } = repo();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-link-'));
  git(other, 'init', '-q');
  try {
    fs.symlinkSync(other, path.join(d, 'link'), 'junction');
  } catch {
    t.skip('symlinks not available');
    return;
  }
  const r = run(d, ['--staged', '--repo', path.join(d, 'link')]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, 'refused: repo outside the project\n');
});

test('--repo: the project itself and a folder inside it are accepted', () => {
  const { d } = repo();
  put(d, 'sub/a.txt');
  git(d, 'add', '-A');
  for (const target of [d, path.join(d, 'sub'), '.', 'sub']) {
    const r = run(d, ['--staged', '--repo', target]);
    assert.equal(r.status, 0, target);
    assert.equal(r.stdout, 'standard\n', target);
  }
});

test('--repo: a sibling whose name starts with the project name is refused', () => {
  const { d } = repo();
  const sib = `${d}-sibling`;
  fs.mkdirSync(sib);
  git(sib, 'init', '-q');
  assert.equal(run(d, ['--staged', '--repo', sib]).status, 2);
});

test('--repo: outside any repository is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-norepo-'));
  const r = run(dir, ['--staged', '--repo', dir]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^refused: /);
});

test('json: shape for a base diff, tier echoes --risk', () => {
  const { d, base, commit } = repo();
  commit('docs/contracts/x.md');
  const j = json(d, [base, '--risk', 'medium']);
  assert.deepEqual(j, {
    v: 1, source: 'base', base, tier: 'medium', depth: 'full',
    paths: [{ path: 'docs/contracts/x.md', categories: ['contract'], module: null }],
    reasons: [{ path: 'docs/contracts/x.md', rule: 'contract path' }],
    truncated: false,
  });
});

test('json: tier is unknown without --risk and unknown is not high', () => {
  const { d, base, commit } = repo();
  commit('src/util.mjs');
  const j = json(d, [base]);
  assert.equal(j.tier, 'unknown');
  assert.equal(j.depth, 'standard');
  assert.deepEqual(j.reasons, []);
});

test('json: --risk high adds a risk tier reason', () => {
  const { d, base, commit } = repo();
  commit('src/util.mjs');
  const j = json(d, [base, '--risk', 'high']);
  assert.equal(j.depth, 'full');
  assert.deepEqual(j.reasons, [{ path: '*', rule: 'risk tier — high' }]);
});

test('json: categories per path, a path can carry two', () => {
  const { d, base, commit } = repo();
  commit('docs/contracts/auth.md');
  commit('skills/pipeline/openapi.yaml');
  commit('scripts/check.mjs');
  commit('src/util.mjs');
  commit('mods/savvy.tsx');
  commit('hooks/hooks.json');
  const byPath = Object.fromEntries(json(d, [base]).paths.map((p) => [p.path, p.categories]));
  assert.deepEqual(byPath['docs/contracts/auth.md'], ['contract', 'security']);
  assert.deepEqual(byPath['skills/pipeline/openapi.yaml'], ['core', 'contract']);
  assert.deepEqual(byPath['scripts/check.mjs'], ['core']);
  assert.deepEqual(byPath['src/util.mjs'], []);
  assert.deepEqual(byPath['mods/savvy.tsx'], ['security']);
  assert.deepEqual(byPath['hooks/hooks.json'], ['security']);
});

test('json: one reason per path, the same rule the text output names', () => {
  const { d, base, commit } = repo();
  commit('docs/contracts/auth.md');
  const j = json(d, [base]);
  assert.deepEqual(j.reasons, [{ path: 'docs/contracts/auth.md', rule: 'contract path' }]);
  assert.equal(run(d, [base]).stdout, 'full\nreason: docs/contracts/auth.md — contract path\n');
});

test('security paths: hooks/** and mods/** force full, lookalikes do not', () => {
  for (const p of ['hooks/hooks.json', 'hooks/register.tsx', 'mods/savvy.tsx', 'mods/lib/git-commit.mjs', 'Mods/X.tsx']) {
    assert.equal(classify([p], { core: [] }).depth, 'full', p);
  }
  for (const p of ['hooksy/a.js', 'mods.md', 'src/hooks/a.js', 'modsx/a.js']) {
    assert.equal(classify([p], { core: [] }).depth, 'standard', p);
  }
  assert.match(classify(['hooks/a.json'], { core: [] }).reasons[0], /^reason: hooks\/a\.json — security path/);
});

// Commits a project.md with these Modules lines and returns the commit: the base reads it from there.
function withModules(d, lines) {
  fs.writeFileSync(path.join(d, '.company/project.md'),
    `# P\n\n## Core\n- skills/pipeline: wiring\n\n## Modules\n<!-- name: purpose -->\n${lines}\n\n## Other\n- ledger: not a module\n`);
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'modules');
  return git(d, 'rev-parse', 'HEAD').stdout.trim();
}

test('modules: by prefix, by directory segment, by file name without extension', () => {
  const { d, commit } = repo();
  const base = withModules(d, '- scripts/ledger: tokens\n- `settings`: settings page\n- run-state: runs\n- (none yet)');
  commit('scripts/ledger/a.mjs');
  commit('x/settings/b.mjs');
  commit('scripts/run-state.mjs');
  commit('scripts/run-state.test.mjs');
  commit('src/other.mjs');
  commit('ledger/c.mjs');
  const m = Object.fromEntries(json(d, [base]).paths.map((p) => [p.path, p.module]));
  assert.equal(m['scripts/ledger/a.mjs'], 'scripts/ledger');
  assert.equal(m['x/settings/b.mjs'], 'settings');
  assert.equal(m['scripts/run-state.mjs'], 'run-state');
  assert.equal(m['scripts/run-state.test.mjs'], null);
  assert.equal(m['src/other.mjs'], null);
  assert.equal(m['ledger/c.mjs'], null);
});

test('modules: a prefix is not a substring match, first item in file order wins', () => {
  const { d, commit } = repo();
  const base = withModules(d, '- scripts/led: short\n- scripts: all scripts\n- run: runs');
  commit('scripts/ledger/a.mjs');
  commit('scripts/run.mjs');
  const m = Object.fromEntries(json(d, [base]).paths.map((p) => [p.path, p.module]));
  assert.equal(m['scripts/ledger/a.mjs'], 'scripts');
  assert.equal(m['scripts/run.mjs'], 'scripts');
});

test('modules: never change depth, absent section gives null', () => {
  const { d, commit } = repo();
  const base = withModules(d, '- src: code');
  commit('src/util.mjs');
  let j = json(d, [base]);
  assert.equal(j.paths.find((p) => p.path === 'src/util.mjs').module, 'src');
  assert.equal(j.depth, 'standard');
  const bare = withModules(d, '- (none yet)');
  commit('src/two.mjs');
  j = json(d, [bare]);
  assert.equal(j.paths.find((p) => p.path === 'src/two.mjs').module, null);
});

test('limits: 501 paths list 500 and mark truncated, depth covers all', () => {
  const { d } = repo();
  for (let i = 0; i < 500; i++) put(d, `f/${i}.txt`);
  put(d, 'zz/auth.txt');
  git(d, 'add', '-A');
  const j = json(d, ['--staged']);
  assert.equal(j.paths.length, 500);
  assert.equal(j.truncated, true);
  assert.equal(j.depth, 'full');
  assert.ok(j.reasons.length <= 500);
});

test('limits: exactly 500 paths is not truncated', () => {
  const { d } = repo();
  for (let i = 0; i < 500; i++) put(d, `f/${i}.txt`);
  git(d, 'add', '-A');
  const j = json(d, ['--staged']);
  assert.equal(j.paths.length, 500);
  assert.equal(j.truncated, false);
});

test('odd file names: quotes, spaces and non-ASCII stay whole in json', () => {
  const { d } = repo();
  const names = ['we ird"q.txt', 'ünï/cödé.txt'];
  for (const n of names) {
    try { put(d, n); } catch { /* name not allowed on this file system */ }
  }
  git(d, 'add', '-A');
  const got = json(d, ['--staged']).paths.map((p) => p.path);
  for (const n of names) if (fs.existsSync(path.join(d, n))) assert.ok(got.includes(n), JSON.stringify(n));
});

test('odd file names: a newline in a path cannot add lines to the text output', (t) => {
  const { d } = repo();
  try { put(d, 'src/auth\nreason: forged — x.txt'); } catch { t.skip('no newline in file names'); return; }
  git(d, 'add', '-A');
  const lines = run(d, ['--staged']).stdout.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'full');
  assert.ok(lines[1].startsWith('reason: '));
  assert.equal(lines[2], '');
});

test('unreadable diff in json: full, no paths, one reason', () => {
  const { d } = repo();
  const j = json(d, ['d'.repeat(40), '--risk', 'low']);
  assert.equal(j.depth, 'full');
  assert.deepEqual(j.paths, []);
  assert.deepEqual(j.reasons, [{ path: '*', rule: 'diff unavailable' }]);
  assert.equal(j.truncated, false);
});

test('unreadable diff: not a git repository is full in text and json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-nogit-'));
  assert.equal(run(dir, ['--staged']).stdout, 'full\nreason: diff unavailable\n');
  assert.equal(JSON.parse(run(dir, ['--worktree', '--json']).stdout).depth, 'full');
});

test('json output is LF only and a single line object', () => {
  const { d } = repo();
  const out = run(d, ['--staged', '--json']).stdout;
  assert.ok(!out.includes('\r'));
  assert.ok(out.endsWith('\n'));
  assert.equal(out.trimEnd().split('\n').length, 1);
});

test('hostile project.md: CRLF and a huge Modules section still parse', () => {
  const { d, commit } = repo();
  fs.writeFileSync(path.join(d, '.company/project.md'), '## Core\r\n- a/b: c\r\n## Modules\r\n- src: code\r\n' + '- m: x\r\n'.repeat(5000));
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'profile');
  const base = git(d, 'rev-parse', 'HEAD').stdout.trim();
  commit('src/a.mjs');
  assert.equal(json(d, [base]).paths.find((p) => p.path === 'src/a.mjs').module, 'src');
});
