// Pins draft-input v1.3 in the Contract and in both guides that name its inputs and refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const CONTRACT = 'docs/contracts/draft-input.md';
const TO_SPEC = 'skills/to-spec/SKILL.md';
const ROUTES = 'skills/idea/references/routes.md';

const SHARED = [
  '.company/work/<name>/prompt.md',
  '16 KiB',
  'argument too large',
  'argument has a line break or control character',
];

test('contract and both guides name the same inputs and refusals', () => {
  for (const rel of [CONTRACT, TO_SPEC, ROUTES]) {
    const text = read(rel);
    for (const s of SHARED) assert.ok(text.includes(s), `${rel} names ${s}`);
  }
});

test('the contract is v1.3 with a history line', () => {
  const text = read(CONTRACT);
  assert.equal(text.split('\n')[0], '# Contract: draft-input v1.3');
  const compat = text.slice(text.indexOf('## Compatibility'));
  const lines = compat.split('\n');
  assert.ok(lines.some((l) => l.startsWith('v1.3 (minor')), 'a v1.3 (minor line');
  assert.ok(lines.some((l) => l.startsWith('v1.2 (minor')), 'the v1.2 line stays');
  assert.ok(lines.some((l) => l.startsWith('v1.1 (minor')), 'the v1.1 line stays');
  assert.ok(text.includes('### take --for to-spec of a prompt file (v1.3)'), 'the take section');
  assert.ok(text.includes('argument is not accepted'), 'command-line arguments keep the old refusal');
});

test('to-spec cites draft-input v1.3', () => {
  const text = read(TO_SPEC);
  assert.match(text, /draft-input` v1\.3/);
  assert.doesNotMatch(text, /draft-input` v1\.2/);
  assert.ok(text.split('\n').length <= 125, 'to-spec SKILL.md stays at most 125 lines');
});

test('the idea route hands to-spec the prompt path, never the body', () => {
  const line = read(ROUTES).split('\n').find((l) => l.startsWith('- To-spec:'));
  assert.ok(line, 'a To-spec line');
  assert.ok(line.includes('.company/work/<reprompt slug>/prompt.md'), 'names the prompt path');
  assert.ok(line.includes('argument file'), 'the path goes to the argument file');
  assert.ok(line.includes('never the body'), 'never the body');
  assert.doesNotMatch(line, /the prompt as the idea text/);
});

test('the three files use LF line ends only', () => {
  for (const rel of [CONTRACT, TO_SPEC, ROUTES]) assert.ok(!read(rel).includes('\r'), `${rel} has no CR`);
});

test('the changelog lists the fix under Unreleased, Fixed', () => {
  const log = read('CHANGELOG.md');
  const start = log.indexOf('## [Unreleased]');
  assert.ok(start !== -1, 'an Unreleased section');
  const next = log.indexOf('\n## [', start + 1);
  const unreleased = log.slice(start, next === -1 ? undefined : next);
  const at = unreleased.indexOf('\n### Fixed');
  assert.ok(at !== -1, 'a Fixed heading under Unreleased');
  const after = unreleased.slice(at + 1);
  const end = after.indexOf('\n### ', 1);
  const fixed = after.slice(0, end === -1 ? undefined : end);
  assert.match(fixed, /draft-input` v1\.3/);
  assert.match(fixed, /prompt file/);
});
