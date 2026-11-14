// Tests (backend, R-2): the SessionStart fixture check on the shipped plugin tree. Fixtures that carry a
// `_synthetic` run/token state are fed through the host's supported path; plugin paths use ${CLAUDE_PLUGIN_ROOT}.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const homes = [];
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });

// Copy of the shipped tree with pins rewritten, so other Steps' pinned-file edits cannot mask the fixture result.
function copyRoot() {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-fxroot-'));
  homes.push(dst);
  for (const d of ['hooks', 'scripts', 'mods', 'skills', 'docs']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dst, d), { recursive: true });
  for (const f of ['package.json']) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(dst, f));
  const w = spawnSync(process.execPath, [path.join(dst, 'scripts', 'hook-pins.mjs'), 'write'], { encoding: 'utf8' });
  assert.equal(w.status, 0, w.stderr);
  return dst;
}

function sessionStart() {
  const root = copyRoot();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-fx-'));
  homes.push(home);
  const input = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'fx', transcript_path: 'fx.jsonl', cwd: ROOT, source: 'startup' });
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'hook-host.mjs')], { input, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home } });
  let msg = '';
  try { msg = JSON.parse(r.stdout).systemMessage ?? ''; } catch { /* silent */ }
  return msg;
}

test('R-2 the shipped cap.M1 and self-protect fixtures pass the session start check', () => {
  const msg = sessionStart();
  assert.doesNotMatch(msg, /pins-mismatch/, msg);
  assert.doesNotMatch(msg, /cap\.M1/, msg);
  assert.doesNotMatch(msg, /self-protect/, msg);
});

test('R-2 the self-protect plugin-rule fixture builds its path from CLAUDE_PLUGIN_ROOT', () => {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'fixtures', 'self-protect.M-SEC1', 'block-write-plugin-rule.json'), 'utf8'));
  assert.match(j.tool_input.file_path, /^\$\{CLAUDE_PLUGIN_ROOT\}\//);
});
