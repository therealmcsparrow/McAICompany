import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, parseRow } from './step-split.mjs';

const temps = [];
after(() => {
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
});

const RUN = '2026-01-01 10.00 - A B';

function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-fix-'));
  temps.push(d);
  const run = path.join(d, '.company/work', RUN);
  fs.mkdirSync(run, { recursive: true });
  const write = (name, rows) => fs.writeFileSync(path.join(run, name), `---\nstep: 1\n---\n## Did\n- x\n\n## Blocking\n${rows.join('\n')}\n\n## Next\n- y\n`);
  const split = (which) => path.join(run, 'split', which);
  const read = (which, name) => fs.readFileSync(path.join(split(which), name), 'utf8');
  return { d, run, write, split, read };
}
const lines = (text) => text.split('\n').filter(Boolean);

test('hostile: a link Handoff is refused and nothing is written', (t) => {
  const p = project();
  fs.writeFileSync(path.join(p.d, 'outside.md'), '## Blocking\n- [spec] a/b.mjs:1 — x\n');
  try {
    fs.symlinkSync(path.join(p.d, 'outside.md'), path.join(p.run, '10-qa.md'));
  } catch {
    t.skip('symlinks not available');
    return;
  }
  const r = main(['fix', RUN, '1', '10-qa.md'], { root: p.d });
  assert.equal(r.code, 2);
  assert.match(r.out, /refused: handoff is not a plain file/);
  assert.equal(fs.existsSync(path.join(p.run, 'split')), false);
});

test('hostile: a hard-linked Handoff is refused', () => {
  const p = project();
  fs.writeFileSync(path.join(p.d, 'outside.md'), '## Blocking\n- [spec] a/b.mjs:1 — x\n');
  fs.linkSync(path.join(p.d, 'outside.md'), path.join(p.run, '10-qa.md'));
  const r = main(['fix', RUN, '1', '10-qa.md'], { root: p.d });
  assert.equal(r.code, 2);
  assert.match(r.out, /refused: handoff is not a plain file/);
  assert.equal(fs.existsSync(path.join(p.run, 'split')), false);
});

test('hostile: a Handoff over the size cap is refused before it is read', () => {
  const p = project();
  fs.writeFileSync(path.join(p.run, '10-qa.md'), `## Blocking\n- ${'x'.repeat(1024 * 1024 + 1)}\n`);
  const r = main(['fix', RUN, '1', '10-qa.md'], { root: p.d });
  assert.equal(r.code, 2);
  assert.match(r.out, /size limit/);
});

test('hostile: a .. path in a Blocking row is only an area key and opens nothing', () => {
  const p = project();
  p.write('10-qa.md', ['- [spec] ../../etc/passwd:1 — x']);
  const r = main(['fix', RUN, '1', '10-qa.md'], { root: p.d });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /group 1: 1 blockers: \.\.\/\.\./);
  assert.deepEqual(fs.readdirSync(p.split('f1')), ['g1.txt']);
  assert.deepEqual(fs.readdirSync(path.join(p.run, 'split')), ['f1']);
});

test('hostile: huge Blocking lines are unplaced or rows, and quickly', () => {
  const p = project();
  p.write('10-qa.md', [`- [spec] ${'a'.repeat(500000)}`, `- [spec] ${'a '.repeat(200000)}:1`, `- [spec] ${'a'.repeat(300)}:1 — ok`]);
  const t0 = Date.now();
  const r = main(['fix', RUN, '1', '10-qa.md'], { root: p.d });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(lines(p.read('f1', 'g1.txt')), ['10-qa.md:10']);
  assert.deepEqual(lines(p.read('f1', 'g2.txt')), ['10-qa.md:8', '10-qa.md:9']);
});

test('11 blockers in 2 areas become groups of at most 8, placed by path, ids ignored', () => {
  const p = project();
  const a = [];
  const b = [];
  for (let i = 1; i <= 6; i++) a.push(`- [spec] R-${i} scripts/a.mjs:${i} — x`);
  for (let i = 1; i <= 5; i++) b.push(`- [test] T-${i} docs/b.md:${i} — y`);
  p.write('10-code-reviewer.md', a);
  p.write('11-qa.md', b);
  const r = main(['fix', RUN, '1', '10-code-reviewer.md', '11-qa.md'], { root: p.d });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^groups: 2\n/);
  assert.match(r.out, /group 1: 5 blockers: docs\/b\.md\n/);
  assert.match(r.out, /group 2: 6 blockers: scripts\/a\.mjs\n/);
  assert.equal(p.read('f1', 'g1.txt'), '11-qa.md:10\n11-qa.md:11\n11-qa.md:12\n11-qa.md:8\n11-qa.md:9\n');
});

