import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main as ruleCheck } from './rule-check.mjs';
import { run as reviewDepth } from './review-depth.mjs';

const rcScript = path.join(import.meta.dirname, 'rule-check.mjs');
const rdScript = path.join(import.meta.dirname, 'review-depth.mjs');
const SLUG = 'bid';
const REF = `refs/heads/aico/${SLUG}`;

// Every test builds its repos in a temp dir; the real home and the real repo are never touched.
const made = [];
function tmp(name = 'base-id-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  made.push(dir);
  return dir;
}
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const HOME = tmp('base-id-home-');
function env(extra = {}) {
  const e = { ...process.env, HOME, USERPROFILE: HOME, MCSPARROW_HOME: path.join(HOME, 'mh'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(HOME, 'none'), ...extra };
  delete e.NODE_TEST_CONTEXT;
  return e;
}

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.test', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: env() });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const PROJECT = '# P\n\n## Core\n- skills/pipeline: wiring\n\n## Modules\n- src: code\n';
const STANDARDS = '## Project rules\n- proj.M11 — Every text file is LF only — check: lf\n';
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// A repo on the run branch: a base commit and a tip commit holding `files`.
async function repo(files = { 'src/ok.js': 'ok\n' }, { project = PROJECT } = {}) {
  const root = tmp('base-id-repo-');
  git(root, 'init', '-q', '-b', 'main');
  write(root, '.company/project.md', project);
  write(root, '.company/standards.md', STANDARDS);
  write(root, '.company/checks.json', JSON.stringify({ version: 1, checks: { lf: { rule: 'proj.M11', text: sha('Every text file is LF only') } } }));
  write(root, '.gitattributes', '* text=auto eol=lf\n');
  write(root, 'seed.txt', 'seed\n');
  git(root, 'add', '-A', '-f');
  git(root, 'commit', '-q', '-m', 'seed');
  const base = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-q', '-b', `aico/${SLUG}`);
  commit(root, files);
  return { root, base, tip: git(root, 'rev-parse', 'HEAD') };
}

function commit(root, files, message = 'change') {
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  const attributes = path.join(root, '.git', 'info', 'attributes');
  const kept = fs.existsSync(attributes) ? fs.readFileSync(attributes) : null;
  fs.mkdirSync(path.dirname(attributes), { recursive: true });
  fs.writeFileSync(attributes, '* -text\n');
  git(root, 'add', '-A', '-f');
  if (kept === null) fs.rmSync(attributes);
  else fs.writeFileSync(attributes, kept);
  git(root, 'commit', '-q', '-m', message, '--allow-empty');
}

function rc(root, base, { command = 'run', extra = [], envExtra = {}, slug = SLUG } = {}) {
  const r = spawnSync(process.execPath, [rcScript, command, '--base', base, '--run', slug, ...(command === 'run' ? ['--root', root] : []), ...extra], { cwd: root, encoding: 'utf8', env: env(envExtra) });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

function rd(root, args, envExtra = {}) {
  const r = spawnSync(process.execPath, [rdScript, ...args], { cwd: root, encoding: 'utf8', env: env(envExtra) });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

// ---------- the base is a full object id ----------

test('a short sha, a ref name and an ambiguous prefix are refused by rule-check and review-depth', async () => {
  const { root, base } = await repo({ 'src/auth.js': 'x\n' });
  for (const bad of [base.slice(0, 7), base.slice(0, 4), 'HEAD', 'main', REF, `${base}~0`, base.toUpperCase()]) {
    for (const command of ['run', 'text']) {
      const r = rc(root, bad, { command });
      assert.equal(r.status, 3, `${command} ${bad}`);
      assert.match(r.out, /^refused: bad base$/m);
    }
    const d = rd(root, [bad, '--run', SLUG]);
    assert.equal(d.status, 2, bad);
    assert.match(d.out, /^refused: /);
  }
  assert.equal(rd(root, [base, '--run', SLUG]).status, 0);
});

test('a replace ref that points the base elsewhere changes nothing', async () => {
  const { root, base, tip } = await repo({ 'src/auth.js': 'x\n', 'src/crlf.txt': 'a\r\n' });
  const quiet = { run: rc(root, base).out, depth: rd(root, [base, '--run', SLUG]).out };
  assert.match(quiet.run, /CR byte in text file/);
  assert.match(quiet.depth, /src\/auth\.js/);
  const decoy = git(root, 'commit-tree', `${tip}^{tree}`, '-m', 'decoy');
  git(root, 'replace', base, decoy);
  assert.equal(git(root, 'diff', '--name-only', base, tip), '', 'the replace ref is live for plain git');
  assert.equal(rc(root, base).out, quiet.run);
  assert.equal(rd(root, [base, '--run', SLUG]).out, quiet.depth);
});

// ---------- local git state cannot change what is judged ----------

// A diff driver that leaves a marker file when git runs it.
function driverFiles() {
  const dir = tmp('base-id-driver-');
  const mark = path.join(dir, 'ran.txt');
  const driver = path.join(dir, 'driver.cjs');
  fs.writeFileSync(driver, `require('node:fs').writeFileSync(${JSON.stringify(mark)}, 'ran');\nprocess.stdout.write('same\\n');\n`);
  return { mark, driver, command: `node ${driver.replaceAll('\\', '/')}` };
}

async function hostileRepo() {
  const files = {
    'src/auth.js': 'const x = 1;\n',
    'src/crlf.txt': 'a\r\n',
    'src/bin.js': 'one\ntwo\n'
  };
  const fixture = await repo(files);
  // a gitlink that changes between the base and the tip, and one more commit that moves it
  git(fixture.root, 'update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},sub`);
  git(fixture.root, 'commit', '-q', '-m', 'sub');
  return fixture;
}

function hostileConfig(root) {
  const { mark, driver, command } = driverFiles();
  git(root, 'config', 'diff.evil.textconv', command);
  git(root, 'config', 'diff.external', command);
  git(root, 'config', 'diff.ignoreSubmodules', 'all');
  git(root, 'config', 'diff.relative', 'true');
  fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'info', 'attributes'), '*.js diff=evil\n');
  return { mark, driver };
}

const FORM = (base) => ['--no-replace-objects', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'diff.ignoreSubmodules=none', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-relative', '--ignore-submodules=none', '--end-of-options', base, REF];

test('textconv, diff.external, attributes and ignored submodules leave the judged paths and the judging diff unchanged', async () => {
  const { root, base } = await hostileRepo();
  const judge = () => spawnSync('git', FORM(base), { cwd: root, encoding: 'utf8', env: { ...env(), GIT_NO_REPLACE_OBJECTS: '1', GIT_LITERAL_PATHSPECS: '1' } }).stdout;
  const before = { run: rc(root, base).out, text: rc(root, base, { command: 'text' }).out, depth: rd(root, [base, '--run', SLUG, '--json']).out, diff: judge() };
  assert.match(before.diff, /Subproject commit/);
  assert.match(before.diff, /\+const x = 1;/);
  const { mark } = hostileConfig(root);
  spawnSync('git', ['diff', base, REF, '--', 'src/auth.js'], { cwd: root, encoding: 'utf8', env: env() });
  assert.equal(fs.existsSync(mark), true, 'the driver is live for plain git');
  fs.rmSync(mark);
  assert.equal(judge(), before.diff);
  assert.equal(rc(root, base).out, before.run);
  assert.equal(rc(root, base, { command: 'text' }).out, before.text);
  assert.equal(rd(root, [base, '--run', SLUG, '--json']).out, before.depth);
  assert.equal(fs.existsSync(mark), false, 'the driver never ran');
});

test('inherited GIT_ variables, also with another letter case, change nothing', async () => {
  const { root, base } = await hostileRepo();
  const decoy = await repo({ 'other.txt': 'z\n' });
  const before = { run: rc(root, base).out, text: rc(root, base, { command: 'text' }).out, depth: rd(root, [base, '--run', SLUG]).out };
  assert.match(before.run, /CR byte in text file/);
  const { mark, command } = driverFiles();
  const hostile = {
    GIT_DIR: path.join(decoy.root, '.git'),
    GIT_WORK_TREE: decoy.root,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'diff.external',
    GIT_CONFIG_VALUE_0: command,
    GIT_EXTERNAL_DIFF: command,
    GIT_INDEX_FILE: path.join(decoy.root, '.git', 'index'),
    GIT_OBJECT_DIRECTORY: path.join(decoy.root, '.git', 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(decoy.root, '.git', 'objects')
  };
  if (process.platform === 'win32') hostile.Git_Dir = path.join(decoy.root, '.git');
  assert.equal(rc(root, base, { envExtra: hostile }).out, before.run);
  assert.equal(rc(root, base, { command: 'text', envExtra: hostile }).out, before.text);
  assert.equal(rd(root, [base, '--run', SLUG], hostile).out, before.depth);
  assert.equal(fs.existsSync(mark), false, 'the external diff never ran');
});

// ---------- grafts ----------

function graftCases(root) {
  const grafts = path.join(root, '.git', 'info', 'grafts');
  fs.mkdirSync(path.dirname(grafts), { recursive: true });
  return [
    ['a grafts file', () => fs.writeFileSync(grafts, `${'0'.repeat(40)}\n`)],
    ['an empty grafts file', () => fs.writeFileSync(grafts, '')],
    ['a link', () => fs.symlinkSync(path.join(root, 'seed.txt'), grafts), true],
    ['a folder', () => fs.mkdirSync(grafts)]
  ].map(([name, make, optional]) => ({ name, make, optional, grafts }));
}

test('a grafts file, empty, a link or a folder, is refused by rule-check and gives full from review-depth', async () => {
  const { root, base } = await repo({ 'src/ok.js': 'ok\n' });
  for (const c of graftCases(root)) {
    fs.rmSync(c.grafts, { recursive: true, force: true });
    try {
      c.make();
    } catch (error) {
      if (c.optional) continue;
      throw error;
    }
    for (const command of ['run', 'text']) {
      const r = rc(root, base, { command });
      assert.equal(r.status, 3, `${c.name} ${command}`);
      assert.equal(r.out, 'refused: grafts file present\n', c.name);
    }
    const lines = ['full', 'reason: grafts file present'].join('\n') + '\n';
    assert.equal(rd(root, [base, '--run', SLUG]).out, lines, c.name);
    assert.equal(rd(root, ['--staged']).out, lines, c.name);
    assert.equal(rd(root, ['--worktree']).out, lines, c.name);
    fs.rmSync(c.grafts, { recursive: true, force: true });
  }
  assert.equal(rc(root, base).status, 0);
});

test('a graft-path query that fails or prints nothing refuses like a grafts file', async () => {
  const { root, base } = await repo({ 'src/ok.js': 'ok\n' });
  for (const query of [() => ({ status: 128, out: Buffer.alloc(0) }), () => ({ status: 0, out: Buffer.alloc(0) }), () => ({ failed: 'ENOENT' })]) {
    for (const command of ['run', 'text']) {
      const args = [command, '--base', base, '--run', SLUG, ...(command === 'run' ? ['--root', root] : [])];
      const previous = process.cwd();
      process.chdir(root);
      try {
        const r = ruleCheck(args, { seam: { graftQuery: query } });
        assert.equal(r.code, 3);
        assert.deepEqual(r.lines, ['refused: grafts file present']);
        for (const mode of [[base, '--run', SLUG], ['--staged'], ['--worktree']]) {
          assert.equal(reviewDepth(mode, { seam: { graftQuery: query } }).out, 'full\nreason: grafts file present\n');
        }
      } finally {
        process.chdir(previous);
      }
    }
  }
});

test('an inherited GIT_GRAFT_FILE is dropped: with no grafts file in the repo the results do not change', async () => {
  const { root, base, tip } = await repo({ 'src/auth.js': 'x\n', 'src/crlf.txt': 'a\r\n' });
  const before = { run: rc(root, base).out, depth: rd(root, [base, '--run', SLUG]).out };
  const file = path.join(tmp(), 'grafts');
  fs.writeFileSync(file, `${tip}\n`);
  const r = rc(root, base, { envExtra: { GIT_GRAFT_FILE: file } });
  assert.equal(r.status, 0);
  assert.equal(r.out, before.run);
  assert.equal(rd(root, [base, '--run', SLUG], { GIT_GRAFT_FILE: file }).out, before.depth);
});

// ---------- the run ref ----------

test('HEAD on another branch is refused by rule-check and gives full from review-depth', async () => {
  const { root, base } = await repo({ 'src/ok.js': 'ok\n' });
  git(root, 'checkout', '-q', '-b', 'decoy', base);
  write(root, 'harmless.txt', 'h\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'harmless');
  for (const command of ['run', 'text']) {
    const r = rc(root, base, { command });
    assert.equal(r.status, 3);
    assert.equal(r.out, 'refused: head not on run branch\n');
  }
  assert.equal(rd(root, [base, '--run', SLUG]).out, 'full\nreason: head not on run branch\n');
  git(root, 'checkout', '-q', '--detach');
  assert.equal(rc(root, base).out, 'refused: head not on run branch\n');
});

test('a bad run slug is refused before any git call', async () => {
  const { root, base } = await repo({ 'src/ok.js': 'ok\n' });
  for (const slug of ['Bad', '-x', 'a/b', '', 'a'.repeat(65), 'x y', '../x']) {
    const r = rc(root, base, { slug });
    assert.equal(r.status, 3, slug);
    assert.match(r.out, /^refused: /);
    assert.equal(rd(root, [base, '--run', slug]).status, 2, slug);
  }
});

test('review-depth in base mode without --run is full with the reason no run ref', async () => {
  const { root, base } = await repo({ 'src/ok.js': 'ok\n' });
  assert.equal(rd(root, [base]).out, 'full\nreason: no run ref\n');
  assert.equal(JSON.parse(rd(root, [base, '--json']).out).reasons[0].rule, 'no run ref');
  assert.equal(rd(root, ['--staged', '--run', SLUG]).status, 2);
});

// ---------- Core at the base commit ----------

test('review-depth reads Core from the base commit, not from the working copy', async () => {
  const { root, base } = await repo({ 'skills/pipeline/x.md': 'x\n' });
  const before = rd(root, [base, '--run', SLUG]).out;
  assert.match(before, /skills\/pipeline\/x\.md — core path/);
  write(root, '.company/project.md', '# P\n\n## Modules\n- src: code\n');
  assert.equal(rd(root, [base, '--run', SLUG]).out, before);
  write(root, '.company/project.md', '# P\n\n## Core\n- nothing/here\n');
  assert.equal(rd(root, [base, '--run', SLUG]).out, before);
});

test('review-depth with .company/project.md untracked, too big or without Core at the base is full: core unknown at base', async () => {
  const root = tmp('base-id-core-');
  git(root, 'init', '-q', '-b', 'main');
  write(root, 'seed.txt', 'seed\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed');
  const base = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-q', '-b', `aico/${SLUG}`);
  write(root, '.company/project.md', PROJECT);
  commit(root, { 'src/a.js': 'a\n' });
  git(root, 'rm', '-q', '--cached', '-r', '.company');
  git(root, 'commit', '-q', '-m', 'untrack');
  const want = 'full\nreason: core unknown at base\n';
  assert.equal(rd(root, [base, '--run', SLUG]).out, want);
  const json = JSON.parse(rd(root, [base, '--run', SLUG, '--json']).out);
  assert.deepEqual([json.depth, json.paths, json.reasons], ['full', [], [{ path: '*', rule: 'core unknown at base' }]]);

  const big = tmp('base-id-big-');
  git(big, 'init', '-q', '-b', 'main');
  write(big, '.company/project.md', `## Core\n- a/b: x\n${'# pad\n'.repeat(12000)}`);
  git(big, 'add', '-A');
  git(big, 'commit', '-q', '-m', 'seed');
  const bigBase = git(big, 'rev-parse', 'HEAD');
  git(big, 'checkout', '-q', '-b', `aico/${SLUG}`);
  commit(big, { 'src/a.js': 'a\n' });
  assert.equal(rd(big, [bigBase, '--run', SLUG]).out, want);

  const noCore = await repo({ 'src/a.js': 'a\n' }, { project: '# P\n\n## Modules\n- src: code\n' });
  assert.equal(rd(noCore.root, [noCore.base, '--run', SLUG]).out, want);
});

// ---------- the commit gate listing: --staged and --worktree ----------

test('--worktree lists a changed submodule under diff.ignoreSubmodules=all', async () => {
  const { root } = await repo({ 'src/ok.js': 'ok\n' });
  const sub = path.join(root, 'sub');
  fs.mkdirSync(sub);
  git(sub, 'init', '-q', '-b', 'main');
  write(sub, 'a.txt', 'a\n');
  git(sub, 'add', '-A');
  git(sub, 'commit', '-q', '-m', 'one');
  git(root, 'add', 'sub');
  git(root, 'commit', '-q', '-m', 'add sub');
  write(sub, 'b.txt', 'b\n');
  git(sub, 'add', '-A');
  git(sub, 'commit', '-q', '-m', 'two');
  git(root, 'config', 'diff.ignoreSubmodules', 'all');
  const j = JSON.parse(rd(root, ['--worktree', '--json']).out);
  assert.deepEqual(j.paths.map(p => p.path), ['sub']);
});

test('--staged and --worktree list the same with a fsmonitor hook, a textconv driver and diff.external, and the hook never runs', async () => {
  const { root } = await repo({ 'src/ok.js': 'ok\n' });
  write(root, 'src/auth.js', 'a\n');
  write(root, 'src/new.js', 'n\n');
  git(root, 'add', 'src/auth.js');
  write(root, 'src/ok.js', 'changed\n');
  const before = { staged: rd(root, ['--staged', '--json']).out, worktree: rd(root, ['--worktree', '--json']).out };
  assert.match(before.staged, /src\/auth\.js/);
  assert.match(before.worktree, /src\/new\.js/);
  const dir = tmp('base-id-hook-');
  const hook = path.join(dir, 'hook.cjs');
  const mark = path.join(dir, 'hook-ran.txt');
  fs.writeFileSync(hook, `require('node:fs').writeFileSync(${JSON.stringify(mark)}, 'ran');\nprocess.stdout.write('\\0');\n`);
  git(root, 'config', 'core.fsmonitor', `node ${hook.replaceAll('\\', '/')}`);
  const { mark: driverMark } = hostileConfig(root);
  spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', env: env() });
  assert.equal(fs.existsSync(mark), true, 'the hook is live for plain git');
  fs.rmSync(mark);
  assert.equal(rd(root, ['--staged', '--json']).out, before.staged);
  assert.equal(rd(root, ['--worktree', '--json']).out, before.worktree);
  assert.equal(fs.existsSync(mark), false, 'the fsmonitor hook never ran');
  assert.equal(fs.existsSync(driverMark), false);
});

// ---------- source: every judging call has the one form ----------

const read = (rel) => fs.readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8');

test('source: the judging diff is built in one place, with the full form and two fixed end points', () => {
  const rule = read('scripts/rule-check.mjs');
  for (const flag of ["'--no-replace-objects'", "'--literal-pathspecs'", "'core.fsmonitor=false'", "'diff.ignoreSubmodules=none'", "'--no-ext-diff'", "'--no-textconv'", "'--no-color'", "'--no-relative'", "'--ignore-submodules=none'", "'--end-of-options'"]) {
    assert.ok(rule.includes(flag), flag);
  }
  assert.ok(rule.includes('GIT_NO_REPLACE_OBJECTS') && rule.includes('GIT_GRAFT_FILE') && rule.includes('GIT_LITERAL_PATHSPECS'));
  assert.ok(rule.includes('/^GIT_/i'), 'GIT_ keys are dropped, in any case');
  assert.equal([...rule.matchAll(/'diff'/g)].length, 1, 'one place builds a diff call');
  for (const file of ['scripts/rule-check.mjs', 'scripts/review-depth.mjs']) {
    assert.doesNotMatch(read(file), /\.\.HEAD|\}\.\.\./, `${file}: no three-dot range and no HEAD end point`);
  }
  assert.doesNotMatch(read('scripts/review-depth.mjs'), /child_process/, 'review-depth runs git only through the shared session');
});

test('source: the graft check runs in an environment without GIT_GRAFT_FILE', () => {
  const rule = read('scripts/rule-check.mjs');
  const open = rule.slice(rule.indexOf('export function openGit'));
  const query = open.indexOf("'info/grafts'");
  const missing = open.indexOf('GIT_GRAFT_FILE');
  assert.ok(query > 0 && missing > query, 'the query comes before the script sets GIT_GRAFT_FILE');
});

test('source: --text appears only in rule-check text, once, by execFileSync without a shell and with literal pathspecs', () => {
  const rule = read('scripts/rule-check.mjs');
  assert.equal([...rule.matchAll(/'--text'/g)].length, 1);
  const at = rule.indexOf("'--text'");
  const call = rule.slice(rule.lastIndexOf('execFileSync(', at), rule.indexOf('catch', at));
  assert.match(call, /shell: false/);
  assert.match(call, /env: git\.diffEnv/);
  assert.match(call, /'--end-of-options', a\.base, ref, '--', file\]/);
  assert.ok(rule.includes('diffEnv = { ...env, GIT_LITERAL_PATHSPECS'));
  const text = rule.slice(rule.indexOf('function cmdText'));
  assert.ok(text.indexOf("['--name-only', '-z']") < text.indexOf("'--text'"), 'the one-path check comes before the --text call');
  assert.equal(read('scripts/review-depth.mjs').includes('--text'), false);
});

test('source: lf reads no numstat and the binary type list is one frozen table', () => {
  const rule = read('scripts/rule-check.mjs');
  const lf = rule.slice(rule.indexOf('function checkLf'), rule.indexOf('function failingTestName'));
  assert.doesNotMatch(lf, /numstat/);
  assert.match(rule, /export const BINARY_TYPES = Object\.freeze\(/);
  assert.equal([...rule.matchAll(/BINARY_TYPES = /g)].length, 1);
});

test('source: no Role or pipeline text puts a <path> placeholder into a command', () => {
  for (const file of ['agents/code-reviewer.md', 'agents/security.md', 'agents/senior-engineer.md', 'skills/pipeline/SKILL.md', 'skills/review/SKILL.md']) {
    for (const line of read(file).split('\n')) {
      if (/rule-check\.mjs|review-depth\.mjs|git diff|--text|git (?:-c \S+ )*status|git push/.test(line)) assert.doesNotMatch(line, /<paths?>/, `${file}: ${line.slice(0, 80)}`);
    }
  }
});
