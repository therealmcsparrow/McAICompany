#!/usr/bin/env node
// Drift report (contract: docs/contracts/drift-report.md v1.1). Node built-ins only.
// uses: docs/contracts/contract-index.md v1 docs/contracts/work-folder-name.md v1.1
// `pick` lists the Contracts with a script Provider that were checked longest ago; `lint` checks the shape
// of one report. Neither writes anything. Report text, file names and arguments are untrusted: every
// pattern is anchored over a character class, sizes are capped before parsing, every file is read by the
// real-path rule, and output holds only fixed words, Contract names from the index, dates and counts.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildIndex } from './contract-drift.mjs';
import { WorkFolderRefusal, exactWorkPath, isWorkFolder } from '../mods/lib/work-folder.mjs';

const KINDS = ['missing-feature', 'incomplete-model', 'logic-shortcut', 'architectural-divergence'];
const MAX_ARG = 4096;
const MAX_REPORT_BYTES = 64 * 1024;
const MAX_CONTRACT_BYTES = 1024 * 1024;
const MAX_LINE = 1000;
const MAX_ITEMS = 500;
const MAX_CHECKED = 40;
const MAX_SLUGS = 500;
const MAX_REPORTS_PER_SLUG = 100;
const MAX_REPORTS = 500;
const MAX_ERRORS_SHOWN = 50;
const DEFAULT_PICK = 8;

const REPORT_NAME = /^drift-(\d{4}-\d{2}-\d{2})\.md$/;
const REPORT_PREFIX = '.company/work/';
const MAX_REPORT_REL = 300;

// [work folder, report file name] of `.company/work/<work folder>/drift-<date>.md`, or null.
function splitReportRel(rel) {
  if (typeof rel !== 'string' || rel.length > MAX_REPORT_REL || !rel.startsWith(REPORT_PREFIX)) return null;
  const rest = rel.slice(REPORT_PREFIX.length);
  const cut = rest.indexOf('/');
  if (cut < 1) return null;
  const folder = rest.slice(0, cut);
  const file = rest.slice(cut + 1);
  return isWorkFolder(folder) && REPORT_NAME.test(file) ? [folder, file] : null;
}
const CONTRACT_NAME = /^[a-z][a-z0-9-]{0,60}$/;
const PROVIDER = /^Provider: `(scripts\/[A-Za-z0-9._-]{1,100}\.mjs)`/;
const PATH_CHARS = '[A-Za-z0-9._@+\\/-]';
const DOC_REF = new RegExp(`^(${PATH_CHARS}{1,200}):(\\d{1,6})$`);
const CODE_REF = new RegExp(`^(${PATH_CHARS}{1,200})(?::(\\d{1,6}))?$`);
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// C0, DEL, C1, zero-width and bidi marks, line and paragraph separators, BOM.
const BAD_TEXT = new RegExp("[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]");
const CONTROL = /[\u0000-\u001f\u007f]/;

class Refused extends Error {}

const validDate = (text) => {
  const m = DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};

// A path key segment list for a repo-relative path: the plan path rule, forward slashes only.
function segmentsOf(rel) {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 200) return null;
  const segs = rel.split('/');
  for (const s of segs) {
    if (!/^[A-Za-z0-9._@+-]+$/.test(s) || s === '.' || s === '..' || s.startsWith('-') || s.endsWith('.')) return null;
    if (s.replace(/[. ]+$/, '').toLowerCase() === '.git' || s.toLowerCase().startsWith('.env')) return null;
  }
  return segs;
}

// The lexical path under the real root, when its real path equals it (no link anywhere on it); else null.
function plainPath(realRoot, segs) {
  const lexical = path.join(realRoot, ...segs);
  let real;
  try {
    real = fs.realpathSync.native(lexical);
  } catch {
    return null;
  }
  if (real !== lexical) return null;
  const rel = path.relative(realRoot, real);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return lexical;
}

