import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Pins the configurable context cap in the shipped pipeline, handoff and dispatch-prompt text, and that no shipped text still states the old fixed cap.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};
const hasNot = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? !n.test(text) : !text.includes(n), `still present: ${n}`);
};
const OLD_LINE = 'Context cap: 95000 handover 85500';
const pipeline = read('skills/pipeline/SKILL.md');
const handoff = read('skills/handoff/SKILL.md');
const contract = read('docs/contracts/dispatch-prompt.md');
const parallel = read('skills/pipeline/references/parallel.md');

// No script reads the line: the Role reads it from the prose rule, so the test pins that rule text only.
test('the contract rule for malformed cap lines gives the default values plus the Nit', () => {
  has(contract, 'not two integers', '`<n>` > `<cap>`', /cap 180000, handover at 162000( \(v5\.3\))?, and a Nit `invalid Context cap`/, 'at most 35 characters');
  has(handoff, 'Absent → cap 180000, handover at 162000', 'Malformed → the same, plus a Nit `invalid Context cap`');
});

test('absent cap line reads 180000 and 162000, not the old fixed pair', () => {
  has(contract, /→ cap 180000, handover at 162000( \(v5\.3\))?\./);
  hasNot(contract, '→ cap 95000, handover at 85500.');
  hasNot(handoff, 'Absent → cap 95000', /always `95000 handover 85500`/, /150000|120000/);
});

test('Setup item 8 takes the run cap from run-state and no longer states a fixed line', () => {
  const item8 = pipeline.split('\n').find((l) => l.startsWith('8. **Context cap'));
  assert.ok(item8, 'Setup item 8 exists');
  has(item8, 'run-state show', 'handover', 'pipeline.context_cap', '`cap`');
  hasNot(item8, OLD_LINE, 'no settings read', /floor\(.*0\.8/);
  hasNot(pipeline, 'roles.<role>.context_cap');
});

test('the contract is dispatch-prompt v5.3 with the line built from the run cap', () => {
  has(contract, '# Contract: dispatch-prompt v5.3', 'v4.4 is additive');
  has(contract, 'floor(cap', 'Context cap: <cap> handover <n>');
  hasNot(contract, /max\(that value, 150000\)/);
});

test('Role hand-over opens no CEO form and never resumes the old Step', () => {
  const line = pipeline.split('\n').find((l) => l.startsWith('- `status: handover`'));
  assert.ok(line);
  has(line, 'no CEO form', 'old Step is never resumed', '**fresh** Step');
  has(contract, 'no CEO form', 'never resumed');
});

test('parallel plan handover is the run handover, not a fixed 85500', () => {
  hasNot(parallel, '`<h>` = `85500`', 'floor(context_cap');
  has(parallel, '`<h>`', 'handover');
});

test('plan-tasks no longer states 0.8 per Role or 95000', () => {
  const planTasks = read('docs/contracts/plan-tasks.md');
  const body = planTasks.slice(planTasks.indexOf('\n## '));
  hasNot(body, /0\.8/, '95000', '85500');
  has(planTasks, '# Contract: plan-tasks v1.10');
});

test('dispatch examples stay valid: 95000 is still a cap and there is no Name: line', () => {
  for (const p of ['tests/regression/dispatch-ok.md', 'tests/regression/dispatch-no-language.md', 'tests/contracts/dispatch-prompt/step.txt']) {
    const t = read(p);
    has(t, OLD_LINE);
    hasNot(t, '150000', '120000', /^Name:/m);
  }
});

function walk(dir, out = []) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && /\.(md|txt)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Contract header lines (the version history before the first `## `) may keep old values.
const bodyOf = (p) => {
  const text = read(p);
  if (!p.startsWith('docs/contracts/')) return text;
  const at = text.indexOf('\n## ');
  return at < 0 ? text : text.slice(at);
};

test('no shipped text states a fixed cap or 95000 handover 85500 as current', () => {
  const files = [
    ...walk('skills'), ...walk('agents'), ...walk('documentation'), ...walk('docs/contracts'),
    'README.md', 'GLOSSARY.md'
  ];
  assert.ok(files.length > 40);
  const history = /\b(ADR|was|until|before|earlier|previously|no longer|instead of|v0\.\d+|CHANGELOG)\b/i;
  const bad = [];
  for (const p of files) {
    bodyOf(p).split('\n').forEach((line, i) => {
      if (/95000 handover 85500/.test(line)
        || /\b(fixed|one fixed)\b[^.\n]{0,20}\bcontext cap\b|\bcontext cap\b[^.\n]{0,25}\b(is|are) fixed\b|\bfixed cap\b/i.test(line)
        || (/\b(85500|95000)\b/.test(line) && !history.test(line))) bad.push(`${relative('.', p)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('ADR 0069 supersedes 0047, which stays and is marked superseded; 0049 and 0056 carry the amendment line', () => {
  const adr = read('docs/adr/0069-configurable-context-cap.md');
  has(adr, '0047', '180000', '90%');
  const old = read('docs/adr/0047-one-context-cap.md');
  has(old, /superseded/i, '0069', '95000', '85500');
  for (const p of ['docs/adr/0049-lead-handover-mechanism.md', 'docs/adr/0056-hard-handover-outside-agent.md']) {
    has(read(p), "Amended 2026-11-14: the cap and handover are now the run's values (ADR 0069).");
  }
});

test('CHANGELOG says stored context_cap values now take effect', () => {
  const top = read('CHANGELOG.md').split('\n').slice(0, 60).join('\n');
  has(top, '180000', /context_cap/, /take(s)? effect/);
});

test('shipped files are LF only', () => {
  for (const p of ['skills/pipeline/SKILL.md', 'skills/pipeline/references/parallel.md', 'skills/handoff/SKILL.md', 'docs/contracts/dispatch-prompt.md', 'docs/adr/0047-one-context-cap.md', 'docs/adr/0069-configurable-context-cap.md', 'scripts/context-cap.test.mjs']) {
    assert.ok(!read(p).includes('\r'), `CR in ${p}`);
  }
  assert.ok(pipeline.split('\n').length <= 125 && handoff.split('\n').length <= 125);
});
