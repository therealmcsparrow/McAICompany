#!/usr/bin/env node
// Token ledger (contract: docs/contracts/token-ledger.md v1). Node built-ins only.
// Stores counts only, never prompt or reply content (GDPR Art. 5(1)(c)): every record is checked
// against an allow-list schema when it is written and again when it is read.
// Ledger files live in <cwd>/.company/ledger/<run>.jsonl.
// Transcript text is data (agentsec.M-SEC1): only four integers and a model id are read from it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MiB = 1024 * 1024;
const MAX_LEDGER_BYTES = MiB;
const MAX_LINE_BYTES = 512;
const MAX_TRANSCRIPT_BYTES = 64 * MiB;
const MAX_TRANSCRIPT_LINE = 8 * MiB;
const MAX_BASELINE_BYTES = MiB;
const MAX_REQUESTS = 100000;
const MAX_LIVE_AGENTS = 500;
const MAX_COUNT = 1000000000;

const RUN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const AGENT = /^[A-Za-z0-9_-]{1,64}$/;
const ROLE = /^(lead|[a-z][a-z0-9-]{0,40})$/;
const MODEL = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const BASELINE_KEY = /^[0-9a-f]{8} [A-Za-z0-9._/-]{1,100}$/;
const KINDS = ['step', 'round', 'crossfire', 'replay', 'total', 'ship', 'reflect'];
const ADD_KINDS = ['step', 'round', 'crossfire', 'replay'];
const TOKEN_KEYS = ['in', 'cache_write', 'cache_read', 'out'];
const RECORD_KEYS = new Set([
  'v', 'run', 'kind', 'id', 'role', 'agent', 'src', 'ctx_end', 'tokens', 'reqs', 'tool_uses', 'ms', 'model',
  'dispatches', 'acs', 'fix_rounds', 'high_blockers'
]);
const SHIP_ONLY = ['acs', 'fix_rounds', 'high_blockers'];
const SHIP_KEYS = new Set(['v', 'run', 'kind', 'acs', 'fix_rounds', 'high_blockers']);
const BASELINE_FIELDS = ['first', 'dispatches', 'requests', 'in', 'cache_write', 'cache_read', 'out', 'notif_total', 'roles'];
const USAGE = [
  'usage: ledger.mjs <command>',
  '  add <run> <kind> <id> <role> <agent> <ctx_end> [tool_uses] [ms]',
  '  add-mod <run> reflect <id> <in> <cache_write> <cache_read> <out> [model] [ms]',
  '  reconcile <run>',
  '  import <file> <key> <run> <acs>',
  '  ship <run> <acs> [fix_rounds] [high_blockers]',
  '  report <run> [--baseline <run>,<run>,<run>] [--json] [--live]',
  '  brainstorm-report <run> [--against <run>]'
].join('\n');

class Refusal extends Error {}
class SizeError extends Error {}

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isInt = (x, max) => Number.isSafeInteger(x) && x >= 0 && x <= max;
const ledgerDir = () => path.join(process.cwd(), '.company', 'ledger');

function checkRun(run) {
  if (typeof run !== 'string' || !RUN.test(run)) throw new Refusal('run must match ^[a-z0-9][a-z0-9-]{0,63}$');
  return run;
}

function checkRunList(list) {
  const runs = String(list).split(',');
  if (runs.length > 10) throw new Refusal('at most 10 runs');
  return runs.map(checkRun);
}

function parseCount(text, name, max = MAX_REQUESTS) {
  if (typeof text !== 'string' || !/^\d{1,10}$/.test(text) || Number(text) > max) {
    throw new Refusal(`${name} must be an integer 0-${max}`);
  }
  return Number(text);
}

// ---------- schema ----------

