// The engine loads scripts after the pins check; every file those scripts import is pinned too.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEP_ENTRIES, depClosure, verifyDeps } from '../hooks/lib/dep-pins.mjs';
import { DEP_HASHES } from '../hooks/lib/dep-hashes.mjs';
import { MODS_DEFAULTS } from '../hooks/lib/mods-defaults.mjs';
import { MODS_DEFAULTS as SETTINGS_DEFAULTS } from './settings.mjs';
import { main } from './hook-pins.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

function copyRoot() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-pins-'));
  for (const d of ['scripts', 'mods/lib', 'hooks/lib', 'hooks/rules', 'hooks/manifests', 'hooks/schema', 'company']) {
    if (!fs.existsSync(path.join(REPO, d))) continue;
    fs.cpSync(path.join(REPO, d), path.join(t, d), { recursive: true, filter: (s) => !/\.test\./.test(s) });
  }
  for (const f of ['hooks/rules.json', 'hooks/hooks.json', 'hooks/pins.json']) fs.copyFileSync(path.join(REPO, f), path.join(t, f));
  return t;
}

test('the closure holds the run scripts and their imports, inside the plugin root', () => {
  const { files, bad } = depClosure(REPO);
  assert.deepEqual(bad, []);
  for (const rel of [...DEP_ENTRIES, 'scripts/run-cap.mjs', 'scripts/handoff-lint.mjs', 'mods/lib/work-folder.mjs']) assert.ok(files.includes(rel), rel);
  assert.ok(files.every((rel) => !rel.startsWith('hooks/lib/') && !rel.startsWith('..')));
});

test('the recorded hashes match the files on disk', () => {
  assert.deepEqual(verifyDeps(REPO), []);
  assert.deepEqual(Object.keys(DEP_HASHES), depClosure(REPO).files);
});

test('a changed transitive script fails the check, naming it', () => {
  const t = copyRoot();
  fs.appendFileSync(path.join(t, 'scripts/run-cap.mjs'), '\n// edit\n');
  assert.deepEqual(verifyDeps(t), ['scripts/run-cap.mjs']);
});

test('a changed entry, a missing file and a new import all fail', () => {
  const t = copyRoot();
  fs.appendFileSync(path.join(t, 'scripts/lead-handover.mjs'), "\nimport './extra-dep.mjs';\n");
  fs.writeFileSync(path.join(t, 'scripts/extra-dep.mjs'), 'export {};\n');
  fs.rmSync(path.join(t, 'mods/lib/work-folder.mjs'));
  const bad = verifyDeps(t);
  for (const rel of ['scripts/lead-handover.mjs', 'scripts/extra-dep.mjs', 'mods/lib/work-folder.mjs']) assert.ok(bad.includes(rel), `${rel} in ${bad}`);
});

test('hook-pins write records the dependency hashes and check passes', () => {
  const t = copyRoot();
  fs.writeFileSync(path.join(t, 'hooks/lib/dep-hashes.mjs'), 'export const DEP_HASHES = {};\n');
  fs.appendFileSync(path.join(t, 'scripts/run-cap.mjs'), '\n// edit\n');
  assert.equal(main(['write', '--root', t]).code, 0);
  assert.equal(main(['check', '--root', t]).code, 0);
  assert.match(fs.readFileSync(path.join(t, 'hooks/lib/dep-hashes.mjs'), 'utf8'), /scripts\/run-cap\.mjs/);
  fs.appendFileSync(path.join(t, 'scripts/run-state.mjs'), '\n// edit\n');
  const r = main(['check', '--root', t]);
  assert.equal(r.code, 1);
  assert.match(r.out, /pins-mismatch: .*scripts\/run-state\.mjs/);
});

test('the engine libs import no script outside the pinned set directly', () => {
  assert.doesNotMatch(read('hooks/lib/snapshot.mjs'), /scripts\//);
  assert.doesNotMatch(read('hooks/lib/cap-effects.mjs'), /import\('\.\.\/\.\.\/scripts/);
});

test('the snapshot default table is the one settings re-exports', () => {
  assert.equal(SETTINGS_DEFAULTS, MODS_DEFAULTS);
});
