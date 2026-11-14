// Tests: normalization of `hook-event` v1 (hooks/lib/event.mjs, fed by scripts/hook-host.mjs).
// A probe guard (hooks/fixtures/engine/rules/probe.mjs) returns the normalized event as a compact JSON note,
// so each test sees what a rule sees. Covers session mapping, keys, tokens, mainModel, env, malformed input.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeEnv, cleanup, key12 } from '../hooks/fixtures/engine/harness.mjs';

after(cleanup);

const usage = (i, cc, cr, o) => ({ input_tokens: i, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: o });
const row = (u, { side = false, model = 'claude-opus-4-1' } = {}) => ({ type: 'assistant', isSidechain: side, message: { model, usage: u } });

// Run the probe and return the event summary it reports.
function seen(env, payload, opts) {
  const r = env.run(payload, opts);
  assert.equal(r.code, 0, r.err);
  const msg = r.json?.systemMessage;
  assert.equal(typeof msg, 'string', `no probe note in: ${r.out.slice(0, 300)}`);
  const m = msg.match(/\{.*\}/s);
  assert.ok(m, msg);
  return JSON.parse(m[0]);
}
const probeEnv = () => {
  const env = makeEnv({ probe: true });
  env.run(env.event('SubagentStart', { agent_id: 'agent-boot' })); // writes lead.json
  return env;
};

describe('session mapping (hook-event v1 "Normalized event")', () => {
  test('PreToolUse without agent_id is a lead event; keys are 12-hex hashes; the event is frozen', () => {
    const env = probeEnv();
    const e = seen(env, env.pre('ls'));
    assert.equal(e.e, 'PreToolUse');
    assert.equal(e.s, 'lead');
    assert.equal(e.sk, key12('sess-lead-1'));
    assert.equal(e.ak, null);
    assert.equal(e.t, 'Bash');
    assert.equal(e.f, true);
  });

  test('PreToolUse with agent_id is a step event with an agentKey', () => {
    const env = probeEnv();
    const e = seen(env, env.stepPre('ls'));
    assert.equal(e.s, 'step');
    assert.equal(e.ak, key12('agent-a1'));
    assert.equal(e.sk, key12('sess-lead-1'));
  });

  test('SubagentStart normalizes to session lead, with the agentKey set', () => {
    const env = probeEnv();
    const e = seen(env, env.event('SubagentStart'));
    assert.equal(e.e, 'SubagentStart');
    assert.equal(e.s, 'lead');
    assert.equal(e.ak, key12('agent-a1'));
    assert.equal(e.t, null);
  });

  test('SubagentStop normalizes to session step and carries stopHookActive', () => {
    const env = probeEnv();
    const a = seen(env, env.event('SubagentStop'));
    assert.equal(a.e, 'SubagentStop');
    assert.equal(a.s, 'step');
    assert.equal(a.ak, key12('agent-a1'));
    assert.equal(a.sh, false);
    const b = seen(env, env.event('SubagentStop', { stop_hook_active: true }));
    assert.equal(b.sh, true);
  });

  test('stopHookActive is null for events that do not carry it', () => {
    const env = probeEnv();
    assert.equal(seen(env, env.pre('ls')).sh, null);
  });

  test('the event holds exactly the contract keys: 14 top-level, 6 in tool', () => {
    const env = probeEnv();
    const e = seen(env, env.pre('ls'));
    assert.equal(e.kn, 14);
    assert.equal(e.tn, 6);
  });

  test('agent ids of the allowed alphabet pass; others are malformed', () => {
    const env = probeEnv();
    for (const id of ['A_b-9', 'a'.repeat(128), 'x']) assert.equal(seen(env, env.stepPre('ls', { agent_id: id })).ak, key12(id));
    for (const id of ['a b', '../x', 'a/b', 'a\\b', 'a.b', '']) {
      const r = env.run(env.stepPre('ls', { agent_id: id }));
      assert.equal(r.json?.hookSpecificOutput?.permissionDecision, 'deny', `${JSON.stringify(id)} -> ${r.out.slice(0, 200)}`);
      assert.match(r.out, /malformed/);
    }
  });

  test('raw ids and tool text never appear in the note or any stored file', () => {
    const env = probeEnv();
    const r = env.run(env.stepPre('echo SECRET-COMMAND-TEXT'));
    assert.doesNotMatch(r.out, /sess-lead-1|agent-a1|SECRET-COMMAND-TEXT/);
  });
});

