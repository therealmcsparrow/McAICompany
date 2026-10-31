#!/usr/bin/env node
// Plan review (contract: docs/contracts/plan-review.md v1.1). Node built-ins only.
// uses: docs/contracts/contract-index.md v1 docs/contracts/plan-tasks.md v1.2 docs/contracts/handoff.md v2.0 docs/contracts/work-folder-name.md v1
// `lines` writes the inputs file a reviewer reads, `gate` prints the reviewer's paraphrase for the CEO,
// `score` counts seeded flaws a reviewer caught. Plans, Handoffs, case files and arguments are untrusted:
// every pattern is anchored over a character class, sizes are capped before parsing, every file is read by
// the real-path rule (no link, junction or second hard link on the path), and output holds only fixed words,
// counts and paths that passed the path rule. The script runs no git and no shell.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildIndex } from './contract-drift.mjs';
import { parseLocations } from './handoff-lint.mjs';
import { normalizePath } from './plan-tasks.mjs';
import { isWorkFolder } from '../mods/lib/work-folder.mjs';

const KiB = 1024;
const MAX_ARG = 4096;
const MAX_PLAN_BYTES = 256 * KiB;
const MAX_HANDOFF_BYTES = 64 * KiB;
const MAX_JSON_BYTES = 16 * KiB;
const MAX_RECORD_BYTES = 64 * KiB;
const MAX_RECORD_LINES = 500;
const MAX_CONTRACTS = 40;
const MAX_CODE = 200;
const MAX_AFTER = 20;
const MAX_CANDIDATES = 5000;
const MAX_CASES = 100;
const MAX_PARAPHRASE = 1200;
const MAX_ROW = 1000;

const PLAN_NAME = /^(\d{2,3}-)?(architect-)?plan(-[a-z0-9]+)?\.md$/;
const HANDOFF_NAME = /^\d{2,3}-[a-z][a-z0-9-]{0,40}\.md$/;
const ARCHITECT_NAME = /^\d{2,3}-architect\.md$/;
const CASE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const CONTRACT_TOKEN = /docs\/contracts\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.md(?![\w-])/g;
const CITE = /(^|[^A-Za-z0-9_-])([a-z][a-z0-9]*(?:-[a-z0-9]+)*) v\d+(?:\.\d+)?(?!\w|\.\d)/g;
const TICKED = /`([^`\n]{1,200})`/g;
const FILES_LINE = /^\s{0,3}[-*]\s+files:[ \t]*(.{0,4000})$/;
const FENCE = /^\s{0,3}(?:`{3,}|~{3,})/;
const TAGS = ['contract', 'spec', 'security', 'test', 'comprehension'];
const KIND_FILES = { plan: ['tests', 'plan-review', 'eval.jsonl'], code: ['tests', 'code-review', 'eval.jsonl'] };
const WIN = process.platform === 'win32';

const USAGE = 'usage: plan-review.mjs lines <slug> <plan> --mode plan|code --after <file>[,<file>…] | gate <slug> <handoff> | score <cases> <results> [--tag] [--record <x.y.z> [--kind plan|code]]';

class Refused extends Error {}
class Unreadable extends Error {}

// ---------------------------------------------------------------- real-path reads

const sameName = (a, b) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
const trimAlias = (s) => s.replace(/[. ]+$/, '') || s;

function realRootOf(root) {
  try {
    return fs.realpathSync.native(root);
  } catch {
    throw new Unreadable('product root unreadable');
  }
}

// The lexical path under the real root when its native real path equals it; else null.
function plainPath(realRoot, segs) {
  const lexical = path.join(realRoot, ...segs);
  let real;
  try {
    real = fs.realpathSync.native(lexical);
  } catch {
    return null;
  }
  if (!sameName(real, lexical)) return null;
  const rel = path.relative(realRoot, real);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return lexical;
}

