#!/usr/bin/env node
// contract: docs/contracts/token-breakdown.md v1
// uses: token-ledger v1.12, lead-handoff v2.2
// Read-only token breakdown of the newest shipped runs: spend per Role from `ledger.mjs report`, the Lead
// spend inside the ledger time window, and where context was added and carried, read from transcripts.
// Only counts, times and tool names are kept; text, commands, paths and session IDs are dropped on read.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createProgress } from './progress.mjs';
import { validateRecord } from './ledger.mjs';
import { WorkFolderRefusal, exactWorkPath, isRunSlug, slugOfKey, workParts } from '../mods/lib/work-folder.mjs';

const MiB = 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 64 * MiB;
const MAX_TRANSCRIPT_LINE = 8 * MiB;
const MAX_REQUESTS = 100000;
const MAX_COUNT = 1000000000;
const MAX_LEDGER_BYTES = 2 * MiB;
const MAX_LEDGER_LINE = 512;
const MAX_RUN_FILE_BYTES = MiB;
const MAX_LEDGER_FILES = 5000;
const MAX_COMMAND_CHARS = 4096;
const MAX_REPORT_BYTES = 8 * MiB;
const DEFAULT_RUNS = 10;
const USAGE = 'usage: token-breakdown.mjs [--runs <n>] [--json]';

const EXCLUDED_RUN = /^(brainstorm|replay|baseline)-/;
const AGENT = /^[A-Za-z0-9_-]{1,64}$/;
const ROLE = /^(lead|[a-z][a-z0-9-]{0,40})$/;
const STEP_ID = /^[A-Za-z0-9._-]{1,16}$/;
const SESSION = /^[0-9a-f]{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const TEST_COMMAND = /\bnode --test\b|\bnpm test\b|\bnpm run test\b|test-run\.mjs/;
const TIME_KEYS = ['t0', 't1', 't_start', 't_ship'];
const CATEGORIES = ['file reads', 'test output', 'command output', 'other tool results', 'mixed', 'prompt', 'reply'];
const TOKEN_FIELDS = [['in', 'input_tokens'], ['cache_write', 'cache_creation_input_tokens'], ['cache_read', 'cache_read_input_tokens'], ['out', 'output_tokens']];

class SizeError extends Error {}
class Refusal extends Error {}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0 && v <= MAX_COUNT;

function timeMs(text) {
  if (typeof text !== 'string' || !TIME.test(text)) return undefined;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : undefined;
}

function parseArgs(args) {
  const opts = { runs: DEFAULT_RUNS, json: false };
  let sawRuns = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--json' && !opts.json) opts.json = true;
    else if (args[i] === '--runs' && !sawRuns && i + 1 < args.length && /^[1-9]\d?$/.test(args[i + 1]) && Number(args[i + 1]) <= 50) {
      opts.runs = Number(args[i + 1]);
      sawRuns = true;
      i += 1;
    } else throw new Refusal(USAGE);
  }
  return opts;
}

// ---------- ledger files ----------

function readLedgerFile(file) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_LEDGER_BYTES) return null;
    const records = [];
    for (const text of fs.readFileSync(file, 'utf8').split('\n')) {
      if (text === '' || Buffer.byteLength(text) > MAX_LEDGER_LINE) continue;
      let rec;
      try { rec = JSON.parse(text); } catch { continue; }
      if (validateRecord(rec).ok) records.push(rec);
    }
    return records;
  } catch {
    return null;
  }
}

