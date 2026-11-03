import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pre, subagentStop, STEP_REASON, STOP_REASON } from '../../scripts/context-guard.mjs';
import { transcriptTokens, newSessionCommand, findRun, HANDOVER_AT } from '../../scripts/lead-handover.mjs';
import { append, show } from '../../scripts/run-state.mjs';

const SLUG = '2026-11-02 18.32 - Guard Test';
const AGENT = 'a1b2c3d4e5f60718';
const NOW = Math.floor(Date.now() / 1000) * 1000;
const usage = (n) => ({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: n - 15 });
const hash12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const quiet = { code: 0, out: '', err: '' };

function fixture({ tokens = HANDOVER_AT, run = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'context-guard-'));
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const dir = path.join(root, '.company', 'work', SLUG);
  fs.mkdirSync(dir, { recursive: true });
  if (run) append(root, SLUG, { ev: 'start' }, { now: NOW - 60000 });
  const proj = path.join(claudeDir, 'projects', 'p');
  fs.mkdirSync(path.join(proj, 'sess', 'subagents'), { recursive: true });
  const transcript = path.join(proj, 'sess.jsonl');
  const row = (u, side) => `${JSON.stringify({ type: 'assistant', isSidechain: side, message: { usage: u } })}\n`;
  fs.writeFileSync(transcript, row(usage(1000), false));
  fs.writeFileSync(path.join(proj, 'sess', 'subagents', `agent-${AGENT}.jsonl`), `${JSON.stringify({ type: 'meta' })}\n${row(usage(500), true)}${row(usage(tokens), true)}`);
  const input = (extra = {}) => JSON.stringify({ hook_event_name: 'PreToolUse', transcript_path: transcript, session_id: 's', agent_id: AGENT, tool_name: 'Read', tool_input: {}, ...extra });
  const opts = { root, claudeDir, env: {}, now: NOW };
  const guard = () => {
    const f = path.join(dir, 'context-guard.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  return { base, root, claudeDir, dir, transcript, input, opts, guard };
}

const decision = (r) => JSON.parse(r.out).hookSpecificOutput;

describe('subagent', () => {
  test('below the hand-over point: silent, no record', () => {
    const fx = fixture({ tokens: HANDOVER_AT - 1 });
    assert.deepEqual(pre(fx.input(), fx.opts), quiet);
    assert.deepEqual(fx.guard(), []);
  });

  test('at the hand-over point a tool is denied with the exact text, one deny per agent', () => {
    const fx = fixture();
    for (let i = 0; i < 2; i++) {
      const r = pre(fx.input(), fx.opts);
      assert.equal(r.code, 0);
      const d = decision(r);
      assert.equal(d.hookEventName, 'PreToolUse');
      assert.equal(d.permissionDecision, 'deny');
      assert.equal(d.permissionDecisionReason, 'aico context cap: this Step reached the hand-over point. Write your Handoff with status: handover to your Output path now, then end. Every other tool is refused.');
    }
    assert.equal(STEP_REASON, decision(pre(fx.input(), fx.opts)).permissionDecisionReason);
    const g = fx.guard();
    assert.equal(g.length, 1);
    assert.deepEqual(Object.keys(g[0]), ['v', 'at', 'ev', 'id']);
    assert.equal(g[0].ev, 'deny');
    assert.match(g[0].id, /^[0-9a-f]{12}$/);
    assert.ok(!JSON.stringify(g).includes(AGENT));
  });

  test('a Write of a new Handoff in the run folder is allowed and recorded', () => {
    const fx = fixture();
    const file = path.join(fx.dir, '04-backend-engineer.md');
    const r = pre(fx.input({ tool_name: 'Write', tool_input: { file_path: file, content: 'x' } }), fx.opts);
    assert.deepEqual(r, quiet);
    assert.deepEqual(fx.guard().map((l) => [l.ev, l.file]), [['handoff', '04-backend-engineer.md']]);
  });

  test('a Write elsewhere, to an existing file or with a bad name is denied', () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.dir, '05-x.md'), 'old');
    const bad = [
      path.join(fx.dir, '05-x.md'),
      path.join(fx.dir, 'notes.md'),
      path.join(fx.dir, '..', '06-x.md'),
      path.join(fx.root, 'src', '06-x.md'),
      path.join(fx.dir, 'sub', '06-x.md'),
      path.join(fx.dir, '06-x.md.txt'),
    ];
    for (const file of bad) {
      const r = pre(fx.input({ tool_name: 'Write', tool_input: { file_path: file } }), fx.opts);
      assert.equal(decision(r).permissionDecision, 'deny', file);
    }
    assert.ok(fx.guard().every((l) => l.ev === 'deny'));
  });

  test('one new findings ledger is allowed per Step, recorded as ledger and not as handoff', () => {
    const fx = fixture();
    const w = (name) => pre(fx.input({ tool_name: 'Write', tool_input: { file_path: path.join(fx.dir, name), content: 'x' } }), fx.opts);
    assert.deepEqual(w('04-code-reviewer.findings.md'), quiet);
    assert.equal(decision(w('04-other.findings.md')).permissionDecision, 'deny');
    assert.deepEqual(fx.guard().map((l) => [l.ev, l.file ?? null]), [['ledger', '04-code-reviewer.findings.md'], ['deny', null]]);
    fs.writeFileSync(path.join(fx.dir, '04-code-reviewer.findings.md'), 'old');
    assert.equal(decision(w('04-code-reviewer.findings.md')).permissionDecision, 'deny');
  });

  test('a relative file_path is refused and a repeated Handoff Write is recorded once', () => {
    const fx = fixture();
    const rel = pre(fx.input({ tool_name: 'Write', tool_input: { file_path: path.relative(fx.root, path.join(fx.dir, '07-x.md')), content: 'x' } }), fx.opts);
    assert.equal(decision(rel).permissionDecision, 'deny');
    const abs = fx.input({ tool_name: 'Write', tool_input: { file_path: path.join(fx.dir, '07-x.md'), content: 'x' } });
    pre(abs, fx.opts);
    pre(abs, fx.opts);
    assert.deepEqual(fx.guard().filter((l) => l.ev === 'handoff').map((l) => l.file), ['07-x.md']);
  });

  test('a link in place of the new file is denied', (t) => {
    const fx = fixture();
    const link = path.join(fx.dir, '07-x.md');
    try { fs.symlinkSync(path.join(fx.base, 'nowhere'), link); } catch { t.skip('no symlink right'); return; }
    const r = pre(fx.input({ tool_name: 'Write', tool_input: { file_path: link } }), fx.opts);
    assert.equal(decision(r).permissionDecision, 'deny');
  });

  test('fail open: off, Lead, bad agent id, no run, bad input, missing transcript', () => {
    const fx = fixture();
    assert.deepEqual(pre(fx.input(), { ...fx.opts, env: { AICO_CONTEXT_GUARD: 'off' } }), quiet);
    assert.notDeepEqual(pre(fx.input(), { ...fx.opts, env: { AICO_CONTEXT_GUARD: 'OFF' } }), quiet);
    const lead = JSON.parse(fx.input());
    delete lead.agent_id;
    assert.deepEqual(pre(JSON.stringify(lead), fx.opts), quiet);
    assert.deepEqual(pre(fx.input({ agent_id: '../x' }), fx.opts), quiet);
    assert.deepEqual(pre(fx.input({ hook_event_name: 'PostToolUse' }), fx.opts), quiet);
    assert.deepEqual(pre('not json', fx.opts), quiet);
    assert.deepEqual(pre('[]', fx.opts), quiet);
    assert.deepEqual(pre(fx.input({ transcript_path: path.join(fx.base, 'nope.jsonl') }), fx.opts), quiet);
    assert.deepEqual(pre(fx.input({ transcript_path: 5 }), fx.opts), quiet);
    assert.deepEqual(pre('x'.repeat(4 * 1024 * 1024 + 1), fx.opts), quiet);
    const none = fixture({ run: false });
    assert.deepEqual(pre(none.input(), none.opts), quiet);
    assert.deepEqual(none.guard(), []);
  });

  test('a transcript outside the Claude projects folder is unknown, so allowed', () => {
    const fx = fixture();
    const out = path.join(fx.base, 'outside');
    fs.mkdirSync(path.join(out, 'sess', 'subagents'), { recursive: true });
    fs.copyFileSync(path.join(fx.claudeDir, 'projects', 'p', 'sess', 'subagents', `agent-${AGENT}.jsonl`), path.join(out, 'sess', 'subagents', `agent-${AGENT}.jsonl`));
    fs.writeFileSync(path.join(out, 'sess.jsonl'), '');
    assert.equal(pre(fx.input({ transcript_path: path.join(out, 'sess.jsonl') }), fx.opts).out, '');
  });

  test('a Step in a worktree reads the run from the main tree', () => {
    const fx = fixture();
    const gd = path.join(fx.root, '.git', 'worktrees', 'w1');
    fs.mkdirSync(gd, { recursive: true });
    const wt = path.join(fx.base, 'wt');
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gd}\n`);
    fs.writeFileSync(path.join(gd, 'gitdir'), `${path.join(wt, '.git')}\n`);
    fs.writeFileSync(path.join(gd, 'commondir'), '../..\n');
    const r = pre(fx.input(), { ...fx.opts, root: wt });
    assert.equal(decision(r).permissionDecision, 'deny');
    assert.equal(fx.guard().length, 1);
  });

  test('a worktree pointer the main .git does not confirm is not followed', () => {
    const fx = fixture();
    const gd = path.join(fx.root, '.git', 'worktrees', 'w1');
    fs.mkdirSync(gd, { recursive: true });
    const wt = path.join(fx.base, 'wt2');
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gd}\n`);
    assert.equal(pre(fx.input(), { ...fx.opts, root: wt }).out, '');
    fs.writeFileSync(path.join(gd, 'gitdir'), `${path.join(fx.base, 'other', '.git')}\n`);
    fs.writeFileSync(path.join(gd, 'commondir'), '../..\n');
    assert.equal(pre(fx.input(), { ...fx.opts, root: wt }).out, '');
    assert.equal(fx.guard().length, 0);
  });

  test('a Step in a worktree may write its Handoff by absolute run-folder path, and its stop follows the record', () => {
    const fx = fixture();
    const gd = path.join(fx.root, '.git', 'worktrees', 'w1');
    fs.mkdirSync(gd, { recursive: true });
    const wt = path.join(fx.base, 'wt3');
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gd}\n`);
    fs.writeFileSync(path.join(gd, 'gitdir'), `${path.join(wt, '.git')}\n`);
    fs.writeFileSync(path.join(gd, 'commondir'), '../..\n');
    const o = { ...fx.opts, root: wt };
    const stop = JSON.stringify({ hook_event_name: 'SubagentStop', transcript_path: fx.transcript, agent_id: AGENT, stop_hook_active: false });
    assert.equal(decision(pre(fx.input(), o)).permissionDecision, 'deny');
    const file = path.join(fx.dir, '04-backend-engineer.md');
    assert.deepEqual(pre(fx.input({ tool_name: 'Write', tool_input: { file_path: file, content: 'x' } }), o), quiet);
    assert.deepEqual(fx.guard().map((l) => l.ev), ['deny', 'handoff']);
    assert.equal(JSON.parse(subagentStop(stop, o).out).decision, 'block');
    fs.writeFileSync(file, 'h');
    assert.equal(subagentStop(stop, o).out, '');
  });

  test('a full guard record never lifts a deny and is not appended to; a stop with no deny on record passes', () => {
    const fx = fixture();
    const rec = path.join(fx.dir, 'context-guard.jsonl');
    const at = `${new Date(NOW).toISOString().slice(0, 19)}Z`;
    const lines = Array.from({ length: 1000 }, (_, i) => JSON.stringify({ v: 1, at, ev: 'deny', id: String(i).padStart(12, '0') }));
    fs.writeFileSync(rec, lines.map((l) => `${l}\n`).join(''));
    const before = fs.readFileSync(rec);
    assert.equal(decision(pre(fx.input(), fx.opts)).permissionDecision, 'deny');
    assert.deepEqual(pre(fx.input({ tool_name: 'Write', tool_input: { file_path: path.join(fx.dir, '03-x.md') } }), fx.opts), quiet);
    assert.deepEqual(pre(fx.input({ tool_name: 'Write', tool_input: { file_path: path.join(fx.dir, '05-x.findings.md'), content: 'x' } }), fx.opts), quiet, 'new ledger allowed, unrecorded');
    assert.ok(before.equals(fs.readFileSync(rec)), 'nothing appended');
    const stop = JSON.stringify({ hook_event_name: 'SubagentStop', transcript_path: fx.transcript, agent_id: AGENT, stop_hook_active: false });
    assert.equal(subagentStop(stop, fx.opts).out, '');
  });

  test('a garbage line among valid ones is ignored and the valid deny still counts', () => {
    const fx = fixture();
    const at = `${new Date(NOW).toISOString().slice(0, 19)}Z`;
    const deny = JSON.stringify({ v: 1, at, ev: 'deny', id: hash12(AGENT) });
    fs.writeFileSync(path.join(fx.dir, 'context-guard.jsonl'), ['garbage', deny, '{"v":1}'].map((l) => `${l}\n`).join(''));
    const stop = JSON.stringify({ hook_event_name: 'SubagentStop', transcript_path: fx.transcript, agent_id: AGENT, stop_hook_active: false });
    assert.equal(JSON.parse(subagentStop(stop, fx.opts).out).decision, 'block');
    pre(fx.input(), fx.opts);
    const raw = fs.readFileSync(path.join(fx.dir, 'context-guard.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(raw.filter((l) => l.includes('"ev":"deny"')).length, 1, 'no second deny for the same agent');
  });

  test('transcriptTokens keeps the Lead and the Step rows apart', () => {
    const fx = fixture();
    const step = path.join(fx.claudeDir, 'projects', 'p', 'sess', 'subagents', `agent-${AGENT}.jsonl`);
    assert.equal(transcriptTokens(fx.transcript, fx.claudeDir), 1000);
    assert.equal(transcriptTokens(step, fx.claudeDir, true), HANDOVER_AT);
    assert.equal(transcriptTokens(step, fx.claudeDir), null);
    assert.equal(findRun(fx.root, NOW), SLUG);
  });

  test('newSessionCommand is text for a good name only', () => {
    assert.equal(newSessionCommand(SLUG), `claude "aico lead hand-over: run lead-handover read '${SLUG}' first, as set out in references/lead-resume.md of the skill aico:pipeline, then follow that file."`);
    for (const bad of ['../x', 'a"b', '2026-11-02 18.32 - A&B', 5, null]) assert.equal(newSessionCommand(bad), null);
  });
});

describe('subagent-stop', () => {
  const stop = (fx, extra = {}) => JSON.stringify({ hook_event_name: 'SubagentStop', transcript_path: fx.transcript, agent_id: AGENT, stop_hook_active: false, ...extra });

  test('refused Step with no Handoff: blocked once with the exact text', () => {
    const fx = fixture();
    pre(fx.input(), fx.opts);
    const r = subagentStop(stop(fx), fx.opts);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out), { decision: 'block', reason: 'aico context cap: this Step was refused tools at the hand-over point. If your Handoff is not written yet, write it now with status: handover to your Output path. Then end.' });
    assert.equal(STOP_REASON, JSON.parse(r.out).reason);
    assert.equal(subagentStop(stop(fx, { stop_hook_active: true }), fx.opts).out, '');
  });

  test('silent with no deny, with the announced Handoff on disk, or when off', () => {
    const fx = fixture();
    assert.equal(subagentStop(stop(fx), fx.opts).out, '');
    pre(fx.input({ tool_name: 'Write', tool_input: { file_path: path.join(fx.dir, '04-x.md') } }), fx.opts);
    pre(fx.input(), fx.opts);
    assert.notEqual(subagentStop(stop(fx), fx.opts).out, '', 'announced but not written');
    fs.writeFileSync(path.join(fx.dir, '04-x.md'), 'h');
    assert.equal(subagentStop(stop(fx), fx.opts).out, '');
    const other = fixture();
    pre(other.input(), other.opts);
    assert.equal(subagentStop(stop(other), { ...other.opts, env: { AICO_CONTEXT_GUARD: 'off' } }).out, '');
    assert.equal(subagentStop(stop(other, { agent_id: 'zz/..' }), other.opts).out, '');
    assert.equal(subagentStop('nope', other.opts).out, '');
  });

  test('a stop for another agent is not blocked', () => {
    const fx = fixture();
    pre(fx.input(), fx.opts);
    assert.equal(subagentStop(stop(fx, { agent_id: 'other-agent' }), fx.opts).out, '');
  });

  test('two stops for one agent id: run-state keeps one closed row and adds a start-less row', () => {
    const fx = fixture();
    const id = 'abcdef012345';
    append(fx.root, SLUG, { ev: 'sub', role: 'backend-engineer', id, phase: 'start' }, { now: NOW });
    append(fx.root, SLUG, { ev: 'sub', role: 'backend-engineer', id, phase: 'stop' }, { now: NOW + 1000 });
    append(fx.root, SLUG, { ev: 'sub', role: 'backend-engineer', id, phase: 'stop' }, { now: NOW + 2000 });
    const subs = show(fx.root, SLUG, { now: NOW + 3000 }).subs;
    assert.equal(subs.length, 2);
    assert.equal(subs[0].ms, 1000);
    assert.equal(subs[1].start, null);
    assert.ok(subs.every((s) => s.stop !== null), 'no row stays running');
  });
});

describe('hook entry', () => {
  test('hooks.json wires pre and subagent-stop, node entry stays silent on bad input', () => {
    const top = path.join(import.meta.dirname, '..', '..');
    const j = JSON.parse(fs.readFileSync(path.join(top, 'hooks', 'hooks.json'), 'utf8'));
    const cmds = (ev) => j.hooks[ev].flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(cmds('PreToolUse').includes('node "${CLAUDE_PLUGIN_ROOT}/scripts/context-guard.mjs" pre'));
    assert.ok(cmds('SubagentStop').includes('node "${CLAUDE_PLUGIN_ROOT}/scripts/context-guard.mjs" subagent-stop'));
    assert.ok(cmds('SubagentStop').some((c) => c.includes('step-times.mjs" stop')));
    const group = (ev, tail) => j.hooks[ev].find((g) => g.hooks.some((h) => h.command === `node "${'$'}{CLAUDE_PLUGIN_ROOT}/scripts/context-guard.mjs" ${tail}`));
    for (const [ev, tail] of [['PreToolUse', 'pre'], ['SubagentStop', 'subagent-stop']]) {
      const g = group(ev, tail);
      assert.ok(g, tail);
      assert.equal(g.matcher, undefined, `${tail} has no matcher`);
      assert.equal(g.hooks.find((h) => h.command.endsWith(` ${tail}`)).timeout, 5, `${tail} timeout`);
    }
    const r = spawnSync(process.execPath, [path.join(top, 'scripts', 'context-guard.mjs'), 'pre'], { input: 'garbage', encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout + r.stderr, '');
  });

  test('subagent-stop as a hook process blocks one refused Step', () => {
    const top = path.join(import.meta.dirname, '..', '..');
    const fx = fixture();
    assert.equal(decision(pre(fx.input(), fx.opts)).permissionDecision, 'deny');
    const env = { ...process.env, CLAUDE_CONFIG_DIR: fx.claudeDir };
    delete env.AICO_CONTEXT_GUARD;
    const input = JSON.stringify({ hook_event_name: 'SubagentStop', transcript_path: fx.transcript, agent_id: AGENT, stop_hook_active: false });
    const r = spawnSync(process.execPath, [path.join(top, 'scripts', 'context-guard.mjs'), 'subagent-stop'], { cwd: fx.root, input, encoding: 'utf8', env });
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).decision, 'block');
  });
});
