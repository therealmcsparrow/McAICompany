import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pins what the pilot agent and skill text must say and their size limits.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};
const FILES = {
  'agents/code-reviewer.md': 50, 'agents/senior-engineer.md': 50,
  'skills/review/SKILL.md': 125, 'skills/ruleset/SKILL.md': 125,
  'skills/standards/SKILL.md': 125, 'skills/feedback/SKILL.md': 125,
  'skills/handoff/SKILL.md': 125, 'skills/handoff/references/pilot.md': 125,
};
const PILOT = 'skills/handoff/references/pilot.md';
const bytes = (p) => Buffer.byteLength(read(p), 'utf8');

// Byte budget: pre-run = base bea3242, from `git show bea3242:<path> | wc -c`.
const PRE = {
  'skills/handoff/SKILL.md': 5844, 'skills/ruleset/SKILL.md': 5915, 'skills/review/SKILL.md': 2048,
  // review: 1899 + 149 B for the open-decision Nit paragraph (plan-check v1, v0.16).
  // standards: 1230 + 90 B for the company-type line it now carries + 360 B for the Playbook guard sentence (ADR 0026).
  'skills/standards/SKILL.md': 1680, 'agents/code-reviewer.md': 1950, 'agents/senior-engineer.md': 2365,
};
// Extra bytes a load may carry over the PRE sum. The handoff skill grew 110 B (Starting a Step item 5: Roles never start a Playbook,
// ADR 0026): code-reviewer is 127 B over its PRE sum (14 B of handoff growth, 113 B of open-decision Nit text, plan-check v1), senior-engineer 110 B over on top of its 22 B of drift and the standards line above.
const LOAD_EXTRA = { 'agents/senior-engineer.md': 132, 'agents/code-reviewer.md': 127 };
const LOAD = {
  'agents/code-reviewer.md': ['agents/code-reviewer.md', 'skills/handoff/SKILL.md', 'skills/review/SKILL.md', 'skills/ruleset/SKILL.md'],
  'agents/senior-engineer.md': ['agents/senior-engineer.md', 'skills/handoff/SKILL.md', 'skills/ruleset/SKILL.md', 'skills/standards/SKILL.md'],
};

test('size limits and LF only (proj.M5, proj.M11)', () => {
  for (const [f, max] of Object.entries(FILES)) {
    const t = read(f);
    assert.ok(!t.includes('\r'), `${f} has CR`);
    assert.ok(t.trimEnd().split('\n').length <= max, `${f} over ${max} lines`);
  }
});

test('byte budget: every pre-existing pilot file is at most its size at bea3242', () => {
  for (const [f, max] of Object.entries(PRE)) assert.ok(bytes(f) <= max, `${f} is ${bytes(f)} B, pre-run ${max} B`);
});

test('byte budget: each pilot Role loads at most the pre-run sum, references/pilot.md included', () => {
  for (const [agent, files] of Object.entries(LOAD)) {
    const pre = files.reduce((n, f) => n + PRE[f], 0) + (LOAD_EXTRA[agent] || 0);
    const now = files.reduce((n, f) => n + bytes(f), 0) + bytes(PILOT);
    assert.ok(now <= pre, `${agent} loads ${now} B, pre-run ${pre} B`);
  }
  assert.equal(LOAD['agents/code-reviewer.md'].reduce((n, f) => n + PRE[f], 0), 15757);
});

test('pilot text lives in references/pilot.md; SKILL.md keeps one pointer', () => {
  assert.ok(existsSync(join(root, PILOT)));
  const h = read('skills/handoff/SKILL.md');
  has(h, 'references/pilot.md', 'builders cite finding IDs in `## Did`');
  assert.doesNotMatch(h, /aico-top/);
  assert.doesNotMatch(h, /findings\.md/);
  for (const f of ['agents/code-reviewer.md', 'agents/senior-engineer.md']) has(read(f), 'references/pilot.md', 'Review format: pilot', 'no `|` inside a field', 'Prose never starts with an ID');
  has(h, 'Review format: pilot');
  has(read(PILOT), 'no `|` inside a field');
  assert.doesNotMatch(read('skills/review/SKILL.md'), /pilot\.md/);
});

