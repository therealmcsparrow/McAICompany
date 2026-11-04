import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, routing } from './dashboard-run.mjs';

const NAME = '2026-11-04 01.19 - Rounds Topic';

function setup(t, steps) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-rounds-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.company', 'work', NAME), { recursive: true });
  const deps = { show: () => ({ steps }), active: () => ({ slug: null }) };
  return { root, deps };
}

const step = (n, role, round, over = {}) => ({ step: n, role, status: 'done', round, file: `${n}-${role}.md`, verdict: null, gate: null, ...over });

test('one chip per distinct round, ascending, "not recorded" as null', async (t) => {
  const { root, deps } = setup(t, [step('10', 'qa', 1), step('05', 'qa', 0), step('11', 'qa', 1)]);
  const out = await run(root, NAME, { deps });
  assert.deepEqual(out.rounds, [{ round: 0, gate: null, review: null }, { round: 1, gate: null, review: null }]);
});

test('gate and review come from the highest-numbered Step of the round that carries one', async (t) => {
  const { root, deps } = setup(t, [
    step('05', 'qa', 0, { gate: 'fail' }),
    step('06', 'code-reviewer', 0, { verdict: 'changes' }),
    step('07', 'qa', 0, { gate: 'pass' }),
    step('08', 'code-reviewer', 0),
    step('09', 'code-reviewer', 1, { verdict: 'approve' }),
  ]);
  const out = await run(root, NAME, { deps });
  assert.deepEqual(out.rounds, [{ round: 0, gate: 'pass', review: 'changes' }, { round: 1, gate: null, review: 'approve' }]);
});

test('values outside the allowed set read as null; unknown rounds are left out', async (t) => {
  const { root, deps } = setup(t, [step('05', 'qa', 0, { gate: 'maybe', verdict: 'lgtm' }), step('06', 'qa', 'unknown')]);
  const out = await run(root, NAME, { deps });
  assert.deepEqual(out.rounds, [{ round: 0, gate: null, review: null }]);
});

test('routing lists reviewer Roles once, first-seen order', () => {
  const steps = [step('01', 'architect', 0), step('02', 'security', 0), step('03', 'code-reviewer', 0), step('04', 'security', 1)];
  assert.deepEqual(routing(steps), ['security', 'code-reviewer']);
  assert.deepEqual(routing([]), []);
  assert.deepEqual(routing(undefined), []);
});

test('run carries routing', async (t) => {
  const { root, deps } = setup(t, [step('01', 'code-reviewer', 0)]);
  assert.deepEqual((await run(root, NAME, { deps })).routing, ['code-reviewer']);
});
