#!/usr/bin/env node
// Plan tasks (contract: docs/contracts/plan-tasks.md v1). Node built-ins only, no child process.
// Parses the task blocks of a plan, schedules them under a cap, and keeps a per-run record in
// .company/work/<slug>/parallel.jsonl. The record holds task IDs, path keys, counts and times only,
// never plan text. Plan text, the record and every CLI argument are untrusted data: output holds only
// task IDs, fixed reason words, known role names and paths that passed the path rule.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readPlanLines } from './plan-markdown.mjs';

const KiB = 1024;
const MAX_PLAN_BYTES = 256 * KiB;
const MAX_TASKS = 100;
const MAX_ITEMS = 40;
const MAX_PATH_CHARS = 200;
const MAX_ARG_CHARS = 4096;
const MAX_PATHS = 100;
const MAX_RECORD_BYTES = 1024 * KiB;
const MAX_RECORD_LINES = 5000;
const MAX_RECORD_LINE_BYTES = 8 * KiB;
const MAX_ROUND = 5;
const MAX_WAVES = 101;

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLAN_NAME = /^(\d{2,3}-)?(architect-)?plan(-[a-z0-9]+)?\.md$/;
const ROLE = /^[a-z][a-z0-9-]{1,40}$/;
const TASK_HEAD = /^(T\d{1,3}[a-z]?)(?=$|[\s:.)-])/;
const DEP_ID = /^T\d{1,3}[a-z]?$/;
const TASK_REC = /^(?:T\d{1,3}[a-z]?(?:-dup\d{1,3})?|U1)$/;
const FIELD = /^\s{0,3}[-*]\s+(role|files|depends-on|parallel):[ \t]*(.*)$/;
const DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const PATH_SHAPE = /^[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*\/?$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const HASH = /^[0-9a-f]{12}$/;
const CONTROLS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const KEY_ECHO = /^[a-z_]{1,20}$/;
const echoKey = (key) => (KEY_ECHO.test(key) ? key : '?');
const MODES = ['parallel', 'sequential'];
const PLAN_ERRORS = ['plan-missing', 'plan-unreadable', 'plan-too-large', 'plan-name'];

const USAGE = [
  'usage: plan-tasks.mjs <command>',
  '  check <slug> <plan> --cap <3-5> --mode <parallel|sequential>',
  '  begin <slug> <plan> --cap <3-5> --mode <parallel|sequential>',
  '  next <slug> [--json]',
  '  start <slug> <id>',
  '  done <slug> <id>',
  '  lines <slug> <id>',
  '  brief <slug> <id>',
  '  scope <slug> <id> -- <path>...',
  '  round <slug> <n> [--loose <k>] -- <path>...',
  '  read <slug>'
].join('\n');

export class ParallelRecordError extends Error {
  constructor(slug, line, reason) {
    super(`parallel record ${slug} line ${line}: ${reason}`);
    this.name = 'ParallelRecordError';
    this.reason = reason;
  }
}

class Refusal extends Error {}

class PlanProblem extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

// ---------------------------------------------------------------- paths

function pathReason(p) {
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'absolute';
  if (/[*?[\]{}]/.test(p)) return 'glob';
  const segments = p.split('/');
  if (segments.at(-1) === '' && segments.length > 1) segments.pop();
  if (segments.some((s) => s === '.' || s === '..')) return 'dot segment';
  if (segments.some((s) => trimAlias(s).toLowerCase() === '.git')) return 'git';
  if (segments.some((s) => s.toLowerCase().startsWith('.env'))) return 'env';
  if (segments.some(isDeviceName)) return 'device name';
  if (p.length > MAX_PATH_CHARS) return 'too long';
  if (!PATH_SHAPE.test(p) || segments.some((s) => s.startsWith('-') || s.endsWith('.') || s.endsWith(' '))) return 'bad character';
  return null;
}

// Windows reads `con`, `NUL.txt` and `com1.tar.gz` as devices: the name up to the first dot, without trailing spaces, is
// compared after trailing dots and spaces are dropped.
function isDeviceName(segment) {
  const name = trimAlias(segment);
  const dot = name.indexOf('.');
  return DEVICE.test((dot === -1 ? name : name.slice(0, dot)).replace(/ +$/, '').toLowerCase());
}

// Windows drops trailing dots and spaces from a name, so `x.mjs.` is the file `x.mjs`.
function trimAlias(segment) {
  let end = segment.length;
  while (end > 0 && (segment[end - 1] === '.' || segment[end - 1] === ' ')) end--;
  return end === 0 ? segment : segment.slice(0, end);
}

function keyOf(p) {
  return p.replaceAll('\\', '/').split('/').map(trimAlias).join('/').toLowerCase().replace(/\/$/, '');
}

export function normalizePath(item) {
  if (typeof item !== 'string') return { ok: false, reason: 'bad character' };
  const p = item.replaceAll('\\', '/');
  const reason = pathReason(p);
  if (reason) return { ok: false, reason };
  return { ok: true, path: p, key: keyOf(p), dir: p.endsWith('/') };
}

function keysOverlap(a, b) {
  return a === b || b.startsWith(`${a}/`) || a.startsWith(`${b}/`);
}

export function overlaps(a, b) {
  return keysOverlap(keyOf(String(a)), keyOf(String(b)));
}

const overlapCache = new WeakMap();

function tasksOverlap(a, b) {
  if (!a.filesValid || !b.filesValid) return true;
  let row = overlapCache.get(a);
  if (!row) {
    row = new Map();
    overlapCache.set(a, row);
  }
  if (row.has(b)) return row.get(b);
  const hit = a.keys.some((ka) => b.keys.some((kb) => keysOverlap(ka, kb)));
  row.set(b, hit);
  return hit;
}

// ---------------------------------------------------------------- plan parsing

function stripTicks(text) {
  return text.length >= 2 && text.startsWith('`') && text.endsWith('`') ? text.slice(1, -1) : text;
}

function readBlocks(text) {
  const blocks = [];
  let current = null;
  let tooMany = false;
  for (const { line, kind, level, title } of readPlanLines(text).lines) {
    if (kind === 'heading') {
      if (current && level <= current.level) current = null;
      if (level >= 2 && level <= 4) {
        const head = TASK_HEAD.exec(title.trim());
        if (head) {
          if (blocks.length >= MAX_TASKS) {
            tooMany = true;
            current = null;
          } else {
            current = { id: head[1], level, fields: new Map(), repeated: [] };
            blocks.push(current);
          }
        }
      }
      continue;
    }
    if (kind !== 'text' || !current) continue;
    const field = FIELD.exec(line);
    if (!field) continue;
    if (current.fields.has(field[1])) {
      if (!current.repeated.includes(field[1])) current.repeated.push(field[1]);
    } else {
      current.fields.set(field[1], field[2].trim());
    }
  }
  return { blocks, tooMany };
}

function parseFiles(value) {
  const reasons = [];
  const items = [];
  const keys = [];
  if (value === undefined) return { reasons: ['files: missing'], items, keys, valid: false };
  const raw = value === '' ? [] : value.split(',').map((s) => stripTicks(s.trim()));
  if (raw.length === 0) return { reasons: ['files: empty'], items, keys, valid: false };
  raw.slice(0, MAX_ITEMS).forEach((item, index) => {
    const n = normalizePath(item);
    if (n.ok) {
      items.push(n.path);
      keys.push(n.key);
    } else {
      reasons.push(`files item ${index + 1}: ${n.reason}`);
    }
  });
  if (raw.length > MAX_ITEMS) reasons.push('files: more than 40');
  return { reasons, items, keys, valid: reasons.length === 0 };
}

function parseDeps(value, known) {
  const deps = [];
  const unknown = [];
  if (value === undefined) return { deps, unknown: ['?'] };
  const tokens = value.split(',').map((s) => stripTicks(s.trim()));
  if (tokens.length === 1 && tokens[0] === 'none') return { deps, unknown };
  for (const token of tokens) {
    if (!DEP_ID.test(token)) {
      if (!unknown.includes('?')) unknown.push('?');
    } else if (!known.has(token)) {
      if (!unknown.includes(token)) unknown.push(token);
    } else if (!deps.includes(token)) {
      deps.push(token);
    }
  }
  return { deps, unknown };
}

// The visit order: plan order, except that a task comes after the tasks it depends on (a stable
// topological order, ties by plan position). A flagged task (unknown dependency or on a cycle) waits for
// every earlier task in plan order. If the flagged edges close a loop, the first flagged task in plan
// order goes next, so the order always covers every task and every dependency points backwards. A flagged
// task also keeps its valid dependencies, except those on its own cycle.
function scheduleOrder(depIndexes, flagged, sameCycle) {
  const n = depIndexes.length;
  const placed = new Array(n).fill(false);
  const depsPlaced = (i) => depIndexes[i].every((d) => placed[d] || sameCycle(i, d));
  const ready = (i) => (flagged[i]
    ? placed.slice(0, i).every(Boolean) && depsPlaced(i)
    : depsPlaced(i));
  const order = [];
  while (order.length < n) {
    let pick = -1;
    for (let i = 0; i < n && pick === -1; i++) if (!placed[i] && ready(i)) pick = i;
    if (pick === -1) pick = flagged.findIndex((f, i) => f && !placed[i]);
    if (pick === -1) pick = placed.indexOf(false);
    placed[pick] = true;
    order.push(pick);
  }
  return order;
}

// Finds the tasks that sit on a real dependency cycle, a self dependency included. Maps each to the set of
// tasks it can reach, so two cycle members share a cycle when each reaches the other.
function cycleMembers(ids, edges) {
  const index = new Map(ids.map((id, i) => [id, i]));
  const members = new Map();
  ids.forEach((id, start) => {
    const seen = new Set();
    const stack = [...edges[start]];
    let onCycle = false;
    while (stack.length) {
      const next = stack.pop();
      if (next === id) onCycle = true;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...edges[index.get(next)]);
    }
    if (onCycle) members.set(id, seen);
  });
  return members;
}

