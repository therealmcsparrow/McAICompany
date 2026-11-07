#!/usr/bin/env node
// Token ledger (contract: docs/contracts/token-ledger.md v1.9). Node built-ins only.
// Stores counts only, never prompt or reply content (GDPR Art. 5(1)(c)): every record is checked
// against an allow-list schema when it is written and again when it is read.
// Ledger files live in <root>/.company/ledger/<run>.jsonl; <root> is the working directory unless main() is given one.
// Transcript text is data (agentsec.M-SEC1): only four integers and a model id are read from it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRecord as readPlanCheck } from './plan-check.mjs';
import { costText, readCost } from './cost-source.mjs';
import { readParallel } from './plan-tasks.mjs';
import { show as showRun } from './run-state.mjs';
import { WorkFolderRefusal, exactWorkPath, isWorkFolder } from '../mods/lib/work-folder.mjs';
import { readTierPath } from './tier-set.mjs';
import * as settings from './settings.mjs';

const MiB = 1024 * 1024;
const MAX_LEDGER_BYTES = MiB;
const MAX_LINE_BYTES = 512;
const MAX_TRANSCRIPT_BYTES = 64 * MiB;
const MAX_TRANSCRIPT_LINE = 8 * MiB;
const MAX_BASELINE_BYTES = MiB;
const MAX_REQUESTS = 100000;
const MAX_LIVE_AGENTS = 500;
const MAX_COUNT = 1000000000;
const CTX_CAP = 95000;
const MAX_AGENT_IDS = 8;
const MAX_COMPARE_FILES = 500;
const MAX_PLUGIN_JSON_BYTES = 64 * 1024;
const MAX_VERDICT_BYTES = 32 * MiB;
const MIN_BASELINE_RUNS = 5;
const MAX_WAIT = 31536000;
const MAX_REJECTS = 1000;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const TIME_MIN = Date.parse('2026-01-01T00:00:00Z');
const TIME_MAX = Date.parse('2100-01-01T00:00:00Z');
const EXCLUDED_RUN = /^(brainstorm|replay|baseline)-/;
const TIERS = ['low', 'medium', 'high'];

const isRun = (name) => typeof name === 'string' && isWorkFolder(name);
const AGENT = /^[A-Za-z0-9_-]{1,64}$/;
const ROLE = /^(lead|[a-z][a-z0-9-]{0,40})$/;
const MODEL = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const AICO_VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const META_KEYS = ['v', 'run', 'kind', 'aico'];
const META_OPTIONAL = ['floor', 'pb', 'sets'];
const PLAYBOOKS = ['feature', 'fix'];
const PATHS = ['full', 'short'];
const TIER_RANK = { low: 0, medium: 1, high: 2 };
const PAR_KEYS = ['v', 'run', 'kind', 'cap', 'peak', 'waits', 'out'];
const PAR_ONLY = ['cap', 'peak', 'waits', 'out'];
// The `release` of company/model-floor.json at tag v0.17.0: the floor a 0.17.x run without a `floor` key ran on.
export const FLOOR_RELEASE_V017 = '0.16.0';
const BUILDER_ROLES = ['backend-engineer', 'frontend-engineer', 'desktop-engineer', 'ai-data-engineer', 'game-engineer'];
const FAMILIES = ['haiku', 'sonnet', 'opus'];
const BASELINE_KEY = /^[0-9a-f]{8} [A-Za-z0-9._/-]{1,100}$/;
const KINDS = ['step', 'round', 'crossfire', 'replay', 'total', 'ship', 'reflect', 'meta', 'par'];
const ADD_KINDS = ['step', 'round', 'crossfire', 'replay'];
const TOKEN_KEYS = ['in', 'cache_write', 'cache_read', 'out'];
const RECORD_KEYS = new Set([
  'v', 'run', 'kind', 'id', 'role', 'agent', 'src', 'ctx_end', 'tokens', 'reqs', 'tool_uses', 'ms', 'model',
  'dispatches', 'acs', 'fix_rounds', 'high_blockers', 't0', 't1', 'tier', 't_start', 't_ship', 'wait', 'rej_brief', 'rej_plan', 'rej_ship', 'aico', 'floor', 'cap', 'peak', 'waits', 'out', 'pb', 'sets', 'path', 'raised'
]);
const SHIP_ONLY = ['acs', 'fix_rounds', 'high_blockers', 'tier', 't_start', 't_ship', 'wait', 'rej_brief', 'rej_plan', 'rej_ship', 'path', 'raised'];
const SHIP_KEYS = new Set(['v', 'run', 'kind', ...SHIP_ONLY]);
const REJECT_KEYS = ['rej_brief', 'rej_plan', 'rej_ship'];
const BASELINE_FIELDS = ['first', 'dispatches', 'requests', 'in', 'cache_write', 'cache_read', 'out', 'notif_total', 'roles'];
const USAGE = [
  'usage: ledger.mjs <command>',
  '  add <run> <kind> <id> <role> <agent> <ctx_end> [tool_uses] [ms]',
  '  add-mod <run> reflect <id> <in> <cache_write> <cache_read> <out> [model] [ms]',
  '  reconcile <run>',
  '  import <file> <key> <run> <acs>',
  '  ship <run> <acs> [fix_rounds] [high_blockers] [--baseline <run>,<run>,<run>]',
  '  scorecard <run> [--baseline <run>,<run>,<run>]',
  '  receipt <run> [--baseline <run>,<run>,<run>]',
  '  report <run> [--baseline <run>,<run>,<run>] [--acs <n>] [--json] [--live]',
  '  agent-ctx <agent>... [--json]',
  '  brainstorm-report <run> [--against <run>]',
  '  model-verdict [--runs <3-50>]',
  '  parallel-verdict [--runs <3-50>]',
  '  low-path-verdict [--runs <3-50>]'
].join('\n');

class Refusal extends Error {}
class SizeError extends Error {}

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isInt = (x, max) => Number.isSafeInteger(x) && x >= 0 && x <= max;

// The product root and the clock for the call in progress; main() sets them and puts them back.
let env = { root: process.cwd(), now: Date.now(), pluginRoot: path.resolve(import.meta.dirname, '..'), loadFloor: settings.loadModelFloor };
const ledgerDir = () => path.join(env.root, '.company', 'ledger');
const isoSec = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// Epoch ms of a UTC time in the contract's range that survives a round trip, else undefined.
function timeMs(text) {
  if (typeof text !== 'string' || !TIME.test(text)) return undefined;
  const ms = Date.parse(text);
  return Number.isFinite(ms) && ms >= TIME_MIN && ms < TIME_MAX && isoSec(ms) === text ? ms : undefined;
}

