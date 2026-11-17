// T19 (QA-first for T20): cap.M1 applies to the Lead agent, never to main (`context-guard` v3.0, AC5, AC7).
// Red until T20 changes hooks/rules/cap.mjs and hooks/lib/cap-effects.mjs. Harness: ./cap-engine.mjs.
// Runs scripts/hook-host.mjs as a process with the real cap rule; no private import.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { capEnv, cleanup, NEW_SESSION_TOOL, LEAD_TYPE, LEAD_AGENT } from './cap-engine.mjs';

after(cleanup);
const F = 162000;
const T = 180000;
const FEEDBACK_TOOL = 'SendFeedback';
const TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'PowerShell', 'Agent', 'Task', 'Grep', NEW_SESSION_TOOL, FEEDBACK_TOOL, 'mcp__other__anything'];

async function fixture() {
  const fx = await capEnv();
  fx.bootLead();
  // A Lead agent call at `tokens`: its own agent file carries the reading, the main chain stays small.
  fx.agentLead = (tokens, { tool = 'Bash', input = { command: 'ls' }, agent = LEAD_AGENT } = {}) =>
    fx.step(tokens, { tool, input, agent, over: { agent_type: LEAD_TYPE } });
  return fx;
}
const text = (r) => `${r.json?.hookSpecificOutput?.permissionDecisionReason ?? ''} ${r.json?.systemMessage ?? ''} ${r.json?.stopReason ?? ''}`;

describe('Lead agent below F', () => {
  test('161999 passes silently', async () => {
    const fx = await fixture();
    fx.quiet(fx.agentLead(F - 1));
  });
});

describe('Lead agent at the clean point (F <= tokens < T) (AC5)', () => {
  test('the first call at F is denied by cap.M1 and names STATUS: handover with the handoff: and next: lines', async () => {
    const fx = await fixture();
    const r = fx.agentLead(F);
    const reason = fx.denyOf(r);
    assert.match(reason, /cap\.M1/);
    assert.match(reason, /STATUS: handover/);
    assert.match(reason, /handoff:/);
    assert.match(reason, /next:/);
    assert.notEqual(r.json.continue, false, 'a freeze deny does not end the turn');
  });

  test('also denied just below T', async () => {
    const fx = await fixture();
    assert.match(fx.denyOf(fx.agentLead(T - 1)), /STATUS: handover|frozen/);
  });

  test('another Lead agent has its own budget: a fresh Lead at 1000 tokens is not capped', async () => {
    const fx = await fixture();
    fx.agentLead(F);
    fx.quiet(fx.agentLead(1000, { agent: 'agent-lead2' }));
  });
});

describe('Lead agent Frozen: every tool denied, never continue:false (AC5, AC7)', () => {
  async function frozen() {
    const fx = await fixture();
    fx.agentLead(F);
    return fx;
  }

  for (const [label, n] of [['F', F], ['T', T], ['above T', T + 20000]]) {
    test(`at ${label} every tool is denied by cap.M1, including the MCP tool and SendFeedback`, async () => {
      const fx = await frozen();
      for (const tool of TOOLS) {
        const r = fx.agentLead(n, { tool });
        assert.ok(fx.isDeny(r), `${tool} denied at ${label}: ${r.out} ${r.err}`);
        assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /cap\.M1/, tool);
      }
    });
  }

  test('the Frozen output never holds continue:false (a continue:false stop emits no SubagentStop)', async () => {
    const fx = await frozen();
    for (const n of [F, T, T + 20000]) {
      for (const tool of TOOLS) {
        const r = fx.agentLead(n, { tool });
        assert.notEqual(r.json?.continue, false, `${tool} at ${n}`);
        assert.ok(!/"continue"\s*:\s*false/.test(r.out), `${tool} at ${n}: ${r.out}`);
      }
    }
  });

  test('the deny still tells the Lead to end with STATUS: handover', async () => {
    const fx = await frozen();
    assert.match(text(fx.agentLead(T, { tool: 'Read' })), /STATUS: handover/);
  });

  test('a Lead first seen at T is denied for every tool without continue:false', async () => {
    const fx = await fixture();
    for (const tool of TOOLS) {
      const r = fx.agentLead(T, { tool });
      assert.ok(fx.isDeny(r), tool);
      assert.notEqual(r.json.continue, false, tool);
    }
  });
});

describe('main is never capped (AC7)', () => {
  for (const n of [0, F - 1, F, T - 1, T, T + 1, 900000]) {
    test(`main (no agent_id) at ${n} tokens: Read, Bash, PowerShell, Write pass`, async () => {
      const fx = await fixture();
      for (const tool of ['Read', 'Bash', 'PowerShell', 'Write']) fx.quiet(fx.lead(n, { tool }), `${tool} at ${n}`);
    });
  }

  test('main stays uncapped while a Lead agent is Frozen', async () => {
    const fx = await fixture();
    fx.agentLead(F);
    assert.ok(fx.isDeny(fx.agentLead(T, { tool: 'Read' })));
    for (const tool of ['Read', 'Bash', NEW_SESSION_TOOL, FEEDBACK_TOOL]) fx.quiet(fx.lead(T + 20000, { tool }), tool);
  });

  test('main at F writes no hand-over record and no guard record', async () => {
    const fx = await fixture();
    fx.lead(F);
    fx.lead(T);
    assert.deepEqual(fx.handovers(), []);
    assert.deepEqual(fx.guardRecord(), []);
  });

  test('a main payload that merely carries agent_type aico:project-manager (no agent_id) is not capped', async () => {
    const fx = await fixture();
    const t = fx.env.transcript('main-typed', [{ type: 'assistant', isSidechain: false, message: { usage: { input_tokens: 200000, output_tokens: 0 } } }]);
    const ev = fx.env.event('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, transcript_path: t, agent_type: LEAD_TYPE });
    fx.quiet(fx.env.run(ev));
  });
});
