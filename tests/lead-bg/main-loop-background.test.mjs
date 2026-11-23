// Bug P20261119.000001 (a): when the Lead spawn comes back "Async agent launched" (platform backgrounds it) and no
// task-notification arrives, main-loop.md gives main no rule: it only knows "no STATUS line". Expected: the reference names the case
// and a recovery (wait for the notification, then one retry resume, never a second parallel Lead).
// Module: skills/lead/references/main-loop.md (+ docs/contracts/lead-relay.md STATUS block).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const loop = readFileSync(join(root, 'skills/lead/references/main-loop.md'), 'utf8');

test('main-loop names the "Async agent launched" case', () => {
  assert.match(loop, /Async agent launched/);
});
test('main-loop says what main does when a backgrounded Lead never sends a notification', () => {
  assert.match(loop, /task-notification/i);
  assert.match(loop, /never (start|spawn) a second Lead|no second Lead/i);
});
