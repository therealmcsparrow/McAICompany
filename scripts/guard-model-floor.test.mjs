import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// T14 (P20261114.000001): red tests for the model-floor guard (rule model-floor.M1), AC7.
// Seam: hooks/rules/model-floor.mjs#judge(event, snapshot) -> verdict (mod-hook v1, hook-event v1).
// The R-10 Decided line of the plan gives the order: (1) FORCE set and not '0' -> the forced
// model (env model unless unset or 'inherit', else event.mainModel; null -> deny "forced model
// unknown"); (2) else the dispatch model ('inherit' -> mainModel); (3) else absent -> pass.
// Red until T15 ships the rule. Events are built by hand; the engine is not involved.

const root = path.resolve(import.meta.dirname, '..');
const RULE = 'model-floor.M1';
const FIX = path.join(root, 'hooks', 'fixtures', RULE);
const FLOOR = JSON.parse(fs.readFileSync(path.join(root, 'company', 'model-floor.json'), 'utf8')).floor;
const RANK = { haiku: 0, sonnet: 1, opus: 2 };

async function load() {
  const file = path.join(root, 'hooks', 'rules', 'model-floor.mjs');
  assert.ok(fs.existsSync(file), 'hooks/rules/model-floor.mjs exists');
  const mod = await import(pathToFileURL(file).href);
  assert.equal(typeof mod.judge, 'function', 'model-floor.mjs exports judge');
  return mod.judge;
}
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}
function ev({ model = null, role = 'qa', via = 'subagentType', name = 'Agent', mainModel = null, env = null, force = null } = {}) {
  return deepFreeze({
    v: 1, event: 'PreToolUse', session: 'lead', sessionKey: 'aaaaaaaaaaaa', agentKey: null, agentType: null,
    tool: {
      name, command: null, paths: [], model,
      subagentType: role && via === 'subagentType' ? role : null,
      outputRole: role && via === 'outputRole' ? role : null,
    },
    tokens: { state: 'none', total: 0 }, mainModel,
    env: { guardsOff: false, subagentModel: env, subagentModelForce: force },
    protected: [], run: null, drift: [], stopHookActive: null,
  });
}
const SNAP = deepFreeze({ v: 1, at: 'x', threshold: 100000, savers: {}, floor: FLOOR, drift: false, settingsWarnings: [] });

async function verdict(opts) {
  const judge = await load();
  const v = await judge(ev(opts), SNAP);
  assert.ok(v && typeof v === 'object', 'judge returns a verdict object');
  return v;
}
async function denies(opts, re) {
  const v = await verdict(opts);
  assert.equal(v.v, 'deny', `deny: ${JSON.stringify(opts)} (got ${JSON.stringify(v)})`);
  assert.equal(v.rule, RULE);
  assert.ok(typeof v.message === 'string' && v.message.length >= 1 && v.message.length <= 300, 'message 1-300 chars');
  if (re) assert.match(v.message, re);
  return v;
}
async function allows(opts) {
  assert.deepEqual(await verdict(opts), { v: 'allow' }, `allow: ${JSON.stringify(opts)}`);
}

// ---------- AC7: dispatch model against the floor ----------
test('AC7 deny: qa (sonnet floor) dispatched on haiku', async () => { await denies({ model: 'haiku' }); });
test('AC7 deny: architect (opus floor) dispatched on sonnet', async () => { await denies({ role: 'architect', model: 'sonnet' }); });
test('AC7 deny: architect dispatched on haiku', async () => { await denies({ role: 'architect', model: 'haiku' }); });
test('AC7 pass: at the floor and above', async () => {
  await allows({ model: 'sonnet' });
  await allows({ model: 'opus' });
  await allows({ role: 'architect', model: 'opus' });
  await allows({ role: 'localizer', model: 'haiku' });
  await allows({ role: 'localizer', model: 'sonnet' });
});
test('AC7 every Role in the floor file is judged against its own floor', async () => {
  for (const [role, floor] of Object.entries(FLOOR)) {
    for (const m of Object.keys(RANK)) {
      const o = { role, model: m };
      if (RANK[m] < RANK[floor]) await denies(o); else await allows(o);
    }
  }
});

// ---------- AC7: any casing, full ids ----------
test('AC7 casing: any casing of the family counts', async () => {
  await denies({ model: 'HAIKU' });
  await denies({ model: 'Haiku' });
  await denies({ role: 'architect', model: 'SoNNet' });
  await allows({ model: 'SONNET' });
  await allows({ model: 'Opus' });
});
test('AC7 full ids: the family inside a full model id is read', async () => {
  await denies({ model: 'claude-haiku-4-5' });
  await denies({ model: 'claude-haiku-4-5-20251001' });
  await denies({ role: 'architect', model: 'claude-sonnet-4-5' });
  await denies({ role: 'architect', model: 'CLAUDE-SONNET-4-5' });
  await allows({ model: 'claude-sonnet-4-5' });
  await allows({ model: 'claude-opus-4-1' });
  await allows({ role: 'architect', model: 'claude-opus-4-1' });
  await allows({ model: 'claude-sonnet-5-5[1m]' });
});
test('AC7 unknown family: a model with no haiku|sonnet|opus word denies', async () => {
  await denies({ model: 'gpt-4o' });
  await denies({ model: 'gemini-pro' });
  await denies({ model: 'claude-fable-1' });
  await denies({ role: 'localizer', model: 'mystery' });
  await denies({ model: '   ' });
});

