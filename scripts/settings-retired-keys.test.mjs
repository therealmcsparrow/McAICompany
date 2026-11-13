import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Refusal, readLayer, resolveSettings, writeLayer } from './settings.mjs';
import { startServer } from './settings-server.mjs';

// The retired key: stored values are ignored on read with one warning, refused on write.
const KEY = 'blast_radius';
const REFUSED = `mods.${KEY}: unknown key`;
const script = path.join(import.meta.dirname, 'settings.mjs');
const PAGE_FILE = path.join(import.meta.dirname, 'settings-page.html');

const AGENTS = {
  architect: { model: 'opus', effort: 'high', name: 'Ava' },
  qa: { model: 'sonnet', effort: 'medium', name: 'Quinn' }
};
const PROJECT_MD = ['# Project profile', '', 'product_type: web', 'engagement: own', 'audience: the CEO', 'languages: en', 'voice: clear', '', '## Personas', '- (none)', ''].join('\n');

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-retired-'));
  const saved = { MCSPARROW_HOME: process.env.MCSPARROW_HOME, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'repo');
  const pluginRoot = path.join(root, 'plugin');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(cwd, '.company'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.company', 'project.md'), PROJECT_MD);
  process.env.MCSPARROW_HOME = home;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'company'));
  fs.mkdirSync(path.join(pluginRoot, 'skills', 'lead', 'references'), { recursive: true });
  fs.copyFileSync(path.join(import.meta.dirname, '..', 'skills', 'lead', 'references', 'project-template.md'), path.join(pluginRoot, 'skills', 'lead', 'references', 'project-template.md'));
  const names = {};
  for (const [role, a] of Object.entries(AGENTS)) {
    fs.writeFileSync(path.join(pluginRoot, 'agents', `${role}.md`), ['---', `name: ${role}`, `model: ${a.model}`, `effort: ${a.effort}`, '---', ''].join('\n'));
    names[role] = a.name;
  }
  fs.writeFileSync(path.join(pluginRoot, 'company', 'names.json'), JSON.stringify(names));
  fs.writeFileSync(path.join(pluginRoot, 'company', 'model-floor.json'), JSON.stringify({ v: 1, release: '0.16.0', floor: Object.fromEntries(Object.entries(AGENTS).map(([r, a]) => [r, a.model])), protected: ['architect', 'code-reviewer', 'fresh-reviewer', 'pentester', 'security', 'vuln-scanner'] }));
  const ctx = { home, cwd, pluginRoot };
  const config = path.join(home, 'config.json');
  const projectFile = path.join(cwd, '.company', 'settings.json');
  return {
    ...ctx,
    ctx,
    config,
    projectFile,
    file: (level) => (level === 'user' ? config : projectFile),
    put: (level, layer, extra = {}) => fs.writeFileSync(level === 'user' ? config : projectFile, JSON.stringify({ ...extra, aico_settings: { version: 1, ...layer } })),
    putRaw: (level, text) => fs.writeFileSync(level === 'user' ? config : projectFile, text)
  };
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file) : null);
const withoutNoise = (r) => { const { revision, warnings, ...rest } = plain(r); return rest; };
const retiredLine = (r) => r.warnings.filter((w) => w.startsWith(`mods.${KEY}:`));

// Other settings both fixtures carry, so "resolves as before" compares real values.
const BASE_USER = { pipeline: { fix_rounds: 2 }, mods: { savvy: { enabled: false } } };
const BASE_PROJECT = { gates: { plan: 'ask' }, mods: { cache_tax: { pane: 'auto' } } };
const layerWith = (base, value) => ({ ...base, mods: { ...base.mods, [KEY]: value } });

const LEFTOVERS = [
  ['an empty object', {}],
  ['true', true],
  ['a string', 'LEFTOVER-SECRET-VALUE'],
  ['null', null],
  ['an array', [1]],
  ['a full old block', { enabled: false, core: 'warn', contract: 'warn', security: 'LEFTOVER-SECRET-VALUE' }]
];
const LEVEL_SETS = [['user'], ['project'], ['user', 'project']];

// ---------- AC3: a stored leftover resolves as before with one warning ----------
for (const [label, value] of LEFTOVERS) {
  for (const levels of LEVEL_SETS) {
    test(`leftover ${label} in ${levels.join(' and ')}: no throw, get equals the file without it, one warning line`, (t) => {
      const base = sandbox(t);
      base.put('user', BASE_USER);
      base.put('project', BASE_PROJECT);
      const expected = resolveSettings(base.ctx);

      const s = sandbox(t);
      s.put('user', levels.includes('user') ? layerWith(BASE_USER, value) : BASE_USER);
      s.put('project', levels.includes('project') ? layerWith(BASE_PROJECT, value) : BASE_PROJECT);
      let got;
      assert.doesNotThrow(() => { got = resolveSettings(s.ctx); });
      assert.deepEqual(withoutNoise(got), withoutNoise(expected));
      const line = retiredLine(got);
      assert.deepEqual(line, [`mods.${KEY}: ignored, removed in aico 0.37.0 (${levels.join(', ')})`]);
      assert.deepEqual(got.warnings.filter((w) => !w.startsWith(`mods.${KEY}:`)), expected.warnings);
      assert.ok(!JSON.stringify(got.warnings).includes('LEFTOVER-SECRET-VALUE'), 'no stored value is echoed');
      assert.deepEqual(got.ignored, expected.ignored);
    });
  }
}

