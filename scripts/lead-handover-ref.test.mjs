import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(import.meta.dirname, '..', 'skills', 'pipeline', 'references', 'lead-handover.md');
const text = readFileSync(file, 'utf8');

function section(heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n');
}

const unknownRule = /`base-commit: unknown`, `risk-tier: unknown`, `tier-path: unknown` or `tier-set: unknown` means run as high/;

test('unknown read-back rule sits under Every run after a hand-over', () => {
  const s = section('Every run after a hand-over');
  assert.match(s, unknownRule);
  assert.match(s, /never the (Lead Handoff )?frontmatter tier or a Role Handoff's/);
  assert.match(s, /Only known values/);
  assert.match(s, /Base commit:/);
});

test('Feature and fix section keeps no copy of the unknown rule', () => {
  const s = section('Feature and fix after a hand-over');
  assert.doesNotMatch(s, unknownRule);
  assert.doesNotMatch(s, /`Base commit:` for every later dispatch/);
  assert.match(s, /triage nonce/);
});

test('After a compaction quotes the single-quoted hook line', () => {
  const s = section('After a compaction');
  assert.ok(s.includes("`aico lead hand-over: run lead-handover read '<slug>' first`"));
  assert.ok(!s.includes('read <slug> first'));
});

test('file has no CR byte', () => {
  assert.ok(!text.includes('\r'));
});
