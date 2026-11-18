// Tests for lead-relay v1 Rules + run-state v3.1: `run-state gate <slug> <g> <result>` needs a CEO answer (AC4).
// An answer counts when it is the latest `answer` of a `gate:<g>` form, chose an option whose `result` is the asked one,
// and its `at` is strictly after the previous `gate` record for that Gate. An `auto` Gate (from the settings snapshot) needs none.
// Forms and answers are written straight into forms.jsonl (the hook adapter is pinned by relay.test.mjs).
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-answer-home-'));
tmps.push(home);
const mcs = path.join(home, '.mcsparrow');
const env = { ...process.env, MCSPARROW_HOME: mcs, HOME: home, USERPROFILE: home };
delete env.AICO_GUARDS;
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const BASE = Math.floor((Date.now() - 3600000) / 1000) * 1000; // one hour ago, whole seconds
const at = (min) => iso(BASE + min * 60000); // minutes after BASE, all in the past

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-answer-'));
  tmps.push(root);
  const dir = path.join(root, '.company', 'work', ID, '01-feature');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', ID, '00-project.md'), 'Demo project\n');
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: at(0), ev: 'start' })}\n`);
  return { root, dir };
}
const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const stateRows = (fx) => lines(path.join(fx.dir, 'run-state.jsonl'));
const gateRows = (fx, gate) => stateRows(fx).filter((r) => r.ev === 'gate' && r.gate === gate);
const append = (file, rows) => fs.appendFileSync(file, rows.map((r) => `${JSON.stringify(r)}\n`).join(''));

const RESULT_OF = { Pass: 'passed', Change: 'changed', Stop: 'stopped' };
// An `open` row for a form with one single-select question; every option carries its run-state result.
const openRow = (id, kind, atIso) => ({
  v: 1, at: atIso, ev: 'open', id, kind,
  questions: [{ q: `Gate ${id}?`, header: 'Gate', multi: false, options: Object.entries(RESULT_OF).map(([label, result]) => ({ label, description: `${label} it`, result })) }],
});
const answerRow = (id, label, atIso) => ({ v: 1, at: atIso, ev: 'answer', id, src: 'hook', answers: [{ labels: [label], other: null }] });

function addForm(fx, { id = 'f01', kind = 'gate:ship', openAt = at(1), label, answerAt = at(2) } = {}) {
  const rows = [openRow(id, kind, openAt)];
  if (label !== undefined) rows.push(answerRow(id, label, answerAt));
  append(path.join(fx.dir, 'forms.jsonl'), rows);
}
const addGateRecord = (fx, gate, result, atIso) => append(path.join(fx.dir, 'run-state.jsonl'), [{ v: 1, at: atIso, ev: 'gate', gate, result }]);

function gate(fx, g, result) {
  const r = spawnSync(process.execPath, [SCRIPT, 'gate', SLUG, g, result], { cwd: fx.root, env, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: r.stderr ?? '' };
}
const refusedFor = (g) => `refused: no CEO answer for ${g}`;

function assertRefused(fx, g, result) {
  const before = stateRows(fx).length;
  const r = gate(fx, g, result);
  assert.equal(r.out, refusedFor(g), `out: ${r.out} ${r.err}`);
  assert.equal(r.code, 2);
  assert.equal(stateRows(fx).length, before, 'a refused gate writes nothing');
}
function assertWritten(fx, g, result) {
  const r = gate(fx, g, result);
  assert.equal(r.out, `ok: gate ${g} ${result}`, `out: ${r.out} ${r.err}`);
  assert.equal(r.code, 0);
  const last = stateRows(fx).at(-1);
  assert.equal(last.ev, 'gate');
  assert.equal(last.gate, g);
  assert.equal(last.result, result);
}

// AC4: a Gate pass traces to a recorded CEO answer.
test('AC4 gate passed with no form and no answer is refused', () => {
  const fx = fixture();
  assertRefused(fx, 'ship', 'passed');
});

test('AC4 gate passed with a form that has no answer row is refused', () => {
  const fx = fixture();
  addForm(fx, {});
  assertRefused(fx, 'ship', 'passed');
});

test('AC4 gate passed with a matching, newer answer is written', () => {
  const fx = fixture();
  addForm(fx, { label: 'Pass' });
  assertWritten(fx, 'ship', 'passed');
});

test('AC4 each Gate (brief, plan, ship) passes on its own gate:<g> answer', () => {
  for (const g of ['brief', 'plan', 'ship']) {
    const fx = fixture();
    addForm(fx, { kind: `gate:${g}`, label: 'Pass' });
    assertWritten(fx, g, 'passed');
  }
});

test('AC4 an answer chose Change: passed is refused, changed is written', () => {
  const fx = fixture();
  addForm(fx, { label: 'Change' });
  assertRefused(fx, 'ship', 'passed');
  assertWritten(fx, 'ship', 'changed');
});

test('AC4 an answer chose Stop: passed is refused, stopped is written', () => {
  const fx = fixture();
  addForm(fx, { label: 'Stop' });
  assertRefused(fx, 'ship', 'passed');
  assertWritten(fx, 'ship', 'stopped');
});

test('AC4 the latest answer of the Gate form decides (older Pass, newer Stop)', () => {
  const fx = fixture();
  addForm(fx, { id: 'f01', label: 'Pass', openAt: at(1), answerAt: at(2) });
  addForm(fx, { id: 'f02', label: 'Stop', openAt: at(3), answerAt: at(4) });
  assertRefused(fx, 'ship', 'passed');
  assertWritten(fx, 'ship', 'stopped');
});

test('AC4 an answer of a non-Gate form (kind ask) does not count', () => {
  const fx = fixture();
  addForm(fx, { kind: 'ask', label: 'Pass' });
  assertRefused(fx, 'ship', 'passed');
});

// One CEO pick passes one Gate once (run-state v3.1).
test('AC4 one answer, two passes of the same Gate (Ship Gate after a Fix round): the second is refused', () => {
  const fx = fixture();
  addForm(fx, { label: 'Pass' });
  assertWritten(fx, 'ship', 'passed');
  assertRefused(fx, 'ship', 'passed');
  assert.equal(gateRows(fx, 'ship').length, 1);
});

test('AC4 a new answer after the first gate record lets the second pass be written', () => {
  const fx = fixture();
  addForm(fx, { id: 'f01', label: 'Pass', openAt: at(1), answerAt: at(2) });
  addGateRecord(fx, 'ship', 'passed', at(3));
  addForm(fx, { id: 'f02', label: 'Pass', openAt: at(4), answerAt: at(5) });
  assertWritten(fx, 'ship', 'passed');
  assert.equal(gateRows(fx, 'ship').length, 2);
});

test('AC4 an answer whose at equals the previous gate record at is refused (strictly after)', () => {
  const fx = fixture();
  addForm(fx, { id: 'f01', label: 'Pass', openAt: at(1), answerAt: at(2) });
  addGateRecord(fx, 'ship', 'passed', at(3));
  addForm(fx, { id: 'f02', label: 'Pass', openAt: at(2), answerAt: at(3) });
  assertRefused(fx, 'ship', 'passed');
});

test('AC4 an answer older than the previous gate record is refused', () => {
  const fx = fixture();
  addForm(fx, { label: 'Pass', answerAt: at(2) });
  addGateRecord(fx, 'ship', 'passed', at(5));
  assertRefused(fx, 'ship', 'passed');
});

test('AC4 an answer for Gate plan does not count after a gate record for ship', () => {
  const fx = fixture();
  addForm(fx, { id: 'f01', kind: 'gate:plan', label: 'Pass', answerAt: at(2) });
  addForm(fx, { id: 'f02', kind: 'gate:ship', label: 'Pass', openAt: at(3), answerAt: at(4) });
  addGateRecord(fx, 'ship', 'passed', at(5));
  // plan answer (at 2) is still unused for plan: a ship record does not spend it
  assertWritten(fx, 'plan', 'passed');
  // the ship answer (at 4) is spent by the ship record at 5; the plan answer never counts for ship
  assertRefused(fx, 'ship', 'passed');
});

test('AC4 a gate record for another Gate does not spend a brief answer', () => {
  const fx = fixture();
  addForm(fx, { id: 'f01', kind: 'gate:brief', label: 'Pass', answerAt: at(2) });
  addGateRecord(fx, 'ship', 'passed', at(3));
  assertWritten(fx, 'brief', 'passed');
});

// An auto Gate needs no answer; `auto` comes from the run's settings snapshot, never from an argument.
// Shape pinned here: the Lead snapshot (lead.json under MCSPARROW_HOME) and the resolved user settings both say ship is auto.
// The two agree in this fixture, so either reading of "the run's settings snapshot" passes (see the Handoff, Decisions).
function setAuto(fx, gateName) {
  fs.mkdirSync(mcs, { recursive: true });
  fs.writeFileSync(path.join(mcs, 'config.json'), JSON.stringify({ aico_settings: { version: 1, gates: { [gateName]: 'auto' }, unlocked: gateName === 'ship' ? ['ship'] : [] } }));
  const realRoot = fs.realpathSync(fx.root);
  const key = createKey(realRoot);
  const snapDir = path.join(mcs, 'hook-snapshots', key);
  fs.mkdirSync(snapDir, { recursive: true });
  fs.writeFileSync(path.join(snapDir, 'lead.json'), JSON.stringify({
    v: 1, at: at(0), threshold: 180000, savers: {}, floor: {}, drift: false, settingsWarnings: [], gates: { [gateName]: 'auto' },
  }));
}
// Same as hash12 in hooks/lib/event.mjs.
function createKey(root) { return createHash('sha256').update(root).digest('hex').slice(0, 12); }
const clearAuto = () => fs.rmSync(mcs, { recursive: true, force: true });

test('AC4 an auto Gate from the snapshot is written without an answer', () => {
  const fx = fixture();
  try {
    setAuto(fx, 'ship');
    assertWritten(fx, 'ship', 'passed');
  } finally { clearAuto(); }
});

test('AC4 auto is per Gate: ship auto leaves a brief pass without an answer refused', () => {
  const fx = fixture();
  try {
    setAuto(fx, 'ship');
    assertRefused(fx, 'brief', 'passed');
  } finally { clearAuto(); }
});

test('AC4 auto is never read from an argument: an extra word is a usage refusal, nothing written', () => {
  const fx = fixture();
  const before = stateRows(fx).length;
  const r = spawnSync(process.execPath, [SCRIPT, 'gate', SLUG, 'ship', 'passed', 'auto'], { cwd: fx.root, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^refused: usage:/);
  assert.equal(stateRows(fx).length, before);
});
