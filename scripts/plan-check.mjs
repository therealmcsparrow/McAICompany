#!/usr/bin/env node
// Plan check (contract: docs/contracts/plan-check.md v1.5). Node built-ins; `verify` also loads the settings script.
// Scans the Steps, Tasks, Wave, Phase, Fix round, T<n> and M<n> sections of a plan for open decisions, and keeps a per-run record of the
// scans in .company/work/<slug>/plan-check.jsonl. The record holds counts, enums, a file name and
// times only, never plan text (GDPR Art. 5(1)(c)). Plan text and CLI arguments are untrusted data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { MAX_LINE_CHARS, readPlanLines } from './plan-markdown.mjs';
import { WorkFolderRefusal, exactWorkPath, isTicketHeading, isWorkFolder } from '../mods/lib/work-folder.mjs';

const KiB = 1024;
const MAX_PLAN_BYTES = 256 * KiB;
const MAX_PATTERN_BYTES = 16 * KiB;
const MAX_PATTERNS = 10;
const MAX_RECORD_BYTES = 64 * KiB;
const MAX_RECORD_LINES = 1000;
const MAX_RECORD_LINE_BYTES = 256;
const MAX_COUNT = 10000;
const MAX_PHRASE = 60;
const MAX_ROWS = 5;
const MAX_PLANS = 50;

const PLAN_NAME = /^(\d{2,3}-)?(architect-)?plan(-[a-z0-9]+)?\.md$/;
const PATTERN_ID = /^[a-z][a-z0-9-]{0,31}$/;
const RESERVED_IDS = new Set(['unclosed-fence', 'long-line']);
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const HASH = /^[0-9a-f]{12}$/;
const WAVE_COUNT = /^(0|[1-9]\d{0,4})$/;
const SECTION_TITLE = /^(?:steps|tasks|wave|phase|fix round|[tm]\d)/i;
const MAX_TITLE_CHARS = 200;
const opensSection = (title) => {
  const text = title.trim().slice(0, MAX_TITLE_CHARS);
  return SECTION_TITLE.test(text) || isTicketHeading(text);
};
const DECIDED = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?Decided: (\S.*?) because (\S.*)$/;
const CONTROLS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const KEY_ECHO = /^[a-z_]{1,20}$/;
const echoKey = (key) => (KEY_ECHO.test(key) ? key : '?');
const POLICIES = ['warn', 'block'];
const REASONS = ['patterns', 'plan-missing', 'plan-unreadable', 'plan-too-large', 'plan-name'];
const PATTERN_FILE = path.join(import.meta.dirname, 'plan-check-patterns.json');
const DEFAULT_RE_FLAGS = new Set(['', 'i']);

const USAGE = [
  'usage: plan-check.mjs <command>',
  '  gate <slug> <plan-name> --policy <warn|block> [--json]',
  '  off <slug>',
  '  wave <slug> <n>',
  '  verify <slug> [<plan-name>] [--json]',
  '  read <slug>'
].join('\n');

export class PlanCheckRecordError extends Error {
  constructor(slug, line, reason) {
    super(`plan-check record ${slug} line ${line}: ${reason}`);
    this.name = 'PlanCheckRecordError';
  }
}

class PatternError extends Error {}
class Refusal extends Error {}