function checkRun(run) {
  if (!isRun(run)) throw new Refusal('run must be a work folder name or a legacy slug');
  try { exactWorkPath({ fs, path }, env.root, [run]); } catch (error) {
    if (error instanceof WorkFolderRefusal) throw new Refusal(error.message);
    throw error;
  }
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
  if (!isRun(rec.run)) return fail('invalid run');
  if (!KINDS.includes(rec.kind)) return fail('invalid kind');
  if (rec.kind !== 'par') for (const k of PAR_ONLY) if (Object.hasOwn(rec, k)) return fail(`${k} only on par`);
  if (rec.kind !== 'meta') for (const k of ['floor', 'pb', 'sets']) if (Object.hasOwn(rec, k)) return fail(`${k} only on meta`);
  if (rec.kind === 'par') {
    const keys = Object.keys(rec);
    if (keys.length !== PAR_KEYS.length || !PAR_KEYS.every((k) => keys.includes(k))) return fail('par needs exactly v, run, kind, cap, peak, waits, out');
    const within = (x, min, max) => Number.isSafeInteger(x) && x >= min && x <= max;
    if (!within(rec.cap, 1, 5)) return fail('cap must be an integer 1-5');
    if (!within(rec.peak, 0, 100)) return fail('peak must be an integer 0-100');
    if (!within(rec.waits, 0, 10000)) return fail('waits must be an integer 0-10000');
    if (!within(rec.out, 0, 10000)) return fail('out must be an integer 0-10000');
    return { ok: true };
  }
  if (rec.kind === 'meta') {
    const keys = Object.keys(rec);
    const allowed = [...META_KEYS, ...META_OPTIONAL];
    if (!META_KEYS.every((k) => keys.includes(k)) || !keys.every((k) => allowed.includes(k))) return fail('meta needs exactly v, run, kind, aico and optionally floor, pb, sets');
    if (typeof rec.aico !== 'string' || !AICO_VERSION.test(rec.aico)) return fail('aico must be a version like 0.17.0');
    if (Object.hasOwn(rec, 'floor') && (typeof rec.floor !== 'string' || !AICO_VERSION.test(rec.floor))) return fail('floor must be a version like 0.16.0');
    if (Object.hasOwn(rec, 'pb') && !PLAYBOOKS.includes(rec.pb)) return fail('pb must be feature or fix');
    if (Object.hasOwn(rec, 'sets') && !(Number.isSafeInteger(rec.sets) && rec.sets >= 1 && rec.sets <= 999)) return fail('sets must be an integer 1-999');
    return { ok: true };
  }
  if (Object.hasOwn(rec, 'aico')) return fail('aico only on meta');
  if (rec.kind === 'ship') {
    for (const k of Object.keys(rec)) if (!SHIP_KEYS.has(k)) return fail('key not allowed on ship');
    if (!isInt(rec.acs, MAX_REQUESTS)) return fail('acs must be an integer 0-100000');
    for (const k of ['fix_rounds', 'high_blockers']) {
      if (Object.hasOwn(rec, k) && !isInt(rec[k], MAX_REQUESTS)) return fail(`${k} must be an integer 0-100000`);
    }
    if (Object.hasOwn(rec, 'tier') && !TIERS.includes(rec.tier)) return fail('tier must be low, medium or high');
    for (const k of REJECT_KEYS) {
      if (Object.hasOwn(rec, k) && !isInt(rec[k], MAX_REJECTS)) return fail(`${k} must be an integer 0-1000`);
    }
    if (Object.hasOwn(rec, 'path') && !PATHS.includes(rec.path)) return fail('path must be full or short');
    if (Object.hasOwn(rec, 'raised') && rec.raised !== 0 && rec.raised !== 1) return fail('raised must be 0 or 1');
    if (Object.hasOwn(rec, 't_start') !== Object.hasOwn(rec, 't_ship')) return fail('t_start and t_ship come together');
    let span;
    if (Object.hasOwn(rec, 't_start')) {
      const start = timeMs(rec.t_start);
      const end = timeMs(rec.t_ship);
      if (start === undefined || end === undefined) return fail('t_start and t_ship must be UTC times from 2026 to 2099');
      if (start > end) return fail('t_start is later than t_ship');
      span = (end - start) / 1000;
    }
    if (Object.hasOwn(rec, 'wait')) {
      if (!isInt(rec.wait, MAX_WAIT)) return fail('wait must be an integer 0-31536000');
      if (span !== undefined && rec.wait > span) return fail('wait is longer than the run');
    }
    return { ok: true };
  }
  for (const k of SHIP_ONLY) if (Object.hasOwn(rec, k)) return fail(`${k} only on ship`);
  const idOk = {
    step: /^\d{2,3}$/,
    round: /^R\d{1,3}$/,
    crossfire: /^R\d{1,3}$/,
    replay: /^(\d{2,3}|R\d{1,3})$/,
    total: /^[0-9a-f]{8}$/,
    reflect: /^(\d{2,3}|RT)$/
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
  if (Object.hasOwn(rec, 't0') || Object.hasOwn(rec, 't1')) {
    if (rec.src !== 'notification' || !ADD_KINDS.includes(rec.kind)) return fail('t0 and t1 only on a dispatch notification');
    const t1 = timeMs(rec.t1);
    if (!Object.hasOwn(rec, 't1') || t1 === undefined) return fail('t1 must be a UTC time from 2026 to 2099');
    if (Object.hasOwn(rec, 't0')) {
      const t0 = timeMs(rec.t0);
      if (t0 === undefined) return fail('t0 must be a UTC time from 2026 to 2099');
      if (t0 > t1) return fail('t0 is later than t1');
    }
  }
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
// With openFd the caller owns the handle and closes it.
function forEachLine(file, onLine, openFd) {
  const fd = openFd ?? fs.openSync(file, 'r');
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
    if (openFd === undefined) fs.closeSync(fd);
  }
}

function usageInt(usage, name) {
  return Object.hasOwn(usage, name) && isInt(usage[name], MAX_COUNT) ? usage[name] : undefined;
}

// Only type, requestId/message.id/uuid, message.model and four integer usage fields are read.
export function readTranscript(file, openFd) {
  if ((openFd === undefined ? fs.statSync(file) : fs.fstatSync(openFd)).size > MAX_TRANSCRIPT_BYTES) throw new SizeError('file');
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
  }, openFd);
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

// ---------- agent-ctx ----------

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

