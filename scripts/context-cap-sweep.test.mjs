// Behaviour of the configurable context cap readers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// The numbers 180000 and 162000 now live only in hooks/rules/cap.mjs
// (scripts/cap-literals.test.mjs scans for them). This sweep pins that the old readers keep their export names.
test('the cap readers hold no default of their own: lead-handover re-exports CAP and HANDOVER_AT, the formula lives in the cap rule module', async () => {
  const lead = read('scripts/lead-handover.mjs');
  assert.match(lead, /\bCAP\b/);
  assert.match(lead, /\bHANDOVER_AT\b/);
  assert.doesNotMatch(lead, /export const CAP = 180000;|export const HANDOVER_AT = 162000;/);
  assert.ok(fs.existsSync(path.join(root, 'hooks/rules/cap.mjs')), 'the cap constants and formulas live in hooks/rules/cap.mjs');
  assert.ok(fs.existsSync(path.join(root, 'scripts/run-cap.mjs')), 'runCap lives in scripts/run-cap.mjs');
  const m = await import('./lead-handover.mjs');
  assert.equal(m.CAP, 180000);
  assert.equal(m.HANDOVER_AT, 162000);
});

test('shipped docs and skills touched by the cap are LF only', () => {
  for (const f of ['CHANGELOG.md', 'README.md', 'GLOSSARY.md', 'skills/pipeline/SKILL.md', 'skills/handoff/SKILL.md', 'documentation/start/setup.md', 'documentation/commands/settings.md']) {
    assert.ok(!read(f).includes('\r'), `${f} has CRLF`);
  }
});
