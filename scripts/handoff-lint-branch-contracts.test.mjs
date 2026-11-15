// Regression: handoff-lint resolves Contract versions from the repo under build (the product root of the
// Handoff's .company/work folder), not only from the plugin the script was installed with.
// Bug: run P20261115.000001, Roles cited Contract versions raised on the branch and lint rejected them as stale.
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
