// QA-first for P20261109.000009-T11 (AC15): handoff-lint attributes a Handoff at
// `.company/work/<ID>/<NN>-<pb>/<step>.md` to that run and still accepts the v2 layout.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.join(import.meta.dirname, 'handoff-lint.mjs');
const repo = path.join(import.meta.dirname, '..');
const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const ID = 'P20261109.000009';
const OTHER = 'P20261109.000010';
const RUN = `${ID}/01-feature`;
const V2 = `${ID}-10.00.00`;
// The handoff Contract version of this tree, read from its doc so the citation never drifts.
const HANDOFF_V = /^# Contract: (handoff v\d+\.\d+)/.exec(fs.readFileSync(path.join(repo, 'docs', 'contracts', 'handoff.md'), 'utf8'))[1];

const handoff = (task) => `---
step: 03
role: qa
task: ${task}
status: done
round: 0
base-commit: 079d7863b895c7359738a05977681fdbc33b4997
risk-tier: high
contracts: [${HANDOFF_V}]
---
By: qa
## Did
- x
## Decisions
- y
## Blocking
- none
## Nits
- none
## Next
- z
`;

function root() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-v3-'));
  roots.push(r);
  return r;
}
function v3Run(r, slug = RUN) {
  const dir = path.join(r, '.company', 'work', ...slug.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(path.dirname(dir), '00-project.md'), 'A demo project\n');
  return dir;
}
function v2Run(r) {
  const dir = path.join(r, '.company', 'work', V2);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '00-summary.md'), 'A demo project\n');
  return dir;
}
function lintFile(dir, task, name = '03-qa.md') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, handoff(task));
  const r = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout };
}

test('AC15: a v3 Handoff whose task is its run slug passes', () => {
  const r = lintFile(v3Run(root()), RUN);
  assert.equal(r.code, 0, r.out);
});

test('AC15: a v3 Handoff may name a ticket of its project', () => {
  const r = lintFile(v3Run(root()), `${ID}-T10`);
  assert.equal(r.code, 0, r.out);
});

test('AC15: a v3 run folder needs no 00-summary.md (the project folder holds 00-project.md)', () => {
  const r = lintFile(v3Run(root()), RUN);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /00-summary\.md/);
});

test('AC15: a v3 Handoff naming another project run or ticket is refused', () => {
  const dir = v3Run(root());
  assert.equal(lintFile(dir, RUN).code, 0);
  for (const task of [`${OTHER}/01-feature`, `${OTHER}-T3`]) {
    const r = lintFile(dir, task);
    assert.equal(r.code, 1, `${task}: ${r.out}`);
    assert.match(r.out, /task must be/);
  }
});

test('AC15: in a v3 run folder the task is compared with the run path, so a sibling run slug is refused', () => {
  const r = root();
  v3Run(r, `${ID}/02-fix`);
  const dir = v3Run(r);
  assert.equal(lintFile(dir, RUN).code, 0);
  const res = lintFile(dir, `${ID}/02-fix`);
  assert.equal(res.code, 1, res.out);
});

test('AC15: a malformed v3 slug is refused', () => {
  const dir = v3Run(root());
  assert.equal(lintFile(dir, RUN).code, 0);
  for (const task of [`${ID}/1-feature`, `${ID}/01-feature/../x`, `${ID}//01-feature`, `${ID}/01-Feature`]) {
    assert.equal(lintFile(dir, task).code, 1, task);
  }
});

test('AC15 and AC7: the v2 layout is accepted exactly as before', () => {
  const dir = v2Run(root());
  assert.equal(lintFile(dir, V2).code, 0);
  assert.equal(lintFile(dir, `${ID}-T4`).code, 0);
  const bad = lintFile(dir, `${OTHER}-T4`);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /task must be/);
});

test('AC15: --applied accepts a v3 run folder and names its slug', () => {
  const dir = v3Run(root());
  const r = spawnSync(process.execPath, [script, '--applied', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  assert.ok(r.stdout.includes(`exceptions on file for ${RUN}`), r.stdout);
});

test('AC15: --exceptions-for accepts a v3 run slug and refuses a bad one', () => {
  const r = root();
  v3Run(r);
  const run = (arg) => spawnSync(process.execPath, [script, '--exceptions-for', arg], { cwd: r, encoding: 'utf8' });
  const ok = run(RUN);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /exceptions on file: 0/);
  for (const bad of [`${ID}`, `${ID}/01-feature/x`, `${ID}/..`, '..\\x']) assert.equal(run(bad).status, 2, bad);
});
