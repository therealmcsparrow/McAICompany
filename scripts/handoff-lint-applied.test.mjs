import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printLine } from './handoff-lint.mjs';
import { append } from './run-state.mjs';

const script = fileURLToPath(new URL('./handoff-lint.mjs', import.meta.url));
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const run = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8' });
const KEY = '10-code-reviewer:R-1';
const KEY2 = '10-code-reviewer:R-2';

const handoff = (role, body) => `---\nstep: 1\nrole: ${role}\ntask: t\nstatus: done\nround: 0\nbase-commit: abc1234\nrisk-tier: high\n---\n# ${role}\nBy: ${role}\n${body}\n`;

// A product root with a run folder holding a reviewer Handoff with two Blocking rows and a builder that escalates the first.
function fixture({ escalate = [KEY], start = true, slug = 'demo' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hl-applied-'));
  made.push(root);
  const dir = join(root, '.company', 'work', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '10-code-reviewer.md'), handoff('code-reviewer', '## Blocking\n- R-1 | a.js:1 | first\n- R-2 | b.js:2 | second\n'));
  const lines = escalate.map(k => `- ${k} — escalate — the reviewer is wrong about this, the CEO should decide`).join('\n');
  writeFileSync(join(dir, '20-backend-engineer.md'), handoff('backend-engineer', `## Contested\n${lines || '- none'}\n`));
  if (start) append(root, slug, { ev: 'start' }, { now: NOW });
  return { root, dir, slug };
}

const ruling = (key, verb, reason = 'because', date = '2026-10-11') => `- ${key} — ${verb} — ${reason} — ruled: ${date} (CEO)`;
const rulings = (dir, ...l) => writeFileSync(join(dir, 'rulings.md'), `# Rulings\n\n## Rulings\n${l.join('\n')}\n`);
const standards = (root, ...l) => writeFileSync(join(root, '.company', 'standards.md'), `# Standards\n\n## Exceptions\n${l.join('\n')}\n`);
const exc = (slug, key, date) => `- ${slug}/${key} — scope — why not — approved: ${date} (CEO)`;

test('a ruling for a lineage that was never escalated is not printed', () => {
  const f = fixture({ escalate: [KEY] });
  rulings(f.dir, ruling(KEY2, 'upheld'));
  const r = run('--applied', f.dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^rulings on file: confirm each is yours \(0\)\n/);
  assert.ok(!r.stdout.includes(KEY2));
});

test('two rulings for one key: only the last is printed, with a > prefix', () => {
  const f = fixture();
  rulings(f.dir, ruling(KEY, 'upheld', 'first'), ruling(KEY, 'overruled', 'second'));
  const r = run('--applied', f.dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.split('\n')[0], 'rulings on file: confirm each is yours (1)');
  assert.equal(r.stdout.split('\n')[1], `> ${ruling(KEY, 'overruled', 'second')}`);
  assert.ok(!r.stdout.includes('first'));
});

test('control, format and separator characters print as \\u{hex} on one line', () => {
  const f = fixture();
  rulings(f.dir, `${ruling(KEY, 'upheld', 'a\u0007b\u202ec')}\u2028`);
  const r = run('--applied', f.dir);
  const out = r.stdout.split('\n');
  assert.equal(out[0], 'rulings on file: confirm each is yours (1)');
  assert.equal(out[1], `> ${ruling(KEY, 'upheld', 'a\\u{7}b\\u{202e}c')}\\u{2028}`);
  assert.match(out[2], /^exceptions on file for demo/);
  assert.ok(!/[\u0007\u202e\u2028]/.test(r.stdout));
});

test('a line over 1000 characters is cut there and followed by the more-characters line', () => {
  const out = printLine('x'.repeat(1500));
  assert.deepEqual(out, [`> ${'x'.repeat(1000)}`, '> … (500 more characters)']);
  assert.deepEqual(printLine('y'.repeat(1000)), [`> ${'y'.repeat(1000)}`]);
});

test('a ruling line over 1000 characters is skipped by the parser and never printed', () => {
  const f = fixture();
  rulings(f.dir, ruling(KEY, 'upheld', 'z'.repeat(1500)));
  const r = run('--applied', f.dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\(0\)/);
});

