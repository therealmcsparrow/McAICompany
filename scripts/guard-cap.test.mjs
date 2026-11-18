import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, after } from 'node:test';
import { capEnv, cleanup, LEAD_TYPE, LEAD_AGENT } from '../tests/context-guard/cap-engine.mjs';

// Tests for the cap guard (rule cap.M1).
// Seams: hooks/rules/cap.mjs#judge(event, snapshot) and hooks/rules/cap.mjs#resolveThreshold(raw).
// Bands: context-guard v2.0 "Bands" table. T = snapshot.threshold, F = floor(T * 0.9).
// resolveThreshold(raw) -> { threshold: int, warning: string|null } (assumed shape).
// Events are built by hand; the engine is not involved.

const root = path.resolve(import.meta.dirname, '..');
const RULE = 'cap.M1';
const FIX = path.join(root, 'hooks', 'fixtures', RULE);
const FOLDER = 'z:/proj/.company/work/P20261114.000001/01-feature';
const MCP = ['mcp__plugin_aico_lead-session__lead', 'new', 'session'].join('_');
const EFFECTS = ['cap-step-record', 'cap-lead-freeze', 'cap-lead-frozen', 'cap-warn'];

async function load() {
  const file = path.join(root, 'hooks', 'rules', 'cap.mjs');
  assert.ok(fs.existsSync(file), 'hooks/rules/cap.mjs exists');
  const mod = await import(pathToFileURL(file).href);
  assert.equal(typeof mod.judge, 'function', 'cap.mjs exports judge');
  assert.equal(typeof mod.resolveThreshold, 'function', 'cap.mjs exports resolveThreshold');
  return mod;
}
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}
const pth = (p, exists = false) => ({ raw: p, expanded: null, real: p, exists, dir: false });
function runOf(o = {}) {
  return { slug: 'P20261114.000001/01-feature', folder: FOLDER, stepRunning: false, frozen: false,
    agent: { deny: false, handoff: false, ledger: false }, ...o };
}
// opts: session ('step' | 'lead' = the Lead agent | 'main'), total, state, run (object | null | undefined = default run),
// tool, paths, runOver, subagentType, background
function ev({ session = 'lead', total = 0, state = 'read', run, tool = 'Read', paths = [], runOver = {}, subagentType = null, background = false } = {}) {
  const agent = session !== 'main';
  return deepFreeze({
    v: 1, event: 'PreToolUse', session: session === 'main' ? 'lead' : session, sessionKey: 'aaaaaaaaaaaa',
    agentKey: agent ? 'bbbbbbbbbbbb' : null, agentType: session === 'step' ? 'aico:qa' : session === 'lead' ? LEAD_TYPE : null,
    tool: { name: tool, command: null, paths, model: null, subagentType, outputRole: null, background },
    tokens: { state, total: state === 'error' ? null : total }, mainModel: null,
    env: { guardsOff: false, subagentModel: null, subagentModelForce: null },
    protected: [], run: run === null ? null : runOf({ ...(run || {}), ...runOver }), drift: [], stopHookActive: null,
  });
}
const snap = (threshold = 180000) =>
  deepFreeze({ v: 1, at: 'x', threshold, savers: {}, floor: {}, drift: false, settingsWarnings: [] });

async function verdict(opts, threshold) {
  const { judge } = await load();
  const v = await judge(ev(opts), snap(threshold));
  assert.ok(v && typeof v === 'object' && !(v instanceof Promise), 'judge returns a verdict object');
  return v;
}
async function denies(opts, threshold, re) {
  const v = await verdict(opts, threshold);
  assert.equal(v.v, 'deny', `deny: ${JSON.stringify(opts)} T=${threshold} (got ${JSON.stringify(v)})`);
  assert.equal(v.rule, RULE);
  assert.ok(typeof v.message === 'string' && v.message.length >= 1 && v.message.length <= 300, 'message 1-300 chars');
  if (re) assert.match(v.message, re);
  if (v.effect !== undefined) assert.ok(EFFECTS.includes(v.effect), `known effect (got ${v.effect})`);
  return v;
}
async function allows(opts, threshold) {
  const v = await verdict(opts, threshold);
  assert.deepEqual(v, { v: 'allow' }, `allow: ${JSON.stringify(opts)} T=${threshold} (got ${JSON.stringify(v)})`);
}
// An allow that carries the record effect (Step writes its handoff file or ledger).
async function allowsRecorded(opts, threshold) {
  const v = await verdict(opts, threshold);
  assert.equal(v.v, 'allow', `allow: ${JSON.stringify(opts)} (got ${JSON.stringify(v)})`);
  assert.equal(v.effect, 'cap-step-record');
  return v;
}
const handoffWrite = (name = '41-qa.md', dir = FOLDER) => ({ tool: 'Write', paths: [pth(`${dir}/${name}`)] });

