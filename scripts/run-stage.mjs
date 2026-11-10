// Stage record of a run: where a run stands between Gates. Report only; nothing here blocks a Step or a Gate.
// contract: docs/contracts/run-stage.md v1.1
// Storage: .company/work/<slug>/stage.jsonl (<slug> is a work folder name or <ID>/<NN>-<pb>), append-only, one JSON object per line, LF.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isRunSlug, workParts, exactWorkPath, WorkFolderRefusal } from '../mods/lib/work-folder.mjs';

export const STAGES = ['brief', 'plan', 'build', 'review', 'ship-gate'];
export const MAX_LINE = 128;
export const MAX_FILE = 16 * 1024;
export const MAX_LINES = 200;

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const KEYS = ['v', 'at', 'stage'];
const NL = '\n';
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const io = { fs, path };

const view = (slug, stage, at, state) => ({ v: 1, slug, stage, at, state });

// { dir } for a real run folder, or { reason } as one of the refusal reasons. A v3 slug checks each of its two parts.
function resolveRun(root, slug) {
  const parts = typeof slug === 'string' && isRunSlug(slug) ? workParts(slug) : null;
  if (parts === null) return { reason: 'bad slug' };
  try {
    if (exactWorkPath(io, root, parts) !== 'exact') return { reason: 'no run folder' };
  } catch (error) {
    if (error instanceof WorkFolderRefusal) return { reason: 'wrong letter case' };
    return { reason: 'no run folder' };
  }
  const work = path.join(root, '.company', 'work');
  try {
    const realWork = path.join(fs.realpathSync.native(root), '.company', 'work');
    if (fs.realpathSync.native(work) !== realWork) return { reason: 'no run folder' };
    let dir = work;
    let realDir = realWork;
    for (const part of parts) {
      dir = path.join(dir, part);
      realDir = path.join(realDir, part);
      const st = fs.lstatSync(dir);
      if (st.isSymbolicLink() || !st.isDirectory()) return { reason: 'no run folder' };
      if (fs.realpathSync.native(dir) !== realDir) return { reason: 'no run folder' };
    }
    return { dir };
  } catch {
    return { reason: 'no run folder' };
  }
}

function validRecord(text) {
  if (Buffer.byteLength(text) > MAX_LINE) return null;
  let rec;
  try {
    rec = JSON.parse(text);
  } catch {
    return null;
  }
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return null;
  const keys = Object.keys(rec);
  if (keys.length !== KEYS.length || !keys.every(k => KEYS.includes(k))) return null;
  if (rec.v !== 1 || typeof rec.at !== 'string' || !AT.test(rec.at)) return null;
  if (typeof rec.stage !== 'string' || !STAGES.includes(rec.stage)) return null;
  return rec;
}

// Opens `file` without following a link; the handle must be the regular, single-link file lstat saw (same dev and ino).
// Returns { fd, st } or { code } when the file is missing (ENOENT) or refused.
function openRegular(file, flags) {
  let lst;
  try {
    lst = fs.lstatSync(file, { bigint: true });
  } catch (error) {
    return { code: error.code === 'ENOENT' ? 'ENOENT' : 'EREFUSED' };
  }
  if (lst.isSymbolicLink() || !lst.isFile()) return { code: 'EREFUSED' };
  let fd;
  try {
    fd = fs.openSync(file, flags | NOFOLLOW);
  } catch {
    return { code: 'EREFUSED' };
  }
  try {
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile() || st.nlink !== 1n || st.dev !== lst.dev || st.ino !== lst.ino) {
      fs.closeSync(fd);
      return { code: 'EREFUSED' };
    }
    return { fd, st };
  } catch {
    fs.closeSync(fd);
    return { code: 'EREFUSED' };
  }
}

// Reads at most MAX_FILE + 1 bytes through the handle; throws when the file is over the cap (it grew after fstat).
function readCapped(fd) {
  const buf = Buffer.alloc(MAX_FILE + 1);
  let off = 0;
  while (off < buf.length) {
    const n = fs.readSync(fd, buf, off, buf.length - off, off);
    if (n === 0) break;
    off += n;
  }
  if (off > MAX_FILE) throw new Error('too large');
  return buf.toString('utf8', 0, off);
}

export function readStage(root, slug) {
  const run = resolveRun(root, slug);
  if (run.reason === 'bad slug' || run.reason === 'wrong letter case') return view(null, null, null, 'none');
  if (run.reason) return view(slug, null, null, 'none');
  const file = path.join(run.dir, 'stage.jsonl');
  const bad = view(slug, null, null, 'unreadable');
  const opened = openRegular(file, fs.constants.O_RDONLY);
  if (opened.code === 'ENOENT') return view(slug, null, null, 'none');
  if (opened.code) return bad;
  let raw;
  try {
    if (opened.st.size > BigInt(MAX_FILE)) return bad;
    raw = readCapped(opened.fd);
  } catch {
    return bad;
  } finally {
    fs.closeSync(opened.fd);
  }
  if (raw.length === 0) return view(slug, null, null, 'none');
  const lines = raw.endsWith(NL) ? raw.slice(0, -1).split(NL) : raw.split(NL);
  if (lines.length > MAX_LINES) return bad;
  const rec = validRecord(lines[lines.length - 1]);
  return rec ? view(slug, rec.stage, rec.at, 'recorded') : bad;
}

// Returns { ok: true } or { reason }.
export function setStage(root, slug, stage, now = new Date()) {
  const run = resolveRun(root, slug);
  if (run.reason) return { reason: run.reason };
  if (typeof stage !== 'string' || !STAGES.includes(stage)) return { reason: 'unknown stage' };
  const file = path.join(run.dir, 'stage.jsonl');
  const at = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const line = `${JSON.stringify({ v: 1, at, stage })}${NL}`;
  const unreadable = { reason: 'stage file unreadable' };
  const opened = openRegular(file, fs.constants.O_RDWR | fs.constants.O_APPEND);
  if (opened.code === 'ENOENT') {
    try {
      const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
      try {
        if (!fs.fstatSync(fd).isFile()) return unreadable;
        fs.writeSync(fd, line);
        return { ok: true };
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return unreadable;
    }
  }
  if (opened.code) return unreadable;
  try {
    if (opened.st.size + BigInt(line.length) > BigInt(MAX_FILE)) return { reason: 'stage file full' };
    const raw = readCapped(opened.fd);
    if (raw.length > 0 && !raw.endsWith(NL)) return unreadable;
    if (raw.split(NL).length - 1 >= MAX_LINES) return { reason: 'stage file full' };
    fs.writeSync(opened.fd, line);
    return { ok: true };
  } catch {
    return unreadable;
  } finally {
    fs.closeSync(opened.fd);
  }
}

const USAGE = 'usage: run-stage set <slug> <stage> | run-stage show <slug> --json';

export function main(argv, { cwd = process.cwd(), out = line => console.log(line) } = {}) {
  const [cmd, slug, arg, ...rest] = argv;
  if (cmd === 'set' && argv.length === 3) {
    const r = setStage(cwd, slug, arg);
    if (r.reason) {
      out(`refused: ${r.reason}`);
      return 2;
    }
    return 0;
  }
  if (cmd === 'show' && argv.length === 3 && arg === '--json' && rest.length === 0) {
    out(JSON.stringify(readStage(cwd, slug)));
    return 0;
  }
  out(USAGE);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