// The context size at the end of one agent's transcript, or null for any failure. Only a regular file that the
// opened handle and the link-free lstat agree on, inside the projects folder, is read. Writes nothing.
function agentCtx(claudeHome, agent) {
  let fd;
  try {
    const file = findTranscript(claudeHome, agent);
    if (!file) return null;
    const projects = fs.realpathSync(path.join(claudeHome, 'projects'));
    const real = fs.realpathSync(file);
    if (path.relative(projects, real).startsWith('..') || path.isAbsolute(path.relative(projects, real))) return null;
    const before = fs.lstatSync(file, { bigint: true });
    if (!before.isFile()) return null;
    fd = fs.openSync(file, 'r');
    const after = fs.fstatSync(fd, { bigint: true });
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino) return null;
    const result = readTranscript(file, fd);
    return result && result.ctx_end !== undefined ? result.ctx_end : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function cmdAgentCtx(args) {
  const usage = 'usage: agent-ctx <agent>... [--json]';
  const json = args.filter((a) => a === '--json');
  if (json.length > 1) throw new Refusal(usage);
  const ids = args.filter((a) => a !== '--json');
  if (ids.length < 1 || ids.length > MAX_AGENT_IDS) throw new Refusal(usage);
  if (!ids.every((id) => AGENT_ID.test(id) && !id.startsWith('-'))) throw new Refusal('agent must match [A-Za-z0-9_-]{1,64} and not start with -');
  const claudeHome = claudeHomeDir();
  const agents = ids.map((agent) => ({ agent, ctx: agentCtx(claudeHome, agent) }));
  if (json.length === 1) return [JSON.stringify({ v: 1, agents })];
  return agents.map((a) => `${a.agent} ${a.ctx === null ? '?' : a.ctx}`);
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
  if (!Number.isFinite(env.now) || Math.abs(env.now) > 8.64e15) throw new Refusal('clock is not a time');
  const t1 = env.now;
  rec.t1 = isoSec(t1);
  if (rec.ms !== undefined) rec.t0 = isoSec(t1 - Math.floor(rec.ms / 1000) * 1000);
  appendRecord(JSON.parse(JSON.stringify(rec)));
  if (rec.ctx_end > CTX_CAP) return { code: 4, lines: [`over cap: ${kind} ${id} ${role} ctx_end ${rec.ctx_end} > ${CTX_CAP}`] };
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

// Splits one optional `--baseline <run>,<run>,<run>` pair from the other arguments.
function splitBaseline(args, usage) {
  const rest = [];
  let baselineRuns = [];
  let seen = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== '--baseline') {
      rest.push(args[i]);
    } else if (!seen && i + 1 < args.length) {
      seen = true;
      i += 1;
      baselineRuns = checkRunList(args[i]);
    } else {
      throw new Refusal(usage);
    }
  }
  return { rest, baselineRuns };
}

// The v1.1 ship keys that the run-state view can fill. Nothing when the run has no passed ship Gate.
function viewKeys(run) {
  let view;
  try {
    view = showRun(env.root, run, { now: env.now });
  } catch {
    return {};
  }
  if (!isObject(view) || view.state === 'none' || !Array.isArray(view.gates)) return {};
  const gates = view.gates.filter(isObject);
  let last = -1;
  gates.forEach((g, i) => {
    if (g.gate === 'ship' && g.result === 'passed') last = i;
  });
  if (last < 0) return {};
  const start = timeMs(view.started);
  const end = timeMs(gates[last].at);
  if (start === undefined || end === undefined || start > end) return {};
  let wait = 0;
  for (const g of gates.slice(0, last + 1)) if (Number.isSafeInteger(g.wait) && g.wait > 0) wait += g.wait;
  const keys = { t_start: view.started, t_ship: gates[last].at, wait: Math.min(wait, (end - start) / 1000, MAX_WAIT) };
  if (TIERS.includes(view.tier)) keys.tier = view.tier;
  for (const gate of ['brief', 'plan', 'ship']) {
    const n = gates.filter((g) => g.gate === gate && (g.result === 'changed' || g.result === 'stopped')).length;
    keys[`rej_${gate}`] = Math.min(n, MAX_REJECTS);
  }
  return keys;
}

// The plugin version from <plugin root>/.claude-plugin/plugin.json, or undefined when it is missing, too big or not a version.
function pluginVersion() {
  try {
    const file = path.join(env.pluginRoot, '.claude-plugin', 'plugin.json');
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_PLUGIN_JSON_BYTES) return undefined;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isObject(data) || !Object.hasOwn(data, 'version')) return undefined;
    return typeof data.version === 'string' && AICO_VERSION.test(data.version) ? data.version : undefined;
  } catch {
    return undefined;
  }
}

// The release of the model floor in force, or undefined when it cannot be loaded or is not a version.
function floorRelease() {
  try {
    const data = env.loadFloor(env.pluginRoot);
    const release = isObject(data) && Object.hasOwn(data, 'release') ? data.release : undefined;
    return typeof release === 'string' && AICO_VERSION.test(release) ? release : undefined;
  } catch {
    return undefined;
  }
}

// Appends the meta line before the ship record; no line when the version cannot be read.
function writeMeta(run, extra = {}) {
  const aico = pluginVersion();
  if (aico === undefined) return;
  const floor = floorRelease();
  try {
    appendRecord({ v: 1, run, kind: 'meta', aico, ...(floor === undefined ? {} : { floor }), ...extra });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
  }
}

// Appends the par line (four integers) from the run's parallel record. Returns the warnings it adds: 1 when the record
// cannot be read or the line cannot be written, else 0 (no record: no line).
function writePar(run) {
  let view;
  try {
    view = readParallel(env.root, run);
  } catch {
    return 1;
  }
  if (!isObject(view) || view.state !== 'on') return 0;
  const rec = { v: 1, run, kind: 'par', cap: view.effective_cap, peak: view.peak, waits: view.waits, out: view.out };
  if (!validateRecord(rec).ok) return 1;
  try {
    appendRecord(rec);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return 1;
  }
  return 0;
}

// The tier-path keys of a run, from the tier record's reader view only: { meta, ship } with the allow-listed values, or
// { warnings: 1 } when the reader throws or the view holds a value outside the allow-list (then none of the keys is written).
// State none gives no keys and no warning.
function tierKeys(run) {
  const none = { meta: {}, ship: {}, tier: undefined, warnings: 0 };
  let view;
  try {
    view = readTierPath(env.root, run, { pluginRoot: env.pluginRoot });
  } catch {
    return { ...none, warnings: 1 };
  }
  if (isObject(view) && view.state === 'none') return none;
  const valid = isObject(view) && view.state === 'on' && PLAYBOOKS.includes(view.pb) && PATHS.includes(view.path) &&
    TIERS.includes(view.tier) && typeof view.raised === 'boolean' && Number.isSafeInteger(view.rev) && view.rev >= 0 && view.rev <= 999;
  if (!valid) return { ...none, warnings: 1 };
  return {
    meta: { pb: view.pb, ...(view.rev > 0 ? { sets: view.rev } : {}) },
    ship: { path: view.path, raised: view.raised ? 1 : 0 },
    tier: view.tier,
    warnings: 0
  };
}

