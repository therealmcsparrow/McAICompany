import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  userCatalogPath, linkedSegments, itemsProven, readBaseline, parseBaseline, readCatalog, validateEntry, expandGroups, eligibleRoles,
  selectable, approvable, boundedFolderHash, skillStatus, addUserEntry, setBoundHash, clearBound, licenseAsTyped,
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

test('licenseAsTyped: cuts edge spaces, refuses hidden characters', () => {
  assert.equal(licenseAsTyped('  MIT  '), 'MIT');
  assert.equal(licenseAsTyped('   '), '');
  assert.equal(licenseAsTyped('a​b'), null);
  assert.equal(licenseAsTyped('​MIT'), null);
  assert.equal(licenseAsTyped('a\nb'), null);
  assert.equal(licenseAsTyped('a\u{e0041}b'), null);
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

test('skillStatus: a link at the folder is present but not recognized; a link on the way holding the name is present and never proves', (t) => {
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
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root2 }).status, 'folder not recognized');
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

test('validateEntry: a plugin name may hold two 64 character parts', () => {
  const part = 'a'.repeat(64);
  const p = `${part}:${part}`;
  assert.equal(validateEntry({ skillname: p, skillcategory: 'design', skillplugin: part }, 'baseline').ok, true);
  assert.equal(validateEntry({ skillname: `${'a'.repeat(40)}:${'b'.repeat(40)}`, skillcategory: 'design', skillplugin: 'a'.repeat(40) }, 'baseline').ok, true);
  assert.equal(validateEntry({ skillname: `${p}a`, skillcategory: 'design', skillplugin: part }, 'baseline').ok, false);
  assert.equal(validateEntry(repoEntry({ skillname: 'a'.repeat(65) }), 'user').ok, false);
});

test('validateEntry: the raw license is tested, only plain edge spaces are trimmed', () => {
  const ok = (l) => validateEntry(repoEntry({ license: l }), 'user');
  for (const bad of ['MIT\n', '\nMIT', 'MIT\r', '\uFEFFMIT', 'MIT\u2028', 'MIT\u2029', 'MIT\t', 'MIT\u200b', '\u202eMIT']) {
    assert.equal(ok(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(ok('\u00a0MIT\u3000').entry.license, 'MIT');
  assert.equal(ok(' MIT ').entry.license, 'MIT');
});

test('skillStatus: a present folder that is not recognized names its place', () => {
  const home = tmp('home');
  const root = tmp('root');
  mkSkillDir(path.join(home, '.claude', 'skills', 'my-skill'));
  assert.deepEqual(
    skillStatus(pinned({ hash: H1 }), { home, productRoot: root }),
    { status: 'folder not recognized', place: 'user', license: 'MIT, as stated, not checked', vetted: null },
  );
  mkSkillDir(path.join(root, '.claude', 'skills', 'my-skill'));
  assert.equal(skillStatus(pinned({ hash: H1 }), { home, productRoot: root }).place, 'project');
});

test('skillStatus: a plugin or wildcard entry keeps its date; an installer entry never does', () => {
  const home = tmp('home');
  const root = tmp('root');
  const plug = { skillname: 'p:s', skillcategory: 'design', skillplugin: 'p', vetted: '2026-10-01' };
  assert.equal(skillStatus(plug, { home, productRoot: root }).vetted, '2026-10-01');
  const wild = { skillname: 'golang-*', skillcategory: 'engineering', skillrepo: 'a/b', vetted: '2026-10-02' };
  assert.equal(skillStatus(wild, { home, productRoot: root }).vetted, '2026-10-02');
  mkSkillDir(path.join(root, '.agents', 'skills', 'golang-testing'));
  assert.equal(skillStatus(wild, { home, productRoot: root }).vetted, '2026-10-02');
  const unpinned = { skillname: 'u-skill', skillcategory: 'engineering', skillrepo: 'a/b', vetted: '2026-10-03' };
  assert.equal(skillStatus(unpinned, { home, productRoot: root }).vetted, '2026-10-03');
  const inst = { skillname: 'inst', skillcategory: 'design', skillinstaller: 'npx pkg@1.0.0', vetted: '2026-10-01' };
  assert.equal(skillStatus(inst, { home, productRoot: root }).vetted, null);
});

test('skillStatus: every present folder must match, a second one that differs is not recognized', () => {
  const home = tmp('home');
  const root = tmp('root');
  const a = path.join(root, '.agents', 'skills', 'my-skill');
  const c = path.join(root, '.claude', 'skills', 'my-skill');
  mkSkillDir(a);
  const hash = boundedFolderHash(a);
  mkSkillDir(c, { 'SKILL.md': '# hostile\n' });
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'folder not recognized');
  fs.rmSync(c, { recursive: true });
  mkSkillDir(c);
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'installed');
  const h2 = tmp('home');
  mkSkillDir(path.join(h2, '.claude', 'skills', 'my-skill'), { 'SKILL.md': '# other\n' });
  assert.equal(skillStatus(pinned({ hash }), { home: h2, productRoot: root }).status, 'folder not recognized');
});

test('skillStatus: a link in .claude must lead to the proven .agents folder', (t) => {
  if (!canLink(t)) return;
  const home = tmp('home');
  const root = tmp('root');
  const a = path.join(root, '.agents', 'skills', 'my-skill');
  mkSkillDir(a);
  const hash = boundedFolderHash(a);
  const other = tmp('other');
  mkSkillDir(path.join(other, 'my-skill'));
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  const link = path.join(root, '.claude', 'skills', 'my-skill');
  fs.symlinkSync(path.join(other, 'my-skill'), link, 'junction');
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'folder not recognized');
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(a, link, 'junction');
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'installed');
});

