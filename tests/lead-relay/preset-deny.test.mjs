// Tests for lead-relay v1 `preset` (cch.M-SEC8): a PreToolUse AskUserQuestion call that carries `tool_input.answers` is denied in every
// session and not turned off by AICO_GUARDS=off; a call without `answers` gets no output. The wired hooks.json command is the one run
// (AC12), so the tests stay red until `preset` is wired. No hook script may emit `updatedInput`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = path.join(import.meta.dirname, '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8'));
const wired = (cfg.hooks.PreToolUse ?? []).find((e) => e.matcher === 'AskUserQuestion' && e.hooks.some((h) => /lead-relay\.mjs" preset$/.test(h.command)));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-deny-'));

const QUESTIONS = [{ question: 'Pass the Ship Gate?', header: 'Ship', multiSelect: false, options: [{ label: 'Pass', description: 'ship' }, { label: 'Stop', description: 'halt' }] }];
const call = (toolInput, extra = {}) => JSON.stringify({
  hook_event_name: 'PreToolUse', session_id: '3f2a9c1e-7b4d-4e0a-9c55-0a1b2c3d4e5f', cwd: home, tool_name: 'AskUserQuestion', tool_input: toolInput, ...extra,
});

// Runs the command of the wired entry (CLAUDE_PLUGIN_ROOT substituted), exactly as the harness would.
function run(input, env = {}) {
  assert.ok(wired, 'hooks.json has a PreToolUse entry, matcher AskUserQuestion, running lead-relay preset');
  const command = wired.hooks[0].command.replace('${CLAUDE_PLUGIN_ROOT}', repo.split(path.sep).join('/'));
  const r = spawnSync(command, { shell: true, cwd: home, input, encoding: 'utf8', timeout: 20000, env: { ...process.env, MCSPARROW_HOME: path.join(home, '.mcsparrow'), HOME: home, USERPROFILE: home, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const denied = (r) => {
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out);
  assert.equal(o.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(o.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(o.hookSpecificOutput.permissionDecisionReason.length > 0);
};

describe('the wired preset adapter', () => {
  test('the wired entry blocks on failure', () => {
    assert.ok(wired);
    assert.equal(wired.hooks[0].onFailure, 'block');
  });

  test('a filled answers map and an empty {} are both denied', () => {
    denied(run(call({ questions: QUESTIONS, answers: { 'Pass the Ship Gate?': 'Pass' } })));
    denied(run(call({ questions: QUESTIONS, answers: {} })));
  });

  test('main, Lead and Role payloads are all denied', () => {
    const answers = { 'Pass the Ship Gate?': 'Pass' };
    denied(run(call({ questions: QUESTIONS, answers })));
    denied(run(call({ questions: QUESTIONS, answers }, { agent_id: 'a1b2c3', agent_type: 'aico:project-manager' })));
    denied(run(call({ questions: QUESTIONS, answers }, { agent_id: 'a1b2c4', agent_type: 'aico:qa' })));
    denied(run(call({ questions: QUESTIONS, answers }, { agent_id: 'a1b2c5' })));
  });

  test('AICO_GUARDS=off does not turn the deny off', () => {
    denied(run(call({ questions: QUESTIONS, answers: { 'Pass the Ship Gate?': 'Pass' } }), { AICO_GUARDS: 'off' }));
    denied(run(call({ questions: QUESTIONS, answers: {} }), { AICO_GUARDS: 'off' }));
  });

  test('a call without answers gets no output, also with AICO_GUARDS=off', () => {
    for (const env of [{}, { AICO_GUARDS: 'off' }]) {
      const r = run(call({ questions: QUESTIONS }), env);
      assert.deepEqual([r.code, r.out], [0, '']);
    }
  });

  test('other tools and unreadable input get no output', () => {
    assert.deepEqual([run(call({ answers: {} }).replace('AskUserQuestion', 'Read')).code, run('{bad').out], [0, '']);
  });
});

describe('cch.M-SEC8: no hook script emits updatedInput', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() && e.name !== 'fixtures' && e.name !== 'node_modules'
    ? walk(path.join(d, e.name)) : /\.(mjs|js|cjs)$/.test(e.name) && !/\.test\./.test(e.name) ? [path.join(d, e.name)] : []));

  test('hooks/ and the scripts hooks.json runs never name updatedInput', () => {
    const hookScripts = new Set(Object.values(cfg.hooks).flat().flatMap((e) => e.hooks.map((h) => /scripts\/([\w-]+\.mjs)/.exec(h.command)?.[1]).filter(Boolean)));
    assert.ok(hookScripts.has('lead-relay.mjs'), 'lead-relay.mjs is wired');
    const files = [...walk(path.join(repo, 'hooks')), ...[...hookScripts].map((n) => path.join(repo, 'scripts', n))];
    assert.ok(files.length > 3);
    for (const f of files) assert.ok(!fs.readFileSync(f, 'utf8').includes('updatedInput'), path.relative(repo, f));
  });
});
