import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LINT = fileURLToPath(new URL('./handoff-lint.mjs', import.meta.url));
const PROJECT = 'P20261108.000001';
const OTHER = 'P20261108.000002';
const V2 = `${PROJECT}-22.25.00`;
const V11 = '2026-11-08 22.25 - Demo Run';
const LEGACY = 'demo-run';
const GOOD = 'Name projects with an ID\n\nRun: first feature\n';

const handoff = task => `---
step: 01
role: qa
task: ${task}
status: done
round: 0
base-commit: d39e8824d81e98a0a3333119ce71881a5716bd0b
risk-tier: high
contracts: []
---
By: qa
## Did
- Wrote tests.
## Blocking
- none
## Next
- The builder runs them.
`;

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'project-summary-lint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function lintFile(file, root) {
  const r = spawnSync(process.execPath, [LINT, file], { cwd: root, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: root, HOME: root, USERPROFILE: root } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// Makes a run folder under .company/work, optionally with a 00-summary.md, and lints a Handoff in it.
function run(root, folder, task, summary) {
  const dir = join(root, '.company', 'work', folder);
  mkdirSync(dir, { recursive: true });
  if (summary !== undefined) writeFileSync(join(dir, '00-summary.md'), summary);
  const file = join(dir, '01-qa.md');
  writeFileSync(file, handoff(task));
  return lintFile(file, root);
}

// The failure must come from the summary, not from the task: line.
const fromSummary = out => assert.ok(!/task must be/.test(out), 'failed on task:, not on the summary');

// ---------- hostile cases first ----------

test('a description with a bidi, zero-width, Mongolian vowel separator or tag character fails and is never echoed', t => {
  for (const bad of ['‮', '​', '᠎', '\u{E0001}']) {
    const root = sandbox(t);
    const r = run(root, V2, V2, `Secret${bad}words\n\nRun: first feature\n`);
    assert.equal(r.code, 1, JSON.stringify(bad));
    assert.match(r.out, /ERROR/);
    fromSummary(r.out);
    assert.ok(!r.out.includes(bad), `echoed ${JSON.stringify(bad)}`);
    assert.ok(!r.out.includes('Secret'), 'description text echoed');
  }
});

test('a symlinked 00-summary.md is not followed', t => {
  const root = sandbox(t);
  const elsewhere = join(root, 'elsewhere.md');
  writeFileSync(elsewhere, GOOD);
  const dir = join(root, '.company', 'work', V2);
  mkdirSync(dir, { recursive: true });
  try {
    symlinkSync(elsewhere, join(dir, '00-summary.md'));
  } catch (e) {
    t.skip(`symlink not available: ${e.code}`);
    return;
  }
  const file = join(dir, '01-qa.md');
  writeFileSync(file, handoff(V2));
  const r = lintFile(file, root);
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR/);
  fromSummary(r.out);
});

test('a hard-linked 00-summary.md is not read', t => {
  const root = sandbox(t);
  const elsewhere = join(root, 'elsewhere.md');
  writeFileSync(elsewhere, GOOD);
  const dir = join(root, '.company', 'work', V2);
  mkdirSync(dir, { recursive: true });
  linkSync(elsewhere, join(dir, '00-summary.md'));
  const file = join(dir, '01-qa.md');
  writeFileSync(file, handoff(V2));
  const r = lintFile(file, root);
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR/);
  fromSummary(r.out);
});

test('a v2 folder without 00-summary.md fails', t => {
  const r = run(sandbox(t), V2, V2);
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR/);
  fromSummary(r.out);
});

// ---------- summary description (AC4, lint side) ----------

test('a v2 folder with a good one-line description passes (AC4)', t => {
  const r = run(sandbox(t), V2, V2, GOOD);
  assert.equal(r.code, 0, r.out);
});

test('a v2 folder with an empty or blank first line fails with missing description (AC4)', t => {
  for (const summary of ['', '\n', '   \n\nRun: first feature\n']) {
    const r = run(sandbox(t), V2, V2, summary);
    assert.equal(r.code, 1, JSON.stringify(summary));
    assert.match(r.out, /ERROR [^\n]*missing description/, JSON.stringify(summary));
  }
});

test('a v2 folder whose line 2 is not empty fails with multi-line description (AC4)', t => {
  for (const summary of ['One line\nSecond line\nRun: first feature\n', 'One line\nRun: first feature\n']) {
    const r = run(sandbox(t), V2, V2, summary);
    assert.equal(r.code, 1, JSON.stringify(summary));
    assert.match(r.out, /ERROR [^\n]*multi-line description/, JSON.stringify(summary));
  }
});

test('a description over 120 characters fails', t => {
  const r = run(sandbox(t), V2, V2, `${'a'.repeat(121)}\n\nRun: first feature\n`);
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR/);
  fromSummary(r.out);
});

test('v1.1 and legacy folders need no 00-summary.md (AC4)', t => {
  assert.equal(run(sandbox(t), V11, V11).code, 0);
  assert.equal(run(sandbox(t), LEGACY, LEGACY).code, 0);
});

// ---------- task: shapes (AC10) ----------

test('task: of the v2 folder name passes (AC10)', t => {
  assert.equal(run(sandbox(t), V2, V2, GOOD).code, 0);
});

test('task: of a ticket of the folder project passes (AC10)', t => {
  for (const id of [`${PROJECT}-T1`, `${PROJECT}-T12`, `${PROJECT}-T123`, `${PROJECT}-T4a`]) {
    const r = run(sandbox(t), V2, id, GOOD);
    assert.equal(r.code, 0, `${id}: ${r.out}`);
  }
});

test('task: of another project ticket, a bare ticket or a near-miss fails in a v2 folder (AC10)', t => {
  const bad = [`${OTHER}-T1`, 'T1', `${PROJECT}-T`, `${PROJECT}-T1234`, `${PROJECT}-T1A`, `${PROJECT}X-T1`, `${PROJECT.replace('.', 'X')}-T1`, `${PROJECT}-t1`, 'P20261108.1-T1'];
  for (const id of bad) {
    const r = run(sandbox(t), V2, id, GOOD);
    assert.equal(r.code, 1, id);
    assert.match(r.out, /ERROR [^\n]*task/, id);
  }
});

test('task: of a v1.1 or legacy ticket shape still passes in its own folder (AC10)', t => {
  assert.equal(run(sandbox(t), V11, 'T3').code, 0);
  assert.equal(run(sandbox(t), LEGACY, 'T3').code, 0);
  assert.equal(run(sandbox(t), V11, V11).code, 0);
});

test('task: of a v2 ticket in a v1.1 folder fails', t => {
  const r = run(sandbox(t), V11, `${PROJECT}-T1`);
  assert.equal(r.code, 1);
});
