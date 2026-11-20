import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, checkDrift } from './contract-drift.mjs';
import { lint } from './handoff-lint.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./handoff-lint.mjs', import.meta.url));
const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

test('the repo has no handoff drift', () => {
  const out = checkDrift(ROOT);
  const rows = Array.isArray(out) ? out : (out.errors ?? out.items ?? []);
  assert.deepEqual(rows.filter(r => /handoff/.test(JSON.stringify(r))), []);
});

const BODY = '## Did\n- work\n## Decisions\n- none\n## Blocking\n- none\n## Nits\n- none\n## Next\n- go\n';
const withCite = cite => `---\nstep: 05\nrole: backend-engineer\ntask: t\nstatus: done\nround: 0\nbase-commit: 0123456789abcdef0123456789abcdef01234567\nrisk-tier: high\ncontracts: [${cite}]\n---\nBy: backend-engineer\n${BODY}`;

test('a handoff cite below the current version is stale and the current cite passes', () => {
  const index = buildIndex(ROOT);
  const h = index.get('handoff');
  const current = `v${h.major}.${h.minor}`;
  for (const cite of ['handoff v1.2', 'handoff v1.3']) {
    assert.deepEqual(lint(withCite(cite), { index }).errors.filter(e => /contracts cite/.test(e)),
      [`frontmatter: contracts cite ${cite} is stale, current ${current}`], cite);
  }
  assert.deepEqual(lint(withCite(`handoff ${current}`), { index }).errors, []);
});

function runFolder(files) {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-v20-'));
  temps.push(dir);
  const run = join(dir, '.company', 'work', 'run1');
  mkdirSync(run, { recursive: true });
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'x.ts'), 'one\ntwo\nthree\nfour\nfive\n');
  writeFileSync(join(run, 'run-state.jsonl'), '{"v":1,"at":"2026-10-29T08:00:00Z","ev":"start"}\n');
  for (const [name, role, cite, body] of files) {
    const nn = name.slice(0, 2);
    writeFileSync(join(run, name), `---\nstep: ${nn}\nrole: ${role}\ntask: run1\nstatus: done\nround: 0\nbase-commit: 0123456789abcdef0123456789abcdef01234567\nrisk-tier: medium\ncontracts: [${cite}]\n---\nBy: ${role}\n${body}\n`);
  }
  return run;
}

test('--contests on a v1.2-era run folder: the evidence ERROR shows, the contracts key is never read, the later evidence contest counts', () => {
  const review = '## Did\n- Reviewed.\n## Blocking\n- [spec] R-1 src/x.ts:3 — empty case — return early\n## Nits\n- none\n## Next\n- backend-engineer: fix.';
  const contested = line => `## Did\n- Changed.\n## Contested\n${line}\n## Nits\n- none\n## Next\n- code-reviewer: answer.`;
  const run = runFolder([
    ['05-code-reviewer.md', 'code-reviewer', 'handoff v1.2', review],
    ['06-backend-engineer.md', 'backend-engineer', 'handoff v1.2', contested('- 05-code-reviewer:R-1 — the code already handles it')],
    ['07-backend-engineer.md', 'backend-engineer', 'handoff v2.0', contested('- 05-code-reviewer:R-1 — the code handles it — evidence: src/x.ts:3')],
  ]);
  const r = spawnSync(process.execPath, [SCRIPT, '--contests', run], { encoding: 'utf8' });
  assert.match(r.stdout, /^ERROR 06-backend-engineer\.md line \d+: contest of 05-code-reviewer:R-1 has no checkable evidence$/m, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /contracts/);
  assert.match(r.stdout, /^state 05-code-reviewer:R-1 contested$/m);
});
