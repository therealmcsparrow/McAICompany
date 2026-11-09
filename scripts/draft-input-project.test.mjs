// draft-input v1.5: a fresh grill, to-spec or to-tickets run becomes a project.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './draft-input.mjs';

const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-project-')));
  made.push(root);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}

function put(root, rel, body) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

const NOW = new Date(2026, 9, 31, 9, 15, 7);
const run = (root, ...args) => main(args, { root, now: NOW });
const idea = (root, f, topic) => {
  put(root, `.company/draft-input-arg-${f}.txt`, 'Build a login page for the shop');
  if (topic !== undefined) put(root, `.company/work-folder-topic-${f}.txt`, topic);
  return run(root, 'arg', '--for', f);
};
const summary = (root, name) => fs.readFileSync(path.join(root, '.company', 'work', name, '00-summary.md'), 'utf8');
const SLUG = /^P\d{8}\.\d{6}-09\.15\.07$/;
const MD = 'Login brief\n\nAC1: accept an email\nAC2: refuse a bad password\n';

describe('arg idea makes a project', () => {
  for (const f of ['grill', 'to-spec']) {
    test(`${f}: slug is a project name and the folder has its summary`, () => {
      const root = fixture();
      const r = idea(root, f, 'Login Page');
      assert.equal(r.code, 0);
      assert.equal(r.lines[0], 'arg: idea');
      const name = r.lines[1].replace(/^slug: /, '');
      assert.match(name, SLUG);
      assert.match(name, /^P\d{8}\.000001-/);
      const lines = summary(root, name).split('\n');
      assert.equal(lines[0], 'Login Page');
      assert.equal(lines[2], `Run: first ${f}`);
    });
  }

  test('no Topic file: the fallback description is used', () => {
    const root = fixture();
    const name = idea(root, 'to-spec').lines[1].replace(/^slug: /, '');
    assert.equal(summary(root, name).split('\n')[0], 'To-Spec');
    const g = idea(fixture(), 'grill');
    assert.match(g.lines[1], /^slug: P/);
  });

  test('a second fresh run on another second gets the next ID; the same second is refused or distinct', () => {
    const root = fixture();
    const a = idea(root, 'grill', 'First').lines[1].replace(/^slug: /, '');
    const b = idea(root, 'grill', 'Second').lines[1].replace(/^slug: /, '');
    assert.notEqual(a, b);
    assert.match(b, /^P\d{8}\.000002-/);
  });

  test('a Topic that fails the name check falls back to the --for description', () => {
    const root = fixture();
    const r = idea(root, 'grill', 'bad/topic');
    assert.equal(r.code, 0);
    const name = r.lines[1].replace(/^slug: /, '');
    assert.equal(summary(root, name).split('\n')[0], 'Grill');
  });

  test('never prints the old v1.1 stamp name', () => {
    const r = idea(fixture(), 'grill', 'Login Page');
    assert.doesNotMatch(r.lines[1], /2026-10-31/);
  });
});

describe('fresh take makes a project', () => {
  test('a file outside .company/work for to-tickets', () => {
    const root = fixture();
    put(root, 'notes/plan.md', MD);
    put(root, '.company/work-folder-topic-to-tickets.txt', 'Login Tickets');
    const r = run(root, 'take', 'notes/plan.md', '--for', 'to-tickets');
    assert.equal(r.code, 0, r.lines.join('\n'));
    const name = r.lines[0].replace(/^slug: /, '');
    assert.match(name, SLUG);
    assert.equal(r.lines[1], `input: .company/work/${name}/input-to-tickets.md`);
    assert.ok(fs.existsSync(path.join(root, '.company', 'work', name, 'input-to-tickets.md')));
    const lines = summary(root, name).split('\n');
    assert.equal(lines[0], 'Login Tickets');
    assert.equal(lines[2], 'Run: first to-tickets');
  });

  test('without a Topic file the fallback description is used', () => {
    const root = fixture();
    put(root, 'notes/plan.md', MD);
    const r = run(root, 'take', 'notes/plan.md', '--for', 'to-tickets');
    assert.equal(r.code, 0, r.lines.join('\n'));
    const name = r.lines[0].replace(/^slug: /, '');
    assert.equal(summary(root, name).split('\n')[0], 'To-Tickets');
  });

  test('two fresh takes get consecutive IDs', () => {
    const root = fixture();
    put(root, 'notes/plan.md', MD);
    const a = run(root, 'take', 'notes/plan.md', '--for', 'to-tickets').lines[0];
    const b = run(root, 'take', 'notes/plan.md', '--for', 'to-tickets').lines[0];
    assert.match(a, /^slug: P\d{8}\.000001-/);
    assert.match(b, /^slug: P\d{8}\.000002-/);
  });
});
