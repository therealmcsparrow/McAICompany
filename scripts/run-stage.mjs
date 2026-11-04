// Stage record of a run: where a run stands between Gates. Report only; nothing here blocks a Step or a Gate.
// Storage: .company/work/<slug>/stage.jsonl, append-only, one JSON object per line, LF.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isWorkFolder, exactWorkPath, WorkFolderRefusal } from '../mods/lib/work-folder.mjs';

export const STAGES = ['brief', 'plan', 'build', 'review', 'ship-gate'];
export const MAX_LINE = 128;
export const MAX_FILE = 16 * 1024;
export const MAX_LINES = 200;

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const KEYS = ['v', 'at', 'stage'];
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const io = { fs, path };

const view = (slug, stage, at, state) => ({ v: 1, slug, stage, at, state });

// { dir } for a real run folder, or { reason } as one of the refusal reasons.
function resolveRun(root, slug) {
  if (typeof slug !== 'string' || !isWorkFolder(slug)) return { reason: 'bad slug' };
  try {
    if (exactWorkPath(io, root, [slug]) !== 'exact') return { reason: 'no run folder' };
  } catch (error) {
    if (error instanceof WorkFolderRefusal) return { reason: 'wrong letter case' };
    return { reason: 'no run folder' };
  }
  const dir = path.join(root, '.company', 'work', slug);
  try {
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) return { reason: 'no run folder' };
    const realWork = path.join(fs.realpathSync.native(root), '.company', 'work');
    if (fs.realpathSync.native(dir) !== path.join(realWork, slug)) return { reason: 'no run folder' };
    if (fs.realpathSync.native(path.join(root, '.company', 'work')) !== realWork) return { reason: 'no run folder' };
  } catch {
    return { reason: 'no run folder' };
  }
  return { dir };
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

export function readStage(root, slug) {
  const run = resolveRun(root, slug);
  if (run.reason === 'bad slug' || run.reason === 'wrong letter case') return view(null, null, null, 'none');
  if (run.reason) return view(slug, null, null, 'none');
  const file = path.join(run.dir, 'stage.jsonl');
  let st;
  try {
    st = fs.lstatSync(file);
  } catch (error) {
    return view(slug, null, null, error.code === 'ENOENT' ? 'none' : 'unreadable');
  }
  const bad = view(slug, null, null, 'unreadable');
  if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_FILE) return bad;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return bad;
  }
  if (raw.length === 0) return view(slug, null, null, 'none');
  const lines = raw.endsWith('\n') ? raw.slice(0, -1).split('\n') : raw.split('\n');
  if (lines.length > MAX_LINES) return bad;
  const rec = validRecord(lines[lines.length - 1]);
  return rec ? view(slug, rec.stage, rec.at, 'recorded') : bad;
}

function append(file, line, existing) {
  const flags = existing
    ? fs.constants.O_WRONLY | fs.constants.O_APPEND | NOFOLLOW
    : fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_EXCL;
  const fd = fs.openSync(file, flags, 0o644);
  try {
    if (!fs.fstatSync(fd).isFile()) return false;
    fs.writeSync(fd, line);
    return true;
  } finally {
    fs.closeSync(fd);
  }
}

// Returns { ok: true } or { reason }.
export function setStage(root, slug, stage, now = new Date()) {
  const run = resolveRun(root, slug);
  if (run.reason) return { reason: run.reason };
  if (typeof stage !== 'string' || !STAGES.includes(stage)) return { reason: 'unknown stage' };
  const file = path.join(run.dir, 'stage.jsonl');
  const at = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const line = `${JSON.stringify({ v: 1, at, stage })}\n`;
  let st = null;
  try {
    st = fs.lstatSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') return { reason: 'stage file unreadable' };
  }
  if (st) {
    if (st.isSymbolicLink() || !st.isFile()) return { reason: 'stage file unreadable' };
    if (st.size + line.length > MAX_FILE) return { reason: 'stage file full' };
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return { reason: 'stage file unreadable' };
    }
    if (raw.length > 0 && !raw.endsWith('\n')) return { reason: 'stage file unreadable' };
    if (raw.split('\n').length - 1 >= MAX_LINES) return { reason: 'stage file full' };
  }
  try {
    return append(file, line, st !== null) ? { ok: true } : { reason: 'stage file unreadable' };
  } catch {
    return { reason: 'stage file unreadable' };
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