// ---------------------------------------------------------------- patterns

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function entryProblem(entry, index, seen) {
  const label = (id) => `patterns entry ${index} (${typeof id === 'string' && PATTERN_ID.test(id) ? id : '?'})`;
  if (!isPlainObject(entry)) return `${label()}: not an object`;
  const fail = (msg) => `${label(entry.id)}: ${msg}`;
  for (const key of Object.keys(entry)) {
    if (!['id', 're', 'why', 'flags'].includes(key)) return fail(`unknown key ${echoKey(key)}`);
  }
  for (const key of ['id', 're', 'why']) if (!Object.hasOwn(entry, key)) return fail(`missing key ${key}`);
  if (typeof entry.id !== 'string' || !PATTERN_ID.test(entry.id)) return fail('id is not allowed');
  if (RESERVED_IDS.has(entry.id)) return fail('id is reserved');
  if (seen.has(entry.id)) return fail('id is not unique');
  if (typeof entry.re !== 'string' || entry.re.length < 1 || entry.re.length > 200) return fail('re must be 1 to 200 characters');
  const flags = Object.hasOwn(entry, 'flags') ? entry.flags : '';
  if (typeof flags !== 'string' || !DEFAULT_RE_FLAGS.has(flags)) return fail('flags must be "" or "i"');
  try {
    new RegExp(entry.re, flags);
  } catch {
    return fail('re does not compile');
  }
  if (typeof entry.why !== 'string' || entry.why.length < 1 || entry.why.length > 120 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(entry.why)) {
    return fail('why must be 1 to 120 characters on one line');
  }
  if (entry.why.trim() === '') return fail('why is blank');
  seen.add(entry.id);
  return null;
}

// Reads the pattern file, rejects the whole file on any problem. Returns { patterns, hash }.
export function loadPatterns(file = PATTERN_FILE) {
  let bytes;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile()) throw new Error('not a file');
    if (st.size > MAX_PATTERN_BYTES) throw new PatternError('patterns: file over 16 KiB');
    bytes = fs.readFileSync(file);
  } catch (error) {
    if (error instanceof PatternError) throw error;
    throw new PatternError('patterns: file cannot be read');
  }
  if (bytes.length > MAX_PATTERN_BYTES) throw new PatternError('patterns: file over 16 KiB');
  let data;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new PatternError('patterns: not valid JSON');
  }
  if (!isPlainObject(data)) throw new PatternError('patterns: not an object');
  for (const key of Object.keys(data)) {
    if (key !== 'v' && key !== 'patterns') throw new PatternError(`patterns: unknown key ${echoKey(key)}`);
  }
  if (data.v !== 1) throw new PatternError('patterns: v must be 1');
  if (!Array.isArray(data.patterns)) throw new PatternError('patterns: patterns must be an array');
  if (data.patterns.length > MAX_PATTERNS) throw new PatternError(`patterns: ${data.patterns.length} entries, at most ${MAX_PATTERNS}`);
  const seen = new Set();
  data.patterns.forEach((entry, index) => {
    const problem = entryProblem(entry, index, seen);
    if (problem) throw new PatternError(problem);
  });
  const patterns = data.patterns.map((e) => ({ id: e.id, re: e.re, flags: e.flags ?? '', why: e.why }));
  const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  return { patterns, hash };
}

// ---------------------------------------------------------------- scanner

function cleanPhrase(text) {
  const flat = text.replace(CONTROLS, '').replaceAll('`', '').replaceAll('|', '/').replace(/\s+/g, ' ').trim();
  const points = Array.from(flat);
  return points.length > MAX_PHRASE ? `${points.slice(0, MAX_PHRASE).join('')}…` : flat;
}

// A run of n backticks opens a span that closes at the next run of exactly n backticks on the line.
function stripCodeSpans(line) {
  if (!line.includes('`')) return line;
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i++];
      continue;
    }
    let n = 0;
    while (line[i + n] === '`') n++;
    let j = i + n;
    let close = -1;
    while (j < line.length) {
      if (line[j] !== '`') {
        j++;
        continue;
      }
      let m = 0;
      while (line[j + m] === '`') m++;
      if (m === n) {
        close = j;
        break;
      }
      j += m;
    }
    if (close === -1) {
      out += line.slice(i, i + n);
      i += n;
    } else {
      out += ' ';
      i = close + n;
    }
  }
  return out;
}

