import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pins the pipeline, review and dispatch-prompt text that enforces the context cap.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};
const hasNot = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? !n.test(text) : !text.includes(n), `still present: ${n}`);
};
const pipeline = read('skills/pipeline/SKILL.md');
const ref = read('skills/pipeline/references/lead-handover.md');
const review = read('skills/review/SKILL.md');
const group = read('skills/review/references/review-group.md');
const contract = read('docs/contracts/dispatch-prompt.md');
const line = (text, start) => text.split('\n').find((l) => l.startsWith(start));

test('a Step is never resumed: lint exit 1, needs-ceo answer and follow-up are fresh Steps', () => {
  const after = line(pipeline, '- After each Step, in this order:');
  has(after, 'Exit 1 → redo the same Step as a fresh Step', 'no Fix round');
  hasNot(pipeline, 're-dispatch the same Step', 'numbers never block a Step');
  has(line(pipeline, '- `status: needs-ceo`'), 'fresh Step', 'never SendMessage');
  has(line(pipeline, '- **Never resume a Step.**'), 'SendMessage', 'follow-up', 'aico-mods', 'v1.6');
});

test('ledger exit 4 routes to one fresh check Step, never a Fix round', () => {
  has(line(pipeline, '- **Ledger exit 4'), 'over cap:', 'token-ledger', 'v1.8', 'fresh check Step', 'no Fix round', 'references/lead-handover.md');
  const s = ref.slice(ref.indexOf('## Ledger exit 4'));
  has(s, 'commit', 'same Role', 'next `NN`', 'same Round', 'second exit 4', 'never closes a review');
  has(s, 'plan-tasks', 'no `done`', 'check Step', 'scope');
  has(ref, '## Context readings', 'ledger agent-ctx', 'lead-handover ctx', 'measure');
});

test('a check Step runs only for Blocking rows or changed code files', () => {
  const s = ref.slice(ref.indexOf('## Ledger exit 4'), ref.indexOf('## Step groups'));
  has(s, 'A check Step runs only when', '`## Blocking` row', '`## Did`', '`files-touched`', 'A code file is any changed file that is not a doc, plan, Contract or Handoff', 'still shows at the Ship Gate', 'no check Step');
  has(line(pipeline, '- **Ledger exit 4'), 'only when', '`## Blocking` rows', 'changed code files');
});

test('check Step rules follow plan R-8 and R-17, Fix group has a Role side', () => {
  const s = ref.slice(ref.indexOf('## Ledger exit 4'), ref.indexOf('## Step groups'));
  has(s, "the over-cap Handoff plus that Step's original inputs", 'check and finish Step <NN> (over cap): confirm or correct each Did, Decisions and Blocking line', 'continue as is, split, stop', 'No third Step');
  has(s, 'The task stays started (no new `start`)', '`Worktree:`', 'may change code inside `Files:`', 'test-first', 'not `plan-tasks done`');
  has(ref.slice(ref.indexOf('## Step groups')), 'fix only the rows listed in <group path>', 'fixes only those `<handoff>:<line>` rows');
  const role = line(ref, '- Fix round without a parallel record');
  has(role, "is the owner of the group's areas in the Architect's Module map", 'same source as `references/parallel.md`', 'Several owners, no owner, or the `unplaced` group', 'whose earlier Handoff in this run lists the row\'s path in `files-touched`', 'still none or several → an ask form, never a pick from row text');
  hasNot(role, "owns the group's paths");
});

test('one Step per review or Fix group through step-split, without --risk', () => {
  has(line(pipeline, '- **One Step per review or Fix group'), 'step-split', 'dispatch-prompt', 'v5.0', 'references/lead-handover.md');
  const s = ref.slice(ref.indexOf('## Step groups'));
  has(s, 'step-split review \'<slug>\' <Base commit> <round>', 'no `--risk`', 'refused: no full path list', 'one unsplit review');
  has(s, 'split exists', 'step-split show', 'every group whose done Handoff', 'architect.txt', 'one architect Step', 'Review group:', 'Fix group:');
  has(s, 'step-split fix \'<slug>\' <round>', 'parallel record', 'out-of-group', 'Blocking');
});

test('Ship Gate shows over cap and the Lead peak', () => {
  has(line(pipeline, '- **Ship Gate** also shows `over cap`'), 'lead peak', 'ledger report', 'lead-handover read');
  has(ref, 'over cap: <count> steps (max <n>)', 'lead peak <n>', 'lead hand-overs: <n>');
});

test('the group lines sit in the v4.4 section, the canonical order stays', () => {
  has(contract, '# Contract: dispatch-prompt v5.0', 'v4.4 is additive');
  has(contract, '`Review group: <i>/<n> .company/work/<slug>/split/r<round>/g<i>.txt`', '`Fix group: <i>/<n> .company/work/<slug>/split/f<round>/g<i>.txt`');
  has(contract, 'directly after `Review depth:`', 'directly after `Round:`', 'architect.txt', 'one architect Step', 'A Role that gets a v4.3 prompt behaves as before');
  has(line(pipeline, '- **One Step per review or Fix group'), '`Review group:`', '`Fix group:`');
});

test('review points at the group reference, which never names tier-set', () => {
  const p = (review.match(/`Review group:` line[^\n]*/) || [])[0];
  assert.ok(p && Buffer.byteLength(p) <= 120);
  has(p, 'references/review-group.md');
  hasNot(group, 'tier-set');
  has(group, 'judge the listed paths', 'callers and Contracts', 'outside', 'stays Blocking', '<path>:<line>', 'step-split fix', 'Nits', 'every group');
});

test('shipped files are LF only and the pipeline stays within its cap', () => {
  for (const p of ['skills/pipeline/SKILL.md', 'skills/pipeline/references/lead-handover.md', 'skills/review/SKILL.md', 'skills/review/references/review-group.md', 'docs/contracts/dispatch-prompt.md']) {
    assert.ok(!read(p).includes('\r'), `CR in ${p}`);
  }
  assert.ok(pipeline.split('\n').length <= 125);
});
