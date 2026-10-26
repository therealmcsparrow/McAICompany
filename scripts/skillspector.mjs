#!/usr/bin/env node
// Wrapper around the NVIDIA SkillSpector CLI (Contract skillspector-scan v1).
// Everything the tool prints is untrusted: only allow-listed, type-checked fields are read, and no
// free text from it reaches stdout or a report.
import { execFile as nodeExecFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ID_RE = /^[0-9a-f]{12}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
const VERSION_RE = /^\d+\.\d+\.\d+([.+-][0-9A-Za-z.]{1,20})?$/;
const ISSUE_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const ISSUE_CATEGORY_RE = /^[A-Za-z0-9_-]{1,40}$/;
const ISSUE_FILE_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const CODE_RE = /^[a-z_]{1,40}$/;
const REASON_RE = /^[a-z0-9-]{1,30}$/;
const BAD_NAME = 'bad skill name (lowercase letters, digits and -, at most 64)';

export const INSTALL_COMMANDS = [
  "uv tool install 'skillspector[mcp] @ git+https://github.com/NVIDIA/skillspector.git@v2.13.1'",
  'claude mcp add --scope user skillspector -- skillspector mcp',
];
export const ROLLBACK_COMMANDS = ['uv tool uninstall skillspector', 'claude mcp remove --scope user skillspector'];

const MODES = ['no-llm', 'claude_cli'];
const SCOPES = ['project', 'global', 'all'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const RECOMMENDATIONS = ['SAFE', 'CAUTION', 'DO_NOT_INSTALL'];
const MAX_SEVERITIES = ['NONE', ...SEVERITIES];

const MAX_STDOUT = 8 * 1024 * 1024;
const TIMEOUT_MS = { 'no-llm': 180000, claude_cli: 900000 };
const SECONDS_PER_SKILL = { 'no-llm': 15, claude_cli: 60 };
const PROBE_MS = 10000;
const SETTINGS_MS = 5000;
const FETCH_MS = 120000;
const CLOSE_WAIT_MS = 2000;
const MAX_ENTRIES = 5000;
const MAX_DEPTH = 10;
const MAX_LISTED = 200;
const MAX_ISSUES_SHOWN = 50;
const MAX_ISSUES_IN_REPORT = 10;
const MAX_ISSUES_READ = 10000;
const MAX_LEDGER = 1000;
const MAX_CODES = 5;
const MAX_DIRECT_URL_BYTES = 64 * 1024;
const DEFAULT_LIMITS = { bytes: 50 * 1024 * 1024, entries: MAX_ENTRIES };
const QUARANTINE_MAX_DEPTH = 4;
const QUARANTINE_PREFIX = 'aico-quarantine-';
const QUARANTINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BASELINE_FILE = '.skillspector-baseline.yaml';

const ENV_ALLOW = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'SystemDrive', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE',
  'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'LANG', 'LC_ALL'];

export class Refusal extends Error {
  constructor(message, code = 2) { super(message); this.exitCode = code; }
}

class PlainText {
  constructor(text) { this.text = text; }
}

const USAGE = [
  'usage: skillspector.mjs <command>',
  '  detect --json',
  '  install-commands --json',
  '  list --scope project|global|all --json',
  '  scan --scope project|global|all [--skill <name>] [--mode no-llm|claude_cli] [--report <slug>] --json',
  '  fetch <owner>/<repo> [--ref <sha>] --json',
  '  scan --quarantine <id> [--skill <name>] [--mode no-llm|claude_cli] --json',
  '  clean --quarantine <id>',
  '  help',
  '',
].join('\n');

// ---------- helpers ----------
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => (isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined);

function inside(roots, real) {
  return roots.some((root) => {
    const rel = path.relative(root, real);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  });
}

function realOrNull(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

// A folder that cannot be removed stays for the OS temp sweep; it never fails the caller.
function removeTree(dir, retries = 5) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: retries, retryDelay: 200 });
    return true;
  } catch {
    return false;
  }
}

function withTmpDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve().then(() => fn(dir)).finally(() => removeTree(dir));
}

const defaultUid = typeof process.getuid === 'function' ? () => process.getuid() : undefined;
// On POSIX a quarantine folder must belong to this user; Windows has no uid and skips the check.
const ownedByMe = (st, getuid) => typeof getuid !== 'function' || st.uid === getuid();

// ---------- child env, argv ----------
export function childEnv(env, kind) {
  const out = Object.create(null);
  const win = process.platform === 'win32';
  for (const want of ENV_ALLOW) {
    const key = win ? Object.keys(env).find((k) => k.toUpperCase() === want.toUpperCase()) : (Object.hasOwn(env, want) ? want : undefined);
    if (key !== undefined && typeof env[key] === 'string') out[want] = env[key];
  }
  out.PYTHONIOENCODING = 'utf-8';
  if (kind === 'claude_cli') {
    if (typeof env.CLAUDE_CONFIG_DIR === 'string' && env.CLAUDE_CONFIG_DIR !== '') out.CLAUDE_CONFIG_DIR = env.CLAUDE_CONFIG_DIR;
    out.SKILLSPECTOR_PROVIDER = 'claude_cli';
  } else if (kind === 'git') {
    out.GIT_TERMINAL_PROMPT = '0';
    out.GIT_LFS_SKIP_SMUDGE = '1';
    out.GIT_CONFIG_NOSYSTEM = '1';
    out.GIT_CONFIG_GLOBAL = win ? 'NUL' : '/dev/null';
  }
  return { ...out };
}

export function toolArgv(realPath, mode) {
  if (!MODES.includes(mode)) throw new Error('bad mode');
  return ['skillspector', 'scan', realPath, '--format', 'json', ...(mode === 'no-llm' ? ['--no-llm'] : [])];
}

function checkRepo(owner, repo) {
  if (typeof owner !== 'string' || typeof repo !== 'string' || !OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === '.' || repo === '..') {
    throw new Error('bad repo');
  }
}

