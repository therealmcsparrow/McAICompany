import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main as approve, dropFreshRun } from './ticket-approval.mjs';

const ID = 'P20261108.000001';
const PARENT = `${ID}-22.25.00`;
const BASE = 'a'.repeat(40);
const NL = '\n';
const T1 = new Date(2026, 10, 8, 22, 31, 7).getTime();
const T2 = new Date(2026, 10, 8, 22, 40, 9).getTime();

const block = (n, id = ID) => [`### ${id}-T${n} a task`, '- role: backend-engineer', `- files: src/t${n}.mjs`, '- depends-on: none', ''].join(NL);
const plan = (...n) => planFor(ID, ...n);
function planFor(id, ...n) { return ['# Plan: demo', '', `Base commit: ${BASE}`, '', '## Tasks', '', ...n.map((x) => block(x, id))].join(NL) + NL; }

const roots = [];
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-home-'));
const saved = {};
before(() => {
  for (const k of ['MCSPARROW_HOME', 'HOME', 'USERPROFILE']) { saved[k] = process.env[k]; process.env[k] = home; }
});
after(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  for (const r of [...roots, home]) fs.rmSync(r, { recursive: true, force: true });
});

function fixture(planText) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-')));
  roots.push(root);
  const dir = path.join(root, '.company', 'work', PARENT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'project.md'), '# Project profile\n\n## Core\n- skills/pipeline: x\n\n## Modules\n- skills/other: x\n');
  fs.writeFileSync(path.join(dir, 'plan.md'), planText);
  fs.writeFileSync(path.join(dir, '00-summary.md'), 'Rename projects by one ID\n\nRun: first feature\n');
  const run = (now, ...args) => approve(args, { now, root });
  const approveAll = (...ids) => {
    assert.equal(run(T1, 'tickets', PARENT, 'plan.md', '--phase', 'd').code, 0);
    for (const id of [...ids, 'S0']) assert.equal(run(T1, 'ticket', PARENT, id, 'approve').code, 0, id);
  };
  const work = path.join(root, '.company', 'work');
  const events = () => fs.readFileSync(path.join(dir, 'tickets.jsonl'), 'utf8').split(NL).filter(Boolean).map((l) => JSON.parse(l));
  const addRun = (name, summaryLine3, planText) => {
    const d = path.join(work, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, '00-summary.md'), `Other run

${summaryLine3}
`);
    fs.writeFileSync(path.join(d, 'plan.md'), planText);
  };
  return { run, approveAll, work, dir, events, addRun, root };
}

const planLine = (r) => r.lines.find((l) => l.startsWith('plan: '));

test('R-4 (a) a resumed build-plan refuses file exists, prints the earlier Build run plan, makes no second run', () => {
  const f = fixture(plan(1, 2));
  f.approveAll(`${ID}-T1`, `${ID}-T2`);
  const first = f.run(T1, 'build-plan', PARENT);
  assert.equal(first.code, 0, first.lines.join(NL));
  const firstPlan = planLine(first);
  assert.match(firstPlan, /^plan: \.company\/work\/P20261108\.000001-22\.31\.07\/plan\.md$/);
  const folders = fs.readdirSync(f.work).sort();
  const events = f.events();
  const second = f.run(T2, 'build-plan', PARENT);
  assert.equal(second.code, 3, second.lines.join(NL));
  assert.equal(second.lines[0], 'refused: file exists');
  assert.equal(second.lines[1], firstPlan);
  assert.deepEqual(fs.readdirSync(f.work).sort(), folders);
  assert.deepEqual(f.events(), events);
});

test('R-4 (b) archiving the earlier Build run lets build-plan build a new run', () => {
  const f = fixture(plan(1, 2));
  f.approveAll(`${ID}-T1`, `${ID}-T2`);
  const first = f.run(T1, 'build-plan', PARENT);
  assert.equal(first.code, 0, first.lines.join(NL));
  const name = `${ID}-22.31.07`;
  assert.equal(f.run(T2, 'build-plan', PARENT).code, 3);
  const archive = path.join(f.root, '.company', 'archive');
  fs.mkdirSync(archive, { recursive: true });
  fs.renameSync(path.join(f.work, name), path.join(archive, name));
  const again = f.run(T2, 'build-plan', PARENT);
  assert.equal(again.code, 0, again.lines.join(NL));
  assert.equal(again.lines[0], 'built 2 tickets');
  assert.equal(planLine(again), `plan: .company/work/${ID}-22.40.09/plan.md`);
  assert.deepEqual(fs.readdirSync(f.work).sort(), [PARENT, `${ID}-22.40.09`]);
  assert.equal(f.events().filter((e) => e.ev === 'build').length, 2);
});

test('R-4 (c) a non-build run of the same project holding the same IDs is not a match', () => {
  const f = fixture(plan(1, 2));
  f.approveAll(`${ID}-T1`, `${ID}-T2`);
  f.addRun(`${ID}-22.20.00`, 'Run: later feature', plan(1, 2));
  const r = f.run(T1, 'build-plan', PARENT);
  assert.equal(r.code, 0, r.lines.join(NL));
  assert.equal(r.lines[0], 'built 2 tickets');
});

test('R-4 (d) a Build run of another project with the same local IDs is not a match', () => {
  const f = fixture(plan(1, 2));
  f.approveAll(`${ID}-T1`, `${ID}-T2`);
  const other = 'P20261108.000002';
  f.addRun(`${other}-22.20.00`, 'Run: build feature', planFor(other, 1, 2));
  const r = f.run(T1, 'build-plan', PARENT);
  assert.equal(r.code, 0, r.lines.join(NL));
  assert.equal(r.lines[0], 'built 2 tickets');
});

test('R-4 (e) a build-plan with a different approved set still makes a new Build run', () => {
  const f = fixture(plan(1, 2));
  f.approveAll(`${ID}-T1`, `${ID}-T2`);
  assert.equal(f.run(T1, 'build-plan', PARENT).code, 0);
  fs.writeFileSync(path.join(f.dir, 'plan.md'), plan(1, 2, 3));
  f.approveAll(`${ID}-T3`);
  const r = f.run(T2, 'build-plan', PARENT);
  assert.equal(r.code, 0, r.lines.join(NL));
  assert.equal(r.lines[0], 'built 3 tickets');
  assert.equal(fs.readdirSync(f.work).length, 3);
});

test('dropFreshRun leaves a symlink or junction at the run folder untouched', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-link-')));
  roots.push(root);
  const work = path.join(root, '.company', 'work');
  const target = path.join(root, 'elsewhere');
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, '00-summary.md'), 'keep\n');
  const name = `${ID}-22.31.07`;
  fs.symlinkSync(target, path.join(work, name), 'junction');
  dropFreshRun(root, name);
  assert.equal(fs.readFileSync(path.join(target, '00-summary.md'), 'utf8'), 'keep\n');
  assert.ok(fs.lstatSync(path.join(work, name)).isSymbolicLink());
});

test('dropFreshRun refuses a name that is not a work folder name', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-name-')));
  roots.push(root);
  const company = path.join(root, '.company');
  const nested = path.join(company, 'work', 'a', 'b');
  const outside = path.join(company, 'x');
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(nested, '00-summary.md'), 'keep\n');
  fs.writeFileSync(path.join(outside, '00-summary.md'), 'keep\n');
  dropFreshRun(root, '../x');
  dropFreshRun(root, 'a/b');
  assert.equal(fs.readFileSync(path.join(outside, '00-summary.md'), 'utf8'), 'keep\n');
  assert.equal(fs.readFileSync(path.join(nested, '00-summary.md'), 'utf8'), 'keep\n');
});
