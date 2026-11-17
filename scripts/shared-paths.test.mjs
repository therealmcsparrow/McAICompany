// Tests for the shared path and rule-ID modules: hostile paths and the shared module. Pinned shape of normalizePath:
//   normalizePath(raw) -> string: '/' separators, lower case, '.' and '..' resolved ('..' kept only at the start of a
//   relative path, dropped at the root), trailing dots and spaces trimmed per segment, stream suffix (':name', '::$DATA')
//   cut from the last segment, '\\?\' and '\\.\' prefixes dropped, UNC root '//server/share' and a drive 'c:' kept. Non-string -> ''.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const pathsFile = path.join(root, 'hooks', 'lib', 'paths.mjs');
const idFile = path.join(root, 'hooks', 'lib', 'rule-id.mjs');
const load = f => import(pathToFileURL(f).href);

test('AC20: hooks/lib/paths.mjs and rule-id.mjs exist and are pure (no import)', () => {
  for (const f of [pathsFile, idFile]) {
    assert.ok(fs.existsSync(f), `${f} missing`);
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /^\s*import\s|\brequire\(|\bimport\(/m, `${path.basename(f)} must not import`);
  }
});

test('AC20: paths.mjs exports normalizePath, trimAlias, isDeviceName', async () => {
  const m = await load(pathsFile);
  for (const n of ['normalizePath', 'trimAlias', 'isDeviceName']) assert.equal(typeof m[n], 'function', n);
});

test('AC6: trimAlias strips trailing dots and spaces, keeps an all-dot segment', async () => {
  const { trimAlias } = await load(pathsFile);
  assert.equal(trimAlias('.env.'), '.env');
  assert.equal(trimAlias('.env . .'), '.env');
  assert.equal(trimAlias('..'), '..');
  assert.equal(trimAlias('a'), 'a');
});

test('AC6: isDeviceName catches device names with extension, dots and spaces', async () => {
  const { isDeviceName } = await load(pathsFile);
  for (const s of ['con', 'NUL', 'com1', 'LPT9', 'aux.txt', 'nul.', 'prn .x', 'CON.tar.gz']) assert.equal(isDeviceName(s), true, s);
  for (const s of ['console', 'com0', 'lpt10', 'a.con', '.env', 'readme']) assert.equal(isDeviceName(s), false, s);
});

const HOSTILE = [
  ['case', '.ENV', '.env'],
  ['case in dir', 'Src/.Env', 'src/.env'],
  ['backslash', 'a\\b\\.env', 'a/b/.env'],
  ['mixed slashes', 'a/b\\.env', 'a/b/.env'],
  ['relative dot', './sub/../.env', '.env'],
  ['relative dotdot kept', '../.env', '../.env'],
  ['dotdot above root dropped', '/a/../../.env', '/.env'],
  ['double slash', 'a//b///.env', 'a/b/.env'],
  ['drive letter', 'C:\\proj\\.env', 'c:/proj/.env'],
  ['drive letter lower, forward', 'c:/proj/./.env', 'c:/proj/.env'],
  ['UNC', '\\\\server\\share\\dir\\.env', '//server/share/dir/.env'],
  ['UNC forward', '//Server/Share/.ENV', '//server/share/.env'],
  ['device prefix ?', '\\\\?\\C:\\proj\\.env', 'c:/proj/.env'],
  ['device prefix .', '\\\\.\\C:\\proj\\.env', 'c:/proj/.env'],
  ['8.3 shape kept, case folded', 'C:\\PROGRA~1\\App\\.ENV', 'c:/progra~1/app/.env'],
  ['8.3 shape of .env', 'ENV~1', 'env~1'],
  ['stream suffix', '.env::$DATA', '.env'],
  ['named stream', '.env:secret', '.env'],
  ['stream in dir path', 'a/.env:x:$DATA', 'a/.env'],
  ['trailing dot', '.env.', '.env'],
  ['trailing dots', '.env...', '.env'],
  ['trailing space', '.env ', '.env'],
  ['trailing dot space mix', '.env. . ', '.env'],
  ['dir trailing dot', 'a./.env', 'a/.env'],
  ['plain stays', 'src/index.mjs', 'src/index.mjs'],
  ['.env.example stays distinct', 'x/.ENV.Example', 'x/.env.example']
];
for (const [name, input, want] of HOSTILE) {
  test(`AC6: normalizePath ${name}: ${JSON.stringify(input)}`, async () => {
    const { normalizePath } = await load(pathsFile);
    assert.equal(normalizePath(input), want);
  });
}

test('AC6: normalizePath is idempotent on every hostile case', async () => {
  const { normalizePath } = await load(pathsFile);
  for (const [, input] of HOSTILE) {
    const once = normalizePath(input);
    assert.equal(normalizePath(once), once, input);
  }
});

test('AC6: normalizePath returns an empty string for non-strings and does not throw', async () => {
  const { normalizePath } = await load(pathsFile);
  for (const v of [null, undefined, 5, {}, []]) assert.equal(normalizePath(v), '');
  assert.equal(normalizePath(''), '');
});

test('AC20: rule-id.mjs exports the rule-check grammar RULE_ID (anchored) and RULE_ID_ANY (global)', async () => {
  const { RULE_ID, RULE_ID_ANY } = await load(idFile);
  assert.ok(RULE_ID instanceof RegExp && RULE_ID_ANY instanceof RegExp);
  for (const id of ['cap.M1', 'dotenv.M-SEC1', 'model-floor.M1', 'self-protect.M-SEC1', 'browser.Y1', 'a.S12']) assert.ok(RULE_ID.test(id), id);
  for (const id of ['Cap.M1', 'cap.M', 'cap.X1', 'cap.m1', '1cap.M1', 'cap M1', `${'a'.repeat(25)}.M1`, 'cap.M1 ', ' cap.M1']) assert.equal(RULE_ID.test(id), false, id);
  assert.equal(RULE_ID.global, false);
  assert.equal(RULE_ID_ANY.global, true);
  assert.deepEqual('see cap.M1 and dotenv.M-SEC1, not Cap.M1'.match(RULE_ID_ANY), ['cap.M1', 'dotenv.M-SEC1']);
});

test('AC20: the scripts import the shared modules and no longer define the logic', () => {
  const lint = fs.readFileSync(path.join(root, 'scripts', 'handoff-lint.mjs'), 'utf8');
  const rc = fs.readFileSync(path.join(root, 'scripts', 'rule-check.mjs'), 'utf8');
  assert.match(lint, /from '\.\.\/hooks\/lib\/paths\.mjs'/);
  assert.doesNotMatch(lint, /^function (trimAlias|isDeviceName)\b/m);
  assert.match(rc, /from '\.\.\/hooks\/lib\/rule-id\.mjs'/);
  assert.doesNotMatch(rc, /^const RULE_ID(_ANY)? = /m);
});
