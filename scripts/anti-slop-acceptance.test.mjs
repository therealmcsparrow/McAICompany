// Acceptance net for the own anti-slop pass: retired-name sweep, setup and writing skill text,
// scanner and voice profile behaviour through their CLIs, test and CI wiring, ADR, glossary, manifest.
// Nothing here reads the company folder: the suite must pass in CI where it is absent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { retiredSkills } from './install-skills.mjs';
import { RULES } from './slop-catalog.mjs';

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

const manifest = () => JSON.parse(read('deps/skills.json'));
const retired = () => retiredSkills(manifest(), path.join(root, 'releases'));
const node = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8' });
const fixtureDir = (name) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d; };

test('AC1: no tracked file names a retired skill, except shipped SBOMs and old plans', () => {
  const names = retired();
  assert.ok(names.length > 0, 'retiredSkills returned nothing');
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, env, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  const files = out.toString('utf8').split('\0').filter(Boolean);
  assert.ok(files.length > 100);
  const hits = [];
  for (const rel of files) {
    if (/^releases\/[^/]+\/sbom\.cdx\.json$/.test(rel) || rel.startsWith('docs/superpowers/plans/')) continue;
    const abs = path.join(root, rel);
    let st;
    try { st = fs.lstatSync(abs); } catch { continue; }
    if (!st.isFile()) continue;
    const text = fs.readFileSync(abs).toString('latin1').toLowerCase();
    for (const n of names) if (text.includes(n.toLowerCase())) hits.push(`${rel}: ${n.length} chars`);
  }
  assert.deepEqual(hits, []);
});

test('AC1: the manifest lists no retired name', () => {
  const text = JSON.stringify(manifest()).toLowerCase();
  for (const n of retired()) assert.ok(!text.includes(n.toLowerCase()));
});

test('AC2: setup offers retired skills before its dry run, and names the three outcomes', () => {
  const s = read('skills/setup/SKILL.md');
  const offer = s.indexOf('\n1a. ');
  const second = s.indexOf('\n2. ');
  assert.ok(offer > 0 && second > offer, 'offer step must come before step 2');
  const offerText = s.slice(offer, second);
  assert.match(offerText, /install-skills --retired/);
  assert.match(offerText, /--remove <name> --dry-run/);
  for (const word of ['removed', 'manual', 'FAILED']) assert.ok(offerText.includes(word), word);
  assert.match(offerText, /Keep, no answer or a non-interactive run → remove nothing/);
  assert.match(offerText, /the CEO decides, never a subagent/);
});

test('AC2: setup description is free of retired names', () => {
  const desc = /^description: (.*)$/m.exec(read('skills/setup/SKILL.md'))[1].toLowerCase();
  for (const n of retired()) assert.ok(!desc.includes(n.toLowerCase()));
});

test('AC3: writing skill names no external skill', () => {
  const w = read('skills/writing/SKILL.md') + '\n' + read('skills/writing/references/tells.md');
  const lower = w.toLowerCase();
  for (const n of retired()) assert.ok(!lower.includes(n.toLowerCase()));
  assert.doesNotMatch(w, /npx -y skills|npx skills|\/plugin install/);
  const refs = [...w.matchAll(/(?<![\w-])([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)(?![\w-])/g)].map((m) => m[0]);
  assert.deepEqual(refs.filter((r) => !r.startsWith('aico:')), []);
});

test('AC3: every catalog id has an entry in tells.md', () => {
  const t = read('skills/writing/references/tells.md');
  assert.ok(RULES.length >= 10);
  for (const r of RULES) assert.match(t, new RegExp(`^### ${r.id} `, 'm'), r.id);
});

test('AC3: no wording about hiding AI origin or beating detectors', () => {
  const w = read('skills/writing/SKILL.md') + '\n' + read('skills/writing/references/tells.md');
  assert.doesNotMatch(w, /undetect|detector|detection|evad(e|ing)|bypass|disguis|conceal|pass(es)? as (human|hand)|sounds? (more )?human|human-like|humaniz|hide (the|that|any) /i);
});

test('AC3: writing skill carries both run.mjs commands, the voice-line rule and the no-Bash line', () => {
  const w = read('skills/writing/SKILL.md');
  assert.ok(w.includes('node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" voice-profile'));
  assert.ok(w.includes('node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" slop-scan'));
  assert.match(w, /--voice-line/);
  assert.match(w, /only when `voice:` is exactly `clear`, `bold`, `technical`, or those joined by ` \+ `/);
  assert.match(w, /slop-scan: not run \(no Bash\)/);
  assert.match(w, /Never write or imply that a scan ran when it did not/);
});

test('AC3: step 7 applies the step 4 path rule to the qa line: characters, quotes, not-scanned route', () => {
  const w = read('skills/writing/SKILL.md');
  const start = w.indexOf('\n7. ');
  assert.ok(start > 0, 'step 7 missing');
  const next = w.indexOf('\n8. ', start);
  const step7 = w.slice(start, next > 0 ? next : undefined);
  const nextLine = step7.split('\n').find((l) => l.includes('`## Next` says `qa: slop-scan'));
  assert.ok(nextLine, 'step 7 has no ## Next qa line');
  assert.match(nextLine, /`qa: slop-scan <paths>, report only, no Step of its own`/);
  assert.match(nextLine, /Apply the path rule of step 4 here/);
  assert.match(nextLine, /only if it holds just letters, digits, dot, underscore, hyphen, slash and space/);
  assert.match(nextLine, /in double quotes/);
  assert.match(nextLine, /Any other path stays out of the line; name it in `## Did` as not scanned/);
  assert.match(nextLine, /must never reach a shell Role as a ready command/);
});

test('R-22: the preset sets the voice; the profile only tunes inside it', () => {
  const w = read('skills/writing/SKILL.md');
  assert.match(w, /The preset sets the voice\. The profile only tunes sentence length, person and terms inside it\. When they disagree, the preset wins\./);
});

test('AC4: the ADR records the Legal comparison and the licence decision', () => {
  const adr = read('docs/adr/0055-aico-owns-anti-slop-pass.md');
  assert.match(adr, /Legal compared/);
  assert.match(adr, /no copied (list|wording)/);
  assert.match(adr, /CC BY-SA/);
  assert.match(adr, /MIT/);
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
  assert.match(read('.github/workflows/ci.yml'), /^\s*- run: npm test\s*$/m);
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

test('AC11: the ADR is numbered once and proposed, the glossary has the entry, no dependencies', () => {
  const adrs = fs.readdirSync(path.join(root, 'docs', 'adr')).filter((f) => f.startsWith('0055-'));
  assert.equal(adrs.length, 1);
  assert.match(read(`docs/adr/${adrs[0]}`), /^Status: (proposed|accepted)/m);
  assert.match(read('GLOSSARY.md'), /^\*\*Voice profile\*\* — /m);
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
