#!/usr/bin/env node
// Review depth (contract: docs/contracts/review-depth.md v1.4). Node built-ins only.
// Usage: node scripts/review-depth.mjs (<base> --run <name> | --staged | --worktree) [--risk low|medium|high] [--repo <dir>] [--json [--lines]]
// Review depth follows the paths a diff touches, never the builder's label.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitTopLevel, openGit, runRef } from './rule-check.mjs';

const MAX_PATHS = 500;
const MAX_PROFILE = 1024 * 1024;
const MAX_BASE_PROFILE = 64 * 1024;
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RISKS = ['low', 'medium', 'high'];
const SEC_WORDS = ['auth', 'login', 'session', 'token', 'secret', 'crypt', 'password', 'payment', 'billing', 'permission'];
const CONTRACT_FILE = /^(openapi|asyncapi)\./;
const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'npm-shrinkwrap.json', 'cargo.lock', 'poetry.lock', 'gemfile.lock', 'composer.lock', 'go.sum', 'uv.lock']);

const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

function securityRule(lower, segs, base) {
  if (segs.some((s) => SEC_WORDS.some((w) => s.includes(w)))) return 'security path';
  if (segs.includes('migrations')) return 'security path (migrations)';
  if (lower.startsWith('.github/workflows/')) return 'security path (workflows)';
  if (/^agents\/[^/]+\.md$/.test(lower)) return 'security path (agent prompt)';
  if (lower === '.company/standards.md' || lower.startsWith('.company/standards/') || lower === '.company/checks.json' || lower === '.company/settings.json') return 'security path (ruleset/settings)';
  if (base === 'package.json' || LOCKFILES.has(base) || lower.startsWith('deps/')) return 'security path (dependencies)';
  if (lower.startsWith('hooks/')) return 'security path (hooks)';
  if (lower.startsWith('mods/')) return 'security path (mods)';
  return null;
}

// Every category a path falls in, ordered core, contract, security; the first entry names the reason.
function rulesFor(file, core) {
  const lower = norm(file).toLowerCase();
  const segs = lower.split('/');
  const base = segs[segs.length - 1];
  const out = [];
  for (const c of core) {
    const cn = norm(c).toLowerCase();
    if (cn && (lower === cn || lower.startsWith(cn + '/'))) {
      out.push({ category: 'core', rule: 'core path' });
      break;
    }
  }
  if (lower.startsWith('docs/contracts/') || segs.slice(0, -1).includes('contracts') || base.endsWith('.proto') || CONTRACT_FILE.test(base)) out.push({ category: 'contract', rule: 'contract path' });
  const sec = securityRule(lower, segs, base);
  if (sec) out.push({ category: 'security', rule: sec });
  return out;
}

export function classify(paths, { core = [], risk } = {}) {
  const reasons = [];
  for (const f of paths) {
    const [first] = rulesFor(f, core);
    if (first) reasons.push(`reason: ${f.replace(/[\r\n]/g, '?')} — ${first.rule}`);
  }
  if (risk === 'high') reasons.unshift('reason: risk tier — high');
  return { depth: reasons.length ? 'full' : 'standard', reasons };
}

function itemsUnder(text, heading) {
  const out = [];
  let inSection = false;
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (/^##\s/.test(line)) { inSection = new RegExp(`^##\\s+${heading}\\s*$`).test(line); continue; }
    if (!inSection) continue;
    const m = /^\s*[-*]\s+(.+)$/.exec(line);
    if (!m) continue;
    const item = m[1].split(':')[0].trim().replace(/^`|`$/g, '');
    if (item && !item.startsWith('(')) out.push(item);
  }
  return out;
}

export function coreFromProject(text) {
  return itemsUnder(text, 'Core');
}

export function modulesFromProject(text) {
  return itemsUnder(text, 'Modules');
}

// The first Modules item a path belongs to, or null. A name with "/" is a path prefix; any other name
// matches a directory segment of the path or its file name without the last extension.
export function moduleFor(file, modules) {
  const lower = norm(file).toLowerCase();
  const segs = lower.split('/');
  const stem = segs[segs.length - 1].replace(/\.[^.]*$/, '');
  for (const m of modules) {
    const mn = norm(m).toLowerCase();
    if (!mn) continue;
    if (mn.includes('/')) {
      if (lower === mn || lower.startsWith(mn + '/')) return m;
    } else if (segs.slice(0, -1).includes(mn) || stem === mn) return m;
  }
  return null;
}

