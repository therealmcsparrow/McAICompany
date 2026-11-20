// Acceptance net for the own anti-slop pass: manifest sweep, scanner and voice profile behaviour through their CLIs,
// test and CI wiring, no dependencies.
// Nothing here reads the company folder: the suite must pass in CI where it is absent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { manifestFromBaseline, retiredSkills } from './install-skills.mjs';
import { readBaseline } from './skill-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const scan = path.join(root, 'scripts', 'slop-scan.mjs');
const profile = path.join(root, 'scripts', 'voice-profile.mjs');

let tmp;
let env;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-slop-acc-'));
  const gitConfig = path.join(tmp, 'gitconfig');
  fs.writeFileSync(gitConfig, '');
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
  };
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const manifest = () => manifestFromBaseline(readBaseline());
const retired = () => retiredSkills(manifest(), path.join(root, 'releases'));
const node = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8' });
const fixtureDir = (name) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d; };

test('AC1: the manifest lists no retired name', () => {
  const text = JSON.stringify(manifest()).toLowerCase();
  for (const n of retired()) assert.ok(!text.includes(n.toLowerCase()));
});

test('AC5: planted tells are reported with line and rule id, identically twice, exit 0', () => {
  const d = fixtureDir('ac5');
  fs.writeFileSync(path.join(d, 'a.md'), 'Plain line.\nWe leverage a robust tapestry.\nIt is a game-changer.\n');
  const a = node(scan, ['a.md'], d);
  const b = node(scan, ['a.md'], d);
  assert.equal(a.status, 0);
  assert.equal(a.stdout, b.stdout);
  assert.equal(a.stderr, '');
  assert.match(a.stdout, /^a\.md:2 W01 /m);
  assert.match(a.stdout, /^a\.md:2 W02 /m);
  assert.match(a.stdout, /^a\.md:3 W03 /m);
  const j = JSON.parse(node(scan, ['--json', 'a.md'], d).stdout);
  assert.ok(j.tells.length >= 3);
  for (const t of j.tells) assert.match(t.rule, /^[WS]\d{2}$/);
});

test('AC6: a clean file has zero tells and exits 0', () => {
  const d = fixtureDir('ac6');
  fs.writeFileSync(path.join(d, 'c.md'), 'The export fails when the file is over 1 MiB.\nRun the tests with npm test.\n');
  const r = node(scan, ['c.md'], d);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^slop-scan: 0 tells, \d+ words, 0\.0 per 1000 words$/m);
});

test('AC5: scanner and profile import no network or child-process module', () => {
  for (const f of ['scripts/slop-scan.mjs', 'scripts/slop-catalog.mjs', 'scripts/voice-profile.mjs']) {
    const s = read(f);
    assert.doesNotMatch(s, /node:(http|https|net|dgram|dns|tls|child_process|worker_threads)|\bfetch\s*\(/, f);
  }
});

test('AC7: the test script picks up the scanner tests and CI runs it', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts.test.includes('"scripts/*.test.mjs"'), pkg.scripts.test);
  for (const f of ['scripts/slop-scan.test.mjs', 'scripts/slop-catalog.test.mjs', 'scripts/voice-profile.test.mjs']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
  assert.match(read('.github/workflows/ci.yml'), /^\s*(?:- )?run: npm test\s*$/m);
});

function docsFixture(name, docs) {
  const d = fixtureDir(name);
  fs.writeFileSync(path.join(d, 'README.md'), 'We keep this guide short. You can read it in a minute.\n');
  fs.mkdirSync(path.join(d, 'docs'));
  for (const [f, t] of Object.entries(docs)) fs.writeFileSync(path.join(d, 'docs', f), t);
  return d;
}

test('AC8: the profile reads README and docs only, never the company folder or other homes', () => {
  const d = docsFixture('ac8', {
    'one.md': 'The quokka registry keeps every quokka entry tidy.\n',
    'two.md': 'Each quokka registry entry stays short.\n',
  });
  fs.mkdirSync(path.join(d, '.company', 'work'), { recursive: true });
  fs.writeFileSync(path.join(d, '.company', 'work', 'h.md'), 'The wombat ledger holds wombat ledger rows. Wombat ledger again.\n');
  fs.writeFileSync(path.join(d, '.company', 'work', 'h2.md'), 'Another wombat ledger page.\n');
  fs.mkdirSync(path.join(env.HOME, '.claude', 'projects'), { recursive: true });
  fs.writeFileSync(path.join(env.HOME, '.claude', 'projects', 't.md'), 'Platypus transcript platypus text.\n');
  const r = node(profile, [], d);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^voice profile: 3 files, /m);
  assert.match(r.stdout, /quokka/);
  assert.doesNotMatch(r.stdout, /wombat|ledger|platypus/);
});

test('AC9: with no README and no docs the profile falls back and exits 0', () => {
  const d = fixtureDir('ac9');
  const r = node(profile, ['--voice-line', 'clear + bold'], d);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'voice profile: no doc text in README or docs folder; using the project voice line: clear + bold');
});

test('AC10: the profile changes when the docs change between two runs', () => {
  const d = docsFixture('ac10', {
    'one.md': 'Short words only here.\n',
    'two.md': 'Short words only there.\n',
  });
  const first = node(profile, [], d);
  fs.writeFileSync(path.join(d, 'docs', 'one.md'), 'Why does the kettle whistle? Does the kettle ever stop? Nobody knows, and we cannot tell.\n');
  const second = node(profile, [], d);
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);
  assert.notEqual(first.stdout, second.stdout);
  assert.match(first.stdout, /questions 0\.0%/);
  assert.match(second.stdout, /questions [1-9]/);
});

test('AC11: no dependencies', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) assert.ok(!(k in pkg), k);
});

test('AC12: no CI workflow or package script runs the scanner or profile', () => {
  const wf = path.join(root, '.github', 'workflows');
  for (const f of fs.readdirSync(wf)) {
    assert.doesNotMatch(fs.readFileSync(path.join(wf, f), 'utf8'), /slop-scan|voice-profile/, f);
  }
  const pkg = JSON.parse(read('package.json'));
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /slop-scan|voice-profile/);
});

test('AC12: a file full of tells still exits 0', () => {
  const d = fixtureDir('ac12');
  fs.writeFileSync(path.join(d, 'p.md'), 'Let us delve into a game-changer. It is truly pivotal.\n'.repeat(20));
  const r = node(scan, ['p.md'], d);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^slop-scan: [1-9]\d* tells/m);
});
