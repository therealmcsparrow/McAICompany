import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, show } from './run-state.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-v15-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

let n = 0;
function repo() {
  const root = path.join(base, `r${n++}`);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}
const stateFile = (root, slug) => path.join(root, '.company', 'work', slug, 'run-state.jsonl');
const raw = (root, slug) => (fs.existsSync(stateFile(root, slug)) ? fs.readFileSync(stateFile(root, slug), 'utf8') : '');
const T0 = Date.parse('2026-10-26T10:00:00Z');
const ID = 'a1b2c3d4e5f6';
const ID2 = '0123456789ab';
const SID = '123e4567-e89b-12d3-a456-426614174000';
const SID2 = '223e4567-e89b-12d3-a456-426614174000';
const V14_COMMIT = '9d79741579fbdf49066f3f9fdfc0dc2596d045a8';
const go = (root, args, ms = 0) => run(args, { root, now: T0 + ms });
function started(slug = 'x') {
  const root = repo();
  assert.equal(go(root, ['start', slug]).code, 0);
  return root;
}
// Asserts a refusal that leaves the file exactly as it was.
function refused(root, args, slug = 'x') {
  const before = raw(root, slug);
  const r = go(root, args, 1000);
  assert.equal(r.code, 2, `${args.join(' ')} -> ${r.out}`);
  assert.match(r.out, /^refused: /);
  assert.equal(raw(root, slug), before);
}
const stamp = ms => new Date(T0 + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// A copy of the v1.4 reader from git, next to the current handoff-lint and contract-drift; null when the clone has no such commit.
function oldReader() {
  const old = spawnSync('git', ['show', `${V14_COMMIT}:scripts/run-state.mjs`], { cwd: import.meta.dirname, encoding: 'utf8' });
  if (old.status !== 0) return null;
  const lib = path.join(base, `old${n++}`);
  fs.mkdirSync(lib);
  fs.writeFileSync(path.join(lib, 'run-state.mjs'), old.stdout);
  for (const f of ['handoff-lint.mjs', 'contract-drift.mjs']) fs.copyFileSync(path.join(import.meta.dirname, f), path.join(lib, f));
  // handoff-lint imports ../mods/lib/work-folder.mjs, so the copy needs it at that relative spot.
  const modLib = path.join(lib, '..', 'mods', 'lib');
  fs.mkdirSync(modLib, { recursive: true });
  fs.copyFileSync(path.join(import.meta.dirname, '..', 'mods', 'lib', 'work-folder.mjs'), path.join(modLib, 'work-folder.mjs'));
  return path.join(lib, 'run-state.mjs');
}
const oldView = (reader, root) => JSON.parse(spawnSync(process.execPath, [reader, 'show', 'x', '--json'], { cwd: root, encoding: 'utf8' }).stdout);

// Hostile input first.
test('ceo: gate and n are allow-listed, nothing written on refusal', () => {
  const root = started();
  for (const args of [
    ['ceo', 'x', 'ship2', '3'], ['ceo', 'x', 'SHIP', '3'], ['ceo', 'x', '', '3'], ['ceo', 'x', '__proto__', '3'],
    ['ceo', 'x', 'ship', '0'], ['ceo', 'x', 'ship', '21'], ['ceo', 'x', 'ship', '-1'], ['ceo', 'x', 'ship', '01'],
    ['ceo', 'x', 'ship', '1.5'], ['ceo', 'x', 'ship', '3 '], ['ceo', 'x', 'ship', '3\n'], ['ceo', 'x', 'ship', '1e1'],
    ['ceo', 'x', 'ship', ''], ['ceo', 'x', 'ship'], ['ceo', 'x', 'ship', '3', 'extra'], ['ceo', 'x'], ['ceo', '../x', 'ship', '3'],
  ]) refused(root, args);
});

test('ceo: bounds 1 and 20 and every gate are accepted', () => {
  const root = started();
  for (const [g, c] of [['brief', '1'], ['plan', '20'], ['ship', '7'], ['none', '4']]) assert.equal(go(root, ['ceo', 'x', g, c]).code, 0);
  const v = show(root, 'x');
  assert.deepEqual(v.ceo.map(e => [e.gate, e.n]), [['brief', 1], ['plan', 20], ['ship', 7], ['none', 4]]);
  assert.deepEqual(v.warnings, []);
});

test('ceo: refused without an open segment', () => {
  const root = repo();
  refused(root, ['ceo', 'x', 'ship', '3']);
  go(root, ['start', 'x']);
  go(root, ['end', 'x', 'ship']);
  refused(root, ['ceo', 'x', 'ship', '3']);
});

test('sub: role, id, phase and session are allow-listed, nothing written on refusal', () => {
  const root = started();
  for (const args of [
    ['sub', 'x', 'begin', 'qa', ID], ['sub', 'x', 'START', 'qa', ID], ['sub', 'x', 'start', 'QA', ID], ['sub', 'x', 'start', 'not-an-agent', ID],
    ['sub', 'x', 'start', '../qa', ID], ['sub', 'x', 'start', '', ID], ['sub', 'x', 'start', 'qa'], ['sub', 'x', 'start'],
    ['sub', 'x', 'start', 'qa', ID.toUpperCase()], ['sub', 'x', 'start', 'qa', 'a1b2c3d4e5f'], ['sub', 'x', 'start', 'qa', 'a1b2c3d4e5f67'],
    ['sub', 'x', 'start', 'qa', 'a1b2c3d4e5fg'], ['sub', 'x', 'start', 'qa', 'agent-1234-abcd-ef'],
    ['sub', 'x', 'start', 'qa', ID, SID.toUpperCase()], ['sub', 'x', 'start', 'qa', ID, 'not-a-uuid'], ['sub', 'x', 'start', 'qa', ID, ''],
    ['sub', 'x', 'start', 'qa', ID, `${SID}0`], ['sub', 'x', 'start', 'qa', ID, ` ${SID}`], ['sub', 'x', 'start', 'qa', ID, `${SID}\n`],
    ['sub', 'x', 'start', 'qa', ID, SID, 'extra'], ['sub', 'x', 'start', 'qa', ID, '123e4567e89b12d3a456426614174000'],
  ]) refused(root, args);
});

test('sub: an agent slug and other are accepted, with and without session', () => {
  const root = started();
  assert.equal(go(root, ['sub', 'x', 'start', 'backend-engineer', ID, SID], 1000).code, 0);
  assert.equal(go(root, ['sub', 'x', 'stop', 'backend-engineer', ID, SID], 5000).code, 0);
  assert.equal(go(root, ['sub', 'x', 'start', 'other', ID2], 6000).code, 0);
  const lines = raw(root, 'x').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(Object.keys(lines[1]), ['v', 'at', 'ev', 'role', 'id', 'phase', 'session']);
  assert.deepEqual(Object.keys(lines[3]), ['v', 'at', 'ev', 'role', 'id', 'phase']);
  for (const l of lines) assert.ok(Buffer.byteLength(JSON.stringify(l)) < 256);
});

test('sub: refused without an open segment', () => {
  refused(repo(), ['sub', 'x', 'start', 'qa', ID]);
});

test('start: aico is an anchored version, nothing written otherwise', () => {
  for (const bad of ['0.19', '0.19.1.2', 'v0.19.1', '0.19.1 ', '0.19.1\n', '1000.0.0', '0.19.x', '-1.0.0', '0.19.1-rc1', '', '0.19.1; rm']) {
    const root = repo();
    refused(root, ['start', 'x', bad]);
    assert.equal(raw(root, 'x'), '');
  }
  const root = repo();
  assert.equal(go(root, ['start', 'x', '0.19.1']).code, 0);
  assert.deepEqual(JSON.parse(raw(root, 'x')), { v: 1, at: '2026-10-26T10:00:00Z', ev: 'start', aico: '0.19.1', cap: 180000 });
  const plain = repo();
  assert.equal(go(plain, ['start', 'x']).code, 0);
  assert.deepEqual(JSON.parse(raw(plain, 'x')), { v: 1, at: '2026-10-26T10:00:00Z', ev: 'start', cap: 180000 });
  assert.equal(show(root, 'x', { now: T0 + 1000 }).state, 'running');
  assert.deepEqual(show(root, 'x', { now: T0 + 1000 }).warnings, []);
});

test('reader: forged lines are skipped with a warning', () => {
  const root = started();
  const at = '2026-10-26T10:00:01Z';
  const forged = [
    { ev: 'ceo', gate: 'ship', n: 0 }, { ev: 'ceo', gate: 'ship', n: 21 }, { ev: 'ceo', gate: 'ship', n: '3' }, { ev: 'ceo', gate: 'x', n: 3 },
    { ev: 'ceo', gate: 'ship', n: 3, extra: 1 }, { ev: 'ceo', gate: 'ship' },
    { ev: 'sub', role: 'qa', id: ID, phase: 'start', extra: 1 }, { ev: 'sub', role: 'qa', id: ID.toUpperCase(), phase: 'start' },
    { ev: 'sub', role: 'qa', id: ID, phase: 'pause' }, { ev: 'sub', role: 'qa', id: ID, phase: 'start', session: SID.toUpperCase() },
    { ev: 'sub', role: 'qa', id: ID, phase: 'start', session: 7 }, { ev: 'sub', role: 'Q A', id: ID, phase: 'start' },
    { ev: 'sub', id: ID, phase: 'start' }, { ev: 'start', aico: '1.2' }, { ev: 'start', aico: 5 }, { ev: 'wave', wave: 1, aico: '1.2.3' },
    { ev: 'ceo', gate: 'ship', n: 3, session: SID },
  ];
  fs.appendFileSync(stateFile(root, 'x'), `${forged.map(f => JSON.stringify({ v: 1, at, ...f })).join('\n')}\n`);
  const v = show(root, 'x');
  assert.deepEqual(v.ceo, []);
  assert.deepEqual(v.subs, []);
  assert.deepEqual(v.sessions, []);
  assert.equal(v.warnings.length, forged.length);
});

// Behaviour.
test('view: ceo, subs and sessions', () => {
  const root = started();
  go(root, ['ceo', 'x', 'brief', '2'], 1000);
  go(root, ['sub', 'x', 'start', 'qa', ID, SID], 2000);
  go(root, ['sub', 'x', 'start', 'security', ID2, SID2], 3000);
  go(root, ['sub', 'x', 'stop', 'qa', ID, SID], 7000);
  go(root, ['sub', 'x', 'start', 'other', 'ffffffffffff', SID], 8000);
  go(root, ['sub', 'x', 'stop', 'other', '000000000000'], 9000);
  go(root, ['ceo', 'x', 'none', '1'], 10000);
  const v = show(root, 'x', { now: T0 + 20000 });
  assert.deepEqual(v.ceo, [{ gate: 'brief', n: 2, at: stamp(1000) }, { gate: 'none', n: 1, at: stamp(10000) }]);
  assert.deepEqual(v.subs, [
    { role: 'qa', id: ID, start: stamp(2000), stop: stamp(7000), ms: 5000 },
    { role: 'security', id: ID2, start: stamp(3000), stop: null, ms: null },
    { role: 'other', id: 'ffffffffffff', start: stamp(8000), stop: null, ms: null },
    { role: 'other', id: '000000000000', start: null, stop: stamp(9000), ms: null },
  ]);
  assert.deepEqual(v.sessions, [SID, SID2]);
  assert.deepEqual(v.warnings, []);
});

test('view: only the last segment counts', () => {
  const root = started();
  go(root, ['ceo', 'x', 'ship', '3'], 1000);
  go(root, ['sub', 'x', 'start', 'qa', ID, SID], 2000);
  go(root, ['end', 'x', 'abort'], 3000);
  go(root, ['start', 'x', '0.19.1'], 4000);
  const v = show(root, 'x');
  assert.deepEqual([v.ceo, v.subs, v.sessions], [[], [], []]);
});

test('view: a run with no new records has the empty keys', () => {
  const v = show(started(), 'x');
  assert.deepEqual([v.ceo, v.subs, v.sessions], [[], [], []]);
  const none = show(repo(), 'x');
  assert.deepEqual([none.ceo, none.subs, none.sessions], [[], [], []]);
});

test('line limit still holds for the new events', () => {
  const root = started();
  const fill = [];
  for (let i = 0; i < 997; i++) fill.push(JSON.stringify({ v: 1, at: '2026-10-26T10:00:00Z', ev: 'ask', gate: 'ship' }));
  fs.appendFileSync(stateFile(root, 'x'), `${fill.join('\n')}\n`);
  assert.equal(go(root, ['sub', 'x', 'start', 'qa', ID], 1000).code, 0);
  assert.equal(go(root, ['ceo', 'x', 'ship', '1'], 1000).code, 0);
  refused(root, ['ceo', 'x', 'ship', '1']);
});

// Every v1.4 file gives the same view plus the empty keys.
test('v1.4 file: same view plus the new empty keys', () => {
  const recs = [
    { ev: 'start' }, { ev: 'wave', wave: 1 }, { ev: 'ask', gate: 'brief' }, { ev: 'gate', gate: 'brief', result: 'passed' },
    { ev: 'pick', pick: 'keep', asked: 0 }, { ev: 'wave', wave: 2 }, { ev: 'gate', gate: 'plan', result: 'changed' },
  ];
  const root = repo();
  fs.mkdirSync(path.dirname(stateFile(root, 'x')), { recursive: true });
  fs.writeFileSync(stateFile(root, 'x'), `${recs.map((r, i) => JSON.stringify({ v: 1, at: stamp(i * 1000), ...r })).join('\n')}\n`);
  const v = show(root, 'x', { now: T0 + 10000 });
  assert.equal(v.state, 'running');
  assert.equal(v.wave, 2);
  assert.deepEqual(v.gates.map(g => [g.gate, g.result]), [['brief', 'passed'], ['plan', 'changed']]);
  assert.deepEqual(v.picks, [{ pick: 'keep', asked: 0, at: stamp(4000) }]);
  assert.deepEqual([v.ceo, v.subs, v.sessions, v.warnings], [[], [], [], []]);
  const reader = oldReader();
  if (reader) {
    const { ceo, subs, sessions, state, waves, open_ask, cap, handover, ...rest } = v;
    const { state: oldState, ...oldRest } = oldView(reader, root);
    assert.deepEqual(rest, oldRest);
  }
});

test('a v1.4 reader skips the new lines with its warning', t => {
  const reader = oldReader();
  if (!reader) { t.skip('v1.4 reader not in this clone'); return; }
  const root = started();
  go(root, ['ceo', 'x', 'ship', '3'], 1000);
  go(root, ['sub', 'x', 'start', 'qa', ID, SID], 2000);
  go(root, ['wave', 'x', '2'], 3000);
  const v = oldView(reader, root);
  assert.deepEqual(v.warnings, ['line 1 skipped', 'line 2 skipped', 'line 3 skipped']);
  assert.equal(v.wave, null); // the old reader skipped the start line, so it sees no run segment
});

test('a v1.4 reader skips a start line that carries aico', t => {
  const reader = oldReader();
  if (!reader) { t.skip('v1.4 reader not in this clone'); return; }
  const root = repo();
  go(root, ['start', 'x', '0.19.1']);
  assert.deepEqual(oldView(reader, root).warnings, ['line 1 skipped']);
});

test('the command output never prints a session', () => {
  const root = started();
  assert.ok(!go(root, ['sub', 'x', 'start', 'qa', ID, SID], 1000).out.includes(SID));
});
