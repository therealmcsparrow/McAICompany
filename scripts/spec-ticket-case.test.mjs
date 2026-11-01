// T4: destination-spec v1.3 and ticket-approval v1.2. A wrong-case folder in a spec path or plan reference is refused.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, cleanup, cli, tree, WRONG } from './fixtures/case-helper.mjs';

after(cleanup);

const DISK = '2026-10-31 09.15 - Exact Case';
const TYPED = '2026-10-31 09.15 - Exact CaSe';
const BASE = 'a'.repeat(40);
const HEADINGS = ['## Problem', '## Solution', '## User stories', '## Decisions', '## Testing decisions', '## Out of scope'];
const SPEC = `---\nslug: demo\nversion: pending\nshipped: pending\n---\n${HEADINGS.map((h) => `${h}\nPlain words about the result.\n`).join('\n')}`;
const PLAN = `# Plan: demo\n\nBase commit: ${BASE}\n\n## Decided (plan-wide)\n- Decided: keep it small, because the CEO said so.\n\n## Tasks\n\n### T1 one\n- role: backend-engineer\n- files: src/t1.mjs\n- depends-on: none\n\n### T2 two\n- role: backend-engineer\n- files: src/t2.mjs\n- depends-on: none\n`;

const wrong = (r) => {
  assert.equal(r.code, 3, r.all);
  assert.ok(r.out.startsWith(`refused: ${WRONG}`), r.out);
};

describe('spec-check', () => {
  const run = (root, ...a) => cli('spec-check.mjs', a, { cwd: root });

  test('check of a spec path with a wrong-case folder is refused', () => {
    const root = fixture({ [`.company/work/${DISK}/spec.md`]: SPEC });
    const before = tree(root);
    wrong(run(root, 'check', `.company/work/${TYPED}/spec.md`));
    assert.deepEqual(tree(root), before);
  });

  test('stamp of a spec path with a wrong-case folder is refused and the file is untouched', () => {
    const root = fixture({ [`.company/work/${DISK}/spec.md`]: SPEC });
    const before = tree(root);
    wrong(run(root, 'stamp', `.company/work/${TYPED}/spec.md`, '--version', '1.0.0', '--date', '2026-10-31'));
    assert.deepEqual(tree(root), before);
  });

  test('a wrong-case .company or work prefix is refused as wrong letter case', () => {
    const root = fixture({ [`.company/work/${DISK}/spec.md`]: SPEC });
    wrong(run(root, 'check', `.Company/work/${DISK}/spec.md`));
    wrong(run(root, 'check', `.company/WORK/${DISK}/spec.md`));
    wrong(run(root, 'stamp', `.company/WORK/${DISK}/spec.md`, '--version', '1.0.0', '--date', '2026-10-31'));
  });

  test('the exact spec path is checked as before', () => {
    const root = fixture({ [`.company/work/${DISK}/spec.md`]: SPEC });
    const r = run(root, 'check', `.company/work/${DISK}/spec.md`);
    assert.equal(r.code, 0, r.all);
    assert.equal(r.out, 'spec-check: 0 errors\n');
  });

  test('a spec missing in every case keeps the old refusal', () => {
    const root = fixture({ [`.company/work/${DISK}/plan.md`]: 'x' });
    const r = run(root, 'check', `.company/work/${DISK}/spec.md`);
    assert.equal(r.code, 3);
    assert.ok(!r.out.includes(WRONG), r.out);
  });
});

describe('ticket-approval', () => {
  const run = (root, ...a) => cli('ticket-approval.mjs', a, { cwd: root });

  test('a wrong-case plan reference is refused and no record is written', () => {
    const root = fixture({ [`.company/work/${DISK}/plan.md`]: PLAN });
    const before = tree(root);
    wrong(run(root, 'tickets', TYPED, 'plan.md', '--phase', 'd'));
    wrong(run(root, 'tickets', DISK, `${TYPED}/plan.md`, '--phase', 'd'));
    assert.deepEqual(tree(root), before);
  });

  test('a wrong-case slug is refused for read, ticket and build-plan', () => {
    const root = fixture({ [`.company/work/${DISK}/plan.md`]: PLAN });
    const before = tree(root);
    wrong(run(root, 'read', TYPED));
    wrong(run(root, 'ticket', TYPED, 'T1', 'approve'));
    wrong(run(root, 'build-plan', TYPED));
    assert.deepEqual(tree(root), before);
  });

  test('the exact plan reference lists the tickets as before', () => {
    const root = fixture({ [`.company/work/${DISK}/plan.md`]: PLAN });
    const r = run(root, 'tickets', DISK, 'plan.md', '--phase', 'd');
    assert.equal(r.code, 0, r.all);
    assert.ok(r.out.startsWith('tickets 2 phase d\n'), r.out);
  });

  test('a plan missing in every case keeps the old refusal', () => {
    const root = fixture({ [`.company/work/${DISK}/spec.md`]: 'x' });
    const r = run(root, 'tickets', DISK, 'plan.md', '--phase', 'd');
    assert.notEqual(r.code, 0);
    assert.ok(!r.all.includes(WRONG), r.all);
  });
});
