// lead-relay open/again: the same questions open in another running or stale run are refused, so `answer` never matches two forms.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '..', '..', 'scripts', 'lead-relay.mjs');
const A = 'P20261116.000001/01-feature';
const B = 'P20261117.000001/01-feature';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-shared-home-'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-shared-'));
after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
const env = { ...process.env, MCSPARROW_HOME: path.join(home, '.mcsparrow'), HOME: home, USERPROFILE: home };
delete env.AICO_GUARDS;

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const relay = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env, encoding: 'utf8', timeout: 20000 });
const dirOf = (slug) => path.join(root, '.company', 'work', ...slug.split('/'));

function setup(slug, ageMs) {
  const id = slug.split('/')[0];
  fs.mkdirSync(dirOf(slug), { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', id, '00-project.md'), 'Demo project\n');
  fs.writeFileSync(path.join(dirOf(slug), 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now() - ageMs), ev: 'start' })}\n`);
}
const qfile = (name, q) => {
  const f = path.join(root, name);
  fs.writeFileSync(f, JSON.stringify([{ q, header: 'Gate', multi: false, options: [{ label: 'Pass', description: 'Pass it' }, { label: 'Stop', description: 'Stop it' }] }]));
  return f;
};
const formsB = () => path.join(dirOf(B), 'forms.jsonl');

test('the same questions open in another run are refused by open and again; allowed once that run ends', () => {
  setup(A, 13 * 3600000);
  setup(B, 60000);
  const same = qfile('same.json', 'Ship it?');

  // (1) run A (stale) opens the form
  const a = relay(['open', A, 'ask', same]);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  const rowA = fs.readFileSync(path.join(dirOf(A), 'forms.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))[0];

  // (2) run B opens the same questions: refused, nothing recorded
  const b = relay(['open', B, 'ask', same]);
  assert.equal(b.status, 1);
  assert.ok((b.stdout + b.stderr).includes(`refused: same questions open in run ${A}`), b.stdout + b.stderr);
  assert.ok(!fs.existsSync(formsB()));

  // a different question text is accepted
  const other = relay(['open', B, 'ask', qfile('other.json', 'Another question?')]);
  assert.equal(other.status, 0, other.stdout + other.stderr);
  fs.rmSync(formsB());

  // (3) again on an identical open row written straight into B: same refusal
  fs.writeFileSync(formsB(), `${JSON.stringify(rowA)}\n`);
  const again = relay(['again', B, rowA.id]);
  assert.equal(again.status, 1);
  assert.ok((again.stdout + again.stderr).includes(`refused: same questions open in run ${A}`), again.stdout + again.stderr);
  fs.rmSync(formsB());

  // (4) run A ended: B may open the same questions
  fs.appendFileSync(path.join(dirOf(A), 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now()), ev: 'end', outcome: 'abort' })}\n`);
  const last = relay(['open', B, 'ask', same]);
  assert.equal(last.status, 0, last.stdout + last.stderr);
});

test('a Gate form open in run A refuses the same-text ask form in run B, by open and again (R-11)', () => {
  const A2 = 'P20261115.000001/01-feature';
  setup(A2, 13 * 3600000);
  fs.rmSync(path.join(dirOf(B), 'forms.jsonl'), { force: true });
  const opts = (result) => [{ label: 'Pass', description: 'Pass it', ...(result ? { result: 'pass' } : {}) }, { label: 'Stop', description: 'Stop it', ...(result ? { result: 'stop' } : {}) }];
  const mk = (name, result) => {
    const f = path.join(root, name);
    fs.writeFileSync(f, JSON.stringify([{ q: 'Gate-vs-ask text?', header: 'Gate', multi: false, options: opts(result) }]));
    return f;
  };

  const g = relay(['open', A2, 'gate:ship', mk('gate.json', true)]);
  assert.equal(g.status, 0, g.stdout + g.stderr);
  const rowG = JSON.parse(fs.readFileSync(path.join(dirOf(A2), 'forms.jsonl'), 'utf8').trim().split('\n')[0]);
  assert.equal(rowG.kind, 'gate:ship');
  assert.equal(rowG.questions[0].options[0].result, 'pass');

  const b = relay(['open', B, 'ask', mk('ask.json', false)]);
  assert.equal(b.status, 1, b.stdout + b.stderr);
  assert.ok((b.stdout + b.stderr).includes(`refused: same questions open in run ${A2}`), b.stdout + b.stderr);
  assert.ok(!fs.existsSync(formsB()));

  // again on the ask-shaped row (no result) written into B
  const askRow = { ...rowG, kind: 'ask', questions: [{ ...rowG.questions[0], options: rowG.questions[0].options.map(({ result, ...o }) => o) }] };
  fs.writeFileSync(formsB(), `${JSON.stringify(askRow)}\n`);
  const again = relay(['again', B, askRow.id]);
  assert.equal(again.status, 1, again.stdout + again.stderr);
  assert.ok((again.stdout + again.stderr).includes(`refused: same questions open in run ${A2}`), again.stdout + again.stderr);
  fs.rmSync(formsB());
});
