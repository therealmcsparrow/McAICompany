import { test } from 'node:test';
import assert from 'node:assert/strict';

test('slow one', async () => {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.ok(true);
});
