#!/usr/bin/env node
// Slop scan (contract: docs/contracts/slop-scan.md v1). Reads Markdown and text files and reports catalog tells. Read-only: opens inputs for reading, writes nothing, no network, no child process.
// Text is untrusted: masking and matching run in linear time, and every file passes the same checks (link, type, size, UTF-8).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RULES, wordTerms } from './slop-catalog.mjs';
import { exactWorkPath } from '../mods/lib/work-folder.mjs';

export { RULES, wordTerms };

export const MAX_BYTES = 1048576;
export const MAX_DEPTH = 6;
export const MAX_FILES = 2000;
const ID_RE = /^[WS]\d{2}$/;
const EXT_RE = /\.(?:md|markdown|txt)$/i;
const USAGE = 'slop-scan: usage: slop-scan [--json] <path>...\n';

// Order by code point, not by UTF-16 unit.
export function cmp(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i);
    const y = b.codePointAt(j);
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  if (i < a.length) return 1;
  return j < b.length ? -1 : 0;
}

// Replace every character except a newline by a space, so line numbers survive.
const blank = (s) => s.replace(/[^\n]/g, ' ');

function isBlankLine(line) {
  for (let k = 0; k < line.length; k++) {
    const c = line.charCodeAt(k);
    if (c !== 32 && c !== 9 && c !== 13) return false;
  }
  return true;
}

function trimEndWs(line) {
  let e = line.length;
  while (e > 0) {
    const c = line.charCodeAt(e - 1);
    if (c !== 32 && c !== 9 && c !== 13) break;
    e--;
  }
  return line.slice(0, e);
}

// A fence line: up to 3 spaces, then 3 or more backticks or tildes. A backtick fence holds no backtick after them.
function fenceOf(line) {
  let k = 0;
  while (k < 3 && line.charCodeAt(k) === 32) k++;
  const c = line[k];
  if (c !== '`' && c !== '~') return null;
  let m = k;
  while (line[m] === c) m++;
  const n = m - k;
  if (n < 3) return null;
  const rest = line.slice(m);
  if (c === '`' && rest.includes('`')) return null;
  return { c, n, rest };
}

// Lines of frontmatter at line 1 and of closed fenced code are blanked. An unclosed construct stays as text.
function maskLines(text) {
  const lines = text.split('\n');
  let i = 0;
  if (lines.length > 1 && trimEndWs(lines[0]) === '---') {
    for (let j = 1; j < lines.length; j++) {
      if (trimEndWs(lines[j]) === '---') {
        for (let k = 0; k <= j; k++) lines[k] = '';
        i = j + 1;
        break;
      }
    }
  }
  // Longest closing-capable fence from each line on, per fence character: an opener longer than that finds no closer
  // in O(1), so unclosed openers cost one pass in all. A scan that does run ends at its closer, and the next starts after it.
  const fences = lines.map(fenceOf);
  const sufMax = { '`': new Array(lines.length + 1).fill(0), '~': new Array(lines.length + 1).fill(0) };
  for (let j = lines.length - 1; j >= 0; j--) {
    const f = fences[j];
    sufMax['`'][j] = sufMax['`'][j + 1];
    sufMax['~'][j] = sufMax['~'][j + 1];
    if (f && isBlankLine(f.rest)) sufMax[f.c][j] = Math.max(sufMax[f.c][j], f.n);
  }
  while (i < lines.length) {
    const open = fences[i];
    if (!open || open.n > sufMax[open.c][i + 1]) { i++; continue; }
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const f = fences[j];
      if (f && f.c === open.c && f.n >= open.n && isBlankLine(f.rest)) { close = j; break; }
    }
    if (close < 0) { i++; continue; }
    for (let k = i; k <= close; k++) lines[k] = '';
    i = close + 1;
  }
  return lines.join('\n');
}

