import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { contextHandover } from '../../scripts/lead-handover.mjs';

// Regression for P20261115.000001/01-fix (CEO decisions 3 and 4, grill P20261109.000003-03.31.20).
// Bug: at the context cap the frozen Lead cannot hand over by itself.
//  (a) guard cap.M1 refuses SendFeedback while frozen (hooks/rules/cap.mjs judgeLead);
//  (b) lead_new_session (scripts/lead-launch-mcp.mjs newSession) only returns the command and starts nothing.
// These tests state the wanted behaviour; they fail at the base commit.

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

// ---------- (b) lead_new_session must start the new Lead ----------
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const SESSION = 'abcdef012345';

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

// A fake `claude` first on PATH records its argv; stands in for whatever process the tool starts.
function fakeClaude() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-newses-bin-'));
  tmps.push(bin);
  const marker = path.join(bin, 'claude-called.txt');
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho "$@" >> "${marker.replaceAll('\\', '/')}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'claude.cmd'), `@echo off\r\necho %* >> "${marker}"\r\n`);
  return { bin, marker };
}

function callTool(root, bin) {
  const input = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lead_new_session' } })}\n`;
  const sep = path.delimiter;
  const r = spawnSync(process.execPath, [SERVER], { cwd: root, input, encoding: 'utf8', timeout: 15000, env: { ...process.env, PATH: `${bin}${sep}${process.env.PATH}` } });
  const out = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { msg: out[0], err: r.stderr };
}
const settle = () => new Promise((r) => setTimeout(r, 1500)); // a detached start may lag the reply

describe('lead_new_session starts the new Lead (decision 3)', () => {
  test('from the frozen state with no Step running it starts a Lead process that reads the hand-over', async () => {
    const fx = fixture();
    const fc = fakeClaude();
    const { msg } = callTool(fx.root, fc.bin);
    await settle();
    assert.equal(msg.result.isError, undefined, JSON.stringify(msg));
    assert.ok(fs.existsSync(fc.marker), 'a new claude process was started (marker missing: the tool only returned a command)');
    const argv = fs.readFileSync(fc.marker, 'utf8');
    assert.match(argv, /lead-handover read/);
    assert.ok(argv.includes(fx.slug), 'the new Lead is pointed at the run slug');
  });

  test('the reply is not a "open a new terminal" instruction (the CEO must not start it by hand)', () => {
    const fx = fixture();
    const { msg } = callTool(fx.root, fakeClaude().bin);
    assert.doesNotMatch(msg.result.content[0].text, /Open a new terminal/i);
  });

  test('the tool description no longer says "Starts nothing"', () => {
    const r = spawnSync(process.execPath, [SERVER], { cwd: repo, input: `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`, encoding: 'utf8', timeout: 10000 });
    const d = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]).result.tools[0].description;
    assert.doesNotMatch(d, /Starts nothing/i);
  });

  test('the server source now owns the process start (child_process), per the superseding ADR', () => {
    assert.match(fs.readFileSync(SERVER, 'utf8'), /child_process/);
  });
});

// Skip paths: nothing may be started. These pass at the base commit because nothing is ever started there;
// they guard the fix against starting a Lead too early. The "background task still running" path is not
// checkable yet: the seam that reports background tasks is not defined (see Handoff, Next).
describe('lead_new_session starts nothing outside the frozen, quiet state', () => {
  const refusedAndQuiet = async (fx) => {
    const fc = fakeClaude();
    const { msg } = callTool(fx.root, fc.bin);
    await settle();
    assert.equal(msg.result.isError, true, JSON.stringify(msg));
    assert.equal(fs.existsSync(fc.marker), false, 'no process may be started');
  };
  test('a Step is still running', async () => { await refusedAndQuiet(fixture({ running: true, frozen: false })); }); // contextHandover itself refuses while a Step runs
  test('no context hand-over on record (not frozen)', async () => { await refusedAndQuiet(fixture({ frozen: false })); });
  test('no run', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-newses-'));
    tmps.push(root);
    await refusedAndQuiet({ root });
  });
});
