import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pins the feature intake and ship text: prototype, glossary and ADRs, destination spec, research inputs.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};
const lines = (t) => t.replace(/\n$/, '').split('\n').length;
const REF = 'skills/feature/references/intake-and-ship.md';
const feature = read('skills/feature/SKILL.md');
const ref = read(REF);
const client = read('skills/client/SKILL.md');
const template = read('skills/lead/references/project-template.md');
const pm = read('agents/product-manager.md');
const architect = read('agents/architect.md');
const sourcing = read('skills/sourcing/SKILL.md');
const sectionOf = (text, heading) => {
  const start = text.indexOf(heading);
  assert.ok(start !== -1, `no ${heading}`);
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next === -1 ? undefined : next);
};

test('size limits, LF only and no Name: line (proj.M5, proj.M11, proj.M14)', () => {
  for (const [f, max] of [['skills/feature/SKILL.md', 125], ['skills/client/SKILL.md', 125], ['skills/sourcing/SKILL.md', 125], [REF, 125], ['agents/product-manager.md', 50], ['agents/architect.md', 50]]) {
    const t = read(f);
    assert.ok(lines(t) <= max, `${f} over ${max} lines`);
    assert.ok(!t.includes('\r'), `${f} has CR`);
    assert.doesNotMatch(t, /^\s*Name:/m, `${f} has a Name: line`);
  }
  assert.ok(!template.includes('\r'));
});

test('feature SKILL.md: steps 1b and 5a are one line each and point to the reference', () => {
  const l1b = feature.split('\n').filter((l) => /^1b\. /.test(l));
  const l5a = feature.split('\n').filter((l) => /^5a\. /.test(l));
  assert.equal(l1b.length, 1);
  assert.equal(l5a.length, 1);
  has(l1b[0], 'references/intake-and-ship.md');
  has(l5a[0], 'references/intake-and-ship.md');
  assert.ok(feature.indexOf('\n1b. ') > feature.indexOf('**→ Brief Gate**'));
  assert.ok(feature.indexOf('\n5a. ') > feature.indexOf('\n5. `aico:writer`'));
  assert.ok(feature.indexOf('\n5a. ') < feature.indexOf('**→ Ship Gate**'));
});

test('prototype: no prototype Step text runs without the Brief Gate yes (AC29)', () => {
  const s = sectionOf(ref, '## Prototype');
  has(s, 'Prototype: <question>', 'Run it', 'Skip', 'only after the CEO answered Run it at the Brief Gate',
    'worktree add', 'proto', 'NN-prototype-<role>.md', 'answer: <question>', '## Answer', 'at most 5 lines',
    'never merges', 'Skip or no question', 'no prototype Step', 'no worktree');
  has(feature.split('\n').find((l) => /^1b\. /.test(l)), 'Run it');
});

test('prototype: the Plan Gate shows the answer line and the architect cites it', () => {
  has(ref, 'prototype: <first line of the answer>', 'Decided:', 'Plan Gate');
});

test('glossary and ADR drafts: Brief Gate form, separate GLOSSARY.md question, architect writes them', () => {
  const s = sectionOf(ref, '## Glossary and ADRs');
  has(s, '## Glossary', '## ADR drafts', 'Write them after approval', 'Change', 'Skip',
    'Create GLOSSARY.md', 'No (Recommended)', 'architect', 'docs/adr/NNNN-<slug>.md');
  has(pm, '## Prototype question', '## Glossary', '## ADR drafts');
  has(architect, 'GLOSSARY.md', 'docs/adr/NNNN-<slug>.md');
});

test('product manager: spec step and a recommended answer with a one-line reason on every CEO question', () => {
  has(pm, 'destination-spec', 'version: pending', 'shipped: pending', /recommended answer first/, 'reason');
  assert.ok(lines(pm) <= 50);
});

test('destination spec: step 5a, one PM revision, stamp after approval, feature runs only', () => {
  const s = sectionOf(ref, '## Destination spec');
  has(s, 'spec-check.mjs', 'check', 'stamp', 'version: pending', 'one PM revision', 'Ship Gate',
    'feature runs only', 'docs/specs/<slug>.md', '.company/work/<slug>/spec.md', 'aico:client handoff');
  has(s, 'release version and date');
});

test('spec_in_repo is read as exactly yes or no; absent or other asks the CEO before 5a, recommended no', () => {
  const s = sectionOf(ref, '## Destination spec');
  has(s, '`spec_in_repo:`', 'exactly `yes` or `no`', 'absent', 'any other value', 'before step 5a',
    'Recommended', 'never default to yes');
  assert.match(s, /client project[^\n]*`spec_in_repo:`[^\n]*(absent|no line)|absent[^\n]*client/i);
});

test('template and client intake carry spec_in_repo:', () => {
  has(template, 'spec_in_repo:');
  assert.match(template, /<!-- spec_in_repo: yes \| no\./);
  has(client, 'spec_in_repo:', 'yes', 'no');
  assert.ok(lines(template) <= 60);
});

test('research inputs: the Lead adds Research inputs: to the PM and architect dispatches; sourcing says (unverified)', () => {
  has(ref, 'Research inputs:', 'product-manager', 'architect');
  has(sourcing, 'Research inputs', '[S#]', 'report date', '(unverified)');
  const para = sourcing.split('\n').find((l) => l.includes('Research inputs'));
  has(para, '(unverified)', 'never', 'data');
});

test('reference is a data rule: no directive phrasing taken from reports', () => {
  has(ref, 'data');
});
