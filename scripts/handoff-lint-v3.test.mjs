// Tests: handoff-lint attributes a Handoff at
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

test('a v3 Handoff whose task is its run slug passes', () => {
  const r = lintFile(v3Run(root()), RUN);
  assert.equal(r.code, 0, r.out);
});

test('a v3 Handoff may name a ticket of its project', () => {
  const r = lintFile(v3Run(root()), `${ID}-T10`);
  assert.equal(r.code, 0, r.out);
});

test('a v3 run folder needs no 00-summary.md (the project folder holds 00-project.md)', () => {
  const r = lintFile(v3Run(root()), RUN);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /00-summary\.md/);
});

test('a v3 Handoff naming another project run or ticket is refused', () => {
  const dir = v3Run(root());
  assert.equal(lintFile(dir, RUN).code, 0);
  for (const task of [`${OTHER}/01-feature`, `${OTHER}-T3`]) {
    const r = lintFile(dir, task);
    assert.equal(r.code, 1, `${task}: ${r.out}`);
    assert.match(r.out, /task must be/);
  }
});

test('in a v3 run folder the task is compared with the run path, so a sibling run slug is refused', () => {
  const r = root();
  v3Run(r, `${ID}/02-fix`);
  const dir = v3Run(r);
  assert.equal(lintFile(dir, RUN).code, 0);
  const res = lintFile(dir, `${ID}/02-fix`);
  assert.equal(res.code, 1, res.out);
});

test('a malformed v3 slug is refused', () => {
  const dir = v3Run(root());
  assert.equal(lintFile(dir, RUN).code, 0);
  for (const task of [`${ID}/1-feature`, `${ID}/01-feature/../x`, `${ID}//01-feature`, `${ID}/01-Feature`]) {
    assert.equal(lintFile(dir, task).code, 1, task);
  }
});

test('the v2 layout is accepted exactly as before', () => {
  const dir = v2Run(root());
  assert.equal(lintFile(dir, V2).code, 0);
  assert.equal(lintFile(dir, `${ID}-T4`).code, 0);
  const bad = lintFile(dir, `${OTHER}-T4`);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /task must be/);
});

