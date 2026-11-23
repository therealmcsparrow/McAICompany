import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const fixtures = path.join(root, 'tests', 'fixtures', 'review-plan-guard');

const REMOVED_WORD = ['bla', 'st'].join('');
const REMOVED_RE = new RegExp(REMOVED_WORD, 'i');

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('AC10: both fixtures exist and are LF only', () => {
  for (const f of ['plan.md', 'change.diff']) {
    const p = path.join(fixtures, f);
    assert.ok(fs.existsSync(p), f);
    assert.ok(!fs.readFileSync(p, 'utf8').includes('\r'), `${f} has CR`);
  }
});

test('AC10: the diff fixture is a unified diff touching exactly three files', () => {
  const diff = fs.readFileSync(path.join(fixtures, 'change.diff'), 'utf8');
  const headers = [...diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)];
  assert.deepEqual(headers.map(m => m[2]).sort(), [
    '.github/workflows/release.yml', 'docs/contracts/example.md', 'docs/contracts/other.md'
  ]);
  for (const m of headers) assert.equal(m[1], m[2]);
  assert.equal(count(diff, '\n--- a/'), 3);
  assert.equal(count(diff, '\n+++ b/'), 3);
  assert.equal(count(diff, '\n@@ '), 3);
});

test('AC10: the fixture plan names docs/contracts/example.md only in a task files line', () => {
  const plan = fs.readFileSync(path.join(fixtures, 'plan.md'), 'utf8');
  const lines = plan.split('\n').filter(l => /^- files:/.test(l));
  assert.equal(lines.length, 1);
  const files = lines[0].replace(/^- files:\s*/, '').split(',').map(s => s.trim());
  assert.deepEqual(files, ['docs/contracts/example.md']);
});

test('AC10: the fixtures state neither a planned change nor a verdict', () => {
  for (const f of ['plan.md', 'change.diff']) {
    const text = fs.readFileSync(path.join(fixtures, f), 'utf8');
    assert.doesNotMatch(text, /planned|unplanned|blocking|verdict|expect|nit/i, f);
    assert.doesNotMatch(text, REMOVED_RE, f);
  }
  const plan = fs.readFileSync(path.join(fixtures, 'plan.md'), 'utf8');
  assert.ok(!plan.includes('other.md') && !plan.includes('release.yml'));
});
