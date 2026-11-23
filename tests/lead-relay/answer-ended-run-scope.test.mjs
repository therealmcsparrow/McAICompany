// Scope of the ended-run answer (lead-relay v1.1): only a form opened at or after the run's end takes an answer, the newest ended
// match wins, ambiguity and run-less folders stay skipped, and live runs win over ended ones.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '..', '..', 'scripts', 'lead-relay.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-scope-home-'));
const roots = [];
after(() => { fs.rmSync(home, { recursive: true, force: true }); for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });
const env = { ...process.env, MCSPARROW_HOME: path.join(home, '.mcsparrow'), HOME: home, USERPROFILE: home };
delete env.AICO_GUARDS;

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const questions = [{ q: 'PR is open. How do I handle it?', header: 'PR', multi: false, options: [{ label: 'Build on branch', description: 'Work on its branch' }, { label: 'Wait for merge', description: 'Stop now' }] }];
const other = [{ q: 'Something else entirely?', header: 'Else', multi: false, options: [{ label: 'Yes', description: 'Do it' }, { label: 'No', description: 'Skip it' }] }];
const gateQs = [{ q: 'Ship it?', header: 'Ship', multi: false, options: [{ label: 'Ship', description: 'Go', result: 'approved' }, { label: 'Hold', description: 'Stop', result: 'rejected' }] }];
const payloadFor = (qs, label) => JSON.stringify({
  hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
  tool_input: { questions: qs.map((q) => ({ question: q.q, header: q.header, multiSelect: q.multi, options: q.options.map((o) => ({ label: o.label, description: o.description })) })) },
  tool_response: { answers: { [qs[0].q]: label } },
});
const payload = payloadFor(questions, 'Build on branch');

let root;
let t; // run start time: set once per test by the first run() call
const relay = (args, input) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env, encoding: 'utf8', timeout: 20000, input });
beforeEach(() => { t = undefined; root =fs.mkdtempSync(path.join(os.tmpdir(), 'relay-scope-')); roots.push(root); fs.writeFileSync(path.join(root, 'q.json'), JSON.stringify(questions)); });

const dirOf = (slug) => path.join(root, '.company', 'work', ...slug.split('/'));
// Run started at t, ended at t+1000 (outcome param), or left running.
function run(slug, ended, outcome = 'ship') {
  const dir = dirOf(slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', slug.split('/')[0], '00-project.md'), 'Demo\n');
  t ??= Math.floor((Date.now() - 600000) / 1000) * 1000;
  const rows = ended ? [{ ev: 'start' }, { ev: 'end', outcome }] : [{ ev: 'start' }];
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), rows.map((r, i) => JSON.stringify({ v: 1, at: iso(t + i * 1000), ...r })).join('\n') + '\n');
}
// Hand-written open row with an explicit `at`.
const openRow = (slug, at, id = 'f01', qs = questions, kind = 'ask') => {
  const row = { v: 1, at, ev: 'open', id, kind, questions: qs };
  fs.appendFileSync(path.join(dirOf(slug), 'forms.jsonl'), `${JSON.stringify(row)}\n`);
};
const open = (slug) => relay(['open', slug, 'ask', path.join(root, 'q.json')]);
const again = (slug, id = 'f01') => relay(['again', slug, id]);
const read = (slug) => relay(['read', slug, 'f01', '--json']).stdout;
const recorded = (slug) => /"labels":\["Build on branch"\]/.test(read(slug));
const none = (slug) => /answer: none/.test(read(slug));
const A = 'P20261118.000002/02-lead';
const B = 'P20261118.000003/02-lead';

test('a running run keeps taking its answer (unchanged)', () => {
  run(A, false);
  assert.equal(open(A).status, 0);
  relay(['answer'], payload);
  assert.ok(recorded(A));
});

test('eligible ended forms in two runs: open is allowed, the answer records nothing (fail closed)', () => {
  run(A, true); run(B, true);
  openRow(A, iso(t + 10000));
  assert.equal(open(B).status, 0);
  relay(['answer'], payload);
  assert.ok(none(B));
  assert.ok(none(A));
});

test('older again is refused while a newer twin is open; the recovery works', () => {
  run(A, true); run(B, true);
  openRow(A, iso(t + 10000));
  openRow(B, iso(t + 20000));
  const r = again(A);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /same questions open in run P20261118\.000003\/02-lead/);
  relay(['answer'], payload);
  assert.ok(none(B));
  assert.ok(none(A));
  assert.equal(again(B).status, 0, 'the newer run stays the one to resume');
});

