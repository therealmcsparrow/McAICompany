// The Gate defaults in settings.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GATE_DEFAULTS, GATES } from './settings.mjs';

test('every Gate defaults to ask', () => {
  for (const gate of GATES) assert.equal(GATE_DEFAULTS[gate], 'ask', gate);
  assert.deepEqual(Object.keys(GATE_DEFAULTS).sort(), [...GATES].sort());
});
