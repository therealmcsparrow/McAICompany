import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  userCatalogPath, userHome, readBaseline, parseBaseline, readCatalog, validateEntry, expandGroups, eligibleRoles,
  selectable, approvable, boundedFolderHash, skillStatus, addUserEntry, setBoundHash, clearBound,
} from './skill-catalog.mjs';
import { skillFolderHash } from './skillspector.mjs';

const made = [];
const tmp = (name = 'skill-catalog') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  made.push(d);
  return d;
};
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const C1 = 'a'.repeat(40);
const C2 = 'b'.repeat(40);
const H1 = '1'.repeat(64);
const repoEntry = (over = {}) => ({ skillname: 'my-skill', skillcategory: 'engineering', skillrepo: 'acme/my-skill', skillcommit: C1, license: 'MIT', ...over });
const userFile = (home) => path.join(home, '.mcsparrow', '3rdpartyskills.json');
const writeUser = (home, doc) => {
  fs.mkdirSync(path.join(home, '.mcsparrow'), { recursive: true });
  fs.writeFileSync(userFile(home), typeof doc === 'string' ? doc : JSON.stringify(doc));
};
const readUser = (home) => JSON.parse(fs.readFileSync(userFile(home), 'utf8'));
const mkSkillDir = (dir, files = { 'SKILL.md': '# x\n' }) => {
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
};
const withEnv = (t, vars) => {
  const old = {};
  for (const k of Object.keys(vars)) { old[k] = process.env[k]; process.env[k] = vars[k]; }
  t.after(() => { for (const k of Object.keys(vars)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } });
};
const canLink = (t) => {
  const d = tmp('link-probe');
  fs.mkdirSync(path.join(d, 'a'));
  try { fs.symlinkSync(path.join(d, 'a'), path.join(d, 'b'), 'junction'); return true; } catch { t.diagnostic('cannot create links here'); return false; }
};

// ---------- hostile first ----------

test('the module imports no child process', () => {
  const src = fs.readFileSync(new URL('./skill-catalog.mjs', import.meta.url), 'utf8');
  assert.equal(/child_process/.test(src), false);
});

test('a planted MCSPARROW_HOME supplies no entry and reads nothing', async (t) => {
  const planted = tmp('planted');
  writeUser(planted, { schema: 1, entries: [repoEntry({ skillname: 'planted-skill' })] });
  fs.mkdirSync(path.join(planted, '.mcsparrow'), { recursive: true });
  withEnv(t, { MCSPARROW_HOME: path.join(planted, '.mcsparrow') });
  const r = readCatalog();
  assert.equal(r.entries.some((e) => e.skillname === 'planted-skill'), false);
  assert.deepEqual(r.warnings, ['role skills: MCSPARROW_HOME is set, the user catalog is not read']);
  const w = addUserEntry(repoEntry({ skillname: 'other-skill' }));
  assert.equal(w.ok, false);
  assert.equal(fs.readFileSync(userFile(planted), 'utf8').includes('other-skill'), false);
});

test('the user home is the operating system answer, not HOME or USERPROFILE', async (t) => {
  const real = os.userInfo().homedir;
  const planted = tmp('planted-home');
  withEnv(t, { HOME: planted, USERPROFILE: planted });
  assert.equal(userHome(), real);
  assert.equal(userCatalogPath({}), path.join(real, '.mcsparrow', '3rdpartyskills.json'));
});

test('a repo-supplied catalog file or env never adds an entry to the baseline', () => {
  const home = tmp();
  const r = readCatalog({ home });
  const base = readBaseline();
  assert.deepEqual(r.entries.map((e) => e.skillname), base.entries.map((e) => e.skillname));
  assert.deepEqual(r.errors, []);
});

test('a user file over 256 KiB is refused before it is parsed', () => {
  const home = tmp();
  writeUser(home, 'x'.repeat(257 * 1024));
  const r = readCatalog({ home });
  assert.deepEqual(r.errors, ['ERROR user catalog: file too large']);
  assert.equal(r.entries.length, readBaseline().entries.length);
});

test('a user file that is a link is refused', (t) => {
  if (!canLink(t)) return;
  const home = tmp();
  const real = tmp('real');
  fs.writeFileSync(path.join(real, 'f.json'), JSON.stringify({ schema: 1, entries: [repoEntry()] }));
  fs.mkdirSync(path.join(home, '.mcsparrow'), { recursive: true });
  try { fs.symlinkSync(path.join(real, 'f.json'), userFile(home), 'file'); } catch { t.diagnostic('no file link here'); return; }
  const r = readCatalog({ home });
  assert.deepEqual(r.errors, ['ERROR user catalog: link']);
  assert.equal(r.entries.some((e) => e.skillname === 'my-skill'), false);
});

