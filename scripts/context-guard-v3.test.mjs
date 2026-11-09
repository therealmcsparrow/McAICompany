// QA-first for P20261109.000009-T11 (AC15): context-guard finds the active v3 run `<ID>/<NN>-<pb>`, keeps its record in
// that run folder and allows a new Handoff written directly in it. The v2 cases stay in tests/context-guard/guard.test.mjs.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pre, subagentStop } from './context-guard.mjs';
import { HANDOVER_AT } from './lead-handover.mjs';
import { append } from './run-state.mjs';

const ID = 'P20261109.000009';
const SLUG = `${ID}/01-feature`;
const AGENT = 'a1b2c3d4e5f60718';
const NOW = Math.floor(Date.now() / 1000) * 1000;
const quiet = { code: 0, out: '', err: '' };
const usage = (n) => ({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: n - 15 });

const bases = [];
after(() => { for (const b of bases) fs.rmSync(b, { recursive: true, force: true }); });

function fixture({ tokens = HANDOVER_AT } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-v3-'));
  bases.push(base);
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const dir = path.join(root, '.company', 'work', ID, '01-feature');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', ID, '00-project.md'), 'A demo project\n');
  append(root, SLUG, { ev: 'start' }, { now: NOW - 60000 });
  const proj = path.join(claudeDir, 'projects', 'p');
  fs.mkdirSync(path.join(proj, 'sess', 'subagents'), { recursive: true });
  const transcript = path.join(proj, 'sess.jsonl');
  const row = (u, side) => `${JSON.stringify({ type: 'assistant', isSidechain: side, message: { usage: u } })}\n`;
  fs.writeFileSync(transcript, row(usage(1000), false));
  fs.writeFileSync(path.join(proj, 'sess', 'subagents', `agent-${AGENT}.jsonl`), `${JSON.stringify({ type: 'meta' })}\n${row(usage(tokens), true)}`);
  const input = (extra = {}) => JSON.stringify({ hook_event_name: 'PreToolUse', transcript_path: transcript, session_id: 's', agent_id: AGENT, tool_name: 'Read', tool_input: {}, ...extra });
  const opts = { root, claudeDir, env: {}, now: NOW };
  const guard = () => {
    const f = path.join(dir, 'context-guard.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  return { root, dir, input, opts, guard };
}

const decision = (r) => JSON.parse(r.out).hookSpecificOutput;

describe('v3 run folder', () => {
  test('AC15: below the hand-over point stays silent with no record', () => {
    const fx = fixture({ tokens: HANDOVER_AT - 1 });
    assert.deepEqual(pre(fx.input(), fx.opts), quiet);
    assert.deepEqual(fx.guard(), []);
  });

  test('AC15: at the hand-over point a tool is denied and the deny is recorded in the v3 run folder', () => {
    const fx = fixture();
    const d = decision(pre(fx.input(), fx.opts));
    assert.equal(d.permissionDecision, 'deny');
    assert.deepEqual(fx.guard().map((l) => l.ev), ['deny']);
  });

  test('AC15: a Write of a new Handoff directly in the v3 run folder is allowed and recorded', () => {
    const fx = fixture();
    const file = path.join(fx.dir, '04-backend-engineer.md');
    assert.deepEqual(pre(fx.input({ tool_name: 'Write', tool_input: { file_path: file, content: 'x' } }), fx.opts), quiet);
    assert.deepEqual(fx.guard().map((l) => [l.ev, l.file]), [['handoff', '04-backend-engineer.md']]);
  });

  test('AC15: a findings ledger in the v3 run folder is allowed once, recorded as a ledger', () => {
    const fx = fixture();
    const w = (name) => pre(fx.input({ tool_name: 'Write', tool_input: { file_path: path.join(fx.dir, name), content: 'x' } }), fx.opts);
    assert.deepEqual(w('04-code-reviewer.findings.md'), quiet);
    assert.equal(decision(w('04-other.findings.md')).permissionDecision, 'deny');
  });

  test('AC15: a Write in the project folder, a sibling run folder or a deeper path is denied', () => {
    const fx = fixture();
    const work = path.join(fx.root, '.company', 'work', ID);
    fs.mkdirSync(path.join(work, '02-fix'), { recursive: true });
    for (const file of [path.join(work, '04-x.md'), path.join(work, '02-fix', '04-x.md'), path.join(fx.dir, 'sub', '04-x.md')]) {
      const r = pre(fx.input({ tool_name: 'Write', tool_input: { file_path: file, content: 'x' } }), fx.opts);
      assert.equal(decision(r).permissionDecision, 'deny', file);
    }
    assert.ok(fx.guard().every((l) => l.ev === 'deny'));
  });

  test('AC15: SubagentStop blocks once after a deny with no Handoff, and lets a Step that wrote one end', () => {
    const fx = fixture();
    pre(fx.input(), fx.opts);
    const block = subagentStop(JSON.stringify({ hook_event_name: 'SubagentStop', agent_id: AGENT }), fx.opts);
    assert.equal(JSON.parse(block.out).decision, 'block');
    const file = path.join(fx.dir, '04-backend-engineer.md');
    pre(fx.input({ tool_name: 'Write', tool_input: { file_path: file, content: 'x' } }), fx.opts);
    fs.writeFileSync(file, 'x');
    assert.deepEqual(subagentStop(JSON.stringify({ hook_event_name: 'SubagentStop', agent_id: AGENT }), fx.opts), quiet);
  });
});
