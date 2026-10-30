import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
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

const PIPE_HINT = '; a | inside a field splits it, write it without |';
const PROSE_HINT = '; every bullet here is a finding row, put prose in ## Did or ## Next';

test('row mode: a prose bullet that starts with an ID gets the prose hint', () => {
  const e = errs(make({ nits: '- R-11 to R-17, R-19 and R-20 are still open Nits' }));
  assert.match(e, /line \d+: row needs 5 fields.*\(got 1\)/);
  assert.ok(e.includes(PROSE_HINT), e);
  assert.ok(!e.includes(PIPE_HINT), e);
  assert.ok(errsTop(ENGLISH_TWIN).includes(PROSE_HINT));
});

test('the same prose bullet without a top block stays exit 0 (plain lint)', () => withDir(dir => {
  const plain = ENGLISH_TWIN.replace('- The name tmp is unclear.', '- R-11 to R-17, R-19 and R-20 are still open Nits');
  assert.deepEqual(lint(plain).errors, []);
  const f = join(dir, '07-code-reviewer.md');
  writeFileSync(f, plain);
  assert.equal(runLint(f).status, 0);
  const r = runLint(f, '--require-top');
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes(PROSE_HINT));
}));

test('a Handoff row with a | inside a field gets the pipe hint', () => {
  const e = errs(make({ nits: '- R-3 | src/y.ts:9 | quotes T-3 | x in prose | readability | rename' }));
  assert.match(e, /row needs 5 fields.*\(got 6\)/);
  assert.ok(e.includes(PIPE_HINT), e);
  assert.ok(!e.includes(PROSE_HINT), e);
  const short = errs(make({ nits: '- R-3 | src/y.ts:9 | only three' }));
  assert.match(short, /\(got 3\)/);
  assert.ok(!short.includes(PIPE_HINT) && !short.includes(PROSE_HINT), short);
});

test('a tagged Blocking prose bullet gets the prose hint; CRLF input too', () => {
  assert.ok(errs(make({ rows: '- [spec] R-1 and R-2 are still open' })).includes(PROSE_HINT));
  const crlf = make({ nits: '- R-11 are still open' }).replace(/\n/g, '\r\n');
  const e = errs(crlf);
  assert.ok(e.includes(PROSE_HINT), e);
  assert.ok(!e.includes('\r'), 'no CR in the errors');
});

test('a ledger row with a | inside a field gets the pipe hint', () => {
  const bad = LEDGER.replace('## Findings\n', '## Findings\n- R-9 | open | [spec] | a.mjs:1 | quotes T-3 | x | why | fix\n');
  assert.ok(lintFindings(bad).errors.some(e => /row needs 7 fields.*\(got 8\)/.test(e) && e.endsWith(PIPE_HINT)));
  const few = lintFindings(LEDGER.replace('## Findings\n', '## Findings\n- R-9 | open | [spec]\n')).errors.join('\n');
  assert.match(few, /\(got 3\)/);
  assert.ok(!few.includes(PIPE_HINT));
});

