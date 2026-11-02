import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from './draft-input.mjs';

const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

const scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-input-stale-cfg-')));
made.push(scratch);
const gitConfig = path.join(scratch, 'gitconfig');
fs.writeFileSync(gitConfig, '[user]\n\tname = Test\n\temail = test@example.invalid\n[commit]\n\tgpgsign = false\n');

function git(root, ...args) {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', XDG_CONFIG_HOME: scratch }
  });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function put(root, rel, body) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function repo(files = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-input-stale-')));
  made.push(root);
  git(root, 'init', '--quiet');
  for (const [rel, body] of Object.entries(files)) put(root, rel, body);
  return root;
}

function commit(root, message) {
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', `--message=${message}`);
  return git(root, 'rev-parse', 'HEAD');
}

function task(id, files, extra = '') {
  return `### ${id} A task\n- role: backend-engineer\n- files: ${files}\n- depends-on: ${extra || 'none'}\n- parallel: yes\n\n`;
}

function plan(base, ...tasks) {
  const head = base === null ? '' : `Base commit: ${base}\n`;
  return `# Plan\n\n${head}\n## Tasks\n\n${tasks.join('')}`;
}

const stale = (root, rel = '.company/work/x/plan.md') => main(['stale', rel], { root });

describe('stale', () => {
  test('deleted path is stale', () => {
    const root = repo({ 'a.txt': 'one\n', 'keep.txt': 'k\n' });
    const base = commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan(base, task('T1', 'a.txt, keep.txt')));
    fs.rmSync(path.join(root, 'a.txt'));
    commit(root, 'drop a');
    const r = stale(root);
    assert.deepEqual(r.lines, ['stale T1 a.txt gone', 'draft-input stale: 1 stale, 0 changed']);
    assert.equal(r.code, 2);
  });

  test('a path created after the base exists', () => {
    const root = repo({ 'a.txt': 'one\n' });
    const base = commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan(base, task('T1', 'new.txt')));
    put(root, 'new.txt', 'n\n');
    commit(root, 'add new');
    const r = stale(root);
    assert.deepEqual(r.lines, ['stale T1 new.txt exists', 'draft-input stale: 1 stale, 0 changed']);
    assert.equal(r.code, 2);
  });

  test('a changed path is info only and exits 0', () => {
    const root = repo({ 'a.txt': 'one\n' });
    const base = commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan(base, task('T1', 'a.txt')));
    put(root, 'a.txt', 'two\n');
    commit(root, 'edit');
    const r = stale(root);
    assert.deepEqual(r.lines, ['changed T1 a.txt', 'draft-input stale: 0 stale, 1 changed']);
    assert.equal(r.code, 0);
  });

  test('nothing moved: only the summary line', () => {
    const root = repo({ 'a.txt': 'one\n' });
    const base = commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan(base, task('T1', 'a.txt, missing.txt')));
    const r = stale(root);
    assert.deepEqual(r.lines, ['draft-input stale: 0 stale, 0 changed']);
    assert.equal(r.code, 0);
  });

  test('lines follow plan order, not dependency order; a trailing slash is dropped', () => {
    const root = repo({ 'a.txt': 'a\n', 'b.txt': 'b\n', 'dir/f.txt': 'f\n' });
    const base = commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan(base, task('T1', 'a.txt', 'T2'), task('T2', 'b.txt, dir/')));
    fs.rmSync(path.join(root, 'a.txt'));
    fs.rmSync(path.join(root, 'b.txt'));
    put(root, 'dir/f.txt', 'changed\n');
    commit(root, 'edit');
    const r = stale(root);
    assert.deepEqual(r.lines, ['stale T1 a.txt gone', 'stale T2 b.txt gone', 'changed T2 dir/', 'draft-input stale: 2 stale, 1 changed']);
    assert.equal(r.code, 2);
  });

  test('paths that fail the path rule never reach git or the output', () => {
    const root = repo({ 'a.txt': 'a\n' });
    const base = commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan(base, task('T1', '../escape.txt, --output=x, a.txt, $(id).txt')));
    fs.rmSync(path.join(root, 'a.txt'));
    commit(root, 'drop');
    const r = stale(root);
    assert.deepEqual(r.lines, ['stale T1 a.txt gone', 'draft-input stale: 1 stale, 0 changed']);
  });

  test('the caller git environment is ignored', () => {
    const root = repo({ 'a.txt': 'a\n' });
    const base = commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan(base, task('T1', 'a.txt')));
    const saved = { dir: process.env.GIT_DIR, tree: process.env.GIT_WORK_TREE };
    process.env.GIT_DIR = path.join(scratch, 'nowhere');
    process.env.GIT_WORK_TREE = scratch;
    try {
      const r = stale(root);
      assert.deepEqual(r.lines, ['draft-input stale: 0 stale, 0 changed']);
    } finally {
      for (const [key, v] of [['GIT_DIR', saved.dir], ['GIT_WORK_TREE', saved.tree]]) {
        if (v === undefined) delete process.env[key];
        else process.env[key] = v;
      }
    }
  });

  test('a replace ref does not change the answer', () => {
    const root = repo({ 'a.txt': 'a\n' });
    const base = commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan(base, task('T1', 'a.txt')));
    const mk = spawnSync('git', ['hash-object', '-w', '-t', 'tree', '--stdin'], { cwd: root, input: '', encoding: 'utf8' });
    assert.equal(mk.status, 0, mk.stderr);
    const empty = mk.stdout.trim();
    const other = git(root, 'commit-tree', empty, '-m', 'other');
    git(root, 'replace', base, other);
    const r = stale(root);
    assert.deepEqual(r.lines, ['draft-input stale: 0 stale, 0 changed']);
    assert.equal(r.code, 0);
  });
});

