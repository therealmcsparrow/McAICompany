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