test('skillStatus: a link to a folder whose name only folds to the proven one is not recognized (U+212A)', (t) => {
  if (!canLink(t)) return;
  const home = tmp('home');
  const root = tmp('root');
  const a = path.join(root, '.agents', 'skills', 'my-skill');
  mkSkillDir(a);
  const hash = boundedFolderHash(a);
  const hostile = path.join(root, '.agents', 'skills', 'my-sKill');
  mkSkillDir(hostile, { 'SKILL.md': '# hostile\n' });
  if (process.platform === 'win32' && !fs.existsSync(hostile)) { t.diagnostic('cannot make the folder here'); return; }
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  try { fs.symlinkSync(hostile, path.join(root, '.claude', 'skills', 'my-skill'), 'junction'); } catch { t.diagnostic('cannot create a link here'); return; }
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'folder not recognized');
});

test('skillStatus: a link whose text climbs through a helper link does not lead to the .agents folder', (t) => {
  if (!canLink(t)) return;
  const home = tmp('home');
  const root = tmp('root');
  const a = path.join(root, '.agents', 'skills', 'my-skill');
  mkSkillDir(a);
  const hash = boundedFolderHash(a);
  const evil = tmp('evil');
  mkSkillDir(path.join(evil, 'my-skill'), { 'SKILL.md': '# hostile\n' });
  fs.mkdirSync(path.join(evil, 'sub'));
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  try {
    fs.symlinkSync(path.join(evil, 'sub'), path.join(root, '.agents', 'skills', 'x'), 'junction');
    fs.symlinkSync('../../.agents/skills/x/../my-skill', path.join(root, '.claude', 'skills', 'my-skill'), 'dir');
  } catch { t.diagnostic('cannot create relative links here'); return; }
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'folder not recognized');
});

test('skillStatus: a link routed through a chained helper link is not recognized, though it lands in the proven folder', (t) => {
  if (!canLink(t)) return;
  const home = tmp('home');
  const root = tmp('root');
  const a = path.join(root, '.agents', 'skills', 'my-skill');
  mkSkillDir(a);
  const hash = boundedFolderHash(a);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  const y = path.join(root, '.agents', 'skills', 'y');
  const link = path.join(root, '.claude', 'skills', 'my-skill');
  try {
    fs.symlinkSync(path.join(root, '.agents', 'skills'), y, 'junction');
    fs.symlinkSync(path.join(y, 'my-skill'), link, 'junction');
  } catch { t.diagnostic('cannot create a link here'); return; }
  assert.equal(fs.realpathSync.native(link), fs.realpathSync.native(a));
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'folder not recognized');
});

