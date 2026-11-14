// Tests for context-guard v1.2: the hand-over point of the guard is the handover of the active run's cap
// (recorded cap, else the current setting, else 180000), floor(cap * 9 / 10). An unreadable cap gives 162000.
// Below 54000 tokens (floor(60000 * 9 / 10)) the run is never looked up. No active run stays a no-op.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pre } from './context-guard.mjs';

const SLUG = 'P20261112.000001/07-feature';
const AGENT = 'a1b2c3d4e5f60718';
const SESSION = 'sess-cap-lead-1';
const NOW = Math.floor(Date.now() / 1000) * 1000;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const usage = (n) => ({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: n - 15 });
const quiet = { code: 0, out: '', err: '' };
const decision = (r) => JSON.parse(r.out).hookSpecificOutput.permissionDecision;
const isDeny = (r) => r.out !== '' && decision(r) === 'deny';

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
// The cap lookup falls back to the user settings file: point it at an empty temp home so a stored cap never leaks in.
const isoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-home-'));
tmps.push(isoHome);
const savedHome = { MCSPARROW_HOME: process.env.MCSPARROW_HOME, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.MCSPARROW_HOME = path.join(isoHome, '.mcsparrow');
process.env.HOME = isoHome;
process.env.USERPROFILE = isoHome;
after(() => { for (const [k, v] of Object.entries(savedHome)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });


// One product root and one Claude dir per test, under a temp dir; nothing reads the real home.
// `starts` are the extra fields of each run-state line; the default is one start with no cap.
function fixture({ tokens, starts = [{ ev: 'start' }], run = true, lead = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'context-guard-cap-'));
  tmps.push(base);
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const dir = path.join(root, '.company', 'work', ...SLUG.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', SLUG.split('/')[0], '00-project.md'), 'Demo project\n');
  if (run) {
    const rows = starts.map((s, i) => JSON.stringify({ v: 1, at: iso(NOW - 60000 + i * 1000), ...s }));
    fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${rows.join('\n')}\n`);
  }
  const proj = path.join(claudeDir, 'projects', 'p');
  fs.mkdirSync(path.join(proj, 'sess', 'subagents'), { recursive: true });
  const transcript = path.join(proj, 'sess.jsonl');
  const row = (u, side) => `${JSON.stringify({ type: 'assistant', isSidechain: side, message: { usage: u } })}\n`;
  fs.writeFileSync(transcript, row(usage(lead ? tokens : 1000), false));
  const agentFile = path.join(proj, 'sess', 'subagents', `agent-${AGENT}.jsonl`);
  fs.writeFileSync(agentFile, `${JSON.stringify({ type: 'meta' })}\n${row(usage(lead ? 500 : tokens), true)}`);
  const stepInput = (extra = {}) => JSON.stringify({ hook_event_name: 'PreToolUse', transcript_path: transcript, session_id: 's', agent_id: AGENT, tool_name: 'Read', tool_input: {}, ...extra });
  const leadInput = (extra = {}) => JSON.stringify({ hook_event_name: 'PreToolUse', transcript_path: transcript, session_id: SESSION, tool_name: 'Bash', tool_input: {}, ...extra });
  const opts = { root, claudeDir, env: {}, now: NOW };
  const handovers = () => {
    const f = path.join(dir, 'lead-handover.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.ev === 'handover') : [];
  };
  return { base, root, dir, stepInput, leadInput, opts, handovers };
}

const withCap = (cap) => [{ ev: 'start', cap }];
// The reading is the Step's own, so each case builds its own transcript at the given token count.
const stepAt = (tokens, cap, extra) => {
  const fx = fixture({ tokens, starts: cap === undefined ? undefined : withCap(cap), ...extra });
  return { fx, r: pre(fx.stepInput(), fx.opts) };
};
const leadAt = (tokens, cap, extra) => {
  const fx = fixture({ tokens, lead: true, starts: cap === undefined ? undefined : withCap(cap), ...extra });
  return { fx, r: pre(fx.leadInput(), fx.opts) };
};

describe('Step: the hand-over point is the run handover', () => {
  test('cap 120000: a Step at 108000 is refused, at 100000 it is allowed', () => {
    assert.equal(isDeny(stepAt(108000, 120000).r), true);
    assert.deepEqual(stepAt(100000, 120000).r, quiet);
  });

  test('cap 120000: the edge is exact, 107999 allows and 108000 refuses', () => {
    assert.deepEqual(stepAt(107999, 120000).r, quiet);
    assert.equal(isDeny(stepAt(108000, 120000).r), true);
  });

  test('the handover is floored: cap 100001 gives 90000', () => {
    assert.deepEqual(stepAt(89999, 100001).r, quiet);
    assert.equal(isDeny(stepAt(90000, 100001).r), true);
  });

  test('the smallest and the largest cap give 54000 and 900000', () => {
    assert.deepEqual(stepAt(53999, 60000).r, quiet);
    assert.equal(isDeny(stepAt(54000, 60000).r), true);
    assert.deepEqual(stepAt(899999, 1000000).r, quiet);
    assert.equal(isDeny(stepAt(900000, 1000000).r), true);
  });

  test('a run with no recorded cap and no setting uses 180000, so 162000 refuses and 161999 allows', () => {
    assert.deepEqual(stepAt(161999).r, quiet);
    assert.equal(isDeny(stepAt(162000).r), true);
  });

  test('a refused Step may still write its Handoff and nothing else', () => {
    const { fx } = stepAt(108000, 120000);
    const handoff = path.join(fx.dir, '04-qa.md');
    const w = pre(fx.stepInput({ tool_name: 'Write', tool_input: { file_path: handoff } }), fx.opts);
    assert.deepEqual(w, quiet);
    assert.equal(isDeny(pre(fx.stepInput({ tool_name: 'Bash' }), fx.opts)), true);
  });
});

describe('Step: a recorded cap that cannot be read gives 162000 and the guard keeps guarding', () => {
  // Each value is hostile or out of range; none of them may switch the guard off or pick another point.
  const BAD = ['120000', 0, -1, 2e9, 59999, 1000001, 120000.5, null, true, [120000], { n: 1 }, 'x'.repeat(300)];
  for (const bad of BAD) {
    test(`cap ${JSON.stringify(bad).slice(0, 40)}: refuses at 162000, allows at 150000`, () => {
      const hi = stepAt(162000, bad);
      assert.equal(isDeny(hi.r), true, 'still refuses at the fallback handover');
      assert.deepEqual(stepAt(150000, bad).r, quiet);
    });
  }

  test('a run-state file with a broken line before a valid start still guards', () => {
    const fx = fixture({ tokens: 162000, starts: withCap(120000) });
    fs.appendFileSync(path.join(fx.dir, 'run-state.jsonl'), '{not json\n');
    assert.equal(isDeny(pre(fx.stepInput(), fx.opts)), true);
  });

  test('two start lines: the first recorded cap is kept', () => {
    const starts = [{ ev: 'start', cap: 120000 }, { ev: 'end', outcome: 'ship' }, { ev: 'start', cap: 600000 }];
    const a = fixture({ tokens: 108000, starts });
    assert.equal(isDeny(pre(a.stepInput(), a.opts)), true);
    const b = fixture({ tokens: 100000, starts });
    assert.deepEqual(pre(b.stepInput(), b.opts), quiet);
  });

  test('a cap recorded on a later start counts when no earlier start carries one', () => {
    const starts = [{ ev: 'start' }, { ev: 'end', outcome: 'ship' }, { ev: 'start', cap: 120000 }];
    const fx = fixture({ tokens: 108000, starts });
    assert.equal(isDeny(pre(fx.stepInput(), fx.opts)), true);
  });
});

describe('no active run is a no-op', () => {
  test('a Step far over any handover with no run-state is allowed', () => {
    assert.deepEqual(stepAt(900000, undefined, { run: false }).r, quiet);
  });

  test('a Lead far over any handover with no run-state is allowed and writes nothing', () => {
    const { fx, r } = leadAt(900000, undefined, { run: false });
    assert.deepEqual(r, quiet);
    assert.deepEqual(fx.handovers(), []);
  });

  test('an ended run is not active', () => {
    const fx = fixture({ tokens: 200000, starts: [{ ev: 'start', cap: 120000 }, { ev: 'end', outcome: 'ship' }] });
    assert.deepEqual(pre(fx.stepInput(), fx.opts), quiet);
  });
});

describe('below 54000 the cap is never read', () => {
  // The run lookup walks .company; count the lstat calls on a path inside it.
  const companyStats = (t, fx, input) => {
    const calls = [];
    const real = fs.lstatSync;
    t.mock.method(fs, 'lstatSync', (p, ...a) => { if (String(p).includes('.company')) calls.push(String(p)); return real(p, ...a); });
    const r = pre(input, fx.opts);
    return { r, calls };
  };

  test('a Step at 53999 allows without touching the run folder', (t) => {
    const fx = fixture({ tokens: 53999, starts: withCap(60000) });
    const a = companyStats(t, fx, fx.stepInput());
    assert.deepEqual(a.r, quiet);
    assert.deepEqual(a.calls, []);
  });

  test('a Step at 54000 looks the run up and refuses at cap 60000', (t) => {
    const fx = fixture({ tokens: 54000, starts: withCap(60000) });
    const b = companyStats(t, fx, fx.stepInput());
    assert.equal(isDeny(b.r), true);
    assert.ok(b.calls.length > 0);
  });

  test('a Lead at 53999 allows without touching the run folder and records nothing', (t) => {
    const fx = fixture({ tokens: 53999, lead: true, starts: withCap(60000) });
    const a = companyStats(t, fx, fx.leadInput());
    assert.deepEqual(a.r, quiet);
    assert.deepEqual(a.calls, []);
    assert.deepEqual(fx.handovers(), []);
  });

  test('a Lead at 54000 looks the run up and freezes at cap 60000', (t) => {
    const fx = fixture({ tokens: 54000, lead: true, starts: withCap(60000) });
    const b = companyStats(t, fx, fx.leadInput());
    assert.equal(isDeny(b.r), true);
    assert.ok(b.calls.length > 0);
  });
});

describe('Lead: the freeze point is the run handover', () => {
  test('cap 120000: the Lead at 108000 is frozen and a hand-over is recorded, at 100000 nothing happens', () => {
    const { fx, r } = leadAt(108000, 120000);
    assert.equal(isDeny(r), true);
    const hs = fx.handovers();
    assert.equal(hs.length, 1);
    assert.equal(hs[0].trigger, 'context');
    assert.equal(hs[0].tokens, 108000);
    const low = leadAt(100000, 120000);
    assert.deepEqual(low.r, quiet);
    assert.deepEqual(low.fx.handovers(), []);
  });

  test('no recorded cap: the Lead freezes at 162000, not before', () => {
    const below = leadAt(161999);
    assert.deepEqual(below.r, quiet);
    assert.deepEqual(below.fx.handovers(), []);
    const at = leadAt(162000);
    assert.equal(isDeny(at.r), true);
    assert.equal(at.fx.handovers().length, 1);
  });

  test('an unreadable cap freezes the Lead at 162000', () => {
    for (const bad of ['120000', 0, -5, 2e9, null]) {
      assert.deepEqual(leadAt(150000, bad).r, quiet, JSON.stringify(bad));
      assert.equal(isDeny(leadAt(162000, bad).r), true, JSON.stringify(bad));
    }
  });
});
