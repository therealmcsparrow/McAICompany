import { test } from 'node:test';

test('never settles', async () => {
  await new Promise(() => {});
});