// Fixtures: raw payload plus a _synthetic block (session, tokens, run); the test rebuilds the event.
function fixtureEvent(name) {
  const p = JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
  const s = p._synthetic;
  const input = p.tool_input || {};
  const fp = input.file_path;
  return {
    session: s.session, total: s.tokens.total ?? 0, state: s.tokens.state, run: s.run,
    tool: p.tool_name, paths: fp ? [pth(fp)] : [],
  };
}

// ---------- the five boundaries at the default T = 180000, Step and Lead ----------
const DEFAULT = 180000;
for (const session of ['step', 'lead']) {
  test(`AC11 ${session}: 161999 silent for every tool`, async () => {
    await allows({ session, total: 161999, tool: 'Read' }, DEFAULT);
    await allows({ session, total: 161999, tool: 'Bash' }, DEFAULT);
    await allows({ session, total: 161999, tool: 'Agent' }, DEFAULT);
    await allows({ session, total: 161999, ...handoffWrite('41-qa.md') }, DEFAULT);
  });
  test(`AC11 ${session}: 162000 freezes (first tool call is refused or handled)`, async () => {
    const v = await verdict({ session, total: 162000, tool: 'Read' }, DEFAULT);
    assert.equal(v.v, 'deny');
    assert.equal(v.rule, RULE);
  });
  test(`AC11 ${session}: 179999 still freeze band`, async () => {
    const v = await verdict({ session, total: 179999, tool: 'Read' }, DEFAULT);
    assert.equal(v.v, 'deny');
  });
  test(`AC11 ${session}: 180000 and 180001 hand over`, async () => {
    for (const total of [180000, 180001]) {
      const v = await verdict({ session, total, tool: 'Read' }, DEFAULT);
      assert.equal(v.v, 'deny', `deny at ${total}`);
      assert.equal(v.rule, RULE);
    }
  });
}

// ---------- other thresholds, F = floor(T x 0.9) ----------
const TABLE = [[200000, 180000], [250000, 225000], [60000, 54000], [100000, 90000], [123457, 111111]];
for (const [T, F] of TABLE) {
  for (const session of ['step', 'lead']) {
    test(`AC12 ${session}: T=${T} silent at ${F - 1}, freezes at ${F}, hands over at ${T}`, async () => {
      await allows({ session, total: F - 1, tool: 'Read' }, T);
      const a = await verdict({ session, total: F, tool: 'Read' }, T);
      assert.equal(a.v, 'deny', `freeze at F=${F}`);
      const b = await verdict({ session, total: T - 1, tool: 'Read' }, T);
      assert.equal(b.v, 'deny', `still frozen at T-1=${T - 1}`);
      const c = await verdict({ session, total: T, tool: 'Read' }, T);
      assert.equal(c.v, 'deny', `hand over at T=${T}`);
    });
  }
}

// ---------- resolveThreshold, valid and bad values, one warning naming the bad value ----------
test('AC12 resolveThreshold: valid values pass unchanged, no warning', async () => {
  const { resolveThreshold } = await load();
  for (const n of [60000, 100000, 180000, 200000, 250000]) {
    const r = resolveThreshold(n);
    assert.equal(r.threshold, n, `valid ${n}`);
    assert.equal(r.warning ?? null, null, `no warning for ${n}`);
  }
});
const BAD = [[0, '0'], [-1, '-1'], ['abc', 'abc'], [null, null], [undefined, null], [1.5, '1.5'],
  ['200k', '200k'], [250001, '250001'], [1e9, '1000000000'], [59999, '59999'], [NaN, 'NaN']];