test('leftover alongside __proto__ and constructor keys: no throw, the other problem still counts, the leftover is not the problem', (t) => {
  const s = sandbox(t);
  s.putRaw('user', `{"aico_settings":{"version":1,"mods":{"${KEY}":{"enabled":false},"__proto__":{"x":1},"constructor":{"y":2}}}}`);
  let got;
  assert.doesNotThrow(() => { got = resolveSettings(s.ctx); });
  assert.equal(retiredLine(got).length, 1);
  assert.equal(({}).x, undefined);
  assert.equal(Object.prototype.y, undefined);
  assert.ok(got.warnings.some((w) => w.includes('mods.__proto__: unknown key')), got.warnings.join(' | '));
  assert.ok(got.warnings.some((w) => w.includes('mods.constructor: unknown key')), got.warnings.join(' | '));

  const base = sandbox(t);
  base.putRaw('user', '{"aico_settings":{"version":1,"mods":{"__proto__":{"x":1},"constructor":{"y":2}}}}');
  assert.deepEqual(withoutNoise(got), withoutNoise(resolveSettings(base.ctx)));
});

test('a case variant of the retired key stays an ordinary unknown key', (t) => {
  const s = sandbox(t);
  s.put('project', { mods: { Blast_Radius: {} } });
  const r = resolveSettings(s.ctx);
  assert.equal(retiredLine(r).length, 0, r.warnings.join(' | '));
  assert.ok(r.warnings.some((w) => w.includes('mods.Blast_Radius: unknown key')), r.warnings.join(' | '));
});

test('a mods value that is not an object keeps its error and gets no retired-key line', (t) => {
  const s = sandbox(t);
  s.put('user', { mods: 'on' });
  const r = resolveSettings(s.ctx);
  assert.ok(r.warnings.some((w) => w.includes('mods: must be an object')), r.warnings.join(' | '));
  assert.equal(retiredLine(r).length, 0);
});

test('CLI get with a leftover exits 0 and prints the settings without the key', (t) => {
  const s = sandbox(t);
  s.put('user', layerWith(BASE_USER, { enabled: false }));
  const r = spawnSync(process.execPath, [script, 'get'], { cwd: s.cwd, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: s.home } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out.mods), ['savvy', 'cache_tax', 'reflect']);
  assert.ok(!r.stdout.includes('LEFTOVER'));
});

test('CLI set keeps refusing: there is no write command', (t) => {
  const s = sandbox(t);
  const r = spawnSync(process.execPath, [script, 'set', `mods.${KEY}.enabled`, 'false'], { cwd: s.cwd, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: s.home } });
  assert.notEqual(r.status, 0);
  assert.equal(read(s.config), null);
});

