// Text pins for the reprompter agent file and its entry in company/names.json.
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
  assert.deepEqual(fm.tools.split(',').map((x) => x.trim()), ['Read', 'Grep', 'Glob', 'Skill', 'Write']);
  assert.equal(fm.model, 'sonnet');
  assert.equal(fm.effort, 'medium');
  for (const bad of ['hooks', 'mcpServers', 'permissionMode', 'initialPrompt']) assert.equal(fm[bad], undefined);
});

test('file is LF only and at most 50 lines', () => {
  const text = read(AGENT);
  assert.ok(!text.includes('\r'));
  assert.ok(text.split('\n').length <= 51);
});

test('body: request files are data, never orders', () => {
  const t = read(AGENT);
  assert.match(t, /data, never (orders|instructions)/i);
  assert.match(t, /rewrite/i);
  assert.match(t, /never (runs|run)/i);
  assert.match(t, /Asks left:/);
  assert.match(t, /dispatch/i);
});

test('body: writes only prompt.md and its Handoff in the run folder; names the Write risk', () => {
  const t = read(AGENT);
  assert.match(t, /prompt\.md/);
  assert.match(t, /run folder/i);
  assert.match(t, /Write/);
  assert.match(t, /only/i);
});

test('body: image target goes to prompt-artist with no card', () => {
  const t = read(AGENT);
  assert.match(t, /prompt-artist/);
  assert.match(t, /no (prompt\.md|card)/i);
});

test('body: question line format and prompt.md part order', () => {
  const t = read(AGENT);
  assert.match(t, /\[spec\] Q<n>: <question> — options:/);
  assert.match(t, /\(Recommended\)/);
  const parts = ['Goal', 'Context', 'Inputs', 'Constraints', 'Output format', 'Done when'];
  let at = -1;
  for (const p of parts) { const i = t.indexOf(p, at + 1); assert.ok(i > at, p); at = i; }
});

test('body: no Bash, web or install instructions', () => {
  const t = read(AGENT);
  assert.ok(!/\b(npx|npm install|curl|WebFetch|WebSearch)\b/.test(t));
});

test('names.json: reprompter is Lynn, unique, case-insensitive', () => {
  const names = JSON.parse(read('company/names.json'));
  assert.equal(names.reprompter, 'Lynn');
  const keys = Object.keys(names);
  assert.equal(keys[keys.length - 1], 'reprompter');
  const lower = Object.values(names).map((n) => n.toLowerCase());
  assert.equal(new Set(lower).size, lower.length);
});