// ---------- AC7: no Role / not a dispatch ----------
test('AC7 no Role: a dispatch with neither subagentType nor outputRole passes on any model', async () => {
  await allows({ role: null, model: 'haiku' });
  await allows({ role: null, model: 'gpt-4o' });
  await allows({ role: null, model: 'haiku', force: '1', env: 'haiku' });
});
test('the Role is read from outputRole when subagentType is absent', async () => {
  await denies({ role: 'code-reviewer', via: 'outputRole', model: 'sonnet' });
  await allows({ role: 'code-reviewer', via: 'outputRole', model: 'opus' });
});
test('both dispatch tool names (Agent, Task) are judged; other tools pass', async () => {
  await denies({ name: 'Agent', model: 'haiku' });
  await denies({ name: 'Task', model: 'haiku' });
  await allows({ name: 'Bash', model: 'haiku' });
  await allows({ name: 'Read', model: 'haiku' });
});

// ---------- R-10 precedence ----------
test('R-10 (1) FORCE on, env haiku, dispatch opus -> deny: the forced model runs', async () => {
  await denies({ force: '1', env: 'haiku', model: 'opus' });
});
test('R-10 (1) FORCE on, env opus, dispatch haiku -> pass: the forced model runs', async () => {
  await allows({ force: '1', env: 'opus', model: 'haiku' });
});
test('R-10 (1) FORCE on, env unset, mainModel below the floor -> deny', async () => {
  await denies({ force: '1', mainModel: 'claude-haiku-4-5', model: 'opus' });
});
test('R-10 (1) FORCE on, env unset, mainModel at or above the floor -> pass', async () => {
  await allows({ force: '1', mainModel: 'claude-sonnet-5-5', model: 'haiku' });
  await allows({ force: '1', mainModel: 'claude-opus-4-1', role: 'architect' });
});
test('R-10 (1) FORCE on, env inherit -> the main model is judged', async () => {
  await denies({ force: '1', env: 'inherit', mainModel: 'claude-haiku-4-5' });
  await allows({ force: '1', env: 'inherit', mainModel: 'claude-opus-4-1' });
});
test('R-10 (1) FORCE on, env unset, mainModel null -> deny "forced model unknown"', async () => {
  await denies({ force: '1', mainModel: null, model: 'opus' }, /forced model unknown/);
  await denies({ force: '1', env: 'inherit', mainModel: null }, /forced model unknown/);
});
test('R-10 (1) FORCE with any value but 0 is on', async () => {
  for (const f of ['1', 'true', 'yes']) await denies({ force: f, env: 'haiku', model: 'opus' });
});
test('R-10 FORCE 0 is off: the dispatch model decides', async () => {
  await allows({ force: '0', env: 'haiku', model: 'opus' });
  await denies({ force: '0', env: 'opus', model: 'haiku' });
  await allows({ force: '0', mainModel: null, model: 'sonnet' });
});
test('R-10 (3) env haiku without FORCE and no dispatch model -> pass', async () => {
  await allows({ env: 'haiku', model: null });
  await allows({ env: 'haiku', model: null, role: 'architect' });
});
test('R-10 (2) env without FORCE and dispatch haiku -> deny; dispatch opus -> pass', async () => {
  await denies({ env: 'opus', model: 'haiku' });
  await allows({ env: 'haiku', model: 'opus' });
});
test('R-10 (2) dispatch inherit -> judged on mainModel', async () => {
  await denies({ model: 'inherit', mainModel: 'claude-haiku-4-5' });
  await allows({ model: 'inherit', mainModel: 'claude-sonnet-5-5' });
  await denies({ role: 'architect', model: 'inherit', mainModel: 'claude-sonnet-5-5' });
  await allows({ role: 'architect', model: 'inherit', mainModel: 'claude-opus-4-1' });
  await allows({ model: 'INHERIT', mainModel: 'claude-opus-4-1' });
});
test('R-10 (2) dispatch inherit, mainModel null -> deny "forced model unknown"; env is not read without FORCE', async () => {
  await denies({ model: 'inherit', mainModel: null }, /forced model unknown/);
  await denies({ model: 'inherit', mainModel: null, env: 'opus' }, /forced model unknown/);
  await allows({ model: 'inherit', env: 'haiku', mainModel: 'claude-opus-4-1' });
});
test('R-10 (3) no dispatch model, no env, no FORCE -> pass (the agent file model applies)', async () => {
  await allows({ model: null });
  await allows({ model: null, role: 'architect' });
});
test('R-10 an unknown family in the env model under FORCE denies', async () => {
  await denies({ force: '1', env: 'gpt-4o', model: 'opus' });
});