export function gitArgv(op, { owner, repo, dir, sha } = {}) {
  if (typeof dir !== 'string' || dir === '') throw new Error('bad dir');
  const hooks = path.join(path.dirname(dir), 'empty-hooks');
  const cfg = [];
  for (const c of ['core.symlinks=false', `core.hooksPath=${hooks}`, 'credential.helper=', 'protocol.allow=never',
    'protocol.https.allow=always', 'transfer.fsckObjects=true']) cfg.push('-c', c);
  const base = ['git', ...cfg];
  if (op === 'init') return [...base, 'init', dir];
  if (op === 'checkout') return [...base, '-C', dir, 'checkout', '--detach', 'FETCH_HEAD'];
  if (op === 'rev-parse') return [...base, '-C', dir, 'rev-parse', 'HEAD'];
  if (op === 'clone' || op === 'fetch') {
    checkRepo(owner, repo);
    const url = `https://github.com/${owner}/${repo}.git`;
    if (op === 'clone') {
      return [...base, 'clone', '--depth', '1', '--single-branch', '--no-tags', '--no-recurse-submodules', '--', url, dir];
    }
    if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw new Error('bad sha');
    return [...base, '-C', dir, 'fetch', '--depth', '1', '--no-tags', '--no-recurse-submodules', '--', url, sha];
  }
  throw new Error('bad git op');
}

// ---------- process running ----------
export function runCommand(argv, { env, cwd, timeoutMs, maxBytes = MAX_STDOUT } = {}) {
  return new Promise((resolve) => {
    let finished = false;
    let timer = null;
    const chunks = [];
    let size = 0;
    const finish = (r) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), {
        env, cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      });
    } catch (e) {
      finish({ error: { code: typeof e?.code === 'string' ? e.code : 'UNKNOWN' } });
      return;
    }
    const pid = child.pid;
    const closed = new Promise((res) => { child.once('close', () => res()); });
    timer = setTimeout(() => finish({ exit: null, stdout: '', pid, timedOut: true, closed }), timeoutMs);
    child.stdout.on('data', (d) => {
      if (finished) return;
      size += d.length;
      if (size > maxBytes) { finish({ exit: null, stdout: '', pid, oversize: true, closed }); return; }
      chunks.push(d);
    });
    child.stderr.on('data', () => {});
    child.on('error', (e) => finish({ error: { code: typeof e?.code === 'string' ? e.code : 'UNKNOWN' } }));
    child.on('close', (code) => finish({ exit: code, stdout: Buffer.concat(chunks).toString('utf8'), pid }));
  });
}

export function killTree(pid, { platform = process.platform, execFile = nodeExecFile, kill = process.kill } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve();
  if (platform === 'win32') {
    return new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true }, () => resolve());
    });
  }
  try { kill(-pid, 'SIGKILL'); } catch { /* the group is already gone */ }
  return Promise.resolve();
}

function waitFor(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((res) => { timer = setTimeout(res, ms); })]).finally(() => clearTimeout(timer));
}

// After a timeout or an oversize result: kill the tree, then wait for the child to close so its
// working directory can be removed.
async function stopTree(res, kill) {
  if (!(res.timedOut || res.oversize) || !Number.isInteger(res.pid)) return;
  await kill(res.pid);
  if (res.closed && typeof res.closed.then === 'function') await waitFor(res.closed, CLOSE_WAIT_MS);
}

// ---------- names and roots ----------
export function resolveSkill(name, scope, roots) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return { ok: false, reason: 'invalid-name' };
  const scopes = scope === 'all' ? ['project', 'global'] : [scope];
  const every = [...(roots.project ?? []), ...(roots.global ?? []), ...(roots.quarantine ?? [])];
  let outside = false;
  for (const sc of scopes) {
    for (const root of roots[sc] ?? []) {
      const real = realOrNull(path.join(root, name));
      if (real === null) continue;
      if (inside(every, real)) return { ok: true, realPath: real, scope: sc };
      outside = true;
    }
  }
  return { ok: false, reason: outside ? 'outside-roots' : 'not-found' };
}

const ROOT_DIRS = [['.claude', 'claude'], ['.agents', 'agents']];

// A project root is used only when neither its parent folder nor it is a link and its real path lies
// strictly inside the project; anything else is counted as refused.
export function projectRoots(cwd, { lstat = fs.lstatSync, realpath = realOrNull } = {}) {
  const realCwd = realpath(cwd);
  const roots = [];
  let refused = 0;
  for (const [dir, label] of ROOT_DIRS) {
    const root = path.join(cwd, dir, 'skills');
    const real = realpath(root);
    if (real === null) continue;
    let linked;
    try { linked = [path.join(cwd, dir), root].some((p) => lstat(p).isSymbolicLink()); } catch { linked = true; }
    if (linked || realCwd === null || !inside([realCwd], real)) { refused++; continue; }
    roots.push({ path: real, label });
  }
  return { roots, refused };
}

function cliRoots(cwd, home) {
  const labels = new Map();
  const project = projectRoots(cwd);
  for (const r of project.roots) labels.set(r.path, r.label);
  const global = [];
  for (const [dir, label] of ROOT_DIRS) {
    const real = realOrNull(path.join(home, dir, 'skills'));
    if (real === null) continue;
    global.push(real);
    labels.set(real, label);
  }
  return { project: project.roots.map((r) => r.path), global, labels, refused: project.refused };
}

function listSkills(scope, roots) {
  const scopes = scope === 'all' ? ['project', 'global'] : [scope];
  const entries = [];
  const seenReal = new Set();
  let skippedInvalid = 0;
  let truncated = 0;
  for (const sc of scopes) {
    for (const root of roots[sc] ?? []) {
      let names;
      try { names = fs.readdirSync(root); } catch { continue; }
      names.sort();
      for (const n of names) {
        const full = path.join(root, n);
        let isDir = false;
        try { isDir = fs.statSync(full).isDirectory(); } catch { isDir = false; }
        if (!isDir) continue;
        if (!NAME_RE.test(n)) { skippedInvalid++; continue; }
        const real = realOrNull(full);
        if (real === null || seenReal.has(real)) continue;
        seenReal.add(real);
        if (entries.length < MAX_LISTED) entries.push({ name: n, scope: sc, root: roots.labels?.get(root) ?? 'claude', dir: real });
        else truncated++;
      }
    }
  }
  return { entries, skippedInvalid, truncated };
}

// ---------- directory walk ----------
const REAL_FS = { readdir: (d) => fs.readdirSync(d), lstat: (p) => fs.lstatSync(p) };