test('one area of 11 blockers splits into 8 and 3', () => {
  const p = project();
  const rows = [];
  for (let i = 1; i <= 11; i++) rows.push(`- [spec] lib/mod/f.mjs:${i} — x`);
  p.write('10-qa.md', rows);
  const r = main(['fix', RUN, '1', '10-qa.md'], { root: p.d });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual([lines(p.read('f1', 'g1.txt')).length, lines(p.read('f1', 'g2.txt')).length], [8, 3]);
});

test('9 unparsed lines form 2 unplaced groups of 8 and 1', () => {
  const p = project();
  const rows = [];
  for (let i = 1; i <= 9; i++) rows.push(`- loose ${i}`);
  p.write('10-qa.md', rows);
  const r = main(['fix', RUN, '1', '10-qa.md'], { root: p.d });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^groups: 2\n/);
  assert.match(r.out, /group 1: 8 blockers: unplaced\n/);
  assert.match(r.out, /group 2: 1 blockers: unplaced\n/);
});

test('unplaced rows never join a parsed area group', () => {
  const p = project();
  p.write('10-qa.md', ['- [spec] a/b.mjs:1 — x', '- loose']);
  const r = main(['fix', RUN, '1', '10-qa.md'], { root: p.d });
  assert.match(r.out, /group 1: 1 blockers: a\/b\.mjs\n/);
  assert.match(r.out, /group 2: 1 blockers: unplaced\n/);
});

test('a duplicate row (R-2) is counted once', () => {
  const p = project();
  p.write('10-code-reviewer.md', ['- [spec] R-2 scripts/a.mjs:10 — one']);
  p.write('11-security.md', ['- [spec] scripts/a.mjs:10 — again']);
  const r = main(['fix', RUN, '1', '10-code-reviewer.md', '11-security.md'], { root: p.d });
  assert.match(r.out, /group 1: 1 blockers/);
  assert.equal(p.read('f1', 'g1.txt'), '10-code-reviewer.md:8\n');
  const q = project();
  q.write('10-a.md', ['- [spec] scripts/a.mjs:10 — x', '- [test] scripts/a.mjs:10 — x', '- [spec] scripts/a.mjs:11 — x']);
  assert.match(main(['fix', RUN, '1', '10-a.md'], { root: q.d }).out, /group 1: 3 blockers/);
});

test('a spaced path with two lines gives two rows with lines 26 and 76', () => {
  const dir = `.company/work/${RUN}/plan.md`;
  assert.deepEqual(parseRow(`- [spec] ${dir}:26 — x`), { tag: 'spec', file: dir, line: '26' });
  assert.deepEqual(parseRow(`- [spec] ${dir}:76 — y`), { tag: 'spec', file: dir, line: '76' });
  const p = project();
  p.write('10-qa.md', [`- [spec] ${dir}:26 — x`, `- [spec] ${dir}:76 — y`]);
  assert.match(main(['fix', RUN, '1', '10-qa.md'], { root: p.d }).out, /group 1: 2 blockers: \.company\/work\n/);
});

test('plan.md:26, plan.md:76 — z gives path plan.md and line 26 (R-18)', () => {
  assert.deepEqual(parseRow('- [spec] plan.md:26, plan.md:76 — z'), { tag: 'spec', file: 'plan.md', line: '26' });
  assert.deepEqual(parseRow('- [spec] a b — z'), { tag: 'spec', file: 'a b', line: null });
  assert.deepEqual(parseRow('- [spec] a b:3 — z : 9'), { tag: 'spec', file: 'a b', line: '3' });
  assert.deepEqual(parseRow('- [spec] a — b:3'), { tag: 'spec', file: 'a', line: null });
  assert.equal(parseRow('- [spec] R-5 plan.md'), null);
});

test('comprehension rows go to architect.txt only and are printed (R-19)', () => {
  const p = project();
  p.write('10-qa.md', ['- [comprehension] R-3 docs/plan.md:5 — wording', '- [spec] a/b.mjs:1 — x', '- [comprehension] docs/plan.md:9 — more']);
  const r = main(['fix', RUN, '2', '10-qa.md'], { root: p.d });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.endsWith(`architect: 2 rows\n  .company/work/${RUN}/split/f2/architect.txt\n`), r.out);
  assert.equal(p.read('f2', 'architect.txt'), '10-qa.md:8\n10-qa.md:10\n');
  assert.equal(p.read('f2', 'g1.txt'), '10-qa.md:9\n');
  assert.deepEqual(fs.readdirSync(p.split('f2')).sort(), ['architect.txt', 'g1.txt']);
});