export function analyze(paths, { core = [], modules = [], risk, limit = MAX_PATHS, lines } = {}) {
  const { depth } = classify(paths, { core, risk });
  const listed = [];
  const reasons = [];
  if (risk === 'high') reasons.push({ path: '*', rule: 'risk tier — high' });
  paths.forEach((p, i) => {
    const rules = rulesFor(p, core);
    if (i < limit) listed.push({ path: p, categories: rules.map((r) => r.category), module: moduleFor(p, modules), ...(lines ? { lines: lines.get(p) ?? 0 } : {}) });
    if (rules.length && reasons.length < limit) reasons.push({ path: p, rule: rules[0].rule });
  });
  return { depth, paths: listed, reasons, truncated: paths.length > limit };
}

class Refused extends Error {}

function refuse(msg) {
  throw new Refused(msg);
}

function parseArgs(argv) {
  const opts = { sha: undefined, run: undefined, staged: false, worktree: false, json: false, lines: false, repo: undefined, risk: undefined };
  const flag = (key) => {
    if (opts[key]) refuse('unexpected argument');
    opts[key] = true;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--risk') {
      if (opts.risk !== undefined) refuse('unexpected argument');
      opts.risk = argv[++i];
      if (!RISKS.includes(opts.risk)) refuse('--risk must be low, medium or high');
    } else if (a === '--repo') {
      if (opts.repo !== undefined) refuse('unexpected argument');
      opts.repo = argv[++i];
      if (!opts.repo || opts.repo.startsWith('-')) refuse('--repo needs a directory');
    } else if (a === '--run') {
      if (opts.run !== undefined) refuse('unexpected argument');
      opts.run = argv[++i];
      if (typeof opts.run !== 'string' || runRef(opts.run) === null) refuse('--run needs a run name');
    } else if (a === '--staged') flag('staged');
    else if (a === '--worktree') flag('worktree');
    else if (a === '--json') flag('json');
    else if (a === '--lines') flag('lines');
    else if (opts.sha === undefined && !a.startsWith('-')) opts.sha = a;
    else refuse('unexpected argument');
  }
  const modes = (opts.sha !== undefined) + opts.staged + opts.worktree;
  if (modes !== 1) refuse('give one of <base>, --staged, --worktree');
  if (opts.sha !== undefined && !FULL_SHA.test(opts.sha)) refuse('base must be a full object id (40 or 64 hex)');
  if (opts.lines && !opts.json) refuse('--lines needs --json');
  if (opts.sha === undefined && opts.run !== undefined) refuse('--run goes with a base');
  return opts;
}

const real = (p) => {
  const r = fs.realpathSync.native(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

// The directory git runs in: the project's own repository or a folder inside its top level.
function resolveRepo(dir) {
  try {
    const top = real(gitTopLevel(process.cwd()));
    const rel = path.relative(top, real(dir));
    if (rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))) return fs.realpathSync.native(dir);
  } catch { /* refused below */ }
  return refuse('repo outside the project');
}

function readProfile() {
  try {
    const fd = fs.openSync(path.join(process.cwd(), '.company', 'project.md'), 'r');
    try {
      const buf = Buffer.alloc(MAX_PROFILE);
      return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, MAX_PROFILE, 0));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

// .company/project.md as the base commit holds it, or null when it is missing, too big or has no `## Core`.
function profileAtBase(git, base) {
  const r = git.run(['cat-file', 'blob', '--end-of-options', `${base}:.company/project.md`], { maxBuffer: MAX_BASE_PROFILE + 1 });
  if (r.failed || r.status !== 0 || r.overflow || r.out.length > MAX_BASE_PROFILE) return null;
  const text = r.out.toString('utf8');
  return /^## Core[ \t]*\r?$/m.test(text) ? text : null;
}

function listPaths(git, mode, endpoints) {
  const r = git.diff(['-z', '--name-only', '--no-renames', ...mode], endpoints);
  if (r.failed || r.status !== 0 || r.overflow) throw new Error('git failed');
  return r.out.toString('utf8').split('\0').filter(Boolean);
}

// Added plus deleted lines per path from the judging numstat; a binary file counts 0. Map(path -> lines).
function listLines(git, mode, endpoints) {
  const r = git.diff(['-z', '--numstat', '--no-renames', ...mode], endpoints);
  if (r.failed || r.status !== 0 || r.overflow) throw new Error('git failed');
  const out = new Map();
  for (const rec of r.out.toString('utf8').split('\0')) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(rec);
    if (m) out.set(m[3], (m[1] === '-' ? 0 : Number(m[1])) + (m[2] === '-' ? 0 : Number(m[2])));
  }
  return out;
}

