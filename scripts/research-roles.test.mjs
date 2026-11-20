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

const ROLES = { 'market-researcher': 'sonnet', 'tech-researcher': 'opus', 'design-researcher': 'sonnet' };
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
}

test('sourcing: frontmatter name matches folder', () => {
  assert.equal(frontmatter(read('skills/sourcing/SKILL.md')).name, 'sourcing');
});
