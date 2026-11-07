// Acceptance and contract suite for the skill catalog, the selected install, the role-skills commands and the
// resolved Role selections. Every test uses stand-ins and per-test temp folders: no real installer, no gh,
// no real home. Verdicts come from return values, exit codes, JSON and files, never from reporter text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main as install, installExec, retiredSkills } from './install-skills.mjs';
import { check } from './check.mjs';
import { buildSbom, serialize } from './sbom.mjs';
import { main as roleSkills, stale, migrate, pending, pendingCounts } from './role-skills.mjs';
import { readCatalog, readBaseline, skillStatus, boundedFolderHash, userCatalogPath, validateEntry, selectable } from './skill-catalog.mjs';
import { resolveSettings, writeLayer, Refusal } from './settings.mjs';
import { startServer } from './settings-server.mjs';

const SETTINGS = path.join(import.meta.dirname, 'settings.mjs');
const COMMIT = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const TODAY = new Date().toISOString().slice(0, 10);
const NAME = 'demo-skill';
const SOURCE = 'octo/skills';

function tmp(t, label = 'rsa') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const userFile = (home) => path.join(home, '.mcsparrow', '3rdpartyskills.json');
function writeUser(home, entries, extra = {}) {
  fs.mkdirSync(path.join(home, '.mcsparrow'), { recursive: true });
  fs.writeFileSync(userFile(home), JSON.stringify({ schema: 1, entries, ...extra }));
}
const readUser = (home) => JSON.parse(fs.readFileSync(userFile(home), 'utf8')).entries;
const entry = (extra = {}) => ({ skillname: NAME, skillcategory: 'engineering', skillrepo: SOURCE, skillcommit: COMMIT, license: 'MIT', ...extra });
function plant(dir, body = 'hello') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
  return boundedFolderHash(dir);
}
const find = (home, name) => readCatalog({ home }).entries.find((e) => e.skillname === name);

// ---------- validation and read bounds ----------

test('AC2: a bad user entry is named by number and field, never echoed, and cannot be selected', (t) => {
  const home = tmp(t);
  const secret = 'SECRET-TEXT-9';
  writeUser(home, [
    entry({ skillname: 'good-one' }),
    entry({ skillname: secret.toLowerCase(), skillcategory: 'nonsense' }),
    entry({ skillname: 'no-license', license: undefined }),
    entry({ skillname: 'bad-repo', skillrepo: `${secret}/../x` }),
    { skillname: 'proto', skillcategory: 'engineering', skillrepo: SOURCE, skillcommit: COMMIT, license: 'MIT', __proto__x: 1, ['__proto__']: { a: 1 } }
  ]);
  const r = readCatalog({ home });
  assert.ok(r.entries.some((e) => e.skillname === 'good-one'));
  assert.ok(!r.entries.some((e) => ['no-license', 'bad-repo'].includes(e.skillname)));
  const text = r.errors.join('\n');
  assert.match(text, /entry 2: skillcategory/);
  assert.match(text, /entry 3: license/);
  assert.match(text, /entry 4: skillrepo/);
  assert.ok(!text.includes(secret) && !text.toLowerCase().includes('secret'));
  assert.ok(r.entries.some((e) => e.skillname === 'find-skills'), 'baseline still works');
});

test('AC2: an oversize file, a bad JSON file and a link give an empty user layer and one error each', (t) => {
  const home = tmp(t);
  fs.mkdirSync(path.join(home, '.mcsparrow'));
  fs.writeFileSync(userFile(home), `{"schema":1,"entries":[],"pad":"${'x'.repeat(300 * 1024)}"}`);
  let r = readCatalog({ home });
  assert.equal(r.entries.filter((e) => e.layer === 'user').length, 0);
  assert.match(r.errors[0], /^ERROR user catalog: file too large/);
  fs.writeFileSync(userFile(home), '{not json');
  r = readCatalog({ home });
  assert.match(r.errors[0], /^ERROR user catalog: bad JSON/);
  assert.ok(r.entries.length > 0);
  const real = path.join(home, 'real.json');
  fs.writeFileSync(real, JSON.stringify({ schema: 1, entries: [entry()] }));
  fs.rmSync(userFile(home));
  try { fs.symlinkSync(real, userFile(home)); } catch (e) { t.skip(`link not allowed here: ${e.code}`); return; }
  r = readCatalog({ home });
  assert.match(r.errors[0], /^ERROR user catalog: link/);
  assert.ok(!r.entries.some((e) => e.skillname === NAME));
});

test('AC2: a baseline entry with no license is valid, selectable and shows no license on record', () => {
  const base = readBaseline().entries.find((e) => e.skillname === 'vercel-react-best-practices');
  assert.equal(base.license, undefined);
  assert.equal(selectable(base).ok, true);
  assert.equal(skillStatus(base, { home: os.tmpdir() + path.sep + 'none-rsa', productRoot: os.tmpdir() + path.sep + 'none-rsa2' }).license, 'no license on record');
});

test('AC9: U+202E, U+200B and U+3164 in a license are refused on read, at add and at record, unechoed; MIT License passes', (t) => {
  for (const ch of ['‮', '​', 'ㅤ']) {
    assert.equal(validateEntry(entry({ license: `MIT${ch}x` }), 'user').ok, false);
    const home = tmp(t);
    writeUser(home, [entry({ license: `MIT${ch}x` })]);
    const r = readCatalog({ home });
    assert.match(r.errors.join(''), /entry 1: license/);
    assert.ok(!r.errors.join('').includes(ch));
    const add = [];
    const code = roleSkills(['add'], { home: tmp(t), log: (l) => add.push(l), stdin: JSON.stringify({ name: 'demo', repo: SOURCE, commit: COMMIT, category: 'engineering', license: `MIT${ch}x`, save: true }) });
    assert.equal(code, 1);
    assert.match(add.join('\n'), /^ERROR license/);
    assert.ok(!add.join('').includes(ch));
    const h2 = tmp(t);
    const rec = [];
    const cwd2 = tmp(t);
    fs.mkdirSync(path.join(cwd2, '.company'));
    const code2 = roleSkills(['record'], { home: h2, cwd: cwd2, log: (l) => rec.push(l), stdin: JSON.stringify({ entry: { skillname: 'demo', skillcategory: 'engineering', skillrepo: SOURCE, skillcommit: COMMIT }, license: `MIT${ch}x`, roles: [] }) });
    assert.equal(code2, 1);
    assert.match(rec.join('\n'), /^ERROR license/);
    assert.ok(!rec.join('').includes(ch));
    assert.equal(fs.existsSync(userFile(h2)), false);
  }
  assert.equal(validateEntry(entry({ license: 'MIT License' }), 'user').ok, true);
});

// ---------- the read path never moves ----------

test('AC10: a planted catalog file, project env and planted HOME or USERPROFILE add no entry and do not move the path', (t) => {
  const real = tmp(t, 'real');
  const planted = tmp(t, 'planted');
  const cwd = tmp(t, 'cwd');
  for (const f of [path.join(cwd, '3rdpartyskills.json'), path.join(cwd, '.mcsparrow', '3rdpartyskills.json'), path.join(planted, '.mcsparrow', '3rdpartyskills.json')]) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ schema: 1, entries: [entry({ skillname: 'planted-skill' })] }));
  }
  fs.mkdirSync(path.join(cwd, '.claude'));
  fs.writeFileSync(path.join(cwd, '.claude', 'settings.json'), JSON.stringify({ env: { MCSPARROW_HOME: planted, HOME: planted, USERPROFILE: planted } }));
  fs.mkdirSync(path.join(cwd, '.company'));
  fs.writeFileSync(path.join(cwd, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, roles: { qa: { skills: [{ name: 'planted-skill', approved: TODAY }] } } } }));
  t.mock.method(os, 'userInfo', () => ({ homedir: real }));
  t.mock.method(os, 'homedir', () => planted);
  const was = process.env.MCSPARROW_HOME;
  delete process.env.MCSPARROW_HOME;
  t.after(() => { if (was !== undefined) process.env.MCSPARROW_HOME = was; });
  const start = process.cwd();
  process.chdir(cwd);
  try {
    assert.equal(userCatalogPath(), path.join(real, '.mcsparrow', '3rdpartyskills.json'));
    const c = readCatalog();
    assert.ok(!c.entries.some((e) => e.skillname === 'planted-skill'), 'a file in the working folder is read');
    assert.ok(c.entries.some((e) => e.skillname === 'find-skills'));
  } finally { process.chdir(start); }
  // Control: the same read does see a user entry in the real home.
  writeUser(real, [entry({ skillname: 'real-skill' })]);
  assert.ok(readCatalog().entries.some((e) => e.skillname === 'real-skill'));
});

test('AC10: with MCSPARROW_HOME elsewhere the user catalog is not read or written', (t) => {
  const real = tmp(t, 'real');
  const elsewhere = tmp(t, 'elsewhere');
  writeUser(real, [entry()]);
  t.mock.method(os, 'userInfo', () => ({ homedir: real }));
  const was = process.env.MCSPARROW_HOME;
  process.env.MCSPARROW_HOME = elsewhere;
  t.after(() => { if (was === undefined) delete process.env.MCSPARROW_HOME; else process.env.MCSPARROW_HOME = was; });
  const c = readCatalog();
  assert.ok(!c.entries.some((e) => e.skillname === NAME));
  assert.ok(c.warnings.some((w) => w.includes('MCSPARROW_HOME')));
  const lines = [];
  const before = fs.readFileSync(userFile(real), 'utf8');
  assert.equal(roleSkills(['add'], { log: (l) => lines.push(l), stdin: JSON.stringify({ name: 'other', repo: SOURCE, commit: COMMIT, category: 'engineering', license: 'MIT', save: true }) }), 1);
  assert.equal(fs.readFileSync(userFile(real), 'utf8'), before);
});

// ---------- status ----------

test('AC17: repo entry statuses, the planted folder under a user-level selection, and a good home copy beside it', (t) => {
  const home = tmp(t, 'home');
  const root = tmp(t, 'root');
  const e = entry();
  assert.equal(skillStatus(e, { home, productRoot: root, scope: 'project' }).status, 'missing');
  const hash = plant(path.join(root, '.agents', 'skills', NAME));
  assert.equal(skillStatus(e, { home, productRoot: root, scope: 'project' }).status, 'folder not recognized');
  assert.equal(skillStatus({ ...e, hash }, { home, productRoot: root, scope: 'project' }).status, 'installed');
  const user = skillStatus({ ...e, hash }, { home, productRoot: root, scope: 'user' });
  assert.equal(user.status, 'missing', 'a matching hash only in the product root does not count at user scope');
  const homeHash = plant(path.join(home, '.agents', 'skills', NAME));
  const both = skillStatus({ ...e, hash: homeHash }, { home, productRoot: root, scope: 'user' });
  assert.equal(both.status, 'installed');
  assert.equal(both.place, 'user');
  const nameOnly = { skillname: 'find-skills', skillcategory: 'research', skillrepo: 'vercel-labs/skills' };
  assert.equal(skillStatus(nameOnly, { home, productRoot: root, scope: 'user' }).status, 'not found');
  plant(path.join(root, '.claude', 'skills', 'find-skills'));
  assert.equal(skillStatus(nameOnly, { home, productRoot: root, scope: 'user' }).status, 'not found');
  assert.equal(skillStatus(nameOnly, { home, productRoot: root, scope: 'project' }).status, 'installed (name only)');
});

