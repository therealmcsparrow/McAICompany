#!/usr/bin/env node
// Records a run's wave, Gates and end (run-state v1.1) and prints the run view.
// Counts, enums and times only. The Step files are LLM-written, so they are size-capped, never followed through a
// symlink, and read with the handoff-lint parser.
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from './handoff-lint.mjs';

export const MAX_FILE = 64 * 1024;
export const MAX_LINE = 256;
export const MAX_LINES = 1000;
const MAX_STEPS = 200;
const MAX_FOLDERS = 200;
const MAX_FM = 8 * 1024;
const STALE_MS = 12 * 60 * 60 * 1000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const STEP_FILE_RE = /^\d{2}-[a-z0-9-]+\.md$/;
const STEP_RE = /^\d{1,3}$/;
const ROLE_RE = /^[a-z][a-z0-9-]{0,40}$/;
const WAVE_RE = /^[1-9]\d?$/;
const GATES = new Set(['brief', 'plan', 'ship']);
const RESULTS = new Set(['passed', 'changed', 'stopped']);
const PICKS = new Set(['use', 'edit', 'keep', 'stop']);
const ASKED_RE = /^[0-3]$/;
const OUTCOMES = new Set(['ship', 'abort']);
const STATUSES = new Set(['done', 'blocked', 'needs-ceo', 'handover']);
export const TRIAGE_TTL_MS = 30 * 60 * 1000;
const HEX64_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const TRIAGE_LINE_RE = / \(triage: XS, risk low, (feature|bug|refactor|launch|audit|incident|upkeep|content|research), route direct\)$/;
const TIER_RANK = { low: 1, medium: 2, high: 3 };
// Allowed keys per event, beyond `v`, `at` and `ev`.
const EXTRA = { start: [], wave: ['wave'], gate: ['gate', 'result'], pick: ['pick', 'asked'], end: ['outcome'] };

const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const lstatOrNull = p => { try { return lstatSync(p); } catch { return null; } };

class Refusal extends Error {}
const refuse = reason => { throw new Refusal(reason); };

function paths(root, slug) {
  const dir = join(root, '.company', 'work', slug);
  return { dir, file: join(dir, 'run-state.jsonl') };
}

function readCapped(file, max) {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const size = fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(size, max));
    let off = 0;
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return buf.subarray(0, off);
  } finally { closeSync(fd); }
}

function validRecord(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
  const keys = Object.keys(o);
  if (o.v !== 1 || typeof o.at !== 'string' || !AT_RE.test(o.at)) return false;
  if (typeof o.ev !== 'string' || !Object.hasOwn(EXTRA, o.ev)) return false;
  const allowed = new Set(['v', 'at', 'ev', ...EXTRA[o.ev]]);
  if (keys.length !== allowed.size || !keys.every(k => allowed.has(k))) return false;
  if (o.ev === 'wave') return Number.isInteger(o.wave) && o.wave >= 1 && o.wave <= 99;
  if (o.ev === 'gate') return typeof o.gate === 'string' && GATES.has(o.gate) && typeof o.result === 'string' && RESULTS.has(o.result);
  if (o.ev === 'pick') return typeof o.pick === 'string' && PICKS.has(o.pick) && Number.isInteger(o.asked) && o.asked >= 0 && o.asked <= 3;
  if (o.ev === 'end') return typeof o.outcome === 'string' && OUTCOMES.has(o.outcome);
  return true;
}

// Reads the record file. Returns { records, warnings, unreadable, lines }.
function readRecords(file) {
  const out = { records: [], warnings: [], unreadable: false, lines: 0 };
  const st = lstatOrNull(file);
  if (!st) return out;
  if (!st.isFile() || st.size > MAX_FILE) { out.unreadable = true; return out; }
  let buf;
  try { buf = readCapped(file, MAX_FILE); } catch { out.unreadable = true; return out; }
  const lines = buf.toString('utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  out.lines = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const line = lines[i];
    if (n > MAX_LINES) { out.warnings.push(`line ${n} skipped`); continue; }
    if (line.includes('\r') || Buffer.byteLength(line, 'utf8') > MAX_LINE) { out.warnings.push(`line ${n} skipped`); continue; }
    let o;
    try { o = JSON.parse(line); } catch { out.warnings.push(`line ${n} skipped`); continue; }
    if (!validRecord(o)) { out.warnings.push(`line ${n} skipped`); continue; }
    out.records.push(o);
  }
  return out;
}

