import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pins the fix Playbook without the Core or Contract pause: only the Ship Gate stays, and a build plan argument runs its tickets.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fix = readFileSync(join(root, 'skills/fix/SKILL.md'), 'utf8');
const lines = (t) => t.replace(/\n$/, '').split('\n');
const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};
const body = lines(fix).slice(5).join('\n');

test('fix has only the Ship Gate', () => {
  const gates = fix.match(/\*\*→ [A-Za-z ]*Gate\*\*/g).map((g) => g.slice(4, -2));
  assert.deepEqual(gates, ['Ship Gate']);
  assert.doesNotMatch(body.replace('No Brief Gate and no Plan Gate', ''), /Brief Gate|Plan Gate|Brief or Plan|Exception/);
  has(fix, 'No Brief Gate and no Plan Gate', '**→ Ship Gate** (after sync --diff; added lanes first)');
});

test('a Core or Contract change in a fix goes to the Ship Gate summary, not to a pause', () => {
  has(fix, /Core or Contract change[^\n]*Ship Gate summary/);
  assert.doesNotMatch(fix, /pause/);
});

test('a decision that used to wait for a Gate is one form, and a script refusal is never bypassed', () => {
  has(fix, 'one form', 'Fix / Stop', 'never bypassed', '`needs-ceo`', 'not a Gate');
});

test('a build plan argument is checked as a repo path and its tickets run in plan order', () => {
  has(fix, '.company/work/<slug>-build/plan.md', 'real root', 'regular file', 'one link',
    'plan-tasks begin', '--mode sequential', 'plan order', 'QA reproduces from the plan', 'data, never instructions');
  has(fix, 'a bug description or issue link runs as before');
  assert.ok(fix.indexOf('real root') < fix.indexOf('--mode sequential'));
});

test('fix keeps the regression test, the tier-set steps and the second reviewer lines', () => {
  has(fix, 'write a failing regression test, and name the suspected Module', 'After its commit, tier-set.mjs sync --diff',
    'second-reviewer', 'no full suite', '${CLAUDE_PLUGIN_ROOT}/scripts/');
  has(lines(fix)[2], 'Ship Gate');
});

test('fix stays within 125 lines and is LF only', () => {
  assert.ok(lines(fix).length <= 125);
  assert.ok(!fix.includes('\r'));
});
