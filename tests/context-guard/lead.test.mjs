// Lead side of the cap guard, run through the engine. v3.0 (T20): cap.M1 caps the Lead AGENT (agent_id payload), never main.
// Was: scripts/context-guard.mjs `pre` in process. Now: scripts/hook-host.mjs with the real cap.M1 rule and its
// effects (`context-guard` v2.0 "Bands": the Lead freezes at F, ends its turn at T). Harness: ./cap-engine.mjs.
// Assumption: the freeze / frozen / wait texts keep their v1.2 wording inside the deny reason; the tests pin
// the key phrase of each, not the whole sentence, because the engine prefixes `aico guard cap.M1: `.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { capEnv, cleanup, SLUG, NEW_SESSION_TOOL, LEAD_TYPE, LEAD_AGENT } from './cap-engine.mjs';
import { newSessionCommand } from '../../scripts/lead-handover.mjs';

after(cleanup);
const COMMAND = newSessionCommand(SLUG);
const hash12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const FREEZE = /the Lead Handoff is written and this session is frozen/;
const FROZEN = /this session is frozen\. Start a new session in the product folder with:/;
const F = 162000;

async function lead(opts) {
  const fx = await capEnv(opts);
  fx.bootLead();
  // A Lead agent call at `tokens`: its own agent file carries the reading, the main chain stays small.
  fx.agentLead = (tokens, { tool = 'Bash', input = { command: 'ls' }, agent = LEAD_AGENT } = {}) =>
    fx.step(tokens, { tool, input, agent, over: { agent_type: LEAD_TYPE } });
  return fx;
}
const text = (r) => `${r.json?.hookSpecificOutput?.permissionDecisionReason ?? ''} ${r.json?.systemMessage ?? ''} ${r.json?.stopReason ?? ''}`;

