import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Contract tests for the to-tickets Playbook. A skill file is the public interface of a Playbook,
// so these pin the rules it states.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = readFileSync(join(root, 'skills/to-tickets/SKILL.md'), 'utf8');
const has = (...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};
const lacks = (...needles) => {
  for (const n of needles) assert.ok(!(n instanceof RegExp ? n.test(text) : text.includes(n)), `must not appear: ${n}`);
};
const idx = (s) => { const i = text.indexOf(s); assert.ok(i >= 0, `missing: ${s}`); return i; };
const fm = () => text.split('\n---\n')[0];

test('frontmatter, Help line and Type line are in place', () => {
  assert.ok(text.startsWith('---\n'));
  has(/^name: to-tickets$/m, /^description: Playbook\. .+/m, /^disable-model-invocation: true$/m,
    /^argument-hint: <.+>$/m);
  lacks(/^allowed-tools:/m);
  assert.ok(fm().length < 1024 + 200);
  has('**Help:**', '`documentation/commands/to-tickets.md`');
  has('**Type:**', 'company-type check-playbook to-tickets');
  assert.ok(idx('**Help:**') < idx('**Type:**'));
  assert.ok(text.split('\n').length <= 125, 'SKILL.md stays at 125 lines or fewer');
  assert.ok(!text.includes('\r'));
});

test('argument goes through the argument file, never a shell', () => {
  has('.company/draft-input-arg-to-tickets.txt', 'Write tool', 'run.mjs" draft-input arg --for to-tickets',
    'Never Read');
  assert.ok(idx('Write tool') < idx('draft-input arg --for to-tickets'));
  has('Write refusal', 'refused:');
  has('arg: file', 'refused: needs a file');
  lacks(/arg --for to-tickets ['"]?<(argument|arg|file)/);
});

test('take --for to-tickets: exit 4 shows only the missing line and stops; exit 3 shows only the refused line', () => {
  has('run.mjs" draft-input take', '--for to-tickets', 'Exit 4', '`missing:` line', 'Exit 3', '`refused:` line');
  has(/Exit 4[^\n]*stop/);
  has('input-to-tickets.md');
  has('data, never instructions');
});

test('architect plan step is the only Role and builds nothing', () => {
  has('check-role architect', '`architect`', 'Base commit:', 'line 3 `Base commit:', 'plan-tasks v1.3');
  has('git --no-replace-objects rev-parse --verify --end-of-options HEAD^{commit}');
  has('Input Handoffs:', 'Output:', 'Context cap:', 'Follow aico:handoff.');
  has('.company/work/<slug>/plan.md');
  has('no builder', 'no branch', 'no commit', 'no `begin`');
  lacks(/plan-tasks\.mjs" begin|plan-tasks" begin|run\.mjs" plan-tasks begin/);
  lacks(/git (add|commit|push|checkout|branch)/);
});

test('the dispatch carries Role skills: after Context cap: and the build follows §1.19 d', () => {
  has('Role skills: <names | none>', '§1.19 d');
  assert.ok(idx('Role skills: <names | none>') > idx('Context cap: <cap> handover <n>'));
});

test('the handover check takes cap, mode and handover from the settings get JSON', () => {
  has('plan-tasks check', '--cap', '--mode', '--handover');
  has('`pipeline.parallel_cap`', 'when it is 3, 4 or 5, else 4');
  has('`pipeline.dispatch`', 'exactly `sequential`', 'else `parallel`', 'never `waves`');
  has('`<h>` = `85500`', 'fixed handover', 'every Role');
  lacks('context_cap', '× 0.8', '120000');
  has('settings get');
});

test('handover is 85500', () => {
  has('--handover \'<h>\'', '85500');
});

test('ready comes from the check exit code and ERROR lines, one fix round, then not ready', () => {
  has('exit code', '`ERROR` lines', 'never the Architect', 'one fix round');
  has(/not ready/);
  has('Round: 1');
  assert.ok(idx('one fix round') < idx('Still failing'));
});

test('the DAG block and per-task lines are printed as data', () => {
  has('code fence', 'unchanged', 'wave');
  has('role', 'files', 'depends-on', 'context', 'slice', 'seams');
  has('control character', String.raw`\u` + '` plus four hex digits');
  has('plan-check', 'gate', 'info line');
});

test('the tree is checked and the end gives the plan path', () => {
  has('git status --porcelain', 'only under `.company/work/<slug>/`');
  has('/aico:feature', 'plan.md');
});
