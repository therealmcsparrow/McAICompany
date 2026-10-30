// Cost source (contract: docs/contracts/cost-source.md v1). Node built-ins only.
// Reads the run's cost from the OpenTelemetry metrics export file the CEO's collector writes:
// <MCSPARROW_HOME or ~/.mcsparrow>/otel/metrics.jsonl. The file is untrusted data: it is read as a plain file,
// streamed, one line at a time, and only the cost metric's value, unit, session id and two times are looked at.
// The number is Claude Code's own approximate cost. It is never worked out from anything else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { show } from './run-state.mjs';

const MiB = 1024 * 1024;
const MAX_FILE = 256 * MiB;
const MAX_LINE = MiB;
const MAX_RUN_STATE = 64 * 1024;
const METRIC = 'claude_code.cost.usage';
const UNIT = 'USD';
const SESSION_KEY = 'session.id';
const DELTA = 1;
const NANO = /^\d{1,20}$/;
const INT = /^\d{1,15}$/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MICROS = 1000000;
const MAX_MICROS = BigInt(Number.MAX_SAFE_INTEGER);

class TooLarge extends Error {}

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (o, key) => (isObject(o) && Object.hasOwn(o, key) ? o[key] : undefined);
const list = (o, key) => {
  const v = own(o, key);
  return Array.isArray(v) ? v : [];
};

// <MCSPARROW_HOME or ~/.mcsparrow>/otel/metrics.jsonl
export function metricsPath() {
  const home = process.env.MCSPARROW_HOME || path.join(os.homedir(), '.mcsparrow');
  return path.join(home, 'otel', 'metrics.jsonl');
}

const none = (reason) => ({ state: 'none', reason });

// The text for the scorecard and the receipt. Micro-USD are rounded half up to 2 decimals only here.
export function costText(result) {
  if (!isObject(result) || result.state !== 'recorded') return 'cost: not recorded';
  const note = '(approximate, Claude Code telemetry)';
  if (result.micros > 0 && result.micros < 5000) return `cost under 0.01 USD ${note}`;
  const cents = Math.floor((result.micros + 5000) / 10000);
  return `cost ${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')} USD ${note}`;
}

const plainStat = (p) => {
  try {
    const st = fs.lstatSync(p);
    return st.isFile() && st.nlink === 1 ? st : null;
  } catch {
    return null;
  }
};

// The time of the last line of the run-state file, as epoch ms, or 0.
function lastRecordMs(root, run) {
  const file = path.join(root, '.company', 'work', run, 'run-state.jsonl');
  const st = plainStat(file);
  if (!st || st.size > MAX_RUN_STATE) return 0;
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '');
    const at = own(JSON.parse(lines.at(-1)), 'at');
    return typeof at === 'string' && AT.test(at) ? Date.parse(at) : 0;
  } catch {
    return 0;
  }
}

// The run's sessions and window [start, end] in epoch ms, or undefined when the run has no session on record.
function runFacts(root, run) {
  let view;
  try {
    view = show(root, run);
  } catch {
    return undefined;
  }
  if (!Array.isArray(view.sessions) || view.sessions.length === 0 || typeof view.started !== 'string') return undefined;
  const times = [view.started, view.ended, ...view.gates.map((g) => g.at), ...view.picks.map((g) => g.at), ...view.ceo.map((g) => g.at)];
  for (const s of view.subs) times.push(s.start, s.stop);
  const start = Date.parse(view.started);
  const end = Math.max(start, lastRecordMs(root, run), ...times.filter((x) => typeof x === 'string').map((x) => Date.parse(x)).filter(Number.isFinite));
  if (!Number.isFinite(start)) return undefined;
  return { sessions: new Set(view.sessions), start: BigInt(start) * 1000000n, end: BigInt(end) * 1000000n };
}

// Streams the lines of the file. Throws TooLarge past a size limit.
function eachLine(fd, limits, onLine) {
  const chunk = Buffer.alloc(MiB);
  let pending = Buffer.alloc(0);
  let total = 0;
  for (;;) {
    const n = fs.readSync(fd, chunk, 0, chunk.length, null);
    if (n === 0) break;
    total += n;
    if (total > limits.file) throw new TooLarge();
    pending = pending.length === 0 ? Buffer.from(chunk.subarray(0, n)) : Buffer.concat([pending, chunk.subarray(0, n)]);
    let start = 0;
    for (let nl = pending.indexOf(10, start); nl !== -1; nl = pending.indexOf(10, start)) {
      if (nl - start > limits.line) throw new TooLarge();
      onLine(pending.subarray(start, nl));
      start = nl + 1;
    }
    pending = pending.subarray(start);
    if (pending.length > limits.line) throw new TooLarge();
  }
  if (pending.length > 0) onLine(pending);
}