function cmdShip(args) {
  const usage = 'usage: ship <run> <acs> [fix_rounds] [high_blockers] [--baseline <run>,<run>,<run>]';
  const { rest, baselineRuns } = splitBaseline(args, usage);
  if (rest.length < 2 || rest.length > 4) throw new Refusal(usage);
  const [run, acs, fixRounds, highBlockers] = rest;
  const rec = { v: 1, run: checkRun(run), kind: 'ship', acs: parseCount(acs, 'acs') };
  if (fixRounds !== undefined) rec.fix_rounds = parseCount(fixRounds, 'fix_rounds');
  if (highBlockers !== undefined) rec.high_blockers = parseCount(highBlockers, 'high_blockers');
  const excluded = EXCLUDED_RUN.test(rec.run);
  const tiers = excluded ? { meta: {}, ship: {}, tier: undefined, warnings: 0 } : tierKeys(rec.run);
  const timed = excluded ? rec : { ...rec, ...viewKeys(rec.run), ...tiers.ship };
  if (tiers.tier !== undefined && !(TIER_RANK[timed.tier] >= TIER_RANK[tiers.tier])) timed.tier = tiers.tier;
  let extraWarnings = tiers.warnings;
  if (!excluded) {
    writeMeta(rec.run, tiers.meta);
    extraWarnings += writePar(rec.run);
  }
  appendRecord(validateRecord(timed).ok ? timed : rec);
  if (excluded) return ['ship recorded (excluded run)'];
  try {
    return [scorecardLine(rec.run, baselineRuns, extraWarnings)];
  } catch {
    return ['ship recorded'];
  }
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

// The true middle value (an even count averages the two middle ones); round only for display.
function exactMedian(list) {
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// A record with counts: a host transcript, an imported baseline, or a mod's own call.
const hasCounts = (r) => r.src === 'transcript' || r.src === 'mod';

function summarize(records, acsOverride) {
  const transcripts = records.filter(hasCounts);
  const spend = transcripts.reduce((s, r) => s + spendOf(r.tokens), 0);
  const cacheRead = transcripts.reduce((s, r) => s + r.tokens.cache_read, 0);
  const matched = new Set(transcripts.map((r) => r.agent).filter(Boolean));
  const unreconciled = records.filter((r) => r.src === 'notification' && !matched.has(r.agent));
  const ships = records.filter((r) => r.kind === 'ship');
  const acs = acsOverride ?? (ships.length ? ships[ships.length - 1].acs : 0);
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
  const usage = 'usage: report <run> [--baseline <run>,<run>,<run>] [--acs <n>] [--json] [--live]';
  const opts = { baselineRuns: [], json: false, live: false, acs: undefined };
  let baseline = false;
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    if ((flag === '--json' || flag === '--live') && !opts[flag.slice(2)]) {
      opts[flag.slice(2)] = true;
    } else if (flag === '--baseline' && !baseline && i + 1 < flags.length) {
      baseline = true;
      i += 1;
      opts.baselineRuns = checkRunList(flags[i]);
    } else if (flag === '--acs' && opts.acs === undefined && i + 1 < flags.length) {
      i += 1;
      opts.acs = parseCount(flags[i], 'acs');
    } else {
      throw new Refusal(usage);
    }
  }
  if (opts.json && baseline) throw new Refusal(usage);
  return opts;
}

function reportJson(run, records, warnings, live, acs) {
  const sum = summarize(records, acs);
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
  const { baselineRuns, json, live, acs } = parseReportFlags(flags);
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
  if (json) return [reportJson(run, records, warnings, new Set(liveRecs), acs)];
  const out = [...warnings, `run ${run}`];
  const sum = summarize(records, acs);
  for (const row of dispatchRows(records, new Set(liveRecs))) out.push(describe(row.rec, row.t));
  const acsNote = sum.acs > 0 ? ` (${sum.acs} ACs)` : '';
  const line = (label, value) => `${label}: ${value} total, ${sum.acs > 0 ? `${perAc(value, sum.acs)} per AC${acsNote}` : 'per AC n/a (no shipped ACs recorded)'}`;
  if (sum.any) {
    out.push(line('spend', sum.spend), line('cache read', sum.cacheRead));
  } else {
    out.push('spend: n/a (nothing reconciled)', 'cache read: n/a (nothing reconciled)');
  }
  out.push(`not reconciled: ${sum.unreconciled.length}`);
  const over = stored.filter((r) => r.src === 'notification' && r.kind !== 'total' && r.ctx_end > CTX_CAP);
  if (over.length > 0) out.push(`over cap: ${over.length} steps (max ${Math.max(...over.map((r) => r.ctx_end))})`);
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

// ---------- scorecard ----------

// A ledger read that never throws: an unreadable file counts as one warning.
function readSafe(run) {
  try {
    return readLedger(run);
  } catch {
    return { exists: true, records: [], warnings: ['warning: ledger not readable'] };
  }
}

const lastShipOf = (records) => records.findLast((r) => r.kind === 'ship');
const isTimed = (ship) => Object.hasOwn(ship, 't_start') && Object.hasOwn(ship, 't_ship');
const get = (rec, key) => (Object.hasOwn(rec, key) ? rec[key] : undefined);

function duration(seconds) {
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

// The values of one shipped run, each undefined when it has no source.
function runValues(records) {
  const ship = lastShipOf(records);
  const sum = summarize(records);
  const counted = sum.any && sum.unreconciled.length === 0 && ship.acs > 0;
  const rejects = REJECT_KEYS.map((k) => get(ship, k)).filter((n) => n !== undefined);
  return {
    ship,
    time: isTimed(ship) ? (Date.parse(ship.t_ship) - Date.parse(ship.t_start)) / 1000 : undefined,
    wait: get(ship, 'wait'),
    spendRaw: counted ? sum.spend : undefined,
    spend: counted ? perAc(sum.spend, ship.acs) : undefined,
    fix: get(ship, 'fix_rounds'),
    high: get(ship, 'high_blockers'),
    rejects: rejects.length ? rejects.reduce((a, b) => a + b, 0) : undefined
  };
}

// The ledger files a scorecard compares with: valid run names, regular files, at most 500 (the newest).
function comparisonFiles(run, counts) {
  let names = [];
  try {
    names = fs.readdirSync(ledgerDir());
  } catch {
    return [];
  }
  const files = [];
  for (const file of names) {
    const name = file.endsWith('.jsonl') ? file.slice(0, -6) : '';
    if (name === run || !isRun(name)) continue;
    try {
      const st = fs.lstatSync(path.join(ledgerDir(), file));
      if (st.isFile()) files.push({ name, mtime: st.mtimeMs });
      else counts.warnings += 1;
    } catch {
      counts.warnings += 1;
    }
  }
  if (files.length <= MAX_COMPARE_FILES) return files;
  counts.warnings += 1;
  return files.sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? -1 : 1)).slice(0, MAX_COMPARE_FILES);
}

function scorecardLine(run, baselineRuns, extraWarnings = 0) {
  const own = readSafe(run);
  if (!own.exists) return `no ledger for ${run}`;
  if (!own.records.some((r) => r.kind === 'ship')) return `no ship record for ${run}`;
  const mine = runValues(own.records);
  const counts = { warnings: own.warnings.length + extraWarnings, excluded: 0 };
  const eligible = [];
  for (const { name } of comparisonFiles(run, counts)) {
    if (EXCLUDED_RUN.test(name)) {
      counts.excluded += 1;
      continue;
    }
    const other = readSafe(name);
    counts.warnings += other.warnings.length;
    if (!other.records.some((r) => r.kind === 'ship')) continue;
    const values = runValues(other.records);
    if (!isTimed(values.ship)) {
      counts.excluded += 1;
      continue;
    }
    const shipMs = Date.parse(values.ship.t_ship);
    if (isTimed(mine.ship) && shipMs >= Date.parse(mine.ship.t_ship)) continue;
    eligible.push({ name, shipMs, values });
  }
  eligible.sort((a, b) => b.shipMs - a.shipMs || (a.name < b.name ? -1 : 1));
  const tier = get(mine.ship, 'tier');
  const sameTier = tier ? eligible.filter((e) => get(e.values.ship, 'tier') === tier) : [];
  const useTier = sameTier.length >= 5;
  const set = (useTier ? sameTier : eligible).slice(0, 5);
  const against = (pick, show) => {
    if (set.length === 0) return '(no baseline)';
    const values = set.map((e) => pick(e.values)).filter((v) => v !== undefined);
    return `(median ${values.length ? show(median(values)) : '?'})`;
  };
  const whole = (n) => (n === undefined ? '?' : String(n));
  const span = (n) => (n === undefined ? '?' : duration(n));
  const seg = (label, pick, show, mineText) => `${label} ${mineText ?? show(pick(mine))} ${against(pick, show)}`;
  const parts = [
    `scorecard ${run} (tier ${tier ?? 'unknown'}${get(mine.ship, 'path') === 'short' ? ', path short' : ''}): ${seg('time', (v) => v.time, span, mine.time === undefined ? 'untimed' : undefined)}`,
    seg('CEO wait', (v) => v.wait, span),
    seg('spend/AC', (v) => v.spend, whole, mine.spend === undefined ? 'not reconciled' : undefined),
    seg('fix rounds', (v) => v.fix, whole),
    seg('high blockers', (v) => v.high, whole),
    seg('gate rejects', (v) => v.rejects, whole)
  ];
  if (set.length) parts.push(`${useTier ? `tier ${tier}` : 'all tiers'}${set.length < 5 ? ` n=${set.length}` : ''}`);
  parts.push(`excluded: ${counts.excluded}`);
  if (baselineRuns.length) parts.push(targetSegment(mine, baselineRuns, counts));
  if (counts.warnings > 0) parts.push(`warnings: ${counts.warnings}`);
  parts.push(costText(readCost(env.root, run)));
  return parts.join(' | ');
}

// The 30% target: spend per AC against the baseline median, with the baseline quality medians.
function targetSegment(mine, baselineRuns, counts) {
  const spends = [];
  const fixes = [];
  const highs = [];
  for (const name of baselineRuns) {
    const base = readSafe(name);
    counts.warnings += base.warnings.length;
    const ship = base.exists ? lastShipOf(base.records) : undefined;
    if (!ship) continue;
    const sum = summarize(base.records);
    if (sum.any && sum.acs > 0) spends.push(perAc(sum.spend, sum.acs));
    if (Object.hasOwn(ship, 'fix_rounds') && Object.hasOwn(ship, 'high_blockers')) {
      fixes.push(ship.fix_rounds);
      highs.push(ship.high_blockers);
    }
  }
  const b = spends.length ? median(spends) : undefined;
  const delta = mine.spend === undefined || b === undefined ? 'n/a' : pct(mine.spend, b);
  let verdict = 'not reconciled';
  if (mine.spendRaw !== undefined && b !== undefined && fixes.length && mine.fix !== undefined && mine.high !== undefined) {
    const lean = mine.spendRaw * 10 <= 7 * b * mine.ship.acs;
    verdict = lean && mine.fix <= median(fixes) && mine.high <= median(highs) ? 'met' : 'missed';
  }
  return `30% target: ${delta} vs ${b ?? '?'}/AC, ${verdict}`;
}

function cmdScorecard(args) {
  const usage = 'usage: scorecard <run> [--baseline <run>,<run>,<run>]';
  const { rest, baselineRuns } = splitBaseline(args, usage);
  if (rest.length !== 1) throw new Refusal(usage);
  return [scorecardLine(checkRun(rest[0]), baselineRuns)];
}

// ---------- receipt ----------

// The Gates of the run as recorded by run-state; none when there is no run-state.
function gatesOf(run) {
  try {
    return showRun(env.root, run).gates.map((g) => `${g.gate} ${g.result}`);
  } catch {
    return [];
  }
}

// The median time of the baseline runs that have a timed ship record: { median, n }, or undefined.
function baselineTime(baselineRuns) {
  const times = [];
  for (const name of baselineRuns) {
    const base = readSafe(name);
    const ship = base.exists ? lastShipOf(base.records) : undefined;
    if (ship && isTimed(ship)) times.push((Date.parse(ship.t_ship) - Date.parse(ship.t_start)) / 1000);
  }
  return times.length ? { median: exactMedian(times), n: times.length } : undefined;
}

// What the records of a run show: only the keys that were recorded. The cost line only when a source recorded it.
function cmdReceipt(args) {
  const usage = 'usage: receipt <run> [--baseline <run>,<run>,<run>]';
  const { rest, baselineRuns } = splitBaseline(args, usage);
  if (rest.length !== 1) throw new Refusal(usage);
  const run = checkRun(rest[0]);
  const own = readSafe(run);
  const lines = [];
  const ship = own.exists ? lastShipOf(own.records) : undefined;
  const time = ship && isTimed(ship) ? (Date.parse(ship.t_ship) - Date.parse(ship.t_start)) / 1000 : undefined;
  if (time !== undefined) {
    lines.push(`time ${duration(time)}`);
    const base = baselineRuns.length ? baselineTime(baselineRuns) : undefined;
    if (base && base.median > time) {
      lines.push(`time saved ${duration(base.median - time)} (baseline median ${duration(base.median)} of ${base.n} run${base.n === 1 ? '' : 's'})`);
    }
  }
  const sum = summarize(own.records);
  if (sum.any) {
    const total = (key) => sum.transcripts.reduce((s, r) => s + r.tokens[key], 0);
    const unreconciled = sum.unreconciled.length ? ` (${sum.unreconciled.length} unreconciled)` : '';
    lines.push(`tokens ${TOKEN_KEYS.map((k) => `${k} ${total(k)}`).join(', ')}${unreconciled}`);
  }
  const gates = gatesOf(run);
  if (gates.length) lines.push(`gates ${gates.join(', ')}`);
  if (ship && get(ship, 'fix_rounds') !== undefined) lines.push(`fix rounds ${ship.fix_rounds}`);
  const cost = readCost(env.root, run);
  if (cost.state === 'recorded') lines.push(costText(cost));
  return [lines.length ? `receipt ${run}` : `no records for ${run}`, ...lines];
}

// ---------- model verdict ----------

const versionParts = (text) => text.split('.').map(Number);
function atLeast(text, min) {
  const have = versionParts(text);
  for (let i = 0; i < min.length; i += 1) if (have[i] !== min[i]) return have[i] > min[i];
  return true;
}
const familyOf = (model) => {
  const hit = typeof model === 'string' ? /haiku|sonnet|opus/.exec(model) : null;
  return hit ? FAMILIES.indexOf(hit[0]) : undefined;
};

// The floor data, reduced to what the verdict may print: Role names that are keys of the floor table.
function floorFor(loadFloor) {
  const none = { ok: false, release: undefined, downgraded: [], rank: new Map(), warnings: 1 };
  try {
    const f = loadFloor(env.pluginRoot);
    if (!isObject(f) || !isObject(f.floor) || !Array.isArray(f.downgraded)) return none;
    const down = [...new Set(f.downgraded.filter((r) => typeof r === 'string' && ROLE.test(r) && Object.hasOwn(f.floor, r) && FAMILIES.includes(f.floor[r])))].sort();
    const release = typeof f.release === 'string' && AICO_VERSION.test(f.release) ? f.release : undefined;
    return { ok: true, release, downgraded: down, rank: new Map(down.map((r) => [r, FAMILIES.indexOf(f.floor[r])])), warnings: Array.isArray(f.warnings) ? f.warnings.length : 0 };
  } catch {
    return none;
  }
}

// The checks both verdicts share (model verdict rule 2): the last ship, the last meta and the plan check key, or undefined.
function countedBase(name, records) {
  const ship = lastShipOf(records);
  if (!ship || !isTimed(ship) || timeMs(ship.t_ship) === undefined || !(ship.acs > 0)) return undefined;
  if (!Object.hasOwn(ship, 'fix_rounds') || !Object.hasOwn(ship, 'high_blockers')) return undefined;
  if (!records.some((r) => r.src === 'transcript') || summarize(records).unreconciled.length > 0) return undefined;
  const meta = records.findLast((r) => r.kind === 'meta');
  let view;
  try {
    view = readPlanCheck(env.root, name);
  } catch {
    return undefined;
  }
  if (!isObject(view) || view.state === 'error') return undefined;
  const key = view.state === 'on' ? view.policy : view.state;
  if (!['none', 'off', 'warn', 'block'].includes(key)) return undefined;
  return { ship, meta, key };
}

// One run's counted values, or undefined when the run does not count (see the contract).
function verdictRun(name, records, floor) {
  const base = countedBase(name, records);
  if (!base) return undefined;
  const { ship, meta, key } = base;
  let side;
  if (!meta) side = '16';
  else if (atLeast(meta.aico, [0, 17, 0]) && !atLeast(meta.aico, [0, 18, 0])) side = '17';
  else return undefined;
  const run = { name, side, key, tShip: timeMs(ship.t_ship), acs: ship.acs, fix: ship.fix_rounds, high: ship.high_blockers, spend: 0n, roleSpend: new Map(), lower: 0, ran: 0 };
  for (const r of records.filter(hasCounts)) {
    const n = BigInt(spendOf(r.tokens));
    run.spend += n;
    if (floor.rank.has(r.role)) run.roleSpend.set(r.role, (run.roleSpend.get(r.role) ?? 0n) + n);
  }
  for (const r of records) {
    if (r.src !== 'transcript' || !ADD_KINDS.includes(r.kind) || !floor.rank.has(r.role)) continue;
    run.ran += 1;
    const family = familyOf(r.model);
    if (family !== undefined && family < floor.rank.get(r.role)) run.lower += 1;
  }
  return run;
}

// Newest first, at most 500 files; a file over 1 MiB and files past 32 MiB in total are left unread.
function verdictRuns(floor, counts, build = verdictRun) {
  const files = comparisonFiles('', counts).sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? -1 : 1));
  const runs = [];
  let bytes = 0;
  for (const { name } of files) {
    if (EXCLUDED_RUN.test(name)) continue;
    let size;
    try {
      size = fs.lstatSync(path.join(ledgerDir(), `${name}.jsonl`)).size;
    } catch {
      counts.warnings += 1;
      continue;
    }
    if (size > MAX_LEDGER_BYTES || bytes + size > MAX_VERDICT_BYTES) {
      counts.notCounted += 1;
      continue;
    }
    bytes += size;
    const ledger = readSafe(name);
    counts.warnings += ledger.warnings.length;
    const run = build(name, ledger.records, floor);
    if (run) runs.push(run);
    else counts.notCounted += 1;
  }
  return runs;
}