test('skillStatus: a link whose text has a dot segment after a named one is not recognized, helper link text included', (t) => {
  const home = tmp('home');
  const root = tmp('root');
  const a = path.join(root, '.agents', 'skills', 'my-skill');
  mkSkillDir(a);
  const hash = boundedFolderHash(a);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  const link = path.join(root, '.claude', 'skills', 'my-skill');
  const texts = ['../../.agents/skills/x/../my-skill', '../../.agents/skills/./my-skill', '../../.agents/skills/x\\..\\my-skill'];
  let made = 0;
  for (const text of texts) {
    fs.rmSync(link, { recursive: true, force: true });
    try { fs.symlinkSync(text, link, 'dir'); } catch { t.diagnostic('cannot create relative links here'); return; }
    made++;
    assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'folder not recognized', text);
  }
  assert.equal(made, texts.length);
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync('../../.agents/skills/my-skill', link, 'dir');
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'installed');
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync('./../../.agents/skills/my-skill', link, 'dir');
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'installed');
});

test('skillStatus: link text with a dot segment after a named one is refused even where the native route is the proven folder', (t) => {
  if (!canLink(t)) return;
  const home = tmp('home');
  const root = tmp('root');
  const a = path.join(root, '.agents', 'skills', 'my-skill');
  mkSkillDir(a);
  const hash = boundedFolderHash(a);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  const link = path.join(root, '.claude', 'skills', 'my-skill');
  try { fs.symlinkSync(a, link, 'junction'); } catch { t.diagnostic('cannot create a link here'); return; }
  const real = fs.readlinkSync;
  for (const text of ['../../.agents/skills/x/../my-skill', '../../.agents/skills/x\\..\\my-skill', '../../.agents/skills/./my-skill']) {
    t.mock.method(fs, 'readlinkSync', (p, ...rest) => (p === link ? text : real(p, ...rest)));
    assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'folder not recognized', text);
    t.mock.restoreAll();
  }
  t.mock.method(fs, 'readlinkSync', (p, ...rest) => (p === link ? '../../.agents/skills/my-skill' : real(p, ...rest)));
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'installed');
  t.mock.restoreAll();
  t.mock.method(fs, 'readlinkSync', (p) => { throw Object.assign(new Error('boom'), { code: 'EIO' }); });
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'folder not recognized');
});

test('skillStatus: a junction as the skills CLI makes it stays installed', (t) => {
  if (!canLink(t)) return;
  const home = tmp('home');
  const root = tmp('root');
  const a = path.join(root, '.agents', 'skills', 'my-skill');
  mkSkillDir(a);
  const hash = boundedFolderHash(a);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  try { fs.symlinkSync(a, path.join(root, '.claude', 'skills', 'my-skill'), 'junction'); } catch { t.diagnostic('cannot create a link here'); return; }
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'installed');
});

test('linkedSegments names a linked .claude, .claude/skills, .agents or .agents/skills', (t) => {
  if (!canLink(t)) return;
  const root = tmp('root');
  assert.deepEqual(linkedSegments(root), []);
  const other = tmp('other');
  fs.mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude'));
  fs.symlinkSync(other, path.join(root, '.claude', 'skills'), 'junction');
  assert.deepEqual(linkedSegments(root), ['.claude/skills']);
  const root2 = tmp('root');
  fs.symlinkSync(other, path.join(root2, '.agents'), 'junction');
  assert.deepEqual(linkedSegments(root2), ['.agents']);
});

