// QA-first red tests for T48: slugOfKey, v3 `siblings`, `branch` on a run slug (work-folder-name v3.0 delta; AC12, AC7).
// Built through the lib makers, so these tests do not depend on `--layout` (refused after the flip).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as lib from '../mods/lib/work-folder.mjs';
import { main } from './work-folder.mjs';

const NOW = new Date(2026, 9, 30, 23, 45, 7);
const io = { fs, path, platform: process.platform };
const ID = 'P20261030.000001';

const dirs = [];
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-run2-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const work = root => path.join(root, '.company', 'work');
const read = (root, ...p) => fs.readFileSync(path.join(work(root), ...p), 'utf8');
const lines = (root, ...p) => read(root, ...p).split('\n');
const run = (root, argv) => main(argv, { root, now: NOW });
function snapshot(dir, rel = '') {
  const out = {};
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) Object.assign(out, { [r + '/']: '' }, snapshot(dir, r));
    else out[r] = fs.readFileSync(path.join(dir, r), 'utf8');
  }
  return out;
}
const v3 = (root, description = 'Fix Login') => lib.makeProjectV3(io, root, NOW, description, 'idea');
const v2 = (root, description = 'Old Work') => lib.makeProject(io, root, NOW, description, 'idea');

describe('slugOfKey (AC12)', () => {
  test('is exported', () => {
    assert.equal(typeof lib.slugOfKey, 'function');
  });
  test('turns a run key back into the run slug', () => {
    assert.equal(lib.slugOfKey(`${ID}~01-fix`), `${ID}/01-fix`);
    assert.equal(lib.slugOfKey(`${ID}~120-idea`), `${ID}/120-idea`);
  });
  test('round trip: runKey(slugOfKey(k)) === k and slugOfKey(runKey(s)) === s', () => {
    for (const slug of [`${ID}/01-fix`, `${ID}/99-a-b-c`, `${ID}/999-feature`]) {
      const key = lib.runKey(slug);
      assert.equal(lib.slugOfKey(key), slug);
      assert.equal(lib.runKey(lib.slugOfKey(key)), key);
    }
  });
  test('a v2 name maps to itself', () => {
    const root = project();
    const made = v2(root);
    assert.equal(lib.slugOfKey(made.name), made.name);
    assert.equal(lib.slugOfKey(`${ID}-23.45.07`), `${ID}-23.45.07`);
  });
  test('a legacy name maps to itself (AC7)', () => {
    for (const k of ['x', 'fix-login', 'a1-b2']) assert.equal(lib.slugOfKey(k), k);
  });
  test('anything else is null', () => {
    const bad = [
      `${ID}~01-fix~02-fix`, `${ID}/01-fix`, `${ID}\\01-fix`, `${ID}~..`, '..', `${ID}~01-../x`,
      `${ID}~00-fix`, `${ID}~1-fix`, `${ID}~01-Fix`, `${ID}~01-`, ID, '', 'X', '-x', 'a b',
    ];
    for (const k of bad) assert.equal(lib.slugOfKey(k), null, JSON.stringify(k));
    for (const k of [null, undefined, 5, {}, []]) assert.equal(lib.slugOfKey(k), null);
  });
  test('over 80 characters is null, exactly 80 is kept', () => {
    const fill = 'a'.repeat(80 - ID.length - 4);
    const ok = `${ID}~01-${fill}`;
    assert.equal(ok.length, 80);
    assert.equal(lib.slugOfKey(ok), `${ID}/01-${fill}`);
    assert.equal(lib.slugOfKey(`${ok}a`), null);
  });
});

