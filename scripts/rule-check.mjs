#!/usr/bin/env node
// Tool checks bound to ruleset rules by ID (contract: docs/contracts/rule-check.md v1.6). Node built-ins only.
// Rule text is data: it is printed and hashed, never run or put into a command (agentsec.M-SEC7).
// Tools run with spawnSync and an argument array, never through a shell (node.M-SEC1).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { WorkFolderRefusal, branchId, exactWorkPath, isBranchId, isRunSlug, workParts } from '../mods/lib/work-folder.mjs';

const KiB = 1024;
const MiB = 1024 * KiB;
const MAX_CHECKS_BYTES = 64 * KiB;
const MAX_TEXT_BYTES = 256 * KiB;
const MAX_SCAN_BYTES = 64 * MiB;
const MAX_OUTPUT = MiB;
const TOOL_TIMEOUT_MS = 120000;
export const NODE_TEST_TIMEOUT_MS = 480000;
export const NODE_TEST_OUTPUT = 16 * MiB;
const CUT = 120;

const RULE_ID = /^[a-z][a-z0-9-]{0,23}\.(?:M-SEC|M|S|Y)\d+$/;
const RULE_LINE = /^- ([a-z][a-z0-9-]{0,23}\.(?:M-SEC|M|S|Y)\d+) — (.*)$/;
const RULE_ID_ANY = /[a-z][a-z0-9-]{0,23}\.(?:M-SEC|M|S|Y)\d+/g;
const CHECK_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const FULL_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// The run ref of a run name (new name or legacy slug): refs/heads/aico/ plus its branch id, or null when the name is not a work folder.
export function runRef(name) {
  if (typeof name !== 'string' || !isRunSlug(name)) return null;
  const id = branchId(name);
  return typeof id === 'string' && isBranchId(id) ? `refs/heads/aico/${id}` : null;
}
const HASH = /^[0-9a-f]{64}$/;
const MARKERS = [' — why: ', ' — source: ', ' — enforced-by: ', ' — check: '];
const BUILTINS = new Set(['aico-check', 'lf', 'node-test', 'handoff-lint']);
const PACK_SECTIONS = new Set(['Must', 'Should', 'May', 'Security']);
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/;
const MAX_SLICE_BYTES = 6 * KiB;
const RULE_CUT = 200;
const FOCUS_CUT = 1000;
const GITATTRIBUTES_LINE = '* text=auto eol=lf';
const NUL_WINDOW = 8000;
const TEXT_SHOWN_MAX = MiB;
const TEXT_TOTAL_MAX = 8 * MiB;
const TEXT_BUFFER = 16 * MiB;
const LIST_BUFFER = 16 * MiB;
const MAX_CHANGED = 2000;
const BATCH_FILE_MAX = 64 * KiB;
const BATCH_BUDGET = 16 * MiB;
const GIT_TIMEOUT_MS = 60000;
const JUDGING = { id: 'judging-diff', text: 'binary is decided by content, never by attributes' };
const USAGE = [
  'usage: rule-check.mjs <command> [--root <dir>]',
  '  run --base <full id> --run <name> [--handoff <file>]',
  '  text --base <full id> --run <name>',
  '  list',
  '  slices <senior-engineer handoff> [--write]',
  '  drift',
  '  fill-security <standards.md> --packs <dir>'
].join('\n');

class Refusal extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

class ConfigError extends Refusal {
  constructor(reason) {
    super(`tool config invalid: ${reason}`);
    this.reason = reason;
  }
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------- ruleset ----------

export function parseRuleLine(line) {
  const m = RULE_LINE.exec(line);
  if (!m) return null;
  const rest = m[2];
  let end = rest.length;
  for (const marker of MARKERS) {
    const i = rest.indexOf(marker);
    if (i !== -1 && i < end) end = i;
  }
  const at = rest.indexOf(MARKERS[3]);
  const check = at === -1 ? null : rest.slice(at + MARKERS[3].length).trim();
  return { id: m[1], text: rest.slice(0, end), check };
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function readCapped(file, cap, label) {
  const size = fs.statSync(file).size;
  if (size > cap) throw new Refusal(`${label} too large`);
  return fs.readFileSync(file, 'utf8');
}

function sections(text) {
  const out = [];
  let name = '';
  for (const line of text.split(/\r?\n/)) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) name = h[1];
    else out.push({ section: name, line });
  }
  return out;
}

// Rules in force: the Project rules of standards.md first, then the committed packs.
function loadRules(root) {
  const rules = new Map();
  const security = new Set();
  const dir = path.join(root, '.company');
  for (const { section, line } of sections(readCapped(path.join(dir, 'standards.md'), MAX_TEXT_BYTES, 'standards.md'))) {
    if (section !== 'Project rules') continue;
    const r = parseRuleLine(line);
    if (!r || rules.has(r.id)) continue;
    rules.set(r.id, { ...r, project: true });
    if (r.id.includes('-SEC')) security.add(r.id);
  }
  const packDir = path.join(dir, 'standards');
  const files = fs.existsSync(packDir) ? fs.readdirSync(packDir).filter(f => /^[^@/\\]+@[^/\\]+\.md$/.test(f)).sort() : [];
  for (const f of files) {
    const file = path.join(packDir, f);
    if (!isFile(file)) continue;
    for (const { section, line } of sections(readCapped(file, MAX_TEXT_BYTES, f))) {
      if (!PACK_SECTIONS.has(section)) continue;
      const r = parseRuleLine(line);
      if (!r || rules.has(r.id)) continue;
      rules.set(r.id, { ...r, check: null, project: false });
      if (section === 'Security' || r.id.includes('-SEC')) security.add(r.id);
    }
  }
  return { rules, security };
}

