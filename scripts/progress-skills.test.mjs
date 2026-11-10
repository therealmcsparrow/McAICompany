import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  { rel: 'skills/tdd/SKILL.md', max: 125 },
  { rel: 'skills/review/SKILL.md', max: 125 },
  { rel: 'skills/verify/SKILL.md', max: 125 },
  { rel: 'agents/qa.md', max: 50 },
];

// Key phrases, matched case-insensitively so wording can move.
const STREAM = /stream(s|ing)?\b[^.\n]*\b(reporter|output|progress|long)|\b(reporter|output|progress)\b[^.\n]*\bstream/i;
const NEVER_SILENCE = /never\b[^.\n]*\b(silenc\w*|buffer\w*|quiet\w*|mut\w*)|\b(silenc\w*|fully buffer\w*)\b[^.\n]*\b(never|not|no)\b|do not (silence|fully buffer)|don't (silence|fully buffer)/i;
const NAME_IN_DID = /\b(name|say|state|note|record)\b[^.\n]*\b(where|place|location)\b[^.\n]*\b(output|log)\b|\b(output|log)\b[^.\n]*\b(went|goes|saved|written|location|place)\b/i;

for (const { rel, max } of FILES) {
  const text = readFileSync(join(ROOT, rel), 'utf8');

  test(`AC8 ${rel} says to use a streaming reporter for long runs`, () => {
    assert.match(text, STREAM);
  });

  test(`AC8 ${rel} says never silence or fully buffer a long run`, () => {
    assert.match(text, NEVER_SILENCE);
    assert.match(text, /long/i);
  });

  test(`AC8 ${rel} says to name the output place in ## Did`, () => {
    assert.match(text, /## Did/);
    assert.match(text, NAME_IN_DID);
  });

  test(`proj.M5 ${rel} stays within ${max} lines`, () => {
    const lines = text.replace(/\n$/, '').split('\n').length;
    assert.ok(lines <= max, `${rel} has ${lines} lines, limit ${max}`);
  });

  test(`proj.M11 ${rel} is LF only`, () => {
    assert.ok(!text.includes('\r'));
  });
}
