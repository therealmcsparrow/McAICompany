import test from 'node:test';
import assert from 'node:assert/strict';
import { board } from './dashboard-data.mjs';
import { routing } from './dashboard-run.mjs';
import { NOW, view, makeDeps, entry } from './dashboard-board-fixtures.mjs';

const sub = (id, start, stop = null) => ({ role: 'qa', id, start, stop, ms: null });
const ago = (h) => new Date(NOW - h * 3600000).toISOString().replace('.000Z', 'Z');

test('active and inflight: only the active run counts; subs older than 12 hours do not', async () => {
  const views = {
    a: view({ subs: [sub('1', ago(1)), sub('2', ago(13)), sub('3', ago(2), ago(1)), sub('4', ago(0.1)), sub('5', null)] }),
    b: view({ subs: [sub('6', ago(1)), sub('7', ago(1))] }),
  };
  const { deps } = makeDeps({ runs: [entry('a'), entry('b')], views, active: 'a' });
  const out = await board('/x', { now: NOW, deps });
  assert.equal(out.active, 'a');
  assert.equal(out.inflight, 2);
});

test('inflight is 0 without an active run', async () => {
  const views = { b: view({ subs: [sub('1', ago(0.1))] }) };
  const { deps } = makeDeps({ runs: [entry('b')], views, active: null });
  const out = await board('/x', { now: NOW, deps });
  assert.equal(out.active, null);
  assert.equal(out.inflight, 0);
});

test('routing lists reviewer Roles in first-seen order', () => {
  const steps = [{ role: 'qa' }, { role: 'security' }, { role: 'code-reviewer' }, { role: 'security' }];
  assert.deepEqual(routing(steps), ['security', 'code-reviewer']);
});