test('tie on at: again keeps the shared-form order, the answer still records nothing in either run', () => {
  run(A, true); run(B, true);
  openRow(A, iso(t + 10000));
  openRow(B, iso(t + 10000));
  assert.equal(again(B).status, 0);
  assert.notEqual(again(A).status, 0);
  relay(['answer'], payload);
  assert.ok(none(B));
  assert.ok(none(A));
});

test('a pre-end Gate form of an aborted run is not answerable until the run is live again', () => {
  run(A, true, 'abort');
  openRow(A, iso(t), 'f01', gateQs, 'gate:ship');
  relay(['answer'], payloadFor(gateQs, 'Ship'));
  assert.ok(none(A));
  const r = again(A);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /form opened before the run ended/);
  fs.appendFileSync(path.join(dirOf(A), 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(t + 5000), ev: 'start' })}\n`);
  assert.equal(again(A).status, 0);
  relay(['answer'], payloadFor(gateQs, 'Ship'));
  assert.match(read(A), /"labels":\["Ship"\]/);
});

test('a pre-end form is ignored by the shared-form check', () => {
  run(A, true); run(B, true);
  openRow(A, iso(t));
  assert.equal(open(B).status, 0);
  relay(['answer'], payload);
  assert.ok(recorded(B));
  assert.ok(none(A));
});

test('same-second boundary: a form opened at the end second is recorded', () => {
  run(A, true);
  openRow(A, iso(t + 1000));
  relay(['answer'], payload);
  assert.ok(recorded(A));
});

test('a bad at on an ended form records nothing', () => {
  run(A, true);
  openRow(A, 'x');
  relay(['answer'], payload);
  assert.ok(none(A));
});

test('a live run with two open non-matching forms stops the ended search', () => {
  run(A, true); run(B, false);
  openRow(A, iso(t + 10000));
  openRow(B, iso(t + 1), 'f01', other);
  openRow(B, iso(t + 2), 'f02', other);
  relay(['answer'], payload);
  assert.ok(none(A));
});

test('an ended run with two open forms is ambiguous: nothing is recorded anywhere', () => {
  run(A, true); run(B, true);
  openRow(A, iso(t + 10000), 'f01', questions);
  openRow(A, iso(t + 10001), 'f02', other);
  openRow(B, iso(t + 20000));
  relay(['answer'], payload);
  assert.ok(none(B));
  assert.ok(none(A));
});

test('a live run and an eligible ended run with the same form: nothing is recorded (R-30)', () => {
  run(A, true); run(B, false);
  assert.equal(open(A).status, 0);
  assert.equal(open(B).status, 0, 'an ended twin does not block a live run');
  relay(['answer'], payload);
  assert.ok(none(B));
  assert.ok(none(A));
});

test('open on an ended run is refused while a live run holds the same form', () => {
  run(A, true); run(B, false);
  assert.equal(open(B).status, 0);
  assert.notEqual(open(A).status, 0);
});

test('again on an ended run is refused while a live run holds the same form', () => {
  run(A, true); run(B, false);
  openRow(A, iso(t + 10000));
  assert.equal(open(B).status, 0);
  const r = again(A);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /same questions open in run/);
});

test('a run-less folder (no run-state) is still skipped', () => {
  const dir = dirOf(A);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'forms.jsonl'), JSON.stringify({ v: 1, at: iso(Date.now() - 1000), ev: 'open', id: 'f01', kind: 'ask', questions }) + '\n');
  relay(['answer'], payload);
  assert.equal(fs.readFileSync(path.join(dir, 'forms.jsonl'), 'utf8').includes('"ev":"answer"'), false);
});

test('R-30: an in-flight ended-run form is not taken by a later live open in another run', () => {
  run(A, true); run(B, false);
  openRow(A, iso(t + 10000));
  assert.equal(open(B).status, 0);
  relay(['answer'], payload);
  assert.ok(none(A));
  assert.ok(none(B));
});

test('R-30: nor by a later open in another ended run', () => {
  run(A, true); run(B, true);
  openRow(A, iso(t + 10000));
  assert.equal(open(B).status, 0);
  relay(['answer'], payload);
  assert.ok(none(A));
  assert.ok(none(B));
});

test('R-31: restarting an ended run does not let its old form take a pick that also fits another run', () => {
  run(A, true); run(B, false);
  openRow(A, iso(t - 1000));
  assert.equal(open(B).status, 0);
  fs.appendFileSync(path.join(dirOf(A), 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(t + 20000), ev: 'start' })}\n`);
  relay(['answer'], payload);
  assert.ok(none(A));
  assert.ok(none(B));
});
