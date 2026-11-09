import test from 'node:test';
import assert from 'node:assert/strict';
import { recordPath } from '../mods/lib/plan-gate.mjs';

const RUN = 'P20261109.000009';

test('dot, dot-dot and empty segments are resolved before the record test', () => {
  const judged = [
    `.company/work/${RUN}/01-feature/./run-state.jsonl`,
    `.company/work/${RUN}/x/../01-feature/run-state.jsonl`,
    `.company/./work/${RUN}/01-feature/run-state.jsonl`,
    `.company//work/${RUN}/01-feature/run-state.jsonl`,
    `Z:/p/.company/x/../work/${RUN}/01-feature/run-state.jsonl`,
    ['Z:', 'p', '.company', 'work', RUN, '01-feature', '.', 'run-state.jsonl'].join('\\'),
    `.company/work/run-one/sub/../run-state.jsonl`,
    `.company/work/run-one/./run-state.jsonl`,
    `./work/run-one/run-state.jsonl`
  ];
  for (const path of judged) assert.notEqual(recordPath(path), null, path);
  assert.deepEqual(recordPath('.company/work/run-one/sub/../run-state.jsonl'), { slug: 'run-one' });
  assert.deepEqual(recordPath('.company/./work/run-one/./run-state.jsonl'), { slug: 'run-one' });
});

test('a path under work whose last segment holds a tilde is judged with a null slug', () => {
  for (const path of [
    `.company/work/${RUN}/01-feature/RUN-ST~1.JSO`,
    `Z:/p/.company/work/${RUN}/01-feature/run-st~1.jso`,
    `.company/work/run-one/RUN-ST~1.JSO`,
    `.company/work/${RUN}/01-feature/./RUN-ST~1.JSO`
  ]) assert.deepEqual(recordPath(path), { slug: null }, path);
});

test('a last segment that starts run-st and ends in a dot or space is judged with a null slug', () => {
  for (const path of [
    `.company/work/${RUN}/01-feature/run-state.json.`,
    `.company/work/${RUN}/01-feature/run-st `,
    `.company/work/run-one/RUN-STATE. `,
    `.company/work/${RUN}/01-feature/run-st.`
  ]) assert.deepEqual(recordPath(path), { slug: null }, path);
});

test('ordinary files and paths outside work are not judged', () => {
  for (const path of [
    `.company/work/${RUN}/01-feature/notes.md`,
    `.company/work/${RUN}/01-feature/run-start.md`,
    `src/RUN-ST~1.JSO`,
    `.company/x/../src/run-state.jsonl`,
    `.company/work/run-one/sub/run-state.jsonl`
  ]) assert.equal(recordPath(path), null, path);
});
