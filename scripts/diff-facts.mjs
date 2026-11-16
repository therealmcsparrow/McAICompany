#!/usr/bin/env node
// contract: docs/contracts/diff-facts.md v1.0
// Classifies what a run changed (docs, tests, code, contracts, ...) into one facts file that gates read.
// Node built-ins and git only. Every git call is a judging call: child env without GIT_*, no shell, literal
// pathspecs, no replace objects, no ext-diff or textconv, NUL-separated output, ids checked before git runs.
// Anything unclear counts as a UI, strings and contract change (docs/adr/0075-fail-safe-ui-changed.md).
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync,
  appendFileSync, writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { WorkFolderRefusal, exactWorkPath, isRunSlug, workParts } from '../mods/lib/work-folder.mjs';

const MiB = 1024 * 1024;
const MAX_FACTS_BYTES = MiB;
const MAX_PATHS = 5000;
const MAX_PATH_BYTES = 4096;
const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_GLOBS = 100;
const MAX_GLOB_LENGTH = 256;
const MAX_GIT_OUTPUT = 32 * MiB;
const GIT_TIMEOUT_MS = 60000;
const PATH_BUDGET = MAX_FACTS_BYTES - 64 * 1024;
const ENTRY_OVERHEAD = 64;
const BINARY_PROBE = 8000;
const FULL_ID = /^[0-9a-f]{40}$/;
const STEP = /^\d{2,3}-[a-z][a-z0-9-]{0,40}$/;
const FACTS_FILE = /^(\d{2,3})-([a-z][a-z0-9-]{0,40})\.json$/;
const STATUSES = ['A', 'M', 'D', 'R', 'C', 'T'];
const KINDS = ['binary', 'rename', 'contract', 'test', 'docs', 'locale', 'style', 'ui', 'config', 'code', 'unknown'];
const FACT_KEYS = ['base', 'contract_changed', 'docs_only', 'head', 'paths', 'step', 'strings_changed', 'truncated', 'ui_changed', 'v'];
const FLAG_KEYS = ['truncated', 'ui_changed', 'strings_changed', 'contract_changed', 'docs_only'];
const NO_DOCS_CONFIG = Object.freeze({ v: 1, not_docs: Object.freeze(['**']) });

const CONTRACT = ['docs/contracts/**', '**/contracts/**', '**/*.proto', '**/openapi*.json', '**/openapi*.yaml', '**/openapi*.yml', '**/*.schema.json'];
const TEST = ['tests/**', 'test/**', '**/__tests__/**', '**/fixtures/**', '**/*.test.*', '**/*.spec.*'];
const DOCS = ['docs/**', 'documentation/**', '.company/**', '*.md', 'LICENSE*'];
const LOCALE = [
  '**/locales/**', '**/locale/**', '**/i18n/**', '**/l10n/**', '**/*.po', '**/*.pot', '**/*.ftl', '**/*.arb', '**/*.resx',
  '**/*.xlf', '**/*.xliff', '**/*.strings',
];
const STYLE = [
  '**/*.css', '**/*.scss', '**/*.sass', '**/*.less', '**/theme/**', '**/themes/**', '**/tokens/**', '**/theme.*', '**/tokens.*',
  '**/*.theme.*', '**/*.tokens.*',
];
const UI = ['**/*.html', '**/*.htm', '**/*.jsx', '**/*.tsx', '**/*.vue', '**/*.svelte', '**/*.svg', '**/*.xaml'];
const CONFIG = ['.github/**', '**/*.json', '**/*.yml', '**/*.yaml', '**/*.toml', '**/*.ini', '**/.env*', '**/*.config.*', '**/.*rc'];
const CODE = [
  '**/*.mjs', '**/*.cjs', '**/*.js', '**/*.ts', '**/*.py', '**/*.go', '**/*.rs', '**/*.java', '**/*.kt', '**/*.cs', '**/*.rb',
  '**/*.php', '**/*.swift', '**/*.c', '**/*.h', '**/*.cpp', '**/*.sh', '**/*.ps1', '**/*.md',
];

class Refusal extends Error {}
const refuse = reason => { throw new Refusal(reason); };

// ---------------------------------------------------------------- glob matching

