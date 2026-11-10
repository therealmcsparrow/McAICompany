#!/usr/bin/env node
// Grill file check (contract: docs/contracts/grill-file.md v1.5). Node built-ins only.
// `check` lists the shape errors of a grill file; `status` prints the answered count and the open branches.
// File text and arguments are untrusted: the size is capped before decoding, every pattern is anchored and
// runs per line, the file is read by the real-path rule, and output holds only fixed words, ids, numbers,
// slugs and branch text with control characters escaped.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isRunSlug, workParts, exactWorkPath, WorkFolderRefusal } from '../mods/lib/work-folder.mjs';

const MAX_ARG = 4096;
const WORK_PREFIX = '.company/work/';
const MAX_BYTES = 256 * 1024;
const MAX_ERRORS_SHOWN = 50;
const MAX_TEXT = 200;

const BAD_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const ESCAPE_CHAR = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g;
const STARTED = /^(\d{4})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):([0-5]\d)$/;
const SECTIONS = ['## Idea', '## Open branches', '## Closed branches', '## Log', '## Proposals'];
const BRANCH_ID = /^B-[1-9][0-9]{0,3}$/;
const BRANCH_LINE = /^- (B-[1-9][0-9]{0,3}) — ([^\n]*)$/;
const BRANCH_PREFIX = /^- (B-[1-9][0-9]{0,3}) — /;
const CLOSE_SPLIT = ' — closed by ';
const REF = /^(?:[QF]-[1-9][0-9]{0,3}|stop)$/;
const ENTRY = /^### ([QF])-([1-9][0-9]{0,3}) — (B-[1-9][0-9]{0,3})$/;
const FIELD = /^- ([A-Za-z]+):(?: (.*))?$/;
const QUESTION_FIELDS = ['Question', 'Options', 'Answer', 'Decision', 'Opens', 'Closes'];
const FACT_FIELDS = ['Fact', 'Source', 'Closes'];
const WIN = process.platform === 'win32';
const io = { fs, path, platform: process.platform };

class Refused extends Error {}

const validStarted = (text) => {
  const m = STARTED.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};

// The branch text is 1-200 code points after trimming and holds no Cc, Cf, Zl or Zp character.
// The character test runs on the untrimmed text, since trim() would drop U+2028 and U+2029 at the ends.
function branchTextOk(raw) {
  if (BAD_CHAR.test(raw)) return false;
  const text = raw.trim();
  if (text.length === 0 || text.length > MAX_TEXT * 2) return false;
  return [...text].length <= MAX_TEXT;
}

// The first option ends `(recommended: <reason>)` with a non-empty reason.
function hasRecommended(option) {
  const mark = '(recommended: ';
  const at = option.lastIndexOf(mark);
  if (at === -1 || !option.endsWith(')')) return false;
  return option.slice(at + mark.length, -1).trim() !== '';
}

// Parses the ids of an Opens or Closes value: `none` or `B-<n>` joined with `, `. Returns an array or null.
function idList(value) {
  if (value === 'none') return [];
  const ids = value.split(', ');
  return ids.every((id) => BRANCH_ID.test(id)) ? ids : null;
}

