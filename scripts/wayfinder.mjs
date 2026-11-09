// Wayfinder map check (contract: docs/contracts/wayfinder.md v1.2). Node built-ins only; reads, never writes.
// Every line must be a title, a heading, a decision line, an open line or a pointer line, so a map can only point at
// files and never hold copied content. Every pattern is anchored and every input is length-capped before one runs.
import fs from 'node:fs';
import path from 'node:path';
import { parsePlan, normalizePath } from './plan-tasks.mjs';
import { workParts, exactWorkPath, ticketLocal } from '../mods/lib/work-folder.mjs';

const MAX_BYTES = 64 * 1024;
const MAX_LINES = 400;
const MAX_LINE = 240;
const MAX_TOPIC = 80;
const MAX_TEXT = 200;
const MAX_WHY = 120;
const MAX_REFS = 3;
const MAX_ARG = 200;
const MAX_PLAN_BYTES = 1024 * 1024;
const MAX_FOLDER = 120;
const DASH = '—';
const SRC_MARK = ` ${DASH} src: `;
const POINTER_MARK = ` ${DASH} `;

const FORBIDDEN_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const FILE_RE = /^\.company\/wayfinder\/[a-z0-9][a-z0-9-]{0,63}\.md$/;
const ID_RE = /^[1-9][0-9]{0,2}$/;
const ANCHOR_RE = /^[A-Za-z0-9-]{1,40}$/;
const PLAN_NAME_RE = /^(\d{2,3}-)?(architect-)?plan(-[a-z0-9]+)?\.md$/;
const SECTIONS = ['## Decisions', '## Open', '## Pointers'];
const PREFIX = ['D', 'O'];

class Refusal extends Error {}

const io = { fs, path, platform: process.platform };

function splitLines(text) {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines.at(-1) === '') lines.pop();
  return lines;
}

function isPlanFile(name) {
  return PLAN_NAME_RE.test(name) || name === 'input-fix.md';
}

// The ref as typed -> { ok, path, anchor } or { ok: false }. The path is echoed only when ok.
function parseRef(raw, root) {
  const bad = { ok: false };
  if (raw.length === 0 || raw.length > MAX_FOLDER + MAX_ARG) return bad;
  let inner = raw;
  const ticked = raw.includes('`');
  if (ticked) {
    if (raw.length < 3 || !raw.startsWith('`') || !raw.endsWith('`')) return bad;
    inner = raw.slice(1, -1);
    if (inner.includes('`')) return bad;
  }
  if (inner.includes('\\')) return bad;
  const hash = inner.indexOf('#');
  const target = hash === -1 ? inner : inner.slice(0, hash);
  const anchor = hash === -1 ? null : inner.slice(hash + 1);
  if (anchor !== null && !ANCHOR_RE.test(anchor) && ticketLocal(anchor) === null) return bad;
  const segs = target.split('/');
  let checked = target;
  if (ticked && segs.length >= 3 && segs[0] === '.company' && segs[1] === 'work' && segs[2].length <= MAX_FOLDER) {
    // A v3 run folder is two segments (`<ProjectID>/<NN>-<playbook>`), any other work folder one.
    const run = segs.length >= 4 && workParts(`${segs[2]}/${segs[3]}`) !== null ? 2 : 1;
    if (run === 2 || workParts(segs[2]) !== null) checked = ['.company', 'work', 'x', ...segs.slice(2 + run)].join('/');
  }
  const n = normalizePath(checked);
  if (!n.ok || n.dir) return bad;
  if (segs[0].toLowerCase() === '.company' && segs[1]?.toLowerCase() === 'work') {
    if (segs[0] !== '.company' || segs[1] !== 'work') return bad;
    try {
      exactWorkPath(io, root, segs.slice(2));
    } catch {
      return bad;
    }
  }
  return { ok: true, path: target, segs, anchor };
}

// lstat every segment under the root: a link, a missing part or a non-file end is `null`.
function resolveFile(root, segs) {
  let cur = root;
  for (let i = 0; i < segs.length; i++) {
    cur = path.join(cur, segs[i]);
    let st;
    try {
      st = fs.lstatSync(cur, { bigint: true });
    } catch {
      return null;
    }
    if (st.isSymbolicLink()) return null;
    if (i < segs.length - 1 ? !st.isDirectory() : !st.isFile()) return null;
  }
  return { full: cur };
}

