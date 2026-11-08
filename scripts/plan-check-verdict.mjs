#!/usr/bin/env node
// Plan-check verdict and history scan (contract: docs/contracts/plan-check.md v1.5). Node built-ins and git only.
// Read-only: nothing is written to the repository or to .company/. Output goes to stdout (one line for `verdict`).
// git runs through execFile with a fixed argument list, no shell, in the product root. Every value taken from git output and
// reused as an argument is matched against a strict pattern first.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateRecord } from './ledger.mjs';
import { isWorkFolder, projectIdOf } from '../mods/lib/work-folder.mjs';
import { loadPatterns, readRecord, scanText } from './plan-check.mjs';
import { show } from './run-state.mjs';

const PLAN_NAME_RE = /^(?:\d{2,3}-)?(?:architect-)?plan(?:-[a-z0-9]+)?\.md$/;
const MAX_PLAN_PATH = 200;
const WORK_PREFIX = '.company/work/';
const SHA_RE = /^[0-9a-f]{40}$/;
const SHA_PREFIX_RE = /^[0-9a-f]{7,64}$/;
const MAX_RUNS = 200;
const MAX_PLAN_BYTES = 256 * 1024;
const MAX_LEDGER_BYTES = 1024 * 1024;
const MAX_LEDGER_LINE = 512;
const MAX_LABELS_BYTES = 64 * 1024;
const MAX_LABELS = 1000;
const GIT_TIMEOUT_MS = 30000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const DEFAULT_RUNS = 5;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const RETUNE_ABOVE = 30;

class Refusal extends Error {}
const refuse = reason => { throw new Refusal(reason); };

// `.company/work/<work folder name>/<plan file name>` as { slug, name }, or null. The text is length-capped and split on `/`,
// and each part is checked with the shared name rule: linear cost, and a name never comes out of a pattern match.
function planPathParts(p) {
  if (typeof p !== 'string' || p.length > MAX_PLAN_PATH || !p.startsWith(WORK_PREFIX)) return null;
  const parts = p.slice(WORK_PREFIX.length).split('/');
  if (parts.length !== 2 || !isWorkFolder(parts[0]) || !PLAN_NAME_RE.test(parts[1])) return null;
  return { slug: parts[0], name: parts[1] };
}

const lstatOrNull = p => { try { return lstatSync(p); } catch { return null; } };

// ---------- git ----------

