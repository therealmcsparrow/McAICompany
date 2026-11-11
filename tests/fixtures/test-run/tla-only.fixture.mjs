// Fixture: an unsettled top-level await and nothing else; node fails it when the loop drains.
import { test } from 'node:test';

test('passes before the hang', () => {});

await new Promise(() => {});
