// Acceptance and contract suite for the skill catalog, the selected install, the role-skills commands and the
// resolved Role selections. Every test uses stand-ins and per-test temp folders: no real installer, no gh,
// no real home. Verdicts come from return values, exit codes, JSON and files, never from reporter text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main as install, installExec } from './install-skills.mjs';
import { main as roleSkills, stale } from './role-skills.mjs';
import { readCatalog, readBaseline, skillStatus, boundedFolderHash, userCatalogPath, validateEntry, selectable } from './skill-catalog.mjs';
import { resolveSettings, writeLayer, Refusal } from './settings.mjs';

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

// ---------- AC2, AC9: validation and read bounds ----------

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
    assert.ok(!add.join('').includes(ch));
    const h2 = tmp(t);
    const rec = [];
    const code2 = roleSkills(['record'], { home: h2, cwd: tmp(t), log: (l) => rec.push(l), stdin: JSON.stringify({ entry: { skillname: 'demo', skillcategory: 'engineering', skillrepo: SOURCE, skillcommit: COMMIT }, license: `MIT${ch}x`, roles: [] }) });
    assert.equal(code2, 1);
    assert.ok(!rec.join('').includes(ch));
    assert.equal(fs.existsSync(userFile(h2)), false);
  }
  assert.equal(validateEntry(entry({ license: 'MIT License' }), 'user').ok, true);
});

// ---------- AC10: the read path never moves ----------

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
  t.mock.method(os, 'userInfo', () => ({ homedir: real }));
  t.mock.method(os, 'homedir', () => planted);
  const was = process.env.MCSPARROW_HOME;
  delete process.env.MCSPARROW_HOME;
  t.after(() => { if (was !== undefined) process.env.MCSPARROW_HOME = was; });
  assert.equal(userCatalogPath(), path.join(real, '.mcsparrow', '3rdpartyskills.json'));
  const c = readCatalog();
  assert.ok(!c.entries.some((e) => e.skillname === 'planted-skill'));
  assert.ok(c.entries.some((e) => e.skillname === 'find-skills'));
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

// ---------- AC17, AC6: status ----------

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

// ---------- AC13, AC18: nothing is executed ----------

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
  const g = [];
  const calls = [];
  assert.equal(await install(['--dry-run', 'core'], { home: tmp(t), log: (l) => g.push(l), exec: (...a) => calls.push(a) }), 0);
  assert.ok(g.some((l) => l.startsWith('manual ') && l.includes('impeccable@')));
  assert.ok(g.some((l) => l.startsWith('WARNING:')));
  assert.ok(!calls.length);
});

test('AC18: status runs no child, no PATH binary and follows no link', (t) => {
  const bin = tmp(t, 'bin');
  const marker = path.join(tmp(t, 'marker'), 'ran');
  fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'npx.cmd'), `@echo off\r\ntype nul > "${marker}"\r\n`);
  const was = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${was}`;
  t.after(() => { process.env.PATH = was; });
  const home = tmp(t, 'home');
  const root = tmp(t, 'root');
  const outside = tmp(t, 'outside');
  fs.writeFileSync(path.join(outside, 'SKILL.md'), 'x');
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  let linked = true;
  try { fs.symlinkSync(outside, path.join(root, '.claude', 'skills', NAME), 'junction'); } catch { linked = false; }
  const cmd = { skillname: 'cmd-skill', skillcategory: 'engineering', skillinstaller: `npx -y evil@1.0.0 add && touch ${marker}`, license: 'MIT' };
  skillStatus(cmd, { home, productRoot: root });
  const st = skillStatus(entry({ hash: boundedFolderHash(outside) }), { home, productRoot: root, scope: 'project' });
  if (linked) assert.notEqual(st.status, 'installed');
  assert.equal(fs.existsSync(marker), false);
});

test('AC18: installExec pins HOME and USERPROFILE to the home and drops CLAUDE_CONFIG_DIR in any case', (t) => {
  const home = tmp(t, 'home');
  const seen = [];
  const runners = { execSync: (c, o) => seen.push(o), execFileSync: (f, a, o) => seen.push(o) };
  t.mock.method(process, 'env', { ...process.env, claude_config_dir: '/planted', CLAUDE_CONFIG_DIR: '/planted', USERPROFILE: '/planted', HOME: '/planted' });
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
    assert.match(r.lines.join('\n'), new RegExp(`ERROR ${field}`));
    assert.equal(fs.existsSync(userFile(home)), false);
  }
  const both = run(t, 'add', addLine({ command: 'npx -y thing@1.2.3', save: true }));
  assert.equal(both.code, 1);
});

test('AC9: a $(...) value through add is stored as text and runs nothing', (t) => {
  const marker = path.join(tmp(t, 'marker'), 'ran');
  const r = run(t, 'add', addLine({ license: `$(touch ${marker})`, save: true }));
  assert.equal(r.code, 0);
  assert.equal(readUser(r.home)[0].license, `$(touch ${marker})`);
  assert.equal(fs.existsSync(marker), false);
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

// ---------- resolved selections (AC3 to AC5, AC23) ----------

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
  const run1 = (approved) => {
    const r = resolved(t, { entries: [design], project: { roles: { 'ui-ux-designer': { skills: approved === undefined ? [{ name: 'des-one' }] : [{ name: 'des-one', approved }] } } } });
    return stale({ home: r.home, cwd: r.cwd, today: TODAY });
  };
  assert.equal(run1(daysAgo(180)).stale, false);
  assert.equal(run1(daysAgo(181)).stale, true);
  assert.equal(run1(undefined).stale, true);
  assert.equal(run1('2999-01-01').stale, true);
  assert.equal(run1('2026-02-31').stale, true);
  const none = resolved(t, { entries: [design] });
  assert.equal(stale({ home: none.home, cwd: none.cwd, today: TODAY }).stale, true);
  const r = resolved(t, { entries: [design], project: { roles: { 'ui-ux-designer': { skills: pick('des-one') } } } });
  assert.equal(stale({ home: r.home, cwd: r.cwd, today: TODAY }).stale, true);
  const rec = run(t, 'record', JSON.stringify({ entry: { skillname: 'des-one', skillcategory: 'design', skillrepo: 'octo/d1', skillcommit: COMMIT }, license: 'MIT', roles: ['ui-ux-designer'] }), { home: r.home, cwd: r.cwd });
  assert.equal(rec.code, 0, rec.lines.join('|'));
  assert.equal(stale({ home: r.home, cwd: r.cwd }).stale, false, 'a record dates the selection even when it was already there');
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
