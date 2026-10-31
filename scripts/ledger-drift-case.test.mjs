// T11: token-ledger v1.7, rule-check v1.3, drift-report v1.2 (step-times takes no typed name; its run comes from run-state active).
// A wrong-case run folder or report file is refused; nothing is written.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, cleanup, cli, tree, WRONG } from './fixtures/case-helper.mjs';

after(cleanup);

const DISK = '2026-10-31 09.15 - Exact Case';
const TYPED = '2026-10-31 09.15 - Exact CaSe';
const STEP = '---\nstep: 01\nrole: qa\ntask: t\nstatus: done\nround: 0\n---\n# qa\nBy: qa\n## Did\n- x\n';

describe('ledger', () => {
  const run = (root, ...a) => cli('ledger.mjs', a, { cwd: root });
  const files = () => ({ [`.company/work/${DISK}/01-qa.md`]: STEP });
  const add = (slug) => ['add', slug, 'step', '01', 'architect', 'aaa111', '5000'];

  test('ledger refuses a wrong-case run folder and writes no ledger line', () => {
    const root = fixture(files());
    const before = tree(root);
    const r = run(root, ...add(TYPED));
    assert.equal(r.code, 2, r.all);
    assert.equal(r.out, `refused: ${WRONG}\n`);
    assert.deepEqual(tree(root), before);
  });

  test('report, ship and reconcile refuse a wrong-case run folder', () => {
    const root = fixture(files());
    assert.equal(run(root, ...add(DISK)).code, 0);
    const before = tree(root);
    for (const args of [['report', TYPED], ['reconcile', TYPED], ['ship', TYPED, '3'], ['scorecard', TYPED], ['receipt', TYPED]]) {
      const r = run(root, ...args);
      assert.equal(r.code, 2, r.all);
      assert.equal(r.out, `refused: ${WRONG}\n`);
    }
    assert.deepEqual(tree(root), before);
  });

  test('the exact run folder appends as before', () => {
    const root = fixture(files());
    const r = run(root, ...add(DISK));
    assert.equal(r.code, 0, r.all);
    assert.equal(r.out, '');
    const dir = path.join(root, '.company', 'ledger');
    assert.deepEqual(fs.readdirSync(dir), [`${DISK}.jsonl`]);
  });

  test('a run with no folder in any case keeps the old behaviour', () => {
    const root = fixture(files());
    const r = run(root, ...add('2026-10-31 09.16 - Nowhere'));
    assert.equal(r.code, 0, r.all);
  });
});

describe('rule-check', () => {
  const git = (root, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd: root, encoding: 'utf8' });
  function repo() {
    const root = fixture({ 'README.md': 'x\n', [`.company/work/${DISK}/01-qa.md`]: STEP, '.gitignore': '.company/\n' });
    git(root, 'init', '-q');
    git(root, 'add', 'README.md', '.gitignore');
    git(root, 'commit', '-q', '-m', 'init');
    git(root, 'checkout', '-q', '-b', 'aico/2026-10-31-0915-exact-case');
    return { root, base: git(root, 'rev-parse', 'HEAD').stdout.trim() };
  }
  const run = (root, ...a) => cli('rule-check.mjs', a, { cwd: root });

  test('rule-check refuses a wrong-case run folder', () => {
    const { root, base } = repo();
    for (const cmd of ['text', 'run']) {
      const r = run(root, cmd, '--base', base, '--run', TYPED);
      assert.equal(r.code, 3, r.all);
      assert.equal(r.out, `refused: ${WRONG}\n`);
    }
  });

  test('rule-check refuses a --handoff in a wrong-case run folder', () => {
    const { root, base } = repo();
    const r = run(root, 'run', '--base', base, '--run', DISK, '--handoff', `.company/work/${TYPED}/01-qa.md`);
    assert.equal(r.code, 3, r.all);
    assert.equal(r.out, `refused: ${WRONG}\n`);
  });

  test('the exact run folder is judged as before', () => {
    const { root, base } = repo();
    const r = run(root, 'text', '--base', base, '--run', DISK);
    assert.ok(!r.all.includes(WRONG), r.all);
  });
});

describe('drift-report lint', () => {
  const run = (root, ...a) => cli('drift-report.mjs', a, { cwd: root });
  const REPORT = '---\nchecked: []\ndate: 2026-10-29\n---\n## Items\n- none\n';
  const files = () => ({ [`.company/work/${DISK}/drift-2026-10-29.md`]: REPORT });

  test('drift-report refuses a wrong-case report path', () => {
    const root = fixture(files());
    const before = tree(root);
    const r = run(root, 'lint', `.company/work/${TYPED}/drift-2026-10-29.md`);
    assert.equal(r.code, 3, r.all);
    assert.equal(r.out, `refused: ${WRONG}\n`);
    assert.deepEqual(tree(root), before);
  });

  test('a wrong-case .company or work segment is refused', () => {
    const root = fixture(files());
    const r = run(root, 'lint', `.company/WORK/${DISK}/drift-2026-10-29.md`);
    assert.equal(r.out, `refused: ${WRONG}\n`);
  });

  test('the exact report path is linted as before', () => {
    const root = fixture(files());
    const r = run(root, 'lint', `.company/work/${DISK}/drift-2026-10-29.md`);
    assert.ok(!r.all.includes(WRONG), r.all);
    assert.ok(r.out.trimEnd().endsWith('errors'), r.out);
  });

  test('a report missing in every case keeps the old answer', () => {
    const root = fixture(files());
    const r = run(root, 'lint', `.company/work/${DISK}/drift-2026-10-30.md`);
    assert.equal(r.code, 1);
    assert.equal(r.out, 'drift-report: report unreadable\n');
  });
});
