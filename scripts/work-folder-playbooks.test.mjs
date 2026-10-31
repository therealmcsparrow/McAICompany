// Setup and the Playbooks name run folders through `work-folder new` and quote the printed name on every shell line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};
const lacks = (text, ...needles) => {
  for (const n of needles) assert.ok(!(n instanceof RegExp ? n.test(text) : text.includes(n)), `still there: ${n}`);
};
const pipeline = read('skills/pipeline/SKILL.md');
const setupLine = (n) => pipeline.split('\n').find((l) => l.startsWith(`${n}. `));

const FILES = [
  'skills/pipeline/SKILL.md', 'skills/pipeline/references/run-state.md', 'skills/pipeline/references/contest.md',
  'skills/pipeline/references/plan-review.md', 'skills/research/SKILL.md', 'skills/brainstorm/SKILL.md',
  'skills/audit/SKILL.md', 'skills/report/SKILL.md', 'skills/vulnscan/SKILL.md', 'skills/client/SKILL.md',
  'skills/feedback/SKILL.md',
];

test('Setup item 1 writes the Topic with Write and runs work-folder new', () => {
  const one = setupLine(1);
  has(one, 'Write tool', '.company/work-folder-topic-<id>.txt', 'never goes on a shell line',
    "work-folder new --playbook '<id>' --topic file", '--topic none', 'mkdir -p .company/work');
  assert.ok(one.indexOf('mkdir -p .company/work') < one.indexOf('work-folder new'));
  has(one, "work-folder clear --playbook '<id>'", 'never `--topic none`', 'no second try');
  has(one, "work-folder branch '<name>'", '`draft-input`', 'resumed run', 'The `name:` line is the slug');
  has(one, "--exceptions-for '<slug>'");
  lacks(one, 'kebab-case');
});

test('Setup item 3 uses the printed branch value as is and never prefixes aico/ again', () => {
  const three = setupLine(3);
  has(three, 'printed `branch:` value as is', 'never prefix', "git checkout -b '<branch>'");
  lacks(three, 'aico/<slug>');
  lacks(pipeline, 'aico/<slug>');
});

test('pipeline shell lines single-quote the run name', () => {
  has(pipeline, "--run '<slug>' --risk", "ledger add '<slug>' step", "ledger reconcile '<slug>'",
    "ledger report '<slug>' --acs", "ledger ship '<slug>' <acs>", "--run '<slug>'`");
  lacks(pipeline, /(--run|ledger (add|reconcile|report|ship)) <slug>/);
});

test('pipeline SKILL.md stays within 125 lines', () => {
  assert.ok(pipeline.split('\n').length - (pipeline.endsWith('\n') ? 1 : 0) <= 125);
});

test('the Plan Gate line is the quoted run-state form', () => {
  const rs = read('skills/pipeline/references/run-state.md');
  has(rs, "run-state gate '<slug>' plan passed", 'the name exactly as printed', 'single spaces');
  lacks(rs, 'no quotes', 'a quoted form', 'the mod does not see it');
  assert.equal(rs.split('\n').filter((l) => l.startsWith('- The Plan Gate')).length, 1);
});

test('contest and plan-review quote the run folder in shell lines', () => {
  const contest = read('skills/pipeline/references/contest.md');
  has(contest, "--contests '.company/work/<slug>'", "--applied '.company/work/<slug>'", "--exceptions-for '<slug>'");
  lacks(contest, /handoff-lint --(contests|applied) \.company/, '--exceptions-for <slug>');
  has(read('skills/pipeline/references/plan-review.md'), "lines '<slug>'", "plan-review gate '<slug>'");
});

test('feedback ledger lines quote the run', () => {
  const fb = read('skills/feedback/SKILL.md');
  has(fb, "ledger report '<run>'", "ledger scorecard '<run>'");
  lacks(fb, 'ledger report <run>', 'ledger scorecard <run>');
});

test('research names its folder through work-folder new and keeps the Short Topic rule', () => {
  const r = read('skills/research/SKILL.md');
  has(r, "work-folder new --playbook 'research' --topic file", '.company/work-folder-topic-research.txt', 'Write tool',
    'makes no branch', '.company/work/<name>/', 'allow-list regex', 'at most 60 characters');
  lacks(r, 'research-<slug>');
});

test('brainstorm falls back to the work folder Topic, not a run slug', () => {
  const b = read('skills/brainstorm/SKILL.md');
  has(b, 'work folder fallback Topic', '`Brainstorm`', 'Never strip or repair');
  lacks(b, '^[a-z0-9]+(-[a-z0-9]+){0,4}$', 'uses the run slug');
});

test('the pipeline Playbooks read their folder name from Setup item 1', () => {
  // audit and vulnscan stay as pinned in the v0.12.0 Playbook check, so they say nothing of their own.
  for (const id of ['report', 'client', 'feedback']) {
    has(read(`skills/${id}/SKILL.md`), '`<slug>` is the work folder name from `aico:pipeline` Setup item 1');
  }
});

test('no file here carries a CR byte or a Name: line', () => {
  for (const f of FILES) {
    const t = read(f);
    lacks(t, '\r');
    lacks(t, /^Name:/m);
  }
});
