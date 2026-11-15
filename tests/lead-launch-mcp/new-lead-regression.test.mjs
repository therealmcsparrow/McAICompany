import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { contextHandover } from '../../scripts/lead-handover.mjs';
import { newSession } from '../../scripts/lead-launch-mcp.mjs';

// Regression for P20261115.000001/01-fix (CEO decisions 3 and 4, grill P20261109.000003-03.31.20).
// Bug: at the context cap the frozen Lead cannot hand over by itself.
//  (a) guard cap.M1 refuses SendFeedback while frozen (hooks/rules/cap.mjs judgeLead);
//  (b) lead_new_session (scripts/lead-launch-mcp.mjs newSession) only returns the command and starts nothing.
// v2.0 (T6): (b) is tested through the deps.start seam (never a real claude, never a real helper) with process.platform pinned.

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const SERVER = path.join(repo, 'scripts', 'lead-launch-mcp.mjs');
const MCP = 'mcp__plugin_aico_lead-session__lead_new_session';
const FOLDER = 'z:/proj/.company/work/P20261114.000001/01-feature';
const T = 180000;

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

// ---------- (a) frozen guard and SendFeedback ----------
const frozenEvent = (tool) => Object.freeze({
  v: 1, event: 'PreToolUse', session: 'lead', sessionKey: 'aaaaaaaaaaaa', agentKey: null, agentType: null,
  tool: { name: tool, command: null, paths: [], model: null, subagentType: null, outputRole: null },
  tokens: { state: 'read', total: 180000 }, mainModel: null,
  env: { guardsOff: false, subagentModel: null, subagentModelForce: null },
  protected: [], run: { slug: 'P20261114.000001/01-feature', folder: FOLDER, stepRunning: false, frozen: true, agent: { deny: false, handoff: false, ledger: false } },
  drift: [], stopHookActive: null,
});
const snap = Object.freeze({ v: 1, at: 'x', threshold: T, savers: {}, floor: {}, drift: false, settingsWarnings: [] });
const judge = async (tool) => (await import(pathToFileURL(path.join(repo, 'hooks', 'rules', 'cap.mjs')).href)).judge(frozenEvent(tool), snap);

describe('frozen guard (decision 4)', () => {
  test('SendFeedback is allowed while the Lead is frozen', async () => {
    assert.deepEqual(await judge('SendFeedback'), { v: 'allow' });
  });

  test('lead_new_session is still allowed while frozen', async () => {
    assert.deepEqual(await judge(MCP), { v: 'allow' });
  });

  test('every other tool stays refused while frozen (only SendFeedback and lead_new_session pass)', async () => {
    for (const tool of ['Read', 'Bash', 'PowerShell', 'Write', 'Edit', 'Agent', 'Task', 'Grep', 'mcp__other__tool', 'SendFeedbackX', 'sendfeedback']) {
      const v = await judge(tool);
      assert.equal(v.v, 'deny', `${tool} must be refused while frozen`);
      assert.equal(v.effect, 'cap-lead-frozen', tool);
    }
  });
});

// ---------- (b) lead_new_session arms and starts the replace helper (lead-session-mcp v2.1) ----------
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const SESSION = 'abcdef012345';
const DESCRIPTION = 'Starts the new Lead in this terminal after a context hand-over: waits for background tasks and the end of this turn, then types /clear and the hand-over prompt.';

