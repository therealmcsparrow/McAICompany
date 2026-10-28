import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_LINE_CHARS, readPlanLines } from './plan-markdown.mjs';

const kinds = (text) => readPlanLines(text).lines.map((l) => l.kind);

describe('plan markdown lines', () => {
  test('the line cap is 4000 characters', () => {
    assert.equal(MAX_LINE_CHARS, 4000);
  });

  test('classifies text, headings and fences', () => {
    const r = readPlanLines('# A\ntext\n```js\n## inside\n```\n### B');
    assert.deepEqual(r.lines.map((l) => l.kind), ['heading', 'text', 'fence', 'fenced', 'fenced', 'heading']);
    assert.deepEqual(r.lines.filter((l) => l.kind === 'heading').map((l) => [l.level, l.title, l.no]), [[1, 'A', 1], [3, 'B', 6]]);
    assert.equal(r.openFence, null);
  });

  test('a closing run must match the character and be as long', () => {
    assert.deepEqual(kinds('````\n```\n~~~~\n````\nafter'), ['fence', 'fenced', 'fenced', 'fenced', 'text']);
    assert.deepEqual(kinds('~~~\n```\n~~\n~~~\nafter'), ['fence', 'fenced', 'fenced', 'fenced', 'text']);
  });

  test('an unclosed fence is reported with its line number', () => {
    const r = readPlanLines('x\n  ```\nrest');
    assert.deepEqual(r.openFence, { no: 2 });
  });

  test('line endings: CRLF, LF and a lone CR end a line', () => {
    assert.equal(readPlanLines('a\r\nb\rc\nd').lines.length, 4);
  });

  test('a line over the cap is long, never a fence or heading, and does not close a fence', () => {
    const long = (s) => `${s}${'x'.repeat(MAX_LINE_CHARS)}`;
    assert.deepEqual(kinds(`${long('```')}\n${long('## ')}`), ['long', 'long']);
    assert.deepEqual(kinds(`\`\`\`\n${' '.repeat(MAX_LINE_CHARS + 1)}\n\`\`\``), ['fence', 'fenced', 'fenced']);
    const edge = '#'.padEnd(2, ' ') + 'y'.repeat(MAX_LINE_CHARS - 2);
    assert.equal(edge.length, MAX_LINE_CHARS);
    assert.deepEqual(kinds(edge), ['heading']);
  });

  test('indentation of 4 spaces is not a fence or a heading', () => {
    assert.deepEqual(kinds('    ```\n    # x'), ['text', 'text']);
  });

  test('plan-check and plan-tasks import the module and hold no fence or heading parser of their own', () => {
    for (const name of ['plan-check.mjs', 'plan-tasks.mjs']) {
      const src = fs.readFileSync(path.join(import.meta.dirname, name), 'utf8');
      assert.match(src, /from '\.\/plan-markdown\.mjs'/, name);
      assert.doesNotMatch(src, /const (FENCE_OPEN|FENCE_CLOSE|HEADING|MAX_LINE_CHARS) =/, name);
    }
  });

  test('plan-tasks ignores a task heading over the shared line cap', async () => {
    const { parsePlan } = await import('./plan-tasks.mjs');
    const head = `### T1 ${'x'.repeat(MAX_LINE_CHARS)}`;
    assert.equal(parsePlan(`## Tasks\n${head}\n- files: a.js\n`, { agents: [] }).tasks.length, 0);
  });

  test('hostile input stays linear', () => {
    const started = Date.now();
    readPlanLines(`${'`'.repeat(200000)}\n${'#'.repeat(200000)}\n${' '.repeat(200000)}x`);
    assert.ok(Date.now() - started < 500);
  });
});
