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

test('stream suffixes, device paths, trailing dots and short names above the run folder are judged with a null slug', () => {
  const rec = `${RUN}/01-feature/run-state.jsonl`;
  for (const path of [
    `Z:/p/.company::$INDEX_ALLOCATION/work/${rec}`,
    `Z:/p/.company/work::$INDEX_ALLOCATION/${rec}`,
    `Z:/p/.company/work:$I30:$INDEX_ALLOCATION/${rec}`,
    `//./Z:/p/.company./work/${rec}`,
    `//./Z:/p/.company/work./${rec}`,
    `\\\\.\\Z:\\p\\.company.\\work\\${RUN}\\01-feature\\run-state.jsonl`,
    `//?/Z:/p/.company /work/${rec}`,
    `Z:/p/.company/work/${RUN}./01-feature /run-state.jsonl`,
    `Z:/p/COMPAN~1/work/${rec}`,
    `Z:/p/COMPAN~1/WORK~1/${rec}`,
    `Z:/p/COMPAN~1/work/run-one/run-state.jsonl`
  ]) assert.deepEqual(recordPath(path), { slug: null }, path);
});

test('a stream suffix on the record name is still judged', () => {
  for (const tail of ['::$DATA', ':x']) assert.notEqual(recordPath(`Z:/p/.company/work/${RUN}/01-feature/run-state.jsonl${tail}`), null, tail);
});

test('a drive letter and an ordinary home short name are not judged', () => {
  for (const path of [
    'Z:/p/src/a.ts',
    'C:/Users/CARLOH~1/p/src/a.ts',
    'C:/Users/CARLOH~1/p/run-state.jsonl',
    'Z:/p/COMPAN~1/work/x/notes.md'
  ]) assert.equal(recordPath(path), null, path);
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
