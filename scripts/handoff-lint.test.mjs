import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, lintFindings, MAX_BYTES } from './handoff-lint.mjs';

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

// ---- handoff v1.1: top block, finding rows, findings ledger ----
const gold = name => readFileSync(fileURLToPath(new URL(`../tests/golden/${name}`, import.meta.url)), 'utf8');
const TOP = ['status: blocked', 'files: [src/x.ts, src/y.ts]', 'ac_ids: [AC1, AC3]', 'rule_ids: [proj.M3]',
  'risks: [R-1]', 'read_next: [src/x.ts#top, R-1]', 'tokens_used: 1200'];
const ROWS = '- [security] R-1 | src/x.ts:12 | input is not sanitised | proj.M3: bounded input | sanitise before use\n'
  + '- [test] R-2 | src/y.ts:4-6 | edge case missing | proj.M4 | add a test';
function make({ top = TOP, rows = ROWS, nits = '- R-3 | src/y.ts:9 | unclear name | readability | rename' } = {}) {
  let t = ENGLISH_TWIN.replace('## Did', `By: Ben (backend-engineer)\n\`\`\`aico-top\n${top.join('\n')}\n\`\`\`\n## Did`);
  t = t.replace(/## Blocking[\s\S]*## Nits[\s\S]*## Next/, `## Blocking\n${rows}\n## Nits\n${nits}\n## Next`);
  return t;
}
const errs = t => lint(t).errors.join('\n');
const errsTop = t => lint(t, { requireTop: true }).errors.join('\n');
const without = k => TOP.filter(l => !l.startsWith(`${k}:`));
const swap = (k, v) => TOP.map(l => (l.startsWith(`${k}:`) ? `${k}: ${v}` : l));

test('a valid top block and rows pass and show up in routing', () => {
  const r = lint(make());
  assert.deepEqual(r.errors, []);
  assert.equal(r.routing.top.status, 'blocked');
  assert.deepEqual(r.routing.top.files, ['src/x.ts', 'src/y.ts']);
  assert.deepEqual(r.routing.top.read_next, ['src/x.ts#top', 'R-1']);
  assert.equal(r.routing.top.tokens_used, 1200);
  assert.deepEqual(r.routing.findings, ['R-1', 'R-2', 'R-3']);
});

test('v1.0 Handoff without a top block stays valid; routing top is null', () => {
  const r = lint(ENGLISH_TWIN);
  assert.deepEqual(r.errors, []);
  assert.equal(r.routing.top, null);
  assert.deepEqual(r.routing.findings, []);
});

test('--require-top: missing block fails, present block passes', () => {
  assert.match(errsTop(ENGLISH_TWIN), /missing aico-top block/);
  assert.deepEqual(lint(make(), { requireTop: true }).errors, []);
});

for (const k of ['status', 'files', 'ac_ids', 'rule_ids', 'risks', 'read_next', 'tokens_used']) {
  test(`top block without ${k} fails`, () => assert.match(errs(make({ top: without(k) })), new RegExp(`aico-top.*${k}`)));
}

test('extra key, wrong order, blank line and repeated key fail', () => {
  assert.match(errs(make({ top: [...TOP, 'note: hi'] })), /aico-top/);
  assert.match(errs(make({ top: [TOP[1], TOP[0], ...TOP.slice(2)] })), /aico-top.*expected/);
  assert.match(errs(make({ top: [...TOP.slice(0, 3), '', ...TOP.slice(3)] })), /aico-top/);
  assert.match(errs(make({ top: [...TOP, 'status: done'] })), /aico-top/);
});

test('mismatch with the frontmatter fails (status, files, ac_ids)', () => {
  assert.match(errs(make({ top: swap('status', 'done') })), /status.*frontmatter/);
  assert.match(errs(make({ top: swap('files', '[src/x.ts]') })), /files.*files-touched/);
  assert.match(errs(make({ top: swap('ac_ids', '[AC1]') })), /ac_ids.*acceptance-ids/);
  assert.deepEqual(lint(make({ top: swap('files', '[src/y.ts, src/x.ts]') })).errors, []);
});

test('absent files-touched and acceptance-ids mean []', () => {
  const t = make({ top: swap('files', '[]').map(l => (l.startsWith('ac_ids') ? 'ac_ids: []' : l)) })
    .replace(/^acceptance-ids: .*\n/m, '').replace(/^files-touched: .*\n/m, '');
  assert.deepEqual(lint(t).errors, []);
});

test('bad values fail, good edge values pass', () => {
  assert.match(errs(make({ top: swap('status', 'finished') })), /status/);
  assert.match(errs(make({ top: swap('files', 'src/x.ts') })), /files/);
  assert.match(errs(make({ top: swap('rule_ids', '[Proj.M3]') })), /rule_ids/);
  assert.match(errs(make({ top: swap('rule_ids', '[proj.M3x]') })), /rule_ids/);
  assert.match(errs(make({ top: swap('risks', '[X-1]') })), /risks/);
  assert.match(errs(make({ top: swap('read_next', '[a, b, c, d, e, f]') })), /read_next.*5/);
  assert.match(errs(make({ top: swap('read_next', '[copy of the text]') })), /read_next/);
  assert.match(errs(make({ top: swap('tokens_used', '12k') })), /tokens_used/);
  assert.match(errs(make({ top: swap('tokens_used', '-3') })), /tokens_used/);
  assert.deepEqual(lint(make({ top: swap('tokens_used', 'unknown') })).errors, []);
  assert.deepEqual(lint(make({ top: swap('rule_ids', '[]') })).errors, []);
  assert.deepEqual(lint(make({ top: swap('rule_ids', '[agentsec.M-SEC7, proj.S1]') })).errors, []);
});

test('a top line over 1000 characters fails', () => {
  assert.match(errs(make({ top: swap('read_next', `[${'a'.repeat(1100)}]`) })), /too long/);
});

test('second aico-top block, or one not right after the By line, fails', () => {
  const block = '```aico-top\n' + TOP.join('\n') + '\n```\n';
  assert.match(errs(make().replace('## Nits', block + '## Nits')), /second aico-top/);
  assert.match(errs(make().replace(/```aico-top[\s\S]*?```\n/, '').replace('## Next', block + '## Next')), /directly after the By/);
  assert.match(errs(make().replace('By: Ben (backend-engineer)\n', '')), /By/);
  assert.match(errs(make().replace('By: Ben (backend-engineer)\n', 'By: Ben (backend-engineer)\n\n')), /directly after the By/);
});

test('an aico-top fence inside another fence is not a block (parsed like the reader)', () => {
  const quoted = ENGLISH_TWIN.replace('## Did\n', '## Did\n````markdown\n```aico-top\nstatus: x\n```\n````\n');
  const r = lint(quoted);
  assert.deepEqual(r.errors, []);
  assert.equal(r.routing.top, null);
});

test('an unclosed aico-top fence fails', () => {
  assert.match(errs(make().replace(/```aico-top[\s\S]*?```\n/, '```aico-top\n' + TOP.join('\n') + '\n')), /unclosed/);
});

test('rows: missing why, field count, missing tag, bad ID, bad location', () => {
  assert.match(errs(make({ rows: '- [spec] R-1 | src/x.ts:1 | problem | | fix' })), /line \d+: .*why/);
  assert.match(errs(make({ rows: '- [spec] R-1 | src/x.ts:1 | problem | why' })), /line \d+: .*5 fields/);
  assert.match(errs(make({ rows: '- [spec] R-1 | src/x.ts:1 | a | b | c | d' })), /line \d+: .*5 fields/);
  assert.match(errs(make({ rows: '- R-1 | src/x.ts:1 | problem | why | fix' })), /line \d+: .*tag/);
  assert.match(errs(make({ rows: '- [spec] Q-1 | src/x.ts:1 | problem | why | fix' })), /finding ID must be R-, C- or T-<n>/);
  assert.match(errs(make({ rows: '- [spec] R-x | src/x.ts:1 | problem | why | fix' })), /finding ID must be R-, C- or T-<n>/);
  assert.match(errs(make({ rows: '- [spec] R-1 | src/x.ts:z | problem | why | fix' })), /line \d+: .*location/);
  assert.match(errs(make({ rows: '- [spec] R-1 | src/x.ts:9-3 | problem | why | fix' })), /line \d+: .*location/);
  assert.match(errs(make({ rows: '- [spec] R-1 | src/x.ts:1 |  | why | fix' })), /line \d+: .*problem/);
  assert.match(errs(make({ rows: '- [spec] R-1 | src/x.ts:1 | problem | why |' })), /line \d+: .*fix/);
});

test('nit rows: single line only, prose fails in row mode, none is allowed', () => {
  assert.match(errs(make({ nits: '- R-3 | src/y.ts:9-12 | a | b | c' })), /line \d+: .*location/);
  assert.match(errs(make({ nits: '- the name tmp is unclear' })), /line \d+: .*row/);
  assert.deepEqual(lint(make({ nits: '- None.' })).errors, []);
  assert.deepEqual(lint(make({ nits: '- (none)' })).errors, []);
  assert.deepEqual(lint(make({ nits: '- C-2 | src/y.ts | a | b | c' })).errors, []);
  assert.deepEqual(lint(make({ nits: '- T-2 | src/y.ts:3 | a | b | c' })).errors, []);
});

test('duplicate finding IDs fail', () => {
  assert.match(errs(make({ nits: '- R-1 | src/y.ts:9 | a | b | c' })), /duplicate finding ID R-1/);
});

test('risks must point at an existing finding row', () => {
  assert.match(errs(make({ top: swap('risks', '[R-7]') })), /risks.*R-7/);
});

test('without a top block a row-shaped line is still checked', () => {
  const bad = ENGLISH_TWIN.replace('- [test] src/y.ts:4 — edge case missing — add a test.', '- [test] R-2 | src/y.ts:4 | edge | | add');
  assert.match(errs(bad), /why/);
});

test('with --require-top a legacy prose finding fails as a row', () => {
  assert.match(errsTop(ENGLISH_TWIN), /row/);
});

test('hostile top block and rows finish quickly', () => {
  const t0 = performance.now();
  lint(make({ top: swap('files', `[${'a,'.repeat(10000)}]`), rows: `- [spec] ${'R-1 | '.repeat(5000)}` }));
  lint(make({ rows: `- [${'['.repeat(20000)}`, nits: `- ${' | '.repeat(20000)}` }));
  assert.ok(performance.now() - t0 < 1000);
});

test('prototype keys never leak into the top block or routing', () => {
  const t = make({ top: ['__proto__: x', ...TOP] });
  assert.match(errs(t), /aico-top/);
  assert.equal(Object.hasOwn(lint(t).routing, '__proto__'), false);
  assert.equal({}.polluted, undefined);
});

test('golden pilot Handoffs pass with --require-top; LF only', () => {
  for (const f of ['pilot-code-reviewer.md', 'pilot-senior-engineer.md']) {
    const text = gold(f);
    assert.equal(text.includes('\r'), false, f);
    assert.ok(text.endsWith('\n'), f);
    assert.deepEqual(lint(text, { requireTop: true }).errors, [], f);
    assert.notEqual(lint(text).routing.top, null, f);
  }
  assert.deepEqual(lint(gold('pilot-code-reviewer.md')).routing.findings, ['R-1', 'R-2', 'R-3']);
});

test('the v1.0 role goldens have no top block and raise no top-block error', () => {
  for (const f of ['architect', 'backend-engineer', 'code-reviewer', 'legal', 'product-manager', 'qa', 'security', 'senior-engineer', 'writer']) {
    const r = lint(gold(`${f}.md`));
    assert.equal(r.routing?.top ?? null, null, f);
    assert.ok(!r.errors.some(e => /aico-top/.test(e)), f);
  }
});

const LEDGER = `---
step: 07
role: code-reviewer
base-commit: 625c5fd
---
## Checked
- scripts/x.mjs
## Findings
- R-1 | open | [spec] | scripts/x.mjs:12 | problem | proj.M2 | fix
- R-2 | fixed | [test] | scripts/x.mjs | problem | why | fix
`;

test('findings ledger: valid, ids and status listed', () => {
  const r = lintFindings(LEDGER);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.ledger.findings, [{ id: 'R-1', status: 'open' }, { id: 'R-2', status: 'fixed' }]);
  assert.deepEqual(r.ledger.checked, ['scripts/x.mjs']);
});

