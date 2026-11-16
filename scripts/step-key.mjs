// step-key: reuse key for Fix-round Steps. Every doubt, error or missing value is a miss, never a hit.
// contract: docs/contracts/step-key.md v1.0
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exactWorkPath } from '../mods/lib/work-folder.mjs';

const MAX_LOG = 256 * 1024;
const MAX_ROW = 1024;
const MAX_FILE = 256 * 1024;
const MAX_TOOL_FILE = 8 * 1024 * 1024;
const MAX_PATHS = 5000;
const MAX_DEPTH = 12;
const COLS = ['v', 'step', 'dispatch', 'model', 'inputs', 'node', 'os', 'lock', 'check', 'env'];
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'Cargo.lock', 'go.sum', 'poetry.lock', 'uv.lock', 'Gemfile.lock', 'composer.lock', 'packages.lock.json']);
const RESULTS = ['miss', 'hit', 'uncacheable', 'cold', 'verify', 'reused', 'outcome', 'agree', 'disagree', 'purge'];
const STEP_KINDS = new Set(['miss', 'hit', 'uncacheable', 'cold', 'verify', 'reused']);
const ENV_EXACT = new Set(['NODE_OPTIONS', 'NODE_ENV', 'CLAUDE_PLUGIN_ROOT']);
const HEX64 = /^[0-9a-f]{64}$/;
const NN_ROLE = /^(\d{1,3})-([a-z][a-z0-9-]{0,40})$/;
const SEG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const CTRL = /[\u0000-\u001f\u007f]/;

class SkErr extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}
class Refuse extends Error {}

const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const refuse = (why) => { throw new Refuse(why); };

// Pure key helpers.

function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function canonDispatch(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/ +$/, ''))
    .filter((l) => !l.startsWith('Round:') && !l.startsWith('Output:'))
    .join('\n');
}

function envPairs(env, salt) {
  const pairs = [];
  for (const [name, value] of Object.entries(env ?? {})) {
    const up = name.toUpperCase();
    if (value === undefined) continue;
    if ((up.startsWith('AICO_') && up !== 'AICO_COLD') || ENV_EXACT.has(up)) {
      pairs.push([up, crypto.createHmac('sha256', salt).update(String(value)).digest('hex').slice(0, 16)]);
    }
  }
  return pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
}

// opts: { role, ticket, dispatch, model, env, salt, node, os, io: { inputLines(), lock(), check() } }
export function columns(opts) {
  const io = opts.io;
  const lines = [...new Set(io.inputLines())].sort();
  return {
    v: 1,
    step: opts.ticket ? `${opts.role}:${opts.ticket}` : opts.role,
    dispatch: sha(canonDispatch(opts.dispatch)),
    model: opts.model,
    inputs: sha(lines.join('\n')),
    node: opts.node,
    os: opts.os,
    lock: io.lock(),
    check: io.check(),
    env: envPairs(opts.env, opts.salt),
  };
}

const isColumnSet = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).length === COLS.length && COLS.every((c) => Object.hasOwn(x, c));

export function compare(a, b) {
  if (!isColumnSet(a) || !isColumnSet(b)) return 'columns';
  for (const c of COLS) {
    if (canon(a[c]) !== canon(b[c])) return c;
  }
  return null;
}

// Argument checks.