export function parsePlan(text, { agents } = {}) {
  const roles = agents instanceof Set ? agents : new Set(Array.isArray(agents) ? agents : []);
  const { blocks, tooMany } = readBlocks(text);
  const firstSeen = new Map();
  const dupCount = new Map();
  const named = blocks.map((block) => {
    if (!firstSeen.has(block.id)) {
      firstSeen.set(block.id, true);
      return { ...block, duplicate: false };
    }
    const k = (dupCount.get(block.id) ?? 0) + 1;
    dupCount.set(block.id, k);
    return { ...block, id: `${block.id}-dup${k}`, duplicate: true };
  });
  const ids = named.map((b) => b.id);
  const known = new Set(ids);
  const parsed = named.map((block) => {
    const files = parseFiles(block.fields.get('files'));
    const deps = parseDeps(block.fields.get('depends-on'), known);
    const roleValue = block.fields.get('role');
    const role = roleValue !== undefined && ROLE.test(roleValue) && roles.has(roleValue) ? roleValue : null;
    return { block, files, deps, role, roleValue };
  });
  const members = cycleMembers(ids, parsed.map((p) => p.deps.deps));
  const flaggedAt = parsed.map((p) => p.deps.unknown.length > 0 || members.has(p.block.id));
  const order = scheduleOrder(parsed.map((p) => p.deps.deps.map((d) => ids.indexOf(d))), flaggedAt, (i, d) => members.get(ids[i])?.has(ids[d]) === true && members.get(ids[d])?.has(ids[i]) === true);
  return {
    tooMany,
    tasks: order.map((at, position) => {
      const { block, files, deps, role, roleValue } = parsed[at];
      const reasons = [];
      const parallel = block.fields.get('parallel');
      if (parallel === 'no') reasons.push('parallel: no');
      else if (parallel !== 'yes') reasons.push('no parallel mark');
      reasons.push(...files.reasons);
      if (roleValue === undefined) reasons.push('role: missing');
      else if (role === null) reasons.push('role: unknown');
      for (const u of deps.unknown) reasons.push(`depends-on: unknown ${u}`);
      if (members.has(block.id)) reasons.push('depends-on: cycle');
      if (block.duplicate) reasons.push('duplicate id');
      for (const key of block.repeated) reasons.push(`field repeated: ${key}`);
      const flagged = flaggedAt[at];
      return {
        id: block.id,
        role,
        items: files.items,
        keys: files.keys,
        filesValid: files.valid,
        deps: flagged ? order.slice(0, position).map((i) => ids[i]) : deps.deps,
        marked: reasons.length === 0 && parallel === 'yes',
        alone: reasons.length > 0,
        reasons
      };
    })
  };
}