test('bad JSON gives an empty user layer and one error', () => {
  const home = tmp();
  writeUser(home, '{not json');
  assert.deepEqual(readCatalog({ home }).errors, ['ERROR user catalog: bad JSON']);
  writeUser(home, JSON.stringify({ schema: 2, entries: [] }));
  assert.deepEqual(readCatalog({ home }).errors, ['ERROR user catalog: bad JSON']);
  writeUser(home, JSON.stringify({ schema: 1, entries: [], extra: 1 }));
  assert.deepEqual(readCatalog({ home }).errors, ['ERROR user catalog: bad JSON']);
});

test('a __proto__ key is refused and never copied', () => {
  const home = tmp();
  writeUser(home, '{"schema":1,"entries":[{"skillname":"my-skill","skillcategory":"engineering","skillrepo":"acme/my-skill","skillcommit":"' + C1 + '","license":"MIT","__proto__":{"polluted":true}}]}');
  const r = readCatalog({ home });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^ERROR user catalog entry 1: /);
  assert.equal(r.errors[0].includes('polluted'), false);
  assert.equal(r.entries.some((e) => e.skillname === 'my-skill'), false);
  assert.equal({}.polluted, undefined);
});

test('a bad entry is reported by field, never echoed, and the rest still read', () => {
  const home = tmp();
  writeUser(home, { schema: 1, entries: [
    repoEntry({ skillname: 'good-one' }),
    repoEntry({ skillname: 'bad-one', skillrepo: 'evil$(touch x)/repo' }),
    repoEntry({ skillname: 'no-license', license: undefined }),
  ] });
  const r = readCatalog({ home });
  assert.equal(r.entries.some((e) => e.skillname === 'good-one'), true);
  assert.equal(r.entries.some((e) => e.skillname === 'bad-one'), false);
  assert.deepEqual(r.errors, ['ERROR user catalog entry 2: skillrepo bad value', 'ERROR user catalog entry 3: license missing']);
  assert.equal(r.errors.join('').includes('touch'), false);
});

test('more than 200 entries is refused', () => {
  const home = tmp();
  const entries = [];
  for (let i = 0; i < 201; i++) entries.push(repoEntry({ skillname: `s-${i}` }));
  writeUser(home, { schema: 1, entries });
  const r = readCatalog({ home });
  assert.deepEqual(r.errors, ['ERROR user catalog: file too large']);
  assert.equal(r.entries.length, readBaseline().entries.length);
});

// ---------- validateEntry ----------

test('validateEntry: a user entry needs a license, a baseline one does not', () => {
  const noLicense = repoEntry({ license: undefined });
  assert.equal(validateEntry(noLicense, 'user').ok, false);
  assert.equal(validateEntry(noLicense, 'user').field, 'license');
  assert.equal(validateEntry({ skillname: 'x-y', skillcategory: 'design', skillrepo: 'acme/x-y' }, 'baseline').ok, true);
});

test('validateEntry: a user repo entry needs a commit, other kinds refuse one', () => {
  assert.equal(validateEntry(repoEntry({ skillcommit: undefined }), 'user').field, 'skillcommit');
  const inst = { skillname: 'inst', skillcategory: 'design', skillinstaller: 'npx -y pkg@1.2.3 skills install', license: 'MIT' };
  assert.equal(validateEntry(inst, 'user').ok, true);
  assert.equal(validateEntry({ ...inst, skillcommit: C1 }, 'user').field, 'skillcommit');
  assert.equal(validateEntry({ skillname: 'p:q', skillcategory: 'design', skillplugin: 'p', license: 'MIT', skillcommit: C1 }, 'user').field, 'skillcommit');
});

test('validateEntry: exactly one source', () => {
  assert.equal(validateEntry({ ...repoEntry(), skillinstaller: 'npx pkg@1.0.0' }, 'user').field, 'skillrepo');
  assert.equal(validateEntry({ skillname: 'a', skillcategory: 'design', license: 'MIT' }, 'user').field, 'skillrepo');
});

test('validateEntry: names', () => {
  for (const bad of ['', 'A', '-a', 'a b', 'a/b', '../x', 'a'.repeat(65), 'a:b:c', ':a', 'a:']) {
    assert.equal(validateEntry(repoEntry({ skillname: bad }), 'user').ok, false, bad);
  }
  assert.equal(validateEntry(repoEntry({ skillname: 'a'.repeat(64) }), 'user').ok, true);
  assert.equal(validateEntry(repoEntry({ skillname: 'golang-*' }), 'user').reason, 'wildcard not allowed');
  assert.equal(validateEntry({ skillname: 'golang-*', skillcategory: 'engineering', skillrepo: 'a/b' }, 'baseline').ok, true);
  assert.equal(validateEntry({ skillname: '*', skillcategory: 'engineering', skillrepo: 'a/b' }, 'baseline').ok, false);
  assert.equal(validateEntry({ skillname: 'p:s', skillcategory: 'design', skillplugin: 'p' }, 'baseline').ok, true);
  assert.equal(validateEntry({ skillname: 'p:s', skillcategory: 'design', skillplugin: 'q' }, 'baseline').ok, false);
  assert.equal(validateEntry({ skillname: 'p-s', skillcategory: 'design', skillplugin: 'p' }, 'baseline').ok, false);
});

