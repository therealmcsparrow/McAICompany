// Tests for mods/lib/switchboard.mjs.
// Contracts: aico-mods v2.2 (Switchboard), mod-manifest v1, aico-settings v3.0 (`set-mod`), mod-hook v1 step 7 (deny log).
// The lib is pure: no `$`, no Node import, no npm package. Names and shapes below are the seam the lib builds to:
//   parseManifest(text)            -> manifest object, or undefined (allow-list of mod-manifest v1)
//   rows(manifests, settings)      -> { guards: Row[], savers: Row[] }  settings = { known, mods }
//                                     Row = { id, title, kind, state, canChange, key }
//   denyLines(text)                -> at most 5 strings, newest first, from `hook-check.mjs denies --json`
//   parseSetMod({ exitCode, stdout }) -> { ok: true } | { ok: false, message }
//   lockedMessage(id), toggledMessage(id, isOn)  -> the message-line texts of the design file, section 2
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseManifest, rows, denyLines, parseSetMod, lockedMessage, toggledMessage } from '../mods/lib/switchboard.mjs';

const own = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const GUARD = (id, rule, title = `${id} guard`) => ({
  v: 1, id, kind: 'guard', title, owner: 'backend-engineer', sessions: 'all', events: ['PreToolUse'], rules: [rule], fail: 'closed', switch: null, lock: true, upstream: null,
});
const GATE = (id) => ({
  v: 1, id, kind: 'gate', title: `${id} gate`, owner: 'backend-engineer', sessions: 'lead', events: ['PreToolUse'], rules: [], fail: 'closed', switch: null, lock: true, upstream: null,
});
const SAVER = (id, title = `${id} saver`) => ({
  v: 1, id, kind: 'saver', title, owner: 'frontend-engineer', sessions: 'lead', events: [], rules: [], fail: 'open', switch: `mods.${id.replace(/-/g, '_')}.enabled`, lock: false, upstream: null,
});
const MODS = { cache_tax: { enabled: true }, savings: { enabled: false }, switchboard: { enabled: true, seen: true } };
const SETTINGS = (mods = MODS) => ({ known: true, mods });

// ---- parseManifest (mod-manifest v1 shape) ----

test('parseManifest accepts each kind row of mod-manifest v1', () => {
  for (const m of [GUARD('cap', 'cap.M1'), GATE('plan-gate'), SAVER('cache-tax', 'Cache clock')]) {
    assert.deepEqual(parseManifest(JSON.stringify(m)), m);
  }
});

test('parseManifest refuses an unknown key, a missing key, a wrong type and an id that is not kebab', () => {
  const g = GUARD('cap', 'cap.M1');
  assert.equal(parseManifest(JSON.stringify({ ...g, extra: 1 })), undefined);
  const { owner, ...missing } = g;
  void owner;
  assert.equal(parseManifest(JSON.stringify(missing)), undefined);
  assert.equal(parseManifest(JSON.stringify({ ...g, lock: 'yes' })), undefined);
  assert.equal(parseManifest(JSON.stringify({ ...g, id: '../cap' })), undefined);
  assert.equal(parseManifest(JSON.stringify({ ...g, id: 'Cap' })), undefined);
});

test('parseManifest refuses a kind whose fixed keys do not match (saver with fail closed, guard with a switch)', () => {
  assert.equal(parseManifest(JSON.stringify({ ...SAVER('savings'), fail: 'closed' })), undefined);
  assert.equal(parseManifest(JSON.stringify({ ...GUARD('cap', 'cap.M1'), switch: 'mods.cap.enabled' })), undefined);
  assert.equal(parseManifest(JSON.stringify({ ...GUARD('cap', 'cap.M1'), lock: false })), undefined);
});

test('parseManifest refuses a title longer than 60 characters, an empty title, and not-JSON, over 8 KiB', () => {
  assert.equal(parseManifest(JSON.stringify(SAVER('savings', 'x'.repeat(61)))), undefined);
  assert.equal(parseManifest(JSON.stringify(SAVER('savings', ''))), undefined);
  assert.equal(parseManifest('{nope'), undefined);
  assert.equal(parseManifest(JSON.stringify({ ...SAVER('savings'), pad: 'x'.repeat(9000) })), undefined);
  assert.equal(parseManifest(undefined), undefined);
  assert.equal(parseManifest(42), undefined);
});

test('parseManifest drops a __proto__ key instead of merging it', () => {
  const text = `{"__proto__":{"polluted":true},${JSON.stringify(SAVER('savings')).slice(1)}`;
  parseManifest(text);
  assert.equal({}.polluted, undefined);
});

