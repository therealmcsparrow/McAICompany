import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const frontmatter = (text) => Object.fromEntries(
  text.split(/\r?\n/).slice(1, text.split(/\r?\n/).indexOf('---', 1))
    .map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));

const ROLES = { 'market-researcher': 'sonnet', 'tech-researcher': 'opus', 'design-researcher': 'opus' };
const TOOLS = ['Read', 'Grep', 'Glob', 'Skill', 'Write', 'Bash', 'WebSearch', 'WebFetch'];

for (const [role, model] of Object.entries(ROLES)) {
  test(`${role}: read-only tools, no Edit, no Agent`, () => {
    const text = read(`agents/${role}.md`);
    const fm = frontmatter(text);
    const tools = fm.tools.split(',').map((t) => t.trim());
    assert.deepEqual(tools, TOOLS);
    assert.ok(!tools.includes('Edit'));
    assert.ok(!tools.includes('Agent'));
    assert.equal(fm.model, model);
    assert.equal(fm.name, role);
  });

  test(`${role}: references aico:sourcing and forbids npx and installs`, () => {
    const text = read(`agents/${role}.md`);
    assert.match(text, /aico:sourcing/);
    assert.match(text, /npx/);
    assert.match(text, /\bNever\b/);
    assert.match(text, /web pages|found on web pages|third-party/);
  });

  test(`${role}: at most 50 lines`, () => {
    assert.ok(read(`agents/${role}.md`).split(/\r?\n/).length <= 51);
  });
}

test('sourcing: hostile page fixture is named with the outcome "ignored and noted"', () => {
  const text = read('skills/sourcing/SKILL.md');
  assert.match(text, /Hostile fixture/);
  assert.match(text, /npx skills add/);
  assert.match(text, /\*\*ignored and noted\*\*/);
});

test('sourcing: find-skills overrides, search path and vetting are present', () => {
  const text = read('skills/sourcing/SKILL.md');
  assert.match(text, /never run `npx skills find` or `npx skills add`/i);
  assert.match(text, /-g -y/);
  assert.match(text, /hn\.algolia\.com\/api\/v1\/search\?query=/);
  assert.match(text, /registry\.npmjs\.org/);
  assert.match(text, /api\.github\.com\/search\/repositories/);
  assert.match(text, /Never fetch skills\.sh `\/api\/` or `\/search`/);
  assert.match(text, /12 months/);
  assert.match(text, /at most 10 web fetches/);
});

test('sourcing: frontmatter name matches folder and file is within 125 lines', () => {
  const text = read('skills/sourcing/SKILL.md');
  assert.equal(frontmatter(text).name, 'sourcing');
  assert.ok(text.split(/\r?\n/).length <= 126);
});