// Product root with a run; `running` leaves a Step open; `frozen` adds a context hand-over for the session.
function fixture({ running = false, frozen = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-newses-'));
  tmps.push(root);
  const slug = 'demo-run';
  const dir = path.join(root, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const id = '000000000001';
  const rows = [{ v: 1, at: iso(now - 60000), ev: 'start' }, { v: 1, at: iso(now - 50000), ev: 'sub', role: 'backend-engineer', id, phase: 'start' }];
  if (!running) rows.push({ v: 1, at: iso(now - 40000), ev: 'sub', role: 'backend-engineer', id, phase: 'stop' });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  if (frozen) contextHandover(root, slug, { tokens: 85600, session: SESSION });
  return { root, slug, dir };
}

// The seam: deps.start(argv) is a fake that records its calls; nothing real is ever started.
const spy = () => { const calls = []; return { calls, start: (argv) => { calls.push(argv); } }; };

// typer(process.platform) is read at call time; pin the platform for one call.
function onPlatform(platform, fn) {
  const d = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', d); }
}
const callOn = (platform, root, deps) => onPlatform(platform, () => newSession(root, Date.now(), deps));
const text = (r) => r.content[0].text;
const armFile = (fx) => path.join(fx.dir, 'lead-replace.json');

describe('lead_new_session arms once and starts the helper (CEO decision 3)', () => {
  test('frozen and quiet on win32: lead-replace.json armed once, deps.start called once', () => {
    const fx = fixture();
    const s = spy();
    const r = callOn('win32', fx.root, { start: s.start });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.equal(s.calls.length, 1, 'deps.start called exactly once');
    assert.ok(fs.existsSync(armFile(fx)), 'lead-replace.json written in the run folder');
    const a = JSON.parse(fs.readFileSync(armFile(fx), 'utf8'));
    assert.equal(a.v, 1);
    assert.equal(a.session, SESSION, 'session of the newest context handover');
    assert.equal(a.state, 'waiting-background');
    assert.ok(Number.isFinite(Date.parse(a.armAt)) && Math.abs(Date.now() - Date.parse(a.armAt)) < 60000, `armAt is an ISO time, got ${a.armAt}`);
  });

  test('deps.start argv is [<plugin>/scripts/lead-replace.mjs, slug, ppid]', () => {
    const fx = fixture();
    const s = spy();
    callOn('win32', fx.root, { start: s.start });
    assert.equal(s.calls.length, 1);
    const argv = s.calls[0];
    assert.equal(argv.length, 3, JSON.stringify(argv));
    assert.equal(path.resolve(String(argv[0])), path.join(repo, 'scripts', 'lead-replace.mjs'));
    assert.equal(argv[1], fx.slug);
    assert.equal(String(argv[2]), String(process.ppid));
    assert.match(String(argv[2]), /^[1-9][0-9]*$/);
  });

  test('success text is the three lines: waits, fallback, command', () => {
    const fx = fixture();
    const r = callOn('win32', fx.root, spy());
    assert.equal(r.content.length, 1);
    const lines = text(r).split('\n');
    assert.equal(lines.length, 3, text(r));
    assert.equal(lines[0], 'The new Lead starts in this terminal once every background task has ended and this turn is over.');
    assert.equal(lines[1], 'If it has not started, run in the product folder:');
    assert.match(lines[2], /^claude ".*lead-handover read 'demo-run' first/);
    assert.doesNotMatch(text(r), /Open a new terminal/i);
  });

  test('a second call gives the same success text and no second start', () => {
    const fx = fixture();
    const s = spy();
    const a = callOn('win32', fx.root, { start: s.start });
    const before = fs.readFileSync(armFile(fx), 'utf8');
    const b = callOn('win32', fx.root, { start: s.start });
    assert.equal(b.isError, undefined);
    assert.equal(text(b), text(a));
    assert.equal(s.calls.length, 1, 'no second helper');
    assert.equal(fs.readFileSync(armFile(fx), 'utf8'), before, 'arm file unchanged');
  });

  test('an arm file already there for the same session: same success text, nothing started', () => {
    const fx = fixture();
    fs.writeFileSync(armFile(fx), `{"v":1,"session":"${SESSION}","armAt":"2026-01-01T00:00:00Z","state":"waiting-background"}\n`);
    const s = spy();
    const r = callOn('win32', fx.root, { start: s.start });
    assert.equal(r.isError, undefined);
    assert.equal(text(r).split('\n').length, 3);
    assert.equal(s.calls.length, 0);
  });

  test('a start that throws is refused: error', () => {
    const fx = fixture();
    const r = callOn('win32', fx.root, { start: () => { throw new Error('spawn failed'); } });
    assert.equal(r.isError, true);
    assert.equal(text(r), 'refused: error');
  });

  test('R-17: second hand-over (replace path), start throws: refused: error, arm gone, retry starts a helper', () => {
    const fx = fixture();
    fs.writeFileSync(armFile(fx), '{"v":1,"session":"0123456789ab","armAt":"2026-01-01T00:00:00Z","state":"waiting-background"}\n');
    const r = callOn('win32', fx.root, { start: () => { throw new Error('spawn failed'); } });
    assert.equal(r.isError, true);
    assert.equal(text(r), 'refused: error');
    assert.equal(fs.existsSync(armFile(fx)), false, 'new arm removed after the failed start');
    const s = spy();
    const r2 = callOn('win32', fx.root, { start: s.start });
    assert.equal(r2.isError, undefined, JSON.stringify(r2));
    assert.equal(s.calls.length, 1, 'retry starts a helper');
    assert.equal(JSON.parse(fs.readFileSync(armFile(fx), 'utf8')).session, SESSION);
  });

  test('the tool description is the v2.0 text, not "Starts nothing"', () => {
    const r = spawnSync(process.execPath, [SERVER], { cwd: repo, input: `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`, encoding: 'utf8', timeout: 10000 });
    const d = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]).result.tools[0].description;
    assert.doesNotMatch(d, /Starts nothing/i);
    assert.equal(d, DESCRIPTION);
  });

  test('the server source owns the process start (child_process), per ADR 0074', () => {
    assert.match(fs.readFileSync(SERVER, 'utf8'), /child_process/);
  });
});

describe('typer(platform) (scripts/lib/lead-typer.mjs)', () => {
  test('win32 has a typer; darwin, linux and others have none', async () => {
    const { typer } = await import(pathToFileURL(path.join(repo, 'scripts', 'lib', 'lead-typer.mjs')).href);
    assert.ok(typer('win32'), 'win32 typer');
    for (const p of ['darwin', 'linux', 'freebsd', 'aix', '']) assert.equal(typer(p), null, p);
  });
});

describe('non-win32: refused: unsupported terminal, nothing armed or started', () => {
  for (const platform of ['linux', 'darwin']) {
    test(platform, () => {
      const fx = fixture();
      const s = spy();
      const r = callOn(platform, fx.root, { start: s.start });
      assert.equal(r.isError, true);
      assert.equal(text(r), 'refused: unsupported terminal');
      assert.equal(s.calls.length, 0);
      assert.equal(fs.existsSync(armFile(fx)), false, 'nothing armed');
    });
  }
});

// Refusal order per the Contract table: the terminal check comes after every run-state check,
// so on linux each earlier refusal still wins; none of them starts or arms anything.
describe('refusal order and nothing started', () => {
  const refusedQuiet = (platform, fx, want) => {
    const s = spy();
    const r = callOn(platform, fx.root, { start: s.start });
    assert.equal(r.isError, true, JSON.stringify(r));
    assert.equal(text(r), `refused: ${want}`);
    assert.equal(s.calls.length, 0, 'nothing started');
    if (fx.dir) assert.equal(fs.existsSync(armFile(fx)), false, 'nothing armed');
  };
  for (const platform of ['win32', 'linux']) {
    test(`${platform}: no run`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-newses-'));
      tmps.push(root);
      refusedQuiet(platform, { root }, 'no run');
    });
    test(`${platform}: broken record before step running`, () => {
      const fx = fixture({ running: true, frozen: false });
      fs.writeFileSync(path.join(fx.dir, 'lead-handover.jsonl'), 'not json\n');
      refusedQuiet(platform, fx, 'broken record');
    });
    test(`${platform}: step running`, () => refusedQuiet(platform, fixture({ running: true, frozen: false }), 'step running'));
    test(`${platform}: no context handover`, () => refusedQuiet(platform, fixture({ frozen: false }), 'no context handover'));
  }
});

// Source shape of the process start (Contract: no shell, never claude, ignore stdio, hidden window, not detached, unref).
describe('the server starts exactly the helper, safely', () => {
  const src = () => fs.readFileSync(SERVER, 'utf8');
  test('no shell, no detached, no exec of a shell string, never claude', () => {
    assert.doesNotMatch(src(), /shell:\s*true/);
    assert.doesNotMatch(src(), /detached:\s*true/);
    assert.doesNotMatch(src(), /\bexec(Sync)?\(/);
    assert.doesNotMatch(src(), /\b(spawn|spawnSync|execFile|execFileSync|fork)\(\s*['"`]claude/);
  });
  test('stdio ignore, windowsHide true, unref', () => {
    assert.match(src(), /stdio:\s*['"]ignore['"]/);
    assert.match(src(), /windowsHide:\s*true/);
    assert.match(src(), /\.unref\(\)/);
  });
});
