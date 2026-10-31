// T2: draft-input v1.4. A work folder or draft file typed in another letter case is refused on every platform.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, cleanup, cli, tree, WRONG } from './fixtures/case-helper.mjs';

after(cleanup);

const DISK = '2026-10-31 09.15 - Exact Case';
const TYPED = '2026-10-31 09.15 - Exact CaSe';
const BRIEF = '# Idea\nWhat we want.\n\n- AC1: it does the thing\n- AC2: it fails safe\n';
const PLAN = '# Plan\n\n## Tasks\n\n### T1 One\n- role: backend-engineer\n- files: a.txt\n- depends-on: none\n- parallel: yes\n- context: 10k\n- slice: x\n- seams: none\n';
const take = (root, rel, f) => cli('draft-input.mjs', ['take', rel, '--for', f], { cwd: root });
const wrong = (r) => {
  assert.equal(r.code, 3, r.all);
  assert.equal(r.out, `refused: ${WRONG}\n`);
};

describe('take', () => {
  test('take of a wrong-case folder is refused and nothing is written', () => {
    const root = fixture({ [`.company/work/${DISK}/plan.md`]: PLAN });
    const before = tree(root);
    wrong(take(root, `.company/work/${TYPED}/plan.md`, 'feature'));
    assert.deepEqual(tree(root), before);
  });

  test('take of a wrong-case plan, spec or grill file is refused', () => {
    const root = fixture({
      [`.company/work/${DISK}/plan.md`]: PLAN,
      [`.company/work/${DISK}/spec.md`]: BRIEF,
      [`.company/work/${DISK}/grill.md`]: BRIEF,
    });
    const before = tree(root);
    for (const file of ['PLAN.md', 'Spec.md', 'GRILL.md']) {
      wrong(take(root, `.company/work/${DISK}/${file}`, 'feature'));
      wrong(take(root, `.company/work/${DISK}/${file}`, 'to-spec'));
    }
    assert.deepEqual(tree(root), before);
  });

  test('take of a wrong-case prompt file is refused', () => {
    const root = fixture({ [`.company/work/${DISK}/prompt.md`]: BRIEF });
    const before = tree(root);
    wrong(take(root, `.company/work/${DISK}/PROMPT.md`, 'to-spec'));
    wrong(take(root, `.company/work/${TYPED}/prompt.md`, 'to-spec'));
    assert.deepEqual(tree(root), before);
  });

  test('take of a typed .Company or WORK prefix is refused wrong letter case', () => {
    const root = fixture({ [`.company/work/${DISK}/grill.md`]: BRIEF });
    const before = tree(root);
    for (const pre of ['.Company/work/', '.company/WORK/', '.COMPANY/Work/']) {
      wrong(take(root, `${pre}${DISK}/grill.md`, 'to-spec'));
    }
    assert.deepEqual(tree(root), before);
  });

  test('an exact draft file is taken: slug and input lines name the folder as on disk', () => {
    const root = fixture({ [`.company/work/${DISK}/plan.md`]: PLAN });
    const r = take(root, `.company/work/${DISK}/plan.md`, 'feature');
    assert.equal(r.code, 0, r.all);
    const slug = /^slug: (.+)$/m.exec(r.out)?.[1];
    assert.ok(slug, r.out);
    assert.ok(!r.out.includes(WRONG));
    assert.ok(r.out.includes(`input: .company/work/${slug}/input-feature.md`), r.out);
    assert.ok(fs.existsSync(path.join(root, '.company', 'work', slug, 'input-feature.md')));
  });

  test('an exact prompt file is taken whole', () => {
    const root = fixture({ [`.company/work/${DISK}/prompt.md`]: BRIEF });
    const r = take(root, `.company/work/${DISK}/prompt.md`, 'to-spec');
    assert.equal(r.code, 0, r.all);
    assert.ok(!r.out.includes(WRONG));
  });

  test('a work file missing in every case keeps the old refusal', () => {
    const root = fixture({ [`.company/work/${DISK}/plan.md`]: PLAN });
    const r = take(root, `.company/work/${DISK}/other.md`, 'feature');
    assert.equal(r.code, 3);
    assert.ok(!r.out.includes(WRONG), r.out);
    const g = take(root, `.company/work/2026-10-31 09.16 - Nowhere/plan.md`, 'feature');
    assert.equal(g.code, 3);
    assert.ok(!g.out.includes(WRONG), g.out);
  });

  test('a junction out of the work root keeps its link refusal', () => {
    const root = fixture({ 'real/plan.md': PLAN });
    fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
    fs.symlinkSync(path.join(root, 'real'), path.join(root, '.company', 'work', DISK), 'junction');
    const r = take(root, `.company/work/${DISK}/plan.md`, 'feature');
    assert.equal(r.code, 3);
    assert.equal(r.out, 'refused: link\n');
  });
});