function aggregate(set) {
  const sum = (pick) => set.reduce((n, r) => n + pick(r), 0n);
  const roleSpend = new Map();
  for (const r of set) for (const [role, n] of r.roleSpend) roleSpend.set(role, (roleSpend.get(role) ?? 0n) + n);
  const down = [...roleSpend.values()].reduce((a, b) => a + b, 0n);
  return {
    n: set.length, acs: sum((r) => BigInt(r.acs)), spend: sum((r) => r.spend), down, roleSpend,
    fix: set.length ? exactMedian(set.map((r) => r.fix)) : undefined, high: set.length ? exactMedian(set.map((r) => r.high)) : undefined
  };
}

// a / b against c / d for non-negative counts with positive b and d.
const ratioLower = (a, b, c, d) => a * d < c * b;
const ratioNotHigher = (a, b, c, d) => a * d <= c * b;

const newest = (list) => [...list].sort((a, b) => b.tShip - a.tShip || (a.name < b.name ? -1 : 1));

// `[--runs <3-50>]`: digits only, 3 to 50, default 10.
function parseRunsFlag(args, usage) {
  if (args.length === 0) return 10;
  if (args.length !== 2 || args[0] !== '--runs' || !/^\d{1,2}$/.test(args[1])) throw new Refusal(usage);
  const limit = Number(args[1]);
  if (limit < 3 || limit > 50) throw new Refusal('--runs must be a whole number from 3 to 50');
  return limit;
}

