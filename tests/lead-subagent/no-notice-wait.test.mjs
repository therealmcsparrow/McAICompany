// Regression: a Lead never ends its turn to wait for a Role completion notice (the notice never wakes it).
// It polls for the Output Handoff file on disk with a bounded bash until-loop, then continues.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = rel => readFileSync(join(root, rel), 'utf8');
const agent = read('agents/project-manager.md');
const pipeline = read('skills/pipeline/SKILL.md');
const dispatchSection = pipeline.slice(pipeline.indexOf('## 2. Dispatch a Step'), pipeline.indexOf('## 3. Spikes'));

for (const [name, text] of [['agents/project-manager.md', agent], ['pipeline section 2 Dispatch a Step', dispatchSection]]) {
  test(`${name}: never ends the turn to wait for a completion notice`, () => {
    assert.match(text, /never end (your|the) turn[^.\n]*(wait|notice)|never wait (on|for) (a |the )?(completion )?notices?/i);
    assert.match(text, /notice/i);
  });
  test(`${name}: polls for the Output Handoff file with a bash until-loop`, () => {
    assert.match(text, /until/i);
    assert.match(text, /poll/i);
    assert.match(text, /Handoff file|Output (Handoff|file|path)/i);
  });
  test(`${name}: poll loop is bounded by a timeout and re-checks the file`, () => {
    assert.match(text, /timeout|bounded|deadline|max(imum)? (wait|\d+)/i);
    assert.match(text, /re-?check|check again|loop again|re-?poll/i);
  });
  test(`${name}: continues with lint/ledger/commit once the file appears`, () => {
    assert.match(text, /appears?[^.\n]*(step-close|lint|ledger|commit|continue)|(step-close|lint|ledger|commit)[^.\n]*after[^.\n]*appears?/i);
  });
}

// Fix round 1: the polling rule must be bounded, safe and consistent (reviewer R-1..R-5, security R-1/R-2).
const handover = read('skills/pipeline/references/lead-handover.md');
const sentences = text => text.split(/(?<=[.!?])\s+|\n/);

test('pipeline section 2: poll call passes an explicit Bash timeout (R-1)', () => {
  assert.match(dispatchSection, /(pass|set|give|use)[^.\n]*`?timeout`?( parameter| param| argument)?|`?timeout`? (parameter|param|argument)|timeout[=: ]+\d{4,}/i);
  assert.doesNotMatch(dispatchSection, /under the 10 min/i);
});
test('pipeline section 2: loop carries its own deadline inside the call (R-1)', () => {
  assert.match(dispatchSection, /(own |per-call |call )deadline|deadline (inside|in) the (loop|call)|(inside|in) the loop[^.\n]*(deadline|limit|stop|seconds)|\$SECONDS|date \+%s/i);
});
test('pipeline section 2: overall limit on poll calls or minutes (R-2, security R-1)', () => {
  assert.match(dispatchSection, /(overall|total)[^.\n]*(limit|cap|calls|minutes|min\b)|(at most|no more than|up to|limited? (to|of)|cap(ped)? at)[^.\n]*\d+[^.\n]*(poll|calls|attempts|rounds)/i);
});
test('pipeline section 2: no polling once the Agent call returned the Role result (R-2)', () => {
  assert.match(dispatchSection, /Agent[^.\n]*(returned|came back|reply|result)[^.\n]*(never|not|no|don'?t)[^.\n]*poll|(never|do not|don'?t|no)[^.\n]*poll[^.\n]*(already|when|once|if)[^.\n]*(returned|came back|reply|result)/i);
});
test('pipeline section 2: on the limit a fresh Step or STATUS blocked naming the lost Step (R-2)', () => {
  assert.match(dispatchSection, /\blost\b|no Handoff from step/i);
  assert.match(dispatchSection, /fresh Step|redo[^.\n]*Step|STATUS: blocked/i);
});
test('pipeline section 2: helper Lead has no file to poll and says what is done instead (R-3)', () => {
  const s = sentences(dispatchSection).filter(x => /helper Lead/i.test(x));
  assert.ok(s.some(x => /no (Output )?(path|file)|nothing to poll|no file to poll|never poll|not poll|does not poll/i.test(x)
    && /instead|STATUS|foreground|again|redo|fresh|dispatch/i.test(x)), `helper Lead sentence: ${s.join(' | ')}`);
});
test('pipeline section 2: polled path is the Lead-built Output path, single-quoted, [ -s ] only (security R-2)', () => {
  assert.match(dispatchSection, /single[- ]quot|'<[^>]*path[^>]*>'/i);
  assert.match(dispatchSection, /\[ -s /);
  assert.match(dispatchSection, /never (print|cat|read|show)[^.\n]*(content|file)|do not (print|cat|read|show)[^.\n]*(content|file)|size only|without (printing|reading)/i);
  assert.match(dispatchSection, /(Output(:| path| line))[^.\n]*(you (built|dispatched|wrote)|Lead[- ]built)|(you|Lead) (built|dispatched|wrote)[^.\n]*Output/i);
});
test('agents/project-manager.md: says step-close, not hand-run lint/ledger/commit (R-4)', () => {
  assert.match(agent, /step-close/);
  assert.doesNotMatch(agent, /continue with handoff-lint, ledger and commit/i);
  assert.doesNotMatch(agent, /under the 10 min/i);
});
test('lead-handover.md: Step running case polls the Output path, no "Wait for it" (R-5)', () => {
  assert.doesNotMatch(handover, /Wait for it\b/);
  assert.doesNotMatch(handover, /wait for the running Step/i);
  assert.match(handover, /poll[^.\n]*Output/i);
});