export function scanText(text, patterns, { file = '' } = {}) {
  const compiled = patterns.map((p) => ({ ...p, rx: new RegExp(p.re, p.flags ?? '') }));
  const findings = [];
  let decided = 0;
  let sectionLevel = 0;
  const { lines, openFence } = readPlanLines(text);
  for (const { no: lineNo, line, kind, level, title } of lines) {
    if (kind === 'fence' || kind === 'fenced') continue;
    if (kind === 'heading') {
      if (sectionLevel && level <= sectionLevel) sectionLevel = 0;
      if (!sectionLevel) {
        if ((level === 2 || level === 3) && opensSection(title)) sectionLevel = level;
        continue;
      }
    }
    if (!sectionLevel) continue;
    if (kind === 'long') {
      findings.push({ file, line: lineNo, id: 'long-line', phrase: cleanPhrase(line.slice(0, 200)), why: 'line too long to check' });
      continue;
    }
    if (/^\s*>/.test(line)) continue;
    if (DECIDED.test(line)) {
      decided++;
      continue;
    }
    const rest = stripCodeSpans(line);
    for (const p of compiled) {
      const m = p.rx.exec(rest);
      if (m) {
        findings.push({ file, line: lineNo, id: p.id, phrase: cleanPhrase(m[0]), why: p.why });
        break;
      }
    }
  }
  if (openFence) {
    findings.push({
      file, line: openFence.no, id: 'unclosed-fence', phrase: cleanPhrase(lines[openFence.no - 1].line.slice(0, 200)),
      why: 'an unclosed code fence hides the rest of the plan from the check'
    });
  }
  findings.sort((a, b) => a.line - b.line);
  return { findings, decided };
}

// ---------------------------------------------------------------- paths

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
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

// The name shape first, then the exact spelling of the folder (and a plan file) on disk.
function checkSlug(slug, root, file) {
  if (typeof slug !== 'string' || !isWorkFolder(slug)) throw new Refusal('bad slug');
  try {
    exactWorkPath({ fs, path }, root, file === undefined ? [slug] : [slug, file]);
  } catch (error) {
    if (error instanceof WorkFolderRefusal) throw new Refusal(error.message);
    throw error;
  }
}

// ---------------------------------------------------------------- record

function intIn(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
}

const EVENTS = {
  scan: { required: ['v', 'at', 'ev', 'policy', 'plan', 'patterns', 'findings', 'decided'], optional: [] },
  off: { required: ['v', 'at', 'ev', 'policy'], optional: [] },
  wave: { required: ['v', 'at', 'ev', 'waved'], optional: [] },
  error: { required: ['v', 'at', 'ev', 'policy', 'reason'], optional: ['plan'] }
};

// Returns the problem text, or null when the record is valid. `scanFindings` is the findings of the latest scan before it.
function recordProblem(rec, scanFindings) {
  if (!isPlainObject(rec)) return 'not an object';
  if (rec.v !== 1) return 'v must be 1';
  if (typeof rec.ev !== 'string' || !Object.hasOwn(EVENTS, rec.ev)) return 'ev is not allowed';
  const spec = EVENTS[rec.ev];
  for (const key of Object.keys(rec)) {
    if (!spec.required.includes(key) && !spec.optional.includes(key)) return `unknown key ${echoKey(key)}`;
  }
  for (const key of spec.required) if (!Object.hasOwn(rec, key)) return `missing key ${key}`;
  if (typeof rec.at !== 'string' || !TIME.test(rec.at) || Number.isNaN(Date.parse(rec.at)) || new Date(rec.at).toISOString().slice(0, 19) + 'Z' !== rec.at) {
    return 'at is not a UTC time';
  }
  if (rec.ev === 'off') {
    if (rec.policy !== 'off') return 'policy is not allowed';
    return null;
  }
  if (rec.ev === 'wave') {
    if (!intIn(rec.waved)) return 'waved must be an integer 0 to 10000';
    if (scanFindings === null) return 'wave with no scan before it';
    if (rec.waved > scanFindings) return 'waved above the findings of the latest scan';
    return null;
  }
  if (!POLICIES.includes(rec.policy)) return 'policy is not allowed';
  if (Object.hasOwn(rec, 'plan') && (typeof rec.plan !== 'string' || !PLAN_NAME.test(rec.plan))) return 'plan is not a plan name';
  if (rec.ev === 'error') return REASONS.includes(rec.reason) ? null : 'reason is not allowed';
  if (typeof rec.patterns !== 'string' || !HASH.test(rec.patterns)) return 'patterns must be 12 lowercase hex';
  for (const key of ['findings', 'decided']) if (!intIn(rec[key])) return `${key} must be an integer 0 to 10000`;
  return null;
}