// Segment match with `*` and `?`; a path segment never holds `/`.
function segmentMatch(glob, text) {
  let g = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (g < glob.length && (glob[g] === '?' || glob[g] === text[t]) && glob[g] !== '*') { g++; t++; }
    else if (g < glob.length && glob[g] === '*') { star = g++; mark = t; }
    else if (star !== -1) { g = star + 1; t = ++mark; }
    else return false;
  }
  while (g < glob.length && glob[g] === '*') g++;
  return g === glob.length;
}

const splitCache = new Map();
function globSegments(glob) {
  let segs = splitCache.get(glob);
  if (segs === undefined) {
    segs = glob.split('/');
    if (splitCache.size < 1000) splitCache.set(glob, segs);
  }
  return segs;
}

// `**` between segments matches zero or more segments, a trailing `**` one or more. Memoised, so linear in glob x path.
function matchGlob(glob, path) {
  const gs = globSegments(glob);
  const ps = path.split('/');
  const memo = new Map();
  const at = (i, j) => {
    if (i === gs.length) return j === ps.length;
    const key = i * (ps.length + 1) + j;
    const seen = memo.get(key);
    if (seen !== undefined) return seen;
    let result;
    if (gs[i] === '**') {
      result = i === gs.length - 1 ? j < ps.length : at(i + 1, j) || (j < ps.length && at(i, j + 1));
    } else {
      result = j < ps.length && segmentMatch(gs[i], ps[j]) && at(i + 1, j + 1);
    }
    memo.set(key, result);
    return result;
  };
  return at(0, 0);
}

const anyMatch = (globs, path) => globs.some(g => matchGlob(g, path));

// ---------------------------------------------------------------- classification

function hostile(p) {
  if (typeof p !== 'string' || p === '') return true;
  if (Buffer.byteLength(p, 'utf8') > MAX_PATH_BYTES) return true;
  if (/[\x00-\x1f\x7f\ufffd\\]/.test(p)) return true;
  return p.split('/').some(seg => seg === '' || seg === '.' || seg === '..' || seg.startsWith('-'));
}

const isCount = n => n === null || n === undefined || n === '-';

function validConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return false;
  const keys = Object.keys(config);
  if (keys.length !== 2 || !keys.includes('v') || !keys.includes('not_docs')) return false;
  if (config.v !== 1 || !Array.isArray(config.not_docs) || config.not_docs.length > MAX_GLOBS) return false;
  return config.not_docs.every(g => typeof g === 'string' && g.length > 0 && g.length <= MAX_GLOB_LENGTH && !/[\x00-\x1f\x7f]/.test(g));
}

// Rules 4 to 10 for one path.
function pathKind(path, notDocs) {
  if (anyMatch(TEST, path)) return 'test';
  if (anyMatch(DOCS, path) && !anyMatch(notDocs, path)) return 'docs';
  if (anyMatch(LOCALE, path)) return 'locale';
  if (anyMatch(STYLE, path)) return 'style';
  if (anyMatch(UI, path)) return 'ui';
  if (anyMatch(CONFIG, path)) return 'config';
  if (anyMatch(CODE, path)) return 'code';
  return 'unknown';
}

function kindOf(e, notDocs) {
  const { path, from } = e;
  if (hostile(path) || (from !== null && hostile(from))) return 'unknown';
  if (!STATUSES.includes(e.status)) return 'unknown';
  if (!(Number.isInteger(e.added) && Number.isInteger(e.removed))) {
    if (isCount(e.added) && isCount(e.removed)) return 'binary';
    return 'unknown';
  }
  if (anyMatch(CONTRACT, path) || (from !== null && anyMatch(CONTRACT, from))) return 'contract';
  if (e.status === 'R' && e.similarity === 100 && e.added === 0 && e.removed === 0) return 'rename';
  const kind = pathKind(path, notDocs);
  if (e.status === 'R' && from !== null && pathKind(from, notDocs) !== kind) return 'unknown';
  return kind;
}

function estimate(p) {
  let n = ENTRY_OVERHEAD + JSON.stringify(p.path).length + (p.from === null ? 4 : JSON.stringify(p.from).length);
  for (const s of [p.path, p.from ?? '']) n += (s.match(/\x7f/g)?.length ?? 0) * 5;
  return n;
}

