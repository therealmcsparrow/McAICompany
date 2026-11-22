// Bug P20261119.000001 (c): `again` for a form of an ended run prints the needs-ceo block, so main asks the CEO in vain
// (answer records only a form opened at or after the end). Expected: refused: form opened before the run ended. Module: scripts/lead-relay.mjs (cmdAgain).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '..', '..', 'scripts', 'lead-relay.mjs');
const ID = 'P20261118.000002';
const SLUG = `${ID}/02-lead`;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-ended-home-'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-ended-'));
after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
const env = { ...process.env, MCSPARROW_HOME: path.join(home, '.mcsparrow'), HOME: home, USERPROFILE: home };
delete env.AICO_GUARDS;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env, encoding: 'utf8', timeout: 20000 });

test('again refuses an open form of an ended run and says the run ended', () => {
  const dir = path.join(root, '.company', 'work', ID, '02-lead');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', ID, '00-project.md'), 'Demo project\n');
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now() - 600000), ev: 'start' })}\n`);
  const file = path.join(root, 'q.json');
  fs.writeFileSync(file, JSON.stringify([{ q: 'Ship it?', header: 'Gate', multi: false, options: [{ label: 'Pass', description: 'Pass it' }, { label: 'Stop', description: 'Stop it' }] }]));
  const o = run(['open', SLUG, 'ask', file]);
  assert.equal(o.status, 0, o.stdout + o.stderr);
  const end = spawnSync(process.execPath, [path.join(here, '..', '..', 'scripts', 'run-state.mjs'), 'end', SLUG, 'ship'], { cwd: root, env, encoding: 'utf8' });
  const st = spawnSync(process.execPath, [path.join(here, '..', '..', 'scripts', 'run-state.mjs'), 'show', SLUG, '--json'], { cwd: root, env, encoding: 'utf8' });
  assert.match(st.stdout + end.stdout + end.stderr, /"state":"ended"|ended/, `precondition: run ended\n${end.stdout}${end.stderr}${st.stdout}`);
  // The form was opened before the end: backdate it so the second-resolution clock cannot make it eligible.
  const forms = path.join(dir, 'forms.jsonl');
  fs.writeFileSync(forms, fs.readFileSync(forms, 'utf8').replace(/"at":"[^"]+"/, '"at":"2020-01-01T00:00:00Z"'));
  const a = run(['again', SLUG, 'f01']);
  assert.equal(a.status, 1, `expected refusal, got: ${a.stdout}`);
  assert.match(a.stdout + a.stderr, /refused: form opened before the run ended/);
  assert.doesNotMatch(a.stdout, /STATUS: needs-ceo/);
});