test('validateEntry: repo, installer and commit patterns', () => {
  for (const bad of ['a', 'a/b/c', '-a/b', 'a/.', 'a/..', 'a b/c', 'a/b$', 'a/' + 'b'.repeat(101), 'a'.repeat(40) + '/b']) {
    assert.equal(validateEntry(repoEntry({ skillrepo: bad }), 'user').ok, false, bad);
  }
  assert.equal(validateEntry(repoEntry({ skillrepo: 'a/.hidden' }), 'user').ok, true);
  for (const bad of ['npx -y pkg skills', 'npx pkg@1.2.3; rm -rf x', 'npx pkg@1.2.3 && x', 'npx  pkg@1.2.3', ' npx pkg@1.2.3', 'npx pkg@1.2.3 other@1.0.0', 'npx pkg@latest', 'npx pkg@1.2.3 `x`', 'npx pkg@1.2.3 $(x)', 'x'.repeat(201), 'npx pkg@1.2.3\nid']) {
    assert.equal(validateEntry({ skillname: 'i', skillcategory: 'design', skillinstaller: bad, license: 'MIT' }, 'user').ok, false, bad);
  }
  assert.equal(validateEntry({ skillname: 'i', skillcategory: 'design', skillinstaller: 'npx -y @scope/pkg@1.2.3 add', license: 'MIT' }, 'user').ok, true);
  for (const bad of [C1.toUpperCase(), 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), 'main']) {
    assert.equal(validateEntry(repoEntry({ skillcommit: bad }), 'user').ok, false, bad);
  }
});

