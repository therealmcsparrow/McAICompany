// Fixture: the test passes, then a ref'd interval keeps the process alive forever.
import { test } from 'node:test';

test('passes, then leaves an open handle', () => {});

setInterval(() => {}, 1000);
