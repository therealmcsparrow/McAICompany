// Tests: handoff v3.1 optional frontmatter fields tests, closes, open, next-step (warnings only, never errors).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lint } from './handoff-lint.mjs';

const script = path.join(import.meta.dirname, 'handoff-lint.mjs');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

// A valid v3.0 Handoff; `extra` lines go at the end of the frontmatter, `next` is the ## Next bullet.
const handoff = (extra = [], next = 'z') => `---
step: 03
role: qa
task: A1
status: done
round: 0
base-commit: 079d7863b895c7359738a05977681fdbc33b4997
risk-tier: high
${extra.join('\n')}${extra.length ? '\n' : ''}---
## Did
- x
## Decisions
- y
## Blocking
- none
## Nits
- none
## Next
- ${next}
`;

// Line number (1-based) of a frontmatter key in the text.
const lineOf = (text, key) => text.split('\n').findIndex(l => l.startsWith(`${key}:`)) + 1;

test('accepts all four keys', () => {
  const r = lint(handoff([
    'tests: unit pass 12 fail 0 skip 1 log logs/u.txt',
    'closes: [R-2, C-1]',
    'open: [R-3]',
    'next-step: code-reviewer — review the diff',
  ]), {});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.routing.tests, { scope: 'unit', pass: 12, fail: 0, skip: 1, log: 'logs/u.txt' });
  assert.deepEqual(r.routing.closes, ['R-2', 'C-1']);
  assert.deepEqual(r.routing.open, ['R-3']);
  assert.deepEqual(r.routing['next-step'], { role: 'code-reviewer', goal: 'review the diff' });
});

test('bad tests shape warns', () => {
  const text = handoff(['tests: all green']);
  const r = lint(text, {});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, [`warning line ${lineOf(text, 'tests')}: tests shape`]);
  assert.equal(r.routing.tests, null);
});

test('bad ID dropped with warning', () => {
  const text = handoff(['closes: [R-2, fixed]']);
  const r = lint(text, {});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, [`warning line ${lineOf(text, 'closes')}: closes shape`]);
  assert.deepEqual(r.routing.closes, ['R-2']);
});

test('open that is not a list warns', () => {
  const text = handoff(['open: R-3']);
  const r = lint(text, {});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, [`warning line ${lineOf(text, 'open')}: open shape`]);
  assert.deepEqual(r.routing.open, []);
});

test('bad next-step shape warns', () => {
  const text = handoff(['next-step: qa']);
  const r = lint(text, {});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, [`warning line ${lineOf(text, 'next-step')}: next-step shape`]);
  assert.equal(r.routing['next-step'], null);
});

test('next-step none', () => {
  const r = lint(handoff(['next-step: none']), {});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.routing['next-step'], 'none');
});

test('next-step mismatch warns', () => {
  const r = lint(handoff(['next-step: qa — x'], 'code-reviewer reviews the diff'), {});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, ['warning: next-step and ## Next name different Roles']);
});

test('next-step matching ## Next gives no warning', () => {
  const r = lint(handoff(['next-step: code-reviewer — x'], 'code-reviewer reviews the diff'), {});
  assert.deepEqual(r.warnings, []);
});

test('no Role in Next, no warning', () => {
  const r = lint(handoff(['next-step: qa — x'], 'see next-step:'), {});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('v3.0 Handoff unchanged', () => {
  const r = lint(handoff(), {});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.routing.tests, null);
  assert.deepEqual(r.routing.closes, []);
  assert.deepEqual(r.routing.open, []);
  assert.equal(r.routing['next-step'], null);
});

test('warnings carry no Handoff text', () => {
  const r = lint(handoff(['tests: SECRETWORD', 'closes: [SECRETWORD]', 'next-step: SECRETWORD']), {});
  assert.ok(r.warnings.length === 3);
  for (const w of r.warnings) assert.ok(!w.includes('SECRETWORD'));
});

test('CLI: a bad tests key exits 0 and prints the warning before the JSON line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-fields-'));
  dirs.push(dir);
  const file = path.join(dir, '03-qa.md');
  const text = handoff(['tests: all green']);
  fs.writeFileSync(file, text);
  const r = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = r.stdout.trim().split('\n');
  assert.equal(out[0], `warning line ${lineOf(text, 'tests')}: tests shape`);
  assert.equal(JSON.parse(out[1]).tests, null);
});

test('prose Role word in Next gives no mismatch', () => {
  const r = lint(handoff(['next-step: code-reviewer — x'], 'Lead dispatches code-reviewer for the security pass'), {});
  assert.deepEqual(r.warnings, []);
});

test('Role as first word of Next that differs warns', () => {
  const r = lint(handoff(['next-step: qa — x'], 'security reviews auth'), {});
  assert.deepEqual(r.warnings, ['warning: next-step and ## Next name different Roles']);
});

test('backticked Role in Next counts', () => {
  const r = lint(handoff(['next-step: security — x'], 'then `qa` runs'), {});
  assert.deepEqual(r.warnings, ['warning: next-step and ## Next name different Roles']);
});

test('next-step none while Next names a Role warns', () => {
  const r = lint(handoff(['next-step: none'], 'qa runs the suite'), {});
  assert.deepEqual(r.warnings, ['warning: next-step and ## Next name different Roles']);
});

test('next-step none with no Role in Next gives no warning', () => {
  const r = lint(handoff(['next-step: none'], 'nothing more'), {});
  assert.deepEqual(r.warnings, []);
});

test('next-step goal keeps " #" text', () => {
  const r = lint(handoff(['next-step: qa — fix issue #12'], 'qa fixes'), {});
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.routing['next-step'], { role: 'qa', goal: 'fix issue #12' });
});

test('tests log path with " #" is a shape warning', () => {
  const text = handoff(['tests: unit pass 1 fail 0 log logs/a #1.txt']);
  const r = lint(text, {});
  assert.deepEqual(r.warnings, [`warning line ${lineOf(text, 'tests')}: tests shape`]);
  assert.equal(r.routing.tests, null);
});

test('tests without skip or log', () => {
  const r = lint(handoff(['tests: unit pass 3 fail 0']), {});
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.routing.tests, { scope: 'unit', pass: 3, fail: 0, skip: null, log: null });
});

test('closes with an empty item warns and keeps the rest', () => {
  const text = handoff(['closes: [R-1, , R-2]']);
  const r = lint(text, {});
  assert.deepEqual(r.warnings, [`warning line ${lineOf(text, 'closes')}: closes shape`]);
  assert.deepEqual(r.routing.closes, ['R-1', 'R-2']);
});

test('empty open list is fine', () => {
  const r = lint(handoff(['open: []']), {});
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.routing.open, []);
});
