import { test } from 'node:test';
import assert from 'node:assert/strict';

test('pass a one', () => {
  assert.equal(1 + 1, 2);
});

test('pass a two', () => {
  assert.deepEqual([1], [1]);
});