// ---------- bindings ----------

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function loadChecks(root) {
  const file = path.join(root, '.company', 'checks.json');
  if (fs.statSync(file).size > MAX_CHECKS_BYTES) throw new ConfigError('checks.json over 64 KiB');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new ConfigError('checks.json is not valid JSON');
  }
  if (!plain(data)) throw new ConfigError('checks.json is not an object');
  for (const key of Object.keys(data)) if (key !== 'version' && key !== 'checks') throw new ConfigError(`unknown key ${key.slice(0, 40)}`);
  if (data.version !== 1) throw new ConfigError('version must be 1');
  if (!plain(data.checks)) throw new ConfigError('checks must be an object');
  const out = new Map();
  for (const [id, b] of Object.entries(data.checks)) {
    if (!CHECK_ID.test(id)) throw new ConfigError('bad check id');
    if (!plain(b)) throw new ConfigError(`check ${id} is not an object`);
    for (const key of Object.keys(b)) if (key !== 'rule' && key !== 'text' && key !== 'argv') throw new ConfigError(`check ${id}: unknown key ${key.slice(0, 40)}`);
    if (typeof b.rule !== 'string' || !RULE_ID.test(b.rule)) throw new ConfigError(`check ${id}: bad rule id`);
    if (typeof b.text !== 'string' || !HASH.test(b.text)) throw new ConfigError(`check ${id}: text must be a SHA-256 hex digest`);
    let argv = null;
    if (Object.hasOwn(b, 'argv')) {
      const a = b.argv;
      if (!Array.isArray(a) || a.length < 1 || a.length > 64 || a[0] === '' || a.some(s => typeof s !== 'string' || s.length > 4096 || s.includes('\0')))
        throw new ConfigError(`check ${id}: argv must be a list of 1-64 strings`);
      argv = a;
    }
    if (BUILTINS.has(id) && argv) throw new ConfigError(`check ${id}: built-in checks take no argv`);
    if (!BUILTINS.has(id) && !argv) throw new ConfigError(`check ${id}: not built in, so argv is required`);
    out.set(id, { rule: b.rule, text: b.text, argv });
  }
  return out;
}

// ---------- tool runner ----------

function resolveCommand(file, args) {
  if (process.platform === 'win32' && (file === 'npm' || file === 'npx')) {
    // The .cmd shims cannot run without a shell; run their JS entry point with this node instead.
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', `${file}-cli.js`);
    if (!fs.existsSync(cli)) return null;
    return { file: process.execPath, args: [cli, ...args] };
  }
  return { file, args };
}

