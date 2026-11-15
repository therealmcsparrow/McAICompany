// Regression: handoff-lint resolves Contract versions from the repo under build (the product root of the
// Handoff's .company/work folder), not only from the plugin the script was installed with.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listContractNames } from './handoff-lint.mjs';

const script = path.join(import.meta.dirname, 'handoff-lint.mjs');
const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const ID = 'P20261109.000009';
const RUN = `${ID}/01-fix`;

const handoff = (cite) => `---
step: 01
role: qa
task: ${RUN}
status: done
round: 0
base-commit: 079d7863b895c7359738a05977681fdbc33b4997
risk-tier: medium
contracts: [${cite}]
---
By: qa
## Did
- x
## Decisions
- y
## Blocking
- none
## Nits
- none
## Next
- z
`;

// A product root with its own docs/contracts and a Handoff folder; returns the Handoff path.
function product(contracts) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-branch-'));
  roots.push(r);
  const cdir = path.join(r, 'docs', 'contracts');
  fs.mkdirSync(cdir, { recursive: true });
  for (const [name, ver] of Object.entries(contracts)) {
    fs.writeFileSync(path.join(cdir, `${name}.md`), `# Contract: ${name} v${ver}\n\nbody\n`);
  }
  const dir = path.join(r, '.company', 'work', ...RUN.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(path.dirname(dir), '00-project.md'), 'A demo project\n');
  return path.join(dir, '01-qa.md');
}

function lintCite(file, cite) {
  fs.writeFileSync(file, handoff(cite));
  const r = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout };
}

test('a Contract version raised on the branch is accepted (branch docs/contracts, not the plugin cache)', () => {
  const file = product({ handoff: '99.5' });
  const r = lintCite(file, 'handoff v99.5');
  assert.equal(r.code, 0, r.out);
  assert.ok(!/stale|is not a Contract/.test(r.out), r.out);
});

test('a cite above the branch version is still stale, and the message names the branch version', () => {
  const file = product({ handoff: '99.5' });
  const r = lintCite(file, 'handoff v99.6');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /stale, current v99\.5/);
});

test('a Contract that exists only on the branch is known', () => {
  const file = product({ 'brand-new-thing': '1.0' });
  const r = lintCite(file, 'brand-new-thing v1.0');
  assert.equal(r.code, 0, r.out);
});

// aico's own current Contract version, read from this repo (never hard-coded).
const aicoHandoff = fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'contracts', 'handoff.md'), 'utf8')
  .match(/^# Contract: handoff v(\d+\.\d+)/m)[1];

// Link makers return false where the OS refuses (no privilege), so a case can skip instead of passing falsely.
function tryLink(make) { try { make(); return true; } catch { return false; } }

test('a product whose docs/contracts has no aico Contract still accepts aico cites beside its own', () => {
  const file = product({ 'billing-api': '1.0' });
  const r = lintCite(file, `handoff v${aicoHandoff}, billing-api v1.0`);
  assert.equal(r.code, 0, r.out);
  assert.ok(!/is not a Contract/.test(r.out), r.out);
});

test('a product Contract wins over the plugin one of the same name; other aico cites still resolve', () => {
  const file = product({ handoff: '99.5' });
  const r = lintCite(file, 'handoff v99.5, context-guard v2.0');
  assert.equal(r.code, 0, r.out);
});

test('a docs/contracts link pointing outside the product root is not followed (plugin index is used)', (t) => {
  const file = product({});
  const root = path.resolve(path.dirname(file), '..', '..', '..', '..');
  fs.rmSync(path.join(root, 'docs'), { recursive: true, force: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-outside-'));
  roots.push(outside);
  fs.writeFileSync(path.join(outside, 'outside-thing.md'), '# Contract: outside-thing v1.0\n\nbody\n');
  fs.mkdirSync(path.join(root, 'docs'));
  if (!tryLink(() => fs.symlinkSync(outside, path.join(root, 'docs', 'contracts'), 'junction'))) return t.skip('cannot create a link');
  const bad = lintCite(file, 'outside-thing v1.0');
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /is not a Contract/);
  const ok = lintCite(file, `handoff v${aicoHandoff}`);
  assert.equal(ok.code, 0, ok.out);
});

test('a hard-linked contract file in docs/contracts is refused', (t) => {
  const file = product({ 'billing-api': '1.0' });
  const root = path.resolve(path.dirname(file), '..', '..', '..', '..');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-outside-'));
  roots.push(outside);
  const target = path.join(outside, 'secret.md');
  fs.writeFileSync(target, '# Contract: linked-thing v1.0\n\nbody\n');
  if (!tryLink(() => fs.linkSync(target, path.join(root, 'docs', 'contracts', 'linked-thing.md')))) return t.skip('cannot create a hard link');
  const bad = lintCite(file, 'linked-thing v1.0');
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /is not a Contract/);
  const ok = lintCite(file, 'billing-api v1.0');
  assert.equal(ok.code, 0, ok.out);
});

test('a wrong-case Docs folder is not read as the product docs/contracts', () => {
  const file = product({});
  const root = path.resolve(path.dirname(file), '..', '..', '..', '..');
  fs.rmSync(path.join(root, 'docs'), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'Docs', 'contracts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Docs', 'contracts', 'casey.md'), '# Contract: casey v1.0\n\nbody\n');
  const bad = lintCite(file, 'casey v1.0');
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /is not a Contract/);
});

