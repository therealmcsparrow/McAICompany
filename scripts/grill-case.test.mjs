// T3: grill-file v1.3. A wrong-case grill slug or GRILL.md is refused; nothing is read past the check.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, cleanup, cli, tree, WRONG } from './fixtures/case-helper.mjs';

after(cleanup);

const DISK = '2026-10-31 09.15 - Exact Case';
const TYPED = '2026-10-31 09.15 - Exact CaSe';
const GRILL = '---\nslug: demo\nstarted: 2026-10-30 09:15\nstatus: open\nformat: 1\n---\n## Idea\nA plain idea.\n\n## Open branches\n\n## Closed branches\n\n## Log\n';
const grill = (root, ...args) => cli('grill.mjs', args, { cwd: root });
const wrong = (r) => {
  assert.equal(r.code, 3, r.all);
  assert.equal(r.out, `refused: ${WRONG}\n`);
};

describe('grill status and check', () => {
  test('status with a wrong-case slug is refused', () => {
    const root = fixture({ [`.company/work/${DISK}/grill.md`]: GRILL });
    const before = tree(root);
    wrong(grill(root, 'status', TYPED));
    assert.deepEqual(tree(root), before);
  });

  test('a wrong-case grill file is refused', () => {
    const root = fixture({ [`.company/work/${DISK}/grill.md`]: GRILL });
    const before = tree(root);
    wrong(grill(root, 'check', `.company/work/${DISK}/GRILL.md`));
    wrong(grill(root, 'check', `.company/work/${TYPED}/grill.md`));
    assert.deepEqual(tree(root), before);
  });

  test('a wrong-case .company or work prefix is refused', () => {
    const root = fixture({ [`.company/work/${DISK}/grill.md`]: GRILL });
    const before = tree(root);
    wrong(grill(root, 'check', `.Company/work/${DISK}/grill.md`));
    wrong(grill(root, 'check', `.company/WORK/${DISK}/grill.md`));
    assert.deepEqual(tree(root), before);
  });

  test('the exact spelling is read as before', () => {
    const root = fixture({ [`.company/work/${DISK}/grill.md`]: GRILL });
    for (const args of [['status', DISK], ['check', `.company/work/${DISK}/grill.md`]]) {
      const r = grill(root, ...args);
      assert.ok(!r.all.includes(WRONG), r.all);
      assert.ok(r.code === 0 || r.code === 2, r.all);
    }
  });

  test('a missing grill file in any case keeps the old refusal', () => {
    const root = fixture({ [`.company/work/${DISK}/spec.md`]: 'x' });
    const r = grill(root, 'status', DISK);
    assert.equal(r.code, 3);
    assert.ok(!r.out.includes(WRONG), r.out);
    const s = grill(root, 'status', '2026-10-31 09.16 - Nowhere');
    assert.equal(s.code, 3);
    assert.ok(!s.out.includes(WRONG), s.out);
  });
});
