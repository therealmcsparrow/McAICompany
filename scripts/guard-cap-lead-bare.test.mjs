import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// cap.M1: main background spawn of a Lead target is denied by tool.leadTarget, even for bare `project-manager`.
const file = path.resolve(import.meta.dirname, '..', 'hooks', 'rules', 'cap.mjs');
const mk = (tool, run = null) => ({
  v: 1, event: 'PreToolUse', session: 'lead', sessionKey: 'aaaaaaaaaaaa', agentKey: null, agentType: null,
  tool: { name: 'Agent', command: null, paths: [], model: null, subagentType: null, outputRole: null, background: false, leadTarget: false, ...tool },
  tokens: { state: 'read', total: 0 }, mainModel: null,
  env: { guardsOff: false, subagentModel: null, subagentModelForce: null },
  protected: [], run, drift: [], stopHookActive: null,
});
const snap = { v: 1, at: 'x', threshold: 180000, savers: {}, floor: {}, drift: false, settingsWarnings: [] };

for (const [label, st] of [['bare project-manager', null], ['aico:project-manager', null], ['bare project-manager typed', 'Project-Manager']]) {
  test(`main background spawn of Lead (${label}) with no run is denied`, async () => {
    const { judge } = await import(pathToFileURL(file).href);
    const v = await judge(mk({ leadTarget: true, subagentType: st, background: true }), snap);
    assert.equal(v.v, 'deny');
    assert.equal(v.rule, 'cap.M1');
    assert.match(v.message, /foreground/i);
  });
}
test('main foreground spawn of Lead (leadTarget) with no run passes', async () => {
  const { judge } = await import(pathToFileURL(file).href);
  assert.deepEqual(await judge(mk({ leadTarget: true }), snap), { v: 'allow' });
});