test('linkedSegments counts a file at .claude or .claude/skills, and any other lstat error, as a linked segment', (t) => {
  const r1 = tmp('root');
  fs.writeFileSync(path.join(r1, '.claude'), 'x');
  assert.deepEqual(linkedSegments(r1), ['.claude']);
  const r2 = tmp('root');
  fs.mkdirSync(path.join(r2, '.claude'));
  fs.writeFileSync(path.join(r2, '.claude', 'skills'), 'x');
  assert.deepEqual(linkedSegments(r2), ['.claude/skills']);
  const r3 = tmp('root');
  fs.mkdirSync(path.join(r3, '.agents', 'skills'), { recursive: true });
  assert.deepEqual(linkedSegments(r3), []);
  const real = fs.lstatSync;
  for (const code of ['ENOENT', 'ENOTDIR']) {
    t.mock.method(fs, 'lstatSync', (p, ...rest) => {
      if (String(p).endsWith('.agents')) throw Object.assign(new Error(code), { code });
      return real(p, ...rest);
    });
    fs.writeFileSync(path.join(r3, '.claude'), 'x');
    assert.deepEqual(linkedSegments(r3), ['.claude']);
    fs.rmSync(path.join(r3, '.claude'));
    t.mock.restoreAll();
  }
  t.mock.method(fs, 'lstatSync', (p, ...rest) => {
    if (String(p).endsWith('.agents')) throw Object.assign(new Error('boom'), { code: 'EACCES' });
    return real(p, ...rest);
  });
  assert.deepEqual(linkedSegments(r3), ['.agents']);
});

test('a plain file through a linked segment reads installed (name only) at project', (t) => {
  if (!canLink(t)) return;
  const home = tmp('home');
  const root = tmp('root');
  const other = tmp('other');
  fs.writeFileSync(path.join(other, 'my-skill'), 'plain file');
  fs.mkdirSync(path.join(root, '.claude'));
  fs.symlinkSync(other, path.join(root, '.claude', 'skills'), 'junction');
  const r = skillStatus({ skillname: 'my-skill', skillcategory: 'engineering', skillrepo: 'a/b' }, { home, productRoot: root });
  assert.equal(r.status, 'installed (name only)');
  assert.equal(r.place, 'project');
});

test('row 1: an lstat error on a skills segment other than absence counts as through at project; a file there is skipped', (t) => {
  const entryOf = { skillname: 'my-skill', skillcategory: 'engineering', skillrepo: 'a/b' };
  const home = tmp('home');
  const root = tmp('root');
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  const real = fs.lstatSync;
  const guarded = path.join(root, '.claude');
  t.mock.method(fs, 'lstatSync', (p, ...rest) => {
    if (String(p).startsWith(guarded)) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return real(p, ...rest);
  });
  const r = skillStatus(entryOf, { home, productRoot: root });
  assert.equal(r.status, 'installed (name only)');
  assert.equal(r.place, 'project');
  assert.deepEqual(itemsProven(root, 'my-skill', H1, { place: 'project' }), { present: true, ok: false });
  t.mock.restoreAll();
  const root2 = tmp('root');
  fs.mkdirSync(path.join(root2, '.claude'));
  fs.writeFileSync(path.join(root2, '.claude', 'skills'), 'a file');
  const r2 = skillStatus(entryOf, { home, productRoot: root2 });
  assert.equal(r2.status, 'not found');
  assert.deepEqual(itemsProven(root2, 'my-skill', H1, { place: 'project' }), { present: false, ok: false });
});

test('an lstat error on the name through a linked segment counts as present and never proves', (t) => {
  if (!canLink(t)) return;
  const root = tmp('root');
  const other = tmp('other');
  mkSkillDir(path.join(other, 'my-skill'));
  fs.mkdirSync(path.join(root, '.claude'));
  fs.symlinkSync(other, path.join(root, '.claude', 'skills'), 'junction');
  const real = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (p, ...rest) => {
    if (String(p).endsWith('my-skill')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return real(p, ...rest);
  });
  assert.deepEqual(itemsProven(root, 'my-skill', H1, { place: 'project' }), { present: true, ok: false });
});

