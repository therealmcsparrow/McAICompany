// Maps a raw Claude Code command-hook payload to the normalized event a rule sees.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeviceName, normalizePath } from './paths.mjs';

export const MAX_INPUT = 4 * 1024 * 1024;
export const EVENTS = Object.freeze(['SessionStart', 'PreToolUse', 'SubagentStart', 'SubagentStop']);

const AGENT_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ROLE_RE = /^aico:([a-z][a-z0-9-]{0,40})$/;
const OUTPUT_RE = /^Output: \.company\/work\/([^/]{1,120})\/(\d{2,3})-([a-z][a-z0-9-]{0,40})\.md$/;
const TAIL_BYTES = 1024 * 1024;
const MAX_PATH = 4096;
const MAX_PATHS = 80;
const MAX_SHELL_PATHS = 64;
const MAX_MODEL = 64;
const PROMPT_BYTES = 64 * 1024;
// Below the lowest freeze point no run is looked up. A plugin root without the cap rule never looks one up.
const FAST_FLOOR = await import('../rules/cap.mjs').then((m) => m.freezeAt(m.MIN_THRESHOLD), () => Infinity);
const SHELL = new Set(['Bash', 'PowerShell']);
const FILE_FIELDS = ['file_path', 'notebook_path', 'path'];

export const hash12 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const own = (o, k) => o !== null && typeof o === 'object' && Object.hasOwn(o, k);
const str = (o, k) => (own(o, k) && typeof o[k] === 'string' ? o[k] : null);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function parseInput(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_INPUT) return null;
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  return isObj(o) ? o : null;
}

const typeOk = (v, word) => (word === 'object' ? isObj(v) : word === 'number' ? typeof v === 'number' : typeof v === word);

export function driftOf(raw, schema, name) {
  const row = schema && isObj(schema.events) && isObj(schema.events[name]) ? schema.events[name] : schema && isObj(schema[name]) ? schema[name].required : null;
  if (!isObj(row)) return [];
  const out = [];
  for (const [field, word] of Object.entries(row)) if (!own(raw, field) || !typeOk(raw[field], word)) out.push(`${name}.${field}`);
  return out;
}

