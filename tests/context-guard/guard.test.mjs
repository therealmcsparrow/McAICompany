// Step side of the cap guard, rewritten red-first for the engine (T20, P20261114.000001; AC11, AC13, AC28).
// Was: scripts/context-guard.mjs `pre` / `subagent-stop` in process. Now: scripts/hook-host.mjs with the real
// cap.M1 rule (`context-guard` v2.0 "Bands", `mod-hook` v1, `hook-event` v1). Red until T19 (the rule) and
// T5 (the host) ship, and T21 deletes scripts/context-guard.mjs. Harness: ./cap-engine.mjs.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { capEnv, cleanup, AGENT, REPO, SLUG } from './cap-engine.mjs';
import { append, show } from '../../scripts/run-state.mjs';

after(cleanup);
const STEP_TEXT = /Write your Handoff with status: handover/;

async function booted(opts) {
  const fx = await capEnv(opts);
  fx.boot();
  return fx;
}
const write = (fx, name, extra = {}) => fx.step(170000, { tool: 'Write', input: { file_path: path.join(fx.runDir, name), content: 'x' }, ...extra });

describe('Step: freeze and hand over', () => {
  test('AC11 below the freeze point (161999): silent, no record', async () => {
    const fx = await booted();
    fx.quiet(fx.step(161999));
    assert.deepEqual(fx.guardRecord(), []);
  });

  for (const n of [162000, 179999, 180000, 180001]) {
    test(`AC11 at ${n}: every tool but a Handoff Write is refused with the Step reason`, async () => {
      const fx = await booted();
      const reason = fx.denyOf(fx.step(n));
      assert.match(reason, /cap\.M1/);
      assert.match(reason, STEP_TEXT);
      assert.match(fx.denyOf(fx.step(n, { tool: 'Bash', input: { command: 'ls' } })), STEP_TEXT);
    });
  }

  test('a Step acts the same in both bands: no continue:false in the freeze or the hand-over band', async () => {
    const fx = await booted();
    for (const n of [170000, 190000]) assert.equal(fx.step(n).json.continue, undefined, `at ${n}`);
  });

  test('the first deny of an agent adds one CEO systemMessage; later denies and the record count once', async () => {
    const fx = await booted();
    const first = fx.step(170000);
    assert.match(first.json.systemMessage ?? '', /^aico cap/);
    assert.ok(!(first.json.hookSpecificOutput.permissionDecisionReason).includes(first.json.systemMessage));
    const second = fx.step(170000);
    assert.equal(second.json.systemMessage, undefined);
    assert.deepEqual(fx.guardRecord().map((l) => l.ev), ['deny']);
  });

  test('the Step reason never names the off switch', async () => {
    const fx = await booted();
    assert.doesNotMatch(fx.denyOf(fx.step(170000)), /AICO_GUARDS|AICO_CONTEXT_GUARD/);
  });
});

describe('Step: the one allowed write', () => {
  test('a Write of a new Handoff in the run folder is allowed and recorded as handoff', async () => {
    const fx = await booted();
    fx.step(170000);
    fx.quiet(write(fx, '04-qa.md'));
    assert.deepEqual(fx.guardRecord().map((l) => l.ev), ['deny', 'handoff']);
  });

  test('a repeated Handoff Write is recorded once', async () => {
    const fx = await booted();
    fx.step(170000);
    write(fx, '04-qa.md');
    write(fx, '04-qa.md');
    assert.equal(fx.guardRecord().filter((l) => l.ev === 'handoff').length, 1);
  });

  test('a Write elsewhere, to an existing file, with a bad name or by a relative path is denied', async () => {
    const fx = await booted();
    fs.writeFileSync(path.join(fx.runDir, '05-qa.md'), 'old');
    const work = path.join(fx.env.project, '.company', 'work', SLUG.split('/')[0]);
    const cases = [
      path.join(fx.env.project, 'src-file.md'), // outside the run folder
      path.join(work, '04-qa.md'), // the project folder, not the run folder
      path.join(fx.runDir, 'sub', '04-qa.md'), // deeper
      path.join(fx.runDir, '05-qa.md'), // exists already
      path.join(fx.runDir, 'notes.md'), // bad name
      path.join(fx.runDir, '04-QA.md'), // bad name
      '04-qa.md' // relative
    ];
    for (const file of cases) {
      const r = fx.step(170000, { tool: 'Write', input: { file_path: file, content: 'x' } });
      assert.match(fx.denyOf(r), /cap\.M1/, file);
    }
    assert.ok(fx.guardRecord().every((l) => l.ev === 'deny'));
  });

  test('a Write through a link to another place is denied', async (t) => {
    const fx = await booted();
    const target = path.join(fx.env.base, 'elsewhere');
    fs.mkdirSync(target);
    const link = path.join(fx.runDir, 'linked');
    try { fs.symlinkSync(target, link, 'junction'); } catch { t.skip('no link rights on this machine'); return; }
    assert.match(fx.denyOf(fx.step(170000, { tool: 'Write', input: { file_path: path.join(link, '04-qa.md'), content: 'x' } })), /cap\.M1/);
  });

  test('one new findings ledger is allowed per Step, recorded as ledger and not as handoff; a second is denied', async () => {
    const fx = await booted();
    fx.quiet(write(fx, '04-code-reviewer.findings.md'));
    assert.match(fx.denyOf(write(fx, '04-other.findings.md')), /cap\.M1/);
    const evs = fx.guardRecord().map((l) => l.ev);
    assert.ok(evs.includes('ledger'));
    assert.ok(!evs.includes('handoff'));
  });
});

