// T17: the Lead agent is session `lead`; every other agent_id payload is a Step (`hook-event` v1.4 "Normalized event",
// `context-guard` v3.0). QA-first: red until T18 changes hooks/lib/event.mjs. Harness: ./cap-engine.mjs.
// Runs scripts/hook-host.mjs as a process with a probe rule that reports the normalized event; no private import.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { seenEnv, dotenvEnv, cleanup, LEAD_TYPE, LEAD_AGENT } from './cap-engine.mjs';
import { key12 } from '../../hooks/fixtures/engine/harness.mjs';

after(cleanup);

describe('session mapping by exact agent_type (hook-event v1.4)', () => {
  test('agent_type aico:project-manager at depth 1 is session lead with its own agentKey', async () => {
    const fx = await seenEnv();
    const e = fx.seen(fx.payload('PreToolUse', { agent: LEAD_AGENT, type: LEAD_TYPE }));
    assert.equal(e.s, 'lead');
    assert.equal(e.ak, key12(LEAD_AGENT));
    assert.equal(e.at, LEAD_TYPE);
  });

  test('SubagentStop of the Lead agent is session lead', async () => {
    const fx = await seenEnv();
    const e = fx.seen(fx.payload('SubagentStop', { agent: LEAD_AGENT, type: LEAD_TYPE }));
    assert.equal(e.s, 'lead');
    assert.equal(e.ak, key12(LEAD_AGENT));
  });

  test('SubagentStop of a Role stays step', async () => {
    const fx = await seenEnv();
    assert.equal(fx.seen(fx.payload('SubagentStop', { agent: 'agent-r1', type: 'aico:qa' })).s, 'step');
  });

  const NOT_LEAD = [
    ['aico:qa', 'aico:qa'],
    ['general-purpose', 'general-purpose'],
    ['AICO:project-manager (case)', 'AICO:project-manager'],
    ['other:project-manager', 'other:project-manager'],
    ['trailing space', 'aico:project-manager '],
    ['missing agent_type', undefined],
    ['non-string agent_type', 7]
  ];
  for (const [label, type] of NOT_LEAD) {
    for (const [depth, agent] of [[1, 'agent-d1'], [2, 'agent-d2']]) {
      test(`${label} at depth ${depth} is step (Step rules)`, async () => {
        const fx = await seenEnv();
        const e = fx.seen(fx.payload('PreToolUse', { agent, type }));
        assert.equal(e.s, 'step');
        assert.equal(e.ak, key12(agent));
      });
    }
  }

  test('a Lead at depth 2 (helper Lead, flat agent file) is session lead; a Role beside it stays step', async () => {
    const fx = await seenEnv();
    const lead2 = fx.seen(fx.payload('PreToolUse', { agent: 'agent-lead2', type: LEAD_TYPE }));
    assert.equal(lead2.s, 'lead');
    assert.equal(lead2.ak, key12('agent-lead2'));
    assert.notEqual(lead2.ak, key12(LEAD_AGENT), 'each Lead is its own key');
    assert.equal(fx.seen(fx.payload('PreToolUse', { agent: 'agent-r2', type: 'aico:qa' })).s, 'step');
  });

  test('no agent_id is main: session lead, agentKey null, agentType null', async () => {
    const fx = await seenEnv();
    const e = fx.seen(fx.payload('PreToolUse'));
    assert.equal(e.s, 'lead');
    assert.equal(e.ak, null);
    assert.equal(e.at, null);
  });

  test('a main payload that merely carries agent_type aico:project-manager (no agent_id) is still main', async () => {
    const fx = await seenEnv();
    const p = fx.payload('PreToolUse');
    p.agent_type = LEAD_TYPE;
    const e = fx.seen(p);
    assert.equal(e.s, 'lead');
    assert.equal(e.ak, null);
  });
});