test('hints echo no Handoff text', () => {
  assert.ok(!errs(make({ nits: '- SECRET-TOKEN-abc123 prose' })).includes('SECRET-TOKEN'));
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

test('findings ledger: a Nit row carries the [nit] marker and keeps its ID', () => {
  const r = lintFindings(LEDGER + '- R-3 | open | [nit] | scripts/x.mjs:3 | vague name | readability | rename\n');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.ledger.findings.at(-1), { id: 'R-3', status: 'open' });
  assert.match(lintFindings(LEDGER.replace('[spec]', '[nitpick]')).errors.join('\n'), /tag/);
});

test('a rejected tool-check Nit row passes --require-top', () => {
  const doc = [
    '---', 'step: 05', 'role: code-reviewer', 'task: t', 'status: blocked', 'round: 0', 'base-commit: abc1234', 'risk-tier: high',
    'acceptance-ids: [AC1]', 'files-touched: []', '---',
    'By: Rin (code-reviewer)',
    '```aico-top', 'status: blocked', 'files: []', 'ac_ids: [AC1]', 'rule_ids: []', 'risks: []', 'read_next: []', 'tokens_used: unknown', '```',
    '## Did', '- Reviewed.',
    '## Blocking', '- [spec] R-1 | src/x.ts:12 | problem | proj.M1 | fix',
    '## Nits', '- T-2 | scripts/x.mjs:5 | not confirmed | the tool matched a comment | none',
    '## Next', '- Builder.', ''
  ].join('\n');
  const r = lint(doc, { requireTop: true });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.routing.findings, ['R-1', 'T-2']);
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

// ---- a handover Handoff needs its findings ledger ----
const HANDOVER = make().replaceAll('status: blocked', 'status: handover');
const FULL_LEDGER = `${LEDGER}- R-3 | open | [nit] | src/y.ts:9 | unclear name | readability | rename\n`;

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hl-led-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const script = fileURLToPath(new URL('./handoff-lint.mjs', import.meta.url));
const runLint = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8' });

test('handover with --require-top and a complete sibling ledger passes', () => withDir(dir => {
  const h = join(dir, '07-code-reviewer.md');
  writeFileSync(h, HANDOVER);
  writeFileSync(join(dir, '07-code-reviewer.findings.md'), FULL_LEDGER);
  const r = runLint(h, '--require-top');
  assert.equal(r.status, 0, r.stdout);
  assert.equal(JSON.parse(r.stdout).status, 'handover');
}));

test('handover without a ledger fails with ERROR handover without findings ledger', () => withDir(dir => {
  const h = join(dir, '07-code-reviewer.md');
  writeFileSync(h, HANDOVER);
  const r = runLint(h, '--require-top');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^ERROR handover without findings ledger$/m);
}));

test('handover without --require-top does not look for a ledger', () => withDir(dir => {
  const h = join(dir, '07-code-reviewer.md');
  writeFileSync(h, HANDOVER);
  assert.equal(runLint(h).status, 0);
}));

test('a ledger that misses a row ID fails with ERROR finding <ID> missing from ledger', () => withDir(dir => {
  const h = join(dir, '07-code-reviewer.md');
  writeFileSync(h, HANDOVER);
  writeFileSync(join(dir, '07-code-reviewer.findings.md'), LEDGER);
  const r = runLint(h, '--require-top');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^ERROR finding R-3 missing from ledger$/m);
  assert.doesNotMatch(r.stdout, /finding R-1 missing/);
}));

test('an invalid ledger fails the handover', () => withDir(dir => {
  const h = join(dir, '07-code-reviewer.md');
  writeFileSync(h, HANDOVER);
  writeFileSync(join(dir, '07-code-reviewer.findings.md'), FULL_LEDGER.replace('| open |', '| closed |'));
  const r = runLint(h, '--require-top');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^ERROR ledger: line \d+: status must be/m);
}));

test('a ledger of another Step or Role does not count', () => withDir(dir => {
  const h = join(dir, '07-code-reviewer.md');
  writeFileSync(h, HANDOVER);
  writeFileSync(join(dir, '06-code-reviewer.findings.md'), FULL_LEDGER);
  writeFileSync(join(dir, '07-security.findings.md'), FULL_LEDGER);
  assert.match(runLint(h, '--require-top').stdout, /^ERROR handover without findings ledger$/m);
}));

test('a Handoff file name that gives no ledger name fails with ERROR cannot locate ledger', () => withDir(dir => {
  for (const name of ['handover.md', '7-code-reviewer.md', '07-Code.md', '07-code-reviewer.txt']) {
    const h = join(dir, name);
    writeFileSync(h, HANDOVER);
    const r = runLint(h, '--require-top');
    assert.equal(r.status, 1, name);
    assert.match(r.stdout, /^ERROR cannot locate ledger$/m, name);
  }
}));

test('a symlinked ledger fails with ERROR cannot locate ledger', () => withDir(dir => {
  const h = join(dir, '07-code-reviewer.md');
  writeFileSync(h, HANDOVER);
  const real = join(dir, 'real.md');
  writeFileSync(real, FULL_LEDGER);
  const link = join(dir, '07-code-reviewer.findings.md');
  try { symlinkSync(real, link); } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    symlinkSync(sub, link, 'junction');
  }
  const r = runLint(h, '--require-top');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^ERROR cannot locate ledger$/m);
}));

