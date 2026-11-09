import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main as approve } from './ticket-approval.mjs';
import { main as planTasks } from './plan-tasks.mjs';

// R-1 (Handoff 55): a real `ticket-approval build-plan` strips trailing spaces and tabs from each block
// line. The Build run's plan must still pass `plan-tasks check` next to the flow plan it was copied from.

const ID = 'P20261108.000001';
const PARENT = `${ID}-22.25.00`;
const BASE = 'a'.repeat(40);
const NL = '\n';
const T1 = new Date(2026, 10, 8, 22, 31, 7).getTime();
const ARROW = '\u2192';
const DASH = '\u2014';

const roots = [];
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bpc-home-'));
const saved = {};
before(() => {
  for (const k of ['MCSPARROW_HOME', 'HOME', 'USERPROFILE']) { saved[k] = process.env[k]; process.env[k] = home; }
});
after(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  for (const r of [...roots, home]) fs.rmSync(r, { recursive: true, force: true });
});

function block(n, { trail = '', file = `src/t${n}.mjs` } = {}) {
  return [
    `### ${ID}-T${n} a task${trail}`,
    `- role: backend-engineer${trail}`,
    `- files: ${file}${trail}`,
    `- depends-on: none${trail}`,
    '- parallel: yes',
    '- context: 20k',
    `- slice: a user submits the form ${ARROW} the page shows the saved row ${DASH} demo: ${file}${trail}`,
    `- seams: ${file}#run`,
    ''
  ].join(NL);
}
const plan = (...blocks) => ['# Plan: demo', '', `Base commit: ${BASE}`, '', '## Tasks', '', ...blocks].join(NL) + NL;

function fixture(planText) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'bpc-')));
  roots.push(root);
  const work = path.join(root, '.company', 'work');
  const dir = path.join(work, PARENT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'project.md'), '# Project profile\n\n## Core\n- skills/pipeline: x\n\n## Modules\n- skills/other: x\n');
  fs.writeFileSync(path.join(dir, 'plan.md'), planText);
  fs.writeFileSync(path.join(dir, '00-summary.md'), 'Rename projects by one ID\n\nRun: first feature\n');
  const pluginRoot = path.join(root, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'agents', 'backend-engineer.md'), 'agent\n');
  const run = (...args) => approve(args, { now: T1, root });
  assert.equal(run('tickets', PARENT, 'plan.md', '--phase', 'd').code, 0);
  const buildRun = (ids) => {
    for (const id of [...ids, 'S0']) assert.equal(run('ticket', PARENT, id, 'approve').code, 0, id);
    const r = run('build-plan', PARENT);
    assert.equal(r.code, 0, r.lines.join(NL));
    const made = fs.readdirSync(work).filter((n) => n !== PARENT);
    assert.equal(made.length, 1, made.join(','));
    const built = fs.readdirSync(path.join(work, made[0])).find((n) => /plan\.md$/.test(n));
    assert.ok(built, 'build run has a plan file');
    return { folder: made[0], file: built };
  };
  const check = (folder, file) =>
    planTasks(['check', folder, file, '--cap', '3', '--mode', 'parallel'], { now: T1, root, pluginRoot, home });
  return { work, dir, buildRun, check };
}

const text = (r) => r.lines.join(NL);

test('R-1: trailing spaces and tabs on ticket lines do not make the Build run plan ticket-reused', () => {
  const f = fixture(plan(block(1, { trail: '  \t ' }), block(2, { trail: '\t' })));
  const b = f.buildRun([`${ID}-T1`, `${ID}-T2`]);
  const built = fs.readFileSync(path.join(f.work, b.folder, b.file), 'utf8');
  assert.ok(!/[ \t]+$/m.test(built.split(NL).filter((l) => l.startsWith('- role')).join(NL)), 'build-plan strips trailing whitespace');
  const r = f.check(b.folder, b.file);
  assert.equal(r.code, 0, text(r));
});

test('R-1: a genuinely different sibling block under the same ID is still refused', () => {
  const f = fixture(plan(block(1, { trail: '  ' })));
  const b = f.buildRun([`${ID}-T1`]);
  const p = path.join(f.work, b.folder, b.file);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('src/t1.mjs', 'src/other.mjs'));
  const r = f.check(b.folder, b.file);
  assert.notEqual(r.code, 0);
  assert.ok(text(r).includes('ticket-reused'), text(r));
});

test('R-9: only trailing spaces, tabs and blank lines are ignored, other trailing whitespace makes a different block', () => {
  const f = fixture(plan(block(1)));
  const b = f.buildRun([`${ID}-T1`]);
  const p = path.join(f.work, b.folder, b.file);
  const s = fs.readFileSync(p, 'utf8');
  assert.ok(s.includes('#run'), 'seams line present');
  fs.writeFileSync(p, s.replace(/(- seams: [^\n]*#run)/, '$1\u00A0'));
  const r = f.check(b.folder, b.file);
  assert.notEqual(r.code, 0);
  assert.ok(text(r).includes('ticket-reused'), text(r));
});
