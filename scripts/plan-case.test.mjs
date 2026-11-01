// T8: plan-check v1.4 and plan-tasks v1.6. A wrong-case slug is refused and no record is written; the run-folder prefix compares exact.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, cleanup, cli, tree, WRONG } from './fixtures/case-helper.mjs';

after(cleanup);

const DISK = '2026-10-31 09.15 - Exact Case';
const TYPED = '2026-10-31 09.15 - Exact CaSe';
const task = (id, f) => `### ${id} title of ${id}\n- role: backend-engineer\n- files: ${f}\n- depends-on: none\n- parallel: yes\n`;
const PLAN = `# Plan\n\n## Tasks\n\n${task('T1', 'a/one.js')}\n${task('T2', 'b/two.js')}`;
const files = () => ({ [`.company/work/${DISK}/02-plan.md`]: PLAN });
const wrong = (r) => {
  assert.equal(r.code, 3, r.all);
  assert.equal(r.out, `refused: ${WRONG}\n`);
};

describe('plan-check', () => {
  const run = (root, ...a) => cli('plan-check.mjs', a, { cwd: root });

  test('plan-check refuses a wrong-case slug and writes no record', () => {
    const root = fixture(files());
    const before = tree(root);
    wrong(run(root, 'gate', TYPED, '02-plan.md', '--policy', 'warn'));
    wrong(run(root, 'off', TYPED));
    wrong(run(root, 'wave', TYPED, '1'));
    wrong(run(root, 'verify', TYPED));
    wrong(run(root, 'read', TYPED));
    assert.deepEqual(tree(root), before);
  });

  test('the exact slug is gated as before', () => {
    const root = fixture(files());
    const r = run(root, 'gate', DISK, '02-plan.md', '--policy', 'warn');
    assert.ok(!r.all.includes(WRONG), r.all);
    assert.ok(r.code === 0 || r.code === 2, r.all);
  });

  test('a plan missing in every case keeps the old refusal', () => {
    const root = fixture(files());
    const r = run(root, 'gate', DISK, '09-plan.md', '--policy', 'warn');
    assert.notEqual(r.code, 0);
    assert.ok(!r.all.includes(WRONG), r.all);
  });
});

describe('plan-tasks', () => {
  const run = (root, ...a) => cli('plan-tasks.mjs', a, { cwd: root });
  const begin = (root, slug) => run(root, 'begin', slug, '02-plan.md', '--cap', '4', '--mode', 'parallel');

  test('plan-tasks begin refuses a wrong-case slug', () => {
    const root = fixture(files());
    const before = tree(root);
    wrong(begin(root, TYPED));
    assert.deepEqual(tree(root), before, 'no parallel record');
  });

  test('check, next, start, done, lines and read refuse a wrong-case slug', () => {
    const root = fixture(files());
    assert.equal(begin(root, DISK).code, 0);
    const before = tree(root);
    wrong(run(root, 'check', TYPED, '02-plan.md', '--cap', '4', '--mode', 'parallel'));
    wrong(run(root, 'next', TYPED));
    wrong(run(root, 'start', TYPED, 'T1'));
    wrong(run(root, 'done', TYPED, 'T1'));
    wrong(run(root, 'lines', TYPED, 'T1'));
    wrong(run(root, 'read', TYPED));
    assert.deepEqual(tree(root), before);
  });

  test('the exact slug begins as before', () => {
    const root = fixture(files());
    const r = begin(root, DISK);
    assert.equal(r.code, 0, r.all);
    assert.ok(!r.all.includes(WRONG));
  });

  test('scope counts a path under the exact run folder as in, not a wrong-case folder', () => {
    const root = fixture(files());
    assert.equal(begin(root, DISK).code, 0);
    assert.equal(run(root, 'start', DISK, 'T1').code, 0);
    const exact = run(root, 'scope', DISK, 'T1', '--', `.company/work/${DISK}/04-x.md`);
    assert.equal(exact.code, 0, exact.all);
    assert.ok(exact.out.startsWith(`in .company/work/${DISK}/04-x.md\n`), exact.out);
    const other = run(root, 'scope', DISK, 'T1', '--', `.company/work/${TYPED}/04-x.md`);
    assert.ok(!other.out.startsWith('in '), other.out);
  });

  test('a slug missing in every case keeps the old refusal', () => {
    const root = fixture(files());
    const r = run(root, 'next', '2026-10-31 09.16 - Nowhere');
    assert.ok(!r.all.includes(WRONG), r.all);
  });
});
