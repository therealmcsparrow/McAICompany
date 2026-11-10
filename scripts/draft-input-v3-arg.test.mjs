// draft-input `arg` with v3 run slugs (`<ProjectID>/<NN>-<playbook>`) and no project line.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './draft-input.mjs';
import { makeProjectV3 } from '../mods/lib/work-folder.mjs';

const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

const IO = { fs, path, platform: process.platform };
const NOW = new Date();

function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-v3-arg-')));
  made.push(root);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  const p = makeProjectV3(IO, root, NOW, 'Login page', 'to-spec');
  return { root, ID: p.id };
}

function put(root, rel, body) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

const exists = (root, rel) => fs.existsSync(path.join(root, ...rel.split('/')));
const tops = (root) => fs.readdirSync(path.join(root, '.company', 'work')).sort();

function arg(root, f, text, topic) {
  put(root, `.company/draft-input-arg-${f}.txt`, text);
  if (topic !== undefined) put(root, `.company/work-folder-topic-${f}.txt`, topic);
  return main(['arg', '--for', f], { root, now: NOW });
}

describe('arg with a v3 run slug and no project line', () => {
  test('grill: resume <ID>/<NN>-<playbook> resumes', () => {
    const { root, ID } = fixture();
    const r = arg(root, 'grill', `resume ${ID}/01-grill`, 'A Topic');
    assert.deepEqual(r, { code: 0, lines: [`arg: resume ${ID}/01-grill`] });
    assert.ok(!exists(root, '.company/work-folder-topic-grill.txt'), 'Topic file consumed');
  });

  test('grill: a v3 grill.md path resumes', () => {
    const { root, ID } = fixture();
    const r = arg(root, 'grill', `.company/work/${ID}/01-grill/grill.md`);
    assert.deepEqual(r, { code: 0, lines: [`arg: resume ${ID}/01-grill`] });
  });

  for (const [f, file] of [['to-spec', 'grill.md'], ['to-spec', 'spec.md'], ['to-tickets', 'plan.md'], ['feature', 'spec.md'], ['feature', 'plan.md']]) {
    test(`${f}: a v3 ${file} path is a file, the Topic file is consumed, nothing is made`, () => {
      const { root, ID } = fixture();
      const before = tops(root);
      const rel = `.company/work/${ID}/01-grill/${file}`;
      const r = arg(root, f, rel, 'A Topic');
      assert.deepEqual(r, { code: 0, lines: [`arg: file ${rel}`] });
      assert.ok(!exists(root, `.company/work-folder-topic-${f}.txt`), 'Topic file consumed');
      assert.deepEqual(tops(root), before);
    });
  }

  test('a backslash v3 path is printed with forward slashes', () => {
    const { root, ID } = fixture();
    const r = arg(root, 'to-tickets', `.company\\work\\${ID}\\02-to-spec\\spec.md`);
    assert.deepEqual(r, { code: 0, lines: [`arg: file .company/work/${ID}/02-to-spec/spec.md`] });
  });

  // Rule 2 for prompt.md leaves the Topic file alone; rule 3 would consume it, so this shows rule 2 took the slug.
  test('to-spec: a v3 prompt.md path is a file and the Topic file stays', () => {
    const { root, ID } = fixture();
    const rel = `.company/work/${ID}/01-to-spec/prompt.md`;
    const r = arg(root, 'to-spec', rel, 'A Topic');
    assert.deepEqual(r, { code: 0, lines: [`arg: file ${rel}`] });
    assert.ok(exists(root, '.company/work-folder-topic-to-spec.txt'), 'Topic file kept');
  });

  test('a v3 prompt.md path for another --for word does not take rule 2 (Topic consumed by the path rule)', () => {
    const { root, ID } = fixture();
    const rel = `.company/work/${ID}/01-to-spec/prompt.md`;
    const r = arg(root, 'feature', rel, 'A Topic');
    assert.deepEqual(r, { code: 0, lines: [`arg: file ${rel}`] });
    assert.ok(!exists(root, '.company/work-folder-topic-feature.txt'));
  });
});

describe('arg refuses to resume or accept a bad v3 slug', () => {
  test('resume <ID>/1-x does not resume; it is an idea', () => {
    const { root, ID } = fixture();
    const r = arg(root, 'grill', `resume ${ID}/1-x`, 'My Topic');
    assert.equal(r.code, 0);
    assert.equal(r.lines[0], 'arg: idea');
    assert.ok(r.lines.every((l) => !l.startsWith('arg: resume')));
  });

  test('a grill.md path three levels deep does not resume', () => {
    const { root, ID } = fixture();
    const r = arg(root, 'grill', `.company/work/${ID}/01-grill/x/grill.md`);
    assert.ok(!r.lines.some((l) => l.startsWith('arg: resume')), r.lines.join('|'));
  });

  for (const bad of ['01-%41', '01-grill%2e', '..', '01-..', '.']) {
    test(`resume <ID>/${bad} does not resume`, () => {
      const { root, ID } = fixture();
      const r = arg(root, 'grill', `resume ${ID}/${bad}`, 'My Topic');
      assert.ok(!r.lines.some((l) => l.startsWith('arg: resume')), r.lines.join('|'));
    });

    test(`a grill.md path with sub part ${bad} does not resume and is not accepted as a file`, () => {
      const { root, ID } = fixture();
      const r = arg(root, 'grill', `.company/work/${ID}/${bad}/grill.md`);
      assert.ok(!r.lines.some((l) => l.startsWith('arg: resume')), r.lines.join('|'));
      assert.equal(r.code, 3, r.lines.join('|'));
      assert.match(r.lines[0], /^refused: path /);
    });

    test(`to-tickets: a plan.md path with sub part ${bad} is refused`, () => {
      const { root, ID } = fixture();
      const r = arg(root, 'to-tickets', `.company/work/${ID}/${bad}/plan.md`);
      assert.equal(r.code, 3, r.lines.join('|'));
    });
  }

  test('a refused v3 path still removes the Topic file', () => {
    const { root, ID } = fixture();
    const r = arg(root, 'to-tickets', `.company/work/${ID}/01-%41/plan.md`, 'A Topic');
    assert.equal(r.code, 3);
    assert.ok(!exists(root, '.company/work-folder-topic-to-tickets.txt'));
  });
});
