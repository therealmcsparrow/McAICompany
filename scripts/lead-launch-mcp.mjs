#!/usr/bin/env node
// lead-session-mcp v2.0 (scripts/lead-launch-mcp.mjs): MCP over stdio, one tool, `lead_new_session`. It arms lead-replace.json in the
// run folder and starts one helper (scripts/lead-replace.mjs) that types the new Lead into this terminal. Node built-ins only; no network.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findRun, newSessionCommand, main as handover, readSmall } from './lead-handover.mjs';
import { isRunSlug, workParts, exactWorkPath } from '../mods/lib/work-folder.mjs';
import { typer } from './lib/lead-typer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_LINE = 64 * 1024;
const MAX_RECORD = 512 * 1024;
const DEFAULT_PROTOCOL = '2025-06-18';
const TOOL = 'lead_new_session';
const DESCRIPTION = 'Starts the new Lead in this terminal after a context hand-over: waits for background tasks and the end of this turn, then types /clear and the hand-over prompt.';
const HELPER = path.join(HERE, 'lead-replace.mjs');
const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;

function pluginVersion() {
  try { return String(JSON.parse(fs.readFileSync(path.join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version); } catch { return '0.0.0'; }
}

const refusal = (text) => ({ content: [{ type: 'text', text: `refused: ${text}` }], isError: true });

// The newest `handover` event of the record, read only after `read` accepted the record. Null when none or unreadable.
function newestHandover(root, slug) {
  const text = readSmall(path.join(root, '.company', 'work', ...workParts(slug), 'lead-handover.jsonl'), MAX_RECORD);
  if (text === null) return null;
  let last = null;
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    try { const o = JSON.parse(line); if (o && o.ev === 'handover') last = o; } catch { return null; }
  }
  return last;
}

// The one process this server starts: the replace helper, run by this node, no shell, outliving the call, not waited for.
function startHelper(argv, root) {
  const child = spawn(process.execPath, argv, { cwd: root, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

// Session named by the arm file already there, or null when it is unreadable or not an arm.
function armedSession(file) {
  const text = readSmall(file, 64 * 1024);
  if (text === null) return null;
  try { const o = JSON.parse(text); return o && typeof o.session === 'string' ? o.session : null; } catch { return null; }
}

// An arm of an earlier session is replaced by temp file and rename.
function replaceArm(file, arm) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(arm)}\n`);
  try { fs.renameSync(tmp, file); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}

export function newSession(root = process.cwd(), now = Date.now(), deps = {}) {
  let armed = null;
  try {
    const slug = findRun(root, now);
    if (!slug) return refusal('no run');
    if (!isRunSlug(slug)) return refusal('bad slug');
    const r = handover(['read', slug], root, {});
    if (r.code !== 0) return refusal('broken record');
    if (/^running: step$/m.test(r.out)) return refusal('step running');
    const last = newestHandover(root, slug);
    if (!last || last.trigger !== 'context') return refusal('no context handover');
    const command = newSessionCommand(slug);
    if (command === null) return refusal('bad slug');
    if (typer(process.platform) === null) return refusal('unsupported terminal');
    if (typeof last.session !== 'string' || !SESSION_RE.test(last.session)) return refusal('error');
    const ppid = String(process.ppid);
    if (!/^[1-9][0-9]*$/.test(ppid)) return refusal('error');
    const parts = workParts(slug);
    exactWorkPath({ fs, path }, root, parts);
    const file = path.join(root, '.company', 'work', ...parts, 'lead-replace.json');
    const arm = { v: 1, session: last.session, armAt: new Date(now).toISOString(), state: 'waiting-background' };
    let fresh = true;
    try {
      fs.writeFileSync(file, `${JSON.stringify(arm)}\n`, { flag: 'wx' });
      armed = file;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      if (armedSession(file) === last.session) fresh = false; else { replaceArm(file, arm); armed = file; }
    }
    if (fresh) (deps.start ?? ((argv) => startHelper(argv, root)))([HELPER, slug, ppid]);
    armed = null;
    return { content: [{ type: 'text', text: `The new Lead starts in this terminal once every background task has ended and this turn is over.\nIf it has not started, run in the product folder:\n${command}` }] };
  } catch {
    if (armed) { try { fs.rmSync(armed, { force: true }); } catch { /* best effort */ } }
    return refusal('error');
  }
}

const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// One protocol line in, the answer object out (null for a notification).
export function handle(line, root = process.cwd(), now = Date.now()) {
  let msg;
  try { msg = JSON.parse(line); } catch { return err(null, -32700, 'parse error'); }
  if (!isPlain(msg)) return err(null, -32600, 'invalid request');
  const hasId = Object.hasOwn(msg, 'id');
  if (!hasId) return null;
  const id = msg.id;
  if (typeof id !== 'string' && typeof id !== 'number') return err(null, -32600, 'invalid request');
  if (typeof msg.method !== 'string') return err(id, -32600, 'invalid request');
  const params = msg.params;
  const paramsOk = params === undefined || isPlain(params);
  switch (msg.method) {
    case 'initialize': {
      if (!paramsOk) return err(id, -32602, 'invalid params');
      const v = params?.protocolVersion;
      const protocolVersion = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : DEFAULT_PROTOCOL;
      return ok(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'lead-session', version: pluginVersion() } });
    }
    case 'ping':
      if (!paramsOk) return err(id, -32602, 'invalid params');
      return ok(id, {});
    case 'tools/list':
      if (!paramsOk) return err(id, -32602, 'invalid params');
      return ok(id, { tools: [{ name: TOOL, description: DESCRIPTION, inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] });
    case 'tools/call': {
      if (!isPlain(params) || typeof params.name !== 'string' || params.name !== TOOL) return err(id, -32602, 'invalid params');
      const a = params.arguments;
      if (a !== undefined && !(isPlain(a) && Object.keys(a).length === 0)) return err(id, -32602, 'invalid params');
      return ok(id, newSession(root, now));
    }
    default: return err(id, -32601, 'method not found');
  }
}

function serve(root) {
  let chunks = [];
  let size = 0;
  let dropping = false;
  const send = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  const line = (buf) => {
    const text = buf.toString('utf8');
    if (text.trim().length === 0) return;
    const a = handle(text, root);
    if (a) send(a);
  };
  process.stdin.on('data', (data) => {
    let start = 0;
    for (;;) {
      const nl = data.indexOf(0x0a, start);
      const end = nl === -1 ? data.length : nl;
      if (!dropping) {
        size += end - start;
        if (size > MAX_LINE) { dropping = true; chunks = []; size = 0; } else chunks.push(data.subarray(start, end));
      }
      if (nl === -1) break;
      if (dropping) { send(err(null, -32700, 'line too long')); dropping = false; }
      else { const buf = Buffer.concat(chunks); chunks = []; size = 0; line(buf); }
      start = nl + 1;
    }
  });
  process.stdin.on('end', () => { process.exitCode = 0; });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve(process.cwd());