// Returns { status, answered, open, closed, errors } for decoded text. Does no I/O and never throws.
export function parseGrill(text) {
  const errors = [];
  const fail = (line, reason) => errors.push({ line, reason });
  const result = { status: null, answered: 0, open: [], closed: [], errors };
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const lastLine = lines.length;

  // Frontmatter.
  let status = null;
  const fmOk = (() => {
    if (lines[0] !== '---' || lines[5] !== '---') return false;
    const slug = /^slug: (.+)$/.exec(lines[1]);
    const started = /^started: (.+)$/.exec(lines[2]);
    const st = /^status: (.+)$/.exec(lines[3]);
    if (!slug || !started || !st || lines[4] !== 'format: 1') return false;
    if (!isRunSlug(slug[1]) || !validStarted(started[1])) return false;
    if (st[1] !== 'open' && st[1] !== 'done' && st[1] !== 'stopped') return false;
    status = st[1];
    return true;
  })();
  if (!fmOk) fail(1, 'bad frontmatter');
  result.status = status;

  // Sections: each heading once and in order; other lines belong to the section above.
  const body = new Map();
  let seenMax = -1;
  let current = null;
  for (let i = fmOk ? 6 : 0; i < lines.length; i += 1) {
    const idx = SECTIONS.indexOf(lines[i]);
    if (idx === -1) {
      if (current !== null) body.get(current).push(i);
      continue;
    }
    if (body.has(SECTIONS[idx]) || idx < seenMax) {
      fail(i + 1, `section out of order ${SECTIONS[idx]}`);
      current = null;
      continue;
    }
    seenMax = idx;
    current = SECTIONS[idx];
    body.set(current, []);
  }
  for (const s of SECTIONS) if (!body.has(s)) fail(lastLine, `missing section ${s}`);

  // Branch sections.
  const openSeen = new Map();
  const closedSeen = new Map();
  const closedRefs = [];
  const declared = new Set();
  const bad = (i) => {
    const p = BRANCH_PREFIX.exec(lines[i]);
    if (p) declared.add(p[1]);
    fail(i + 1, 'bad branch line');
  };
  for (const i of body.get('## Open branches') ?? []) {
    const line = lines[i];
    if (line === '') continue;
    const m = BRANCH_LINE.exec(line);
    if (!m || !branchTextOk(m[2])) {
      bad(i);
      continue;
    }
    if (openSeen.has(m[1])) {
      fail(i + 1, `duplicate branch ${m[1]}`);
      continue;
    }
    openSeen.set(m[1], m[2].trim());
  }
  for (const i of body.get('## Closed branches') ?? []) {
    const line = lines[i];
    if (line === '') continue;
    const m = BRANCH_LINE.exec(line);
    const cut = m ? m[2].lastIndexOf(CLOSE_SPLIT) : -1;
    if (cut === -1) {
      bad(i);
      continue;
    }
    const ref = m[2].slice(cut + CLOSE_SPLIT.length);
    if (!branchTextOk(m[2].slice(0, cut)) || !REF.test(ref)) {
      bad(i);
      continue;
    }
    if (closedSeen.has(m[1])) {
      fail(i + 1, `duplicate branch ${m[1]}`);
      continue;
    }
    if (openSeen.has(m[1])) {
      fail(i + 1, `branch open and closed ${m[1]}`);
      continue;
    }
    closedSeen.set(m[1], i + 1);
    if (ref !== 'stop') closedRefs.push({ ref, line: i + 1 });
  }
  const known = (id) => openSeen.has(id) || closedSeen.has(id) || declared.has(id);

  // Log entries.
  const entries = new Set();
  const counts = { Q: 0, F: 0 };
  let entry = null;
  const finish = () => {
    if (entry === null) return;
    const { kind, headLine, fields } = entry;
    const wanted = kind === 'Q' ? QUESTION_FIELDS : FACT_FIELDS;
    for (let p = 0; p < wanted.length; p += 1) {
      const f = fields[p];
      if (!f || f.name !== wanted[p] || f.value === '') {
        fail(f && f.name === wanted[p] ? f.line : headLine, `missing field ${wanted[p]}`);
        break;
      }
      if (f.name === 'Options') {
        const items = f.value.split(' | ').map((s) => s.trim());
        if (items.length < 2 || items.length > 4 || items.some((s) => s === '')) fail(f.line, 'options count');
        else if (!hasRecommended(items[0])) fail(f.line, 'missing field recommended');
      }
      if (f.name === 'Opens' || f.name === 'Closes') {
        const ids = idList(f.value);
        if (ids === null) fail(f.line, `missing field ${f.name}`);
        else for (const id of ids) if (!known(id)) fail(f.line, `unknown branch ${id}`);
      }
    }
    entry = null;
  };
  for (const i of body.get('## Log') ?? []) {
    const line = lines[i];
    if (line.startsWith('### ')) {
      finish();
      const m = ENTRY.exec(line);
      if (!m) {
        fail(i + 1, 'entry out of sequence ?');
        continue;
      }
      const id = `${m[1]}-${m[2]}`;
      counts[m[1]] += 1;
      entries.add(id);
      if (Number(m[2]) !== counts[m[1]]) fail(i + 1, `entry out of sequence ${id}`);
      if (!known(m[3])) fail(i + 1, `unknown branch ${m[3]}`);
      entry = { kind: m[1], headLine: i + 1, fields: [] };
      continue;
    }
    if (entry === null) continue;
    const f = FIELD.exec(line);
    if (f) entry.fields.push({ name: f[1], value: (f[2] ?? '').trim(), line: i + 1 });
  }
  finish();
  result.answered = counts.Q;

  for (const { ref, line } of closedRefs) if (!entries.has(ref)) fail(line, 'bad branch line');

  if (status === 'done' && openSeen.size > 0) fail(4, 'done with open branches');

  result.open = [...openSeen].map(([id, t]) => ({ id, text: t }));
  result.closed = [...closedSeen.keys()];
  errors.sort((a, b) => a.line - b.line);
  return result;
}

