import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pins the one fixed context cap in the shipped pipeline, handoff and dispatch-prompt text.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};
const hasNot = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? !n.test(text) : !text.includes(n), `still present: ${n}`);
};
const LINE = 'Context cap: 95000 handover 85500';
const pipeline = read('skills/pipeline/SKILL.md');
const handoff = read('skills/handoff/SKILL.md');
const contract = read('docs/contracts/dispatch-prompt.md');
const parallel = read('skills/pipeline/references/parallel.md');

// No script reads the line: the Role reads it from the prose rule, so the test pins that rule text only.
test('the contract rule for malformed cap lines gives the same values plus the Nit', () => {
  has(contract, 'not two integers', '`<n>` > `<cap>`', 'cap 95000, handover at 85500, and a Nit `invalid Context cap`', 'at most 35 characters');
  has(handoff, 'Absent → cap 95000, handover at 85500', 'Malformed → the same, plus a Nit `invalid Context cap`');
});

test('absent cap line reads the same values', () => {
  has(contract, '→ cap 95000, handover at 85500.');
  hasNot(contract, /cap 150000, handover at 120000/);
  hasNot(handoff, /150000|120000/);
});

test('every tier gets 95000 85500: Setup item 8 has no settings read and no high-tier raise', () => {
  const item8 = pipeline.split('\n').find((l) => l.startsWith('8. **Context cap'));
  assert.ok(item8, 'Setup item 8 exists');
  has(item8, LINE, 'every Role and Risk tier');
  hasNot(item8, 'context_cap', 'max(', '150000', '120000', /floor\(/);
  hasNot(pipeline, 'roles.<role>.context_cap');
});

test('the contract states the fixed line for every Role and tier at v4.4', () => {
  has(contract, '# Contract: dispatch-prompt v5.2', 'v4.4 is additive');
  has(contract, LINE, 'every Role', 'every Risk tier');
  hasNot(contract, /max\(that value, 150000\)/);
});

test('Role hand-over opens no CEO form and never resumes the old Step', () => {
  const line = pipeline.split('\n').find((l) => l.startsWith('- `status: handover`'));
  assert.ok(line);
  has(line, 'no CEO form', 'old Step is never resumed', '**fresh** Step');
  has(contract, 'no CEO form', 'never resumed');
});

test('parallel plan handover is 85500', () => {
  has(parallel, '`<h>` = `85500`');
  hasNot(parallel, 'floor(context_cap');
});

test('dispatch examples carry the fixed line and no Name: line', () => {
  for (const p of ['tests/regression/dispatch-ok.md', 'tests/regression/dispatch-no-language.md', 'tests/contracts/dispatch-prompt/step.txt']) {
    const t = read(p);
    has(t, LINE);
    hasNot(t, '150000', '120000', /^Name:/m);
  }
});

test('shipped files are LF only and the ADR exists', () => {
  for (const p of ['skills/pipeline/SKILL.md', 'skills/pipeline/references/parallel.md', 'skills/handoff/SKILL.md', 'docs/contracts/dispatch-prompt.md', 'docs/adr/0047-one-context-cap.md', 'scripts/context-cap.test.mjs']) {
    assert.ok(!read(p).includes('\r'), `CR in ${p}`);
  }
  has(read('docs/adr/0047-one-context-cap.md'), '# ', '95000', '85500');
  assert.ok(pipeline.split('\n').length <= 125 && handoff.split('\n').length <= 125);
});