function cleanRel(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 300 || CTRL.test(p)) refuse('path');
  const s = p.replace(/\\/g, '/');
  if (s.startsWith('/') || /^[A-Za-z]:/.test(s)) refuse('path');
  const segs = s.split('/').filter((x) => x !== '' && x !== '.');
  if (segs.length === 0) refuse('path');
  for (const g of segs) {
    if (g === '..' || !/^[^<>:"|?*]+$/.test(g)) refuse('path');
  }
  return segs.join('/');
}

function parseSlug(slug) {
  const segs = typeof slug === 'string' ? slug.split('/') : [];
  if (segs.length < 1 || segs.length > 4 || !segs.every((s) => SEG.test(s))) refuse('slug');
  return segs;
}

const VALUE_OPTS = new Set(['--round', '--dispatch', '--model', '--task', '--input', '--files', '--undeclared', '--output']);
const FLAG_OPTS = new Set(['--verify', '--cold']);
const REPEAT = new Set(['--input', '--undeclared']);
const ALLOWED = {
  before: new Set(['--round', '--dispatch', '--model', '--task', '--input', '--files', '--undeclared', '--verify', '--cold']),
  reuse: new Set(['--output', '--cold']),
  after: new Set(['--cold']),
  stats: new Set(),
};

function parseArgs(argv) {
  const cmd = argv[0];
  if (!Object.hasOwn(ALLOWED, cmd ?? '')) refuse('command');
  const pos = [];
  const vals = new Map();
  const flags = new Set();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    if (!ALLOWED[cmd].has(a)) refuse('option');
    if (FLAG_OPTS.has(a)) { flags.add(a); continue; }
    if (!VALUE_OPTS.has(a) || i + 1 >= argv.length) refuse('option');
    const v = argv[++i];
    if (REPEAT.has(a)) vals.set(a, [...(vals.get(a) ?? []), v]);
    else if (vals.has(a)) refuse('option');
    else vals.set(a, v);
  }
  const want = cmd === 'stats' ? 1 : 2;
  if (pos.length !== want) refuse('arguments');
  const segs = parseSlug(pos[0]);
  const c = { cmd, segs, flags, vals };
  if (want === 2) {
    const m = NN_ROLE.exec(pos[1]);
    if (!m) refuse('step');
    c.nn = pos[1];
    c.num = m[1];
    c.role = m[2];
  }
  return c;
}

function validateBefore(c) {
  const o = { verify: c.flags.has('--verify') };
  const round = c.vals.get('--round');
  if (round === undefined || !/^\d{1,3}$/.test(round)) refuse('round');
  o.round = Number(round);
  const d = c.vals.get('--dispatch');
  o.dispatch = d === undefined ? null : d === '-' ? '-' : cleanRel(d);
  const m = c.vals.get('--model');
  if (m !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/.test(m)) refuse('model');
  o.model = m ?? null;
  const t = c.vals.get('--task');
  if (t !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(t)) refuse('task');
  o.ticket = t ?? null;
  o.inputs = (c.vals.get('--input') ?? []).map(cleanRel);
  const f = c.vals.get('--files');
  if (f === undefined || f === 'none') o.files = 'none';
  else o.files = [...new Set(f.split(',').map(cleanRel))].sort();
  o.undeclared = (c.vals.get('--undeclared') ?? []).map((u) => {
    if (u.length === 0 || u.length > 80 || CTRL.test(u)) refuse('undeclared');
    return u.replace(/[^A-Za-z0-9 ._:-]/g, '?');
  });
  return o;
}

function isCold(c) {
  const v = process.env.AICO_COLD;
  return (v !== undefined && v !== '' && v !== '0' && v !== 'false') || c.flags.has('--cold');
}

// Files and git.

const root = () => process.cwd();

function gitEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!/^GIT_/i.test(k)) env[k] = v;
  }
  return {
    ...env,
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function git(args, input) {
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
      cwd: root(), env: gitEnv(), input, maxBuffer: 16 * 1024 * 1024, timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
  } catch {
    throw new SkErr('git');
  }
}

