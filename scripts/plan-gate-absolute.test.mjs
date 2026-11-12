import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordPath } from '../mods/lib/plan-gate.mjs';

// An absolute path whose first folder is named `work` is a product path, not `.company/work` read from its root.
test('an absolute /work/... product file is not a run-state record', () => {
  for (const path of ['/work/src/run-state.jsonl', '/work/.company/work/run-state.jsonl', '/work/run-one/run-state.jsonl']) {
    assert.equal(recordPath(path), null, path);
  }
});

test('an absolute path under .company/work and a relative work/ path are still judged', () => {
  assert.deepEqual(recordPath('/work/.company/work/run-one/run-state.jsonl'), { slug: 'run-one' });
  assert.deepEqual(recordPath('./work/run-one/run-state.jsonl'), { slug: 'run-one' });
});
