// Tests: the SessionStart fixture check on the shipped plugin tree. Fixtures that carry a
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
function copyRoot(patch) {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-fxroot-'));
  homes.push(dst);
  for (const d of ['hooks', 'scripts', 'mods', 'skills', 'docs', 'company']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dst, d), { recursive: true });
  for (const f of ['package.json']) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(dst, f));
  if (patch) patch(dst);
  const w = spawnSync(process.execPath, [path.join(dst, 'scripts', 'hook-pins.mjs'), 'write'], { encoding: 'utf8' });
  assert.equal(w.status, 0, w.stderr);
  return dst;
}

function sessionStart(patch) {
  const root = copyRoot(patch);
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

test('the fixture replay has its own deadline, apart from the per-call runner deadline', () => {
  const msg = sessionStart((dst) => {
    const f = path.join(dst, 'hooks', 'lib', 'rule-runner.mjs');
    const src = fs.readFileSync(f, 'utf8');
    assert.match(src, /CALL_DEADLINE_MS = 3500;/);
    fs.writeFileSync(f, src.replace('CALL_DEADLINE_MS = 3500;', 'CALL_DEADLINE_MS = 1;'));
  });
  assert.doesNotMatch(msg, /fixture check failed/, msg);
});

test('R-2 the self-protect plugin-rule fixture builds its path from CLAUDE_PLUGIN_ROOT', () => {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'fixtures', 'self-protect.M-SEC1', 'block-write-plugin-rule.json'), 'utf8'));
  assert.match(j.tool_input.file_path, /^\$\{CLAUDE_PLUGIN_ROOT\}\//);
});

test('R-2 a renamed real field in a cap.M1 fixture still fails the session start check', () => {
  const root = copyRoot();
  const p = path.join(root, 'hooks', 'fixtures', 'cap.M1', 'block-lead-read-at-freeze.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.tool_name_renamed = j.tool_name;
  delete j.tool_name;
  fs.writeFileSync(p, JSON.stringify(j));
  const w = spawnSync(process.execPath, [path.join(root, 'scripts', 'hook-pins.mjs'), 'write'], { encoding: 'utf8' });
  assert.equal(w.status, 0, w.stderr);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-fx-'));
  homes.push(home);
  const input = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'fx', transcript_path: 'fx.jsonl', cwd: ROOT, source: 'startup' });
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'hook-host.mjs')], { input, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home } });
  assert.match(JSON.parse(r.stdout).systemMessage, /fixture check failed for cap.M1/);
});

// A host without the fixture's drive (CI Windows has no Z:, POSIX reads `z:/x` as a cwd-relative name) must judge a pass fixture
// the same as a dev machine, so a pass fixture carries no drive-letter paths and its run folder is resolved against cwd.
test('R-2 cap.M1 pass fixtures carry no drive letter and pass the check from a cwd on any drive', () => {
  const dir = path.join(ROOT, 'hooks', 'fixtures', 'cap.M1');
  for (const n of fs.readdirSync(dir).filter((x) => /^pass-.+\.json$/.test(x))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
    if (j.tool_name !== 'Write') continue; // only a Write is judged by its path against the run folder
    for (const v of [j.tool_input?.file_path, j._synthetic?.run?.folder]) {
      if (typeof v === 'string') assert.doesNotMatch(v, /^[a-z]:/i, `${n}: ${v}`);
    }
  }
  const root = copyRoot();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-fx-'));
  homes.push(home);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-fxcwd-'));
  homes.push(cwd);
  const input = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'fx', transcript_path: 'fx.jsonl', cwd, source: 'startup' });
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'hook-host.mjs')], { input, cwd, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home } });
  let msg = '';
  try { msg = JSON.parse(r.stdout).systemMessage ?? ''; } catch { /* silent */ }
  assert.doesNotMatch(msg, /fixture check failed/, msg);
});
