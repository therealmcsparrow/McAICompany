// T7: handoff v2.2. A Handoff path, run folder or exceptions slug in another letter case is refused ("wrong letter case").
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, cleanup, cli, tree, put, WRONG } from './fixtures/case-helper.mjs';
import { append } from './run-state.mjs';

after(cleanup);

const DISK = '2026-10-31 09.15 - Exact Case';
const TYPED = '2026-10-31 09.15 - Exact CaSe';
const KEY = '10-code-reviewer:R-1';
const handoff = (role, body = '') => `---\nstep: 1\nrole: ${role}\ntask: t\nstatus: done\nround: 0\nbase-commit: abc1234\nrisk-tier: high\n---\n# ${role}\nBy: ${role}\n${body}\n`;
const lint = (root, ...a) => cli('handoff-lint.mjs', a, { cwd: root });

function run() {
  const root = fixture({
    [`.company/work/${DISK}/10-code-reviewer.md`]: handoff('code-reviewer', '## Blocking\n- R-1 | a.js:1 | first\n'),
    [`.company/work/${DISK}/20-backend-engineer.md`]: handoff('backend-engineer', `## Contested\n- ${KEY} — escalate — the reviewer is wrong about this, the CEO should decide\n`),
    '.company/standards.md': `# Standards\n\n## Exceptions\n- ${DISK}/${KEY} — scope — why not — approved: 2026-10-31 (CEO)\n`,
  });
  append(root, DISK, { ev: 'start' }, { now: Date.UTC(2026, 9, 31, 9, 0, 0) });
  return root;
}

describe('a Handoff path', () => {
  test('a Handoff with a wrong-case work folder is refused', () => {
    const root = run();
    const before = tree(root);
    const r = lint(root, `.company/work/${TYPED}/10-code-reviewer.md`);
    assert.notEqual(r.code, 0, r.all);
    assert.ok(r.out.includes(WRONG), r.all);
    assert.deepEqual(tree(root), before);
  });

  test('a Handoff with a wrong-case file part is refused', () => {
    const root = run();
    const r = lint(root, `.company/work/${DISK}/10-Code-Reviewer.md`);
    assert.notEqual(r.code, 0, r.all);
    assert.ok(r.out.includes(WRONG), r.all);
  });

  test('a Handoff with a wrong-case .company or work segment is refused', () => {
    const root = run();
    const r = lint(root, `.COMPANY/work/${DISK}/10-code-reviewer.md`);
    assert.ok(r.out.includes(WRONG), r.all);
    const w = lint(root, `.company/WORK/${DISK}/10-code-reviewer.md`);
    assert.ok(w.out.includes(WRONG), w.all);
  });

  test('the exact path is linted as before', () => {
    const root = run();
    const r = lint(root, `.company/work/${DISK}/10-code-reviewer.md`);
    assert.ok(!r.all.includes(WRONG), r.all);
  });

  test('a missing file in any case keeps the old error', () => {
    const root = run();
    const r = lint(root, `.company/work/${DISK}/99-nothing.md`);
    assert.equal(r.code, 1);
    assert.equal(r.out, 'ERROR cannot read file\n');
  });
});

describe('run folders and exceptions', () => {
  test('--applied with a wrong-case run folder is refused', () => {
    const root = run();
    const r = lint(root, '--applied', `.company/work/${TYPED}`);
    assert.notEqual(r.code, 0, r.all);
    assert.ok(r.out.includes(WRONG), r.all);
  });

  test('--contests with a wrong-case run folder is refused', () => {
    const root = run();
    const r = lint(root, '--contests', `.company/work/${TYPED}`);
    assert.notEqual(r.code, 0, r.all);
    assert.ok(r.out.includes(WRONG), r.all);
  });

  test('--applied with the exact run folder lists the exception as before', () => {
    const root = run();
    const r = lint(root, '--applied', `.company/work/${DISK}`);
    assert.equal(r.code, 0, r.all);
    assert.ok(r.out.includes(`exceptions on file for ${DISK}: confirm each is yours (1)`), r.out);
  });

  test('--exceptions-for counts the exact slug', () => {
    const root = run();
    const r = lint(root, '--exceptions-for', DISK);
    assert.equal(r.out, 'exceptions on file: 1\n');
  });

  test('--exceptions-for with a wrong-case slug does not count the exception', () => {
    const root = run();
    const r = lint(root, '--exceptions-for', TYPED);
    assert.ok(r.out.includes(WRONG), r.all);
    assert.ok(!/exceptions on file: [1-9]/.test(r.out), r.out);
  });

  test('a wrong-case slug in an exceptions line is not applied to the exact run', () => {
    const root = run();
    put(root, '.company/standards.md', `# Standards\n\n## Exceptions\n- ${TYPED}/${KEY} — scope — why not — approved: 2026-10-31 (CEO)\n`);
    const r = lint(root, '--applied', `.company/work/${DISK}`);
    assert.ok(r.out.includes(`exceptions on file for ${DISK}: confirm each is yours (0)`), r.out);
  });
});
