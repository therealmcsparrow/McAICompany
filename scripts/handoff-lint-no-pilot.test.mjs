import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as handoffLint from './handoff-lint.mjs';

// handoff v3.0 (AC6): the pilot top block and the findings ledger are removed. `--require-top` and `--findings` are unknown flags
// (usage, exit 2); plain lint is unchanged; a handover Handoff needs no sibling ledger.
const { lint } = handoffLint;
const script = fileURLToPath(new URL('./handoff-lint.mjs', import.meta.url));

const GOOD = `---
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
const HANDOVER = GOOD.replace('status: blocked', 'status: handover');

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hl-nopilot-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const cli = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8' });

test('plain lint of a valid Handoff is unchanged: no errors, same routing', () => {
  const r = lint(GOOD);
  assert.deepEqual(r.errors, []);
  assert.equal(r.routing.status, 'blocked');
  assert.deepEqual(r.routing.blocking, ['security', 'test']);
});

test('CLI plain lint exits 0 and prints the routing JSON', () => withDir((dir) => {
  const f = join(dir, '03-backend-engineer.md');
  writeFileSync(f, GOOD);
  const r = cli(f);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(JSON.parse(r.stdout).status, 'blocked');
}));

test('--require-top is an unknown flag: usage line and exit 2, with or without a good file', () => withDir((dir) => {
  const f = join(dir, '03-backend-engineer.md');
  writeFileSync(f, GOOD);
  const r = cli(f, '--require-top');
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /^usage: /);
  assert.doesNotMatch(r.stdout, /require-top/, 'the usage line no longer names it');
  assert.equal(cli('--require-top', f).status, 2);
}));

test('--findings is an unknown flag: usage line and exit 2', () => withDir((dir) => {
  const led = join(dir, '07-code-reviewer.findings.md');
  writeFileSync(led, '---\nstep: 07\n---\n');
  const r = cli('--findings', led);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stdout, /^usage: /);
  assert.doesNotMatch(r.stdout, /--findings/);
}));

test('the usage line keeps the kept flags', () => {
  const r = cli();
  assert.equal(r.status, 2);
  for (const flag of ['--contests', '--applied', '--exceptions-for']) assert.ok(r.stdout.includes(flag), flag);
});

test('lint ignores the old requireTop option: a Handoff without a top block raises no top-block error', () => {
  const r = lint(GOOD, { requireTop: true });
  assert.ok(!r.errors.some((e) => /aico-top|top block/i.test(e)), r.errors.join(' | '));
  assert.deepEqual(r.errors, []);
});

test('a handover Handoff passes without a sibling findings ledger', () => withDir((dir) => {
  const f = join(dir, '07-code-reviewer.md');
  writeFileSync(f, HANDOVER);
  const r = cli(f);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(JSON.parse(r.stdout).status, 'handover');
  assert.doesNotMatch(r.stdout, /ledger/);
}));

test('the findings ledger exports are gone', () => {
  assert.equal(Object.hasOwn(handoffLint, 'lintFindings'), false);
  assert.equal(Object.hasOwn(handoffLint, 'checkLedger'), false);
});
