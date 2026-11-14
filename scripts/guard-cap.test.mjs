import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Tests for the cap guard (rule cap.M1).
// Seams: hooks/rules/cap.mjs#judge(event, snapshot) and hooks/rules/cap.mjs#resolveThreshold(raw).
// Bands: context-guard v2.0 "Bands" table. T = snapshot.threshold, F = floor(T * 0.9).
// resolveThreshold(raw) -> { threshold: int, warning: string|null } (assumed shape).
// Events are built by hand; the engine is not involved.

const root = path.resolve(import.meta.dirname, '..');
const RULE = 'cap.M1';
const FIX = path.join(root, 'hooks', 'fixtures', RULE);
const FOLDER = 'z:/proj/.company/work/P20261114.000001/01-feature';
const MCP = 'mcp__plugin_aico_lead-session__lead_new_session';
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
// opts: session, total, state, run (object | null | undefined = default run), tool, paths, runOver
function ev({ session = 'lead', total = 0, state = 'read', run, tool = 'Read', paths = [], runOver = {} } = {}) {
  return deepFreeze({
    v: 1, event: 'PreToolUse', session, sessionKey: 'aaaaaaaaaaaa',
    agentKey: session === 'step' ? 'bbbbbbbbbbbb' : null, agentType: session === 'step' ? 'aico:qa' : null,
    tool: { name: tool, command: null, paths, model: null, subagentType: null, outputRole: null },
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
    await allowsRecorded({ ...o, ...handoffWrite('041a-qa-tester.md') }, DEFAULT);
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
  test(`Lead at ${total} (${hand ? 'hand over' : 'freeze'}): clean point hands over and denies`, async () => {
    const v = await denies({ session: 'lead', total, tool: 'Read' }, DEFAULT, /lead_new_session|new session/i);
    assert.equal(v.effect, 'cap-lead-freeze', 'clean point: engine writes the Lead Handoff then denies');
    await allows({ session: 'lead', total, tool: MCP }, DEFAULT);
  });
  test(`Lead at ${total}: frozen session denies all but the MCP tool`, async () => {
    const run = { frozen: true };
    for (const tool of ['Read', 'Bash', 'PowerShell', 'Write', 'Agent', 'Task']) {
      const v = await denies({ session: 'lead', total, tool, run }, DEFAULT);
      assert.equal(v.effect, 'cap-lead-frozen', `frozen deny effect for ${tool}`);
    }
    await allows({ session: 'lead', total, tool: MCP, run }, DEFAULT);
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
