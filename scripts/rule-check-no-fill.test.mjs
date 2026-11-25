// rule-check v2.0: `fill-security` is removed. Security Musts stay in force from the committed
// packs (`slices` reads them there), so a Ruleset never carries copies of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { main } from './rule-check.mjs';

test('fill-security is refused with the usage text, and usage no longer names it', () => {
  const r = main(['fill-security', 'standards.md', '--packs', '.']);
  assert.equal(r.code, 2);
  assert.match(r.lines.join('\n'), /^refused: usage: rule-check\.mjs/);
  assert.doesNotMatch(r.lines.join('\n'), /fill-security/);
});

test('the ruleset skill no longer tells a Step to copy security rows', () => {
  const skill = fs.readFileSync(new URL('../skills/ruleset/SKILL.md', import.meta.url), 'utf8');
  assert.doesNotMatch(skill, /rule-check fill-security/);
  assert.match(skill, /never copy them into the Ruleset/);
});