function runTool(file, args, { cwd, timeout, maxBuffer = MAX_OUTPUT }) {
  const command = resolveCommand(file, args);
  if (!command) return { failed: 'cannot find the program' };
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(command.file, command.args, {
    cwd, env, timeout, encoding: 'utf8', maxBuffer, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  if (r.error?.code === 'ETIMEDOUT') return { failed: `timed out after ${timeout / 1000} s` };
  if (r.error) return { failed: r.error.code ?? 'spawn error' };
  if (r.status === null) return { failed: `signal ${r.signal ?? 'unknown'}` };
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// ---------- git (judging calls) ----------

// Signatures of the binary types a product may carry: [offset, hex] parts that must all match for one alternative.
const SIG = (...alts) => Object.freeze(alts.map(parts => Object.freeze(parts.map(p => Object.freeze([...p])))));
const RIFF = (tag) => [[0, '52494646'], [8, Buffer.from(tag).toString('hex')]];
export const BINARY_TYPES = Object.freeze({
  png: SIG([[0, '89504e470d0a1a0a']]),
  jpg: SIG([[0, 'ffd8ff']]),
  jpeg: SIG([[0, 'ffd8ff']]),
  gif: SIG([[0, '474946383761']], [[0, '474946383961']]),
  webp: SIG(RIFF('WEBP')),
  ico: SIG([[0, '00000100']]),
  woff: SIG([[0, '774f4646']]),
  woff2: SIG([[0, '774f4632']]),
  ttf: SIG([[0, '00010000']], [[0, '74727565']]),
  otf: SIG([[0, '4f54544f']]),
  zip: SIG([[0, '504b0304']], [[0, '504b0506']]),
  gz: SIG([[0, '1f8b']]),
  tgz: SIG([[0, '1f8b']]),
  pdf: SIG([[0, '255044462d']]),
  mp3: SIG([[0, '494433']], [[0, 'fffb']], [[0, 'fff3']], [[0, 'fff2']]),
  wav: SIG(RIFF('WAVE')),
  ogg: SIG([[0, '4f676753']]),
  flac: SIG([[0, '664c6143']]),
  mp4: SIG([[4, '66747970']]),
  m4a: SIG([[4, '66747970']]),
  mov: SIG([[4, '66747970']]),
  webm: SIG([[0, '1a45dfa3']])
});

export function isRealBinaryType(file, bytes) {
  const name = file.slice(file.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = name.slice(dot + 1).replace(/[A-Z]/g, c => c.toLowerCase());
  if (!Object.hasOwn(BINARY_TYPES, ext)) return false;
  return BINARY_TYPES[ext].some(parts => parts.every(([at, hex]) => bytes.subarray(at, at + hex.length / 2).toString('hex') === hex));
}

const hasNul = bytes => bytes.subarray(0, NUL_WINDOW).includes(0);

// The environment of every git child: the parent's without any GIT_ key, then only this script's own fixed keys.
function gitBaseEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^GIT_/i.test(key)) env[key] = value;
  return env;
}

const GIT_FIXED = ['--no-replace-objects', '-c', 'core.fsmonitor=false'];
const JUDGE = ['--literal-pathspecs', '-c', 'diff.ignoreSubmodules=none', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-relative', '--ignore-submodules=none'];

function runGit(args, { cwd, env, maxBuffer = LIST_BUFFER, input }) {
  const r = spawnSync('git', args, { cwd, env, maxBuffer, input, timeout: GIT_TIMEOUT_MS, shell: false, windowsHide: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  const cut = r.error?.code === 'ENOBUFS';
  if (r.error && !cut) return { failed: r.error.code ?? 'spawn error' };
  if (!cut && r.status === null) return { failed: `signal ${r.signal ?? 'unknown'}` };
  return { status: cut ? 0 : r.status, out: r.stdout ?? Buffer.alloc(0), overflow: cut };
}

// Opens the git session every judging call runs in: top level, grafts off, replace refs off, GIT_ keys dropped.
// Returns { ok: false, reason } when git cannot be used safely, else { ok: true, git }.
export function gitTopLevel(cwd) {
  const r = runGit([...GIT_FIXED, 'rev-parse', '--show-toplevel'], { cwd, env: gitBaseEnv() });
  return r.failed || r.status !== 0 ? '' : r.out.toString('utf8').replace(/\r?\n$/, '');
}

export function openGit(cwd, seam = {}) {
  const plain = gitBaseEnv();
  // One call for the top level and the object format; an older git without the second flag falls back to the first alone.
  const first = runGit([...GIT_FIXED, 'rev-parse', '--show-toplevel', '--show-object-format'], { cwd, env: plain });
  const parts = first.failed || first.status !== 0 ? [] : first.out.toString('utf8').split('\n');
  const combined = parts.length === 3 && parts[2] === '' && parts[0] !== '';
  const top = combined ? parts[0].replace(/\r$/, '') : gitTopLevel(cwd);
  if (!top) return { ok: false, reason: 'git unavailable' };
  const format = combined ? parts[1].trim() : '';
  const cwdTop = top;
  const query = seam.graftQuery ? seam.graftQuery() : runGit([...GIT_FIXED, 'rev-parse', '--git-path', 'info/grafts'], { cwd: cwdTop, env: { ...plain, GIT_NO_REPLACE_OBJECTS: '1' } });
  const printed = query.failed || query.status !== 0 ? '' : Buffer.from(query.out).toString('utf8').replace(/\r?\n$/, '');
  if (!printed) return { ok: false, reason: 'grafts file present' };
  try {
    fs.lstatSync(path.resolve(cwdTop, printed));
    return { ok: false, reason: 'grafts file present' };
  } catch (error) {
    if (error.code !== 'ENOENT') return { ok: false, reason: 'grafts file present' };
  }
  const missing = path.join(os.tmpdir(), `aico-no-grafts-${crypto.randomBytes(8).toString('hex')}`);
  try {
    fs.lstatSync(missing);
    return { ok: false, reason: 'git unavailable' };
  } catch (error) {
    if (error.code !== 'ENOENT') return { ok: false, reason: 'git unavailable' };
  }
  const env = { ...plain, GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: missing };
  const diffEnv = { ...env, GIT_LITERAL_PATHSPECS: '1' };
  const git = {
    top: cwdTop,
    links: new Map(),
    env,
    diffEnv,
    run: (args, o = {}) => runGit([...GIT_FIXED, ...args], { cwd: cwdTop, env, ...o }),
    // The judging diff: mode flags, then --end-of-options, the endpoints, and at most one path.
    diff: (mode, endpoints, file, o = {}) => runGit([...GIT_FIXED, ...JUDGE, ...mode, '--end-of-options', ...endpoints, ...(file === undefined ? [] : ['--', file])], { cwd: cwdTop, env: diffEnv, ...o }),
    head: () => {
      const r = runGit([...GIT_FIXED, 'symbolic-ref', '-q', 'HEAD'], { cwd: cwdTop, env });
      return r.failed || r.status !== 0 ? null : r.out.toString('utf8');
    },
    // 40 for sha1, 64 for sha256, 0 when this git cannot say.
    objectLength: () => (format === 'sha256' ? 64 : format === 'sha1' ? 40 : 0),
    files: new Map()
  };
  return { ok: true, git };
}

// The names a judging diff prints with -z, or null on a git failure.
// Names that are not valid UTF-8 cannot be passed back to git as text: they are left out and, when `bad` is given, collected there.
function diffNames(git, mode, endpoints, bad = null) {
  const r = git.diff(['-z', '--name-only', '--no-renames', ...mode], endpoints);
  if (r.failed || r.status !== 0 || r.overflow) return null;
  const names = [];
  for (const part of r.out.toString('latin1').split('\0')) {
    if (!part) continue;
    const raw = Buffer.from(part, 'latin1');
    const name = raw.toString('utf8');
    if (Buffer.from(name, 'utf8').equals(raw)) names.push(name);
    else bad?.add(name);
  }
  return names;
}

// The paths a tree holds as submodule entries (their commits are not in this repository), or null on a git failure.
function gitlinks(git, treeish) {
  if (git.links.has(treeish)) return git.links.get(treeish);
  const r = git.run(['ls-tree', '-r', '-z', '--full-tree', treeish]);
  let links = null;
  if (!r.failed && r.status === 0 && !r.overflow) {
    links = new Set();
    for (const entry of r.out.toString('utf8').split('\0')) {
      const m = /^160000 commit [0-9a-f]+\t([\s\S]+)$/.exec(entry);
      if (m) links.add(m[1]);
    }
  }
  git.links.set(treeish, links);
  return links;
}

// First 8000 bytes of a blob and whether it is one: { blob: true, bytes } | { blob: false } | null (git failed).
function probeBlob(git, treeish, file) {
  const r = git.run(['cat-file', 'blob', '--end-of-options', `${treeish}:${file}`], { maxBuffer: NUL_WINDOW });
  if (!r.failed && r.status === 0) return { blob: true, bytes: r.out.subarray(0, NUL_WINDOW) };
  const links = gitlinks(git, treeish);
  return links !== null && links.has(file) ? { blob: false } : null;
}

// Changed files as blobs, most of them in two git calls: Map(file -> { blob, bytes, size, whole }), or null on a git failure.
// `bytes` is the whole blob when `whole` is true, else its first 8000 bytes. Large files and odd names go one at a time.
function loadFiles(git, treeish, files) {
  const out = new Map();
  const single = [];
  const listed = [];
  for (const file of files) (/[\r\n]/.test(file) ? single : listed).push(file);
  if (listed.length) {
    const check = git.run(['cat-file', '--batch-check'], { input: listed.map(file => `${treeish}:${file}\n`).join('') });
    if (check.failed || check.status !== 0 || check.overflow) return null;
    const infos = check.out.toString('utf8').split('\n');
    const small = [];
    let budget = BATCH_BUDGET;
    listed.forEach((file, i) => {
      const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(infos[i] ?? '');
      const size = m ? Number(m[2]) : 0;
      if (m && m[1] === 'blob' && size <= BATCH_FILE_MAX && size <= budget) {
        budget -= size;
        small.push([file, size]);
      } else if (m && m[1] === 'commit') out.set(file, { blob: false });
      else single.push(file);
    });
    if (small.length) {
      const read = git.run(['cat-file', '--batch'], { input: small.map(([file]) => `${treeish}:${file}\n`).join(''), maxBuffer: BATCH_BUDGET + MiB });
      if (read.failed || read.status !== 0 || read.overflow) return null;
      let at = 0;
      for (const [file, size] of small) {
        const end = read.out.indexOf(10, at);
        const m = end === -1 ? null : /^[0-9a-f]+ blob (\d+)$/.exec(read.out.toString('latin1', at, end));
        if (!m || Number(m[1]) !== size || end + 1 + size > read.out.length) return null;
        out.set(file, { blob: true, bytes: read.out.subarray(end + 1, end + 1 + size), size, whole: true });
        at = end + 1 + size + 1;
      }
    }
  }
  for (const file of single) {
    const p = probeBlob(git, treeish, file);
    if (p === null) return null;
    out.set(file, p.blob ? { blob: true, bytes: p.bytes, size: p.bytes.length < NUL_WINDOW ? p.bytes.length : null, whole: p.bytes.length < NUL_WINDOW } : { blob: false });
  }
  return out;
}

function blobSize(git, spec) {
  const r = git.run(['cat-file', '-s', '--end-of-options', spec]);
  if (r.failed || r.status !== 0) return null;
  const n = Number(r.out.toString('utf8').trim());
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

// Rows for binary-marked text and for binary content, plus the text-by-content paths `text` may show.
function binaryFacts(git, base, ref) {
  const rows = [];
  const shown = [];
  const num = git.diff(['--numstat', '-z', '--no-renames'], [base, ref]);
  if (num.failed || num.status !== 0 || num.overflow) return { failed: true };
  const marked = [];
  for (const entry of num.out.toString('utf8').split('\0')) {
    const m = /^(\S+)\t(\S+)\t([\s\S]+)$/.exec(entry);
    if (m && m[1] === '-' && m[2] === '-') marked.push(m[3]);
  }
  const bad = new Set();
  const tipNames = diffNames(git, ['--diff-filter=d'], [base, ref], bad);
  if (tipNames === null || marked.length > MAX_CHANGED || tipNames.length > MAX_CHANGED) return { failed: true };
  if (marked.length) {
    const added = diffNames(git, ['--diff-filter=A'], [base, ref], bad);
    const deleted = diffNames(git, ['--diff-filter=D'], [base, ref], bad);
    if (added === null || deleted === null) return { failed: true };
    const noBase = new Set(added);
    const noTip = new Set(deleted);
    for (const file of marked) {
      if (bad.has(file)) continue;
      let text = false;
      let large = false;
      const sides = [...(noBase.has(file) ? [] : [base]), ...(noTip.has(file) ? [] : [ref])];
      for (const treeish of sides) {
        const p = probeBlob(git, treeish, file);
        if (p === null) return { failed: true };
        if (!p.blob || hasNul(p.bytes)) continue;
        const size = blobSize(git, `${treeish}:${file}`);
        if (size === null) return { failed: true };
        text = true;
        if (size > TEXT_SHOWN_MAX) large = true;
      }
      if (!text) continue;
      rows.push({ file, problem: large ? 'binary-marked file too large to show' : 'text shown as binary' });
      if (!large) shown.push(file);
    }
  }
  for (const file of bad) rows.push({ file, problem: 'path not UTF-8' });
  const tipFiles = loadFiles(git, ref, tipNames);
  if (tipFiles === null) return { failed: true };
  for (const [file, entry] of tipFiles) git.files.set(file, entry);
  for (const file of tipNames) {
    const p = tipFiles.get(file);
    if (!p) return { failed: true };
    if (!p.blob || !hasNul(p.bytes)) continue;
    rows.push({ file, problem: isRealBinaryType(file, p.bytes) ? 'binary file changed' : 'binary content in a text path' });
  }
  return { rows, shown };
}

// The run session of `run` and `text`: the arguments, then HEAD on the run branch, then no grafts. Throws a Refusal (3).
function runSession(root, base, slug, seam) {
  const opened = openGit(root, seam);
  if (!opened.ok) throw new Refusal(opened.reason, 3);
  const ref = runRef(slug);
  if (ref === null) throw new Refusal('bad run', 3);
  if (opened.git.head() !== `${ref}\n`) throw new Refusal('head not on run branch', 3);
  const length = opened.git.objectLength();
  if (length !== 0 && base.length !== length) throw new Refusal('bad base', 3);
  return { git: opened.git, ref };
}

// ---------- rows ----------

// Controls, format characters (bidi, zero-width, tag characters, BOM) and line and paragraph separators.
const HIDDEN_RUN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
function clean(value) {
  return String(value).replace(HIDDEN_RUN, ' ').replace(/\|/g, '¦').trim();
}

function cut(value, n = CUT) {
  const s = clean(value);
  return s.length > n ? s.slice(0, n) : s;
}

function row(n, file, problem, rule, fix = 'see rule') {
  const ruleCell = rule ? `${rule.id}: ${cut(rule.text)}` : 'none';
  return `T-${n} | ${clean(file)} | ${clean(problem)} | ${ruleCell} | ${clean(fix)}`;
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

// ---------- built-in checks: each returns { findings: [{file, problem, fix}] } or { failed } ----------

function checkAico(ctx) {
  const r = runTool(process.execPath, [path.join(import.meta.dirname, 'check.mjs'), ctx.root], ctx);
  if (r.failed) return r;
  if (r.status !== 0 && r.status !== 1) return { failed: `exit ${r.status}` };
  const findings = [];
  for (const line of r.out.split(/\r?\n/)) {
    const m = /^WARN (.+): (\S+) (\d+) > (\d+) lines$/.exec(line);
    if (m) findings.push({ file: m[1], problem: `${m[2]} ${m[3]} > ${m[4]} lines`, fix: 'move detail to references/ files' });
  }
  return { findings };
}

function firstCr(bytes) {
  const at = bytes.indexOf(13);
  if (at === -1) return 0;
  let line = 1;
  for (let i = 0; i < at; i++) if (bytes[i] === 10) line++;
  return line;
}

// Reads every changed file as its tip blob, never from the worktree, and decides binary by content.
function checkLf(ctx) {
  const { git, ref, base } = ctx;
  const names = diffNames(git, ['--diff-filter=ACMR'], [base, ref]);
  if (names === null) return { failed: 'git failed' };
  if (names.length > MAX_CHANGED) return { failed: 'too many changed files' };
  const findings = [];
  const missing = names.filter(name => !git.files.has(name));
  if (missing.length) {
    const more = loadFiles(git, ref, missing);
    if (more === null) return { failed: 'git failed' };
    for (const [file, entry] of more) git.files.set(file, entry);
  }
  for (const name of names) {
    const entry = git.files.get(name);
    if (!entry) return { failed: 'git failed' };
    if (!entry.blob || hasNul(entry.bytes)) continue;
    let bytes = entry.bytes;
    if (!entry.whole) {
      const size = entry.size ?? blobSize(git, `${ref}:${name}`);
      if (size === null) return { failed: 'git failed' };
      if (size > MAX_SCAN_BYTES) {
        findings.push({ file: name, problem: 'too large to scan for CR bytes', fix: 'see rule' });
        continue;
      }
      const whole = git.run(['cat-file', 'blob', '--end-of-options', `${ref}:${name}`], { maxBuffer: size + KiB });
      if (whole.failed || whole.status !== 0 || whole.overflow) return { failed: 'git failed' };
      bytes = whole.out;
    }
    const line = firstCr(bytes);
    if (line) findings.push({ file: `${name}:${line}`, problem: 'CR byte in text file', fix: 'convert to LF' });
  }
  const attr = git.run(['cat-file', 'blob', '--end-of-options', `${ref}:.gitattributes`], { maxBuffer: MiB });
  const attributes = attr.failed || attr.status !== 0 ? [] : attr.out.toString('utf8').split(/\r?\n/).map(l => l.trim());
  if (!attributes.includes(GITATTRIBUTES_LINE))
    findings.push({ file: '.gitattributes', problem: `missing line "${GITATTRIBUTES_LINE}"`, fix: 'restore the line' });
  return { findings };
}


function failingTestName(output) {
  for (const line of output.split(/\r?\n/)) {
    const tap = /^\s*not ok \d+ - (.+?)(?:\s+#.*)?$/.exec(line);
    if (tap) return tap[1];
    const spec = /^\s*✖ (.+?)(?: \([\d.]+ms\))?$/.exec(line);
    if (spec && !spec[1].startsWith('failing tests')) return spec[1];
  }
  return null;
}

function checkNodeTest(ctx) {
  const r = runTool('npm', ['test'], { cwd: ctx.root, timeout: ctx.nodeTestTimeout, maxBuffer: NODE_TEST_OUTPUT });
  if (r.failed) return r;
  if (r.status === 0) return { findings: [] };
  const name = failingTestName(`${r.out}\n${r.err}`);
  return { findings: [{ file: 'package.json', problem: `npm test failed: ${name ? cut(name) : `exit ${r.status}`}`, fix: 'see rule' }] };
}

function checkHandoffLint(ctx) {
  if (!ctx.handoff) return { failed: 'no --handoff given' };
  const r = runTool(process.execPath, [path.join(import.meta.dirname, 'handoff-lint.mjs'), ctx.handoff], ctx);
  if (r.failed) return r;
  if (r.status === 0) return { findings: [] };
  if (r.status !== 1) return { failed: `exit ${r.status}` };
  const file = rel(ctx.root, ctx.handoff);
  const errors = r.out.split(/\r?\n/).filter(l => l.startsWith('ERROR '));
  const lines = errors.length ? errors.map(l => l.slice(6)) : ['handoff-lint exited 1'];
  return { findings: lines.map(problem => ({ file, problem, fix: 'see rule' })) };
}

function checkArgv(id, argv, ctx) {
  const r = runTool(argv[0], argv.slice(1), ctx);
  if (r.failed) return r;
  if (r.status === 0) return { findings: [] };
  const first = `${r.out}\n${r.err}`.split(/\r?\n/).find(l => l.trim()) ?? '';
  return { findings: [{ file: '-', problem: `${id} exited ${r.status}: ${cut(first)}`, fix: 'see rule' }] };
}

// ---------- commands ----------

function ruleset(root) {
  return {
    standards: isFile(path.join(root, '.company', 'standards.md')),
    checks: isFile(path.join(root, '.company', 'checks.json'))
  };
}

function cmdRun(a, opts) {
  const { git, ref } = runSession(a.root, a.base, a.run, opts.seam);
  const head = [];
  let n = 0;
  const facts = binaryFacts(git, a.base, ref);
  if (facts.failed) head.push(row(++n, '-', 'tool failed: binary-content', JUDGING));
  else for (const r of facts.rows) head.push(row(++n, r.file, r.problem, JUDGING));
  const done = (code, lines) => ({ code, lines: [...head, ...lines] });
  const st = ruleset(a.root);
  if (!st.standards && !st.checks) return done(0, ['no ruleset']);
  if (!st.checks) return done(0, ['no checks bound']);
  if (!st.standards) return done(0, [row(0, '.company/checks.json', 'tool config invalid: .company/standards.md is missing', null, 'restore the ruleset')]);
  let checks;
  try {
    checks = loadChecks(a.root);
  } catch (error) {
    if (error instanceof ConfigError) return done(2, [row(0, '.company/checks.json', `tool config invalid: ${error.reason}`, null, 'fix checks.json')]);
    throw error;
  }
  const { rules } = loadRules(a.root);
  const timeout = opts.timeoutMs ?? TOOL_TIMEOUT_MS;
  const ctx = { root: a.root, cwd: a.root, git, ref, base: a.base, handoff: a.handoff, timeout, nodeTestTimeout: opts.timeoutMs ?? NODE_TEST_TIMEOUT_MS };
  const lines = [];
  for (const [id, b] of checks) {
    const rule = rules.get(b.rule);
    if (!rule || sha256(rule.text) !== b.text) {
      lines.push(row(0, '.company/checks.json', `tool config invalid: binding ${id} is out of date (run drift)`, null, 'rebind the check'));
      continue;
    }
    let result;
    if (b.argv) result = checkArgv(id, b.argv, ctx);
    else if (id === 'aico-check') result = checkAico(ctx);
    else if (id === 'lf') result = checkLf(ctx);
    else if (id === 'node-test') result = checkNodeTest(ctx);
    else result = checkHandoffLint(ctx);
    if (result.failed) lines.push(row(++n, '-', `tool failed: ${id} (${result.failed})`, rule));
    else for (const f of result.findings) lines.push(row(++n, f.file, f.problem, rule, f.fix));
  }
  return done(0, lines);
}

// ---------- text: the --text diff of binary-marked text files ----------

const HIDDEN_ONE = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]$/u;
const hex = (n, width) => n.toString(16).padStart(width, '0');

// Text for a reader: C0 controls except tab and LF, DEL and invalid UTF-8 bytes as \x<hh>; C1 and bidi controls as \u<hhhh>.
export function escapeBytes(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += b === 9 || b === 10 || (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : `\\x${hex(b, 2)}`;
      i++;
      continue;
    }
    let need = 0;
    let cp = 0;
    let min = 0;
    if (b >= 0xc2 && b <= 0xdf) [need, cp, min] = [1, b & 0x1f, 0x80];
    else if (b >= 0xe0 && b <= 0xef) [need, cp, min] = [2, b & 0x0f, 0x800];
    else if (b >= 0xf0 && b <= 0xf4) [need, cp, min] = [3, b & 0x07, 0x10000];
    let valid = need > 0 && i + need < bytes.length;
    for (let k = 1; valid && k <= need; k++) {
      const c = bytes[i + k];
      if ((c & 0xc0) !== 0x80) valid = false;
      else cp = (cp << 6) | (c & 0x3f);
    }
    if (!valid || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      out += `\\x${hex(b, 2)}`;
      i++;
      continue;
    }
    out += HIDDEN_ONE.test(String.fromCodePoint(cp)) ? `\\u${hex(cp, 4)}` : String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}

function cmdText(a, opts) {
  const { git, ref } = runSession(a.root, a.base, a.run, opts.seam);
  const facts = binaryFacts(git, a.base, ref);
  if (facts.failed) return { code: 1, lines: ['tool failed: text'] };
  if (!facts.shown.length) return { code: 0, lines: ['no binary-marked text files'] };
  // Every path is checked before any section is printed.
  for (const file of facts.shown) {
    const r = git.diff(['--name-only', '-z'], [a.base, ref], file);
    if (r.failed || r.status !== 0 || r.overflow) return { code: 1, lines: ['tool failed: text'] };
    if (r.out.toString('utf8') !== `${file}\0`) throw new Refusal(`path check failed ${clean(file)}`, 3);
  }
  const lines = [];
  let total = 0;
  let capped = false;
  for (const file of facts.shown) {
    let section = null;
    if (!capped) {
      let out;
      try {
        out = execFileSync('git', [...GIT_FIXED, ...JUDGE, '--text', '--no-renames', '--end-of-options', a.base, ref, '--', file], {
          cwd: git.top, env: git.diffEnv, maxBuffer: opts.seam?.textBuffer ?? TEXT_BUFFER, timeout: GIT_TIMEOUT_MS, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
        });
      } catch {
        return { code: 1, lines: ['tool failed: text'] };
      }
      section = `text ${escapeBytes(Buffer.from(clean(file), 'utf8'))}\n${escapeBytes(out).replace(/\n$/, '')}`;
      if (total + Buffer.byteLength(section, 'utf8') > TEXT_TOTAL_MAX) capped = true;
      else total += Buffer.byteLength(section, 'utf8');
    }
    lines.push(capped ? `text not shown (output cap) ${clean(file)}` : section);
  }
  return { code: 0, lines };
}

function cmdList(a) {
  if (!ruleset(a.root).checks) return { code: 0, lines: [] };
  return { code: 0, lines: [...loadChecks(a.root)].map(([id, b]) => `${b.rule} ${id}`) };
}

// ---------- slices and slice files ----------

// The task lines of `## Rules per task`: { cell0 (the first cell), rest (everything after it) }.
function taskRows(text) {
  const rows = [];
  let tableRow = -1;
  for (const { section, line } of sections(text)) {
    if (section !== 'Rules per task') continue;
    if (!line.startsWith('|')) {
      tableRow = -1;
      continue;
    }
    tableRow++;
    if (tableRow === 0 || /^\|[\s:|-]+\|?\s*$/.test(line)) continue;
    const m = /^\|([^|]*)(?:\|(.*))?$/.exec(line);
    rows.push({ cell0: m[1].trim(), rest: (m[2] ?? '').replace(/\|\s*$/, '').trim() });
  }
  return rows;
}

function cutWord(value, n) {
  if (value.length <= n) return value;
  let s = value.slice(0, n);
  if (value[n] !== ' ') {
    const i = s.lastIndexOf(' ');
    if (i > 0) s = s.slice(0, i);
  }
  return `${s.trimEnd()}…`;
}

const uniq = list => [...new Set(list)];

// Renders one slice file from its row; returns the text or throws a Refusal (exit code 1).
function renderSlice(row, { rules, security }, source) {
  const task = row.cell0;
  if (!TASK_ID.test(task)) throw new Refusal(`bad task id ${task.slice(0, 35)}`, 1);
  const f = row.rest.indexOf('focus:');
  let focus = '';
  let outside = row.rest;
  if (f !== -1) {
    const e = row.rest.indexOf('; security:', f);
    const end = e === -1 ? row.rest.length : e;
    focus = row.rest.slice(f + 'focus:'.length, end).trim();
    outside = `${row.rest.slice(0, f)} ${row.rest.slice(end)}`;
  }
  const ids = uniq(outside.match(RULE_ID_ANY) ?? []);
  for (const id of ids) if (!rules.has(id)) throw new Refusal(`unknown rule ${id} in ${task}`, 1);
  const sec = uniq(row.rest.match(RULE_ID_ANY) ?? []).filter(id => security.has(id));
  const lines = ['---', `task: ${task}`, `source: ${source}`, '---', '## Rules'];
  for (const id of ids) {
    if (security.has(id)) continue;
    lines.push(`- ${id} — ${cutWord(rules.get(id).text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(), RULE_CUT)}`);
  }
  lines.push('## Focus', `> ${focus ? focus.slice(0, FOCUS_CUT) : '(none)'}`, '## Security', sec.join(', '));
  const content = `${lines.join('\n')}\n`;
  if (Buffer.byteLength(content, 'utf8') > MAX_SLICE_BYTES) throw new Refusal(`slice ${task} over 6 KiB`, 1);
  return content;
}

// Renders every row: { rendered: Map(task -> text), problems: [reason] }.
function renderAll(rows, ctx, source) {
  const rendered = new Map();
  const problems = [];
  for (const row of rows) {
    try {
      if (rendered.has(row.cell0)) throw new Refusal(`duplicate task id ${row.cell0.slice(0, 35)}`, 1);
      rendered.set(row.cell0, renderSlice(row, ctx, source));
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      problems.push(error.message);
    }
  }
  return { rendered, problems };
}

function lstatOrNull(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// The entries of rules/: only regular `*.md` files are ours; anything else is foreign.
function ruleEntries(rulesDir) {
  const st = lstatOrNull(rulesDir);
  if (!st) return { exists: false, names: [], foreign: false };
  if (!st.isDirectory()) return { exists: true, names: [], foreign: true };
  const names = [];
  let foreign = false;
  for (const name of fs.readdirSync(rulesDir)) {
    const e = fs.lstatSync(path.join(rulesDir, name));
    if (e.isFile() && name.endsWith('.md')) names.push(name);
    else foreign = true;
  }
  return { exists: true, names, foreign };
}

function writeSlices(dir, rendered, entries) {
  const rulesDir = path.join(dir, 'rules');
  if (!entries.exists) fs.mkdirSync(rulesDir);
  const inside = path.join(fs.realpathSync(dir), 'rules');
  if (fs.realpathSync(rulesDir) !== inside) throw new Refusal('unexpected entry in rules/', 1);
  for (const [task, content] of rendered) {
    const target = path.join(rulesDir, `${task}.md`);
    const where = path.relative(rulesDir, target);
    if (where !== `${task}.md`) throw new Refusal(`bad task id ${task.slice(0, 35)}`, 1);
    const tmp = path.join(dir, `.rules-${process.pid}-${task}.tmp`);
    try {
      fs.writeFileSync(tmp, content, { flag: 'wx' });
      fs.renameSync(tmp, target);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  for (const name of entries.names) if (!rendered.has(name.slice(0, -3))) fs.unlinkSync(path.join(rulesDir, name));
}

function sliceFileGaps(dir, rows, rendered, entries) {
  const gaps = [];
  if (entries.foreign) gaps.push('unexpected entry in rules/');
  const tasks = new Set(rows.map(r => r.cell0));
  for (const name of entries.names) if (!tasks.has(name.slice(0, -3))) gaps.push(`slice without row: ${cut(name, 40)}`);
  for (const [task, content] of rendered) {
    if (!entries.names.includes(`${task}.md`)) {
      gaps.push(`slice missing: ${task}`);
      continue;
    }
    const file = path.join(dir, 'rules', `${task}.md`);
    if (fs.statSync(file).size > MAX_SLICE_BYTES * 2 || fs.readFileSync(file, 'utf8') !== content) gaps.push(`slice stale: ${task}`);
  }
  return gaps;
}

function cmdSlices(a) {
  if (!ruleset(a.root).standards) return { code: 0, lines: ['no ruleset'] };
  const file = path.resolve(a.positional);
  if (!isFile(file)) throw new Refusal('bad handoff');
  const text = readCapped(file, MAX_TEXT_BYTES, 'handoff');
  const ctx = loadRules(a.root);
  if (!/^## Rules per task\s*$/m.test(text)) return { code: 1, lines: ['## Rules per task is missing'] };
  const rows = taskRows(text);
  const gaps = [];
  for (const row of rows) {
    const listed = new Set(row.rest.match(RULE_ID_ANY) ?? []);
    const missing = [...ctx.security].filter(id => !listed.has(id));
    if (missing.length) gaps.push(`${cut(row.cell0, 40)}: missing ${missing.join(', ')}`);
  }
  if (!rows.length) return { code: 1, lines: ['## Rules per task has no task lines'] };

  const dir = path.dirname(file);
  const source = rel(a.root, file);
  const entries = ruleEntries(path.join(dir, 'rules'));
  const lines = [];
  if (a.write || entries.exists) {
    if (a.write && (source.startsWith('..') || path.isAbsolute(source))) throw new Refusal('bad handoff');
    const { rendered, problems } = renderAll(rows, ctx, source);
    if (a.write) {
      if (problems.length || entries.foreign) {
        const reasons = problems.length ? problems : ['unexpected entry in rules/'];
        return { code: 1, lines: reasons.map(p => `refused: ${p}`) };
      }
      writeSlices(dir, rendered, entries);
      lines.push(`wrote ${rendered.size} slices`);
      gaps.push(...sliceFileGaps(dir, rows, rendered, ruleEntries(path.join(dir, 'rules'))));
    } else {
      gaps.push(...problems.map(p => `slice invalid: ${p}`), ...sliceFileGaps(dir, rows, rendered, entries));
    }
  }
  if (gaps.length) return { code: 1, lines: [...lines, ...gaps] };
  return { code: 0, lines: [...lines, `slices ok: ${rows.length} task line(s)`] };
}

function cmdDrift(a) {
  const st = ruleset(a.root);
  if (!st.standards && !st.checks) return { code: 0, lines: ['no ruleset'] };
  const lines = [];
  const checks = st.checks ? loadChecks(a.root) : new Map();
  if (!st.standards) {
    for (const [id, b] of checks) lines.push(`binding ${id}: rule ${b.rule} missing (no .company/standards.md)`);
    if (!lines.length) lines.push('checks.json without standards.md');
    return { code: 1, lines };
  }
  const { rules } = loadRules(a.root);
  for (const [id, b] of checks) {
    const rule = rules.get(b.rule);
    if (!rule) {
      lines.push(`binding ${id}: rule ${b.rule} missing`);
      continue;
    }
    if (sha256(rule.text) !== b.text) lines.push(`binding ${id}: rule ${b.rule} text changed (rebind after sign-off)`);
    if (rule.project && rule.check !== id) lines.push(`binding ${id}: rule ${b.rule} does not carry check:${id}`);
  }
  for (const rule of rules.values()) {
    if (!rule.project || rule.check === null || rule.check === 'judgment') continue;
    if (!CHECK_ID.test(rule.check)) {
      lines.push(`rule ${rule.id}: invalid check tag`);
      continue;
    }
    const b = checks.get(rule.check);
    if (!b || b.rule !== rule.id) lines.push(`rule ${rule.id} carries check:${rule.check} but no binding for it`);
  }
  return { code: lines.length ? 1 : 0, lines: lines.length ? lines : ['drift ok'] };
}

// ---------- fill-security ----------

const FILL_HEADING = '## Security rows (filled by rule-check)';
const SEC_MUST = /^[a-z][a-z0-9-]{0,23}\.M-SEC\d+$/;
const PACK_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}@[A-Za-z0-9._-]{1,40}\.md$/;
const PACK_ENTRY = /^- (\S+)(?: — .*)?$/;
// As plan-tasks.mjs: control and format characters (zero-width, bidi, tag), line and paragraph separators; a tab is kept.
const UNSAFE_CHARS = /(?!\t)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const LONG_LINE = 1000;

function regularFile(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

function listedPacks(text) {
  const names = [];
  const skipped = [];
  for (const { section, line } of sections(text)) {
    if (section !== 'Packs') continue;
    const m = PACK_ENTRY.exec(line);
    if (!m) continue;
    const name = m[1].slice(Math.max(m[1].lastIndexOf('/'), m[1].lastIndexOf('\\')) + 1);
    if (!PACK_FILE.test(name)) skipped.push(`pack not read ${cut(name, 35)}`);
    else if (!names.includes(name)) names.push(name);
  }
  return { names, skipped };
}

function cmdFillSecurity(a) {
  if (typeof a.packs !== 'string' || typeof a.positional !== 'string') throw new Refusal(USAGE);
  const file = path.resolve(a.positional);
  if (!regularFile(file)) throw new Refusal('standards file is not a regular file');
  const text = readCapped(file, MAX_TEXT_BYTES, 'standards file');
  if (text.includes('\r')) throw new Refusal('standards file has CR bytes');
  const packDir = path.resolve(a.packs);
  let dirStat;
  try {
    dirStat = fs.lstatSync(packDir);
  } catch {
    dirStat = null;
  }
  if (!dirStat || !dirStat.isDirectory()) throw new Refusal('bad packs folder');
  const lines = text.split('\n');
  if (lines.filter(l => l.trimEnd() === FILL_HEADING).length > 1) throw new Refusal('marker heading appears twice');

  const have = new Set();
  for (const { section, line } of sections(text)) {
    if (section !== 'Project rules' && section !== FILL_HEADING.slice(3)) continue;
    const r = parseRuleLine(line);
    if (r) have.add(r.id);
  }

  const { names, skipped } = listedPacks(text);
  const report = [...skipped];
  const rows = [];
  for (const name of names) {
    const packFile = path.join(packDir, name);
    if (!regularFile(packFile)) {
      report.push(`pack not read ${name}`);
      continue;
    }
    let packText;
    try {
      packText = readCapped(packFile, MAX_TEXT_BYTES, name);
    } catch {
      report.push(`pack not read ${name}`);
      continue;
    }
    for (const { section, line } of sections(packText)) {
      if (section !== 'Must' && section !== 'Security') continue;
      const r = parseRuleLine(line);
      if (!r || !SEC_MUST.test(r.id) || have.has(r.id)) continue;
      have.add(r.id);
      if (UNSAFE_CHARS.test(line)) {
        report.push(`skipped ${r.id} (control character in the pack line)`);
        continue;
      }
      rows.push({ id: r.id, line });
      if (line.length > LONG_LINE) report.push(`long ${r.id} (${line.length} characters, copied whole)`);
    }
  }
  if (!rows.length) return { code: 0, lines: [...report, 'nothing to add'] };

  const added = rows.map(r => r.line);
  let next;
  const at = lines.findIndex(l => l.trimEnd() === FILL_HEADING);
  if (at === -1) {
    const body = text.endsWith('\n') || text === '' ? text : `${text}\n`;
    const gap = body === '' || body.endsWith('\n\n') ? '' : '\n';
    next = `${body}${gap}${FILL_HEADING}\n${added.join('\n')}\n`;
  } else {
    let end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
    if (end === -1) end = lines.length;
    let insert = end;
    while (insert > at + 1 && lines[insert - 1].trim() === '') insert--;
    const copy = [...lines];
    copy.splice(insert, 0, ...added);
    next = copy.join('\n');
    if (!next.endsWith('\n')) next += '\n';
  }
  if (Buffer.byteLength(next, 'utf8') > MAX_TEXT_BYTES) throw new Refusal('standards file would pass its size cap');

  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temp, next, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw new Refusal(`cannot write standards file (${error.code ?? 'error'})`);
  }
  return { code: 0, lines: [...report, ...rows.map(r => `added ${r.id}`)] };
}

// ---------- CLI ----------

function parseArgs(args) {
  const [command, ...rest] = args;
  const allowed = {
    run: ['--root', '--base', '--run', '--handoff'], text: ['--base', '--run'], list: ['--root'], slices: ['--root', '--write'], drift: ['--root'], 'fill-security': ['--root', '--packs']
  };
  if (!command || !Object.hasOwn(allowed, command)) throw new Refusal(USAGE);
  const code = command === 'run' || command === 'text' ? 3 : 2;
  const opts = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      if (!allowed[command].includes(arg) || Object.hasOwn(opts, arg)) throw new Refusal(USAGE, code);
      if (arg === '--write') {
        opts[arg] = true;
        continue;
      }
      if (i + 1 >= rest.length) throw new Refusal(USAGE, code);
      opts[arg] = rest[++i];
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== (command === 'slices' || command === 'fill-security' ? 1 : 0)) throw new Refusal(USAGE, code);
  return { command, opts, positional: positional[0] };
}

// A work folder path in another letter case is refused (work-folder-name v1.1); nothing else changes.
function exactOrRefuse(root, rel) {
  try { exactWorkPath({ fs, path }, root, rel); } catch (error) {
    if (error instanceof WorkFolderRefusal) throw new Refusal(error.message, 3);
    throw error;
  }
}

export function main(args, options = {}) {
  try {
    const { command, opts, positional } = parseArgs(args);
    const base = opts['--base'];
    const slug = opts['--run'];
    const judging = command === 'run' || command === 'text';
    if (judging && !(typeof base === 'string' && FULL_ID.test(base))) throw new Refusal('bad base', 3);
    if (judging && runRef(slug) === null) throw new Refusal('bad run', 3);
    const root = path.resolve(opts['--root'] ?? process.cwd());
    let isDir = false;
    try {
      isDir = fs.statSync(root).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) throw new Refusal('bad root');
    if (judging) exactOrRefuse(root, workParts(slug));
    const a = { root, packs: opts['--packs'], base, run: slug, positional, handoff: null, write: opts['--write'] === true };
    if (opts['--handoff'] !== undefined) {
      const abs = path.resolve(root, opts['--handoff']);
      const inside = path.relative(root, abs);
      if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) throw new Refusal('bad handoff');
      const segs = inside.split(path.sep);
      // Letter case first, so a wrong-case path is refused the same on case-sensitive and case-insensitive filesystems.
      if (/^\.company$/i.test(segs[0]) && /^work$/i.test(segs[1] ?? '')) {
        if (segs[0] !== '.company' || segs[1] !== 'work') throw new Refusal('wrong letter case', 3);
        exactOrRefuse(root, segs.slice(2));
      }
      if (!isFile(abs)) throw new Refusal('bad handoff');
      a.handoff = abs;
    }
    const handlers = { run: a2 => cmdRun(a2, options), text: a2 => cmdText(a2, options), list: cmdList, slices: cmdSlices, drift: cmdDrift, 'fill-security': cmdFillSecurity };
    return handlers[command](a);
  } catch (error) {
    if (error instanceof Refusal) return { code: error.code, lines: [`refused: ${error.message}`] };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, lines } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
