import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pins the plan-check wording in the pipeline Core text and in the review, planning and feedback skills.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const has = (text, ...needles) => {
  for (const n of needles) assert.ok(text.includes(n), `missing: ${n}`);
};
const pipeline = read('skills/pipeline/SKILL.md');
const reference = read('skills/pipeline/references/plan-check.md');
const sectionOf = (text, heading) => {
  const start = text.indexOf(heading);
  assert.ok(start !== -1, `no ${heading}`);
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next === -1 ? undefined : next);
};

test('pipeline SKILL.md loads the plan-check reference in Setup and stays within 125 lines', () => {
  has(pipeline, '10. **Plan check**: load `references/plan-check.md` in Setup.');
  assert.ok(pipeline.replace(/\n$/, '').split('\n').length <= 125);
  assert.ok(!pipeline.includes('\r') && !reference.includes('\r'));
});

test('section 1.7 names plan_check and its fallback', () => {
  has(pipeline, '`plan_check` (`policy`, `runs`)', '`plan_check` `warn`, runs 5');
});

test('section 4 says the Plan Gate shows the block and never blocks in this version', () => {
  has(pipeline, '**Plan Gate** also shows the Plan check block (`references/plan-check.md`); in v0.16 it never blocks the Gate.');
});

test('section 6 names which rounds fix_rounds counts', () => {
  has(sectionOf(pipeline, '## 6. Finish'), '`<fix_rounds>` is the highest `round:` among the Steps that ran before the first Ship Gate answer (`plan-check` v1)');
});

test('the reference runs gate or off at the Plan Gate, wave after the form, read before the Ship Gate', () => {
  has(reference,
    'plan-check.mjs" off \'<slug>\'',
    'plan-check.mjs" gate \'<slug>\' \'<plan name>\' --policy \'<warn|block>\'',
    'plan-check.mjs" wave \'<slug>\' \'<count>\'',
    'plan-check.mjs" read \'<slug>\'',
    'Plan check: mark warnings as noise',
    '`plan-check marker: <state, or the error line>`',
    'exit 2 (`block`) is shown like `warn`');
  assert.ok(!/<plugin root>/.test(reference));
});

test('the reference still runs gate with plan name none when files-touched lists no plan file, and picks one of two', () => {
  has(reference,
    'plan-check.mjs" gate \'<slug>\' \'none\' --policy \'<policy>\'',
    'reason `plan-name`',
    'two plan files');
  assert.ok(!reference.includes('skip the scan'));
});

test('review, planning and feedback texts carry the open-decision wiring', () => {
  const review = read('skills/review/SKILL.md');
  has(review, 'a Nit `[open-decision] <plan file>:<line or section>', 'The tag never appears under `## Blocking`');
  has(read('skills/planning/SKILL.md'), 'Decided: <choice> because <reason>', '`TBD`, `TODO` or `decide later`');
  has(read('skills/feedback/SKILL.md'), 'plan-check-verdict.mjs" verdict --runs', '## Plan check');
});