export function realOf(p, cwd) {
  if (typeof p !== 'string' || p.length === 0 || p.length > MAX_PATH || p.includes('\u0000')) return null;
  let cur;
  try { cur = path.resolve(cwd || process.cwd(), p); } catch { return null; }
  const rest = [];
  for (;;) {
    try {
      const r = fs.realpathSync.native(cur);
      return rest.length > 0 ? path.join(r, ...rest.reverse()) : r;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return null;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

export const fold = (p) => { const s = p.replaceAll('\\', '/'); return process.platform === 'win32' ? s.toLowerCase() : s; };

function homeOf(env) { return env.USERPROFILE || env.HOME || os.homedir(); }

// Leading home or aico variable of a raw path replaced by the host's own value.
export function expandLeading(raw, ctx) {
  const env = ctx.env;
  const home = homeOf(env);
  const drive = env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : home;
  const forms = [
    [/^~(?=$|[\\/])/, home],
    [/^\$\{HOME\}(?=$|[\\/])/i, home], [/^\$HOME(?=$|[\\/])/i, home],
    [/^\$env:(?:HOME|USERPROFILE)(?=$|[\\/])/i, home], [/^%USERPROFILE%(?=$|[\\/])/i, home],
    [/^%HOMEDRIVE%%HOMEPATH%(?=$|[\\/])/i, drive],
    [/^(?:\$\{MCSPARROW_HOME\}|\$MCSPARROW_HOME|\$env:MCSPARROW_HOME|%MCSPARROW_HOME%)(?=$|[\\/])/i, ctx.mcsHome],
    [/^(?:\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT|\$env:CLAUDE_PLUGIN_ROOT|%CLAUDE_PLUGIN_ROOT%)(?=$|[\\/])/i, ctx.pluginRoot]
  ];
  for (const [re, value] of forms) if (re.test(raw)) return typeof value === 'string' && value ? raw.replace(re, value) : null;
  return null;
}

function pathEntry(raw, ctx, cwd) {
  const expanded = expandLeading(raw, ctx);
  const real = realOf(expanded ?? raw, cwd);
  let exists = false;
  let dir = false;
  try {
    const st = fs.statSync(path.resolve(cwd || process.cwd(), expanded ?? raw));
    exists = true;
    dir = st.isDirectory();
  } catch { /* absent */ }
  return { raw, expanded, real, exists, dir };
}

const pathLike = (t) => /[\\/]/.test(t) || /^[~$%.]/.test(t) || /\.[A-Za-z0-9]{1,8}$/.test(t);

function shellTokens(command) {
  const out = [];
  for (const t of command.split(/[\s;|&<>()"'`,=]+/)) {
    if (t.length === 0 || t.length > MAX_PATH || !pathLike(t)) continue;
    out.push(t);
    if (out.length >= MAX_SHELL_PATHS) break;
  }
  return out;
}

function toolOf(name, input, ctx, cwd) {
  const raws = [];
  for (const f of FILE_FIELDS) { const v = str(input, f); if (v) raws.push(v); }
  if (name === 'Glob') { const v = str(input, 'pattern'); if (v) raws.push(v); }
  const command = SHELL.has(name) ? str(input, 'command') : null;
  if (command) raws.push(...shellTokens(command));
  const paths = [...new Set(raws)].filter((r) => r.length <= MAX_PATH).slice(0, MAX_PATHS).map((r) => pathEntry(r, ctx, cwd));
  let model = null;
  let subagentType = null;
  let outputRole = null;
  if (name === 'Agent' || name === 'Task') {
    model = str(input, 'model');
    const st = str(input, 'subagent_type');
    const m = st ? ROLE_RE.exec(st) : null;
    subagentType = m ? m[1] : null;
    const prompt = str(input, 'prompt');
    if (prompt) {
      for (const line of prompt.slice(0, PROMPT_BYTES).split('\n')) {
        if (line.length > 300) continue;
        const o = OUTPUT_RE.exec(line.replace(/\r$/, ''));
        if (o) { outputRole = o[3]; break; }
      }
    }
  }
  return { name, command, paths, model, subagentType, outputRole };
}

const usageTotal = (u) => {
  if (!isObj(u)) return null;
  const n = (k, req) => {
    if (!own(u, k)) return req ? null : 0;
    return Number.isSafeInteger(u[k]) && u[k] >= 0 ? u[k] : null;
  };
  const parts = [n('input_tokens', true), n('output_tokens', true), n('cache_creation_input_tokens', false), n('cache_read_input_tokens', false)];
  return parts.some((x) => x === null) ? null : parts.reduce((a, b) => a + b, 0);
};

// Token count of the last assistant row of the right chain; the file is read from its last MiB (a lower bound).
export function readUsage(file, sidechain) {
  const none = { state: 'none', total: 0, model: null };
  const bad = { state: 'error', total: null, model: null };
  if (typeof file !== 'string' || file.length === 0) return none;
  if (file.length > MAX_PATH) return bad;
  const n = normalizePath(file);
  if (n.startsWith('//') || n.split('/').some((s) => s !== '' && isDeviceName(s))) return bad;
  let fd = null;
  try {
    let st;
    try { st = fs.statSync(file); } catch (e) { return e.code === 'ENOENT' || e.code === 'ENOTDIR' ? none : bad; }
    if (!st.isFile()) return bad;
    fd = fs.openSync(file, 'r');
    const start = Math.max(0, st.size - TAIL_BYTES);
    const buf = Buffer.alloc(st.size - start);
    let got = 0;
    while (got < buf.length) {
      const r = fs.readSync(fd, buf, got, buf.length - got, start + got);
      if (r === 0) break;
      got += r;
    }
    const lines = buf.subarray(0, got).toString('utf8').split('\n');
    if (start > 0) lines.shift();
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].length === 0) continue;
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      if (!isObj(o) || o.type !== 'assistant' || (o.isSidechain === true) !== sidechain || !isObj(o.message)) continue;
      if (!own(o.message, 'usage')) continue;
      const total = usageTotal(o.message.usage);
      if (total === null) return bad;
      const model = typeof o.message.model === 'string' && o.message.model.length > 0 && o.message.model.length <= MAX_MODEL ? o.message.model : null;
      return { state: 'read', total, model };
    }
    return none;
  } catch { return bad; } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* closed */ } }
}

// False when the main transcript exists but is not a regular file (a Step reads its own file beside it).
function mainReadable(file) {
  if (file.length > MAX_PATH) return false;
  try { return fs.statSync(file).isFile(); } catch (e) { return e.code === 'ENOENT' || e.code === 'ENOTDIR'; }
}