// ---- rows: read-only guards, settings only ----

test('rows: guards and gates are one read-only group, savers another, manifest order kept, no row for the switchboard itself', () => {
  const r = rows(
    [GUARD('cap', 'cap.M1'), SAVER('cache-tax', 'Cache clock'), GATE('plan-gate'), SAVER('switchboard'), GUARD('dotenv', 'dotenv.M-SEC1'), SAVER('savings')],
    SETTINGS(),
  );
  assert.deepEqual(r.guards.map((x) => x.id), ['cap', 'plan-gate', 'dotenv']);
  assert.deepEqual(r.savers.map((x) => x.id), ['cache-tax', 'savings']);
  for (const g of r.guards) {
    assert.equal(g.state, 'LOCKED ON');
    assert.equal(g.canChange, false);
    assert.equal(g.key, null);
  }
});

test('AC15: a hand-edited guard key in settings changes nothing, the guard row stays LOCKED ON', () => {
  const edited = { ...MODS, cap: { enabled: false }, git_add: { enabled: false }, dotenv: false, plan_gate: { enabled: false } };
  const r = rows([GUARD('cap', 'cap.M1'), GUARD('self-protect', 'self-protect.M-SEC1'), GUARD('dotenv', 'dotenv.M-SEC1'), GATE('plan-gate')], SETTINGS(edited));
  assert.deepEqual(r.guards.map((x) => x.state), ['LOCKED ON', 'LOCKED ON', 'LOCKED ON', 'LOCKED ON']);
  assert.ok(r.guards.every((x) => x.canChange === false));
});

test('rows: a saver reads its manifest switch key from the settings: ON, OFF, and the key it will write', () => {
  const r = rows([SAVER('cache-tax', 'Cache clock'), SAVER('savings')], SETTINGS());
  assert.deepEqual(r.savers.map((x) => [x.id, x.state, x.canChange, x.key]), [
    ['cache-tax', 'ON', true, 'mods.cache_tax.enabled'],
    ['savings', 'OFF', true, 'mods.savings.enabled'],
  ]);
});

test('rows: settings unknown -> savers UNKNOWN and cannot change, guards still LOCKED ON', () => {
  const r = rows([GUARD('cap', 'cap.M1'), SAVER('savings')], { known: false, mods: {} });
  assert.equal(r.guards[0].state, 'LOCKED ON');
  assert.equal(r.savers[0].state, 'UNKNOWN');
  assert.equal(r.savers[0].canChange, false);
});

test('rows: a saver whose switch value is not a boolean is UNKNOWN, not ON', () => {
  const r = rows([SAVER('savings')], SETTINGS({ savings: { enabled: 'yes' } }));
  assert.equal(r.savers[0].state, 'UNKNOWN');
});

test('rows: no savers -> empty savers group, guards listed; no manifests -> both empty, no throw', () => {
  assert.deepEqual(rows([GUARD('cap', 'cap.M1')], SETTINGS()).savers, []);
  assert.deepEqual(rows([], SETTINGS()), { guards: [], savers: [] });
});

test('rows: a hostile title is cleaned (control, escape and bidi characters become spaces) and cut to 60', () => {
  const hostile = 'Cache\u001b[31m clock\u202E\nlast\u0007' + 'z'.repeat(80);
  const r = rows([{ ...SAVER('cache-tax'), title: hostile }], SETTINGS());
  const t = r.savers[0].title;
  assert.ok(!/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(t), JSON.stringify(t));
  assert.ok(t.length <= 60);
  assert.ok(t.startsWith('Cache'));
});

// ---- denyLines: RECENT DENIES ----

const ROW = (rule, at, extra = {}) => ({ v: 1, at, rule, kind: 'deny', session: 'S1', agent: null, ...extra });

test('denyLines: none -> empty list; not JSON, not an array, or wrong item type -> empty list', () => {
  assert.deepEqual(denyLines('[]'), []);
  assert.deepEqual(denyLines(''), []);
  assert.deepEqual(denyLines('{nope'), []);
  assert.deepEqual(denyLines('{"rule":"cap.M1"}'), []);
  assert.deepEqual(denyLines('[1,"a",null]'), []);
});

test('denyLines: one deny reads `<rule>, main chat, <hh:mm>`; a Step row says task step', () => {
  const lines = denyLines(JSON.stringify([ROW('dotenv.M-SEC1', '2026-11-14T14:52:00Z'), ROW('cap.M1', '2026-11-14T14:50:00Z', { agent: 'abc123' })]));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^dotenv\.M-SEC1, main chat, \d\d:\d\d$/);
  assert.match(lines[1], /^cap\.M1, task step, \d\d:\d\d$/);
});

