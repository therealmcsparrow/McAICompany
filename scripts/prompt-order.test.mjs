import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Drift test for the canonical dispatch line order (dispatch-prompt v3.1) plus one
// assertion per wiring rule of skills/pipeline. The order is for reading only: no cache claim anywhere.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const pipelineDir = join(root, 'skills', 'pipeline');
const refs = existsSync(join(pipelineDir, 'references')) ? readdirSync(join(pipelineDir, 'references')) : [];
const skillOnly = read('skills/pipeline/SKILL.md');
const pipeline = [skillOnly, ...refs.map(f => read(`skills/pipeline/references/${f}`))].join('\n');
const brainstorm = read('skills/brainstorm/SKILL.md');
const contract = read('docs/contracts/dispatch-prompt.md');

const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};

// Fenced blocks of a markdown text, as arrays of lines.
function blocks(text) {
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) { if (cur) { out.push(cur); cur = null; } else cur = []; }
    else if (cur) cur.push(line);
  }
  return out;
}
// Keys of a dispatch block in order: `Key:` at line start, comment lines skipped, the closing line as `Follow`.
const keys = (lines) => lines
  .filter(l => !l.startsWith('#'))
  .map(l => l.startsWith('Follow aico:handoff.') ? 'Follow' : /^([A-Z][A-Za-z ]*?):/.exec(l)?.[1])
  .filter(Boolean);

const PIPELINE_ORDER = ['Project profile', 'Company profile', 'Language', 'Name', 'Settings', 'Context cap', 'Design skills', 'Risk tier', 'Base commit', 'Round', 'Review depth', 'Input Handoffs', 'Rule slice', 'Output', 'Goal', 'Follow'];
const ROUND_1 = ['Project profile', 'Company profile', 'Language', 'Name', 'Settings', 'Input', 'Output', 'Goal'];
const stepBlock = () => blocks(skillOnly).find(l => l.some(x => x.startsWith('Output: .company/work/')));

test('the canonical order in the Contract is the one this test pins', () => {
  has(contract, '`Project profile:`, `Company profile:`, `Language:`, `Name:`, `Settings:` (optional), `Context cap:`, `Design skills:` (UI Roles only), `Risk tier:`, `Base commit:`, `Round:`, `Review depth:` (code-reviewer only), `Input Handoffs:`, `Rule slice:` (builders and devops only, Fix round 4), `Output:`, `Goal:`, then the closing `Follow aico:handoff.`');
  has(contract, '`Input:`, `Output:`, `Goal:`');
});

test('the pipeline dispatch block follows the canonical order', () => {
  assert.ok(stepBlock(), 'pipeline has a dispatch block');
  assert.deepEqual(keys(stepBlock()), PIPELINE_ORDER);
});

