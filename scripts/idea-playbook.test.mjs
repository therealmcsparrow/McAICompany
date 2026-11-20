import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main as flow } from './idea-flow.mjs';
import { main as approval } from './ticket-approval.mjs';

// A walk of the shipped provider scripts (idea-flow, ticket-approval) in route order.

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); tmps.push(d); return d; };


describe('idea-flow outside software', () => {
  test('outside software the tickets form has no build letter', () => {
    const cwd = tmp('idea-playbook-');
    const f = (...argv) => flow(argv, cwd);
    const optionLines = (r) => r.out.split('\n').filter((l) => l.startsWith('option '));
    f('start', 'idea-t', '--kind', 'idea');
    f('pick', 'idea-t', '1'); f('done', 'idea-t', 'grill'); f('done', 'idea-t', 'reprompt');
    f('pick', 'idea-t', 'D'); f('done', 'idea-t', 'to-spec'); f('done', 'idea-t', 'to-tickets');
    // the type changes after the tickets form opened (a record from a software run)
    fs.mkdirSync(path.join(cwd, '.company'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.company', 'project.md'), 'company_type: design\n');
    assert.deepEqual(optionLines(f('options', 'idea-t')).map((l) => l.split(' ')[2]), ['park-roadmap', 'park-idea']);
    assert.equal(f('pick', 'idea-t', 'F').code, 3);
  });

  test('outside software the routes form has no Spec and tickets', () => {
    const cwd = tmp('idea-playbook-');
    fs.mkdirSync(path.join(cwd, '.company'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.company', 'project.md'), 'company_type: research\n');
    const f = (...argv) => flow(argv, cwd);
    f('start', 'idea-u', '--kind', 'idea');
    f('pick', 'idea-u', '1'); f('done', 'idea-u', 'grill'); f('done', 'idea-u', 'reprompt');
    assert.deepEqual(f('options', 'idea-u').out.split('\n').filter((l) => l.startsWith('option ')).map((l) => l.split(' ')[2]),
      ['cooler', 'brainstorm', 'research', 'park-idea']);
    assert.equal(f('pick', 'idea-u', 'D').code, 3);
  });

  test('outside software after Research the routes form is Park the idea plus Stop (2 options)', () => {
    const cwd = tmp('idea-playbook-');
    fs.mkdirSync(path.join(cwd, '.company'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.company', 'project.md'), 'company_type: research\n');
    const f = (...argv) => flow(argv, cwd);
    f('start', 'idea-s', '--kind', 'idea');
    f('pick', 'idea-s', '1'); f('done', 'idea-s', 'grill'); f('done', 'idea-s', 'reprompt');
    f('pick', 'idea-s', 'C'); f('done', 'idea-s', 'research'); f('done', 'idea-s', 'reprompt');
    assert.deepEqual(f('options', 'idea-s').out.split('\n').filter((l) => l.startsWith('option ')).map((l) => l.split(' ')[2]),
      ['park-idea', 'stop']);
    assert.equal(f('pick', 'idea-s', 'S').code, 0);
    assert.equal(f('options', 'idea-s').out, 'ended\n');
  });

});

describe('scripts walk in route order', () => {
  const run = (cwd) => (...argv) => flow(argv, cwd);
  const optionLines = (r) => r.out.split('\n').filter((l) => l.startsWith('option '));

  test('idea captures then asks the grill form', () => {
    for (const kind of ['idea', 'bug']) {
      const cwd = tmp('idea-playbook-');
      const f = run(cwd);
      assert.equal(f('start', `${kind}-20261030-1309`, '--kind', kind).out.trim(), 'started');
      const opts = optionLines(f('options', `${kind}-20261030-1309`));
      assert.deepEqual(opts, ['option 1 grill', 'option 2 grill-me', 'option 3 grill-with-docs']);
      assert.match(f('state', `${kind}-20261030-1309`).out, kind === 'idea' ? /build: feature/ : /build: fix/);
    }
  });

  test('the routes form lists A to E and a letter outside it is refused', () => {
    const cwd = tmp('idea-playbook-');
    const f = run(cwd);
    f('start', 'idea-a', '--kind', 'idea');
    f('pick', 'idea-a', '2');
    f('done', 'idea-a', 'grill-me');
    f('done', 'idea-a', 'reprompt');
    assert.deepEqual(optionLines(f('options', 'idea-a')).map((l) => l.split(' ')[1]), ['A', 'B', 'C', 'D', 'E']);
    const bad = f('pick', 'idea-a', 'F');
    assert.equal(bad.code, 3);
    assert.match(bad.out, /not an allowed pick/);
  });

  test('route G: park every ticket in reverse plan order, then the flow has ended', () => {
    const cwd = tmp('idea-playbook-');
    const dir = path.join(cwd, '.company', 'work', 'idea-g-plan');
    fs.mkdirSync(dir, { recursive: true });
    const blk = (id, deps) => `### ${id} title ${id}\n- role: backend-engineer\n- files: src/${id}.mjs\n- depends-on: ${deps}\n`;
    fs.writeFileSync(path.join(dir, 'plan.md'),
      `# Plan: g\n\nBase commit: ${'a'.repeat(40)}\n\n## Tasks\n\n${blk('T1', 'none')}\n${blk('T2', 'T1')}\n${blk('T3', 'T2')}`);
    const f = run(cwd);
    const a = (...argv) => approval(argv, { now: new Date(2026, 9, 30, 13, 9).getTime(), root: cwd });
    f('start', 'idea-g', '--kind', 'idea');
    f('pick', 'idea-g', '1'); f('done', 'idea-g', 'grill'); f('done', 'idea-g', 'reprompt');
    f('pick', 'idea-g', 'D'); f('done', 'idea-g', 'to-spec'); f('done', 'idea-g', 'to-tickets');
    assert.deepEqual(optionLines(f('options', 'idea-g')).map((l) => l.split(' ')[2]), ['build', 'park-roadmap', 'park-idea']);
    const t = a('tickets', 'idea-g', 'idea-g-plan/plan.md', '--phase', 'f');
    assert.equal(t.code, 0, t.lines.join('\n'));
    assert.deepEqual(t.lines.filter((l) => l.startsWith('ask ')).map((l) => l.split(' ')[1]), ['T1', 'T2', 'T3', 'S0']);
    assert.match(f('pick', 'idea-g', 'G').out, /picked G park-roadmap/);
    // Route G parks ticket IDs only: S0 cannot be parked
    assert.equal(a('ticket', 'idea-g', 'S0', 'park').code, 3);
    // forward order is refused while a dependent is unparked
    assert.equal(a('ticket', 'idea-g', 'T1', 'park').code, 0);
    assert.equal(a('park-ticket', 'idea-g', 'T1').code, 3);
    for (const id of ['T3', 'T2', 'T1']) {
      assert.equal(a('ticket', 'idea-g', id, 'park').code, 0);
      const r = a('park-ticket', 'idea-g', id);
      assert.equal(r.code, 0, r.lines.join('\n'));
    }
    assert.equal(fs.readdirSync(path.join(cwd, '.company', 'roadmap')).length, 3);
    assert.equal(f('options', 'idea-g').out.trim(), 'ended');
    const after = a('tickets', 'idea-g', 'idea-g-plan/plan.md', '--phase', 'f');
    assert.deepEqual(after.lines.filter((l) => l.startsWith('skip ')), ['skip T1 parked', 'skip T2 parked', 'skip T3 parked']);
  });

  test('route F: every ticket parked leaves the tickets form open, G then ends the flow', () => {
    const cwd = tmp('idea-playbook-');
    const dir = path.join(cwd, '.company', 'work', 'idea-f-plan');
    fs.mkdirSync(dir, { recursive: true });
    const blk = (id, deps) => `### ${id} title ${id}\n- role: backend-engineer\n- files: src/${id}.mjs\n- depends-on: ${deps}\n`;
    fs.writeFileSync(path.join(dir, 'plan.md'),
      `# Plan: f\n\nBase commit: ${'a'.repeat(40)}\n\n## Tasks\n\n${blk('T1', 'none')}\n${blk('T2', 'T1')}`);
    const f = run(cwd);
    const a = (...argv) => approval(argv, { now: new Date(2026, 9, 30, 13, 9).getTime(), root: cwd });
    f('start', 'idea-f', '--kind', 'idea');
    f('pick', 'idea-f', '1'); f('done', 'idea-f', 'grill'); f('done', 'idea-f', 'reprompt');
    f('pick', 'idea-f', 'D'); f('done', 'idea-f', 'to-spec'); f('done', 'idea-f', 'to-tickets');
    assert.equal(a('tickets', 'idea-f', 'idea-f-plan/plan.md', '--phase', 'f').code, 0);
    for (const id of ['T2', 'T1']) {
      assert.equal(a('ticket', 'idea-f', id, 'park').code, 0);
      assert.equal(a('park-ticket', 'idea-f', id).code, 0);
    }
    const built = a('build-plan', 'idea-f');
    assert.equal(built.code, 3);
    assert.deepEqual(built.lines, ['refused: no approved ticket']);
    assert.deepEqual(optionLines(f('options', 'idea-f')).map((l) => l.split(' ')[1]), ['F', 'G', 'E']);
    assert.match(f('pick', 'idea-f', 'G').out, /picked G park-roadmap/);
    assert.equal(f('options', 'idea-f').out.trim(), 'ended');
  });
});
