#!/usr/bin/env node
// Ticket approval record (contract: docs/contracts/ticket-approval.md v1.4). Node built-ins only.
// Run and helper folder names come only from ../mods/lib/work-folder.mjs.
// A ticket is one plan-tasks task block; an approval counts only for the block hash it was given at.
// Plan text and arguments are untrusted: files are read by the real-path rule, sizes are capped before decoding,
// every pattern is anchored and runs per line, output holds only fixed words, ids and validated record fields,
// and no text reaches a child process (none is started).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPlanLines } from './plan-markdown.mjs';
import { WorkFolderRefusal, exactWorkPath, helperName, isWorkFolder } from '../mods/lib/work-folder.mjs';

const KiB = 1024;
const MAX_PLAN_BYTES = 256 * KiB;
const MAX_PROJECT_BYTES = 256 * KiB;
const MAX_RECORD_BYTES = 1024 * KiB;
const MAX_RECORD_LINES = 5000;
const MAX_RECORD_LINE_BYTES = 8 * KiB;
const MAX_TICKETS = 100;
const MAX_ARG_CHARS = 4096;
const MAX_ITEMS = 40;
const MAX_PATH_CHARS = 200;
const MAX_CORE = 200;
const MAX_TITLE = 60;

const PLAN_NAME = /^(?:\d{2,3}-)?(?:architect-)?plan(?:-[a-z0-9]+)?\.md$/;
const TICKET_ID = /^T\d{1,3}[a-z]?$/;
const TASK_HEAD = /^(T\d{1,3}[a-z]?)(?=$|[\s:.)-])/;
const FIELD = /^\s{0,3}[-*]\s+(role|files|depends-on):[ \t]*(.*)$/;
const DECIDED_LINE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?Decided:/;
const BASE_LINE = /^Base commit: ([0-9a-f]{40,64})[ \t]*$/;
const PATH_SHAPE = /^[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*\/?$/;
const CORE_ENTRY = /^\s*[-*]\s+`?([A-Za-z0-9._@+/-]{1,200})`?[ \t]*:/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const HASH = /^[0-9a-f]{12}$/;
const FILE_NAME = /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2} - [A-Za-z0-9 -]{1,60}\.md$/;
const DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const CONTROLS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const FORMAT_CHARS = /\p{Cf}/gu;
const TASKS_TITLE = /^tasks(?:[ \t]+#+)?$/i;
const SECTIONS_ID = 'S0';
const ZERO = '000000000000';

const PICKS = ['approve', 'change', 'park'];
const EXTRA_KEYS = {
  plan: ['plan'],
  approve: ['id', 'hash'],
  change: ['id', 'hash'],
  park: ['id', 'hash'],
  parked: ['id', 'hash', 'file'],
  build: ['ids']
};
const BASE_KEYS = ['v', 'n', 'prev', 'at', 'ev'];

const USAGE = [
  'usage: ticket-approval tickets <slug> <plan> --phase d|f',
  '       ticket-approval ticket <slug> <id> approve|change|park',
  '       ticket-approval park-ticket <slug> <id>',
  '       ticket-approval build-plan <slug>',
  '       ticket-approval read <slug>'
].join('\n');

class Refusal extends Error {
  constructor(message, extra = []) {
    super(message);
    this.extra = extra;
  }
}
class PlanProblem extends Error {}
class RecordError extends Error {}

const sha12 = (data) => crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);

// ---------------------------------------------------------------- safe files

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

const isPlain = (st) => st.isFile() && st.nlink === 1;

// True when the real path of root/parts equals the real root joined with parts (no link on any segment).
function realMatches(root, parts) {
  const abs = path.join(root, ...parts);
  const real = fs.realpathSync.native(abs);
  return real === path.join(fs.realpathSync.native(root), ...parts);
}

