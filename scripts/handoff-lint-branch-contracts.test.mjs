// Regression: handoff-lint resolves Contract versions from the repo under build (the product root of the
// Handoff's .company/work folder), not only from the plugin the script was installed with.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
