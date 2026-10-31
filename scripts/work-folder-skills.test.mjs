import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const FILES = [
  'skills/incident/SKILL.md',
  'skills/pentest/SKILL.md',
  'skills/usability-test/SKILL.md',
  'skills/usability/SKILL.md',
  'skills/maintain/SKILL.md',
  'skills/ruleset/SKILL.md',
  'skills/skillspector/SKILL.md',
  'skills/handoff/SKILL.md',
  'skills/lead/references/skill-picks.md',
  'skills/brainstorm/references/format-2.md',
  'skills/pipeline/references/ceo-pack.md',
  'skills/pipeline/references/parallel.md',
  'skills/pipeline/references/plan-check.md',
  'skills/pipeline/references/review-loop.md',
];
const PLACEHOLDERS = ['<slug>', '<name>', '<run>', '<task>', '<build>', '<parent>'];
const SCRIPT_NAMES = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
  .flatMap((f) => [f, f.slice(0, -4)]);
const FIRST_WORDS = new Set(['node', 'git', 'bash', ...SCRIPT_NAMES]);

function spans(text) {
  const out = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      out.push(line.trim());
      continue;
    }
    for (const m of line.matchAll(/`([^`]+)`/g)) out.push(m[1]);
  }
  return out;
}

export function unquoted(span) {
  const first = span.trim().split(/\s+/)[0];
  if (!FIRST_WORDS.has(first)) return [];
  const hits = [];
  let inQuote = false;
  for (let i = 0; i < span.length; i++) {
    if (span[i] === "'") inQuote = !inQuote;
    else if (!inQuote) {
      for (const p of PLACEHOLDERS) if (span.startsWith(p, i)) hits.push(p);
    }
  }
  return hits;
}

test('checker flags an unquoted placeholder on a shell line', () => {
  assert.deepEqual(unquoted('node x.mjs run <slug>'), ['<slug>']);
  assert.deepEqual(unquoted("node x.mjs run '<slug>'"), []);
  assert.deepEqual(unquoted("node x.mjs run '.company/work/<slug>/a.md'"), []);
  assert.deepEqual(unquoted('/aico:fix <slug>'), []);
});

for (const file of FILES) {
  test(`${file}: placeholders on shell lines are single-quoted`, () => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(!text.includes('\r'), 'LF only');
    if (file.endsWith('SKILL.md')) assert.ok(text.split('\n').length <= 126, 'at most 125 lines');
    const bad = spans(text).flatMap((s) => unquoted(s).map((p) => `${p} in: ${s.slice(0, 90)}`));
    assert.deepEqual(bad, []);
  });
}

test('skillspector scan line quotes the report slug', () => {
  const text = readFileSync(join(ROOT, 'skills/skillspector/SKILL.md'), 'utf8');
  assert.ok(text.includes("--report '<slug>'"));
});

test('review-loop gate line quotes the slug', () => {
  const text = readFileSync(join(ROOT, 'skills/pipeline/references/review-loop.md'), 'utf8');
  assert.ok(text.includes("run `gate '<slug>' --base"));
});
