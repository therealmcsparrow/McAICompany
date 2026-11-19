// Round 2 of bug P20261119.000001: R-13 a Lead that ended with no SubagentStop must not leave a stale live entry that mutes every
// later result (main's spawn of a Lead resets the live set), R-14 leadstart|leadstop|leadreset denied in the pins-mismatch text branch.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, leadStart, leadStop, leadReset } from '../../scripts/lead-relay.mjs';
import { judgeRecord } from '../../hooks/rules/self-protect.mjs';
import { capEnv, cleanup, LEAD_TYPE } from '../context-guard/cap-engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'lead-relay.mjs');
const tmp = [];
after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); cleanup(); });

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-live-'));
tmp.push(root);
const state = path.join(root, 'state');
const SLUG = 'P20261119.000008/02-lead';
const dir = path.join(root, '.company', 'work', ...SLUG.split('/'));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: '2026-11-19T10:00:00Z', ev: 'start' })}\n`);
const ev = (name, over = {}) => JSON.stringify({ hook_event_name: name, agent_id: 'a1', agent_type: LEAD_TYPE, ...over });
const block = `STATUS: done\nrun: .company/work/${SLUG}\nsummary: ok`;

test('R-13 unit: a stale live entry mutes a later Lead until leadReset clears the set', () => {
  leadStart(ev('SubagentStart', { agent_id: 'dead' }), root, state); // never stops (interrupt, crash)
  leadStart(ev('SubagentStart', { agent_id: 'a2' }), root, state);
  leadStop(ev('SubagentStop', { agent_id: 'a2', last_assistant_message: block }), root, state);
  assert.match(main(['result', SLUG], root).out, /result: none/, 'precondition: stale entry mutes the record');
  leadReset(ev('PreToolUse'), root, state);
  leadStart(ev('SubagentStart', { agent_id: 'a3' }), root, state);
  leadStop(ev('SubagentStop', { agent_id: 'a3', last_assistant_message: block }), root, state);
  assert.match(main(['result', SLUG], root).out, /STATUS: done/);
});

test('R-13 host: main spawning a Lead resets the live set; a stale entry no longer mutes the next Lead', async () => {
  const fx = await capEnv();
  fx.boot();
  const slug = fx.slug;
  const msg = `STATUS: handover\nrun: .company/work/${slug}\nhandoff: 01-x.md\nnext: resume`;
  const lead = (name, over = {}) => fx.env.event(name, { agent_id: 'lead-x', agent_type: LEAD_TYPE, ...over });
  const read = () => spawnSync(process.execPath, [SCRIPT, 'result', slug], { cwd: fx.env.project, encoding: 'utf8', timeout: 20000 }).stdout;
  fx.env.run(lead('SubagentStart', { agent_id: 'dead' })); // a Lead that never stopped
  const spawn = fx.env.run(fx.env.event('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: LEAD_TYPE, description: 'd', prompt: 'p' }, tool_use_id: 't1' }));
  assert.notEqual(spawn.json?.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(spawn.json));
  fx.env.run(lead('SubagentStart'));
  fx.env.run(lead('SubagentStop', { last_assistant_message: msg }));
  assert.match(read(), /STATUS: handover/);
});

test('R-14: leadstart, leadstop, leadreset in a shell naming lead-relay are denied by self-protect and by the pins-mismatch text branch', () => {
  for (const fn of ['leadStart', 'leadStop', 'leadReset']) {
    const cmd = `node -e "import('./scripts/lead-relay.mjs').then(m=>m.${fn}('x'))"`;
    assert.equal(judgeRecord({ tool: { name: 'Bash', command: cmd, paths: [] }, protected: [] }).v, 'deny', fn);
  }
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-r14-'));
  tmp.push(dst);
  for (const d of ['hooks', 'scripts', 'mods', 'company']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dst, d), { recursive: true });
  assert.equal(spawnSync(process.execPath, [path.join(dst, 'scripts', 'hook-pins.mjs'), 'write'], { encoding: 'utf8' }).status, 0);
  fs.appendFileSync(path.join(dst, 'scripts', 'run-state.mjs'), '\n// edit\n');
  for (const fn of ['leadStart', 'leadStop', 'leadReset']) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-r14h-'));
    tmp.push(home);
    const payload = { session_id: 'r14', transcript_path: 'r14.jsonl', cwd: ROOT, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: `node -e "import('./scripts/lead-relay.mjs').then(m=>m.${fn}('x'))"` } };
    const r = spawnSync(process.execPath, [path.join(dst, 'scripts', 'hook-host.mjs')], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home, AICO_GUARDS: 'off' } });
    assert.match(r.stdout, /"deny"/, `${fn}: ${r.stdout}`);
  }
});