test('only comprehension rows: no builder group, groups: 0', () => {
  const p = project();
  p.write('10-qa.md', ['- [comprehension] docs/plan.md:5 — wording']);
  const r = main(['fix', RUN, '1', '10-qa.md'], { root: p.d });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^groups: 0\narchitect: 1 rows\n/);
  assert.deepEqual(fs.readdirSync(p.split('f1')), ['architect.txt']);
});

test('show f<round> lists the groups and the architect file', () => {
  const p = project();
  p.write('10-qa.md', ['- [comprehension] docs/plan.md:5 — wording', '- [spec] a/b.mjs:1 — x']);
  main(['fix', RUN, '1', '10-qa.md'], { root: p.d });
  const r = main(['show', RUN, 'f1'], { root: p.d });
  assert.equal(r.code, 0);
  assert.equal(r.out, [
    'groups: 1',
    'group 1: 1 entries',
    `  .company/work/${RUN}/split/f1/g1.txt`,
    'architect: 1 rows',
    `  .company/work/${RUN}/split/f1/architect.txt`,
    ''
  ].join('\n'));
  assert.equal(main(['show', RUN, 'f9'], { root: p.d }).out, 'groups: 0\n');
});

test('group files are LF only and a CRLF Handoff parses', () => {
  const p = project();
  fs.writeFileSync(path.join(p.run, '10-qa.md'), '## Blocking\r\n- [spec] a/b.mjs:1 — x\r\n');
  const r = main(['fix', RUN, '1', '10-qa.md'], { root: p.d });
  assert.equal(r.code, 0, r.out);
  assert.equal(p.read('f1', 'g1.txt'), '10-qa.md:2\n');
});

test('only ## Blocking counts: bullets in other sections are ignored', () => {
  const p = project();
  fs.writeFileSync(path.join(p.run, '10-qa.md'), '## Did\n- [spec] a/b.mjs:1 — no\n\n## Blocking\n- none\n\n## Next\n- [spec] c/d.mjs:1 — no\n');
  assert.match(main(['fix', RUN, '1', '10-qa.md'], { root: p.d }).out, /no blocking rows/);
});

test('hostile: show refuses a hard-linked split file (proj.M-SEC7)', () => {
  const p = project();
  fs.mkdirSync(p.split('f1'), { recursive: true });
  fs.writeFileSync(path.join(p.d, 'outside.txt'), 'a\nb\n');
  fs.linkSync(path.join(p.d, 'outside.txt'), path.join(p.split('f1'), 'g1.txt'));
  const r = main(['show', RUN, 'f1'], { root: p.d });
  assert.equal(r.code, 2);
  assert.match(r.out, /refused: split file is not a plain file/);
});

test('hostile: show refuses a hard-linked architect file', () => {
  const p = project();
  fs.mkdirSync(p.split('f1'), { recursive: true });
  fs.writeFileSync(path.join(p.split('f1'), 'g1.txt'), 'a\n');
  fs.writeFileSync(path.join(p.d, 'outside.txt'), 'a\n');
  fs.linkSync(path.join(p.d, 'outside.txt'), path.join(p.split('f1'), 'architect.txt'));
  const r = main(['show', RUN, 'f1'], { root: p.d });
  assert.equal(r.code, 2);
  assert.match(r.out, /refused: split file is not a plain file/);
});

test('show still counts a plain split file', () => {
  const p = project();
  fs.mkdirSync(p.split('r1'), { recursive: true });
  fs.writeFileSync(path.join(p.split('r1'), 'g1.txt'), 'a\nb\n');
  assert.match(main(['show', RUN, 'r1'], { root: p.d }).out, /group 1: 2 entries/);
});

test('control and bidi characters in a listed path are refused', () => {
  const exec = () => JSON.stringify({ v: 1, truncated: false, reasons: [], paths: [{ path: 'a/b\u202e.mjs', lines: 1, module: null }] });
  const p = project();
  const r = main(['review', RUN, 'a'.repeat(40), '0'], { root: p.d, exec });
  assert.equal(r.code, 2);
  assert.match(r.out, /bad path entry/);
});
