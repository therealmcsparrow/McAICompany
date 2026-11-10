#!/usr/bin/env node
// Checker for the reprompt Playbook (reprompt v2.6). Three subcommands, run from the product root:
//   snap <name> [walk-less|raise|both]          records the run and a baseline of the watched files before a dispatch
//   arm <name> <NN>                  marks dispatch NN as seen by the write gate (run by the gate only)
//   reply <name> <NN> <hex> <asks>   compares the tree to the baseline and checks the reply against an allow-list
// A run is a reprompt run only when `snap` recorded it in the user's own folder (never in the repo), so no folder
// name, and nothing a Role writes in the repo, makes a run one; `arm` and `reply` refuse a run without the record.
// The reply is written by an LLM that reads untrusted text: every argument is a fixed-shape token, every read is
// size-capped, every pattern is anchored and linear, and any doubt is a refusal (exit 3) or a malformed reply (exit 1).
// Git config can run programs, so `reply` compares the files git reads before it starts any git command.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lint } from './handoff-lint.mjs';
import { isRunName } from '../mods/lib/reprompt-gate.mjs';
import { exactWorkPath, workParts, isProjectId, WorkFolderRefusal } from '../mods/lib/work-folder.mjs';

const NN_RE = /^\d{2,3}$/;
const HEX_RE = /^[0-9a-f]{64}$/;
const ASKS_RE = /^[0-3]$/;
const LEAD_FILE_RE = /^(request|answers-\d+|edit-\d+)\.md$/;
const RUN_FILE_RE = /^(\.gitignore|\.tree\.json|\.gate-\d{2,3}|prompt\.md|run-state\.jsonl|00-summary\.md|request\.md|answers-\d+\.md|edit-\d+\.md|\d{2,3}-reprompter\.md)$/;
const USAGE = 'bad arguments (snap <slug> [walk-less|raise|both] | arm <slug> <NN> | reply <slug> <NN> <hex> <asks>)';

const KIB = 1024;
const MAX_LEAD_FILE = 33 * KIB;
const MAX_SUMMARY = 16 * KIB;
const MAX_HANDOFF = 64 * KIB;
const MAX_PROMPT = 16 * KIB;
const MAX_OUT = 64 * KIB;
const MAX_BASELINE = 64 * 1024 * KIB;
const MAX_CLAUDE_JSON = 32 * 1024 * KIB;
const GIT_MS = 10000;
const MAX_PATHS = 20;
const MAX_PATH_SHOWN = 200;
const MAX_LINE = 1000;
const TARGETS = new Set(['claude-code', 'ai-chat', 'other-ai', 'unknown']);
const SIX_EN = ['Goal', 'Context', 'Inputs', 'Constraints', 'Output format', 'Done when'];
const MCP_KEYS = ['mcpServers', 'enabledMcpjsonServers', 'disabledMcpjsonServers', 'enableAllProjectMcpServers', 'allowedTools'];

// The base limits and the one fixed ceiling of Raise the limit (reprompt v2.2).
export const LIMITS = Object.freeze({ entries: 50000, gitOut: 8 * 1024 * KIB });
export const CEILING = 2;
const LIMIT_TOKEN_RE = /^(walk-less|raise|both)$/;
const LIMIT_KINDS = ['none', 'walk-less', 'raise', 'both'];

// Over the active bound: an internal signal, not a refusal, so `snap` can pick exit 4 or exit 3.
class OverLimit extends Error {}

class Refused extends Error {
  constructor(reason, paths) { super(reason); this.paths = paths; }
}
const refuse = (reason, paths) => { throw new Refused(reason, paths); };

// ---------- the character rule ----------
const ALLOWED_RE = /^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}\n\t]*$/u;
// Every default-ignorable code point is invisible or renders blank; only the text and emoji selectors stay.
const IGNORABLE_RE = /(?![\u{FE0E}\u{FE0F}])\p{DI}/u;
const DOUBLE_SELECTOR_RE = /[\u{FE0E}\u{FE0F}]{2}/u;

export function charsOk(text) {
  return ALLOWED_RE.test(text) && !IGNORABLE_RE.test(text) && !DOUBLE_SELECTOR_RE.test(text) && !text.includes('<!--');
}

// Strict decode: a byte sequence that is not UTF-8 gives null.
function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf); } catch { return null; }
}

function showPath(s) {
  let out = '';
  for (const ch of s) {
    out += charsOk(ch) && ch !== '\n' && ch !== '\t' ? ch : `<U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}>`;
    if (out.length > MAX_PATH_SHOWN) return `${out.slice(0, MAX_PATH_SHOWN)}...`;
  }
  return out;
}

// ---------- environment ----------
function real(p) {
  try { return realpathSync.native(p); } catch { return resolve(p); }
}

function locations(cwd, env) {
  const root = real(resolve(cwd));
  const home = resolve(env.HOME || env.USERPROFILE || homedir());
  const config = resolve(env.CLAUDE_CONFIG_DIR || join(home, '.claude'));
  const mcsparrow = resolve(env.MCSPARROW_HOME || join(home, '.mcsparrow'));
  const plugin = env.CLAUDE_PLUGIN_ROOT ? resolve(env.CLAUDE_PLUGIN_ROOT) : null;
  const xdg = env.XDG_CONFIG_HOME ? resolve(env.XDG_CONFIG_HOME) : join(home, '.config');
  const gitGlobal = env.GIT_CONFIG_GLOBAL ? resolve(root, env.GIT_CONFIG_GLOBAL) : null;
  return { root, home, config, mcsparrow, plugin, xdg, gitGlobal };
}