for (const [bad, named] of BAD) {
  test(`AC12 resolveThreshold: ${String(bad)} -> 180000 and one warning${named ? ' naming it' : ''}`, async () => {
    const { resolveThreshold } = await load();
    const r = resolveThreshold(bad);
    assert.equal(r.threshold, 180000);
    assert.equal(typeof r.warning, 'string', 'one warning string, not a list');
    assert.ok(r.warning.length >= 1 && r.warning.length <= 300);
    if (named) assert.ok(r.warning.includes(named) || r.warning.includes(String(bad)), `warning names ${named}: ${r.warning}`);
    // Deterministic: the same bad value gives the same single warning (once-per-session is the engine's dedupe).
    assert.deepEqual(resolveThreshold(bad), r);
  });
}
test('AC12 a bad value never moves the boundary: judge on the resolved 180000', async () => {
  const { resolveThreshold } = await load();
  const T = resolveThreshold('200k').threshold;
  await allows({ session: 'lead', total: 161999 }, T);
  assert.equal((await verdict({ session: 'lead', total: 162000 }, T)).v, 'deny');
});

// ---------- active run only ----------
test('R-14 no active run: pass whatever tokens say, Step and Lead', async () => {
  for (const session of ['step', 'lead']) {
    await allows({ session, run: null, total: 0 }, DEFAULT);
    await allows({ session, run: null, total: 170000 }, DEFAULT);
    await allows({ session, run: null, total: 999999 }, DEFAULT);
    await allows({ session, run: null, state: 'error' }, DEFAULT);
    await allows({ session, run: null, state: 'none' }, DEFAULT);
  }
});

// ---------- tokens state: none passes, error fails closed in a run ----------
test('state none in an active run counts 0 and passes, every tool, Step and Lead', async () => {
  for (const session of ['step', 'lead']) {
    for (const tool of ['Read', 'Bash', 'Agent', 'Write']) await allows({ session, state: 'none', tool }, DEFAULT);
  }
});
test('state error in an active run: deny cap.M1 unreadable, plain (no freeze effect), Step and Lead', async () => {
  for (const session of ['step', 'lead']) {
    for (const tool of ['Read', 'Bash', 'Agent']) {
      const v = await denies({ session, state: 'error', tool }, DEFAULT, /unreadable/);
      assert.equal(v.effect, undefined, 'error is a plain deny: no freeze, no record');
    }
  }
});
test('state error in an active run: even a Handoff write is denied (fail closed)', async () => {
  await denies({ session: 'step', state: 'error', ...handoffWrite() }, DEFAULT, /unreadable/);
});
test('state error with no active run passes (R-14); with a run it denies (AC9 closed)', async () => {
  await allows({ session: 'lead', run: null, state: 'error' }, DEFAULT);
  await denies({ session: 'lead', state: 'error' }, DEFAULT, /unreadable/);
});

// ---------- Step bands, both freeze and hand over ----------
for (const total of [162000, 179999, 180000, 180001]) {
  test(`Step at ${total}: only a new Handoff or one new ledger in the run folder`, async () => {
    const o = { session: 'step', total };
    await allowsRecorded({ ...o, ...handoffWrite('41-qa.md') }, DEFAULT);
    await allowsRecorded({ ...o, ...handoffWrite('041a-qa.md') }, DEFAULT);
    await allowsRecorded({ ...o, ...handoffWrite('41-qa.findings.md') }, DEFAULT);
    for (const tool of ['Read', 'Bash', 'PowerShell', 'Edit', 'Glob', 'Grep', 'Agent', 'Task']) {
      await denies({ ...o, tool }, DEFAULT, /Handoff/i);
    }
  });
}
test('Step freeze: the deny tells the model to write the Handoff with status: handover', async () => {
  await denies({ session: 'step', total: 170000, tool: 'Read' }, DEFAULT, /status: handover/);
});
test('Step freeze: Write refusals (existing file, other folder, deeper, bad name, no path)', async () => {
  const o = { session: 'step', total: 170000, tool: 'Write' };
  await denies({ ...o, paths: [pth(`${FOLDER}/41-qa.md`, true)] }, DEFAULT);
  await denies({ ...o, paths: [pth(`${FOLDER}/41-qa.findings.md`, true)] }, DEFAULT);
  await denies({ ...o, paths: [pth('z:/proj/.company/work/P20261114.000001/01-feature/../02-x/41-qa.md')] }, DEFAULT);
  await denies({ ...o, paths: [pth('z:/proj/.company/work/P20261114.000001/02-other/41-qa.md')] }, DEFAULT);
  await denies({ ...o, paths: [pth(`${FOLDER}/sub/41-qa.md`)] }, DEFAULT);
  await denies({ ...o, paths: [pth('z:/proj/src/41-qa.md')] }, DEFAULT);
  await denies({ ...o, paths: [pth(`${FOLDER}/notes.md`)] }, DEFAULT);
  await denies({ ...o, paths: [pth(`${FOLDER}/41-QA.md`)] }, DEFAULT);
  await denies({ ...o, paths: [pth(`${FOLDER}/1-qa.md`)] }, DEFAULT);
  await denies({ ...o, paths: [pth(`${FOLDER}/41-qa.md.exe`)] }, DEFAULT);
  await denies({ ...o, paths: [] }, DEFAULT);
  await denies({ ...o, paths: [pth(`${FOLDER}/41-qa.md`), pth('z:/proj/src/x.js')] }, DEFAULT);
});
test('Step freeze: a second ledger from the same agent is denied; a Handoff is still allowed', async () => {
  const run = { agent: { deny: true, handoff: false, ledger: true } };
  await denies({ session: 'step', total: 170000, run, ...handoffWrite('42-qa.findings.md') }, DEFAULT);
  await allowsRecorded({ session: 'step', total: 170000, run, ...handoffWrite('42-qa.md') }, DEFAULT);
});
test('Step below F: Write anywhere passes, nothing recorded', async () => {
  await allows({ session: 'step', total: 100000, tool: 'Write', paths: [pth('z:/proj/src/a.js')] }, DEFAULT);
});
test('Step acts the same in both bands: same verdict at F and at T for a refused tool', async () => {
  const a = await verdict({ session: 'step', total: 162000, tool: 'Bash' }, DEFAULT);
  const b = await verdict({ session: 'step', total: 180000, tool: 'Bash' }, DEFAULT);
  assert.deepEqual(a, b);
});

