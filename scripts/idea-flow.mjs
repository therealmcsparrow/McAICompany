#!/usr/bin/env node
// idea-flow: the route record of one idea or bug flow (contract idea-flow v1.1).
// Every argument and every line of the record is untrusted and parsed against an allow-list.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run as companyType } from './company-type.mjs';

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NAME = /^[a-z0-9][a-z0-9-]{2,63}$/;
const FINAL_NAME = /^[a-z0-9][a-z0-9-]{2,65}$/;
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const TS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const BAD_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const OUT_CHARS = /^[A-Za-z0-9._ /-]{1,200}$/;

const KINDS = ['idea', 'bug'];
const SIZES = ['XS', 'S', 'M', 'L'];
const TIERS = ['low', 'medium', 'high'];
const GRILLS = ['grilling', 'grill-me', 'grill-with-docs'];
const STEPS = [...GRILLS, 'reprompt', 'cooler', 'brainstorm', 'research', 'to-spec', 'to-tickets', 'triage', 'build'];
const GRILL_FORM = [['1', 'grilling'], ['2', 'grill-me'], ['3', 'grill-with-docs']];
const ROUTES = [['A', 'cooler'], ['B', 'brainstorm'], ['C', 'research'], ['D', 'to-spec'], ['E', 'park-idea']];
const TICKET_FORM = [['F', 'build'], ['G', 'park-roadmap'], ['E', 'park-idea']];
const TICKET_FORM_PARK = TICKET_FORM.filter(([, r]) => r !== 'build');
const LEVEL = { cooler: 1, brainstorm: 2, research: 3 };

const MAX_ARG = 4096;
const MAX_BYTES = 256 * 1024;
const MAX_LINES = 2000;
const MAX_LINE = 1024;
const MAX_FILES = 200;
const MAX_FILE = 1024 * 1024;
const MAX_DEPTH = 3;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

class Refusal extends Error {}
class Fail extends Error {}
class Order extends Error {}

const refuse = (why) => { throw new Refusal(why); };
const fail = (why) => { throw new Fail(why); };

function validOut(o) {
  if (typeof o !== 'string' || !OUT_CHARS.test(o) || o.startsWith('/')) return false;
  return o.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && !s.endsWith('.') && !s.endsWith(' '));
}

// Event shapes: exact key order, then ts last.
function checkEvent(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
  const keys = Object.keys(o);
  if (typeof o.ts !== 'string' || !TS.test(o.ts) || keys[keys.length - 1] !== 'ts') return false;
  const k = keys.slice(0, -1).join(',');
  switch (o.e) {
    case 'start': return k === 'e,kind' && KINDS.includes(o.kind);
    case 'pick': return k === 'e,letter,route' && typeof o.letter === 'string' && typeof o.route === 'string';
    case 'park': return k === 'e,name' && typeof o.name === 'string' && FINAL_NAME.test(o.name);
    case 'done': {
      if (!STEPS.includes(o.step)) return false;
      const want = ['e', 'step'];
      if (o.step === 'triage') {
        if (!SIZES.includes(o.size) || !TIERS.includes(o.tier)) return false;
        want.push('size', 'tier');
      } else if ('size' in o || 'tier' in o) return false;
      if ('out' in o) { if (!validOut(o.out)) return false; want.push('out'); }
      return k === want.join(',');
    }
    default: return false;
  }
}

// The build pick exists only in a software company; the type comes from company-type resolve, never from text.
function typeOf(cwd) {
  const r = companyType(['resolve', '--json'], { cwd });
  let id;
  try { id = JSON.parse(r.out).id; } catch { fail('company type'); }
  if (r.code !== 0 || typeof id !== 'string') fail('company type');
  return id;
}

