// Fixture: an unsettled top-level await while a ref'd interval keeps the loop alive.
import { test } from 'node:test';

test('passes before the hang', () => {});

setInterval(() => {}, 1000);
await new Promise(() => {});
