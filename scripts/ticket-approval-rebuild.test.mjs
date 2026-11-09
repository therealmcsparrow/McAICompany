import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main as approve } from './ticket-approval.mjs';

const ID = 'P20261108.000001';
const PARENT = `${ID}-22.25.00`;
const BASE = 'a'.repeat(40);
const NL = '\n';
const T1 = new Date(2026, 10, 8, 22, 31, 7).getTime();
const T2 = new Date(2026, 10, 8, 22, 40, 9).getTime();

const block = (n) => [`### ${ID}-T${n} a task`, '- role: backend-engineer', `- files: src/t${n}.mjs`, '- depends-on: none', ''].join(NL);
const plan = (...n) => ['# Plan: demo', '', `Base commit: ${BASE}`, '', '## Tasks', '', ...n.map(block)].join(NL) + NL;

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
  return { run, approveAll, work, dir, events };
}

test('a resumed build-plan with the same approved IDs refuses file exists and makes no second Build run', () => {
  const f = fixture(plan(1, 2));
  f.approveAll(`${ID}-T1`, `${ID}-T2`);
  const first = f.run(T1, 'build-plan', PARENT);
  assert.equal(first.code, 0, first.lines.join(NL));
  const folders = fs.readdirSync(f.work).sort();
  const events = f.events();
  const second = f.run(T2, 'build-plan', PARENT);
  assert.equal(second.code, 3);
  assert.equal(second.lines[0], 'refused: file exists');
  assert.deepEqual(fs.readdirSync(f.work).sort(), folders);
  assert.deepEqual(f.events(), events);
});

test('a build-plan with a different approved set still makes a new Build run', () => {
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
