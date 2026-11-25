// The guard host must answer before Claude Code kills it. A killed PreToolUse host blocks the tool
// (onFailure "block"), and a CPU-loaded machine (another session's test workers) can starve a node
// start past 10 s, so the hook timeout leaves room and the host's own exits come first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const hooks = JSON.parse(fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8')).hooks;
const src = fs.readFileSync(path.join(repo, 'scripts', 'hook-host.mjs'), 'utf8');
const num = (name) => Number(new RegExp(`const ${name} = ([0-9]+);`).exec(src)?.[1]);

const hostEntries = Object.entries(hooks).flatMap(([event, groups]) =>
  groups.flatMap((g) => g.hooks.filter((h) => h.command.includes('scripts/hook-host.mjs')).map((h) => ({ event, ...h }))));

test('every hook-host entry has a 30 s timeout', () => {
  assert.equal(hostEntries.length, 4);
  for (const h of hostEntries) assert.equal(h.timeout, 30, h.event);
});

test('the host self-exits answer before the hook timeout', () => {
  const self = num('SELF_EXIT_MS');
  const start = num('START_EXIT_MS');
  assert.ok(self >= 20000 && self < 30000, `SELF_EXIT_MS ${self}`);
  assert.ok(start > self && start < 30000, `START_EXIT_MS ${start}`);
});