// ---------------------------------------------------------------- scheduling

export function schedule(tasks, done, running, cap) {
  const doneSet = new Set(done);
  const runSet = new Set(running);
  const runningAlone = tasks.find((t) => runSet.has(t.id) && t.alone);
  const started = [];
  const earlier = [];
  let barrier = null;
  const out = [];
  for (const t of tasks) {
    if (doneSet.has(t.id)) continue;
    if (runSet.has(t.id)) {
      out.push({ id: t.id, outcome: 'running', reason: null, on: null });
      earlier.push(t);
      continue;
    }
    const wait = (reason, on = null) => out.push({ id: t.id, outcome: 'wait', reason, on });
    const begin = () => {
      out.push({ id: t.id, outcome: 'start', reason: null, on: null });
      started.push(t.id);
    };
    const depends = new Set(t.deps);
    const blockedBy = depends.size ? tasks.find((u) => depends.has(u.id) && !doneSet.has(u.id)) : undefined;
    const overlapping = earlier.find((u) => tasksOverlap(u, t));
    if (runningAlone) wait('alone', runningAlone.id);
    else if (blockedBy) wait('depends', blockedBy.id);
    else if (overlapping) wait('overlap', overlapping.id);
    else if (barrier) wait('barrier', barrier);
    else if (t.alone) {
      if (runSet.size === 0 && started.length === 0) begin();
      else wait('alone', [...runSet][0] ?? started[0]);
      barrier = t.id;
    } else if (runSet.size + started.length >= cap) wait('cap');
    else begin();
    earlier.push(t);
  }
  return out;
}

// ---------------------------------------------------------------- files

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

// A plain file: a regular file with exactly one hard link.
const isPlain = (st) => st.isFile() && st.nlink === 1;

// Opens without following a link, checks the opened handle is the file that was inspected, and reads at most max + 1 bytes.
function readOpened(file, expect, max) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (!openedMatches(fd, expect)) throw new Error('file changed');
    const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, max + 1));
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return buf.subarray(0, off);
  } finally {
    fs.closeSync(fd);
  }
}

// The handle is a regular file with one hard link and, when an lstat is given, the same dev and ino.
function openedMatches(fd, expect) {
  const f = fs.fstatSync(fd);
  return isPlain(f) && (!expect || (f.dev === expect.dev && f.ino === expect.ino));
}

// The run folder, with no link in .company, .company/work or the slug folder. Returns null when absent.
function runDir(root, slug) {
  let dir = root;
  for (const part of ['.company', 'work', slug]) {
    dir = path.join(dir, part);
    const st = lstatOrNull(dir);
    if (!st) return null;
    if (!st.isDirectory()) return 'unsafe';
  }
  return dir;
}

function readPlan(root, slug, name) {
  if (typeof name !== 'string' || !PLAN_NAME.test(name)) throw new PlanProblem('plan-name');
  const dir = runDir(root, slug);
  if (dir === null) throw new PlanProblem('plan-missing');
  if (dir === 'unsafe') throw new PlanProblem('plan-unreadable');
  const file = path.join(dir, name);
  const st = lstatOrNull(file);
  if (!st) throw new PlanProblem('plan-missing');
  if (!isPlain(st)) throw new PlanProblem('plan-unreadable');
  if (st.size > MAX_PLAN_BYTES) throw new PlanProblem('plan-too-large');
  let bytes;
  try {
    bytes = readOpened(file, st, MAX_PLAN_BYTES);
  } catch {
    throw new PlanProblem('plan-unreadable');
  }
  if (bytes.length > MAX_PLAN_BYTES) throw new PlanProblem('plan-too-large');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PlanProblem('plan-unreadable');
  }
  return { text, hash: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12) };
}

function loadAgents(pluginRoot) {
  const roles = new Set();
  try {
    for (const name of fs.readdirSync(path.join(pluginRoot, 'agents')).slice(0, 500)) {
      if (!name.endsWith('.md')) continue;
      const slug = name.slice(0, -3);
      if (ROLE.test(slug)) roles.add(slug);
    }
  } catch {
    // no agents folder: every role reads as unknown
  }
  return roles;
}

// ---------------------------------------------------------------- record

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, lo, hi) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

const EVENTS = {
  begin: ['plan', 'hash', 'cap', 'mode', 'tasks', 'ow'],
  start: ['task', 'round', 'ow'],
  done: ['task', 'round', 'ow'],
  out: ['task', 'round', 'extra', 'sibling'],
  round: ['round', 'sets', 'loose', 'ow']
};

function newState() {
  return {
    begun: false, plan: null, hash: null, cap: null, mode: null, round: 0, running: [], done: new Map(),
    peak: 0, waits: new Set(), out: 0, sibling: 0, extras: new Map(), sets: null
  };
}