test('validateEntry: license text', () => {
  const ok = (l) => validateEntry(repoEntry({ license: l }), 'user');
  assert.equal(ok('MIT').ok, true);
  assert.equal(ok('  MIT  ').entry.license, 'MIT');
  assert.equal(ok('Custom licence 2.0, see vendor').ok, true);
  assert.equal(ok('x'.repeat(64)).ok, true);
  assert.equal(ok('x'.repeat(65)).ok, false);
  assert.equal(ok('   ').ok, false);
  assert.equal(ok('').ok, false);
  assert.equal(ok(5).ok, false);
  for (const bad of ['a\nb', 'a\rb', 'a\tb', 'a\u0000b', 'a​b', 'a b', 'a b', 'a‮b', 'a᠎b', 'a⁥b', 'a\u{e0041}b', 'a­b', 'a﻿b', 'a⁠b', 'aᅟb']) {
    assert.equal(ok(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(ok('x'.repeat(100000)).ok, false);
});

test('validateEntry: vetted and hash', () => {
  const v = (x) => validateEntry(repoEntry({ vetted: x }), 'user');
  assert.equal(v('2026-10-22').ok, true);
  for (const bad of ['2026-13-01', '2026-02-30', '2026-1-1', '9999-01-01', 'yesterday', 20261022]) assert.equal(v(bad).ok, false, String(bad));
  assert.equal(validateEntry(repoEntry({ hash: H1 }), 'user').ok, true);
  for (const bad of ['1'.repeat(63), 'Z'.repeat(64), 'A'.repeat(64)]) assert.equal(validateEntry(repoEntry({ hash: bad }), 'user').ok, false);
});

test('validateEntry: unknown keys, bad types and the category list', () => {
  assert.equal(validateEntry(repoEntry({ extra: 1 }), 'user').ok, false);
  assert.equal(validateEntry(JSON.parse('{"__proto__":{"x":1},"skillname":"a"}'), 'user').ok, false);
  for (const bad of [null, [], 'x', 5, undefined]) assert.equal(validateEntry(bad, 'user').ok, false);
  assert.equal(validateEntry(repoEntry({ skillcategory: 'other' }), 'user').field, 'skillcategory');
  assert.equal(validateEntry(repoEntry({ skillcategory: 'constructor' }), 'user').ok, false);
  const r = validateEntry(repoEntry({ skillrepo: 'evil$(x)/y' }), 'user');
  assert.equal(JSON.stringify(r).includes('evil'), false);
});

test('validateEntry: the normalized entry holds only known keys, in a fixed order', () => {
  const r = validateEntry({ license: ' MIT ', skillcommit: C1, skillrepo: 'a/b', skillcategory: 'design', skillname: 'a-b' }, 'user');
  assert.deepEqual(Object.keys(r.entry), ['skillname', 'skillcategory', 'skillrepo', 'skillcommit', 'license']);
});

// ---------- baseline ----------

test('the baseline pins every name, category, source and license', () => {
  const b = readBaseline();
  const map = Object.fromEntries(b.entries.map((e) => [e.skillname, [e.skillcategory, e.skillrepo ?? e.skillinstaller ?? `plugin:${e.skillplugin}`, e.license ?? null]]));
  assert.deepEqual(map, {
    'find-skills': ['research', 'vercel-labs/skills', 'MIT'],
    hallmark: ['design', 'nutlope/hallmark', 'MIT'],
    impeccable: ['design', 'npx -y impeccable@4.8.0 skills install', 'Apache-2.0'],
    'frontend-ui-engineering': ['design', 'addyosmani/agent-skills', 'MIT'],
    'security-and-hardening': ['security', 'addyosmani/agent-skills', 'MIT'],
    'security-review': ['security', 'getsentry/skills', 'Apache-2.0'],
    'auth-implementation-patterns': ['engineering', 'wshobson/agents', 'MIT'],
    'golang-*': ['engineering', 'samber/cc-skills-golang', 'MIT'],
    'vercel-react-best-practices': ['engineering', 'vercel-labs/agent-skills', null],
    'vercel-composition-patterns': ['engineering', 'vercel-labs/agent-skills', null],
    'typescript-advanced-types': ['engineering', 'wshobson/agents', 'MIT'],
    'tanstack-query': ['engineering', 'tanstack-skills/tanstack-skills', 'MIT'],
    'tanstack-router': ['engineering', 'tanstack-skills/tanstack-skills', 'MIT'],
    'tanstack-form': ['engineering', 'tanstack-skills/tanstack-skills', 'MIT'],
    'tanstack-table': ['engineering', 'tanstack-skills/tanstack-skills', 'MIT'],
    'two-factor-authentication-best-practices': ['engineering', 'better-auth/skills', null],
    'aico:ui-design': ['design', 'plugin:aico', null],
  });
  assert.equal(Object.hasOwn(b.entries.find((e) => e.skillname === 'vercel-react-best-practices'), 'license'), false);
});

test('the baseline keeps vetted on find-skills only, and no hash', () => {
  const b = readBaseline();
  assert.deepEqual(b.entries.filter((e) => Object.hasOwn(e, 'vetted')).map((e) => [e.skillname, e.vetted]), [['find-skills', '2026-10-22']]);
  assert.equal(b.entries.some((e) => Object.hasOwn(e, 'hash') || Object.hasOwn(e, 'skillcommit')), false);
});

test('the baseline categories are the closed list with the contract role ids', () => {
  const b = readBaseline();
  assert.deepEqual(Object.keys(b.categories), ['engineering', 'design', 'security', 'quality', 'product', 'research', 'content']);
  assert.deepEqual(b.categories.security, ['security', 'pentester', 'vuln-scanner']);
  assert.equal(b.categories.engineering.includes('backend-engineer'), true);
  assert.equal(b.categories.design.includes('frontend-engineer'), true);
});

test('the baseline groups expand in the old manifest order, de-duplicated, and aico:ui-design is in none', () => {
  const b = readBaseline();
  assert.deepEqual(expandGroups(b, ['core']).map((e) => e.skillname), [
    'find-skills', 'hallmark', 'impeccable', 'frontend-ui-engineering', 'security-and-hardening', 'security-review', 'auth-implementation-patterns',
  ]);
  assert.deepEqual(expandGroups(b, ['go', 'react', 'tanstack', 'auth']).map((e) => e.skillname), [
    'golang-*', 'vercel-react-best-practices', 'vercel-composition-patterns', 'typescript-advanced-types',
    'tanstack-query', 'tanstack-router', 'tanstack-form', 'tanstack-table', 'two-factor-authentication-best-practices',
  ]);
  assert.equal(expandGroups(b).some((e) => e.skillname === 'aico:ui-design'), false);
  assert.throws(() => expandGroups(b, ['nope']));
});

test('parseBaseline refuses a malformed baseline', () => {
  const good = JSON.parse(fs.readFileSync(new URL('../deps/3rdpartyskills.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => parseBaseline(JSON.stringify(good)));
  const bad = (mut) => { const c = structuredClone(good); mut(c); return () => parseBaseline(JSON.stringify(c)); };
  assert.throws(bad((c) => { c.schema = 2; }), /ERROR baseline catalog/);
  assert.throws(bad((c) => { c.extra = 1; }), /ERROR baseline catalog/);
  assert.throws(bad((c) => { delete c.categories.content; }), /ERROR baseline catalog/);
  assert.throws(bad((c) => { c.groups.core.push('missing-name'); }), /ERROR baseline catalog/);
  assert.throws(bad((c) => { c.groups.research.push({ include: 'core' }); }), /ERROR baseline catalog/);
  assert.throws(bad((c) => { c.entries[0].license = 'a\nb'; }), /ERROR baseline catalog/);
  assert.throws(bad((c) => { c.entries.push(structuredClone(c.entries[0])); }), /ERROR baseline catalog/);
  assert.throws(() => parseBaseline('{'), /ERROR baseline catalog/);
});

test('every baseline entry is valid and no line has a CR', () => {
  for (const e of readBaseline().entries) assert.equal(validateEntry(e, 'baseline').ok, true, e.skillname);
  for (const f of ['../deps/3rdpartyskills.json', './skill-catalog.mjs', './skill-catalog.test.mjs']) {
    assert.equal(fs.readFileSync(new URL(f, import.meta.url)).includes(13), false, f);
  }
});

// ---------- readCatalog merge ----------

test('readCatalog: user entries join after the baseline; a clash keeps the baseline', () => {
  const home = tmp();
  writeUser(home, { schema: 1, entries: [
    repoEntry(),
    repoEntry({ skillname: 'hallmark', skillrepo: 'other/hallmark' }),
  ] });
  const r = readCatalog({ home });
  const names = r.entries.map((e) => e.skillname);
  assert.equal(names.at(-1), 'my-skill');
  assert.equal(r.entries.find((e) => e.skillname === 'hallmark').skillrepo, 'nutlope/hallmark');
  assert.deepEqual(r.clashes, [{ skillname: 'hallmark', pinned: false }]);
  assert.equal(r.entries.find((e) => e.skillname === 'my-skill').layer, 'user');
  assert.equal(r.entries.find((e) => e.skillname === 'hallmark').layer, 'baseline');
});

test('readCatalog: a same-source user entry with a commit pins the baseline entry with its own license and vetted', () => {
  const home = tmp();
  writeUser(home, { schema: 1, entries: [
    { skillname: 'hallmark', skillcategory: 'security', skillrepo: 'nutlope/hallmark', skillcommit: C1, license: 'BSD-3-Clause', vetted: '2026-11-01', hash: H1 },
  ] });
  const r = readCatalog({ home });
  const e = r.entries.find((x) => x.skillname === 'hallmark');
  assert.equal(e.skillcommit, C1);
  assert.equal(e.license, 'BSD-3-Clause');
  assert.equal(e.vetted, '2026-11-01');
  assert.equal(e.hash, H1);
  assert.equal(e.skillcategory, 'design');
  assert.equal(e.pinned, true);
  assert.deepEqual(r.clashes, [{ skillname: 'hallmark', pinned: true }]);
  assert.equal(r.entries.filter((x) => x.skillname === 'hallmark').length, 1);
});

test('readCatalog: a duplicate name in the user file reports the second', () => {
  const home = tmp();
  writeUser(home, { schema: 1, entries: [repoEntry(), repoEntry({ skillcommit: C2 })] });
  const r = readCatalog({ home });
  assert.deepEqual(r.errors, ['ERROR user catalog entry 2: skillname duplicate']);
  assert.equal(r.entries.find((e) => e.skillname === 'my-skill').skillcommit, C1);
});

// ---------- small exports ----------

test('eligibleRoles, selectable and approvable', () => {
  const b = readBaseline();
  assert.deepEqual(eligibleRoles(b.entries.find((e) => e.skillname === 'security-review'), b.categories), ['security', 'pentester', 'vuln-scanner']);
  assert.deepEqual(eligibleRoles({ skillcategory: 'nope' }, b.categories), []);
  assert.deepEqual(selectable(b.entries.find((e) => e.skillname === 'golang-*')), { ok: false, reason: 'a wildcard names no one skill' });
  assert.deepEqual(selectable(b.entries.find((e) => e.skillname === 'vercel-react-best-practices')), { ok: true });
  assert.equal(approvable({ verdict: 'pass' }, H1), true);
  assert.equal(approvable({ verdict: 'pass' }, null), false);
  assert.equal(approvable({ verdict: 'pass' }, 'zz'), false);
  assert.equal(approvable({ verdict: 'findings', blocking: false, counts: { critical: 0, high: 0 } }, H1), true);
  assert.equal(approvable({ verdict: 'findings', blocking: true, counts: { critical: 0, high: 0 } }, H1), false);
  assert.equal(approvable({ verdict: 'findings', blocking: false, counts: { critical: 0, high: 1 } }, H1), false);
  assert.equal(approvable({ verdict: 'error' }, H1), false);
  assert.equal(approvable(null, H1), false);
  assert.equal(approvable({ verdict: 'findings', blocking: false }, H1), false);
});

// ---------- boundedFolderHash ----------

test('boundedFolderHash equals the scan folder hash', () => {
  const d = tmp();
  mkSkillDir(path.join(d, 's'), { 'SKILL.md': 'hello', 'a/b.txt': 'b', 'a/A.txt': 'c', 'z.md': 'z', 'node_modules/x.js': 'skip', '.git/HEAD': 'skip' });
  assert.equal(boundedFolderHash(path.join(d, 's')), skillFolderHash(path.join(d, 's')));
});

test('boundedFolderHash refuses a link at the top and a missing folder', (t) => {
  const d = tmp();
  assert.equal(boundedFolderHash(path.join(d, 'none')), null);
  mkSkillDir(path.join(d, 'real'));
  if (canLink(t)) {
    fs.symlinkSync(path.join(d, 'real'), path.join(d, 'lnk'), 'junction');
    assert.equal(boundedFolderHash(path.join(d, 'lnk')), null);
  }
  fs.writeFileSync(path.join(d, 'file'), 'x');
  assert.equal(boundedFolderHash(path.join(d, 'file')), null);
});

test('boundedFolderHash returns null over 2000 files', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 's'));
  for (let i = 0; i < 2001; i++) fs.writeFileSync(path.join(d, 's', `f${i}`), '');
  assert.equal(boundedFolderHash(path.join(d, 's')), null);
  fs.unlinkSync(path.join(d, 's', 'f0'));
  assert.equal(typeof boundedFolderHash(path.join(d, 's')), 'string');
});

test('boundedFolderHash returns null over 64 MiB', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 's'));
  const fd = fs.openSync(path.join(d, 's', 'big'), 'w');
  fs.ftruncateSync(fd, 64 * 1024 * 1024 + 1);
  fs.closeSync(fd);
  assert.equal(boundedFolderHash(path.join(d, 's')), null);
});