test('findings ledger: bad status, tag, ID, duplicate, empty why, missing heading or key', () => {
  const e = x => lintFindings(x).errors.join('\n');
  assert.match(e(LEDGER.replace('| open |', '| closed |')), /line \d+: status/);
  assert.match(e(LEDGER.replace('[spec]', 'spec')), /line \d+: .*tag/);
  assert.match(e(LEDGER.replace('R-2', 'Z-2')), /finding ID must be R-, C- or T-<n>/);
  assert.match(e(LEDGER.replace('R-2', 'R-1')), /duplicate finding ID R-1/);
  assert.match(e(LEDGER.replace('proj.M2', '')), /line \d+: .*why/);
  assert.match(e(LEDGER.replace('## Checked\n- scripts/x.mjs\n', '')), /## Checked/);
  assert.match(e(LEDGER.replace('base-commit: 625c5fd\n', '')), /base-commit/);
  assert.match(e('nope'), /frontmatter/);
  assert.deepEqual(lintFindings('x'.repeat(MAX_BYTES + 1)).errors, ['file too large']);
});

test('CLI: exit codes, --require-top and --findings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hl-'));
  try {
    const script = fileURLToPath(new URL('./handoff-lint.mjs', import.meta.url));
    const run = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8' });
    const good = join(dir, 'good.md'), old = join(dir, 'old.md'), led = join(dir, 'x.findings.md');
    writeFileSync(good, make()); writeFileSync(old, ENGLISH_TWIN); writeFileSync(led, LEDGER);
    const ok = run(good, '--require-top');
    assert.equal(ok.status, 0);
    assert.equal(JSON.parse(ok.stdout).top.status, 'blocked');
    assert.equal(run(old).status, 0);
    const miss = run(old, '--require-top');
    assert.equal(miss.status, 1);
    assert.match(miss.stdout, /ERROR missing aico-top block/);
    assert.equal(run('--findings', led).status, 0);
    assert.equal(run('--findings', good).status, 1);
    assert.equal(run().status, 2);
    assert.equal(run(good, '--bogus').status, 2);
    assert.equal(run(join(dir, 'nope.md')).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
