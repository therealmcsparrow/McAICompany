import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lint, MAX_BYTES } from './handoff-lint.mjs';

const fixture = name => readFileSync(fileURLToPath(new URL(`../tests/${name}`, import.meta.url)), 'utf8');

const ENGLISH_TWIN = `---
step: 03
role: backend-engineer
task: example
status: blocked
round: 1
base-commit: d39e8824d81e98a0a3333119ce71881a5716bd0b
risk-tier: high
acceptance-ids: [AC1, AC3]
files-touched: [src/x.ts, src/y.ts]
---
## Did
- Added module x in src/x.ts with tests.
## Decisions
- Input is validated at the boundary.
## Blocking
- [security] src/x.ts:12 — input is not sanitised — sanitise before use.
- [test] src/y.ts:4 — edge case missing — add a test.
## Nits
- The name tmp is unclear.
## Next
- The code-reviewer checks the changes since base-commit.
`;

test('Dutch prose with English machine parts passes and routes like its English twin (AC15)', () => {
  const nl = lint(fixture('handoff-nl.fixture.md'));
  const en = lint(ENGLISH_TWIN);
  assert.deepEqual(nl.errors, []);
  assert.deepEqual(en.errors, []);
  assert.deepEqual(nl.routing, en.routing);
  assert.deepEqual(nl.routing.blocking, ['security', 'test']);
  assert.equal(nl.routing.status, 'blocked');
});

test('Dutch headings, status, risk tier and blocking tag fail (AC15)', () => {
  const { errors } = lint(fixture('handoff-nl-bad.fixture.md'));
  const joined = errors.join('\n');
  assert.match(joined, /status must be/);
  assert.match(joined, /risk-tier must be/);
  assert.match(joined, /missing English heading ## Did/);
  assert.match(joined, /missing English heading ## Blocking/);
  assert.match(joined, /missing English heading ## Next/);
});

test('blocking tag outside the taxonomy fails', () => {
  const bad = ENGLISH_TWIN.replace('[security]', '[beveiliging]');
  assert.ok(lint(bad).errors.some(e => e.includes('blocking item needs')));
});

test('translated frontmatter key fails', () => {
  const bad = ENGLISH_TWIN.replace('task: example', 'taak: example');
  const { errors } = lint(bad);
  assert.ok(errors.some(e => e.includes('unknown frontmatter key')));
  assert.ok(errors.some(e => e.includes('missing task')));
});

test('(none) under Blocking is fine', () => {
  const ok = ENGLISH_TWIN.replace(/## Blocking[\s\S]*## Nits/, '## Blocking\n- (none)\n## Nits');
  assert.deepEqual(lint(ok).errors, []);
});

test('missing or unterminated frontmatter fails', () => {
  assert.deepEqual(lint('## Did\n').errors, ['missing frontmatter']);
  assert.deepEqual(lint('---\nstep: 1\n').errors, ['unterminated frontmatter']);
});

test('a file over 64 KiB is refused before parsing', () => {
  assert.deepEqual(lint(ENGLISH_TWIN + 'x'.repeat(MAX_BYTES)).errors, ['file too large']);
});

test('hostile long lines finish quickly (linear patterns)', () => {
  const hostile = ENGLISH_TWIN.replace('## Blocking', `## Blocking\n- ${'['.repeat(20000)}\n- ${' '.repeat(20000)}x`);
  const t = performance.now();
  const { errors } = lint(hostile);
  assert.ok(performance.now() - t < 500);
  assert.ok(errors.length > 0);
});

test('researcher Handoff keys fetches and depth are accepted', () => {
  const r = ENGLISH_TWIN.replace('risk-tier: high', 'risk-tier: high\nfetches: 7\ndepth: quick');
  assert.deepEqual(lint(r).errors, []);
  assert.ok(lint(r.replace('depth: quick', 'depth: diep')).errors.some(e => e.includes('depth must be')));
});