// Text of a plan file inside the real root, or null when it cannot be read safely.
function readPlanText(root, segs, full) {
  let fd = null;
  try {
    const realRoot = fs.realpathSync.native(root);
    if (fs.realpathSync.native(full) !== path.join(realRoot, ...segs)) return null;
    const st = fs.lstatSync(full, { bigint: true });
    if (!st.isFile() || st.nlink !== 1n || st.size > BigInt(MAX_PLAN_BYTES)) return null;
    fd = fs.openSync(full, fs.constants.O_RDONLY | (process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW ?? 0)));
    const f = fs.fstatSync(fd, { bigint: true });
    if (!f.isFile() || f.dev !== st.dev || f.ino !== st.ino || f.nlink !== 1n) return null;
    const buf = Buffer.alloc(Number(f.size) + 1);
    let off = 0;
    while (off < buf.length) {
      const got = fs.readSync(fd, buf, off, buf.length - off, off);
      if (got === 0) break;
      off += got;
    }
    if (off > MAX_PLAN_BYTES) return null;
    return buf.subarray(0, off).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

// The run slug a plan path sits in: `<ID>/<NN>-<pb>` for a v3 run folder, else the single folder name.
function runSlugOf(segs) {
  if (segs[0] !== '.company' || segs[1] !== 'work') return undefined;
  if (segs.length >= 5 && workParts(`${segs[2]}/${segs[3]}`)?.length === 2) return `${segs[2]}/${segs[3]}`;
  return segs[2];
}

export function validate(text, { root = process.cwd() } = {}) {
  const errors = [];
  if (typeof text !== 'string') return [{ line: 1, reason: 'bad title' }];
  if (text.length > MAX_BYTES * 4) return [{ line: 1, reason: 'too large' }];
  const all = splitLines(text);
  const lines = all.slice(0, MAX_LINES);
  if (lines.length === 0) errors.push({ line: 1, reason: 'bad title' });
  const seenIds = new Set();
  const planTasks = new Map();
  let section = -1;
  let last = -1;

  const err = (line, reason) => errors.push({ line, reason });

  const checkRef = (n, rawRef) => {
    const ref = parseRef(rawRef, root);
    if (!ref.ok) return err(n, 'bad ref');
    const found = resolveFile(root, ref.segs);
    if (found === null) return err(n, `pointer missing ${ref.path}`);
    if (ref.anchor === null || ticketLocal(ref.anchor) === null || !isPlanFile(ref.segs.at(-1))) return undefined;
    if (!planTasks.has(ref.path)) {
      const body = readPlanText(root, ref.segs, found.full);
      planTasks.set(ref.path, body === null ? new Set() : new Set(parsePlan(body, { slug: runSlugOf(ref.segs) }).tasks.map((t) => t.id)));
    }
    if (!planTasks.get(ref.path).has(ref.anchor)) err(n, `task missing ${ref.anchor} in ${ref.path}`);
    return undefined;
  };

  lines.forEach((line, i) => {
    const n = i + 1;
    if (n === 1) {
      const topic = line.startsWith('# Wayfinder: ') ? line.slice('# Wayfinder: '.length) : '';
      const ok = line.length <= MAX_LINE && topic.trim().length > 0 && topic.length <= MAX_TOPIC && !FORBIDDEN_RE.test(line);
      if (!ok) err(n, 'bad title');
      return;
    }
    if (line === '') return;
    if (line.length > MAX_LINE) return err(n, 'line too long');
    const shape = () => err(n, 'not a pointer or decision line');
    if (FORBIDDEN_RE.test(line)) return shape();
    if (line.trimStart().startsWith('```') || line.trimStart().startsWith('~~~') || line.includes('```')) return err(n, 'fence');
    const heading = SECTIONS.indexOf(line);
    if (heading !== -1) {
      if (heading <= last) err(n, 'heading order');
      last = Math.max(last, heading);
      section = heading;
      return undefined;
    }
    if (section === -1 || !line.startsWith('- ')) return shape();

    if (section === 2) {
      const at = line.indexOf(POINTER_MARK);
      if (at === -1) return shape();
      const why = line.slice(at + POINTER_MARK.length);
      if (why.trim().length === 0 || why.length > MAX_WHY) return shape();
      return checkRef(n, line.slice(2, at));
    }

    const at = line.lastIndexOf(SRC_MARK);
    const prefix = `- ${PREFIX[section]}-`;
    if (at === -1 || !line.startsWith(prefix)) return shape();
    const head = line.slice(0, at);
    const space = head.indexOf(' ', prefix.length);
    if (space === -1) return shape();
    const num = head.slice(prefix.length, space);
    const body = head.slice(space + 1);
    if (!ID_RE.test(num) || body.trim().length === 0 || body.length > MAX_TEXT) return shape();
    const refs = line.slice(at + SRC_MARK.length).split(', ');
    if (refs.length > MAX_REFS) return shape();
    const id = `${PREFIX[section]}-${num}`;
    if (seenIds.has(id)) err(n, `duplicate id ${id}`);
    seenIds.add(id);
    for (const r of refs) checkRef(n, r);
    return undefined;
  });
  if (all.length > MAX_LINES) err(MAX_LINES + 1, 'too large');
  return errors;
}

function refuse(reason) {
  throw new Refusal(reason);
}

// Reads the map file: a real file, one link, no link on the way, under the size caps, clean UTF-8.
function readMap(root, rel) {
  let realRoot;
  try {
    realRoot = fs.realpathSync.native(root);
  } catch {
    return refuse('unreadable');
  }
  const segs = rel.split('/');
  let cur = root;
  for (let i = 0; i < segs.length; i++) {
    cur = path.join(cur, segs[i]);
    let st;
    try {
      st = fs.lstatSync(cur, { bigint: true });
    } catch {
      return refuse('unreadable');
    }
    if (st.isSymbolicLink()) return refuse('link');
    if (i < segs.length - 1 ? !st.isDirectory() : !st.isFile()) return refuse('unreadable');
  }
  let fd = null;
  try {
    if (fs.realpathSync.native(cur) !== path.join(realRoot, ...segs)) return refuse('link');
    const st = fs.lstatSync(cur, { bigint: true });
    if (st.nlink !== 1n) return refuse('link');
    if (st.size > BigInt(MAX_BYTES)) return refuse('too large');
    fd = fs.openSync(cur, fs.constants.O_RDONLY | (process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW ?? 0)));
    const f = fs.fstatSync(fd, { bigint: true });
    if (!f.isFile() || f.dev !== st.dev || f.ino !== st.ino || f.nlink !== 1n) return refuse('link');
    const buf = Buffer.alloc(Number(f.size) + 1);
    let off = 0;
    while (off < buf.length) {
      const got = fs.readSync(fd, buf, off, buf.length - off, off);
      if (got === 0) break;
      off += got;
    }
    if (off > MAX_BYTES) return refuse('too large');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf.subarray(0, off));
    } catch {
      return refuse('not UTF-8');
    }
    if (splitLines(text).length > MAX_LINES) return refuse('too large');
    return text;
  } catch (error) {
    if (error instanceof Refusal) throw error;
    return refuse('unreadable');
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

export function main(args, { root } = {}) {
  try {
    if (!Array.isArray(args) || args.length !== 2 || args[0] !== 'check' || typeof args[1] !== 'string') return refuse('usage: wayfinder check <file>');
    const file = args[1];
    if (file.length > MAX_ARG || FORBIDDEN_RE.test(file) || !FILE_RE.test(file)) return refuse('bad file name');
    const text = readMap(root ?? process.cwd(), file);
    const errors = validate(text, { root: root ?? process.cwd() });
    const lines = errors.map((e) => `ERROR ${e.line}: ${e.reason}`);
    lines.push(`wayfinder: ${errors.length} errors`);
    return { code: errors.length === 0 ? 0 : 1, lines };
  } catch (error) {
    if (error instanceof Refusal) return { code: 3, lines: [`refused: ${error.message}`] };
    return { code: 3, lines: ['refused: unreadable'] };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = main(process.argv.slice(2));
  process.stdout.write(`${result.lines.join('\n')}\n`);
  process.exitCode = result.code;
}