function collect(label, abs, rootReal, out, budget, depth = 0) {
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') { out.push({ label, missing: true }); return; }
    throw new SkErr('read');
  }
  if (st.isSymbolicLink() || depth > MAX_DEPTH) throw new SkErr('read');
  if (rootReal) {
    let real;
    try { real = fs.realpathSync.native(abs); } catch { throw new SkErr('read'); }
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw new SkErr('read');
  }
  if (st.isDirectory()) {
    let names;
    try { names = fs.readdirSync(abs).sort(); } catch { throw new SkErr('read'); }
    for (const n of names) {
      if (CTRL.test(n)) throw new SkErr('read');
      collect(`${label}/${n}`, path.join(abs, n), rootReal, out, budget, depth + 1);
    }
    return;
  }
  if (!st.isFile()) throw new SkErr('read');
  if (++budget.n > MAX_PATHS) throw new SkErr('limit');
  out.push({ label, fsPath: abs });
}

function blobIds(paths) {
  if (paths.length === 0) return [];
  const res = git(['hash-object', '--no-filters', '--stdin-paths'], `${paths.join('\n')}\n`).toString('utf8').split('\n').filter(Boolean);
  if (res.length !== paths.length || !res.every((x) => /^[0-9a-f]{40,64}$/.test(x))) throw new SkErr('git');
  return res;
}

// entries: [{ label, abs }]; returns sorted-ready lines `<label>\0<blob id|missing>`.
function hashLines(entries, rootReal, budget) {
  const found = [];
  for (const e of entries) collect(e.label, e.abs, e.outside ? null : rootReal, found, budget);
  const files = found.filter((x) => !x.missing);
  const ids = blobIds(files.map((x) => x.fsPath));
  const byLabel = new Map(files.map((x, i) => [x.label, ids[i]]));
  return found.map((x) => `${x.label}\0${x.missing ? 'missing' : byLabel.get(x.label)}`);
}

function treeLine(rootReal, budget) {
  const tree = git(['rev-parse', '--verify', 'HEAD^{tree}']).toString('utf8').trim();
  const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  const paths = status.toString('utf8').split('\0').filter(Boolean).map((e) => e.slice(3));
  if (paths.length > MAX_PATHS) throw new SkErr('limit');
  const lines = hashLines(paths.map((p) => ({ label: p, abs: path.join(root(), p) })), rootReal, budget);
  return `*tree\0${tree}\0${sha(status)}\0${sha(lines.sort().join('\n'))}`;
}

function lockColumn(rootReal, budget) {
  const names = git(['ls-files', '-z']).toString('utf8').split('\0').filter((p) => LOCKFILES.has(p.split('/').pop()));
  if (names.length === 0) return 'none';
  const lines = hashLines(names.map((p) => ({ label: p, abs: path.join(root(), p) })), rootReal, budget);
  return sha(lines.sort().join('\n'));
}

function checkColumn(pluginRoot) {
  const p = path.join(pluginRoot, 'scripts', 'check.mjs');
  let st;
  try { st = fs.lstatSync(p); } catch (e) {
    if (e.code === 'ENOENT') return 'missing';
    throw new SkErr('read');
  }
  if (!st.isFile() || st.size > MAX_TOOL_FILE) throw new SkErr('read');
  try { return sha(fs.readFileSync(p)); } catch { throw new SkErr('read'); }
}

