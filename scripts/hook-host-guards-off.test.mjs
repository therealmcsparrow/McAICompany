// Regression: with AICO_GUARDS=off the host must not
// append a `bg` guard row: the Lead opted out of guard bookkeeping, only the one `guards-off` row is written.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { capEnv, cleanup } from '../tests/context-guard/cap-engine.mjs';
import { makeEnv, startLead, cleanup as cleanupEnv } from '../hooks/fixtures/engine/harness.mjs';

after(cleanup);
after(cleanupEnv);
const bg = { command: 'sleep 1', run_in_background: true };

async function leadPre(guardEnv) {
  const fx = await capEnv();
  fx.bootLead();
  const t = fx.env.transcript('lead-sess-lead-1', [{ type: 'assistant', isSidechain: false, message: { model: 'claude-opus-4-1', usage: { input_tokens: 50000, output_tokens: 1 } } }]);
  const r = fx.env.run(fx.env.event('PreToolUse', { tool_name: 'Bash', tool_input: bg, transcript_path: t, session_id: 'sess-lead-1' }), { env: guardEnv });
  assert.equal(r.code, 0, r.err);
  return fx.guardRecord();
}

test('control: guards on, a Lead background launch writes no bg row (context-guard v3.0 retired it)', async () => {
  const rows = await leadPre({});
  assert.equal(rows.filter((r) => r.ev === 'bg').length, 0, JSON.stringify(rows));
});

test('S-6: AICO_GUARDS=off, a Lead background launch writes no bg row', async () => {
  const rows = await leadPre({ AICO_GUARDS: 'off' });
  assert.equal(rows.filter((r) => r.ev === 'bg').length, 0, `bg row written with guards off: ${JSON.stringify(rows)}`);
  assert.equal(rows.filter((r) => r.ev === 'guards-off').length, 1, 'the one guards-off row is still recorded');
});

// AICO_GUARDS=off with a pins mismatch falls back to text checks; any prefix of -EncodedCommand
// after any dash-like lead denies (fail closed), in any case.
const OFF = { env: { AICO_GUARDS: 'off' } };
function mismatchEnv() {
  const env = makeEnv();
  startLead(env);
  fs.appendFileSync(path.join(env.plugin, 'hooks', 'manifests', 'stub-guard.json'), ' ');
  return env;
}
const verdict = (r) => r.json?.hookSpecificOutput?.permissionDecision ?? 'allow';
const reason = (r) => r.json?.hookSpecificOutput?.permissionDecisionReason ?? '';
const PAYLOAD = Buffer.from('Write-Output 1', 'utf16le').toString('base64');
const FULL = 'EncodedCommand';
const PD = ['‐', '‑', '‒', '–', '—', '―', '−'];
const label = (s) => s.replace(/[^\x00-\x7f]/g, (c) => `U+${c.codePointAt(0).toString(16)}`);

test('guards off + pins mismatch: pwsh with any prefix of -EncodedCommand denies, any case', () => {
  const env = mismatchEnv();
  const flags = [];
  for (let i = 1; i <= FULL.length; i++) flags.push(`-${FULL.slice(0, i)}`, `-${FULL.slice(0, i).toUpperCase()}`);
  flags.push('-ec', '-EC', '-eNc');
  for (const f of flags) {
    const r = env.run(env.pre(`pwsh ${f} ${PAYLOAD}`), OFF);
    assert.equal(verdict(r), 'deny', `pwsh ${f}`);
    assert.match(reason(r), /encoded PowerShell/, f);
  }
});

test('guards off + pins mismatch: --enc, /enc, and every dash lead deny for -enc, -EncodedCommand and -e', () => {
  const env = mismatchEnv();
  for (const lead of ['--', '/', '---', ...PD, `${PD[0]}${PD[6]}`]) {
    for (const flag of ['e', 'ec', 'enc', 'EncodedCommand', 'ENCODEDCOMMAND']) {
      const cmd = `pwsh ${lead}${flag} ${PAYLOAD}`;
      assert.equal(verdict(env.run(env.pre(cmd), OFF)), 'deny', label(cmd));
    }
  }
});