// A 64-bit time as BigInt: a decimal string, or a number that is a safe integer. Else undefined.
function nanos(x) {
  if (typeof x === 'string') return NANO.test(x) ? BigInt(x) : undefined;
  return Number.isSafeInteger(x) && x >= 0 ? BigInt(x) : undefined;
}

// Integer micro-USD of one point (BigInt), or undefined when the value is not usable.
function micros(point) {
  const hasDouble = Object.hasOwn(point, 'asDouble');
  const hasInt = Object.hasOwn(point, 'asInt');
  if (hasDouble === hasInt) return undefined;
  if (hasDouble) {
    const v = point.asDouble;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined;
    const scaled = Math.round(v * MICROS);
    return Number.isSafeInteger(scaled) ? BigInt(scaled) : undefined;
  }
  const v = point.asInt;
  if (typeof v === 'string') return INT.test(v) ? BigInt(v) * BigInt(MICROS) : undefined;
  return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) * BigInt(MICROS) : undefined;
}

// The session id of a point: the one `session.id` attribute with a string value, else undefined.
function sessionOf(point) {
  let found;
  for (const a of list(point, 'attributes')) {
    if (own(a, 'key') !== SESSION_KEY) continue;
    const value = own(own(a, 'value'), 'stringValue');
    if (typeof value !== 'string') return undefined;
    if (found !== undefined && found !== value) return undefined;
    found = value;
  }
  return found;
}

// Adds one parsed line to `acc`. Returns false when the line is not an OTLP metrics batch.
function addLine(obj, facts, acc) {
  if (!isObject(obj) || !Array.isArray(own(obj, 'resourceMetrics'))) return false;
  for (const rm of obj.resourceMetrics) {
    for (const sm of list(rm, 'scopeMetrics')) {
      for (const metric of list(sm, 'metrics')) {
        if (own(metric, 'name') !== METRIC || own(metric, 'unit') !== UNIT) continue;
        const sum = own(metric, 'sum');
        for (const point of list(sum, 'dataPoints')) {
          const session = sessionOf(point);
          if (session === undefined || !facts.sessions.has(session)) continue;
          if (own(sum, 'aggregationTemporality') !== DELTA) {
            acc.cumulative = true;
            continue;
          }
          const from = nanos(own(point, 'startTimeUnixNano'));
          const to = nanos(own(point, 'timeUnixNano'));
          const value = micros(point);
          if (from === undefined || to === undefined || value === undefined || from > to) {
            acc.skipped += 1;
            continue;
          }
          if (from > facts.end || to < facts.start) continue;
          acc.micros += value;
          acc.points += 1;
        }
      }
    }
  }
  return true;
}

// readCost(root, run, { limits }) -> { state: 'recorded', micros, points, skipped } | { state: 'none', reason }
// reason: no-session | no-file | unreadable | too-large | temporality | no-points. `limits` is for tests.
export function readCost(root, run, { limits } = {}) {
  const caps = { file: limits?.file ?? MAX_FILE, line: limits?.line ?? MAX_LINE };
  const facts = runFacts(root, run);
  if (!facts) return none('no-session');
  const file = metricsPath();
  let lst;
  try {
    lst = fs.lstatSync(file);
  } catch (error) {
    return none(error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 'no-file' : 'unreadable');
  }
  let dir;
  try {
    dir = fs.lstatSync(path.dirname(file));
  } catch {
    return none('unreadable');
  }
  if (!dir.isDirectory() || !lst.isFile() || lst.nlink !== 1) return none('unreadable');
  if (lst.size > caps.file) return none('too-large');
  const acc = { micros: 0n, points: 0, skipped: 0, cumulative: false };
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || (lst.ino !== 0 && (st.ino !== lst.ino || st.dev !== lst.dev))) return none('unreadable');
    eachLine(fd, caps, (buf) => {
      const text = buf.toString('utf8').trim();
      if (text === '') return;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        acc.skipped += 1;
        return;
      }
      if (!addLine(parsed, facts, acc)) acc.skipped += 1;
    });
  } catch (error) {
    return none(error instanceof TooLarge ? 'too-large' : 'unreadable');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  if (acc.cumulative) return none('temporality');
  if (acc.points === 0 || acc.micros > MAX_MICROS) return none('no-points');
  return { state: 'recorded', micros: Number(acc.micros), points: acc.points, skipped: acc.skipped };
}