function lstatOrNull(p) {
  try { return lstatSync(p); } catch { return null; }
}

function runFolder(loc, slug) {
  const parts = workParts(slug);
  if (parts === null) refuse(USAGE);
  // Exact letter case of `.company`, `work` and the slug first; a missing path keeps the refusals below.
  try {
    exactWorkPath({ fs: { readdirSync }, path: { join } }, loc.root, parts);
  } catch (e) {
    if (e instanceof WorkFolderRefusal) refuse(e.message);
    throw e;
  }
  const dir = join(loc.root, '.company', 'work', ...parts);
  const st = lstatOrNull(dir);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) refuse('run folder missing or not a plain folder');
  let found;
  try { found = realpathSync.native(dir); } catch { refuse('run folder missing or not a plain folder'); }
  if (found !== join(realpathSync.native(loc.root), '.company', 'work', ...parts)) refuse('run folder is reached through a link');
  return dir;
}

// ---------- the run record ----------
const RECORD_DIR = 'reprompt-runs';
const MAX_RECORD = 512;
const foldsCase = process.platform === 'win32' || process.platform === 'darwin';

function recordFile(loc, name) {
  const fold = s => (foldsCase ? s.toLowerCase() : s);
  const id = createHash('sha256').update(`${fold(loc.root)}\0${fold(name)}`).digest('hex');
  return join(loc.mcsparrow, RECORD_DIR, `${id}.json`);
}

const recordText = name => `${JSON.stringify({ v: 1, kind: 'reprompt', name })}\n`;

// `snap` is the only writer. A record already holding the same text is left as it is.
function writeRecord(loc, name) {
  const file = recordFile(loc, name);
  const text = recordText(name);
  const st = lstatOrNull(file);
  if (st && st.isFile() && st.size === Buffer.byteLength(text) && readFileSync(file, 'utf8') === text) return;
  if (st && !st.isFile()) refuse('cannot record the run');
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  } catch { refuse('cannot record the run'); }
}

// The record must be a plain file that holds exactly the text `snap` wrote for this run.
function requireRecord(loc, name) {
  const file = recordFile(loc, name);
  const st = lstatOrNull(file);
  const text = recordText(name);
  if (!st || !st.isFile() || st.size > MAX_RECORD || st.size !== Buffer.byteLength(text)) refuse('not a reprompt run');
  let got;
  try { got = readFileSync(file, 'utf8'); } catch { refuse('not a reprompt run'); }
  if (got !== text) refuse('not a reprompt run');
}

