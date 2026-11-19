// Bug: a form opened on a run that already ended (end outcome ship) was never recorded by the `answer` hook,
// so `lead-relay read` showed "answer: none" and the Lead asked again (run P20261118.000002, form f03 answered 3 times).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '..', '..', 'scripts', 'lead-relay.mjs');
const SLUG = 'P20261118.000002/02-lead';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-ended-home-'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-ended-'));
after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
const env = { ...process.env, MCSPARROW_HOME: path.join(home, '.mcsparrow'), HOME: home, USERPROFILE: home };
delete env.AICO_GUARDS;

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const relay = (args, input) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env, encoding: 'utf8', timeout: 20000, input });
const dir = path.join(root, '.company', 'work', ...SLUG.split('/'));

const questions = [{ q: 'PR is open. How do I handle it?', header: 'PR', multi: false, options: [{ label: 'Build on branch', description: 'Work on its branch' }, { label: 'Wait for merge', description: 'Stop now' }] }];

test('an answer to a form opened on an ended run (outcome ship) is recorded and readable', () => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', SLUG.split('/')[0], '00-project.md'), 'Demo\n');
  const t = Date.now() - 600000;
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), [{ ev: 'start' }, { ev: 'end', outcome: 'ship' }].map((r, i) => JSON.stringify({ v: 1, at: iso(t + i * 1000), ...r })).join('\n') + '\n');
  const qf = path.join(root, 'q.json');
  fs.writeFileSync(qf, JSON.stringify(questions));

  const o = relay(['open', SLUG, 'ask', qf]);
  assert.equal(o.status, 0, o.stdout + o.stderr);

  const payload = {
    hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
    tool_input: { questions: questions.map((q) => ({ question: q.q, header: q.header, multiSelect: q.multi, options: q.options })) },
    tool_response: { answers: { [questions[0].q]: 'Build on branch' } },
  };
  const a = relay(['answer'], JSON.stringify(payload));
  assert.equal(a.status, 0, a.stderr);

  const r = relay(['read', SLUG, 'f01', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!r.stdout.includes('answer: none'), `answer lost on ended run:\n${r.stdout}`);
  assert.match(r.stdout, /"labels":\["Build on branch"\]/);
});
