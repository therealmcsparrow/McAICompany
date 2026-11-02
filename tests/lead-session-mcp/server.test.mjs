import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as lead from '../../scripts/lead-handover.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const SERVER = path.join(repo, 'scripts', 'lead-session-mcp.mjs');
const pluginVersion = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version;

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// A product root with a fresh run-state; `subs` 'running' leaves a Step open.
function fixture({ slug = 'demo-run', running = false, handover = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-mcp-'));
  tmps.push(root);
  const dir = path.join(root, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const rows = [{ v: 1, at: iso(now - 60000), ev: 'start' }];
  const id = '000000000001';
  rows.push({ v: 1, at: iso(now - 50000), ev: 'sub', role: 'backend-engineer', id, phase: 'start' });
  if (!running) rows.push({ v: 1, at: iso(now - 40000), ev: 'sub', role: 'backend-engineer', id, phase: 'stop' });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  if (handover) {
    const ev = { v: 1, n: 1, at: iso(now - 1000), ev: 'handover', file: 'lead-handoff-1.md', tokens: 85600, window: null, trigger: handover };
    if (handover === 'context') ev.session = 'abcdef012345';
    fs.writeFileSync(path.join(dir, 'lead-handover.jsonl'), `${JSON.stringify(ev)}\n`);
  }
  return { root, slug, dir };
}

// Runs the server on the given stdin text; returns the parsed stdout lines, the raw stderr and the exit code.
function run(input, cwd = repo) {
  const r = spawnSync(process.execPath, [SERVER], { cwd, input, encoding: 'utf8', timeout: 10000 });
  return { out: r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)), raw: r.stdout, err: r.stderr, code: r.status };
}
const rpc = (id, method, params) => `${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`;
const call = (id, args) => rpc(id, 'tools/call', { name: 'lead_new_session', ...(args === undefined ? {} : { arguments: args }) });
const text = (m) => m.result.content[0].text;

describe('protocol', () => {
  test('initialize echoes a date protocol version and reports the plugin version', () => {
    const r = run(rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } }));
    assert.deepEqual(r.out[0], { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'lead-session', version: pluginVersion } } });
    assert.equal(r.code, 0);
    assert.equal(r.err, '');
  });

  test('initialize falls back to 2025-06-18 for a non-date version', () => {
    assert.equal(run(rpc(1, 'initialize', { protocolVersion: 'latest' })).out[0].result.protocolVersion, '2025-06-18');
    assert.equal(run(rpc(1, 'initialize', {})).out[0].result.protocolVersion, '2025-06-18');
  });

  test('notifications get no answer; ping answers an empty result', () => {
    const r = run(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n${JSON.stringify({ jsonrpc: '2.0', method: 'whatever' })}\n${rpc(7, 'ping')}`);
    assert.deepEqual(r.out, [{ jsonrpc: '2.0', id: 7, result: {} }]);
  });

  test('tools/list returns the one tool with the fixed schema and description', () => {
    const t = run(rpc(2, 'tools/list')).out[0].result.tools;
    assert.equal(t.length, 1);
    assert.deepEqual(t[0], {
      name: 'lead_new_session',
      description: 'Returns the command that starts a new Lead session after a context hand-over. Starts nothing.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    });
  });

  test('unknown method -32601; bad JSON -32700 with null id', () => {
    const r = run(`${rpc(3, 'nope')}{not json\n`);
    assert.equal(r.out[0].error.code, -32601);
    assert.equal(r.out[0].id, 3);
    assert.equal(r.out[1].error.code, -32700);
    assert.equal(r.out[1].id, null);
  });

  test('bad params, unknown tool and any argument give -32602', () => {
    const cases = [
      rpc(1, 'tools/call'),
      rpc(2, 'tools/call', { name: 'other' }),
      rpc(3, 'tools/call', { name: 7 }),
      call(4, { slug: 'x' }),
      call(5, []),
      call(6, null),
      rpc(7, 'initialize', 'str'),
    ];
    const r = run(cases.join(''));
    assert.deepEqual(r.out.map((m) => m.error?.code), [-32602, -32602, -32602, -32602, -32602, -32602, -32602]);
  });

  test('a line over 64 KiB is dropped with -32700 and the next line still works', () => {
    const big = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', pad: 'x'.repeat(70 * 1024) })}\n`;
    const r = run(`${big}${rpc(2, 'ping')}`);
    assert.equal(r.out.length, 2);
    assert.equal(r.out[0].error.code, -32700);
    assert.equal(r.out[0].id, null);
    assert.deepEqual(r.out[1], { jsonrpc: '2.0', id: 2, result: {} });
  });

  test('only protocol lines on stdout, stderr silent, exit 0 at end of input', () => {
    const r = run(`${rpc(1, 'ping')}garbage\n${call(2)}`);
    assert.equal(r.err, '');
    assert.equal(r.code, 0);
    for (const l of r.raw.split('\n').filter(Boolean)) assert.equal(JSON.parse(l).jsonrpc, '2.0');
  });
});

describe('lead_new_session refusals', () => {
  const refused = (r, msg) => {
    assert.equal(r.out[0].result.isError, true);
    assert.equal(text(r.out[0]), `refused: ${msg}`);
  };

  test('no run', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-mcp-'));
    tmps.push(root);
    refused(run(call(1), root), 'no run');
  });

  test('step running', () => {
    const fx = fixture({ running: true, handover: 'manual' });
    refused(run(call(1), fx.root), 'step running');
  });

  test('no handover record, and a newest handover that is not context', () => {
    refused(run(call(1), fixture().root), 'no context handover');
    refused(run(call(1), fixture({ handover: 'manual' }).root), 'no context handover');
  });

  test('broken record', () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.dir, 'lead-handover.jsonl'), 'not json\n');
    refused(run(call(1), fx.root), 'broken record');
  });

  test('an empty arguments object is accepted', () => {
    const r = run(call(1, {}), fixture().root);
    assert.equal(r.out[0].result.isError, true);
  });
});

describe('lead_new_session success', () => {
  // The `context` trigger is validated by the lead-handover.mjs change of T3; skip until that export exists.
  const landed = typeof lead.contextHandover === 'function';

  test('returns the two-line text with the fixed command, the same on every call', { skip: !landed && 'lead-handover.mjs has no context trigger yet' }, () => {
    const fx = fixture({ handover: 'context' });
    const before = fs.readdirSync(fx.dir).sort();
    const r = run(call(1) + call(2), fx.root);
    const want = `Open a new terminal in the product folder and run:\nclaude "aico lead hand-over: run lead-handover read '${fx.slug}' first, then follow skills/pipeline/references/lead-handover.md."`;
    assert.equal(r.out[0].result.isError, undefined);
    assert.equal(text(r.out[0]), want);
    assert.equal(text(r.out[1]), want);
    assert.equal(text(r.out[0]).split('\n').length, 2);
    assert.equal(r.out[0].result.content.length, 1);
    assert.deepEqual(fs.readdirSync(fx.dir).sort(), before);
  });
});

describe('only points', () => {
  test('the server source starts no process and opens no network', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    assert.doesNotMatch(src, /child_process|node:net|node:http|node:dgram|fetch\(|\bspawn|\bexec(Sync|File)?\(/);
  });

  test('.mcp.json registers the server as the contract says', () => {
    const j = JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8'));
    assert.deepEqual(j, { mcpServers: { 'lead-session': { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/lead-session-mcp.mjs'] } } });
  });
});
