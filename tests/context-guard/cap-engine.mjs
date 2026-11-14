// Shared harness for the cap guard tests (T20, P20261114.000001). Not a test file.
// The old tests called scripts/context-guard.mjs in process. The cap is now the `cap` guard (rule cap.M1)
// of the hook engine (`context-guard` v2.0, `mod-hook` v1), so every case here runs scripts/hook-host.mjs
// as a process with the REAL hooks/rules/cap.mjs, hooks/manifests/cap.json and the cap.M1 row(s) of the
// real hooks/rules.json, inside the throw-away plugin root of hooks/fixtures/engine/harness.mjs.
// QA assumptions (change here in one place): the cap rows are found by `rule === 'cap.M1'` in hooks/rules.json;
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
export const NEW_SESSION_TOOL = 'mcp__plugin_aico_lead-session__lead_new_session';
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