// ---------- skillStatus ----------

const pinned = (over = {}) => repoEntry({ hash: undefined, ...over });

test('skillStatus: repo entry with a commit reads installed, folder not recognized or missing', () => {
  const home = tmp('home');
  const root = tmp('root');
  const dir = path.join(root, '.agents', 'skills', 'my-skill');
  assert.equal(skillStatus(pinned(), { home, productRoot: root }).status, 'missing');
  mkSkillDir(dir);
  assert.equal(skillStatus(pinned(), { home, productRoot: root }).status, 'folder not recognized');
  const hash = boundedFolderHash(dir);
  assert.deepEqual(
    skillStatus(pinned({ hash }), { home, productRoot: root }),
    { status: 'installed', place: 'project', license: 'MIT, as stated, not checked', vetted: null },
  );
  assert.equal(skillStatus(pinned({ hash: H1 }), { home, productRoot: root }).status, 'folder not recognized');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), 'changed');
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'folder not recognized');
});

test('skillStatus: the home is checked after the product root', () => {
  const home = tmp('home');
  const root = tmp('root');
  mkSkillDir(path.join(home, '.claude', 'skills', 'my-skill'));
  const hash = boundedFolderHash(path.join(home, '.claude', 'skills', 'my-skill'));
  const s = skillStatus(pinned({ hash }), { home, productRoot: root });
  assert.equal(s.status, 'installed');
  assert.equal(s.place, 'user');
});