// ---------- Lead bands ----------
for (const total of [162000, 179999, 180000, 180001]) {
  const hand = total >= 180000;
  test(`Lead at ${total} (${hand ? 'hand over' : 'freeze'}): clean point denies and tells it to end with STATUS: handover`, async () => {
    const v = await denies({ session: 'lead', total, tool: 'Read' }, DEFAULT, /STATUS: handover/);
    assert.equal(v.effect, 'cap-lead-freeze', 'clean point: engine writes the Lead Handoff then denies');
    assert.match(v.message, /handoff:/);
    assert.match(v.message, /next:/);
    await denies({ session: 'lead', total, tool: MCP }, DEFAULT, /STATUS: handover/);
  });
  test(`Lead at ${total}: frozen session denies every tool, the MCP name and SendFeedback included`, async () => {
    const run = { frozen: true };
    for (const tool of ['Read', 'Bash', 'PowerShell', 'Write', 'Agent', 'Task', MCP, 'SendFeedback']) {
      const v = await denies({ session: 'lead', total, tool, run }, DEFAULT, /STATUS: handover/);
      assert.equal(v.effect, 'cap-lead-frozen', `frozen deny effect for ${tool}`);
    }
  });
  test(`Lead at ${total}: a Step running denies Agent and Task with the wait reason, other tools pass`, async () => {
    const run = { stepRunning: true };
    await denies({ session: 'lead', total, tool: 'Agent', run }, DEFAULT, /wait/i);
    await denies({ session: 'lead', total, tool: 'Task', run }, DEFAULT, /wait/i);
    for (const tool of ['Read', 'Bash', 'Write', 'PowerShell']) await allows({ session: 'lead', total, tool, run }, DEFAULT);
  });
  test(`Lead at ${total}: frozen wins over a running Step`, async () => {
    await denies({ session: 'lead', total, tool: 'Read', run: { frozen: true, stepRunning: true } }, DEFAULT);
  });
}
test('Lead below F with a Step running: Agent is not refused', async () => {
  await allows({ session: 'lead', total: 100000, tool: 'Agent', run: { stepRunning: true } }, DEFAULT);
});
test('Lead below F with frozen record from an earlier reading: still silent (tokens rule the band)', async () => {
  await allows({ session: 'lead', total: 100000, tool: 'Read', run: { frozen: true } }, DEFAULT);
});
test('Lead and Step do not share a branch: Lead freeze effect never appears on a Step verdict', async () => {
  const v = await verdict({ session: 'step', total: 170000, tool: 'Read' }, DEFAULT);
  assert.notEqual(v.effect, 'cap-lead-freeze');
  assert.notEqual(v.effect, 'cap-lead-frozen');
});