// ---------- verdict shape ----------
test('the verdict is a plain allow-list object, the frozen event is left unchanged, no promise leaks', async () => {
  const judge = await load();
  const e = ev({ model: 'haiku' });
  const before = JSON.stringify(e);
  const v = await judge(e, SNAP);
  assert.deepEqual(Object.keys(v).sort(), ['message', 'rule', 'v']);
  assert.equal(JSON.stringify(e), before);
  assert.equal(typeof v.then, 'undefined');
});
test('the deny message names the floor and never a settings switch', async () => {
  const v = await denies({ role: 'architect', model: 'sonnet' });
  assert.match(v.message, /opus/i);
  assert.ok(!/AICO_GUARDS|CLAUDE_CODE_SUBAGENT_MODEL/.test(v.message), 'no switch name in deny text');
});
test('judge is deterministic', async () => {
  const judge = await load();
  assert.deepEqual(await judge(ev({ model: 'haiku' }), SNAP), await judge(ev({ model: 'haiku' }), SNAP));
});

// ---------- agents/*.md: every Role file model at or above its floor ----------
test('AC7 every agents/*.md model is at or above its floor (the file model applies when a dispatch has none)', () => {
  const dir = path.join(root, 'agents');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const role = f.replace(/\.md$/, '');
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(fm, `${f} has frontmatter`);
    const model = /^model:\s*(\S+)\s*$/m.exec(fm[1])?.[1];
    assert.ok(model && model in RANK, `${f} model is haiku|sonnet|opus (got ${model})`);
    assert.ok(FLOOR[role], `${role} has a floor in company/model-floor.json`);
    assert.ok(RANK[model] >= RANK[FLOOR[role]], `${f}: model ${model} is below floor ${FLOOR[role]}`);
  }
});

// ---------- fixtures (AC4): per-rule folder, one pass and one block at least ----------
function fixtures() {
  assert.ok(fs.existsSync(FIX), 'hooks/fixtures/model-floor.M1/ exists');
  return fs.readdirSync(FIX).filter((f) => f.endsWith('.json'));
}
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
test('AC4 fixtures: at least one pass-*.json and one block-*.json, names only pass-/block-', () => {
  const files = fixtures();
  assert.ok(files.some((f) => f.startsWith('pass-')), 'a pass fixture');
  assert.ok(files.some((f) => f.startsWith('block-')), 'a block fixture');
  for (const f of files) assert.match(f, /^(pass|block)-[a-z0-9-]+\.json$/);
});
test('AC4 fixtures: synthetic PreToolUse Agent payloads, no real session values', () => {
  for (const f of fixtures()) {
    const j = read(f);
    assert.equal(j.hook_event_name, 'PreToolUse');
    assert.ok(['Agent', 'Task'].includes(j.tool_name), `${f} tool_name`);
    assert.equal(typeof j.tool_input, 'object');
    assert.equal(j.session_id, 'fixture');
    assert.ok(!('agent_id' in j) || /^[A-Za-z0-9_-]+$/.test(j.agent_id));
  }
});
test('AC4 fixtures: judge allows each pass-* and denies each block-* with rule model-floor.M1', async () => {
  const judge = await load();
  for (const f of fixtures()) {
    const j = read(f);
    const ti = j.tool_input;
    const sub = typeof ti.subagent_type === 'string' ? ti.subagent_type.replace(/^aico:/, '') : null;
    const out = /Output:\s*\S*?\d+-([a-z][a-z-]*)\.md/.exec(ti.prompt ?? '')?.[1] ?? null;
    const e = ev({ model: ti.model ?? null, role: sub ?? out, via: sub ? 'subagentType' : 'outputRole', name: j.tool_name });
    const v = await judge(e, SNAP);
    if (f.startsWith('pass-')) assert.deepEqual(v, { v: 'allow' }, f);
    else { assert.equal(v.v, 'deny', f); assert.equal(v.rule, RULE, f); }
  }
});
test('fixtures cover: below floor by type and by Output role, a full upper-case id, an unknown family, no model, no Role', () => {
  const all = fixtures().map((f) => [f, read(f).tool_input]);
  const has = (pre, fn) => all.some(([f, t]) => f.startsWith(pre) && fn(t));
  assert.ok(has('block-', (t) => t.subagent_type && /^haiku$/.test(t.model)), 'below floor by subagent_type');
  assert.ok(has('block-', (t) => !t.subagent_type && /Output:/.test(t.prompt)), 'below floor by Output role');
  assert.ok(has('block-', (t) => /^claude-/i.test(t.model) && /[A-Z]/.test(t.model)), 'upper-case full id');
  assert.ok(has('block-', (t) => !/haiku|sonnet|opus/i.test(t.model ?? 'x')), 'unknown family');
  assert.ok(has('pass-', (t) => t.subagent_type && !('model' in t)), 'no dispatch model');
  assert.ok(has('pass-', (t) => !t.subagent_type && !/Output:/.test(t.prompt ?? '')), 'no Role');
  assert.ok(has('pass-', (t) => /^claude-opus/.test(t.model ?? '')), 'full id at floor');
});
