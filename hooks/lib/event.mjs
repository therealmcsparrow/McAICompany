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
const MAX_RUNS = 500;
const GUARD_SHAPE = /\/\.company\/work\/(?:[^/]+\/)+(?:(?:guard|forms|run-state)\.jsonl|lead-result\.txt)$/;
const LEAD_TYPE = 'aico:project-manager';
const PROMPT_BYTES = 64 * 1024;
// Below the lowest freeze point no run is looked up. A plugin root without the cap rule never looks one up.
const FAST_FLOOR = await import('../rules/cap.mjs').then((m) => m.freezeAt(m.MIN_THRESHOLD), () => Infinity);
const SHELL = new Set(['Bash', 'PowerShell']);
const BG_TOOLS = new Set(['Bash', 'PowerShell', 'Agent', 'Task']);
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

function pathEntry(raw, ctx, cwd, alts = []) {
  const expanded = expandLeading(raw, ctx);
  const real = realOf(expanded ?? raw, cwd);
  let exists = false;
  let dir = false;
  try {
    const st = fs.statSync(path.resolve(cwd || process.cwd(), expanded ?? raw));
    exists = true;
    dir = st.isDirectory();
  } catch { /* absent */ }
  if (!dir) for (const c of alts) if (isDirIn(expanded ?? raw, c)) { exists = true; dir = true; break; }
  return { raw, expanded, real, exists, dir };
}

// True when s holds a run of more than MAX_PATH consecutive non-whitespace characters (whitespace as in the regex \s class).
export function hasLongWord(s) {
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const space = c === 32 || (c >= 9 && c <= 13) || (c > 127 && (c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279));
    if (space) run = 0;
    else if (++run > MAX_PATH) return true;
  }
  return false;
}

const pathLike = (t) => /[\\/]/.test(t) || /^[~$%.]/.test(t) || /\.[A-Za-z0-9]{1,8}$/.test(t);

const isDirIn = (t, cwd) => {
  try { return fs.statSync(path.resolve(cwd || process.cwd(), t)).isDirectory(); } catch { return false; }
};

const CD_WORDS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location']);
const MAX_CWDS = 8;

