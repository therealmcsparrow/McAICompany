// Bug P20261119.000001 (a): main may never get the Lead's STATUS (platform backgrounds the spawn). The SubagentStop hook
// sees the Lead's last message, so `lead-relay record` stores its STATUS block and `lead-relay result` prints it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'lead-relay.mjs');
const ID = 'P20261119.000009';
const SLUG = `${ID}/02-lead`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-result-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const dir = path.join(root, '.company', 'work', ID, '02-lead');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: '2026-11-19T10:00:00Z', ev: 'start' })}\n`);
const run = (args, input) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', input, timeout: 20000 });
const stop = (over) => JSON.stringify({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'aico:project-manager', last_assistant_message: `STATUS: done\nrun: .company/work/${SLUG}\nsummary: ok`, ...over });

test('result is none before a Lead stopped', () => {
  const r = run(['result', SLUG]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /result: none/);
});
test('record stores the Lead STATUS block, result prints it', () => {
  const h = run(['record'], stop());
  assert.equal(h.status, 0);
  const r = run(['result', SLUG]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /STATUS: done\nrun: .company\/work\/P20261119.000009\/02-lead\nsummary: ok/);
});
test('record ignores a non-Lead, a message without STATUS and an unknown run', () => {
  run(['record'], stop({ agent_type: 'aico:qa', last_assistant_message: `STATUS: blocked\nrun: .company/work/${SLUG}\nreason: x` }));
  run(['record'], stop({ last_assistant_message: `all good\nrun: .company/work/${SLUG}` }));
  run(['record'], stop({ last_assistant_message: 'STATUS: blocked\nrun: .company/work/P20261119.000008/01-x\nreason: x' }));
  const r = run(['result', SLUG]);
  assert.match(r.stdout, /STATUS: done/);
  assert.equal(fs.existsSync(path.join(root, '.company', 'work', 'P20261119.000008')), false);
});