// A regular file with one hard link whose real path is its lexical path. max 0: checks only, reads nothing.
// Returns { text } or { reason } with reason path | missing | not a plain file | too large | changed | read.
function readPlain(realRoot, segs, max) {
  const file = plainPath(realRoot, segs);
  if (file === null) {
    return { reason: fs.existsSync(path.join(realRoot, ...segs)) ? 'path' : 'missing' };
  }
  let st;
  try {
    st = fs.lstatSync(file);
  } catch {
    return { reason: 'missing' };
  }
  if (!st.isFile() || st.nlink !== 1) return { reason: 'not a plain file' };
  if (max > 0 && st.size > max) return { reason: 'too large' };
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch {
    return { reason: 'read' };
  }
  try {
    const f = fs.fstatSync(fd);
    if (!f.isFile() || f.nlink !== 1 || f.dev !== st.dev || f.ino !== st.ino) return { reason: 'changed' };
    if (max === 0) return { text: '' };
    if (f.size > max) return { reason: 'too large' };
    const buf = Buffer.alloc(f.size);
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, off)) };
  } catch {
    return { reason: 'read' };
  } finally {
    fs.closeSync(fd);
  }
}

// A folder reached without a link.
function plainDir(realRoot, segs) {
  const dir = plainPath(realRoot, segs);
  if (dir === null) return null;
  try {
    return fs.lstatSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- arguments

function checkArgs(args) {
  if (!Array.isArray(args)) throw new Refused(USAGE);
  for (const a of args) {
    if (typeof a !== 'string') throw new Refused(USAGE);
    if (a.length > MAX_ARG) throw new Refused('argument too long');
    if (CONTROL.test(a)) throw new Refused('argument holds a control character');
  }
}

const needSlug = (s) => {
  if (!isWorkFolder(s)) throw new Refused('bad slug');
  return s;
};

// Flags with a value (`valued`) or without (`bare`); each once; the rest are positionals.
function takeFlags(args, valued, bare) {
  const flags = new Map();
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (valued.includes(a)) {
      if (flags.has(a) || i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Refused(USAGE);
      flags.set(a, args[i + 1]);
      i += 1;
    } else if (bare.includes(a)) {
      if (flags.has(a)) throw new Refused(USAGE);
      flags.set(a, true);
    } else if (a.startsWith('--')) {
      throw new Refused(USAGE);
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

// ---------------------------------------------------------------- lines

function fencedLines(text) {
  const out = [];
  let fence = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      fence = !fence;
      continue;
    }
    if (!fence) out.push(line);
  }
  return out;
}

function planContracts(text, index) {
  const found = [];
  const seen = new Set();
  const add = (name) => {
    const entry = index.get(name);
    const file = entry ? entry.file : `docs/contracts/${name}.md`;
    if (!seen.has(file)) {
      seen.add(file);
      found.push(file);
    }
  };
  for (const line of text.split('\n')) {
    const hits = [];
    for (const m of line.matchAll(CONTRACT_TOKEN)) hits.push([m.index, m[1]]);
    for (const m of line.matchAll(CITE)) if (index.has(m[2])) hits.push([m.index + m[1].length, m[2]]);
    hits.sort((a, b) => a[0] - b[0]);
    for (const [, name] of hits) add(name);
  }
  return found;
}

function stripTicks(s) {
  return s.length >= 2 && s.startsWith('`') && s.endsWith('`') ? s.slice(1, -1) : s;
}

// Candidate code paths in plan order: backticked tokens and `files:` items, outside code fences.
function codeCandidates(text) {
  const out = [];
  for (const line of fencedLines(text)) {
    const files = FILES_LINE.exec(line);
    const tokens = [...line.matchAll(TICKED)].map((m) => m[1]);
    if (files) for (const item of files[1].split(',')) tokens.push(stripTicks(item.trim()));
    for (const t of tokens) {
      out.push(t);
      if (out.length >= MAX_CANDIDATES) return out;
    }
  }
  return out;
}

function excludedKey(key) {
  return key.startsWith('.company/') || key.startsWith('docs/contracts/');
}

function readable(realRoot, p) {
  return readPlain(realRoot, p.split('/'), 0).text !== undefined;
}

function underCompany(realRoot, p) {
  const lexical = plainPath(realRoot, p.split('/'));
  if (lexical === null) return true;
  const first = path.relative(realRoot, lexical).split(path.sep)[0];
  return trimAlias(first).toLowerCase() === '.company';
}

function collectCode(realRoot, text) {
  const out = [];
  const seen = new Set();
  for (const raw of codeCandidates(text)) {
    const n = normalizePath(raw);
    if (!n.ok || n.dir || excludedKey(n.key) || seen.has(n.key)) continue;
    seen.add(n.key);
    if (!readable(realRoot, n.path) || underCompany(realRoot, n.path)) continue;
    out.push(n.path);
  }
  return out;
}

function planFile(realRoot, slug, name, max) {
  const res = readPlain(realRoot, ['.company', 'work', slug, name], max);
  if (res.text !== undefined) return res.text;
  if (res.reason === 'path' || res.reason === 'not a plain file' || res.reason === 'changed') {
    throw new Refused(`${name} fails the real-path read rule`);
  }
  throw new Unreadable('plan unreadable');
}

function writeInputs(realRoot, slug, body) {
  const run = plainDir(realRoot, ['.company', 'work', slug]);
  if (run === null) throw new Refused('run folder missing or linked');
  const dir = path.join(run, 'plan-review');
  let st = null;
  try {
    st = fs.lstatSync(dir);
  } catch {
    st = null;
  }
  if (st === null) {
    try {
      fs.mkdirSync(dir);
    } catch (error) {
      if (error.code !== 'EEXIST') throw new Refused('plan-review folder cannot be made');
    }
  }
  if (plainDir(realRoot, ['.company', 'work', slug, 'plan-review']) === null) throw new Refused('plan-review folder is not a plain folder');
  const file = path.join(dir, 'inputs.md');
  let fst = null;
  try {
    fst = fs.lstatSync(file);
  } catch {
    fst = null;
  }
  if (fst && (!fst.isFile() || fst.nlink !== 1)) throw new Refused('inputs file is not a plain file');
  const nofollow = fs.constants.O_NOFOLLOW ?? 0;
  const flags = fst
    ? fs.constants.O_WRONLY | nofollow
    : fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | nofollow;
  let fd;
  try {
    fd = fs.openSync(file, flags, 0o644);
    const f = fs.fstatSync(fd);
    if (!f.isFile() || f.nlink !== 1 || (fst && (f.dev !== fst.dev || f.ino !== fst.ino))) throw new Refused('inputs file is not a plain file');
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, body, 0);
  } catch (error) {
    if (error instanceof Refused) throw error;
    throw new Refused('inputs file cannot be written');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function cmdLines(args, env) {
  const { flags, rest } = takeFlags(args, ['--mode', '--after'], []);
  if (rest.length !== 2 || !flags.has('--mode') || !flags.has('--after')) throw new Refused(USAGE);
  const slug = needSlug(rest[0]);
  const planName = rest[1];
  if (!PLAN_NAME.test(planName)) throw new Refused('bad plan name');
  const mode = flags.get('--mode');
  if (mode !== 'plan' && mode !== 'code') throw new Refused('mode must be plan or code');
  const after = flags.get('--after').split(',');
  if (after.length < 1 || after.length > MAX_AFTER) throw new Refused('--after takes 1 to 20 files');
  for (const f of after) {
    if (!HANDOFF_NAME.test(f) || PLAN_NAME.test(f)) throw new Refused('--after takes Handoff file names, never a plan');
  }
  if (new Set(after).size !== after.length) throw new Refused('--after names a file twice');
  if (mode === 'plan' && !after.some((f) => ARCHITECT_NAME.test(f))) throw new Refused('plan mode needs an architect Handoff in --after');

  const realRoot = realRootOf(env.root);
  const text = planFile(realRoot, slug, planName, MAX_PLAN_BYTES);
  for (const f of after) {
    const res = readPlain(realRoot, ['.company', 'work', slug, f], 0);
    if (res.text === undefined) throw new Refused(`--after file ${f}: ${res.reason}`);
  }

  const warnings = [];
  const index = buildIndex(realRoot);
  let contracts = planContracts(text, index).filter((c) => readable(realRoot, c));
  if (contracts.length > MAX_CONTRACTS) {
    contracts = contracts.slice(0, MAX_CONTRACTS);
    warnings.push(`warning: inputs capped contracts ${MAX_CONTRACTS}`);
  }
  let code = [];
  if (mode === 'plan') {
    code = collectCode(realRoot, text);
    if (code.length > MAX_CODE) {
      code = code.slice(0, MAX_CODE);
      warnings.push(`warning: inputs capped code ${MAX_CODE}`);
    }
  }
  const base = `.company/work/${slug}`;
  const body = [
    '## Plan', `${base}/${planName}`,
    '## Contracts', ...contracts,
    ...(mode === 'plan' ? ['## Code', ...code] : ['## Diff', 'judging diff: rule git.M-SEC4'])
  ].join('\n') + '\n';
  writeInputs(realRoot, slug, body);
  return {
    code: 0,
    lines: [
      'Input Handoffs: none: plan review',
      `Review inputs: ${base}/plan-review/inputs.md`,
      `After first pass: ${after.map((f) => `${base}/${f}`).join(', ')}`,
      ...warnings
    ]
  };
}

// ---------------------------------------------------------------- Handoff reading

function frontmatter(lines) {
  const fm = new Map();
  if (lines[0] !== '---') return { fm, end: -1 };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { fm, end: -1 };
  for (let i = 1; i < end; i += 1) {
    const m = /^([a-z][a-z-]{0,30}):[ \t]*(.{0,200})$/.exec(lines[i]);
    if (m && !fm.has(m[1])) fm.set(m[1], m[2].trim());
  }
  return { fm, end };
}

// First occurrence of each `## ` section outside code fences: name → lines.
function sectionsOf(lines, from) {
  const out = new Map();
  let current = null;
  let fence = false;
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i];
    if (FENCE.test(line)) {
      fence = !fence;
      if (current) current.push(line);
      continue;
    }
    const h = fence ? null : /^## (.{1,100})$/.exec(line);
    if (h) {
      const name = h[1].trim();
      current = out.has(name) ? null : [];
      if (current) out.set(name, current);
      continue;
    }
    if (current) current.push(line);
  }
  return out;
}

function parseHandoff(text) {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const { fm, end } = frontmatter(lines);
  return { fm, sections: end < 0 ? new Map() : sectionsOf(lines, end + 1) };
}

// Blocking bullets: { tag, n, body } with n the R-ID (null when the row has none).
function blockingRows(sections) {
  const rows = [];
  for (const line of sections.get('Blocking') ?? []) {
    const b = /^- (.*)$/.exec(line);
    if (!b || /^none\b/i.test(b[1]) || line.length > MAX_ROW) continue;
    const t = /^(?:\[([^\]\s]{1,40})\] )?(?:R-(\d{1,4})(?: |$))?/.exec(b[1]);
    rows.push({ tag: t[1] ?? '', n: t[2] === undefined ? null : Number(t[2]), body: b[1] });
  }
  return rows;
}

function escapeText(s) {
  let out = '';
  for (const ch of s) {
    out += ch !== '\n' && CONTROL.test(ch) ? `\\u{${ch.codePointAt(0).toString(16)}}` : ch;
  }
  return out;
}

function cmdGate(args, env) {
  if (args.length !== 2) throw new Refused(USAGE);
  const slug = needSlug(args[0]);
  const name = args[1];
  if (!HANDOFF_NAME.test(name) || PLAN_NAME.test(name)) throw new Refused('bad Handoff name');
  const realRoot = realRootOf(env.root);
  const res = readPlain(realRoot, ['.company', 'work', slug, name], MAX_HANDOFF_BYTES);
  if (res.text === undefined) {
    if (res.reason === 'missing') throw new Refused('Handoff missing');
    throw new Refused(`Handoff ${res.reason}`);
  }
  const { fm, sections } = parseHandoff(res.text);
  if (fm.get('role') !== 'fresh-reviewer') throw new Refused('Handoff is not a fresh-reviewer Handoff');
  const para = sections.get('Paraphrase');
  if (!para) throw new Refused('Handoff has no ## Paraphrase');
  const raw = para.filter((l) => l.trim() !== '').join('\n');
  const capped = Array.from(raw).slice(0, MAX_PARAPHRASE).join('');
  const shown = escapeText(capped).split('\n').map((l) => `> ${l}`);
  const first = (sections.get('First pass') ?? []).filter((l) => /^- R-\d{1,4}(?: |$)/.test(l)).length;
  const stem = name.slice(0, -3);
  const lines = ['paraphrase:', ...shown, `first pass: ${first} findings`];
  for (const r of blockingRows(sections)) if (r.tag === 'comprehension' && r.n !== null) lines.push(`comprehension ${stem}:R-${r.n}`);
  return { code: 0, lines };
}

// ---------------------------------------------------------------- score

function overlapsRows(rows, expected, withTag) {
  const want = normalizePath(expected.file);
  for (const row of rows) {
    if (withTag && row.tag !== expected.tag) continue;
    for (const loc of parseLocations(row.body)) {
      const n = normalizePath(loc.path);
      if (!want.ok || !n.ok || n.key !== want.key) continue;
      if (loc.from === null) return true;
      if (loc.from <= expected.lines[1] && loc.to >= expected.lines[0]) return true;
    }
  }
  return false;
}

function parseExpected(text, label) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Refused(`case ${label}: expected.json is not JSON`);
  }
  const keys = obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.keys(obj).sort().join(',') : '';
  if (keys === 'control,v' && obj.v === 1 && obj.control === true) return { control: true };
  const l = obj?.lines;
  const ok = keys === 'file,lines,tag,v' && obj.v === 1 && typeof obj.file === 'string' && normalizePath(obj.file).ok
    && Array.isArray(l) && l.length === 2 && l.every((x) => Number.isInteger(x) && x >= 1 && x <= 1000000) && l[0] <= l[1]
    && TAGS.includes(obj.tag);
  if (!ok) throw new Refused(`case ${label}: expected.json shape`);
  return { control: false, file: obj.file, lines: l, tag: obj.tag };
}

