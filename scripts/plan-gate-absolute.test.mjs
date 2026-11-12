import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordPath } from '../mods/lib/plan-gate.mjs';

// An absolute path whose first folder is named `work` is a product path, not `.company/work` read from its root.
test('an absolute /work/... product file is not a run-state record', () => {
  for (const path of ['/work/src/run-state.jsonl', '/work/.company/work/run-state.jsonl', '/work/run-one/run-state.jsonl']) {
    assert.equal(recordPath(path), null, path);
  }
});

// Fail-closed (aico-mods v1.8): a relative path that reaches a run-state record by dot, space or 8.3 tricks is still judged.
test('relative dot, space and 8.3 variants of a work/ record are judged', () => {
  for (const path of [
    './work./run-one/run-state.jsonl',
    './work /run-one/run-state.jsonl',
    '././work./run-one/run-state.jsonl',
    '. /work./run-one/run-state.jsonl',
    './work./run-one/RUN-ST~1.JSO'
  ]) {
    assert.notEqual(recordPath(path), null, path);
  }
});

test('an absolute path under .company/work and a relative work/ path are still judged', () => {
  assert.deepEqual(recordPath('/work/.company/work/run-one/run-state.jsonl'), { slug: 'run-one' });
  assert.deepEqual(recordPath('./work/run-one/run-state.jsonl'), { slug: 'run-one' });
});
