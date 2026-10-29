import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const has = (text, ...needles) => {
  for (const n of needles) assert.ok(text.includes(n), `missing: ${n}`);
};

test('tdd skill: seams, vertical slices, red before green, outside-seam tests under Decisions', () => {
  const t = read('skills/tdd/SKILL.md');
  has(t, 'plan-tasks` v1.3', 'seams:', 'vertical slices', 'run it red', 'Never write all tests first', '## Decisions');
});

test('tdd skill: anti-tautology rule', () => {
  const t = read('skills/tdd/SKILL.md');
  has(t, 'No tautological tests', 'own setup', 'never mock the unit under test', 'mock was called');
});

test('review skill: tautological test is a Blocking [test] finding citing plan-tasks v1.3', () => {
  const t = read('skills/review/SKILL.md');
  has(t, 'asserts its own setup or mocks the unit under test', '`## Blocking` `[test]`', 'plan-tasks` v1.3');
});

test('both skills stay within 125 lines and are LF only', () => {
  for (const f of ['skills/tdd/SKILL.md', 'skills/review/SKILL.md']) {
    const t = read(f);
    assert.ok(!t.includes('\r'), `${f} has CR`);
    assert.ok(t.trimEnd().split('\n').length <= 125, `${f} over 125 lines`);
  }
});
