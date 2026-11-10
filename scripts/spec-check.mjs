#!/usr/bin/env node
// Destination spec check (contract: docs/contracts/destination-spec.md v1.5). Node built-ins only.
// `check` reports a spec that holds a code block, a file path, a bad frontmatter or a wrong heading list;
// `stamp` fills the two pending frontmatter values once. Spec text and arguments are untrusted: sizes are
// capped before parsing, every pattern is anchored over a character class or replaced by a single scan, the
// file is read by the real-path rule, and output holds only fixed words, line numbers and counts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WorkFolderRefusal, exactWorkPath, isRunSlug, slugOfKey, workParts } from '../mods/lib/work-folder.mjs';

const MAX_ARG = 4096;
const MAX_BYTES = 64 * 1024;
const MAX_ERRORS_SHOWN = 50;

const SPECS_DIR = 'docs/specs/';
const WORK_DIR = '.company/work/';
const VERSION = /^\d+\.\d+\.\d+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const HEADINGS = ['## Problem', '## Solution', '## User stories', '## Decisions', '## Testing decisions', '## Out of scope'];
const EXTENSIONS = new Set(
  'mjs cjs js jsx ts tsx json md mdx yml yaml toml ini py go rs java kt cs rb php sh ps1 bat html css scss sql lock xml gradle swift c h cpp'.split(' ')
);
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;
const SEPARATORS = new Set(' \t\r\n\f\v`()[]{}<>"\',;'.split(''));
const WIN = process.platform === 'win32';

class Refused extends Error {}

// A spec path by name: `docs/specs/<name>.md` or `.company/work/<run>/spec.md`, `<name>` a work folder name (new form or
// legacy slug), `<run>` a run slug (a v3 run is `<ProjectID>/<NN>-<playbook>`). The name is cut out by position and
// judged by the shared allow-list.
function isSpecRel(rel) {
  if (typeof rel !== 'string' || rel.length > MAX_ARG) return false;
  if (rel.startsWith(SPECS_DIR) && rel.endsWith('.md')) {
    const name = rel.slice(SPECS_DIR.length, -'.md'.length);
    return workParts(name)?.length === 1 || (!name.includes('/') && slugOfKey(name) !== null);
  }
  if (rel.startsWith(WORK_DIR) && rel.endsWith('/spec.md')) return isRunSlug(rel.slice(WORK_DIR.length, -'/spec.md'.length));
  return false;
}

const validDate = (text) => {
  const m = DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};

function realRootOf(root) {
  try {
    return fs.realpathSync.native(root);
  } catch {
    throw new Refused('root unreadable');
  }
}

// The repo-relative form of the argument, forward slashes; it must be a spec path by name.
function relOf(realRoot, arg) {
  let rel = arg.replace(/\\/g, '/');
  if (path.isAbsolute(arg)) rel = path.relative(realRoot, arg).split(path.sep).join('/');
  if (!rel.startsWith(WORK_DIR) && rel.slice(0, WORK_DIR.length).replace(/[A-Z]/g, (c) => c.toLowerCase()) === WORK_DIR) {
    throw new Refused('wrong letter case');
  }
  // A backslash in a relative argument is a separator for a one-part name only; a v3 run slug is written with a slash.
  const nested = rel.startsWith(WORK_DIR) && rel.slice(WORK_DIR.length).split('/').length > 2;
  if (!isSpecRel(rel) || (nested && !path.isAbsolute(arg) && arg.includes('\\'))) throw new Refused('spec must be docs/specs/<name>.md or .company/work/<run>/spec.md');
  if (rel.startsWith(WORK_DIR)) {
    try {
      exactWorkPath({ fs, path }, realRoot, rel.slice(WORK_DIR.length).split('/'));
    } catch (error) {
      if (error instanceof WorkFolderRefusal) throw new Refused(error.message);
      throw error;
    }
  }
  return rel;
}

// The real path of the spec: it equals the lexical path (no link or junction on it), lies inside the real
// root, and its canonical relative form is again a spec path. Returns { file, dir } or null.
function plainSpec(realRoot, rel) {
  const lexical = path.join(realRoot, ...rel.split('/'));
  let real;
  try {
    real = fs.realpathSync.native(lexical);
  } catch {
    return null;
  }
  if (real !== lexical) return null;
  const canon = path.relative(realRoot, real).split(path.sep).join('/');
  if (!isSpecRel(canon)) return null;
  return { file: real, dir: path.dirname(real) };
}