// Resolves a cases or results argument to a plain folder inside the root; returns its root-relative segments.
function folderArg(realRoot, arg) {
  const abs = path.isAbsolute(arg) ? arg : path.join(realRoot, arg);
  const rel = path.relative(realRoot, path.resolve(abs));
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Refused('folder must be inside the product root');
  const segs = rel.split(path.sep);
  if (plainDir(realRoot, segs) === null) throw new Refused('folder missing or linked');
  return segs;
}

function utc(now) {
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function appendRecord(realRoot, kind, record) {
  const segs = KIND_FILES[kind];
  for (let i = 1; i < segs.length; i += 1) {
    const dir = path.join(realRoot, ...segs.slice(0, i));
    let st = null;
    try {
      st = fs.lstatSync(dir);
    } catch {
      st = null;
    }
    if (st === null) {
      try {
        fs.mkdirSync(dir);
      } catch (error) {
        if (error.code !== 'EEXIST') throw new Refused('record folder cannot be made');
      }
    }
    if (plainDir(realRoot, segs.slice(0, i)) === null) throw new Refused('record folder is not a plain folder');
  }
  const file = path.join(realRoot, ...segs);
  let st = null;
  try {
    st = fs.lstatSync(file);
  } catch {
    st = null;
  }
  const line = `${JSON.stringify(record)}\n`;
  if (st) {
    if (!st.isFile() || st.nlink !== 1) throw new Unreadable('record is not a plain file');
    const cur = readPlain(realRoot, segs, MAX_RECORD_BYTES);
    if (cur.text === undefined) throw new Unreadable('record unreadable');
    if ((cur.text !== '' && !cur.text.endsWith('\n')) || cur.text.split('\n').length > MAX_RECORD_LINES
      || cur.text.length + line.length > MAX_RECORD_BYTES) throw new Unreadable('record unreadable');
  }
  const nofollow = fs.constants.O_NOFOLLOW ?? 0;
  const flags = st
    ? fs.constants.O_WRONLY | fs.constants.O_APPEND | nofollow
    : fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_EXCL | nofollow;
  let fd;
  try {
    fd = fs.openSync(file, flags, 0o644);
    const f = fs.fstatSync(fd);
    if (!f.isFile() || f.nlink !== 1 || (st && (f.dev !== st.dev || f.ino !== st.ino))) throw new Unreadable('record is not a plain file');
    fs.writeSync(fd, line);
  } catch (error) {
    if (error instanceof Unreadable) throw error;
    throw new Unreadable('record cannot be written');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function cmdScore(args, env) {
  const { flags, rest } = takeFlags(args, ['--record', '--kind'], ['--tag']);
  if (rest.length !== 2) throw new Refused(USAGE);
  if (flags.has('--kind') && !flags.has('--record')) throw new Refused('--kind needs --record');
  const kind = flags.has('--kind') ? flags.get('--kind') : 'plan';
  if (!Object.hasOwn(KIND_FILES, kind)) throw new Refused('kind must be plan or code');
  const version = flags.get('--record');
  if (version !== undefined && !VERSION.test(version)) throw new Refused('record version must be x.y.z');
  const withTag = flags.has('--tag');

  const realRoot = realRootOf(env.root);
  const casesSegs = folderArg(realRoot, rest[0]);
  const resultsSegs = folderArg(realRoot, rest[1]);
  let names;
  try {
    names = fs.readdirSync(path.join(realRoot, ...casesSegs), { withFileTypes: true })
      .filter((e) => e.isDirectory() && CASE_NAME.test(e.name)).map((e) => e.name).sort();
  } catch {
    throw new Refused('cases folder unreadable');
  }
  if (names.length === 0) throw new Refused('no cases');
  if (names.length > MAX_CASES) throw new Refused('more than 100 cases');

  const lines = [];
  let caught = 0;
  let total = 0;
  let controls = 0;
  let hasControl = false;
  for (const name of names) {
    const plan = readPlain(realRoot, [...casesSegs, name, 'plan.md'], 0);
    if (plan.text === undefined) throw new Refused(`case ${name}: plan.md ${plan.reason}`);
    const exp = readPlain(realRoot, [...casesSegs, name, 'expected.json'], MAX_JSON_BYTES);
    if (exp.text === undefined) throw new Refused(`case ${name}: expected.json ${exp.reason}`);
    const expected = parseExpected(exp.text, name);
    const res = readPlain(realRoot, [...resultsSegs, `${name}.md`], MAX_HANDOFF_BYTES);
    let rows = [];
    if (res.text !== undefined) {
      const { fm, sections } = parseHandoff(res.text);
      if (fm.get('role') === 'fresh-reviewer' || fm.get('role') === 'code-reviewer') rows = blockingRows(sections);
    }
    if (expected.control) {
      if (res.text === undefined) { lines.push(`control ${name} missing`); continue; }
      hasControl = true;
      controls += rows.length;
      lines.push(`control ${name} ${rows.length} blocking`);
      continue;
    }
    total += 1;
    const hit = overlapsRows(rows, expected, withTag);
    if (hit) caught += 1;
    lines.push(`case ${name} ${hit ? 'caught' : 'missed'}`);
  }
  lines.push(`caught ${caught} of ${total}`);
  if (version !== undefined) {
    const record = { v: 1, aico: version, at: utc(env.now), caught, total };
    if (hasControl) record.control = controls;
    appendRecord(realRoot, kind, record);
  }
  return { code: 0, lines };
}

// ---------------------------------------------------------------- main

const HANDLERS = { lines: cmdLines, gate: cmdGate, score: cmdScore };

export function main(args, { root, now } = {}) {
  const env = {
    root: typeof root === 'string' && root !== '' ? root : process.cwd(),
    now: typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
  };
  try {
    checkArgs(args);
    const [command, ...rest] = args;
    if (typeof command !== 'string' || !Object.hasOwn(HANDLERS, command)) throw new Refused(USAGE);
    return HANDLERS[command](rest, env);
  } catch (error) {
    if (error instanceof Refused) return { code: 3, lines: [`refused: ${error.message}`] };
    if (error instanceof Unreadable) return { code: 1, lines: [`plan-review: ${error.message}`] };
    throw error;
  }
}

function isMainReal() {
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (process.argv[1] && (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href || isMainReal())) {
  const { code, lines } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