// Fail-loud parse of the whole record. Returns { view, scanFindings } where scanFindings is null before any scan.
function parseRecord(root, slug) {
  checkSlugForRead(slug);
  const dir = runDir(root, slug);
  const none = { view: { v: 1, slug, state: 'none' }, scanFindings: null };
  if (dir === null) return none;
  const fail = (line, reason) => new PlanCheckRecordError(slug, line, reason);
  if (dir === 'unsafe') throw fail(0, 'run folder is a link or not a folder');
  const file = path.join(dir, 'plan-check.jsonl');
  const st = lstatOrNull(file);
  if (!st) return none;
  if (!st.isFile()) throw fail(0, 'record is a link or not a file');
  if (st.size > MAX_RECORD_BYTES) throw fail(0, 'file over 64 KiB');
  const bytes = fs.readFileSync(file);
  if (bytes.length > MAX_RECORD_BYTES) throw fail(0, 'file over 64 KiB');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw fail(0, 'not valid UTF-8');
  }
  if (text === '') throw fail(0, 'file is empty');
  const lines = text.split('\n');
  const endsWithLf = lines.at(-1) === '';
  if (endsWithLf) lines.pop();
  if (lines.length > MAX_RECORD_LINES) throw fail(0, 'file over 1000 lines');
  if (!endsWithLf) throw fail(lines.length, 'no line feed at the end');
  let last = null;
  let scans = 0;
  let waved = 0;
  let scanFindings = null;
  lines.forEach((line, index) => {
    const n = index + 1;
    if (line === '') throw fail(n, 'blank line');
    if (line.includes('\r')) throw fail(n, 'carriage return');
    if (Buffer.byteLength(line) > MAX_RECORD_LINE_BYTES) throw fail(n, 'line over 256 bytes');
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      throw fail(n, 'not valid JSON');
    }
    const problem = recordProblem(rec, scanFindings);
    if (problem) throw fail(n, problem);
    if (rec.ev === 'wave') {
      waved = rec.waved;
      return;
    }
    last = rec;
    if (rec.ev === 'scan') {
      scans++;
      waved = 0;
      scanFindings = rec.findings;
    }
  });
  if (!last) throw fail(0, 'no scan, off or error record');
  const state = last.ev === 'scan' ? 'on' : last.ev;
  const view = {
    v: 1, slug, state, policy: last.policy, plan: last.plan ?? null, patterns: last.patterns ?? null,
    findings: last.findings ?? null, decided: last.decided ?? null, waved, scans
  };
  return { view, scanFindings };
}

function checkSlugForRead(slug) {
  if (typeof slug !== 'string' || !isWorkFolder(slug)) throw new TypeError('plan-check: bad slug');
}

export function readRecord(root, slug) {
  return parseRecord(root, slug).view;
}