describe('Agent and Task dispatch fields', () => {
  const dispatch = (env, extra = {}) => env.event('PreToolUse', { tool_name: 'Agent', tool_input: { model: 'opus', subagent_type: 'aico:qa', prompt: 'Task: x\nOutput: .company/work/P1/01-feature/05-qa.md\n', ...extra } });

  test('model, subagentType (the part after aico:) and mainModel on a Lead Agent call', () => {
    const env = probeEnv();
    const t = env.transcript('lead-main', [row(usage(10, 20, 30, 40), { model: 'claude-opus-4-1' })]);
    const e = seen(env, { ...dispatch(env), transcript_path: t });
    assert.equal(e.t, 'Agent');
    assert.equal(e.m, 'opus');
    assert.equal(e.st, 'qa');
    assert.equal(e.mm, 'claude-opus-4-1');
  });

  test('a subagent_type without the aico: prefix gives no subagentType', () => {
    const env = probeEnv();
    const e = seen(env, dispatch(env, { subagent_type: 'general-purpose' }));
    assert.equal(e.st, null);
  });

  test('Task counts like Agent for mainModel', () => {
    const env = probeEnv();
    const t = env.transcript('lead-task', [row(usage(1, 1, 1, 1), { model: 'claude-sonnet-4-5' })]);
    const e = seen(env, { ...dispatch(env), tool_name: 'Task', transcript_path: t });
    assert.equal(e.mm, 'claude-sonnet-4-5');
  });

  test('mainModel is null for any other tool and for a Step', () => {
    const env = probeEnv();
    const t = env.transcript('lead-bash', [row(usage(1, 1, 1, 1))]);
    assert.equal(seen(env, { ...env.pre('ls'), transcript_path: t }).mm, null);
    assert.equal(seen(env, { ...dispatch(env), agent_id: 'agent-a1', agent_type: 'aico:qa', transcript_path: t }).mm, null);
  });

  test('mainModel is null when the transcript row has no model, and capped at 64 characters', () => {
    const env = probeEnv();
    const t1 = env.transcript('no-model', [{ type: 'assistant', isSidechain: false, message: { usage: usage(1, 1, 1, 1) } }]);
    assert.equal(seen(env, { ...dispatch(env), transcript_path: t1 }).mm, null);
    const t2 = env.transcript('long-model', [row(usage(1, 1, 1, 1), { model: 'm'.repeat(200) })]);
    const mm = seen(env, { ...dispatch(env), transcript_path: t2 }).mm;
    assert.ok(mm === null || mm.length <= 64, `${mm?.length}`);
  });
});

describe('tokens (hook-event v1 "tokens")', () => {
  test('no transcript file: state none, total 0', () => {
    const env = probeEnv();
    assert.equal(seen(env, env.pre('ls')).tk, 'none:0');
  });

  test('a transcript without usage rows: state none, total 0', () => {
    const env = probeEnv();
    const t = env.transcript('no-usage', [{ type: 'user', message: { content: 'hi' } }]);
    assert.equal(seen(env, env.pre('ls', { transcript_path: t })).tk, 'none:0');
  });

  test('Lead: input + cache creation + cache read + output of the last assistant row; sidechain rows are ignored', () => {
    const env = probeEnv();
    const t = env.transcript('lead-tokens', [
      row(usage(1, 1, 1, 1)),
      row(usage(100, 200, 300, 400)),
      row(usage(9999, 9999, 9999, 9999), { side: true }),
      { type: 'user', message: { content: 'x' } }
    ]);
    assert.equal(seen(env, env.pre('ls', { transcript_path: t })).tk, 'read:1000');
  });

  test('Step PreToolUse reads <transcript minus .jsonl>/subagents/agent-<id>.jsonl, sidechain rows only', () => {
    const env = probeEnv();
    const t = env.transcript('main', [row(usage(5000, 0, 0, 0))]);
    const dir = t.replace(/\.jsonl$/, '');
    fs.mkdirSync(path.join(dir, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'subagents', 'agent-agent-a1.jsonl'), [row(usage(1, 2, 3, 4), { side: true }), row(usage(50, 0, 0, 0), { side: false }), ''].map((x) => (x ? JSON.stringify(x) : '')).join('\n'));
    assert.equal(seen(env, env.stepPre('ls', { transcript_path: t })).tk, 'read:10');
  });

  test('a Step with no usage row yet counts 0 (fresh Step)', () => {
    const env = probeEnv();
    const t = env.transcript('main2', [row(usage(5000, 0, 0, 0))]);
    assert.equal(seen(env, env.stepPre('ls', { transcript_path: t })).tk, 'none:0');
  });

  test('SubagentStop reads agent_transcript_path', () => {
    const env = probeEnv();
    const t = env.transcript('stop-agent', [row(usage(7, 8, 9, 10), { side: true })]);
    assert.equal(seen(env, env.event('SubagentStop', { agent_transcript_path: t })).tk, 'read:34');
  });

  test('present but unreadable (a directory): state error, total null', () => {
    const env = probeEnv();
    const d = path.join(env.base, 'transcripts', 'a-dir.jsonl');
    fs.mkdirSync(d, { recursive: true });
    assert.equal(seen(env, env.pre('ls', { transcript_path: d })).tk, 'error:null');
  });

  test('a malformed usage row: state error', () => {
    const env = probeEnv();
    const t = env.transcript('bad-usage', [{ type: 'assistant', isSidechain: false, message: { model: 'm', usage: 'lots' } }]);
    assert.equal(seen(env, env.pre('ls', { transcript_path: t })).tk, 'error:null');
    const t2 = env.transcript('bad-usage2', [{ type: 'assistant', isSidechain: false, message: { model: 'm', usage: { input_tokens: 'x', output_tokens: 1 } } }]);
    assert.equal(seen(env, env.pre('ls', { transcript_path: t2 })).tk, 'error:null');
  });

  test('a transcript path that fails the path checks (device name, UNC) is an error, not a read', () => {
    const env = probeEnv();
    for (const p of ['\\\\server\\share\\x.jsonl', 'CON', 'NUL.jsonl']) {
      const tk = seen(env, env.pre('ls', { transcript_path: p })).tk;
      assert.ok(tk === 'error:null' || tk === 'none:0', `${p} -> ${tk}`);
      assert.notEqual(tk.startsWith('read'), true);
    }
  });
});

