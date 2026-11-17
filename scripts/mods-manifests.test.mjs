// Every mod file has one valid manifest (mod-manifest v1).
// Mapping: mods/<id>.ts|tsx -> hooks/manifests/<id>.json; mods/shared/ and mods/lib/ are exempt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestDir = path.join(root, 'hooks', 'manifests');
const modsDir = path.join(root, 'mods');

const EVENTS = ['PreToolUse', 'SessionStart', 'SubagentStart', 'SubagentStop'];
const KEYS = ['v', 'id', 'kind', 'title', 'owner', 'sessions', 'events', 'rules', 'fail', 'switch', 'lock', 'upstream'];
const RULE_ID = /^[a-z][a-z0-9-]{0,23}\.(M-SEC|M|S|Y)\d+$/;

const modIds = () =>
  fs.readdirSync(modsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => e.name.replace(/\.tsx?$/, ''))
    .sort();
const load = (id) => JSON.parse(fs.readFileSync(path.join(manifestDir, `${id}.json`), 'utf8'));
const manifestFiles = () => fs.readdirSync(manifestDir).filter((f) => f.endsWith('.json')).sort();

// Returns a list of problems; empty means valid (allow-list shape and the kind rows).
function problems(m, fileId) {
  const p = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['not an object'];
  for (const k of Object.keys(m)) if (!KEYS.includes(k)) p.push(`unknown key ${k}`);
  for (const k of KEYS) if (!Object.hasOwn(m, k)) p.push(`missing key ${k}`);
  if (p.length) return p;
  if (m.v !== 1) p.push('v');
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(m.id) || m.id !== fileId) p.push('id');
  if (typeof m.title !== 'string' || m.title.length < 1 || m.title.length > 60 || /[^\x20-\x7e]/.test(m.title)) p.push('title');
  if (typeof m.owner !== 'string' || !m.owner) p.push('owner');
  if (!Array.isArray(m.events) || m.events.some((e) => !EVENTS.includes(e))) p.push('events');
  if (!Array.isArray(m.rules) || m.rules.some((r) => !RULE_ID.test(r))) p.push('rules');
  if (typeof m.lock !== 'boolean') p.push('lock type');
  if (m.upstream !== null && (typeof m.upstream !== 'object' || !m.upstream.name || !m.upstream.version || !('licence' in m.upstream))) p.push('upstream');
  const row = {
    guard: { sessions: 'all', fail: 'closed', lock: true },
    gate: { sessions: 'lead', fail: 'closed', lock: true },
    saver: { sessions: 'lead', fail: 'open', lock: false }
  }[m.kind];
  if (!row) return [...p, 'kind'];
  for (const [k, v] of Object.entries(row)) if (m[k] !== v) p.push(`${m.kind} needs ${k}=${v}`);
  if (m.kind === 'saver') {
    if (m.switch !== `mods.${m.id.replace(/-/g, '_')}.enabled`) p.push('saver switch');
  } else if (m.switch !== null) p.push('switch must be null');
  if (m.kind === 'guard' && m.rules.length < 1) p.push('guard needs a rule');
  if (m.events.length === 0 && !(m.kind === 'saver' && m.rules.length === 0)) p.push('empty events only for a view-only saver');
  return p;
}

test('AC2: the validator rejects bad manifests (self-check of the test)', () => {
  const good = load('dotenv');
  assert.deepEqual(problems(good, 'dotenv'), []);
  assert.notDeepEqual(problems({ ...good, extra: 1 }, 'dotenv'), []);
  assert.notDeepEqual(problems({ ...good, fail: 'open' }, 'dotenv'), []);
  assert.notDeepEqual(problems({ ...good, id: 'other' }, 'dotenv'), []);
  const { title, ...noTitle } = good;
  assert.notDeepEqual(problems(noTitle, 'dotenv'), []);
});

test('AC2: there is at least one mod file to check', () => {
  assert.ok(modIds().length >= 6, `mods found: ${modIds().join(', ')}`);
});

for (const id of ['cache-tax', 'fresh-step', 'plan-gate', 'reflect', 'reprompt-gate', 'savvy', 'switchboard', 'savings']) {
  test(`AC2: mod ${id} has a valid manifest hooks/manifests/${id}.json`, () => {
    const f = path.join(manifestDir, `${id}.json`);
    assert.ok(fs.existsSync(f), `missing hooks/manifests/${id}.json`);
    assert.deepEqual(problems(load(id), id), []);
  });
}

test('AC2: every mods/<id>.ts(x) file maps to a valid manifest (mods/shared and mods/lib exempt)', () => {
  const bad = [];
  for (const id of modIds()) {
    const f = path.join(manifestDir, `${id}.json`);
    if (!fs.existsSync(f)) { bad.push(`${id}: no manifest`); continue; }
    const pr = problems(load(id), id);
    if (pr.length) bad.push(`${id}: ${pr.join(', ')}`);
  }
  assert.deepEqual(bad, []);
});

test('AC2: the release 1 mod files switchboard and savings exist', () => {
  for (const id of ['switchboard', 'savings']) {
    assert.ok(modIds().includes(id), `mods/${id}.ts(x) missing`);
  }
});

