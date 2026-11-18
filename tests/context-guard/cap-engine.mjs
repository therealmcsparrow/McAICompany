// Shared harness for the cap guard tests. Not a test file.
// The old tests called scripts/context-guard.mjs in process. The cap is now the `cap` guard (rule cap.M1)
// of the hook engine (`context-guard` v2.0, `mod-hook` v1), so every case here runs scripts/hook-host.mjs
// as a process with the REAL hooks/rules/cap.mjs, hooks/manifests/cap.json and the cap.M1 row(s) of the
// real hooks/rules.json, inside the throw-away plugin root of hooks/fixtures/engine/harness.mjs.
// Assumptions (change here in one place): the cap rows are found by `rule === 'cap.M1'` in hooks/rules.json;
// the threshold comes from <MCSPARROW_HOME>/config.json `aico_settings.pipeline.context_cap`, read at
// SessionStart / SubagentStart into the snapshot; the guard record is <run folder>/guard.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeEnv, cleanup, startLead } from '../../hooks/fixtures/engine/harness.mjs';

export { cleanup };
export const REPO = path.resolve(import.meta.dirname, '..', '..');
export const AGENT = 'agent-a1';
export const SLUG = 'P20261114.000099/01-feature';
export const NEW_SESSION_TOOL = ['mcp__plugin_aico_lead-session__lead', 'new', 'session'].join('_');
export const usage = (n) => ({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: n - 15 });
export const row = (n, side = false) => ({ type: 'assistant', isSidechain: side, message: { model: 'claude-opus-4-1', usage: usage(n) } });

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// opts: { cap (raw value stored as pipeline.context_cap; undefined = none), run (default true), slug }
export async function capEnv({ cap, run = true, slug = SLUG } = {}) {
  const rulesFile = path.join(REPO, 'hooks', 'rules.json');
  for (const f of [rulesFile, path.join(REPO, 'hooks', 'rules', 'cap.mjs'), path.join(REPO, 'hooks', 'manifests', 'cap.json')]) {
    assert.ok(fs.existsSync(f), `${path.relative(REPO, f)} exists (the engine and the cap guard are built)`);
  }
  const rows = readJson(rulesFile).filter((r) => r.rule === 'cap.M1');
  assert.ok(rows.length >= 1, 'hooks/rules.json has a cap.M1 row');
  const env = makeEnv();
  const put = (rel) => { fs.mkdirSync(path.dirname(path.join(env.plugin, rel)), { recursive: true }); fs.copyFileSync(path.join(REPO, rel), path.join(env.plugin, rel)); };
  put('hooks/rules/cap.mjs');
  put('hooks/rules/self-protect.mjs'); // the host imports it from the plugin root and fails closed without it
  put('hooks/rules/dotenv.mjs'); // the guards-off host path imports it and fails closed without it
  put('hooks/manifests/cap.json');
  fs.writeFileSync(path.join(env.plugin, 'hooks', 'rules.json'), JSON.stringify(rows, null, 2));
  env.repin();
  if (cap !== undefined) env.setConfig({ pipeline: { context_cap: cap } });
  const out = { env, slug, dir: null, runDir: null };
  if (run) out.dir = out.runDir = await env.startRun(slug);

  // Lead session start, then the Step dispatch that writes the Step snapshot.
  out.boot = () => { startLead(env); const r = env.run(env.event('SubagentStart', { agent_id: AGENT })); return r; };
  out.bootLead = () => startLead(env);

  // Lead tool call at `tokens`; rows = the whole transcript when given (first reading = session start).
  out.lead = (tokens, { tool = 'Bash', input = {}, session = 'sess-lead-1', rows: rs } = {}) => {
    const t = env.transcript(`lead-${session}`, (rs ?? [tokens]).map((n) => row(n)));
    return env.run(env.event('PreToolUse', { tool_name: tool, tool_input: input, transcript_path: t, session_id: session }));
  };
  // Step tool call at `tokens` (its own sidechain reading; the main chain stays small).
  out.step = (tokens, { tool = 'Read', input = { file_path: 'x.txt' }, agent = AGENT, mainTokens = 1000, cwd = env.project, over = {} } = {}) => {
    const t = env.transcript(`main-${agent}`, [row(mainTokens)]);
    const dir = t.replace(/\.jsonl$/, '');
    fs.mkdirSync(path.join(dir, 'subagents'), { recursive: true });
    const lines = [{ type: 'meta' }, row(500, true), ...(tokens === null ? [] : [row(tokens, true)])];
    const file = path.join(dir, 'subagents', `agent-${agent}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    return env.run(env.event('PreToolUse', { tool_name: tool, tool_input: input, transcript_path: t, agent_id: agent, agent_type: 'aico:qa', cwd, ...over }), { cwd });
  };
  out.stop = (tokens = 150000, { agent = AGENT, active = false, cwd = env.project } = {}) => {
    const t = env.transcript(`stop-${agent}`, [row(tokens, true)]);
    return env.run(env.event('SubagentStop', { agent_id: agent, agent_transcript_path: t, stop_hook_active: active, cwd }), { cwd });
  };
  out.guardRecord = (dir = out.runDir) => {
    const f = path.join(dir, 'guard.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  out.handovers = (dir = out.runDir) => {
    const f = path.join(dir, 'lead-handover.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.ev === 'handover') : [];
  };
  // A running Step in the run record (the Lead's wait branch).
  out.addSub = (phase = 'start', id = '000000000001') => {
    const at = new Date(Date.now() - 30000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    fs.appendFileSync(path.join(out.runDir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at, ev: 'sub', role: 'backend-engineer', id, phase })}\n`);
  };
  out.isDeny = (r) => r.json?.hookSpecificOutput?.permissionDecision === 'deny';
  out.denyOf = (r) => { assert.ok(out.isDeny(r), `expected a deny, got: ${r.out} ${r.err}`); return r.json.hookSpecificOutput.permissionDecisionReason; };
  out.quiet = (r, why = '') => { assert.equal(r.code, 0, r.err); assert.equal(r.out.trim(), '', `expected silence ${why}, got ${r.out}`); };
  // True when the call was refused as a cap freeze or hand over.
  out.capDeny = (r) => out.isDeny(r) && /cap\.M1/.test(r.json.hookSpecificOutput.permissionDecisionReason);
  return out;
}

