import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pre, FREEZE_REASON, WAIT_REASON, FROZEN_LINE, NEW_SESSION_TOOL } from '../../scripts/context-guard.mjs';
import { newSessionCommand, HANDOVER_AT } from '../../scripts/lead-handover.mjs';
import { append } from '../../scripts/run-state.mjs';

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'context-guard.mjs');
const SLUG = '2026-11-02 18.32 - Lead Guard Test';
const SESSION = 'sess-lead-1';
const NOW = Date.parse('2026-11-02T18:40:00Z');
const hash12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const usage = (n) => ({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: n - 15 });
const quiet = { code: 0, out: '', err: '' };
const COMMAND = newSessionCommand(SLUG);

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

function fixture({ tokens = HANDOVER_AT, subs = [] } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'context-guard-lead-'));
  tmps.push(base);
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const dir = path.join(root, '.company', 'work', SLUG);
  fs.mkdirSync(dir, { recursive: true });
  append(root, SLUG, { ev: 'start' }, { now: NOW - 60000 });
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const [i, s] of subs.entries()) {
    const id = String(i + 1).padStart(12, '0');
    const line = (phase, at) => `${JSON.stringify({ v: 1, at: iso(at), ev: 'sub', role: 'backend-engineer', id, phase })}\n`;
    fs.appendFileSync(path.join(dir, 'run-state.jsonl'), line('start', NOW - 50000));
    if (s === 'stopped') fs.appendFileSync(path.join(dir, 'run-state.jsonl'), line('stop', NOW - 40000));
  }
  const proj = path.join(claudeDir, 'projects', 'p');
  fs.mkdirSync(proj, { recursive: true });
  const transcript = path.join(proj, 'lead.jsonl');
  const setTokens = (n) => fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', isSidechain: false, message: { usage: usage(n) } })}\n`);
  setTokens(tokens);
  const input = (extra = {}) => JSON.stringify({ hook_event_name: 'PreToolUse', transcript_path: transcript, session_id: SESSION, tool_name: 'Read', tool_input: {}, ...extra });
  const opts = { root, claudeDir, env: {}, now: NOW };
  const record = () => {
    const f = path.join(dir, 'lead-handover.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  return { base, root, claudeDir, dir, transcript, setTokens, input, opts, record };
}

const decision = (r) => JSON.parse(r.out).hookSpecificOutput;

describe('exact texts', () => {
  test('the three Lead texts', () => {
    assert.equal(FREEZE_REASON, 'aico context cap: the Lead Handoff is written and this session is frozen. Call lead_new_session, or show the CEO this command for a new session:');
    assert.equal(WAIT_REASON, 'aico context cap: no new Step from this session. Wait for the running Step; the Lead Handoff is written after it.');
    assert.equal(FROZEN_LINE, 'aico context cap: this session is frozen. Start a new session in the product folder with:');
    assert.equal(NEW_SESSION_TOOL, 'mcp__plugin_aico_lead-session__lead_new_session');
  });
});

describe('Lead below the hand-over point', () => {
  test('silent, nothing written, also with the guard off or no session id', () => {
    const fx = fixture({ tokens: HANDOVER_AT - 1 });
    assert.deepEqual(pre(fx.input(), fx.opts), quiet);
    assert.deepEqual(fx.record(), []);
    const fy = fixture();
    assert.deepEqual(pre(fy.input(), { ...fy.opts, env: { AICO_CONTEXT_GUARD: 'off' } }), quiet);
    assert.deepEqual(pre(fy.input({ session_id: undefined }), fy.opts), quiet);
    assert.deepEqual(pre(fy.input({ session_id: '' }), fy.opts), quiet);
    assert.deepEqual(pre(fy.input({ session_id: 'x'.repeat(513) }), fy.opts), quiet);
    assert.deepEqual(fy.record(), []);
  });

  test('unknown tokens and no active run fail open', () => {
    const fx = fixture();
    fs.rmSync(fx.transcript);
    assert.deepEqual(pre(fx.input(), fx.opts), quiet);
    const fy = fixture();
    fs.rmSync(path.join(fy.dir, 'run-state.jsonl'));
    assert.deepEqual(pre(fy.input(), fy.opts), quiet);
    assert.deepEqual(pre('not json', fy.opts), quiet);
  });
});

describe('Lead clean point', () => {
  test('the first call writes the Handoff and the context event, then denies with the freeze reason and the command', () => {
    const fx = fixture();
    const r = pre(fx.input(), fx.opts);
    assert.equal(r.code, 0);
    assert.equal(r.err, '');
    const d = decision(r);
    assert.equal(d.hookEventName, 'PreToolUse');
    assert.equal(d.permissionDecision, 'deny');
    assert.equal(d.permissionDecisionReason, `${FREEZE_REASON} ${COMMAND}`);
    const ev = fx.record().find((e) => e.ev === 'handover');
    assert.equal(ev.trigger, 'context');
    assert.equal(ev.session, hash12(SESSION));
    assert.equal(ev.tokens, HANDOVER_AT);
    assert.equal(ev.window, null);
    const text = fs.readFileSync(path.join(fx.dir, ev.file), 'utf8');
    assert.ok(text.endsWith(`- New session command: ${COMMAND}\n`));
    assert.ok(!text.includes(SESSION));
    assert.ok(!fs.existsSync(path.join(fx.dir, 'lead-freeze.lock')));
  });

  test('the MCP tool at the clean point is allowed, and still freezes the session', () => {
    const fx = fixture();
    assert.deepEqual(pre(fx.input({ tool_name: NEW_SESSION_TOOL }), fx.opts), quiet);
    assert.equal(fx.record().filter((e) => e.trigger === 'context').length, 1);
    assert.deepEqual(pre(fx.input({ tool_name: NEW_SESSION_TOOL }), fx.opts), quiet);
  });

  test('a failed write allows the tool; the next call retries', () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.dir, 'lead-freeze.lock'), '');
    assert.deepEqual(pre(fx.input(), fx.opts), quiet);
    assert.deepEqual(fx.record(), []);
    fs.rmSync(path.join(fx.dir, 'lead-freeze.lock'));
    assert.equal(decision(pre(fx.input(), fx.opts)).permissionDecision, 'deny');
  });

  test('a broken Lead record fails open', () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.dir, 'lead-handover.jsonl'), 'garbage\n');
    assert.deepEqual(pre(fx.input(), fx.opts), quiet);
  });
});