function utc(now) {
  if (!Number.isFinite(now)) throw new Refusal('clock is not a time');
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Appends one record. The existing record is read first, so a broken file is never extended.
function appendRecord(root, slug, rec) {
  const dir = runDir(root, slug);
  if (dir === null) throw new Refusal('run folder missing');
  if (dir === 'unsafe') throw new Refusal('run folder is a link');
  try {
    parseRecord(root, slug);
  } catch (error) {
    if (error instanceof PlanCheckRecordError) throw new Refusal(error.message);
    throw error;
  }
  const line = `${JSON.stringify(rec)}\n`;
  if (Buffer.byteLength(line) > MAX_RECORD_LINE_BYTES + 1) throw new Refusal('record line too long');
  const file = path.join(dir, 'plan-check.jsonl');
  const st = lstatOrNull(file);
  if (st) {
    if (!st.isFile()) throw new Refusal('record is a link');
    if (st.size + Buffer.byteLength(line) > MAX_RECORD_BYTES) throw new Refusal('record over 64 KiB');
    const count = fs.readFileSync(file, 'utf8').split('\n').length - 1;
    if (count + 1 > MAX_RECORD_LINES) throw new Refusal('record over 1000 lines');
  }
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = fs.openSync(file, flags, 0o644);
    fs.writeSync(fd, line);
  } catch {
    throw new Refusal('record cannot be written');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------- plan file

class PlanProblem extends Error {
  constructor(reason, detail) {
    super(detail);
    this.reason = reason;
  }
}

function readPlan(root, slug, name) {
  const dir = runDir(root, slug);
  const file = path.join(dir, name);
  const st = lstatOrNull(file);
  if (!st) throw new PlanProblem('plan-missing', `${name} not found`);
  if (!st.isFile()) throw new PlanProblem('plan-unreadable', `${name} is not a regular file`);
  if (st.size > MAX_PLAN_BYTES) throw new PlanProblem('plan-too-large', `${name} is over 256 KiB`);
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    throw new PlanProblem('plan-unreadable', `${name} cannot be read`);
  }
  if (bytes.length > MAX_PLAN_BYTES) throw new PlanProblem('plan-too-large', `${name} is over 256 KiB`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PlanProblem('plan-unreadable', `${name} is not valid UTF-8`);
  }
}

// ---------------------------------------------------------------- CLI

function takeFlags(args, spec) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a === 'string' && a.startsWith('--')) {
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

function countLine(policy, count, decided) {
  return `plan-check (${policy}): ${count} open decision${count === 1 ? '' : 's'}, ${decided} decided`;
}

function cmdGate(args, env) {
  const { positional, flags } = takeFlags(args, { '--policy': 'value', '--json': 'bool' });
  if (positional.length !== 2 || !Object.hasOwn(flags, '--policy')) throw new Refusal(USAGE);
  const [slug, name] = positional;
  checkSlug(slug, env.root, typeof name === 'string' && PLAN_NAME.test(name) ? name : undefined);
  const policy = flags['--policy'];
  if (!POLICIES.includes(policy)) throw new Refusal('policy must be warn or block');
  const dir = runDir(env.root, slug);
  if (dir === null) throw new Refusal('run folder missing');
  if (dir === 'unsafe') throw new Refusal('run folder is a link');
  const at = utc(env.now);
  const nameOk = typeof name === 'string' && PLAN_NAME.test(name);
  const failWith = (reason, detail) => {
    const rec = { v: 1, at, ev: 'error', policy, ...(nameOk ? { plan: name } : {}), reason };
    appendRecord(env.root, slug, rec);
    return { code: 1, lines: [`plan-check (${policy}): error ${reason}: ${detail}`] };
  };
  if (!nameOk) return failWith('plan-name', 'the plan file name is not allowed');
  let loaded;
  try {
    loaded = loadPatterns(env.patternFile);
  } catch (error) {
    if (error instanceof PatternError) return failWith('patterns', error.message);
    throw error;
  }
  let text;
  try {
    text = readPlan(env.root, slug, name);
  } catch (error) {
    if (error instanceof PlanProblem) return failWith(error.reason, error.message);
    throw error;
  }
  const { findings, decided } = scanText(text, loaded.patterns, { file: name });
  appendRecord(env.root, slug, {
    v: 1, at, ev: 'scan', policy, plan: name, patterns: loaded.hash,
    findings: Math.min(findings.length, MAX_COUNT), decided: Math.min(decided, MAX_COUNT)
  });
  const code = policy === 'block' && findings.length > 0 ? 2 : 0;
  if (flags['--json']) {
    return { code, lines: [JSON.stringify({ v: 1, policy, count: findings.length, decided, findings })] };
  }
  const lines = [countLine(policy, findings.length, decided)];
  for (const f of findings.slice(0, MAX_ROWS)) lines.push(`${f.file}:${f.line} | ${f.phrase} | ${f.why}`);
  if (findings.length > MAX_ROWS) lines.push(`+${findings.length - MAX_ROWS} more`);
  return { code, lines };
}

function cmdOff(args, env) {
  if (args.length !== 1) throw new Refusal(USAGE);
  checkSlug(args[0], env.root);
  appendRecord(env.root, args[0], { v: 1, at: utc(env.now), ev: 'off', policy: 'off' });
  return { code: 0, lines: ['plan-check: off'] };
}

function cmdWave(args, env) {
  if (args.length !== 2) throw new Refusal(USAGE);
  const [slug, count] = args;
  checkSlug(slug, env.root);
  if (typeof count !== 'string' || !WAVE_COUNT.test(count)) throw new Refusal('count must be a whole number');
  const n = Number(count);
  let scanFindings;
  try {
    scanFindings = parseRecord(env.root, slug).scanFindings;
  } catch (error) {
    if (error instanceof PlanCheckRecordError) throw new Refusal(error.message);
    throw error;
  }
  if (scanFindings === null) throw new Refusal('no scan record for this run');
  if (n > scanFindings) throw new Refusal('count is above the findings of the latest scan');
  appendRecord(env.root, slug, { v: 1, at: utc(env.now), ev: 'wave', waved: n });
  return { code: 0, lines: [`plan-check: waved ${n} of ${scanFindings}`] };
}

function cmdRead(args, env) {
  if (args.length !== 1) throw new Refusal(USAGE);
  checkSlug(args[0], env.root);
  try {
    return { code: 0, lines: [JSON.stringify(readRecord(env.root, args[0]))] };
  } catch (error) {
    if (error instanceof PlanCheckRecordError) return { code: 1, lines: [error.message] };
    throw error;
  }
}

// ---------------------------------------------------------------- verify

// A plan entry the check can trust: a regular file with one hard link, opened without following a link,
// the same file that was inspected, within the cap, valid UTF-8. Anything else is an error, never a skip.
function readPlanStrict(dir, name) {
  const file = path.join(dir, name);
  const st = lstatOrNull(file);
  if (!st || !st.isFile() || st.nlink !== 1) throw new PlanProblem('unreadable', `${name} is not a plain file`);
  if (st.size > MAX_PLAN_BYTES) throw new PlanProblem('too large', `${name} is over 256 KiB`);
  let bytes;
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== st.dev || opened.ino !== st.ino) {
      throw new Error('file changed');
    }
    const buf = Buffer.alloc(Math.min(opened.size, MAX_PLAN_BYTES + 1));
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    bytes = buf.subarray(0, off);
  } catch {
    throw new PlanProblem('unreadable', `${name} cannot be read`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  if (bytes.length > MAX_PLAN_BYTES) throw new PlanProblem('too large', `${name} is over 256 KiB`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PlanProblem('unreadable', `${name} is not valid UTF-8`);
  }
}

function planEntries(dir, plan) {
  if (plan !== undefined) {
    if (typeof plan !== 'string' || !PLAN_NAME.test(plan)) throw new PlanProblem('unreadable', 'the plan file name is not allowed');
    return [plan];
  }
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    throw new PlanProblem('unreadable', 'the run folder cannot be read');
  }
  // A name that matches the plan pattern only when case is ignored is an alias on a case-folding file system.
  const CI = new RegExp(PLAN_NAME.source, 'i');
  if (names.some((n) => CI.test(n) && !PLAN_NAME.test(n))) throw new PlanProblem('unreadable', 'a plan file name differs only in case');
  const found = names.filter((n) => PLAN_NAME.test(n)).sort();
  if (found.length === 0) throw new PlanProblem('no plan', 'no plan file in the run folder');
  if (found.length > MAX_PLANS) throw new PlanProblem('too large', 'more than 50 plan files');
  return found;
}