export function validateRecord(input) {
  const fail = (reason) => ({ ok: false, reason });
  if (!isObject(input)) return fail('not an object');
  const rec = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  for (const k of Object.keys(rec)) if (!RECORD_KEYS.has(k)) return fail('key outside the allow-list');
  if (rec.v !== 1) return fail('v must be 1');
  if (typeof rec.run !== 'string' || !RUN.test(rec.run)) return fail('invalid run');
  if (!KINDS.includes(rec.kind)) return fail('invalid kind');
  if (rec.kind === 'ship') {
    for (const k of Object.keys(rec)) if (!SHIP_KEYS.has(k)) return fail('key not allowed on ship');
    if (!isInt(rec.acs, MAX_REQUESTS)) return fail('acs must be an integer 0-100000');
    for (const k of ['fix_rounds', 'high_blockers']) {
      if (Object.hasOwn(rec, k) && !isInt(rec[k], MAX_REQUESTS)) return fail(`${k} must be an integer 0-100000`);
    }
    return { ok: true };
  }
  for (const k of SHIP_ONLY) if (Object.hasOwn(rec, k)) return fail(`${k} only on ship`);
  const idOk = {
    step: /^\d{2}$/,
    round: /^R\d{1,3}$/,
    crossfire: /^R\d{1,3}$/,
    replay: /^(\d{2}|R\d{1,3})$/,
    total: /^[0-9a-f]{8}$/,
    reflect: /^(\d{2}|RT)$/
  }[rec.kind];
  if (typeof rec.id !== 'string' || !idOk.test(rec.id)) return fail('invalid id');
  if (typeof rec.role !== 'string' || !ROLE.test(rec.role)) return fail('invalid role');
  if (Object.hasOwn(rec, 'agent') && (typeof rec.agent !== 'string' || !AGENT.test(rec.agent))) return fail('invalid agent');
  if (rec.kind === 'reflect' && (rec.role !== 'lead' || Object.hasOwn(rec, 'agent'))) return fail('reflect needs role lead and no agent');
  if (rec.kind !== 'total' && rec.kind !== 'reflect' && !(Object.hasOwn(rec, 'agent'))) return fail('agent required');
  if (rec.kind === 'total' && !isInt(rec.dispatches, MAX_REQUESTS)) return fail('dispatches must be an integer 0-100000');
  if (rec.kind !== 'total' && Object.hasOwn(rec, 'dispatches')) return fail('dispatches only on total');
  if (rec.src !== 'notification' && rec.src !== 'transcript' && rec.src !== 'mod') return fail('invalid src');
  if ((rec.kind === 'reflect') !== (rec.src === 'mod')) return fail('src mod goes with kind reflect only');
  if (rec.kind === 'total' && rec.src !== 'transcript') return fail('total needs src transcript');
  if (rec.src === 'notification') {
    if (!isInt(rec.ctx_end, 10000000)) return fail('ctx_end must be an integer 0-10000000');
    if (Object.hasOwn(rec, 'tokens')) return fail('tokens not allowed on a notification');
  } else {
    if (rec.src === 'mod' && Object.hasOwn(rec, 'ctx_end')) return fail('ctx_end not allowed on a mod record');
    if (Object.hasOwn(rec, 'ctx_end') && !isInt(rec.ctx_end, 10000000)) return fail('ctx_end must be an integer 0-10000000');
    const t = rec.tokens;
    if (!isObject(t)) return fail('tokens required on a transcript or mod record');
    const keys = Object.keys(t);
    if (keys.length !== 4 || !TOKEN_KEYS.every((k) => keys.includes(k))) return fail('tokens needs exactly in, cache_write, cache_read, out');
    if (!TOKEN_KEYS.every((k) => isInt(t[k], MAX_COUNT))) return fail('token counts must be integers 0-1000000000');
  }
  if (Object.hasOwn(rec, 'reqs') && !isInt(rec.reqs, MAX_REQUESTS)) return fail('reqs must be an integer 0-100000');
  if (Object.hasOwn(rec, 'tool_uses') && !isInt(rec.tool_uses, MAX_REQUESTS)) return fail('tool_uses must be an integer 0-100000');
  if (Object.hasOwn(rec, 'ms') && !isInt(rec.ms, 86400000)) return fail('ms must be an integer 0-86400000');
  if (Object.hasOwn(rec, 'model') && (typeof rec.model !== 'string' || !MODEL.test(rec.model))) return fail('invalid model');
  return { ok: true };
}