test('skillStatus: scope user reads the home only', () => {
  const home = tmp('home');
  const root = tmp('root');
  mkSkillDir(path.join(root, '.agents', 'skills', 'my-skill'));
  const hash = boundedFolderHash(path.join(root, '.agents', 'skills', 'my-skill'));
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root, scope: 'user' }).status, 'missing');
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root, scope: 'project' }).status, 'installed');
  const inst = { skillname: 'inst', skillcategory: 'design', skillinstaller: 'npx pkg@1.0.0', license: 'MIT' };
  mkSkillDir(path.join(root, '.claude', 'skills', 'inst'));
  assert.equal(skillStatus(inst, { home, productRoot: root, scope: 'user' }).status, 'not found');
  assert.equal(skillStatus(inst, { home, productRoot: root }).status, 'installed (name only)');
  mkSkillDir(path.join(home, '.claude', 'skills', 'inst'));
  assert.equal(skillStatus(inst, { home, productRoot: root, scope: 'user' }).status, 'installed (name only)');
});

test('skillStatus: a link at the folder is present but not recognized; a link on the way is not followed', (t) => {
  if (!canLink(t)) return;
  const home = tmp('home');
  const root = tmp('root');
  const elsewhere = tmp('else');
  mkSkillDir(path.join(elsewhere, 'my-skill'));
  const hash = boundedFolderHash(path.join(elsewhere, 'my-skill'));
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync(path.join(elsewhere, 'my-skill'), path.join(root, '.claude', 'skills', 'my-skill'), 'junction');
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'folder not recognized');
  const root2 = tmp('root');
  fs.mkdirSync(path.join(elsewhere, 'skills'), { recursive: true });
  fs.renameSync(path.join(elsewhere, 'my-skill'), path.join(elsewhere, 'skills', 'my-skill'));
  fs.symlinkSync(elsewhere, path.join(root2, '.agents'), 'junction');
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root2 }).status, 'missing');
});

test('skillStatus: a hash that is not bound never reads installed', () => {
  const home = tmp('home');
  const root = tmp('root');
  mkSkillDir(path.join(root, '.agents', 'skills', 'my-skill'));
  assert.equal(skillStatus(pinned(), { home, productRoot: root }).status, 'folder not recognized');
});

test('skillStatus: installer, unpinned baseline repo, plugin and wildcard entries', () => {
  const home = tmp('home');
  const root = tmp('root');
  const b = readBaseline();
  const get = (n) => b.entries.find((e) => e.skillname === n);
  assert.equal(skillStatus(get('impeccable'), { home, productRoot: root }).status, 'not found');
  mkSkillDir(path.join(root, '.claude', 'skills', 'impeccable'));
  assert.equal(skillStatus(get('impeccable'), { home, productRoot: root }).status, 'installed (name only)');
  assert.equal(skillStatus(get('hallmark'), { home, productRoot: root }).status, 'not found');
  mkSkillDir(path.join(root, '.agents', 'skills', 'hallmark'));
  assert.equal(skillStatus(get('hallmark'), { home, productRoot: root }).status, 'installed (name only)');
  assert.equal(skillStatus(get('aico:ui-design'), { home, productRoot: root }).status, 'checked at run start');
  assert.equal(skillStatus(get('golang-*'), { home, productRoot: root }).status, 'not found');
  mkSkillDir(path.join(root, '.agents', 'skills', 'golang-testing'));
  assert.equal(skillStatus(get('golang-*'), { home, productRoot: root }).status, 'installed (name only)');
});

