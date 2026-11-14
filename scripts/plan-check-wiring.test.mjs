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

test('section 4 says the Plan Gate shows the block; it never blocks under warn and off, the scripts refuse under block', () => {
  has(pipeline, '**Plan Gate** also shows the Plan check block (`references/plan-check.md`); under `warn` and `off` it never blocks the Gate, under `block` the scripts refuse a Plan Gate with open decisions (plan-check step 7).');
  assert.ok(!pipeline.includes('in v0.16 it never blocks'));
});

test('section 6 names which rounds fix_rounds counts', () => {
  has(sectionOf(pipeline, '## 6. Finish'), '`<fix_rounds>` is the highest `round:` among the Steps that ran before the first Ship Gate answer (`plan-check` v1)');
});

test('the reference runs gate or off at the Plan Gate, wave after the form, read before the Ship Gate', () => {
  has(reference,
    'run.mjs" plan-check off \'<slug>\'',
    'run.mjs" plan-check gate \'<slug>\' \'<plan name>\' --policy \'<warn|block>\'',
    'run.mjs" plan-check wave \'<slug>\' \'<count>\'',
    'run.mjs" plan-check read \'<slug>\'',
    'Plan check: mark warnings as noise',
    '`plan-check marker: <state, or the error line>`',
    'Exit 2 (`block`) means the scripts refuse the Plan Gate (step 7)');
  assert.ok(!reference.includes('is shown like `warn`'));
  assert.ok(!/<plugin root>/.test(reference));
});

test('the reference runs gate with plan name none when files-touched lists no plan file, only for warn or block', () => {
  has(reference,
    'run.mjs" plan-check gate \'<slug>\' \'none\' --policy \'<warn|block>\'',
    'reason `plan-name`');
  assert.ok(!reference.includes('--policy \'<policy>\''));
  assert.ok(!reference.includes('skip the scan'));
});

test('the reference resolves the policy first and runs off whatever files-touched says', () => {
  const step1 = reference.slice(reference.indexOf('1. **Before the Gate form.**'), reference.indexOf('2. **Run it.**'));
  const at = (s) => { const i = step1.indexOf(s); assert.ok(i !== -1, `missing: ${s}`); return i; };
  assert.ok(at('plan_check.policy') < at('run.mjs" plan-check gate'));
  has(step1, 'With `off`, run the `off` command of step 2 whatever `files-touched` says');
  has(step1, 'Only with `warn` or `block` and no plan file');
});

test('the reference settles several plan files: one highest prefix wins, otherwise plan name none', () => {
  has(reference,
    'take the one file with the highest number prefix',
    'If two files share that prefix, if any is unprefixed, or if no single file wins, use no plan file');
  assert.ok(!reference.includes('files-touched of the Architect\'s Handoff; it must match `^(\\d{2,3}-)?(architect-)?plan(-[a-z0-9]+)?\\.md$`, if'));
});

test('review, planning and feedback texts carry the open-decision wiring', () => {
  const review = read('skills/review/SKILL.md');
  has(review, 'a Nit `[open-decision] <plan file>:<line or section>', 'The tag never appears under `## Blocking`');
  has(read('skills/planning/SKILL.md'), 'Decided: <choice> because <reason>', '`TBD`, `TODO` or `decide later`');
  has(read('skills/feedback/SKILL.md'), 'run.mjs" plan-check-verdict verdict --runs', '## Plan check');
});

test('feature and fix runs show the plan check at the Ship Gate and ask a form only on a refusal', () => {
  const rule = reference.split('\n').find((l) => l.startsWith('**Feature and fix.**'));
  assert.ok(rule, 'no Feature and fix rule');
  has(rule,
    'no Plan Gate',
    'Ship Gate summary',
    'Fix / Stop',
    '`plan-tasks begin` or `next` refusal',
    'never bypassed');
  has(reference, 'At each Plan Gate');
});

test('the pasted plan-check block sits inside a code fence', () => {
  has(reference, 'inside a code fence');
});

test('plan-review keeps its Plan Gate text and adds the feature and fix rule with the run cap', () => {
  const review = read('skills/pipeline/references/plan-review.md');
  const rule = review.split('\n').find((l) => l.startsWith('**Feature and fix.**'));
  assert.ok(rule, 'no Feature and fix rule');
  has(rule, 'no Plan Gate', 'Ship Gate summary', 'plan review: not run');
  has(review, '**Plan Gate block.** Under the summary show');
  assert.doesNotMatch(review, /95000|85500/);
});