function keyProblem(list, label, { allowUnknown = false } = {}) {
  if (!Array.isArray(list)) return `${label} must be a list`;
  if (list.length > MAX_PATHS) return `${label} holds more than 100 paths`;
  for (const k of list) {
    if (allowUnknown && k === '?') continue;
    const n = typeof k === 'string' ? normalizePath(k) : { ok: false };
    if (!n.ok || n.path !== k || n.key !== k) return `${label} holds a bad path`;
  }
  return null;
}

function owProblem(ow) {
  if (!Array.isArray(ow) || ow.length > MAX_TASKS + 1) return 'ow must be a list of task ids';
  return ow.every((id) => typeof id === 'string' && TASK_REC.test(id)) ? null : 'ow holds a bad task id';
}

function taskProblem(rec, st, { mustRun }) {
  if (typeof rec.task !== 'string' || !TASK_REC.test(rec.task)) return 'task is not a task id';
  if (rec.task === 'U1' && st.round === 0) return 'U1 outside a round';
  if (!isInt(rec.round, 0, MAX_ROUND) || rec.round !== st.round) return 'round does not match';
  if (mustRun && !st.running.includes(rec.task)) return 'task is not running';
  return null;
}

// Checks one record against the state before it and applies it. Returns the problem text, or null.
function applyEvent(st, rec) {
  if (!isPlainObject(rec)) return 'not an object';
  if (rec.v !== 1) return 'v must be 1';
  if (typeof rec.ev !== 'string' || !Object.hasOwn(EVENTS, rec.ev)) return 'ev is not allowed';
  const wanted = EVENTS[rec.ev];
  for (const key of Object.keys(rec)) {
    if (key !== 'v' && key !== 'at' && key !== 'ev' && !wanted.includes(key)) return `unknown key ${echoKey(key)}`;
  }
  for (const key of ['at', ...wanted]) if (!Object.hasOwn(rec, key)) return `missing key ${key}`;
  if (typeof rec.at !== 'string' || !TIME.test(rec.at) || Number.isNaN(Date.parse(rec.at)) || new Date(rec.at).toISOString().slice(0, 19) + 'Z' !== rec.at) {
    return 'at is not a UTC time';
  }
  if (!st.begun && rec.ev !== 'begin') return 'first line is not begin';
  let problem;
  switch (rec.ev) {
    case 'begin': {
      if (typeof rec.plan !== 'string' || !PLAN_NAME.test(rec.plan)) return 'plan is not a plan name';
      if (typeof rec.hash !== 'string' || !HASH.test(rec.hash)) return 'hash must be 12 lowercase hex';
      if (!isInt(rec.cap, 3, 5)) return 'cap must be an integer 3 to 5';
      if (!MODES.includes(rec.mode)) return 'mode is not allowed';
      if (!isInt(rec.tasks, 0, MAX_TASKS)) return 'tasks must be an integer 0 to 100';
      if ((problem = owProblem(rec.ow))) return problem;
      if (st.running.length) return 'begin while a task runs';
      Object.assign(st, { begun: true, plan: rec.plan, hash: rec.hash, cap: rec.cap, mode: rec.mode });
      break;
    }
    case 'start': {
      if ((problem = taskProblem(rec, st, { mustRun: false }))) return problem;
      if ((problem = owProblem(rec.ow))) return problem;
      if (st.running.includes(rec.task)) return 'task already running';
      if (st.done.get(st.round)?.includes(rec.task)) return 'task already done in this round';
      if (st.round > 0 && !st.sets?.has(rec.task)) return 'task is not in the round';
      st.running.push(rec.task);
      st.peak = Math.max(st.peak, st.running.length);
      break;
    }
    case 'done': {
      if ((problem = taskProblem(rec, st, { mustRun: true }))) return problem;
      if ((problem = owProblem(rec.ow))) return problem;
      st.running = st.running.filter((id) => id !== rec.task);
      if (!st.done.has(st.round)) st.done.set(st.round, []);
      st.done.get(st.round).push(rec.task);
      break;
    }
    case 'out': {
      if ((problem = taskProblem(rec, st, { mustRun: true }))) return problem;
      if ((problem = keyProblem(rec.extra, 'extra', { allowUnknown: true }))) return problem;
      if ((problem = keyProblem(rec.sibling, 'sibling'))) return problem;
      st.out += rec.extra.length + rec.sibling.length;
      st.sibling += rec.sibling.length;
      st.extras.set(rec.task, [...(st.extras.get(rec.task) ?? []), ...rec.extra.filter((k) => k !== '?')]);
      break;
    }
    case 'round': {
      if (!isInt(rec.round, 0, MAX_ROUND)) return 'round must be an integer 0 to 5';
      if (!isInt(rec.loose, 0, 100)) return 'loose must be an integer 0 to 100';
      if (!isPlainObject(rec.sets)) return 'sets must be an object';
      const sets = new Map();
      for (const key of Object.keys(rec.sets)) {
        if (!TASK_REC.test(key)) return 'sets holds a bad task id';
        if ((problem = keyProblem(rec.sets[key], 'sets'))) return problem;
        sets.set(key, rec.sets[key]);
      }
      if ((problem = owProblem(rec.ow))) return problem;
      if (st.running.length) return 'round while a task runs';
      if (rec.round !== st.round + 1) return 'round must follow the last round';
      st.round = rec.round;
      st.sets = sets;
      break;
    }
    default:
      return 'ev is not allowed';
  }
  const at = rec.ev === 'round' ? rec.round : st.round;
  if (rec.ow) for (const id of rec.ow) st.waits.add(`${at}:${id}`);
  return null;
}