// Counts every entry. A link, a non-regular entry or a folder that cannot be read is counted and never
// followed; it sets `unsafe` and the walk goes on. Only the entry and depth bounds end it early.
export function walk(root, { maxEntries, maxDepth, skipGit = false, sumBytes = false }, api = REAL_FS) {
  let count = 0;
  let bytes = 0;
  let unsafe = false;
  const stack = [[root, 0]];
  const result = (extra) => ({ count, bytes, ...(unsafe ? { unsafe: true } : {}), ...extra });
  while (stack.length > 0) {
    const [dir, depth] = stack.pop();
    let names;
    try { names = api.readdir(dir); } catch { unsafe = true; continue; }
    for (const n of names) {
      if (skipGit && depth === 0 && n === '.git') continue;
      count++;
      if (count > maxEntries || depth + 1 > maxDepth) return result({ tooLarge: true });
      const full = path.join(dir, n);
      let st;
      try { st = api.lstat(full); } catch { unsafe = true; continue; }
      if (st.isSymbolicLink() || !(st.isFile() || st.isDirectory())) { unsafe = true; continue; }
      if (st.isDirectory()) stack.push([full, depth + 1]);
      else if (sumBytes) bytes += st.size;
    }
  }
  return result({});
}

// ---------- classification ----------
const zeroCounts = () => ({ critical: 0, high: 0, medium: 0, low: 0 });

function makeResult(ctx, f) {
  return {
    name: ctx.name, scope: ctx.scope, root: ctx.root, verdict: f.verdict, blocking: f.blocking ?? false, reason: f.reason ?? null,
    incomplete_codes: f.incomplete_codes ?? [], refs_not_bundled: f.refs ?? 0, effective_mode: f.effective_mode, shipped_baseline: f.shipped ?? false,
    score: f.score ?? null, recommendation: f.recommendation ?? null, counts: f.counts ?? zeroCounts(), issues: f.issues ?? [],
  };
}

// The tool's own version string is kept off the result's keys; the run reads it once for the output header.
function withToolVersion(result, version) {
  if (typeof version === 'string' && VERSION_RE.test(version)) Object.defineProperty(result, 'toolVersion', { value: version, enumerable: false });
  return result;
}

function readReport(raw) {
  if (!isObj(raw)) return null;
  const ra = own(raw, 'risk_assessment');
  const score = own(ra, 'score');
  const recommendation = own(ra, 'recommendation');
  const maxSeverity = own(ra, 'max_issue_severity');
  if (!Number.isInteger(score) || score < 0 || score > 100) return null;
  if (!RECOMMENDATIONS.includes(recommendation) || !MAX_SEVERITIES.includes(maxSeverity)) return null;
  const components = own(raw, 'components');
  const rawIssues = own(raw, 'issues');
  if (!Array.isArray(components) || !Array.isArray(rawIssues) || rawIssues.length > MAX_ISSUES_READ) return null;
  const issues = [];
  for (const it of rawIssues) {
    const loc = own(it, 'location');
    const id = own(it, 'id');
    const category = own(it, 'category');
    const severity = own(it, 'severity');
    const file = own(loc, 'file');
    const line = own(loc, 'start_line');
    if (typeof id !== 'string' || typeof category !== 'string' || !SEVERITIES.includes(severity)) return null;
    if (typeof file !== 'string' || typeof line !== 'number') return null;
    issues.push({ id, category, severity, file, line });
  }
  const suppressed = own(raw, 'suppressed_count');
  const meta = own(raw, 'metadata');
  const provenance = own(own(own(meta, 'llm_provenance'), 'provider'), 'effective_adapter');
  const llmRequested = own(meta, 'llm_requested');
  const llmAvailable = own(meta, 'llm_available');
  const version = own(meta, 'skillspector_version');
  if (!Number.isInteger(suppressed)) return null;
  if (typeof version !== 'string' || typeof llmRequested !== 'boolean' || typeof llmAvailable !== 'boolean') return null;
  if (typeof provenance !== 'string') return null;
  const executionSuccessful = own(raw, 'execution_successful');
  const completeness = own(raw, 'analysis_completeness');
  const isComplete = own(completeness, 'is_complete');
  if (typeof executionSuccessful !== 'boolean' || typeof isComplete !== 'boolean') return null;
  return {
    score, recommendation, maxSeverity, componentCount: components.length, issues, suppressed,
    llmRequested, llmAvailable, adapter: provenance, executionSuccessful, isComplete, version,
    detail: {
      executionSuccessful: own(completeness, 'execution_successful'),
      limitations: own(completeness, 'limitations'),
      partial: own(completeness, 'partially_inspected_files'),
      uninspected: own(completeness, 'entirely_uninspected_files'),
      ledger: own(completeness, 'ledger_exceptions'),
    },
  };
}

// The tool's own install gate accepts a partial scan whose only gaps are paths named in SKILL.md that are not
// bundled; so does this one, and nothing wider. Returns the number of such references, or null.
function referenceCaveat(r) {
  const d = r.detail;
  if (r.executionSuccessful !== true || d.executionSuccessful !== true) return null;
  if (!Array.isArray(d.limitations) || d.limitations.length !== 0) return null;
  if (d.partial !== 0 || d.uninspected !== 0) return null;
  const ledger = d.ledger;
  if (!Array.isArray(ledger) || ledger.length < 1 || ledger.length > MAX_LEDGER) return null;
  for (const e of ledger) {
    if (!isObj(e) || own(e, 'reason_code') !== 'reference_missing' || own(e, 'fatal') !== false) return null;
  }
  return ledger.length;
}

function incompleteCodes(ledger) {
  if (!Array.isArray(ledger)) return [];
  const codes = new Set();
  for (const e of ledger.slice(0, MAX_LEDGER)) {
    const c = own(e, 'reason_code');
    codes.add(typeof c === 'string' && CODE_RE.test(c) ? c : '?');
  }
  return [...codes].sort().slice(0, MAX_CODES);
}

function parseJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

const pick = (re, v) => (typeof v === 'string' && re.test(v) ? v : '?');