// ---------- the same guard in a Step session (fixtures) ----------
test('AC28 fixtures: pass-* pass, block-* deny, through the rule', async () => {
  const names = fs.readdirSync(FIX).filter((n) => n.endsWith('.json'));
  assert.ok(names.some((n) => n.startsWith('pass-')) && names.some((n) => n.startsWith('block-')), 'one pass and one block fixture');
  for (const n of names) {
    const o = fixtureEvent(n);
    if (n.startsWith('pass-')) await allowsOrRecorded(o, n);
    else await denies(o, DEFAULT);
  }
});
async function allowsOrRecorded(o, label) {
  const v = await verdict(o, DEFAULT);
  assert.equal(v.v, 'allow', `${label}: ${JSON.stringify(v)}`);
}
test('AC28 Step session denies on the cap exactly as the Lead does at the same reading', async () => {
  for (const total of [162000, 180000]) {
    const s = await verdict({ session: 'step', total, tool: 'Read' }, DEFAULT);
    const l = await verdict({ session: 'lead', total, tool: 'Read' }, DEFAULT);
    assert.equal(s.v, 'deny');
    assert.equal(l.v, 'deny');
    assert.equal(s.rule, l.rule);
  }
});

// ---------- verdict shape, purity ----------
test('verdict: only allow-listed keys (v, rule, message, effect)', async () => {
  const cases = [
    { session: 'step', total: 170000, tool: 'Read' },
    { session: 'lead', total: 170000, tool: 'Read' },
    { session: 'lead', total: 170000, tool: 'Read', run: { frozen: true } },
    { session: 'step', state: 'error' },
    { session: 'step', total: 170000, ...handoffWrite() },
  ];
  for (const o of cases) {
    const v = await verdict(o, DEFAULT);
    for (const k of Object.keys(v)) assert.ok(['v', 'rule', 'message', 'effect'].includes(k), `key ${k}`);
  }
});
test('judge does not mutate the frozen event or snapshot (frozen inputs would throw in strict mode)', async () => {
  await verdict({ session: 'lead', total: 170000 }, DEFAULT);
  await verdict({ session: 'step', total: 170000, ...handoffWrite() }, DEFAULT);
});
test('judge reads the threshold from the snapshot only, not from a constant', async () => {
  // 150000 is below the default F, above F for T=150000 -> 135000.
  assert.equal((await verdict({ session: 'lead', total: 140000 }, 150000)).v, 'deny');
  await allows({ session: 'lead', total: 140000 }, 180000);
});

// ---------- main is never capped ----------
test('main (session lead, no agent) is never capped: every tool passes at and far over F and T', async () => {
  for (const total of [0, 162000, 180000, 900000]) {
    for (const tool of ['Read', 'Bash', 'Write']) await allows({ session: 'main', total, tool }, DEFAULT);
  }
  await allows({ session: 'main', state: 'error' }, DEFAULT);
});

// ---------- spawn rules, judge level: background and main (AC1, AC2) ----------
test('AC1 Lead agent Agent or Task with run_in_background true in a run: denied below F', async () => {
  for (const total of [0, 100000, 161999]) {
    for (const tool of ['Agent', 'Task']) {
      await denies({ session: 'lead', total, tool, subagentType: 'qa', background: true }, DEFAULT, /foreground/i);
    }
  }
});
test('AC1 Lead agent foreground Agent to a Role in a run below F passes', async () => {
  await allows({ session: 'lead', total: 100000, tool: 'Agent', subagentType: 'qa', background: false }, DEFAULT);
});
test('AC1 Lead agent background Agent with no active run passes the cap rule', async () => {
  await allows({ session: 'lead', run: null, tool: 'Agent', subagentType: 'qa', background: true }, DEFAULT);
});
test('AC1 main background Agent to aico:project-manager is denied with and without an active run', async () => {
  await denies({ session: 'main', tool: 'Agent', subagentType: 'project-manager', background: true }, DEFAULT, /foreground/i);
  await denies({ session: 'main', run: null, tool: 'Agent', subagentType: 'project-manager', background: true }, DEFAULT, /foreground/i);
});
test('AC1 main foreground Agent to aico:project-manager passes, in a run and outside one', async () => {
  await allows({ session: 'main', tool: 'Agent', subagentType: 'project-manager' }, DEFAULT);
  await allows({ session: 'main', run: null, tool: 'Agent', subagentType: 'project-manager' }, DEFAULT);
});
test('AC1 main Agent or Task to a Role in a run is denied; outside a run it passes', async () => {
  for (const tool of ['Agent', 'Task']) {
    await denies({ session: 'main', tool, subagentType: 'qa' }, DEFAULT, /Lead/);
    await denies({ session: 'main', tool, subagentType: null }, DEFAULT, /Lead/);
  }
  await allows({ session: 'main', run: null, tool: 'Agent', subagentType: 'qa' }, DEFAULT);
});