// The last segment starts at the last `start` record.
function lastSegment(records) {
  let from = -1;
  for (let i = 0; i < records.length; i++) if (records[i].ev === 'start') from = i;
  return from < 0 ? [] : records.slice(from);
}

const segmentOpen = seg => seg.length > 0 && !seg.some(r => r.ev === 'end');

function readSteps(dir, warnings) {
  const steps = [];
  let names;
  try { names = readdirSync(dir); } catch { return steps; }
  names = names.filter(n => STEP_FILE_RE.test(n)).sort();
  if (names.length > MAX_STEPS) { warnings.push(`only ${MAX_STEPS} Step files read`); names = names.slice(0, MAX_STEPS); }
  for (const name of names) {
    const file = join(dir, name);
    const st = lstatOrNull(file);
    if (!st || !st.isFile()) { warnings.push(`${name} skipped`); continue; }
    let text;
    try { text = readCapped(file, MAX_FM).toString('utf8'); } catch { warnings.push(`${name} skipped`); continue; }
    const lines = text.split(/\r?\n/);
    const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
    if (end < 0) { warnings.push(`${name} skipped`); continue; }
    // Only the frontmatter goes to the parser; headings are not this script's business.
    const fmText = lines.slice(0, end + 1).join('\n');
    const { errors, routing } = lint(fmText);
    if (!routing || errors.some(e => e === 'frontmatter: missing step' || e === 'frontmatter: missing role')) {
      warnings.push(`${name} skipped`); continue;
    }
    const step = /^step:[ \t]*(\S{1,10})/m.exec(fmText)?.[1];
    const role = /^role:[ \t]*(\S{1,60})/m.exec(fmText)?.[1];
    if (!step || !role || !STEP_RE.test(step) || !ROLE_RE.test(role)) { warnings.push(`${name} skipped`); continue; }
    steps.push({
      step,
      role,
      status: STATUSES.has(routing.status) ? routing.status : 'unknown',
      round: /^\d{1,2}$/.test(routing.round ?? '') ? Number(routing.round) : 'unknown',
      tier: Object.hasOwn(TIER_RANK, routing['risk-tier']) ? routing['risk-tier'] : 'unknown',
      file: name,
      mtime: iso(st.mtimeMs),
    });
  }
  return steps;
}

function load(root, slug, now) {
  const { dir, file } = paths(root, slug);
  const view = {
    v: 1, slug, state: 'none', started: null, ended: null, outcome: null, wave: null, gates: [], picks: [],
    round: 0, tier: 'unknown', steps: [], warnings: [],
  };
  const dst = lstatOrNull(dir);
  if (dst && (!dst.isDirectory())) { view.warnings.push('run-state unreadable'); return { view, activity: 0 }; }
  const rec = readRecords(file);
  view.warnings.push(...rec.warnings);
  if (rec.unreadable) view.warnings.push('run-state unreadable');
  const steps = dst ? readSteps(dir, view.warnings) : [];
  let newestStep = 0;
  let round = 0;
  let tierRank = 0;
  for (const s of steps) {
    newestStep = Math.max(newestStep, Date.parse(s.mtime));
    if (typeof s.round === 'number') round = Math.max(round, s.round);
    tierRank = Math.max(tierRank, TIER_RANK[s.tier] ?? 0);
  }
  view.steps = steps.map(({ tier, ...s }) => s);
  view.round = round;
  view.tier = ['unknown', 'low', 'medium', 'high'][tierRank];
  const seg = rec.unreadable ? [] : lastSegment(rec.records);
  let activity = 0;
  if (seg.length > 0) {
    activity = Math.max(Date.parse(seg[seg.length - 1].at), newestStep);
    view.started = seg[0].at;
    for (const r of seg) {
      if (r.ev === 'wave') view.wave = r.wave;
      else if (r.ev === 'gate') view.gates.push({ gate: r.gate, result: r.result, at: r.at });
      else if (r.ev === 'pick') view.picks.push({ pick: r.pick, asked: r.asked, at: r.at });
      else if (r.ev === 'end') { view.ended = r.at; view.outcome = r.outcome; }
    }
    if (!segmentOpen(seg)) view.state = 'ended';
    else view.state = now - activity > STALE_MS ? 'stale' : 'running';
  }
  return { view, activity };
}