// Reads the spec as a regular file with one hard link, at most MAX_BYTES, UTF-8. Returns { text, st } or { reason }.
function readSpec(realRoot, rel) {
  const p = plainSpec(realRoot, rel);
  if (p === null) return { reason: 'spec path is not a plain path under the root' };
  let st;
  try {
    st = fs.lstatSync(p.file);
  } catch {
    return { reason: 'spec not readable' };
  }
  if (!st.isFile() || st.nlink !== 1) return { reason: 'spec is not a plain file' };
  if (st.size > MAX_BYTES) return { reason: 'spec over 64 KiB' };
  let fd;
  try {
    fd = fs.openSync(p.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch {
    return { reason: 'spec not readable' };
  }
  try {
    const f = fs.fstatSync(fd);
    if (!f.isFile() || f.nlink !== 1 || f.dev !== st.dev || f.ino !== st.ino) return { reason: 'spec changed while opening' };
    if (f.size > MAX_BYTES) return { reason: 'spec over 64 KiB' };
    const buf = Buffer.alloc(f.size);
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, off));
    return { text, st, path: p };
  } catch {
    return { reason: 'spec not readable as UTF-8' };
  } finally {
    fs.closeSync(fd);
  }
}

// Frontmatter: `---`, exactly slug, version, shipped in that order, `---`. Returns { end, version, shipped } or null.
// `end` is the index of the closing line.
function frontmatter(lines) {
  if (lines[0] !== '---' || lines[4] !== '---') return null;
  const slug = /^slug: (.+)$/.exec(lines[1]);
  const version = /^version: (.+)$/.exec(lines[2]);
  const shipped = /^shipped: (.+)$/.exec(lines[3]);
  if (!slug || !version || !shipped) return null;
  if (!isRunSlug(slug[1])) return null;
  if (version[1] !== 'pending' && !VERSION.test(version[1])) return null;
  if (shipped[1] !== 'pending' && !validDate(shipped[1])) return null;
  return { end: 4, version: version[1], shipped: shipped[1] };
}

// Removes every `<scheme>://…` run (to the next whitespace) in one scan; the scheme is at most 32 characters.
function stripUrls(line) {
  let out = '';
  let from = 0;
  let at = line.indexOf('://');
  while (at !== -1) {
    let s = at;
    while (s > from && at - s < 32 && /[A-Za-z0-9+.-]/.test(line[s - 1])) s -= 1;
    let e = at + 3;
    while (e < line.length && !/\s/.test(line[e])) e += 1;
    out += `${line.slice(from, s)} `;
    from = e;
    at = line.indexOf('://', from);
  }
  return out + line.slice(from);
}

const TRIM_END = new Set('.:!?*_'.split(''));
const TRIM_START = new Set('*_'.split(''));

function trimToken(token) {
  let a = 0;
  let b = token.length;
  while (a < b && TRIM_START.has(token[a])) a += 1;
  while (b > a && TRIM_END.has(token[b - 1])) b -= 1;
  return token.slice(a, b);
}

const endsWithExtension = (segment) => {
  const dot = segment.lastIndexOf('.');
  return dot > 0 && EXTENSIONS.has(segment.slice(dot + 1).toLowerCase());
};

// Drops a "#anchor" and a trailing location suffix (":12", ":12-30", ":12:5", ":L12", ":L12-L30"); one pass from the end.
function dropLocation(token) {
  const hash = token.indexOf('#');
  const head = hash === -1 ? token : token.slice(0, hash);
  let b = head.length;
  let colon = -1;
  let digit = false;
  while (b > 0) {
    const c = head[b - 1];
    if (c === ':') colon = b - 1;
    else if (c >= '0' && c <= '9') digit = true;
    else if (c !== '-' && c !== 'L') break;
    b -= 1;
  }
  if (colon > 0 && digit) return trimToken(head.slice(0, colon));
  return trimToken(head);
}

function isPath(raw) {
  const token = dropLocation(raw);
  if (token === '') return false;
  const slash = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'));
  if (slash !== -1 && endsWithExtension(token.slice(slash + 1))) return true; // (a)
  if (/^(?:\.\.?\/|~\/|[A-Za-z]:\\)/.test(token)) return true; // (b)
  if (token[0] === '/' && token.length > 1) return true; // (b)
  return slash === -1 && endsWithExtension(token); // (c)
}

function holdsPath(line) {
  const text = stripUrls(line);
  let start = -1;
  for (let i = 0; i <= text.length; i += 1) {
    const sep = i === text.length || SEPARATORS.has(text[i]);
    if (!sep) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (isPath(trimToken(text.slice(start, i)))) return true;
      start = -1;
    }
  }
  return false;
}

