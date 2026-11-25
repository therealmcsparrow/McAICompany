// CEO-only skills (disable-model-invocation: true) never trigger from their
// description, so the description is what the CEO reads in the / menu. Each one
// must say when to use it (PR #97).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const USE_RE = /\bUse (when|for|after)\b/;

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

const ceoOnly = readdirSync(SKILLS, { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(join(SKILLS, d.name, 'SKILL.md')))
  .map(d => ({ name: d.name, fm: frontmatter(readFileSync(join(SKILLS, d.name, 'SKILL.md'), 'utf8')) }))
  .filter(s => /^disable-model-invocation:\s*true\s*$/m.test(s.fm));

test('CEO-only skills exist', () => {
  assert.ok(ceoOnly.length >= 10, `found only ${ceoOnly.length} CEO-only skills`);
});

test('every CEO-only skill description says when to use it', () => {
  const missing = ceoOnly
    .filter(s => !USE_RE.test((s.fm.match(/^description:\s*(.*)$/m) || [])[1] || ''))
    .map(s => s.name);
  assert.deepEqual(missing, [], `descriptions without "Use when/for/after": ${missing.join(', ')}`);
});