test('--applied accepts a v3 run folder and names its slug', () => {
  const dir = v3Run(root());
  const r = spawnSync(process.execPath, [script, '--applied', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  assert.ok(r.stdout.includes(`exceptions on file for ${RUN}`), r.stdout);
});

test('--exceptions-for accepts a v3 run slug and refuses a bad one', () => {
  const r = root();
  v3Run(r);
  const run = (arg) => spawnSync(process.execPath, [script, '--exceptions-for', arg], { cwd: r, encoding: 'utf8' });
  const ok = run(RUN);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /exceptions on file: 0/);
  for (const bad of [`${ID}`, `${ID}/01-feature/x`, `${ID}/..`, '..\\x']) assert.equal(run(bad).status, 2, bad);
});

// ---- exceptions and rulings of a v3 run

const KEY = '10-code-reviewer:R-1';
const reviewer = `---
step: 10
role: code-reviewer
task: ${RUN}
status: done
round: 0
base-commit: 079d7863b895c7359738a05977681fdbc33b4997
risk-tier: high
---
By: code-reviewer
## Blocking
- R-1 | a.js:1 | first
`;
const escalation = `---
step: 20
role: backend-engineer
task: ${RUN}
status: done
round: 1
base-commit: 079d7863b895c7359738a05977681fdbc33b4997
risk-tier: high
---
By: backend-engineer
## Contested
- ${KEY} — escalate — the reviewer is wrong about this, the CEO should decide
`;
const exc = (slug, date = '2026-11-10') => `- ${slug}/${KEY} — scope — reason — approved: ${date} (CEO)`;
const ruling = `- ${KEY} — upheld — because — ruled: 2026-11-10 (CEO)`;

// A v3 run folder with a reviewer finding, a builder escalation and a run start; `dir` is the run folder.
async function filled(r, slug = RUN) {
  const dir = v3Run(r, slug);
  fs.writeFileSync(path.join(dir, '10-code-reviewer.md'), reviewer);
  fs.writeFileSync(path.join(dir, '20-backend-engineer.md'), escalation);
  const { append } = await import('./run-state.mjs');
  append(r, slug, { ev: 'start' }, { now: Date.UTC(2026, 10, 9, 12, 0, 0) });
  return dir;
}
const standards = (r, ...lines) => fs.writeFileSync(path.join(r, '.company', 'standards.md'), `# Standards\n\n## Exceptions\n${lines.join('\n')}\n`);
const applied = (dir) => spawnSync(process.execPath, [script, '--applied', dir], { encoding: 'utf8' });
const counted = (out) => Number(/exceptions on file for \S+: confirm each is yours \((\d+)\)/.exec(out)[1]);

test('handoff v2.6: an exception line naming the v3 run slug is counted and applied', async () => {
  const r = root();
  const dir = await filled(r);
  standards(r, exc(RUN));
  const res = applied(dir);
  assert.equal(res.status, 0, res.stdout);
  assert.equal(counted(res.stdout), 1, res.stdout);
  assert.ok(res.stdout.includes(exc(RUN)), res.stdout);
  const { contests } = await import('./handoff-lint.mjs');
  assert.deepEqual(contests(dir).excepted, [KEY]);
  const f = spawnSync(process.execPath, [script, '--exceptions-for', RUN], { cwd: r, encoding: 'utf8' });
  assert.match(f.stdout, /exceptions on file: 1/);
});

test('handoff v2.6: a line dated before the run started is not applied', async () => {
  const r = root();
  const dir = await filled(r);
  standards(r, exc(RUN, '2026-11-08'));
  assert.equal(counted(applied(dir).stdout), 0);
});

test('handoff v2.6: a sibling run slug and a three-part slug are not counted for this run', async () => {
  const r = root();
  const dir = await filled(r);
  v3Run(r, `${ID}/02-fix`);
  standards(r, exc(`${ID}/02-fix`), exc(`${RUN}/extra`), exc(`${OTHER}/01-feature`), exc(ID));
  const res = applied(dir);
  assert.equal(res.status, 0, res.stdout);
  assert.equal(counted(res.stdout), 0, res.stdout);
  const { contests } = await import('./handoff-lint.mjs');
  assert.deepEqual(contests(dir).excepted, []);
  const f = spawnSync(process.execPath, [script, '--exceptions-for', RUN], { cwd: r, encoding: 'utf8' });
  assert.match(f.stdout, /exceptions on file: 0/);
  const sib = spawnSync(process.execPath, [script, '--exceptions-for', `${ID}/02-fix`], { cwd: r, encoding: 'utf8' });
  assert.match(sib.stdout, /exceptions on file: 1/, 'the sibling slug counts only for the sibling');
});

test('handoff v2.6: a rulings.md in the nested run folder is applied', async () => {
  const r = root();
  const dir = await filled(r);
  fs.writeFileSync(path.join(dir, 'rulings.md'), `# Rulings\n\n## Rulings\n${ruling}\n`);
  const res = applied(dir);
  assert.equal(res.status, 0, res.stdout);
  assert.match(res.stdout, /^rulings on file: confirm each is yours \(1\)\n/);
  assert.ok(res.stdout.includes(`> ${ruling}`), res.stdout);
  const { contests } = await import('./handoff-lint.mjs');
  assert.equal(contests(dir).states.get(KEY), 'upheld');
});

test('handoff v2.6: a rulings.md in the project folder or a sibling run does not apply to this run', async () => {
  const r = root();
  const dir = await filled(r);
  const sibling = v3Run(r, `${ID}/02-fix`);
  fs.writeFileSync(path.join(sibling, 'rulings.md'), `# Rulings\n\n## Rulings\n${ruling}\n`);
  fs.writeFileSync(path.join(path.dirname(dir), 'rulings.md'), `# Rulings\n\n## Rulings\n${ruling}\n`);
  const res = applied(dir);
  assert.match(res.stdout, /^rulings on file: confirm each is yours \(0\)\n/, res.stdout);
});

test('handoff v2.6: a project folder in another letter case gives no exceptions and no rulings', async (t) => {
  const r = root();
  const dir = await filled(r);
  fs.writeFileSync(path.join(dir, 'rulings.md'), `# Rulings\n\n## Rulings\n${ruling}\n`);
  standards(r, exc(RUN));
  const { contests } = await import('./handoff-lint.mjs');
  const same = contests(dir);
  assert.deepEqual(same.excepted, [KEY], 'control: the exact case applies the exception');
  const work = path.join(r, '.company', 'work');
  fs.renameSync(path.join(work, ID), path.join(work, `${ID}.tmp`));
  fs.renameSync(path.join(work, `${ID}.tmp`), path.join(work, ID.toLowerCase()));
  if (!fs.existsSync(path.join(work, ID, '01-feature'))) { t.skip('the file system tells letter cases apart'); return; }
  const got = contests(path.join(work, ID, '01-feature'));
  assert.deepEqual(got.excepted, [], 'no exception applied');
  assert.notEqual(got.states.get(KEY), 'upheld', 'no ruling applied');
  assert.ok(got.warnings.some((w) => /on-disk name/.test(w)), got.warnings.join('\n'));
});