function parseRecordText(slug, text) {
  const fail = (line, reason) => new ParallelRecordError(slug, line, reason);
  if (Buffer.byteLength(text) > MAX_RECORD_BYTES) throw fail(0, 'file over 1 MiB');
  if (text === '') throw fail(0, 'file is empty');
  const lines = text.split('\n');
  const endsWithLf = lines.at(-1) === '';
  if (endsWithLf) lines.pop();
  if (lines.length > MAX_RECORD_LINES) throw fail(0, 'file over 5000 lines');
  if (!endsWithLf) throw fail(lines.length, 'no line feed at the end');
  const st = newState();
  lines.forEach((line, index) => {
    const n = index + 1;
    if (line === '') throw fail(n, 'blank line');
    if (line.includes('\r')) throw fail(n, 'carriage return');
    if (Buffer.byteLength(line) > MAX_RECORD_LINE_BYTES) throw fail(n, 'line over 8 KiB');
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      throw fail(n, 'not valid JSON');
    }
    const problem = applyEvent(st, rec);
    if (problem) throw fail(n, problem);
  });
  return st;
}

// Reads and checks the whole record. `state` is null when there is no record file.
function loadRecord(root, slug) {
  const fail = (reason) => new ParallelRecordError(slug, 0, reason);
  const dir = runDir(root, slug);
  if (dir === null) return { dir: null, file: null, text: '', state: null };
  if (dir === 'unsafe') throw fail('run folder is a link or not a folder');
  const file = path.join(dir, 'parallel.jsonl');
  const st = lstatOrNull(file);
  if (!st) return { dir, file, text: '', state: null };
  if (!isPlain(st)) throw fail('record is a link or not a file');
  if (st.size > MAX_RECORD_BYTES) throw fail('file over 1 MiB');
  let bytes;
  try {
    bytes = readOpened(file, st, MAX_RECORD_BYTES);
  } catch {
    throw fail('record is a link or not a file');
  }
  if (bytes.length > MAX_RECORD_BYTES) throw fail('file over 1 MiB');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw fail('not valid UTF-8');
  }
  return { dir, file, text, state: parseRecordText(slug, text), stat: st };
}

function viewOf(slug, st) {
  const done = {};
  for (const round of [...st.done.keys()].sort((a, b) => a - b)) {
    if (st.done.get(round).length) done[round] = [...st.done.get(round)];
  }
  return {
    v: 1, slug, state: 'on', plan: st.plan, hash: st.hash, cap: st.cap, mode: st.mode,
    effective_cap: st.mode === 'sequential' ? 1 : st.cap, round: st.round, running: [...st.running], done,
    peak: st.peak, waits: st.waits.size, out: st.out, sibling: st.sibling
  };
}

export function readParallel(root, slug) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new TypeError('plan-tasks: bad slug');
  const { state } = loadRecord(root, slug);
  return state ? viewOf(slug, state) : { v: 1, slug, state: 'none' };
}