test('AC17: a command entry shows not vetted even with a date; a plugin reads checked at run start', () => {
  const cmd = { skillname: 'cmd-skill', skillcategory: 'design', skillinstaller: 'npx -y thing@1.2.3 skills install', license: 'MIT', vetted: '2026-01-01' };
  assert.equal(skillStatus(cmd, { home: os.tmpdir() + '/none-a', productRoot: os.tmpdir() + '/none-b' }).vetted, null);
  assert.equal(skillStatus({ skillname: 'aico:ui-design', skillcategory: 'design', skillplugin: 'aico' }, {}).status, 'checked at run start');
});

// ---------- the selected install, with stand-ins ----------

const settingsFor = (lists, moved = false) => ({
  settings_folder_moved: moved,
  roles: Object.fromEntries(Object.entries(lists).map(([role, [level, names]]) => [role, { skills: names.map((name) => ({ name, approved: TODAY })), source: { skills: level } }]))
});

// A fake npx and npx.cmd first on PATH that write a marker when anything starts them; the PATH is put back after the test.
function plantNpx(t) {
  const bin = tmp(t, 'bin');
  const marker = path.join(tmp(t, 'marker'), 'ran');
  fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'npx.cmd'), `@echo off\r\ntype nul > "${marker}"\r\n`);
  const was = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${was}`;
  t.after(() => { process.env.PATH = was; });
  return marker;
}
const CMD_ENTRY = { skillname: 'cmd-skill', skillcategory: 'engineering', skillinstaller: 'npx -y evil@1.0.0 go', license: 'MIT' };

function setup(t, { entries = [entry()], lists = { qa: ['user', [NAME]] }, scan = {}, install: custom, moved = false } = {}) {
  const home = tmp(t, 'home');
  const root = tmp(t, 'root');
  if (entries.length) writeUser(home, entries);
  const scanHash = plant(tmp(t, 'scan'));
  const log = [];
  const calls = [];
  const vets = [];
  const env = {
    home, productRoot: root, today: TODAY, log: (x) => log.push(x), settings: settingsFor(lists, moved),
    scanInstalled: async () => ({ results: [{ verdict: 'pass', blocking: false }] }),
    vet: async (arg) => { vets.push(arg); return { commit: COMMIT, hash: scanHash, result: { verdict: 'pass', counts: { critical: 0, high: 0 } }, ...scan }; },
    exec: (cmd, cwd, argv) => {
      calls.push({ cmd, cwd, argv });
      if (custom) custom({ cmd, cwd, argv, home, root });
      else plant(argv.includes('-g') ? path.join(home, '.claude', 'skills', NAME) : path.join(root, '.agents', 'skills', NAME));
    }
  };
  return { home, root, env, log, calls, vets, scanHash };
}

test('AC12: a clean scan installs once and stores hash and the date of the scan; every Install scans again', async (t) => {
  const s = setup(t, { entries: [entry({ vetted: '2026-01-01' })] });
  assert.equal(await install(['--selected'], s.env), 0, s.log.join('|'));
  assert.equal(s.vets.length, 1);
  assert.equal(find(s.home, NAME).hash, s.scanHash);
  assert.equal(find(s.home, NAME).vetted, TODAY);
  const s2 = setup(t);
  await install(['--selected'], s2.env);
  s2.calls.length = 0;
  await install(['--selected'], s2.env);
  assert.equal(s2.vets.length, 1, 'an installed and bound skill binds without a second install');
  assert.equal(s2.calls.length, 0);
});

test('AC12: a failed scan and an erroring scan install nothing, clear hash and vetted, and report missing', async (t) => {
  const bad = { result: { verdict: 'fail', counts: { critical: 1, high: 0 } } };
  for (const scan of [bad, { refused: 'scan error' }]) {
    const s = setup(t, { entries: [entry({ hash: 'c'.repeat(64), vetted: '2026-01-01' })], scan });
    assert.equal(await install(['--selected'], s.env), 1);
    assert.equal(s.calls.length, 0);
    const e = find(s.home, NAME);
    assert.equal(e.hash, undefined);
    assert.equal(e.vetted, undefined);
    assert.ok(s.log.join('|').includes('missing'));
  }
  const s = setup(t, { entries: [entry({ hash: 'c'.repeat(64) })] });
  s.env.vet = async () => { throw new Error('boom'); };
  assert.equal(await install(['--selected'], s.env), 1);
  assert.equal(find(s.home, NAME).hash, undefined);
});

test('AC12: a user entry with no license is not scanned or installed and the error names the field', async (t) => {
  const s = setup(t, { entries: [entry({ license: undefined })] });
  const code = await install(['--selected'], s.env);
  assert.equal(s.vets.length, 0);
  assert.equal(s.calls.length, 0);
  assert.ok(s.log.some((l) => /entry 1: license/.test(l)));
  assert.equal(code, 0);
});

test('AC2: a command entry with no license or with a shell operator prints no manual line, with or without --dry-run, and the error names entry and field', async (t) => {
  const noLicense = { skillname: 'no-license', skillcategory: 'engineering', skillinstaller: 'npx -y thing@1.2.3 go' };
  const shellOp = { skillname: 'shell-op', skillcategory: 'engineering', skillinstaller: 'npx -y thing@1.2.3 go && touch x', license: 'MIT' };
  for (const dry of [[], ['--dry-run']]) {
    const s = setup(t, { entries: [noLicense, shellOp], lists: { qa: ['user', ['no-license', 'shell-op']] } });
    await install(['--selected', ...dry], s.env);
    const text = s.log.join('\n');
    assert.ok(!s.log.some((l) => l.startsWith('manual ')), text);
    assert.ok(!s.log.some((l) => l.startsWith('WARNING:')), text);
    assert.equal(s.calls.length, 0);
    assert.equal(s.vets.length, 0);
    assert.match(text, /entry 1: license/);
    assert.match(text, /entry 2: skillinstaller/);
  }
});

test('AC12: hash differs exits 1, stores nothing and the skill is off the dispatch list', async (t) => {
  const s = setup(t, { install: ({ argv, home }) => plant(path.join(home, '.claude', 'skills', NAME), `other-${argv.length}`) });
  assert.equal(await install(['--selected'], s.env), 1);
  assert.equal(find(s.home, NAME).hash, undefined);
  const out = [];
  await install(['--status'], { ...s.env, log: (l) => out.push(l) });
  assert.match(out.find((l) => l.startsWith(NAME)), /dispatch: no/);
});

test('AC11: --skill installs only the Install pick beside a Skip; a name outside the selection or failing the pattern refuses', async (t) => {
  const second = entry({ skillname: 'second-skill', skillrepo: 'octo/second' });
  const s = setup(t, { entries: [entry(), second], lists: { qa: ['user', [NAME, 'second-skill']] }, install: ({ argv, home }) => plant(path.join(home, '.claude', 'skills', argv[argv.indexOf('-s') + 1])) });
  assert.equal(await install(['--selected', `--skill=${NAME}`], s.env), 0, s.log.join('|'));
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].argv[s.calls[0].argv.indexOf('-s') + 1], NAME);
  assert.equal(s.vets.length, 1);
  assert.equal(find(s.home, 'second-skill').hash, undefined);
  for (const bad of ['--skill=not-selected', '--skill=Bad_Name', '--skill=../x', '--skill=']) {
    const t2 = setup(t, { entries: [entry(), second], lists: { qa: ['user', [NAME, 'second-skill']] } });
    assert.equal(await install(['--selected', bad], t2.env), 1, bad);
    assert.equal(t2.calls.length, 0);
    assert.equal(t2.vets.length, 0);
  }
});

test('AC11: a skill selected at user level by one Role and at project level by another installs once, -g from the home', async (t) => {
  const s = setup(t, { lists: { qa: ['user', [NAME]], 'senior-engineer': ['project', [NAME]] } });
  assert.equal(await install(['--selected'], s.env), 0, s.log.join('|'));
  assert.equal(s.calls.length, 1);
  assert.ok(s.calls[0].argv.includes('-g'));
  assert.equal(s.calls[0].cwd, s.home);
  assert.equal(fs.existsSync(path.join(s.root, '.agents')), false);
  const out = [];
  await install(['--status'], { ...s.env, log: (l) => out.push(l) });
  const line = out.find((l) => l.startsWith(NAME));
  assert.match(line, /installed \| place: user/);
  assert.match(line, /roles: (qa, senior-engineer|senior-engineer, qa)/);
  assert.match(line, /dispatch: yes/);
});

test('AC11: a user-level selection with a folder equal to the scan hash only in the product root does not bind', async (t) => {
  const s = setup(t);
  plant(path.join(s.root, '.agents', 'skills', NAME));
  assert.equal(await install(['--selected'], s.env), 0, s.log.join('|'));
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].cwd, s.home);
  assert.ok(s.calls[0].argv.includes('-g'));
});

test('AC17: --status line for a planted folder under a user-level selection, and a plugin line', async (t) => {
  const s = setup(t, { entries: [entry({ hash: 'c'.repeat(64) })], lists: { security: ['user', [NAME]] } });
  plant(path.join(s.root, '.agents', 'skills', NAME));
  const out = [];
  await install(['--status'], { ...s.env, log: (l) => out.push(l) });
  assert.match(out.find((l) => l.startsWith(NAME)), /\| missing \|.*dispatch: no/);
  const p = setup(t, { entries: [], lists: { 'ui-ux-designer': ['user', ['aico:ui-design']] } });
  const o2 = [];
  await install(['--status'], { ...p.env, log: (l) => o2.push(l) });
  assert.match(o2.find((l) => l.startsWith('aico:ui-design')), /checked at run start.*dispatch: session list/);
});

test('AC17: license and vetted texts, as stated, old list and no license on record', async (t) => {
  const s = setup(t, { entries: [entry({ vetted: '2026-01-02' }), entry({ skillname: 'bound-skill', skillrepo: 'octo/b', hash: 'd'.repeat(64), vetted: '2026-01-03' })], lists: { qa: ['user', [NAME, 'bound-skill']], 'frontend-engineer': ['project', ['vercel-react-best-practices']] } });
  const out = [];
  await install(['--status'], { ...s.env, log: (l) => out.push(l) });
  assert.match(out.find((l) => l.startsWith(`${NAME} `)), /MIT, as stated, not checked.*vetted 2026-01-02, from the old list, not scanned here/);
  assert.match(out.find((l) => l.startsWith('bound-skill')), /vetted 2026-01-03(?!,)/);
  const react = out.find((l) => l.startsWith('vercel-react-best-practices'));
  assert.match(react, /no license on record/);
  assert.match(react, /not vetted/);
});

// ---------- nothing is executed ----------

test('AC13: a command entry prints manual and WARNING, runs nothing with or without --dry-run, and plants no marker', async (t) => {
  const marker = path.join(tmp(t, 'marker'), 'ran');
  const cmd = 'npx -y skills@1.7.4 add evil/repo -g -a claude-code -y';
  for (const dry of [[], ['--dry-run']]) {
    const s = setup(t, { entries: [{ skillname: 'cmd-skill', skillcategory: 'engineering', skillinstaller: cmd, license: 'MIT' }], lists: { qa: ['user', ['cmd-skill']] } });
    assert.equal(await install(['--selected', ...dry], s.env), 0, s.log.join('|'));
    assert.equal(s.calls.length, 0);
    assert.equal(s.vets.length, 0);
    assert.ok(s.log.includes(`manual ${cmd}`));
    assert.ok(s.log.some((l) => l.startsWith('WARNING:')));
    assert.equal(fs.existsSync(marker), false);
  }
  // No exec override: a run through any other route would start the planted npx.
  const planted = plantNpx(t);
  for (const dry of [[], ['--dry-run']]) {
    const s = setup(t, { entries: [CMD_ENTRY], lists: { qa: ['user', ['cmd-skill']] } });
    delete s.env.exec;
    assert.equal(await install(['--selected', ...dry], s.env), 0, s.log.join('|'));
    assert.ok(s.log.includes(`manual ${CMD_ENTRY.skillinstaller}`), s.log.join('|'));
    assert.equal(s.vets.length, 0);
    assert.equal(fs.existsSync(planted), false, `a planted npx ran ${dry.join(' ')}`);
  }
  const g = [];
  const calls = [];
  assert.equal(await install(['--dry-run', 'core'], { home: tmp(t), log: (l) => g.push(l), exec: (...a) => calls.push(a) }), 0);
  assert.ok(g.some((l) => l.startsWith('manual ') && l.includes('impeccable@')));
  assert.ok(g.some((l) => l.startsWith('WARNING:')));
  assert.ok(!calls.length);
});

test('AC18: status starts no child, parses and runs no command text, and reads no file content through a link (where a link leads and which names are there may be looked up)', (t) => {
  const bin = tmp(t, 'bin');
  const marker = path.join(tmp(t, 'marker'), 'ran');
  fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'npx.cmd'), `@echo off\r\ntype nul > "${marker}"\r\n`);
  const was = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${was}`;
  t.after(() => { process.env.PATH = was; });
  const home = tmp(t, 'home');
  const cmd = { skillname: 'cmd-skill', skillcategory: 'engineering', skillinstaller: `npx -y evil@1.0.0 add && touch ${marker}`, license: 'MIT' };
  // Each fixture links a different segment of the path to the skill folder.
  const fixtures = {
    'skill folder': (root) => ({ link: path.join(root, '.claude', 'skills', NAME), parent: path.join(root, '.claude', 'skills') }),
    '.claude/skills': (root) => ({ link: path.join(root, '.claude', 'skills'), parent: path.join(root, '.claude') }),
    '.claude': (root) => ({ link: path.join(root, '.claude'), parent: root }),
  };
  const opened = [];
  const record = (orig) => function spy(file, ...rest) {
    const name = file instanceof URL ? fileURLToPath(file) : Buffer.isBuffer(file) ? file.toString() : file;
    if (typeof name === 'string') opened.push(path.resolve(name));
    return orig.call(this, file, ...rest);
  };
  t.mock.method(fs, 'readFileSync', record(fs.readFileSync));
  t.mock.method(fs, 'openSync', record(fs.openSync));
  for (const [label, make] of Object.entries(fixtures)) {
    const root = tmp(t, 'root');
    const base = tmp(t, 'outside');
    // The target holds the folder the link leads to, at the same depth the linked segment has under the root.
    const depth = label === '.claude' ? ['skills', NAME] : label === '.claude/skills' ? [NAME] : [];
    const outside = path.join(base, ...depth);
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'SKILL.md'), 'x');
    const f = make(root);
    fs.mkdirSync(f.parent, { recursive: true });
    const target = label === 'skill folder' ? outside : label === '.claude/skills' ? path.dirname(outside) : path.dirname(path.dirname(outside));
    let linked = true;
    try { fs.symlinkSync(target, f.link, 'junction'); } catch { linked = false; }
    if (!linked) { t.diagnostic(`no link could be made for ${label}`); continue; }
    const hash = boundedFolderHash(outside);
    const through = [target, fs.realpathSync(target), f.link].map((x) => path.resolve(x));
    opened.length = 0;
    skillStatus(cmd, { home, productRoot: root });
    const st = skillStatus(entry({ hash }), { home, productRoot: root, scope: 'project' });
    assert.notEqual(st.status, 'installed', label);
    const hit = opened.filter((x) => through.some((d) => x === d || x.startsWith(d + path.sep)));
    assert.deepEqual(hit, [], `a file under the link target or the link was read, link at ${label}`);
  }
  assert.equal(fs.existsSync(marker), false);
});