function cmdModelVerdict(args, { loadFloor }) {
  const limit = parseRunsFlag(args, 'usage: model-verdict [--runs <3-50>]');
  const floor = floorFor(loadFloor);
  const counts = { warnings: floor.warnings, excluded: 0, notCounted: 0 };
  const counted = verdictRuns(floor, counts);
  const reference = newest(counted.filter((r) => r.side === '17'))[0]?.key;
  const matching = counted.filter((r) => reference === undefined || r.key === reference);
  const excluded = counted.length - matching.length;
  const avail17 = newest(matching.filter((r) => r.side === '17'));
  const avail16 = newest(matching.filter((r) => r.side === '16'));
  const set17 = avail17.slice(0, limit);
  const set16 = avail16.slice(0, limit);
  const a = aggregate(set17);
  const b = aggregate(set16);

  let state;
  let roll = [];
  if (avail17.length < limit || avail16.length < MIN_BASELINE_RUNS || !floor.ok || floor.downgraded.length === 0 || a.down === 0n || b.down === 0n) {
    state = `insufficient (n=${avail17.length})`;
  } else {
    const downLower = ratioLower(a.down, a.acs, b.down, b.acs);
    const guards = ratioNotHigher(a.spend, a.acs, b.spend, b.acs) && a.fix <= b.fix && a.high <= b.high;
    state = downLower && guards ? 'pass' : 'fail';
    if (state === 'fail') {
      roll = guards
        ? floor.downgraded.filter((role) => {
          const mine = a.roleSpend.get(role) ?? 0n;
          const base = b.roleSpend.get(role) ?? 0n;
          return !(mine === 0n && base === 0n) && !ratioLower(mine, a.acs, base, b.acs);
        })
        : floor.downgraded;
    }
  }
  const whole = (n, acs) => (acs > 0n ? String(Math.round(Number(n) / Number(acs))) : '?');
  const dec = (n) => (n === undefined ? '?' : n.toFixed(1));
  const lower = set17.reduce((n, r) => n + r.lower, 0);
  const ran = set17.reduce((n, r) => n + r.ran, 0);
  const parts = [
    `model verdict: ${state}`,
    `runs ${a.n} v0.17, ${b.n} v0.16 (plan check ${reference ?? '?'})`,
    `spend/AC ${whole(a.spend, a.acs)} (v0.16 ${whole(b.spend, b.acs)})`,
    `downgraded spend/AC ${whole(a.down, a.acs)} (v0.16 ${whole(b.down, b.acs)})`,
    `fix rounds median ${dec(a.fix)} (v0.16 ${dec(b.fix)})`,
    `high blockers median ${dec(a.high)} (v0.16 ${dec(b.high)})`,
    `downgraded: ${floor.downgraded.length ? floor.downgraded.join(', ') : 'none'}`,
    `lower model: ${lower} of ${ran}`,
    `excluded: ${excluded}`,
    `not counted: ${counts.notCounted}`
  ];
  if (state === 'fail') parts.push(`roll back: ${roll.join(', ')}`);
  if (counts.warnings > 0) parts.push(`warnings: ${counts.warnings}`);
  return [parts.join(' | ')];
}