export function show(root, slug, { now = Date.now() } = {}) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) refuse('bad slug');
  return load(root, slug, now).view;
}

export function active(root, { now = Date.now() } = {}) {
  const work = join(root, '.company', 'work');
  const wst = lstatOrNull(work);
  let best = null;
  if (wst && wst.isDirectory()) {
    let names;
    try { names = readdirSync(work).filter(n => SLUG_RE.test(n)).sort(); } catch { names = []; }
    for (const slug of names.slice(0, MAX_FOLDERS)) {
      const f = lstatOrNull(join(work, slug, 'run-state.jsonl'));
      if (!f || !f.isFile()) continue;
      const { view, activity } = load(root, slug, now);
      if (view.state !== 'running') continue;
      if (!best || activity > best.activity) best = { slug, view, activity };
    }
  }
  return best ? { slug: best.slug, view: best.view } : { slug: null, view: null };
}

// Validates, checks the open segment and limits, then appends one line. Returns the record written.
export function append(root, slug, fields, { now = Date.now() } = {}) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) refuse('bad slug');
  const { dir, file } = paths(root, slug);
  const dst = lstatOrNull(dir);
  if (dst && !dst.isDirectory()) refuse('run folder is not a directory');
  const fst = lstatOrNull(file);
  if (fst && !fst.isFile()) refuse('run-state is not a regular file');
  if (fst && fst.size > MAX_FILE) refuse('run-state unreadable');
  const rec = fst ? readRecords(file) : { records: [], lines: 0, unreadable: false };
  if (rec.unreadable) refuse('run-state unreadable');
  const open = segmentOpen(lastSegment(rec.records));
  if (fields.ev === 'start') {
    if (open) refuse(`run ${slug} already started`);
  } else if (!open) refuse(`no open run for ${slug}`);
  if ('v' in fields || 'at' in fields) refuse('bad record');
  const record = { v: 1, at: iso(now), ...fields };
  if (!validRecord(record)) refuse('bad record');
  const line = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE) refuse('record too long');
  if (rec.lines >= MAX_LINES) refuse('run-state is full (1000 lines)');
  const size = fst ? fst.size : 0;
  if (size + Buffer.byteLength(line, 'utf8') > MAX_FILE) refuse('run-state is full (64 KiB)');
  if (!dst) mkdirSync(dir, { recursive: true });
  const fd = openSync(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o644);
  try {
    // A last line without a newline would glue to the new one.
    const prefix = size > 0 && !endsWithNewline(file, size) ? '\n' : '';
    writeSync(fd, prefix + line);
  } finally { closeSync(fd); }
  return record;
}

function endsWithNewline(file, size) {
  const fd = openSync(file, constants.O_RDONLY);
  try {
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, size - 1);
    return b[0] === 0x0a;
  } finally { closeSync(fd); }
}

const sha = text => createHash('sha256').update(text).digest('hex');
// NFC, any line ending to LF, trailing spaces and tabs off each line, then both ends trimmed.
const normalizeRequest = text => text.normalize('NFC').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').trim();

function validTriageRecord(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
  if (o.v !== 1 || typeof o.at !== 'string' || !AT_RE.test(o.at) || typeof o.k !== 'string' || !HEX64_RE.test(o.k)) return false;
  const keys = Object.keys(o);
  if (o.ev === 'issue') return keys.length === 5 && typeof o.h === 'string' && HEX64_RE.test(o.h);
  if (o.ev === 'used') return keys.length === 4;
  return false;
}

