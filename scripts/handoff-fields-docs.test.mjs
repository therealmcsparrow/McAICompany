import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('handoff SKILL template has no comment lines and the rules name the four optional fields', () => {
  const s = read('skills/handoff/SKILL.md');
  const start = s.indexOf('```markdown');
  const end = s.indexOf('```', start + 5);
  const fm = s.slice(start, end).replace(/\r/g, '').split('\n---\n')[1];
  assert.ok(fm, 'template frontmatter');
  for (const l of fm.split('\n')) assert.ok(!l.startsWith('#'), `comment line in template frontmatter: ${l}`);
  const rules = s.slice(end);
  for (const k of ['tests:', 'closes:', 'open:', 'next-step:']) assert.ok(rules.includes(k), k);
  assert.match(rules, /optional/i);
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
    // Match within the line that states the order, so an earlier `route next` mention cannot satisfy it.
    const line = s.split('\n').find(l => l.includes('next-step:') && l.includes('## Next'));
    assert.ok(line, 'a line naming next-step: and ## Next');
    assert.match(line, /route next[\s\S]*?next-step:[\s\S]*?## Next/);
  });
}

test('dispatch.md names the next-step mismatch warning and the route rule', () => {
  const s = read('skills/pipeline/references/dispatch.md');
  const line = s.split('\n').find(l => l.includes('warning: next-step and ## Next name different Roles'));
  assert.ok(line, 'mismatch warning bullet');
  assert.match(line, /route by `next-step:`/);
});

test('rule-check contract keeps the base regex backslashes', () => {
  const s = read('docs/contracts/rule-check.md');
  assert.ok(s.includes(String.raw`(^|[\s,;|])base(?=$|[\s,;|])`));
});

test('handoff SKILL template, filled minimally, passes the lint', async () => {
  const { lint } = await import('./handoff-lint.mjs');
  const s = read('skills/handoff/SKILL.md');
  const start = s.indexOf('```markdown') + '```markdown\n'.length;
  const tpl = s.slice(start, s.indexOf('```', start)).replace(/\r/g, '');
  const text = tpl
    .replace('status: done | blocked | needs-ceo | handover', 'status: done')
    .replace('task: <task-slug>', 'task: a1')
    .replace('base-commit: <full object id>', 'base-commit: 079d7863b895c7359738a05977681fdbc33b4997')
    .replace('By: <role id>', 'By: backend-engineer')
    .replace('contracts: [handoff]', 'contracts: [handoff v3.1]')
    .replace('- [contract|spec|security|test] <file:line> — problem — fix.', '- none');
  const r = lint(text, {});
  assert.deepEqual(r.errors ?? [], [], JSON.stringify(r.errors));
});