// ---------- spawn rules through the host: raw subagent_type, depth, agent_type, tokens, run, AICO_GUARDS ----------
after(cleanup);
const PM = 'aico:project-manager';
const row0 = (n) => ({ type: 'assistant', isSidechain: false, message: { model: 'claude-opus-4-1', usage: { input_tokens: n, output_tokens: 0 } } });
const call = (sub, extra = {}) => ({ subagent_type: sub, prompt: 'x', ...extra });

// Runs one Agent or Task call through the host. who: 'main' or { agent, type } (a payload with agent_id; type undefined = no agent_type).
function spawn(fx, who, input, { tool = 'Agent', env } = {}) {
  if (who === 'main') {
    const t = fx.env.transcript('spawn-main', [row0(15)]);
    return fx.env.run(fx.env.event('PreToolUse', { tool_name: tool, tool_input: input, transcript_path: t }), { env });
  }
  const t = fx.env.transcript(`main-${who.agent}`, [row0(1000)]);
  const dir = t.replace(/\.jsonl$/, '');
  fs.mkdirSync(path.join(dir, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'subagents', `agent-${who.agent}.jsonl`), `${JSON.stringify({ type: 'meta' })}\n${JSON.stringify(row0(500))}\n`);
  const ev = fx.env.event('PreToolUse', { tool_name: tool, tool_input: input, transcript_path: t, agent_id: who.agent, agent_type: who.type });
  return fx.env.run(ev, { env });
}

describe('AC2 a Role never spawns the Lead, run or not, below the fast floor', () => {
  const TYPES = [['aico:qa', 'aico:qa'], ['general-purpose', 'general-purpose'], ['AICO:project-manager', 'AICO:project-manager'],
    ['other:project-manager', 'other:project-manager'], ['missing agent_type', undefined]];
  const TARGETS = ['aico:project-manager', 'project-manager', 'AICO:Project-Manager', 'other:project-manager'];
  for (const run of [true, false]) {
    for (const [label, type] of TYPES) {
      for (const [depth, agent] of [[1, 'agent-role-d1'], [2, 'agent-role-d2']]) {
        test(`${label} at depth ${depth}, ${run ? 'in a run' : 'no run'}: every Lead target form is denied`, async () => {
          const fx = await capEnv({ run });
          fx.bootLead();
          for (const target of TARGETS) {
            for (const tool of ['Agent', 'Task']) {
              const r = spawn(fx, { agent, type }, call(target), { tool });
              assert.ok(fx.capDeny(r), `deny ${target} ${tool}: ${r.out} ${r.err}`);
            }
          }
        });
      }
    }
  }
  test('a Role spawning another Role passes the cap rule, foreground and background', async () => {
    const fx = await capEnv();
    fx.bootLead();
    fx.quiet(spawn(fx, { agent: 'agent-role-d1', type: 'aico:qa' }, call('aico:qa')));
    fx.quiet(spawn(fx, { agent: 'agent-role-d1', type: 'aico:qa' }, call('aico:qa', { run_in_background: true })));
  });
  test('AICO_GUARDS=off never stands a Role down: the Lead spawn stays denied', async () => {
    const fx = await capEnv();
    fx.bootLead();
    const r = spawn(fx, { agent: 'agent-role-off', type: 'aico:qa' }, call(PM), { env: { AICO_GUARDS: 'off' } });
    assert.ok(fx.capDeny(r), `${r.out} ${r.err}`);
  });
});