// Scans the plan files itself and reads no record. Returns the result plus the decided count.
function scanPlans({ root, home, slug, plan }) {
  if (typeof slug !== 'string' || !isWorkFolder(slug)) throw new TypeError('plan-check: bad slug');
  // Settings load only here, so gate, off, wave and read need nothing beyond this script.
  const { resolveSettings } = createRequire(import.meta.url)('./settings.mjs');
  const policy = resolveSettings({ home, cwd: root }).plan_check.policy;
  const outcome = (state, extra = {}) => ({ v: 1, policy, state, count: 0, plan: null, decided: 0, ...extra });
  const failed = (reason) => outcome('error', { reason });
  const dir = runDir(root, slug);
  if (dir === null) return failed('no plan');
  if (dir === 'unsafe') return failed('unreadable');
  let patterns;
  try {
    patterns = loadPatterns().patterns;
  } catch (error) {
    if (error instanceof PatternError) return failed('patterns');
    throw error;
  }
  let count = 0;
  let decidedTotal = 0;
  let firstOpen = null;
  let problem = null;
  let names;
  try {
    names = planEntries(dir, plan);
  } catch (error) {
    if (error instanceof PlanProblem) return failed(error.reason);
    throw error;
  }
  for (const name of names) {
    let text;
    try {
      text = readPlanStrict(dir, name);
    } catch (error) {
      if (!(error instanceof PlanProblem)) throw error;
      problem ??= error.reason;
      continue;
    }
    const { findings, decided } = scanText(text, patterns, { file: name });
    count += findings.length;
    decidedTotal += decided;
    if (findings.length > 0) firstOpen ??= name;
  }
  if (problem) return failed(problem);
  return outcome(count > 0 ? 'open' : 'pass', { count: Math.min(count, MAX_COUNT), plan: firstOpen, decided: decidedTotal });
}

