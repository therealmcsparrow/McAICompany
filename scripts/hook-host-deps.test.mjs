// Tests: a changed script outside the pinned folders (an import of the run scripts) is a pins-mismatch answer
// of the host, not a crash, and AICO_GUARDS=off still lets the Lead through.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = [];
after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); });

function changedDepRoot() {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-deproot-'));
  tmp.push(dst);
  for (const d of ['hooks', 'scripts', 'mods', 'company']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dst, d), { recursive: true });
  const w = spawnSync(process.execPath, [path.join(dst, 'scripts', 'hook-pins.mjs'), 'write'], { encoding: 'utf8' });
  assert.equal(w.status, 0, w.stderr);
  fs.appendFileSync(path.join(dst, 'scripts', 'run-state.mjs'), '\n// edit\n');
  return dst;
}

function host(root, payload, env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-dephome-'));
  tmp.push(home);
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'hook-host.mjs')], {
    input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home, ...env }
  });
  return r.stdout.trim() === '' ? null : JSON.parse(r.stdout);
}

const base = { session_id: 'dp', transcript_path: 'dp.jsonl', cwd: ROOT };

test('SessionStart names the changed dependency file as pins-mismatch', () => {
  const out = host(changedDepRoot(), { ...base, hook_event_name: 'SessionStart', source: 'startup' });
  assert.match(out.systemMessage, /pins-mismatch/);
  assert.match(out.systemMessage, /scripts\/run-state\.mjs/);
});

test('a guarded call is denied with pins-mismatch naming the file, not a crash', () => {
  const out = host(changedDepRoot(), { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1' });
  const why = out.hookSpecificOutput.permissionDecisionReason;
  assert.match(why, /pins-mismatch/);
  assert.match(why, /scripts\/run-state\.mjs/);
  assert.doesNotMatch(why, /crash/);
});

test('AICO_GUARDS=off lets the Lead through despite the mismatch', () => {
  const out = host(changedDepRoot(), { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1' }, { AICO_GUARDS: 'off' });
  assert.equal(out, null);
});
