// T10: idea-flow, reflect, skillspector-scan, skill-recommendation. A wrong-case slug, run or report folder is refused; nothing is written.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, cleanup, cli, tree, WRONG } from './fixtures/case-helper.mjs';

after(cleanup);

const DISK = '2026-10-31 09.15 - Exact Case';
const TYPED = '2026-10-31 09.15 - Exact CaSe';
const STEP = '---\nstep: 01\nrole: qa\ntask: t\nstatus: done\nround: 0\n---\n# qa\nBy: qa\n## Did\n- x\n';

describe('idea-flow', () => {
  const run = (root, ...a) => cli('idea-flow.mjs', a, { cwd: root });
  const files = () => ({ [`.company/work/${DISK}/01-qa.md`]: STEP });

  test('idea-flow refuses a wrong-case slug', () => {
    const root = fixture(files());
    assert.equal(run(root, 'start', DISK, '--kind', 'idea').code, 0);
    const before = tree(root);
    for (const args of [['start', TYPED, '--kind', 'idea'], ['read', TYPED], ['state', TYPED], ['options', TYPED]]) {
      const r = run(root, ...args);
      assert.equal(r.code, 3, r.all);
      assert.equal(r.err, `refused: ${WRONG}\n`);
    }
    assert.deepEqual(tree(root), before, 'no event written');
  });

  test('a start of a wrong-case slug makes no record or folder', () => {
    const root = fixture(files());
    const before = tree(root);
    const r = run(root, 'start', TYPED, '--kind', 'idea');
    assert.equal(r.err, `refused: ${WRONG}\n`);
    assert.deepEqual(tree(root), before);
  });

  test('the exact slug starts and reads as before', () => {
    const root = fixture(files());
    assert.equal(run(root, 'start', DISK, '--kind', 'idea').out, 'started\n');
    const r = run(root, 'read', DISK);
    assert.equal(r.code, 0, r.all);
  });

  test('a slug missing in every case keeps the old behaviour', () => {
    const root = fixture(files());
    const r = run(root, 'read', '2026-10-31 09.16 - Nowhere');
    assert.ok(!r.all.includes(WRONG), r.all);
  });
});

describe('reflect', () => {
  const run = (root, ...a) => cli('reflect.mjs', a, { cwd: root });
  const files = () => ({ [`.company/work/${DISK}/01-qa.md`]: STEP });

  test('reflect refuses a wrong-case run folder', () => {
    const root = fixture(files());
    const before = tree(root);
    for (const args of [['retro', TYPED, '--json'], ['step', TYPED, '01-qa.md', '--json']]) {
      const r = run(root, ...args);
      assert.equal(r.code, 2, r.all);
      assert.equal(r.out, `refused: ${WRONG}\n`);
    }
    assert.deepEqual(tree(root), before);
  });

  test('a step file in a wrong-case run folder path is refused', () => {
    const root = fixture(files());
    const r = run(root, 'step', DISK, `.company/work/${TYPED}/01-qa.md`, '--json');
    assert.equal(r.code, 2, r.all);
    assert.ok(r.out.startsWith('refused: '), r.out);
  });

  test('a wrongly spelled .company/work pair in a step path is refused with the case reason', () => {
    const root = fixture(files());
    for (const pair of ['.COMPANY/work', '.company/WORK', '.Company/Work']) {
      const r = run(root, 'step', DISK, `${pair}/${DISK}/01-qa.md`, '--json');
      assert.equal(r.code, 2, r.all);
      assert.equal(r.out, `refused: ${WRONG}\n`, pair);
    }
  });

  test('a U+212A look-alike in the work segment or the slug is refused, nothing is read', () => {
    const K = 'K';
    const root = fixture({ [`.company/work/2026-10-31 09.15 - Kelvin Work/01-qa.md`]: STEP });
    const slug = '2026-10-31 09.15 - Kelvin Work';
    const lookalike = '2026-10-31 09.15 - Kelvin Wor' + K;
    const cases = [
      [slug, `.company/wor${K}/${slug}/01-qa.md`],
      [slug, `.company/work/${lookalike}/01-qa.md`],
      [slug, path.join(root, '.company', `wor${K}`, slug, '01-qa.md')],
      [slug, path.join(root, '.company', 'work', lookalike, '01-qa.md')],
    ];
    for (const [s, file] of cases) {
      const r = run(root, 'step', s, file, '--json');
      assert.equal(r.code, 2, `${file}: ${r.all}`);
      assert.ok(r.out.startsWith('refused: '), `${file}: ${r.out}`);
    }
  });

  test('an ASCII-case work segment keeps the wrong letter case words', () => {
    const root = fixture(files());
    const r = run(root, 'step', DISK, `.company/WORK/${DISK}/01-qa.md`, '--json');
    assert.equal(r.out, `refused: ${WRONG}\n`);
  });

  test('the exact run folder is reflected as before', () => {
    const root = fixture(files());
    const r = run(root, 'retro', DISK, '--json');
    assert.equal(r.code, 0, r.all);
    assert.ok(!r.all.includes(WRONG));
  });

  test('a run folder missing in every case keeps the old refusal', () => {
    const root = fixture(files());
    const r = run(root, 'retro', '2026-10-31 09.16 - Nowhere', '--json');
    assert.equal(r.code, 2);
    assert.equal(r.out, 'refused: no run folder for 2026-10-31 09.16 - Nowhere\n');
  });
});