test('AC20 pilot.md holds the top block keys and the finding rows; agents name the row shapes', () => {
  const p = read(PILOT);
  has(p, '`status`, `files`, `ac_ids`', '`rule_ids`', '`risks`', '`read_next`', '`tokens_used`', 'aico-top', '--require-top',
    '- [contract|spec|security|test] <ID> | <file>[:<line>[-<line>]] | <problem> | <why> | <fix>',
    '- <ID> | <file>[:<line>] | <problem> | <why> | <fix>', '`why` never empty', '`R-<n>`', '`C-<n>`', '`T-<n>`');
  has(read('agents/code-reviewer.md'), 'R-<n> | file:line | problem | why | fix', '--require-top');
  has(read('agents/senior-engineer.md'), 'C-<n> | file:line | problem | why | fix', '--require-top');
});

test('AC22 reviewers read rule-check list and confirm T- rows, tools never block alone', () => {
  for (const f of ['skills/review/SKILL.md', 'skills/ruleset/SKILL.md']) has(read(f), /rule-check\.mjs/, 'list');
  has(read('skills/review/SKILL.md'), 'Confirm each `T-` row', 'never blocks on its own', 'T-<n> | <file>[:<line>] | not confirmed | <why> | none');
  has(read('agents/code-reviewer.md'), 'aico:review');
  has(read('docs/contracts/rule-check.md'), 'T-<n> | <file>[:<line>] | not confirmed | <why> | none');
});