// Reads root/parts as a plain file by the real-path rule. Returns null when it does not exist.
// Throws Error('unsafe'), Error('too-large') or Error('unreadable').
function readFileSafe(root, parts, max) {
  const abs = path.join(root, ...parts);
  let ok;
  try {
    ok = realMatches(root, parts);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw new Error('unreadable');
  }
  if (!ok) throw new Error('unsafe');
  let st;
  try {
    st = lstatOrNull(abs);
  } catch {
    throw new Error('unreadable');
  }
  if (!st) return null;
  if (!isPlain(st)) throw new Error('unsafe');
  if (st.size > max) throw new Error('too-large');
  let fd;
  try {
    fd = fs.openSync(abs, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const f = fs.fstatSync(fd);
    if (!isPlain(f) || f.dev !== st.dev || f.ino !== st.ino) throw new Error('unsafe');
    const buf = Buffer.alloc(Math.min(f.size, max + 1));
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    if (off > max) throw new Error('too-large');
    return { bytes: buf.subarray(0, off), stat: st };
  } catch (error) {
    if (['unsafe', 'too-large'].includes(error.message)) throw error;
    throw new Error('unreadable');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function decode(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// An existing directory root/parts that is not a link. With create, a missing last segment is made.
function ensureDir(root, parts, { create = false } = {}) {
  let dir = root;
  for (let i = 0; i < parts.length; i++) {
    dir = path.join(dir, parts[i]);
    const st = lstatOrNull(dir);
    if (!st) {
      if (!create || i < parts.length - 1) throw new Refusal('folder missing');
      try {
        fs.mkdirSync(dir);
      } catch (error) {
        if (error.code !== 'EEXIST') throw new Refusal('folder cannot be created');
      }
    } else if (!st.isDirectory()) {
      throw new Refusal('folder is a link or not a folder');
    }
  }
  let ok = false;
  try { ok = realMatches(root, parts); } catch { ok = false; }
  if (!ok) throw new Refusal('folder is a link or not a folder');
  return dir;
}

// Creates a new file inside dir; an existing file is refused, never opened for writing.
function createNew(dir, name, text) {
  let fd;
  try {
    fd = fs.openSync(path.join(dir, name), fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0), 0o644);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Refusal('file exists');
    throw new Refusal('file cannot be created');
  }
  try {
    fs.writeSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------- plan

function pathKey(item) {
  let p = stripTicks(item.trim()).replaceAll('\\', '/');
  if (p.length < 1 || p.length > MAX_PATH_CHARS || !PATH_SHAPE.test(p)) return null;
  if (p.endsWith('/')) p = p.slice(0, -1);
  for (const seg of p.split('/')) {
    if (seg === '.' || seg === '..' || seg.endsWith('.') || seg.endsWith(' ')) return null;
  }
  return p.toLowerCase();
}

function stripTicks(text) {
  return text.length >= 2 && text.startsWith('`') && text.endsWith('`') ? text.slice(1, -1) : text;
}

function keysOverlap(a, b) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

// Splits the plan into ticket blocks through plan-markdown's line reader. Throws PlanProblem.
function parsePlan(text) {
  const { lines, openFence } = readPlanLines(text);
  const heads = [];
  lines.forEach((entry, index) => {
    if (entry.kind === 'heading') heads.push(index);
  });
  const tickets = [];
  const seen = new Set();
  const inBlock = new Array(lines.length).fill(false);
  for (const index of heads) {
    const entry = lines[index];
    if (entry.level < 2 || entry.level > 4) continue;
    const head = TASK_HEAD.exec(entry.title.trim());
    if (!head) continue;
    if (tickets.length >= MAX_TICKETS) throw new PlanProblem('too many tickets');
    if (seen.has(head[1])) throw new PlanProblem(`repeated id ${head[1]}`);
    seen.add(head[1]);
    let end = lines.length;
    let fieldEnd = lines.length;
    for (const next of heads) {
      if (next <= index) continue;
      const h = lines[next];
      if (h.level <= entry.level) { end = next; if (fieldEnd > next) fieldEnd = next; break; }
      if (fieldEnd === lines.length && h.level >= 2 && h.level <= 4 && TASK_HEAD.test(h.title.trim())) fieldEnd = next;
    }
    const fields = new Map();
    for (let i = index + 1; i < fieldEnd; i++) {
      if (lines[i].kind !== 'text') continue;
      const field = FIELD.exec(lines[i].line);
      if (field && !fields.has(field[1])) fields.set(field[1], field[2].trim());
    }
    const block = lines.slice(index, end).map((l) => l.line.replace(/[ \t]+$/, ''));
    while (block.length > 1 && block[block.length - 1] === '') block.pop();
    for (let i = index; i < end; i++) inBlock[i] = true;
    const blockText = `${block.join('\n')}\n`;
    tickets.push({
      id: head[1],
      title: entry.title.trim().slice(head[1].length).replace(/^[\s:.)-]+/, ''),
      text: blockText,
      hash: sha12(blockText),
      fields,
      deps: depsOf(fields.get('depends-on'))
    });
  }
  if (tickets.length === 0) throw new PlanProblem('no tickets');
  let title = null;
  let base = null;
  const decided = [];
  const rest = [];
  lines.forEach((entry, i) => {
    if (inBlock[i]) return;
    if (entry.kind === 'heading' && entry.level === 1 && title === null) {
      title = entry.line.replace(CONTROLS, ' ').trim();
      return;
    }
    rest.push(entry);
    if (entry.kind !== 'text') return;
    const b = BASE_LINE.exec(entry.line);
    if (b && base === null) base = b[1];
    if (DECIDED_LINE.test(entry.line)) decided.push(entry.line.replace(/[ \t]+$/, ''));
  });
  const plan = { tickets, title: title ?? '# Build plan', base, decided, rest, openFence };
  const head = headLines(plan);
  const headText = `${head.join('\n')}\n`;
  plan.sections = { id: SECTIONS_ID, text: headText, hash: sha12(headText) };
  return plan;
}

// The source plan's text outside every ticket block, as data only. The Base commit and Decided lines
// are written once at the top, so they are dropped here. A heading is kept when its own text is not empty
// or when a deeper heading under it keeps text; a section left wholly empty is dropped. A heading titled
// Tasks is renamed so the build plan holds one `## Tasks`. Format characters (Cf, bidi) are removed.
function otherSections(rest) {
  const chunks = [{ head: null, entries: [] }];
  for (const entry of rest) {
    if (entry.kind === 'heading') chunks.push({ head: entry, entries: [] });
    chunks.at(-1).entries.push(entry);
  }
  for (const c of chunks) {
    c.kept = c.entries.filter((e) => !(e.kind === 'text' && (BASE_LINE.test(e.line) || DECIDED_LINE.test(e.line))));
    c.keep = c.kept.some((e) => e.kind !== 'heading' && e.line.trim() !== '');
  }
  for (let i = chunks.length - 1; i > 0; i--) {
    if (!chunks[i].keep) continue;
    let level = chunks[i].head.level;
    for (let j = i - 1; j > 0 && level > 1; j--) {
      if (chunks[j].head.level < level) { chunks[j].keep = true; level = chunks[j].head.level; }
    }
  }
  const out = [];
  for (const c of chunks) {
    if (!c.keep) continue;
    for (const e of c.kept) {
      const tasks = e.kind === 'heading' && TASKS_TITLE.test(e.title.trim());
      out.push((tasks ? `${'#'.repeat(e.level)} Tasks (source)` : e.line).replace(FORMAT_CHARS, ''));
    }
  }
  while (out.length && out[0].trim() === '') out.shift();
  while (out.length && out.at(-1).trim() === '') out.pop();
  return out;
}

// Everything the build plan holds before `## Tasks`: this text is what the sections item (S0) approves.
function headLines(plan) {
  const others = otherSections(plan.rest);
  const decided = plan.decided.map((l) => l.replace(FORMAT_CHARS, ''));
  return [plan.title, '', `Base commit: ${plan.base ?? 'none'}`, '', ...(decided.length ? [...decided, ''] : []), ...(others.length ? [...others, ''] : [])];
}

function depsOf(value) {
  if (value === undefined) return [];
  return value.split(',').map((s) => stripTicks(s.trim())).filter((s) => TICKET_ID.test(s));
}

function readPlan(root, ref) {
  const [slug, name] = ref.split('/');
  let file;
  try {
    file = readFileSafe(root, ['.company', 'work', slug, name], MAX_PLAN_BYTES);
  } catch (error) {
    throw new PlanProblem(error.message === 'too-large' ? 'too large' : 'unreadable');
  }
  if (!file) throw new PlanProblem('missing');
  let text;
  try {
    text = decode(file.bytes);
  } catch {
    throw new PlanProblem('unreadable');
  }
  return parsePlan(text);
}

// Core paths of .company/project.md (## Core section list lines). Missing or unsafe file: none.
function coreKeys(root) {
  let file;
  try {
    file = readFileSafe(root, ['.company', 'project.md'], MAX_PROJECT_BYTES);
  } catch {
    return [];
  }
  if (!file) return [];
  let text;
  try { text = decode(file.bytes); } catch { return []; }
  const keys = [];
  let inCore = false;
  for (const { line, kind } of readPlanLines(text).lines) {
    if (kind === 'heading') {
      inCore = /^##\s+Core\s*$/.test(line);
      continue;
    }
    if (!inCore || kind !== 'text' || keys.length >= MAX_CORE) continue;
    const m = CORE_ENTRY.exec(line);
    const key = m ? pathKey(m[1]) : null;
    if (key) keys.push(key);
  }
  return keys;
}

function flagsOf(ticket, core) {
  const raw = ticket.fields.get('files');
  const out = { core: false, contract: false };
  if (raw === undefined || raw === '') return out;
  for (const item of raw.split(',').slice(0, MAX_ITEMS)) {
    const key = pathKey(item);
    if (!key) continue;
    if (core.some((c) => keysOverlap(key, c))) out.core = true;
    if (key.startsWith('docs/contracts/')) out.contract = true;
  }
  return out;
}

// ---------------------------------------------------------------- record

function recordPath(slug) {
  return ['.company', 'work', slug, 'tickets.jsonl'];
}

function badLine(slug, n, reason) {
  return new RecordError(`ticket-approval: record ${slug} line ${n}: ${reason}`);
}

function checkEvent(slug, rec, n, prevText) {
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) throw badLine(slug, n, 'not an object');
  const ev = rec.ev;
  if (typeof ev !== 'string' || !Object.hasOwn(EXTRA_KEYS, ev)) throw badLine(slug, n, 'bad event');
  const want = [...BASE_KEYS, ...EXTRA_KEYS[ev]];
  const have = Object.keys(rec);
  if (have.length !== want.length || !want.every((k) => Object.hasOwn(rec, k))) throw badLine(slug, n, 'keys do not match the event');
  if (rec.v !== 1) throw badLine(slug, n, 'bad version');
  if (rec.n !== n) throw badLine(slug, n, 'bad number');
  if (rec.prev !== (prevText === null ? ZERO : sha12(prevText))) throw badLine(slug, n, 'chain broken');
  if (typeof rec.at !== 'string' || !TIME.test(rec.at) || Number.isNaN(Date.parse(rec.at))) throw badLine(slug, n, 'bad time');
  if (ev === 'plan' && !(typeof rec.plan === 'string' && validPlanRef(rec.plan))) throw badLine(slug, n, 'bad plan');
  if (ev !== 'plan' && ev !== 'build') {
    const sectionsOk = rec.id === SECTIONS_ID && (ev === 'approve' || ev === 'change');
    if (typeof rec.id !== 'string' || !(TICKET_ID.test(rec.id) || sectionsOk)) throw badLine(slug, n, 'bad id');
    if (typeof rec.hash !== 'string' || !HASH.test(rec.hash)) throw badLine(slug, n, 'bad hash');
  }
  if (ev === 'parked' && !(typeof rec.file === 'string' && FILE_NAME.test(rec.file))) throw badLine(slug, n, 'bad file');
  if (ev === 'build') {
    const ids = rec.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_TICKETS || new Set(ids).size !== ids.length
      || !ids.every((x) => typeof x === 'string' && TICKET_ID.test(x))) throw badLine(slug, n, 'bad ids');
  }
}

// Reads and checks the whole record. Returns { lines, events, stat } ; stat is null when there is no file.
function loadRecord(root, slug) {
  let file;
  try {
    file = readFileSafe(root, recordPath(slug), MAX_RECORD_BYTES);
  } catch (error) {
    throw new RecordError(`ticket-approval: record ${slug}: ${error.message}`);
  }
  if (!file) return { lines: [], events: [], stat: null };
  let text;
  try {
    text = decode(file.bytes);
  } catch {
    throw new RecordError(`ticket-approval: record ${slug}: not UTF-8`);
  }
  if (text === '') return { lines: [], events: [], stat: file.stat };
  const parts = text.split('\n');
  if (parts.pop() !== '') throw badLine(slug, parts.length + 1, 'no final newline');
  if (parts.length > MAX_RECORD_LINES) throw badLine(slug, MAX_RECORD_LINES + 1, 'too many lines');
  const events = [];
  parts.forEach((line, i) => {
    const n = i + 1;
    if (line === '' || line.includes('\r')) throw badLine(slug, n, 'blank line or CR');
    if (Buffer.byteLength(line) > MAX_RECORD_LINE_BYTES) throw badLine(slug, n, 'line too long');
    let rec;
    try { rec = JSON.parse(line); } catch { throw badLine(slug, n, 'not JSON'); }
    checkEvent(slug, rec, n, i === 0 ? null : parts[i - 1]);
    events.push(rec);
  });
  return { lines: parts, events, stat: file.stat };
}

function appendEvent(env, slug, rec, fields) {
  const at = new Date(env.now).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const last = rec.lines.at(-1);
  const line = JSON.stringify({ v: 1, n: rec.lines.length + 1, prev: last === undefined ? ZERO : sha12(last), at, ...fields });
  if (Buffer.byteLength(line) > MAX_RECORD_LINE_BYTES) throw new Refusal('record line too long');
  if (rec.lines.length >= MAX_RECORD_LINES) throw new Refusal('record is full');
  if (rec.lines.reduce((sum, l) => sum + Buffer.byteLength(l) + 1, 0) + Buffer.byteLength(line) + 1 > MAX_RECORD_BYTES) throw new Refusal('record is full');
  const abs = path.join(env.root, ...recordPath(slug));
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let fd;
  try {
    if (rec.stat) {
      fd = fs.openSync(abs, fs.constants.O_WRONLY | fs.constants.O_APPEND | noFollow);
      const f = fs.fstatSync(fd);
      if (!isPlain(f) || f.dev !== rec.stat.dev || f.ino !== rec.stat.ino) throw new Refusal('record changed');
    } else {
      fd = fs.openSync(abs, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_APPEND | noFollow, 0o644);
    }
    fs.writeSync(fd, `${line}\n`);
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw new Refusal('record cannot be written');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  const parsed = JSON.parse(line);
  rec.lines.push(line);
  rec.events.push(parsed);
  rec.stat ??= lstatOrNull(abs);
  return parsed;
}

const lastPlanRef = (rec) => rec.events.findLast((e) => e.ev === 'plan')?.plan ?? null;

// new | changed | approved | parked, by the last event of the id at the current block hash.
function statusOf(rec, ticket) {
  const mine = rec.events.filter((e) => e.id === ticket.id);
  const last = mine.findLast((e) => e.hash === ticket.hash);
  if (last?.ev === 'approve') return 'approved';
  if (last?.ev === 'parked') return 'parked';
  return mine.length === 0 ? 'new' : 'changed';
}

function dupCount(rec) {
  const counts = new Map();
  for (const e of rec.events) {
    if (e.ev !== 'approve') continue;
    const key = `${e.id} ${e.hash}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let dup = 0;
  for (const n of counts.values()) dup += n - 1;
  return dup;
}

// The stored line of the last approve event at the ticket's current hash, for each approved ticket in plan order.
function appliedLines(rec, tickets) {
  const out = [];
  for (const t of tickets) {
    if (statusOf(rec, t) !== 'approved') continue;
    const index = rec.events.findLastIndex((e) => e.ev === 'approve' && e.id === t.id && e.hash === t.hash);
    out.push(rec.lines[index]);
  }
  return out;
}

// ---------------------------------------------------------------- commands

// The typed folder (and file) spelled exactly as listed on disk; another ASCII letter case is refused.
function checkExact(env, rel) {
  try {
    exactWorkPath({ fs, path }, env.root, rel);
  } catch (error) {
    if (error instanceof WorkFolderRefusal) throw new Refusal(error.message);
    throw error;
  }
}

function checkSlug(value, env) {
  if (typeof value !== 'string' || !isWorkFolder(value)) throw new Refusal('bad slug');
  checkExact(env, [value]);
  return value;
}

function checkId(value, { sections = false } = {}) {
  if (typeof value !== 'string' || !(TICKET_ID.test(value) || (sections && value === SECTIONS_ID))) throw new Refusal('bad ticket id');
  return value;
}

// `<work folder name>/<plan file name>`: the name by isWorkFolder, the file by the plan name rule, one `/` only.
function validPlanRef(ref) {
  if (typeof ref !== 'string') return false;
  const cut = ref.indexOf('/');
  return cut > 0 && isWorkFolder(ref.slice(0, cut)) && PLAN_NAME.test(ref.slice(cut + 1));
}

function planRefOf(slug, arg, env) {
  if (typeof arg !== 'string') throw new Refusal('bad plan');
  const ref = arg.includes('/') ? arg : `${slug}/${arg}`;
  if (!validPlanRef(ref)) throw new Refusal('bad plan');
  checkExact(env, ref.split('/'));
  return ref;
}

// The plan the last `tickets` run named, read now.
function currentPlan(env, rec) {
  const ref = lastPlanRef(rec);
  if (ref === null) throw new Refusal('no tickets run yet');
  return { ref, plan: readPlan(env.root, ref) };
}

function cmdTickets(args, env) {
  if (args.length !== 4 || args[2] !== '--phase' || !['d', 'f'].includes(args[3])) throw new Refusal(USAGE);
  const slug = checkSlug(args[0], env);
  const ref = planRefOf(slug, args[1], env);
  const phase = args[3];
  const plan = readPlan(env.root, ref);
  const rec = loadRecord(env.root, slug);
  if (lastPlanRef(rec) !== ref) {
    ensureDir(env.root, ['.company', 'work', slug]);
    appendEvent(env, slug, rec, { ev: 'plan', plan: ref });
  }
  const core = coreKeys(env.root);
  const lines = [`tickets ${plan.tickets.length} phase ${phase}`];
  for (const t of plan.tickets) {
    const status = statusOf(rec, t);
    if (phase === 'd') lines.push(`ask ${t.id} new`);
    else if (status === 'approved' || status === 'parked') lines.push(`skip ${t.id} ${status}`);
    else lines.push(`ask ${t.id} ${status}`);
    const flags = flagsOf(t, core);
    if (flags.core) lines.push(`core ${t.id}`);
    if (flags.contract) lines.push(`contract ${t.id}`);
  }
  const sStatus = statusOf(rec, plan.sections);
  if (phase === 'f' && sStatus === 'approved') lines.push(`skip ${SECTIONS_ID} approved`);
  else lines.push(`ask ${SECTIONS_ID} ${phase === 'd' ? 'new' : sStatus}`);
  return { code: 0, lines };
}

function cmdTicket(args, env) {
  if (args.length !== 3) throw new Refusal(USAGE);
  const slug = checkSlug(args[0], env);
  const id = checkId(args[1], { sections: true });
  if (!PICKS.includes(args[2])) throw new Refusal('pick must be approve, change or park');
  if (id === SECTIONS_ID && args[2] === 'park') throw new Refusal('the plan sections cannot be parked');
  const rec = loadRecord(env.root, slug);
  const { plan } = currentPlan(env, rec);
  const ticket = id === SECTIONS_ID ? plan.sections : plan.tickets.find((t) => t.id === id);
  if (!ticket) throw new Refusal(`unknown ticket ${id}`);
  appendEvent(env, slug, rec, { ev: args[2], id, hash: ticket.hash });
  return { code: 0, lines: [`${args[2]} ${id}`] };
}

const pad = (n) => String(n).padStart(2, '0');

function roadmapTitle(raw, id) {
  const cut = raw.replace(/[^A-Za-z0-9 -]/g, '').replace(/ {2,}/g, ' ').trim().slice(0, MAX_TITLE).trim();
  if (DEVICE.test(cut)) throw new Refusal('title is a reserved name');
  return cut === '' ? id : cut;
}

function cmdParkTicket(args, env) {
  if (args.length !== 2) throw new Refusal(USAGE);
  const slug = checkSlug(args[0], env);
  const id = checkId(args[1]);
  const rec = loadRecord(env.root, slug);
  const { plan } = currentPlan(env, rec);
  const ticket = plan.tickets.find((t) => t.id === id);
  if (!ticket) throw new Refusal(`unknown ticket ${id}`);
  const pick = rec.events.findLast((e) => e.id === id && e.hash === ticket.hash);
  if (pick?.ev !== 'park') throw new Refusal(`${id} has no park pick for its current text`);
  for (const other of plan.tickets) {
    if (other.id !== id && other.deps.includes(id) && statusOf(rec, other) !== 'parked') {
      throw new Refusal(`${other.id} depends on ${id} and is not parked`);
    }
  }
  const title = roadmapTitle(ticket.title, id);
  const d = new Date(env.now);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  const name = `${stamp} - ${title}.md`;
  const body = `# ${title}\n\nParked ticket ${id} of run ${slug} on ${stamp.slice(0, 10)}.\n\n${ticket.text}`;
  ensureDir(env.root, ['.company']);
  const dir = ensureDir(env.root, ['.company', 'roadmap'], { create: true });
  createNew(dir, name, body);
  appendEvent(env, slug, rec, { ev: 'parked', id, hash: ticket.hash, file: name });
  return { code: 0, lines: [`parked ${id} ${name}`] };
}

function cmdBuildPlan(args, env) {
  if (args.length !== 1) throw new Refusal(USAGE);
  const slug = checkSlug(args[0], env);
  const buildSlug = helperName(slug, 'Build');
  if (buildSlug === null) throw new Refusal('no build folder name for this flow');
  const planPath = `.company/work/${buildSlug}/plan.md`;
  const rec = loadRecord(env.root, slug);
  const { plan } = currentPlan(env, rec);
  const approved = plan.tickets.filter((t) => statusOf(rec, t) === 'approved');
  if (approved.length === 0) throw new Refusal('no approved ticket');
  if (plan.base === null) throw new PlanProblem('no Base commit line');
  if (plan.openFence) throw new PlanProblem('unclosed code fence');
  const sStatus = statusOf(rec, plan.sections);
  if (sStatus === 'new') throw new Refusal('the plan sections (S0) are not approved: show them to the CEO and run ticket <slug> S0 approve');
  if (sStatus !== 'approved') throw new Refusal('the plan sections (S0) changed since the CEO answered: ask again and run ticket <slug> S0 approve');
  const text = [...headLines(plan), '## Tasks', '', ...approved.map((t) => `${t.text}`)].join('\n');
  const applied = appliedLines(rec, [...plan.tickets, plan.sections]);
  ensureDir(env.root, ['.company', 'work']);
  const dir = ensureDir(env.root, ['.company', 'work', buildSlug], { create: true });
  try {
    createNew(dir, 'plan.md', text.endsWith('\n') ? text : `${text}\n`);
  } catch (error) {
    if (error instanceof Refusal && error.message === 'file exists') throw new Refusal(error.message, [`plan: ${planPath}`]);
    throw error;
  }
  appendEvent(env, slug, rec, { ev: 'build', ids: approved.map((t) => t.id) });
  return { code: 0, lines: [`built ${approved.length} tickets`, `plan: ${planPath}`, ...applied] };
}

function cmdRead(args, env) {
  if (args.length !== 1) throw new Refusal(USAGE);
  const slug = checkSlug(args[0], env);
  const rec = loadRecord(env.root, slug);
  if (rec.events.length === 0) return { code: 0, lines: ['state none'] };
  const ref = lastPlanRef(rec);
  const head = ['state on', `plan ${ref ?? 'none'}`, `events ${rec.events.length}`, `dup ${dupCount(rec)}`];
  if (ref === null) return { code: 0, lines: [...head, 'approved 0'] };
  const plan = readPlan(env.root, ref);
  const applied = appliedLines(rec, [...plan.tickets, plan.sections]);
  return { code: 0, lines: [...head, `approved ${applied.length}`, ...applied] };
}

const HANDLERS = {
  tickets: cmdTickets,
  ticket: cmdTicket,
  'park-ticket': cmdParkTicket,
  'build-plan': cmdBuildPlan,
  read: cmdRead
};

// `now` (epoch ms) and `root` (the product root) are for callers that inject them.
export function main(args, { now, root } = {}) {
  const env = {
    root: typeof root === 'string' && root !== '' ? root : process.cwd(),
    now: typeof now === 'number' ? now : Date.now()
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
    if (error instanceof Refusal) return { code: 3, lines: [`refused: ${error.message}`, ...error.extra] };
    if (error instanceof RecordError) return { code: 1, lines: [error.message] };
    if (error instanceof PlanProblem) return { code: 1, lines: [`ticket-approval: plan ${error.message}`] };
    throw error;
  }
}

// A script started through a symlinked folder has argv[1] unresolved while import.meta.url is the real path.
function isMainReal() {
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
}

if (process.argv[1] && (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href || isMainReal())) {
  const { code, lines } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