// The plan Gate check: every plan file in the run folder (or the named one) against the own pattern file.
export function verifyPlans(args) {
  const { decided, ...result } = scanPlans(args);
  return result;
}

function cmdVerify(args, env) {
  const { positional, flags } = takeFlags(args, { '--json': 'bool' });
  if (positional.length < 1 || positional.length > 2) throw new Refusal(USAGE);
  const [slug, plan] = positional;
  checkSlug(slug, env.root, typeof plan === 'string' && PLAN_NAME.test(plan) ? plan : undefined);
  let full;
  try {
    full = scanPlans({ root: env.root, home: env.home, slug, plan });
  } catch {
    full = { v: 1, policy: 'block', state: 'error', count: 0, plan: null, decided: 0, reason: 'unreadable' };
  }
  const { decided, ...result } = full;
  const code = full.state === 'error' ? 1 : full.policy === 'block' && full.state === 'open' ? 2 : 0;
  if (flags['--json']) return { code, lines: [JSON.stringify(result)] };
  if (full.state === 'error') return { code, lines: [`plan-check (${full.policy}): error ${full.reason}`] };
  return { code, lines: [countLine(full.policy, full.count, decided)] };
}

// `now` (epoch ms) and `root` (the product root) are for callers that inject them; `patternFile` is for tests.
export function main(args, { now, root, patternFile, home } = {}) {
  const env = {
    root: typeof root === 'string' && root !== '' ? root : process.cwd(),
    now: typeof now === 'number' ? now : Date.now(),
    patternFile,
    home: typeof home === 'string' && home !== '' ? home : undefined
  };
  const handlers = { gate: cmdGate, off: cmdOff, wave: cmdWave, read: cmdRead, verify: cmdVerify };
  try {
    const [command, ...rest] = Array.isArray(args) ? args : [];
    if (typeof command !== 'string' || !Object.hasOwn(handlers, command)) throw new Refusal(USAGE);
    return handlers[command](rest, env);
  } catch (error) {
    if (error instanceof Refusal) return { code: 3, lines: [`refused: ${error.message}`] };
    throw error;
  }
}

// A script started through a symlinked folder (macOS /var -> /private/var) has argv[1] unresolved while import.meta.url is the real path.
function isMainReal() {
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
}

if (process.argv[1] && (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href || isMainReal())) {
  const { code, lines } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
