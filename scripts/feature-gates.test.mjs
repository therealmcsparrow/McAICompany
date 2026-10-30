import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pins the feature Playbook without a Brief Gate and a Plan Gate: only the Ship Gate stays, and the former Gate items move.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};
const lines = (t) => t.replace(/\n$/, '').split('\n').length;
const feature = read('skills/feature/SKILL.md');
const ref = read('skills/feature/references/intake-and-ship.md');
const tierPath = read('skills/pipeline/references/tier-path.md');
const triage = read('skills/triage/SKILL.md');
const adr = read('docs/adr/0050-feature-and-fix-without-brief-and-plan-gate.md');
const sectionOf = (text, heading) => {
  const start = text.indexOf(heading);
  assert.ok(start !== -1, `no ${heading}`);
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next === -1 ? undefined : next);
};
const step = (n) => tierPath.split('\n').find((l) => l.startsWith(`${n}. **`));

test('feature has only the Ship Gate', () => {
  const gates = feature.match(/\*\*→ [A-Za-z ]*Gate\*\*/g).map((g) => g.slice(4, -2));
  assert.deepEqual(gates, ['Ship Gate']);
  assert.doesNotMatch(feature.split('\n').slice(5).join('\n').replace('No Brief Gate and no Plan Gate', ''), /Brief Gate|Plan Gate/);
  has(feature, 'No Brief Gate and no Plan Gate');
  assert.doesNotMatch(feature.split('\n').slice(0, 4).join('\n'), /Brief, Plan and Ship Gates/);
  has(feature.split('\n')[2], 'Ship Gate');
});

test('feature stays within 125 lines, LF only, and the Ship Gate line is the pinned one', () => {
  assert.ok(lines(feature) <= 125 && lines(ref) <= 125);
  assert.ok(!feature.includes('\r') && !ref.includes('\r') && !tierPath.includes('\r') && !adr.includes('\r'));
  has(feature, '**→ Ship Gate** (after tier-set.mjs sync --diff; added Roles and lanes first)');
  assert.ok(feature.indexOf('\n5a. ') < feature.indexOf('**→ Ship Gate**'));
});

test('the Ship Gate summary section lists the former Gate items and shows Role lines verbatim', () => {
  const s = sectionOf(ref, '\n## Ship Gate summary');
  has(s, 'Core and Contract', 'Art direction', 'plan-tasks waves', 'plan-check', 'plan review', 'Spike results', 'prototype',
    'stale', 'tickets changed since approval', 'ticket-approval', '--phase f', 'sign-off skipped', '> ',
    'verbatim', 'nothing waits');
  has(s, 'never an approval');
  has(s, "ticket-approval read '<flow slug>'", 'applied approve line');
});

test('tier-path step 2: feature starts at medium unless a trusted triage record says low', () => {
  const s = step(2);
  has(s, 'Feature:', 'medium', 'trusted', 'triage check');
  assert.doesNotMatch(s, /Feature: the tier of the triage line the request ends in, else `low`/);
});

test('former Gate decisions become forms when they arise, and a script refusal is never bypassed', () => {
  const s = sectionOf(ref, '\n## Forms');
  has(s, '`needs-ceo`', 'ruleset rule', 'plan-check', '`block`', 'plan-tasks begin', 'Fix / Stop',
    'Run it / Skip', 'Write them / Skip', 'not a Gate', 'never bypassed', '2 to 4');
});

test('prototype and glossary text no longer name the Brief Gate or the Plan Gate', () => {
  assert.doesNotMatch(ref.replace('Feature has no Brief Gate and no Plan Gate; only the Ship Gate.', ''), /Brief Gate|Plan Gate/);
  has(sectionOf(ref, '## Prototype'), 'prototype form', 'Ship Gate');
  has(sectionOf(ref, '## Glossary and ADRs'), 'Write them / Skip');
});

test('tier-path step 4 asks the short path form only when the preview prints path: short (low)', () => {
  const s = step(4);
  has(s, 'no Brief Gate', 'path: short (low)', 'Short path (Recommended) / Full path', "--ceo '<c>'", 'not a Gate');
  assert.ok(s.indexOf('preview') < s.indexOf('begin'));
  assert.doesNotMatch(s, /gates\.brief/);
});

test('tier-path step 8 checks the plan before the first builder and step 9 pastes into the Ship Gate summary', () => {
  has(step(8), "`sync '<slug>' --plan '<plan>' --base '<base>'` before the first builder (feature)");
  assert.doesNotMatch(step(8), /Plan Gate/);
  has(step(9), 'every Ship Gate summary', 'Every Gate the Playbook has stops as today');
  assert.doesNotMatch(step(9), /Brief \(feature\)|Plan and Ship/);
});

test('triage keeps its own form and says every Gate the route has', () => {
  has(triage, 'every Gate the route has, however small', '**→ Brief Gate** (a form: Approve / Change / Stop)');
});

test('ADR 0050 records the removal, the cc.S2 re-approval and the kept controls', () => {
  has(adr, 'cc.S2', 'Brief and Plan Gate', 'Ship Gate', 'security', 'Playbook start rule', 'CEO', '2026-10-30');
  has(adr, 'medium', 'trusted triage record', 'security lane always runs');
  assert.ok(lines(adr) <= 12);
  assert.doesNotMatch(adr, /^Name:/m);
});
