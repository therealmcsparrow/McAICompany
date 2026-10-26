#!/usr/bin/env node
// Usage: node scripts/review-depth.mjs (<base-sha> | --staged | --worktree) [--risk low|medium|high] [--repo <dir>] [--json]
// Review depth follows the paths a diff touches (contract review-depth v1), never the builder's label.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_PATHS = 500;
const MAX_PROFILE = 1024 * 1024;
const GIT_OPTS = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024, timeout: 30000 };
const SHA = /^[0-9a-f]{7,40}$/;
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

export function analyze(paths, { core = [], modules = [], risk, limit = MAX_PATHS } = {}) {
  const { depth } = classify(paths, { core, risk });
  const listed = [];
  const reasons = [];
  if (risk === 'high') reasons.push({ path: '*', rule: 'risk tier — high' });
  paths.forEach((p, i) => {
    const rules = rulesFor(p, core);
    if (i < limit) listed.push({ path: p, categories: rules.map((r) => r.category), module: moduleFor(p, modules) });
    if (rules.length && reasons.length < limit) reasons.push({ path: p, rule: rules[0].rule });
  });
  return { depth, paths: listed, reasons, truncated: paths.length > limit };
}

function refuse(msg) {
  process.stdout.write(`refused: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { sha: undefined, staged: false, worktree: false, json: false, repo: undefined, risk: undefined };
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
    } else if (a === '--staged') flag('staged');
    else if (a === '--worktree') flag('worktree');
    else if (a === '--json') flag('json');
    else if (opts.sha === undefined && !a.startsWith('-')) opts.sha = a;
    else refuse('unexpected argument');
  }
  const modes = (opts.sha !== undefined) + opts.staged + opts.worktree;
  if (modes !== 1) refuse('give one of <base-sha>, --staged, --worktree');
  if (opts.sha !== undefined && !SHA.test(opts.sha)) refuse('base-sha must match ^[0-9a-f]{7,40}$');
  return opts;
}

const real = (p) => {
  const r = fs.realpathSync.native(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

// The directory git runs in: the project's own repository or a folder inside its top level.
function resolveRepo(dir) {
  try {
    const top = real(execFileSync('git', ['rev-parse', '--show-toplevel'], GIT_OPTS).trim());
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

const gitArgs = (repo, args) => (repo ? ['-C', repo, ...args] : args);
const gitPaths = (repo, args) => execFileSync('git', gitArgs(repo, args), GIT_OPTS).split('\0').filter(Boolean);

function hasHead(repo) {
  try {
    execFileSync('git', gitArgs(repo, ['rev-parse', '--verify', '-q', 'HEAD']), GIT_OPTS);
    return true;
  } catch {
    return false;
  }
}

function readPaths(opts, repo) {
  if (opts.sha !== undefined) return gitPaths(repo, ['diff', '-z', '--name-only', `${opts.sha}..HEAD`]);
  const staged = () => gitPaths(repo, ['diff', '-z', '--name-only', '--no-renames', '--cached']);
  if (opts.staged) return staged();
  const untracked = () => gitPaths(repo, ['ls-files', '-z', '--others', '--exclude-standard', '--full-name', '--', ':/']);
  if (!hasHead(repo)) return [...new Set([...staged(), ...untracked()])];
  return [...new Set([...gitPaths(repo, ['diff', '-z', '--name-only', '--no-renames', 'HEAD']), ...staged(), ...untracked()])];
}

function main(argv) {
  const opts = parseArgs(argv);
  const repo = opts.repo === undefined ? undefined : resolveRepo(opts.repo);
  const profile = readProfile();
  const core = coreFromProject(profile);
  const source = opts.sha !== undefined ? 'base' : opts.staged ? 'staged' : 'worktree';
  const head = { v: 1, source, base: opts.sha ?? null, tier: opts.risk ?? 'unknown' };

  let paths;
  try {
    paths = readPaths(opts, repo);
  } catch {
    if (opts.json) process.stdout.write(JSON.stringify({ ...head, depth: 'full', paths: [], reasons: [{ path: '*', rule: 'diff unavailable' }], truncated: false }) + '\n');
    else process.stdout.write('full\nreason: diff unavailable\n');
    return;
  }
  if (opts.json) {
    const a = analyze(paths, { core, modules: modulesFromProject(profile), risk: opts.risk });
    process.stdout.write(JSON.stringify({ ...head, depth: a.depth, paths: a.paths, reasons: a.reasons, truncated: a.truncated }) + '\n');
    return;
  }
  const { depth, reasons } = classify(paths, { core, risk: opts.risk });
  process.stdout.write([depth, ...reasons].join('\n') + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