test('a linked .claude/skills holding the name beside a proven .agents copy is not recognized at place project', (t) => {
  if (!canLink(t)) return;
  const home = tmp('home');
  const root = tmp('root');
  const a = path.join(root, '.agents', 'skills', 'my-skill');
  mkSkillDir(a);
  const hash = boundedFolderHash(a);
  const evil = tmp('evil');
  mkSkillDir(path.join(evil, 'my-skill'), { 'SKILL.md': '# hostile\n' });
  fs.mkdirSync(path.join(root, '.claude'));
  fs.symlinkSync(evil, path.join(root, '.claude', 'skills'), 'junction');
  assert.deepEqual(itemsProven(root, 'my-skill', hash, { place: 'project' }), { present: true, ok: false });
  assert.deepEqual(itemsProven(root, 'my-skill', hash), { present: true, ok: false });
  assert.deepEqual(itemsProven(root, 'my-skill', hash, { place: 'user' }), { present: true, ok: true });
  const r = skillStatus(pinned({ hash }), { home, productRoot: root });
  assert.equal(r.status, 'folder not recognized');
  assert.equal(r.place, 'project');
  // the same bytes behind a link still never prove
  fs.rmSync(path.join(evil, 'my-skill'), { recursive: true });
  mkSkillDir(path.join(evil, 'my-skill'));
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'folder not recognized');
});

test('a linked .claude/skills without the name adds nothing; an unpinned entry reads place project through a link', (t) => {
  if (!canLink(t)) return;
  const home = tmp('home');
  const root = tmp('root');
  const a = path.join(root, '.agents', 'skills', 'my-skill');
  mkSkillDir(a);
  const hash = boundedFolderHash(a);
  const empty = tmp('empty');
  fs.mkdirSync(path.join(root, '.claude'));
  fs.symlinkSync(empty, path.join(root, '.claude', 'skills'), 'junction');
  assert.equal(skillStatus(pinned({ hash }), { home, productRoot: root }).status, 'installed');
  assert.deepEqual(linkedSegments(root), ['.claude/skills']);
  const evil = tmp('evil');
  mkSkillDir(path.join(evil, 'u-skill'));
  fs.rmSync(path.join(root, '.claude', 'skills'), { recursive: true, force: true });
  fs.symlinkSync(evil, path.join(root, '.claude', 'skills'), 'junction');
  mkSkillDir(path.join(home, '.agents', 'skills', 'u-skill'));
  const r = skillStatus({ skillname: 'u-skill', skillcategory: 'engineering', skillrepo: 'a/b' }, { home, productRoot: root });
  assert.equal(r.place, 'project');
  assert.equal(r.status, 'installed (name only)');
});

