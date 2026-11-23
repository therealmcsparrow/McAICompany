// Regression: the first Ship Gate form carried option results (approve/change/stop) that `run-state gate` never accepts
// (passed|changed|stopped), so the CEO's Approve was never recorded and the Gate was re-asked
// (runs P20261120.000001/01-lead f05->f06, P20261122.000001/01-fix f02->f03).
// Two parts: `lead-relay open` refuses a gate:<brief|plan|ship> option whose result is not a run-state gate word;
// the docs the Lead reads (gates.md) name those words.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'lead-relay.mjs');
const SLUG = 'P20261123.000001/01-fix';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-words-home-'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-words-'));
after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
const env = { ...process.env, MCSPARROW_HOME: path.join(home, '.mcsparrow'), HOME: home, USERPROFILE: home };
delete env.AICO_GUARDS;

const dir = path.join(root, '.company', 'work', ...SLUG.split('/'));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(root, '.company', 'work', SLUG.split('/')[0], '00-project.md'), 'Demo project\n');
fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: new Date(Date.now() - 60000).toISOString().replace(/\.\d{3}Z$/, 'Z'), ev: 'start' })}\n`);
const forms = path.join(dir, 'forms.jsonl');

afterEach(() => { fs.rmSync(forms, { force: true }); });

let n = 0;
const open = (kind, results) => {
  const f = path.join(root, `q${n}.json`);
  const labels = ['Approve', 'Change', 'Stop'];
  fs.writeFileSync(f, JSON.stringify([{ q: `${SLUG} gate question ${n++}?`, header: 'Gate', multi: false,
    options: results.map((result, i) => ({ label: labels[i], description: `${labels[i]} it`, result })) }]));
  return spawnSync(process.execPath, [SCRIPT, 'open', SLUG, kind, f], { cwd: root, env, encoding: 'utf8', timeout: 20000 });
};

for (const kind of ['gate:brief', 'gate:plan', 'gate:ship']) {
  test(`open ${kind} refuses option results that run-state gate does not accept (approve/change/stop)`, () => {
    const r = open(kind, ['approve', 'change', 'stop']);
    assert.equal(r.status, 1, `expected refusal, got: ${r.stdout}${r.stderr}`);
    const out = r.stdout + r.stderr;
    assert.ok(/refused/.test(out));
    for (const w of ['passed', 'changed', 'stopped']) assert.ok(out.includes(w), `refusal text lacks ${w}: ${out}`);
    assert.ok(!fs.existsSync(forms), 'nothing written');
  });
}

test('open gate:ship refuses a form where only one option has a bad result', () => {
  const r = open('gate:ship', ['passed', 'change', 'stopped']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(forms));
});

test('open gate:ship accepts passed|changed|stopped', () => {
  const r = open('gate:ship', ['passed', 'changed', 'stopped']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  fs.rmSync(forms);
});

test('gates.md names the result words the Lead must put on Gate options', () => {
  const txt = fs.readFileSync(path.join(REPO, 'skills', 'pipeline', 'references', 'gates.md'), 'utf8');
  for (const w of ['passed', 'changed', 'stopped']) assert.ok(txt.includes(w), `gates.md lacks result word ${w}`);
});