function pluginRoot() {
  const e = process.env.CLAUDE_PLUGIN_ROOT;
  return e ? path.resolve(e) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

// A regular file with one link, whose real path equals its lexical path under the real root, read through a handle
// tied by device and inode to the checked entry. Status 'missing' only for an absent entry.
function readPlain(abs, limit) {
  const rr = fs.realpathSync.native(root());
  const rel = path.relative(root(), abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return { status: 'refused' };
  const lexical = path.join(rr, rel);
  let lst;
  try { lst = fs.lstatSync(lexical, { bigint: true }); } catch (e) {
    return { status: e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 'missing' : 'error' };
  }
  if (!lst.isFile() || lst.nlink !== 1n || lst.ino === 0n) return { status: 'refused' };
  if (lst.size > BigInt(limit)) return { status: 'big' };
  let real;
  try { real = fs.realpathSync.native(lexical); } catch { return { status: 'refused' }; }
  if (real !== lexical || !real.startsWith(rr + path.sep)) return { status: 'refused' };
  let fd;
  try {
    fd = fs.openSync(lexical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile() || st.nlink !== 1n || st.size > BigInt(limit)) return { status: 'refused' };
    if (st.ino !== lst.ino || st.dev !== lst.dev) return { status: 'refused' };
    const buf = Buffer.alloc(Number(st.size));
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return { status: 'ok', buf: buf.subarray(0, off) };
  } catch {
    return { status: 'error' };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function readBounded(abs, limit, kind = 'read') {
  const r = readPlain(abs, limit);
  if (r.status === 'ok') return r.buf;
  throw new SkErr(r.status === 'big' ? 'limit' : kind);
}

function readStdin() {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  let total = 0;
  for (;;) {
    let n;
    try { n = fs.readSync(0, buf, 0, buf.length, null); } catch (e) {
      if (e.code === 'EOF') break;
      throw new SkErr('read');
    }
    if (n === 0) break;
    total += n;
    if (total > MAX_FILE) throw new SkErr('limit');
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks);
}

// Run folder, log and salt.

function runPaths(segs) {
  const rel = ['.company', 'work', ...segs];
  return { rel: rel.join('/'), abs: path.join(root(), ...rel), chain: rel };
}

function checkRunDir(run, kind) {
  try {
    const rr = fs.realpathSync.native(root());
    if (exactWorkPath({ fs, path }, rr, run.chain.slice(2)) !== 'exact') throw new SkErr(kind);
  } catch { throw new SkErr(kind); }
  let cur = root();
  for (const seg of run.chain) {
    cur = path.join(cur, seg);
    let st;
    try { st = fs.lstatSync(cur); } catch { throw new SkErr(kind); }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new SkErr(kind);
  }
}

const logFile = (run) => path.join(run.abs, 'step-keys.jsonl');

function validRow(r) {
  if (!RESULTS.includes(r.result) || typeof r.step !== 'string' || !NN_ROLE.test(r.step)) return false;
  if (typeof r.id !== 'string' || r.id.length > 120 || !Number.isInteger(r.round)) return false;
  for (const k of ['key', 'hsha']) {
    if (r[k] !== undefined && !(typeof r[k] === 'string' && HEX64.test(r[k]))) return false;
  }
  return true;
}

function readRows(run) {
  checkRunDir(run, 'log');
  const p = logFile(run);
  const r = readPlain(p, MAX_LOG);
  if (r.status === 'missing') return [];
  if (r.status === 'big') throw new SkErr('limit');
  if (r.status !== 'ok') throw new SkErr('log');
  const text = r.buf.toString('utf8');
  if (text.length > MAX_LOG) throw new SkErr('limit');
  if (text === '') return [];
  if (!text.endsWith('\n')) throw new SkErr('parse');
  const rows = [];
  for (const line of text.slice(0, -1).split('\n')) {
    if (Buffer.byteLength(line) > MAX_ROW) throw new SkErr('limit');
    let v;
    try { v = JSON.parse(line); } catch { throw new SkErr('parse'); }
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new SkErr('parse');
    const row = Object.assign(Object.create(null), v);
    if (!validRow(row)) throw new SkErr('parse');
    rows.push(row);
  }
  return rows;
}

const size = (x) => Buffer.byteLength(JSON.stringify(x)) + 1;
const filesDigest = (f) => (Array.isArray(f) ? `sha256:${sha(JSON.stringify([...f].sort())).slice(0, 24)}` : f);

function fit(row) {
  const r = { ...row };
  if (typeof r.reason === 'string') r.reason = r.reason.slice(0, 120);
  if (size(r) <= MAX_ROW) return r;
  delete r.cols;
  if (size(r) <= MAX_ROW) return r;
  for (const k of ['outcome', 'cached', 'cold']) {
    if (r[k] && typeof r[k] === 'object') r[k] = { ...r[k], files: filesDigest(r[k].files) };
  }
  return size(r) <= MAX_ROW ? r : null;
}

function appendRow(run, row) {
  const r = fit(row);
  if (!r) return false;
  const line = `${JSON.stringify(r)}\n`;
  checkRunDir(run, 'log');
  const p = logFile(run);
  let cur = 0;
  try {
    const st = fs.lstatSync(p);
    if (!st.isFile()) throw new SkErr('log');
    cur = st.size;
  } catch (e) {
    if (e instanceof SkErr) throw e;
    if (e.code !== 'ENOENT') throw new SkErr('log');
  }
  if (cur + Buffer.byteLength(line) > MAX_LOG) throw new SkErr('limit');
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = fs.openSync(p, flags, 0o644);
    fs.writeSync(fd, line);
  } catch { throw new SkErr('log'); } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return true;
}

function tryAppend(run, row) {
  try { return appendRow(run, row); } catch { return false; }
}

function loadSalt(run) {
  const p = path.join(run.abs, 'step-keys.salt');
  for (let attempt = 0; attempt < 2; attempt++) {
    checkRunDir(run, 'salt');
    const r = readPlain(p, 32);
    if (r.status !== 'missing') {
      if (r.status !== 'ok' || r.buf.length !== 32) throw new SkErr('salt');
      return r.buf;
    }
    let fd;
    try {
      fd = fs.openSync(p, 'wx', 0o600);
      fs.writeSync(fd, crypto.randomBytes(32));
    } catch (err) {
      if (err.code === 'EEXIST') continue;
      throw new SkErr('salt');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  throw new SkErr('salt');
}

// Handoff reading.

function parseHandoff(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const fm = new Map();
  for (let i = 1; i < end; i++) {
    const m = /^([a-z][a-z-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (m && !fm.has(m[1])) fm.set(m[1], m[2].trim());
  }
  let status = fm.get('status') ?? 'unknown';
  const fence = lines.indexOf('```aico-top', end + 1);
  if (fence > 0) {
    for (let i = fence + 1; i < lines.length && lines[i] !== '```'; i++) {
      const m = /^status:[ \t]*(.*)$/.exec(lines[i]);
      if (m && m[1].trim() !== status) status = 'conflict';
    }
  }
  let files = [];
  const ft = fm.get('files-touched');
  if (ft !== undefined) {
    const m = /^\[(.*)\]$/.exec(ft);
    if (!m) return null;
    files = m[1].split(',').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
  }
  files = [...new Set(files)].sort();
  const bi = lines.indexOf('## Blocking', end + 1);
  const tags = new Set();
  let clean = false;
  if (bi > 0) {
    const body = [];
    for (let i = bi + 1; i < lines.length && !lines[i].startsWith('## '); i++) {
      if (lines[i].trim()) body.push(lines[i].trim());
    }
    for (const l of body) {
      for (const m of l.matchAll(/\[(contract|spec|security|test)\]/g)) tags.add(m[1]);
    }
    clean = body.length > 0 && body.every((l) => /^-[ \t]*none\.?$/i.test(l));
  }
  return { status, blocking: [...tags].sort(), files, clean };
}

const outcomeOf = (p) => ({ status: p.status, blocking: p.blocking, files: p.files });
const outcomeKey = (o) => canon({
  status: o?.status ?? null,
  blocking: Array.isArray(o?.blocking) ? [...o.blocking].sort() : null,
  files: filesDigest(o?.files ?? null),
});

function covered(declared, p) {
  const n = path.posix.normalize(p);
  if (n.startsWith('..') || n.startsWith('/') || /^[A-Za-z]:/.test(n)) return false;
  return declared.some((f) => n === f || n.startsWith(`${f}/`));
}

function handoffInRun(run, rel) {
  if (typeof rel !== 'string' || CTRL.test(rel)) return null;
  const prefix = `${run.rel}/`;
  if (!rel.startsWith(prefix)) return null;
  const name = rel.slice(prefix.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(name)) return null;
  return path.join(run.abs, name);
}

function readHandoffRel(run, rel) {
  const abs = handoffInRun(run, rel);
  if (!abs) throw new SkErr('read');
  checkRunDir(run, 'read');
  return readBounded(abs, MAX_FILE);
}

// Log queries.

const purgedKeys = (rows) => new Set(rows.filter((r) => r.result === 'purge' && r.key).map((r) => r.key));
const isEntry = (r) => r.result === 'outcome' && r.hsha !== undefined && r.key !== undefined && typeof r.handoff === 'string';

function lastIndex(rows, fn, from = rows.length - 1) {
  for (let i = from; i >= 0; i--) if (fn(rows[i])) return i;
  return -1;
}

function diffColumn(rows, idx, cols) {
  const e = rows[idx];
  const j = lastIndex(rows, (r) => r.step === e.step && r.key === e.key && r.cols && typeof r.cols === 'object', idx - 1);
  return (j >= 0 ? compare(rows[j].cols, cols) : null) ?? 'key';
}

function decide(run, rows, id, key, cols) {
  const idx = lastIndex(rows, (r) => isEntry(r) && r.id === id);
  if (idx < 0) return { miss: 'first' };
  const e = rows[idx];
  if (e.key !== key) return { miss: diffColumn(rows, idx, cols) };
  if (purgedKeys(rows).has(key)) return { miss: 'purged' };
  try {
    if (sha(readHandoffRel(run, e.handoff)) !== e.hsha) return { miss: 'handoff-changed' };
  } catch {
    return { miss: 'handoff-changed' };
  }
  return { hit: e.step };
}

// Commands.

const out = (s) => { process.stdout.write(`${s}\n`); };
const now = () => new Date().toISOString();

function dispatchText(d) {
  if (d === '-') return readStdin().toString('utf8');
  return readBounded(path.join(root(), d), MAX_FILE).toString('utf8');
}

function declaredInputs(c, o) {
  const list = new Set([...o.inputs, '.company/project.md']);
  if (Array.isArray(o.files)) for (const f of o.files) list.add(f);
  if (fs.existsSync(path.join(root(), '.company', 'standards.md'))) list.add('.company/standards.md');
  const entries = [...list].sort().map((p) => ({ label: p, abs: path.join(root(), ...p.split('/')) }));
  entries.push({ label: `plugin:agents/${c.role}.md`, abs: path.join(pluginRoot(), 'agents', `${c.role}.md`), outside: true });
  return entries;
}

function cmdBefore(c) {
  const o = validateBefore(c);
  const run = runPaths(c.segs);
  const id = o.ticket ? `${c.role}:${o.ticket}` : c.role;
  const base = { v: 1, at: now(), step: c.nn, id, round: o.round };
  if (isCold(c)) {
    tryAppend(run, { ...base, result: 'cold', reason: 'cold' });
    return out('cold');
  }
  const why = o.dispatch === null ? 'no dispatch' : o.model === null ? 'no model'
    : o.undeclared.length > 0 ? `undeclared ${o.undeclared[0]}` : null;
  if (why) {
    tryAppend(run, { ...base, result: 'uncacheable', reason: why });
    return out(`uncacheable ${why}`);
  }
  let rows;
  let cols;
  try {
    rows = readRows(run);
    const salt = loadSalt(run);
    const dispatch = dispatchText(o.dispatch);
    const rootReal = fs.realpathSync.native(root());
    const budget = { n: 0 };
    cols = columns({
      role: c.role, ticket: o.ticket, dispatch, model: o.model, env: process.env, salt,
      node: process.version, os: `${process.platform}-${process.arch}`,
      io: {
        inputLines: () => {
          const lines = hashLines(declaredInputs(c, o), rootReal, budget);
          if (o.files === 'none') lines.push(treeLine(rootReal, budget));
          return lines;
        },
        lock: () => lockColumn(rootReal, budget),
        check: () => checkColumn(pluginRoot()),
      },
    });
  } catch (e) {
    const kind = e instanceof SkErr ? e.kind : 'read';
    if (!['log', 'limit', 'parse'].includes(kind)) tryAppend(run, { ...base, result: 'miss', reason: `error:${kind}` });
    return out(`miss error:${kind}`);
  }
  const key = sha(canon(cols));
  const row = { ...base, key, cols, files: o.files };
  let result;
  let text;
  let reason;
  if (o.verify) {
    result = 'verify'; text = 'verify'; reason = 'verify';
  } else if (o.round < 1) {
    result = 'miss'; text = 'miss round0'; reason = 'round0';
  } else {
    const d = decide(run, rows, id, key, cols);
    if (d.hit) { result = 'hit'; text = `hit ${d.hit}`; reason = `entry ${d.hit}`; } else {
      result = 'miss'; text = `miss ${d.miss}`; reason = d.miss;
    }
  }
  let appended = false;
  try { appended = appendRow(run, { ...row, result, reason }); } catch (e) {
    return out(`miss error:${e instanceof SkErr ? e.kind : 'log'}`);
  }
  if (!appended) {
    tryAppend(run, { ...base, result: 'uncacheable', reason: 'row-limit' });
    return out('uncacheable row-limit');
  }
  return out(text);
}

function buildCopy(text, num, round, srcRel, key) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  let s = false;
  let r = false;
  for (let i = 1; i < end; i++) {
    if (!s && lines[i].startsWith('step:')) { lines[i] = `step: ${num}`; s = true; } else if (!r && lines[i].startsWith('round:')) { lines[i] = `round: ${round}`; r = true; }
  }
  const di = lines.indexOf('## Did', end + 1);
  if (!s || !r || di < 0) return null;
  lines.splice(di + 1, 0, `- Reused ${srcRel} (stepKey ${key.slice(0, 16)}); no Step ran.`);
  return lines.join('\n');
}

function cmdReuse(c) {
  const outRel = cleanRel(c.vals.get('--output'));
  if (isCold(c)) refuse('cold');
  const run = runPaths(c.segs);
  const outAbs = handoffInRun(run, outRel);
  if (!outAbs) refuse('output');
  let rows;
  try { rows = readRows(run); } catch (e) { refuse(`error:${e instanceof SkErr ? e.kind : 'log'}`); }
  const bi = lastIndex(rows, (r) => r.step === c.nn && STEP_KINDS.has(r.result));
  if (bi < 0 || rows[bi].result !== 'hit' || !rows[bi].key) refuse('no hit');
  const b = rows[bi];
  const ei = lastIndex(rows, (r) => isEntry(r) && r.id === b.id, bi - 1);
  if (ei < 0 || rows[ei].key !== b.key) refuse('no entry');
  const e = rows[ei];
  if (purgedKeys(rows).has(b.key)) refuse('purged');
  let src;
  try { src = readHandoffRel(run, e.handoff); } catch { refuse('handoff-changed'); }
  if (sha(src) !== e.hsha) refuse('handoff-changed');
  const copy = buildCopy(src.toString('utf8'), c.num, b.round, e.handoff, b.key);
  if (copy === null) refuse('handoff-shape');
  try { checkRunDir(run, 'log'); } catch { refuse('run folder'); }
  try {
    fs.lstatSync(outAbs);
    refuse('output exists');
  } catch (err) {
    if (err instanceof Refuse) throw err;
    if (err.code !== 'ENOENT') refuse('output');
  }
  let fd;
  try {
    fd = fs.openSync(outAbs, 'wx', 0o644);
    fs.writeSync(fd, copy);
  } catch { refuse('output'); } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  tryAppend(run, { v: 1, at: now(), step: c.nn, id: b.id, round: b.round, key: b.key, result: 'reused', reason: 'reuse', handoff: e.handoff });
  return out(`reused ${e.handoff}`);
}

function cmdAfter(c) {
  const run = runPaths(c.segs);
  if (isCold(c)) {
    tryAppend(run, { v: 1, at: now(), step: c.nn, id: c.role, round: 0, result: 'cold', reason: 'cold' });
    return out('cold');
  }
  let rows;
  try { rows = readRows(run); } catch { return out('none'); }
  const bi = lastIndex(rows, (r) => r.step === c.nn && STEP_KINDS.has(r.result));
  const b = bi < 0 ? null : rows[bi];
  if (!b || !b.key || !['miss', 'hit', 'verify'].includes(b.result)) return out('none');
  const rowBase = { v: 1, step: c.nn, id: b.id, round: b.round, key: b.key };
  const handoffRel = `${run.rel}/${c.nn}.md`;
  let buf = null;
  try { buf = readHandoffRel(run, handoffRel); } catch { buf = null; }
  const parsed = buf ? parseHandoff(buf.toString('utf8')) : null;
  if (!parsed) {
    tryAppend(run, { ...rowBase, at: now(), result: 'outcome', reason: 'no handoff', outcome: { status: 'missing', blocking: [], files: [] } });
    return out('none');
  }
  if (b.files !== 'none' && (!Array.isArray(b.files) || parsed.files.some((f) => !covered(b.files, f)))) {
    tryAppend(run, { ...rowBase, at: now(), result: 'uncacheable', reason: 'files-touched outside Files' });
    return out('none');
  }
  const outcome = outcomeOf(parsed);
  const purged = purgedKeys(rows);
  const ri = lastIndex(rows, (r) => isEntry(r) && r.id === b.id && r.key === b.key && !purged.has(r.key), bi - 1);
  let verdict = 'none';
  if (ri >= 0) verdict = outcomeKey(rows[ri].outcome) === outcomeKey(outcome) ? 'agree' : 'disagree';
  const entry = parsed.status === 'done' && parsed.clean && verdict !== 'disagree';
  const outRow = { ...rowBase, at: now(), result: 'outcome', reason: entry ? 'entry' : 'no entry', outcome };
  if (entry) { outRow.handoff = handoffRel; outRow.hsha = sha(buf); }
  try {
    if (!appendRow(run, outRow)) return out('none');
    if (verdict === 'agree') appendRow(run, { ...rowBase, at: now(), result: 'agree', reason: 'cold agrees with cache' });
    if (verdict === 'disagree') {
      appendRow(run, { ...rowBase, at: now(), result: 'disagree', reason: 'cold wins', cached: rows[ri].outcome, cold: outcome });
      appendRow(run, { ...rowBase, at: now(), result: 'purge', reason: 'cold wins' });
    }
  } catch { return out('none'); }
  return out(verdict);
}

function cmdStats(c) {
  const run = runPaths(c.segs);
  let rows;
  try { rows = readRows(run); } catch (e) { refuse(`error:${e instanceof SkErr ? e.kind : 'log'}`); }
  for (const r of RESULTS) out(`${r} ${rows.filter((x) => x.result === r).length}`);
}

export function main(argv) {
  try {
    const c = parseArgs(argv);
    if (c.cmd === 'before') cmdBefore(c);
    else if (c.cmd === 'reuse') cmdReuse(c);
    else if (c.cmd === 'after') cmdAfter(c);
    else cmdStats(c);
  } catch (e) {
    out(`refused: ${e instanceof Refuse ? e.message : 'internal'}`);
    process.exitCode = 2;
  }
}

let direct = false;
try {
  direct = process.argv[1] !== undefined
    && fs.realpathSync.native(process.argv[1]) === fs.realpathSync.native(fileURLToPath(import.meta.url));
} catch { direct = false; }
if (direct) main(process.argv.slice(2));
