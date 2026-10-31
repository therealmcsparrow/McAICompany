// T1: exactWorkPath (work-folder-name v1.1). A work folder path in another letter case is refused on every
// platform; the refusal words come from an ASCII-only fold, never from file-system behaviour.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as lib from '../mods/lib/work-folder.mjs';

const { WorkFolderRefusal } = lib;
const exactWorkPath = (...a) => lib.exactWorkPath(...a);
import { fixture, cleanup, cli, tree, allowsTwins, WRONG } from './fixtures/case-helper.mjs';

after(cleanup);
const io = { fs, path, platform: process.platform };
const NAME = '2026-10-31 09.15 - Exact Case';

const refusal = (fn) => assert.throws(fn, (e) => e instanceof WorkFolderRefusal && e.message === WRONG);

describe('exactWorkPath', () => {
  test('exactWorkPath refuses a wrong-case folder on every platform', () => {
    const root = fixture({ [`.company/work/${NAME}/plan.md`]: 'x' });
    refusal(() => exactWorkPath(io, root, [NAME.toLowerCase()]));
    refusal(() => exactWorkPath(io, root, [NAME.toUpperCase()]));
  });

  test('a wrong-case file part is refused', () => {
    const root = fixture({ [`.company/work/${NAME}/plan.md`]: 'x' });
    refusal(() => exactWorkPath(io, root, [NAME, 'PLAN.md']));
    refusal(() => exactWorkPath(io, root, [NAME, 'Plan.md']));
  });

  test('a wrong-case .company or work segment is refused', () => {
    const a = fixture({ [`.Company/work/${NAME}/plan.md`]: 'x' });
    refusal(() => exactWorkPath(io, a, [NAME]));
    const b = fixture({ [`.company/Work/${NAME}/plan.md`]: 'x' });
    refusal(() => exactWorkPath(io, b, [NAME]));
  });

  test('exact folder and exact file are exact', () => {
    const root = fixture({ [`.company/work/${NAME}/plan.md`]: 'x' });
    assert.equal(exactWorkPath(io, root, [NAME]), 'exact');
    assert.equal(exactWorkPath(io, root, [NAME, 'plan.md']), 'exact');
  });

  test('a path missing in every case is missing, not refused', () => {
    const root = fixture({ [`.company/work/${NAME}/plan.md`]: 'x' });
    assert.equal(exactWorkPath(io, root, ['2026-10-31 09.16 - Other']), 'missing');
    assert.equal(exactWorkPath(io, root, [NAME, 'none.md']), 'missing');
  });

  test('a look-alike letter outside ASCII stays a different name (missing, not a case variant)', () => {
    const root = fixture({ '.company/work/\u212Aelvin/plan.md': 'x' });
    assert.equal(exactWorkPath(io, root, ['kelvin']), 'missing');
    assert.equal(exactWorkPath(io, root, ['Kelvin']), 'missing');
  });

  test('two case twins: the typed spelling wins', (t) => {
    if (!allowsTwins()) {
      t.skip('this file system keeps no case twins');
      return;
    }
    const root = fixture({ '.company/work/abc/x.md': '1', '.company/work/ABC/x.md': '2' });
    assert.equal(exactWorkPath(io, root, ['abc']), 'exact');
    assert.equal(exactWorkPath(io, root, ['ABC']), 'exact');
  });
});

describe('work-folder.mjs branch', () => {
  test('branch refuses a wrong-case folder and writes nothing', () => {
    const root = fixture({ [`.company/work/${NAME}/plan.md`]: 'x' });
    const before = tree(root);
    const r = cli('work-folder.mjs', ['branch', NAME.replace('Exact Case', 'EXACT CASE')], { cwd: root });
    assert.equal(r.code, 3);
    assert.equal(r.out, `refused: ${WRONG}\n`);
    assert.deepEqual(tree(root), before);
  });

  test('branch of the exact name is unchanged', () => {
    const root = fixture({ [`.company/work/${NAME}/plan.md`]: 'x' });
    const r = cli('work-folder.mjs', ['branch', NAME], { cwd: root });
    assert.equal(r.code, 0);
    assert.equal(r.out, 'branch: aico/2026-10-31-0915-exact-case\n');
  });

  test('a name missing in every case keeps the old refusal', () => {
    const root = fixture({ [`.company/work/${NAME}/plan.md`]: 'x' });
    const r = cli('work-folder.mjs', ['branch', '2026-10-31 09.17 - Nope'], { cwd: root });
    assert.equal(r.code, 3);
    assert.equal(r.out, 'refused: unknown name\n');
  });

  test('a wrong-case .company folder is refused for branch', () => {
    const root = fixture({ [`.Company/work/${NAME}/plan.md`]: 'x' });
    const r = cli('work-folder.mjs', ['branch', NAME], { cwd: root });
    assert.equal(r.code, 3);
    assert.equal(r.out, `refused: ${WRONG}\n`);
  });
});