describe('Step: fail closed in a run, open outside one (R-14, AC9)', () => {
  test('a transcript that exists but cannot be read denies cap.M1: unreadable', async () => {
    const fx = await booted();
    const dir = path.join(fx.env.base, 'transcripts', 'a-dir.jsonl');
    fs.mkdirSync(dir, { recursive: true });
    const r = fx.env.run(fx.env.event('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' }, transcript_path: dir, agent_id: AGENT, agent_type: 'aico:qa' }));
    assert.match(fx.denyOf(r), /cap\.M1: unreadable/);
  });

  test('a Step with no usage row yet counts 0 and passes', async () => {
    const fx = await booted();
    fx.quiet(fx.step(null));
  });

  test('a bad agent id is malformed: the guard denies instead of passing', async () => {
    const fx = await booted();
    const r = fx.step(170000, { agent: '../x' });
    // hook-event: bad agent_id is malformed; the engine denies with the host reason (no rule id).
    assert.match(fx.denyOf(r), /malformed: bad agent id/);
  });

  test('no active run: a Step far over the point is allowed, and an unreadable transcript too', async () => {
    const fx = await capEnv({ run: false });
    fx.boot();
    fx.quiet(fx.step(900000));
    const dir = path.join(fx.env.base, 'transcripts', 'a-dir2.jsonl');
    fs.mkdirSync(dir, { recursive: true });
    fx.quiet(fx.env.run(fx.env.event('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' }, transcript_path: dir, agent_id: AGENT, agent_type: 'aico:qa' })));
  });

  test('an ended run is not active', async () => {
    const fx = await booted();
    append(fx.env.project, SLUG, { ev: 'end', outcome: 'ship' });
    fx.quiet(fx.step(200000));
  });

  test('a run-state file with a broken line before the start still guards', async () => {
    const fx = await booted();
    const f = path.join(fx.runDir, 'run-state.jsonl');
    fs.writeFileSync(f, '{not json\n' + fs.readFileSync(f, 'utf8'));
    assert.match(fx.denyOf(fx.step(170000)), /cap\.M1/);
  });

  test('a PostToolUse payload is not judged', async () => {
    const fx = await booted();
    fx.quiet(fx.env.run(fx.env.event('PreToolUse', { hook_event_name: 'PostToolUse', agent_id: AGENT })));
  });
});

describe('Step: the off switches', () => {
  test('AICO_GUARDS=off does not stand a Step down (Lead only, CEO decision)', async () => {
    const fx = await booted();
    const t = fx.env.transcript('main-off', [{ type: 'assistant', isSidechain: false, message: { usage: { input_tokens: 1, output_tokens: 1 } } }]);
    const dir = t.replace(/\.jsonl$/, '');
    fs.mkdirSync(path.join(dir, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'subagents', `agent-${AGENT}.jsonl`), JSON.stringify({ type: 'assistant', isSidechain: true, message: { usage: { input_tokens: 170000, output_tokens: 0 } } }) + '\n');
    const ev = fx.env.event('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' }, transcript_path: t, agent_id: AGENT, agent_type: 'aico:qa' });
    assert.match(fx.denyOf(fx.env.run(ev, { env: { AICO_GUARDS: 'off' } })), /cap\.M1/);
  });

  test('the retired AICO_CONTEXT_GUARD=off is no longer read, for a Step or a Lead', async () => {
    const fx = await booted();
    const t = fx.env.transcript('lead-retired', [{ type: 'assistant', isSidechain: false, message: { usage: { input_tokens: 170000, output_tokens: 0 } } }]);
    const ev = fx.env.event('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' }, transcript_path: t });
    const r = fx.env.run(ev, { env: { AICO_CONTEXT_GUARD: 'off' } });
    assert.ok(fx.isDeny(r), 'the Lead is still guarded');
  });
});