// ---------- parallel verdict ----------

// One run's counted values for the parallel verdict, or undefined when the run does not count.
function parallelRun(name, records) {
  const base = countedBase(name, records);
  if (!base || !base.meta) return undefined;
  const { ship, meta, key } = base;
  if (get(ship, 'path') === 'short') return undefined;
  const builders = new Set(records.filter((r) => r.kind === 'step' && BUILDER_ROLES.includes(r.role)).map((r) => r.id));
  if (builders.size < 2) return undefined;
  let side;
  let floorKey;
  let cap;
  let out;
  if (atLeast(meta.aico, [0, 18, 0])) {
    const rec = records.findLast((r) => r.kind === 'par');
    if (!rec || rec.cap < 2) return undefined;
    side = '18';
    floorKey = get(meta, 'floor');
    cap = rec.cap;
    out = rec.out;
  } else if (atLeast(meta.aico, [0, 17, 0])) {
    side = '17';
    floorKey = get(meta, 'floor') ?? FLOOR_RELEASE_V017;
  } else {
    return undefined;
  }
  const rejects = REJECT_KEYS.reduce((n, k) => n + (get(ship, k) ?? 0), 0);
  const wall = (timeMs(ship.t_ship) - timeMs(ship.t_start)) / 1000;
  let spend = 0n;
  for (const r of records.filter(hasCounts)) spend += BigInt(spendOf(r.tokens));
  return {
    name, side, key, floorKey, tShip: timeMs(ship.t_ship), acs: ship.acs, fix: ship.fix_rounds, high: ship.high_blockers, rejects,
    wall, time: wall - (get(ship, 'wait') ?? 0), spend, cap, out
  };
}

function parallelSet(set, v18) {
  const med = (pick) => (set.length ? exactMedian(set.map(pick)) : undefined);
  return {
    n: set.length, acs: set.reduce((n, r) => n + BigInt(r.acs), 0n), spend: set.reduce((n, r) => n + r.spend, 0n),
    time: med((r) => r.time), wall: med((r) => r.wall), fix: med((r) => r.fix), high: med((r) => r.high), rejects: med((r) => r.rejects),
    out: v18 ? med((r) => r.out) : undefined, cap: v18 ? med((r) => r.cap) : undefined
  };
}

function cmdParallelVerdict(args, { loadFloor }) {
  const limit = parseRunsFlag(args, 'usage: parallel-verdict [--runs <3-50>]');
  const floor = floorFor(loadFloor);
  const counts = { warnings: floor.warnings + (floor.ok && floor.release === undefined ? 1 : 0), excluded: 0, notCounted: 0 };
  const counted = verdictRuns(floor, counts, parallelRun);
  const reference = newest(counted.filter((r) => r.side === '18'))[0]?.key;
  const matching = counted.filter((r) => (reference === undefined || r.key === reference) && (floor.release === undefined || r.floorKey === floor.release));
  const excluded = counted.length - matching.length;
  const set18 = newest(matching.filter((r) => r.side === '18')).slice(0, limit);
  const set17 = newest(matching.filter((r) => r.side === '17')).slice(0, limit);
  const a = parallelSet(set18, true);
  const b = parallelSet(set17, false);

  let state;
  if (!floor.ok || floor.release === undefined || a.n < limit || b.n < limit) {
    state = `insufficient (n=${Math.min(a.n, b.n)})`;
  } else {
    const fast = a.time * 4 <= b.time * 3;
    const quality = a.fix <= b.fix && a.high <= b.high && a.rejects <= b.rejects;
    const lean = a.spend * 10n * b.acs <= b.spend * 11n * a.acs;
    state = fast && quality && lean && a.out === 0 ? 'pass' : 'fail';
  }
  const dec = (n) => (n === undefined ? '?' : n.toFixed(1));
  const span = (n) => (n === undefined ? '?' : duration(n));
  const perAcText = (x) => (x.acs > 0n ? String(Math.round(Number(x.spend) / Number(x.acs))) : '?');
  const parts = [
    `parallel verdict: ${state}`,
    `runs ${a.n} v0.18, ${b.n} v0.17 (plan check ${reference ?? '?'}, floor ${floor.release ?? '?'})`,
    `time minus CEO wait median ${span(a.time)} (v0.17 ${span(b.time)})`,
    `wall clock median ${span(a.wall)} (v0.17 ${span(b.wall)})`,
    `fix rounds median ${dec(a.fix)} (v0.17 ${dec(b.fix)})`,
    `high blockers median ${dec(a.high)} (v0.17 ${dec(b.high)})`,
    `gate rejects median ${dec(a.rejects)} (v0.17 ${dec(b.rejects)})`,
    `spend/AC ${perAcText(a)} (v0.17 ${perAcText(b)})`,
    `out-of-list median ${dec(a.out)}`,
    `cap median ${dec(a.cap)}`,
    `excluded: ${excluded}`,
    `not counted: ${counts.notCounted}`
  ];
  if (state === 'fail') parts.push(a.cap < 5 ? 'next step: set pipeline.parallel_cap to 5' : 'next step: set pipeline.dispatch to sequential');
  if (counts.warnings > 0) parts.push(`warnings: ${counts.warnings}`);
  return [parts.join(' | ')];
}

// ---------- low-path verdict ----------

// The playbook of a run: meta `pb` from 0.19.0 on; before that a product-manager step means feature, else a first step by qa means fix.
function playbookOf(records, meta, modern) {
  if (modern) return get(meta, 'pb');
  const steps = records.filter((r) => r.kind === 'step');
  if (steps.some((r) => r.role === 'product-manager')) return 'feature';
  const first = steps.reduce((low, r) => (low === undefined || r.id < low.id ? r : low), undefined);
  return first?.role === 'qa' ? 'fix' : undefined;
}

