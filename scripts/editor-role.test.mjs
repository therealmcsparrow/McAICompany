import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const frontmatter = (text) => {
  const lines = text.split('\n');
  return Object.fromEntries(lines.slice(1, lines.indexOf('---', 1))
    .map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
};

// A claim line is cited with [S#] or marked (unverified); anything else is blocked with [spec].
function lintFindings(handoff) {
  const section = /^## Findings\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(handoff);
  const blocking = [];
  for (const line of (section ? section[1] : '').split('\n').filter((l) => l.startsWith('- '))) {
    if (!/\[S\d+\]/.test(line) && !/\(unverified\)/.test(line)) blocking.push(`[spec] uncited claim: ${line.slice(2)}`);
  }
  return blocking;
}

test('names.json has 36 entries and editor is named Edith', () => {
  const names = JSON.parse(read('company/names.json'));
  assert.equal(Object.keys(names).length, 36);
  assert.equal(names.editor, 'Edith');
  const lower = Object.values(names).map((n) => n.toLowerCase());
  assert.equal(new Set(lower).size, lower.length);
  const agents = readdirSync(join(root, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  assert.deepEqual(Object.keys(names).sort(), agents.sort());
});

test('editor agent: frontmatter, tools Read Grep Glob Write only, at most 50 lines', () => {
  const text = read('agents/editor.md');
  const fm = frontmatter(text);
  assert.equal(fm.name, 'editor');
  assert.ok(fm.description.length > 0);
  assert.ok(['sonnet', 'opus', 'haiku', 'inherit'].includes(fm.model));
  assert.ok(fm.effort);
  assert.deepEqual(fm.tools.split(',').map((t) => t.trim()), ['Read', 'Grep', 'Glob', 'Write']);
  assert.ok(text.split('\n').length <= 51);
  assert.ok(!text.includes('\r'));
});

test('editor agent blocks an uncited claim with spec and never rewrites it', () => {
  const text = read('agents/editor.md');
  assert.match(text, /\[spec\]/);
  assert.match(text, /\[S#\]|\[S\d\]/);
  assert.match(text, /\(unverified\)/);
  assert.match(text, /Never[^\n]*rewrit/i);
  assert.match(text, /aico:handoff/);
});

test('fixture Handoff: an uncited claim is blocked with spec, cited and unverified pass', () => {
  const bad = '## Findings\n- Market grew 12% — [S1] — confidence high\n- Churn fell by half\n- Rivals copy us (unverified)\n\n## Sources\n- [S1] x\n';
  const found = lintFindings(bad);
  assert.equal(found.length, 1);
  assert.match(found[0], /^\[spec\] uncited claim: Churn fell by half$/);
  assert.deepEqual(lintFindings('## Findings\n- A claim — [S2] — confidence low\n'), []);
});

test('lead routes to the editor', () => {
  assert.match(read('skills/lead/SKILL.md'), /\| [^|]*\| `aico:editor` \|/);
});
