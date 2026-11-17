import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// aico-settings v3.0 (planned): `settings.mjs set-mod <id> on|off` and `set-mod switchboard seen`.
// Covers: guards have no switch, switches are written only through settings.
const here = import.meta.dirname;
const script = path.join(here, 'settings.mjs');
const manifestDir = path.join(here, '..', 'hooks', 'manifests');

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'set-mod-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'repo');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(cwd, '.company'), { recursive: true });
  const config = path.join(home, 'config.json');
  const projectFile = path.join(cwd, '.company', 'settings.json');
  return {
    home, cwd, config, projectFile,
    user: (layer, extra = {}) => fs.writeFileSync(config, JSON.stringify({ ...extra, aico_settings: { version: 1, ...layer } })),
    project: (layer) => fs.writeFileSync(projectFile, JSON.stringify({ aico_settings: { version: 1, ...layer } })),
    cli: (...args) => {
      const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home } });
      return { code: r.status, out: r.stdout, err: r.stderr };
    },
    stored: () => (fs.existsSync(config) ? JSON.parse(fs.readFileSync(config, 'utf8')) : null)
  };
}

const manifests = () => {
  assert.ok(fs.existsSync(manifestDir), 'hooks/manifests exists (mod-manifest v1)');
  return fs.readdirSync(manifestDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(manifestDir, f), 'utf8')));
};
const keyOf = (id) => `mods.${id.replaceAll('-', '_')}.enabled`;

test('set-mod savings off writes exactly one user key, prints the line and exits 0', (t) => {
  const s = sandbox(t);
  const r = s.cli('set-mod', 'savings', 'off');
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.out, 'set mods.savings.enabled false\n');
  assert.deepEqual(s.stored().aico_settings, { version: 1, mods: { savings: { enabled: false } } });
  assert.equal(fs.existsSync(s.projectFile), false, 'the project file is never written');
  assert.equal(s.cli('get', 'mods.savings.enabled').out, 'false\n');
});

test('set-mod on flips it back; other stored keys and other config.json keys are kept', (t) => {
  const s = sandbox(t);
  s.user({ gates: { brief: 'ask' }, mods: { savings: { enabled: false }, savvy: { pane: 'command' } } }, { aico_language: 'nl' });
  const r = s.cli('set-mod', 'savings', 'on');
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.out, 'set mods.savings.enabled true\n');
  const stored = s.stored();
  assert.equal(stored.aico_language, 'nl');
  assert.deepEqual(stored.aico_settings, { version: 1, gates: { brief: 'ask' }, mods: { savings: { enabled: true }, savvy: { pane: 'command' } } });
});

test('every saver manifest id with a switch is accepted and writes its own key; the key is mods.<id_with_underscores>.enabled', (t) => {
  const SWITCHABLE = ['cache-tax', 'efficient-browser-use', 'savings', 'switchboard'];
  const savers = manifests().filter((m) => m.kind === 'saver' && m.switch && SWITCHABLE.includes(m.id));
  const ids = savers.map((m) => m.id).sort();
  for (const must of ['cache-tax', 'efficient-browser-use', 'savings', 'switchboard']) assert.ok(ids.includes(must), `saver manifest ${must}`);
  for (const m of savers) {
    assert.equal(m.switch, keyOf(m.id), m.id);
    const s = sandbox(t);
    const r = s.cli('set-mod', m.id, 'on');
    assert.equal(r.code, 0, `${m.id}: ${r.out}${r.err}`);
    assert.equal(r.out, `set ${m.switch} true\n`);
    const [, k] = m.switch.split('.');
    assert.deepEqual(s.stored().aico_settings.mods[k], { enabled: true }, m.id);
  }
  const s = sandbox(t);
  const r = s.cli('set-mod', 'reflect', 'on');
  assert.equal(r.code, 2, 'reflect is switched on the settings page, not by set-mod');
  assert.equal(r.out, 'refused: reflect cannot be switched\n');
  assert.equal(fs.existsSync(s.config), false);
});

test('AC15: a guard or gate id is refused as not switchable, exit 2, nothing written', (t) => {
  const locked = manifests().filter((m) => m.kind === 'guard' || m.kind === 'gate');
  for (const id of ['cap', 'dotenv', 'model-floor', 'self-protect']) assert.ok(locked.some((m) => m.id === id), `guard manifest ${id}`);
  assert.ok(!locked.some((m) => m.id === 'git-add'), 'git-add guard is gone (ADR 0079)');
  for (const m of locked) {
    for (const word of ['on', 'off']) {
      const s = sandbox(t);
      const r = s.cli('set-mod', m.id, word);
      assert.equal(r.code, 2, m.id);
      assert.equal(r.out, `refused: ${m.id} cannot be switched\n`);
      assert.equal(fs.existsSync(s.config), false, `${m.id}: nothing written`);
      assert.equal(fs.existsSync(s.projectFile), false);
    }
  }
});

test('an unknown id, a path-like id or another word is refused, exit 2, nothing written', (t) => {
  for (const [id, word] of [['nope', 'on'], ['__proto__', 'off'], ['../savings', 'on'], ['SAVINGS', 'on'], ['savings', 'maybe'], ['savings', 'ON'], ['savings', 'true'], ['guards', 'off']]) {
    const s = sandbox(t);
    const r = s.cli('set-mod', id, word);
    assert.equal(r.code, 2, `${id} ${word}`);
    assert.match(r.out, /^refused: /, `${id} ${word}`);
    assert.equal(fs.existsSync(s.config), false, `${id} ${word}: nothing written`);
  }
  const s = sandbox(t);
  assert.equal(s.cli('set-mod', 'nope', 'on').out, 'refused: nope cannot be switched\n');
});

