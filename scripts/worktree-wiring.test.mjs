import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pins the Lead's worktree text: the two pointer lines in the pipeline Core, the
// worktrees reference and the waves/handover additions to the parallel reference.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const pipeline = read('skills/pipeline/SKILL.md');
const wt = read('skills/pipeline/references/worktrees.md');
const parallel = read('skills/pipeline/references/parallel.md');

const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};

test('pipeline SKILL.md stays at or under 125 lines and points at worktrees.md twice', () => {
  assert.ok(pipeline.split('\n').length - 1 <= 125, `pipeline has ${pipeline.split('\n').length - 1} lines`);
  assert.equal(pipeline.split('references/worktrees.md').length - 1, 2);
  has(pipeline, 'pipeline.worktrees', 'worktree leftovers', 'run-guard gate', 'protocheck');
  assert.equal(/allowed-tools/.test(pipeline), false);
});

test('worktrees.md names every command, the verdict sources and the conflict rule', () => {
  has(wt, 'worktree add', 'worktree changed', 'worktree merge', 'worktree cleanup', 'leftovers', 'protocheck', 'run-guard gate',
    '--mode waves', 'plan-tasks merged', '--archive', '--base');
  has(wt, /conflict[^\n]*`?\[spec\]`? Blocking/);
  has(wt, "plan-tasks round", "never edits code", "never drops a side");
  has(wt, 'exit code', 'printed lines');
});

test('worktrees.md runs with the setting on, parallel dispatch, cap above 1 and two or more tasks; else no command', () => {
  has(wt, '`pipeline.worktrees` is `on`', 'cap above 1', '`pipeline.dispatch` is `parallel`', 'AC34');
  has(wt, /Off, sequential or one task/);
  has(wt, 'Worktree:', 'directly after `Files:`');
});

test('worktrees.md states the Worktree Steps rules: git -C, no cd, no stash, settings, write mode, both rule forms', () => {
  has(wt, 'git -C', 'absolute path', 'permissions.additionalDirectories', '.aico-wt', 'acceptEdits');
  has(wt, /never `cd` or `Set-Location`/, /never `git stash`/);
  has(wt, 'PowerShell(', 'Bash(');
  assert.equal(/Bash\(git:\*\)|PowerShell\(git:\*\)/.test(wt), false);
  has(wt, '--literal-pathspecs');
  assert.equal(/^Name:/m.test(wt), false);
});

test('worktrees.md stops the run on a merge exit 2 without conflict lines and on kept lines', () => {
  has(wt, 'driver risk', 'record mismatch', 'unexpected result', 'kept', 'skip');
  has(wt, /exit 2 without `conflict` lines/, 'stops the run', 'never merges by hand');
  has(wt, /deletes nothing by hand/);
  has(wt, 'Read or Edit', 'stops the wave');
});

test('parallel.md adds --handover, --mode waves and merged, and keeps the single-tree flow', () => {
  has(parallel, '--handover', '--mode waves', 'plan-tasks merged', 'references/worktrees.md');
  has(parallel, /check '<slug>' '<plan>' --cap '<cap>' --mode '<mode>'/);
  has(parallel, /one task|worktrees are off/);
  has(parallel, 'AC34');
  assert.ok(/begin[^\n]*--handover|--handover[^\n]*begin/.test(parallel));
});

test('every file is LF only', () => {
  for (const t of [pipeline, wt, parallel]) assert.equal(t.includes('\r'), false);
});
