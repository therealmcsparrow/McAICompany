import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Regression: /aico:cooler and /aico:brainstorm must dispatch real Role agents; the Lead in the main
// session never speaks for a Role. Pins "each Role turn is an Agent dispatch of that Role" in the
// Playbook text (the public interface of both Playbooks). Task P20261116.000002/01-fix.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const files = {
  cooler: ['skills/cooler/SKILL.md'],
  brainstorm: ['skills/brainstorm/SKILL.md', 'skills/brainstorm/references/format-1.md', 'skills/brainstorm/references/format-2.md'],
};
const text = (name) => files[name].map(read).join('\n');

for (const name of Object.keys(files)) {
  const t = text(name);

  test(`${name}: files are LF only`, () => {
    for (const f of files[name]) assert.ok(!read(f).includes('\r'), `CR in ${f}`);
  });

  test(`${name}: every Role turn is an Agent call to the Role's own subagent aico:<role>`, () => {
    assert.match(t, /Agent (call|tool)/i, 'must name the Agent call as the way a Role speaks');
    assert.match(t, /aico:<role>/, 'must name the subagent type aico:<role>');
    assert.match(t, /subagent/i, 'must say each Role is a subagent');
  });

  test(`${name}: the Lead never writes a Role's line or reply itself`, () => {
    assert.match(
      t,
      /(never|not)[^.\n]{0,60}(write|speak|answer|voice|play|invent|fake|stand in)[^.\n]{0,60}(for|as|instead of)[^.\n]{0,30}(a |any |the )?Role/i,
      'must forbid the Lead speaking for a Role',
    );
  });

  test(`${name}: a Role line enters the file only from an Agent result, never from the Lead`, () => {
    assert.match(t, /(only|solely)[^.\n]{0,80}(Agent result|subagent'?s? (reply|result|line)|dispatched)/i);
  });
}

test('cooler: each Role turn is its own dispatch, sequential, one speaker per turn', () => {
  const t = text('cooler');
  assert.match(t, /One speaker per turn, sequential/);
  assert.match(t, /Agent (call|tool)[^.\n]{0,80}(each|per|every) (turn|Role)|(each|per|every) turn[^.\n]{0,80}Agent (call|tool)/i);
});