// Makes sure .company/triage is a plain folder that ignores itself. Returns the folder path.
function triageFolder(root) {
  const company = join(root, '.company');
  const dir = join(company, 'triage');
  for (const p of [company, dir]) {
    const st = lstatOrNull(p);
    if (st && !st.isDirectory()) refuse('triage folder is a link');
  }
  mkdirSync(dir, { recursive: true });
  const ig = join(dir, '.gitignore');
  const ist = lstatOrNull(ig);
  if (ist && !ist.isFile()) refuse('triage folder is a link');
  let same = false;
  if (ist) {
    try { same = readCapped(ig, 16).toString('utf8') === '*\n'; } catch { refuse('triage folder is a link'); }
  }
  if (!same) writeFileSync(ig, '*\n', { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0) });
  return dir;
}

// Reads and always deletes request.txt. Returns the text, or null when missing or unreadable.
function takeRequest(dir) {
  const file = join(dir, 'request.txt');
  const st = lstatOrNull(file);
  if (!st) return null;
  try {
    if (!st.isFile() || st.size > MAX_FILE) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(readCapped(file, MAX_FILE));
  } catch { return null; } finally {
    try { unlinkSync(file); } catch { /* already gone */ }
  }
}

// Returns the valid records of records.jsonl; a link or an oversize file is refused.
function readTriageRecords(file) {
  const st = lstatOrNull(file);
  if (!st) return { records: [], raw: '' };
  if (!st.isFile() || st.size > MAX_FILE) refuse('triage record unreadable');
  let raw;
  try { raw = readCapped(file, MAX_FILE).toString('utf8'); } catch { refuse('triage record unreadable'); }
  const records = [];
  for (const line of raw.split('\n')) {
    if (line === '' || line.includes('\r') || Buffer.byteLength(line, 'utf8') > MAX_LINE || records.length >= MAX_LINES) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (validTriageRecord(o)) records.push(o);
  }
  return { records, raw };
}

// Drops expired issues, orphan used lines and bad lines. Rewrites through a temp file when the content changes.
function pruneTriage(dir, file, recs, raw, now) {
  const live = new Set(recs.filter(r => r.ev === 'issue' && now - Date.parse(r.at) <= TRIAGE_TTL_MS).map(r => r.k));
  const kept = recs.filter(r => live.has(r.k));
  const text = kept.map(r => `${JSON.stringify(r)}\n`).join('');
  if (text !== raw) {
    const tmp = join(dir, `records.${randomBytes(6).toString('hex')}.tmp`);
    writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 });
    try { renameSync(tmp, file); } catch (e) {
      try { unlinkSync(tmp); } catch { /* ignore */ }
      throw e;
    }
  }
  return { count: kept.length, size: Buffer.byteLength(text, 'utf8') };
}