export function classify(entries, config) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  const notDocs = config === null || config === undefined ? [] : (validConfig(config) ? config.not_docs : NO_DOCS_CONFIG.not_docs);
  const all = entries.map(e => {
    if (e === null || typeof e !== 'object' || typeof e.path !== 'string') throw new TypeError('bad entry');
    const entry = { ...e, from: e.from === undefined || e.from === null ? null : String(e.from) };
    const kind = kindOf(entry, notDocs);
    return { path: entry.path, from: entry.from, status: STATUSES.includes(entry.status) ? entry.status : 'M', kind };
  });
  all.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const paths = [];
  let used = 0;
  let truncated = false;
  for (const p of all) {
    used += estimate(p);
    if (paths.length >= MAX_PATHS || used > PATH_BUDGET) { truncated = true; break; }
    paths.push(p);
  }
  const kinds = paths.map(p => p.kind);
  const some = list => kinds.some(k => list.includes(k));
  const every = list => kinds.every(k => list.includes(k));
  const empty = paths.length === 0;
  return {
    paths,
    truncated,
    ui_changed: truncated || empty || !every(['docs', 'test']),
    strings_changed: truncated || empty || !every(['docs', 'test', 'style']),
    contract_changed: truncated || some(['contract', 'binary', 'unknown']),
    docs_only: !truncated && !empty && every(['docs']),
  };
}

// ---------------------------------------------------------------- safe file reads

const bigStat = (p) => lstatSync(p, { bigint: true });

