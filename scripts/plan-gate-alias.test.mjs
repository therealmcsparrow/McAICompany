import test from 'node:test';
import assert from 'node:assert/strict';
import { recordPath } from '../mods/lib/plan-gate.mjs';

const PREFIXES = ['.company/work/', '/w/.company/work/', 'work/'];

test('a record path whose folder part is not a valid run slug is judged with a null slug', () => {
  for (const folder of [
    'P20261109.000009./01-draft', 'P20261109.000009 /01-draft', 'P20261~1/01-draft', 'P20261~1',
    './01-draft', '../01-draft', '../x', './x', 'P20261109.000009/',
    'run-one.', 'run-one ', 'RUN~1', '.', '..', '', '/'
  ]) {
    for (const prefix of PREFIXES) {
      const path = `${prefix}${folder}/run-state.jsonl`;
      assert.deepEqual(recordPath(path), { slug: null }, path);
    }
  }
});

test('an empty segment is judged, not skipped', () => {
  assert.deepEqual(recordPath('.company/work//run-state.jsonl'), { slug: null });
  assert.deepEqual(recordPath('.company/work/P20261109.000009//run-state.jsonl'), { slug: null });
});

test('a valid run folder keeps its slug and a sub folder of a real run is still not a record', () => {
  assert.deepEqual(recordPath('.company/work/run-one/run-state.jsonl'), { slug: 'run-one' });
  assert.equal(recordPath('/w/.company/work/run-one/sub/run-state.jsonl'), null);
});
