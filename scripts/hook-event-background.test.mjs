// Tests: hook-event v1.2 (additive): a PreToolUse reads `tool_input.run_in_background` as a boolean
// for the tools Bash, PowerShell, Agent, Task (P20261115.000001-T4, red until T5 lands).
// Assumption (one place): the field is `event.tool.background`; `event.background` is accepted too.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { normalize } from '../hooks/lib/event.mjs';

const ctx = { env: {}, schema: null, pluginRoot: null, mcsHome: os.tmpdir(), resolveRun: null };
const bgOf = (e) => (e.tool && 'background' in e.tool ? e.tool.background : e.background);

async function ev(tool, input, extra = {}) {
  const r = await normalize({ hook_event_name: 'PreToolUse', session_id: 's1', cwd: os.tmpdir(), tool_name: tool, tool_input: input, ...extra }, ctx);
  assert.equal(r.ok, true);
  return r.event;
}
const inputFor = (tool, more) => (tool === 'Agent' || tool === 'Task' ? { prompt: 'x', subagent_type: 'aico:qa', ...more } : { command: 'sleep 1', ...more });

describe('run_in_background on a Lead PreToolUse', () => {
  for (const tool of ['Bash', 'PowerShell', 'Agent', 'Task']) {
    test(`${tool}: true is read as true`, async () => {
      assert.equal(bgOf(await ev(tool, inputFor(tool, { run_in_background: true }))), true);
    });
    test(`${tool}: false is false`, async () => {
      assert.equal(bgOf(await ev(tool, inputFor(tool, { run_in_background: false }))), false);
    });
    test(`${tool}: key absent is false`, async () => {
      assert.equal(bgOf(await ev(tool, inputFor(tool, {}))), false);
    });
    test(`${tool}: a non-boolean value is false`, async () => {
      for (const v of ['true', 1, 'yes', null, {}, [true]]) {
        assert.equal(bgOf(await ev(tool, inputFor(tool, { run_in_background: v }))), false, `value ${JSON.stringify(v)}`);
      }
    });
  }

  test('an inherited run_in_background is not read (own property only)', async () => {
    const input = Object.create({ run_in_background: true });
    input.command = 'ls';
    assert.equal(bgOf(await ev('Bash', input)), false);
  });

  test('a tool_input that is not an object gives false', async () => {
    assert.equal(bgOf(await ev('Bash', 'run_in_background')), false);
  });

  test('the event stays frozen with the new field', async () => {
    const e = await ev('Bash', { command: 'ls', run_in_background: true });
    assert.equal(Object.isFrozen(e), true);
    assert.equal(Object.isFrozen(e.tool), true);
  });
});
