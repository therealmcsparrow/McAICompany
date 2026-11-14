// Lead side of the cap guard, run through the engine.
// Was: scripts/context-guard.mjs `pre` in process. Now: scripts/hook-host.mjs with the real cap.M1 rule and its
// effects (`context-guard` v2.0 "Bands": the Lead freezes at F, ends its turn at T). Harness: ./cap-engine.mjs.
// Assumption: the freeze / frozen / wait texts keep their v1.2 wording inside the deny reason; the tests pin
// the key phrase of each, not the whole sentence, because the engine prefixes `aico guard cap.M1: `.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { capEnv, cleanup, SLUG, NEW_SESSION_TOOL } from './cap-engine.mjs';
import { newSessionCommand } from '../../scripts/lead-handover.mjs';

after(cleanup);
const COMMAND = newSessionCommand(SLUG);
const hash12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const FREEZE = /the Lead Handoff is written and this session is frozen/;
const FROZEN = /this session is frozen\. Start a new session in the product folder with:/;
const WAIT = /no new Step from this session\. Wait for the running Step/;
const F = 162000;

async function lead(opts) {
  const fx = await capEnv(opts);
  fx.bootLead();
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

describe('Lead clean point (freeze band F <= tokens < T)', () => {
  test('the first call writes the Handoff and the context event, then denies with the freeze reason and the command', async () => {
    const fx = await lead();
    const r = fx.lead(F);
    assert.equal(r.code, 0);
    const reason = fx.denyOf(r);
    assert.match(reason, /cap\.M1/);
    assert.match(reason, FREEZE);
    assert.ok(reason.includes(COMMAND), 'the deny reason carries the new-session command');
    assert.equal(r.json.continue, undefined, 'the first freeze deny does not end the turn');
    const ev = fx.handovers().find((e) => e.trigger === 'context');
    assert.ok(ev, 'a context handover is recorded');
    assert.equal(ev.session, hash12('sess-lead-1'));
    assert.equal(ev.tokens, F);
    const body = fs.readFileSync(path.join(fx.runDir, ev.file), 'utf8');
    assert.ok(body.endsWith(`- New session command: ${COMMAND}\n`));
    assert.ok(!body.includes('sess-lead-1'));
    assert.ok(!fs.existsSync(path.join(fx.runDir, 'lead-freeze.lock')));
  });

  test('the MCP tool at the clean point is allowed and still freezes the session', async () => {
    const fx = await lead();
    fx.quiet(fx.lead(F, { tool: NEW_SESSION_TOOL }));
    assert.equal(fx.handovers().filter((e) => e.trigger === 'context').length, 1);
    fx.quiet(fx.lead(F, { tool: NEW_SESSION_TOOL }));
  });

  test('the CEO sees one note at the first freeze deny (systemMessage), never as model text', async () => {
    const fx = await lead();
    const r = fx.lead(F);
    assert.match(r.json.systemMessage ?? '', /^aico cap/);
    assert.ok(!r.json.hookSpecificOutput.permissionDecisionReason.includes(r.json.systemMessage));
  });
});

describe('Lead frozen', () => {
  async function frozen() {
    const fx = await lead();
    fx.lead(F);
    return fx;
  }

  test('any tool but the MCP tool stops the turn (continue:false) and names the command; one handover only', async () => {
    const fx = await frozen();
    for (const tool of ['Read', 'Agent', 'Write', 'PowerShell']) {
      const r = fx.lead(F, { tool });
      assert.equal(r.json.continue, false, tool);
      assert.match(text(r), FROZEN, tool);
      assert.ok(text(r).includes(COMMAND), tool);
      assert.ok(fx.isDeny(r), tool);
    }
    assert.equal(fx.handovers().length, 1);
  });

  test('the MCP tool is allowed', async () => {
    const fx = await frozen();
    fx.quiet(fx.lead(F, { tool: NEW_SESSION_TOOL }));
  });

  test('stays frozen with a Step running; a new session is not frozen by the old record', async () => {
    const fx = await frozen();
    fx.addSub('start', '000000000009');
    assert.equal(fx.lead(F).json.continue, false);
    fx.quiet(fx.lead(F, { session: 'sess-lead-2' }));
    assert.equal(fx.handovers().filter((e) => e.trigger === 'context').length, 1);
  });

  test('a manual compaction lowers the reading and unfreezes the session', async () => {
    const fx = await frozen();
    fx.quiet(fx.lead(F - 20000));
  });
});

describe('Lead with a Step running', () => {
  test('Agent and Task are denied with the wait reason, every other tool passes, nothing is written', async () => {
    const fx = await lead();
    fx.addSub('start');
    for (const tool of ['Agent', 'Task']) {
      const reason = fx.denyOf(fx.lead(F, { tool }));
      assert.match(reason, WAIT);
    }
    for (const tool of ['Read', 'PowerShell', 'Write', NEW_SESSION_TOOL]) fx.quiet(fx.lead(F, { tool }), tool);
    assert.deepEqual(fx.handovers(), []);
  });

  test('once the Step stopped the next call freezes', async () => {
    const fx = await lead();
    fx.addSub('start');
    fx.addSub('stop');
    assert.match(fx.denyOf(fx.lead(F, { tool: 'Agent' })), FREEZE);
  });
});

describe('Lead hand-over band (tokens >= T)', () => {
  for (const [n, ends] of [[179999, false], [180000, true], [180001, true]]) {
    test(`AC11 at ${n} the deny ${ends ? 'ends the turn (continue:false)' : 'does not end the turn'}`, async () => {
      const fx = await lead();
      const r = fx.lead(n);
      assert.match(fx.denyOf(r), /cap\.M1/);
      assert.equal(r.json.continue, ends ? false : undefined);
    });
  }

  test('a Step running at T still writes no Lead Handoff', async () => {
    const fx = await lead();
    fx.addSub('start');
    fx.lead(190000, { tool: 'Agent' });
    assert.deepEqual(fx.handovers(), []);
  });
});

describe('AC16 the off switch stands the Lead down only', () => {
  test('AICO_GUARDS=off: the Lead at 200000 passes and guards-off is recorded once per session', async () => {
    const fx = await lead();
    const t = fx.env.transcript('lead-off', [{ type: 'assistant', isSidechain: false, message: { usage: { input_tokens: 200000, output_tokens: 0 } } }]);
    const ev = () => fx.env.event('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, transcript_path: t });
    fx.quiet(fx.env.run(ev(), { env: { AICO_GUARDS: 'off' } }));
    fx.quiet(fx.env.run(ev(), { env: { AICO_GUARDS: 'off' } }));
    const rec = fx.guardRecord().filter((l) => l.ev === 'guards-off');
    assert.equal(rec.length, 1);
    assert.equal(rec[0].session, hash12('sess-lead-1'));
  });

  test('only the exact value off counts', async () => {
    const fx = await lead();
    const t = fx.env.transcript('lead-off2', [{ type: 'assistant', isSidechain: false, message: { usage: { input_tokens: 200000, output_tokens: 0 } } }]);
    const ev = fx.env.event('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, transcript_path: t });
    for (const v of ['OFF', '1', 'on', '']) assert.ok(fx.isDeny(fx.env.run(ev, { env: { AICO_GUARDS: v } })), `AICO_GUARDS=${v}`);
  });
});
