// Tests: the background launch ledger. Retired by context-guard v3.0 (T20): no `bg` row is ever written.
// Was (P20261115.000001-T4): a Lead launch with run_in_background appended one bg row. Kept as inverted no-row tests.
// A Lead PreToolUse with tool_input.run_in_background === true in an active run appends one
// {"ev":"bg","session":<sessionKey>} row (plus v, at) to <run folder>/guard.jsonl through the real host.
// No row for a Step session, a denied call, the flag false or no active run. A row at every token level.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { capEnv, cleanup, LEAD_TYPE, LEAD_AGENT } from '../tests/context-guard/cap-engine.mjs';
import { key12 } from '../hooks/fixtures/engine/harness.mjs';

after(cleanup);
const SESSION = 'sess-lead-1';
const bgRows = (fx) => fx.guardRecord().filter((r) => r.ev === 'bg');
const bg = { command: 'sleep 1', run_in_background: true };

async function lead(opts) {
  const fx = await capEnv(opts);
  fx.bootLead();
  return fx;
}

// context-guard v3.0 (T20): bg rows are removed. Every case that expected a row now expects none.
describe('v3.0: no bg row for any Lead launch', () => {
  for (const tool of ['Bash', 'PowerShell', 'Agent', 'Task']) {
    test(`${tool} with run_in_background true: no row`, async () => {
      const fx = await lead();
      const input = tool === 'Agent' || tool === 'Task' ? { prompt: 'x', subagent_type: 'aico:qa', run_in_background: true } : bg;
      const r = fx.lead(50000, { tool, input });
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(bgRows(fx), [], JSON.stringify(fx.guardRecord()));
    });
  }

  for (const tokens of [1000, 50000, 100000, 161999, 200000]) {
    test(`no row at ${tokens} tokens`, async () => {
      const fx = await lead();
      const r = fx.lead(tokens, { input: bg });
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(bgRows(fx), []);
    });
  }

  test('no row when the transcript has no readable usage', async () => {
    const fx = await lead();
    const r = fx.env.run(fx.env.event('PreToolUse', { tool_name: 'Bash', tool_input: bg }));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(bgRows(fx), []);
  });

  test('the tool call stays allowed and silent; two launches write nothing', async () => {
    const fx = await lead();
    fx.quiet(fx.lead(50000, { input: bg }));
    fx.quiet(fx.lead(50000, { input: bg }));
    assert.deepEqual(bgRows(fx), []);
    assert.deepEqual(fx.guardRecord(), []);
  });
});

describe('no bg row', () => {
  test('flag false', async () => {
    const fx = await lead();
    fx.lead(50000, { input: { command: 'ls', run_in_background: false } });
    assert.deepEqual(bgRows(fx), []);
  });

  test('flag absent', async () => {
    const fx = await lead();
    fx.lead(50000, { input: { command: 'ls' } });
    assert.deepEqual(bgRows(fx), []);
  });

  test('flag not a boolean ("true", 1)', async () => {
    const fx = await lead();
    fx.lead(50000, { input: { command: 'ls', run_in_background: 'true' } });
    fx.lead(50000, { input: { command: 'ls', run_in_background: 1 } });
    assert.deepEqual(bgRows(fx), []);
  });

  test('Step session (agent_id set) with the flag true', async () => {
    const fx = await lead();
    fx.boot();
    const r = fx.step(50000, { tool: 'Bash', input: bg });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(bgRows(fx), []);
  });

  test('a Lead agent call denied over the freeze point leaves no row', async () => {
    const fx = await lead();
    const r = fx.step(200000, { tool: 'Bash', input: bg, agent: LEAD_AGENT, over: { agent_type: LEAD_TYPE } });
    assert.ok(fx.capDeny(r), `expected a cap deny: ${r.out} ${r.err}`);
    assert.deepEqual(bgRows(fx), []);
  });

  test('no active run: no row, no crash', async () => {
    const fx = await lead({ run: false });
    const r = fx.lead(50000, { input: bg });
    assert.equal(r.code, 0, r.err);
    assert.equal(fx.guardRecord(fx.env.project).length, 0);
  });

  test('a tool outside the four names (Read) with the flag true leaves no row', async () => {
    const fx = await lead();
    fx.lead(50000, { tool: 'Read', input: { file_path: 'x.txt', run_in_background: true } });
    assert.deepEqual(bgRows(fx), []);
  });
});