test('a linked folder under the user home stays skipped at scope user', (t) => {
  if (!canLink(t)) return;
  const home = tmp('home');
  const root = tmp('root');
  const dotfiles = tmp('dotfiles');
  const a = path.join(home, '.agents', 'skills', 'my-skill');
  mkSkillDir(a);
  const hash = boundedFolderHash(a);
  mkSkillDir(path.join(dotfiles, 'other-skill'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.symlinkSync(dotfiles, path.join(home, '.claude', 'skills'), 'junction');
  const r = skillStatus(pinned({ hash }), { home, productRoot: root, scope: 'user' });
  assert.equal(r.status, 'installed');
  assert.equal(r.place, 'user');
});

test('a regular file named like the skill is not an installed skill, and a pinned entry reads folder not recognized', () => {
  const home = tmp('home');
  const root = tmp('root');
  fs.mkdirSync(path.join(home, '.agents', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(home, '.agents', 'skills', 'u-skill'), 'x');
  fs.writeFileSync(path.join(home, '.agents', 'skills', 'golang-testing'), 'x');
  const unpinned = { skillname: 'u-skill', skillcategory: 'engineering', skillrepo: 'a/b' };
  assert.equal(skillStatus(unpinned, { home, productRoot: root }).status, 'not found');
  const wild = { skillname: 'golang-*', skillcategory: 'engineering', skillrepo: 'a/b' };
  assert.equal(skillStatus(wild, { home, productRoot: root }).status, 'not found');
  fs.writeFileSync(path.join(home, '.agents', 'skills', 'my-skill'), 'x');
  assert.equal(skillStatus(pinned({ hash: H1 }), { home, productRoot: root }).status, 'folder not recognized');
});

test('licenseAsTyped: a long inner run of spaces is read in linear time', () => {
  const long = `MIT${' '.repeat(60000)}x`;
  const start = process.hrtime.bigint();
  assert.equal(licenseAsTyped(long), long);
  assert.ok(Number(process.hrtime.bigint() - start) / 1e6 < 500);
  assert.equal(licenseAsTyped(` ${' '.repeat(60000)}MIT${' '.repeat(60000)}`), 'MIT');
});

test('a catalog file planted in the working folder adds nothing to a read', (t) => {
  const home = tmp();
  const cwd = tmp('cwd');
  fs.mkdirSync(path.join(cwd, '.mcsparrow'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.mcsparrow', '3rdpartyskills.json'), JSON.stringify({ schema: 1, entries: [repoEntry({ skillname: 'planted-skill' })] }));
  fs.writeFileSync(path.join(cwd, '3rdpartyskills.json'), JSON.stringify({ schema: 1, entries: [repoEntry({ skillname: 'planted-skill' })] }));
  const before = process.cwd();
  process.chdir(cwd);
  t.after(() => process.chdir(before));
  const r = readCatalog({ home });
  assert.equal(r.entries.some((e) => e.skillname === 'planted-skill'), false);
  assert.deepEqual(r.errors, []);
});

test('clearBound clears both keys beside another hostile row; setBoundHash still refuses and writes nothing', () => {
  const home = tmp();
  addUserEntry(repoEntry({ hash: undefined }), { home });
  setBoundHash('my-skill', H1, '2026-11-01', { home });
  const doc = readUser(home);
  doc.entries.push(repoEntry({ skillname: 'other-skill', license: 'MIT ' }));
  writeUser(home, JSON.stringify(doc));
  assert.equal(setBoundHash('my-skill', H1, '2026-11-02', { home }).ok, false);
  const c = clearBound('my-skill', { home });
  assert.deepEqual(c, { ok: true, changed: true });
  const after = readUser(home);
  assert.equal(Object.hasOwn(after.entries[0], 'hash'), false);
  assert.equal(Object.hasOwn(after.entries[0], 'vetted'), false);
  assert.equal(after.entries[1].license, 'MIT ');
});

test('clearBound refuses a file-level error and writes nothing', () => {
  const home = tmp();
  writeUser(home, '{ not json');
  const before = fs.readFileSync(userFile(home), 'utf8');
  assert.equal(clearBound('my-skill', { home }).ok, false);
  assert.equal(fs.readFileSync(userFile(home), 'utf8'), before);
});

test('clearBound clears a row that itself holds a banned character', () => {
  const home = tmp();
  writeUser(home, JSON.stringify({ schema: 1, entries: [repoEntry({ license: 'MIT ', hash: H1, vetted: '2026-11-01' })] }));
  assert.deepEqual(clearBound('my-skill', { home }), { ok: true, changed: true });
  const row = readUser(home).entries[0];
  assert.equal(Object.hasOwn(row, 'hash'), false);
  assert.equal(Object.hasOwn(row, 'vetted'), false);
});

test('clearBound removes both keys from every row of the name, so the first valid row cannot keep the pin', () => {
  const bad = repoEntry({ skillcategory: 'no-such-category' });
  const good = repoEntry({ hash: H1, vetted: '2026-11-01' });
  const cases = [
    ['bad then good', [bad, good]],
    ['bad with a pin then good', [{ ...bad, hash: H1, vetted: '2026-11-01' }, good]],
  ];
  for (const [label, entries] of cases) {
    const home = tmp();
    writeUser(home, { schema: 1, entries });
    assert.equal(readCatalog({ home }).entries.find((e) => e.skillname === 'my-skill')?.hash, H1, `${label}: pinned before`);
    assert.deepEqual(clearBound('my-skill', { home }), { ok: true, changed: true }, label);
    for (const row of readUser(home).entries) {
      assert.equal(Object.hasOwn(row, 'hash'), false, label);
      assert.equal(Object.hasOwn(row, 'vetted'), false, label);
    }
    assert.equal(readCatalog({ home }).entries.find((e) => e.skillname === 'my-skill')?.hash, undefined, `${label}: no pin after`);
  }
});

test('clearBound leaves the rows of other names alone', () => {
  const home = tmp();
  writeUser(home, { schema: 1, entries: [repoEntry({ hash: H1, vetted: '2026-11-01' }), repoEntry({ skillname: 'other-skill', hash: H1, vetted: '2026-11-01' })] });
  assert.deepEqual(clearBound('my-skill', { home }), { ok: true, changed: true });
  const [a, b] = readUser(home).entries;
  assert.equal(Object.hasOwn(a, 'hash'), false);
  assert.equal(b.hash, H1);
  assert.equal(b.vetted, '2026-11-01');
});

test('clearBound skips a row that is not an object and a row whose skillname is not the name text, and keeps both as they were', () => {
  const home = tmp();
  const odd = [null, 'my-skill', ['my-skill'], { skillname: ['my-skill'], hash: H1, vetted: '2026-11-01' }, { skillname: { toString: 1 }, hash: H1 }];
  writeUser(home, { schema: 1, entries: [...odd, repoEntry({ hash: H1, vetted: '2026-11-01' })] });
  assert.deepEqual(clearBound('my-skill', { home }), { ok: true, changed: true });
  const rows = readUser(home).entries;
  assert.deepEqual(rows.slice(0, odd.length), odd);
  assert.equal(Object.hasOwn(rows.at(-1), 'hash'), false);
  assert.equal(Object.hasOwn(rows.at(-1), 'vetted'), false);
});

const REFUSED = (n) => `ERROR user catalog entry ${n}: clearing the pin would make this row the one read, nothing written; fix or remove it by hand`;

test('clearBound refuses when the strip would make a first row of the name readable, and writes nothing', () => {
  const cases = [
    ['a lone row with a bad hash: none before, the row after', [repoEntry({ hash: 'zz' })], 1],
    ['a bad vetted row, then the row read with a pin', [repoEntry({ vetted: '2099-01-01' }), repoEntry({ hash: H1, vetted: '2026-11-01' })], 1],
    ['another name first, a bad row of the name second, the row read third', [repoEntry({ skillname: 'other-skill' }), repoEntry({ vetted: '2099-01-01' }), repoEntry({ hash: H1, vetted: '2026-11-01' })], 2],
  ];
  for (const [label, entries, n] of cases) {
    const home = tmp();
    writeUser(home, { schema: 1, entries });
    const before = fs.readFileSync(userFile(home), 'utf8');
    assert.deepEqual(clearBound('my-skill', { home }), { ok: false, error: REFUSED(n) }, label);
    assert.equal(fs.readFileSync(userFile(home), 'utf8'), before, label);
  }
});

test('clearBound with no keys to strip changes nothing and still answers changed false', () => {
  const home = tmp();
  writeUser(home, { schema: 1, entries: [repoEntry({ skillcategory: 'no-such-category' }), repoEntry()] });
  const before = fs.readFileSync(userFile(home), 'utf8');
  assert.deepEqual(clearBound('my-skill', { home }), { ok: true, changed: false });
  assert.equal(fs.readFileSync(userFile(home), 'utf8'), before);
});

test('clearBound never echoes the text of the row it refuses', () => {
  const home = tmp();
  writeUser(home, { schema: 1, entries: [repoEntry({ skillrepo: 'evil/payload', hash: 'zz' })] });
  const r = clearBound('my-skill', { home });
  assert.equal(r.ok, false);
  assert.equal(r.error.includes('evil'), false);
  assert.equal(r.error.includes('payload'), false);
});