function utc(now) {
  if (!Number.isFinite(now)) throw new Refusal('clock is not a time');
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Appends one event. The line is checked against the existing record first, so a file is never extended into a broken one.
function appendEvent(env, slug, rec) {
  const cur = loadRecord(env.root, slug);
  if (!cur.dir) throw new Refusal('run folder missing');
  const line = `${JSON.stringify(rec)}\n`;
  try {
    parseRecordText(slug, cur.text + line);
  } catch (error) {
    if (error instanceof ParallelRecordError) throw new Refusal(`record refuses the event: ${error.reason}`);
    throw error;
  }
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = fs.openSync(cur.file, flags, 0o644);
    if (!openedMatches(fd, cur.stat)) throw new Error('file changed');
    fs.writeSync(fd, line);
  } catch {
    throw new Refusal('record cannot be written');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------- run view

function roundTasks(planTasks, st) {
  if (st.round === 0 || !st.sets) return planTasks;
  const tasks = [];
  for (const t of planTasks) {
    if (!st.sets.has(t.id)) continue;
    const added = st.sets.get(t.id);
    tasks.push({ ...t, deps: [], keys: [...t.keys, ...added], added });
  }
  if (st.sets.has('U1')) {
    const added = st.sets.get('U1');
    tasks.push({ id: 'U1', role: null, items: [], keys: [...added], filesValid: true, deps: [], marked: false, alone: true, reasons: [], added });
  }
  return tasks;
}

function effectiveCap(st) {
  return st.mode === 'sequential' ? 1 : st.cap;
}

function overlapWaits(tasks, done, running, cap) {
  return schedule(tasks, done, running, cap).filter((e) => e.outcome === 'wait' && e.reason === 'overlap').map((e) => e.id);
}

function needState(env, slug) {
  const { state } = loadRecord(env.root, slug);
  if (!state) throw new Refusal('no begin record for this run');
  return state;
}

function needPlan(env, slug, st, { strict }) {
  const plan = readPlan(env.root, slug, st.plan);
  if (strict && plan.hash !== st.hash) throw new Refusal('plan changed since begin');
  const parsed = parsePlan(plan.text, { agents: env.agents() });
  if (parsed.tooMany) throw new PlanProblem('plan-too-large');
  return parsed;
}

function gateBlock(parsed, cap, mode) {
  const tasks = parsed.tasks;
  if (tasks.length === 0) return ['plan-tasks: 0 tasks; plan Steps run one at a time'];
  const effective = mode === 'sequential' ? 1 : cap;
  const marked = tasks.filter((t) => t.marked).length;
  const lines = [`plan-tasks: ${tasks.length} tasks, ${marked} marked, ${tasks.length - marked} alone, cap ${cap} (${mode})`];
  const placed = new Set();
  let previous = null;
  for (let k = 1; placed.size < tasks.length && k <= MAX_WAVES; k++) {
    const outcomes = schedule(tasks, placed, [], effective);
    const starts = outcomes.filter((e) => e.outcome === 'start');
    if (starts.length === 0) break;
    const entries = starts.map((e) => {
      const was = previous?.get(e.id);
      return was ? `${e.id} ${was.reason}${was.on ? ` ${was.on}` : ''}` : e.id;
    });
    lines.push(`wave ${k}: ${entries.join(', ')}`);
    previous = new Map(outcomes.filter((e) => e.outcome === 'wait').map((e) => [e.id, e]));
    for (const e of starts) placed.add(e.id);
  }
  for (const t of tasks) if (t.alone) lines.push(`warning ${t.id}: runs alone: ${t.reasons.join('; ')}`);
  return lines;
}

// ---------------------------------------------------------------- CLI

function splitDash(args) {
  const at = args.indexOf('--');
  return at === -1 ? { head: args, tail: null } : { head: args.slice(0, at), tail: args.slice(at + 1) };
}

function takeFlags(args, spec) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      if (!Object.hasOwn(spec, a) || Object.hasOwn(flags, a)) throw new Refusal(USAGE);
      if (spec[a] === 'value') {
        if (i + 1 >= args.length) throw new Refusal(USAGE);
        flags[a] = args[++i];
      } else {
        flags[a] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function checkSlug(slug) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new Refusal('bad slug');
  return slug;
}

function checkId(id) {
  if (typeof id !== 'string' || !TASK_REC.test(id)) throw new Refusal('bad task id');
  return id;
}

function capAndMode(flags) {
  if (!Object.hasOwn(flags, '--cap') || !Object.hasOwn(flags, '--mode')) throw new Refusal(USAGE);
  if (!/^[345]$/.test(flags['--cap'])) throw new Refusal('cap must be 3, 4 or 5');
  if (!MODES.includes(flags['--mode'])) throw new Refusal('mode must be parallel or sequential');
  return { cap: Number(flags['--cap']), mode: flags['--mode'] };
}

function checkPaths(list) {
  if (list.length > MAX_PATHS) throw new Refusal('more than 100 paths');
  return list;
}

function planFor(env, slug, name) {
  if (typeof name !== 'string' || !PLAN_NAME.test(name)) throw new PlanProblem('plan-name');
  const plan = readPlan(env.root, slug, name);
  const parsed = parsePlan(plan.text, { agents: env.agents() });
  if (parsed.tooMany) throw new PlanProblem('plan-too-large');
  return { plan, parsed };
}

function cmdCheck(args, env) {
  const { positional, flags } = takeFlags(args, { '--cap': 'value', '--mode': 'value' });
  if (positional.length !== 2) throw new Refusal(USAGE);
  const slug = checkSlug(positional[0]);
  const { cap, mode } = capAndMode(flags);
  const { parsed } = planFor(env, slug, positional[1]);
  return { code: 0, lines: gateBlock(parsed, cap, mode) };
}

function cmdBegin(args, env) {
  const { positional, flags } = takeFlags(args, { '--cap': 'value', '--mode': 'value' });
  if (positional.length !== 2) throw new Refusal(USAGE);
  const slug = checkSlug(positional[0]);
  const { cap, mode } = capAndMode(flags);
  const { plan, parsed } = planFor(env, slug, positional[1]);
  const st = loadRecord(env.root, slug).state ?? newState();
  if (st.running.length) throw new Refusal('a task is running');
  const tasks = roundTasks(parsed.tasks, st);
  const ow = overlapWaits(tasks, st.done.get(st.round) ?? [], [], mode === 'sequential' ? 1 : cap);
  appendEvent(env, slug, {
    v: 1, at: utc(env.now), ev: 'begin', plan: positional[1], hash: plan.hash, cap, mode, tasks: parsed.tasks.length, ow
  });
  return { code: 0, lines: [gateBlock(parsed, cap, mode)[0], 'begun'] };
}

function nextView(env, slug) {
  const st = needState(env, slug);
  const parsed = needPlan(env, slug, st, { strict: true });
  const tasks = roundTasks(parsed.tasks, st);
  const done = st.done.get(st.round) ?? [];
  const outcomes = schedule(tasks, done, st.running, effectiveCap(st));
  const doneCount = tasks.filter((t) => done.includes(t.id)).length;
  return { st, tasks, outcomes, doneCount, complete: doneCount === tasks.length };
}

function cmdNext(args, env) {
  const { positional, flags } = takeFlags(args, { '--json': 'bool' });
  if (positional.length !== 1) throw new Refusal(USAGE);
  const slug = checkSlug(positional[0]);
  const { st, tasks, outcomes, doneCount, complete } = nextView(env, slug);
  const roleOf = new Map(tasks.map((t) => [t.id, t.role ?? '?']));
  if (flags['--json']) {
    const body = {
      v: 1, round: st.round, cap: effectiveCap(st), running: st.running.length,
      start: outcomes.filter((e) => e.outcome === 'start').map((e) => ({ task: e.id, role: roleOf.get(e.id) })),
      wait: outcomes.filter((e) => e.outcome === 'wait').map((e) => ({ task: e.id, reason: e.reason, on: e.on })),
      done: doneCount, total: tasks.length, complete
    };
    return { code: 0, lines: [JSON.stringify(body)] };
  }
  const lines = [`next: round ${st.round}, running ${st.running.length} of cap ${effectiveCap(st)}`];
  if (complete) {
    lines.push(`next: round ${st.round} complete`);
    return { code: 0, lines };
  }
  for (const e of outcomes) {
    if (e.outcome === 'start') lines.push(`start ${e.id} ${roleOf.get(e.id)}`);
    else if (e.outcome === 'running') lines.push(`running ${e.id}`);
    else lines.push(`wait ${e.id} ${e.reason}${e.on ? ` ${e.on}` : ''}`);
  }
  lines.push(`done ${doneCount} of ${tasks.length}`);
  return { code: 0, lines };
}

function twoArgs(args) {
  if (args.length !== 2) throw new Refusal(USAGE);
  return [checkSlug(args[0]), checkId(args[1])];
}

function cmdStart(args, env) {
  const [slug, id] = twoArgs(args);
  const { st, tasks, outcomes } = nextView(env, slug);
  if (!outcomes.some((e) => e.id === id && e.outcome === 'start')) throw new Refusal('not a start line of next');
  const done = st.done.get(st.round) ?? [];
  const ow = overlapWaits(tasks, done, [...st.running, id], effectiveCap(st));
  appendEvent(env, slug, { v: 1, at: utc(env.now), ev: 'start', task: id, round: st.round, ow });
  return { code: 0, lines: [`started ${id}`] };
}

function cmdDone(args, env) {
  const [slug, id] = twoArgs(args);
  const st = needState(env, slug);
  if (!st.running.includes(id)) throw new Refusal('task is not running');
  let ow = [];
  try {
    const tasks = roundTasks(needPlan(env, slug, st, { strict: true }).tasks, st);
    ow = overlapWaits(tasks, [...(st.done.get(st.round) ?? []), id], st.running.filter((r) => r !== id), effectiveCap(st));
  } catch (error) {
    if (!(error instanceof Refusal) && !(error instanceof PlanProblem)) throw error;
  }
  appendEvent(env, slug, { v: 1, at: utc(env.now), ev: 'done', task: id, round: st.round, ow });
  return { code: 0, lines: [`done ${id}`] };
}

function cmdLines(args, env) {
  const [slug, id] = twoArgs(args);
  const st = needState(env, slug);
  const tasks = roundTasks(needPlan(env, slug, st, { strict: true }).tasks, st);
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Refusal('task is not in this round');
  const files = [...new Set([...task.items, ...(task.added ?? [])])];
  return { code: 0, lines: [`Task: ${id}`, `Files: ${files.length ? files.join(', ') : 'none'}`] };
}

// The builder's slice of the plan: its own task block, the plan's Contracts section, every Decided line outside
// the task blocks, and every other section whose heading names the task. Plan text goes to the file only, never to stdout.
export function taskBrief(text, id, planName) {
  const lines = readPlanLines(text).lines;
  const own = [];
  const contracts = [];
  const decided = [];
  const named = [];
  const idToken = new RegExp(`(^|[^A-Za-z0-9])${id}(?![0-9a-z])`);
  let section = null;
  let inTask = false;
  for (const entry of lines) {
    if (entry.kind === 'heading') {
      if (section && entry.level <= section.level) section = null;
      if (!section && entry.level >= 2 && entry.level <= 4) {
        const head = TASK_HEAD.exec(entry.title.trim());
        if (head) {
          inTask = true;
          section = { level: entry.level, into: head[1] === id ? own : null };
        } else {
          inTask = false;
          if (entry.level === 2 && /^Contracts\b/i.test(entry.title.trim())) section = { level: 2, into: contracts };
          else if (idToken.test(entry.title)) section = { level: entry.level, into: named };
        }
      } else if (!section && entry.level < 2) {
        inTask = false;
      }
      if (section?.into) section.into.push(entry.line);
      continue;
    }
    if (section?.into) {
      section.into.push(entry.line);
    } else if (!inTask && !section && entry.kind === 'text' && /^\s{0,3}(?:[-*]\s+)?Decided:/.test(entry.line)) {
      decided.push(entry.line);
    }
  }
  if (own.length === 0) return null;
  const out = [
    `# Task brief: ${id} (from ${planName})`,
    '',
    'Your slice of the plan. Build from this file, the Contracts it names and the brief; do not open the full plan.',
    'Missing something you need → return `status: blocked` with `missing plan context: <what>`.',
    '',
    ...own
  ];
  if (contracts.length) out.push('', ...contracts);
  if (decided.length) out.push('', '## Decided (plan-wide)', ...decided);
  if (named.length) out.push('', ...named);
  return `${out.join('\n')}\n`;
}

function cmdBrief(args, env) {
  const [slug, id] = twoArgs(args);
  const st = needState(env, slug);
  const tasks = roundTasks(needPlan(env, slug, st, { strict: true }).tasks, st);
  if (!tasks.some((t) => t.id === id)) throw new Refusal('task is not in this round');
  if (!DEP_ID.test(id)) throw new Refusal('task has no plan block');
  const brief = taskBrief(readPlan(env.root, slug, st.plan).text, id, st.plan);
  if (brief === null) throw new Refusal('task has no plan block');
  const dir = runDir(env.root, slug);
  if (dir === null || dir === 'unsafe') throw new Refusal('run folder missing');
  const tasksDir = path.join(dir, 'tasks');
  const dst = lstatOrNull(tasksDir);
  if (dst && !dst.isDirectory()) throw new Refusal('tasks folder is not a folder');
  if (!dst) fs.mkdirSync(tasksDir);
  const file = path.join(tasksDir, `${id}.md`);
  const fst = lstatOrNull(file);
  if (fst && !isPlain(fst)) throw new Refusal('task brief is not a plain file');
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = fs.openSync(file, flags, 0o644);
    fs.writeSync(fd, brief);
  } catch {
    throw new Refusal('task brief cannot be written');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return { code: 0, lines: [`Task brief: .company/work/${slug}/tasks/${id}.md`] };
}

function cmdScope(args, env) {
  const { head, tail } = splitDash(args);
  if (tail === null || head.length !== 2) throw new Refusal(USAGE);
  const [slug, id] = twoArgs(head);
  const candidates = checkPaths(tail);
  const st = needState(env, slug);
  if (!st.running.includes(id)) throw new Refusal('task is not running');
  const tasks = roundTasks(needPlan(env, slug, st, { strict: false }).tasks, st);
  const setOf = (taskId) => [...(tasks.find((t) => t.id === taskId)?.keys ?? []), ...(st.extras.get(taskId) ?? [])];
  const own = setOf(id);
  const others = st.running.filter((r) => r !== id).map((r) => ({ id: r, keys: setOf(r) }));
  const prefix = `.company/work/${slug}/`;
  const lines = [];
  const extra = [];
  const sibling = [];
  for (const candidate of candidates) {
    const n = normalizePath(candidate);
    if (!n.ok) {
      extra.push('?');
      lines.push('extra ?');
    } else if (n.key.startsWith(prefix) || own.some((k) => keysOverlap(k, n.key))) {
      lines.push(`in ${n.path}`);
    } else {
      const other = others.find((o) => o.keys.some((k) => keysOverlap(k, n.key)));
      if (other) {
        sibling.push(n.key);
        lines.push(`sibling ${other.id} ${n.path}`);
      } else {
        extra.push(n.key);
        lines.push(`extra ${n.path}`);
      }
    }
  }
  appendEvent(env, slug, { v: 1, at: utc(env.now), ev: 'out', task: id, round: st.round, extra, sibling });
  lines.push(`scope: ${extra.length} extra, ${sibling.length} sibling`);
  return { code: 0, lines };
}

function cmdRound(args, env) {
  const { head, tail } = splitDash(args);
  if (tail === null) throw new Refusal(USAGE);
  const { positional, flags } = takeFlags(head, { '--loose': 'value' });
  if (positional.length !== 2) throw new Refusal(USAGE);
  const slug = checkSlug(positional[0]);
  if (!/^[1-5]$/.test(positional[1])) throw new Refusal('round must be a whole number from 1 to 5');
  const n = Number(positional[1]);
  let loose = 0;
  if (Object.hasOwn(flags, '--loose')) {
    if (!/^(0|[1-9]\d{0,2})$/.test(flags['--loose']) || Number(flags['--loose']) > 100) throw new Refusal('loose must be a whole number from 0 to 100');
    loose = Number(flags['--loose']);
  }
  const blockers = checkPaths(tail).map((p) => {
    const norm = normalizePath(p);
    if (!norm.ok) throw new Refusal('a path is not allowed');
    return norm;
  });
  const st = needState(env, slug);
  if (st.running.length) throw new Refusal('a task is running');
  if (n !== st.round + 1) throw new Refusal(`round must be ${st.round + 1}`);
  if (blockers.length === 0 && loose === 0) throw new Refusal('nothing to send back');
  const parsed = needPlan(env, slug, st, { strict: true });
  const sets = new Map();
  const unowned = [];
  const give = (id, key) => {
    if (!sets.has(id)) sets.set(id, []);
    if (!sets.get(id).includes(key)) sets.get(id).push(key);
  };
  for (const b of blockers) {
    const byFiles = parsed.tasks.find((t) => t.keys.some((k) => keysOverlap(k, b.key)));
    const byExtra = byFiles ?? parsed.tasks.find((t) => (st.extras.get(t.id) ?? []).some((k) => keysOverlap(k, b.key)));
    if (byExtra) give(byExtra.id, b.key);
    else unowned.push(b);
  }
  if (unowned.length || loose > 0) {
    sets.set('U1', []);
    for (const b of unowned) give('U1', b.key);
  }
  const ordered = new Map();
  for (const t of parsed.tasks) if (sets.has(t.id)) ordered.set(t.id, sets.get(t.id));
  if (sets.has('U1')) ordered.set('U1', sets.get('U1'));
  const next = { round: n, sets: ordered };
  const ow = overlapWaits(roundTasks(parsed.tasks, next), [], [], effectiveCap(st));
  appendEvent(env, slug, {
    v: 1, at: utc(env.now), ev: 'round', round: n, sets: Object.fromEntries(ordered), loose, ow
  });
  const lines = [`round ${n}: ${[...ordered].map(([id, keys]) => `${id} (+${keys.length} paths)`).join(', ')}`];
  for (const b of unowned) lines.push(`unowned ${b.path}`);
  return { code: 0, lines };
}

function cmdRead(args, env) {
  if (args.length !== 1) throw new Refusal(USAGE);
  return { code: 0, lines: [JSON.stringify(readParallel(env.root, checkSlug(args[0])))] };
}

const HANDLERS = {
  check: cmdCheck, begin: cmdBegin, next: cmdNext, start: cmdStart, done: cmdDone, lines: cmdLines, brief: cmdBrief, scope: cmdScope, round: cmdRound, read: cmdRead
};

// `now` (epoch ms) and `root` (the product root) are for callers that inject them; `pluginRoot` locates agents/.
export function main(args, { now, root, pluginRoot } = {}) {
  let agents = null;
  const env = {
    root: typeof root === 'string' && root !== '' ? root : process.cwd(),
    now: typeof now === 'number' ? now : Date.now(),
    agents: () => (agents ??= loadAgents(typeof pluginRoot === 'string' && pluginRoot !== '' ? pluginRoot : path.resolve(import.meta.dirname, '..')))
  };
  try {
    const list = Array.isArray(args) ? args : [];
    for (const arg of list) {
      if (typeof arg !== 'string') throw new Refusal(USAGE);
      if (CONTROLS.test(arg)) throw new Refusal('argument holds a control character');
      if (arg.length > MAX_ARG_CHARS) throw new Refusal('argument too long');
    }
    const [command, ...rest] = list;
    if (typeof command !== 'string' || !Object.hasOwn(HANDLERS, command)) throw new Refusal(USAGE);
    return HANDLERS[command](rest, env);
  } catch (error) {
    if (error instanceof Refusal) return { code: 3, lines: [`refused: ${error.message}`] };
    if (error instanceof ParallelRecordError) return { code: 1, lines: [error.message] };
    if (error instanceof PlanProblem) {
      return { code: 1, lines: [`plan-tasks: error ${PLAN_ERRORS.includes(error.reason) ? error.reason : 'plan-unreadable'}`] };
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, lines } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