function shownIssues(issues) {
  return issues.slice(0, MAX_ISSUES_SHOWN).map((i) => ({
    id: pick(ISSUE_ID_RE, i.id),
    category: pick(ISSUE_CATEGORY_RE, i.category),
    severity: i.severity,
    file: pick(ISSUE_FILE_RE, i.file),
    line: Number.isInteger(i.line) && i.line >= 0 ? i.line : '?',
  }));
}

export function classify(res, { mode, name, scope, root, shipped }) {
  const ctx = { name, scope, root: root ?? (scope === 'quarantine' ? 'quarantine' : 'claude') };
  const fail = (reason, extra = {}) => makeResult(ctx, { verdict: 'error', reason, effective_mode: mode, shipped, ...extra });
  if (res.error) return fail('spawn-failed');
  if (res.timedOut) return fail('timeout');
  if (res.oversize || (typeof res.stdout === 'string' && res.stdout.length > MAX_STDOUT)) return fail('oversize');
  if (!Number.isInteger(res.exit)) return fail('spawn-failed');
  const parsed = parseJson(res.stdout);
  if (res.exit === 2) {
    if (isObj(parsed) && own(parsed, 'execution_successful') === false) return fail('not-successful');
    const ac = own(parsed, 'analysis_completeness');
    if (own(ac, 'is_complete') === false) return fail('incomplete', { incomplete_codes: incompleteCodes(own(ac, 'ledger_exceptions')) });
    return fail('exit-2');
  }
  if (res.exit !== 0 && res.exit !== 1) return fail(`exit-${res.exit}`);
  if (parsed === undefined) return fail('unparsable');
  const r = readReport(parsed);
  if (r === null) return fail('shape');
  const failR = (reason, extra) => withToolVersion(fail(reason, extra), r.version);
  if (!r.executionSuccessful) return failR('not-successful');
  if (r.componentCount < 1) return failR('no-components');
  let refs = 0;
  if (!r.isComplete) {
    const n = referenceCaveat(r);
    if (n === null) return failR('incomplete', { incomplete_codes: incompleteCodes(r.detail.ledger) });
    refs = n;
  }
  if (r.suppressed !== 0) return failR('suppressed');
  if (mode === 'no-llm' && r.llmRequested) return failR('mode-mismatch');
  let effective = 'no-llm';
  if (mode === 'claude_cli') {
    effective = r.llmRequested && r.llmAvailable && r.adapter === 'claude_cli' ? 'claude_cli' : 'static-fallback';
  }
  const counts = zeroCounts();
  for (const i of r.issues) counts[i.severity.toLowerCase()]++;
  const blocking = counts.critical + counts.high > 0 || r.maxSeverity === 'HIGH' || r.maxSeverity === 'CRITICAL'
    || res.exit === 1 || r.recommendation === 'DO_NOT_INSTALL';
  const pass = r.issues.length === 0 && res.exit === 0 && !blocking;
  return withToolVersion(makeResult(ctx, {
    verdict: pass ? 'pass' : 'findings', blocking, effective_mode: effective, shipped, refs,
    score: r.score, recommendation: r.recommendation, counts, issues: shownIssues(r.issues),
  }), r.version);
}

export async function scanOne(realPath, { mode = 'no-llm', scope = 'project', root, name, runTool = runCommand, killTree: kill = killTree } = {}) {
  if (!MODES.includes(mode)) throw new Error('bad mode');
  const shown = typeof name === 'string' ? name : path.basename(realPath);
  const label = NAME_RE.test(shown) ? shown : '?';
  const ctx = { name: label, scope, root: root ?? (scope === 'quarantine' ? 'quarantine' : 'claude') };
  const fail = (reason) => makeResult(ctx, { verdict: 'error', reason, effective_mode: mode });
  let skillMd;
  try { skillMd = fs.lstatSync(path.join(realPath, 'SKILL.md')); } catch { return fail('no-skill-md'); }
  if (!skillMd.isFile()) return fail('no-skill-md');
  const w = walk(realPath, { maxEntries: MAX_ENTRIES, maxDepth: MAX_DEPTH });
  if (w.unsafe) return fail('symlink-inside');
  if (w.tooLarge) return fail('too-large');
  let shipped = false;
  try { shipped = fs.lstatSync(path.join(realPath, BASELINE_FILE)).isFile(); } catch { shipped = false; }
  const res = await withTmpDir('aico-ss-', async (cwd) => {
    const r = await runTool(toolArgv(realPath, mode), {
      env: childEnv(process.env, mode), cwd, timeoutMs: TIMEOUT_MS[mode], shell: false,
    });
    await stopTree(r, kill);
    return r;
  });
  return classify(res, { mode, name: label, scope, root: ctx.root, shipped });
}

// ---------- detect ----------
async function probe(argv, env, cwd) {
  const r = await runCommand(argv, { env, cwd, timeoutMs: PROBE_MS, maxBytes: 1024 * 1024 });
  await stopTree(r, killTree);
  return r;
}

function readSmallJson(file) {
  if (fs.statSync(file).size > MAX_DIRECT_URL_BYTES) throw new Error('too large');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function findCommit(toolDir) {
  const stack = [[path.join(toolDir, 'skillspector'), 0]];
  let visited = 0;
  while (stack.length > 0 && visited < 2000) {
    const [dir, depth] = stack.pop();
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      visited++;
      const full = path.join(dir, n);
      if (/^skillspector-[^/\\]+\.dist-info$/.test(n)) {
        try {
          const j = readSmallJson(path.join(full, 'direct_url.json'));
          const c = own(own(j, 'vcs_info'), 'commit_id');
          if (typeof c === 'string' && SHA_RE.test(c)) return c;
        } catch { /* no usable direct_url.json here */ }
        return null;
      }
      if (depth < 5 && !/^(__pycache__|Scripts|bin)$/.test(n)) {
        let st = null;
        try { st = fs.lstatSync(full); } catch { st = null; }
        if (st?.isDirectory()) stack.push([full, depth + 1]);
      }
    }
  }
  return null;
}

