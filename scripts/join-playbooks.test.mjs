import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Each in-scope Playbook Folder paragraph cites join-project.md,
// each hand-over ends `project: <ProjectID>`. Plain text pins; no skip paths.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const CITE = 'join-project.md';
const LINE = 'project: <ProjectID>';

// Every in-scope Playbook file (the pipeline Setup is pinned in join-wiring.test.mjs).
const IN_SCOPE = [
  'skills/bug/SKILL.md',
  'skills/idea/SKILL.md',
  'skills/idea/references/routes.md',
  'skills/reprompt/SKILL.md',
  'skills/research/SKILL.md',
  'skills/grill/SKILL.md',
  'skills/grill/references/grill-loop.md',
  'skills/grill-me/SKILL.md',
  'skills/grill-with-docs/SKILL.md',
  'skills/to-spec/SKILL.md',
  'skills/to-tickets/SKILL.md',
  'skills/review/SKILL.md',
  'skills/planning/SKILL.md',
];

// Playbooks that hand over or route to another Playbook.
const HANDS_OVER = [
  'skills/bug/SKILL.md',
  'skills/idea/references/routes.md',
  'skills/reprompt/SKILL.md',
  'skills/grill/references/grill-loop.md',
  'skills/research/SKILL.md',
];

for (const f of IN_SCOPE) {
  test(`${f} cites ${CITE}`, () => {
    assert.ok(read(f).includes(CITE), `${f} does not cite ${CITE}`);
  });
}

// A hand-over line says the args end with the project line.
const endsWith = new RegExp(
  '(end(s|ing)?|last|final)[^\n]{0,80}' + LINE + '|' + LINE + '[^\n]{0,60}(last|final|end)',
  'i',
);
for (const f of HANDS_OVER) {
  test(`${f} hand-over ends with \`${LINE}\``, () => {
    const t = read(f);
    assert.ok(t.includes(LINE), `${f} lacks ${LINE}`);
    assert.match(t, endsWith, `${f} does not say the hand-over ends with ${LINE}`);
  });
}

// bug and idea have a **Folder:** paragraph: the cite sits inside it.
for (const f of ['skills/bug/SKILL.md', 'skills/idea/SKILL.md']) {
  test(`${f} Folder paragraph itself cites ${CITE}`, () => {
    const para = read(f).split('\n').find((l) => l.startsWith('**Folder:**'));
    assert.ok(para, `${f} has no **Folder:** paragraph`);
    assert.ok(para.includes(CITE), `Folder paragraph of ${f} does not cite ${CITE}`);
  });
}

// Receivers whose argument goes to `draft-input` leave the last `project:` line in the argument
// file (draft-input v1.7 cuts it) and hand `--project` to `take` when `arg` printed the line.
const PASS_THROUGH = [
  'skills/fix/SKILL.md',
  'skills/feature/references/intake-and-ship.md',
  'skills/grill/references/grill-loop.md',
  'skills/to-spec/SKILL.md',
  'skills/to-tickets/SKILL.md',
];
for (const f of PASS_THROUGH) {
  test(`${f} passes the project line through draft-input`, () => {
    const t = read(f);
    assert.ok(t.includes('draft-input'), `${f} names draft-input`);
    assert.ok(t.includes(LINE), `${f} names ${LINE}`);
    assert.match(t, /--project '<ProjectID>'/, `${f} gives take --project '<ProjectID>'`);
    assert.match(t, /--project[^\n]{0,40}before `--for`/, `${f} puts --project before --for`);
  });
}

test('the receivers that cut the line say it is not part of the idea or report', () => {
  for (const f of ['skills/fix/SKILL.md', 'skills/grill/references/grill-loop.md', 'skills/to-spec/SKILL.md']) {
    assert.match(read(f), /without (a|that) last (`project:` line|line)/, `${f} keeps the line out of the text`);
  }
});
