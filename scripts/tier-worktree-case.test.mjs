// T9: tier-sets v1.4 and worktree v1.2. A wrong-case slug is refused; no tier-path record, branch or worktree is made.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fixture, cleanup, cli, tree, WRONG } from './fixtures/case-helper.mjs';

after(cleanup);

const DISK = '2026-10-31 09.15 - Exact Case';
const TYPED = '2026-10-31 09.15 - Exact CaSe';
const task = (id, f) => `### ${id} title of ${id}\n- role: backend-engineer\n- files: ${f}\n- depends-on: none\n- parallel: yes\n`;
const PLAN = `# Plan\n\n## Tasks\n\n${task('T1', 'a/one.js')}\n${task('T2', 'b/two.js')}`;
const wrong = (r) => {
  assert.equal(r.code, 3, r.all);
  assert.equal(r.out, `refused: ${WRONG}\n`);
};

const git = (root, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd: root, encoding: 'utf8' });

function repo() {
  const root = fixture({ 'README.md': 'x\n', [`.company/work/${DISK}/02-plan.md`]: PLAN, '.gitignore': '.company/\n' });
  git(root, 'init', '-q');
  git(root, 'add', 'README.md', '.gitignore');
  git(root, 'commit', '-q', '-m', 'init');
  git(root, 'checkout', '-q', '-b', 'aico/2026-10-31-0915-exact-case');
  const base = git(root, 'rev-parse', 'HEAD').stdout.trim();
  return { root, base };
}

describe('tier-set', () => {
  const run = (root, ...a) => cli('tier-set.mjs', a, { cwd: root });

  test('tier-set refuses a wrong-case slug and writes no tier-path record', () => {
    const { root, base } = repo();
    const before = tree(root);
    wrong(run(root, 'preview', TYPED, '--playbook', 'feature', '--triage', 'low', '--short', 'on'));
    wrong(run(root, 'begin', TYPED, '--playbook', 'feature', '--triage', 'low', '--short', 'on', '--base', base));
    wrong(run(root, 'sync', TYPED, '--plan', '02-plan.md'));
    wrong(run(root, 'raise', TYPED, 'high'));
    wrong(run(root, 'read', TYPED));
    assert.deepEqual(tree(root), before);
  });

  test('the exact slug begins as before', () => {
    const { root, base } = repo();
    const r = run(root, 'begin', DISK, '--playbook', 'feature', '--triage', 'low', '--short', 'on', '--base', base);
    assert.ok(!r.all.includes(WRONG), r.all);
    assert.equal(r.code, 0, r.all);
  });

  test('a slug missing in every case keeps the old behaviour', () => {
    const { root } = repo();
    const r = run(root, 'read', '2026-10-31 09.16 - Nowhere');
    assert.ok(!r.all.includes(WRONG), r.all);
  });
});

describe('worktree', () => {
  const run = (root, ...a) => cli('worktree.mjs', a, { cwd: root });
  const plan = (root, ...a) => cli('plan-tasks.mjs', a, { cwd: root });

  function started() {
    const f = repo();
    assert.equal(plan(f.root, 'begin', DISK, '02-plan.md', '--cap', '4', '--mode', 'parallel').code, 0);
    assert.equal(plan(f.root, 'start', DISK, 'T1').code, 0);
    return f;
  }

  test('worktree refuses a wrong-case slug and makes no branch', () => {
    const { root, base } = started();
    const branches = git(root, 'branch', '--list', '--all').stdout;
    const trees = git(root, 'worktree', 'list').stdout;
    const before = tree(root);
    wrong(run(root, 'add', TYPED, 't1', '--base', base));
    wrong(run(root, 'changed', TYPED, 't1'));
    wrong(run(root, 'merge', TYPED));
    wrong(run(root, 'cleanup', TYPED));
    wrong(run(root, 'protocheck', TYPED));
    assert.equal(git(root, 'branch', '--list', '--all').stdout, branches);
    assert.equal(git(root, 'worktree', 'list').stdout, trees);
    assert.deepEqual(tree(root), before);
  });

  test('the exact slug adds a worktree as before', () => {
    const { root, base } = started();
    const r = run(root, 'add', DISK, 't1', '--base', base);
    assert.ok(!r.all.includes(WRONG), r.all);
    assert.equal(r.code, 0, r.all);
    run(root, 'cleanup', DISK);
  });
});
