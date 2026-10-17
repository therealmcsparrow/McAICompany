import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from './check.mjs';

function fixture({ skills = {}, agents = {} }) {
  const root = mkdtempSync(join(tmpdir(), 'aico-'));
  for (const [dir, text] of Object.entries(skills)) {
    mkdirSync(join(root, 'skills', dir), { recursive: true });
    writeFileSync(join(root, 'skills', dir, 'SKILL.md'), text);
  }
  mkdirSync(join(root, 'agents'), { recursive: true });
  for (const [name, text] of Object.entries(agents)) writeFileSync(join(root, 'agents', `${name}.md`), text);
  return root;
}
const skill = (name, body = 'Body.', desc = 'Use when testing.') => `---\nname: ${name}\ndescription: ${desc}\n---\n${body}\n`;
const agent = (name, body = 'Body.', model = 'sonnet') => `---\nname: ${name}\ndescription: Dispatch when testing.\ntools: Read\nmodel: ${model}\n---\n${body}\n`;

test('good fixture has no errors', () => {
  const r = check(fixture({ skills: { a: skill('a', 'See aico:b and aico:qa.') , b: skill('b') }, agents: { qa: agent('qa') } }));
  assert.deepEqual(r.errors, []);
});

test('name must match folder', () => {
  const r = check(fixture({ skills: { x: skill('y') } }));
  assert.ok(r.errors.some(e => e.includes('name mismatch')));
});

test('description over 1024 chars is an error', () => {
  const r = check(fixture({ skills: { a: skill('a', 'Body.', 'x'.repeat(1025)) } }));
  assert.ok(r.errors.some(e => e.includes('description too long')));
});

test('missing description is an error', () => {
  const r = check(fixture({ skills: { a: '---\nname: a\n---\nBody\n' } }));
  assert.ok(r.errors.some(e => e.includes('missing description')));
});

test('unknown aico reference is an error', () => {
  const r = check(fixture({ skills: { a: skill('a', 'Load aico:missing now.') } }));
  assert.ok(r.errors.some(e => e.includes('unknown reference aico:missing')));
});

test('oversized agent and skill are warnings, not errors', () => {
  const long = n => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
  const r = check(fixture({ skills: { a: skill('a', long(122)) }, agents: { qa: agent('qa', long(45)) } }));
  assert.ok(r.warnings.some(w => w.includes('agent 51 > 50 lines')), r.warnings.join('\n'));
  assert.ok(r.warnings.some(w => w.includes('skill 126 > 125 lines')), r.warnings.join('\n'));
  assert.deepEqual(r.errors, []);
});

test('invalid model is an error', () => {
  const r = check(fixture({ agents: { qa: agent('qa', 'Body.', 'gpt4') } }));
  assert.ok(r.errors.some(e => e.includes('invalid model')));
});

test('skill and agent with the same name is an error', () => {
  const r = check(fixture({ skills: { support: skill('support') }, agents: { support: agent('support') } }));
  assert.ok(r.errors.some(e => e.includes('name clash support')));
});
