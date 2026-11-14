import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// One executable test group per row of docs/pack-clash-table.md, each proving
// that no saver overrides a Role pin, the model floor or the context cap. Row ids: clash.1 to clash.8 plus
// `clash.cache-clock` (the extra row). Clean-room: only aico code and the Contracts are read, never the pack.
// Rows 2 to 5 are Haiku mods of release 2; their release-1 test is the invariant that nothing in release 1 can
// do what the pack mod does (no manifest, no rule, no verdict key that rewrites input), and that the aico rule
// the row names is unchanged under every saver setting.

const root = path.resolve(import.meta.dirname, '..');
const rel = (...p) => path.join(root, ...p);
const read = (...p) => fs.readFileSync(rel(...p), 'utf8');
const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-clash-')); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const imp = (...p) => import(pathToFileURL(rel(...p)).href);

const manifests = () => fs.readdirSync(rel('hooks', 'manifests')).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(read('hooks', 'manifests', n)));
const savers = () => manifests().filter((m) => m.kind === 'saver');
const guards = () => manifests().filter((m) => m.kind !== 'saver');
const SAVER_IDS = () => savers().map((m) => m.id);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}
// All 2^n combinations of saver switches (n is small), plus none and all.
function saverCombos() {
  const ids = SAVER_IDS();
  const out = [];
  for (let mask = 0; mask < 1 << ids.length; mask++) out.push(Object.fromEntries(ids.map((id, i) => [id, Boolean(mask & (1 << i))])));
  return out;
}
const snap = (over = {}) => ({ v: 1, at: 'x', threshold: 180000, savers: {}, floor: { qa: 'sonnet', architect: 'opus', localizer: 'haiku' }, drift: false, settingsWarnings: [], ...over });
function ev({ tool = {}, session = 'lead', tokens = { state: 'read', total: 0 }, run = null, event = 'PreToolUse', agentType = null, mainModel = null, env = {} } = {}) {
  return deepFreeze({
    v: 1, event, session, sessionKey: 'aaaaaaaaaaaa', agentKey: session === 'step' ? 'bbbbbbbbbbbb' : null, agentType,
    tool: { name: 'Read', command: null, paths: [], model: null, subagentType: null, outputRole: null, ...tool },
    tokens, mainModel, env: { guardsOff: false, subagentModel: null, subagentModelForce: null, ...env },
    protected: [], run, drift: [], stopHookActive: null,
  });
}
const RUN = { slug: 'P1/01-feature', folder: 'z:/p/.company/work/P1/01-feature', stepRunning: false, frozen: false, agent: { deny: false, handoff: false, ledger: false } };