// Shipped runs of the product, newest ship time first.
function shippedRuns(root) {
  const dir = path.join(root, '.company', 'ledger');
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).slice(0, MAX_LEDGER_FILES);
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    const key = name.slice(0, -'.jsonl'.length);
    if (EXCLUDED_RUN.test(key)) continue;
    const run = slugOfKey(key);
    if (run === null || !isRunSlug(run)) continue;
    const records = readLedgerFile(path.join(dir, name));
    if (records === null) continue;
    const ships = records.filter((r) => r.kind === 'ship');
    if (ships.length === 0) continue;
    const shipMs = Math.max(-1, ...ships.map((r) => timeMs(r.t_ship) ?? -1));
    const times = records.flatMap((r) => TIME_KEYS.map((k) => timeMs(r[k])).filter((t) => t !== undefined));
    found.push({ run, shipMs, window: times.length ? { lo: Math.min(...times), hi: Math.max(...times) } : null });
  }
  return found.sort((a, b) => b.shipMs - a.shipMs || (a.run < b.run ? 1 : -1));
}

// ---------- spend split from `report --json` ----------

function reportFor(root, run) {
  const ledger = path.join(import.meta.dirname, 'ledger.mjs');
  const r = spawnSync(process.execPath, [ledger, 'report', run, '--json'], {
    cwd: root, encoding: 'utf8', maxBuffer: MAX_REPORT_BYTES, timeout: 60000, env: process.env
  });
  if (r.error || r.status !== 0) return null;
  try {
    const rep = JSON.parse(r.stdout);
    if (!isObject(rep) || !Array.isArray(rep.rows) || !isObject(rep.totals) || !isCount(rep.totals.spend)) return null;
    const rows = [];
    for (const row of rep.rows) {
      if (!isObject(row) || typeof row.role !== 'string' || (row.spend !== null && !isCount(row.spend))) return null;
      rows.push({
        role: ROLE.test(row.role) ? row.role : null,
        id: typeof row.id === 'string' && STEP_ID.test(row.id) ? row.id : null,
        agent: typeof row.agent === 'string' && AGENT.test(row.agent) ? row.agent : null,
        spend: row.spend
      });
    }
    return { rows, total: rep.totals.spend };
  } catch {
    return null;
  }
}

// ---------- reading transcripts ----------

const claudeHomeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

function insideReal(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// The transcript file only when it is a regular file, not a link, inside the real projects folder.
function safeFile(projectsReal, file) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile()) return false;
    return insideReal(projectsReal, fs.realpathSync(file));
  } catch {
    return false;
  }
}

function projectsRoot(claudeHome) {
  try {
    const dir = path.join(claudeHome, 'projects');
    return { dir, real: fs.realpathSync(dir) };
  } catch {
    return null;
  }
}

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

// Every matching transcript; the caller refuses more than one (cct.M2).
function findAgentFile(projects, agent) {
  const found = [];
  for (const proj of subdirs(projects.dir)) {
    for (const sess of subdirs(path.join(projects.dir, proj))) {
      const file = path.join(projects.dir, proj, sess, 'subagents', `agent-${agent}.jsonl`);
      if (safeFile(projects.real, file)) found.push(file);
    }
  }
  return found;
}

function findLeadFiles(projects, sessions) {
  const files = [];
  const perSession = new Map();
  for (const proj of subdirs(projects.dir)) {
    let entries;
    try { entries = fs.readdirSync(path.join(projects.dir, proj)); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      const uuid = name.slice(0, -'.jsonl'.length);
      if (!UUID.test(uuid)) continue;
      if (!sessions.has(crypto.createHash('sha256').update(uuid).digest('hex').slice(0, 12))) continue;
      const file = path.join(projects.dir, proj, name);
      if (safeFile(projects.real, file)) {
        files.push(file);
        perSession.set(uuid, (perSession.get(uuid) ?? 0) + 1);
      }
    }
  }
  return { files, ambiguous: [...perSession.values()].some((n) => n > 1) };
}

