// `work-folder new` makes v3 only; any --layout is a usage refusal.
// work-folder-name v3.0. Drive-agnostic: temp dirs only.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main } from './work-folder.mjs';

const SCRIPT = fileURLToPath(new URL('./work-folder.mjs', import.meta.url));
const NOW = new Date(2026, 9, 30, 23, 45);
const ID = 'P20261030.000001';
const dirs = [];
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-flip-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const work = root => path.join(root, '.company', 'work');
const top = root => fs.readdirSync(work(root)).sort();
const topic = (root, text = 'Fix Login') => fs.writeFileSync(path.join(root, '.company', 'work-folder-topic-idea.txt'), text);
const NEW = ['new', '--playbook', 'idea', '--topic', 'file'];

describe('new without --layout is v3', () => {
  test('first run: project folder, 00-project.md, 01-<pb>; prints run slug', () => {
    const root = project();
    topic(root);
    const r = main(NEW, { root, now: NOW });
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, [`id: ${ID}`, `name: ${ID}/01-idea`, `branch: aico/${ID}`]);
    assert.deepEqual(top(root), [ID]);
    assert.deepEqual(fs.readdirSync(path.join(work(root), ID)).sort(), ['00-project.md', '01-idea']);
  });

  test('--project <ID> joins as the next v3 run, even with a v2 folder of that ID', () => {
    const root = project();
    fs.mkdirSync(path.join(work(root), `${ID}-10.00.00`));
    fs.writeFileSync(path.join(work(root), `${ID}-10.00.00`, '00-summary.md'), 'Old\n\nRun: first idea\n');
    const r = main(['new', '--playbook', 'fix', '--project', ID], { root, now: NOW });
    assert.equal(r.code, 0);
    assert.equal(r.lines[1], `name: ${ID}/01-fix`);
    assert.ok(fs.statSync(path.join(work(root), ID, '01-fix', '00-summary.md')).isFile());
    assert.ok(!top(root).includes(`${ID}-23.45.00`));
  });

  test('CLI process exits 0 and prints a slash slug', () => {
    const root = project();
    const res = spawnSync(process.execPath, [SCRIPT, 'new', '--playbook', 'idea', '--topic', 'none'], { cwd: root, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout.trim().split('\n')[1], /^name: P\d{8}\.\d{6}\/01-idea$/);
  });
});

describe('--layout with any value is refused: usage, non-zero, nothing written', () => {
  const variants = [['v2'], ['v3'], ['V3'], ['v4'], [''], ['3'], []]; // [] = flag without a value
  for (const v of variants) {
    test(`new (topic) --layout ${JSON.stringify(v[0] ?? '<none>')}`, () => {
      const root = project();
      topic(root);
      const r = main([...NEW, '--layout', ...v], { root, now: NOW });
      assert.equal(r.code, 3);
      assert.deepEqual(r.lines, ['refused: usage']);
      assert.deepEqual(top(root), []);
      assert.ok(fs.existsSync(path.join(root, '.company', 'work-folder-topic-idea.txt')), 'topic file not consumed');
    });
    test(`new --project --layout ${JSON.stringify(v[0] ?? '<none>')}`, () => {
      const root = project();
      const r = main(['new', '--playbook', 'fix', '--project', ID, '--layout', ...v], { root, now: NOW });
      assert.equal(r.code, 3);
      assert.deepEqual(r.lines, ['refused: usage']);
      assert.deepEqual(top(root), []);
    });
  }

  test('--layout twice, or before the other flags, is refused too', () => {
    const root = project();
    for (const argv of [
      [...NEW, '--layout', 'v3', '--layout', 'v3'],
      ['new', '--layout', 'v3', '--playbook', 'idea', '--topic', 'none'],
    ]) {
      const r = main(argv, { root, now: NOW });
      assert.equal(r.code, 3, argv.join(' '));
      assert.deepEqual(r.lines, ['refused: usage']);
    }
    assert.deepEqual(top(root), []);
  });

  test('CLI process: non-zero exit, no folder', () => {
    for (const v of ['v2', 'v3']) {
      const root = project();
      const res = spawnSync(process.execPath, [SCRIPT, 'new', '--playbook', 'idea', '--topic', 'none', '--layout', v], { cwd: root, encoding: 'utf8' });
      assert.notEqual(res.status, 0);
      assert.match(res.stdout, /refused: usage/);
      assert.deepEqual(top(root), []);
    }
  });
});