// One run's counted values for the low-path verdict, or undefined when the run does not count.
function lowPathRun(name, records) {
  const base = countedBase(name, records);
  if (!base) return undefined;
  const { ship, meta, key } = base;
  const modern = meta !== undefined && atLeast(meta.aico, [0, 19, 0]);
  const pb = playbookOf(records, meta, modern);
  if (!PLAYBOOKS.includes(pb)) return undefined;
  const shipPath = get(ship, 'path');
  let side;
  if (modern && shipPath === 'short') side = 'short';
  else if (get(ship, 'tier') === 'low' && (!modern || shipPath === 'full')) side = 'before';
  else return undefined;
  let floorKey = 'none';
  if (meta && Object.hasOwn(meta, 'floor')) floorKey = meta.floor;
  else if (meta && atLeast(meta.aico, [0, 17, 0]) && !atLeast(meta.aico, [0, 18, 0])) floorKey = FLOOR_RELEASE_V017;
  const par = records.findLast((r) => r.kind === 'par');
  const rejects = REJECT_KEYS.reduce((n, k) => n + (get(ship, k) ?? 0), 0);
  let spend = 0n;
  for (const r of records.filter(hasCounts)) spend += BigInt(spendOf(r.tokens));
  return {
    name, pb, side, key, floorKey, capKey: par ? String(par.cap) : 'none', tShip: timeMs(ship.t_ship), acs: ship.acs,
    fix: ship.fix_rounds, high: ship.high_blockers, rejects, raised: get(ship, 'raised') === 1,
    time: (timeMs(ship.t_ship) - timeMs(ship.t_start)) / 1000 - (get(ship, 'wait') ?? 0), spend
  };
}

function lowPathSet(set) {
  const med = (pick) => (set.length ? exactMedian(set.map(pick)) : undefined);
  return {
    n: set.length, acs: set.reduce((n, r) => n + BigInt(r.acs), 0n), spend: set.reduce((n, r) => n + r.spend, 0n),
    time: med((r) => r.time), fix: med((r) => r.fix), high: med((r) => r.high), rejects: med((r) => r.rejects),
    raised: set.filter((r) => r.raised).length
  };
}

function lowPathLine(pb, list, floor, limit, counts) {
  const reference = newest(list.filter((r) => r.side === 'short'))[0];
  const matching = list.filter((r) => reference === undefined ||
    (r.key === reference.key && r.floorKey === reference.floorKey && r.capKey === reference.capKey));
  const a = lowPathSet(newest(matching.filter((r) => r.side === 'short')).slice(0, limit));
  const b = lowPathSet(newest(matching.filter((r) => r.side === 'before')).slice(0, limit));
  let state;
  if (!floor.ok || a.n < limit || b.n < limit) {
    state = `insufficient (n=${Math.min(a.n, b.n)})`;
  } else {
    const fast = a.time * 4 <= b.time * 3;
    const quality = a.fix <= b.fix && a.high <= b.high && a.rejects <= b.rejects;
    const lean = pb === 'feature' ? a.spend * b.acs <= b.spend * a.acs : a.spend * BigInt(b.n) <= b.spend * BigInt(a.n);
    state = fast && quality && lean && a.raised * 5 <= a.n ? 'pass' : 'fail';
  }
  const dec = (n) => (n === undefined ? '?' : n.toFixed(1));
  const span = (n) => (n === undefined ? '?' : duration(n));
  const per = (x) => {
    const divisor = pb === 'feature' ? x.acs : BigInt(x.n);
    return divisor > 0n ? String(Math.round(Number(x.spend) / Number(divisor))) : '?';
  };
  const unit = pb === 'feature' ? 'spend/AC' : 'spend/run';
  const parts = [
    `low-path verdict ${pb}: ${state}`,
    `runs ${a.n} short, ${b.n} before (plan check ${reference?.key ?? '?'}, floor ${reference?.floorKey ?? '?'}, cap ${reference?.capKey ?? '?'})`,
    `time minus CEO wait median ${span(a.time)} (before ${span(b.time)})`,
    `fix rounds median ${dec(a.fix)} (before ${dec(b.fix)})`,
    `high blockers median ${dec(a.high)} (before ${dec(b.high)})`,
    `gate rejects median ${dec(a.rejects)} (before ${dec(b.rejects)})`,
    `${unit} ${per(a)} (before ${per(b)})`,
    `raised ${a.raised} of ${a.n}`,
    `excluded: ${list.length - matching.length}`,
    `not counted: ${counts.notCounted}`
  ];
  if (state === 'fail') parts.push('roll back: set pipeline.short_path to off');
  if (counts.warnings > 0) parts.push(`warnings: ${counts.warnings}`);
  return parts.join(' | ');
}

function cmdLowPathVerdict(args, { loadFloor }) {
  const limit = parseRunsFlag(args, 'usage: low-path-verdict [--runs <3-50>]');
  const floor = floorFor(loadFloor);
  const counts = { warnings: floor.warnings, excluded: 0, notCounted: 0 };
  const counted = verdictRuns(floor, counts, lowPathRun);
  return PLAYBOOKS.map((pb) => lowPathLine(pb, counted.filter((r) => r.pb === pb), floor, limit, counts));
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

// `now` (epoch ms), `root` (the product root), `pluginRoot` and `loadFloor` (the model floor reader) are for callers that
// inject them; the CLI uses the defaults.
export function main(args, { now, root, pluginRoot, loadFloor } = {}) {
  const [command, ...rest] = args;
  const before = env;
  env = {
    root: typeof root === 'string' && root !== '' ? root : process.cwd(),
    now: typeof now === 'number' ? now : Date.now(),
    pluginRoot: typeof pluginRoot === 'string' && pluginRoot !== '' ? pluginRoot : path.resolve(import.meta.dirname, '..'),
    loadFloor: typeof loadFloor === 'function' ? loadFloor : settings.loadModelFloor
  };
  try {
    const handlers = {
      add: cmdAdd, 'add-mod': cmdAddMod, reconcile: cmdReconcile, import: cmdImport, ship: cmdShip, scorecard: cmdScorecard, receipt: cmdReceipt,
      report: cmdReport, 'brainstorm-report': cmdBrainstormReport, 'model-verdict': cmdModelVerdict, 'parallel-verdict': cmdParallelVerdict,
      'low-path-verdict': cmdLowPathVerdict, 'agent-ctx': cmdAgentCtx
    };
    if (!Object.hasOwn(handlers, command ?? '')) throw new Refusal(USAGE);
    if (['report', 'brainstorm-report', 'scorecard', 'receipt'].includes(command) && rest.length === 0) throw new Refusal(USAGE);
    const result = handlers[command](rest, env);
    return Array.isArray(result) ? { code: 0, lines: result } : result;
  } catch (error) {
    if (error instanceof Refusal) return { code: 2, lines: [`refused: ${error.message}`] };
    throw error;
  } finally {
    env = before;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, lines } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
