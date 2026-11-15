// Regression: with AICO_GUARDS=off the host must not
// append a `bg` guard row: the Lead opted out of guard bookkeeping, only the one `guards-off` row is written.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { capEnv, cleanup } from '../tests/context-guard/cap-engine.mjs';

after(cleanup);
const bg = { command: 'sleep 1', run_in_background: true };

async function leadPre(guardEnv) {
  const fx = await capEnv();
  fx.bootLead();
  const t = fx.env.transcript('lead-sess-lead-1', [{ type: 'assistant', isSidechain: false, message: { model: 'claude-opus-4-1', usage: { input_tokens: 50000, output_tokens: 1 } } }]);
  const r = fx.env.run(fx.env.event('PreToolUse', { tool_name: 'Bash', tool_input: bg, transcript_path: t, session_id: 'sess-lead-1' }), { env: guardEnv });
  assert.equal(r.code, 0, r.err);
  return fx.guardRecord();
}

test('control: guards on, a Lead background launch writes one bg row', async () => {
  const rows = await leadPre({});
  assert.equal(rows.filter((r) => r.ev === 'bg').length, 1, JSON.stringify(rows));
});

test('S-6: AICO_GUARDS=off, a Lead background launch writes no bg row', async () => {
  const rows = await leadPre({ AICO_GUARDS: 'off' });
  assert.equal(rows.filter((r) => r.ev === 'bg').length, 0, `bg row written with guards off: ${JSON.stringify(rows)}`);
  assert.equal(rows.filter((r) => r.ev === 'guards-off').length, 1, 'the one guards-off row is still recorded');
});