describe('work-folder siblings on v3 projects (AC12)', () => {
  function two() {
    const root = project();
    const a = v3(root, 'First Project');
    const b = v3(root, 'Second Project');
    return { root, a: a.id, b: b.id, runA: a.name, runB: b.name };
  }
  test('sets line 3 of each 00-project.md to the other IDs and lists the project folders', () => {
    const { root, a, b } = two();
    const r = run(root, ['siblings', a, b]);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.deepEqual(r.lines, [`linked: ${a} ${b}`]);
    assert.equal(lines(root, a, '00-project.md')[2], `Siblings: ${b}`);
    assert.equal(lines(root, b, '00-project.md')[2], `Siblings: ${a}`);
  });
  test('line 1 stays the description', () => {
    const { root, a, b } = two();
    assert.equal(run(root, ['siblings', a, b]).code, 0);
    assert.equal(lines(root, a, '00-project.md')[0], 'First Project');
    assert.equal(lib.summaryDescription(read(root, a, '00-project.md')).description, 'First Project');
  });
  test('a second call replaces the line, it does not add one', () => {
    const { root, a, b } = two();
    run(root, ['siblings', a, b]);
    const once = read(root, a, '00-project.md');
    run(root, ['siblings', a, b]);
    assert.equal(read(root, a, '00-project.md'), once);
    assert.equal(once.split('\n').filter(l => l.startsWith('Siblings:')).length, 1);
  });
  test('three IDs: each lists the other two, sorted', () => {
    const { root, a, b } = two();
    const c = v3(root, 'Third').id;
    const r = run(root, ['siblings', c, a, b]);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(lines(root, a, '00-project.md')[2], `Siblings: ${[b, c].sort().join(' ')}`);
    assert.equal(lines(root, c, '00-project.md')[2], `Siblings: ${[a, b].sort().join(' ')}`);
  });
  test('v3 run 00-summary.md files are not touched; only the two 00-project.md files change', () => {
    const { root, a, b } = two();
    const before = snapshot(work(root));
    run(root, ['siblings', a, b]);
    const after = snapshot(work(root));
    const changed = Object.keys(after).filter(k => after[k] !== before[k]).sort();
    assert.deepEqual(changed, [path.join(a, '00-project.md'), path.join(b, '00-project.md')].sort());
  });
  test('a v3 project and a v2 project: line 3 of 00-project.md and line 4 of 00-summary.md', () => {
    const root = project();
    const a = v3(root, 'New One').id;
    const old = v2(root, 'Old One');
    const r = run(root, ['siblings', a, old.id]);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(lines(root, a, '00-project.md')[2], `Siblings: ${old.id}`);
    assert.equal(lines(root, old.name, '00-summary.md')[3], `Siblings: ${a}`);
  });
  test('an ID with a v3 folder and v2 folders sets both', () => {
    const root = project();
    const old = v2(root, 'Both');
    lib.makeRunV3(io, root, old.id, NOW, 'fix');
    assert.ok(fs.existsSync(path.join(work(root), old.id, '00-project.md')));
    const other = v3(root, 'Other').id;
    const r = run(root, ['siblings', old.id, other]);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(lines(root, old.id, '00-project.md')[2], `Siblings: ${other}`);
    assert.equal(lines(root, old.name, '00-summary.md')[3], `Siblings: ${other}`);
    assert.equal(lines(root, other, '00-project.md')[2], `Siblings: ${old.id}`);
  });
  test('refusal writes nothing: unknown ID', () => {
    const { root, a, b } = two();
    const good = two();
    assert.equal(run(good.root, ['siblings', good.a, good.b]).code, 0, 'the same call without the unknown ID links');
    const before = snapshot(root);
    const r = run(root, ['siblings', a, b, 'P20261030.000099']);
    assert.deepEqual(r, { code: 3, lines: ['refused: unknown project'] });
    assert.deepEqual(snapshot(root), before);
  });
  test('refusal writes nothing: a later project has an empty 00-project.md', () => {
    const { root, a, b } = two();
    const good = two();
    assert.equal(run(good.root, ['siblings', good.a, good.b]).code, 0, 'the same pair with intact files links');
    fs.writeFileSync(path.join(work(root), b, '00-project.md'), '');
    const before = snapshot(root);
    const r = run(root, ['siblings', a, b]);
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: /);
    assert.deepEqual(snapshot(root), before);
  });
  test('refusal writes nothing: duplicate ID, bad ID, one ID', () => {
    const { root, a, b } = two();
    const good = two();
    assert.equal(run(good.root, ['siblings', good.a, good.b]).code, 0, 'a valid pair links');
    const before = snapshot(root);
    void b;
    for (const argv of [['siblings', a, a], ['siblings', a, 'nope'], ['siblings', a]]) {
      assert.equal(run(root, argv).code, 3, argv.join(' '));
      assert.deepEqual(snapshot(root), before, argv.join(' '));
    }
  });
});

describe('work-folder branch on a run slug (AC12, AC7)', () => {
  test('a v3 run slug prints the project branch', () => {
    const root = project();
    const made = v3(root);
    assert.deepEqual(run(root, ['branch', made.name]), { code: 0, lines: [`branch: aico/${made.id}`] });
  });
  test('a later v3 run slug (makeRunV3) prints the same branch', () => {
    const root = project();
    const made = v3(root);
    const slug = lib.makeRunV3(io, root, made.id, NOW, 'fix');
    assert.deepEqual(run(root, ['branch', slug]), { code: 0, lines: [`branch: aico/${made.id}`] });
  });
  test('v2 names print what they do today (AC7)', () => {
    const root = project();
    const old = v2(root);
    assert.deepEqual(run(root, ['branch', old.name]), { code: 0, lines: [`branch: aico/${old.id}`] });
  });
  test('a bare project ID stays refused: bad name, even when the v3 folder exists', () => {
    const root = project();
    const made = v3(root);
    assert.deepEqual(run(root, ['branch', made.id]), { code: 3, lines: ['refused: bad name'] });
  });
  test('a run slug whose folder is missing is refused: unknown name', () => {
    const root = project();
    const made = v3(root);
    assert.deepEqual(run(root, ['branch', `${made.id}/05-fix`]), { code: 3, lines: ['refused: unknown name'] });
    assert.deepEqual(run(root, ['branch', 'P20261030.000077/01-fix']), { code: 3, lines: ['refused: unknown name'] });
  });
  test('a run slug that is a file, not a folder, is refused: unknown name', () => {
    const root = project();
    const made = v3(root);
    fs.writeFileSync(path.join(work(root), made.id, '07-fix'), 'x');
    assert.deepEqual(run(root, ['branch', `${made.id}/07-fix`]), { code: 3, lines: ['refused: unknown name'] });
  });
  test('bad names are refused: bad name', () => {
    const root = project();
    const made = v3(root);
    const bad = [`${made.id}/`, `${made.id}/../x`, `${made.id}\\01-idea`, `${made.id}/01-idea/x`, `${made.id}~01-idea`, '..', '', `${made.id}/00-idea`];
    for (const name of bad) assert.deepEqual(run(root, ['branch', name]), { code: 3, lines: ['refused: bad name'] }, JSON.stringify(name));
  });
  test('refusal writes nothing', () => {
    const root = project();
    const made = v3(root);
    assert.equal(run(root, ['branch', made.name]).code, 0, 'the run slug itself is accepted');
    const before = snapshot(root);
    run(root, ['branch', made.id]);
    run(root, ['branch', `${made.id}/09-fix`]);
    assert.deepEqual(snapshot(root), before);
  });
  test('argument count other than one is usage', () => {
    const root = project();
    assert.deepEqual(run(root, ['branch']), { code: 3, lines: ['refused: usage'] });
    assert.deepEqual(run(root, ['branch', 'a', 'b']), { code: 3, lines: ['refused: usage'] });
  });
});
