import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('handoff SKILL template lists the four optional fields', () => {
  const s = read('skills/handoff/SKILL.md');
  const tpl = s.slice(s.indexOf('```markdown'), s.indexOf('```', s.indexOf('```markdown') + 5));
  for (const k of ['tests:', 'closes:', 'open:', 'next-step:']) assert.ok(tpl.includes(k), k);
  assert.match(tpl, /optional/i);
});

test('handoff SKILL has the targeted-cut rules', () => {
  const s = read('skills/handoff/SKILL.md');
  assert.match(s, /never repeats[^\n]*files-touched/);
  assert.ok(s.includes('committed by the Lead'));
});

for (const f of ['lead-resume', 'lead-handover', 'dispatch']) {
  test(`${f}.md states the route order`, () => {
    const s = read(`skills/pipeline/references/${f}.md`);
    assert.ok(s.includes('next-step:'));
    assert.match(s, /route next[\s\S]*?next-step:[\s\S]*?## Next/);
  });
}