test('denyLines: seven rows -> the newest five, newest first, whatever order the script prints', () => {
  const rowsIn = [3, 1, 7, 5, 2, 6, 4].map((n) => ROW(`rule-${n}.M1`, `2026-11-14T10:0${n}:00Z`));
  const lines = denyLines(JSON.stringify(rowsIn));
  assert.equal(lines.length, 5);
  assert.deepEqual(lines.map((l) => l.split(',')[0]), ['rule-7.M1', 'rule-6.M1', 'rule-5.M1', 'rule-4.M1', 'rule-3.M1']);
});

test('denyLines: a failure kind (timeout) is named in its line', () => {
  const [line] = denyLines(JSON.stringify([ROW('cap.M1', '2026-11-14T14:52:00Z', { kind: 'timeout' })]));
  assert.ok(line.includes('timeout'), line);
});

test('denyLines: hostile rule text is cleaned and cut, never raw escape or bidi characters; a bad `at` is not shown as NaN', () => {
  const lines = denyLines(JSON.stringify([ROW('x\u001b[2J\u202E<b>rm</b>' + 'y'.repeat(300), 'not a date'), ROW('cap.M1', null)]));
  for (const l of lines) {
    assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(l), JSON.stringify(l));
    assert.ok(!/NaN|undefined|null|Invalid/.test(l), l);
    assert.ok(l.length <= 120, `${l.length}`);
  }
});

test('denyLines: a 5 MB answer does not hang or throw', () => {
  const big = JSON.stringify(Array.from({ length: 50000 }, (_, i) => ROW('cap.M1', `2026-11-14T10:00:${String(i % 60).padStart(2, '0')}Z`)));
  assert.equal(denyLines(big).length, 5);
});

// ---- parseSetMod / message lines ----

test('parseSetMod: exit 0 with `set mods.<key>.enabled <bool>` is ok', () => {
  assert.deepEqual(parseSetMod({ exitCode: 0, stdout: 'set mods.cache_tax.enabled false\n' }), { ok: true });
});

test('R-15: a project-level refusal (exit 2) is the message, verbatim', () => {
  const r = parseSetMod({ exitCode: 2, stdout: 'refused: cache-tax is set in .company/settings.json\n' });
  assert.deepEqual(r, { ok: false, message: 'refused: cache-tax is set in .company/settings.json' });
});

test('parseSetMod: a guard refusal, an unknown answer, exit 0 with other text, and a hostile refusal never read as ok', () => {
  assert.equal(parseSetMod({ exitCode: 2, stdout: 'refused: cap cannot be switched' }).ok, false);
  assert.equal(parseSetMod({ exitCode: 0, stdout: 'something else' }).ok, false);
  assert.equal(parseSetMod({ exitCode: 1, stdout: '' }).ok, false);
  assert.equal(parseSetMod(undefined).ok, false);
  const bad = parseSetMod({ exitCode: 2, stdout: 'refused: x\u001b[31m\u202E' + 'z'.repeat(400) });
  assert.equal(bad.ok, false);
  assert.ok(!/[\u0000-\u001f\u202a-\u202e]/.test(bad.message));
  assert.ok(bad.message.length <= 200);
});

test('message lines are the design file wording', () => {
  assert.equal(lockedMessage('cap'), 'cap is locked on and cannot be changed here.');
  assert.equal(toggledMessage('cache-tax', false), 'cache-tax set OFF. Applies when the next task step starts.');
  assert.equal(toggledMessage('cache-tax', true), 'cache-tax set ON. Applies when the next task step starts.');
});

// ---- no second switch file, static scan of the seams ----

test('AC23: neither the pane nor its lib names a switches.json or writes a file', () => {
  for (const rel of ['mods/lib/switchboard.mjs', 'mods/switchboard.tsx']) {
    const src = own(rel);
    assert.ok(!/switches\.json/i.test(src), `${rel} names switches.json`);
    assert.ok(!/fs\.write|writeFile|appendFile/.test(src), `${rel} writes a file`);
  }
});

test('the lib stays pure: no $ engine call, no Node import, no npm package', () => {
  const src = own('mods/lib/switchboard.mjs');
  assert.ok(!/from\s+['"](node:|fs|path|os|child_process)/.test(src));
  assert.ok(!/\brequire\(/.test(src));
  assert.ok(!/\$\.(fs|process|ui)\b/.test(src));
});