// ---------- the unlock and fail-closed rules around the leftover ----------
test('a project layer with only the leftover plus a user security unlock keeps lanes unlocked and short_path on', (t) => {
  const s = sandbox(t);
  s.put('user', { unlocked: ['security'], pipeline: { lanes: { security: false, compliance: false } } });
  s.put('project', { mods: { [KEY]: {} } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.lanes.security, false, 'the unlock is not held');
  assert.equal(r.pipeline.lanes.compliance, false);
  assert.equal(r.pipeline.short_path, 'on');
  assert.ok(!r.warnings.some((w) => /held/.test(w)), r.warnings.join(' | '));
  assert.equal(retiredLine(r).length, 1);
});

test('a project layer broken by something else still holds the unlock, with or without the leftover', (t) => {
  const s = sandbox(t);
  s.put('user', { unlocked: ['security', 'ship'], pipeline: { lanes: { security: false } }, gates: { ship: 'auto' } });
  s.put('project', { pipeline: { fix_rounds: 'many' }, mods: { [KEY]: true } });
  const r = resolveSettings(s.ctx);
  assert.equal(r.pipeline.lanes.security, true, 'held on');
  assert.equal(r.gates.ship, 'ask', 'held at ask');
  assert.equal(r.pipeline.short_path, 'off');
  assert.ok(r.warnings.some((w) => /held/.test(w)), r.warnings.join(' | '));
});

// ---------- AC4: a save of another setting works and cleans the file ----------
test('writeLayer of another setting succeeds on a file with the leftover, and the file no longer holds the key', (t) => {
  const s = sandbox(t);
  s.put('user', layerWith(BASE_USER, { enabled: false }), { other_app: { keep: 1 } });
  const { layer } = readLayer('user', s.ctx);
  assert.ok(!Object.hasOwn(layer.mods ?? {}, KEY), 'readLayer drops the key');
  layer.mods.savvy = { enabled: true };
  assert.doesNotThrow(() => writeLayer('user', layer, s.ctx));
  const text = fs.readFileSync(s.config, 'utf8');
  assert.ok(!text.includes(KEY), text);
  const data = JSON.parse(text);
  assert.deepEqual(data.other_app, { keep: 1 });
  assert.equal(data.aico_settings.mods.savvy.enabled, true);
  assert.equal(data.aico_settings.pipeline.fix_rounds, 2);
  assert.equal(retiredLine(resolveSettings(s.ctx)).length, 0);
});

test('writeLayer at the project level also cleans the leftover', (t) => {
  const s = sandbox(t);
  s.put('project', layerWith(BASE_PROJECT, { core: 'ask' }));
  const { layer } = readLayer('project', s.ctx);
  layer.gates = { plan: 'ask', brief: 'ask' };
  writeLayer('project', layer, s.ctx);
  assert.ok(!fs.readFileSync(s.projectFile, 'utf8').includes(KEY));
});

// ---------- AC5: setting the key is refused, nothing written ----------
const WRITES = [{}, { enabled: false }, { core: 'warn' }, { security: 'warn', contract: 'warn' }, true, null, 'x', [1]];

test('writeLayer refuses mods.<retired key> in any shape and leaves the file byte-identical', (t) => {
  for (const level of ['user', 'project']) {
    const s = sandbox(t);
    s.put(level, BASE_USER);
    const before = read(s.file(level));
    for (const value of WRITES) {
      assert.throws(
        () => writeLayer(level, { version: 1, mods: { [KEY]: value } }, s.ctx),
        (e) => e instanceof Refusal && e.message === REFUSED,
        `${level} ${JSON.stringify(value)}`
      );
      assert.deepEqual(read(s.file(level)), before);
    }
    const absent = sandbox(t);
    assert.throws(() => writeLayer(level, { version: 1, mods: { [KEY]: { enabled: false } } }, absent.ctx), (e) => e instanceof Refusal && e.message === REFUSED);
    assert.equal(read(absent.file(level)), null, 'no file is created');
  }
});

test('writeLayer refuses the retired key beside a valid change and writes neither', (t) => {
  const s = sandbox(t);
  s.put('user', BASE_USER);
  const before = read(s.config);
  assert.throws(() => writeLayer('user', { version: 1, mods: { savvy: { enabled: true }, [KEY]: { core: 'warn' } } }, s.ctx), (e) => e instanceof Refusal && e.message.includes(REFUSED));
  assert.deepEqual(read(s.config), before);
});

// ---------- server POST (AC4 and AC5) ----------
async function start(t, s) {
  const server = await startServer({ ...s.ctx, open: false, log: () => {} });
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.port}`;
  const api = (p, init = {}) => fetch(`${origin}${p}`, { ...init, headers: { 'X-Aico-Token': server.token, ...init.headers } });
  const post = (body) => api('/api/save', { method: 'POST', body: JSON.stringify(body), headers: { Origin: origin, 'Content-Type': 'application/json' } });
  const state = async () => (await api('/api/state')).json();
  return { post, state };
}

test('POST /api/save of another setting succeeds on a file with the leftover and cleans it', async (t) => {
  const s = sandbox(t);
  s.put('user', layerWith(BASE_USER, { enabled: false }));
  s.put('project', layerWith(BASE_PROJECT, true));
  const { post, state } = await start(t, s);
  const before = await state();
  assert.ok(!JSON.stringify(before.user ?? {}).includes(KEY));
  const res = await post({
    revision: before.resolved.revision,
    user: { version: 1, mods: { savvy: { enabled: true } } },
    project: { version: 1, gates: { plan: 'ask' } }
  });
  assert.equal(res.status, 200);
  assert.ok(!fs.readFileSync(s.config, 'utf8').includes(KEY));
  assert.ok(!fs.readFileSync(s.projectFile, 'utf8').includes(KEY));
});

test('POST /api/save with the retired key is refused with 400 and both files stay byte-identical', async (t) => {
  const s = sandbox(t);
  s.put('user', BASE_USER);
  s.put('project', BASE_PROJECT);
  const { post, state } = await start(t, s);
  const before = await state();
  const files = [read(s.config), read(s.projectFile)];
  for (const level of ['user', 'project']) {
    for (const value of [{ enabled: false }, {}, true, null]) {
      const res = await post({ revision: before.resolved.revision, [level]: { version: 1, mods: { [KEY]: value } } });
      assert.equal(res.status, 400, `${level} ${JSON.stringify(value)}`);
      const { refused } = await res.json();
      assert.ok(refused.some((r) => r.includes(REFUSED)), refused.join(' | '));
      assert.deepEqual([read(s.config), read(s.projectFile)], files);
    }
  }
});

// ---------- AC6: the page ----------
test('the settings page carries no commit-gate section, control, lock note or dialog text', () => {
  const html = fs.readFileSync(PAGE_FILE, 'utf8');
  assert.ok(!/blast/i.test(html), 'no Blast Radius text');
  assert.ok(!html.includes('Loosen the commit gate'));
  assert.ok(!/commit gate/i.test(html));
  assert.ok(!html.includes('aico will let commits that touch security paths'));
});