function optionsOf(st, cwd) {
  if (st.form === 'grill') return GRILL_FORM;
  // Replay (no cwd) accepts every record the full form allows; the type limits only new picks.
  if (st.form === 'tickets') return cwd === undefined || typeOf(cwd) === 'software' ? TICKET_FORM : TICKET_FORM_PARK;
  if (st.form === 'routes') return ROUTES.filter(([, r]) => !(r in LEVEL) || LEVEL[r] > st.level);
  return [];
}

// One transition; throws Order when the event does not fit the open form.
function apply(st, ev) {
  if (ev.e === 'start') throw new Order();
  if (ev.e === 'pick') {
    const hit = optionsOf(st).find(([l, r]) => l === ev.letter && r === ev.route);
    if (!hit) throw new Order();
    if (st.form === 'tickets') {
      if (ev.route === 'park-roadmap') return { ...st, form: 'ended', pending: null };
      return { ...st, form: 'pending', pending: ev.route === 'build' ? 'triage' : ev.route };
    }
    return { ...st, form: 'pending', pending: ev.route };
  }
  if (ev.e === 'park') {
    if (st.form !== 'pending' || st.pending !== 'park-idea') throw new Order();
    return { ...st, form: 'ended', pending: null };
  }
  if (st.form !== 'pending' || st.pending !== ev.step) throw new Order();
  const s = ev.step;
  if (GRILLS.includes(s)) return { ...st, pending: 'reprompt' };
  if (s === 'reprompt') return { ...st, form: 'routes', pending: null };
  if (s === 'research') return { ...st, level: 3, pending: 'reprompt' };
  if (s in LEVEL) return { ...st, form: 'routes', level: LEVEL[s], pending: null };
  if (s === 'to-spec') return { ...st, pending: 'to-tickets' };
  if (s === 'to-tickets') return { ...st, form: 'tickets', pending: null };
  if (s === 'triage') return { ...st, pending: 'build' };
  return { ...st, form: 'ended', pending: null };
}

function replay(events) {
  if (events.length === 0 || events[0].e !== 'start') fail('broken record');
  let st = { kind: events[0].kind, form: 'grill', level: 0, pending: null };
  for (let i = 1; i < events.length; i++) {
    try { st = apply(st, events[i]); } catch (e) { if (e instanceof Order) fail('broken record'); throw e; }
  }
  return st;
}

function dirsOk(cwd, slug, create) {
  let p = cwd;
  for (const part of ['.company', 'work', slug]) {
    p = path.join(p, part);
    let l;
    try { l = fs.lstatSync(p); } catch (e) {
      if (e.code !== 'ENOENT') fail('unknown slug');
      if (!create) fail('unknown slug');
      fs.mkdirSync(p);
      continue;
    }
    if (l.isSymbolicLink()) fail('link');
    if (!l.isDirectory()) fail('not a regular file');
  }
  return p;
}

function recordPath(cwd, slug) { return path.join(cwd, '.company', 'work', slug, 'idea-flow.jsonl'); }

function openChecked(file, flags) {
  let l;
  try { l = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') fail('unknown slug'); fail('not a regular file'); }
  if (l.isSymbolicLink()) fail('link');
  if (!l.isFile()) fail('not a regular file');
  if (l.nlink !== 1) fail('hard-linked');
  const fd = fs.openSync(file, flags | NOFOLLOW);
  const f = fs.fstatSync(fd);
  if (!f.isFile() || f.nlink !== 1 || f.dev !== l.dev || f.ino !== l.ino) { fs.closeSync(fd); fail('not a regular file'); }
  return { fd, size: f.size };
}

function load(cwd, slug) {
  dirsOk(cwd, slug, false);
  const { fd, size } = openChecked(recordPath(cwd, slug), fs.constants.O_RDONLY);
  let text;
  try {
    if (size > MAX_BYTES) fail('too large');
    const buf = Buffer.alloc(size);
    let n = 0;
    while (n < size) { const r = fs.readSync(fd, buf, n, size - n, n); if (r === 0) break; n += r; }
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, n)); } catch { fail('broken record'); }
  } finally { fs.closeSync(fd); }
  if (!text.endsWith('\n')) fail('broken record');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length > MAX_LINES) fail('broken record');
  const events = lines.map((l) => {
    if (Buffer.byteLength(l) > MAX_LINE) fail('broken record');
    let o;
    try { o = JSON.parse(l); } catch { fail('broken record'); }
    if (!checkEvent(o)) fail('broken record');
    return o;
  });
  return { events, size, state: replay(events) };
}

