import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// T24 (P20261114.000001): red tests for the browser saver note (rule browser.Y1), AC25, AC3, AC28.
// Seam: hooks/rules/browser.mjs#judge(event, snapshot) -> verdict (mod-hook v1, hook-event v1).
// Source of the behaviour: docs/pack-clash-table.md row efficient-browser-use + clash.6: note-only, default
// off, Lead session only, hands-on-tester and any Step session produce no note and no change.
// QA assumptions (named in the T24 Handoff): the rule judges by tool name only (hook-event v1 reads no
// screenshot fields); a "browser call" is a screenshot tool of a browser MCP server (name ends in
// `screenshot`, any case); the switch is snapshot.savers['efficient-browser-use'] === true exactly.
// Events are built by hand; the engine is not involved. Red until T25 ships the rule.

const root = path.resolve(import.meta.dirname, '..');
const RULE = 'browser.Y1';
const ID = 'efficient-browser-use';
const FIX = path.join(root, 'hooks', 'fixtures', RULE);
const SHOTS = ['mcp__Claude_Browser__screenshot', 'mcp__playwright__browser_take_screenshot', 'mcp__chrome-devtools__take_screenshot', 'mcp__claude-in-chrome__SCREENSHOT'];

async function load() {
  const file = path.join(root, 'hooks', 'rules', 'browser.mjs');
  assert.ok(fs.existsSync(file), 'hooks/rules/browser.mjs exists');
  const mod = await import(pathToFileURL(file).href);
  assert.equal(typeof mod.judge, 'function', 'browser.mjs exports judge');
  return mod.judge;
}
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}
function ev({ tool = SHOTS[0], session = 'lead', agentType = null, event = 'PreToolUse' } = {}) {
  return deepFreeze({
    v: 1, event, session, sessionKey: 'aaaaaaaaaaaa', agentKey: session === 'step' ? 'bbbbbbbbbbbb' : null, agentType,
    tool: { name: tool, command: null, paths: [], model: null, subagentType: null, outputRole: null },
    tokens: { state: 'none', total: 0 }, mainModel: null,
    env: { guardsOff: false, subagentModel: null, subagentModelForce: null },
    protected: [], run: null, drift: [], stopHookActive: null,
  });
}
const snap = (savers) => deepFreeze({ v: 1, at: 'x', threshold: 100000, savers, floor: {}, drift: false, settingsWarnings: [] });
const ON = snap({ [ID]: true });

async function run(opts, s = ON) {
  const judge = await load();
  const e = ev(opts);
  const before = JSON.stringify(e);
  const v = await judge(e, s);
  assert.equal(JSON.stringify(e), before, 'AC3: the event is unchanged');
  assert.ok(v && typeof v === 'object', 'judge returns a verdict object');
  return v;
}
const allow = async (opts, s) => assert.deepEqual(await run(opts, s), { v: 'allow' }, `allow: ${JSON.stringify(opts)}`);

// ---------- AC25: a Lead browser call notes when the saver is on ----------
test('AC25 note: Lead screenshot call with the saver on', async () => {
  for (const tool of SHOTS) {
    const v = await run({ tool });
    assert.equal(v.v, 'note', `note for ${tool} (got ${JSON.stringify(v)})`);
    assert.equal(v.rule, RULE);
    assert.ok(typeof v.message === 'string' && v.message.length >= 1 && v.message.length <= 300, 'message 1-300 chars');
    assert.match(v.message, /^[\x20-\x7e -￿]+$/, 'printable, one line');
  }
});
test('AC25 note: the verdict is allow-listed (only v, rule, message): no rewrite, no effect', async () => {
  const v = await run({});
  assert.deepEqual(Object.keys(v).sort(), ['message', 'rule', 'v']);
  for (const k of ['updatedInput', 'additionalContext', 'effect', 'systemMessage']) assert.ok(!(k in v), `no ${k}`);
});
test('AC25 note: the text names the cost, not the pack or a way to shrink evidence', async () => {
  const v = await run({});
  assert.match(v.message, /screenshot|token|image/i);
});

// ---------- AC25: off by default ----------
test('AC25 off: switch false, absent, empty or not exactly true allows', async () => {
  await allow({}, snap({ [ID]: false }));
  await allow({}, snap({}));
  await allow({}, snap({ 'cache-tax': true }));
  await allow({}, snap({ [ID]: 'true' }));
  await allow({}, snap({ [ID]: 1 }));
  await allow({}, snap({ [ID]: null }));
  await allow({}, deepFreeze({ v: 1, at: 'x', threshold: 100000, floor: {}, drift: false, settingsWarnings: [] }));
});

// ---------- AC25 + AC28: never in a Step, never on hands-on-tester evidence ----------
test('AC28 Step session: no note even with the saver on', async () => {
  await allow({ session: 'step', agentType: 'aico:qa' });
  await allow({ session: 'step', agentType: null });
});
test('AC25 hands-on-tester: no note, in any session label', async () => {
  await allow({ session: 'step', agentType: 'aico:hands-on-tester' });
  await allow({ session: 'step', agentType: 'hands-on-tester' });
  await allow({ session: 'lead', agentType: 'aico:hands-on-tester' });
  await allow({ session: 'lead', agentType: 'HANDS-ON-TESTER' });
});

// ---------- scope: only browser screenshot calls on PreToolUse ----------
test('AC25 scope: other tools and other events allow', async () => {
  for (const tool of ['Read', 'Bash', 'Agent', 'Write', 'mcp__Claude_Browser__navigate', 'mcp__other__screenshot_notes']) await allow({ tool });
  await allow({ event: 'SubagentStart' });
  await allow({ event: 'SessionStart' });
});
test('AC25 scope: a null tool allows without throwing', async () => {
  const judge = await load();
  const e = deepFreeze({ ...ev({}), tool: null });
  assert.deepEqual(await judge(e, ON), { v: 'allow' });
});

// ---------- AC3: never alters input ----------
test('AC3 frozen event and snapshot are never touched, verdict never carries updatedInput', async () => {
  for (const opts of [{}, { session: 'step' }, { tool: 'Read' }]) {
    const v = await run(opts);
    assert.ok(!('updatedInput' in v));
  }
});

// ---------- fixtures (hooks/fixtures/browser.Y1): note-*, pass-* ----------
test('fixtures: browser.Y1 has at least one note-* and one pass-* file, each a synthetic PreToolUse payload', () => {
  const names = fs.readdirSync(FIX).filter((n) => n.endsWith('.json'));
  assert.ok(names.some((n) => n.startsWith('note-')), 'a note fixture');
  assert.ok(names.some((n) => n.startsWith('pass-')), 'a pass fixture');
  for (const n of names) {
    const j = JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8'));
    assert.equal(j.hook_event_name, 'PreToolUse');
    assert.equal(typeof j.tool_name, 'string');
    assert.ok(!('prompt' in j), 'synthetic, never a real payload');
  }
});
test('fixtures drive the judge: note-* notes, pass-* allows', async () => {
  const judge = await load();
  for (const n of fs.readdirSync(FIX).filter((x) => x.endsWith('.json')).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8'));
    const syn = j._synthetic || {};
    const e = ev({ tool: j.tool_name, session: syn.session || 'lead', agentType: j.agent_type || null });
    const v = await judge(e, snap({ [ID]: syn.saver === true }));
    assert.equal(v.v, n.startsWith('note-') ? 'note' : 'allow', `${n} (got ${JSON.stringify(v)})`);
  }
});