// Inline code spans, HTML comments and link targets, left to right. A span closes on a backtick run of the same
// length in the same paragraph. Every search is cached, so repeated unclosed openers cost no more than the first.
function maskInline(t) {
  const n = t.length;
  const runs = [];
  const byLen = new Map();
  let para = 0;
  let lineBlank = true;
  for (let i = 0; i < n; i++) {
    const c = t.charCodeAt(i);
    if (c === 10) { if (lineBlank) para++; lineBlank = true; continue; }
    if (c !== 32 && c !== 9 && c !== 13) lineBlank = false;
    if (c !== 96) continue;
    let m = i;
    while (m < n && t.charCodeAt(m) === 96) m++;
    const len = m - i;
    let arr = byLen.get(len);
    if (!arr) { arr = []; byLen.set(len, arr); }
    // A fence line that found no closing fence stays text: its backticks never open or close a span.
    let sp = 0;
    while (sp < 3 && t.charCodeAt(i - 1 - sp) === 32) sp++;
    const lead = i - sp === 0 || t.charCodeAt(i - sp - 1) === 10;
    let skip = false;
    if (lead && len >= 3 && sp <= 3) {
      let e = t.indexOf('\n', m);
      if (e < 0) e = n;
      skip = !t.slice(m, e).includes('`');
    }
    const run = { pos: i, len, para, k: arr.length, skip };
    if (!skip) arr.push(run);
    runs.push(run);
    i = m - 1;
  }
  const out = [];
  let from = 0;
  const maskRange = (a, b) => { out.push(t.slice(from, a), blank(t.slice(a, b))); from = b; };
  let ri = 0;
  let noCommentClose = false;
  let paren = -2;
  let lineEnd = -1;
  let i = 0;
  while (i < n) {
    const c = t.charCodeAt(i);
    if (c === 96) {
      while (runs[ri].pos < i) ri++;
      const r = runs[ri];
      if (r.skip) { i = r.pos + r.len; continue; }
      const next = byLen.get(r.len)[r.k + 1];
      if (next && next.para === r.para) {
        maskRange(r.pos, next.pos + next.len);
        i = next.pos + next.len;
      } else {
        i = r.pos + r.len;
      }
      continue;
    }
    if (c === 60 && !noCommentClose && t.startsWith('<!--', i)) {
      const e = t.indexOf('-->', i + 4);
      if (e < 0) { noCommentClose = true; } else { maskRange(i, e + 3); i = e + 3; continue; }
    } else if (c === 93 && t.charCodeAt(i + 1) === 40) {
      if (i > lineEnd) { lineEnd = t.indexOf('\n', i); if (lineEnd < 0) lineEnd = n; }
      if (paren !== -1 && paren < i + 2) paren = t.indexOf(')', i + 2);
      if (paren !== -1 && paren < lineEnd) { maskRange(i + 2, paren); i = paren; continue; }
    }
    i++;
  }
  out.push(t.slice(from));
  return out.join('');
}

export function mask(text) {
  return maskInline(maskLines(String(text)));
}

// Tokens that hold a letter or digit.
export function countWords(text) {
  let w = 0;
  for (const tok of String(text).split(/\s+/)) if (/[\p{L}\p{N}]/u.test(tok)) w++;
  return w;
}

const globalOf = (re) => (re.global ? re : new RegExp(re.source, `${re.flags}g`));

const isRuleLine = (s) => {
  if (s.length < 2 || '-=*_'.indexOf(s[0]) < 0) return false;
  for (let k = 1; k < s.length; k++) if (s[k] !== s[0]) return false;
  return true;
};
const HEADING_RE = /^#{1,6}(?:[ \t]|$)/;
const LIST_START_RE = /^(?:[-*+]|\d{1,3}[.)])[ \t]/;

// Paragraphs of the masked text (contract: Units). Returns [{ text, starts, lines, first }]: the joined text, each
// segment's offset in it, each segment's 1-based line, and the first line with text. One pass, plain loops.
export function paragraphs(text, masked = mask(text)) {
  const raw = String(text).split('\n');
  const mk = String(masked).split('\n');
  const out = [];
  let cur = null;
  const open = (quoted) => { cur = { parts: [], starts: [], lines: [], len: 0, quoted }; };
  const add = (seg, line) => {
    const start = cur.parts.length ? cur.len + 1 : 0;
    cur.parts.push(seg);
    cur.starts.push(start);
    cur.lines.push(line);
    cur.len = start + seg.length;
  };
  const close = () => {
    if (cur && cur.parts.length) out.push({ text: cur.parts.join(' '), starts: cur.starts, lines: cur.lines, first: cur.lines[0] });
    cur = null;
  };
  for (let i = 0; i < mk.length; i++) {
    const m = mk[i];
    if (isBlankLine(raw[i] ?? '') || m === '') { close(); continue; }
    let s = 0;
    let e = m.length;
    while (s < e && (m.charCodeAt(s) === 32 || m.charCodeAt(s) === 9 || m.charCodeAt(s) === 13)) s++;
    while (e > s && (m.charCodeAt(e - 1) === 32 || m.charCodeAt(e - 1) === 9 || m.charCodeAt(e - 1) === 13)) e--;
    let quoted = false;
    while (s < e && m.charCodeAt(s) === 62) {
      quoted = true;
      s++;
      while (s < e && (m.charCodeAt(s) === 32 || m.charCodeAt(s) === 9)) s++;
    }
    const seg = m.slice(s, e);
    if (seg === '') {
      if (quoted) close();
      else if (cur) add('', i + 1);
      continue;
    }
    const line = i + 1;
    if (HEADING_RE.test(seg) || isRuleLine(seg) || seg[0] === '|') {
      close();
      open(quoted);
      add(seg, line);
      close();
      continue;
    }
    if (LIST_START_RE.test(seg) || (cur && cur.quoted !== quoted)) close();
    if (!cur) open(quoted);
    add(seg, line);
  }
  close();
  return out;
}