test('AC18: install --status and the page state start no PATH binary and make no network call, with a command entry selected', async (t) => {
  const marker = plantNpx(t);
  const realFetch = globalThis.fetch;
  const outside = [];
  t.mock.method(globalThis, 'fetch', (url, ...rest) => {
    if (!String(url).startsWith('http://127.0.0.1:')) { outside.push(String(url)); throw new Error('network is off'); }
    return realFetch(url, ...rest);
  });
  const s = setup(t, { entries: [CMD_ENTRY], lists: { qa: ['user', ['cmd-skill']] } });
  delete s.env.exec;
  delete s.env.vet;
  assert.equal(await install(['--status'], s.env), 0, s.log.join('|'));
  const line = s.log.find((l) => l.startsWith('cmd-skill'));
  assert.ok(line, 'the command entry is read by --status');
  assert.match(line, /not vetted/);
  const sb = pageSandbox(t);
  writeUser(sb.home, [CMD_ENTRY]);
  const st = await openPage(t, sb);
  assert.ok(st.catalog.entries.some((e) => e.name === 'cmd-skill'), 'the command entry is read by the page');
  assert.deepEqual(outside, []);
  assert.equal(fs.existsSync(marker), false, 'a planted npx ran');
});

test('AC18: installExec pins HOME and USERPROFILE to the home and drops CLAUDE_CONFIG_DIR in any case', (t) => {
  const home = tmp(t, 'home');
  const seen = [];
  const runners = { execSync: (c, o) => seen.push(o), execFileSync: (f, a, o) => seen.push(o) };
  const planted = { claude_config_dir: '/planted', CLAUDE_CONFIG_DIR: '/planted', USERPROFILE: '/planted', HOME: '/planted' };
  const before = Object.fromEntries(Object.keys(planted).map((k) => [k, process.env[k]]));
  t.after(() => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  Object.assign(process.env, planted);
  try { installExec(home, runners, { pinHome: true })('npx -y skills@1.7.4 add a/b -g', home, ['-y', 'skills@1.7.4', 'add', 'a/b', '-g']); } catch { /* the stand-in only records */ }
  const env = seen.map((o) => o?.env).find(Boolean);
  if (env === undefined) { t.skip('no install call reached the stand-in without a download'); return; }
  assert.equal(env.HOME, home);
  assert.equal(env.USERPROFILE, home);
  assert.ok(!Object.keys(env).some((k) => k.toLowerCase() === 'claude_config_dir'));
});

// ---------- add and record commands ----------

const addLine = (extra = {}) => JSON.stringify({ name: NAME, repo: SOURCE, commit: COMMIT, category: 'engineering', license: 'MIT', ...extra });
function run(t, cmd, stdin, { home = tmp(t, 'home'), cwd = tmp(t, 'cwd'), args = [] } = {}) {
  const lines = [];
  const code = roleSkills([cmd, ...args], { home, cwd, log: (l) => lines.push(l), stdin });
  return { code, lines, home, cwd };
}

test('AC8, AC10: add previews without Save, writes atomically with Save, keeps other entries', (t) => {
  const home = tmp(t, 'home');
  writeUser(home, [entry({ skillname: 'first-one', skillrepo: 'octo/first' })]);
  const pre = run(t, 'add', addLine(), { home });
  assert.equal(pre.code, 0);
  assert.equal(readUser(home).length, 1, 'no Save writes nothing');
  assert.ok(pre.lines.join('\n').includes('nothing checks it'));
  const saved = run(t, 'add', addLine({ save: true }), { home });
  assert.equal(saved.code, 0);
  assert.deepEqual(readUser(home).map((e) => e.skillname), ['first-one', NAME]);
  assert.equal(readUser(home)[0].license, 'MIT');
  const fresh = tmp(t, 'fresh');
  assert.equal(run(t, 'add', addLine({ save: true }), { home: fresh }).code, 0);
  assert.equal(readUser(fresh).length, 1);
});

test('AC9: invalid answers name the field and write nothing', (t) => {
  const cases = [
    [{ name: 'Bad Name' }, 'name'], [{ repo: '../x' }, 'repo'], [{ commit: 'abc' }, 'commit'], [{ license: '' }, 'license'],
    [{ license: 'x'.repeat(65) }, 'license'], [{ license: 'a\u0007b' }, 'license'], [{ category: 'other' }, 'category'],
    [{ repo: undefined, command: 'npx -y thing add' }, 'command'], [{ repo: undefined, commit: undefined, command: 'npx -y thing@1.2.3; rm -rf x' }, 'command'],
    [{ repo: undefined, commit: undefined, command: 'npx -y thing@1.2.3 $(touch x)' }, 'command'], [{ license: 'MIT\nGPL' }, 'license']
  ];
  for (const [extra, field] of cases) {
    const home = tmp(t, 'home');
    const r = run(t, 'add', addLine({ ...extra, save: true }), { home });
    assert.equal(r.code, 1, field);
    assert.match(r.lines.join('\n'), new RegExp(`ERROR (input: missing )?${field}`));
    assert.equal(fs.existsSync(userFile(home)), false);
  }
  const both = run(t, 'add', addLine({ command: 'npx -y thing@1.2.3', save: true }));
  assert.equal(both.code, 1);
});

test('AC9: a $(...) value through add is stored as text and runs nothing', (t) => {
  const work = tmp(t, 'work');
  const start = process.cwd();
  process.chdir(work);
  try {
    const r = run(t, 'add', addLine({ license: '$(touch rsa-ran)', save: true }));
    assert.equal(r.code, 0, r.lines.join('|'));
    assert.equal(readUser(r.home)[0].license, '$(touch rsa-ran)');
    assert.equal(fs.existsSync(path.join(work, 'rsa-ran')), false);
    assert.equal(fs.existsSync(path.join(r.cwd, 'rsa-ran')), false);
  } finally { process.chdir(start); }
});

test('AC9: add and record refuse an extra argument and a second line', (t) => {
  for (const cmd of ['add', 'record']) {
    const a = run(t, cmd, addLine({ save: true }), { args: ['--name=x'] });
    assert.equal(a.code, 1);
    assert.equal(fs.existsSync(userFile(a.home)), false);
    const b = run(t, cmd, `${addLine({ save: true })}\n${addLine({ save: true })}`);
    assert.equal(b.code, 1);
    assert.equal(fs.existsSync(userFile(b.home)), false);
    const c = run(t, cmd, ' '.repeat(70 * 1024));
    assert.equal(c.code, 1);
  }
});

test('AC9: taken names, and the pin form: Keep and Cancel write nothing, Move changes only commit and license', (t) => {
  const home = tmp(t, 'home');
  writeUser(home, [entry({ hash: 'e'.repeat(64), vetted: '2026-01-01' })]);
  const before = fs.readFileSync(userFile(home), 'utf8');
  assert.equal(run(t, 'add', addLine({ save: true }), { home }).code, 1, 'same source and commit is taken');
  assert.equal(run(t, 'add', addLine({ repo: 'other/repo', save: true }), { home }).code, 1, 'another source is taken');
  assert.equal(run(t, 'add', addLine({ name: 'find-skills', repo: 'someone/else', save: true }), { home }).code, 1, 'a baseline name with another source is taken');
  assert.equal(run(t, 'add', addLine({ commit: OTHER, save: true }), { home }).code, 1, 'Save without Move');
  const preview = run(t, 'add', addLine({ commit: OTHER }), { home });
  assert.equal(preview.code, 0);
  assert.equal(fs.readFileSync(userFile(home), 'utf8'), before);
  assert.equal(run(t, 'add', addLine({ commit: OTHER, license: 'Apache-2.0', save: true, move: true, category: 'design' }), { home }).code, 0);
  const moved = readUser(home)[0];
  assert.equal(moved.skillcommit, OTHER);
  assert.equal(moved.license, 'Apache-2.0');
  assert.equal(moved.skillcategory, 'engineering');
  assert.equal(moved.hash, undefined);
  assert.equal(moved.vetted, undefined);
});

test('AC9, AC10: the baseline name with the same repo and a commit becomes a user pin with the stated license', (t) => {
  const home = tmp(t, 'home');
  const r = run(t, 'add', addLine({ name: 'find-skills', repo: 'vercel-labs/skills', category: 'research', license: 'Mine', save: true }), { home });
  assert.equal(r.code, 0, r.lines.join('|'));
  const c = readCatalog({ home });
  const pin = c.entries.find((e) => e.skillname === 'find-skills');
  assert.equal(pin.skillcommit, COMMIT);
  assert.equal(skillStatus(pin, { home, productRoot: tmp(t) }).license, 'Mine, as stated, not checked');
});

test('AC22: record writes the entry with the stated license, no vetted, and Roles only; no license writes nothing and names the entry', (t) => {
  const home = tmp(t, 'home');
  const cwd = tmp(t, 'cwd');
  fs.mkdirSync(path.join(cwd, '.company'));
  const rec = { skillname: NAME, skillcategory: 'engineering', skillrepo: SOURCE, skillcommit: COMMIT };
  const none = run(t, 'record', JSON.stringify({ entry: rec, roles: ['senior-engineer'] }), { home, cwd });
  assert.equal(none.code, 0);
  assert.ok(none.lines.join('\n').includes(`no license stated: ${NAME}`));
  assert.equal(fs.existsSync(userFile(home)), false);
  const ok = run(t, 'record', JSON.stringify({ entry: rec, license: 'MIT', roles: ['senior-engineer'] }), { home, cwd });
  assert.equal(ok.code, 0, ok.lines.join('|'));
  assert.equal(readUser(home)[0].vetted, undefined);
  assert.equal(readUser(home)[0].license, 'MIT');
  const settings = JSON.parse(fs.readFileSync(path.join(cwd, '.company', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.aico_settings.roles['senior-engineer'].skills, [{ name: NAME, approved: TODAY }]);
  const withDate = run(t, 'record', JSON.stringify({ entry: { ...rec, vetted: TODAY }, license: 'MIT', roles: [] }), { home, cwd });
  assert.equal(withDate.code, 1);
  const cmdEntry = run(t, 'record', JSON.stringify({ entry: { skillname: 'evil-cmd', skillcategory: 'engineering', skillinstaller: 'npx -y evil@1.0.0 go' }, license: 'MIT', roles: [] }), { home, cwd });
  assert.equal(cmdEntry.code, 1, 'a researcher cannot introduce a command');
  assert.equal(readUser(home).some((e) => e.skillname === 'evil-cmd'), false);
});

test('AC22: a listed command is accepted only when it is byte-identical; a changed one writes nothing', (t) => {
  const home = tmp(t, 'home');
  const cwd = tmp(t, 'cwd');
  fs.mkdirSync(path.join(cwd, '.company'));
  const base = readBaseline().entries.find((e) => e.skillname === 'impeccable');
  const same = { skillname: 'impeccable', skillcategory: base.skillcategory, skillinstaller: base.skillinstaller };
  const ok = run(t, 'record', JSON.stringify({ entry: same, roles: ['ui-ux-designer'] }), { home, cwd });
  assert.equal(ok.code, 0, ok.lines.join('|'));
  assert.equal(fs.existsSync(userFile(home)), false, 'no user file for a listed command');
  const settings = JSON.parse(fs.readFileSync(path.join(cwd, '.company', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.aico_settings.roles['ui-ux-designer'].skills, [{ name: 'impeccable', approved: TODAY }]);
  const home2 = tmp(t, 'home');
  const cwd2 = tmp(t, 'cwd');
  fs.mkdirSync(path.join(cwd2, '.company'));
  const changed = { ...same, skillinstaller: `${base.skillinstaller} --extra` };
  const bad = run(t, 'record', JSON.stringify({ entry: changed, license: 'MIT', roles: ['ui-ux-designer'] }), { home: home2, cwd: cwd2 });
  assert.equal(bad.code, 1);
  assert.ok(bad.lines.join('|').includes('ERROR entry: source differs from the list'));
  assert.equal(fs.existsSync(userFile(home2)), false);
  assert.equal(fs.existsSync(path.join(cwd2, '.company', 'settings.json')), false);
});

// ---------- resolved selections ----------

function resolved(t, { user, project, entries = [entry({ skillcategory: 'quality' })] } = {}) {
  const home = tmp(t, 'home');
  const cwd = tmp(t, 'cwd');
  fs.mkdirSync(path.join(cwd, '.company'));
  writeUser(home, entries);
  const layer = (x) => JSON.stringify({ aico_settings: { version: 1, ...x } });
  if (user) fs.writeFileSync(path.join(home, 'config.json'), layer(user));
  if (project) fs.writeFileSync(path.join(cwd, '.company', 'settings.json'), layer(project));
  return { home, cwd, get: () => resolveSettings({ home, cwd }) };
}
const pick = (...names) => names.map((name) => ({ name, approved: '2026-01-01' }));

test('AC4, AC5: a stale name and a protected project list are ignored by path, never by value; an all-ignored list falls back', (t) => {
  const r = resolved(t, { user: { roles: { 'code-reviewer': { skills: pick(NAME) }, qa: { skills: pick(NAME) } } }, project: { roles: { 'code-reviewer': { skills: pick('SECRET-GONE') }, qa: { skills: pick('SECRET-GONE') } } } });
  const s = r.get();
  assert.deepEqual(s.roles['code-reviewer'].skills.map((x) => x.name), [NAME]);
  assert.equal(s.roles['code-reviewer'].source.skills, 'user');
  assert.deepEqual(s.roles.qa.skills.map((x) => x.name), [NAME], 'an all-ignored project list falls back to the user list');
  assert.ok(s.ignored.some((l) => l.startsWith('roles.qa.skills[0].name')));
  assert.ok(s.ignored.some((l) => l.startsWith('roles.code-reviewer.skills')));
  assert.ok(!JSON.stringify(s.ignored).includes('SECRET'));
  const empty = resolved(t, { user: { roles: { qa: { skills: pick(NAME) } } }, project: { roles: { qa: { skills: [] } } } }).get();
  assert.deepEqual(empty.roles.qa.skills, [], 'an explicit empty list still replaces');
});

test('AC4: outside the Role categories or the catalog is refused on save; AC3: a 6th is refused', (t) => {
  const many = Array.from({ length: 6 }, (_, i) => entry({ skillname: `skill-${i}`, skillrepo: `octo/s${i}`, skillcategory: 'quality' }));
  const r = resolved(t, { entries: [...many, entry({ skillname: 'eng-only' })] });
  const save = (roles) => writeLayer('project', { version: 1, roles }, { home: r.home, cwd: r.cwd });
  assert.throws(() => save({ qa: { skills: [{ name: 'eng-only' }] } }), Refusal);
  assert.throws(() => save({ qa: { skills: [{ name: 'not-in-catalog' }] } }), Refusal);
  assert.throws(() => save({ qa: { skills: many.map((e) => ({ name: e.skillname })) } }), Refusal);
  assert.throws(() => save({ architect: { skills: [{ name: 'skill-0' }] } }), Refusal, 'a protected Role takes no project selection');
  save({ qa: { skills: [{ name: 'skill-0' }, { name: 'skill-1' }] } });
  assert.deepEqual(r.get().roles.qa.skills.map((x) => x.name), ['skill-0', 'skill-1']);
});

test('AC23: a save dates only the Role it changed; client dates are dropped; an unchanged save keeps the dates', (t) => {
  const r = resolved(t, { entries: [entry({ skillname: 'q-one', skillcategory: 'quality', skillrepo: 'octo/q1' }), entry({ skillname: 'q-two', skillcategory: 'quality', skillrepo: 'octo/q2' })], project: { roles: { qa: { skills: pick('q-one') }, 'persona-tester': { skills: pick('q-one') } } } });
  const save = (roles) => writeLayer('project', { version: 1, roles }, { home: r.home, cwd: r.cwd });
  save({ qa: { skills: pick('q-one', 'q-two') }, 'persona-tester': { skills: pick('q-one') } });
  const s = r.get();
  assert.deepEqual(s.roles.qa.skills.map((x) => x.approved), [TODAY, TODAY]);
  assert.deepEqual(s.roles['persona-tester'].skills.map((x) => x.approved), ['2026-01-01']);
  save({ qa: { skills: pick('q-two', 'q-one') }, 'persona-tester': { skills: pick('q-one') } });
  assert.deepEqual(r.get().roles.qa.skills.map((x) => x.approved), [TODAY, TODAY], 'order alone is no change');
});

test('AC23: stale at the 180-day boundary, with no date, with no design selection, and fresh after a record', (t) => {
  const design = entry({ skillname: 'des-one', skillcategory: 'design', skillrepo: 'octo/d1' });
  const daysAgo = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
  const was = process.env.MCSPARROW_HOME;
  delete process.env.MCSPARROW_HOME;
  t.after(() => { if (was !== undefined) process.env.MCSPARROW_HOME = was; });
  const at = (home) => {
    const info = t.mock.method(os, 'userInfo', () => ({ homedir: home }));
    const dir = t.mock.method(os, 'homedir', () => home);
    return { info, dir };
  };
  const setup = (project) => {
    const r = resolved(t, { entries: [design], project });
    at(r.home);
    return r;
  };
  const run1 = (approved) => {
    const skill = approved === undefined ? { name: 'des-one' } : { name: 'des-one', approved };
    const r = setup({ roles: { 'ui-ux-designer': { skills: [skill] } } });
    return stale({ cwd: r.cwd, today: TODAY });
  };
  assert.equal(run1(daysAgo(180)).stale, false);
  assert.equal(run1(daysAgo(181)).stale, true);
  assert.equal(run1(undefined).stale, true);
  assert.equal(run1('2999-01-01').stale, true);
  assert.equal(run1('2026-02-31').stale, true);
  const none = setup(undefined);
  assert.equal(stale({ cwd: none.cwd, today: TODAY }).stale, true);
  const r = setup({ roles: { 'ui-ux-designer': { skills: pick('des-one') } } });
  assert.equal(stale({ cwd: r.cwd, today: TODAY }).stale, true);
  const rec = run(t, 'record', JSON.stringify({ entry: { skillname: 'des-one', skillcategory: 'design', skillrepo: 'octo/d1', skillcommit: COMMIT }, license: 'MIT', roles: ['ui-ux-designer'] }), { home: r.home, cwd: r.cwd });
  assert.equal(rec.code, 0, rec.lines.join('|'));
  assert.equal(stale({ cwd: r.cwd }).stale, false, 'a record dates the selection even when it was already there');
});

test('AC23: the newest approval date counts, in either order and across UI Roles; a UI Role with only a non-design selection is stale', (t) => {
  const entries = [entry({ skillname: 'des-old', skillcategory: 'design', skillrepo: 'octo/d1' }), entry({ skillname: 'des-new', skillcategory: 'design', skillrepo: 'octo/d2' }), entry({ skillname: 'eng-one', skillcategory: 'engineering', skillrepo: 'octo/e1' })];
  const daysAgo = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
  const old = daysAgo(400);
  const fresh = daysAgo(10);
  const was = process.env.MCSPARROW_HOME;
  delete process.env.MCSPARROW_HOME;
  t.after(() => { if (was !== undefined) process.env.MCSPARROW_HOME = was; });
  const verdict = (roles) => {
    const r = resolved(t, { entries, project: { roles } });
    t.mock.method(os, 'userInfo', () => ({ homedir: r.home }));
    t.mock.method(os, 'homedir', () => r.home);
    return stale({ cwd: r.cwd, today: TODAY });
  };
  const sel = (name, approved) => ({ skills: [{ name, approved }] });
  const both = (a, b) => ({ skills: [{ name: a[0], approved: a[1] }, { name: b[0], approved: b[1] }] });
  assert.equal(verdict({ 'ui-ux-designer': sel('des-old', old) }).stale, true, 'control: the old date alone is stale');
  assert.equal(verdict({ 'ui-ux-designer': both(['des-old', old], ['des-new', fresh]) }).stale, false, 'old then fresh');
  assert.equal(verdict({ 'ui-ux-designer': both(['des-new', fresh], ['des-old', old]) }).stale, false, 'fresh then old');
  assert.equal(verdict({ 'ui-ux-designer': sel('des-old', old), 'brand-artist': sel('des-new', fresh) }).stale, false, 'the newer date on a second UI Role');
  assert.equal(verdict({ 'ui-ux-designer': sel('des-new', fresh), 'brand-artist': sel('des-old', old) }).stale, false, 'the older date on the second UI Role');
  for (const role of ['motion-artist', 'game-artist', 'prompt-artist']) {
    const off = verdict({ 'ui-ux-designer': sel('des-old', old), [role]: sel('des-new', fresh) });
    assert.equal(off.stale, true, `${role} is not a UI Role: its fresh date does not count`);
    assert.deepEqual(off.names, ['des-old']);
    assert.equal(verdict({ [role]: sel('des-new', fresh) }).reason, 'no design selection', role);
  }
  const eng = verdict({ 'frontend-engineer': sel('eng-one', fresh) });
  assert.equal(eng.stale, true);
  assert.equal(eng.reason, 'no design selection');
});

// ---------- settings folder moved ----------

test('AC10: get says settings_folder_moved true with a planted USERPROFILE, in a child with MCSPARROW_HOME in a temp folder', (t) => {
  const home = tmp(t, 'home');
  const cwd = tmp(t, 'cwd');
  const r = spawnSync(process.execPath, [SETTINGS, 'get'], { cwd, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home, USERPROFILE: home, HOME: home } });
  assert.equal(JSON.parse(r.stdout).settings_folder_moved, true);
});

test('AC10: settings_folder_moved is false only when the settings folder is the user home folder (in process)', (t) => {
  const mine = tmp(t, 'mine');
  const planted = tmp(t, 'planted');
  const cwd = tmp(t, 'cwd');
  const was = process.env.MCSPARROW_HOME;
  delete process.env.MCSPARROW_HOME;
  t.after(() => { if (was !== undefined) process.env.MCSPARROW_HOME = was; });
  t.mock.method(os, 'userInfo', () => ({ homedir: mine }));
  const at = t.mock.method(os, 'homedir', () => mine);
  assert.equal(resolveSettings({ cwd }).settings_folder_moved, false);
  at.mock.mockImplementation(() => planted);
  assert.equal(resolveSettings({ cwd }).settings_folder_moved, true);
});

test('AC10: user selections are not counted while the settings folder is moved', (t) => {
  const home = tmp(t, 'home');
  const cwd = tmp(t, 'cwd');
  writeUser(home, [entry({ skillcategory: 'quality' })]);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ aico_settings: { version: 1, roles: { qa: { skills: pick(NAME) } } } }));
  const mine = tmp(t, 'mine');
  const was = process.env.MCSPARROW_HOME;
  process.env.MCSPARROW_HOME = home;
  t.after(() => { if (was === undefined) delete process.env.MCSPARROW_HOME; else process.env.MCSPARROW_HOME = was; });
  t.mock.method(os, 'userInfo', () => ({ homedir: mine }));
  const s = resolveSettings({ cwd });
  assert.equal(s.settings_folder_moved, true);
  assert.deepEqual(s.roles.qa.skills, []);
});

// ---------- migration of the old project text ----------

const NOW = '2026-11-07';
const OLD = {
  hallmark: '- name: hallmark; source: nutlope/hallmark; license: MIT; vetted: 2026-01-10; why: looks; approved: 2026-01-11',
  pin: `- name: hallmark; source: nutlope/hallmark; license: Own-Terms; vetted: 2026-01-10; commit: ${OTHER}; why: looks; approved: 2026-01-11`,
  impeccable: '- name: impeccable; source: `npx -y impeccable skills install`; license: Apache-2.0; vetted: 2026-01-10; why: polish; approved: 2026-01-12',
  repo: `- name: fancy-ui; source: octo/fancy; license: MIT; vetted: 2026-02-01; commit: ${COMMIT}; why: fancy; approved: 2026-02-02`,
  nocommit: '- name: free; source: octo/free; license: MIT; vetted: 2026-02-01; why: w; approved: 2026-02-02',
  uiDesign: '- name: aico:ui-design; source: plugin aico; license: -; vetted: -; why: own; approved: 2026-02-03',
  otherPlugin: '- name: aico:other; source: plugin aico; license: MIT; vetted: 2026-02-01; why: own; approved: 2026-02-03',
  command: '- name: sneaky; source: `npx -y sneaky@1.0.0 install && touch x`; license: MIT; vetted: 2026-02-01; why: w; approved: 2026-02-02',
  bad: `- name: odd-one; source: octo/odd; license: MIT!x; vetted: 2026-02-01; commit: ${COMMIT}; why: w; approved: 2026-02-02`,
  stk: `- area: stack; name: stk-skill; source: octo/stk; license: MIT; vetted: 2026-02-03; commit: ${OTHER}; why: w; approved: 2026-02-04`
};

function oldProject(t, { design = [], skills = [], settings } = {}) {
  const cwd = tmp(t, 'cwd');
  const home = tmp(t, 'home');
  fs.mkdirSync(path.join(cwd, '.company'));
  const md = `# P\n\n## Design skills\n${design.join('\n')}\n\n## Skills\n${skills.join('\n')}\n\n## Other\nkeep\n`;
  fs.writeFileSync(path.join(cwd, '.company', 'project.md'), md);
  if (settings) fs.writeFileSync(path.join(cwd, '.company', 'settings.json'), JSON.stringify(settings));
  const lineOf = (i) => 4 + i;
  const skillLine = (i) => 6 + design.length + i;
  const mig = (extra = {}) => migrate({ cwd, home, today: NOW, ...extra });
  const md0 = () => fs.readFileSync(path.join(cwd, '.company', 'project.md'), 'utf8');
  const sel = () => JSON.parse(fs.readFileSync(path.join(cwd, '.company', 'settings.json'), 'utf8')).aico_settings.roles;
  return { cwd, home, md, lineOf, skillLine, mig, md0, sel };
}

test('AC20: the preview names each line by number, writes nothing, and asks no license or vetted question', (t) => {
  const p = oldProject(t, { design: [OLD.hallmark, OLD.pin, OLD.impeccable, OLD.repo, OLD.nocommit, OLD.uiDesign, OLD.otherPlugin, OLD.command, OLD.bad] });
  const r = p.mig();
  assert.equal(r.ok, true);
  const text = r.lines.join('\n');
  assert.match(text, /line 4: hallmark.*selection only/);
  assert.match(text, /line 5: hallmark.*pin on the list entry/);
  assert.match(text, /line 6: impeccable.*selection only/);
  assert.match(text, /line 7: fancy-ui.*new entry in your list/);
  assert.match(text, /line 8: stays, repo line has no commit/);
  assert.match(text, /line 9: aico:ui-design.*selection only/);
  assert.match(text, /line 10: aico:other.*new entry in your list/);
  assert.match(text, /line 11: stays, command differs from the list/);
  assert.match(text, /line 12: stays, license not valid/);
  assert.ok(!/MIT!x|octo\/odd|odd-one|touch x/.test(text), 'a failed line is never echoed');
  assert.equal(p.md0(), p.md);
  assert.equal(fs.existsSync(userFile(p.home)), false);
  assert.equal(pending({ cwd: p.cwd, home: p.home, today: NOW }), 9);
  assert.deepEqual(pendingCounts({ cwd: p.cwd, home: p.home, today: NOW }), { total: 9, migrate: 6 });
  const printed = [];
  assert.equal(roleSkills(['pending'], { cwd: p.cwd, home: p.home, today: NOW, log: (x) => printed.push(x) }), 0);
  assert.deepEqual(printed, ['pending: 9', 'can migrate: 6']);
});

test('AC14, AC20: apply writes selections and entries, keeps old dates, archives the lines and a re-run changes nothing', (t) => {
  const p = oldProject(t, { design: [OLD.hallmark, OLD.impeccable, OLD.repo, OLD.uiDesign, OLD.command] });
  const choices = [
    { n: p.lineOf(0), name: 'hallmark', roles: ['ui-ux-designer'] },
    { n: p.lineOf(1), name: 'impeccable', roles: ['ui-ux-designer'] },
    { n: p.lineOf(2), name: 'fancy-ui', roles: ['ui-ux-designer', 'brand-artist'] },
    { n: p.lineOf(3), name: 'aico:ui-design', roles: ['ui-ux-designer'] }
  ];
  const r = p.mig({ apply: true, choices });
  assert.equal(r.ok, true, r.lines.join('|'));
  const roles = p.sel();
  assert.deepEqual(roles['ui-ux-designer'].skills, [
    { name: 'hallmark', approved: '2026-01-11' }, { name: 'impeccable', approved: '2026-01-12' },
    { name: 'fancy-ui', approved: '2026-02-02' }, { name: 'aico:ui-design', approved: '2026-02-03' }]);
  assert.deepEqual(roles['brand-artist'].skills, [{ name: 'fancy-ui', approved: '2026-02-02' }]);
  const users = readUser(p.home);
  assert.deepEqual(users.map((e) => e.skillname), ['fancy-ui']);
  assert.equal(users[0].license, 'MIT');
  assert.equal(users[0].vetted, '2026-02-01');
  assert.equal(users[0].hash, undefined);
  assert.equal(users[0].skillcategory, 'design');
  const arch = path.join(p.cwd, '.company', 'archive');
  const files = fs.readdirSync(arch);
  assert.equal(files.length, 1);
  assert.match(fs.readFileSync(path.join(arch, files[0]), 'utf8'), /name: fancy-ui/);
  const md = p.md0();
  assert.doesNotMatch(md, /name: fancy-ui|name: hallmark|name: impeccable|aico:ui-design/);
  assert.match(md, /name: sneaky/, 'a line that stays remains');
  const snap = [md, JSON.stringify(roles), fs.readFileSync(userFile(p.home), 'utf8')];
  const again = p.mig({ apply: true, choices });
  assert.equal(again.ok, true);
  assert.deepEqual([p.md0(), JSON.stringify(p.sel()), fs.readFileSync(userFile(p.home), 'utf8')], snap);
  assert.equal(fs.readdirSync(arch).length, 1);
});

test('AC20: a baseline line with a commit becomes a user pin holding the line license and vetted date, never the baseline license', (t) => {
  const p = oldProject(t, { design: [OLD.pin] });
  const r = p.mig({ apply: true, choices: [{ n: p.lineOf(0), name: 'hallmark', roles: ['ui-ux-designer'] }] });
  assert.equal(r.ok, true, r.lines.join('|'));
  const pin = readUser(p.home).find((e) => e.skillname === 'hallmark');
  assert.equal(pin.skillcommit, OTHER);
  assert.equal(pin.license, 'Own-Terms');
  assert.equal(pin.vetted, '2026-01-10');
  assert.equal(pin.hash, undefined);
  assert.equal(pin.skillrepo, 'nutlope/hallmark');
});

test('AC20: a command line is selection-only when byte-equal to the baseline install, and the user file never gets a command', (t) => {
  const p = oldProject(t, { design: [OLD.impeccable, OLD.command] });
  const r = p.mig({ apply: true, choices: [{ n: p.lineOf(0), name: 'impeccable', roles: ['ui-ux-designer'] }, { n: p.lineOf(1), name: 'sneaky', roles: ['ui-ux-designer'] }] });
  assert.equal(r.ok, true, r.lines.join('|'));
  assert.equal(fs.existsSync(userFile(p.home)), false);
  assert.deepEqual(p.sel()['ui-ux-designer'].skills.map((x) => x.name), ['impeccable']);
  assert.match(p.md0(), /name: sneaky/);
});

test('AC20: a protected or unlisted Role stays, a Role at 5 is not offered, and protected Roles are never listed', (t) => {
  const five = ['a1', 'a2', 'a3', 'a4', 'a5'].map((name) => ({ name }));
  const p = oldProject(t, { design: [OLD.repo], skills: [OLD.stk], settings: { aico_settings: { version: 1, roles: { 'brand-artist': { skills: five } } } } });
  const text = p.mig().lines.join('\n');
  assert.doesNotMatch(text, /line 4:.*Roles:.*brand-artist/, 'a Role at 5 is not offered');
  assert.match(text, /line 7: stk-skill/);
  assert.doesNotMatch(text, /Roles:.*\b(architect|security|code-reviewer|pentester|vuln-scanner|fresh-reviewer)\b/);
  const r = p.mig({ apply: true, choices: [{ n: p.skillLine(0), name: 'stk-skill', roles: ['architect'], category: 'engineering' }, { n: p.lineOf(0), name: 'fancy-ui', roles: ['brand-artist'] }] });
  const out = r.lines.join('\n');
  assert.match(out, /line 7: stays, Role not offered/);
  assert.match(out, /line 4: stays, Role not offered/);
  assert.equal(fs.existsSync(userFile(p.home)), false);
  assert.match(p.md0(), /name: stk-skill/);
});

test('AC20: another commit for a name in the user file needs Move; Keep leaves the line and the entry', (t) => {
  const p = oldProject(t, { design: [OLD.repo] });
  writeUser(p.home, [entry({ skillname: 'fancy-ui', skillcategory: 'design', skillrepo: 'octo/fancy', skillcommit: OTHER, hash: 'd'.repeat(64), vetted: '2026-01-01' })]);
  const choice = [{ n: p.lineOf(0), name: 'fancy-ui', roles: ['ui-ux-designer'] }];
  const keep = p.mig({ apply: true, choices: choice });
  assert.match(keep.lines.join('\n'), /line 4: stays, commit differs from your list/);
  assert.equal(readUser(p.home)[0].skillcommit, OTHER);
  assert.match(p.md0(), /name: fancy-ui/);
  const move = p.mig({ apply: true, choices: choice, moves: [`${p.lineOf(0)}:fancy-ui`] });
  assert.equal(move.ok, true, move.lines.join('|'));
  const e = readUser(p.home)[0];
  assert.equal(e.skillcommit, COMMIT);
  assert.equal(e.hash, undefined);
  assert.equal(e.license, 'MIT', 'Move takes the license from the line');
  assert.equal(e.vetted, undefined, 'Move clears the vetted date');
});

test('AC21: with nobody to answer nothing changes, and pending reports the unmigrated count', (t) => {
  const p = oldProject(t, { design: [OLD.hallmark, OLD.repo], skills: [OLD.stk] });
  assert.equal(pending({ cwd: p.cwd, home: p.home, today: NOW }), 3);
  assert.equal(pendingCounts({ cwd: p.cwd, home: p.home, today: NOW }).migrate, 3, 'can migrate: counts the lines migrate would offer');
  const r = p.mig({ apply: true, choices: [] });
  assert.equal(r.ok, true);
  assert.equal(p.md0(), p.md);
  assert.equal(fs.existsSync(userFile(p.home)), false);
  assert.equal(fs.existsSync(path.join(p.cwd, '.company', 'settings.json')), false);
  assert.equal(pending({ cwd: p.cwd, home: p.home, today: NOW }), 3);
});

test('AC24: a project with no old section lines has nothing to migrate and writes nothing', (t) => {
  const p = oldProject(t, { design: ['- (none yet; the design-researcher proposes them)'], skills: ['- (none yet; the skill-researcher proposes them)'] });
  assert.equal(pending({ cwd: p.cwd, home: p.home, today: NOW }), 0);
  const r = p.mig();
  assert.equal(r.changed, false);
  assert.equal(p.md0(), p.md);
});

// ---------- the settings page data and markup ----------

const PAGE = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');

function pageSandbox(t) {
  const root = tmp(t, 'page');
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'repo');
  const pluginRoot = path.join(root, 'plugin');
  for (const d of [home, path.join(cwd, '.company'), path.join(pluginRoot, 'agents'), path.join(pluginRoot, 'company'), path.join(pluginRoot, 'skills', 'lead', 'references')]) fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(path.join(import.meta.dirname, '..', 'skills', 'lead', 'references', 'project-template.md'), path.join(pluginRoot, 'skills', 'lead', 'references', 'project-template.md'));
  const floor = { architect: 'opus', qa: 'sonnet' };
  for (const [role, model] of Object.entries(floor)) fs.writeFileSync(path.join(pluginRoot, 'agents', `${role}.md`), `---\nname: ${role}\nmodel: ${model}\neffort: high\n---\n`);
  fs.writeFileSync(path.join(pluginRoot, 'company', 'names.json'), JSON.stringify({ architect: 'Ava', qa: 'Quinn' }));
  fs.writeFileSync(path.join(pluginRoot, 'company', 'model-floor.json'), JSON.stringify({ v: 1, release: '0.16.0', floor, protected: ['architect', 'code-reviewer', 'fresh-reviewer', 'pentester', 'security', 'vuln-scanner'] }));
  fs.writeFileSync(path.join(cwd, '.company', 'project.md'), '# Project profile\n\nproduct_type: web\nengagement: own\naudience: the CEO\nlanguages: en\nvoice: clear\n\n## Personas\n- (none)\n');
  return { home, cwd, pluginRoot };
}