test('R-15: a key the project layer sets is refused with the project file named, exit 2, user file byte-identical', (t) => {
  for (const value of [false, true]) {
    const s = sandbox(t);
    s.user({ gates: { brief: 'ask' } });
    s.project({ mods: { savings: { enabled: value } } });
    const before = fs.readFileSync(s.config);
    const projectBefore = fs.readFileSync(s.projectFile);
    const r = s.cli('set-mod', 'savings', 'off');
    assert.equal(r.code, 2);
    assert.equal(r.out, 'refused: savings is set in .company/settings.json\n');
    assert.deepEqual(fs.readFileSync(s.config), before, 'user file untouched');
    assert.deepEqual(fs.readFileSync(s.projectFile), projectBefore, 'project file untouched');
  }
  const none = sandbox(t);
  none.project({ mods: { savings: { enabled: false } } });
  assert.equal(none.cli('set-mod', 'savings', 'on').code, 2);
  assert.equal(fs.existsSync(none.config), false, 'no user file is created either');
});

test('R-15: a project value on another saver does not block this one', (t) => {
  const s = sandbox(t);
  s.project({ mods: { savings: { enabled: false } } });
  const r = s.cli('set-mod', 'efficient-browser-use', 'on');
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.out, 'set mods.efficient_browser_use.enabled true\n');
  assert.equal(s.cli('get', 'mods.efficient_browser_use.enabled').out, 'true\n');
});

test('set-mod switchboard seen writes user mods.switchboard.seen true and exits 0', (t) => {
  const s = sandbox(t);
  assert.equal(s.cli('get', 'mods.switchboard.seen').out, 'false\n');
  const r = s.cli('set-mod', 'switchboard', 'seen');
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.out, 'set mods.switchboard.seen true\n');
  assert.deepEqual(s.stored().aico_settings, { version: 1, mods: { switchboard: { seen: true } } });
  assert.equal(s.cli('get', 'mods.switchboard.seen').out, 'true\n');
  const again = s.cli('set-mod', 'switchboard', 'seen');
  assert.equal(again.code, 0);
  assert.deepEqual(s.stored().aico_settings.mods.switchboard, { seen: true }, 'idempotent');
});

test('set-mod switchboard seen keeps mods.switchboard.enabled and ignores a project seen value', (t) => {
  const s = sandbox(t);
  s.user({ mods: { switchboard: { enabled: false } } });
  s.project({ mods: { switchboard: { seen: false } } });
  const r = s.cli('set-mod', 'switchboard', 'seen');
  assert.equal(r.code, 0, 'a project seen is ignored, so it never blocks the user write: ' + r.out + r.err);
  assert.deepEqual(s.stored().aico_settings.mods.switchboard, { enabled: false, seen: true });
  assert.equal(s.cli('get', 'mods.switchboard.seen').out, 'true\n');
  s.project({ mods: { switchboard: { seen: false, enabled: true } } });
  const blocked = s.cli('set-mod', 'switchboard', 'off');
  assert.equal(blocked.code, 2);
  assert.equal(blocked.out, 'refused: switchboard is set in .company/settings.json\n');
});

test('seen belongs to the switchboard only: set-mod savings seen is refused, nothing written', (t) => {
  const s = sandbox(t);
  const r = s.cli('set-mod', 'savings', 'seen');
  assert.equal(r.code, 2);
  assert.match(r.out, /^refused: /);
  assert.doesNotMatch(r.out, /usage/, 'refused by set-mod itself, not as an unknown command');
  assert.equal(fs.existsSync(s.config), false);
});

test('a write is atomic: no temp file is left beside config.json and it stays valid JSON', (t) => {
  const s = sandbox(t);
  for (const word of ['off', 'on', 'off']) assert.equal(s.cli('set-mod', 'savings', word).code, 0);
  assert.deepEqual(fs.readdirSync(s.home), ['config.json']);
  assert.equal(s.stored().aico_settings.mods.savings.enabled, false);
});

test('a broken user file is not overwritten: set-mod refuses and leaves it as it was', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.config, '{ not json');
  const r = s.cli('set-mod', 'savings', 'off');
  assert.equal(r.code, 2);
  assert.match(r.out, /^refused: /);
  assert.doesNotMatch(r.out, /usage/, 'refused by set-mod itself, not as an unknown command');
  assert.equal(fs.readFileSync(s.config, 'utf8'), '{ not json');
});

test('AC23: no switches.json is read or written, and the Switchboard mod writes only through settings', (t) => {
  const s = sandbox(t);
  assert.equal(s.cli('set-mod', 'savings', 'off').code, 0);
  assert.deepEqual(fs.readdirSync(s.home), ['config.json']);
  const mod = path.join(here, '..', 'mods', 'switchboard.tsx');
  assert.ok(fs.existsSync(mod), 'mods/switchboard.tsx exists');
  const text = fs.readFileSync(mod, 'utf8');
  assert.ok(!text.includes('switches.json'), 'no switches.json');
  assert.ok(!/writeFile|appendFile|renameSync|createWriteStream/.test(text), 'the mod holds no file write of its own');
  assert.ok(text.includes('set-mod'), 'the toggle goes through settings.mjs set-mod');
  for (const f of ['settings.mjs', 'settings-server.mjs']) assert.ok(!fs.readFileSync(path.join(here, f), 'utf8').includes('switches.json'), f);
});