test('an over-cap number of entries in docs/contracts is bounded: not every file is indexed', () => {
  const names = Array.from({ length: 700 }, (_, i) => `c${String(i).padStart(3, '0')}`);
  const file = product(Object.fromEntries(names.map((n) => [n, '1.0'])));
  // Fixture setup above is not timed; only one lint call is, with a bound generous enough for a loaded machine.
  const first = lintCite(file, 'c000 v1.0');
  const started = performance.now();
  const last = lintCite(file, 'c699 v1.0');
  const elapsed = performance.now() - started;
  assert.equal(last.code, 1, 'entries past the cap must be unknown');
  assert.equal(first.code, 0, 'entries under the cap must still be known');
  assert.ok(elapsed < 20000, `one lint call stays fast (took ${Math.round(elapsed)} ms)`);
});

// Bounded header read: only the first 300 bytes of a Contract file are read, so the body size never matters.
function addContract(file, fname, text) {
  const root = path.resolve(path.dirname(file), '..', '..', '..', '..');
  fs.writeFileSync(path.join(root, 'docs', 'contracts', fname), text);
}

test('a Contract file well over 300 bytes still indexes its header', () => {
  const file = product({ 'billing-api': '1.0' });
  addContract(file, 'big-body.md', `# Contract: big-body v1.0\n\n${'body line\n'.repeat(5000)}`);
  const ok = lintCite(file, 'big-body v1.0');
  assert.equal(ok.code, 0, ok.out);
});

test('a CRLF header and a header with trailing blanks past byte 300 are still indexed', () => {
  const file = product({ 'billing-api': '1.0' });
  addContract(file, 'crlf-one.md', '# Contract: crlf-one v1.0\r\nrest\r\n');
  addContract(file, 'padded.md', `# Contract: padded v1.0${' '.repeat(400)}
rest
`);
  assert.equal(lintCite(file, 'crlf-one v1.0').code, 0);
  assert.equal(lintCite(file, 'padded v1.0').code, 0);
});

test('a Contract file over the 64 KiB size limit is refused even with a valid header', () => {
  const file = product({ 'billing-api': '1.0' });
  addContract(file, 'huge.md', `# Contract: huge v1.0\n${'x'.repeat(64 * 1024 + 10)}`);
  const bad = lintCite(file, 'huge v1.0');
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /is not a Contract/);
  assert.equal(lintCite(file, 'billing-api v1.0').code, 0);
});

test('an empty or header-less .md file in docs/contracts is skipped, not fatal', () => {
  const file = product({ 'billing-api': '1.0' });
  addContract(file, 'empty.md', '');
  addContract(file, 'nohead.md', 'just text\n');
  addContract(file, 'notes.txt', '# Contract: txt-thing v1.0\n');
  assert.equal(lintCite(file, 'billing-api v1.0').code, 0);
  assert.equal(lintCite(file, 'txt-thing v1.0').code, 1);
});

// listContractNames(dir, maxEntries, maxFiles): the bounded directory walk, tested with a fake Dir (no filesystem order).
function fakeDir(entries, { throwAt } = {}) {
  const d = { reads: 0, closes: 0 };
  d.readSync = () => {
    if (throwAt !== undefined && d.reads === throwAt) throw new Error('read failed');
    return d.reads < entries.length ? { name: entries[d.reads++] } : null;
  };
  d.closeSync = () => { d.closes++; };
  return d;
}

test('listContractNames: 5001 non-.md entries then one .md: the .md is not listed and readSync is called 5000 times', () => {
  const entries = [...Array.from({ length: 5001 }, (_, i) => `n${i}.txt`), 'late.md'];
  const d = fakeDir(entries);
  assert.deepEqual(listContractNames(d, 5000, 500), []);
  assert.equal(d.reads, 5000);
  assert.equal(d.closes, 1);
});

test('listContractNames: a .md at entry 5000 is listed, one at entry 5001 is not (non-.md counted)', () => {
  const inside = fakeDir([...Array.from({ length: 4999 }, (_, i) => `n${i}.txt`), 'last.md', 'after.md']);
  assert.deepEqual(listContractNames(inside, 5000, 500), ['last.md']);
  assert.equal(inside.reads, 5000);
});

test('listContractNames: a readSync throw closes the Dir exactly once and the error propagates', () => {
  const d = fakeDir(['a.md', 'b.md', 'c.md'], { throwAt: 2 });
  assert.throws(() => listContractNames(d, 5000, 500), /read failed/);
  assert.equal(d.closes, 1);
});

test('listContractNames: closes the Dir once on a normal end, and a throw on the first read also closes', () => {
  const d = fakeDir(['a.md']);
  listContractNames(d, 10, 10);
  assert.equal(d.closes, 1);
  const e = fakeDir([], { throwAt: 0 });
  assert.throws(() => listContractNames(e, 10, 10), /read failed/);
  assert.equal(e.closes, 1);
});

test('listContractNames: returns only .md names, sorted, cut to maxFiles after sorting', () => {
  const d = fakeDir(['z.md', 'a.txt', 'b.md', 'a.md', 'c.MD', 'd.md']);
  assert.deepEqual(listContractNames(d, 100, 3), ['a.md', 'b.md', 'd.md']);
});

test('listContractNames: an empty directory gives an empty list and no extra reads', () => {
  const d = fakeDir([]);
  assert.deepEqual(listContractNames(d, 5000, 500), []);
  assert.equal(d.reads, 0);
  assert.equal(d.closes, 1);
});