describe('stale refusals', () => {
  test('a grafts file refuses before any compare', () => {
    const root = repo({ 'a.txt': 'a\n' });
    const base = commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan(base, task('T1', 'a.txt')));
    fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'info', 'grafts'), `${base}\n`);
    const r = stale(root);
    assert.deepEqual(r.lines, ['refused: grafts file present']);
    assert.equal(r.code, 3);
  });

  test('a plan without a Base commit line', () => {
    const root = repo({ 'a.txt': 'a\n' });
    commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan(null, task('T1', 'a.txt')));
    const r = stale(root);
    assert.deepEqual(r.lines, ['refused: plan has no Base commit line']);
    assert.equal(r.code, 3);
  });

  test('a Base commit line after ## Tasks does not count', () => {
    const root = repo({ 'a.txt': 'a\n' });
    const base = commit(root, 'base');
    put(root, '.company/work/x/plan.md', `${plan(null, task('T1', 'a.txt'))}Base commit: ${base}\n`);
    assert.deepEqual(stale(root).lines, ['refused: plan has no Base commit line']);
  });

  test('a base that is not full lowercase hex, or not the repo format', () => {
    const root = repo({ 'a.txt': 'a\n' });
    const base = commit(root, 'base');
    for (const bad of [base.slice(0, 12), base.toUpperCase(), 'HEAD', `${base}${base.slice(0, 24)}`, 'main --help']) {
      put(root, '.company/work/x/plan.md', plan(bad, task('T1', 'a.txt')));
      const r = stale(root);
      assert.deepEqual(r.lines, ['refused: plan has no Base commit line'], bad);
      assert.equal(r.code, 3);
    }
  });

  test('a 64-hex base in a sha1 repo is refused', () => {
    const root = repo({ 'a.txt': 'a\n' });
    commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan('a'.repeat(64), task('T1', 'a.txt')));
    const r = stale(root);
    assert.deepEqual(r.lines, ['refused: plan has no Base commit line']);
    assert.equal(r.code, 3);
  });

  test('a file that is not a plan, a missing file, usage', () => {
    const root = repo({ 'a.txt': 'a\n', 'notes.md': '# Notes\nnothing\n' });
    commit(root, 'base');
    assert.deepEqual(stale(root, 'notes.md').lines, ['refused: not a plan']);
    assert.equal(stale(root, 'notes.md').code, 3);
    assert.deepEqual(stale(root, 'gone.md').lines, ['refused: missing']);
    assert.deepEqual(main(['stale'], { root }).lines, ['refused: usage']);
    assert.deepEqual(main(['stale', 'a.md', 'b.md'], { root }).lines, ['refused: usage']);
    assert.deepEqual(main(['stale', 'notes.md', '--for', 'grill'], { root }).lines, ['refused: usage']);
    assert.deepEqual(main(['stale', '../x.md'], { root }).lines, ['refused: path dot segment']);
  });
});