async function openPage(t, s) {
  const server = await startServer({ home: s.home, cwd: s.cwd, pluginRoot: s.pluginRoot, open: false, log: () => {} });
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.port}/api/state`, { headers: { 'X-Aico-Token': server.token } });
  return res.json();
}

test('AC1, AC17, AC24: a new product with no user catalog lists baseline entries with status, license and no error; a wildcard is not selectable', async (t) => {
  const s = pageSandbox(t);
  const st = await openPage(t, s);
  assert.deepEqual(st.catalog.errors, []);
  const byName = Object.fromEntries(st.catalog.entries.map((e) => [e.name, e]));
  assert.ok(st.catalog.entries.every((e) => e.layer === 'baseline'));
  assert.equal(byName['golang-*'].selectable, false);
  assert.ok(byName['golang-*'].reason);
  assert.equal(byName['vercel-react-best-practices'].license, 'no license on record');
  assert.equal(byName['vercel-react-best-practices'].selectable, true);
  assert.equal(byName['impeccable'].vetted, null);
  assert.equal(byName['aico:ui-design'].status, 'checked at run start');
  assert.ok(PAGE.includes('/aico:add-skill'), 'the page names the add command');
  const home = JSON.stringify(st.catalog);
  assert.ok(!home.includes(s.home) && !home.includes(s.cwd));
});

test('AC1, AC2: each Role gets only entries of its categories; a bad user entry is named by number and cannot be selected', async (t) => {
  const s = pageSandbox(t);
  writeUser(s.home, [entry({ skillname: 'qa-only', skillcategory: 'quality', skillrepo: 'octo/qa' }), entry({ skillname: 'secret-bad', skillcategory: 'nonsense' })]);
  const st = await openPage(t, s);
  const qa = st.catalog.entries.find((e) => e.name === 'qa-only');
  assert.ok(qa.roles.includes('qa') && qa.roles.includes('code-reviewer'));
  assert.ok(!qa.roles.includes('architect') && !qa.roles.includes('senior-engineer'));
  assert.ok(!st.catalog.entries.some((e) => e.name.includes('secret')));
  const errs = st.catalog.errors.join('\n');
  assert.match(errs, /entry 2: skillcategory/);
  assert.ok(!errs.includes('secret'));
});

test('AC15: every skill row has a label bound to its checkbox, state and status as text, wrapping text and no sideways scroll', () => {
  assert.match(PAGE, /el\('label', \{ for: id \}, e\.name\)/);
  assert.match(PAGE, /type: 'checkbox', id, disabled: e\.selectable !== true/);
  assert.match(PAGE, /'Status: '/);
  assert.match(PAGE, /aria-describedby/);
  assert.match(PAGE, /id: 'skcount', role: 'status'/);
  assert.match(PAGE, /\.sk-row \.sk-text \{[^}]*overflow-wrap: anywhere/);
  assert.match(PAGE, /\.sk-row \{[^}]*min-width: 0/);
  const rule = PAGE.match(/\.sk-(?:list|row|text)[^{]*\{[^}]*\}/g).join('\n');
  assert.doesNotMatch(rule, /white-space:\s*nowrap|overflow-x:\s*(scroll|auto)/);
  assert.doesNotMatch(PAGE, /body\s*\{[^}]*overflow-x:\s*scroll/);
});

test('AC24: the project template holds neither old skill section', () => {
  const tpl = fs.readFileSync(path.join(import.meta.dirname, '..', 'skills', 'lead', 'references', 'project-template.md'), 'utf8');
  assert.doesNotMatch(tpl, /^## Design skills\s*$/m);
  assert.doesNotMatch(tpl, /^## Skills\s*$/m);
});

// ---------- setup commands, baseline checks, SBOM and retired names ----------

const REPO_ROOT = path.join(import.meta.dirname, '..');
const addCmd = (source, name) => `[dry-run] npx -y skills@1.7.4 add ${source} -s ${name} -g -a claude-code -y`;
const OLD_GROUP_LINES = [
  addCmd('vercel-labs/skills', 'find-skills'), addCmd('nutlope/hallmark', 'hallmark'),
  addCmd('addyosmani/agent-skills', 'frontend-ui-engineering'), addCmd('addyosmani/agent-skills', 'security-and-hardening'),
  addCmd('getsentry/skills', 'security-review'), addCmd('wshobson/agents', 'auth-implementation-patterns'),
  addCmd('samber/cc-skills-golang', process.platform === 'win32' ? '"*"' : "'*'"),
  addCmd('vercel-labs/agent-skills', 'vercel-react-best-practices'), addCmd('vercel-labs/agent-skills', 'vercel-composition-patterns'),
  addCmd('wshobson/agents', 'typescript-advanced-types'),
  ...['query', 'router', 'form', 'table'].map((n) => addCmd('tanstack-skills/tanstack-skills', `tanstack-${n}`)),
  addCmd('better-auth/skills', 'two-factor-authentication-best-practices')
];

test('AC19: the setup groups print today\'s commands byte for byte with the baseline licenses in place, and the stored command is only printed', async (t) => {
  const calls = [];
  const lines = [];
  const code = await install(['--dry-run', 'core', 'research', 'go', 'react', 'tanstack', 'auth'], { home: tmp(t, 'home'), log: (l) => lines.push(l), exec: (...a) => calls.push(a) });
  assert.equal(code, 0);
  assert.deepEqual(lines.filter((l) => l.startsWith('[dry-run]')), OLD_GROUP_LINES);
  assert.deepEqual(lines.filter((l) => l.startsWith('manual ')), ['manual npx -y impeccable@4.8.0 skills install']);
  assert.equal(calls.length, 0);
});

test('AC19: a user entry is never added to a setup group', async (t) => {
  const home = tmp(t, 'home');
  writeUser(home, [entry({ skillname: 'user-only-skill' })]);
  const lines = [];
  await install(['--dry-run', 'core', 'research', 'go', 'react', 'tanstack', 'auth'], { home, log: (l) => lines.push(l), exec: () => {} });
  assert.ok(!lines.join('\n').includes('user-only-skill'));
});

test('AC19: the SBOM lists baseline skills and never a user entry', (t) => {
  const home = tmp(t, 'home');
  writeUser(home, [entry({ skillname: 'user-only-skill' })]);
  const was = process.env.MCSPARROW_HOME;
  delete process.env.MCSPARROW_HOME;
  t.after(() => { if (was !== undefined) process.env.MCSPARROW_HOME = was; });
  t.mock.method(os, 'userInfo', () => ({ homedir: home }));
  assert.ok(readCatalog().entries.some((e) => e.skillname === 'user-only-skill'), 'control: the user entry is reachable');
  const text = serialize(buildSbom({ root: REPO_ROOT, now: new Date('2026-11-07T00:00:00Z'), serial: 'urn:uuid:00000000-0000-4000-8000-000000000000' }));
  assert.ok(!text.includes('user-only-skill'));
  for (const n of ['skill:hallmark@', 'skill:find-skills@']) assert.ok(text.includes(n), n);
});

test('AC19: a returned deps/skills.json and a live cite of it are check errors; a user name is not retired', (t) => {
  const root = tmp(t, 'root');
  fs.mkdirSync(path.join(root, 'deps'));
  fs.writeFileSync(path.join(root, 'deps', ['skills', 'json'].join('.')), '{}');
  fs.mkdirSync(path.join(root, 'skills', 'x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'x', 'SKILL.md'), 'Read `deps/' + 'skills.json` for the list.\n');
  const errors = check(root).errors ?? check(root);
  const text = (Array.isArray(errors) ? errors : []).join('\n');
  assert.match(text, /the old inventory returned/);
  assert.match(text, /skills\/x\/SKILL\.md:1: live cite of the old inventory file/);
  const rel = tmp(t, 'releases');
  fs.mkdirSync(path.join(rel, '0.1.0'));
  fs.writeFileSync(path.join(rel, '0.1.0', 'sbom.cdx.json'), JSON.stringify({ components: [{ 'bom-ref': 'skill:gone-one@1' }, { 'bom-ref': 'skill:mine-one@1' }] }));
  assert.deepEqual(retiredSkills({}, rel, ['mine-one']), ['gone-one']);
});

test('AC19: deps/skills.json is gone and no live skill, script or Contract cites it as a source', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'deps', ['skills', 'json'].join('.'))), false);
  assert.deepEqual(check(REPO_ROOT).errors.filter((e) => /old inventory/.test(e)), []);
});

// ---------- text pins: dispatch line, add-skill, license question, Install form, auto answer ----------

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');
const PIPELINE = read('skills', 'pipeline', 'SKILL.md');
const HANDOFF = read('skills', 'handoff', 'SKILL.md');
const FEATURE = read('skills', 'feature', 'SKILL.md');
const PICKS = read('skills', 'lead', 'references', 'skill-picks.md');
const ADD_SKILL = read('skills', 'add-skill', 'SKILL.md');
const DISPATCH = read('docs', 'contracts', 'dispatch-prompt.md');

test('AC6, AC7: the dispatch text names the Role skills line and no Design skills line', () => {
  assert.match(PIPELINE, /^Role skills: <names \| none>/m);
  assert.match(HANDOFF, /`Role skills:`.*load each named skill with the Skill tool/);
  assert.match(HANDOFF, /missing role skill: <name>/);
  for (const text of [PIPELINE, HANDOFF]) assert.doesNotMatch(text, /Design skills:/);
});

test('AC7: a name the agent text also loads (aico:ui-design) loads once, said in the Core skill and in the Contract', () => {
  assert.match(HANDOFF, /A name your agent text also loads \(`aico:ui-design`\) loads once\./);
  assert.match(DISPATCH, /A name the Role's agent text also loads \(`aico:ui-design`\) loads once\./);
});

test('AC8, AC16, AC9: add-skill is CEO-only with help, and takes values only through a quoted heredoc', () => {
  assert.match(ADD_SKILL, /^disable-model-invocation: true$/m);
  assert.match(ADD_SKILL, /argument-hint: "\[help\]"/);
  assert.match(ADD_SKILL, /documentation\/commands\/add-skill\.md/);
  assert.match(ADD_SKILL, /role-skills add <<'AICO_JSON'/);
  assert.match(ADD_SKILL, /Never put an answer on the command line/);
  assert.match(PICKS, /role-skills record <<'AICO_JSON'/);
  assert.match(PICKS, /with the Bash tool and a quoted heredoc, never on the command line/);
  const doc = read('documentation', 'commands', 'add-skill.md');
  assert.match(doc, /\/aico:add-skill help/);
  assert.match(doc, /Only you start this command/);
});

test('AC9, AC22: the pick license question always offers No license and Cancel, and Cancel runs no record', () => {
  assert.match(PICKS, /Options: `picks\[\]\.stated_license`.*`No license, skip this skill`; `Cancel`; Other = the value/);
  assert.match(PICKS, /`Cancel` runs no `record` for any pick/);
});

test('AC11, AC17: Install only means install-skills --selected, the Lead never runs a shown command, a command entry gets no Install question', () => {
  assert.match(PIPELINE, /Install only ever means `install-skills --selected`, with one `--skill=<name>` per Install pick/);
  assert.match(PIPELINE, /You never run a command shown in a/);
  assert.match(PIPELINE, /A `manual` and `WARNING:`.*line gets no Install question: show it as is, say aico does not run it/);
  assert.match(PIPELINE, /Options: Install \(Recommended\) \/ Skip/);
  assert.match(PICKS, /a command shown as `manual` is not run by aico/);
  assert.match(FEATURE, /show every `WARNING:` line to the CEO as a visibly marked warning/);
});

test('AC11: gates.installs auto skips the Install form only when settings_folder_moved is false', () => {
  assert.match(PIPELINE, /`gates\.installs` `auto` .*answers Install without the form only when `settings_folder_moved` in the §1\.7 `get` JSON is `false`; true or absent shows the form/);
  for (const [name, text] of [['feature', FEATURE], ['skill-picks', PICKS]]) {
    assert.match(text, /settings_folder_moved/, name);
    assert.match(text, /gates\.installs/, name);
  }
});

test('AC20: name clashes, a same-source line, a plugin line with no license and a Role reaching 5 partway', (t) => {
  const lineFor = (extra) => `- name: ${extra.name}; source: ${extra.source}; license: ${extra.license ?? 'MIT'}; vetted: 2026-02-01; ${extra.commit === false ? '' : `commit: ${extra.commit ?? COMMIT}; `}why: w; approved: 2026-02-02`;
  const unchanged = (p, home = true) => {
    assert.equal(p.md0(), p.md);
    assert.equal(fs.existsSync(path.join(p.cwd, '.company', 'settings.json')), false);
    if (home) assert.equal(fs.existsSync(userFile(p.home)), false);
  };

  const base = oldProject(t, { design: [lineFor({ name: 'hallmark', source: 'octo/other' })] });
  assert.match(base.mig().lines.join('\n'), /line 4: stays, name clash with the list/);
  const baseApply = base.mig({ apply: true, choices: [{ n: 4, name: 'hallmark', roles: ['ui-ux-designer'] }] });
  assert.match(baseApply.lines.join('\n'), /line 4: stays, name clash with the list/);
  unchanged(base);

  const other = oldProject(t, { design: [OLD.repo] });
  writeUser(other.home, [entry({ skillname: 'fancy-ui', skillcategory: 'design', skillrepo: 'octo/else', skillcommit: COMMIT })]);
  const otherApply = other.mig({ apply: true, choices: [{ n: 4, name: 'fancy-ui', roles: ['ui-ux-designer'] }] });
  assert.match(otherApply.lines.join('\n'), /line 4: stays, name clash with your list/);
  unchanged(other, false);
  assert.deepEqual(readUser(other.home).map((e) => e.skillrepo), ['octo/else']);

  const same = oldProject(t, { design: [OLD.repo] });
  writeUser(same.home, [entry({ skillname: 'fancy-ui', skillcategory: 'design', skillrepo: 'octo/fancy', skillcommit: COMMIT })]);
  const before = fs.readFileSync(userFile(same.home), 'utf8');
  assert.match(same.mig().lines.join('\n'), /line 4: .*selection only/);
  const sameApply = same.mig({ apply: true, choices: [{ n: 4, name: 'fancy-ui', roles: ['ui-ux-designer'] }] });
  assert.equal(sameApply.ok, true, sameApply.lines.join('|'));
  assert.equal(fs.readFileSync(userFile(same.home), 'utf8'), before, 'the user file is not rewritten');
  assert.deepEqual(same.sel()['ui-ux-designer'].skills.map((x) => x.name), ['fancy-ui']);

  const dash = oldProject(t, { design: [lineFor({ name: 'aico:other', source: 'plugin aico', license: '-', commit: false })] });
  assert.match(dash.mig().lines.join('\n'), /line 4: stays, no license/);
  const dashApply = dash.mig({ apply: true, choices: [{ n: 4, name: 'aico:other', roles: ['ui-ux-designer'] }] });
  assert.match(dashApply.lines.join('\n'), /line 4: stays, no license/);
  unchanged(dash);

  const names = ['has-one', 'has-two', 'has-three', 'has-four'];
  const four = names.map((name) => ({ name }));
  const part = oldProject(t, { design: [OLD.repo, lineFor({ name: 'second-ui', source: 'octo/second' })], settings: { aico_settings: { version: 1, roles: { 'brand-artist': { skills: four } } } } });
  writeUser(part.home, names.map((skillname, i) => entry({ skillname, skillcategory: 'design', skillrepo: `octo/has${i}` })));
  const partApply = part.mig({ apply: true, choices: [{ n: 4, name: 'fancy-ui', roles: ['brand-artist'] }, { n: 5, name: 'second-ui', roles: ['brand-artist'] }] });
  const text = partApply.lines.join('\n');
  assert.match(text, /line 4: migrated/);
  assert.match(text, /line 5: stays, Role already has 5/);
  assert.equal(part.sel()['brand-artist'].skills.length, 5);
  assert.match(part.md0(), /name: second-ui/);
  assert.ok(!/name: fancy-ui/.test(part.md0().split('## Skills')[0].split('## Design skills')[1] ?? ''), 'the first line left project.md');
  assert.deepEqual(readUser(part.home).map((e) => e.skillname).filter((x) => !names.includes(x)), ['fancy-ui'], 'only the migrated line wrote an entry');
});

test('AC9: a control character in a command, a line with no source, and a selection that survives Move', (t) => {
  for (const ch of ['\u0007', '\u202E']) {
    const home = tmp(t, 'home');
    const r = run(t, 'add', addLine({ repo: undefined, commit: undefined, command: `npx -y thing@1.2.3 skills${ch}install`, save: true }), { home });
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /^ERROR command: /);
    assert.ok(!r.lines.join('').includes(ch), 'the value is never echoed');
    assert.equal(fs.existsSync(userFile(home)), false);
  }
  const none = run(t, 'add', addLine({ repo: undefined, commit: undefined }));
  assert.equal(none.code, 0);
  assert.ok(none.lines.includes('missing: repo or command'), none.lines.join('|'));
  const saveNone = run(t, 'add', addLine({ repo: undefined, commit: undefined, save: true }));
  assert.equal(saveNone.code, 1);
  assert.equal(saveNone.lines[0], 'ERROR input: missing repo or command');
  assert.equal(fs.existsSync(userFile(saveNone.home)), false);

  const r = resolved(t, { project: { roles: { qa: { skills: pick(NAME) } } } });
  const stored = fs.readFileSync(path.join(r.cwd, '.company', 'settings.json'), 'utf8');
  const moved = run(t, 'add', addLine({ commit: OTHER, license: 'Apache-2.0', save: true, move: true }), { home: r.home, cwd: r.cwd });
  assert.equal(moved.code, 0, moved.lines.join('|'));
  assert.equal(readUser(r.home)[0].skillcommit, OTHER);
  assert.equal(fs.readFileSync(path.join(r.cwd, '.company', 'settings.json'), 'utf8'), stored, 'Move writes no selection file');
  assert.deepEqual(r.get().roles.qa.skills.map((x) => x.name), [NAME], 'every selection stays');
});

test('AC8: the repo preview says it stays not vetted until an install scans it clean', (t) => {
  const pre = run(t, 'add', addLine());
  assert.equal(pre.code, 0);
  assert.ok(pre.lines.includes('The scan runs when you install it. It stays not vetted until an install scans it clean.'), pre.lines.join('|'));
  const cmd = run(t, 'add', addLine({ repo: undefined, commit: undefined, command: 'npx -y thing@1.2.3 skills install' }));
  assert.ok(cmd.lines.includes('A skill added as a command is never scanned and shows as not vetted.'));
});

test('AC8: add-skill asks in the fixed order, lists the closed category pages, and ends the preview with Save / Cancel', () => {
  const order = ['2. **Name.**', '3. **Repo.**', '4. **Installer command.**', '5. **Category.**', '6. **Commit**', '7. **License.**', '8. **Preview.**', '9. **Save:**'];
  const at = order.map((h) => ADD_SKILL.indexOf(h));
  assert.ok(at.every((i) => i > 0), `every step is present: ${at.join(',')}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the questions keep their order');
  assert.match(ADD_SKILL, /Page 1: engineering, design, More\.\.\., Cancel\. Page 2: security, quality, More\.\.\., Cancel\. Page 3: product, research, content, Cancel\./);
  assert.match(ADD_SKILL, /every question has Cancel/);
  assert.match(ADD_SKILL, /Options: Save \/ Cancel\./);
  assert.match(ADD_SKILL, /Keep \(Recommended\) \/ Move \/ Cancel/);
  assert.match(ADD_SKILL, /the scan line, the file line/);
});