test('guards off + pins mismatch: powershell, quoted, colon, no leading space and Bash-wrapped forms deny', () => {
  const env = mismatchEnv();
  for (const cmd of [
    `powershell --enc ${PAYLOAD}`, `pwsh -EncodedCommand:${PAYLOAD}`, `pwsh "-enc" ${PAYLOAD}`, `echo x;pwsh -enc ${PAYLOAD}`,
    `pwsh -NoProfile -e ${PAYLOAD}`, `PWSH.EXE /EC ${PAYLOAD}`, `bash -c 'pwsh --enc ${PAYLOAD}'`,
  ]) assert.equal(verdict(env.run(env.pre(cmd), OFF)), 'deny', cmd);
});

test('guards off + pins mismatch: pwsh without an encoded flag, and non-pwsh text, still allow', () => {
  const env = mismatchEnv();
  for (const cmd of [
    'pwsh -ExecutionPolicy Bypass -File x.ps1', 'pwsh -NoProfile', 'pwsh -NoProfile -Command Write-Output', 'powershell -File a.ps1 -Verbose',
    'pwsh -Encx 1', 'pwsh -ecx 1', 'pwsh -EncodedCommandX 1', 'ls -e', 'git log --encoding=utf8', `echo -enc ${PAYLOAD}`,
    'pwsh -NoLogo',
  ]) assert.notEqual(verdict(env.run(env.pre(cmd), OFF)), 'deny', cmd);
});

// Under guards off with a pins mismatch the host also checks the JSON-decoded stdin strings, so a
// JSON-escaped dash or letter cannot hide the flag or the name. The escapes are written literally in the raw stdin text.
const esc = (s, chars) => s.replace(new RegExp(`[${chars}]`, 'g'), (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const rawPre = (env, command, chars) => esc(JSON.stringify(env.pre(command)), chars);

test('guards off + pins mismatch: JSON-escaped dash or name in stdin still denies encoded pwsh', () => {
  const env = mismatchEnv();
  const cmds = [`pwsh -enc ${PAYLOAD}`, `pwsh -EncodedCommand ${PAYLOAD}`, `powershell -e ${PAYLOAD}`];
  for (const cmd of cmds) {
    for (const [what, chars] of [['dash', '-'], ['name letters', 'wsh'], ['dash and name letters', '-wsh'], ['every letter', 'a-zA-Z']]) {
      const raw = rawPre(env, cmd, chars);
      if (!/\u00/.test(raw)) continue;
      const r = env.run(raw, OFF);
      assert.equal(verdict(r), 'deny', `${what}: ${raw.slice(0, 120)}`);
      assert.match(reason(r), /encoded PowerShell/, what);
    }
  }
  const lit = '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"p\\u0077sh \\u002denc AAAA"}}';
  assert.equal(verdict(env.run(lit, OFF)), 'deny', lit);
});

test('guards off + pins mismatch: an en dash written as a JSON escape in stdin still denies encoded pwsh', () => {
  const env = mismatchEnv();
  const lit = `{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"pwsh \\u2013enc ${PAYLOAD}"}}`;
  assert.equal(verdict(env.run(lit, OFF)), 'deny', lit);
});

test('guards off + pins mismatch: JSON-escaped pwsh without an encoded flag still allows', () => {
  const env = mismatchEnv();
  for (const cmd of ['pwsh -File a.ps1', 'pwsh -ExecutionPolicy Bypass -File x.ps1', 'powershell -NoProfile']) {
    for (const chars of ['-', 'wsh', '-wsh', 'a-zA-Z']) {
      const r = env.run(rawPre(env, cmd, chars), OFF);
      assert.notEqual(verdict(r), 'deny', `${chars}: ${cmd}`);
    }
  }
  const lit = '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"p\\u0077sh \\u002dFile a.ps1"}}';
  assert.notEqual(verdict(env.run(lit, OFF)), 'deny', lit);
});