describe('skillspector writeReport', () => {
  const OUT = { v: 1, tool: { version: '2.13.1', commit: null }, mode: 'no-llm', results: [], skipped_invalid: 0, truncated: 0, roots_refused: 0, summary: { pass: 0, findings: 0, error: 0 } };
  const load = () => import('./skillspector.mjs');

  test('skillspector refuses a wrong-case report folder and writes nothing', async () => {
    const { writeReport } = await load();
    const root = fixture({ [`.company/work/${DISK}/01-qa.md`]: STEP });
    const before = tree(root);
    await assert.rejects(() => writeReport(root, TYPED, OUT), (e) => e.message === WRONG);
    assert.deepEqual(tree(root), before);
  });

  test('the exact report folder gets the report as before', async () => {
    const { writeReport } = await load();
    const root = fixture({ [`.company/work/${DISK}/01-qa.md`]: STEP });
    await writeReport(root, DISK, OUT);
    assert.ok(fs.lstatSync(path.join(root, '.company', 'work', DISK, 'skillspector-report.md')).isFile());
  });
});

describe('skill-picks', () => {
  const run = (root, ...a) => cli('skill-picks.mjs', a, { cwd: root });
  const RESEARCHER = '---\nstep: 01\nrole: skill-researcher\narea: design\n---\n## Recommended set\n- none\n';
  const files = () => ({ [`.company/work/${DISK}/01-skill-researcher.md`]: RESEARCHER });

  test('skill-picks refuses a wrong-case work folder', () => {
    const root = fixture(files());
    for (const cmd of ['lint']) {
      const r = run(root, cmd, `.company/work/${TYPED}/01-skill-researcher.md`);
      assert.notEqual(r.code, 0, r.all);
      assert.equal(r.out, `refused: ${WRONG}\n`);
    }
  });

  test('the exact path is linted as before', () => {
    const root = fixture(files());
    const r = run(root, 'lint', `.company/work/${DISK}/01-skill-researcher.md`);
    assert.equal(r.code, 0, r.all);
    assert.ok(!r.out.includes(WRONG));
  });

  test('a Handoff missing in every case keeps the old refusal', () => {
    const root = fixture(files());
    const r = run(root, 'lint', `.company/work/${DISK}/09-skill-researcher.md`);
    assert.equal(r.out, 'refused: handoff not found\n');
  });
});