export function projectRoot(cwd) {
  const start = realOf(cwd || '.', process.cwd());
  if (!start) return null;
  for (let cur = start; ; cur = path.dirname(cur)) {
    try { if (fs.statSync(path.join(cur, '.company')).isDirectory()) return cur; } catch { /* keep climbing */ }
    if (path.dirname(cur) === cur) return start;
  }
}

export function protectedPaths(ctx, root) {
  const home = homeOf(ctx.env);
  const list = [ctx.pluginRoot, path.join(ctx.mcsHome, 'config.json'), path.join(ctx.mcsHome, 'hook-snapshots'),
    path.join(home, '.claude', 'settings.json'), path.join(home, '.claude', 'settings.local.json')];
  if (root) list.push(path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.local.json'), path.join(root, '.company', 'settings.json'));
  const out = new Set();
  for (const p of list) { const r = realOf(p, root || process.cwd()); if (r) out.add(fold(r)); }
  return [...out];
}

const envStr = (env, k) => (typeof env[k] === 'string' && env[k].length <= MAX_MODEL ? env[k] : null);

function deepFreeze(o) {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

// ctx: { env, schema, pluginRoot, mcsHome, resolveRun(event, root) (may be async) }. Returns { ok: true, event } or { ok: false, why }.
export async function normalize(raw, ctx) {
  if (!isObj(raw)) return { ok: false, why: 'not an object' };
  const name = str(raw, 'hook_event_name');
  if (!EVENTS.includes(name)) return { ok: false, why: 'unknown event' };
  let agentKey = null;
  const hasAgent = own(raw, 'agent_id');
  if (hasAgent) {
    if (typeof raw.agent_id !== 'string' || !AGENT_RE.test(raw.agent_id)) return { ok: false, why: 'bad agent id' };
    agentKey = hash12(raw.agent_id);
  }
  const session = name === 'SubagentStop' || (name === 'PreToolUse' && hasAgent) ? 'step' : 'lead';
  const sessionKey = hash12(str(raw, 'session_id') ?? '');
  const cwd = str(raw, 'cwd') ?? process.cwd();
  const drift = driftOf(raw, ctx.schema, name);
  const toolName = name === 'PreToolUse' ? str(raw, 'tool_name') : null;
  const input = own(raw, 'tool_input') && isObj(raw.tool_input) ? raw.tool_input : {};
  const tool = toolName ? toolOf(toolName, input, ctx, cwd) : null;

  let usage = { state: 'none', total: 0, model: null };
  if (name === 'PreToolUse' || name === 'SubagentStop') {
    const tp = str(raw, 'transcript_path');
    if (session === 'lead') usage = readUsage(tp, false);
    else if (name === 'SubagentStop') usage = readUsage(str(raw, 'agent_transcript_path'), true);
    else if (tp && tp.endsWith('.jsonl') && !mainReadable(tp)) usage = { state: 'error', total: null, model: null };
    else if (tp && tp.endsWith('.jsonl')) usage = readUsage(path.join(tp.slice(0, -'.jsonl'.length), 'subagents', `agent-${raw.agent_id}.jsonl`), true);
  }
  const mainModel = session === 'lead' && tool && (tool.name === 'Agent' || tool.name === 'Task') ? usage.model : null;
  const root = projectRoot(cwd);
  const event = {
    v: 1, event: name, session, sessionKey, agentKey, agentType: hasAgent ? str(raw, 'agent_type') : null,
    tool,
    tokens: { state: usage.state, total: usage.total },
    mainModel,
    env: {
      guardsOff: ctx.env.AICO_GUARDS === 'off',
      subagentModel: envStr(ctx.env, 'CLAUDE_CODE_SUBAGENT_MODEL'),
      subagentModelForce: envStr(ctx.env, 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE')
    },
    protected: protectedPaths(ctx, root),
    run: null,
    drift,
    stopHookActive: name === 'SubagentStop' && typeof raw.stop_hook_active === 'boolean' ? raw.stop_hook_active : null
  };
  if ((usage.state === 'read' && usage.total >= FAST_FLOOR) || usage.state === 'error') {
    try { event.run = (ctx.resolveRun ? await ctx.resolveRun(event, root) : null) ?? null; } catch { event.run = null; }
  }
  return { ok: true, event: deepFreeze(event), cwd, root };
}