// ---- T17 (hook-event v1.4, context-guard v3.0): Lead agent harness ----
export const LEAD_TYPE = 'aico:project-manager';
export const LEAD_AGENT = 'agent-lead1';

// A throw-away plugin root with a probe rule that reports what a rule sees: session, key, agent type, tool, run folder.
// Own rule file, so the shared probe fixture stays untouched. Starts an active run and the Lead session.
export async function seenEnv({ run = true } = {}) {
  const env = makeEnv({
    manifests: [{ v: 1, id: 'seen', kind: 'guard', title: 'Seen', owner: 'qa', sessions: 'all', events: ['PreToolUse', 'SubagentStop'], rules: ['seen.M1', 'seen.M2'], fail: 'closed', switch: null, lock: true, upstream: null }],
    rows: [
      { event: 'PreToolUse', matcher: ['*'], rule: 'seen.M1', module: 'seen.mjs', export: 'judge', fail: 'closed', timeoutMs: 300, message: 'seen' },
      { event: 'SubagentStop', matcher: ['*'], rule: 'seen.M2', module: 'seen.mjs', export: 'judge', fail: 'closed', timeoutMs: 300, message: 'seen' }
    ]
  });
  fs.writeFileSync(path.join(env.plugin, 'hooks', 'rules', 'seen.mjs'),
    "export function judge(e) {\n  return { v: 'note', rule: 'seen.M1', message: JSON.stringify({ s: e.session, ak: e.agentKey, at: e.agentType, t: e.tool ? e.tool.name : null, run: e.run ? (e.run.folder ?? true) : null }) };\n}\n");
  env.repin();
  const out = { env };
  if (run) out.runDir = await env.startRun(SLUG);
  startLead(env);
  // Main transcript with one small reading; the agent file (flat, any depth) with its own small reading.
  out.payload = (name, { agent = null, type, tool = 'Bash', input = { command: 'ls' }, tokens = 0 } = {}) => {
    const t = env.transcript(`seen-${agent ?? 'main'}`, [row(tokens + 15)]);
    const over = { transcript_path: t, tool_name: tool, tool_input: input };
    if (agent) {
      const dir = t.replace(/\.jsonl$/, '');
      fs.mkdirSync(path.join(dir, 'subagents'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'subagents', `agent-${agent}.jsonl`), [JSON.stringify({ type: 'meta' }), JSON.stringify(row(tokens + 15, true))].join('\n') + '\n');
      over.agent_id = agent;
      if (type !== undefined) over.agent_type = type;
    }
    if (name === 'SubagentStop') { over.agent_transcript_path = t; over.stop_hook_active = false; }
    return env.event(name, over);
  };
  out.seen = (payload) => {
    const r = env.run(payload);
    assert.equal(r.code, 0, r.err);
    const m = String(r.json?.systemMessage ?? '').match(/\{.*\}/s);
    assert.ok(m, `no probe note in: ${r.out.slice(0, 300)} ${r.err.slice(0, 300)}`);
    return JSON.parse(m[0]);
  };
  return out;
}

// A throw-away plugin root with the REAL dotenv.M-SEC1 rule (all sessions), for the shell `.env` deny.
export function dotenvEnv() {
  const rows = readJson(path.join(REPO, 'hooks', 'rules.json')).filter((r) => r.rule === 'dotenv.M-SEC1');
  assert.ok(rows.length >= 1, 'hooks/rules.json has a dotenv.M-SEC1 row');
  const env = makeEnv();
  for (const rel of ['hooks/rules/dotenv.mjs', 'hooks/manifests/dotenv.json']) {
    fs.mkdirSync(path.dirname(path.join(env.plugin, rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), path.join(env.plugin, rel));
  }
  fs.writeFileSync(path.join(env.plugin, 'hooks', 'rules.json'), JSON.stringify(rows, null, 2));
  env.repin();
  startLead(env);
  return env;
}