// ---------- storage ----------

const fileFor = (run) => path.join(ledgerDir(), `${checkRun(run)}.jsonl`);

function appendRecord(rec) {
  const verdict = validateRecord(rec);
  if (!verdict.ok) throw new Refusal(verdict.reason);
  const line = `${JSON.stringify(rec)}\n`;
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Refusal('record is over 512 bytes');
  const file = fileFor(rec.run);
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  if (size + Buffer.byteLength(line) > MAX_LEDGER_BYTES) throw new Refusal('ledger file would pass 1 MiB');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line);
}

// Returns { exists, records, warnings }. A bad line is skipped with a warning, never fatal.
function readLedger(run) {
  const file = fileFor(run);
  if (!fs.existsSync(file)) return { exists: false, records: [], warnings: [] };
  const warnings = [];
  if (fs.statSync(file).size > 2 * MAX_LEDGER_BYTES) {
    return { exists: true, records: [], warnings: ['warning: ledger over its size limit, not read'] };
  }
  const records = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
    if (text === '') return;
    let rec;
    try {
      rec = Buffer.byteLength(text) <= MAX_LINE_BYTES ? JSON.parse(text) : undefined;
    } catch {
      rec = undefined;
    }
    if (rec === undefined || !validateRecord(rec).ok) warnings.push(`warning: line ${i + 1} skipped`);
    else records.push(rec);
  });
  return { exists: true, records, warnings };
}

// ---------- transcripts (reconcile) ----------

function findTranscript(claudeHome, agent) {
  let projects;
  try {
    projects = fs.readdirSync(path.join(claudeHome, 'projects'), { withFileTypes: true });
  } catch {
    return null;
  }
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const projDir = path.join(claudeHome, 'projects', proj.name);
    let sessions;
    try {
      sessions = fs.readdirSync(projDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sess of sessions) {
      if (!sess.isDirectory()) continue;
      const file = path.join(projDir, sess.name, 'subagents', `agent-${agent}.jsonl`);
      try {
        if (fs.lstatSync(file).isFile()) return file;
      } catch {
        // not in this session
      }
    }
  }
  return null;
}

// Calls onLine(buffer) for every line; throws SizeError for a line over the cap.
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

function usageInt(usage, name) {
  return Object.hasOwn(usage, name) && isInt(usage[name], MAX_COUNT) ? usage[name] : undefined;
}