// A plain regular file with one link at exactly `lexical`, whose real path equals it and lies under `realRoot`.
function readPlain(realRoot, lexical, cap) {
  let lst;
  try { lst = bigStat(lexical); } catch (e) { return { status: e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 'missing' : 'error' }; }
  if (!lst.isFile() || lst.nlink !== 1n) return { status: 'refused' };
  if (lst.size > BigInt(cap)) return { status: 'big' };
  let real;
  try { real = realpathSync.native(lexical); } catch { return { status: 'refused' }; }
  if (real !== lexical || !real.startsWith(realRoot + sep)) return { status: 'refused' };
  let fd;
  try {
    fd = openSync(lexical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const st = fstatSync(fd, { bigint: true });
    if (!st.isFile() || st.nlink !== 1n || st.size > BigInt(cap)) return { status: 'refused' };
    if (lst.ino !== 0n && (st.ino !== lst.ino || st.dev !== lst.dev)) return { status: 'refused' };
    const buf = Buffer.alloc(Number(st.size));
    let off = 0;
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return { status: 'ok', buf: buf.subarray(0, off) };
  } catch {
    return { status: 'error' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// A real directory (no link) at `dir` whose real path equals `dir`.
function isRealDir(dir) {
  try {
    const st = lstatSync(dir);
    return st.isDirectory() && !st.isSymbolicLink() && realpathSync.native(dir) === dir;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- config

// { config, warning }: a missing config is normal, a bad one is ignored and no path counts as docs.
export function readConfig(root) {
  const bad = reason => ({ config: NO_DOCS_CONFIG, warning: `diff-facts: config ignored: ${reason}` });
  let realRoot;
  try { realRoot = realpathSync.native(root); } catch { return bad('unreadable'); }
  const file = join(realRoot, 'diff-facts.config.json');
  const r = readPlain(realRoot, file, MAX_CONFIG_BYTES);
  if (r.status === 'missing') return { config: null, warning: null };
  if (r.status === 'big') return bad('too big');
  if (r.status !== 'ok') return bad('not a plain file');
  let parsed;
  try { parsed = JSON.parse(r.buf.toString('utf8')); } catch { return bad('bad JSON'); }
  if (!validConfig(parsed)) return bad('wrong keys or values');
  return { config: parsed, warning: null };
}

// ---------------------------------------------------------------- git

function gitEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!/^GIT_/i.test(k)) env[k] = v;
  }
  return {
    ...env,
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

const GIT_PREFIX = ['--no-replace-objects', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'diff.ignoreSubmodules=none'];

function git(cwd, args) {
  try {
    return execFileSync('git', [...GIT_PREFIX, ...args], {
      cwd, env: gitEnv(), maxBuffer: MAX_GIT_OUTPUT, timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
  } catch {
    return refuse('git failed');
  }
}

function noGrafts(cwd) {
  const out = git(cwd, ['rev-parse', '--git-path', 'info/grafts']).toString('utf8').replace(/\r?\n$/, '');
  if (out === '' || /[\x00-\x1f]/.test(out)) refuse('git failed');
  if (existsSync(resolve(cwd, out))) refuse('grafts are present');
}

function requireCommit(cwd, id) {
  if (!FULL_ID.test(id)) refuse('not a full commit id');
  if (git(cwd, ['cat-file', '-t', '--end-of-options', id]).toString('utf8') !== 'commit\n') refuse('not a commit');
}

const decode = latin1 => Buffer.from(latin1, 'latin1').toString('utf8');

function nulTokens(buf) {
  const text = buf.toString('latin1');
  if (text === '') return [];
  if (!text.endsWith('\0')) refuse('git output not understood');
  return text.slice(0, -1).split('\0');
}

function parseNameStatus(buf) {
  const tokens = nulTokens(buf);
  const out = [];
  for (let i = 0; i < tokens.length;) {
    const code = tokens[i++];
    if (!/^[A-Z]\d{0,3}$/.test(code)) refuse('git output not understood');
    const letter = code[0];
    if (letter === 'R' || letter === 'C') {
      if (i + 1 >= tokens.length) refuse('git output not understood');
      out.push({ status: letter, similarity: Number(code.slice(1) || 0), from: tokens[i], path: tokens[i + 1] });
      i += 2;
    } else {
      if (i >= tokens.length) refuse('git output not understood');
      out.push({ status: letter, similarity: null, from: null, path: tokens[i++] });
    }
  }
  return out;
}

function parseNumstat(buf) {
  const tokens = nulTokens(buf);
  const map = new Map();
  const count = s => (s === '-' ? '-' : /^\d{1,12}$/.test(s) ? Number(s) : refuse('git output not understood'));
  for (let i = 0; i < tokens.length;) {
    const t = tokens[i++];
    const a = t.indexOf('\t');
    const b = a < 0 ? -1 : t.indexOf('\t', a + 1);
    if (b < 0) refuse('git output not understood');
    const added = count(t.slice(0, a));
    const removed = count(t.slice(a + 1, b));
    let path = t.slice(b + 1);
    if (path === '') {
      if (i + 1 >= tokens.length) refuse('git output not understood');
      path = tokens[i + 1];
      i += 2;
    }
    map.set(path, { added, removed });
  }
  return map;
}

function gitInput(cwd, args, input) {
  try {
    return execFileSync('git', [...GIT_PREFIX, ...args], {
      cwd, env: gitEnv(), input, maxBuffer: MAX_GIT_OUTPUT, timeout: GIT_TIMEOUT_MS, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
  } catch {
    return refuse('git failed');
  }
}

// Reads each `<id>:<path>` spec raw with one cat-file process: 'nul' when the first bytes hold a NUL, a non-blob or a missing object.
function probeBlobs(cwd, specs) {
  if (specs.length === 0) return [];
  const out = gitInput(cwd, ['cat-file', '--batch'], Buffer.from(specs.map(x => `${x}\n`).join(''), 'utf8'));
  const result = [];
  let pos = 0;
  for (let i = 0; i < specs.length; i++) {
    const nl = out.indexOf(10, pos);
    if (nl < 0) refuse('git output not understood');
    const header = out.toString('latin1', pos, nl);
    pos = nl + 1;
    if (header.endsWith(' missing')) { result.push(true); continue; }
    const m = /^[0-9a-f]{40,64} ([a-z]+) (\d{1,12})$/.exec(header);
    if (m === null) refuse('git output not understood');
    const size = Number(m[2]);
    if (pos + size + 1 > out.length) refuse('git output not understood');
    result.push(m[1] !== 'blob' || out.subarray(pos, pos + Math.min(size, BINARY_PROBE)).includes(0));
    pos += size + 1;
  }
  if (pos !== out.length) refuse('git output not understood');
  return result;
}

// The tip side read from the working tree by the real-path rule; anything not a plain readable file counts as binary.
function worktreeHasNul(realRoot, rel) {
  const r = readPlain(realRoot, join(realRoot, ...rel.split('/')), MAX_GIT_OUTPUT);
  return r.status !== 'ok' || r.buf.subarray(0, BINARY_PROBE).includes(0);
}

// A path numstat shows as binary whose sides hold no NUL: its counts come from the one-path call.
function textCounts(cwd, flags, tail, path) {
  const only = parseNameOnly(git(cwd, [...flags, '--name-only', ...tail, path]));
  if (only.length !== 1 || decode(only[0]) !== path) refuse('git output not understood');
  const counts = parseNumstat(git(cwd, [...flags, '--numstat', '--text', ...tail, path]));
  if (counts.size !== 1) refuse('git output not understood');
  const c = [...counts.values()][0];
  // A `-diff` attribute keeps numstat at `-` even with --text; the content is NUL-free, so it is text, with counts git will not give.
  return Number.isInteger(c.added) && Number.isInteger(c.removed) ? c : { added: 1, removed: 1 };
}

function parseNameOnly(buf) {
  return nulTokens(buf);
}

// tip: { commit } reads the tip blob at that commit, { worktree } reads the working-tree file.
function listChanges(cwd, revs, tip) {
  const flags = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-relative', '--ignore-submodules=none', '-z', '-M'];
  const tail = ['--end-of-options', ...revs, '--'];
  const status = parseNameStatus(git(cwd, [...flags, '--name-status', ...tail]));
  const counts = parseNumstat(git(cwd, [...flags, '--numstat', ...tail]));
  if (counts.size !== status.length || status.some(s => !counts.has(s.path))) refuse('git output not understood');
  const entries = status.map(s => {
    const c = counts.get(s.path);
    return {
      path: decode(s.path), from: s.from === null ? null : decode(s.from), status: s.status, similarity: s.similarity,
      added: c.added, removed: c.removed,
    };
  });
  const probed = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).slice(0, MAX_PATHS)
    .filter(e => !hostile(e.path) && (e.from === null || !hostile(e.from)));
  const specs = [];
  for (const e of probed) {
    if (e.status !== 'A') specs.push(`${revs[0]}:${e.from ?? e.path}`);
    if (e.status !== 'D' && tip.commit !== undefined) specs.push(`${tip.commit}:${e.path}`);
  }
  const nuls = probeBlobs(cwd, specs);
  const realRoot = tip.worktree === true ? realpathSync.native(cwd) : null;
  let at = 0;
  for (const e of probed) {
    let nul = false;
    if (e.status !== 'A' && nuls[at++]) nul = true;
    if (e.status !== 'D') {
      if (tip.commit !== undefined) { if (nuls[at++]) nul = true; } else if (worktreeHasNul(realRoot, e.path)) nul = true;
    }
    if (nul) { e.added = '-'; e.removed = '-'; continue; }
    if (e.added === '-' && e.removed === '-') {
      const c = textCounts(cwd, flags, tail, e.path);
      e.added = c.added;
      e.removed = c.removed;
    }
  }
  return entries;
}

// An untracked file counts as binary when its first bytes hold a NUL, and when it cannot be read as a plain file.
function probeUntracked(cwd, rel) {
  const abs = join(cwd, ...rel.split('/'));
  let fd;
  try {
    const st = lstatSync(abs);
    if (!st.isFile()) return null;
    fd = openSync(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const buf = Buffer.alloc(BINARY_PROBE);
    const n = readSync(fd, buf, 0, BINARY_PROBE, 0);
    return buf.subarray(0, n).includes(0) ? null : 1;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function listUntracked(cwd) {
  const buf = git(cwd, ['ls-files', '-z', '--others', '--exclude-standard']);
  return nulTokens(buf).map(raw => {
    const path = decode(raw);
    const lines = hostile(path) ? null : probeUntracked(cwd, path);
    return { path, from: null, status: 'A', similarity: null, added: lines, removed: lines === null ? null : 0 };
  });
}

// ---------------------------------------------------------------- facts

function render(facts) {
  return `${JSON.stringify(facts).replace(/\x7f/g, '\\u007f')}\n`;
}

function buildFacts(cwd, base, head, entries, step) {
  const { config, warning } = readConfig(cwd);
  if (warning !== null) process.stderr.write(`${warning}\n`);
  const c = classify(entries, config);
  const facts = {};
  facts.v = 1;
  if (step !== null) facts.step = step;
  facts.base = base;
  facts.head = head;
  Object.assign(facts, { paths: c.paths }, Object.fromEntries(FLAG_KEYS.map(k => [k, c[k]])));
  const text = render(facts);
  if (Buffer.byteLength(text) > MAX_FACTS_BYTES) refuse('facts too big');
  return { facts, text };
}

function headId(cwd) {
  const head = git(cwd, ['rev-parse', 'HEAD']).toString('utf8').trim();
  requireCommit(cwd, head);
  return head;
}

function show(cwd, opts) {
  requireCommit(cwd, opts.base);
  if (opts.head !== null) requireCommit(cwd, opts.head);
  noGrafts(cwd);
  const head = opts.head ?? headId(cwd);
  const entries = listChanges(cwd, [opts.base, head], { commit: head });
  return buildFacts(cwd, opts.base, head, entries, null);
}

// ---------------------------------------------------------------- work folder

function checkedSlug(slug) {
  if (typeof slug !== 'string' || slug === '' || /[\x00-\x1f\x7f\\:]/.test(slug) || slug.startsWith('-') || !isRunSlug(slug)) refuse('bad slug');
  const parts = workParts(slug);
  if (parts === null || parts.some(p => p === '' || p === '.' || p === '..' || p.startsWith('-') || p.includes('/'))) refuse('bad slug');
  return parts;
}

function runDirOf(root, parts) {
  let realRoot;
  try { realRoot = realpathSync.native(root); } catch { return refuse('bad run folder'); }
  try {
    if (exactWorkPath({ fs: { readdirSync }, path: { join } }, realRoot, parts) !== 'exact') return { realRoot, runDir: null };
  } catch (e) {
    if (e instanceof WorkFolderRefusal) return refuse('bad run folder');
    throw e;
  }
  const runDir = join(realRoot, '.company', 'work', ...parts);
  if (!isRealDir(runDir)) return refuse('bad run folder');
  return { realRoot, runDir };
}

function baseCommitOf(text) {
  if (!text.startsWith('---\n')) refuse('no Handoff frontmatter');
  const end = text.indexOf('\n---', 4);
  if (end < 0) refuse('no Handoff frontmatter');
  const hits = text.slice(4, end).split('\n').map(l => l.replace(/\r$/, '')).filter(l => /^base-commit:/.test(l));
  if (hits.length !== 1) refuse('no base-commit in the Handoff');
  const value = hits[0].slice('base-commit:'.length).trim();
  if (!FULL_ID.test(value)) refuse('bad base-commit in the Handoff');
  return value;
}

function write(cwd, slug, step) {
  const parts = checkedSlug(slug);
  if (typeof step !== 'string' || !STEP.test(step)) refuse('bad step');
  const { realRoot, runDir } = runDirOf(cwd, parts);
  if (runDir === null) refuse('no Handoff');
  const handoff = readPlain(realRoot, join(runDir, `${step}.md`), MiB);
  if (handoff.status !== 'ok') refuse('no Handoff');
  const base = baseCommitOf(handoff.buf.toString('utf8'));
  const factsDir = join(runDir, 'facts');
  const file = join(factsDir, `${step}.json`);
  if (existsSync(file)) refuse('facts file exists');
  requireCommit(cwd, base);
  noGrafts(cwd);
  const ref = git(cwd, ['symbolic-ref', '-q', 'HEAD']).toString('utf8').trim();
  if (!/^refs\/heads\/[^\x00-\x20\x7f~^:?*[\\]+$/.test(ref)) refuse('not on a run branch');
  const head = headId(cwd);
  const entries = [...listChanges(cwd, [base], { worktree: true }), ...listUntracked(cwd)];
  const { text } = buildFacts(cwd, base, head, entries, step);
  try { mkdirSync(factsDir); } catch (e) { if (e.code !== 'EEXIST') refuse('cannot create the facts folder'); }
  if (!isRealDir(factsDir)) refuse('facts folder is not a plain folder');
  try {
    writeFileSync(file, text, { flag: 'wx' });
  } catch {
    refuse('facts file not written');
  }
  return ['.company', 'work', ...parts, 'facts', `${step}.json`].join('/');
}

function newestName(factsDir) {
  let names;
  try { names = readdirSync(factsDir); } catch { return null; }
  let best = null;
  for (const name of names) {
    const m = FACTS_FILE.exec(name);
    if (m === null) continue;
    const n = Number(m[1]);
    if (best === null || n > best.n || (n === best.n && name > best.name)) best = { n, name };
  }
  return best === null ? null : best.name;
}

function validFacts(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
  const keys = Object.keys(o).sort();
  if (keys.length !== FACT_KEYS.length || keys.some((k, i) => k !== FACT_KEYS[i])) return false;
  if (o.v !== 1 || typeof o.step !== 'string' || !STEP.test(o.step)) return false;
  if (typeof o.base !== 'string' || !FULL_ID.test(o.base) || typeof o.head !== 'string' || !FULL_ID.test(o.head)) return false;
  if (FLAG_KEYS.some(k => typeof o[k] !== 'boolean')) return false;
  if (!Array.isArray(o.paths) || o.paths.length > MAX_PATHS) return false;
  return o.paths.every(p => {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return false;
    const k = Object.keys(p).sort();
    return k.length === 4 && k.join() === 'from,kind,path,status' && typeof p.path === 'string'
      && (p.from === null || typeof p.from === 'string') && STATUSES.includes(p.status) && KINDS.includes(p.kind);
  });
}

export function readLatest(runDir) {
  try {
    const realRun = realpathSync.native(runDir);
    const factsDir = join(realRun, 'facts');
    if (!isRealDir(factsDir)) return null;
    const name = newestName(factsDir);
    if (name === null) return null;
    const r = readPlain(realRun, join(factsDir, name), MAX_FACTS_BYTES);
    if (r.status !== 'ok') return null;
    const facts = JSON.parse(r.buf.toString('utf8'));
    return validFacts(facts) ? facts : null;
  } catch {
    return null;
  }
}

function latest(cwd, slug) {
  const parts = checkedSlug(slug);
  const { runDir } = runDirOf(cwd, parts);
  if (runDir === null) return 'none';
  const factsDir = join(runDir, 'facts');
  if (!isRealDir(factsDir)) return 'none';
  const name = newestName(factsDir);
  return name === null ? 'none' : ['.company', 'work', ...parts, 'facts', name].join('/');
}

// ---------------------------------------------------------------- CLI

function parseShow(args) {
  const opts = { base: null, head: null, githubOutput: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--github-output') {
      if (opts.githubOutput) refuse('repeated option');
      opts.githubOutput = true;
    } else if (a === '--base' || a === '--head') {
      const key = a.slice(2);
      if (opts[key] !== null || i + 1 >= args.length) refuse('bad option');
      opts[key] = args[++i];
    } else {
      refuse('unknown option');
    }
  }
  if (opts.base === null) refuse('--base is required');
  if (!FULL_ID.test(opts.base) || (opts.head !== null && !FULL_ID.test(opts.head))) refuse('not a full commit id');
  return opts;
}

function appendGithubOutput(facts) {
  const target = process.env.GITHUB_OUTPUT;
  if (typeof target !== 'string' || target === '' || target.includes('\0')) refuse('GITHUB_OUTPUT is not set');
  try { appendFileSync(target, `docs_only=${facts.docs_only}\nui_changed=${facts.ui_changed}\n`); } catch { refuse('GITHUB_OUTPUT not written'); }
}

export function main(argv, cwd = process.cwd()) {
  const [command, ...rest] = argv;
  try {
    if (command === 'show') {
      const opts = parseShow(rest);
      if (opts.githubOutput && (typeof process.env.GITHUB_OUTPUT !== 'string' || process.env.GITHUB_OUTPUT === '')) refuse('GITHUB_OUTPUT is not set');
      const { facts, text } = show(cwd, opts);
      if (opts.githubOutput) appendGithubOutput(facts);
      return { code: 0, out: text };
    }
    if (command === 'write') {
      if (rest.length !== 2) refuse('usage: write <slug> <NN-role>');
      return { code: 0, out: `${write(cwd, rest[0], rest[1])}\n` };
    }
    if (command === 'latest') {
      if (rest.length !== 1) refuse('usage: latest <slug>');
      return { code: 0, out: `${latest(cwd, rest[0])}\n` };
    }
    return refuse('usage: show | write | latest');
  } catch (e) {
    return { code: 2, out: `refused: ${e instanceof Refusal ? e.message : 'internal error'}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = main(process.argv.slice(2));
  process.stdout.write(r.out);
  process.exitCode = r.code;
}