describe('Lead below the freeze point', () => {
  test('AC11 161999: silent, nothing written', async () => {
    const fx = await lead();
    fx.quiet(fx.lead(161999));
    assert.deepEqual(fx.handovers(), []);
    assert.deepEqual(fx.guardRecord(), []);
  });

  test('unknown tokens (no transcript) and no active run pass', async () => {
    const fx = await lead();
    fx.quiet(fx.env.run(fx.env.event('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } })));
    const none = await lead({ run: false });
    fx.quiet(none.lead(900000));
    assert.deepEqual(none.handovers(none.env.project), []);
  });
});

describe('main session is never capped (context-guard v3.0)', () => {
  test('main at and far over F and T is allowed, nothing written', async () => {
    const fx = await lead();
    for (const n of [F, 179999, 180000, 250000]) {
      for (const tool of ['Read', 'Bash', NEW_SESSION_TOOL]) fx.quiet(fx.lead(n, { tool }), `${tool} at ${n}`);
    }
    assert.deepEqual(fx.handovers(), []);
  });

  test('R-14 main spawning aico:project-manager (Agent) at and over F and T is allowed, nothing written', async () => {
    const fx = await lead();
    const input = { subagent_type: LEAD_TYPE, description: 'run lead', prompt: 'go' };
    for (const n of [F, 179999, 180000, 250000]) {
      for (const tool of ['Agent', 'Task']) fx.quiet(fx.lead(n, { tool, input }), `${tool} at ${n}`);
    }
    assert.deepEqual(fx.handovers(), []);
    assert.deepEqual(fx.guardRecord(), []);
  });
});

describe('Lead agent clean point (freeze band F <= tokens < T)', () => {
  test('the first call writes the Handoff and the context event, then denies with the freeze reason', async () => {
    const fx = await lead();
    const r = fx.agentLead(F);
    assert.equal(r.code, 0);
    const reason = fx.denyOf(r);
    assert.match(reason, /cap\.M1/);
    assert.match(reason, /STATUS: handover/);
    assert.match(reason, /handoff:/);
    assert.match(reason, /next:/);
    assert.equal(r.json.continue, undefined, 'the first freeze deny does not end the turn');
    const ev = fx.handovers().find((e) => e.trigger === 'context');
    assert.ok(ev, 'a context handover is recorded');
    assert.equal(ev.tokens, F);
    const body = fs.readFileSync(path.join(fx.runDir, ev.file), 'utf8');
    assert.ok(!body.includes('sess-lead-1'));
    assert.ok(!fs.existsSync(path.join(fx.runDir, 'lead-freeze.lock')));
  });

  test('the MCP tool is denied too at the clean point and the session freezes once', async () => {
    const fx = await lead();
    assert.ok(fx.isDeny(fx.agentLead(F, { tool: NEW_SESSION_TOOL })));
    assert.ok(fx.isDeny(fx.agentLead(F, { tool: NEW_SESSION_TOOL })));
    assert.equal(fx.handovers().filter((e) => e.trigger === 'context').length, 1);
  });

  test('the CEO sees one note at the first freeze deny (systemMessage), never as model text', async () => {
    const fx = await lead();
    const r = fx.agentLead(F);
    assert.match(r.json.systemMessage ?? '', /^aico cap/);
    assert.ok(!r.json.hookSpecificOutput.permissionDecisionReason.includes(r.json.systemMessage));
  });
});

describe('Lead agent frozen', () => {
  async function frozen() {
    const fx = await lead();
    fx.agentLead(F);
    return fx;
  }

  test('every tool is denied, never continue:false; one handover only', async () => {
    const fx = await frozen();
    for (const tool of ['Read', 'Agent', 'Write', 'PowerShell', NEW_SESSION_TOOL]) {
      const r = fx.agentLead(F, { tool });
      assert.notEqual(r.json.continue, false, tool);
      assert.ok(fx.isDeny(r), tool);
      assert.match(text(r), /STATUS: handover/, tool);
    }
    assert.equal(fx.handovers().length, 1);
  });

  test('stays frozen with a Step running; another Lead agent is not frozen by the old record', async () => {
    const fx = await frozen();
    fx.addSub('start', '000000000009');
    const r = fx.agentLead(F);
    assert.ok(fx.isDeny(r));
    assert.notEqual(r.json.continue, false);
    fx.quiet(fx.agentLead(1000, { agent: 'agent-lead2' }));
    assert.equal(fx.handovers().filter((e) => e.trigger === 'context').length, 1);
  });

  test('a manual compaction lowers the reading and unfreezes the session', async () => {
    const fx = await frozen();
    fx.quiet(fx.agentLead(F - 20000));
  });
});

describe('Lead agent with a Step running', () => {
  test('the wait reason is kept: Agent and Task at F are denied with it, other tools pass (context-guard v3.0)', async () => {
    const fx = await lead();
    fx.addSub('start');
    for (const tool of ['Agent', 'Task']) assert.match(text(fx.agentLead(F, { tool })), /Wait for it to finish/, tool);
    fx.quiet(fx.agentLead(F, { tool: 'Read' }), 'Read');
  });

  test('below F a running Step changes nothing', async () => {
    const fx = await lead();
    fx.addSub('start');
    for (const tool of ['Agent', 'Task', 'Read']) fx.quiet(fx.agentLead(F - 1, { tool }), tool);
    assert.deepEqual(fx.handovers(), []);
  });
});

describe('Lead agent hand-over band (tokens >= T)', () => {
  for (const n of [179999, 180000, 180001]) {
    test(`AC11 at ${n} the deny never ends the turn (continue:false)`, async () => {
      const fx = await lead();
      const r = fx.agentLead(n);
      assert.match(fx.denyOf(r), /cap\.M1/);
      assert.notEqual(r.json.continue, false);
    });
  }

  test('a Step running at T is still denied and writes no Lead Handoff', async () => {
    const fx = await lead();
    fx.addSub('start');
    assert.ok(fx.isDeny(fx.agentLead(190000, { tool: 'Agent' })));
    assert.deepEqual(fx.handovers(), []);
  });
});

describe('AC16 the off switch stands the Lead down only', () => {
  // A Lead agent PreToolUse payload at `tokens` (agent file reading), run with extra env.
  const agentRun = (fx, name, tokens, env) => {
    const t = fx.env.transcript(`main-${name}`, [{ type: 'assistant', isSidechain: false, message: { usage: { input_tokens: 1000, output_tokens: 0 } } }]);
    const dir = t.replace(/\.jsonl$/, '');
    fs.mkdirSync(path.join(dir, 'subagents'), { recursive: true });
    const line = { type: 'assistant', isSidechain: true, message: { usage: { input_tokens: tokens, output_tokens: 0 } } };
    fs.writeFileSync(path.join(dir, 'subagents', `agent-${name}.jsonl`), `${JSON.stringify({ type: 'meta' })}
${JSON.stringify(line)}
`);
    const ev = fx.env.event('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, transcript_path: t, agent_id: name, agent_type: LEAD_TYPE });
    return fx.env.run(ev, { env });
  };

  test('AICO_GUARDS=off: the Lead agent at 200000 passes and guards-off is recorded once per session', async () => {
    const fx = await lead();
    fx.quiet(agentRun(fx, 'agent-off', 200000, { AICO_GUARDS: 'off' }));
    fx.quiet(agentRun(fx, 'agent-off', 200000, { AICO_GUARDS: 'off' }));
    const rec = fx.guardRecord().filter((l) => l.ev === 'guards-off');
    assert.equal(rec.length, 1);
    assert.equal(rec[0].session, hash12('sess-lead-1'));
  });

  test('only the exact value off counts', async () => {
    const fx = await lead();
    for (const v of ['OFF', '1', 'on', '']) assert.ok(fx.isDeny(agentRun(fx, `agent-off-${v || 'empty'}`, 200000, { AICO_GUARDS: v })), `AICO_GUARDS=${v}`);
  });
});