// Path-like tokens, plus bare tokens (and the rest of a `:/x` pathspec) that name a directory under cwd
// or under a `git -C` / `cd` target. `limited` is true when probes ran out or a target could not be read.
function shellTokens(command, cwd) {
  const out = [];
  const cwds = [cwd];
  const state = { probes: 0, limited: false };
  const probe = (t) => {
    if (state.probes >= MAX_SHELL_PATHS) { state.limited = true; return false; }
    state.probes++;
    return cwds.some((c) => isDirIn(t, c));
  };
  const follow = (t) => {
    const next = [];
    for (const c of cwds) {
      if (state.probes >= MAX_SHELL_PATHS) { state.limited = true; break; }
      state.probes++;
      if (isDirIn(t, c)) next.push(path.resolve(c || process.cwd(), t));
    }
    if (next.length === 0) { state.limited = true; return; }
    for (const n of next) if (cwds.length < MAX_CWDS && !cwds.includes(n)) cwds.push(n);
  };
  if (command.length > MAX_PATH && hasLongWord(command)) state.limited = true;
  let want = null;
  for (const t of command.split(/[\s;|&<>()"'`,=]+/)) {
    if (t.length === 0) continue;
    if (t.length > MAX_PATH) { state.limited = true; continue; }
    const pending = want;
    want = null;
    if (pending) {
      if (pending === 'cd' && t.startsWith('-') && t !== '-') { want = 'cd'; continue; }
      follow(t);
      if (pathLike(t)) out.push(t);
      continue;
    }
    if (t === '-C') { want = 'C'; continue; }
    if (CD_WORDS.has(t.toLowerCase())) { want = 'cd'; continue; }
    if (pathLike(t)) {
      out.push(t);
      if (t.startsWith(':/') && t.length > 2 && probe(t.slice(2))) out.push(t.slice(2));
    } else if (!t.startsWith('-') && probe(t)) {
      out.push(t);
    }
    if (out.length >= MAX_SHELL_PATHS) { state.limited = true; break; }
  }
  return { tokens: out, cwds, limited: state.limited };
}

function toolOf(name, input, ctx, cwd) {
  const raws = [];
  for (const f of FILE_FIELDS) { const v = str(input, f); if (v) raws.push(v); }
  if (name === 'Glob') { const v = str(input, 'pattern'); if (v) raws.push(v); }
  const command = SHELL.has(name) ? str(input, 'command') : null;
  let alts = [];
  let probeLimited = false;
  if (command) { const st = shellTokens(command, cwd); raws.push(...st.tokens); alts = st.cwds; probeLimited = st.limited; }
  if (name === 'Grep') { const v = str(input, 'glob'); if (v) raws.push(v); }
  const paths = [...new Set(raws)].filter((r) => r.length <= MAX_PATH).slice(0, MAX_PATHS - 1).map((r) => pathEntry(r, ctx, cwd, alts));
  if (probeLimited) paths.push({ raw: '', expanded: null, real: null, exists: false, dir: true, cwds: alts });
  let model = null;
  let subagentType = null;
  let outputRole = null;
  // Unicode whitespace is stripped so a padded name cannot slip past the Lead match.
  const stRaw = (name === 'Agent' || name === 'Task') ? str(input, 'subagent_type') : null;
  const st = typeof stRaw === 'string' ? stRaw.replace(/^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/g, '') : null;
  if (name === 'Agent' || name === 'Task') {
    model = str(input, 'model');
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
  const leadTarget = (name === 'Agent' || name === 'Task') && /(^|:)project-manager$/.test((st ?? '').toLowerCase());
  const background = BG_TOOLS.has(name) && own(input, 'run_in_background') && input.run_in_background === true;
  return { name, command, paths, model, subagentType, outputRole, background, leadTarget };
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

const readSmall = (file) => {
  try {
    const l = fs.lstatSync(file);
    if (l.isSymbolicLink() || !l.isFile() || l.size > 4096) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
};

// The main tree of a linked git worktree, from the nearest `.git` pointer file above cwd; null when the
// pointer is absent or is not confirmed from both sides (back link, common dir, a .company/work folder).
export function worktreeMain(cwd) {
  const start = realOf(cwd || '.', process.cwd());
  if (!start) return null;
  for (let cur = start; ; cur = path.dirname(cur)) {
    const g = path.join(cur, '.git');
    let l = null;
    try { l = fs.lstatSync(g); } catch { /* none here */ }
    if (l && l.isDirectory()) return null;
    if (l && l.isFile()) {
      const text = readSmall(g);
      const m = text === null ? null : /^gitdir: (.+?)\r?\n?$/.exec(text);
      if (!m) return null;
      const gitdir = path.resolve(cur, m[1]);
      const wt = path.dirname(gitdir);
      if (path.basename(wt) !== 'worktrees' || path.basename(path.dirname(wt)) !== '.git') return null;
      const main = path.dirname(path.dirname(wt));
      const back = readSmall(path.join(gitdir, 'gitdir'));
      const common = readSmall(path.join(gitdir, 'commondir'));
      if (back === null || common === null) return null;
      if (realOf(path.resolve(gitdir, back.trim())) !== realOf(g)) return null;
      if (realOf(path.resolve(gitdir, common.trim())) !== realOf(path.join(main, '.git'))) return null;
      return main;
    }
    if (path.dirname(cur) === cur) return null;
  }
}

export function protectedPaths(ctx, root, main = null) {
  const home = homeOf(ctx.env);
  const list = [ctx.pluginRoot, path.join(ctx.mcsHome, 'config.json'), path.join(ctx.mcsHome, 'hook-snapshots'),
    path.join(home, '.claude', 'settings.json'), path.join(home, '.claude', 'settings.local.json')];
  for (const r of [root, main]) {
    if (!r) continue;
    list.push(path.join(r, '.claude', 'settings.json'), path.join(r, '.claude', 'settings.local.json'), path.join(r, '.company', 'settings.json'));
    const work = path.join(r, '.company', 'work');
    const queue = [work];
    for (let seen = 0; queue.length > 0 && seen < MAX_RUNS; seen++) {
      const dir = queue.shift();
      for (const n of ['guard.jsonl', 'forms.jsonl', 'run-state.jsonl', 'lead-result.txt']) list.push(path.join(dir, n));
      let kids = [];
      try { kids = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* unreadable or absent */ }
      for (const d of kids) if (d.isDirectory()) queue.push(path.join(dir, d.name));
    }
  }
  const out = new Set();
  for (const p of list) { const r = realOf(p, root || process.cwd()); if (r) out.add(fold(r)); }
  return [...out];
}

const envStr = (env, k) => (typeof env[k] === 'string' && env[k].length <= MAX_MODEL ? env[k] : null);

function deepFreeze(o) {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

// ctx: { env, schema, pluginRoot, mcsHome, resolveRun(event, root) (may be async), memo? (Map, optional cwd cache) }. Returns { ok: true, event } or { ok: false, why }.
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
  const isLeadAgent = hasAgent && raw.agent_type === LEAD_TYPE;
  const session = name === 'SubagentStop' || (name === 'PreToolUse' && hasAgent) ? (isLeadAgent ? 'lead' : 'step') : 'lead';
  const fromAgentFile = session === 'step' || isLeadAgent;
  const sessionKey = hash12(str(raw, 'session_id') ?? '');
  const cwd = str(raw, 'cwd') ?? process.cwd();
  const drift = driftOf(raw, ctx.schema, name);
  const toolName = name === 'PreToolUse' ? str(raw, 'tool_name') : null;
  const input = own(raw, 'tool_input') && isObj(raw.tool_input) ? raw.tool_input : {};
  const tool = toolName ? toolOf(toolName, input, ctx, cwd) : null;

  let usage = { state: 'none', total: 0, model: null };
  if (name === 'PreToolUse' || name === 'SubagentStop') {
    const tp = str(raw, 'transcript_path');
    if (!fromAgentFile) usage = readUsage(tp, false);
    else if (name === 'SubagentStop') usage = readUsage(str(raw, 'agent_transcript_path'), true);
    else if (tp && tp.endsWith('.jsonl') && !mainReadable(tp)) usage = { state: 'error', total: null, model: null };
    else if (tp && tp.endsWith('.jsonl')) usage = readUsage(path.join(tp.slice(0, -'.jsonl'.length), 'subagents', `agent-${raw.agent_id}.jsonl`), true);
  }
  const mainModel = session === 'lead' && tool && (tool.name === 'Agent' || tool.name === 'Task') ? usage.model : null;
  // A caller-owned Map keeps the per-cwd lookups for one replay; without it every call reads the disk.
  const memo = ctx.memo instanceof Map ? ctx.memo : null;
  let hit = memo ? memo.get(cwd) : undefined;
  if (!hit) {
    const r = projectRoot(cwd);
    hit = { root: r, base: protectedPaths(ctx, r, worktreeMain(cwd)) };
    if (memo) memo.set(cwd, hit);
  }
  const root = hit.root;
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
    protected: [...hit.base],
    run: null,
    drift,
    stopHookActive: name === 'SubagentStop' && typeof raw.stop_hook_active === 'boolean' ? raw.stop_hook_active : null
  };
  const leadSpawn = session === 'lead' && name === 'PreToolUse' && tool !== null && (tool.name === 'Agent' || tool.name === 'Task');
  if ((usage.state === 'read' && usage.total >= FAST_FLOOR) || usage.state === 'error' || leadSpawn) {
    try { event.run = (ctx.resolveRun ? await ctx.resolveRun(event, root) : null) ?? null; } catch { event.run = { error: true }; }
  }
  for (const e of tool ? tool.paths : []) {
    if (typeof e.real === 'string' && GUARD_SHAPE.test(fold(e.real)) && !event.protected.includes(fold(e.real))) event.protected.push(fold(e.real));
  }
  if (event.run && typeof event.run.folder === 'string') {
    for (const n of ['guard.jsonl', 'forms.jsonl', 'run-state.jsonl', 'lead-result.txt']) {
      const g = realOf(path.join(event.run.folder, n), root || process.cwd());
      if (g && !event.protected.includes(fold(g))) event.protected.push(fold(g));
    }
  }
  for (const e of tool ? tool.paths : []) {
    if (e.raw !== '' || !Array.isArray(e.cwds)) continue;
    const hot = (list) => e.cwds.some((c) => {
      const r = typeof c === 'string' ? realOf(c, root || process.cwd()) : null;
      const f = r ? fold(r) : null;
      return f !== null && list.some((p) => f === p || f.startsWith(`${p}/`));
    });
    e.cwdHot = hot(event.protected);
    e.cwdRec = hot(event.protected.filter((p) => GUARD_SHAPE.test(p)));
    delete e.cwds;
  }
  return { ok: true, event: deepFreeze(event), cwd, root };
}
