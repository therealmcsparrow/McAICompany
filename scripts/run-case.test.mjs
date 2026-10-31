// T6: lead-handoff v1.5, run-state v1.7, run-guard v1.2. A wrong-case slug is refused and no ledger or run-state line is written.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, cleanup, cli, tree, WRONG } from './fixtures/case-helper.mjs';

after(cleanup);

const DISK = '2026-10-31 09.15 - Exact Case';
const TYPED = '2026-10-31 09.15 - Exact CaSe';
const START = '{"v":1,"at":"2026-10-31T09:15:00Z","ev":"start"}\n';
const files = () => ({ [`.company/work/${DISK}/run-state.jsonl`]: START, [`.company/work/${DISK}/01-qa.md`]: '---\nrole: qa\n---\n' });

describe('run-state', () => {
  const run = (root, ...a) => cli('run-state.mjs', a, { cwd: root });

  test('run-state refuses a wrong-case slug and writes nothing', () => {
    const root = fixture(files());
    const before = tree(root);
    for (const args of [['wave', TYPED, '2'], ['ask', TYPED, 'plan'], ['end', TYPED, 'abort']]) {
      const r = run(root, ...args);
      assert.equal(r.code, 2, r.all);
      assert.equal(r.out, `refused: ${WRONG}\n`);
    }
    assert.deepEqual(tree(root), before);
  });

  test('a start of a wrong-case slug makes no run folder (linux has no such folder yet)', () => {
    const root = fixture(files());
    const r = run(root, 'start', TYPED);
    assert.equal(r.code, 2, r.all);
    assert.equal(r.out, `refused: ${WRONG}\n`);
    assert.deepEqual(fs.readdirSync(path.join(root, '.company', 'work')), [DISK]);
  });

  test('the exact slug appends as before', () => {
    const root = fixture(files());
    const r = run(root, 'wave', DISK, '2');
    assert.equal(r.code, 0, r.all);
    assert.equal(r.out, 'ok: wave 2\n');
    assert.equal(fs.readFileSync(path.join(root, '.company', 'work', DISK, 'run-state.jsonl'), 'utf8').split('\n').filter(Boolean).length, 2);
  });

  test('a run folder missing in every case keeps the old behaviour', () => {
    const root = fixture(files());
    const r = run(root, 'wave', '2026-10-31 09.16 - Nowhere', '2');
    assert.ok(!r.all.includes(WRONG), r.all);
  });
});

describe('run-guard', () => {
  test('run-guard refuses a wrong-case slug', () => {
    const root = fixture(files());
    const r = cli('run-guard.mjs', ['gate', TYPED], { cwd: root });
    assert.equal(r.code, 3, r.all);
    assert.equal(r.out, `refused: ${WRONG}\n`);
  });

  test('the exact slug prints the two guardrail lines', () => {
    const root = fixture(files());
    const r = cli('run-guard.mjs', ['gate', DISK], { cwd: root });
    assert.equal(r.code, 0, r.all);
    assert.equal(r.out.trimEnd().split('\n').length, 2);
  });
});

describe('lead-handover', () => {
  const run = (root, ...a) => cli('lead-handover.mjs', a, { cwd: root });

  test('lead-handover refuses a wrong-case slug and writes nothing', () => {
    const root = fixture(files());
    const before = tree(root);
    for (const args of [['read', TYPED], ['write', TYPED], ['begin', TYPED, 'feature']]) {
      const r = run(root, ...args);
      assert.equal(r.code, 3, r.all);
      assert.equal(r.err, `refused: ${WRONG}\n`);
    }
    assert.deepEqual(tree(root), before);
  });

  test('the exact slug reads as before', () => {
    const root = fixture(files());
    const r = run(root, 'read', DISK);
    assert.equal(r.code, 0, r.all);
    assert.ok(r.out.startsWith('handovers 0\n'), r.out);
  });

  test('a run missing in every case keeps the old refusal', () => {
    const root = fixture(files());
    const r = run(root, 'read', '2026-10-31 09.16 - Nowhere');
    assert.equal(r.code, 3);
    assert.equal(r.err, 'refused: no run\n');
  });
});
