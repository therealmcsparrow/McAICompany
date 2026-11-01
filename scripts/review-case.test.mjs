// T5: plan-review v1.2 and review-loop v1.2. A wrong-case slug or Handoff file is refused and no record is written.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, cleanup, cli, tree, WRONG } from './fixtures/case-helper.mjs';

after(cleanup);

const DISK = '2026-10-31 09.15 - Exact Case';
const TYPED = '2026-10-31 09.15 - Exact CaSe';
const PLAN = '# Plan: demo\n\nBase commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n\n## Tasks\n\n### T1 one\n- role: backend-engineer\n- files: src/t1.mjs\n- depends-on: none\n';
const FRESH = '---\nstep: 03\nrole: fresh-reviewer\nreview-mode: plan\n---\n## Paraphrase\nA short paraphrase.\n\n## First pass\n';
const wrong = (r) => {
  assert.equal(r.code, 3, r.all);
  assert.equal(r.out, `refused: ${WRONG}\n`);
};

describe('plan-review', () => {
  const run = (root, ...a) => cli('plan-review.mjs', a, { cwd: root });
  const files = { [`.company/work/${DISK}/plan.md`]: PLAN, [`.company/work/${DISK}/01-architect.md`]: '---\nrole: architect\n---\n', [`.company/work/${DISK}/03-fresh-reviewer.md`]: FRESH };

  test('lines with a wrong-case slug is refused and no inputs file is written', () => {
    const root = fixture(files);
    const before = tree(root);
    wrong(run(root, 'lines', TYPED, 'plan.md', '--mode', 'plan', '--after', '01-architect.md'));
    assert.deepEqual(tree(root), before);
  });

  test('gate with a wrong-case slug is refused', () => {
    const root = fixture(files);
    wrong(run(root, 'gate', TYPED, '03-fresh-reviewer.md'));
  });

  test('the exact slug is read as before', () => {
    const root = fixture(files);
    const g = run(root, 'gate', DISK, '03-fresh-reviewer.md');
    assert.equal(g.code, 0, g.all);
    assert.ok(g.out.startsWith('paraphrase:\n'), g.out);
    const l = run(root, 'lines', DISK, 'plan.md', '--mode', 'plan', '--after', '01-architect.md');
    assert.ok(!l.all.includes(WRONG), l.all);
  });

  test('a Handoff missing in every case keeps the old refusal', () => {
    const root = fixture(files);
    const r = run(root, 'gate', DISK, '09-fresh-reviewer.md');
    assert.equal(r.code, 3);
    assert.equal(r.out, 'refused: Handoff missing\n');
  });
});

describe('review-loop', () => {
  const run = (root, ...a) => cli('review-loop.mjs', a, { cwd: root });
  const files = { [`.company/work/${DISK}/plan.md`]: PLAN };

  test('review-loop refuses a wrong-case slug', () => {
    const root = fixture(files);
    const before = tree(root);
    wrong(run(root, 'attempt', TYPED, '03', 'code-reviewer', '1', 'crash'));
    wrong(run(root, 'gate', TYPED));
    wrong(run(root, 'mark', TYPED, '1', '--base', 'a'.repeat(40)));
    assert.deepEqual(tree(root), before, 'no record written');
  });

  test('the exact slug records an attempt as before', () => {
    const root = fixture(files);
    const r = run(root, 'attempt', DISK, '03', 'code-reviewer', '1', 'crash');
    assert.equal(r.code, 0, r.all);
    assert.equal(r.out, 'retry code-reviewer\n');
  });

  test('a slug missing in every case keeps the old behaviour', () => {
    const root = fixture(files);
    const r = run(root, 'gate', '2026-10-31 09.16 - Nowhere');
    assert.ok(!r.all.includes(WRONG), r.all);
  });
});
