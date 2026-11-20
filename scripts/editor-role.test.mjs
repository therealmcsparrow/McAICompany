import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
// A claim line is cited with [S#] or marked (unverified); anything else is blocked with [spec].
function lintFindings(handoff) {
  const section = /^## Findings\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(handoff);
  const blocking = [];
  for (const line of (section ? section[1] : '').split('\n').filter((l) => l.startsWith('- '))) {
    if (!/\[S\d+\]/.test(line) && !/\(unverified\)/.test(line)) blocking.push(`[spec] uncited claim: ${line.slice(2)}`);
  }
  return blocking;
}

test('names.json has 37 entries (36 Roles and the Lead) and editor is named Edith', () => {
  const names = JSON.parse(read('company/names.json'));
  assert.equal(Object.keys(names).length, 37);
  assert.equal(names.editor, 'Edith');
  const lower = Object.values(names).map((n) => n.toLowerCase());
  assert.equal(new Set(lower).size, lower.length);
  const agents = readdirSync(join(root, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  assert.deepEqual(Object.keys(names).sort(), agents.sort());
});

test('fixture Handoff: an uncited claim is blocked with spec, cited and unverified pass', () => {
  const bad = '## Findings\n- Market grew 12% — [S1] — confidence high\n- Churn fell by half\n- Rivals copy us (unverified)\n\n## Sources\n- [S1] x\n';
  const found = lintFindings(bad);
  assert.equal(found.length, 1);
  assert.match(found[0], /^\[spec\] uncited claim: Churn fell by half$/);
  assert.deepEqual(lintFindings('## Findings\n- A claim — [S2] — confidence low\n'), []);
});
