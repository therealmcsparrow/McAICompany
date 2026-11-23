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

// ---- handoff v3.0: finding rows without the pilot top block (the block and the ledger are gone) ----
const PIPE_HINT = '; a | inside a field splits it, write it without |';
const ROWS = '- [security] R-1 | src/x.ts:12 | input is not sanitised | proj.M3: bounded input | sanitise before use\n'
  + '- [test] R-2 | src/y.ts:4-6 | edge case missing | proj.M4 | add a test';
function make({ rows = ROWS, nits = '- R-3 | src/y.ts:9 | unclear name | readability | rename' } = {}) {
  return ENGLISH_TWIN.replace(/## Blocking[\s\S]*## Nits[\s\S]*## Next/, `## Blocking\n${rows}\n## Nits\n${nits}\n## Next`);
}
const errs = t => lint(t).errors.join('\n');

test('a Handoff with row-shaped findings passes; routing has no top or findings key', () => {
  const r = lint(make());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.routing.blocking, ['security', 'test']);
  assert.equal('top' in r.routing, false);
  assert.equal('findings' in r.routing, false);
});

test('a quoted aico-top fence is plain text now: no block check, no error', () => {
  const t = ENGLISH_TWIN.replace('## Did', '```aico-top\nstatus: wrong\n```\n## Did');
  assert.deepEqual(lint(t).errors, []);
});

test('rows: missing why, field count, missing tag, bad ID, bad location', () => {
  assert.match(errs(make({ rows: '- [spec] R-1 | src/x.ts:1 | problem | | fix' })), /line \d+: .*why/);
  assert.match(errs(make({ rows: '- [spec] R-1 | src/x.ts:1 | problem | why' })), /line \d+: .*5 fields/);
  assert.match(errs(make({ rows: '- R-1 | src/x.ts:1 | problem | why | fix' })), /line \d+: .*tag/);
  assert.match(errs(make({ rows: '- [spec] Q-1 | src/x.ts:1 | problem | why | fix' })), /finding ID must be R-, C- or T-<n>/);
  assert.match(errs(make({ rows: '- [spec] R-1 | src/x.ts:9-3 | problem | why | fix' })), /line \d+: .*location/);
});

test('duplicate finding IDs fail', () => {
  assert.match(errs(make({ nits: '- R-1 | src/y.ts:9 | a | b | c' })), /duplicate finding ID R-1/);
});

test('a row-shaped line is checked; a plain prose Nit is not', () => {
  const bad = ENGLISH_TWIN.replace('- [test] src/y.ts:4 — edge case missing — add a test.', '- [test] R-2 | src/y.ts:4 | edge | | add');
  assert.match(errs(bad), /why/);
  assert.deepEqual(lint(make({ nits: '- R-11 to R-17 are still open Nits' })).errors, []);
});

test('hints: pipe hint for too many fields; echoes no text', () => {
  const many = errs(make({ nits: '- R-3 | src/y.ts:9 | quotes T-3 | x in prose | readability | rename' }));
  assert.match(many, /row needs 5 fields.*\(got 6\)/);
  assert.ok(many.includes(PIPE_HINT), many);
  assert.ok(!errs(make({ nits: '- SECRET-TOKEN-abc123 | prose' })).includes('SECRET-TOKEN'));
});

test('hostile rows finish quickly', () => {
  const t0 = performance.now();
  lint(make({ rows: `- [spec] ${'R-1 | '.repeat(5000)}` }));
  lint(make({ rows: `- [${'['.repeat(20000)}`, nits: `- ${' | '.repeat(20000)}` }));
  assert.ok(performance.now() - t0 < 1000);
});

// ---- fresh-reviewer Handoff shape (handoff v2.0) ----
const PARAPHRASE = 'The plan adds a lint rule so a contest needs evidence that a reviewer can open, and a ruling file for the CEO answers. It keeps security findings open until a fix. A comprehension gap is a Blocking row.';

function freshHandoff({ mode = 'plan', paraphrase = PARAPHRASE, firstPass = '- none', extraFm = '', head = null, did = '- read the plan', blocking = '- none' } = {}) {
  const shape = head ?? `## Paraphrase\n${paraphrase}\n## First pass\n${firstPass}\n`;
  return `---\nstep: 03\nrole: fresh-reviewer\ntask: t\nstatus: done\nround: 0\nbase-commit: 0123456789abcdef0123456789abcdef01234567\nrisk-tier: high\nreview-mode: ${mode}\ncontracts: [handoff v2.0]\n${extraFm}---\nBy: fresh-reviewer\n${shape}## Did\n${did}\n## Decisions\n- none\n## Blocking\n${blocking}\n## Nits\n- none\n## Next\n- go\n`;
}
const freshErrors = (text, opts) => lint(text, opts).errors.join('\n');