function readLines(opts, git) {
  if (opts.sha !== undefined) return listLines(git, [], [opts.sha, runRef(opts.run)]);
  const staged = () => listLines(git, ['--cached'], []);
  if (opts.staged || !hasHead(git)) return staged();
  const out = listLines(git, [], ['HEAD']);
  for (const [p, n] of staged()) if (!out.has(p)) out.set(p, n);
  return out;
}

function untrackedPaths(git) {
  const r = git.run(['ls-files', '-z', '--others', '--exclude-standard', '--full-name', '--', ':/']);
  if (r.failed || r.status !== 0 || r.overflow) throw new Error('git failed');
  return r.out.toString('utf8').split('\0').filter(Boolean);
}

function hasHead(git) {
  const r = git.run(['rev-parse', '--verify', '-q', 'HEAD']);
  return !r.failed && r.status === 0;
}

function readPaths(opts, git) {
  if (opts.sha !== undefined) return listPaths(git, [], [opts.sha, runRef(opts.run)]);
  const staged = () => listPaths(git, ['--cached'], []);
  if (opts.staged) return staged();
  if (!hasHead(git)) return [...new Set([...staged(), ...untrackedPaths(git)])];
  return [...new Set([...listPaths(git, [], ['HEAD']), ...staged(), ...untrackedPaths(git)])];
}

function full(opts, head, reason) {
  if (opts.json) return JSON.stringify({ ...head, depth: 'full', paths: [], reasons: [{ path: '*', rule: reason }], truncated: false }) + '\n';
  return `full\nreason: ${reason}\n`;
}

// { code, out } for one invocation. `seam` lets a test replace the graft-path query.
export function run(argv, { seam } = {}) {
  try {
    return { code: 0, out: answer(argv, seam) };
  } catch (error) {
    if (error instanceof Refused) return { code: 2, out: `refused: ${error.message}\n` };
    throw error;
  }
}

function answer(argv, seam) {
  const opts = parseArgs(argv);
  const repo = opts.repo === undefined ? undefined : resolveRepo(opts.repo);
  const source = opts.sha !== undefined ? 'base' : opts.staged ? 'staged' : 'worktree';
  const head = { v: 1, source, base: opts.sha ?? null, tier: opts.risk ?? 'unknown' };
  if (source === 'base' && opts.run === undefined) return full(opts, head, 'no run ref');
  const opened = openGit(repo ?? process.cwd(), seam);
  if (!opened.ok) return full(opts, head, opened.reason === 'git unavailable' ? 'diff unavailable' : opened.reason);
  const { git } = opened;
  if (source === 'base') {
    if (git.head() !== `${runRef(opts.run)}\n`) return full(opts, head, 'head not on run branch');
    const length = git.objectLength();
    if (length !== 0 && opts.sha.length !== length) return full(opts, head, 'diff unavailable');
  }
  let paths;
  try {
    paths = readPaths(opts, git);
  } catch {
    return full(opts, head, 'diff unavailable');
  }
  let lines;
  if (opts.lines) {
    try {
      lines = readLines(opts, git);
    } catch {
      return full(opts, head, 'diff unavailable');
    }
  }
  const profile = source === 'base' ? profileAtBase(git, opts.sha) : readProfile();
  if (profile === null && opts.lines) {
    const a = analyze(paths, { lines });
    return JSON.stringify({ ...head, depth: 'full', paths: a.paths, reasons: [{ path: '*', rule: 'core unknown at base' }], truncated: a.truncated }) + '\n';
  }
  if (profile === null) return full(opts, head, 'core unknown at base');
  const core = coreFromProject(profile);
  if (opts.json) {
    const a = analyze(paths, { core, modules: modulesFromProject(profile), risk: opts.risk, lines });
    return JSON.stringify({ ...head, depth: a.depth, paths: a.paths, reasons: a.reasons, truncated: a.truncated }) + '\n';
  }
  const { depth, reasons } = classify(paths, { core, risk: opts.risk });
  return [depth, ...reasons].join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out } = run(process.argv.slice(2));
  process.stdout.write(out);
  process.exitCode = code;
}