describe('Lead frozen', () => {
  function frozen() {
    const fx = fixture();
    pre(fx.input(), fx.opts);
    return fx;
  }

  test('any tool but the MCP tool stops the turn: stdout JSON, stderr and the exact line with the command', () => {
    const fx = frozen();
    const line = `${FROZEN_LINE} ${COMMAND}`;
    for (const tool of ['Read', 'Agent', 'Write', 'PowerShell']) {
      const r = pre(fx.input({ tool_name: tool }), fx.opts);
      assert.equal(r.code, 0);
      assert.deepEqual(JSON.parse(r.out), { continue: false, stopReason: line, systemMessage: line });
      assert.deepEqual(Object.keys(JSON.parse(r.out)), ['continue', 'stopReason', 'systemMessage']);
      assert.equal(r.err, `${line}\n`);
    }
    assert.equal(fx.record().filter((e) => e.ev === 'handover').length, 1);
  });

  test('the MCP tool is allowed', () => {
    const fx = frozen();
    assert.deepEqual(pre(fx.input({ tool_name: NEW_SESSION_TOOL }), fx.opts), quiet);
  });

  test('a frozen session stays frozen with a Step running, and a new session is not frozen by the old record', () => {
    const fx = frozen();
    fs.appendFileSync(path.join(fx.dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: '2026-11-02T18:39:30Z', ev: 'sub', role: 'qa', id: '000000000009', phase: 'start' })}\n`);
    assert.equal(JSON.parse(pre(fx.input(), fx.opts).out).continue, false);
    const other = pre(fx.input({ session_id: 'sess-lead-2' }), fx.opts);
    assert.equal(other.out, '');
    assert.equal(fx.record().filter((e) => e.trigger === 'context').length, 1);
  });

  test('a manual compaction lowers the reading and unfreezes the session', () => {
    const fx = frozen();
    fx.setTokens(HANDOVER_AT - 20000);
    assert.deepEqual(pre(fx.input(), fx.opts), quiet);
  });
});

describe('Lead with a Step running', () => {
  test('Agent and Task are denied with the wait reason, every other tool is allowed, nothing is written', () => {
    const fx = fixture({ subs: ['running'] });
    for (const tool of ['Agent', 'Task']) {
      const d = decision(pre(fx.input({ tool_name: tool }), fx.opts));
      assert.equal(d.permissionDecision, 'deny');
      assert.equal(d.permissionDecisionReason, 'aico context cap: no new Step from this session. Wait for the running Step; the Lead Handoff is written after it.');
    }
    for (const tool of ['Read', 'PowerShell', 'Write', NEW_SESSION_TOOL]) assert.deepEqual(pre(fx.input({ tool_name: tool }), fx.opts), quiet);
    assert.deepEqual(fx.record(), []);
  });

  test('once the Step stopped the next call freezes', () => {
    const fx = fixture({ subs: ['stopped'] });
    assert.equal(decision(pre(fx.input({ tool_name: 'Agent' }), fx.opts)).permissionDecision, 'deny');
    assert.equal(fx.record().filter((e) => e.trigger === 'context').length, 1);
  });
});

describe('process', () => {
  test('pre as a hook process: freeze deny first, then the frozen route on stdout and stderr, exit 0', () => {
    const fx = fixture();
    const env = { ...process.env, CLAUDE_CONFIG_DIR: fx.claudeDir };
    delete env.AICO_CONTEXT_GUARD;
    const run = () => spawnSync(process.execPath, [GUARD, 'pre'], { cwd: fx.root, input: fx.input(), encoding: 'utf8', env });
    const a = run();
    assert.equal(a.status, 0);
    assert.equal(JSON.parse(a.stdout).hookSpecificOutput.permissionDecision, 'deny');
    const b = run();
    assert.equal(b.status, 0);
    assert.equal(JSON.parse(b.stdout).continue, false);
    assert.equal(b.stderr, `${FROZEN_LINE} ${COMMAND}\n`);
  });
});
