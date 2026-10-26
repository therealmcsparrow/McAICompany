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
const ISSUE_FILE_RE = /^[A-Za-z0-9._/ -]{1,200}$/;

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
const PROBE_MS = 10000;
const SETTINGS_MS = 5000;
const FETCH_MS = 120000;
const MAX_ENTRIES = 5000;
const MAX_DEPTH = 10;
const MAX_LISTED = 200;
const MAX_ISSUES_SHOWN = 50;
const MAX_ISSUES_READ = 10000;
const QUARANTINE_MAX_BYTES = 50 * 1024 * 1024;
const QUARANTINE_MAX_DEPTH = 4;
const QUARANTINE_PREFIX = 'aico-quarantine-';
const QUARANTINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BASELINE_FILE = '.skillspector-baseline.yaml';

const ENV_ALLOW = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'SystemDrive', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE',
  'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'LANG', 'LC_ALL'];

export class Refusal extends Error {
  constructor(message, code = 2) { super(message); this.exitCode = code; }
}

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

function withTmpDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const done = () => fs.rmSync(dir, { recursive: true, force: true });
  return Promise.resolve().then(() => fn(dir)).finally(done);
}

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
    timer = setTimeout(() => finish({ exit: null, stdout: '', pid, timedOut: true }), timeoutMs);
    child.stdout.on('data', (d) => {
      if (finished) return;
      size += d.length;
      if (size > maxBytes) { finish({ exit: null, stdout: '', pid, oversize: true }); return; }
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

function realRoots(base) {
  return [path.join(base, '.claude', 'skills'), path.join(base, '.agents', 'skills')].map(realOrNull).filter((p) => p !== null);
}

function cliRoots(cwd) {
  return { project: realRoots(cwd), global: realRoots(os.homedir()) };
}

function listSkills(scope, roots) {
  const scopes = scope === 'all' ? ['project', 'global'] : [scope];
  const skills = [];
  const seenReal = new Set();
  const seenName = new Set();
  let skippedInvalid = 0;
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
        const real = realOrNull(full) ?? full;
        if (seenReal.has(real) || seenName.has(`${sc}:${n}`)) continue;
        seenReal.add(real);
        seenName.add(`${sc}:${n}`);
        if (skills.length < MAX_LISTED) skills.push({ name: n, scope: sc });
      }
    }
  }
  return { skills, skippedInvalid };
}

// ---------- directory walk ----------
function walk(root, { maxEntries, maxDepth, skipGit = false, sumBytes = false }) {
  let count = 0;
  let bytes = 0;
  const stack = [[root, 0]];
  while (stack.length > 0) {
    const [dir, depth] = stack.pop();
    let names;
    try { names = fs.readdirSync(dir); } catch { return { unsafe: true, count, bytes }; }
    for (const n of names) {
      if (skipGit && depth === 0 && n === '.git') continue;
      count++;
      if (count > maxEntries || depth + 1 > maxDepth) return { tooLarge: true, count, bytes };
      const full = path.join(dir, n);
      let st;
      try { st = fs.lstatSync(full); } catch { return { unsafe: true, count, bytes }; }
      if (st.isSymbolicLink() || !(st.isFile() || st.isDirectory())) return { unsafe: true, count, bytes };
      if (st.isDirectory()) stack.push([full, depth + 1]);
      else if (sumBytes) bytes += st.size;
    }
  }
  return { count, bytes };
}

// ---------- classification ----------
const zeroCounts = () => ({ critical: 0, high: 0, medium: 0, low: 0 });