// scan(text, path, rules): { path, words, tells: [{ path, line, rule, label }] } sorted by line, then rule id.
// A rule holds exactly one of `re` (a RegExp) and `test(text) -> boolean`; `unit` is 'paragraph' (default) or 'line'.
export function scan(text, filePath, rules = RULES) {
  const masked = mask(text);
  const paras = paragraphs(text, masked);
  const lines = masked.split('\n').map(trimEndWs);
  const tells = [];
  let lineUnits = null;
  for (const rule of rules) {
    if (!ID_RE.test(rule.id)) throw new Error('bad rule id');
    const hasRe = rule.re !== undefined && rule.re !== null;
    const hasTest = rule.test !== undefined && rule.test !== null;
    if (hasRe === hasTest || (hasRe && !(rule.re instanceof RegExp)) || (hasTest && typeof rule.test !== 'function')
      || (rule.unit !== undefined && rule.unit !== 'paragraph' && rule.unit !== 'line')) throw new Error('bad rule');
    if (rule.unit === 'line' && !lineUnits) lineUnits = lines.map((t, ln) => ({ text: t, starts: [0], lines: [ln + 1], first: ln + 1 }));
    const units = rule.unit === 'line' ? lineUnits : paras;
    const re = hasRe ? globalOf(rule.re) : null;
    const hit = (line) => tells.push({ path: filePath, line, rule: rule.id, label: rule.label });
    for (const u of units) {
      if (!re) {
        if (rule.test(u.text)) hit(u.first);
        continue;
      }
      re.lastIndex = 0;
      let k = 0;
      let m;
      while ((m = re.exec(u.text)) !== null) {
        while (k + 1 < u.starts.length && u.starts[k + 1] <= m.index) k++;
        hit(u.lines[k]);
        if (m[0] === '') re.lastIndex++;
      }
    }
  }
  tells.sort((a, b) => a.line - b.line || cmp(a.rule, b.rule));
  return { path: filePath, words: countWords(masked), tells };
}

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
const clean = (s) => String(s).replace(CONTROL_RE, '?');

const rootOf = (env) => fs.realpathSync.native(env.cwd ?? process.cwd());

const outside = (rel) => rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);

// Name as shown: relative to the root with `/`, control characters replaced, never raw.
function shown(root, lexical, arg) {
  const rel = path.relative(root, lexical);
  if (outside(rel)) return clean(String(arg).split('\\').join('/'));
  return rel === '' ? '.' : clean(rel.split(path.sep).join('/'));
}

// Checks one named path. Returns { reason, name }, { dir: true, abs, name } or { abs, name, text }.
export function readInput(arg, env = {}) {
  const root = rootOf(env);
  const raw = String(arg);
  if (raw === '' || raw.includes('\0')) return { reason: 'unreadable', name: clean(raw) };
  const lexical = path.resolve(root, raw);
  const name = shown(root, lexical, raw);
  const fail = (reason) => ({ reason, name });
  const rel = path.relative(root, lexical);
  if (outside(rel)) return fail('link');
  const parts = rel === '' ? [] : rel.split(path.sep);
  if (parts.length >= 2 && /^\.company$/i.test(parts[0]) && /^work$/i.test(parts[1])) {
    // exactWorkPath checks `.company` and `work` itself, spelled lower case; the typed spellings must match exactly.
    if (parts[0] !== '.company' || parts[1] !== 'work') return fail('missing');
    try {
      if (exactWorkPath({ fs, path }, root, parts.slice(2)) === 'missing') return fail('missing');
    } catch {
      return fail('missing');
    }
  }
  let st;
  try {
    st = fs.lstatSync(lexical, { bigint: true });
  } catch (error) {
    return fail(error && (error.code === 'ENOENT' || error.code === 'ENOTDIR') ? 'missing' : 'unreadable');
  }
  if (st.isSymbolicLink()) return fail('link');
  let real;
  try {
    real = fs.realpathSync.native(lexical);
  } catch {
    return fail('unreadable');
  }
  if (real !== lexical) return fail('link');
  if (st.isDirectory()) return { dir: true, abs: lexical, name };
  if (!st.isFile() || !EXT_RE.test(lexical)) return fail('type');
  if (st.nlink !== 1n) return fail('link');
  let fd;
  try {
    fd = fs.openSync(lexical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  } catch {
    return fail('unreadable');
  }
  try {
    const hs = fs.fstatSync(fd, { bigint: true });
    if (!hs.isFile() || hs.dev !== st.dev || hs.ino !== st.ino) return fail('link');
    if (hs.size > BigInt(MAX_BYTES)) return fail('too large');
    const buf = Buffer.alloc(Number(hs.size) + 1);
    let total = 0;
    while (total < buf.length) {
      const got = fs.readSync(fd, buf, total, buf.length - total, null);
      if (got === 0) break;
      total += got;
    }
    if (total > MAX_BYTES) return fail('too large');
    try {
      return { abs: lexical, name, text: new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, total)) };
    } catch {
      return fail('not utf-8');
    }
  } catch {
    return fail('unreadable');
  } finally {
    fs.closeSync(fd);
  }
}

