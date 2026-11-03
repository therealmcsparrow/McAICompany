// Regression: the Lead hand-over loop (run "2026-11-03 07.12 - Lead Session Mcp Connect").
// Evidence: every fresh Lead session starts at about 55k tokens (system prompt, tools, skill and agent listings: first main
// assistant row 55558 / 53579 / 53619 / 55513 in the four sessions) and the playbook boot reading (aico:fix, aico:pipeline,
// references) adds about 30k, so the context-guard `lead` branch freezes at HANDOVER_AT (85500) before the first Step is
// dispatched. Session 45d64ef2d458 went 55558 -> 87240 in 37 seconds and was frozen 3 seconds after `begin`.
// Suspected Module: scripts/context-guard.mjs `lead` (measures total context against HANDOVER_AT) with
// scripts/lead-handover.mjs `transcriptTokens` (last row only, no baseline).
// Design-neutral invariant tested: a session that has grown by only the boot reading (32k above its own first row) is not frozen.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pre } from '../../scripts/context-guard.mjs';
import { append } from '../../scripts/run-state.mjs';

const SLUG = '2026-11-03 07.12 - Lead Fresh Session Test';
const SESSION = 'sess-fresh-lead-1';
const NOW = Math.floor(Date.now() / 1000) * 1000;
const usage = (n) => ({ input_tokens: 2, output_tokens: 200, cache_creation_input_tokens: 3000, cache_read_input_tokens: n - 3202 });
const row = (n) => `${JSON.stringify({ type: 'assistant', isSidechain: false, message: { usage: usage(n) } })}\n`;

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

// A run with a Lead transcript holding the given main-chain readings in order (first = session start).
function fixture(readings) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'context-guard-fresh-'));
  tmps.push(base);
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const dir = path.join(root, '.company', 'work', SLUG);
  fs.mkdirSync(dir, { recursive: true });
  append(root, SLUG, { ev: 'start' }, { now: NOW - 60000 });
  const proj = path.join(claudeDir, 'projects', 'p');
  fs.mkdirSync(proj, { recursive: true });
  const transcript = path.join(proj, 'lead.jsonl');
  fs.writeFileSync(transcript, readings.map(row).join(''));
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', transcript_path: transcript, session_id: SESSION, tool_name: 'Bash', tool_input: {} });
  const record = () => {
    const f = path.join(dir, 'lead-handover.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  return { input, opts: { root, claudeDir, env: {}, now: NOW }, record };
}

describe('Lead hand-over loop: a fresh session is not frozen by its own boot reading', () => {
  test('boot reading only (55558 -> 87240, the first real session) writes no hand-over and stays silent', () => {
    const f = fixture([55558, 60177, 75333, 82641, 87240]);
    const r = pre(f.input, f.opts);
    assert.deepEqual(r, { code: 0, out: '', err: '' });
    assert.equal(f.record().filter((e) => e.ev === 'handover').length, 0);
  });

  test('boot reading only (53619 -> 86858, the third real session) is not frozen', () => {
    const f = fixture([53619, 67759, 86858]);
    const r = pre(f.input, f.opts);
    assert.deepEqual(r, { code: 0, out: '', err: '' });
    assert.equal(f.record().filter((e) => e.ev === 'handover').length, 0);
  });

  test('control: a session far over the point (55558 -> 150000) is still frozen', () => {
    const f = fixture([55558, 100000, 150000]);
    const r = pre(f.input, f.opts);
    assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(f.record().filter((e) => e.ev === 'handover').length, 1);
  });
});
