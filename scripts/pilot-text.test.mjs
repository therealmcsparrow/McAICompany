import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pins what the pilot agent and skill text must say and their size limits.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};
const FILES = {
  'agents/code-reviewer.md': 50, 'agents/senior-engineer.md': 50,
  'skills/review/SKILL.md': 125, 'skills/ruleset/SKILL.md': 125,
  'skills/standards/SKILL.md': 125, 'skills/feedback/SKILL.md': 125,
};

test('size limits and LF only (proj.M5, proj.M11)', () => {
  for (const [f, max] of Object.entries(FILES)) {
    const t = read(f);
    assert.ok(!t.includes('\r'), `${f} has CR`);
    assert.ok(t.trimEnd().split('\n').length <= max, `${f} over ${max} lines`);
  }
});

test('AC20 reviewers write rows and the aico-top block', () => {
  for (const f of ['agents/code-reviewer.md', 'agents/senior-engineer.md']) has(read(f), 'file:line | problem | why | fix', '--require-top');
  has(read('agents/code-reviewer.md'), '`why` never empty', 'R-<n>');
  has(read('agents/senior-engineer.md'), 'C-<n>');
  has(read('skills/review/SKILL.md'), 'R-<n> | file:line | problem | why | fix');
});

test('AC22 reviewers read rule-check list and confirm T- rows, tools never block alone', () => {
  for (const f of ['agents/code-reviewer.md', 'skills/review/SKILL.md', 'skills/ruleset/SKILL.md']) has(read(f), /rule-check\.mjs/, 'list');
  has(read('skills/review/SKILL.md'), 'Confirm each `T-` row', 'never blocks on its own', 'T-<n> | <file>[:<line>] | not confirmed | <why> | none');
  has(read('agents/code-reviewer.md'), 'T-<n> | <file>[:<line>] | not confirmed | <why> | none');
  has(read('agents/code-reviewer.md'), 'never blocks on its own');
});

test('AC23 slices carry every security Must and a findings ledger survives handover', () => {
  has(read('skills/ruleset/SKILL.md'), 'every security Must', /rule-check\.mjs"? slices/);
  has(read('agents/senior-engineer.md'), 'every security Must', /rule-check\.mjs"? slices/);
  has(read('agents/code-reviewer.md'), 'findings.md', 'continues the same file');
  has(read('skills/review/SKILL.md'), '## Checked', '## Findings', 'never deleted');
});

test('AC24 depth comes from review-depth and is never lowered', () => {
  has(read('agents/code-reviewer.md'), 'review-depth.mjs', 'never lower it');
  has(read('skills/review/SKILL.md'), 'Review depth:', 'not the builder\'s label', 'never lower it');
});

test('AC26 feedback reads ledger report for the last 3 runs, spend and cache read apart', () => {
  has(read('skills/feedback/SKILL.md'), 'ledger.mjs', 'report', 'last 3 runs', '**spend**', '**cache read**', 'Never add them');
});

test('kept rules: reviewer never edits, Must never softened, old rules still present', () => {
  has(read('agents/code-reviewer.md'), 'You never change code', 'never softened to a Nit', 'spike/', 'aico:i18n', 'aico:performance', 'previous Blocking items');
  has(read('agents/senior-engineer.md'), 'accept a Must without a primary source', 'edit product code', 'Debt');
  has(read('skills/review/SKILL.md'), 'block-list', 'Handoffs, Steps, Roles');
});

test('handoff skill: context budget follows the Context cap line, lint runs from the plugin root', () => {
  const t = read('skills/handoff/SKILL.md');
  has(t, 'Context cap: <cap> handover <n>', 'invalid Context cap', '150000', '120000', 'never compute');
  assert.doesNotMatch(t, /around 130k/);
  assert.doesNotMatch(t, /node scripts\/handoff-lint\.mjs/);
  has(t, '${CLAUDE_PLUGIN_ROOT}/scripts/handoff-lint.mjs');
});