// Lists the .md, .markdown and .txt files under a checked folder in code point order. `state.count` is the run-wide
// count of files met. Past depth 6 or past 2000 files the walk stops there and reports `limit`; what was walked stays. `links` counts every symlink, read from lstat and never followed, and every hard-linked .md/.markdown/.txt file passed over.
export function walk(rootDir, env = {}, state = { count: 0 }) {
  const files = [];
  const errors = [];
  let links = 0;
  let cut = false;
  const visit = (dir, depth) => {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      errors.push({ reason: 'unreadable' });
      return;
    }
    names.sort(cmp);
    for (const name of names) {
      if (cut) return;
      if (name.startsWith('.')) continue;
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.lstatSync(full);
      } catch {
        errors.push({ reason: 'unreadable' });
        continue;
      }
      if (st.isSymbolicLink()) {
        links++;
        continue;
      }
      if (st.isDirectory()) {
        if (depth + 1 > MAX_DEPTH) { errors.push({ reason: 'limit' }); continue; }
        visit(full, depth + 1);
      } else if (st.isFile() && EXT_RE.test(name)) {
        if (st.nlink !== 1) { links++; continue; }
        if (state.count >= MAX_FILES) { errors.push({ reason: 'limit' }); cut = true; return; }
        state.count++;
        files.push(full);
      }
    }
  };
  visit(rootDir, 0);
  return { files, errors, links };
}

const per1000 = (t, w) => (w === 0 ? '0.0' : ((t * 1000) / w).toFixed(1));

// main(args, env): { code, stdout, stderr }. env.cwd is the product root, env.rules replaces the catalog.
export function main(args, env = {}) {
  const rules = env.rules ?? RULES;
  let json = false;
  const paths = [];
  for (const a of args) {
    if (a === '--json') json = true;
    else if (a.startsWith('-')) return { code: 2, stdout: '', stderr: USAGE };
    else paths.push(a);
  }
  if (paths.length === 0) return { code: 2, stdout: '', stderr: USAGE };
  const errors = [];
  const tells = [];
  const seen = new Set();
  const state = { count: 0 };
  let files = 0;
  let words = 0;
  const take = (input) => {
    if (input.reason) { errors.push({ path: input.name, reason: input.reason }); return; }
    if (seen.has(input.abs)) return;
    seen.add(input.abs);
    const r = scan(input.text, input.name, rules);
    files++;
    words += r.words;
    for (const t of r.tells) tells.push(t);
  };
  for (const p of paths) {
    const input = readInput(p, env);
    if (!input.dir) { take(input); continue; }
    const walked = walk(input.abs, env, state);
    for (const e of walked.errors) errors.push({ path: input.name, reason: e.reason });
    for (const f of walked.files) take(readInput(f, env));
  }
  tells.sort((a, b) => cmp(a.path, b.path) || a.line - b.line || cmp(a.rule, b.rule));
  const uniq = new Map();
  for (const e of errors) uniq.set(`${e.path}\0${e.reason}`, e);
  const errs = [...uniq.values()].sort((a, b) => cmp(a.path, b.path) || cmp(a.reason, b.reason));
  const r = per1000(tells.length, words);
  let stdout;
  if (json) {
    stdout = `${JSON.stringify({ v: 1, files, words, tells: tells.map((t) => ({ path: t.path, line: t.line, rule: t.rule })), per_1000: Number(r), errors: errs })}\n`;
  } else {
    stdout = tells.map((t) => `${t.path}:${t.line} ${t.rule} ${t.label}\n`).join('')
      + `slop-scan: ${tells.length} tells, ${words} words, ${r} per 1000 words\n`;
  }
  const stderr = errs.map((e) => `ERROR ${e.path}: ${e.reason}\n`).join('');
  return { code: errs.length ? 1 : 0, stdout, stderr };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const res = main(process.argv.slice(2), {});
  process.stdout.write(res.stdout);
  process.stderr.write(res.stderr);
  process.exitCode = res.code;
}
