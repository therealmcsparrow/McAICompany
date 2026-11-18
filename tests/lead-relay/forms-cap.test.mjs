// Tests for lead-relay v1 + run-state v3.1 (R-8): one forms.jsonl cap, MAX_FORMS (256 KiB), for the writer and the gate reader.
// An append that would pass the cap is refused and leaves the file unchanged (the writer throws `forms record full`; the CLI reports
// `error: failed`, the answer hook swallows it); at or under the cap it appends and the run-state gate reads the answer.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_FORMS } from '../../scripts/run-state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RELAY = path.join(here, '..', '..', 'scripts', 'lead-relay.mjs');
const STATE = path.join(here, '..', '..', 'scripts', 'run-state.mjs');
const ID = 'P20261117.000001';
const SLUG = `${ID}/01-feature`;

const tmps = [];
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-cap-home-'));
tmps.push(home);
const env = { ...process.env, MCSPARROW_HOME: path.join(home, '.mcsparrow'), HOME: home, USERPROFILE: home };
delete env.AICO_GUARDS;
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-cap-'));
  tmps.push(root);
  const dir = path.join(root, '.company', 'work', ID, '01-feature');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', ID, '00-project.md'), 'Demo project\n');
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now() - 60000), ev: 'start' })}\n`);
  return { root, dir, forms: path.join(dir, 'forms.jsonl') };
}

const run = (script, fx, args, input) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: fx.root, env, input, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};

const QUESTIONS = [{
  q: 'Gate ship?', header: 'Gate', multi: false,
  options: [{ label: 'Pass', description: 'Pass it', result: 'passed' }, { label: 'Stop', description: 'Stop it', result: 'stopped' }],
}];
let seq = 0;
function open(fx, kind = 'gate:ship') {
  const file = path.join(fx.root, `q-${seq++}.json`);
  fs.writeFileSync(file, JSON.stringify(QUESTIONS));
  return run(RELAY, fx, ['open', SLUG, kind, file]);
}

// The exact line `open` writes for form f02 (its `at` is always 20 chars), so the cap boundary can be hit to the byte.
const openLine = (kind = 'gate:ship') => `${JSON.stringify({ v: 1, at: iso(0), ev: 'open', id: 'f02', kind, questions: QUESTIONS })}\n`;

// An answered form f01 (valid rows, no open form) padded so the file is exactly `size` bytes.
function fill(fx, size) {
  const head = `${JSON.stringify({ v: 1, at: iso(Date.now() - 50000), ev: 'open', id: 'f01', kind: 'ask', questions: [] })}\n`;
  const mk = (pad) => `${JSON.stringify({ v: 1, at: iso(Date.now() - 40000), ev: 'answer', id: 'f01', src: 'hook', answers: [], pad })}\n`;
  const pad = 'x'.repeat(size - Buffer.byteLength(head) - Buffer.byteLength(mk('')));
  fs.writeFileSync(fx.forms, head + mk(pad));
  assert.equal(fs.statSync(fx.forms).size, size);
}

test('R-8 MAX_FORMS is 256 KiB', () => {
  assert.equal(MAX_FORMS, 256 * 1024);
});

test('R-8 open whose row would pass the cap by one byte fails and leaves forms.jsonl unchanged', () => {
  const fx = fixture();
  fill(fx, MAX_FORMS - Buffer.byteLength(openLine()) + 1);
  const before = fs.readFileSync(fx.forms);
  const r = open(fx);
  assert.equal(r.code, 1, r.out + r.err);
  assert.equal(r.out, '');
  assert.match(r.err, /^error: failed/);
  assert.deepEqual(fs.readFileSync(fx.forms), before, 'no byte written');
});

test('R-8 open whose row lands exactly on the cap appends and the file stays readable by the gate', () => {
  const fx = fixture();
  fill(fx, MAX_FORMS - Buffer.byteLength(openLine()));
  const r = open(fx);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(fs.statSync(fx.forms).size, MAX_FORMS);
  const rows = fs.readFileSync(fx.forms, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.at(-1).ev, 'open');
  assert.equal(rows.at(-1).id, 'f02');
});

test('R-8 answer hook whose row would pass the cap records nothing and leaves forms.jsonl unchanged', () => {
  const fx = fixture();
  const row = { v: 1, at: iso(Date.now() - 30000), ev: 'open', id: 'f01', kind: 'gate:ship', questions: QUESTIONS };
  const base = Buffer.byteLength(`${JSON.stringify({ ...row, pad: '' })}\n`);
  fs.writeFileSync(fx.forms, `${JSON.stringify({ ...row, pad: 'x'.repeat(MAX_FORMS - 20 - base) })}\n`);
  assert.equal(fs.statSync(fx.forms).size, MAX_FORMS - 20);
  const before = fs.readFileSync(fx.forms);
  const payload = {
    cwd: fx.root, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
    tool_input: { questions: QUESTIONS.map((q) => ({ question: q.q, header: q.header, multiSelect: q.multi, options: q.options.map((o) => ({ label: o.label, description: o.description })) })) },
    tool_response: { answers: { [QUESTIONS[0].q]: 'Pass' } },
  };
  const h = run(RELAY, fx, ['answer'], JSON.stringify(payload));
  assert.equal(h.code, 0, h.out + h.err);
  assert.deepEqual(fs.readFileSync(fx.forms), before, 'no byte written');
});

test('R-8 under the cap: open and answer append, and run-state gate reads the answer', () => {
  const fx = fixture();
  fill(fx, MAX_FORMS - 16 * 1024);
  const o = open(fx);
  assert.equal(o.code, 0, o.out + o.err);
  assert.match(o.out, /^form: f02$/m);
  const payload = {
    cwd: fx.root, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
    tool_input: { questions: QUESTIONS.map((q) => ({ question: q.q, header: q.header, multiSelect: q.multi, options: q.options.map((x) => ({ label: x.label, description: x.description })) })) },
    tool_response: { answers: { [QUESTIONS[0].q]: 'Pass' } },
  };
  const h = run(RELAY, fx, ['answer'], JSON.stringify(payload));
  assert.equal(h.code, 0, h.out + h.err);
  const rows = fs.readFileSync(fx.forms, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.at(-1).ev, 'answer');
  assert.equal(rows.at(-1).id, 'f02');
  assert.ok(fs.statSync(fx.forms).size <= MAX_FORMS);
  const g = run(STATE, fx, ['gate', SLUG, 'ship', 'passed']);
  assert.equal(g.out.trim(), 'ok: gate ship passed', g.out + g.err);
  assert.equal(g.code, 0);
});
