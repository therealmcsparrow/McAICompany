// Scope of the ended-run answer (lead-relay v1): ambiguity and run-less folders stay skipped, live runs win, and `open` refuses
// a form that an ended twin would make ambiguous. Companion to answer-ended-run.test.mjs (QA-owned).
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
const payload = JSON.stringify({
  hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
  tool_input: { questions: questions.map((q) => ({ question: q.q, header: q.header, multiSelect: q.multi, options: q.options })) },
  tool_response: { answers: { [questions[0].q]: 'Build on branch' } },
});

let root;
const relay = (args, input) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env, encoding: 'utf8', timeout: 20000, input });
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-scope-')); roots.push(root); fs.writeFileSync(path.join(root, 'q.json'), JSON.stringify(questions)); });

function run(slug, ended) {
  const dir = path.join(root, '.company', 'work', ...slug.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', slug.split('/')[0], '00-project.md'), 'Demo\n');
  const t = Date.now() - 600000;
  const rows = ended ? [{ ev: 'start' }, { ev: 'end', outcome: 'ship' }] : [{ ev: 'start' }];
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), rows.map((r, i) => JSON.stringify({ v: 1, at: iso(t + i * 1000), ...r })).join('\n') + '\n');
}
const open = (slug) => relay(['open', slug, 'ask', path.join(root, 'q.json')]);
const read = (slug) => relay(['read', slug, 'f01', '--json']).stdout;
const A = 'P20261118.000002/02-lead';
const B = 'P20261118.000003/02-lead';

test('a running run keeps taking its answer (unchanged)', () => {
  run(A, false);
  assert.equal(open(A).status, 0);
  relay(['answer'], payload);
  assert.match(read(A), /"labels":\["Build on branch"\]/);
});

test('two ended runs holding the same open form: open refuses the second, so no ambiguous answer', () => {
  run(A, true); run(B, true);
  assert.equal(open(A).status, 0);
  const o = open(B);
  assert.notEqual(o.status, 0);
  assert.match(o.stdout + o.stderr, /same questions open in run/);
});

test('ambiguity stays skipped: two ended open forms written past the refusal record nothing', () => {
  run(A, true); run(B, true);
  for (const s of [A, B]) {
    const dir = path.join(root, '.company', 'work', ...s.split('/'));
    fs.writeFileSync(path.join(dir, 'forms.jsonl'), JSON.stringify({ v: 1, at: iso(Date.now() - 1000), ev: 'open', id: 'f01', kind: 'ask', questions }) + '\n');
  }
  relay(['answer'], payload);
  assert.match(read(A), /answer: none/);
  assert.match(read(B), /answer: none/);
});

test('a live run wins over an ended run with the same open form', () => {
  run(A, true); run(B, false);
  assert.equal(open(A).status, 0);
  assert.equal(open(B).status, 0, 'an ended twin does not block a live run');
  relay(['answer'], payload);
  assert.match(read(B), /"labels":\["Build on branch"\]/);
  assert.match(read(A), /answer: none/);
});

test('open on an ended run is refused while a live run holds the same form', () => {
  run(A, true); run(B, false);
  assert.equal(open(B).status, 0);
  assert.notEqual(open(A).status, 0);
});

test('a run-less folder (no run-state) is still skipped', () => {
  const dir = path.join(root, '.company', 'work', 'P20261118.000002', '02-lead');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'forms.jsonl'), JSON.stringify({ v: 1, at: iso(Date.now() - 1000), ev: 'open', id: 'f01', kind: 'ask', questions }) + '\n');
  relay(['answer'], payload);
  assert.equal(fs.readFileSync(path.join(dir, 'forms.jsonl'), 'utf8').includes('"ev":"answer"'), false);
});
