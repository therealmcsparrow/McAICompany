// Guards the docs-guards test files themselves; the doc wording is not pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('files are LF only', () => {
  for (const f of ['scripts/docs-guards.test.mjs', 'scripts/docs-commands.test.mjs']) assert.ok(!read(f).includes('\r'), f);
});