// Reads a regular file with one hard link whose real path is its lexical path; at most max bytes (0: no read).
// Returns { text } or { reason }.
function readPlain(realRoot, segs, max) {
  const file = plainPath(realRoot, segs);
  if (file === null) return { reason: 'path' };
  let st;
  try {
    st = fs.lstatSync(file);
  } catch {
    return { reason: 'missing' };
  }
  if (!st.isFile() || st.nlink !== 1) return { reason: 'not a plain file' };
  if (st.size > max && max > 0) return { reason: 'too large' };
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch {
    return { reason: 'open' };
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

// Folder names under a folder reached without a link; [] when it is missing or linked.
function listPlainDir(realRoot, segs, cap) {
  const dir = plainPath(realRoot, segs);
  if (dir === null) return [];
  try {
    if (!fs.lstatSync(dir).isDirectory()) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).slice(0, cap).map((e) => ({ name: e.name, dir: e.isDirectory(), file: e.isFile() }));
  } catch {
    return [];
  }
}

const splitLines = (text) => text.split(/\r?\n/);

// Frontmatter: exactly `checked: [<names>]` and `date: <YYYY-MM-DD>` between two `---` lines.
// Returns { checked, date, next } (next: index of the first line after it) or { error }.
function parseFrontmatter(lines) {
  if (lines[0] !== '---') return { error: 'frontmatter missing' };
  const end = lines.slice(1, 12).indexOf('---');
  if (end === -1) return { error: 'frontmatter not closed' };
  let checked = null;
  let date = null;
  for (const line of lines.slice(1, end + 1)) {
    const m = /^(checked|date): ([^\r\n]{0,2100})$/.exec(line);
    if (!m) return { error: 'frontmatter key' };
    if (m[1] === 'checked') {
      if (checked !== null) return { error: 'frontmatter key repeated' };
      const list = /^\[([a-z0-9, -]{0,2050})\]$/.exec(m[2]);
      if (!list) return { error: 'checked is not a list' };
      const items = list[1].split(',').map((s) => s.trim()).filter((s) => s !== '');
      if (items.length < 1 || items.length > MAX_CHECKED || !items.every((s) => CONTRACT_NAME.test(s))) return { error: 'checked list' };
      checked = items;
    } else {
      if (date !== null) return { error: 'frontmatter key repeated' };
      if (!validDate(m[2])) return { error: 'date is not a calendar date' };
      date = m[2];
    }
  }
  if (checked === null) return { error: 'checked missing' };
  if (date === null) return { error: 'date missing' };
  return { checked, date, next: end + 2 };
}

function checkArgs(args) {
  for (const a of args) {
    if (typeof a !== 'string' || a.length > MAX_ARG || CONTROL.test(a)) throw new Refused('argument is not a plain value');
  }
}

function realRootOf(root) {
  try {
    return fs.realpathSync.native(root);
  } catch {
    throw new Refused('product root unreadable');
  }
}

// ---- pick ----

function lastChecked(realRoot, known) {
  const last = new Map();
  let seen = 0;
  const slugs = listPlainDir(realRoot, ['.company', 'work'], MAX_SLUGS).filter((e) => e.dir && isWorkFolder(e.name));
  for (const s of slugs) {
    const reports = listPlainDir(realRoot, ['.company', 'work', s.name], MAX_REPORTS_PER_SLUG).filter((e) => e.file && REPORT_NAME.test(e.name));
    for (const r of reports) {
      if (seen >= MAX_REPORTS) return last;
      seen += 1;
      const res = readPlain(realRoot, ['.company', 'work', s.name, r.name], MAX_REPORT_BYTES);
      if (res.text === undefined) continue;
      const fm = parseFrontmatter(splitLines(res.text));
      if (fm.error) continue;
      for (const name of fm.checked) {
        if (!known.has(name)) continue;
        if (!last.has(name) || last.get(name) < fm.date) last.set(name, fm.date);
      }
    }
  }
  return last;
}

function scriptProviders(root, realRoot) {
  const out = [];
  for (const [name, entry] of buildIndex(root)) {
    const segs = segmentsOf(entry.file);
    if (!segs) continue;
    const res = readPlain(realRoot, segs, MAX_CONTRACT_BYTES);
    if (res.text === undefined) continue;
    const line = splitLines(res.text.slice(0, 8000)).slice(0, 20).find((l) => l.startsWith('Provider: '));
    const m = line === undefined ? null : PROVIDER.exec(line);
    const script = m ? segmentsOf(m[1]) : null;
    if (!script || readPlain(realRoot, script, 0).text === undefined) continue;
    out.push({ name, file: entry.file, script: m[1] });
  }
  return out;
}

function pick(args, root) {
  let max = DEFAULT_PICK;
  if (args.length > 0) {
    if (args.length !== 2 || args[0] !== '--max' || !/^[1-8]$/.test(args[1])) throw new Refused('usage: pick [--max <1-8>]');
    max = Number(args[1]);
  }
  const realRoot = realRootOf(root);
  const candidates = scriptProviders(root, realRoot);
  if (candidates.length === 0) return { code: 0, lines: ['pick: none'] };
  const last = lastChecked(realRoot, new Set(candidates.map((c) => c.name)));
  candidates.sort((a, b) => {
    const da = last.get(a.name);
    const db = last.get(b.name);
    if (da === undefined && db !== undefined) return -1;
    if (da !== undefined && db === undefined) return 1;
    if (da !== db) return da < db ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  const picked = candidates.slice(0, max);
  const lines = picked.map((c) => `${c.name} ${c.file} ${c.script} ${last.get(c.name) ?? 'never'}`);
  lines.push(`pick: ${picked.length} of ${candidates.length} contracts`);
  return { code: 0, lines };
}

// ---- lint ----

function checkRef(realRoot, rel, label, errors, n) {
  const segs = segmentsOf(rel);
  if (!segs || readPlain(realRoot, segs, 0).text === undefined) errors.push([n, `${label} path is not a plain file inside the product`]);
}

function lintItem(line, n, realRoot, errors) {
  if (line.length > MAX_LINE) return void errors.push([n, 'item too long']);
  if (!line.startsWith('- ')) return void errors.push([n, 'item shape']);
  const parts = line.slice(2).split(' | ');
  if (parts.length !== 4) return void errors.push([n, 'item shape']);
  const [kind, doc, code, text] = parts;
  if (!KINDS.includes(kind)) errors.push([n, 'unknown kind']);
  const d = DOC_REF.exec(doc);
  const c = CODE_REF.exec(code);
  if (!d) errors.push([n, 'doc path shape']);
  if (!c) errors.push([n, 'code path shape']);
  if (text.length < 1 || text.length > 300 || BAD_TEXT.test(text)) errors.push([n, 'text']);
  if (d) checkRef(realRoot, d[1], 'doc', errors, n);
  if (c) checkRef(realRoot, c[1], 'code', errors, n);
}

function lintBody(lines, root, realRoot, errors) {
  const known = buildIndex(root);
  const fm = parseFrontmatter(lines);
  if (fm.error) {
    errors.push([1, fm.error]);
    return;
  }
  for (const name of fm.checked) if (!known.has(name)) errors.push([2, 'checked names a contract not in the index']);
  let i = fm.next;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (lines[i] !== '## Items') {
    errors.push([Math.min(i + 1, lines.length), 'items heading']);
    return;
  }
  let items = 0;
  let none = false;
  for (i += 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (line.startsWith('## ')) {
      errors.push([i + 1, 'unexpected heading']);
      continue;
    }
    items += 1;
    if (line === '- none') {
      none = true;
      continue;
    }
    if (items <= MAX_ITEMS) lintItem(line, i + 1, realRoot, errors);
  }
  if (items === 0) errors.push([lines.length, 'no items']);
  if (items > MAX_ITEMS) errors.push([lines.length, 'too many items']);
  if (none && items > 1) errors.push([lines.length, 'none beside items']);
}

function lint(args, root) {
  if (args.length !== 1) throw new Refused('usage: lint <report>');
  const realRoot = realRootOf(root);
  let rel = args[0].replace(/\\/g, '/');
  if (path.isAbsolute(args[0])) {
    const r = path.relative(realRoot, args[0]);
    rel = r.split(path.sep).join('/');
  }
  if (rel.length <= MAX_REPORT_REL && /^\.company\/work\//i.test(rel)) {
    if (!rel.startsWith(REPORT_PREFIX)) throw new Refused('wrong letter case');
    try { exactWorkPath({ fs, path }, realRoot, rel.split('/').slice(2)); } catch (error) {
      if (error instanceof WorkFolderRefusal) throw new Refused(error.message);
      throw error;
    }
  }
  const parts = splitReportRel(rel);
  const name = parts ? REPORT_NAME.exec(parts[1]) : null;
  if (!parts || !name || !validDate(name[1])) throw new Refused('report must be .company/work/<work folder>/drift-<YYYY-MM-DD>.md');
  const res = readPlain(realRoot, rel.split('/'), MAX_REPORT_BYTES);
  if (res.text === undefined) return { code: 1, lines: ['drift-report: report unreadable'] };
  const errors = [];
  lintBody(splitLines(res.text), root, realRoot, errors);
  errors.sort((a, b) => a[0] - b[0]);
  const lines = errors.slice(0, MAX_ERRORS_SHOWN).map(([n, why]) => `ERROR line ${n}: ${why}`);
  lines.push(`drift-report: ${errors.length} errors`);
  return { code: errors.length ? 2 : 0, lines };
}

export function main(args, { root = process.cwd() } = {}) {
  try {
    checkArgs(args);
    if (args[0] === 'pick') return pick(args.slice(1), root);
    if (args[0] === 'lint') return lint(args.slice(1), root);
    throw new Refused('usage: drift-report.mjs pick [--max <1-8>] | lint <report>');
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