function errorResult(name, scope, reason, mode, extra = {}) {
  return {
    name, scope, verdict: 'error', blocking: false, reason, effective_mode: mode, shipped_baseline: false,
    score: null, recommendation: null, counts: zeroCounts(), issues: [], ...extra,
  };
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
  if (!Number.isInteger(suppressed)) return null;
  if (typeof own(meta, 'skillspector_version') !== 'string' || typeof llmRequested !== 'boolean' || typeof llmAvailable !== 'boolean') return null;
  if (typeof provenance !== 'string') return null;
  const executionSuccessful = own(raw, 'execution_successful');
  const isComplete = own(own(raw, 'analysis_completeness'), 'is_complete');
  if (typeof executionSuccessful !== 'boolean' || typeof isComplete !== 'boolean') return null;
  return {
    score, recommendation, maxSeverity, componentCount: components.length, issues, suppressed,
    llmRequested, llmAvailable, adapter: provenance, executionSuccessful, isComplete,
  };
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

export function classify(res, { mode, name, scope, shipped }) {
  const fail = (reason) => errorResult(name, scope, reason, mode, { shipped_baseline: shipped });
  if (res.error) return fail('spawn-failed');
  if (res.timedOut) return fail('timeout');
  if (res.oversize || (typeof res.stdout === 'string' && res.stdout.length > MAX_STDOUT)) return fail('oversize');
  if (!Number.isInteger(res.exit)) return fail('spawn-failed');
  const parsed = parseJson(res.stdout);
  if (res.exit === 2) {
    if (isObj(parsed) && own(parsed, 'execution_successful') === false) return fail('not-successful');
    if (isObj(parsed) && own(own(parsed, 'analysis_completeness'), 'is_complete') === false) return fail('incomplete');
    return fail('exit-2');
  }
  if (res.exit !== 0 && res.exit !== 1) return fail(`exit-${res.exit}`);
  if (parsed === undefined) return fail('unparsable');
  const r = readReport(parsed);
  if (r === null) return fail('shape');
  if (!r.executionSuccessful) return fail('not-successful');
  if (r.componentCount < 1) return fail('no-components');
  if (!r.isComplete) return fail('incomplete');
  if (r.suppressed !== 0) return fail('suppressed');
  if (mode === 'no-llm' && r.llmRequested) return fail('mode-mismatch');
  let effective = 'no-llm';
  if (mode === 'claude_cli') {
    effective = r.llmRequested && r.llmAvailable && r.adapter === 'claude_cli' ? 'claude_cli' : 'static-fallback';
  }
  const counts = zeroCounts();
  for (const i of r.issues) counts[i.severity.toLowerCase()]++;
  const blocking = counts.critical + counts.high > 0 || r.maxSeverity === 'HIGH' || r.maxSeverity === 'CRITICAL'
    || res.exit === 1 || r.recommendation === 'DO_NOT_INSTALL';
  const pass = r.issues.length === 0 && res.exit === 0 && !blocking;
  return {
    name, scope, verdict: pass ? 'pass' : 'findings', blocking, reason: null, effective_mode: effective, shipped_baseline: shipped,
    score: r.score, recommendation: r.recommendation, counts, issues: shownIssues(r.issues),
  };
}

export async function scanOne(realPath, { mode = 'no-llm', scope = 'project', name, runTool = runCommand, killTree: kill = killTree } = {}) {
  if (!MODES.includes(mode)) throw new Error('bad mode');
  const shown = typeof name === 'string' ? name : path.basename(realPath);
  const label = NAME_RE.test(shown) ? shown : '?';
  const fail = (reason, extra) => errorResult(label, scope, reason, mode, extra);
  let skillMd;
  try { skillMd = fs.lstatSync(path.join(realPath, 'SKILL.md')); } catch { return fail('no-skill-md'); }
  if (!skillMd.isFile()) return fail('no-skill-md');
  const w = walk(realPath, { maxEntries: MAX_ENTRIES, maxDepth: MAX_DEPTH });
  if (w.unsafe) return fail('symlink-inside');
  if (w.tooLarge) return fail('too-large');
  let shipped = false;
  try { shipped = fs.lstatSync(path.join(realPath, BASELINE_FILE)).isFile(); } catch { shipped = false; }
  const res = await withTmpDir('aico-ss-', (cwd) => runTool(toolArgv(realPath, mode), {
    env: childEnv(process.env, mode), cwd, timeoutMs: TIMEOUT_MS[mode], shell: false,
  }));
  if ((res.timedOut || res.oversize) && Number.isInteger(res.pid)) await kill(res.pid);
  return classify(res, { mode, name: label, scope, shipped });
}

// ---------- detect ----------
async function probe(argv, env, cwd) {
  const r = await runCommand(argv, { env, cwd, timeoutMs: PROBE_MS, maxBytes: 1024 * 1024 });
  if (r.pid && (r.timedOut || r.oversize)) await killTree(r.pid);
  return r;
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
          const j = JSON.parse(fs.readFileSync(path.join(full, 'direct_url.json'), 'utf8'));
          const c = own(own(j, 'vcs_info'), 'commit_id');
          if (typeof c === 'string' && SHA_RE.test(c)) return c;
        } catch { /* no direct_url.json here */ }
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
async function settingsMode() {
  try {
    const env = childEnv(process.env, 'no-llm');
    if (typeof process.env.MCSPARROW_HOME === 'string') env.MCSPARROW_HOME = process.env.MCSPARROW_HOME;
    const r = await runCommand([process.execPath, path.join(import.meta.dirname, 'settings.mjs'), 'get', 'skillspector.mode'],
      { env, cwd: process.cwd(), timeoutMs: SETTINGS_MS, maxBytes: 64 * 1024 });
    if (r.pid && (r.timedOut || r.oversize)) await killTree(r.pid);
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

function sweepQuarantines() {
  const base = tmpRoot();
  let names = [];
  try { names = fs.readdirSync(base); } catch { return; }
  for (const n of names) {
    if (!/^aico-quarantine-[0-9a-f]{12}$/.test(n)) continue;
    const full = path.join(base, n);
    try {
      const st = fs.lstatSync(full);
      if (st.isDirectory() && Date.now() - st.mtimeMs > QUARANTINE_MAX_AGE_MS) fs.rmSync(full, { recursive: true, force: true, maxRetries: 3 });
    } catch { /* another session owns it, or it is gone */ }
  }
}

function discoverQuarantine(repoReal) {
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

function openQuarantine(id) {
  const q = quarantineDir(id);
  let st;
  try { st = fs.lstatSync(q); } catch { throw new Refusal('quarantine not found'); }
  if (!st.isDirectory()) throw new Refusal('quarantine not found');
  const repo = realOrNull(path.join(q, 'repo'));
  if (repo === null || !inside([realOrNull(q) ?? q], repo)) throw new Refusal('quarantine not found');
  return repo;
}

async function fetchRepo(owner, repo, ref) {
  sweepQuarantines();
  let id;
  let q;
  for (let i = 0; i < 5 && !q; i++) {
    id = randomBytes(6).toString('hex');
    const dir = quarantineDir(id);
    try { fs.mkdirSync(dir, { mode: 0o700 }); q = dir; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  if (!q) throw new Error('no quarantine dir');
  const remove = () => fs.rmSync(q, { recursive: true, force: true, maxRetries: 3 });
  try {
    fs.mkdirSync(path.join(q, 'empty-hooks'));
    const target = path.join(q, 'repo');
    const env = childEnv(process.env, 'git');
    const deadline = Date.now() + FETCH_MS;
    const git = async (argv) => {
      const left = deadline - Date.now();
      if (left <= 0) return { timedOut: true };
      const r = await runCommand(argv, { env, cwd: q, timeoutMs: left, maxBytes: 1024 * 1024 });
      if (r.pid && (r.timedOut || r.oversize)) await killTree(r.pid);
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
    const w = walk(repoReal, { maxEntries: MAX_ENTRIES, maxDepth: 64, skipGit: true, sumBytes: true });
    if (w.tooLarge || w.bytes > QUARANTINE_MAX_BYTES) throw new Refusal('candidate too large');
    const { found, skippedInvalid } = discoverQuarantine(repoReal);
    return { v: 1, id, commit, skills: [...found.keys()], skipped_invalid: skippedInvalid };
  } catch (e) {
    remove();
    throw e;
  }
}

function cleanQuarantine(id) {
  const q = quarantineDir(id);
  let st = null;
  try { st = fs.lstatSync(q); } catch { st = null; }
  if (!st || !st.isDirectory()) return { v: 1, removed: false };
  fs.rmSync(q, { recursive: true, force: true, maxRetries: 3 });
  return { v: 1, removed: true };
}

// ---------- report ----------
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
    '## Summary',
    `- pass ${n(sum.pass)}, findings ${n(sum.findings)}, error ${n(sum.error)}`,
    '## Skills',
  ];
  for (const r of results) {
    const c = r.counts ?? {};
    const verdict = ['pass', 'findings', 'error'].includes(r.verdict) ? r.verdict : 'error';
    const eff = ['no-llm', 'claude_cli', 'static-fallback'].includes(r.effective_mode) ? r.effective_mode : '?';
    let line = `- ${pick(NAME_RE, r.name)} (${SCOPES.includes(r.scope) ? r.scope : '?'}): ${verdict} — critical ${n(c.critical)}, high ${n(c.high)}, medium ${n(c.medium)}, low ${n(c.low)} — mode ${eff}`;
    if (r.blocking === true) line += ' — blocking';
    if (typeof r.reason === 'string' && /^[a-z0-9-]{1,30}$/.test(r.reason)) line += ` — reason ${r.reason}`;
    if (r.shipped_baseline === true) line += ' — ships a baseline file (not applied)';
    lines.push(line);
  }
  lines.push('## Not scanned', `- ${n(output?.skipped_invalid)} entries with an invalid name were skipped (names not shown).`);
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
};

function parseArgs(argv) {
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
  if (skill !== undefined && !NAME_RE.test(skill)) throw new Refusal('bad skill name');
  const mode = flags.get('--mode');
  if (mode !== undefined && !MODES.includes(mode)) throw new Refusal('usage: bad mode');
  const report = flags.get('--report');
  if (report !== undefined && !SLUG_RE.test(report)) throw new Refusal('bad report slug');
  return { scope, quarantine, skill, mode, report };
}

function summarize(results) {
  const summary = { pass: 0, findings: 0, error: 0 };
  for (const r of results) summary[r.verdict]++;
  return summary;
}

async function runScan(flags) {
  const a = validateScan(flags);
  const info = await detect();
  if (!info.installed) throw new Refusal('skillspector missing', 3);
  const mode = a.mode ?? await settingsMode();
  let targets;
  let skippedInvalid = 0;
  if (a.quarantine !== undefined) {
    const repoReal = openQuarantine(a.quarantine);
    const { found, skippedInvalid: bad } = discoverQuarantine(repoReal);
    skippedInvalid = bad;
    targets = [...found].filter(([n]) => a.skill === undefined || n === a.skill)
      .map(([name, dir]) => ({ name, scope: 'quarantine', dir, outside: !inside([repoReal], realOrNull(dir) ?? dir) }));
  } else {
    const roots = cliRoots(process.cwd());
    const listed = listSkills(a.scope, roots);
    skippedInvalid = listed.skippedInvalid;
    const chosen = a.skill === undefined ? listed.skills : listed.skills.filter((s) => s.name === a.skill).slice(0, 1);
    targets = chosen.map((s) => {
      const r = resolveSkill(s.name, s.scope, roots);
      return r.ok ? { name: s.name, scope: s.scope, dir: r.realPath } : { name: s.name, scope: s.scope, failure: r.reason };
    });
    const seen = new Set();
    targets = targets.filter((t) => {
      if (!t.dir) return true;
      if (seen.has(t.dir)) return false;
      seen.add(t.dir);
      return true;
    });
  }
  if (a.skill !== undefined && targets.length === 0) throw new Refusal('skill not found');
  const results = [];
  for (const t of targets) {
    if (t.failure) results.push(errorResult(t.name, t.scope, t.failure, mode));
    else if (t.outside) results.push(errorResult(t.name, t.scope, 'outside-roots', mode));
    else results.push(await scanOne(t.dir, { mode, scope: t.scope, name: t.name }));
  }
  const output = {
    v: 1, tool: { version: info.version ?? '?', commit: info.commit }, mode, results, skipped_invalid: skippedInvalid, summary: summarize(results),
  };
  if (a.report !== undefined) await writeReport(process.cwd(), a.report, output, { scopeLabel: a.skill ?? a.scope });
  return output;
}

export async function main(argv) {
  const { command, flags, positional } = parseArgs(argv);
  if (command === 'install-commands') return { v: 1, install: [...INSTALL_COMMANDS], rollback: [...ROLLBACK_COMMANDS] };
  if (command === 'detect') return detect();
  if (command === 'list') {
    const scope = flags.get('--scope');
    if (!SCOPES.includes(scope)) throw new Refusal('usage: bad scope');
    const { skills, skippedInvalid } = listSkills(scope, cliRoots(process.cwd()));
    return { v: 1, skills, skipped_invalid: skippedInvalid };
  }
  if (command === 'scan') return runScan(flags);
  if (command === 'clean') {
    const id = flags.get('--quarantine');
    if (!ID_RE.test(id ?? '')) throw new Refusal('bad quarantine id');
    return cleanQuarantine(id);
  }
  const [target] = positional;
  const parts = target.split('/');
  if (parts.length !== 2 || !OWNER_RE.test(parts[0]) || !REPO_RE.test(parts[1]) || parts[1] === '.' || parts[1] === '..') throw new Refusal('bad repo');
  const ref = flags.get('--ref');
  if (ref !== undefined && !SHA_RE.test(ref)) throw new Refusal('bad ref');
  const info = await detect();
  if (!info.installed) throw new Refusal('skillspector missing', 3);
  return fetchRepo(parts[0], parts[1], ref);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((out) => {
    process.stdout.write(`${JSON.stringify(out)}\n`);
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