export async function detect() {
  return withTmpDir('aico-ss-', async (cwd) => {
    const env = childEnv(process.env, 'no-llm');
    const tool = await probe(['skillspector', '--version'], env, cwd);
    const uvRun = await probe(['uv', '--version'], env, cwd);
    const installed = !(tool.error && tool.error.code === 'ENOENT');
    const uv = !uvRun.error && uvRun.exit === 0;
    let version = null;
    let commit = null;
    if (installed) {
      const m = !tool.error && tool.exit === 0 ? /(\d+\.\d+\.\d+(?:[.+-][0-9A-Za-z.]{1,20})?)/.exec(String(tool.stdout)) : null;
      version = m && VERSION_RE.test(m[1]) ? m[1] : null;
      if (uv) {
        const dirRun = await probe(['uv', 'tool', 'dir'], env, cwd);
        const dir = !dirRun.error && dirRun.exit === 0 ? String(dirRun.stdout).trim() : '';
        if (dir && path.isAbsolute(dir)) commit = findCommit(dir);
      }
    }
    return { v: 1, installed, version, commit, uv };
  });
}

// ---------- mode setting ----------
export async function settingsMode() {
  try {
    const env = childEnv(process.env, 'no-llm');
    if (typeof process.env.MCSPARROW_HOME === 'string') env.MCSPARROW_HOME = process.env.MCSPARROW_HOME;
    const r = await runCommand([process.execPath, path.join(import.meta.dirname, 'settings.mjs'), 'get', 'skillspector.mode'],
      { env, cwd: process.cwd(), timeoutMs: SETTINGS_MS, maxBytes: 64 * 1024 });
    await stopTree(r, killTree);
    const v = typeof r.stdout === 'string' ? r.stdout.trim() : '';
    return !r.error && r.exit === 0 && MODES.includes(v) ? v : 'no-llm';
  } catch {
    return 'no-llm';
  }
}

// ---------- quarantine ----------
function tmpRoot() {
  return realOrNull(os.tmpdir()) ?? os.tmpdir();
}

function quarantineDir(id) {
  return path.join(tmpRoot(), `${QUARANTINE_PREFIX}${id}`);
}

export function sweepQuarantines({ getuid = defaultUid } = {}) {
  const base = tmpRoot();
  let names = [];
  try { names = fs.readdirSync(base); } catch { return; }
  for (const n of names) {
    if (!/^aico-quarantine-[0-9a-f]{12}$/.test(n)) continue;
    const full = path.join(base, n);
    try {
      const st = fs.lstatSync(full);
      if (st.isDirectory() && ownedByMe(st, getuid) && Date.now() - st.mtimeMs > QUARANTINE_MAX_AGE_MS) removeTree(full, 3);
    } catch { /* another session owns it, or it is gone */ }
  }
}

export function discoverQuarantine(repoReal) {
  const found = new Map();
  let skippedInvalid = 0;
  let level = [repoReal];
  let visited = 0;
  for (let depth = 1; depth <= QUARANTINE_MAX_DEPTH && level.length > 0; depth++) {
    const next = [];
    for (const dir of level) {
      let names;
      try { names = fs.readdirSync(dir); } catch { continue; }
      names.sort();
      for (const n of names) {
        if (n === '.git' || ++visited > MAX_ENTRIES) continue;
        const full = path.join(dir, n);
        let st;
        try { st = fs.lstatSync(full); } catch { continue; }
        if (!st.isDirectory()) continue;
        let md = null;
        try { md = fs.lstatSync(path.join(full, 'SKILL.md')); } catch { md = null; }
        if (md?.isFile()) {
          if (!NAME_RE.test(n)) skippedInvalid++;
          else if (!found.has(n) && found.size < MAX_LISTED) found.set(n, full);
        } else {
          next.push(full);
        }
      }
    }
    level = next;
  }
  return { found, skippedInvalid };
}

export function openQuarantine(id, { getuid = defaultUid } = {}) {
  const q = quarantineDir(id);
  let st;
  try { st = fs.lstatSync(q); } catch { throw new Refusal('quarantine not found'); }
  if (!st.isDirectory() || !ownedByMe(st, getuid)) throw new Refusal('quarantine not found');
  const repo = realOrNull(path.join(q, 'repo'));
  if (repo === null || !inside([realOrNull(q) ?? q], repo)) throw new Refusal('quarantine not found');
  return repo;
}