test('a well-formed fresh-reviewer Handoff lints in plan mode; code mode and the model key are no longer known', () => {
  assert.deepEqual(lint(freshHandoff()).errors, []);
  assert.match(freshErrors(freshHandoff({ mode: 'code' })), /review-mode must be plan$/m);
  assert.doesNotMatch(freshErrors(freshHandoff({ mode: 'code' })), /model/);
  assert.match(freshErrors(freshHandoff({ extraFm: 'model: opus\n' })), /unknown frontmatter key/);
  assert.match(freshErrors(freshHandoff({ mode: 'code', extraFm: 'model: opus\n' })), /review-mode must be plan/);
  assert.deepEqual(lint(freshHandoff({ firstPass: '- R-1 the cited Contract is stale\n- R-2 task 3 has no depends-on' })).errors, []);
  assert.deepEqual(lint(freshHandoff({ blocking: '- [comprehension] R-1 plan.md:3 — paraphrase differs — change the text' })).errors, []);
});

test('review-mode is required for the fresh reviewer, plan is the only value, and refused for every other Role', () => {
  assert.match(freshErrors(freshHandoff().replace('review-mode: plan\n', '')), /missing review-mode/);
  assert.match(freshErrors(freshHandoff({ mode: 'both' })), /review-mode must be plan$/m);
  assert.match(freshErrors(freshHandoff({ mode: 'code' })), /review-mode must be plan$/m);
  const other = freshHandoff().replace('role: fresh-reviewer', 'role: code-reviewer').replace('By: fresh-reviewer', 'By: code-reviewer');
  assert.match(freshErrors(other), /line 9: review-mode key is for fresh-reviewer only/);
});

test('the first two headings are ## Paraphrase then ## First pass', () => {
  assert.match(freshErrors(freshHandoff({ head: '## First pass\n- none\n' })), /Paraphrase/);
  assert.match(freshErrors(freshHandoff({ head: `## First pass\n- none\n## Paraphrase\n${PARAPHRASE}\n` })), /needs ## Paraphrase as its first heading/);
  assert.match(freshErrors(freshHandoff({ head: `## Paraphrase\n${PARAPHRASE}\n## Did\n- x\n## First pass\n- none\n` })), /First pass directly after/);
  assert.match(freshErrors(freshHandoff({ head: `## Paraphrase\n${PARAPHRASE}\n` })), /First pass/);
});

test('the paraphrase is 200 to 1200 characters of non-empty lines', () => {
  const pad = n => 'a'.repeat(n);
  assert.match(freshErrors(freshHandoff({ paraphrase: pad(199) })), /paraphrase must be 200-1200 characters \(got 199\)/);
  assert.match(freshErrors(freshHandoff({ paraphrase: pad(1201) })), /paraphrase must be 200-1200 characters \(got 1201\)/);
  assert.equal(lint(freshHandoff({ paraphrase: pad(200) })).errors.length, 0);
  assert.equal(lint(freshHandoff({ paraphrase: pad(1200) })).errors.length, 0);
  assert.match(freshErrors(freshHandoff({ paraphrase: '\n\n' })), /paraphrase must be 200-1200 characters \(got 0\)/);
  // Empty lines do not count; the lines are joined by one line break.
  assert.deepEqual(lint(freshHandoff({ paraphrase: `${pad(100)}\n\n\n${pad(99)}` })).errors, []);
  assert.match(freshErrors(freshHandoff({ paraphrase: `${pad(100)}\n\n\n${pad(98)}` })), /\(got 199\)/);
});

test('a first pass line is "- R-<n> …" or "- none"', () => {
  assert.match(freshErrors(freshHandoff({ firstPass: 'prose about the plan' })), /first pass line/);
  assert.match(freshErrors(freshHandoff({ firstPass: '- the plan is fine' })), /first pass line/);
});

test('no run Handoff is cited before the first pass ends; the plan may be', () => {
  const cited = /Handoff cited before the first pass ends/;
  assert.match(freshErrors(freshHandoff({ firstPass: '- R-1 03-architect.md says the Contract is v1' })), cited);
  assert.match(freshErrors(freshHandoff({ firstPass: '- R-1 see .company/work/t/03-architect.md:4' })), cited);
  assert.match(freshErrors(freshHandoff({ paraphrase: `${PARAPHRASE} It follows 05-product-manager.md.` })), cited);
  assert.match(freshErrors(freshHandoff({ firstPass: '- R-1 see 1103-architect.md' })), cited);
  assert.deepEqual(lint(freshHandoff({ firstPass: '- R-1 03-plan.md task T2 breaks the Contract' })).errors, []);
  assert.deepEqual(lint(freshHandoff({ firstPass: '- R-1 .company/work/t/03-architect-plan.md:12' })).errors, []);
  assert.deepEqual(lint(freshHandoff({ did: '- compared with 03-architect.md after the first pass' })).errors, []);
});

test('the fresh reviewer is a reviewer Role: rows need R-<n>; a comprehension row needs the fresh reviewer', () => {
  assert.match(freshErrors(freshHandoff({ blocking: '- [spec] plan.md:3 — vague — fix' })), /R-<n>/);
  const code = freshHandoff({ blocking: '- [comprehension] R-1 plan.md:3 — paraphrase differs — change the text' }).replace('fresh-reviewer', 'architect');
  assert.match(freshErrors(code), /comprehension tag is for fresh-reviewer only/);
});
