// Regression: the Lead skipped the Ship Gate form on the v0.47.2 release run (P20261127, PR #112 via PR #113). It read the
// request "merge after all CI green incl. Windows" as the approval. A request's words never count as Ship Gate approval:
// merge, tag and release always wait for the Ship Gate form and a recorded `run-state gate <slug> ship passed`.
// Text pins on the docs the Lead reads: the rule must be named where the merge/release step is described.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');
const gates = read('skills', 'pipeline', 'references', 'gates.md');
const pipeline = read('skills', 'pipeline', 'SKILL.md');
const lead = read('skills', 'lead', 'SKILL.md');

// A single sentence/line that mentions the request wording, says it never approves, and ties it to the Ship Gate.
const ruleLine = (text) => text.split('\n').find((l) =>
  /request/i.test(l) && /(merge|release|tag)/i.test(l) && /ship gate/i.test(l) && /(never|not|no)\b[^.]*\b(approv|count)/i.test(l)
  && /(CI green|after CI|merge after|wording|words)/i.test(l));

test('gates.md: request wording (merge/release/"after CI green") never counts as Ship Gate approval', () => {
  assert.ok(ruleLine(gates), 'gates.md has no line saying a request to merge/release (e.g. "merge after CI green") is not Ship Gate approval');
});

test('pipeline SKILL §6: merge needs the recorded Ship Gate pass, not only green CI', () => {
  const l = pipeline.split('\n').find((x) => /merges a PR/i.test(x));
  assert.ok(l, 'merge sentence missing');
  assert.match(l, /ship gate/i, 'the merge sentence must also require the Ship Gate');
  assert.match(l, /gate\W+\w*\W*ship passed|recorded|passed/i, 'the merge sentence must require a recorded pass');
});

test('lead SKILL: the approval rule names the Ship Gate and release/merge requests', () => {
  assert.ok(ruleLine(lead), 'lead SKILL has no line saying a release/merge request never approves the Ship Gate');
});

test('gates.md: a release/merge request still gets the Ship Gate form before merge, tag, release', () => {
  assert.match(gates, /(release|tag)[^\n]*(always|still)[^\n]*form|form[^\n]*(release|tag)[^\n]*(always|still)/i,
    'gates.md must say release/tag requests still ask the Ship Gate form');
});
