// Regression: a Role never ends its turn to wait for a background command's completion notice
// (the notice never wakes it, so no Handoff is written and the Lead hits its poll limit).
// The rule lives once in the shared skill every Role loads (skills/handoff/SKILL.md), not in each agent file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = rel => readFileSync(join(root, rel), 'utf8');
const handoff = read('skills/handoff/SKILL.md');
const sentences = text => text.split(/(?<=[.!?])\s+|\n/);

test('handoff skill: never end a turn waiting for a background command or its notice', () => {
  assert.match(handoff, /never end (your|the|a) turn[^.\n]*(wait|notice)[^.\n]*background|background[^.\n]*never end (your|the|a) turn/i);
  assert.match(handoff, /notice/i);
});
test('handoff skill: long commands run in the foreground with an explicit timeout', () => {
  assert.match(handoff, /foreground[^.\n]*(explicit )?`?timeout`?|`?timeout`?[^.\n]*foreground/i);
});
test('handoff skill: or poll the result on disk in short calls', () => {
  assert.match(handoff, /poll[^.\n]*(on disk|file|result)[^.\n]*short|short[^.\n]*poll[^.\n]*(on disk|file|result)/i);
});
test('handoff skill: a command moved to the background anyway is never waited on by notice', () => {
  const s = sentences(handoff).filter(x => /moved to the background anyway/i.test(x));
  assert.ok(s.length > 0, 'no "moved to the background anyway" sentence in skills/handoff/SKILL.md');
  assert.ok(s.some(x => /never waited on by (the )?notice/i.test(x) && /start a new (short )?poll/i.test(x)), s.join(' | '));
});
test('handoff skill: foreground only when the command fits one call', () => {
  assert.match(handoff, /foreground only if it finishes inside one call/i);
});
test('handoff skill: per-call deadline 150 s and Bash timeout 170000', () => {
  assert.match(handoff, /deadline (of )?150 ?s/i);
  assert.match(handoff, /timeout`? (of at most |of )?170000/i);
  assert.match(handoff, /per-call deadline 150 s, Bash `timeout` 170000/i);
});
test('handoff skill: background command appends an exit marker', () => {
  assert.match(handoff, /echo "exit \$\?"/);
  assert.match(handoff, /`exit` marker/i);
});
test('handoff skill: poll only the tail of the output file', () => {
  assert.match(handoff, /only the tail of the output file/i);
});
test('handoff skill: overall limit then status blocked', () => {
  assert.match(handoff, /overall limit.*`status: blocked`/i);
});
test('handoff skill: the rule sits in Starting a Step or its own section, before Finishing a Step', () => {
  const i = handoff.search(/background/i);
  assert.ok(i >= 0 && i < handoff.indexOf('## Finishing a Step'), 'rule missing or after Finishing a Step');
});

// Every Role loads the shared skill, so the one rule covers all of them.
const roles = readdirSync(join(root, 'agents')).filter(f => f.endsWith('.md') && f !== 'project-manager.md');
test('every Role agent follows aico:handoff (the shared carrier of the rule)', () => {
  const missing = roles.filter(f => !/aico:handoff/.test(read(`agents/${f}`)));
  assert.deepEqual(missing, [], `agents without aico:handoff: ${missing}`);
});
