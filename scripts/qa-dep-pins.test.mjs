// Tests: AC19 dependency pins. A pin mismatch is reported by name through the check command and the host,
// never as a crash, in a copied plugin root.
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

function pinnedRoot() {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-deppins-'));
  tmp.push(dst);
  for (const d of ['hooks', 'scripts', 'mods', 'company']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dst, d), { recursive: true });
  const w = spawnSync(process.execPath, [path.join(dst, 'scripts', 'hook-pins.mjs'), 'write'], { encoding: 'utf8' });
  assert.equal(w.status, 0, w.stderr);
  return dst;
}

const pins = (root) => spawnSync(process.execPath, [path.join(root, 'scripts', 'hook-pins.mjs'), 'check', '--root', root], { encoding: 'utf8' });

function host(root, payload) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-deppins-home-'));
  tmp.push(home);
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'hook-host.mjs')], {
    input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home }
  });
  return { r, out: r.stdout.trim() === '' ? null : JSON.parse(r.stdout) };
}

const base = { session_id: 'qdp', transcript_path: 'qdp.jsonl', cwd: ROOT };
const pre = (tool, input) => ({ ...base, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: 'q1' });

test('AC19: freshly written pins check ok', () => {
  const r = pins(pinnedRoot());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /pins ok/);
});

test('AC19: an edited imported script is reported by name, exit 1, no stack trace', () => {
  const root = pinnedRoot();
  fs.appendFileSync(path.join(root, 'scripts', 'run-state.mjs'), '\n// edit\n');
  const r = pins(root);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /pins-mismatch: .*scripts\/run-state\.mjs/);
  assert.equal(r.stderr, '');
});

test('AC19: a deleted imported script is a mismatch report, not a crash', () => {
  const root = pinnedRoot();
  fs.rmSync(path.join(root, 'scripts', 'run-state.mjs'));
  const r = pins(root);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /pins-mismatch/);
  assert.doesNotMatch(r.stderr, /at .*\.mjs|Error:/);
});

test('AC19: the host denies a Write call with pins-mismatch naming the file, exit 0, empty stderr', () => {
  const root = pinnedRoot();
  fs.appendFileSync(path.join(root, 'scripts', 'run-state.mjs'), '\n// edit\n');
  const { r, out } = host(root, pre('Write', { file_path: path.join(root, 'x.txt'), content: 'a' }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /pins-mismatch.*scripts\/run-state\.mjs/);
});

test('AC19: an edited pinned hook file is also a pins-mismatch answer from the host', () => {
  const root = pinnedRoot();
  const f = fs.readdirSync(path.join(root, 'hooks', 'rules')).find((n) => n.endsWith('.mjs') && !n.endsWith('.test.mjs'));
  fs.appendFileSync(path.join(root, 'hooks', 'rules', f), '\n// edit\n');
  const { r, out } = host(root, pre('Bash', { command: 'ls' }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, new RegExp(`pins-mismatch.*${f.replace('.', '\.')}`));
});

test('AC19: AICO_GUARDS=off still lets the call through despite a mismatch', () => {
  const root = pinnedRoot();
  fs.appendFileSync(path.join(root, 'scripts', 'run-state.mjs'), '\n// edit\n');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-deppins-home-'));
  tmp.push(home);
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'hook-host.mjs')], {
    input: JSON.stringify(pre('Bash', { command: 'ls' })), encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home, AICO_GUARDS: 'off' }
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});