// Only type, requestId/message.id/uuid, message.model and four integer usage fields are read.
export function readTranscript(file) {
  if (fs.statSync(file).size > MAX_TRANSCRIPT_BYTES) throw new SizeError('file');
  const byRequest = new Map();
  let model;
  forEachLine(file, (buf) => {
    let o;
    try {
      o = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    if (!isObject(o) || o.type !== 'assistant' || !isObject(o.message) || !isObject(o.message.usage)) return;
    const key = [o.requestId, o.message.id, o.uuid].find((k) => typeof k === 'string' && k !== '' && k.length <= 200);
    if (key === undefined) return;
    const u = o.message.usage;
    const counts = {
      in: usageInt(u, 'input_tokens'),
      cache_write: usageInt(u, 'cache_creation_input_tokens'),
      cache_read: usageInt(u, 'cache_read_input_tokens'),
      out: usageInt(u, 'output_tokens')
    };
    if (TOKEN_KEYS.every((k) => counts[k] === undefined)) return;
    byRequest.set(key, Object.fromEntries(TOKEN_KEYS.map((k) => [k, counts[k] ?? 0])));
    if (byRequest.size > MAX_REQUESTS) throw new SizeError('requests');
    if (typeof o.message.model === 'string' && MODEL.test(o.message.model)) model = o.message.model;
  });
  if (byRequest.size === 0) return null;
  const tokens = { in: 0, cache_write: 0, cache_read: 0, out: 0 };
  let last;
  for (const u of byRequest.values()) {
    for (const k of TOKEN_KEYS) tokens[k] += u[k];
    last = u;
  }
  if (TOKEN_KEYS.some((k) => tokens[k] > MAX_COUNT)) throw new SizeError('counts');
  const ctx = TOKEN_KEYS.reduce((sum, k) => sum + last[k], 0);
  return { tokens, reqs: byRequest.size, model, ctx_end: ctx <= 10000000 ? ctx : undefined };
}

const claudeHomeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

// Builds the transcript record for one notification record. Returns { rec } or { warning } or {} when
// the transcript is missing, empty or not a valid record. Writes nothing.
function transcriptFor(note, claudeHome) {
  const file = findTranscript(claudeHome, note.agent);
  if (!file) return {};
  let result;
  try {
    result = readTranscript(file);
  } catch (error) {
    if (!(error instanceof SizeError)) throw error;
    return { warning: `warning: ${note.agent} skipped (size)` };
  }
  if (!result) return {};
  const rec = JSON.parse(JSON.stringify({
    v: 1, run: note.run, kind: note.kind, id: note.id, role: note.role, agent: note.agent, src: 'transcript',
    ctx_end: result.ctx_end, tokens: result.tokens, reqs: result.reqs, tool_uses: note.tool_uses, ms: note.ms,
    model: result.model
  }));
  return { rec };
}

function cmdReconcile(args) {
  if (args.length !== 1) throw new Refusal('usage: reconcile <run>');
  const run = checkRun(args[0]);
  const { exists, records, warnings } = readLedger(run);
  if (!exists) return [`no ledger for ${run}`];
  const out = [...warnings];
  const done = new Set(records.filter((r) => r.src === 'transcript' && r.agent).map((r) => r.agent));
  const claudeHome = claudeHomeDir();
  let reconciled = 0;
  const pending = new Set();
  for (const note of records.filter((r) => r.src === 'notification' && r.kind !== 'total')) {
    if (done.has(note.agent)) continue;
    done.add(note.agent); // one transcript record per agent
    pending.add(note.agent);
    const found = transcriptFor(note, claudeHome);
    if (found.warning) out.push(found.warning);
    if (!found.rec) continue;
    appendRecord(found.rec);
    pending.delete(note.agent);
    reconciled += 1;
  }
  out.push(`reconciled: ${reconciled}, not reconciled: ${pending.size}`);
  return out;
}

// ---------- add, ship, import ----------

function cmdAdd(args) {
  if (args.length < 6 || args.length > 8) throw new Refusal('usage: add <run> <kind> <id> <role> <agent> <ctx_end> [tool_uses] [ms]');
  const [run, kind, id, role, agent, ctxEnd, toolUses, ms] = args;
  if (!ADD_KINDS.includes(kind)) throw new Refusal(`kind must be one of ${ADD_KINDS.join(', ')}`);
  const rec = {
    v: 1, run: checkRun(run), kind, id, role, agent, src: 'notification', ctx_end: parseCount(ctxEnd, 'ctx_end', 10000000),
    tool_uses: toolUses === undefined ? undefined : parseCount(toolUses, 'tool_uses'),
    ms: ms === undefined ? undefined : parseCount(ms, 'ms', 86400000)
  };
  appendRecord(JSON.parse(JSON.stringify(rec)));
  return [];
}

function cmdAddMod(args) {
  const usage = 'usage: add-mod <run> reflect <id> <in> <cache_write> <cache_read> <out> [model] [ms]';
  if (args.length < 7 || args.length > 9) throw new Refusal(usage);
  const [run, kind, id, inT, cacheWrite, cacheRead, out, model, ms] = args;
  if (kind !== 'reflect') throw new Refusal('kind must be reflect');
  const rec = {
    v: 1, run: checkRun(run), kind, id, role: 'lead', src: 'mod',
    tokens: {
      in: parseCount(inT, 'in', MAX_COUNT), cache_write: parseCount(cacheWrite, 'cache_write', MAX_COUNT),
      cache_read: parseCount(cacheRead, 'cache_read', MAX_COUNT), out: parseCount(out, 'out', MAX_COUNT)
    },
    ms: ms === undefined ? undefined : parseCount(ms, 'ms', 86400000),
    model
  };
  appendRecord(JSON.parse(JSON.stringify(rec)));
  return [];
}

function cmdShip(args) {
  if (args.length < 2 || args.length > 4) throw new Refusal('usage: ship <run> <acs> [fix_rounds] [high_blockers]');
  const [run, acs, fixRounds, highBlockers] = args;
  const rec = { v: 1, run: checkRun(run), kind: 'ship', acs: parseCount(acs, 'acs') };
  if (fixRounds !== undefined) rec.fix_rounds = parseCount(fixRounds, 'fix_rounds');
  if (highBlockers !== undefined) rec.high_blockers = parseCount(highBlockers, 'high_blockers');
  appendRecord(rec);
  return [];
}

function cmdImport(args) {
  if (args.length !== 4) throw new Refusal('usage: import <file> <key> <run> <acs>');
  const [file, key, runName, acsText] = args;
  const run = checkRun(runName);
  const acs = parseCount(acsText, 'acs');
  if (!BASELINE_KEY.test(key)) throw new Refusal('key must look like "<8 hex> <name>"');
  let text;
  try {
    if (fs.statSync(file).size > MAX_BASELINE_BYTES) throw new Refusal('baseline file is over 1 MiB');
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw new Refusal('baseline file is not readable');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Refusal('baseline file is not valid JSON');
  }
  if (!isObject(data)) throw new Refusal('baseline file must be a JSON object');
  if (!Object.hasOwn(data, key)) throw new Refusal('key not found in the baseline file');
  const entry = data[key];
  if (!isObject(entry)) throw new Refusal('baseline entry must be an object');
  if (Object.keys(entry).some((k) => !BASELINE_FIELDS.includes(k))) throw new Refusal('baseline entry holds a key outside the allow-list');
  for (const k of ['dispatches', 'requests']) {
    if (!isInt(entry[k], MAX_REQUESTS)) throw new Refusal(`${k} must be an integer 0-100000`);
  }
  for (const k of TOKEN_KEYS) {
    if (!isInt(entry[k], MAX_COUNT)) throw new Refusal(`${k} must be an integer 0-1000000000`);
  }
  const total = {
    v: 1, run, kind: 'total', id: key.slice(0, 8), role: 'lead', src: 'transcript', reqs: entry.requests,
    dispatches: entry.dispatches, tokens: Object.fromEntries(TOKEN_KEYS.map((k) => [k, entry[k]]))
  };
  const ship = { v: 1, run, kind: 'ship', acs };
  for (const rec of [total, ship]) {
    const verdict = validateRecord(rec);
    if (!verdict.ok) throw new Refusal(verdict.reason);
  }
  const target = fileFor(run);
  if (fs.existsSync(target)) throw new Refusal(`${run}.jsonl exists`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(total)}\n${JSON.stringify(ship)}\n`, { flag: 'wx' });
  return [];
}

// ---------- reports ----------

const spendOf = (t) => t.in + t.cache_write + t.out;
function pct(value, base) {
  if (base === 0) return 'n/a';
  const p = Math.round(((value - base) / base) * 100) || 0;
  return `${p > 0 ? '+' : ''}${p}%`;
}

function median(list) {
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// A record with counts: a host transcript, an imported baseline, or a mod's own call.
const hasCounts = (r) => r.src === 'transcript' || r.src === 'mod';

function summarize(records) {
  const transcripts = records.filter(hasCounts);
  const spend = transcripts.reduce((s, r) => s + spendOf(r.tokens), 0);
  const cacheRead = transcripts.reduce((s, r) => s + r.tokens.cache_read, 0);
  const matched = new Set(transcripts.map((r) => r.agent).filter(Boolean));
  const unreconciled = records.filter((r) => r.src === 'notification' && !matched.has(r.agent));
  const ships = records.filter((r) => r.kind === 'ship');
  const acs = ships.length ? ships[ships.length - 1].acs : 0;
  return { transcripts, spend, cacheRead, unreconciled, acs, any: transcripts.length > 0 };
}

const perAc = (value, acs) => (acs > 0 ? Math.round(value / acs) : undefined);

function describe(rec, transcript) {
  const head = `${rec.kind} ${rec.id} ${rec.role}`;
  if (!transcript) {
    return `${head}  context at end ${rec.ctx_end ? rec.ctx_end : 'unknown'} (not reconciled)`;
  }
  const ctx = transcript.ctx_end ?? rec.ctx_end;
  return `${head}  spend ${spendOf(transcript.tokens)}  cache read ${transcript.tokens.cache_read}` +
    (ctx ? `  context at end ${ctx}` : '');
}

// One entry per dispatch, in file order: a notification joined with its transcript record, or a
// counted record on its own. A transcript whose agent has a notification is shown on that row.
function dispatchRows(records, live) {
  const byAgent = new Map(records.filter((r) => r.src === 'transcript' && r.agent).map((r) => [r.agent, r]));
  const noted = new Set(records.filter((r) => r.src === 'notification').map((r) => r.agent));
  const rows = [];
  for (const rec of records) {
    if (rec.src === 'notification') rows.push({ rec, t: byAgent.get(rec.agent) });
    else if (hasCounts(rec) && !(rec.src === 'transcript' && noted.has(rec.agent))) rows.push({ rec, t: rec });
  }
  return rows.map(({ rec, t }) => ({
    rec,
    t,
    json: {
      kind: rec.kind, id: rec.id, role: rec.role, agent: rec.agent ?? null,
      state: t ? (live.has(t) ? 'live' : 'reconciled') : 'unreconciled',
      tokens: t ? t.tokens : null,
      spend: t ? spendOf(t.tokens) : null,
      ctx_end: (t ? t.ctx_end ?? rec.ctx_end : rec.ctx_end) || null,
      ms: (t ? t.ms ?? rec.ms : rec.ms) ?? null,
      model: t?.model ?? null
    }
  }));
}

// Reads the transcripts of notified agents that have no transcript record, in memory only.
function liveRecords(records, warnings) {
  const done = new Set(records.filter((r) => r.src === 'transcript' && r.agent).map((r) => r.agent));
  const claudeHome = claudeHomeDir();
  const live = [];
  let limited = false;
  for (const note of records.filter((r) => r.src === 'notification' && r.kind !== 'total')) {
    if (done.has(note.agent)) continue;
    if (done.size >= MAX_LIVE_AGENTS) {
      limited = true;
      continue;
    }
    done.add(note.agent);
    const found = transcriptFor(note, claudeHome);
    if (found.warning) warnings.push(found.warning);
    if (found.rec && validateRecord(found.rec).ok) live.push(found.rec);
  }
  if (limited) warnings.push('warning: live limit reached, the rest stay unreconciled');
  return live;
}

function parseReportFlags(flags) {
  const usage = 'usage: report <run> [--baseline <run>,<run>,<run>] [--json] [--live]';
  const opts = { baselineRuns: [], json: false, live: false };
  let baseline = false;
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    if ((flag === '--json' || flag === '--live') && !opts[flag.slice(2)]) {
      opts[flag.slice(2)] = true;
    } else if (flag === '--baseline' && !baseline && i + 1 < flags.length) {
      baseline = true;
      i += 1;
      opts.baselineRuns = checkRunList(flags[i]);
    } else {
      throw new Refusal(usage);
    }
  }
  if (opts.json && baseline) throw new Refusal(usage);
  return opts;
}

function reportJson(run, records, warnings, live) {
  const sum = summarize(records);
  const rows = dispatchRows(records, live).map((r) => r.json);
  const cacheWrite = sum.transcripts.reduce((n, r) => n + r.tokens.cache_write, 0);
  const byKind = {};
  for (const r of sum.transcripts) byKind[r.kind] = (byKind[r.kind] ?? 0) + spendOf(r.tokens);
  const ac = sum.any && sum.acs > 0;
  return JSON.stringify({
    v: 1, run, rows,
    totals: {
      spend: sum.spend, cache_read: sum.cacheRead, cache_write: cacheWrite,
      cache_write_share: sum.spend === 0 ? 0 : Math.round((cacheWrite / sum.spend) * 10000) / 10000,
      by_kind: byKind
    },
    per_ac: { spend: ac ? perAc(sum.spend, sum.acs) : null, cache_read: ac ? perAc(sum.cacheRead, sum.acs) : null },
    not_reconciled: sum.unreconciled.length,
    warnings
  });
}

function cmdReport(args) {
  const [runName, ...flags] = args;
  const run = checkRun(runName);
  const { baselineRuns, json, live } = parseReportFlags(flags);
  const { exists, records: stored, warnings } = readLedger(run);
  if (!exists) {
    if (!json) return [`no ledger for ${run}`];
    return [JSON.stringify({
      v: 1, run, rows: [],
      totals: { spend: 0, cache_read: 0, cache_write: 0, cache_write_share: 0, by_kind: {} },
      per_ac: { spend: null, cache_read: null }, not_reconciled: 0, warnings: ['no ledger']
    })];
  }
  const liveRecs = live ? liveRecords(stored, warnings) : [];
  const records = [...stored, ...liveRecs];
  if (json) return [reportJson(run, records, warnings, new Set(liveRecs))];
  const out = [...warnings, `run ${run}`];
  const sum = summarize(records);
  for (const row of dispatchRows(records, new Set(liveRecs))) out.push(describe(row.rec, row.t));
  const acsNote = sum.acs > 0 ? ` (${sum.acs} ACs)` : '';
  const line = (label, value) => `${label}: ${value} total, ${sum.acs > 0 ? `${perAc(value, sum.acs)} per AC${acsNote}` : 'per AC n/a (no shipped ACs recorded)'}`;
  if (sum.any) {
    out.push(line('spend', sum.spend), line('cache read', sum.cacheRead));
  } else {
    out.push('spend: n/a (nothing reconciled)', 'cache read: n/a (nothing reconciled)');
  }
  out.push(`not reconciled: ${sum.unreconciled.length}`);
  if (baselineRuns.length) {
    const spends = [];
    const reads = [];
    for (const name of baselineRuns) {
      const base = readLedger(name);
      if (!base.exists) {
        out.push(`baseline ${name}: no ledger`);
        continue;
      }
      out.push(...base.warnings.map((w) => w.replace('warning: ', `warning: baseline ${name} `)));
      const b = summarize(base.records);
      if (!b.any || b.acs === 0) {
        out.push(`baseline ${name}: not usable (no transcript counts or no shipped ACs)`);
        continue;
      }
      spends.push(perAc(b.spend, b.acs));
      reads.push(perAc(b.cacheRead, b.acs));
    }
    if (spends.length) {
      const mine = (value) => (sum.any && sum.acs > 0 ? perAc(value, sum.acs) : undefined);
      const delta = (value, base) => (mine(value) === undefined ? 'n/a' : pct(mine(value), base));
      const s = median(spends);
      const c = median(reads);
      out.push(
        `spend median ${s} per AC, delta ${delta(sum.spend, s)} (baseline of ${spends.length} runs)`,
        `cache read median ${c} per AC, delta ${delta(sum.cacheRead, c)} (baseline of ${spends.length} runs)`
      );
    }
  }
  return out;
}

// Totals for rounds from round 2 on: spend, cache read, crossfire spend, per round, unreconciled count.
function roundTotals(records) {
  const roundNo = (r) => (/^R(\d+)$/.test(r.id ?? '') ? Number(r.id.slice(1)) : 0);
  const inScope = records.filter((r) => (r.kind === 'round' || r.kind === 'crossfire') && roundNo(r) >= 2);
  const sum = summarize(inScope);
  const rounds = new Map();
  let crossfire = 0;
  for (const t of sum.transcripts) {
    const n = roundNo(t);
    const row = rounds.get(n) ?? { spend: 0, cacheRead: 0 };
    row.spend += spendOf(t.tokens);
    row.cacheRead += t.tokens.cache_read;
    rounds.set(n, row);
    if (t.kind === 'crossfire') crossfire += spendOf(t.tokens);
  }
  return { inScope: inScope.length, sum, rounds, crossfire };
}

function cmdBrainstormReport(args) {
  const [runName, ...flags] = args;
  const run = checkRun(runName);
  let against;
  if (flags.length) {
    if (flags[0] !== '--against' || flags.length !== 2) throw new Refusal('usage: brainstorm-report <run> [--against <run>]');
    against = checkRun(flags[1]);
  }
  const { exists, records, warnings } = readLedger(run);
  if (!exists) return [`no ledger for ${run}`];
  const out = [...warnings];
  const mine = roundTotals(records);
  if (mine.inScope === 0) return [...out, 'no rounds from round 2 on'];
  out.push(`brainstorm ${run} (rounds 2 and later)`);
  for (const [n, row] of [...mine.rounds].sort((a, b) => a[0] - b[0])) {
    out.push(`R${n}  spend ${row.spend}  cache read ${row.cacheRead}`);
  }
  if (mine.sum.any) {
    out.push(`spend: ${mine.sum.spend} total`, `cache read: ${mine.sum.cacheRead} total`);
    out.push(`crossfire share: ${mine.sum.spend === 0 ? 'n/a' : `${Math.round((mine.crossfire / mine.sum.spend) * 100)}%`} of spend`);
  } else {
    out.push('spend: n/a (nothing reconciled)', 'cache read: n/a (nothing reconciled)');
  }
  out.push(`not reconciled: ${mine.sum.unreconciled.length}`);
  if (against) {
    const other = readLedger(against);
    if (!other.exists) {
      out.push(`against ${against}: no ledger`);
    } else {
      const o = roundTotals(other.records);
      if (!o.sum.any || !mine.sum.any) out.push(`against ${against}: n/a (nothing reconciled)`);
      else out.push(`against ${against}: spend delta ${pct(mine.sum.spend, o.sum.spend)}, cache read delta ${pct(mine.sum.cacheRead, o.sum.cacheRead)}`);
    }
  }
  return out;
}

// ---------- CLI ----------

export function main(args) {
  const [command, ...rest] = args;
  try {
    const handlers = {
      add: cmdAdd, 'add-mod': cmdAddMod, reconcile: cmdReconcile, import: cmdImport, ship: cmdShip, report: cmdReport,
      'brainstorm-report': cmdBrainstormReport
    };
    if (!Object.hasOwn(handlers, command ?? '')) throw new Refusal(USAGE);
    if ((command === 'report' || command === 'brainstorm-report') && rest.length === 0) throw new Refusal(USAGE);
    return { code: 0, lines: handlers[command](rest) };
  } catch (error) {
    if (error instanceof Refusal) return { code: 2, lines: [`refused: ${error.message}`] };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, lines } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