function append(cwd, slug, ev, create) {
  const line = `${JSON.stringify({ ...ev, ts: new Date().toISOString() })}\n`;
  if (create) {
    dirsOk(cwd, slug, true);
    let fd;
    try {
      fd = fs.openSync(recordPath(cwd, slug), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o644);
    } catch (e) { if (e.code === 'EEXIST') fail('exists'); throw e; }
    try { fs.writeSync(fd, line); } finally { fs.closeSync(fd); }
    return;
  }
  const { fd, size } = openChecked(recordPath(cwd, slug), fs.constants.O_WRONLY | fs.constants.O_APPEND);
  try {
    if (size + Buffer.byteLength(line) > MAX_BYTES) fail('too large');
    fs.writeSync(fd, line);
  } finally { fs.closeSync(fd); }
}

function checkSlug(s) { if (!SLUG.test(s)) refuse('bad slug'); }

// Collects regular files of the work folder; links are skipped, caps fail before anything is created.
function scan(dir, rel, depth, acc) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    const l = fs.lstatSync(full);
    if (l.isSymbolicLink()) continue;
    if (l.isDirectory()) {
      if (depth < MAX_DEPTH) { acc.dirs.push([...rel, d.name]); scan(full, [...rel, d.name], depth + 1, acc); }
    } else if (l.isFile()) {
      if (l.size > MAX_FILE) fail('too large');
      acc.files.push([...rel, d.name]);
      if (acc.files.length > MAX_FILES) fail('too large');
    }
  }
}

