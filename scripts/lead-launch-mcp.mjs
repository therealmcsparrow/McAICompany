#!/usr/bin/env node
// lead-session-mcp v1 (scripts/lead-launch-mcp.mjs): MCP over stdio, one tool, `lead_new_session`. It only points: it returns the command
// for a new Lead session and starts nothing. Node built-ins only; no process start, no network, no write.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findRun, newSessionCommand, main as handover, readSmall } from './lead-handover.mjs';
import { isWorkFolder } from '../mods/lib/work-folder.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_LINE = 64 * 1024;
const MAX_RECORD = 512 * 1024;
const DEFAULT_PROTOCOL = '2025-06-18';
const TOOL = 'lead_new_session';
const DESCRIPTION = 'Returns the command that starts a new Lead session after a context hand-over. Starts nothing.';

function pluginVersion() {
  try { return String(JSON.parse(fs.readFileSync(path.join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version); } catch { return '0.0.0'; }
}

const refusal = (text) => ({ content: [{ type: 'text', text: `refused: ${text}` }], isError: true });

// The newest `handover` event of the record, read only after `read` accepted the record. Null when none or unreadable.
function newestHandover(root, slug) {
  const text = readSmall(path.join(root, '.company', 'work', slug, 'lead-handover.jsonl'), MAX_RECORD);
  if (text === null) return null;
  let last = null;
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    try { const o = JSON.parse(line); if (o && o.ev === 'handover') last = o; } catch { return null; }
  }
  return last;
}

export function newSession(root = process.cwd(), now = Date.now()) {
  try {
    const slug = findRun(root, now);
    if (!slug) return refusal('no run');
    if (!isWorkFolder(slug)) return refusal('bad slug');
    const r = handover(['read', slug], root, {});
    if (r.code !== 0) return refusal('broken record');
    if (/^running: step$/m.test(r.out)) return refusal('step running');
    const last = newestHandover(root, slug);
    if (!last || last.trigger !== 'context') return refusal('no context handover');
    const command = newSessionCommand(slug);
    if (command === null) return refusal('bad slug');
    return { content: [{ type: 'text', text: `Open a new terminal in the product folder and run:\n${command}` }] };
  } catch {
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
