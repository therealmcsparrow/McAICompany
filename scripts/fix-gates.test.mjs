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
  has(fix, '.company/work/<name>/plan.md', 'draft-input arg --for fix', 'draft-input take', '--for fix', 'input:', 'printed copy',
    'plan-tasks begin', '--mode sequential', 'plan order', 'QA reproduces from the plan', 'data, never instructions');
  has(fix, 'a bug description or issue link runs as before');
  assert.ok(fix.indexOf('--for fix') < fix.indexOf('--mode sequential'));
  assert.doesNotMatch(fix, /The Lead checks it before Setup/);
});

test('the fix Ship Gate shows the applied approve lines of the flow, each with a > prefix', () => {
  has(fix, "ticket-approval read '<flow slug>'", 'applied approve line', '> ', 'verbatim');
});

test('fix starts at medium unless a trusted triage record says low', () => {
  has(fix, 'trusted triage record');
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

// Bug: plan-tasks refused the drafted copy input-fix.md, so step 2 sent the fix run to a hand-made plan.md. AC6.
const step2 = () => lines(fix).find((l) => /^2\. /.test(l)) ?? '';

test('AC6 step 2 runs plan-tasks check and then begin on input-fix.md, the drafted copy', () => {
  const s = step2();
  has(s, 'input-fix.md', 'plan-tasks check', 'plan-tasks begin', '--mode sequential', /`plan-tasks` v1\.5/);
  assert.ok(s.indexOf('plan-tasks check') < s.indexOf('plan-tasks begin'), 'check comes before begin');
  assert.ok(s.indexOf('input-fix.md') < s.indexOf('--mode sequential'));
  has(s, /draft-input take[^\n]*input:|input:[^\n]*draft-input take|printed/);
});

test('AC6 step 2 passes --cap: plan-tasks refuses check and begin without it', () => {
  const s = step2();
  has(s, '--cap');
});

test('AC6 no line of the skill asks for a copy named plan.md', () => {
  const argPath = '.company/work/<name>/plan.md';
  for (const line of lines(fix)) {
    const rest = line.split(argPath).join('');
    if (!rest.includes('plan.md')) continue;
    // The one allowed mention is the clause that says no Step makes such a copy by hand.
    assert.match(rest, /\bno Step\b[^.\n]*\bby hand\b/, `a line mentions plan.md: ${line.slice(0, 80)}`);
  }
  assert.ok(lines(fix).some((l) => /\bno Step\b[^.\n]*\bplan\.md\b[^.\n]*\bby hand\b/.test(l)), 'the no-hand-made-copy clause is missing');
  assert.doesNotMatch(fix, /(copy|copies|save|saves|write|writes|rename|named?) (it |them |that |the copy )?(to|as|called|into)? ?`?plan\.md/i);
});