function parkCopy(cwd, slug, name) {
  const work = path.join(cwd, '.company', 'work', slug);
  const acc = { dirs: [], files: [] };
  scan(work, [], 0, acc);
  const ideas = path.join(cwd, '.company', 'ideas');
  try { fs.mkdirSync(ideas); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const il = fs.lstatSync(ideas);
  if (il.isSymbolicLink() || !il.isDirectory()) fail('link');
  let dest = null;
  let final = null;
  for (const cand of [name, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${name}-${n}`)]) {
    try { fs.mkdirSync(path.join(ideas, cand)); dest = path.join(ideas, cand); final = cand; break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  if (!dest) fail('name taken');
  for (const d of acc.dirs) fs.mkdirSync(path.join(dest, ...d));
  for (const f of acc.files) {
    const { fd } = openChecked(path.join(work, ...f), fs.constants.O_RDONLY);
    let data;
    try { data = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
    fs.writeFileSync(path.join(dest, ...f), data, { flag: 'wx' });
  }
  return final;
}

function formText(st) { return st.form === 'pending' ? `pending ${st.pending}` : st.form; }

function describe(ev) {
  if (ev.e === 'start') return `start kind=${ev.kind}`;
  if (ev.e === 'pick') return `pick ${ev.letter} ${ev.route}`;
  if (ev.e === 'park') return `park ${ev.name}`;
  return ['done', ev.step, ev.size && `size=${ev.size}`, ev.tier && `tier=${ev.tier}`, ev.out && `out=${ev.out}`].filter(Boolean).join(' ');
}

function parseDone(rest) {
  const opt = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i];
    if (!['--size', '--tier', '--out'].includes(k) || i + 1 >= rest.length || k.slice(2) in opt) refuse('usage');
    opt[k.slice(2)] = rest[i + 1];
  }
  return opt;
}

function exec(argv, cwd) {
  for (const a of argv) {
    if (typeof a !== 'string' || a.length > MAX_ARG || BAD_CHAR.test(a)) refuse('argument is not accepted');
  }
  const [cmd, slug, ...rest] = argv;
  const usage = () => refuse('usage');
  const lines = [];
  switch (cmd) {
    case 'start': {
      if (rest.length !== 2 || rest[0] !== '--kind') usage();
      checkSlug(slug);
      if (!KINDS.includes(rest[1])) refuse('bad kind');
      append(cwd, slug, { e: 'start', kind: rest[1] }, true);
      lines.push('started');
      break;
    }
    case 'options': case 'state': case 'read': {
      if (rest.length !== 0) usage();
      checkSlug(slug);
      const { events, state } = load(cwd, slug);
      if (cmd === 'options') {
        const o = optionsOf(state, cwd);
        if (o.length) o.forEach(([l, r]) => lines.push(`option ${l} ${r}`));
        else lines.push(formText(state));
      } else if (cmd === 'state') {
        lines.push(`kind: ${state.kind}`, `form: ${formText(state)}`, `build: ${state.kind === 'bug' ? 'fix' : 'feature'}`);
      } else events.forEach((ev, i) => lines.push(`${i + 1} ${describe(ev)}`));
      break;
    }
    case 'pick': {
      if (rest.length !== 1) usage();
      checkSlug(slug);
      const { state } = load(cwd, slug);
      const hit = optionsOf(state, cwd).find(([l]) => l === rest[0]);
      if (!hit) refuse('not an allowed pick');
      append(cwd, slug, { e: 'pick', letter: hit[0], route: hit[1] }, false);
      lines.push(`picked ${hit[0]} ${hit[1]}`);
      break;
    }
    case 'done': {
      if (rest.length < 1) usage();
      checkSlug(slug);
      const [step, ...flags] = rest;
      if (!STEPS.includes(step)) refuse('bad step');
      const opt = parseDone(flags);
      if (step === 'triage') {
        if (!('size' in opt) || !('tier' in opt)) refuse('size and tier required');
        if (!SIZES.includes(opt.size)) refuse('bad size');
        if (!TIERS.includes(opt.tier)) refuse('bad tier');
      } else if ('size' in opt || 'tier' in opt) refuse('size and tier only for triage');
      if ('out' in opt && !validOut(opt.out)) refuse('bad out');
      const { state } = load(cwd, slug);
      if (state.form !== 'pending' || state.pending !== step) fail('step out of order');
      const ev = { e: 'done', step };
      if (step === 'triage') { ev.size = opt.size; ev.tier = opt.tier; }
      if ('out' in opt) ev.out = opt.out;
      append(cwd, slug, ev, false);
      lines.push(`done ${step}`);
      break;
    }
    case 'park-idea': {
      if (rest.length !== 1) usage();
      checkSlug(slug);
      const { state } = load(cwd, slug);
      if (state.form !== 'pending' || state.pending !== 'park-idea') fail('step out of order');
      const name = rest[0];
      if (!NAME.test(name) || DEVICE.test(name.split('-')[0])) fail('name refused');
      const final = parkCopy(cwd, slug, name);
      append(cwd, slug, { e: 'park', name: final }, false);
      lines.push(`parked ${final}`);
      break;
    }
    default: usage();
  }
  return `${lines.join('\n')}\n`;
}

export function main(argv, cwd = process.cwd()) {
  try {
    return { code: 0, out: exec(argv, cwd) };
  } catch (e) {
    if (e instanceof Refusal) return { code: 3, out: `refused: ${e.message}\n` };
    if (e instanceof Fail) return { code: 1, out: `error: ${e.message}\n` };
    return { code: 1, out: 'error: failed\n' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const r = main(process.argv.slice(2));
  (r.code === 0 ? process.stdout : process.stderr).write(r.out);
  process.exitCode = r.code;
}