describe('run for session lead Agent/Task (hook-event v1.4)', () => {
  const calls = [['Agent', { subagent_type: 'aico:qa', prompt: 'x' }], ['Task', { subagent_type: 'aico:qa', prompt: 'x' }]];
  for (const [tool, input] of calls) {
    test(`main ${tool} at 0 tokens: run is set with the active run folder`, async () => {
      const fx = await seenEnv();
      const e = fx.seen(fx.payload('PreToolUse', { tool, input, tokens: 0 }));
      assert.equal(e.s, 'lead');
      assert.ok(e.run, 'run set below the fast floor');
      assert.ok(String(e.run).replace(/\\/g, '/').includes('P20261114.000099/01-feature'), `run folder: ${e.run}`);
    });
    test(`Lead agent ${tool} at 0 tokens: run is set`, async () => {
      const fx = await seenEnv();
      const e = fx.seen(fx.payload('PreToolUse', { agent: LEAD_AGENT, type: LEAD_TYPE, tool, input, tokens: 0 }));
      assert.equal(e.s, 'lead');
      assert.ok(e.run, 'run set below the fast floor');
    });
  }
  test('a Role Agent call (session step) and a main Bash call at 0 tokens keep run null', async () => {
    const fx = await seenEnv();
    assert.equal(fx.seen(fx.payload('PreToolUse', { agent: 'agent-r1', type: 'aico:qa', tool: 'Agent', input: { subagent_type: 'aico:qa' } })).run, null);
    assert.equal(fx.seen(fx.payload('PreToolUse')).run, null);
  });
});

describe('.env shell reads are denied in every session (cch.M-SEC7, AC5)', () => {
  const SHELLS = [['Bash', 'cat .env'], ['PowerShell', 'Get-Content .env']];
  const SESSIONS = [
    ['a depth-2 Role', { agent_id: 'agent-d2', agent_type: 'aico:qa' }],
    ['the Lead agent (depth 1)', { agent_id: LEAD_AGENT, agent_type: LEAD_TYPE }],
    ['main (no agent_id), guards on', {}]
  ];
  for (const [tool, command] of SHELLS) {
    for (const [who, over] of SESSIONS) {
      test(`${tool} ${command} is denied for ${who}`, () => {
        const env = dotenvEnv();
        const r = env.run(env.event('PreToolUse', { tool_name: tool, tool_input: { command }, ...over }));
        assert.equal(r.code, 0, r.err);
        const reason = env.reason(r);
        assert.ok(reason, `expected a deny, got: ${r.out} ${r.err}`);
        assert.match(reason, /dotenv\.M-SEC1/);
      });
    }
  }
  test('control: a shell read of README passes for the Lead agent', () => {
    const env = dotenvEnv();
    const r = env.run(env.event('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'cat README.md' }, agent_id: LEAD_AGENT, agent_type: LEAD_TYPE }));
    assert.equal(env.reason(r), null);
  });
});

// R-3 (fail closed): a throwing resolveRun on a Lead Agent/Task PreToolUse is an unreadable run, never "no run".
describe('resolveRun failure on a Lead spawn (hook-event v1.4, context-guard v3.0)', async () => {
  const nodeFs = await import('node:fs');
  const nodeOs = await import('node:os');
  const nodePath = await import('node:path');
  const { normalize } = await import('../../hooks/lib/event.mjs');
  const { judge, freezeAt } = await import('../../hooks/rules/cap.mjs');
  const base = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'rr-'));
  after(() => nodeFs.rmSync(base, { recursive: true, force: true }));
  const ctx = (resolveRun) => ({
    env: { USERPROFILE: nodePath.join(base, 'home'), HOME: nodePath.join(base, 'home') },
    schema: null, pluginRoot: nodePath.join(base, 'plugin'), mcsHome: nodePath.join(base, 'msh'), resolveRun
  });
  const raw = (tool) => ({
    hook_event_name: 'PreToolUse', session_id: 's-rr', transcript_path: nodePath.join(base, 'none.jsonl'), cwd: base,
    agent_id: LEAD_AGENT, agent_type: LEAD_TYPE, tool_name: tool,
    tool_input: { subagent_type: 'aico:qa', prompt: 'x' }, permission_mode: 'default'
  });

  for (const tool of ['Agent', 'Task']) {
    test(`${tool}: a throwing resolveRun gives event.run { error: true } and a cap deny (RUN_UNREADABLE)`, async () => {
      const r = await normalize(raw(tool), ctx(async () => { throw new Error('boom'); }));
      assert.ok(r.ok, 'normalize ok');
      assert.equal(r.event.session, 'lead');
      assert.deepEqual(r.event.run, { error: true });
      const v = judge({ ...r.event, tokens: { state: 'read', total: freezeAt(180000) } }, { threshold: 180000 });
      assert.equal(v.v, 'deny');
      assert.equal(v.rule, 'cap.M1');
      assert.match(v.message, /unreadable/);
    });

    test(`${tool}: a null resolveRun still allows`, async () => {
      const r = await normalize(raw(tool), ctx(async () => null));
      assert.ok(r.ok, 'normalize ok');
      assert.equal(r.event.run, null);
      assert.equal(judge({ ...r.event, tokens: { state: 'read', total: freezeAt(180000) } }, { threshold: 180000 }).v, 'allow');
    });
  }
});