// ---------- the tree manifest ----------
const fingerprint = st => `${st.isSymbolicLink() ? 'l' : st.isDirectory() ? 'd' : st.isFile() ? 'f' : 'o'}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
const key = p => p.split(sep).join('/');

class Manifest {
  constructor(skip, budget) { this.map = new Map(); this.skip = skip; this.budget = budget; }
  set(p, fp) {
    if (p === this.skip) return;
    const k = key(p);
    if (!this.map.has(k) && ++this.budget.n > this.budget.max) throw new OverLimit('tree too large');
    this.map.set(k, fp);
  }
  // Walks one path without following links; a missing path adds nothing.
  walk(start, { skipDirs = [] } = {}) {
    const stack = [start];
    while (stack.length) {
      const p = stack.pop();
      const st = lstatOrNull(p);
      if (!st) continue;
      this.set(p, fingerprint(st));
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      let names;
      try { names = readdirSync(p); } catch { this.set(`${p}${sep}<unreadable>`, 'x'); continue; }
      for (const name of names) {
        if (skipDirs.includes(name)) continue;
        stack.push(join(p, name));
      }
    }
  }
  // One entry for the path itself, without walking below it.
  entry(p) {
    const st = lstatOrNull(p);
    if (st) this.set(p, fingerprint(st));
  }
}

// ---------- git ----------
function git(args, cwd, env, cap) {
  const r = spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
    cwd, env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: cap, timeout: GIT_MS, windowsHide: true, shell: false,
  });
  if (r.error) {
    if (r.error.code === 'ENOENT') return null;
    if (r.error.code === 'ENOBUFS') throw new OverLimit('tree too large');
    refuse('git failed');
  }
  return r;
}

// Top level, git dir and common dir as absolute paths; null when the folder is not in a work tree.
function gitInfo(loc, env) {
  let r = git(['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'], loc.root, env, loc.gitOut);
  if (r && r.status !== 0) r = git(['rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir'], loc.root, env, loc.gitOut);
  if (!r || r.status !== 0) return null;
  const lines = r.stdout.toString('utf8').split('\n').filter(l => l !== '');
  if (lines.length !== 3) return null;
  const [top, gitDir, commonDir] = lines.map(l => resolve(loc.root, l));
  return { top: real(top), gitDir, commonDir };
}

const expandHome = (loc, v) => (v === '~' ? loc.home : /^~[\\/]/.test(v) ? join(loc.home, v.slice(2)) : v);

// The config files git read, every include path (present or not) and the hooks folder, from `git config --list --show-origin -z`.
function configFiles(loc, env) {
  const r = git(['config', '--list', '--show-origin', '-z'], loc.root, env, loc.gitOut);
  if (!r || r.status !== 0) refuse('git failed');
  const parts = r.stdout.toString('utf8').split('\0');
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const origin = parts[i];
    if (!origin.startsWith('file:')) continue;
    const file = resolve(loc.root, origin.slice(5));
    out.push(file);
    const entry = parts[i + 1];
    const nl = entry.indexOf('\n');
    const name = (nl < 0 ? entry : entry.slice(0, nl)).toLowerCase();
    const value = nl < 0 ? '' : entry.slice(nl + 1);
    if (value === '') continue;
    if (/^include(if\..+)?\.path$/.test(name)) out.push(resolve(dirname(file), expandHome(loc, value)));
    else if (name === 'core.hookspath') out.push(resolve(loc.root, expandHome(loc, value)));
  }
  return out;
}

// (a) the control set: every path git reads that can name a program to run, as a sorted list.
function controlPaths(loc, env, info) {
  const set = new Set([join(loc.root, '.git'), join(loc.home, '.gitconfig'), join(loc.xdg, 'git')]);
  if (loc.gitGlobal) set.add(loc.gitGlobal);
  if (info) {
    for (const n of ['config', 'config.worktree', 'commondir', 'gitdir', 'info']) set.add(join(info.gitDir, n));
    for (const n of ['config', 'hooks', 'info']) set.add(join(info.commonDir, n));
    for (const p of configFiles(loc, env)) set.add(p);
  }
  return [...set].map(p => key(resolve(p))).sort();
}

function walkControl(loc, paths, budget) {
  const m = new Manifest(null, budget);
  const dotGit = key(join(loc.root, '.git'));
  for (const p of paths) {
    if (p === dotGit) {
      // A plain .git folder changes on every git command, so only its type counts; the files in it that can run a program are control paths of their own.
      const st = lstatOrNull(p);
      if (st) m.set(p, st.isDirectory() && !st.isSymbolicLink() ? 'd' : fingerprint(st));
    } else m.walk(p);
  }
  return m.map;
}

function porcelain(buf, wantIgnored) {
  const parts = buf.toString('utf8').split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    const rel = e.slice(3);
    if (/[RC]/.test(xy)) i++;
    if (wantIgnored !== (xy === '!!')) continue;
    out.push({ xy, rel: rel.endsWith('/') ? rel.slice(0, -1) : rel });
  }
  return out;
}

// (c) and (d): what git reports as changed, untracked or ignored.
function gitView(loc, env, top, skip, budget) {
  const m = new Manifest(skip, budget);
  const changed = git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all'], loc.root, env, loc.gitOut);
  const ignored = git(['status', '--porcelain=v1', '-z', '--ignored=traditional', '--untracked-files=normal', '--ignore-submodules=all'], loc.root, env, loc.gitOut);
  if (!changed || !ignored || changed.status !== 0 || ignored.status !== 0) refuse('git failed');
  const add = ({ xy, rel }) => {
    const abs = join(top, ...rel.split('/'));
    const st = lstatOrNull(abs);
    m.set(abs, `${xy}|${st ? fingerprint(st) : 'missing'}`);
  };
  porcelain(changed.stdout, false).forEach(add);
  porcelain(ignored.stdout, true).forEach(add);
  return m.map;
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

const pickMcp = obj => {
  const out = {};
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const k of MCP_KEYS) if (Object.hasOwn(obj, k)) out[k] = obj[k];
  return out;
};

// One value for a `.claude.json`: a hash of its MCP and allowed-tools keys only, since the rest changes every session.
function claudeJsonFingerprint(file) {
  const st = lstatOrNull(file);
  if (!st) return 'missing';
  if (!st.isFile() || st.size > MAX_CLAUDE_JSON) return 'unparsable';
  try {
    const text = decode(readFileSync(file));
    if (text === null) return 'unparsable';
    const doc = JSON.parse(text);
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return 'unparsable';
    const projects = Object.hasOwn(doc, 'projects') && doc.projects !== null && typeof doc.projects === 'object' && !Array.isArray(doc.projects) ? doc.projects : {};
    const per = Object.keys(projects).sort().map(k => [k, pickMcp(projects[k])]);
    return `h:${createHash('sha256').update(canonical({ top: pickMcp(doc), projects: per })).digest('hex')}`;
  } catch { return 'unparsable'; }
}

// (b) the watch set, walked recursively.
// `plugins` is null for the full plugins/ walk, or the sorted active roots of Walk less (they replace the walk of plugins/cache only).
function watchSet(loc, skip, budget, plugins) {
  const m = new Manifest(skip, budget);
  for (const n of ['.company', '.claude', 'CLAUDE.md', 'CLAUDE.local.md', '.mcp.json']) m.walk(join(loc.root, n));
  for (const n of ['settings.json', 'CLAUDE.md', 'agents', 'skills', 'commands', 'hooks', 'rules', 'output-styles']) m.walk(join(loc.config, n));
  const pluginsDir = join(loc.config, 'plugins');
  if (plugins === null) {
    m.walk(pluginsDir, { skipDirs: ['node_modules', '.git'] });
  } else {
    let names = [];
    try { names = readdirSync(pluginsDir); } catch { /* none */ }
    for (const name of names) {
      const full = join(pluginsDir, name);
      const st = lstatOrNull(full);
      // Only a real cache folder is narrowed (to the active versions below); everything else is walked in full.
      if (name === 'cache' && st && st.isDirectory() && !st.isSymbolicLink()) m.entry(full);
      else m.walk(full, { skipDirs: ['node_modules', '.git'] });
    }
    for (const root of plugins) m.walk(root, { skipDirs: ['node_modules', '.git'] });
  }
  let projects = [];
  try { projects = readdirSync(join(loc.config, 'projects')); } catch { /* none */ }
  for (const name of projects) m.walk(join(loc.config, 'projects', name, 'memory'));
  m.walk(loc.mcsparrow);
  if (loc.plugin) m.walk(loc.plugin);
  for (const file of new Set([join(loc.home, '.claude.json'), join(loc.config, '.claude.json')])) m.set(file, claudeJsonFingerprint(file));
  return m.map;
}

// The watch set, then the git view (or, without git, a walk of the product root).
function collect(loc, env, runDir, info, budget, plugins) {
  const skip = join(runDir, '.tree.json');
  let view;
  if (info) {
    view = gitView(loc, env, info.top, skip, budget);
  } else {
    const m = new Manifest(skip, budget);
    m.walk(loc.root, { skipDirs: ['.git', 'node_modules'] });
    view = m.map;
  }
  return { watch: watchSet(loc, skip, budget, plugins), view };
}

const MAX_INSTALLED = 1024 * KIB;
const foldCase = p => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);

// Walk less: the installed plugin folders inside plugins/cache (the rest of plugins/ is still walked); null (the full walk) when installed_plugins.json is unusable.
function activePluginRoots(loc) {
  const file = join(loc.config, 'plugins', 'installed_plugins.json');
  const st = lstatOrNull(file);
  if (!st || !st.isFile() || st.size > MAX_INSTALLED) return null;
  let doc;
  try {
    const text = decode(readFileSync(file));
    if (text === null) return null;
    doc = JSON.parse(text);
  } catch { return null; }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const list = doc.plugins;
  if (list === null || typeof list !== 'object' || Array.isArray(list)) return null;
  const cache = foldCase(real(join(loc.config, 'plugins', 'cache')));
  const roots = new Set();
  for (const entries of Object.values(list)) {
    if (!Array.isArray(entries)) return null;
    for (const e of entries) {
      if (e === null || typeof e !== 'object' || typeof e.installPath !== 'string' || !isAbsolute(e.installPath)) continue;
      const p = resolve(e.installPath);
      const pst = lstatOrNull(p);
      if (!pst || !pst.isDirectory() || pst.isSymbolicLink()) continue;
      const inside = foldCase(real(p));
      if (inside.startsWith(cache + sep) || inside.startsWith(`${cache}/`)) roots.add(p);
    }
  }
  return [...roots].sort();
}

function diff(before, after) {
  const out = [];
  for (const [p, fp] of after) if (before.get(p) !== fp) out.push(p);
  for (const p of before.keys()) if (!after.has(p)) out.push(p);
  return out;
}

function display(loc, p) {
  const root = key(loc.root);
  const home = key(loc.home);
  if (p === root) return '.';
  if (p.startsWith(`${root}/`)) return p.slice(root.length + 1);
  if (p.startsWith(`${home}/`)) return `~/${p.slice(home.length + 1)}`;
  return p;
}

function shownPaths(loc, list) {
  const shown = list.slice(0, MAX_PATHS).map(p => showPath(display(loc, p)));
  return list.length > MAX_PATHS ? { paths: shown, more: list.length - MAX_PATHS } : { paths: shown };
}

// ---------- section scan (fence-aware, like the Handoff linter) ----------
function openFence(line) {
  const f = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
  if (!f || (f[1][0] === '`' && f[2].includes('`'))) return null;
  return { ch: f[1][0], len: f[1].length };
}
function closesFence(line, fence) {
  const c = /^ {0,3}([`~]{3,})[ \t]*$/.exec(line);
  return Boolean(c) && c[1][0] === fence.ch && c[1].length >= fence.len;
}