function forEachLine(file, onLine) {
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(MiB);
    let pending = Buffer.alloc(0);
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      pending = pending.length === 0 ? Buffer.from(chunk.subarray(0, n)) : Buffer.concat([pending, chunk.subarray(0, n)]);
      let start = 0;
      for (let nl = pending.indexOf(10, start); nl !== -1; nl = pending.indexOf(10, start)) {
        if (nl - start > MAX_TRANSCRIPT_LINE) throw new SizeError('line');
        onLine(pending.subarray(start, nl));
        start = nl + 1;
      }
      pending = pending.subarray(start);
      if (pending.length > MAX_TRANSCRIPT_LINE) throw new SizeError('line');
    }
    if (pending.length > 0) onLine(pending);
  } finally {
    fs.closeSync(fd);
  }
}

function toolCategory(block) {
  if (block.name === 'Read') return 'file reads';
  if (block.name === 'Bash' || block.name === 'PowerShell') {
    const command = isObject(block.input) && typeof block.input.command === 'string' ? block.input.command.slice(0, MAX_COMMAND_CHARS) : '';
    return TEST_COMMAND.test(command) ? 'test output' : 'command output';
  }
  return 'other tool results';
}

// Requests in file order, each once: { usage, ts, cats }. A line that is not JSON, not an assistant turn or has a
// mistyped count is skipped. Tool calls of lines that share a request key are merged.
function readRequests(file) {
  if (fs.statSync(file).size > MAX_TRANSCRIPT_BYTES) throw new SizeError('file');
  const byKey = new Map();
  forEachLine(file, (buf) => {
    if (!buf.includes('"usage"')) return;
    let o;
    try { o = JSON.parse(buf.toString('utf8')); } catch { return; }
    if (!isObject(o) || o.type !== 'assistant' || !isObject(o.message) || !isObject(o.message.usage)) return;
    const key = [o.requestId, o.message.id, o.uuid].find((k) => typeof k === 'string' && k !== '' && k.length <= 200);
    if (key === undefined) return;
    const usage = {};
    let present = 0;
    for (const [name, field] of TOKEN_FIELDS) {
      if (!Object.hasOwn(o.message.usage, field)) { usage[name] = 0; continue; }
      if (!isCount(o.message.usage[field])) return;
      usage[name] = o.message.usage[field];
      present += 1;
    }
    if (present === 0) return;
    const entry = byKey.get(key) ?? { usage, ts: undefined, cats: new Set() };
    entry.usage = usage;
    entry.ts = timeMs(o.timestamp) ?? entry.ts;
    if (Array.isArray(o.message.content)) {
      for (const block of o.message.content) {
        if (isObject(block) && block.type === 'tool_use' && typeof block.name === 'string') entry.cats.add(toolCategory(block));
      }
    }
    byKey.set(key, entry);
    if (byKey.size > MAX_REQUESTS) throw new SizeError('requests');
  });
  return [...byKey.values()];
}

const contextOf = (u) => u.in + u.cache_write + u.cache_read;
const spendOf = (u) => u.in + u.cache_write + u.out;

function categoryOf(req) {
  if (req.cats.size === 0) return 'reply';
  return req.cats.size === 1 ? [...req.cats][0] : 'mixed';
}

// Context added per request credited to the category of the previous request's tool calls, and the cache reads
// it causes (added x later requests). With `baseline` the first request is only the starting point.
function categorize(reqs, baseline) {
  const added = {};
  const carried = {};
  let skipped = 0;
  const n = reqs.length;
  for (let i = baseline ? 1 : 0; i < n; i += 1) {
    const ctx = contextOf(reqs[i].usage);
    const delta = i === 0 ? ctx : ctx - contextOf(reqs[i - 1].usage);
    if (delta < 0) { skipped += 1; continue; }
    const cat = i === 0 ? 'prompt' : categoryOf(reqs[i - 1]);
    added[cat] = (added[cat] ?? 0) + delta;
    carried[cat] = (carried[cat] ?? 0) + delta * (n - 1 - i);
  }
  return { added, carried, skipped };
}