test('the pipeline dispatch block carries Context cap: and Review depth: as in v3.1', () => {
  const b = stepBlock().join('\n');
  assert.match(b, /^Context cap: <cap> handover <n>/m);
  assert.match(b, /^Review depth: <full \| standard> +# code-reviewer only/m);
  assert.match(b, /^Design skills: .*# only /m);
  assert.match(b, /^Settings: .*# only the values passed/m);
  assert.match(b, /^Rule slice: .*# builders and devops only/m);
});

test('the brainstorm skill has one dispatch block, in the canonical order, with no per-round content', () => {
  const bs = blocks(brainstorm).filter(l => l.some(x => x.startsWith('Company profile:')));
  assert.equal(bs.length, 1);
  assert.deepEqual(keys(bs[0]), ROUND_1);
  assert.doesNotMatch(bs[0].join('\n'), /Digest|Your last reply|Others said|Full file|Round \d/);
});

test('the brainstorm prompt is the same bytes for the whole run (same-bytes rule)', () => {
  has(contract, 'Brainstorm byte-identity');
  has(brainstorm, 'exact bytes', 'every dispatch of the run');
});

test('the order is described as fixed for reading, with no cache claim', () => {
  assert.doesNotMatch(pipeline, /cache hit|cheaper|cached prefix|prefix cach|saves? (tokens|cost|money)/i);
  has(pipeline, 'fixed for reading');
  has(pipeline, 'no cache saving');
});

test('Setup resolves the context cap once; the floor and the 80% live only here', () => {
  has(pipeline, '**Context cap (§1.7)**', 'roles.<role>.context_cap', 'max(`<cap>`, 150000)', 'floor(`<cap>` × 0.8)', 'once per run per Role', 'Context cap: <cap> handover <n>');
  has(pipeline, /Risk tier `high`/);
  has(pipeline, 'the Role never computes');
});

test('handover follows the Context cap line for Roles; the Lead keeps its own 150k', () => {
  has(pipeline, '`status: handover` → the Role reached the handover point of its `Context cap:`');
  assert.doesNotMatch(pipeline, /hit the 150k context budget/);
  has(pipeline, '**Your own budget is 150k too.**');
});

test('review depth is computed per dispatch from the diff, for the code-reviewer only', () => {
  has(pipeline, 'review-depth.mjs', '--risk', 'per dispatch', 'Fix-round', 'never from a builder');
});

test('each Step is linted, then recorded in the ledger from the notification integers only', () => {
  has(pipeline, 'handoff-lint.mjs', '--require-top', 'code-reviewer', 'senior-engineer', 'no Fix round');
  has(pipeline, 'ledger.mjs" add <slug> step <NN> <role> <agentId> <ctx_end>', '<subagent_tokens>', 'matches `^[A-Za-z0-9_-]{1,64}$`', 'no such block → `0`');
  has(pipeline, /integers only/i);
});

test('the ledger is reconciled and the cost line built before the Ship Gate, shown at Ship only', () => {
  has(pipeline, 'ledger.mjs" reconcile <slug>', 'ledger.mjs" ship <slug>', 'ledger.mjs" report <slug>');
  has(pipeline, 'spend', 'cache read', 'per shipped AC', 'context at end (not cost)', 'at the Ship Gate only');
});

test('tool checks come first in the pre-filter; a T- row blocks only after the reviewer confirms', () => {
  const at = pipeline.indexOf('**Pre-filter');
  assert.ok(at >= 0);
  const pre = pipeline.slice(at, at + 1600);
  assert.ok(pre.indexOf('rule-check.mjs') >= 0 && pre.indexOf('rule-check.mjs') < pre.indexOf('npm run check'), pre);
  has(pre, 'run --base <sha>', '`list`', 'T-', 'does **not** consume a Fix round');
});

test('slices are checked before builders; drift runs after sign-off and before Ship', () => {
  has(pipeline, 'rule-check.mjs" slices', 'rule-check.mjs" drift');
  const signoff = pipeline.slice(pipeline.indexOf('**Ruleset sign-off:**'), pipeline.indexOf('**Ruleset sign-off:**') + 700);
  has(signoff, 'rule-check.mjs" drift');
  const finish = pipeline.slice(pipeline.indexOf('## 6. Finish'));
  has(finish, 'rule-check.mjs" drift', /before the Ship Gate/i);
});

test('builders get Rule slice: after Input Handoffs: instead of the senior-engineer Handoff (dispatch-prompt v3.1)', () => {
  const names = stepBlock().filter(l => !l.startsWith('#')).map(l => l.split(':')[0]);
  assert.equal(names[names.indexOf('Input Handoffs') + 1], 'Rule slice');
  const bullet = skillOnly.split('\n').find(l => l.startsWith('- **Builders**'));
  assert.ok(bullet, 'builders bullet present');
  has(bullet, '.company/work/<slug>/rules/<task>.md', 'directly after `Input Handoffs:`', "no longer the Senior Engineer's Handoff", 'from the plan, never from Role output');
  has(bullet, 'rule-check.mjs" slices <that Handoff>', "no slice file for the builder's task", 'no Fix round');
  has(bullet, 'blocked — missing rule slice', 'no ruleset', 'at most 3');
});

test('the findings ledger of a pilot reviewer is committed only when it exists; a handover without one is re-dispatched', () => {
  const commit = skillOnly.split('\n').find(l => l.startsWith('- Commit **only that Step'));
  has(commit, '.findings.md', 'only when it exists');
  const after = skillOnly.split('\n').find(l => l.startsWith('- After each Step'));
  has(after, 'handover without findings ledger', 'finding <ID> missing from ledger', 'cannot locate ledger', 'same Step', 'no Fix round');
});

test('the commit line is built from checked values in single quotes (agentsec.M-SEC7)', () => {
  const line = skillOnly.split('\n').find(l => l.startsWith('- Commit **only that Step'));
  assert.ok(line, 'commit line present');
  has(line, 'git --literal-pathspecs add -- ', "git commit -m '<type>: <summary>' -- ", 'git status --porcelain', '`..`', 'control character', '.env');
  assert.doesNotMatch(line, /git commit -m "/);
  assert.doesNotMatch(line, /git add <those paths>/);
  has(line, 'The `<type>` stays English; the summary after it is written in `Language:`', 'Never `git add -A`', 'Parallel Steps get one commit each, in turn');
  has(line, 'no `aico:`, `aico/`, `[builder]`, `senior-engineer:`');
});

test('rewritten lines keep their rules: settings, locks, auto Gates, Name:, Language:', () => {
  has(skillOnly, 'never re-resolve mid-run', '`aico-settings` v1', 'Locks are already applied', 'Language: <tag from Setup §1.6>', "Name: <the Role's name from Setup §1.7>");
  has(skillOnly, '**Auto Gates (§1.7):**', 'it never merges', 'An auto **Plan Gate** still stops with a form', 'A Gate is never skipped', '**Always a form, whatever the settings say:**');
  has(skillOnly, 'A resolved model of `inherit` means your own session model', 'Never pass the literal `inherit`');
  has(skillOnly, '`Design skills:` lists the names in `.company/project.md` `## Design skills`');
});

test('SKILL.md stays within 125 lines and every file is LF only', () => {
  assert.ok(skillOnly.replace(/\n$/, '').split('\n').length <= 125);
  for (const f of ['skills/pipeline/SKILL.md', 'scripts/prompt-order.test.mjs', 'scripts/check.mjs', 'scripts/check.test.mjs', ...refs.map(r => `skills/pipeline/references/${r}`)])
    assert.ok(!read(f).includes('\r'), `${f} has a CR byte`);
});