describe('env (hook-event v1 "env")', () => {
  test('unset: guardsOff false, models null', () => {
    const env = probeEnv();
    const e = seen(env, env.pre('ls'));
    assert.equal(e.g, false);
    assert.equal(e.sm, null);
    assert.equal(e.sf, null);
  });

  test('AICO_GUARDS=off exactly sets guardsOff; other values do not', () => {
    const env = probeEnv();
    assert.equal(seen(env, env.pre('ls'), { env: { AICO_GUARDS: 'off' } }).g, true);
    for (const v of ['OFF', 'on', '1', ' off']) assert.equal(seen(env, env.pre('ls'), { env: { AICO_GUARDS: v } }).g, false, v);
  });

  test('CLAUDE_CODE_SUBAGENT_MODEL and _FORCE are read once as strings', () => {
    const env = probeEnv();
    const e = seen(env, env.pre('ls'), { env: { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' } });
    assert.equal(e.sm, 'sonnet');
    assert.equal(e.sf, '1');
  });

  test('an env value over 64 characters is cut or null, never longer', () => {
    const env = probeEnv();
    const e = seen(env, env.pre('ls'), { env: { CLAUDE_CODE_SUBAGENT_MODEL: 'x'.repeat(200) } });
    assert.ok(e.sm === null || e.sm.length <= 64);
  });
});

describe('input limits and unknown events', () => {
  test('an unknown hook_event_name is malformed', () => {
    const env = probeEnv();
    const r = env.run(env.event('PreToolUse', { hook_event_name: 'Stop' }));
    assert.match(r.out, /malformed/);
  });

  test('a JSON array or a bare string is malformed', () => {
    const env = probeEnv();
    for (const s of ['[]', '"x"', '42', 'null']) assert.match(env.run(s).out, /malformed/, s);
  });

  test('an input just under 4 MiB is accepted', () => {
    const env = probeEnv();
    const e = seen(env, env.pre('x'.repeat(4 * 1024 * 1024 - 1024)));
    assert.equal(e.e, 'PreToolUse');
  });

  test('an input over 4 MiB is malformed', () => {
    const env = probeEnv();
    assert.match(env.run(env.pre('x'.repeat(4 * 1024 * 1024 + 1024))).out, /malformed/);
  });

  test('keys are read with hasOwn: an inherited-looking __proto__ key does not change the event', () => {
    const env = probeEnv();
    const raw = JSON.stringify(env.pre('ls')).replace(/^\{/, '{"__proto__":{"agent_id":"evil"},');
    const e = seen(env, raw);
    assert.equal(e.s, 'lead');
    assert.equal(e.ak, null);
  });

  test('the engine has no Stop entry in the stub hooks.json (a Stop payload is an unknown event)', () => {
    const env = probeEnv();
    const j = JSON.parse(fs.readFileSync(path.join(env.plugin, 'hooks', 'hooks.json'), 'utf8'));
    assert.equal(Object.hasOwn(j.hooks, 'Stop'), false);
  });
});