describe('Step in a worktree', () => {
  function worktree(fx, name, { confirm = true } = {}) {
    const gd = path.join(fx.env.project, '.git', 'worktrees', name);
    fs.mkdirSync(gd, { recursive: true });
    const wt = path.join(fx.env.base, name);
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gd}\n`);
    if (confirm) {
      fs.writeFileSync(path.join(gd, 'gitdir'), `${path.join(wt, '.git')}\n`);
      fs.writeFileSync(path.join(gd, 'commondir'), '../..\n');
    }
    return wt;
  }

  test('a Step in a worktree reads the run from the main tree', async () => {
    const fx = await booted();
    const wt = worktree(fx, 'w1');
    assert.match(fx.denyOf(fx.step(170000, { cwd: wt })), /cap\.M1/);
    assert.deepEqual(fx.guardRecord().map((l) => l.ev), ['deny']);
  });

  test('a worktree pointer the main .git does not confirm is not followed', async () => {
    const fx = await booted();
    const wt = worktree(fx, 'w2', { confirm: false });
    fx.quiet(fx.step(170000, { cwd: wt }));
    assert.deepEqual(fx.guardRecord(), []);
  });

  test('a worktree Step may write its Handoff by absolute run-folder path, and its stop follows the record', async () => {
    const fx = await booted();
    const wt = worktree(fx, 'w3');
    fx.step(170000, { cwd: wt });
    fx.quiet(write(fx, '04-backend-engineer.md', { cwd: wt }));
    assert.deepEqual(fx.guardRecord().map((l) => l.ev), ['deny', 'handoff']);
    assert.equal(fx.stop(170000, { cwd: wt }).json?.decision, 'block');
  });
});

describe('SubagentStop', () => {
  test('a refused Step with no Handoff is blocked once with the Step stop reason', async () => {
    const fx = await booted();
    fx.step(170000);
    const r = fx.stop();
    assert.equal(r.json.decision, 'block');
    assert.match(r.json.reason, /Handoff/);
    assert.deepEqual(Object.keys(r.json).sort(), ['decision', 'reason']);
    fx.quiet(fx.stop(), 'the second stop passes (once only)');
  });

  test('silent with no deny on record, with the Handoff on disk, or with stop_hook_active', async () => {
    const fx = await booted();
    fx.quiet(fx.stop());
    fx.step(170000);
    fx.quiet(fx.stop(170000, { active: true }));
    const fy = await booted();
    fy.step(170000);
    write(fy, '04-qa.md');
    fs.writeFileSync(path.join(fy.runDir, '04-qa.md'), 'h');
    fy.quiet(fy.stop());
  });

  test('a stop for another agent is not blocked', async () => {
    const fx = await booted();
    fx.step(170000);
    fx.quiet(fx.stop(170000, { agent: 'agent-other' }));
  });

  test('two stops for one agent id: run-state keeps one closed row and adds a start-less row', async () => {
    const fx = await capEnv();
    const id = 'abcdef012345';
    const now = Date.now();
    append(fx.env.project, SLUG, { ev: 'sub', role: 'backend-engineer', id, phase: 'start' }, { now });
    append(fx.env.project, SLUG, { ev: 'sub', role: 'backend-engineer', id, phase: 'stop' }, { now: now + 1000 });
    append(fx.env.project, SLUG, { ev: 'sub', role: 'backend-engineer', id, phase: 'stop' }, { now: now + 2000 });
    const subs = show(fx.env.project, SLUG, { now: now + 3000 }).subs;
    assert.equal(subs.length, 2);
    assert.equal(subs[0].ms, 1000);
    assert.equal(subs[1].start, null);
    assert.ok(subs.every((s) => s.stop !== null));
  });
});

describe('hook entries (AC13: the handoff mod is the only cap enforcer)', () => {
  test('scripts/context-guard.mjs is gone and hooks.json has no entry for it', () => {
    assert.equal(fs.existsSync(path.join(REPO, 'scripts', 'context-guard.mjs')), false, 'scripts/context-guard.mjs still exists');
    const text = fs.readFileSync(path.join(REPO, 'hooks', 'hooks.json'), 'utf8');
    assert.doesNotMatch(text, /context-guard/);
  });

  test('hooks.json wires the engine on PreToolUse (onFailure block) and SubagentStop, beside step-times', () => {
    const j = JSON.parse(fs.readFileSync(path.join(REPO, 'hooks', 'hooks.json'), 'utf8'));
    const entries = (ev) => j.hooks[ev].flatMap((g) => g.hooks.map((h) => ({ ...h, matcher: g.matcher })));
    const host = (ev) => entries(ev).find((h) => /scripts\/hook-host\.mjs/.test(h.command));
    assert.ok(host('PreToolUse'), 'PreToolUse engine entry');
    assert.ok(host('SubagentStop'), 'SubagentStop engine entry');
    assert.equal(host('PreToolUse').onFailure, 'block');
    assert.ok(entries('SubagentStop').some((h) => /step-times\.mjs" stop/.test(h.command)));
  });
});
