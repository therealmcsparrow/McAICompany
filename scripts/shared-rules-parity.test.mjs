// Tests: rule-check (handoff-lint parity retired with handoff v3.0) and the shared normalizer give byte-identical output and exit codes
// to the base commit. Base = git archive of the base commit; "now" = the same tree with the working scripts/, mods/
// and hooks/ laid over it, docs/ kept at base so only the script change is measured.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repo = path.resolve(import.meta.dirname, '..');
const BASE = '2e62437201f6f68426d0ee85804da54930aa5eb3';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-parity-'));
const A = path.join(tmp, 'base');
const B = path.join(tmp, 'now');
const keep = src => !/node_modules|\.test\.mjs$/.test(src);

before(() => {
  fs.mkdirSync(A);
  const tarFile = path.join(tmp, 'base.tar');
  const g = spawnSync('git', ['-C', repo, 'archive', '-o', tarFile, BASE, 'scripts', 'mods', 'docs', 'company', 'hooks', '.claude-plugin'], { encoding: 'utf8' });
  assert.equal(g.status, 0, g.stderr);
  const t = spawnSync('tar', ['-xf', 'base.tar', '-C', 'base'], { cwd: tmp, encoding: 'utf8' });
  assert.equal(t.status, 0, t.stderr);
  fs.cpSync(A, B, { recursive: true });
  for (const d of ['scripts', 'mods', 'hooks']) fs.cpSync(path.join(repo, d), path.join(B, d), { recursive: true, filter: keep });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(tree, script, args, cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(tree, 'scripts', script), ...args], { cwd, encoding: 'utf8', env });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
function parity(script, args, cwd = tmp) {
  const a = run(A, script, args, cwd);
  const b = run(B, script, args, cwd);
  // rule-check v1.7 (plan C15) added the `standing` command, so its usage text gains one line; drop it before comparing.
  const planned = t => t.replace(/^ {2}standing --write \| standing check\r?\n/m, '');
  if (script === 'rule-check.mjs') Object.assign(b, { stdout: planned(b.stdout), stderr: planned(b.stderr) });
  // rule-check v2.0 removed `fill-security`, so the base tree's usage text loses that line before comparing.
  const dropped = t => t.replace(/^ {2}fill-security <standards\.md> --packs <dir>\r?\n/m, '');
  if (script === 'rule-check.mjs') Object.assign(a, { stdout: dropped(a.stdout), stderr: dropped(a.stderr) });
  assert.deepEqual(b, a, `${script} ${args.join(' ')}`);
  return a;
}

const HOSTILE_EVIDENCE = [
  'src/a.mjs', 'src/dir/', 'a/b.mjs', 'SRC/A.mjs', 'a\\b', '.env', '.ENV', 'a/.env.local', '.env.example', '.env.', '.env ', '.env::$DATA',
  '.git', '.GIT', '.git.', '.git /x', 'a/.git/config', '../x', './x', 'a/../b', '/abs', 'C:/x', 'c:\\x', '\\\\srv\\share\\x', '//srv/share/x',
  'con', 'CON.txt', 'nul.', 'a/com1', 'lpt9.x', 'console', 'PROGRA~1/x', 'ENV~1', 'a/b.', 'a/b ', '-flag', 'a/-b', 'a*b', 'a?b', 'a[1]', 'a{b}',
  'a'.repeat(201), 'a'.repeat(200), '', '.', '..', 'a//b', 'sp ace', null, 5, undefined
];

test('AC20: evidencePath equals base for every hostile path (host vs scripts parity)', async () => {
  const a = await import(pathToFileURL(path.join(A, 'scripts', 'handoff-lint.mjs')).href);
  const b = await import(pathToFileURL(path.join(B, 'scripts', 'handoff-lint.mjs')).href);
  for (const p of HOSTILE_EVIDENCE) assert.deepEqual(b.evidencePath(p), a.evidencePath(p), String(p).slice(0, 40));
});

test('AC20: whatever the shared normalizer flags (.env, .git, device) the lint rejects too', async () => {
  const { normalizePath, trimAlias, isDeviceName } = await import(pathToFileURL(path.join(repo, 'hooks', 'lib', 'paths.mjs')).href);
  const b = await import(pathToFileURL(path.join(B, 'scripts', 'handoff-lint.mjs')).href);
  for (const p of HOSTILE_EVIDENCE.filter(x => typeof x === 'string' && x.length < 200)) {
    const segs = normalizePath(p).split('/');
    const sharedHit = segs.some(s => s.startsWith('.env') || trimAlias(s) === '.git' || isDeviceName(s));
    if (sharedHit) assert.equal(b.evidencePath(p).ok, false, `lint accepted ${JSON.stringify(p)}`);
  }
});

function ruleRoot(name, standards, checks) {
  const root = path.join(tmp, `r-${name}`);
  fs.mkdirSync(path.join(root, '.company', 'standards'), { recursive: true });
  if (standards !== null) fs.writeFileSync(path.join(root, '.company', 'standards.md'), standards);
  if (checks !== undefined) fs.writeFileSync(path.join(root, '.company', 'checks.json'), checks);
  return root;
}
const STANDARDS = `# Standards
## Project rules
- cap.M1 — a cap rule — why: x
- dotenv.M-SEC1 — no bulk add — source: y — check: grep
- dotenv.M-SEC1 — no env — enforced-by: hook
- Cap.M2 — upper case is not a rule
- bad.X1 — wrong class
- ${'a'.repeat(24)}.M3 — longest id
- ${'a'.repeat(25)}.M4 — too long
- lint.S2 — should
- style.Y1 — may
- cap.M1 — duplicate
## Notes
- other.M9 — outside the section
`;
const HASH = '0'.repeat(64);
const CHECKS = id => JSON.stringify({ version: 1, checks: { c1: { rule: id, text: HASH, argv: ['node', '--version'] } } });

const RC_ROOTS = {
  none: [null, undefined],
  standardsOnly: [STANDARDS, undefined],
  badRuleId: [STANDARDS, CHECKS('Cap.M1')],
  longRuleId: [STANDARDS, CHECKS(`${'a'.repeat(25)}.M1`)],
  goodRuleId: [STANDARDS, CHECKS('cap.M1')],
  unknownRule: [STANDARDS, CHECKS('nope.M1')],
  badJson: [STANDARDS, '{']
};
for (const [name, [s, c]] of Object.entries(RC_ROOTS)) {
  test(`AC20: rule-check ${name}: list, drift and usage equal base`, () => {
    const root = ruleRoot(name, s, c);
    for (const args of [['list'], ['drift'], ['bogus'], [], ['slices'], ['run'], ['text', '--base', 'abc']]) parity('rule-check.mjs', [...args, '--root', root]);
  });
}

test('AC20: rule-check parseRuleLine equals base on id edge lines', async () => {
  const a = await import(pathToFileURL(path.join(A, 'scripts', 'rule-check.mjs')).href);
  const b = await import(pathToFileURL(path.join(B, 'scripts', 'rule-check.mjs')).href);
  const lines = ['- cap.M1 — t', '- cap.M-SEC12 — t — why: w', '- Cap.M1 — t', '- cap.M — t', '- x.Y1 — a — check: c — source: s', `- ${'a'.repeat(25)}.M1 — t`, 'cap.M1 — t', '- cap.M1 - t'];
  for (const l of lines) assert.deepEqual(b.parseRuleLine(l), a.parseRuleLine(l), l);
});