test('status done with no ledger stays valid; status blocked too', () => withDir(dir => {
  for (const st of ['done', 'blocked']) {
    const h = join(dir, `07-code-reviewer.md`);
    writeFileSync(h, make().replaceAll('status: blocked', `status: ${st}`));
    const r = runLint(h, '--require-top');
    assert.equal(r.status, 0, `${st}: ${r.stdout}`);
  }
}));

test('lint() stays pure: a handover text alone raises no ledger error', () => {
  assert.deepEqual(lint(HANDOVER, { requireTop: true }).errors, []);
});

test('read_next pointers: path, R-n, or path#heading with spaces only after the #', () => {
  const ok = v => assert.deepEqual(lint(make({ top: swap('read_next', v) })).errors, [], v);
  const bad = v => assert.match(errs(make({ top: swap('read_next', v) })), /read_next/, v);
  ok('[docs/contracts/handoff.md#v1.1 part 3: the findings ledger]');
  ok('[R-21]');
  ok('[src/x.ts]');
  // shapes of the two natural code-reviewer read_next lists
  ok('[docs/contracts/handoff.md#v1.1 part 3: the findings ledger, R-1, scripts/handoff-lint.mjs]');
  ok('[skills/review/SKILL.md#Review depth, .company/work/x/02-architect-plan.md#Lighter pipeline Steps]');
  bad('[copied text here]');
  bad('[a b.md#x]');
  bad('[R-1 and R-2]');
  bad('[a.md#x, b c]');
  bad(`[a.md#${'x'.repeat(200)}]`);
  ok(`[a.md#${'x'.repeat(194)}]`);
  assert.match(errs(make({ top: swap('read_next', '[a.md#x\ty]') })), /read_next/);
  assert.match(errs(make({ top: swap('read_next', '[a.md#]') })), /read_next/);
});

// ---- fresh-reviewer Handoff shape (handoff v2.0) ----
const PARAPHRASE = 'The plan adds a lint rule so a contest needs evidence that a reviewer can open, and a ruling file for the CEO answers. It keeps security findings open until a fix. A comprehension gap is a Blocking row.';

function freshHandoff({ mode = 'plan', paraphrase = PARAPHRASE, firstPass = '- none', extraFm = '', head = null, did = '- read the plan', blocking = '- none' } = {}) {
  const shape = head ?? `## Paraphrase\n${paraphrase}\n## First pass\n${firstPass}\n`;
  return `---\nstep: 03\nrole: fresh-reviewer\ntask: t\nstatus: done\nround: 0\nbase-commit: 0123456789abcdef0123456789abcdef01234567\nrisk-tier: high\nreview-mode: ${mode}\ncontracts: [handoff v2.0]\n${extraFm}---\nBy: fresh-reviewer\n${shape}## Did\n${did}\n## Decisions\n- none\n## Blocking\n${blocking}\n## Nits\n- none\n## Next\n- go\n`;
}
const freshErrors = (text, opts) => lint(text, opts).errors.join('\n');

test('a well-formed fresh-reviewer Handoff lints in both modes', () => {
  assert.deepEqual(lint(freshHandoff()).errors, []);
  assert.deepEqual(lint(freshHandoff({ mode: 'code', extraFm: 'model: opus\n' })).errors, []);
  assert.deepEqual(lint(freshHandoff({ firstPass: '- R-1 the cited Contract is stale\n- R-2 task 3 has no depends-on' })).errors, []);
  assert.deepEqual(lint(freshHandoff({ blocking: '- [comprehension] R-1 plan.md:3 — paraphrase differs — change the text' })).errors, []);
});

test('review-mode is required for the fresh reviewer, a plan or code value, and refused for every other Role', () => {
  assert.match(freshErrors(freshHandoff().replace('review-mode: plan\n', '')), /missing review-mode/);
  assert.match(freshErrors(freshHandoff({ mode: 'both' })), /review-mode must be plan\|code/);
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