// True for `.company/work/<work folder name>/grill.md` (the file name in any ASCII case; readGrill refuses a variant): the prefix and the file name are fixed words and the
// name in between is split off first, so no pattern runs over the name.
function isGrillRel(rel) {
  if (typeof rel !== 'string' || rel.length > MAX_ARG || !rel.startsWith(WORK_PREFIX)) return false;
  const parts = rel.slice(WORK_PREFIX.length).split('/');
  const file = parts.pop();
  return parts.length >= 1 && parts.length <= 2 && /^grill\.md$/i.test(file) && isRunSlug(parts.join('/'));
}

function checkArgs(args) {
  for (const a of args) {
    if (typeof a !== 'string' || a.length > MAX_ARG || BAD_CHAR.test(a)) throw new Refused('argument is not accepted');
  }
}

// The grill path as `.company/work/<slug>/grill.md`; an absolute path must lie inside the real root.
function relOf(realRoot, arg) {
  let rel = arg.replace(/\\/g, '/');
  if (path.isAbsolute(arg)) {
    const r = path.relative(realRoot, arg);
    if (r === '' || r.startsWith('..') || path.isAbsolute(r)) throw new Refused('outside the product root');
    rel = r.split(path.sep).join('/');
  }
  if (!isGrillRel(rel)) {
    // A prefix that differs from `.company/work/` only in ASCII letter case is a case variant, not another path.
    if (typeof rel === 'string' && rel.length <= MAX_ARG && rel.slice(0, WORK_PREFIX.length).replace(/[A-Z]/g, (c) => c.toLowerCase()) === WORK_PREFIX
      && !rel.startsWith(WORK_PREFIX) && isGrillRel(WORK_PREFIX + rel.slice(WORK_PREFIX.length))) {
      throw new Refused('wrong letter case');
    }
    throw new Refused('not a grill path');
  }
  return rel;
}

