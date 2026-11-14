import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, checkDrift } from './contract-drift.mjs';
import { lint } from './handoff-lint.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./handoff-lint.mjs', import.meta.url));
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

// Paths (relative to the repo, forward slashes) whose text may still hold the old number; each is a prefix.
const KEPT = Object.freeze([
  'scripts/handoff-v20.test.mjs',
  'scripts/pilot-text.test.mjs',
  'tests/fixtures/plan-review/root/',
]);
const OLD_CITES = [/handoff v1\.3(?![0-9])/, /`handoff` v1\.3(?![0-9])/, /handoff\.md v1\.3(?![0-9])/];
const SCAN_DIRS = ['docs', 'skills', 'agents', 'scripts', 'tests'];
const MAX_FILE = 1024 * 1024;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) { if (name !== 'node_modules') yield* files(p); } else if (st.isFile() && st.size <= MAX_FILE) yield p;
  }
}

test('the index reads handoff as major 2, minor 7, and version.txt holds 2.7', () => {
  const h = buildIndex(ROOT).get('handoff');
  assert.equal(h.major, 2);
  assert.equal(h.minor, 7);
  assert.equal(read('tests/contracts/handoff/version.txt').trim(), '2.7');
  assert.equal(read('docs/contracts/handoff.md').split('\n')[0], '# Contract: handoff v2.7');
});

test('the repo has no handoff drift', () => {
  const out = checkDrift(ROOT);
  const rows = Array.isArray(out) ? out : (out.errors ?? out.items ?? []);
  assert.deepEqual(rows.filter(r => /handoff/.test(JSON.stringify(r))), []);
});

test('no file of docs, skills, agents, scripts or tests cites handoff v1.3 outside the kept list', () => {
  const hits = [];
  for (const dir of SCAN_DIRS) {
    for (const p of files(join(ROOT, dir))) {
      const rel = relative(ROOT, p).split(sep).join('/');
      if (KEPT.some(k => rel === k || (k.endsWith('/') && rel.startsWith(k)))) continue;
      const text = readFileSync(p, 'utf8');
      text.split('\n').forEach((line, i) => { if (OLD_CITES.some(re => re.test(line))) hits.push(`${rel}:${i + 1}`); });
    }
  }
  assert.deepEqual(hits, []);
});

const BODY = '## Did\n- work\n## Decisions\n- none\n## Blocking\n- none\n## Nits\n- none\n## Next\n- go\n';
const withCite = cite => `---\nstep: 05\nrole: backend-engineer\ntask: t\nstatus: done\nround: 0\nbase-commit: 0123456789abcdef0123456789abcdef01234567\nrisk-tier: high\ncontracts: [${cite}]\n---\nBy: backend-engineer\n${BODY}`;

test('a handoff cite is stale below or above v2.1 and passes at v2.0 and v2.1', () => {
  const index = buildIndex(ROOT);
  for (const cite of ['handoff v1.2', 'handoff v1.3', 'handoff v2.8']) {
    assert.deepEqual(lint(withCite(cite), { index }).errors.filter(e => /contracts cite/.test(e)),
      [`frontmatter: contracts cite ${cite} is stale, current v2.7`], cite);
  }
  for (const ok of ['handoff v2.0', 'handoff v2.1', 'handoff v2.2', 'handoff v2.3', 'handoff v2.4', 'handoff v2.5', 'handoff v2.6', 'handoff v2.7']) assert.deepEqual(lint(withCite(ok), { index }).errors, []);
});

test('the Contract carries the migration section and no longer calls part 5 a minor bump', () => {
  const text = read('docs/contracts/handoff.md');
  const at = text.indexOf('\n## Migration from v1.2\n');
  assert.ok(at > 0, 'missing section');
  assert.equal(text.indexOf('\n## ', at + 5), -1, 'the section is last');
  const mig = text.slice(at);
  assert.match(mig, /has no checkable evidence/);
  assert.match(mig, /names no run/);
  assert.match(mig, /latest `start`/);
  assert.match(mig, /`contracts:` names `handoff` v1\.x/);
  assert.match(mig, /--exceptions-for/);
  assert.match(mig, /`contracts: \[handoff v2.1]`/);
  assert.doesNotMatch(text, /minor bump although|part 5[^.\n]*minor bump|It is a minor bump/);
  assert.doesNotMatch(text, /If v1\.2 ships alone first/);
  assert.match(text, /^## v2\.0 part 5:/m);
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