export async function fetchRepo(owner, repo, ref, deps = {}) {
  const run = deps.runCommand ?? runCommand;
  const kill = deps.killTree ?? killTree;
  const limits = deps.limits ?? DEFAULT_LIMITS;
  sweepQuarantines({ getuid: deps.getuid });
  let id;
  let q;
  for (let i = 0; i < 5 && !q; i++) {
    id = randomBytes(6).toString('hex');
    const dir = quarantineDir(id);
    try { fs.mkdirSync(dir, { mode: 0o700 }); q = dir; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  if (!q) throw new Error('no quarantine dir');
  try {
    fs.mkdirSync(path.join(q, 'empty-hooks'));
    const target = path.join(q, 'repo');
    const env = childEnv(process.env, 'git');
    const deadline = Date.now() + FETCH_MS;
    const git = async (argv) => {
      const left = deadline - Date.now();
      if (left <= 0) return { timedOut: true };
      const r = await run(argv, { env, cwd: q, timeoutMs: left, maxBytes: 1024 * 1024 });
      await stopTree(r, kill);
      return r;
    };
    const steps = ref === undefined
      ? [gitArgv('clone', { owner, repo, dir: target })]
      : [gitArgv('init', { dir: target }), gitArgv('fetch', { owner, repo, dir: target, sha: ref }), gitArgv('checkout', { dir: target })];
    for (const argv of steps) {
      const r = await git(argv);
      if (r.error?.code === 'ENOENT') throw new Refusal('git missing');
      if (r.error || r.timedOut || r.oversize || r.exit !== 0) throw new Refusal('fetch failed');
    }
    const head = await git(gitArgv('rev-parse', { dir: target }));
    const commit = !head.error && head.exit === 0 ? String(head.stdout).trim() : '';
    if (!SHA_RE.test(commit) || (ref !== undefined && commit !== ref)) throw new Refusal('fetch failed');
    const repoReal = realOrNull(target);
    if (repoReal === null) throw new Refusal('fetch failed');
    const w = walk(repoReal, { maxEntries: limits.entries, maxDepth: 64, skipGit: true, sumBytes: true });
    if (w.unsafe || w.tooLarge || w.bytes > limits.bytes) throw new Refusal('candidate too large');
    const { found, skippedInvalid } = discoverQuarantine(repoReal);
    return { v: 1, id, commit, skills: [...found.keys()], skipped_invalid: skippedInvalid };
  } catch (e) {
    removeTree(q);
    throw e;
  }
}

export function cleanQuarantine(id, { getuid = defaultUid } = {}) {
  const q = quarantineDir(id);
  let st = null;
  try { st = fs.lstatSync(q); } catch { st = null; }
  if (!st || !st.isDirectory() || !ownedByMe(st, getuid)) return { v: 1, removed: false };
  return { v: 1, removed: removeTree(q) };
}

// ---------- scanning a set of targets ----------
function summarize(results) {
  const summary = { pass: 0, findings: 0, error: 0 };
  for (const r of results) summary[r.verdict]++;
  return summary;
}

const defaultProgress = (line) => process.stderr.write(`${line}\n`);

async function scanTargets(targets, mode, deps) {
  const progress = deps.progress ?? defaultProgress;
  progress(`scan: ${targets.length} skills, about ${targets.length * SECONDS_PER_SKILL[mode]} s`);
  const results = [];
  let i = 0;
  for (const t of targets) {
    let result;
    if (t.failure) {
      result = makeResult({ name: t.name, scope: t.scope, root: t.root }, { verdict: 'error', reason: t.failure, effective_mode: mode });
    } else {
      result = await scanOne(t.dir, { mode, scope: t.scope, root: t.root, name: t.name, runTool: deps.runTool, killTree: deps.killTree });
    }
    results.push(result);
    progress(`scan: ${++i}/${targets.length} ${result.name} ${result.verdict}`);
  }
  return results;
}

function toolVersion(info, results) {
  if (typeof info.version === 'string' && VERSION_RE.test(info.version)) return info.version;
  const first = results.find((r) => typeof r.toolVersion === 'string');
  return first ? first.toolVersion : '?';
}

// ---------- report ----------
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CANNOT_TRUST = ['SkillSpector gave a result aico cannot trust', 'run /aico:skillspector install to check the pinned version, then scan again'];

function removalCommand(r) {
  const dir = r.root === 'claude' ? '.claude' : r.root === 'agents' ? '.agents' : null;
  if (dir === null || !NAME_RE.test(r.name)) return null;
  return `rm -r ${r.scope === 'global' ? '~/' : ''}${dir}/skills/${r.name}`;
}

function whyNext(r, mode) {
  if (r.verdict === 'findings') {
    if (r.blocking === true) {
      const cmd = removalCommand(r);
      return ['critical or high findings', `do not use it${cmd ? `; remove it (${cmd})` : ''}`];
    }
    return ['medium or low findings only', 'read the issues below before you use it'];
  }
  switch (r.reason) {
    case 'not-found': return ['not in the skill folders', 'check the name with list'];
    case 'outside-roots': return ['the folder is a link to a place outside the skill folders, so it was not scanned', 'check the link; remove it if you did not make it'];
    case 'no-skill-md': return ['no SKILL.md file', 'check the folder; it is not a working skill'];
    case 'symlink-inside': return ['it contains a link, which can point anywhere, so it was not scanned', 'replace the link with the file, or remove the skill'];
    case 'too-large': return ['over 5000 files or 10 levels deep, so it was not scanned', 'check it by hand'];
    case 'spawn-failed': return ['SkillSpector did not start', 'run /aico:skillspector install, or check PATH'];
    case 'timeout': return [`the scan took longer than ${mode === 'claude_cli' ? 900 : 180} s`, 'scan this skill alone; with claude_cli, try no-llm'];
    case 'not-successful': return ['SkillSpector reported a failed run (with claude_cli: often `claude` is not available)', 'check that claude works, or scan with no-llm'];
    case 'no-components': return ['SkillSpector found no files to scan', 'check that the folder holds the skill files'];
    case 'incomplete': {
      const codes = Array.isArray(r.incomplete_codes) ? r.incomplete_codes.map((c) => pick(CODE_RE, c)) : [];
      return [`SkillSpector could not inspect all of it${codes.length ? ` (${codes.join(', ')})` : ''}`,
        'do not treat it as checked; read the named files by hand, and check network access to api.osv.dev if a lookup failed'];
    }
    case 'suppressed': return ['findings were suppressed by a baseline', 'report this; aico never applies baselines'];
    case 'mode-mismatch': return ['an LLM was used although no-llm was asked', 'report this; do not trust the result'];
    default: return CANNOT_TRUST;
  }
}

export function renderReport(output, { date = new Date(), scopeLabel } = {}) {
  const results = Array.isArray(output?.results) ? output.results : [];
  const tool = output?.tool ?? {};
  const version = pick(VERSION_RE, tool.version);
  const commit = typeof tool.commit === 'string' && SHA_RE.test(tool.commit) ? `@${tool.commit.slice(0, 7)}` : '';
  const mode = MODES.includes(output?.mode) ? output.mode : '?';
  const scopes = [...new Set(results.map((r) => (SCOPES.includes(r.scope) ? r.scope : '?')))];
  const scope = typeof scopeLabel === 'string' && (NAME_RE.test(scopeLabel) || SCOPES.includes(scopeLabel)) ? scopeLabel : (scopes.join('+') || 'none');
  const sum = output?.summary ?? {};
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const lines = [
    '# SkillSpector scan',
    `- Date: ${date.toISOString()}; tool: skillspector ${version}${commit}; mode: ${mode}; scope: ${scope}`,
    `- Network: package names and versions from dependency files go to OSV.dev${mode === 'claude_cli' ? '; skill text goes to Anthropic (claude_cli)' : ''}`,
    '## Summary',
    `- pass ${n(sum.pass)}, findings ${n(sum.findings)}, error ${n(sum.error)}`,
    '## Skills',
  ];
  for (const r of results) {
    const c = r.counts ?? {};
    const verdict = ['pass', 'findings', 'error'].includes(r.verdict) ? r.verdict : 'error';
    const eff = ['no-llm', 'claude_cli', 'static-fallback'].includes(r.effective_mode) ? r.effective_mode : '?';
    const safe = { ...r, verdict, name: pick(NAME_RE, r.name), scope: SCOPES.includes(r.scope) ? r.scope : '?', reason: typeof r.reason === 'string' && REASON_RE.test(r.reason) ? r.reason : null };
    let line = `- ${safe.name} (${safe.scope}): ${verdict} — critical ${n(c.critical)}, high ${n(c.high)}, medium ${n(c.medium)}, low ${n(c.low)} — mode ${eff}`;
    if (r.blocking === true) line += ' — blocking';
    if (safe.reason !== null) {
      const codes = Array.isArray(r.incomplete_codes) ? r.incomplete_codes.slice(0, MAX_CODES).map((x) => pick(CODE_RE, x)) : [];
      line += ` — reason ${safe.reason}${safe.reason === 'incomplete' && codes.length ? `: ${codes.join(', ')}` : ''}`;
    }
    if (r.shipped_baseline === true) line += ' — ships a baseline file (not applied)';
    if (n(r.refs_not_bundled) > 0) line += ` — ${n(r.refs_not_bundled)} references to files outside the skill (not inspected)`;
    lines.push(line);
    if (verdict === 'pass') continue;
    const [why, next] = whyNext(safe, mode);
    lines.push(`  - Why: ${why}`, `  - Next: ${next}`);
    const issues = Array.isArray(r.issues) ? r.issues : [];
    const total = n(c.critical) + n(c.high) + n(c.medium) + n(c.low);
    if (issues.length > 0) {
      const shown = issues.slice(0, MAX_ISSUES_IN_REPORT).map((i) => {
        const sev = SEVERITIES.includes(i?.severity) ? i.severity : '?';
        const lineNo = Number.isInteger(i?.line) && i.line >= 0 ? i.line : '?';
        return `${pick(ISSUE_ID_RE, i?.id)} ${sev} ${pick(ISSUE_FILE_RE, i?.file)}:${lineNo}`;
      });
      const more = Math.max(issues.length, total) - MAX_ISSUES_IN_REPORT;
      lines.push(`  - Issues: ${shown.join('; ')}${more > 0 ? `; and ${more} more in the JSON` : ''}`);
    }
  }
  const notScanned = [
    [n(output?.skipped_invalid), (k) => `- ${k} entries with an invalid name were skipped (names not shown).`],
    [n(output?.truncated), (k) => `- ${k} more skills over the limit of ${MAX_LISTED} were not scanned.`],
    [n(output?.roots_refused), (k) => `- ${k} project skill folders are links or point outside the project, so they were not scanned.`],
  ].filter(([k]) => k > 0);
  if (notScanned.length > 0) lines.push('## Not scanned', ...notScanned.map(([k, text]) => text(k)));
  return `${lines.join('\n')}\n`;
}

export async function writeReport(cwd, slug, output, opts = {}) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new Refusal('bad report slug');
  const company = path.join(cwd, '.company');
  const work = path.join(company, 'work');
  const folder = path.join(work, slug);
  const file = path.join(folder, 'skillspector-report.md');
  for (const p of [company, work, folder, file]) {
    let st = null;
    try { st = fs.lstatSync(p); } catch { st = null; }
    if (st?.isSymbolicLink()) throw new Refusal('report path is a link');
  }
  const text = renderReport(output, opts);
  fs.mkdirSync(folder, { recursive: true });
  const tmp = path.join(folder, `.skillspector-report-${randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return file;
}

// ---------- CLI ----------
const SPECS = {
  detect: { flags: { '--json': false } },
  'install-commands': { flags: { '--json': false } },
  list: { flags: { '--scope': true, '--json': false } },
  scan: { flags: { '--scope': true, '--quarantine': true, '--skill': true, '--mode': true, '--report': true, '--json': false } },
  fetch: { flags: { '--ref': true, '--json': false }, positional: 1 },
  clean: { flags: { '--quarantine': true } },
  help: { flags: {} },
};

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { command: 'help', flags: new Map(), positional: [] };
  const [command, ...rest] = argv;
  if (typeof command !== 'string' || !Object.hasOwn(SPECS, command)) throw new Refusal('usage: unknown command');
  const spec = SPECS[command];
  const flags = new Map();
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('-')) {
      if (!Object.hasOwn(spec.flags, a)) throw new Refusal('usage: unknown flag');
      if (flags.has(a)) throw new Refusal('usage: repeated flag');
      if (spec.flags[a]) {
        const v = rest[++i];
        if (typeof v !== 'string' || v.startsWith('-')) throw new Refusal('usage: flag needs a value');
        flags.set(a, v);
      } else {
        flags.set(a, true);
      }
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== (spec.positional ?? 0)) throw new Refusal('usage: wrong number of arguments');
  return { command, flags, positional };
}

function validateScan(flags) {
  const scope = flags.get('--scope');
  const quarantine = flags.get('--quarantine');
  if ((scope === undefined) === (quarantine === undefined)) throw new Refusal('usage: scan needs --scope or --quarantine');
  if (scope !== undefined && !SCOPES.includes(scope)) throw new Refusal('usage: bad scope');
  if (quarantine !== undefined && !ID_RE.test(quarantine)) throw new Refusal('bad quarantine id');
  if (quarantine !== undefined && flags.has('--report')) throw new Refusal('usage: --report needs --scope');
  const skill = flags.get('--skill');
  if (skill !== undefined && !NAME_RE.test(skill)) throw new Refusal(BAD_NAME);
  const mode = flags.get('--mode');
  if (mode !== undefined && !MODES.includes(mode)) throw new Refusal('usage: bad mode');
  const report = flags.get('--report');
  if (report !== undefined && !SLUG_RE.test(report)) throw new Refusal('bad report slug');
  return { scope, quarantine, skill, mode, report };
}

async function runScan(flags, deps = {}) {
  const a = validateScan(flags);
  const info = await (deps.detect ?? detect)();
  if (!info.installed) throw new Refusal('skillspector missing', 3);
  const mode = a.mode ?? await (deps.settingsMode ?? settingsMode)();
  const cwd = deps.cwd ?? process.cwd();
  let targets;
  let skippedInvalid = 0;
  let truncated = 0;
  let rootsRefused = 0;
  if (a.quarantine !== undefined) {
    const repoReal = openQuarantine(a.quarantine, deps);
    const { found, skippedInvalid: bad } = discoverQuarantine(repoReal);
    skippedInvalid = bad;
    targets = [...found].filter(([n]) => a.skill === undefined || n === a.skill).map(([name, dir]) => (
      inside([repoReal], realOrNull(dir) ?? dir)
        ? { name, scope: 'quarantine', root: 'quarantine', dir }
        : { name, scope: 'quarantine', root: 'quarantine', failure: 'outside-roots' }));
  } else {
    const roots = cliRoots(cwd, deps.home ?? os.homedir());
    const listed = listSkills(a.scope, roots);
    skippedInvalid = listed.skippedInvalid;
    truncated = listed.truncated;
    rootsRefused = roots.refused;
    const every = [...roots.project, ...roots.global];
    targets = listed.entries.filter((e) => a.skill === undefined || e.name === a.skill).map((e) => (
      inside(every, e.dir)
        ? { name: e.name, scope: e.scope, root: e.root, dir: e.dir }
        : { name: e.name, scope: e.scope, root: e.root, failure: 'outside-roots' }));
  }
  if (a.skill !== undefined && targets.length === 0) throw new Refusal('skill not found');
  const results = await scanTargets(targets, mode, deps);
  const output = {
    v: 1, tool: { version: toolVersion(info, results), commit: info.commit ?? null }, mode, results,
    skipped_invalid: skippedInvalid, truncated, roots_refused: rootsRefused, summary: summarize(results),
  };
  if (a.report !== undefined) await writeReport(cwd, a.report, output, { scopeLabel: a.skill ?? a.scope });
  return output;
}

function parseRepo(source) {
  const parts = typeof source === 'string' ? source.split('/') : [];
  if (parts.length !== 2 || !OWNER_RE.test(parts[0]) || !REPO_RE.test(parts[1]) || parts[1] === '.' || parts[1] === '..') throw new Refusal('bad repo');
  return parts;
}

// Pre-approval scan: fetch the exact commit into a quarantine, scan the named skills there,
// and always remove the quarantine. Returns { commit, results: { <name>: result | { refused } } } or { refused }.
export async function vetCandidates({ source, commit, names, mode } = {}, deps = {}) {
  try {
    const [owner, repo] = parseRepo(source);
    if (typeof commit !== 'string' || !SHA_RE.test(commit)) throw new Refusal('bad ref');
    if (!Array.isArray(names) || names.length < 1 || names.length > MAX_LISTED || names.some((n) => typeof n !== 'string' || !NAME_RE.test(n))) {
      throw new Refusal(BAD_NAME);
    }
    if (mode !== undefined && !MODES.includes(mode)) throw new Refusal('usage: bad mode');
    const info = await (deps.detect ?? detect)();
    if (!info.installed) throw new Refusal('skillspector missing', 3);
    const effective = mode ?? await (deps.settingsMode ?? settingsMode)();
    const q = await fetchRepo(owner, repo, commit, deps);
    try {
      const repoReal = openQuarantine(q.id, deps);
      const { found } = discoverQuarantine(repoReal);
      const results = Object.create(null);
      for (const name of new Set(names)) {
        const dir = found.get(name);
        results[name] = dir === undefined
          ? { refused: 'skill not in repo' }
          : await scanOne(dir, { mode: effective, scope: 'quarantine', root: 'quarantine', name, runTool: deps.runTool, killTree: deps.killTree });
      }
      return { commit: q.commit, results };
    } finally {
      cleanQuarantine(q.id, deps);
    }
  } catch (e) {
    if (e instanceof Refusal) return { refused: e.message };
    throw e;
  }
}

export async function vetCandidate({ source, commit, name, mode } = {}, deps = {}) {
  const r = await vetCandidates({ source, commit, names: [name], mode }, deps);
  if (r.refused !== undefined) return { refused: r.refused };
  const one = r.results[name];
  return one.refused !== undefined ? { refused: one.refused } : { commit: r.commit, result: one };
}

// Scans an installed skill by name in every scope; returns { results } or { refused }.
export async function scanInstalled({ name, mode } = {}, deps = {}) {
  try {
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Refusal(BAD_NAME);
    const flags = new Map([['--scope', 'all'], ['--skill', name]]);
    if (mode !== undefined) flags.set('--mode', mode);
    const out = await runScan(flags, { progress: () => {}, ...deps });
    return { results: out.results };
  } catch (e) {
    if (e instanceof Refusal) return { refused: e.message };
    throw e;
  }
}

export async function main(argv, deps = {}) {
  const { command, flags, positional } = parseArgs(argv);
  if (command === 'help') return new PlainText(USAGE);
  if (command === 'install-commands') return { v: 1, install: [...INSTALL_COMMANDS], rollback: [...ROLLBACK_COMMANDS] };
  if (command === 'detect') return (deps.detect ?? detect)();
  if (command === 'list') {
    const scope = flags.get('--scope');
    if (!SCOPES.includes(scope)) throw new Refusal('usage: bad scope');
    const roots = cliRoots(deps.cwd ?? process.cwd(), deps.home ?? os.homedir());
    const { entries, skippedInvalid, truncated } = listSkills(scope, roots);
    return {
      v: 1, skills: entries.map(({ name, scope: sc, root }) => ({ name, scope: sc, root })),
      skipped_invalid: skippedInvalid, truncated, roots_refused: roots.refused,
    };
  }
  if (command === 'scan') return runScan(flags, deps);
  if (command === 'clean') {
    const id = flags.get('--quarantine');
    if (!ID_RE.test(id ?? '')) throw new Refusal('bad quarantine id');
    return cleanQuarantine(id, deps);
  }
  const [owner, repo] = parseRepo(positional[0]);
  const ref = flags.get('--ref');
  if (ref !== undefined && !SHA_RE.test(ref)) throw new Refusal('bad ref');
  const info = await (deps.detect ?? detect)();
  if (!info.installed) throw new Refusal('skillspector missing', 3);
  return fetchRepo(owner, repo, ref, deps);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((out) => {
    process.stdout.write(out instanceof PlainText ? out.text : `${JSON.stringify(out)}\n`);
  }).catch((e) => {
    if (e instanceof Refusal) {
      process.stdout.write(`refused: ${e.message}\n`);
      process.exitCode = e.exitCode;
    } else {
      process.stderr.write('error: internal\n');
      process.exitCode = 1;
    }
  });
}