test('AC23 slices carry every security Must and a findings ledger survives handover', () => {
  has(read('skills/ruleset/SKILL.md'), 'every security Must', /rule-check\.mjs"? slices/);
  has(read('agents/senior-engineer.md'), 'every security Must', /rule-check\.mjs"? slices/);
  has(read(PILOT), 'findings.md', 'continues the same file', 'appends every new finding before its Handoff', 'never deleted', '`open|fixed|withdrawn`', '[nit]', 'handoff-lint.mjs --findings');
});

const HANDOVER = [
  '- Pilot handover (`status: handover` only): first write `<NN>-<role>.findings.md` beside the Handoff (frontmatter `step`, `role`, `base-commit`; `## Checked`; `## Findings` rows `- ',
  ' | open | [spec] | file:line | problem | why | fix`, `[nit]` for a Nit, no `|` inside a field); a continuation appends its new rows. Prose never starts with an ID: under `## Blocking` and `## Nits` every bullet is a row.',
];
test('AC23 both pilot agents hold the Handover line; the pins that left pilot.md live there (AC34)', () => {
  for (const [f, id] of [['agents/code-reviewer.md', 'R-1'], ['agents/senior-engineer.md', 'C-1']]) {
    const t = read(f);
    has(t, HANDOVER[0] + id + HANDOVER[1], 'findings.md', '## Checked', '## Findings', '[nit]', 'appends');
    assert.ok(t.trimEnd().split('\n').length <= 50);
  }
  const rev = read('agents/code-reviewer.md').split('\n');
  assert.equal(rev.findIndex((l) => l.startsWith('- Pilot handover')), rev.findIndex((l) => l.startsWith('- With `Review format: pilot` only')) + 1);
  const sen = read('agents/senior-engineer.md').split('\n');
  assert.equal(sen.findIndex((l) => l.startsWith('- Pilot handover')), sen.findIndex((l) => l.startsWith('- **compliance:**')) + 1);
  assert.doesNotMatch(read('agents/code-reviewer.md'), /Read the brief, the Architect's Handoff/);
});

test('pilot.md: the Lead-side lint text is cut, layout points at the agent, read_next allows heading spaces', () => {
  const p = read(PILOT);
  has(p, 'Contract: `docs/contracts/handoff.md`. Lint: `handoff-lint.mjs --require-top`; an error re-dispatches you, no Fix round.',
    'Layout: the Handover line of your agent; statuses `open|fixed|withdrawn`; no `|` inside a field; a Nit\'s Handoff row drops `[nit]`. Rows are appended or change status, never deleted.',
    '(heading text may hold spaces)');
  assert.doesNotMatch(p, /The Lead runs/);
});

test('review skill: do not re-judge or restate the tool-checked rules', () => {
  has(read('skills/review/SKILL.md'), "don't re-judge or restate those rules");
});

test('builder agents: search before you read a file you will edit', () => {
  const LINE = 'Before you Read a file you will edit, Grep it for the spot, then Read with `offset`/`limit`; read it whole only to rewrite most of it.';
  for (const a of ['backend-engineer', 'frontend-engineer', 'desktop-engineer', 'ai-data-engineer', 'game-engineer', 'devops']) {
    const t = read(`agents/${a}.md`);
    has(t, LINE);
    assert.ok(t.split('\n').find((l) => l.startsWith('**Start:**')).includes(LINE), `${a}: in Start`);
    assert.ok(t.trimEnd().split('\n').length <= 50);
  }
});

test('ledger timing: written only near a handover (60% of the cap or a decision to hand over), IDs without a ledger', () => {
  const p = read(PILOT);
  has(p, 'only with `status: handover`', '75% of `<n>` (60% of `<cap>`', '90000', 'status: handover', 'writes none', 'always has it',
    'fixed R-2', '1 + the highest');
  assert.doesNotMatch(read('agents/code-reviewer.md') + read('skills/review/SKILL.md'), /before the first file|from the first file/);
});

test('rule slices: builders follow Rule slice, the senior engineer writes the files before done', () => {
  const r = read('skills/ruleset/SKILL.md');
  has(r, '`Rule slice:`', '.company/work/<slug>/rules/<task>.md', 'blocked — missing rule slice', 'instead of the senior-engineer Handoff');
  for (const f of ['skills/standards/SKILL.md', 'agents/senior-engineer.md']) has(read(f), /rule-check\.mjs"? slices <[^>]+> --write/);
});

test('AC24 depth comes from review-depth and is never lowered', () => {
  has(read('agents/code-reviewer.md'), 'Review depth:', 'never lower it');
  has(read('skills/review/SKILL.md'), 'Review depth:', 'not the builder\'s label', 'never lower it');
});

test('AC26 feedback reads ledger report for the last 3 runs, spend and cache read apart', () => {
  has(read('skills/feedback/SKILL.md'), 'ledger.mjs', 'report', 'last 3 runs', '**spend**', '**cache read**', 'Never add them');
  has(read('skills/feedback/SKILL.md'), 'ledger.mjs" scorecard <run>', '## Speed', 'never stops the run',
    '`brainstorm-`, `replay-` or `baseline-`', 'try the next file, up to 3 tries');
});

test('kept rules: reviewer never edits, Must never softened, old rules still present', () => {
  has(read('agents/code-reviewer.md'), 'You never change code', 'soften a Blocking item', 'spike/', 'aico:i18n', 'aico:performance', 'previous Blocking items');
  has(read('agents/senior-engineer.md'), 'accept a Must without a primary source', 'edit product code', 'Debt');
  has(read('skills/ruleset/SKILL.md'), 'never softened to a Nit', 'Reviewers apply the tiers **only to lines the run adds or changes**');
  has(read('skills/review/SKILL.md'), 'block-list', 'Handoffs, Steps, Roles');
});

test('handoff skill: context budget follows the Context cap line, lint runs from the plugin root', () => {
  const t = read('skills/handoff/SKILL.md');
  has(t, 'Context cap: <cap> handover <n>', 'invalid Context cap', '150000', '120000', 'never compute');
  assert.doesNotMatch(t, /around 130k/);
  has(read('skills/pipeline/SKILL.md'), '${CLAUDE_PLUGIN_ROOT}/scripts/handoff-lint.mjs');
  assert.doesNotMatch(read(PILOT), /node scripts\/handoff-lint\.mjs/);
});