test('skillStatus: license text and vetted', () => {
  const home = tmp('home');
  const root = tmp('root');
  const b = readBaseline();
  const get = (n) => b.entries.find((e) => e.skillname === n);
  assert.equal(skillStatus(get('vercel-react-best-practices'), { home, productRoot: root }).license, 'no license on record');
  assert.equal(skillStatus(get('vercel-composition-patterns'), { home, productRoot: root }).license, 'no license on record');
  assert.equal(skillStatus(get('two-factor-authentication-best-practices'), { home, productRoot: root }).license, 'no license on record');
  assert.equal(skillStatus(get('impeccable'), { home, productRoot: root }).license, 'Apache-2.0, as stated, not checked');
  assert.equal(skillStatus(get('find-skills'), { home, productRoot: root }).vetted, '2026-10-22');
  assert.equal(skillStatus(get('hallmark'), { home, productRoot: root }).vetted, null);
  const withDate = { skillname: 'inst', skillcategory: 'design', skillinstaller: 'npx pkg@1.0.0', license: 'MIT', vetted: '2026-10-01' };
  assert.equal(skillStatus(withDate, { home, productRoot: root }).vetted, null);
  assert.equal(skillStatus(repoEntry({ vetted: '2026-10-01' }), { home, productRoot: root }).vetted, '2026-10-01');
});

test('skillStatus joins no unvalidated name', () => {
  const home = tmp('home');
  const root = tmp('root');
  fs.mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents', 'outside'));
  const e = { skillname: '../outside', skillcategory: 'design', skillrepo: 'a/b', skillcommit: C1, license: 'MIT' };
  assert.equal(skillStatus(e, { home, productRoot: root }).status, 'not found');
});

// ---------- writes ----------

test('addUserEntry adds, then an equal entry writes nothing', () => {
  const home = tmp();
  const r = addUserEntry(repoEntry(), { home });
  assert.deepEqual(r, { ok: true, changed: true });
  assert.deepEqual(readUser(home), { schema: 1, entries: [repoEntry()] });
  const before = fs.readFileSync(userFile(home), 'utf8');
  const mtime = fs.statSync(userFile(home)).mtimeMs;
  assert.deepEqual(addUserEntry(repoEntry(), { home }), { ok: true, changed: false });
  assert.equal(fs.readFileSync(userFile(home), 'utf8'), before);
  assert.equal(fs.statSync(userFile(home)).mtimeMs, mtime);
  assert.equal(before.endsWith('\n'), true);
  assert.equal(before.includes('\r'), false);
  assert.deepEqual(fs.readdirSync(path.join(home, '.mcsparrow')), ['3rdpartyskills.json']);
});

test('addUserEntry refuses an entry with no license and writes nothing', () => {
  const home = tmp();
  const r = addUserEntry(repoEntry({ license: undefined }), { home });
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(userFile(home)), false);
});

test('addUserEntry: another commit needs moveCommit, another source is refused', () => {
  const home = tmp();
  addUserEntry(repoEntry({ license: 'MIT' }), { home });
  assert.equal(setBoundHash('my-skill', H1, '2026-11-01', { home }).ok, true);
  const raw = readUser(home);
  raw.entries[0].skillcategory = 'security';
  writeUser(home, raw);
  const before = fs.readFileSync(userFile(home), 'utf8');
  const refused = addUserEntry(repoEntry({ skillcommit: C2 }), { home });
  assert.equal(refused.ok, false);
  assert.equal(fs.readFileSync(userFile(home), 'utf8'), before);
  const other = addUserEntry(repoEntry({ skillrepo: 'evil/other', skillcommit: C2 }), { home, moveCommit: true });
  assert.equal(other.ok, false);
  assert.equal(fs.readFileSync(userFile(home), 'utf8'), before);
  const moved = addUserEntry(repoEntry({ skillcommit: C2, license: 'Apache-2.0' }), { home, moveCommit: true });
  assert.deepEqual(moved, { ok: true, changed: true });
  assert.deepEqual(readUser(home).entries, [{ skillname: 'my-skill', skillcategory: 'security', skillrepo: 'acme/my-skill', skillcommit: C2, license: 'Apache-2.0' }]);
});