export function checkText(text) {
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  const errors = [];
  const fm = frontmatter(lines);
  if (fm === null) errors.push([1, 'bad frontmatter']);
  const bodyFrom = fm === null ? 0 : fm.end + 1;
  const found = new Map();
  lines.forEach((line, i) => {
    const n = i + 1;
    if (FENCE.test(line)) errors.push([n, 'code block']);
    if (i < bodyFrom) return;
    if (HEADINGS.includes(line) && !found.has(line)) found.set(line, n);
    if (holdsPath(line)) errors.push([n, 'file path in spec']);
  });
  let last = 0;
  for (const h of HEADINGS) {
    if (!found.has(h)) errors.push([lines.length, `missing heading ${h}`]);
    else if (found.get(h) < last) errors.push([found.get(h), `heading out of order ${h}`]);
    else last = found.get(h);
  }
  errors.sort((a, b) => a[0] - b[0]);
  return errors;
}

function checkArgs(args) {
  for (const a of args) {
    if (typeof a !== 'string' || a.length > MAX_ARG || CONTROL.test(a)) throw new Refused('argument is not accepted');
  }
}

function check(args, root) {
  if (args.length !== 1) throw new Refused('usage: check <file>');
  const realRoot = realRootOf(root);
  const rel = relOf(realRoot, args[0]);
  const res = readSpec(realRoot, rel);
  if (res.text === undefined) throw new Refused(res.reason);
  const errors = checkText(res.text);
  const lines = errors.slice(0, MAX_ERRORS_SHOWN).map(([n, why]) => `ERROR line ${n}: ${why}`);
  lines.push(`spec-check: ${errors.length} errors`);
  return { code: errors.length ? 2 : 0, lines };
}

function parseStampArgs(args) {
  if (args.length !== 5) throw new Refused('usage: stamp <file> --version <x.y.z> --date <YYYY-MM-DD>');
  const [file, ...rest] = args;
  const flags = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if ((key !== '--version' && key !== '--date') || flags.has(key)) throw new Refused('usage: stamp <file> --version <x.y.z> --date <YYYY-MM-DD>');
    flags.set(key, rest[i + 1]);
  }
  const version = flags.get('--version');
  const date = flags.get('--date');
  if (!VERSION.test(version ?? '')) throw new Refused('version must be <x.y.z>');
  if (!validDate(date ?? '')) throw new Refused('date must be <YYYY-MM-DD>');
  return { file, version, date };
}

function writeTemp(dir, bytes) {
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (WIN ? 0 : (fs.constants.O_NOFOLLOW ?? 0));
  const tmp = path.join(dir, `.spec-${crypto.randomBytes(12).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, flags, 0o644);
  try {
    fs.writeSync(fd, bytes, 0, bytes.length, 0);
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  return tmp;
}

function stamp(args, root) {
  const { file, version, date } = parseStampArgs(args);
  const realRoot = realRootOf(root);
  const rel = relOf(realRoot, file);
  const res = readSpec(realRoot, rel);
  if (res.text === undefined) throw new Refused(res.reason);
  const lines = res.text.split('\n');
  const fm = frontmatter(lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)));
  if (fm === null) throw new Refused('spec has a bad frontmatter');
  if (fm.version !== 'pending' || fm.shipped !== 'pending') throw new Refused('spec is already stamped');
  lines[2] = lines[2].replace('version: pending', `version: ${version}`);
  lines[3] = lines[3].replace('shipped: pending', `shipped: ${date}`);
  const bytes = Buffer.from(lines.join('\n'), 'utf8');

  let tmp = null;
  try {
    tmp = writeTemp(res.path.dir, bytes);
    // The folder and the spec are checked again right before the rename.
    const again = plainSpec(realRoot, rel);
    const before = again === null ? null : fs.lstatSync(again.file);
    if (again === null || again.file !== res.path.file || !before.isFile() || before.nlink !== 1 || before.dev !== res.st.dev || before.ino !== res.st.ino) {
      throw new Refused('spec changed during stamp');
    }
    fs.renameSync(tmp, again.file);
    tmp = null;
    const after = fs.lstatSync(again.file);
    if (!after.isFile() || after.nlink !== 1) return { code: 1, lines: ['spec-check: stamped file is not a plain file'] };
  } finally {
    if (tmp !== null) fs.rmSync(tmp, { force: true });
  }
  return { code: 0, lines: [`stamped ${rel} ${version} ${date}`] };
}

export function main(args, { root = process.cwd() } = {}) {
  try {
    checkArgs(args);
    if (args[0] === 'check') return check(args.slice(1), root);
    if (args[0] === 'stamp') return stamp(args.slice(1), root);
    throw new Refused('usage: spec-check.mjs check <file> | stamp <file> --version <x.y.z> --date <YYYY-MM-DD>');
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