function scan(lines, from, headRe) {
  const sections = new Map();
  const dup = new Set();
  const heads = [];
  let cur = null;
  let fence = null;
  for (let i = from; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      if (cur) cur.push(line);
      continue;
    }
    const opened = openFence(line);
    if (opened) {
      fence = opened;
      if (cur) cur.push(line);
      continue;
    }
    const h = headRe.exec(line);
    if (h) {
      const name = h[1].trim();
      heads.push(name);
      if (sections.has(name)) dup.add(name);
      cur = [];
      sections.set(name, cur);
      continue;
    }
    if (cur) cur.push(line);
  }
  return { sections, dup, heads };
}

const nonBlank = lines => lines.filter(l => l.trim() !== '');

// ---------- hidden markup ----------
// After leading spaces, quote marks and list markers, a line that starts with `[` and holds `]:` can be a link
// definition, which renders as nothing.
const PREFIX_RE = /[-+*][ \t]+|\d{1,9}[.)][ \t]+|[ \t>]+/y;
function prefixEnd(line) {
  let i = 0;
  for (;;) {
    PREFIX_RE.lastIndex = i;
    const m = PREFIX_RE.exec(line);
    if (!m) break;
    i += m[0].length;
  }
  return i;
}

export function hiddenLine(line) {
  const at = prefixEnd(line);
  return line[at] === '[' && line.indexOf(']:', at) >= 0;
}