function readTranscript(file, baseline) {
  try {
    const reqs = readRequests(file);
    if (reqs.length === 0) return { reason: 'no usable requests' };
    return { reqs, ...categorize(reqs, baseline) };
  } catch (error) {
    if (error instanceof SizeError) return { reason: 'size' };
    return { reason: 'unreadable' };
  }
}

// ---------- Lead session ----------

// A file of the run folder, only through typed parts, an exact path, a regular file and a real path inside work/.
function readRunFile(root, run, name) {
  try {
    const parts = workParts(run);
    if (parts === null) return null;
    const io = { fs, path };
    if (exactWorkPath(io, root, parts) !== 'exact') return null;
    const file = path.join(root, '.company', 'work', ...parts, name);
    const realWork = fs.realpathSync.native(path.join(root, '.company', 'work'));
    if (realWork !== path.join(fs.realpathSync.native(root), '.company', 'work')) return null;
    const st = fs.lstatSync(file, { bigint: true });
    if (!st.isFile() || st.nlink !== 1n || st.size > BigInt(MAX_RUN_FILE_BYTES)) return null;
    const real = fs.realpathSync.native(file);
    if (real !== path.join(realWork, ...parts, name) || !insideReal(realWork, real)) return null;
    const fd = fs.openSync(file, 'r');
    try {
      const open = fs.fstatSync(fd, { bigint: true });
      if (!open.isFile() || open.nlink !== 1n || open.dev !== st.dev || open.ino !== st.ino || open.size > BigInt(MAX_RUN_FILE_BYTES)) return null;
      return fs.readFileSync(fd, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (error instanceof WorkFolderRefusal) return null;
    return null;
  }
}

function leadSessions(root, run) {
  const found = new Set();
  let named = false;
  const note = (value) => {
    named = true;
    if (typeof value === 'string' && SESSION.test(value)) found.add(value);
  };
  const context = readRunFile(root, run, 'lead-context.json');
  if (context !== null) {
    try {
      const o = JSON.parse(context);
      if (isObject(o) && Object.hasOwn(o, 'session')) note(o.session);
    } catch {
      // not JSON: no session
    }
  }
  const events = readRunFile(root, run, 'lead-handover.jsonl');
  if (events !== null) {
    for (const text of events.split('\n')) {
      if (text === '') continue;
      try {
        const o = JSON.parse(text);
        if (isObject(o) && o.ev === 'handover' && Object.hasOwn(o, 'session')) note(o.session);
      } catch {
        // skip the line
      }
    }
  }
  return { found, named };
}

function leadFor(root, run, window, projects) {
  const { found, named } = leadSessions(root, run);
  if (!named) return { reason: 'no Lead session recorded for this run' };
  if (found.size === 0) return { reason: 'the recorded Lead session is not valid' };
  if (window === null) return { reason: 'no ledger times to bound the Lead window' };
  if (projects === null) return { reason: 'no Lead transcript found' };
  const { files, ambiguous } = findLeadFiles(projects, found);
  if (ambiguous) return { reason: 'more than one Lead transcript for a session' };
  if (files.length === 0) return { reason: 'no Lead transcript found' };
  let spend = 0;
  let requests = 0;
  const tally = { added: {}, carried: {}, skipped: 0 };
  let readAny = false;
  let lastReason = 'size';
  for (const file of files) {
    const t = readTranscript(file, false);
    if (t.reason) { lastReason = t.reason; continue; }
    const inside = t.reqs.filter((r) => r.ts !== undefined && r.ts >= window.lo && r.ts <= window.hi);
    readAny = true;
    for (const r of inside) spend += spendOf(r.usage);
    requests += inside.length;
    if (inside.length > 0) merge(tally, categorize(inside, true));
  }
  if (!readAny) return { reason: `Lead transcript ${lastReason === 'size' ? 'over the size limit (size)' : lastReason}` };
  return { spend, requests, tally };
}

function merge(into, from) {
  for (const key of ['added', 'carried']) {
    for (const [cat, n] of Object.entries(from[key])) into[key][cat] = (into[key][cat] ?? 0) + n;
  }
  into.skipped += from.skipped;
}

// ---------- one run ----------

function measureRun(root, entry, projects) {
  const out = { run: entry.run, report: null, roles: [], total: 0, mismatch: false, lead: null, gaps: [], tally: { added: {}, carried: {}, skipped: 0 }, measured: false };
  const rep = reportFor(root, entry.run);
  if (rep === null) return out;
  out.report = 'ok';
  const byRole = new Map();
  for (const row of rep.rows) {
    if (row.spend === null) continue;
    const role = row.role ?? '(role refused)';
    byRole.set(role, (byRole.get(role) ?? 0) + row.spend);
  }
  out.roles = [...byRole].map(([role, spend]) => ({ role, spend }));
  out.total = rep.total;
  out.mismatch = out.roles.reduce((n, r) => n + r.spend, 0) !== rep.total;
  const seen = new Set();
  for (const row of rep.rows) {
    const label = { role: row.role ?? '(role refused)', id: row.id ?? '?' };
    if (row.agent === null) { out.gaps.push({ ...label, reason: 'no agent ID in the record' }); continue; }
    if (seen.has(row.agent)) continue;
    seen.add(row.agent);
    const matches = projects === null ? [] : findAgentFile(projects, row.agent);
    if (matches.length > 1) { out.gaps.push({ ...label, reason: 'more than one transcript found' }); continue; }
    const file = matches[0] ?? null;
    if (file === null) { out.gaps.push({ ...label, reason: 'transcript not found' }); continue; }
    const t = readTranscript(file, false);
    if (t.reason) { out.gaps.push({ ...label, reason: t.reason === 'size' ? 'transcript over the size limit (size)' : `transcript ${t.reason}` }); continue; }
    merge(out.tally, t);
    out.measured = true;
  }
  out.lead = leadFor(root, entry.run, entry.window, projects);
  if (out.lead.tally) {
    merge(out.tally, out.lead.tally);
    out.measured = true;
  }
  return out;
}

// ---------- report ----------

const sumOf = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const share = (n, total) => (Math.round((n / total) * 1000) / 10).toFixed(1);

function rank(carried) {
  const total = sumOf(carried);
  if (total === 0) return null;
  const list = CATEGORIES.map((cat) => ({ cat, n: carried[cat] ?? 0 })).sort((a, b) => b.n - a.n || CATEGORIES.indexOf(a.cat) - CATEGORIES.indexOf(b.cat));
  return { total, list };
}

function summarize(runs) {
  const all = { added: {}, carried: {}, skipped: 0 };
  let measuredRuns = 0;
  for (const r of runs) {
    if (!r.measured) continue;
    measuredRuns += 1;
    merge(all, r.tally);
  }
  const ranking = rank(all.carried);
  let sink = null;
  let hook = null;
  if (ranking !== null) {
    const top = ranking.list[0];
    sink = { category: top.cat, percent: share(top.n, ranking.total), runs: measuredRuns };
    const at = ranking.list.findIndex((x) => x.cat === 'test output');
    const other = at === 0 ? ranking.list[1] : ranking.list[0];
    hook = {
      yes: at <= 1 && ranking.list[at].n > 0,
      rank: at + 1,
      testShare: share(ranking.list[at].n, ranking.total),
      otherCategory: other.cat,
      otherShare: share(other.n, ranking.total)
    };
  }
  return { all, measuredRuns, ranking, sink, hook };
}

function markdown(runs, sum) {
  const out = ['# Token breakdown', '', `runs: ${runs.length}`, ''];
  if (runs.length === 0) {
    out.push('not measurable from records: no shipped runs');
    return out;
  }
  out.push('## Runs', '', ...runs.map((r) => `- ${r.run}`), '');
  for (const r of runs) {
    out.push(`## ${r.run}`, '');
    if (r.report === null) {
      out.push('- report failed: the run is left out', '');
      continue;
    }
    out.push('### Spend', '');
    for (const { role, spend } of r.roles) out.push(`- ${role}: ${spend}`);
    out.push(`- subagent total: ${r.total}${r.mismatch ? ' (mismatch: the Role sum differs from the total)' : ''}`);
    if (r.lead.reason) out.push(`- Lead: not measurable from records: ${r.lead.reason}`);
    else out.push(`- Lead: ${r.lead.spend} (${r.lead.requests} requests inside the ledger time window)`);
    out.push('');
    if (r.gaps.length > 0) {
      out.push('### Not measured', '');
      for (const g of r.gaps) out.push(`- ${g.role} step ${g.id}: not measurable from records: ${g.reason}`);
      out.push('');
    }
  }
  out.push('## Shares', '');
  if (sum.ranking === null) {
    for (const cat of CATEGORIES) out.push(`- ${cat}: not measurable from records: no transcript read`);
    out.push('');
    out.push('Top sink: not measurable from records: no transcript read');
    out.push('Test-output tail hook: not measurable from records: no transcript read');
    return out;
  }
  const addedTotal = sumOf(sum.all.added);
  out.push('### Added context', '');
  for (const cat of CATEGORIES) {
    const n = sum.all.added[cat] ?? 0;
    out.push(`- ${cat}: ${n} tokens, ${addedTotal === 0 ? 'n/a' : `${share(n, addedTotal)}%`} of added`);
  }
  out.push('', '### Carried context (cache reads caused)', '');
  for (const cat of CATEGORIES) {
    const n = sum.all.carried[cat] ?? 0;
    out.push(`- ${cat}: ${n} tokens, ${share(n, sum.ranking.total)}% of carried`);
  }
  out.push('', `Requests skipped for a context drop: ${sum.all.skipped}`, '');
  out.push(`Top sink: ${sum.sink.category} ${sum.sink.percent}% of carried tokens (${sum.sink.runs} runs)`);
  out.push(`Test-output tail hook: ${sum.hook.yes ? 'yes' : 'no'} (test output ${sum.hook.testShare}%, rank ${sum.hook.rank}; ${sum.hook.rank === 1 ? 'next' : 'first'} is ${sum.hook.otherCategory} ${sum.hook.otherShare}%)`);
  return out;
}

function jsonReport(runs, sum) {
  return {
    v: 1,
    runs: runs.map((r) => ({
      run: r.run,
      report: r.report ?? 'failed',
      roles: r.roles,
      subagent_total: r.total,
      mismatch: r.mismatch,
      lead: r.lead === null ? null : r.lead.reason ? { not_measurable: r.lead.reason } : { spend: r.lead.spend, requests: r.lead.requests },
      not_measurable: r.gaps,
      added: r.tally.added,
      carried: r.tally.carried
    })),
    added: sum.all.added,
    carried: sum.all.carried,
    skipped: sum.all.skipped,
    top_sink: sum.sink,
    tail_hook: sum.hook
  };
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    process.stderr.write(`refused: ${error.message}\n`);
    return 2;
  }
  const root = process.cwd();
  const entries = shippedRuns(root).slice(0, opts.runs);
  const projects = projectsRoot(claudeHomeDir());
  const progress = entries.length > 0 ? createProgress({ command: 'token-breakdown', total: entries.length, unit: 'runs' }) : null;
  const runs = [];
  try {
    progress?.start();
    for (const entry of entries) {
      progress?.begin(entry.run);
      const result = measureRun(root, entry, projects);
      runs.push(result);
      progress?.done(entry.run, result.report !== null);
    }
  } finally {
    progress?.end();
  }
  const sum = summarize(runs);
  process.stdout.write(opts.json ? `${JSON.stringify(jsonReport(runs, sum))}\n` : `${markdown(runs, sum).join('\n')}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
