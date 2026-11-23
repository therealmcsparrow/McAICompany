// Frontmatter shape of the reprompter agent file and its entry in the names list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const AGENT = 'agents/reprompter.md';
const frontmatter = (text) => {
  const lines = text.split('\n');
  return Object.fromEntries(lines.slice(1, lines.indexOf('---', 1)).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
};

test('frontmatter: name, description, exact tools, model, effort', () => {
  const fm = frontmatter(read(AGENT));
  assert.equal(fm.name, 'reprompter');
  assert.ok(fm.description.length > 20);
  assert.deepEqual(fm.tools.split(',').map((x) => x.trim()), ['Read', 'Skill', 'Write']);
  assert.equal(fm.model, 'sonnet');
  assert.equal(fm.effort, 'medium');
  for (const bad of ['hooks', 'mcpServers', 'permissionMode', 'initialPrompt']) assert.equal(fm[bad], undefined);
});

test('names.json: reprompter is Lynn, unique, case-insensitive', () => {
  const names = JSON.parse(read('company/names.json'));
  assert.equal(names.reprompter, 'Lynn');
  const keys = Object.keys(names);
  assert.equal(keys[keys.length - 3], 'reprompter');
  const lower = Object.values(names).map((n) => n.toLowerCase());
  assert.equal(new Set(lower).size, lower.length);
});