function gitEnv() {
  return { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
}

// Returns { ok, out } and never throws: any exit code other than 0, a signal, a timeout or an over-large output is a failure.
function git(root, args, { binary = false, maxBuffer = GIT_MAX_BUFFER } = {}) {
  try {
    const out = execFileSync('git', args, {
      cwd: root, env: gitEnv(), timeout: GIT_TIMEOUT_MS, maxBuffer, windowsHide: true,
      encoding: binary ? 'buffer' : 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
    return { ok: true, out };
  } catch {
    return { ok: false, out: binary ? Buffer.alloc(0) : '' };
  }
}

// Parses `--format=%x01%H%x09%ct --name-only` output into [{ sha, ct, paths }], newest first as git prints them.
function parseLog(text) {
  const commits = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('\x01')) {
      const [sha, ct] = line.slice(1).split('\t');
      commits.push({ sha, ct: /^\d{1,12}$/.test(ct ?? '') ? Number(ct) : null, paths: [] });
    } else if (line !== '' && commits.length > 0) commits[commits.length - 1].paths.push(line);
  }
  return commits;
}

// ---------- file reads ----------

function readBounded(file, max) {
  const st = lstatOrNull(file);
  if (!st || !st.isFile() || st.size > max) return null;
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const f = fstatSync(fd);
    if (!f.isFile() || f.nlink !== 1 || f.size > max) return null;
    const buf = Buffer.alloc(f.size);
    let off = 0;
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return buf.subarray(0, off);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// The last valid ship record of the run's ledger file, or null.
function lastShip(root, slug) {
  const buf = readBounded(join(root, '.company', 'ledger', `${slug}.jsonl`), MAX_LEDGER_BYTES);
  if (!buf) return null;
  let ship = null;
  for (const text of buf.toString('utf8').split('\n')) {
    if (text === '' || Buffer.byteLength(text) > MAX_LEDGER_LINE) continue;
    let rec;
    try { rec = JSON.parse(text); } catch { continue; }
    if (!validateRecord(rec).ok || rec.kind !== 'ship' || rec.run !== slug) continue;
    ship = rec;
  }
  return ship;
}

// The recorded fix_rounds of a ship record, or null.
const recordedFixRounds = ship => (ship !== null && Object.hasOwn(ship, 'fix_rounds') ? ship.fix_rounds : null);

// ---------- statistics ----------

export function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const show1 = m => (m === null ? '?' : m.toFixed(1));

// ---------- feature runs ----------

// Folders under .company/work that are runs: a plain folder with a valid name, a summary file and a plan file.
function featureRuns(root) {
  const work = join(root, '.company', 'work');
  let names;
  try { names = readdirSync(work).filter(isWorkFolder).sort(); } catch { return []; }
  const runs = [];
  for (const slug of names) {
    const dir = join(work, slug);
    const st = lstatOrNull(dir);
    if (!st || !st.isDirectory()) continue;
    const summary = lstatOrNull(join(dir, '00-summary.md'));
    if (!summary || !summary.isFile()) continue;
    let files;
    try { files = readdirSync(dir); } catch { continue; }
    const hasPlan = files.some(f => PLAN_NAME_RE.test(f) && lstatOrNull(join(dir, f))?.isFile());
    if (hasPlan) runs.push({ slug, mtime: Math.floor(summary.mtimeMs / 1000) });
  }
  return runs;
}

// Newest first by the committer time of the last commit that touched the summary; the file mtime when untracked.
function orderRuns(root, runs, warnings) {
  const res = git(root, ['log', '--no-color', '--no-renames', '--format=%x01%H%x09%ct', '--name-only', '--', '.company/work/*/00-summary.md']);
  const last = new Map();
  if (res.ok) {
    for (const c of parseLog(res.out)) {
      if (c.ct === null) continue;
      for (const p of c.paths) if (!last.has(p)) last.set(p, c.ct);
    }
  } else warnings.push('git unavailable: runs ordered by file time');
  const keyed = runs.map(r => ({ ...r, time: last.get(`.company/work/${r.slug}/00-summary.md`) ?? r.mtime }));
  keyed.sort((a, b) => b.time - a.time || (a.slug < b.slug ? -1 : 1));
  return { runs: keyed.slice(0, MAX_RUNS), gitFailed: !res.ok };
}

// Earliest add time (epoch seconds) per work-file name of one run, from one git call. null when git failed.
function addTimes(root, slug) {
  const res = git(root, ['log', '--no-color', '--no-renames', '--diff-filter=A', '--format=%x01%H%x09%ct', '--name-only', '--', `.company/work/${slug}`]);
  if (!res.ok) return null;
  const times = new Map();
  const prefix = `.company/work/${slug}/`;
  for (const c of parseLog(res.out)) {
    if (c.ct === null) continue;
    for (const p of c.paths) {
      if (!p.startsWith(prefix)) continue;
      const name = p.slice(prefix.length);
      if (!times.has(name) || c.ct < times.get(name)) times.set(name, c.ct);
    }
  }
  return times;
}

// The highest numeric round among the run's Step files dated no later than the first ship gate answer. A tracked file is dated by
// the commit that added it, any other file by its mtime in whole seconds.
function handoffRounds(root, slug, warnings, gitState) {
  let view;
  try { view = show(root, slug); } catch { return null; }
  const ship = view.gates.find(g => g.gate === 'ship');
  const cutoff = ship ? Date.parse(ship.at) : null;
  let times = null;
  if (cutoff !== null && !gitState.failed) {
    times = addTimes(root, slug);
    if (times === null) {
      gitState.failed = true;
      warnings.push('git unavailable: every work file dated by its mtime');
    }
  }
  let best = null;
  for (const s of view.steps) {
    if (typeof s.round !== 'number') continue;
    if (cutoff !== null) {
      const seconds = times !== null && times.has(s.file) ? times.get(s.file) : Math.floor(Date.parse(s.mtime) / 1000);
      if (!Number.isFinite(seconds) || seconds * 1000 > cutoff) continue;
    }
    if (best === null || s.round > best) best = s.round;
  }
  return best;
}

// Collects the counted runs. Throws the reader's error for a broken record.
function collectRuns(root, warnings) {
  const { runs: ordered, gitFailed } = orderRuns(root, featureRuns(root), warnings);
  const gitState = { failed: gitFailed };
  const counted = [];
  for (const r of ordered) {
    const ship = lastShip(root, r.slug);
    if (ship === null && projectIdOf(r.slug) !== null) continue;
    if (ship !== null && ship.path === 'short') continue;
    const rec = readRecord(root, r.slug);
    if (rec.state === 'error') { warnings.push(`${r.slug}: plan-check record in error state`); continue; }
    const recorded = recordedFixRounds(ship);
    const fromFiles = handoffRounds(root, r.slug, warnings, gitState);
    if (recorded === null || fromFiles === null || recorded !== fromFiles) {
      warnings.push(`${r.slug}: fix rounds ${recorded ?? 'none'} vs handoffs ${fromFiles ?? 'none'}`);
      continue;
    }
    counted.push({
      slug: r.slug, side: rec.state === 'on' ? 'on' : 'base', fix: recorded,
      findings: rec.state === 'on' ? rec.findings ?? 0 : 0, waved: rec.state === 'on' ? rec.waved ?? 0 : 0
    });
  }
  return counted;
}

function parseRuns(value) {
  if (!/^\d{1,2}$/.test(value) || Number(value) < 3 || Number(value) > 50) refuse('--runs must be a whole number from 3 to 50');
  return Number(value);
}

export function verdict(root, runsOption) {
  const n = runsOption ?? DEFAULT_RUNS;
  const warnings = [];
  let counted;
  try {
    counted = collectRuns(root, warnings);
  } catch (e) {
    return { code: 1, lines: [`plan-check verdict: error (${e.message})`], warnings };
  }
  const on = counted.filter(r => r.side === 'on').slice(0, n);
  const base = counted.filter(r => r.side === 'base').slice(0, n);
  const mOn = median(on.map(r => r.fix));
  const mBase = median(base.map(r => r.fix));
  const insufficient = on.length < n || base.length < n;
  const state = insufficient ? `insufficient (n=${Math.min(on.length, base.length)})` : (mBase - mOn >= 1 ? 'pass' : 'fail');
  const findings = on.reduce((a, r) => a + r.findings, 0);
  const waved = on.reduce((a, r) => a + r.waved, 0);
  let share = 'waved off n/a';
  if (findings > 0) {
    const pct = Math.round((100 * waved) / findings);
    share = `waved off ${pct}%${pct > RETUNE_ABOVE ? ' retune' : ''}`;
  }
  const parts = [`plan-check verdict: ${state}`, `check on: median ${show1(mOn)} (n=${on.length})`, `baseline: median ${show1(mBase)} (n=${base.length})`, share];
  if (state === 'fail') parts.push('default should become off');
  if (warnings.length > 0) parts.push(`warnings: ${warnings.length}`);
  return { code: 0, lines: [parts.join(' | ')], warnings, runs: { on, base } };
}

// ---------- history ----------

function readLabels(file) {
  const buf = readBounded(resolve(file), MAX_LABELS_BYTES);
  if (!buf) refuse('labels file: not a readable regular file of at most 64 KiB');
  let data;
  try { data = JSON.parse(buf.toString('utf8')); } catch { refuse('labels file: not JSON'); }
  const plain = o => o !== null && typeof o === 'object' && !Array.isArray(o);
  if (!plain(data) || Object.keys(data).length !== 2 || data.v !== 1 || !Array.isArray(data.labels)) refuse('labels file: expected {"v":1,"labels":[...]}');
  if (data.labels.length > MAX_LABELS) refuse(`labels file: at most ${MAX_LABELS} entries`);
  const seen = new Set();
  return data.labels.map((e, i) => {
    const bad = problem => refuse(`labels entry ${i}: ${problem}`);
    if (!plain(e)) bad('not an object');
    const keys = Object.keys(e);
    if (keys.length !== 4 || !['path', 'sha', 'line', 'label'].every(k => Object.hasOwn(e, k))) bad('keys must be exactly path, sha, line, label');
    if (planPathParts(e.path) === null) bad('path is not a plan path');
    if (typeof e.sha !== 'string' || !SHA_PREFIX_RE.test(e.sha)) bad('sha must be 7 to 64 lowercase hex characters');
    if (!Number.isSafeInteger(e.line) || e.line < 1 || e.line > 10000000) bad('line must be a positive whole number');
    if (e.label !== 'fp' && e.label !== 'tp') bad('label must be fp or tp');
    const key = `${e.path}\n${e.sha}\n${e.line}`;
    if (seen.has(key)) bad('duplicate entry');
    seen.add(key);
    return { path: e.path, sha: e.sha, line: e.line, label: e.label };
  });
}

function parseHistoryArgs(args) {
  const out = { labels: null, limit: DEFAULT_LIMIT, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') out.json = true;
    else if (a === '--labels' || a === '--limit') {
      const v = args[++i];
      if (v === undefined) refuse(`${a} needs a value`);
      if (a === '--labels') out.labels = v;
      else {
        if (!/^\d{1,3}$/.test(v) || Number(v) < 1 || Number(v) > MAX_LIMIT) refuse(`--limit must be a whole number from 1 to ${MAX_LIMIT}`);
        out.limit = Number(v);
      }
    } else refuse('unknown argument');
  }
  return out;
}

// Plans on disk now: [{ path, mtime }], at most MAX_RUNS folders, regular files only. null when there is no work folder.
function workingTreePlans(root) {
  const work = join(root, '.company', 'work');
  const st = lstatOrNull(work);
  if (!st || !st.isDirectory()) return null;
  let names;
  try { names = readdirSync(work).filter(isWorkFolder).sort().slice(0, MAX_RUNS); } catch { return []; }
  const plans = [];
  for (const slug of names) {
    const dir = join(work, slug);
    if (!lstatOrNull(dir)?.isDirectory()) continue;
    let files;
    try { files = readdirSync(dir); } catch { continue; }
    for (const name of files.filter(f => PLAN_NAME_RE.test(f)).sort()) {
      const fst = lstatOrNull(join(dir, name));
      if (fst?.isFile()) plans.push({ path: `.company/work/${slug}/${name}`, time: Math.floor(fst.mtimeMs / 1000) });
    }
  }
  return plans;
}

// A revision never parses as an option: --end-of-options comes before it.
export function catBlobArgs(sha, path) {
  return ['cat-file', 'blob', '--end-of-options', `${sha}:${path}`];
}

// Plans ever added in git: Map path -> { sha, ct } at the oldest adding commit. null when git failed.
function gitPlans(root) {
  const log = git(root, ['log', '--no-color', '--no-renames', '--diff-filter=A', '--format=%x01%H%x09%ct', '--name-only', '--', '.company/work']);
  if (!log.ok) return null;
  const oldest = new Map();
  for (const c of parseLog(log.out)) {
    if (!SHA_RE.test(c.sha) || c.ct === null) continue;
    for (const p of c.paths) {
      if (planPathParts(p) === null) continue;
      const prev = oldest.get(p);
      if (!prev || c.ct < prev.ct) oldest.set(p, { sha: c.sha, ct: c.ct });
    }
  }
  return oldest;
}

export function history(root, args) {
  const opt = parseHistoryArgs(args);
  const labels = opt.labels === null ? [] : readLabels(opt.labels);
  const warnings = [];
  let loaded;
  try { loaded = loadPatterns(); } catch (e) { return { code: 1, lines: [`history: ${e.message}`], warnings }; }
  const fromGit = gitPlans(root);
  const fromDisk = workingTreePlans(root);
  if (fromGit === null && fromDisk === null) return { code: 1, lines: ['history: git unavailable'], warnings };
  if (fromGit === null) warnings.push('git unavailable: working tree only');
  const merged = new Map();
  for (const p of fromDisk ?? []) merged.set(p.path, { path: p.path, source: 'working-tree', time: p.time });
  for (const [path, v] of fromGit ?? []) merged.set(path, { path, source: 'git', time: v.ct, sha: v.sha });
  const plans = [...merged.values()].sort((a, b) => b.time - a.time || (a.path < b.path ? -1 : 1)).slice(0, opt.limit);
  const result = [];
  for (const p of plans) {
    const m = planPathParts(p.path);
    let bytes;
    if (p.source === 'git') {
      const blob = git(root, catBlobArgs(p.sha, p.path), { binary: true, maxBuffer: MAX_PLAN_BYTES + 1 });
      bytes = blob.ok ? blob.out : null;
    } else bytes = readBounded(join(root, ...p.path.split('/')), MAX_PLAN_BYTES);
    const rev = p.source === 'git' ? p.sha : bytes === null ? null : createHash('sha256').update(bytes).digest('hex');
    const label = `${p.path}@${(rev ?? '0000000').slice(0, 7)}`;
    if (bytes === null || bytes.length > MAX_PLAN_BYTES) { warnings.push(`${label}: skipped (unreadable or over 256 KiB)`); continue; }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { warnings.push(`${label}: skipped (not UTF-8)`); continue; }
    const { findings } = scanText(text, loaded.patterns, { file: m.name });
    result.push({
      path: p.path, source: p.source, rev,
      findings: findings.map(f => {
        const hit = labels.find(l => l.path === p.path && l.line === f.line && rev.startsWith(l.sha));
        return { line: f.line, phrase: f.phrase, why: f.why, label: hit ? hit.label : 'unlabeled' };
      })
    });
  }
  const all = result.flatMap(r => r.findings);
  const fp = all.filter(f => f.label === 'fp').length;
  const tp = all.filter(f => f.label === 'tp').length;
  const rate = fp + tp > 0 ? Math.round((100 * fp) / (fp + tp)) : null;
  if (opt.json) {
    const data = { v: 1, plans: result, findings: all.length, labeled: fp + tp, falsePositives: fp, rate };
    return { code: 0, lines: [JSON.stringify(data)], warnings };
  }
  const lines = [];
  for (const r of result) {
    lines.push(`${r.path}@${r.rev.slice(0, 7)}${r.source === 'working-tree' ? ' (working tree)' : ''}: ${r.findings.length} findings`);
    for (const f of r.findings) lines.push(`  ${f.line} | ${f.phrase} | ${f.why} | ${f.label}`);
  }
  lines.push(rate === null
    ? `history: ${result.length} plans, ${all.length} findings, false-positive rate: no labels`
    : `history: ${result.length} plans, ${all.length} findings, labeled ${fp + tp}, false positives ${fp} (${rate}%)`);
  return { code: 0, lines, warnings };
}

// ---------- CLI ----------

const USAGE = 'usage: plan-check-verdict.mjs verdict [--runs <3-50>] | history [--labels <file>] [--limit <n>] [--json]';

// Returns { code, lines, warnings }. Exit 0 done, 1 a broken record or no git, 3 refused.
export function main(args, { root = process.cwd() } = {}) {
  try {
    const [command, ...rest] = args;
    if (command === 'verdict') {
      let runs;
      if (rest.length === 0) runs = undefined;
      else if (rest.length === 2 && rest[0] === '--runs') runs = parseRuns(rest[1]);
      else refuse(USAGE);
      return verdict(root, runs);
    }
    if (command === 'history') return history(root, rest);
    return refuse(USAGE);
  } catch (e) {
    if (e instanceof Refusal) return { code: 3, lines: [`refused: ${e.message}`], warnings: [] };
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { code, lines, warnings } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  if (warnings.length) process.stderr.write(`${warnings.map(w => `warning: ${w}`).join('\n')}\n`);
  process.exitCode = code;
}
