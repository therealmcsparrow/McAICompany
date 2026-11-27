// A request's words never count as Ship Gate approval: merge, tag and release always wait for the Ship Gate form
// and a recorded `run-state gate <slug> ship passed`.
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

// A single line that mentions the request wording, says it never approves, and ties it to the Ship Gate.
const ruleLine = (text) => text.split('\n').find((l) =>
  /request/i.test(l) && /\b(merge|release|tag)\b/i.test(l) && /ship gate/i.test(l) && /(never|not|no)\b[^.]*\b(approv|count)/i.test(l)
  && /(CI green|after CI|merge after|wording|words)/i.test(l));

// The §6 ship sentence itself, up to its full stop (not the whole line, which names the Ship Gate elsewhere).
const shipSentence = (pipeline.match(/The Lead merges a PR[^.]*\./) || [''])[0];

test('gates.md: request wording (merge/release/"after CI green") never counts as Ship Gate approval', () => {
  assert.ok(ruleLine(gates), 'gates.md has no line saying a request to merge/release (e.g. "merge after CI green") is not Ship Gate approval');
});

test('pipeline SKILL §6: merge needs the recorded Ship Gate pass, not only green CI', () => {
  assert.ok(shipSentence, 'merge sentence missing');
  assert.match(shipSentence, /ship gate[^.]*(passed|recorded)/i, 'the merge sentence must require the Ship Gate pass');
  assert.match(shipSentence, /run-state gate '<slug>' ship passed/, 'the merge sentence must name the recorded `ship passed`');
});

test('pipeline SKILL §6: the same rule covers tag push and release', () => {
  assert.match(shipSentence, /\btag\b/i);
  assert.match(shipSentence, /\brelease\b/i);
});

test('pipeline SKILL §6: a merged PR also needs green CI', () => {
  assert.match(shipSentence, /green CI|CI[^.]*green/i);
});

test('pipeline SKILL §6: the Lead checks that the latest ship gate entry is passed before merge', () => {
  assert.match(pipeline, /Right before[^.]*run-state show\b[^.]*latest `ship` gate entry must be `passed`/i);
});

test('gates.md: an auto Ship Gate never merges, tags or releases', () => {
  assert.match(gates, /auto Ship Gate[^\n]*never merges, tags or releases/i);
});

test('gates.md: merge, tag or release is in the Always-a-form list', () => {
  const l = gates.split('\n').find((x) => /Always a form/i.test(x));
  assert.ok(l, 'Always-a-form list missing');
  assert.match(l, /\bmerge, tag or release\b/i);
});

test('lead SKILL: the approval rule names the Ship Gate and release/merge requests', () => {
  assert.ok(ruleLine(lead), 'lead SKILL has no line saying a release/merge request never approves the Ship Gate');
});

test('gates.md: the Always-a-form line itself says merge, tag or release always ask', () => {
  const l = gates.split('\n').find((x) => /Always a form/i.test(x));
  assert.ok(l, 'Always-a-form line missing');
  assert.match(l, /\bmerge, tag or release\b[^.]*\balways ask\b/i, 'the Always-a-form line must say merge, tag or release always ask');
});