test('AC2: shared and lib code needs no manifest (none is required or shipped for it)', () => {
  assert.ok(!fs.existsSync(path.join(manifestDir, 'shell.json')));
  assert.ok(!fs.existsSync(path.join(manifestDir, 'settings.json')));
  assert.ok(!fs.existsSync(path.join(manifestDir, 'shared.json')));
  assert.ok(!fs.existsSync(path.join(manifestDir, 'lib.json')));
});

test('AC2: every manifest file is valid and unique by id and rule ID', () => {
  const seen = new Map();
  const bad = [];
  for (const f of manifestFiles()) {
    const id = f.replace(/\.json$/, '');
    const m = load(id);
    const pr = problems(m, id);
    if (pr.length) bad.push(`${f}: ${pr.join(', ')}`);
    for (const r of m.rules ?? []) {
      if (seen.has(r)) bad.push(`rule ${r} in ${seen.get(r)} and ${id}`);
      seen.set(r, id);
    }
  }
  assert.deepEqual(bad, []);
});

test('AC2: kinds of the release 1 manifests', () => {
  const kinds = {
    cap: 'guard', 'self-protect': 'guard', dotenv: 'guard', 'model-floor': 'guard',
    'cache-tax': 'saver', savvy: 'saver', reflect: 'saver', 'efficient-browser-use': 'saver', switchboard: 'saver', savings: 'saver',
    'plan-gate': 'gate', 'fresh-step': 'gate', 'reprompt-gate': 'gate'
  };
  const bad = [];
  for (const [id, kind] of Object.entries(kinds)) {
    const f = path.join(manifestDir, `${id}.json`);
    if (!fs.existsSync(f)) { bad.push(`${id}: missing`); continue; }
    if (load(id).kind !== kind) bad.push(`${id}: kind ${load(id).kind} != ${kind}`);
  }
  assert.deepEqual(bad, []);
});

test('AC2: cache-tax manifest: title Cache clock, switch mods.cache_tax.enabled, saver, no rule', () => {
  const f = path.join(manifestDir, 'cache-tax.json');
  assert.ok(fs.existsSync(f), 'missing hooks/manifests/cache-tax.json');
  const m = load('cache-tax');
  assert.equal(m.id, 'cache-tax');
  assert.equal(m.title, 'Cache clock');
  assert.equal(m.kind, 'saver');
  assert.equal(m.switch, 'mods.cache_tax.enabled');
  assert.deepEqual(m.rules, []);
});

test('AC2: saver switches name a mod key that exists in scripts/settings.mjs', () => {
  const src = fs.readFileSync(path.join(root, 'scripts', 'settings.mjs'), 'utf8');
  const bad = [];
  for (const f of manifestFiles()) {
    const m = load(f.replace(/\.json$/, ''));
    if (m.kind !== 'saver' || typeof m.switch !== 'string') continue;
    const key = m.switch.split('.')[1];
    if (!new RegExp(`\\b${key}\\s*:`).test(src)) bad.push(`${m.id}: ${m.switch}`);
  }
  assert.deepEqual(bad, []);
});

test('AC2: every guard event is wired to the hook host in hooks/hooks.json', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const wired = (e) => Array.isArray(hooks[e]) && hooks[e].some((x) => JSON.stringify(x).includes('hook-host.mjs'));
  const bad = [];
  for (const f of manifestFiles()) {
    const m = load(f.replace(/\.json$/, ''));
    if (m.kind !== 'guard') continue;
    for (const e of m.events) if (!wired(e)) bad.push(`${m.id}: ${e} not wired`);
  }
  assert.deepEqual(bad, []);
});

test('ADR 0079: exactly four guard manifests and no git-add anywhere', () => {
  const guards = manifestFiles().map((f) => load(f.replace(/\.json$/, ''))).filter((m) => m.kind === 'guard').map((m) => m.id).sort();
  assert.deepEqual(guards, ['cap', 'dotenv', 'model-floor', 'self-protect']);
  assert.ok(!fs.existsSync(path.join(manifestDir, 'git-add.json')), 'hooks/manifests/git-add.json removed');
  assert.ok(!fs.existsSync(path.join(root, 'hooks', 'rules', 'git-add.mjs')), 'hooks/rules/git-add.mjs removed');
  assert.ok(!fs.existsSync(path.join(root, 'hooks', 'fixtures', 'git-add.M-SEC1')), 'hooks/fixtures/git-add.M-SEC1 removed');
  const rules = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'rules.json'), 'utf8'));
  assert.deepEqual(rules.filter((r) => /git-add/.test(JSON.stringify(r))), [], 'no git-add row in hooks/rules.json');
  const pins = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'pins.json'), 'utf8'));
  assert.deepEqual(Object.keys(pins.files).filter((k) => /git-add/.test(k)), [], 'no git-add pin in hooks/pins.json');
  assert.ok(!/git-add/.test(fs.readFileSync(path.join(root, 'hooks', 'lib', 'dep-hashes.mjs'), 'utf8')), 'no git-add in dep-hashes.mjs');
});
