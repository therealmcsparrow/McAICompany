// lead-relay answer: a run whose only run-state activity is older than 12 h is `stale`, yet its open form must still record the answer (141 R-5).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '..', '..', 'scripts', 'lead-relay.mjs');
const ID = 'P20261117.000001';
const SLUG = `${ID}/01-feature`;

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-stale-home-'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-stale-'));
after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
const env = { ...process.env, MCSPARROW_HOME: path.join(home, '.mcsparrow'), HOME: home, USERPROFILE: home };
delete env.AICO_GUARDS;

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const run = (args, input) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env, input, encoding: 'utf8', timeout: 20000 });

test('answer is recorded for a run stale for over 12 h', () => {
  const dir = path.join(root, '.company', 'work', ID, '01-feature');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', ID, '00-project.md'), 'Demo project\n');
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now() - 13 * 3600000), ev: 'start' })}\n`);
  const qs = [{ q: 'Ship it?', header: 'Gate', multi: false, options: [{ label: 'Pass', description: 'Pass it' }, { label: 'Stop', description: 'Stop it' }] }];
  const file = path.join(root, 'q.json');
  fs.writeFileSync(file, JSON.stringify(qs));
  const o = run(['open', SLUG, 'ask', file]);
  assert.equal(o.status, 0, o.stdout + o.stderr);
  const payload = {
    cwd: root, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
    tool_input: { questions: qs.map((q) => ({ question: q.q, header: q.header, multiSelect: q.multi, options: q.options })) },
    tool_response: { answers: { 'Ship it?': 'Pass' } },
  };
  assert.equal(run(['answer'], JSON.stringify(payload)).status, 0);
  const rows = fs.readFileSync(path.join(dir, 'forms.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const got = rows.filter((r) => r.ev === 'answer');
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].answers, [{ labels: ['Pass'], other: null }]);
});