test('addUserEntry keeps every other entry and refuses a baseline clash with another source', () => {
  const home = tmp();
  addUserEntry(repoEntry({ skillname: 'one' }), { home });
  addUserEntry(repoEntry({ skillname: 'two', skillrepo: 'acme/two' }), { home });
  assert.deepEqual(readUser(home).entries.map((e) => e.skillname), ['one', 'two']);
  assert.equal(addUserEntry(repoEntry({ skillname: 'hallmark', skillrepo: 'other/hallmark' }), { home }).ok, false);
  assert.equal(addUserEntry({ skillname: 'impeccable', skillcategory: 'design', skillinstaller: 'npx pkg@1.0.0', license: 'MIT' }, { home }).ok, false);
  const pin = addUserEntry({ skillname: 'hallmark', skillcategory: 'design', skillrepo: 'nutlope/hallmark', skillcommit: C1, license: 'MIT' }, { home });
  assert.deepEqual(pin, { ok: true, changed: true });
});

test('addUserEntry refuses to overwrite a file it cannot read', () => {
  const home = tmp();
  writeUser(home, '{broken');
  const r = addUserEntry(repoEntry(), { home });
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(userFile(home), 'utf8'), '{broken');
});

test('addUserEntry refuses a link at the target', (t) => {
  if (!canLink(t)) return;
  const home = tmp();
  const real = tmp('real');
  fs.writeFileSync(path.join(real, 'f.json'), '{"schema":1,"entries":[]}');
  fs.mkdirSync(path.join(home, '.mcsparrow'), { recursive: true });
  try { fs.symlinkSync(path.join(real, 'f.json'), userFile(home), 'file'); } catch { t.diagnostic('no file link here'); return; }
  const r = addUserEntry(repoEntry(), { home });
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(path.join(real, 'f.json'), 'utf8'), '{"schema":1,"entries":[]}');
});

test('addUserEntry refuses when the settings folder is a link', (t) => {
  if (!canLink(t)) return;
  const home = tmp();
  const real = tmp('real');
  fs.symlinkSync(real, path.join(home, '.mcsparrow'), 'junction');
  const r = addUserEntry(repoEntry(), { home });
  assert.equal(r.ok, false);
  assert.deepEqual(fs.readdirSync(real), []);
});

test('addUserEntry refuses the 201st entry', () => {
  const home = tmp();
  const entries = [];
  for (let i = 0; i < 200; i++) entries.push(repoEntry({ skillname: `s-${i}` }));
  writeUser(home, { schema: 1, entries });
  assert.equal(addUserEntry(repoEntry({ skillname: 'one-more' }), { home }).ok, false);
});

test('setBoundHash writes both or neither, and clearBound clears both', () => {
  const home = tmp();
  addUserEntry(repoEntry(), { home });
  const before = fs.readFileSync(userFile(home), 'utf8');
  assert.equal(setBoundHash('my-skill', 'zz', '2026-11-01', { home }).ok, false);
  assert.equal(setBoundHash('my-skill', H1, 'tomorrow', { home }).ok, false);
  assert.equal(setBoundHash('my-skill', H1, '9999-01-01', { home }).ok, false);
  assert.equal(setBoundHash('my-skill', H1, undefined, { home }).ok, false);
  assert.equal(setBoundHash('nope', H1, '2026-11-01', { home }).ok, false);
  assert.equal(setBoundHash('../x', H1, '2026-11-01', { home }).ok, false);
  assert.equal(fs.readFileSync(userFile(home), 'utf8'), before);
  assert.deepEqual(setBoundHash('my-skill', H1, '2026-11-01', { home }), { ok: true, changed: true });
  const e = readUser(home).entries[0];
  assert.equal(e.hash, H1);
  assert.equal(e.vetted, '2026-11-01');
  assert.deepEqual(clearBound('my-skill', { home }), { ok: true, changed: true });
  const c = readUser(home).entries[0];
  assert.equal(Object.hasOwn(c, 'hash'), false);
  assert.equal(Object.hasOwn(c, 'vetted'), false);
  assert.deepEqual(clearBound('my-skill', { home }), { ok: true, changed: false });
  assert.equal(clearBound('nope', { home }).ok, false);
});

test('setBoundHash refuses an entry that is not a repo with a commit', () => {
  const home = tmp();
  addUserEntry({ skillname: 'inst', skillcategory: 'design', skillinstaller: 'npx pkg@1.0.0', license: 'MIT' }, { home });
  assert.equal(setBoundHash('inst', H1, '2026-11-01', { home }).ok, false);
});

test('a bound hash and vetted date read back through the status of a pinned folder', () => {
  const home = tmp('home');
  const root = tmp('root');
  addUserEntry(repoEntry(), { home });
  mkSkillDir(path.join(root, '.agents', 'skills', 'my-skill'));
  const hash = boundedFolderHash(path.join(root, '.agents', 'skills', 'my-skill'));
  setBoundHash('my-skill', hash, '2026-11-02', { home });
  const entry = readCatalog({ home }).entries.find((e) => e.skillname === 'my-skill');
  const s = skillStatus(entry, { home, productRoot: root });
  assert.equal(s.status, 'installed');
  assert.equal(s.vetted, '2026-11-02');
});
