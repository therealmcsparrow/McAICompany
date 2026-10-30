import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pins the feature Playbook's draft input text: scope, argument file, take, Plan Gate outcomes.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};
const lines = (t) => t.replace(/\n$/, '').split('\n').length;
const feature = read('skills/feature/SKILL.md');
const ref = read('skills/feature/references/intake-and-ship.md');
const client = read('skills/client/SKILL.md');
const sectionOf = (text, heading) => {
  const start = text.indexOf(heading);
  assert.ok(start !== -1, `no ${heading}`);
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next === -1 ? undefined : next);
};
const draft = sectionOf(ref, '## Draft inputs');

test('feature SKILL.md stays within 125 lines, LF only, and points to Draft inputs', () => {
  assert.ok(lines(feature) <= 125, 'feature SKILL.md over 125 lines');
  assert.ok(!feature.includes('\r') && !ref.includes('\r') && !client.includes('\r'));
  assert.match(feature, /^argument-hint: <feature description \| draft file>$/m);
  assert.ok(feature.split('\n').some((l) => /^1\. /.test(l) && l.includes('Draft inputs')) || /Draft inputs/.test(feature));
  has(feature, 'references/intake-and-ship.md');
});

test('scope: only draft files take the intake (R-12)', () => {
  has(draft, '.company/work/<s>/grill.md', '.company/work/<s>/spec.md', '.company/work/<s>/plan.md',
    'one token with no whitespace', 'only to draft files');
});

test('a research-report hand-over (.company/research/<slug>.md) starts exactly as today', () => {
  has(draft, '.company/research/<slug>.md', 'brainstorm', 'exactly as today', 'no `take`', 'no 256 KiB cap', "Setup's slug");
});

test('a triage-lined request starts exactly as today', () => {
  has(draft, 'triage', 'exactly as today');
  assert.match(draft, /request[^\n]*triage line|triage line[^\n]*request/i);
});

test('argument file, arg and take run before Setup item 1; the printed slug is the task slug', () => {
  has(draft, '.company/draft-input-arg-feature.txt', 'Write tool', 'arg --for feature', 'arg: file',
    'take --for feature', 'before Setup item 1', 'task slug', 'never builds a slug');
  has(draft, "node \"${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs\" draft-input");
});

test('input kinds: spec, grill, brief or text go to the product-manager; plan goes to the architect with stale', () => {
  has(draft, 'product-manager', 'architect', '`stale`', 'plan');
  assert.match(draft, /spec[^\n]*grill[^\n]*brief[^\n]*text[^\n]*product-manager|product-manager[^\n]*spec[^\n]*grill[^\n]*brief[^\n]*text/);
});

test('Plan Gate outcome 1: stale gone/exists lines are Blocking [spec]', () => {
  has(draft, 'stale <id> <path>', 'gone', 'exists', 'Blocking `[spec]`', 'Decided (stale <id> <path>):');
});

test('Plan Gate outcome 2: changed lines are info, not Blocking', () => {
  has(draft, 'changed <id> <path>', 'info', 'Plan Gate summary');
  assert.match(draft, /`changed[^\n]*info/);
});

test('Plan Gate outcome 3: no Base commit, base unknown or exit 1 is one stale not checked Blocking', () => {
  has(draft, 'refused: plan has no Base commit line', 'base unknown', 'exit 1', 'stale not checked',
    'Decided (stale not checked):', 'every `files:` path', 'back to the architect once', 'open at the Plan Gate');
});

test('Plan Gate outcome 3 fails closed: a grafts refusal, a link refusal or no summary line is a stale not checked Blocking', () => {
  has(draft, 'refused: grafts file present', 'refused: link', 'exit other than 0 or 2', '`draft-input stale:` summary line',
    '`[spec] stale not checked: <first line>`');
  assert.match(draft, /any `stale` exit other than 0 or 2/i);
});

test('the path given to take and stale is quoted', () => {
  has(draft, "take '<path>' --for feature", "stale '<path>'");
});

test('Plan Gate checks: Lead checks Decided lines, plan-check and reviewer as usual, no approval carries over, stale not rerun', () => {
  has(draft, 'plan-check', 'plan reviewer', 'No earlier approval carries over', 'not rerun', 'data');
});

test('step 5a and stamp act only on the run\'s own spec', () => {
  has(draft, "run's own spec", 'Step 5a', '`stamp`', 'never into the draft');
});

test('client handoff package takes stamped specs only, never a pending draft', () => {
  const s = client.slice(client.indexOf('## handoff'));
  has(s, 'spec_in_repo: no', '.company/work/<slug>/spec.md', 'package', 'stamped', 'pending');
  assert.match(s, /never a `pending`/);
});