// A label can span lines inside one paragraph, so a line that opens with `[` keeps the paragraph open until a blank line or a fence.
export function hiddenMarkup(lines, from) {
  let fence = null;
  let open = false;
  for (let i = from; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opened = openFence(line);
    if (opened) { fence = opened; open = false; continue; }
    if (/^[ \t>]*$/.test(line)) { open = false; continue; }
    const at = prefixEnd(line);
    if (line[at] === '[') {
      if (line.indexOf(']:', at) >= 0) return true;
      open = true;
    } else if (open && line.includes(']:')) return true;
  }
  return false;
}

// Backticks: one more than the longest backtick run in the texts shown, and at least three.
function fenceFor(...texts) {
  let longest = 0;
  for (const text of texts) {
    let run = 0;
    for (let i = 0; i < text.length; i++) {
      run = text.charCodeAt(i) === 96 ? run + 1 : 0;
      if (run > longest) longest = run;
    }
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

// ---------- the reply allow-list ----------
const OPT_SEP = ' — options: ';
const WHY_SEP = ' — why: ';
const NO_OPEN = '- No open question left — ';

// A reason is one line of 10 to 120 characters without a pipe; the checked characters are the only ones kept.
function reasonOk(why, min, max, pipeOk) {
  const n = [...why].length;
  return n >= min && n <= max && why === why.trim() && (pipeOk || !why.includes('|'));
}

function parseQuestion(line, k) {
  if (line.length > MAX_LINE) return null;
  const head = /^- \[spec\] Q([1-3]): /.exec(line);
  if (!head || Number(head[1]) !== k) return null;
  const whole = line.slice(head[0].length);
  const cut = whole.lastIndexOf(WHY_SEP);
  if (cut < 0) return null;
  const why = whole.slice(cut + WHY_SEP.length);
  if (!reasonOk(why, 10, 120, false)) return null;
  const rest = whole.slice(0, cut);
  const at = rest.indexOf(OPT_SEP);
  if (at < 0) return null;
  const text = rest.slice(0, at);
  const len = [...text].length;
  if (len < 1 || len > 200 || text !== text.trim()) return null;
  const raw = rest.slice(at + OPT_SEP.length).split(' | ');
  if (raw.length < 2 || raw.length > 4) return null;
  const labels = [];
  for (let i = 0; i < raw.length; i++) {
    let label = raw[i];
    if (i === 0) {
      if (!label.endsWith(' (Recommended)')) return null;
      label = label.slice(0, -' (Recommended)'.length);
    }
    const n = [...label].length;
    if (n < 1 || n > 40 || label !== label.trim() || label.includes('|') || label.includes('(Recommended)')) return null;
    labels.push(label);
  }
  if (new Set(labels).size !== labels.length) return null;
  return { n: k, text, options: labels, recommended: labels[0], why };
}

function fm(lines) {
  const end = lines.indexOf('---', 1);
  const out = Object.create(null);
  for (let i = 1; i < end; i++) {
    const m = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const at = m[2].indexOf(' #');
    out[m[1]] = (at < 0 ? m[2] : m[2].slice(0, at)).trim();
  }
  return { fm: out, end };
}

function readText(file, max) {
  const st = lstatOrNull(file);
  if (!st || !st.isFile()) return { missing: true };
  if (st.size > max) return { big: true };
  const text = decode(readFileSync(file));
  return { text };
}

// A triage line in the prompt body or the brief, code fences included, in any spelling (reprompt v1.1).
// The test runs on a match copy that is never shown or returned: NFKD, marks removed, look-alike letters folded.
const FOLD_SETS = {
  a: [0x0430, 0x0410, 0x03B1, 0x0391, 0x0251],
  e: [0x0435, 0x0415, 0x0395, 0x04BD],
  g: [0x0261, 0x0581, 0x050C],
  i: [0x0456, 0x0406, 0x0131, 0x03B9, 0x0399, 0x0269, 0x04CF, 0x04C0],
  r: [0x0433, 0x1D26],
  t: [0x0442, 0x0422, 0x03A4],
};
// Frozen object keyed by code point, so the exported table cannot be changed.
export const TRIAGE_FOLD = Object.freeze(Object.assign(Object.create(null),
  Object.fromEntries(Object.entries(FOLD_SETS).flatMap(([to, cps]) => cps.map(cp => [cp, to])))));
const MARK_RE = /\p{M}/gu;
const TRIAGE_RE = /triage(?:[\p{Zs}\t*_`~\\]|<\/?[a-z][a-z0-9]{0,9}>)*(?:[:\u{2236}\u{A789}\u{02F8}\u{05C3}\u{0589}\u{1804}\u{205A}]|&(?:amp;)*(?:#0*58;?|#x0*3a;?|colon;))/iu;

export function triageLine(text) {
  const copy = text.normalize('NFKD').replace(MARK_RE, '');
  let out = '';
  for (const ch of copy) out += TRIAGE_FOLD[ch.codePointAt(0)] ?? ch;
  return TRIAGE_RE.test(out);
}

function checkPrompt(file, treeChanged, assumed) {
  if (!treeChanged) return { reason: 'prompt.md not rewritten' };
  const r = readText(file, MAX_PROMPT);
  if (r.missing) return { reason: 'prompt.md not rewritten' };
  if (r.big) return { reason: 'too large' };
  if (r.text === null || !charsOk(r.text)) return { reason: 'bad characters' };
  const lines = r.text.split('\n');
  const head = [lines[0], lines[1], lines[2], lines[3], lines[4]];
  const m = /^language: (\S{2,35})$/.exec(head[3] ?? '');
  let tag = null;
  if (m && /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(m[1])) {
    try { tag = Intl.getCanonicalLocales(m[1])[0] ?? null; } catch { tag = null; }
  }
  const target = /^target: (\S+)$/.exec(head[2] ?? '');
  if (head[0] !== '---' || head[1] !== 'v: 1' || !target || !TARGETS.has(target[1]) || !tag || head[4] !== '---') {
    return { reason: 'bad frontmatter' };
  }
  const { heads } = scan(lines, 5, /^ {0,3}## (.*)$/);
  if (heads.length !== 6) return { reason: 'not six parts' };
  if (/^en(-|$)/i.test(m[1]) && heads.some((h, i) => h !== SIX_EN[i])) return { reason: 'parts out of order' };
  if (hiddenMarkup(lines, 5)) return { reason: 'hidden markup' };
  if (triageLine(lines.slice(5).join('\n'))) return { reason: 'triage line' };
  return { kind: 'prompt', fence: fenceFor(lines.slice(5).join('\n'), assumed) };
}

function checkReply(runDir, slug, nn, asks, promptChanged) {
  const file = join(runDir, `${nn}-reprompter.md`);
  const r = readText(file, MAX_HANDOFF);
  if (r.missing) return { reason: 'handoff missing' };
  if (r.big) return { reason: 'too large' };
  if (r.text === null || !charsOk(r.text)) return { reason: 'bad characters' };
  const { errors, routing } = lint(r.text);
  if (errors.length || !routing) return { reason: 'handoff invalid' };
  const lines = r.text.split('\n');
  const { fm: front, end } = fm(lines);
  if (front.role !== 'reprompter') return { reason: 'handoff invalid' };
  if (front.step !== nn) return { reason: 'wrong step' };
  const own = `.company/work/${slug}/prompt.md`;
  const touched = routing['files-touched'];
  if (touched.some(f => f !== own)) return { reason: 'writes outside the run folder' };
  if (new Set(touched).size !== touched.length) return { reason: 'handoff invalid' };
  const { sections, dup } = scan(lines, end + 1, /^## (.*)$/);
  if (dup.size) return { reason: 'handoff invalid' };
  const status = routing.status;
  if (status === 'blocked' || status === 'handover') return { kind: status };

  if (status === 'needs-ceo') {
    if (Number(asks) < 1) return { reason: 'needs-ceo without asks' };
    const block = nonBlank(sections.get('Blocking') ?? []);
    if (block.length < 1 || block.length > 3) return { reason: 'needs 1 to 3 questions' };
    const questions = block.map((l, i) => parseQuestion(l, i + 1));
    if (questions.some(q => q === null)) return { reason: 'bad question line' };
    return { kind: 'questions', questions };
  }

  const all = nonBlank(sections.get('Decisions') ?? []);
  const openAt = all.findIndex(l => l.startsWith(NO_OPEN));
  let noOpen = null;
  if (openAt >= 0) {
    const why = all[openAt].slice(NO_OPEN.length);
    if (all[openAt].length > MAX_LINE || !reasonOk(why, 10, 200, true)) return { reason: 'assumptions not listed' };
    noOpen = why;
  }
  const dec = noOpen === null ? all : all.filter((_, i) => i !== openAt);
  if (noOpen !== null && all.filter(l => l.startsWith(NO_OPEN)).length > 1) return { reason: 'assumptions not listed' };
  const listed = (dec.length === 1 && dec[0] === '- none') || (noOpen !== null && dec.length === 0);
  const assumed = dec.length > 0 && dec.every(l => {
    if (l.length > MAX_LINE || !l.startsWith('- Assumed: ')) return false;
    const body = l.slice('- Assumed: '.length);
    const at = body.indexOf(' — ');
    return at > 0 && body.slice(0, at).trim() !== '' && body.slice(at + 3).trim() !== '';
  });
  if (!listed && !assumed) return { reason: 'assumptions not listed' };
  const assumptions = assumed ? dec.join('\n') : '';

  const mark = r2 => (noOpen === null || r2.reason ? r2 : { ...r2, noOpenQuestion: noOpen });
  if (touched.length === 1) return mark(checkPrompt(join(runDir, 'prompt.md'), promptChanged, assumptions));
  const next = nonBlank(sections.get('Next') ?? []);
  const brief = next.length === 1 && next[0].length <= MAX_LINE ? /^- prompt-artist: (.*)$/.exec(next[0]) : null;
  const text = brief ? brief[1].trim() : '';
  const n = [...text].length;
  if (!brief || n < 1 || n > 300) return { reason: 'no prompt and no brief' };
  if (hiddenLine(text)) return { reason: 'hidden markup' };
  if (triageLine(text)) return { reason: 'triage line' };
  return mark({ kind: 'image', brief: text, fence: fenceFor(text, assumptions) });
}

// ---------- the subcommands ----------
const isPair = e => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'string';

function pairs(list) {
  if (!Array.isArray(list) || !list.every(isPair)) refuse('baseline changed');
  return new Map(list);
}

function readBaseline(runDir, hex) {
  const file = join(runDir, '.tree.json');
  const st = lstatOrNull(file);
  if (!st || !st.isFile() || st.size > MAX_BASELINE) refuse('baseline changed');
  const buf = readFileSync(file);
  if (createHash('sha256').update(buf).digest('hex') !== hex) refuse('baseline changed');
  let doc;
  try { doc = JSON.parse(buf.toString('utf8')); } catch { refuse('baseline changed'); }
  if (doc === null || typeof doc !== 'object' || doc.v !== 2 || typeof doc.git !== 'boolean') refuse('baseline changed');
  if (!Array.isArray(doc.control) || !doc.control.every(p => typeof p === 'string')) refuse('baseline changed');
  if (Object.hasOwn(doc, 'limit') && !LIMIT_KINDS.includes(doc.limit)) refuse('baseline changed');
  const plugins = Object.hasOwn(doc, 'plugins') ? doc.plugins : null;
  if (plugins !== null && !(Array.isArray(plugins) && plugins.every(p => typeof p === 'string' && isAbsolute(p)))) refuse('baseline changed');
  return {
    plugins,
    limit: Object.hasOwn(doc, 'limit') ? doc.limit : 'none',
    git: doc.git,
    control: doc.control,
    centries: pairs(doc.centries),
    watch: pairs(doc.watch),
    view: pairs(doc.view),
  };
}

// The run folder holds only the files of the Run folder table; the Lead's files are size-capped.
function checkRunFolder(dir) {
  let names;
  try { names = readdirSync(dir); } catch { refuse('run folder unreadable'); }
  for (const name of names) {
    if (!RUN_FILE_RE.test(name)) refuse('unexpected file in the run folder');
    const st = lstatOrNull(join(dir, name));
    if (!st || !st.isFile()) refuse('unexpected entry in the run folder');
    if (LEAD_FILE_RE.test(name) && st.size > MAX_LEAD_FILE) refuse('a request file is too large');
    if (name === '00-summary.md') {
      if (st.nlink > 1) refuse('unexpected entry in the run folder');
      if (st.size > MAX_SUMMARY) refuse('the summary file is too large');
    }
  }
  const ig = lstatOrNull(join(dir, '.gitignore'));
  if (!ig || !ig.isFile() || ig.size !== 2 || readFileSync(join(dir, '.gitignore'), 'latin1') !== '*\n') {
    refuse('.gitignore in the run folder must be exactly * and a line feed');
  }
}

// The active bound: the base, or exactly CEILING times the base for raise and both.
function bound(base, limit) {
  const k = limit === 'raise' || limit === 'both' ? CEILING : 1;
  return { entries: base.entries * k, gitOut: base.gitOut * k };
}

function snap(loc0, env, slug, base, limit) {
  const active = bound(base, limit);
  const loc = { ...loc0, gitOut: active.gitOut };
  const dir = runFolder(loc, slug);
  checkRunFolder(dir);
  writeRecord(loc, slug);
  const budget = { n: 0, max: active.entries };
  try {
    return snapWrite(loc, env, dir, budget, limit);
  } catch (e) {
    if (!(e instanceof OverLimit)) throw e;
    if (limit === 'raise' || limit === 'both') refuse('tree too large');
    return { json: { kind: 'pick', offer: limit === 'walk-less' ? ['raise'] : ['walk-less', 'raise'] }, code: 4 };
  }
}

function snapWrite(loc, env, dir, budget, limit) {
  const info = gitInfo(loc, env);
  const control = controlPaths(loc, env, info);
  const plugins = limit === 'walk-less' || limit === 'both' ? activePluginRoots(loc) : null;
  const { watch, view } = collect(loc, env, dir, info, budget, plugins);
  const centries = walkControl(loc, control, budget);
  const buf = Buffer.from(JSON.stringify({
    v: 2, limit, plugins, git: Boolean(info), control, centries: [...centries], watch: [...watch], view: [...view],
  }));
  if (buf.length > MAX_BASELINE) refuse('tree too large');
  writeFileSync(join(dir, '.tree.json'), buf);
  return { json: { snap: createHash('sha256').update(buf).digest('hex') }, code: 0 };
}

function arm(loc, slug, nn) {
  const dir = runFolder(loc, slug);
  checkRunFolder(dir);
  requireRecord(loc, slug);
  try {
    writeFileSync(join(dir, `.gate-${nn}`), '1\n', { flag: 'wx' });
  } catch (e) {
    refuse(e.code === 'EEXIST' ? 'gate already armed' : 'cannot arm the gate');
  }
  return { json: { armed: nn }, code: 0 };
}

function reply(loc0, env, slug, nn, hex, asks, baseLimits) {
  const dir = runFolder(loc0, slug);
  requireRecord(loc0, slug);
  const base = readBaseline(dir, hex);
  const active = bound(baseLimits, base.limit);
  const loc = { ...loc0, gitOut: active.gitOut };
  const runKey = key(dir);

  // The files git reads come first, before any git command can run under them.
  const nowControl = walkControl(loc, base.control, { n: 0, max: active.entries });
  const controlMoved = diff(base.centries, nowControl).sort();
  if (controlMoved.length) refuse('git config changed', controlMoved);

  const gateFile = join(dir, `.gate-${nn}`);
  const gate = lstatOrNull(gateFile);
  if (base.watch.has(`${runKey}/.gate-${nn}`) || !gate || !gate.isFile() || gate.size !== 2 || readFileSync(gateFile, 'latin1') !== '1\n') {
    refuse('write gate not active');
  }

  const budget = { n: 0, max: active.entries };
  let info = null;
  if (base.git) {
    info = gitInfo(loc, env);
    const listed = info ? controlPaths(loc, env, info) : [];
    const [a, b] = [new Set(listed), new Set(base.control)];
    const moved = [...a].filter(p => !b.has(p)).concat([...b].filter(p => !a.has(p)));
    if (!info || moved.length) refuse('git config changed', moved.sort());
  }
  const now = collect(loc, env, dir, info, budget, base.plugins);

  const allowed = new Set([runKey, `${runKey}/prompt.md`, `${runKey}/${nn}-reprompter.md`, `${runKey}/.gate-${nn}`]);
  // The run's own state log is skipped only while it is still a plain file.
  const logKey = `${runKey}/run-state.jsonl`;
  const plainLog = (m, view) => /^f:/.test(view ? String(m.get(logKey) ?? '').replace(/^[^|]*\|/, '') : String(m.get(logKey) ?? ''));
  const watchAll = diff(base.watch, now.watch);
  const viewAll = diff(base.view, now.view);
  const watchMoved = watchAll.filter(p => !allowed.has(p) && !(p === logKey && plainLog(now.watch, false)));
  const seen = new Set(watchMoved);
  const viewMoved = viewAll.filter(p => !allowed.has(p) && !seen.has(p) && !(p === logKey && plainLog(now.view, true)));
  const bad = [...new Set(watchMoved)].sort().concat([...new Set(viewMoved)].sort());
  const promptChanged = watchAll.includes(`${runKey}/prompt.md`) || viewAll.includes(`${runKey}/prompt.md`);

  const result = checkReply(dir, slug, nn, asks, promptChanged);
  const json = { tree: bad.length ? 'changed' : 'ok', ...shownPaths(loc, bad) };
  json.ok = !result.reason;
  Object.assign(json, result);
  return { json, code: bad.length ? 2 : result.reason ? 1 : 0 };
}

// Returns { code, out }; `out` is one JSON line.
// The test-only `limits` may only lower the base values.
function baseLimits(limits) {
  if (limits === undefined) return LIMITS;
  if (limits === null || typeof limits !== 'object') refuse(USAGE);
  const out = { ...LIMITS };
  for (const k of Object.keys(LIMITS)) {
    if (!Object.hasOwn(limits, k)) continue;
    const v = limits[k];
    if (!Number.isSafeInteger(v) || v < 1 || v > LIMITS[k]) refuse(USAGE);
    out[k] = v;
  }
  return out;
}

export function run(argv, { cwd = process.cwd(), env = process.env, limits } = {}) {
  try {
    const [cmd, slug, ...rest] = argv;
    if (typeof slug !== 'string' || !isRunName(slug) || isProjectId(slug)) refuse(USAGE);
    const base = baseLimits(limits);
    const loc = locations(cwd, env);
    let res;
    if (cmd === 'snap' && (rest.length === 0 || (rest.length === 1 && LIMIT_TOKEN_RE.test(rest[0])))) {
      res = snap(loc, env, slug, base, rest.length ? rest[0] : 'none');
    } else if (cmd === 'arm' && rest.length === 1 && NN_RE.test(rest[0])) {
      res = arm(loc, slug, rest[0]);
    } else if (cmd === 'reply' && rest.length === 3 && NN_RE.test(rest[0]) && HEX_RE.test(rest[1]) && ASKS_RE.test(rest[2])) {
      res = reply(loc, env, slug, rest[0], rest[1], rest[2], base);
    } else {
      refuse(USAGE);
    }
    const out = JSON.stringify(res.json);
    if (Buffer.byteLength(out) > MAX_OUT) refuse('output too large');
    return { code: res.code, out };
  } catch (e) {
    const why = e instanceof Refused || e instanceof OverLimit ? e.message : 'checker failed';
    const json = { refused: `refused: ${why}` };
    if (e instanceof Refused && e.paths) {
      try {
        Object.assign(json, shownPaths(locations(cwd, env), e.paths));
      } catch { /* the reason alone stands */ }
    }
    return { code: 3, out: JSON.stringify(json) };
  }
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const r = run(process.argv.slice(2));
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}
