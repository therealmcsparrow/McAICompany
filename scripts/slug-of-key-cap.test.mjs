import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugOfKey, isWorkFolder, runKey } from '../mods/lib/work-folder.mjs';

const LONG = '2026-11-01 10.00 - Fix-Login-Flow-For-Many-Users-Across-Every-Region-And-Device Draft 2';

test('slugOfKey keeps a valid 81-120 char work folder name', () => {
  assert.equal(LONG.length, 87);
  assert.equal(isWorkFolder(LONG), true);
  assert.equal(slugOfKey(LONG), LONG);
  assert.equal(slugOfKey(runKey(LONG)), LONG);
});

test('slugOfKey still rejects keys over 120 and over-80 tilde keys', () => {
  assert.equal(slugOfKey('a'.repeat(121)), null);
  assert.equal(slugOfKey(`P20261109.000009~${'x'.repeat(70)}`), null);
});