describe('stale git exit codes', () => {
  test('an unknown base: one line, exit 2, no path lines', () => {
    const root = repo({ 'a.txt': 'a\n' });
    commit(root, 'base');
    const unknown = '0123456789abcdef0123456789abcdef01234567';
    put(root, '.company/work/x/plan.md', plan(unknown, task('T1', 'a.txt')));
    const r = stale(root);
    assert.deepEqual(r.lines, ['base unknown 0123456789ab']);
    assert.equal(r.code, 2);
  });

  test('exit 128 from a broken repo: exit 1, no stale line', () => {
    const root = repo({ 'a.txt': 'a\n' });
    const base = commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan(base, task('T1', 'a.txt')));
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'garbage\n');
    const r = stale(root);
    assert.equal(r.code, 1);
    assert.equal(r.lines.length, 1);
    assert.match(r.lines[0], /^error: git exit \d+$/);
    assert.ok(!r.lines.some((l) => l.startsWith('draft-input stale:')));
  });

  test('a folder that is not a repo: exit 1', () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-input-stale-')));
    made.push(root);
    put(root, '.company/work/x/plan.md', plan('a'.repeat(40), task('T1', 'a.txt')));
    const r = stale(root);
    assert.equal(r.code, 1);
    assert.match(r.lines[0], /^error: git exit 128$/);
    assert.equal(r.lines.length, 1);
  });

  test('git not found: exit 1', () => {
    const root = repo({ 'a.txt': 'a\n' });
    const base = commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan(base, task('T1', 'a.txt')));
    const saved = process.env.PATH;
    process.env.PATH = path.join(scratch, 'empty');
    let r;
    try {
      r = stale(root);
    } finally {
      process.env.PATH = saved;
    }
    assert.equal(r.code, 1);
    assert.deepEqual(r.lines, ['error: git not found']);
  });

  test('the file at HEAD missing mid-compare is read as missing, not as an error', () => {
    const root = repo({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
    const base = commit(root, 'base');
    put(root, '.company/work/x/plan.md', plan(base, task('T1', 'a.txt'), task('T2', 'b.txt')));
    fs.rmSync(path.join(root, 'a.txt'));
    fs.rmSync(path.join(root, 'b.txt'));
    commit(root, 'drop both');
    const r = stale(root);
    assert.equal(r.code, 2);
    assert.deepEqual(r.lines, ['stale T1 a.txt gone', 'stale T2 b.txt gone', 'draft-input stale: 2 stale, 0 changed']);
  });
});

describe('stale work folder with spaces (regression)', () => {
  test('a plan in a new-form work folder name is checked', () => {
    const root = repo({ 'a.txt': 'one\n' });
    const base = commit(root, 'base');
    const rel = '.company/work/2026-11-02 14.20 - Plan And Draft Tools/plan.md';
    put(root, rel, plan(base, task('T1', 'a.txt')));
    const r = stale(root, rel);
    assert.deepEqual(r.lines, ['draft-input stale: 0 stale, 0 changed']);
    assert.equal(r.code, 0);
  });
});