// Reads the grill file by the real-path rule. Returns the decoded text or throws Refused.
function readGrill(realRoot, rel) {
  const lexical = path.join(realRoot, ...rel.split('/'));
  // Exact letter case of every segment from `.company` down, before any read; a missing path keeps `missing` below.
  try {
    exactWorkPath(io, realRoot, rel.slice(WORK_PREFIX.length).split('/'));
  } catch (error) {
    if (error instanceof WorkFolderRefusal) throw new Refused(error.message);
    throw error;
  }
  if (!rel.endsWith('/grill.md')) throw new Refused('not a grill path');
  let real;
  try {
    real = fs.realpathSync.native(lexical);
  } catch {
    try {
      if (fs.lstatSync(lexical).isSymbolicLink()) throw new Refused('link');
    } catch (error) {
      if (error instanceof Refused) throw error;
    }
    throw new Refused('missing');
  }
  if (real !== lexical) throw new Refused('link');
  const back = path.relative(realRoot, real);
  if (back === '' || back.startsWith('..') || path.isAbsolute(back)) throw new Refused('outside the product root');
  if (!isGrillRel(back.split(path.sep).join('/'))) throw new Refused('not a grill path');
  let st;
  try {
    st = fs.lstatSync(real, { bigint: true });
  } catch {
    throw new Refused('missing');
  }
  if (st.isSymbolicLink()) throw new Refused('link');
  if (!st.isFile()) throw new Refused('not a regular file');
  if (st.nlink !== 1n) throw new Refused('hard-linked');
  let fd;
  try {
    fd = fs.openSync(real, fs.constants.O_RDONLY | (WIN ? 0 : (fs.constants.O_NOFOLLOW ?? 0)));
  } catch (error) {
    throw new Refused(error && error.code === 'ELOOP' ? 'link' : 'missing');
  }
  try {
    const f = fs.fstatSync(fd, { bigint: true });
    if (!f.isFile() || f.dev !== st.dev || f.ino !== st.ino) throw new Refused('not a regular file');
    if (f.nlink !== 1n) throw new Refused('hard-linked');
    if (f.size > BigInt(MAX_BYTES)) throw new Refused('too large');
    const buf = Buffer.alloc(Number(f.size) + 1);
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    if (off > MAX_BYTES) throw new Refused('too large');
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf.subarray(0, off));
    } catch {
      throw new Refused('not UTF-8');
    }
  } finally {
    fs.closeSync(fd);
  }
}

function realRootOf(root) {
  try {
    return fs.realpathSync.native(root);
  } catch {
    throw new Refused('outside the product root');
  }
}

const errorLines = (errors) => [
  ...errors.slice(0, MAX_ERRORS_SHOWN).map((e) => `ERROR line ${e.line}: ${e.reason}`),
  `grill-check: ${errors.length} errors`,
];

const escapeText = (t) => t.replace(ESCAPE_CHAR, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

function check(args, root) {
  if (args.length !== 1) throw new Refused(USAGE);
  const realRoot = realRootOf(root);
  const parsed = parseGrill(readGrill(realRoot, relOf(realRoot, args[0])));
  return { code: parsed.errors.length > 0 ? 2 : 0, lines: errorLines(parsed.errors) };
}

function status(args, root) {
  if (args.length !== 1) throw new Refused(USAGE);
  if (!isRunSlug(args[0])) throw new Refused('bad slug');
  const realRoot = realRootOf(root);
  const parsed = parseGrill(readGrill(realRoot, `${WORK_PREFIX}${args[0]}/grill.md`));
  if (parsed.errors.length > 0) return { code: 2, lines: errorLines(parsed.errors) };
  return {
    code: 0,
    lines: [
      `grill: ${parsed.answered} answered, ${parsed.open.length} open`,
      ...parsed.open.map((b) => `open ${b.id} — ${escapeText(b.text)}`),
      `status: ${parsed.status}`,
    ],
  };
}

const USAGE = 'usage: grill.mjs check <file> | status <slug>';

export function main(args, { root = process.cwd() } = {}) {
  try {
    checkArgs(args);
    if (args[0] === 'check') return check(args.slice(1), root);
    if (args[0] === 'status') return status(args.slice(1), root);
    throw new Refused(USAGE);
  } catch (error) {
    if (error instanceof Refused) return { code: 3, lines: [`refused: ${error.message}`] };
    throw error;
  }
}

// A script started through a symlinked folder has argv[1] unresolved while import.meta.url is the real path.
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
