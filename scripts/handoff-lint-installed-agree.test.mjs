// Regression: the installed plugin's handoff-lint and this repo's scripts/handoff-lint.mjs give one verdict
// on `contracts:` cites for a Handoff in a product whose own docs/contracts bumped a Contract (bug: an older
// installed lint checked cites against its own cache versions only, so a product cite was "stale" there).
// Opt-in: runs only with AICO_CHECK_INSTALLED=1, because it reads the real user home (proj.M8).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoLint = path.join(import.meta.dirname, 'handoff-lint.mjs');
const enabled = process.env.AICO_CHECK_INSTALLED === '1';
const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

// The active installed aico copy that has run.mjs (CLAUDE_PLUGIN_ROOT first).
function installedRunner() {
  const cands = [];
  if (process.env.CLAUDE_PLUGIN_ROOT) cands.push(process.env.CLAUDE_PLUGIN_ROOT);
  const base = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'aico', 'aico');
  try { cands.push(...fs.readdirSync(base).sort().reverse().map(v => path.join(base, v))); } catch { /* none */ }
  // run.mjs refuses (exit 2/3) a copy that is not the active version, so probe each one.
  const refused = p => /^aico run:/m.test(spawnSync(process.execPath, [p, 'handoff-lint', path.join(os.tmpdir(), 'hl-none.md')], { encoding: 'utf8', timeout: 30000 }).stderr || '');
  return cands.map(c => path.join(c, 'scripts', 'run.mjs')).find(p => fs.existsSync(p) && !refused(p));
}
const runner = enabled ? installedRunner() : undefined;
const skipWhy = !enabled ? 'set AICO_CHECK_INSTALLED=1 to run' : (!runner ? 'no installed aico plugin' : false);

const RUN = 'P20990101.000001/01-demo';
const handoff = cite => `---
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
- None.
## Nits
- none
## Next
- z
`;

function product(contracts) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-agree-'));
  roots.push(r);
  fs.mkdirSync(path.join(r, 'docs', 'contracts'), { recursive: true });
  for (const [n, v] of Object.entries(contracts)) {
    fs.writeFileSync(path.join(r, 'docs', 'contracts', `${n}.md`), `# Contract: ${n} v${v}\n\nbody\n`);
  }
  const dir = path.join(r, '.company', 'work', ...RUN.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(path.dirname(dir), '00-project.md'), 'A demo project\n');
  return path.join(dir, '01-qa.md');
}

const verdict = (args, file) => {
  const r = spawnSync(process.execPath, [...args, file], { encoding: 'utf8', timeout: 30000 });
  const out = r.stdout || '';
  return { code: r.status, out, cites: out.split(/\r?\n/).filter(l => l.includes('contracts cite')) };
};

for (const [label, cite, branchVer] of [
  ['a product-bumped major', 'lead-session-mcp v7.1', '7.1'],
  ['a cite at the old installed version', 'lead-session-mcp v1.2', '7.1'],
]) {
  test(`installed and repo lint agree: ${label}`, { skip: skipWhy }, () => {
    const file = product({ 'lead-session-mcp': branchVer });
    fs.writeFileSync(file, handoff(cite));
    const repo = verdict([repoLint], file);
    const inst = verdict([runner, 'handoff-lint'], file);
    assert.equal(inst.code, repo.code, `installed: ${inst.out}\nrepo: ${repo.out}`);
    assert.deepEqual(inst.cites, repo.cites);
  });
}

test('installed lint accepts the cite the product Contract version names', { skip: skipWhy }, () => {
  const file = product({ 'lead-session-mcp': '7.1' });
  fs.writeFileSync(file, handoff('lead-session-mcp v7.1'));
  const inst = verdict([runner, 'handoff-lint'], file);
  assert.equal(inst.code, 0, inst.out);
  assert.ok(!/stale/.test(inst.out), inst.out);
});