function appendTriage(file, kept, record, now) {
  const line = `${JSON.stringify({ v: 1, at: iso(now), ...record })}\n`;
  if (kept.count >= MAX_LINES || kept.size + Buffer.byteLength(line, 'utf8') > MAX_FILE) refuse('triage record full');
  const fd = openSync(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { writeSync(fd, line); } finally { closeSync(fd); }
}

// `issue` records an approved direct-route request; `check` spends that record once. Returns the JSON text to print.
export function triage(root, args, { now = Date.now() } = {}) {
  const isCheck = args[0] === 'check';
  if (!(args[0] === 'issue' && args.length === 1) && !(isCheck && args.length === 2)) refuse(usage());
  if (isCheck && !NONCE_RE.test(args[1])) refuse('bad nonce');
  const dir = triageFolder(root);
  const request = takeRequest(dir);
  const normalized = request === null ? null : normalizeRequest(request);
  const match = normalized === null ? null : TRIAGE_LINE_RE.exec(normalized);
  if (!isCheck) {
    if (request === null) refuse('no request');
    if (!match) refuse('no direct triage line');
  }
  const file = join(dir, 'records.jsonl');
  const { records, raw } = readTriageRecords(file);
  const k = isCheck ? sha(args[1]) : null;
  let reason = null;
  if (isCheck) {
    const issue = records.find(r => r.ev === 'issue' && r.k === k);
    const age = issue ? now - Date.parse(issue.at) : 0;
    if (request === null) reason = 'no request';
    else if (!match) reason = 'no triage line';
    else if (!issue) reason = 'no record';
    else if (records.some(r => r.ev === 'used' && r.k === k)) reason = 'used';
    else if (age < 0 || age > TRIAGE_TTL_MS) reason = 'expired';
    else if (issue.h !== sha(normalized)) reason = 'request changed';
  }
  const kept = pruneTriage(dir, file, records, raw, now);
  if (!isCheck) {
    const nonce = randomBytes(16).toString('hex');
    appendTriage(file, kept, { ev: 'issue', h: sha(normalized), k: sha(nonce) }, now);
    return JSON.stringify({ nonce, type: match[1] });
  }
  if (reason) return JSON.stringify({ trusted: false, reason });
  appendTriage(file, kept, { ev: 'used', k }, now);
  return JSON.stringify({ trusted: true, type: match[1] });
}

function usage() {
  return 'usage: start <slug> | wave <slug> <n> | gate <slug> <brief|plan|ship> <passed|changed|stopped> | pick <slug> <use|edit|keep|stop> <asked> | end <slug> <ship|abort> | show <slug> --json | active --json | triage issue | triage check <nonce>';
}

// Returns { out, code }.
export function run(argv, { root = process.cwd(), now = Date.now() } = {}) {
  const [cmd, ...rest] = argv;
  const opts = { now };
  try {
    switch (cmd) {
      case 'start':
        if (rest.length !== 1) refuse(usage());
        append(root, rest[0], { ev: 'start' }, opts);
        return { out: `ok: start ${rest[0]}`, code: 0 };
      case 'wave':
        if (rest.length !== 2) refuse(usage());
        if (!WAVE_RE.test(rest[1])) refuse('wave must be a number from 1 to 99');
        append(root, rest[0], { ev: 'wave', wave: Number(rest[1]) }, opts);
        return { out: `ok: wave ${rest[1]}`, code: 0 };
      case 'gate':
        if (rest.length !== 3) refuse(usage());
        if (!GATES.has(rest[1])) refuse('gate must be brief, plan or ship');
        if (!RESULTS.has(rest[2])) refuse('result must be passed, changed or stopped');
        append(root, rest[0], { ev: 'gate', gate: rest[1], result: rest[2] }, opts);
        return { out: `ok: gate ${rest[1]} ${rest[2]}`, code: 0 };
      case 'pick':
        if (rest.length !== 3) refuse(usage());
        if (!PICKS.has(rest[1])) refuse('pick must be use, edit, keep or stop');
        if (!ASKED_RE.test(rest[2])) refuse('asked must be 0 to 3');
        append(root, rest[0], { ev: 'pick', pick: rest[1], asked: Number(rest[2]) }, opts);
        return { out: `ok: pick ${rest[1]} ${rest[2]}`, code: 0 };
      case 'end':
        if (rest.length !== 2) refuse(usage());
        if (!OUTCOMES.has(rest[1])) refuse('outcome must be ship or abort');
        append(root, rest[0], { ev: 'end', outcome: rest[1] }, opts);
        return { out: `ok: end ${rest[1]}`, code: 0 };
      case 'show':
        if (rest.length !== 2 || rest[1] !== '--json') refuse(usage());
        return { out: JSON.stringify(show(root, rest[0], opts)), code: 0 };
      case 'active':
        if (rest.length !== 1 || rest[0] !== '--json') refuse(usage());
        return { out: JSON.stringify(active(root, opts)), code: 0 };
      case 'triage':
        return { out: triage(root, rest, opts), code: 0 };
      default:
        refuse(usage());
    }
  } catch (e) {
    if (e instanceof Refusal) return { out: `refused: ${e.message}`, code: 2 };
    return { out: 'refused: run-state failed', code: 2 };
  }
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const { out, code } = run(process.argv.slice(2));
  process.stdout.write(`${out}\n`);
  process.exit(code);
}
