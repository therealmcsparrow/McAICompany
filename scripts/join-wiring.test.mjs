import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pins: the join rule is wired into pipeline Setup, run-state.md, worktrees.md
// and the dispatch-prompt Contract. Run 1 kept join-project.md dormant (no file cited it); run 2 drops that.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const CITE = /join-project\.md/;

test('pipeline Setup item 1 cites join-project.md and hands the run-slug rule over', () => {
  const line = read('skills/pipeline/SKILL.md').split('\n').find((l) => l.startsWith('1. **Task slug**'));
  assert.ok(line, 'Setup item 1 line not found');
  assert.match(line, CITE);
  assert.match(line, /project: <ProjectID>/);
  assert.doesNotMatch(line, /--layout/, 'the flipped CLI has no --layout');
});

test('pipeline Setup item 1 sends a hand-typed start with an active project through the join form', () => {
  const line = read('skills/pipeline/SKILL.md').split('\n').find((l) => l.startsWith('1. **Task slug**'));
  assert.ok(line, 'Setup item 1 line not found');
  assert.match(line, /run-state projects --json/);
  assert.match(line, /form/i);
});

test('pipeline Setup item 1 names the no-active-project path as today (no form)', () => {
  const line = read('skills/pipeline/SKILL.md').split('\n').find((l) => l.startsWith('1. **Task slug**'));
  assert.ok(line, 'Setup item 1 line not found');
  assert.match(line, /no active project/i);
});

test('run-state.md reference cites join-project.md', () => {
  assert.match(read('skills/pipeline/references/run-state.md'), CITE);
});

test('worktrees.md cites join-project.md', () => {
  assert.match(read('skills/pipeline/references/worktrees.md'), CITE);
});

test('dispatch-prompt Contract is v5.2 and cites join-project.md for the project: line', () => {
  const t = read('docs/contracts/dispatch-prompt.md');
  assert.match(t.split('\n')[0], /^# Contract: dispatch-prompt v5\.2$/);
  assert.match(t, CITE);
  assert.match(t, /project: <ProjectID>/);
});

test('pipeline text tells the Lead to note the AFK start in the first Gate summary', () => {
  const t = read('skills/pipeline/SKILL.md');
  assert.ok(t.includes('join: start new (no CEO; active <ProjectID>)'), 'AFK note missing in pipeline SKILL.md');
});

test('join-project.md is no longer dormant and its commands have no --layout', () => {
  const t = read('skills/pipeline/references/join-project.md');
  assert.doesNotMatch(t, /dormant/i);
  assert.doesNotMatch(t, /--layout/);
});