describe('a padded or newline-ended Lead target is still the Lead (hook-event v1.4 leadTarget)', () => {
  const PADDED = [' aico:project-manager ', 'aico:project-manager\n', '\taico:project-manager\r\n', '\u00a0aico:project-manager\u00a0', '\u200baico:project-manager\ufeff', ' project-manager ', ' AICO:Project-Manager\n'];
  for (const tool of ['Agent', 'Task']) {
    test(`${tool}: a Role spawning a padded Lead target is denied`, async () => {
      const fx = await capEnv();
      fx.bootLead();
      for (const target of PADDED) {
        const r = spawn(fx, { agent: 'agent-role-pad', type: 'aico:qa' }, call(target), { tool });
        assert.ok(fx.capDeny(r), `deny ${JSON.stringify(target)}: ${r.out} ${r.err}`);
      }
    });
    test(`${tool}: main with a padded Lead target and run_in_background true is denied (foreground rule)`, async () => {
      const fx = await capEnv();
      fx.bootLead();
      for (const target of PADDED) {
        const r = spawn(fx, 'main', call(target, { run_in_background: true }), { tool });
        assert.ok(fx.capDeny(r), `deny bg ${JSON.stringify(target)}: ${r.out} ${r.err}`);
      }
    });
  }
  test('a padded Role name is not mistaken for the Lead: a Role spawning aico:qa with padding passes', async () => {
    const fx = await capEnv();
    fx.bootLead();
    fx.quiet(spawn(fx, { agent: 'agent-role-pad2', type: 'aico:qa' }, call(' aico:qa\n')));
  });
});

describe('AC1 the Lead and main spawn rules through the host', () => {
  test('main Agent to a Role in a run is denied at 0 tokens, whatever model is given', async () => {
    const fx = await capEnv();
    fx.bootLead();
    for (const model of [undefined, 'opus', 'claude-opus-4-1']) {
      const r = spawn(fx, 'main', call('aico:qa', model ? { model } : {}));
      assert.ok(fx.capDeny(r), `deny model ${model}: ${r.out} ${r.err}`);
    }
  });
  test('main Agent to a Role with no active run passes', async () => {
    const fx = await capEnv({ run: false });
    fx.bootLead();
    fx.quiet(spawn(fx, 'main', call('aico:qa')));
  });
  test('main Agent to aico:project-manager: foreground passes, background is denied, with and without a run', async () => {
    for (const run of [true, false]) {
      const fx = await capEnv({ run });
      fx.bootLead();
      fx.quiet(spawn(fx, 'main', call(PM)), `fg run=${run}`);
      const r = spawn(fx, 'main', call(PM, { run_in_background: true }));
      assert.ok(fx.capDeny(r), `bg denied run=${run}: ${r.out} ${r.err}`);
    }
  });
  test('Lead agent Agent to aico:qa in a run: foreground passes, background is denied below F', async () => {
    const fx = await capEnv();
    fx.bootLead();
    fx.quiet(spawn(fx, { agent: LEAD_AGENT, type: LEAD_TYPE }, call('aico:qa')));
    const r = spawn(fx, { agent: LEAD_AGENT, type: LEAD_TYPE }, call('aico:qa', { run_in_background: true }));
    assert.ok(fx.capDeny(r), `${r.out} ${r.err}`);
  });
  test('Lead at depth 1 and a helper Lead at depth 2 spawn aico:project-manager in the foreground; background is denied', async () => {
    const fx = await capEnv();
    fx.bootLead();
    for (const agent of [LEAD_AGENT, 'agent-lead2']) {
      fx.quiet(spawn(fx, { agent, type: LEAD_TYPE }, call(PM)), agent);
      const r = spawn(fx, { agent, type: LEAD_TYPE }, call(PM, { run_in_background: true }));
      assert.ok(fx.capDeny(r), `${agent}: ${r.out} ${r.err}`);
    }
  });
  test('Lead agent background Agent with no active run passes the cap rule', async () => {
    const fx = await capEnv({ run: false });
    fx.bootLead();
    fx.quiet(spawn(fx, { agent: LEAD_AGENT, type: LEAD_TYPE }, call('aico:qa', { run_in_background: true })));
  });
  test('AICO_GUARDS=off: a Lead background Agent passes, and so does a main background Lead spawn', async () => {
    const fx = await capEnv();
    fx.bootLead();
    const env = { AICO_GUARDS: 'off' };
    fx.quiet(spawn(fx, { agent: 'agent-lead-off', type: LEAD_TYPE }, call('aico:qa', { run_in_background: true }), { env }));
    fx.quiet(spawn(fx, 'main', call(PM, { run_in_background: true }), { env }));
  });
});