test('AC6, AC17: a planted product folder under a user-level security selection reads not found and is off the dispatch list', async (t) => {
  const s = setup(t, { entries: [], lists: { security: ['user', ['security-review']] } });
  plant(path.join(s.root, '.claude', 'skills', 'security-review'));
  const out = [];
  assert.equal(await install(['--status'], { ...s.env, log: (l) => out.push(l) }), 0, out.join('|'));
  const line = out.find((l) => l.startsWith('security-review'));
  assert.match(line, /\| not found \|/);
  assert.match(line, /dispatch: no/);
  assert.ok(!/dispatch: yes/.test(line));
  assert.equal(s.calls.length, 0, 'status starts no install');
});

test('AC6: the Lead leaves a name off the Role skills line unless its dispatch field allows it, and records degraded once per name', () => {
  const pipeline = read('skills', 'pipeline', 'SKILL.md');
  assert.match(pipeline, /build each Role's `Role skills:` from its `dispatch:` field only, and only from lines with `roles:` not `-`: `yes` → the name; `session list` → the name only if the session's skill list holds it, otherwise left off; anything else → left off, `degraded: missing <name>` once per name in the Handoff and Gate summary/);
});

test('AC16: README, the settings page doc, the glossary and the changelog describe the skill catalog and its migration', () => {
  const readme = read('README.md');
  assert.match(readme, /\/aico:add-skill/);
  assert.doesNotMatch(readme, /deps\/skills\.json/);
  assert.match(read('documentation', 'commands', 'settings.md'), /Skills tab/);
  assert.match(read('GLOSSARY.md'), /\*\*Catalog\*\*.*3rdpartyskills\.json/);
  const log = read('CHANGELOG.md');
  // From Unreleased through the end of the 0.29.0 section; later releases only add sections above it.
  const from = log.indexOf('## [Unreleased]');
  const v29 = log.indexOf('## [0.29.0]');
  assert.ok(from !== -1 && v29 > from);
  const next = log.indexOf('\n## [', v29 + 1);
  const unreleased = log.slice(from, next === -1 ? undefined : next);
  assert.match(unreleased, /\*\*Breaking: skills now live in a catalog/);
  assert.match(unreleased, /pick Migrate/);
  assert.match(unreleased, /deps\/3rdpartyskills\.json/);
});
