import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listRoadmap, main } from './roadmap.mjs';

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const base = () => path.join(root, '.company', 'roadmap');
function put(lane, name, content) {
  const dir = lane === 'roadmap' ? base() : path.join(base(), lane === 'not-now' ? 'Not now' : 'to-check');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}
const fm = t => `---\ntopic: ${t}\nstarted: 2026-11-04 02.10\nstatus: roadmap\n---\nbody\n`;
const canLink = (() => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  try { fs.writeFileSync(path.join(d, 'a'), ''); fs.symlinkSync(path.join(d, 'a'), path.join(d, 'b')); return true; }
  catch { return false; } finally { fs.rmSync(d, { recursive: true, force: true }); }
})();

describe('listRoadmap', () => {
  test('missing folder gives empty items', () => {
    assert.deepEqual(listRoadmap(root), { v: 1, items: [], warnings: [] });
  });

  test('three lanes in order, then file name, fixed keys', () => {
    put('to-check', 'c.md', fm('C'));
    put('not-now', 'b.md', fm('B'));
    put('roadmap', 'z.md', fm('Z'));
    put('roadmap', 'a.md', fm('A'));
    fs.writeFileSync(path.join(base(), 'note.txt'), 'x');
    const r = listRoadmap(root);
    assert.deepEqual(r.items.map(i => [i.lane, i.file, i.topic]), [
      ['roadmap', 'a.md', 'A'], ['roadmap', 'z.md', 'Z'], ['not-now', 'b.md', 'B'], ['to-check', 'c.md', 'C']]);
    assert.deepEqual(Object.keys(r.items[0]), ['file', 'topic', 'started', 'status', 'lane']);
    assert.equal(r.items[0].started, '2026-11-04 02.10');
    assert.equal(r.items[0].status, 'roadmap');
    assert.deepEqual(r.warnings, []);
  });

  test('keeps only topic, started, status; missing key is null', () => {
    put('roadmap', 'a.md', '---\ntopic: T\nroles: qa\n---\n');
    assert.deepEqual(listRoadmap(root).items[0], { file: 'a.md', topic: 'T', started: null, status: null, lane: 'roadmap' });
  });

  test('strips control and format chars and cuts to 200', () => {
    put('roadmap', 'a.md', `---\ntopic: A\u0007B‮C D${'x'.repeat(300)}\n---\n`);
    const t = listRoadmap(root).items[0].topic;
    assert.equal(t.length, 200);
    assert.ok(t.startsWith('ABCDxxx'));
  });

  test('handles CRLF frontmatter', () => {
    put('roadmap', 'a.md', '---\r\ntopic: T\r\n---\r\n');
    assert.equal(listRoadmap(root).items[0].topic, 'T');
  });

  test('no frontmatter, unclosed block, invalid UTF-8 are skipped with place number', () => {
    put('roadmap', 'a.md', 'no front\n');
    put('roadmap', 'b.md', fm('B'));
    put('roadmap', 'c.md', `---\ntopic: ${'x'.repeat(5000)}\n---\n`);
    fs.writeFileSync(path.join(base(), 'd.md'), Buffer.concat([Buffer.from('---\ntopic: '), Buffer.from([0xff, 0xfe]), Buffer.from('\n---\n')]));
    const r = listRoadmap(root);
    assert.deepEqual(r.items.map(i => i.file), ['b.md']);
    assert.deepEqual(r.warnings, ['roadmap file 1 skipped', 'roadmap file 3 skipped', 'roadmap file 4 skipped']);
  });

  test('bytes after the closing line are never decoded', () => {
    fs.mkdirSync(base(), { recursive: true });
    fs.writeFileSync(path.join(base(), 'a.md'), Buffer.concat([Buffer.from('---\ntopic: T\n---\n'), Buffer.from([0xff, 0xff])]));
    assert.equal(listRoadmap(root).items[0].topic, 'T');
  });

  test('a multibyte char cut at 4 KiB does not break a closed block', () => {
    put('roadmap', 'a.md', '---\ntopic: T\n---\n' + 'é'.repeat(3000));
    assert.equal(listRoadmap(root).items[0].topic, 'T');
  });

  test('big file is read only to 4 KiB', () => {
    put('roadmap', 'a.md', fm('T') + 'y'.repeat(5 * 1024 * 1024));
    assert.equal(listRoadmap(root).items[0].topic, 'T');
  });

  test('non-md names and folders are skipped silently', () => {
    put('roadmap', 'a.txt', fm('A'));
    fs.mkdirSync(path.join(base(), 'dir.md'));
    assert.deepEqual(listRoadmap(root), { v: 1, items: [], warnings: [] });
  });

  test('at most 200 files, rest left out with a warning', () => {
    for (let i = 0; i < 205; i++) put('roadmap', `f${String(i).padStart(3, '0')}.md`, fm(`T${i}`));
    const r = listRoadmap(root);
    assert.equal(r.items.length, 200);
    assert.equal(r.items[199].file, 'f199.md');
    assert.deepEqual(r.warnings, ['over 200 items']);
  });

  test('links are skipped', { skip: !canLink }, () => {
    put('roadmap', 'real.md', fm('R'));
    const outside = path.join(root, 'outside.md');
    fs.writeFileSync(outside, fm('X'));
    fs.symlinkSync(outside, path.join(base(), 'link.md'));
    const other = path.join(root, 'otherdir');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'q.md'), fm('Q'));
    fs.symlinkSync(other, path.join(base(), 'to-check'), 'junction');
    assert.deepEqual(listRoadmap(root).items.map(i => i.file), ['real.md']);
  });

  test('a linked roadmap folder gives empty items', { skip: !canLink }, () => {
    const other = path.join(root, 'elsewhere');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'a.md'), fm('A'));
    fs.mkdirSync(path.join(root, '.company'));
    fs.symlinkSync(other, base(), 'junction');
    assert.deepEqual(listRoadmap(root).items, []);
  });
});

describe('main', () => {
  test('list --json prints the object, exit 0', () => {
    put('roadmap', 'a.md', fm('A'));
    let out = '';
    assert.equal(main(['list', '--json'], { root, out: s => { out += s; } }), 0);
    assert.deepEqual(JSON.parse(out), listRoadmap(root));
    assert.ok(out.endsWith('\n'));
  });

  test('bad usage prints usage and exits 2', () => {
    let out = '';
    assert.equal(main(['nope'], { root, out: s => { out += s; } }), 2);
    assert.match(out, /usage: roadmap list --json/);
  });

  test('runs as a script', () => {
    put('roadmap', 'a.md', fm('A'));
    const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'roadmap.mjs'), 'list', '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).items[0].topic, 'A');
  });
});