test('an exception of this run dated on the day of the latest start is printed', () => {
  const f = fixture();
  standards(f.root, exc('demo', KEY, '2026-10-10'));
  const r = run('--applied', f.dir);
  assert.equal(r.status, 0);
  const out = r.stdout.split('\n');
  assert.equal(out[1], 'exceptions on file for demo: confirm each is yours (1)');
  assert.equal(out[2], `> ${exc('demo', KEY, '2026-10-10')}`);
});

test('an earlier, other-run or unslugged exception is not printed; the unslugged one warns', () => {
  const f = fixture();
  standards(f.root, exc('demo', KEY, '2026-10-09'), exc('other', KEY, '2026-10-10'),
    `- ${KEY} — scope — why not — approved: 2026-10-10 (CEO)`);
  const r = run('--applied', f.dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /exceptions on file for demo: confirm each is yours \(0\)/);
  assert.ok(!r.stdout.includes('> '));
  assert.match(r.stdout, new RegExp(`warning: exception ${KEY} names no run; not applied`));
});

test('an exception is listed whether or not it matches a lineage', () => {
  const f = fixture();
  standards(f.root, exc('demo', '99-nobody:R-9', '2026-10-12'));
  assert.match(run('--applied', f.dir).stdout, /\(1\)\n> - demo\/99-nobody:R-9/);
});

test('no run-state record: zero exceptions and the no-start warning', () => {
  const f = fixture({ start: false });
  standards(f.root, exc('demo', KEY, '2026-10-10'));
  const r = run('--applied', f.dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /exceptions on file for demo: confirm each is yours \(0\)\n/);
  assert.match(r.stdout, /warning: run demo has no start; no exceptions applied/);
});

test('no rulings.md and no standards.md: both counts are 0, exit 0', () => {
  const f = fixture();
  const r = run('--applied', f.dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'rulings on file: confirm each is yours (0)\nexceptions on file for demo: confirm each is yours (0)\n');
});

test('a rulings.md that is a link is an ERROR, exit 1, and no list', (t) => {
  const f = fixture();
  const elsewhere = mkdtempSync(join(tmpdir(), 'hl-applied-out-'));
  made.push(elsewhere);
  writeFileSync(join(elsewhere, 'r.md'), `## Rulings\n${ruling(KEY, 'upheld')}\n`);
  try { symlinkSync(join(elsewhere, 'r.md'), join(f.dir, 'rulings.md'), 'junction'); } catch { t.skip('cannot create a link here'); return; }
  const r = run('--applied', f.dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^ERROR /);
  assert.ok(!r.stdout.includes('rulings on file'));
});

test('a standards.md that is a link is an ERROR, exit 1', (t) => {
  const f = fixture();
  const elsewhere = mkdtempSync(join(tmpdir(), 'hl-applied-out-'));
  made.push(elsewhere);
  writeFileSync(join(elsewhere, 's.md'), `## Exceptions\n${exc('demo', KEY, '2026-10-10')}\n`);
  try { symlinkSync(join(elsewhere, 's.md'), join(f.root, '.company', 'standards.md'), 'file'); } catch { t.skip('cannot create a link here'); return; }
  const r = run('--applied', f.dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^ERROR /);
});

test('a folder not shaped .company/work/<slug>, or bad usage, prints the usage line, exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hl-applied-bad-'));
  made.push(dir);
  for (const args of [[dir], [], [dir, 'extra'], ['--contests']]) {
    const r = run('--applied', ...args);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /^usage: .*--applied <run folder>/);
  }
});

test('--contests output is unchanged by the new reads, on the same fixtures', () => {
  const f = fixture();
  rulings(f.dir, ruling(KEY, 'upheld', 'ok'));
  standards(f.root, exc('demo', KEY, '2026-10-10'), `- ${KEY2} — scope — why not — approved: 2026-10-10 (CEO)`);
  const expected = [
    `warning: exception ${KEY2} names no run; not applied`,
    `state ${KEY} excepted`,
    `state ${KEY2} open`,
    `excepted ${KEY}`,
  ].join('\n') + '\n';
  const r = run('--contests', f.dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, expected);
});

test('contest.md names --applied and says its output is pasted unchanged', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(fileURLToPath(new URL('../skills/pipeline/references/contest.md', import.meta.url)), 'utf8');
  assert.match(text, /--applied/);
  assert.match(text, /pastes? (the|its) output[^.]*unchanged/i);
  assert.ok(!/^Name:/m.test(text));
});
