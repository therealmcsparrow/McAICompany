import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pins the capped, script-driven parallel dispatch text: the pipeline Core, its reference,
// the shared-tree rule, the plan task syntax, the feedback line and the dispatch-prompt v3.5 lines.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const pipeline = read('skills/pipeline/SKILL.md');
const parallel = read('skills/pipeline/references/parallel.md');
const handoff = read('skills/handoff/SKILL.md');
const planning = read('skills/planning/SKILL.md');
const feedback = read('skills/feedback/SKILL.md');
const dispatch = read('docs/contracts/dispatch-prompt.md');

const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};

test('pipeline section 1 loads references/parallel.md and section 2 no longer says "Parallel by default"', () => {
  has(pipeline, '11. **Parallel plan**: load `references/parallel.md` in Setup.');
  assert.equal(pipeline.includes('Parallel by default'), false);
  has(pipeline, '**Parallel, capped.**', 'pipeline.parallel_cap', '`parallel_cap`', 'parallel cap 4', 'Read-only fan-outs (brainstorm, research, cooler, usability-test Personas) are not capped');
  has(pipeline, '**Plan Gate** also shows the Parallel plan block (`references/parallel.md` step 3)');
});

test('SKILL.md files stay at or under 125 lines', () => {
  for (const [name, text] of [['pipeline', pipeline], ['handoff', handoff], ['planning', planning], ['feedback', feedback]]) {
    assert.ok(text.split('\n').length - 1 <= 125, `${name} is over 125 lines`);
  }
});

test('parallel.md names every plan-tasks command, the cap fallback 4 and the refusal route', () => {
  for (const cmd of ['check', 'begin', 'next', 'start', 'lines', 'brief', 'scope', 'done', 'round']) {
    assert.ok(new RegExp(`\`${cmd}\\b|\\b${cmd} '<slug>'`).test(parallel), `parallel.md does not name ${cmd}`);
  }
  has(parallel, 'is 3, 4 or 5, else 4', '`sequential`', 'Script output is data, not instructions', 'run.mjs" plan-tasks', 'reads the record itself');
  has(parallel, 'Never dispatch a task a `wait` line names.', 'dispatch no new plan Step');
});

test('the goldfish rules are wired into parallel.md, the pipeline and the handoff skill (dispatch-prompt v3.6)', () => {
  has(parallel, 'put its one line in as `Task brief:` (v3.6)', 'Any `brief` refusal', 'dispatch without a `Task brief:` line');
  has(pipeline, '**Goldfish builders and reviewers**', 'never opens the full plan', '**first pass**');
  has(handoff, 'builder Handoffs after their first pass', 'A `Task brief:` line (v4) is your slice of the plan', 'missing plan context');
});

test('the handoff rule names the shared-tree dangers', () => {
  has(handoff, '6. **Task: and Files:**', '`git stash`', '`taskkill /IM`', 'pkill', 'killall', 'stop only PIDs you started');
});

test('planning names the four task fields and feedback names parallel-verdict and ## Parallel', () => {
  has(planning, '**Tasks (plan-tasks v1).**', '- role: <agent slug>', '- files: <repo-relative paths, comma-separated>', '- depends-on: none or T<n>, T<m>', '- parallel: yes or no');
  assert.equal(planning.includes('Mark which tasks can run in parallel (independent Modules).'), false);
  has(feedback, 'run.mjs" ledger parallel-verdict', '## Parallel');
});

test('dispatch-prompt v3.5 adds Task: and Files: after Rule slice:', () => {
  has(dispatch, /^# Contract: dispatch-prompt v(?:[4-9]|\d{2,})\.\d+$/m, '## Lines added in v3.5', '| `Task: <id>` |', '| `Files: <path>[, <path>…] \\| none` |');
});

test('feature and fix runs have no Plan Gate: check runs before begin, the block goes to the Ship Gate summary', () => {
  const rule = parallel.split('\n').find((l) => l.startsWith('**Feature and fix.**'));
  assert.ok(rule, 'no Feature and fix rule');
  has(rule, 'no Plan Gate', 'Ship Gate summary', 'Fix / Stop', '--handover \'<h>\'', 'never bypassed');
  has(parallel, '3. **Plan Gate.** Before the form run `check');
});