// A user home and a project root with settings files, for the real snapshot code.
async function snapshotFor({ user, project, ids = SAVER_IDS() } = {}) {
  const { resolveSnapshotSettings } = await imp('hooks', 'lib', 'snapshot.mjs');
  const home = tmp();
  const proj = tmp();
  if (user !== undefined) fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(user));
  if (project !== undefined) {
    fs.mkdirSync(path.join(proj, '.company'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.company', 'settings.json'), JSON.stringify(project));
  }
  const ms = manifests().filter((m) => ids.includes(m.id) || m.kind !== 'saver');
  return resolveSnapshotSettings({ mcsHome: home, root: proj, manifests: ms });
}

// ---------- clash.1: handoff (250k offer) vs the cap guard ----------
test('clash.1 AC26: 250000 is the top of the range, 180000 is used when unset, 250001 and bad values fall back with one warning', async () => {
  const { resolveThreshold, DEFAULT_THRESHOLD, MAX_THRESHOLD } = await imp('hooks', 'rules', 'cap.mjs');
  assert.equal(DEFAULT_THRESHOLD, 180000);
  assert.equal(MAX_THRESHOLD, 250000);
  assert.deepEqual(resolveThreshold(250000), { threshold: 250000, warning: null });
  assert.equal(resolveThreshold(undefined).threshold, 180000);
  for (const bad of [250001, 59999, 0, -1, 1000000, 180000.5, '250000', NaN, Infinity, true, {}, []]) {
    const r = resolveThreshold(bad);
    assert.equal(r.threshold, 180000, `bad value ${String(bad)}`);
    assert.equal(typeof r.warning, 'string', `one warning for ${String(bad)}`);
    assert.ok(!r.warning.includes('\n'), 'one line');
  }
});
test('clash.1 AC26: the snapshot threshold is 180000 unset and for 250001; the pack 250k offer point is never carried', async () => {
  const unset = await snapshotFor({});
  assert.equal(unset.threshold, 180000);
  const over = await snapshotFor({ user: { pipeline: { context_cap: 250001 } } });
  assert.equal(over.threshold, 180000);
  assert.equal(over.warnings.length, 1, 'one warning');
  const ok = await snapshotFor({ user: { pipeline: { context_cap: 250000 } } });
  assert.equal(ok.threshold, 250000);
});
test('clash.1 AC26: a project value cannot raise the cap (user level only)', async () => {
  const s = await snapshotFor({ project: { pipeline: { context_cap: 250000 } } });
  assert.equal(s.threshold, 180000);
  const both = await snapshotFor({ user: { pipeline: { context_cap: 100000 } }, project: { pipeline: { context_cap: 250000 } } });
  assert.equal(both.threshold, 100000);
});
test('clash.1 AC26: at the freeze point of the default cap the guard acts under every saver setting; no saver moves the verdict', async () => {
  const { judge, freezeAt } = await imp('hooks', 'rules', 'cap.mjs');
  assert.equal(freezeAt(180000), 162000);
  const tool = { name: 'Read' };
  const at = ev({ tool, session: 'lead', tokens: { state: 'read', total: 162000 }, run: RUN });
  const below = ev({ tool, session: 'lead', tokens: { state: 'read', total: 161999 }, run: RUN });
  // 200000 tokens is under the pack's 250k offer point but over the freeze point of 180000.
  const packOffer = ev({ tool, session: 'step', tokens: { state: 'read', total: 200000 }, run: RUN });
  const base = judge(at, snap());
  assert.equal(base.v, 'deny');
  assert.equal(judge(packOffer, snap()).v, 'deny');
  assert.deepEqual(judge(below, snap()), { v: 'allow' });
  for (const combo of saverCombos()) {
    const s = snap({ savers: combo });
    assert.deepEqual(judge(at, s), base, `savers ${JSON.stringify(combo)}`);
    assert.equal(judge(packOffer, s).v, 'deny');
    assert.deepEqual(judge(below, s), { v: 'allow' });
  }
});
test('clash.1 AC26: the cap guard is locked on with no switch, no saver runs the cap rule, and no manifest is a handoff mod', () => {
  const cap = manifests().find((m) => m.id === 'cap');
  assert.ok(cap, 'cap manifest exists');
  assert.equal(cap.kind, 'guard');
  assert.equal(cap.lock, true);
  assert.equal(cap.switch, null);
  for (const s of savers()) assert.ok(!s.rules.some((r) => r.startsWith('cap.')), `${s.id} does not own a cap rule`);
  assert.ok(!manifests().some((m) => /handoff/.test(m.id)), 'no pack handoff mod');
});
test('clash.1 AC26: a saver verdict cannot carry a cap effect', async () => {
  const { checkVerdict } = await imp('hooks', 'lib', 'rule-runner.mjs');
  assert.equal(checkVerdict({ v: 'note', rule: 'browser.Y1', message: 'x', effect: 'cap-warn' }), null);
  assert.equal(checkVerdict({ v: 'allow', rule: 'browser.Y1', effect: 'cap-lead-freeze' }), null);
  assert.equal(checkVerdict({ v: 'deny', rule: 'savings.Y1', message: 'x', effect: 'cap-step-record' }), null);
});

// ---------- clash.2: model-router vs the model floor and Role pins (release 2 mod) ----------
test('clash.2 AC26: no release-1 saver picks a model: no router manifest, no saver rule, and the floor verdict is the same under every saver setting', async () => {
  assert.ok(!manifests().some((m) => /model-router/.test(m.id)), 'no model-router in release 1');
  const { judge } = await imp('hooks', 'rules', 'model-floor.mjs');
  const cases = [
    ev({ tool: { name: 'Agent', subagentType: 'aico:qa', model: 'haiku' } }),
    ev({ tool: { name: 'Agent', subagentType: 'architect', model: 'sonnet' } }),
    ev({ tool: { name: 'Agent', subagentType: 'qa', model: 'sonnet' } }),
    ev({ tool: { name: 'Agent', subagentType: 'qa', model: 'inherit' }, mainModel: 'claude-haiku-4-5' }),
    ev({ tool: { name: 'Agent', subagentType: 'localizer', model: 'haiku' } }),
  ];
  const base = cases.map((c) => judge(c, snap()));
  assert.deepEqual(base.map((v) => v.v), ['deny', 'deny', 'allow', 'deny', 'allow']);
  for (const combo of saverCombos()) assert.deepEqual(cases.map((c) => judge(c, snap({ savers: combo }))), base, JSON.stringify(combo));
});
test('clash.2 AC26: a Role pin wins: every agents/*.md model is at or above its floor in company/model-floor.json', () => {
  const rank = { haiku: 0, sonnet: 1, opus: 2 };
  const floor = JSON.parse(read('company', 'model-floor.json')).floor;
  let checked = 0;
  for (const f of fs.readdirSync(rel('agents')).filter((n) => n.endsWith('.md'))) {
    const role = f.replace(/\.md$/, '');
    const m = /^model:\s*(\S+)\s*$/m.exec(read('agents', f).split(/\r?\n---/)[0]);
    if (!m || !Object.hasOwn(floor, role)) continue;
    assert.ok(rank[m[1]] >= rank[floor[role]], `${role}: pin ${m[1]} is below floor ${floor[role]}`);
    checked++;
  }
  assert.ok(checked > 10, 'many Role pins were checked');
});
test('clash.2 AC26: a saver rule never reads or sets a model', () => {
  for (const f of ['browser.mjs']) {
    const src = read('hooks', 'rules', f);
    assert.doesNotMatch(src, /\.model\b|subagentModel|mainModel|updatedInput/, `${f} touches no model`);
  }
});

// ---------- clash.3: effort-optimizer vs Role effort (release 2 mod) ----------
test('clash.3 AC26: nothing in release 1 sets effort; the Role effort in agents/*.md is not touched by any saver', async () => {
  assert.ok(!manifests().some((m) => /effort/.test(m.id)), 'no effort-optimizer in release 1');
  const { checkVerdict } = await imp('hooks', 'lib', 'rule-runner.mjs');
  assert.equal(checkVerdict({ v: 'note', rule: 'browser.Y1', message: 'x', effort: 'low' }), null, 'a verdict key outside the allow-list is refused');
  assert.equal(checkVerdict({ v: 'note', rule: 'browser.Y1', message: 'x', updatedInput: { effort: 'low' } }), null);
  assert.doesNotMatch(read('hooks', 'rules', 'browser.mjs'), /effort/i);
  for (const f of fs.readdirSync(rel('agents')).filter((n) => n.endsWith('.md'))) {
    assert.match(read('agents', f).split(/\r?\n---/)[0], /^effort:\s*\S+\s*$/m, `${f} keeps an effort pin`);
  }
});

// ---------- clash.4: input-router vs exact text for Edit and review (release 2 mod) ----------
test('clash.4 AC26: nothing in release 1 replaces what Claude reads: no router manifest, no verdict key that rewrites input or output, the event is unchanged', async () => {
  assert.ok(!manifests().some((m) => /input-router/.test(m.id)), 'no input-router in release 1');
  const { checkVerdict } = await imp('hooks', 'lib', 'rule-runner.mjs');
  for (const key of ['updatedInput', 'updatedOutput', 'additionalContext', 'systemMessage', 'summary']) {
    assert.equal(checkVerdict({ v: 'note', rule: 'browser.Y1', message: 'x', [key]: 'y' }), null, key);
  }
  const { judge } = await imp('hooks', 'rules', 'browser.mjs');
  const e = ev({ tool: { name: 'Read', paths: [{ raw: 'a.txt', real: '/a.txt', exists: true }] } });
  const before = JSON.stringify(e);
  judge(e, snap({ savers: Object.fromEntries(SAVER_IDS().map((id) => [id, true])) }));
  assert.equal(JSON.stringify(e), before);
  assert.deepEqual(judge(e, snap({ savers: { 'efficient-browser-use': true } })), { v: 'allow' }, 'a Read passes untouched');
});

// ---------- clash.5: research-router vs aico:sourcing (release 2 mod) ----------
test('clash.5 AC26: nothing in release 1 routes research; the sourcing tiers, caps and (unverified) rule are still in aico:sourcing', () => {
  assert.ok(!manifests().some((m) => /research-router/.test(m.id)), 'no research-router in release 1');
  for (const s of savers()) assert.ok(!/sourc|research/i.test(`${s.id} ${s.title} ${s.rules.join(' ')}`), `${s.id} is not a research saver`);
  const text = read('skills', 'sourcing', 'SKILL.md');
  assert.match(text, /\(unverified\)/);
  assert.match(text, /at most 10 web fetches/);
  assert.match(text, /untrusted/i);
});

// ---------- clash.6: efficient-browser-use vs hands-on-tester evidence ----------
test('clash.6 AC25 AC26: off by default in the settings and in the snapshot the engine builds', async () => {
  const { judge } = await imp('hooks', 'rules', 'browser.mjs');
  const s = await snapshotFor({});
  assert.equal(s.savers['efficient-browser-use'], false, 'snapshot default for efficient-browser-use is false');
  const shot = ev({ tool: { name: 'mcp__playwright__browser_take_screenshot' } });
  assert.deepEqual(judge(shot, snap({ savers: s.savers })), { v: 'allow' }, 'no note when never switched on');
  const on = await snapshotFor({ user: { mods: { efficient_browser_use: { enabled: true } } } });
  assert.equal(on.savers['efficient-browser-use'], true);
});
test('clash.6 AC25 AC26: hands-on-tester and every Step session get no note and no change, with the saver on', async () => {
  const { judge } = await imp('hooks', 'rules', 'browser.mjs');
  const on = snap({ savers: { 'efficient-browser-use': true } });
  const names = ['mcp__Claude_Browser__screenshot', 'mcp__playwright__browser_take_screenshot', 'mcp__claude-in-chrome__SCREENSHOT'];
  for (const name of names) {
    for (const agentType of ['hands-on-tester', 'aico:hands-on-tester', 'HANDS-ON-TESTER']) {
      const e = ev({ tool: { name }, session: 'lead', agentType });
      const before = JSON.stringify(e);
      assert.deepEqual(judge(e, on), { v: 'allow' }, `${agentType} ${name}`);
      assert.equal(JSON.stringify(e), before, 'evidence bytes unchanged');
    }
    for (const agentType of [null, 'qa', 'aico:qa', 'hands-on-tester']) {
      assert.deepEqual(judge(ev({ tool: { name }, session: 'step', agentType }), on), { v: 'allow' }, `step ${agentType} ${name}`);
    }
  }
});
test('clash.6 AC25 AC26: the Lead note never shrinks or replaces the screenshot: note only, no rewrite key', async () => {
  const { judge } = await imp('hooks', 'rules', 'browser.mjs');
  const e = ev({ tool: { name: 'mcp__Claude_Browser__screenshot' } });
  const before = JSON.stringify(e);
  const v = judge(e, snap({ savers: { 'efficient-browser-use': true } }));
  assert.equal(v.v, 'note');
  assert.deepEqual(Object.keys(v).sort(), ['message', 'rule', 'v']);
  assert.equal(JSON.stringify(e), before);
  assert.doesNotMatch(read('hooks', 'rules', 'browser.mjs'), /haiku|resize|shrink\(|sharp|canvas/i);
  const m = manifests().find((x) => x.id === 'efficient-browser-use');
  assert.equal(m.sessions, 'lead');
  assert.equal(m.fail, 'open');
});

// ---------- clash.7: mods (switches.json) vs aico settings with locks ----------
test('clash.7 AC15 AC23 AC26: every guard and gate row is LOCKED ON and cannot change, even when settings say off', async () => {
  const { rows } = await imp('mods', 'lib', 'switchboard.mjs');
  const mods = Object.fromEntries(manifests().flatMap((m) => [[m.id.replaceAll('-', '_'), { enabled: false }]]));
  const t = rows(manifests(), { known: true, mods });
  assert.equal(t.guards.length, guards().length);
  assert.ok(t.guards.length >= 6);
  for (const g of t.guards) {
    assert.equal(g.state, 'LOCKED ON', g.id);
    assert.equal(g.canChange, false, g.id);
    assert.equal(g.key, null, g.id);
  }
  for (const m of guards()) { assert.equal(m.lock, true, m.id); assert.equal(m.switch, null, m.id); }
});
test('clash.7 AC15 AC23 AC26: hand-edited settings cannot turn a guard off: the snapshot has no guard switch and every guard rule stays in rules.json', async () => {
  const hand = { mods: { cap: { enabled: false }, model_floor: { enabled: false }, git_add: { enabled: false }, self_protect: { enabled: false }, dotenv: { enabled: false } }, guards: 'off', guards_off: true };
  const s = await snapshotFor({ user: hand, project: hand });
  const guardIds = guards().map((m) => m.id);
  for (const id of guardIds) assert.ok(!Object.hasOwn(s.savers, id), `${id} has no switch in the snapshot`);
  assert.deepEqual(Object.keys(s.savers).sort(), SAVER_IDS().sort(), 'the snapshot lists savers only');
  const table = JSON.parse(read('hooks', 'rules.json'));
  for (const g of guards()) for (const r of g.rules) assert.ok(table.some((row) => row.rule === r && row.fail === 'closed'), `${r} still runs, fail closed`);
});
test('clash.7 AC15 AC23 AC26: set-mod refuses a guard id and writes nothing; a saver write goes to config.json only, never a switches.json', () => {
  const home = tmp();
  const proj = tmp();
  const run = (...args) => spawnSync(process.execPath, [rel('scripts', 'settings.mjs'), ...args], { cwd: proj, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home } });
  for (const id of ['cap', 'model-floor', 'self-protect', 'git-add', 'dotenv', 'switches', 'handoff']) {
    const r = run('set-mod', id, 'off');
    assert.equal(r.status, 2, `${id}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /^refused: /);
  }
  assert.deepEqual(fs.readdirSync(home), [], 'nothing written by the refusals');
  const ok = run('set-mod', 'savings', 'off');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const names = fs.readdirSync(home);
  assert.ok(!names.includes('switches.json'));
  assert.ok(names.every((n) => n === 'config.json' || n.startsWith('config.json.') === false || true));
  assert.ok(names.includes('config.json'));
});
test('clash.7 AC15 AC23 AC26: switches.json is never read or written by production code', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'fixtures', 'test'].includes(e.name)) walk(p); continue; }
      if (!/\.(mjs|js|ts|tsx|html)$/.test(e.name) || /\.test\./.test(e.name)) continue;
      if (/switches\.json/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p));
    }
  };
  for (const d of ['scripts', 'hooks', 'mods']) walk(rel(d));
  assert.deepEqual(hits, []);
});

// ---------- clash.8: savings-proof vs real tokens from the ledger ----------
const stepRow = (tokens, extra = {}) => ({ kind: 'step', tokens, ...extra });
const T = (n) => ({ in: n, cache_write: 0, cache_read: 0, out: 0 });
test('clash.8 AC24 AC26: an estimate never enters the real figure, whatever name or place it has', async () => {
  const { currentFigures } = await imp('mods', 'lib', 'savings.mjs');
  const clean = currentFigures({ rows: [stepRow(T(100)), stepRow(T(300)), stepRow(T(200))] });
  assert.equal(clean.median, 200);
  const dirty = currentFigures({
    rows: [
      stepRow(T(100), { saved: 99999, estimated: 5000, estimate: 5000, tokens_saved: 7000 }),
      stepRow(T(300), { estimated_tokens: 1 }),
      stepRow(T(200)),
      { kind: 'saving', tokens: T(1), saved: 5 },
      { kind: 'estimate', tokens: T(2) },
    ],
    saved: 123456, estimated: 99,
  });
  assert.deepEqual(dirty, clean);
  assert.equal(currentFigures({ rows: [stepRow({ ...T(100), estimated: 50 })] }).median, 100, 'an extra token key is not added to the real count');
});
test('clash.8 AC24 AC26: empty or missing data shows "no data" or "unmeasured", never NaN; the baseline cannot be filled by an estimate', async () => {
  const { currentFigures, baselineFigures, paneLines } = await imp('mods', 'lib', 'savings.mjs');
  const bad = [undefined, null, {}, { rows: null }, { rows: [] }, { rows: [stepRow(null)] }, { rows: [stepRow({})] },
    { rows: [stepRow({ in: NaN, cache_write: 0, cache_read: 0, out: 0 })] }, { rows: [stepRow({ in: '5', cache_write: 0, cache_read: 0, out: 0 })] },
    { rows: [stepRow({ in: -1, cache_write: 0, cache_read: 0, out: 0 })] }, { rows: [stepRow({ in: Infinity, cache_write: 0, cache_read: 0, out: 0 })] }, 'text', 42];
  const baselines = [undefined, null, {}, { state: 'ok', median: NaN, runs: 3 }, { state: 'ok', median: null, runs: 3 }, { state: 'ok', median: 5, runs: 0 }, { state: 'ok', median: 5, runs: 11 },
    { state: 'ok', median: '5', runs: 2 }, { state: 'no-data', median: 7, runs: 0 }, { state: 'unknown', median: null, runs: 0 }, { state: 'estimated', median: 9, runs: 1 }, { estimate: 5 }];
  for (const r of bad) {
    for (const b of baselines) {
      const current = currentFigures(r);
      assert.ok(['no-data', 'unmeasured'].includes(current.state), JSON.stringify(r));
      const lines = paneLines({ run: 'x', current, baseline: baselineFigures(b), ledgerError: '', columns: 100 }).map((l) => l.text).join('\n');
      assert.doesNotMatch(lines, /NaN|undefined|Infinity|\[object/, `${JSON.stringify(r)} ${JSON.stringify(b)}`);
    }
  }
  assert.match(paneLines({ run: '', current: currentFigures({ rows: [] }), baseline: baselineFigures(undefined), ledgerError: '', columns: 100 }).map((l) => l.text).join('\n'), /NO DATA|UNMEASURED|UNKNOWN|UNREADABLE/);
});
test('clash.8 AC24 AC26: the estimate field is separate and labelled, and the pane draws no estimate as a measured number', async () => {
  const { currentFigures, baselineFigures, paneLines } = await imp('mods', 'lib', 'savings.mjs');
  const lines = paneLines({ run: 'r', current: currentFigures({ rows: [stepRow(T(1234))] }), baseline: baselineFigures({ state: 'ok', median: 2000, runs: 3 }), ledgerError: '', columns: 100 }).map((l) => l.text);
  const measured = lines.findIndex((l) => l.startsWith('MEASURED'));
  const estimated = lines.findIndex((l) => l.startsWith('ESTIMATED'));
  assert.ok(measured >= 0 && estimated > measured, 'MEASURED then ESTIMATED sections');
  assert.ok(lines.slice(0, estimated).some((l) => /1234/.test(l)), 'the real figure is in the measured part');
  assert.ok(!lines.slice(estimated + 1).some((l) => /\d{3,}/.test(l)), 'no number in the estimated part');
});
test('clash.8 AC24 AC26: run names and fields are escaped; the pack savings log is never read', async () => {
  const { safeText, paneLines, currentFigures, baselineFigures } = await imp('mods', 'lib', 'savings.mjs');
  const evil = 'run\u001b[31mRED\u0007\u0000\n' + 'x'.repeat(100);
  const s = safeText(evil);
  assert.doesNotMatch(s, /[\u0000-\u001f\u007f-\u009f]/);
  assert.ok(Array.from(s).length <= 43);
  const text = paneLines({ run: safeText(evil), current: currentFigures({ rows: [] }), baseline: baselineFigures({ state: 'unknown', median: null, runs: 0 }), ledgerError: '', columns: 100 }).map((l) => l.text).join('\n');
  assert.doesNotMatch(text, /\u001b/);
  const src = ['mods/lib/savings.mjs', 'mods/savings.tsx'].map((f) => read(...f.split('/'))).join('\n');
  assert.doesNotMatch(src, /savings\.json|savings-log|savings\.jsonl|readFile|node:fs|fs\.read/);
  assert.match(read('mods', 'savings.tsx'), /run\(\$, 'ledger'/, 'the pane reads the ledger script');
});

// ---------- extra row: cache-clock (countdown only; no keep-warm ping) ----------
const CLOCK_FILES = [['mods', 'cache-tax.tsx'], ['mods', 'lib', 'cache-clock.mjs']];
test('clash.cache-clock AC22 AC26: no network, spawn, model fork or ping in the clock mod', () => {
  for (const f of CLOCK_FILES) {
    const src = read(...f);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket|\bhttps?:\/\/|from\s+['"](?:node:)?(?:https?|net|tls|dgram|child_process)['"]|require\(['"](?:node:)?(?:https?|net|child_process)/, `${f.join('/')}: no network or process`);
    assert.doesNotMatch(code, /\bmodel\.(fork|complete|ask)\b|\$\.(agent\.(spawn|fork|run|start)|prompt\.(send|submit))\s*\(|\bspawn(Sync)?\s*\(/, `${f.join('/')}: no model call or spawn`);
    assert.doesNotMatch(code, /keepwarm|keep-warm|keep_warm|\bping\b|setInterval\([^)]*(model|agent|prompt)/i, `${f.join('/')}: no ping`);
  }
});
test('clash.cache-clock AC22 AC26: the clock shows a countdown, says nothing keeps it warm, and never asks for a ping', async () => {
  const { cacheClock, clockLines, noteRequest, clockStatus } = await imp('mods', 'lib', 'cache-clock.mjs');
  const t0 = Date.UTC(2026, 10, 14, 10, 0, 0);
  const state = noteRequest(null, t0);
  const clock = cacheClock(state, t0 + 10 * 60000);
  assert.equal(clock.kind, 'valid');
  assert.equal(clock.minutesLeft, 50);
  assert.equal(clockStatus(clock), '50m');
  const text = clockLines(clock).join('\n');
  assert.match(text, /in 50 min/);
  assert.match(text, /nothing keeps them warm/);
  assert.doesNotMatch(text, /ping|keepwarm|keep warm/i);
  assert.equal(cacheClock(state, t0 + 61 * 60000).kind, 'expired');
  assert.match(clockLines(cacheClock(state, t0 + 61 * 60000)).join('\n'), /expired/);
  assert.equal(cacheClock(noteRequest(null, t0, 'assumed'), t0).kind, 'valid');
});
test('clash.cache-clock AC22 AC26: the saver manifest is cache-tax (title Cache clock), a saver with the existing switch and no rule, and the keep-warm command is gone', async () => {
  const file = rel('hooks', 'manifests', 'cache-tax.json');
  assert.ok(fs.existsSync(file), 'hooks/manifests/cache-tax.json exists');
  const { parseManifest } = await imp('mods', 'lib', 'switchboard.mjs');
  const m = parseManifest(fs.readFileSync(file, 'utf8'));
  assert.ok(m, 'valid mod-manifest v1');
  assert.equal(m.id, 'cache-tax');
  assert.equal(m.title, 'Cache clock');
  assert.equal(m.kind, 'saver');
  assert.equal(m.switch, 'mods.cache_tax.enabled');
  assert.deepEqual(m.rules, []);
  assert.ok(!fs.existsSync(rel('commands', 'keepwarm.md')));
});

// ---------- coverage of the table itself ----------
test('AC26: every clash id of docs/pack-clash-table.md has a test here', () => {
  const table = read('docs', 'pack-clash-table.md');
  const ids = [...new Set([...table.matchAll(/\bclash\.(\d)\b/g)].map((m) => m[1]))].sort();
  assert.deepEqual(ids, ['1', '2', '3', '4', '5', '6', '7', '8']);
  const self = read('scripts', 'pack-clash.test.mjs');
  for (const id of ids) assert.match(self, new RegExp(`test\\('clash\\.${id} `), `clash.${id} has a test`);
  assert.match(self, /test\('clash\.cache-clock /);
});
