// QA-first tests for T28 (run-state v3.1, AC4): `run-state gate <slug> <g> passed` with no CEO answer is written only when the
// RESOLVED settings (settings.mjs: project over user, ship auto needs the user unlock, held at ask on project problems) say `auto`.
// The Lead snapshot (lead.json) is never read. Any settings error reads as not auto. No form answer is written in any case below.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '..', '..', 'scripts', 'run-state.mjs');
const ID = 'P20261117.000001';
const SLUG = `${ID}/01-feature`;

const tmps = [];
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const START = iso(Math.floor((Date.now() - 3600000) / 1000) * 1000);

// One home per test: user settings live in <home>/.mcsparrow/config.json.
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-auto-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-auto-'));
  tmps.push(home, root);
  const mcs = path.join(home, '.mcsparrow');
  fs.mkdirSync(mcs, { recursive: true });
  const dir = path.join(root, '.company', 'work', ID, '01-feature');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', ID, '00-project.md'), 'Demo project\n');
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: START, ev: 'start' })}\n`);
  const env = { ...process.env, MCSPARROW_HOME: mcs, HOME: home, USERPROFILE: home };
  delete env.AICO_GUARDS;
  return { home, root, dir, mcs, env };
}
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const userSettings = (fx, body) => fs.writeFileSync(path.join(fx.mcs, 'config.json'), typeof body === 'string' ? body : JSON.stringify({ aico_settings: { version: 1, ...body } }));
const projectSettings = (fx, body) => fs.writeFileSync(path.join(fx.root, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, ...body } }));
const leadJson = (fx, gates) => {
  const key = createHash('sha256').update(fs.realpathSync(fx.root)).digest('hex').slice(0, 12);
  const dir = path.join(fx.mcs, 'hook-snapshots', key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'lead.json'), JSON.stringify({ v: 1, at: START, threshold: 180000, savers: {}, floor: {}, drift: false, settingsWarnings: [], gates }));
};

const rows = (fx) => fs.readFileSync(path.join(fx.dir, 'run-state.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
function gate(fx, g) {
  const r = spawnSync(process.execPath, [SCRIPT, 'gate', SLUG, g, 'passed'], { cwd: fx.root, env: fx.env, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: r.stderr ?? '' };
}
function assertWritten(fx, g) {
  const r = gate(fx, g);
  assert.equal(r.out, `ok: gate ${g} passed`, `out: ${r.out} ${r.err}`);
  assert.equal(r.code, 0);
  const last = rows(fx).at(-1);
  assert.deepEqual([last.ev, last.gate, last.result], ['gate', g, 'passed']);
}
function assertRefused(fx, g) {
  const before = rows(fx).length;
  const r = gate(fx, g);
  assert.equal(r.out, `refused: no CEO answer for ${g}`, `out: ${r.out} ${r.err}`);
  assert.equal(r.code, 2);
  assert.equal(rows(fx).length, before, 'a refused gate writes nothing');
}

test('AC4 user config gates.brief auto, no lead.json: gate brief passed is written without an answer', () => {
  const fx = fixture();
  userSettings(fx, { gates: { brief: 'auto' } });
  assertWritten(fx, 'brief');
});

test('AC4 lead.json says ship auto but the settings say ask: refused, the snapshot is not read', () => {
  const fx = fixture();
  userSettings(fx, { gates: { ship: 'ask' } });
  leadJson(fx, { ship: 'auto' });
  assertRefused(fx, 'ship');
});

test('AC4 user ship auto without unlocked ship (locked): refused', () => {
  const fx = fixture();
  userSettings(fx, { gates: { ship: 'auto' } });
  assertRefused(fx, 'ship');
});

test('AC4 user ship auto plus unlock, project settings with an invalid field (held): refused', () => {
  const fx = fixture();
  userSettings(fx, { gates: { ship: 'auto' }, unlocked: ['ship'] });
  projectSettings(fx, { gates: { plan: 'sometimes' } });
  assertRefused(fx, 'ship');
});

test('AC4 user ship auto plus unlock, valid settings: written (control for the held case)', () => {
  const fx = fixture();
  userSettings(fx, { gates: { ship: 'auto' }, unlocked: ['ship'] });
  assertWritten(fx, 'ship');
});

test('AC4 project gates.brief auto over user ask: written (project wins)', () => {
  const fx = fixture();
  userSettings(fx, { gates: { brief: 'ask' } });
  projectSettings(fx, { gates: { brief: 'auto' } });
  assertWritten(fx, 'brief');
});

test('AC4 user config.json that is not valid JSON: refused (any error reads as not auto)', () => {
  const fx = fixture();
  userSettings(fx, '{ "aico_settings": { "gates": ');
  assertRefused(fx, 'brief');
});

test('AC4 auto is per Gate: brief auto leaves plan refused', () => {
  const fx = fixture();
  userSettings(fx, { gates: { brief: 'auto' } });
  assertRefused(fx, 'plan');
});

test('AC4 source scan: run-state.mjs has no import of settings.mjs (static or dynamic) and no leadFile', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(src, /import\s[^;]*?['"][^'"]*settings\.mjs['"]/);
  assert.doesNotMatch(src, /import\s*\(\s*['"`][^'"`]*settings\.mjs/);
  assert.doesNotMatch(src, /\bleadFile\b/);
});
