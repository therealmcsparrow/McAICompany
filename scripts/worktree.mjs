#!/usr/bin/env node
// Worktree (contract: docs/contracts/worktree.md v1.1).Node built-ins only; cwd = product root.
// uses: docs/contracts/plan-tasks.md v1.3 docs/contracts/tier-sets.md v1.1
// One git worktree per parallel task, merged back into the run branch in plan order. Every git call is a fixed argument
// list run without a shell, in a scrubbed environment, with replace refs and grafts off; branches, worktree folders,
// record lines and git output are untrusted, and a failed or unexpected answer stops the command (docs/adr/0043-task-worktrees-outside-repo.md).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readParallel, sortByVisit, normalizePath, ParallelRecordError } from './plan-tasks.mjs';
import { WorkFolderRefusal, branchId, exactWorkPath, isWorkFolder } from '../mods/lib/work-folder.mjs';

const BRANCH_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const ID =/^(?:t\d{1,3}[a-z]?|proto)$/;
const FULL_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PATCH_NAME = /^(?:t\d{1,3}[a-z]?|proto)-\d{8}T\d{6}Z\.patch$/;
const IGNORED_NAME = /^(?:t\d{1,3}[a-z]?|proto)-\d{8}T\d{6}Z\.ignored$/;
const CONTROLS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const MAX_ARG_CHARS = 4096;
const MAX_PATH_CHARS = 200;
const MAX_LINE_BYTES = 512;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_LINES = 500;
const MAX_PATHS = 100;
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const IGNORED_CAPS = { files: 1000, file: 8 * 1024 * 1024, total: 64 * 1024 * 1024 };
// Dependency and build output: an ignored folder with one of these exact names is deleted with the worktree, not copied.
const REBUILDABLE = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'coverage', 'bin', 'obj', 'vendor', '.venv', 'venv', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.gradle', '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache'
]);
const LEAD = ['--no-replace-objects', '--no-optional-locks', '-c', 'core.fsmonitor=false'];

const USAGE = [
  'usage: worktree <command>',
  '  add <slug> <id> --base <full id>',
  '  changed <slug> <id>',
  '  merge <slug>',
  '  cleanup <slug> [--archive]',
  '  leftovers',
  '  protocheck <slug>'
].join('\n');

export class WorktreeRecordError extends Error {
  constructor(slug, line, reason) {
    super(`worktree record ${slug} line ${line}: ${reason}`);
    this.name = 'WorktreeRecordError';
    this.reason = reason;
  }
}

class Refusal extends Error {}

class GitFailure extends Error {
  constructor(reason, { overflow = false } = {}) {
    super(reason);
    this.overflow = overflow;
  }
}

// ---------------------------------------------------------------- files

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

const isPlain = (st) => st.isFile() && st.nlink === 1;
const isFolder = (st) => st.isDirectory() && !st.isSymbolicLink();

// Case-folded on win32, where the file system folds case; the extended-length prefix is dropped.
function sameKey(p) {
  const r = path.resolve(p.replace(/^\\\\\?\\/, ''));
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

function realOf(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

// The path has no link on it: its real path is its lexical path.
function isUnlinked(p) {
  const real = realOf(p);
  return real !== null && sameKey(real) === sameKey(p);
}

function handleMatches(fd, expect) {
  const f = fs.fstatSync(fd);
  return isPlain(f) && (!expect || (f.dev === expect.dev && f.ino === expect.ino));
}

// The real-path read rule: no link on the path, a regular file with one hard link, and the opened handle is that file.
function readFileChecked(file, max) {
  if (!isUnlinked(file)) throw new Error('path has a link');
  const st = lstatOrNull(file);
  if (!st || !isPlain(st)) throw new Error('not a plain file');
  if (st.size > max) throw new Error('file too large');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (!handleMatches(fd, st)) throw new Error('file changed');
    const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, max + 1));
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return buf.subarray(0, off);
  } finally {
    fs.closeSync(fd);
  }
}

// The run folder, with no link in .company, .company/work or the slug folder. Null when absent.
function runDir(root, slug) {
  let dir = root;
  for (const part of ['.company', 'work', slug]) {
    dir = path.join(dir, part);
    const st = lstatOrNull(dir);
    if (!st) return null;
    if (!isFolder(st)) return 'unsafe';
  }
  return dir;
}

// ---------------------------------------------------------------- record

const EVENT_KEYS = {
  add: ['task', 'base'],
  merge: ['task', 'commit', 'tip'],
  conflict: ['task', 'paths'],
  remove: ['task', 'commit'],
  archive: ['task', 'commit', 'patch']
};
const OPTIONAL_KEYS = { remove: ['ignored'], archive: ['ignored'] };

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function applyEvent(ids, rec) {
  if (!isPlainObject(rec)) return 'not an object';
  if (rec.v !== 1) return 'v must be 1';
  if (typeof rec.ev !== 'string' || !Object.hasOwn(EVENT_KEYS, rec.ev)) return 'ev is not allowed';
  const wanted = EVENT_KEYS[rec.ev];
  for (const key of Object.keys(rec)) {
    if (key !== 'v' && key !== 'at' && key !== 'ev' && !wanted.includes(key) && !OPTIONAL_KEYS[rec.ev]?.includes(key)) return 'unknown key';
  }
  for (const key of ['at', ...wanted]) if (!Object.hasOwn(rec, key)) return `missing key ${key}`;
  if (typeof rec.at !== 'string' || !TIME.test(rec.at) || Number.isNaN(Date.parse(rec.at)) || new Date(rec.at).toISOString().slice(0, 19) + 'Z' !== rec.at) {
    return 'at is not a UTC time';
  }
  if (typeof rec.task !== 'string' || !ID.test(rec.task)) return 'task is not a task id';
  for (const key of ['base', 'commit', 'tip']) {
    if (Object.hasOwn(rec, key) && !(typeof rec[key] === 'string' && FULL_ID.test(rec[key]))) return `${key} is not a full commit id`;
  }
  if (rec.ev === 'conflict') {
    if (!Array.isArray(rec.paths) || rec.paths.length > MAX_PATHS) return 'paths must be a list of at most 100 path keys';
    for (const k of rec.paths) {
      if (k === '?') continue;
      const n = typeof k === 'string' ? normalizePath(k) : { ok: false };
      if (!n.ok || n.key !== k) return 'paths holds a bad path key';
    }
  }
  if (rec.ev === 'archive' && !(typeof rec.patch === 'string' && PATCH_NAME.test(rec.patch))) return 'patch is not a patch file name';
  if (Object.hasOwn(rec, 'ignored') && !(typeof rec.ignored === 'string' && IGNORED_NAME.test(rec.ignored) && rec.ignored.startsWith(`${rec.task}-`))) {
    return 'ignored is not an ignored-files folder name';
  }
  const cur = ids.get(rec.task);
  if (rec.ev === 'add') {
    if (cur?.live) return 'add while the worktree is live';
    ids.set(rec.task, { live: true, base: rec.base, merge: null, addAt: rec.at });
    return null;
  }
  if (!cur?.live) return `${rec.ev} without a live add`;
  if (rec.ev === 'merge') cur.merge = { commit: rec.commit, tip: rec.tip };
  if (rec.ev === 'remove' || rec.ev === 'archive') {
    cur.live = false;
    cur.end = { ev: rec.ev, commit: rec.commit };
  }
  return null;
}

function parseRecordText(slug, text) {
  const fail = (line, reason) => new WorktreeRecordError(slug, line, reason);
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw fail(0, 'file over 64 KiB');
  if (text === '') throw fail(0, 'file is empty');
  const lines = text.split('\n');
  const endsWithLf = lines.at(-1) === '';
  if (endsWithLf) lines.pop();
  if (lines.length > MAX_LINES) throw fail(0, 'file over 500 lines');
  if (!endsWithLf) throw fail(lines.length, 'no line feed at the end');
  const ids = new Map();
  const events = [];
  lines.forEach((line, index) => {
    const n = index + 1;
    if (line === '') throw fail(n, 'blank line');
    if (line.includes('\r')) throw fail(n, 'carriage return');
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw fail(n, 'line over 512 bytes');
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      throw fail(n, 'not valid JSON');
    }
    const problem = applyEvent(ids, rec);
    if (problem) throw fail(n, problem);
    events.push(rec);
  });
  return { ids, events };
}

function loadRecord(root, slug) {
  const fail = (reason) => new WorktreeRecordError(slug, 0, reason);
  const dir = runDir(root, slug);
  const none = { dir, file: null, text: '', ids: new Map(), events: [], stat: null };
  if (dir === null) return none;
  if (dir === 'unsafe') throw fail('run folder is a link or not a folder');
  const file = path.join(dir, 'worktrees.jsonl');
  const st = lstatOrNull(file);
  if (!st) return { ...none, file };
  if (!isPlain(st)) throw fail('record is a link or not a file');
  if (st.size > MAX_FILE_BYTES) throw fail('file over 64 KiB');
  let bytes;
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      if (!handleMatches(fd, st)) throw new Error('changed');
      bytes = Buffer.alloc(Math.min(fs.fstatSync(fd).size, MAX_FILE_BYTES + 1));
      let off = 0;
      while (off < bytes.length) {
        const n = fs.readSync(fd, bytes, off, bytes.length - off, off);
        if (n === 0) break;
        off += n;
      }
      bytes = bytes.subarray(0, off);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    throw fail('record is a link or not a file');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw fail('not valid UTF-8');
  }
  const parsed = parseRecordText(slug, text);
  return { dir, file, text, ids: parsed.ids, events: parsed.events, stat: st };
}

export function readWorktrees(root, slug) {
  if (typeof slug !== 'string' || !isWorkFolder(slug)) throw new TypeError('worktree: bad slug');
  const cur = loadRecord(root, slug);
  if (!cur.events.length) return { v: 1, slug, state: 'none', events: [], archived: 0, conflicts: 0 };
  return {
    v: 1,
    slug,
    state: 'on',
    events: cur.events.map((e) => ({ ...e })),
    archived: cur.events.filter((e) => e.ev === 'archive').length,
    conflicts: cur.events.filter((e) => e.ev === 'conflict').length
  };
}

function utc(now) {
  if (!Number.isFinite(now)) throw new Refusal('clock is not a time');
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function appendEvent(env, slug, rec) {
  const cur = loadRecord(env.root, slug);
  if (!cur.dir) throw new Refusal('run folder missing');
  const line = `${JSON.stringify(rec)}\n`;
  if (Buffer.byteLength(line) - 1 > MAX_LINE_BYTES) throw new Refusal('record refuses the event: line over 512 bytes');
  try {
    parseRecordText(slug, cur.text + line);
  } catch (error) {
    if (error instanceof WorktreeRecordError) throw new Refusal(`record refuses the event: ${error.reason}`);
    throw error;
  }
  const create = cur.stat ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL;
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | create | (fs.constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = fs.openSync(path.join(cur.dir, 'worktrees.jsonl'), flags, 0o644);
    if (!handleMatches(fd, cur.stat)) throw new Error('file changed');
    fs.writeSync(fd, line);
  } catch {
    throw new Refusal('record cannot be written');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------- git

function scrubbedEnv() {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('GIT_')) out[key] = value;
  }
  return out;
}

function runGit(argv, { cwd, env, input, codes = [0], maxBuffer = GIT_MAX_BUFFER }) {
  try {
    const out = execFileSync('git', argv, {
      cwd, env, input, timeout: GIT_TIMEOUT_MS, maxBuffer, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true
    });
    return { code: 0, out };
  } catch (error) {
    if (typeof error.status === 'number' && codes.includes(error.status)) return { code: error.status, out: error.stdout ?? Buffer.alloc(0) };
    if (error.code === 'ENOBUFS') throw new GitFailure('output over the size cap', { overflow: true });
    throw new GitFailure(typeof error.status === 'number' ? `exit ${error.status}` : 'call failed');
  }
}

const lineOf = (buf) => buf.toString('utf8').replace(/\n$/, '');

function absentPath(label) {
  return path.join(os.tmpdir(), `aico-no-${label}-${crypto.randomBytes(8).toString('hex')}`);
}

// Opens the git context: the top level equals the real product root, and every later call carries the fixed options and
// the scrubbed environment, with the graft file looked at first.
function openGit(env) {
  const realRoot = realOf(env.root);
  if (realRoot === null) throw new Refusal('root is not a folder');
  const baseEnv = scrubbedEnv();
  const call = (argv, o) => {
    env.hook?.('git', { args: argv, env: o.env });
    return runGit(argv, o);
  };
  const topOut = call([...LEAD, 'rev-parse', '--show-toplevel'], { cwd: realRoot, env: baseEnv });
  const top = lineOf(topOut.out);
  if (top === '' || sameKey(top) !== sameKey(realRoot)) throw new Refusal('root is not the repository top level');
  const graftOut = lineOf(call([...LEAD, 'rev-parse', '--git-path', 'info/grafts'], { cwd: top, env: { ...baseEnv, GIT_NO_REPLACE_OBJECTS: '1' } }).out);
  if (graftOut === '' || graftOut.includes('\n')) throw new GitFailure('graft path unreadable');
  const graftFile = path.resolve(top, graftOut);
  const noGrafts = absentPath('grafts');
  const noHooks = absentPath('hooks');
  for (const p of [noGrafts, noHooks]) if (lstatOrNull(p)) throw new GitFailure('temp path taken');
  const childEnv = { ...baseEnv, GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: noGrafts };

  const checkGrafts = () => {
    if (lstatOrNull(graftFile)) throw new GitFailure('grafts file present');
  };
  const git = (argv, { dir, codes, input, maxBuffer } = {}) => {
    checkGrafts();
    const full = [...LEAD, ...(dir ? ['-C', dir] : []), ...argv];
    return call(full, { cwd: top, env: childEnv, codes, input, maxBuffer });
  };
  const text = (argv, o) => lineOf(git(argv, o).out);
  const commitOf = (ref, o) => {
    const id = text(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], o);
    if (!FULL_ID.test(id)) throw new GitFailure('not a full commit id');
    return id;
  };
  const gitPath = (name) => {
    const p = text(['rev-parse', '--git-path', name]);
    if (p === '' || p.includes('\n')) throw new GitFailure('git path unreadable');
    return path.resolve(top, p);
  };
  return { top, realRoot, git, text, commitOf, gitPath, noHooks };
}

function parseStatus(buf) {
  const parts = buf.toString('utf8').split('\0');
  if (parts.at(-1) === '') parts.pop();
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    const xy = entry.slice(0, 2);
    const item = { xy, path: entry.slice(3) };
    if (/[RC]/.test(xy)) item.orig = parts[++i] ?? '';
    out.push(item);
  }
  return out;
}

function statusOf(ctx, dir, { ignored = false } = {}) {
  return ctx.git(['status', '--porcelain=v1', '-z', ...(ignored ? ['--ignored=matching'] : []), '--untracked-files=all'], { dir }).out;
}

function listWorktrees(ctx) {
  const parts = ctx.git(['worktree', 'list', '--porcelain', '-z']).out.toString('utf8').split('\0');
  return parts.filter((f) => f.startsWith('worktree ')).map((f) => f.slice('worktree '.length));
}

function listBranches(ctx, slug) {
  const out = ctx.git(['for-each-ref', '--format=%(refname)', '--end-of-options', `refs/heads/aico-wt/${idOf(slug)}/`]).out.toString('utf8');
  return out.split('\n').filter(Boolean);
}

// ---------------------------------------------------------------- layout

// The branch id of a run name (a legacy slug is its own id), re-checked against its allow-list before it is part of a ref or a path.
function idOf(slug) {
  const id = isWorkFolder(slug) ? branchId(slug) : null;
  if (typeof id !== 'string' || !BRANCH_ID.test(id)) throw new Refusal('bad run name');
  return id;
}

const branchOf = (slug, id) => `aico-wt/${idOf(slug)}/${id}`;
const refOf = (slug, id) => `refs/heads/${branchOf(slug, id)}`;
const runRef = (slug) => `refs/heads/aico/${idOf(slug)}`;

function layoutOf(realRoot, slug, id) {
  const wtRoot = path.join(path.dirname(realRoot), `${path.basename(realRoot)}.aico-wt`);
  const slugDir = path.join(wtRoot, idOf(slug));
  return { wtRoot, slugDir, wt: path.join(slugDir, id) };
}

// Every existing segment from the worktree root down is a plain folder whose real path is its lexical path.
function segmentsOk(layout) {
  for (const p of [layout.wtRoot, layout.slugDir, layout.wt]) {
    const st = lstatOrNull(p);
    if (!st) continue;
    if (!isFolder(st) || !isUnlinked(p)) return false;
  }
  return true;
}

function printable(p) {
  const n = normalizePath(p);
  return n.ok ? n.path : '?';
}

// ---------------------------------------------------------------- checks

// The exact spelling of the run folder on disk; a letter-case variant is refused before any read or write.
function exactSlug(root, slug) {
  try {
    exactWorkPath({ fs, path }, root, [slug]);
  } catch (error) {
    if (error instanceof WorkFolderRefusal) throw new Refusal(error.message);
    throw error;
  }
}

function checkSlug(value, root) {
  if (typeof value !== 'string' || !isWorkFolder(value)) throw new Refusal('slug must be lowercase letters, digits and hyphens');
  exactSlug(root, value);
  return value;
}

function checkId(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Refusal('id must be a task id in lowercase or proto');
  return value;
}

// Flags are taken from the list once each; anything else is refused.
function takeFlags(list, allowed) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.startsWith('-')) {
      const spec = allowed[a];
      if (!spec || Object.hasOwn(flags, a)) throw new Refusal(`flag ${a.slice(0, 40)} is not allowed here`);
      if (spec === 'value') {
        if (i + 1 >= list.length) throw new Refusal(`${a} needs a value`);
        flags[a] = list[++i];
      } else flags[a] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

// Record against git: a live add has its worktree and its branch; an id that ended has neither.
// The other way too: a branch or worktree of this run that has no live add in the record is a mismatch (named by id, or ? when it is not a task id).
function recordMismatches(ctx, slug, rec) {
  const treeList = listWorktrees(ctx);
  const trees = new Set(treeList.map(sameKey));
  const branchList = listBranches(ctx, slug);
  const branches = new Set(branchList);
  const bad = [];
  for (const [id, st] of rec.ids) {
    const { wt } = layoutOf(ctx.realRoot, slug, id);
    const hasTree = trees.has(sameKey(wt));
    const hasBranch = branches.has(refOf(slug, id));
    if (st.live ? !(hasTree && hasBranch) : (hasTree || hasBranch)) bad.push(id);
  }
  const strays = new Set();
  const stray = (id) => {
    if (!ID.test(id)) strays.add('?');
    else if (!rec.ids.get(id)?.live && !bad.includes(id)) strays.add(id);
  };
  const branchPrefix = `refs/heads/aico-wt/${idOf(slug)}/`;
  for (const ref of branchList) stray(ref.slice(branchPrefix.length));
  const slugPrefix = `${sameKey(layoutOf(ctx.realRoot, slug, 'x').slugDir)}${path.sep}`;
  for (const p of treeList) {
    const key = sameKey(p);
    if (key.startsWith(slugPrefix) && !key.slice(slugPrefix.length).includes(path.sep)) stray(path.basename(path.resolve(p)));
  }
  return [...bad, ...strays];
}

const attrAlias = (segment) => {
  const base = segment.split(':')[0].replace(/[​-‏‪-‮⁠-⁤⁪-⁯﻿]/gu, '');
  let end = base.length;
  while (end > 0 && (base[end - 1] === '.' || base[end - 1] === ' ')) end--;
  return base.slice(0, end).toLowerCase();
};

export function isGitattributesName(p) {
  const last = String(p).replaceAll('\\', '/').split('/').at(-1);
  const name = attrAlias(last);
  return name === '.gitattributes' || /^gitatt~[1-9]\d*$/.test(name);
}

// ---------------------------------------------------------------- add

function cmdAdd(args, env) {
  const { positional, flags } = takeFlags(args, { '--base': 'value' });
  if (positional.length !== 2 || !flags['--base']) throw new Refusal(USAGE);
  const slug = checkSlug(positional[0], env.root);
  const id = checkId(positional[1]);
  const base = flags['--base'];
  if (!FULL_ID.test(base)) throw new Refusal('--base must be a full commit id');
  const ctx = openGit(env);
  const rec = loadRecord(env.root, slug);
  if (!rec.dir) throw new Refusal('run folder missing');
  if (rec.ids.get(id)?.live) throw new Refusal(`worktree ${id} already added`);
  const head = ctx.text(['symbolic-ref', '--quiet', 'HEAD'], { codes: [0, 1] });
  if (head !== runRef(slug)) throw new Refusal(`HEAD is not ${runRef(slug)}`);
  const runCommit = ctx.commitOf(runRef(slug));
  if (id === 'proto') {
    if (ctx.commitOf(base) !== base) throw new Refusal('--base is not a commit');
    const anc = ctx.git(['merge-base', '--is-ancestor', '--end-of-options', base, runCommit], { codes: [0, 1] }).code;
    if (anc !== 0) throw new Refusal('--base is not an ancestor of the run branch');
  } else if (runCommit !== base) {
    throw new Refusal('--base is not the run branch commit');
  }
  const layout = layoutOf(ctx.realRoot, slug, id);
  if (layout.wt.length > MAX_PATH_CHARS) throw new Refusal('worktree path is over 200 characters');
  if (!segmentsOk(layout)) throw new Refusal('a segment of the worktree path is a link or not a folder');
  if (lstatOrNull(layout.wt)) throw new Refusal('worktree path exists');
  if (listWorktrees(ctx).map(sameKey).includes(sameKey(layout.wt))) throw new Refusal('worktree path is already registered');
  if (listBranches(ctx, slug).includes(refOf(slug, id))) throw new Refusal('branch exists');
  ctx.git(['worktree', 'add', '-b', branchOf(slug, id), '--end-of-options', layout.wt, base]);
  if (!segmentsOk(layout)) throw new GitFailure('worktree path changed');
  appendEvent(env, slug, { v: 1, at: utc(env.now), ev: 'add', task: id, base });
  return { code: 0, lines: [`Worktree: ${layout.wt}`] };
}

// ---------------------------------------------------------------- changed

function cmdChanged(args, env) {
  if (args.length !== 2) throw new Refusal(USAGE);
  const slug = checkSlug(args[0], env.root);
  const id = checkId(args[1]);
  const ctx = openGit(env);
  const rec = loadRecord(env.root, slug);
  if (!rec.ids.get(id)?.live) throw new Refusal(`no worktree for ${id}`);
  const layout = layoutOf(ctx.realRoot, slug, id);
  if (!segmentsOk(layout)) throw new Refusal('a segment of the worktree path is a link or not a folder');
  const seen = new Set();
  const lines = [];
  for (const e of parseStatus(statusOf(ctx, layout.wt))) {
    for (const p of [e.path, e.orig]) {
      if (p === undefined || seen.has(p)) continue;
      seen.add(p);
      lines.push(printable(p));
    }
  }
  return { code: 0, lines };
}

// ---------------------------------------------------------------- merge

// The main tree is on the run ref and clean; the run's own untracked files below .company/work/<slug>/ do not count.
function checkMainTree(ctx, slug) {
  if (ctx.text(['symbolic-ref', '--quiet', 'HEAD'], { codes: [0, 1] }) !== runRef(slug)) throw new Refusal(`main tree is not on ${runRef(slug)}`);
  const own = `.company/work/${slug}/`;
  const dirty = parseStatus(statusOf(ctx)).filter((e) => !(e.xy === '??' && e.path.startsWith(own)));
  if (dirty.length) throw new Refusal('main tree is not clean');
}

// Returns a reason when a merge driver, a merge option or an attribute could change what the merge does, else null.
function driverRisk(ctx, runTip, taskTip) {
  if (lstatOrNull(ctx.gitPath('info/attributes'))) return 'info-attributes';
  const hit = (pattern) => ctx.git(['config', '--get-regexp', pattern], { codes: [0, 1] }).code === 0;
  if (hit('^merge\\..*\\.driver$')) return 'merge-driver';
  if (hit('^merge\\.default$')) return 'merge-default';
  if (hit('^branch\\..*\\.mergeoptions$')) return 'branch-mergeoptions';
  if (hit('^pull\\.(twohead|octopus)$')) return 'pull-strategy';
  const mb = ctx.text(['merge-base', '--end-of-options', runTip, taskTip]);
  if (!FULL_ID.test(mb)) throw new GitFailure('merge base unreadable');
  const raw = ctx.git([
    '-c', 'diff.ignoreSubmodules=none', '--literal-pathspecs', 'diff', '--name-only', '-z', '--no-renames', '--no-ext-diff',
    '--no-textconv', '--no-color', '--no-relative', '--ignore-submodules=none', '--end-of-options', mb, taskTip, '--'
  ]).out.toString('utf8').split('\0').filter(Boolean);
  if (raw.some(isGitattributesName)) return 'gitattributes-changed';
  if (raw.length) {
    const parts = ctx.git(['check-attr', '-z', '--stdin', 'merge'], { input: `${raw.join('\0')}\0` }).out.toString('utf8').split('\0');
    if (parts.at(-1) === '') parts.pop();
    if (parts.length !== raw.length * 3) throw new GitFailure('check-attr output unreadable');
    for (let i = 2; i < parts.length; i += 3) if (parts[i] !== 'unspecified' && parts[i] !== 'set') return 'merge-attribute';
  }
  return null;
}

function mergeOne(ctx, env, slug, ID_, id) {
  checkMainTree(ctx, slug);
  const runTip = ctx.commitOf(runRef(slug));
  const taskTip = ctx.commitOf(refOf(slug, id));
  env.hook?.('tip-read', { id, tip: taskTip });
  const risk = driverRisk(ctx, runTip, taskTip);
  if (risk) return { kind: 'risk', reason: risk };
  const merged = ctx.git([
    '-c', 'rerere.enabled=false', '-c', `core.hooksPath=${ctx.noHooks}`, '-c', 'merge.renormalize=false',
    '-c', 'pull.twohead=ort', '-c', 'pull.octopus=octopus',
    'merge', '--no-ff', '--no-edit', '--no-verify', `--message=merge: ${slug} ${ID_}`, '--end-of-options', taskTip
  ], { codes: [0, 1] });
  if (merged.code === 1) {
    const hasHead = ctx.git(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { codes: [0, 1] }).code === 0;
    if (!hasHead) throw new GitFailure('merge failed without a conflict');
    const paths = ctx.git(['diff', '--name-only', '--diff-filter=U', '-z']).out.toString('utf8').split('\0').filter(Boolean);
    ctx.git(['merge', '--abort']);
    return { kind: 'conflict', paths };
  }
  const first = ctx.commitOf(`${runRef(slug)}^1`);
  const second = ctx.commitOf(`${runRef(slug)}^2`);
  if (first !== runTip || second !== taskTip) return { kind: 'unexpected' };
  return { kind: 'merged', commit: ctx.commitOf(runRef(slug)), tip: taskTip };
}

function cmdMerge(args, env) {
  if (args.length !== 1) throw new Refusal(USAGE);
  const slug = checkSlug(args[0], env.root);
  const ctx = openGit(env);
  const rec = loadRecord(env.root, slug);
  const bad = recordMismatches(ctx, slug, rec);
  if (bad.length) return { code: 2, lines: bad.map((id) => `record mismatch ${id}`) };
  const view = readParallel(env.root, slug);
  if (view.state !== 'on' || !Array.isArray(view.open_wave)) throw new Refusal('no open wave');
  const ordered = sortByVisit(env.root, slug, view.open_wave);
  if (ordered === null) throw new Refusal('open wave cannot be put in plan order: plan unreadable, changed since begin, or missing a task');
  const wave = ordered.map((ID_) => {
    const id = ID_.toLowerCase();
    if (!ID.test(id) || id === 'proto') throw new Refusal('open wave holds a task that cannot be merged');
    return { ID: ID_, id };
  });
  const lines = [];
  let done = 0;
  for (const { ID: ID_, id } of wave) {
    if (!rec.ids.get(id)?.live) {
      lines.push(`main-tree ${ID_}`);
      done++;
      continue;
    }
    const r = mergeOne(ctx, env, slug, ID_, id);
    if (r.kind === 'merged') {
      appendEvent(env, slug, { v: 1, at: utc(env.now), ev: 'merge', task: id, commit: r.commit, tip: r.tip });
      lines.push(`merged ${ID_} ${r.commit.slice(0, 7)}`);
      done++;
      continue;
    }
    if (r.kind === 'risk') lines.push(`merge: driver risk ${r.reason} ${ID_}`);
    else if (r.kind === 'unexpected') lines.push(`merge: unexpected result ${ID_}`);
    else {
      const keys = [...new Set(r.paths.map((p) => { const n = normalizePath(p); return n.ok ? n.key : '?'; }))].slice(0, MAX_PATHS);
      appendEvent(env, slug, { v: 1, at: utc(env.now), ev: 'conflict', task: id, paths: keys });
      for (const p of r.paths.slice(0, MAX_PATHS)) lines.push(`conflict ${ID_} ${printable(p)}`);
      lines.push(`merge: stopped at ${ID_}`);
    }
    lines.push(`merge: ${done} of ${wave.length}`);
    return { code: 2, lines };
  }
  lines.push(`merge: ${done} of ${wave.length}`);
  return { code: 0, lines };
}

// ---------------------------------------------------------------- cleanup

function archiveDir(root, slug) {
  const dir = runDir(root, slug);
  if (!dir || dir === 'unsafe') throw new Error('run folder unavailable');
  const folder = path.join(dir, 'worktrees');
  const st = lstatOrNull(folder);
  if (!st) fs.mkdirSync(folder);
  else if (!isFolder(st)) throw new Error('worktrees folder is a link');
  if (!isUnlinked(folder)) throw new Error('worktrees folder has a link');
  return folder;
}

// Writes the patch, reads it back by the real-path rule and compares it byte for byte. Returns the file path or null.
function writePatch(env, slug, id, diff) {
  try {
    const folder = archiveDir(env.root, slug);
    const stamp = utc(env.now).replace(/[-:]/g, '');
    const name = `${id}-${stamp}.patch`;
    const file = path.join(folder, name);
    const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0);
    env.hook?.('patch-open', { flags });
    const fd = fs.openSync(file, flags, 0o644);
    try {
      let off = 0;
      while (off < diff.length) off += fs.writeSync(fd, diff, off, diff.length - off);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    env.hook?.('patch-written', { file });
    const back = readFileChecked(file, diff.length + 1);
    if (!back.equals(diff)) return null;
    return { file, name };
  } catch {
    return null;
  }
}

const isSymref = (ctx, ref) => ctx.git(['symbolic-ref', '--quiet', '--end-of-options', ref], { codes: [0, 1] }).code === 0;

// Deletes the task branch only when it is not a symbolic ref and still holds the checked head. Returns a reason when it stays.
function deleteBranch(ctx, slug, id, head) {
  const ref = refOf(slug, id);
  if (isSymref(ctx, ref)) return 'branch is a symbolic ref';
  try {
    ctx.git(['update-ref', '--no-deref', '-d', '--end-of-options', ref, head]);
  } catch (error) {
    if (error instanceof GitFailure && error.message.startsWith('exit ')) return 'branch moved';
    throw error;
  }
  return null;
}

// Removes each skipped folder with fs.rmSync (recursive, no force: it unlinks a link it meets and never enters it),
// after repeating the skip check on it. The folder must then be gone (lstat ENOENT). Returns true only when all are.
function removeSkipped(env, layout, folders) {
  for (const rel of folders) {
    const full = path.join(layout.wt, ...rel.split('/'));
    try {
      if (!skippable(layout, `${rel}/`)) return false;
      env.hook?.('rebuildable-remove', { path: full });
      if (!skippable(layout, `${rel}/`)) return false;
      fs.rmSync(full, { recursive: true });
      try {
        fs.lstatSync(full);
        return false;
      } catch (error) {
        if (error?.code !== 'ENOENT') return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function removeWorktree(ctx, layout, slug, id, { force, head, env, skipped = [] }) {
  if (!removeSkipped(env, layout, skipped)) return 'rebuildable folder not removed';
  ctx.git(['worktree', 'remove', ...(force ? ['--force'] : []), '--end-of-options', layout.wt]);
  return deleteBranch(ctx, slug, id, head);
}

// Makes each folder of the path below base one at a time, each checked with lstat.
function ensureFolders(base, parts) {
  let dir = base;
  for (const part of parts) {
    dir = path.join(dir, part);
    const st = lstatOrNull(dir);
    if (!st) fs.mkdirSync(dir, 0o700);
    const now = lstatOrNull(dir);
    if (!now || !isFolder(now)) throw new Error('not a folder');
  }
}

// Creates a new file, writes it, syncs it, reads it back by the real-path read rule and compares it byte for byte.
function writeVerified(file, data, env) {
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const fd = fs.openSync(file, flags, 0o600);
  try {
    let off = 0;
    while (off < data.length) off += fs.writeSync(fd, data, off, data.length - off);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  env.hook?.('ignored-written', { file });
  if (!readFileChecked(file, data.length + 1).equals(data)) throw new Error('read-back mismatch');
}

// The path rule of plan-tasks, except its refusal of .env names: those are the files this copy exists to save.
function archivable(p) {
  const swapped = p.split('/').map((seg) => (seg.toLowerCase().startsWith('.env') ? `x${seg.slice(1)}` : seg)).join('/');
  const n = normalizePath(swapped);
  return n.ok && n.path === swapped && !n.dir;
}

// An ignored folder entry ('a/node_modules/') is skipped only when its last segment is on the list (exact, case-sensitive)
// and lstat shows a real folder, not a link, whose real path is its own path inside the worktree.
function skippable(layout, entry) {
  const rel = entry.slice(0, -1);
  if (!archivable(rel)) return false;
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  if (!REBUILDABLE.has(name)) return false;
  const full = path.join(layout.wt, ...rel.split('/'));
  const st = lstatOrNull(full);
  return st !== null && isFolder(st) && isUnlinked(full);
}

// Copies the worktree's loose git-ignored files into a new folder that git ignores itself. Returns { ok, count, name }.
// Listed rebuildable folders are skipped; every other folder entry keeps the worktree.
function archiveIgnored(env, layout, slug, id, statusBytes) {
  const entries = parseStatus(statusBytes).filter((e) => e.xy === '!!').map((e) => e.path);
  const folders = entries.filter((p) => p.endsWith('/'));
  const paths = entries.filter((p) => !p.endsWith('/'));
  try {
    if (!folders.every((p) => skippable(layout, p))) return { ok: false };
    const skipped = folders.map((p) => p.slice(0, -1));
    if (paths.length === 0) return { ok: true, count: 0, skipped };
    const caps = env.ignoredCaps;
    if (paths.length > caps.files) return { ok: false };
    if (!paths.every(archivable)) return { ok: false };
    const name = `${id}-${utc(env.now).replace(/[-:]/g, '')}.ignored`;
    const dest = path.join(archiveDir(env.root, slug), name);
    fs.mkdirSync(dest, 0o700);
    const st = lstatOrNull(dest);
    if (!st || !isFolder(st) || !isUnlinked(dest)) return { ok: false };
    writeVerified(path.join(dest, '.gitignore'), Buffer.from('*\n'), env);
    let total = 0;
    for (const p of paths) {
      const parts = p.split('/');
      const data = readFileChecked(path.join(layout.wt, ...parts), caps.file);
      total += data.length;
      if (data.length > caps.file || total > caps.total) return { ok: false };
      ensureFolders(dest, parts.slice(0, -1));
      writeVerified(path.join(dest, ...parts), data, env);
    }
    env.hook?.('ignored-verified', { id, folder: dest });
    return { ok: true, count: paths.length, name, skipped };
  } catch {
    return { ok: false };
  }
}

const withCount = (line, count) => (count > 0 ? `${line} ignored ${count}` : line);

function cleanOne(ctx, env, slug, id, st, archive) {
  const layout = layoutOf(ctx.realRoot, slug, id);
  const inList = listWorktrees(ctx).map(sameKey).includes(sameKey(layout.wt));
  if (!inList || !segmentsOk(layout) || !isUnlinked(layout.wt)) return { line: `skip ${id}`, stop: true };
  if (isSymref(ctx, refOf(slug, id))) return { line: `kept ${id}: branch is a symbolic ref`, stop: true };
  const onBranch = ctx.text(['symbolic-ref', '--quiet', 'HEAD'], { dir: layout.wt, codes: [0, 1] });
  if (onBranch !== refOf(slug, id)) return { line: `kept ${id}: worktree not on its branch`, stop: true };
  const head = ctx.commitOf(refOf(slug, id));
  const ignoredNotSaved = { line: `kept ${id}: ignored files not archived`, stop: true };
  const changed = { line: `kept ${id}: changed during archive`, stop: true };
  const m = st.merge;
  if (id !== 'proto' && m && m.tip === head) {
    const second = ctx.git(['rev-parse', '--verify', '--end-of-options', `${m.commit}^2^{commit}`], { codes: [0, 128] });
    const confirmed = second.code === 0 && lineOf(second.out) === m.tip
      && ctx.git(['merge-base', '--is-ancestor', '--end-of-options', m.commit, runRef(slug)], { codes: [0, 1] }).code === 0;
    if (confirmed && statusOf(ctx, layout.wt).length === 0) {
      const before = statusOf(ctx, layout.wt, { ignored: true });
      const saved = archiveIgnored(env, layout, slug, id, before);
      if (!saved.ok) return ignoredNotSaved;
      if (ctx.commitOf(refOf(slug, id)) !== head || !statusOf(ctx, layout.wt, { ignored: true }).equals(before)) return changed;
      const stays = removeWorktree(ctx, layout, slug, id, { force: false, head, env, skipped: saved.skipped });
      if (stays) return { line: `kept ${id}: ${stays}`, stop: true };
      appendEvent(env, slug, { v: 1, at: utc(env.now), ev: 'remove', task: id, commit: head, ...(saved.name ? { ignored: saved.name } : {}) });
      return { line: withCount(`removed ${id}`, saved.count) };
    }
  }
  if (!archive) return { line: `kept ${id}: unmerged work`, stop: true };
  const notWritten = { line: `kept ${id}: patch not written`, stop: true };
  ctx.git(['add', '-A'], { dir: layout.wt });
  let diff;
  try {
    diff = ctx.git([
      '-c', 'diff.ignoreSubmodules=none', 'diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', '--no-color',
      '--no-relative', '--ignore-submodules=none', '--end-of-options', st.base
    ], { dir: layout.wt, maxBuffer: GIT_MAX_BUFFER }).out;
  } catch (error) {
    if (error instanceof GitFailure && error.overflow) return notWritten;
    throw error;
  }
  if (diff.length > (env.patchCap ?? GIT_MAX_BUFFER)) return notWritten;
  const before = statusOf(ctx, layout.wt, { ignored: true });
  const written = writePatch(env, slug, id, diff);
  if (!written) return notWritten;
  const saved = archiveIgnored(env, layout, slug, id, before);
  if (!saved.ok) return ignoredNotSaved;
  env.hook?.('archive-verified', { id, file: written.file });
  const same = () => ctx.commitOf(refOf(slug, id)) === head && statusOf(ctx, layout.wt, { ignored: true }).equals(before);
  if (!same()) return changed;
  try {
    appendEvent(env, slug, {
      v: 1, at: utc(env.now), ev: 'archive', task: id, commit: head, patch: written.name, ...(saved.name ? { ignored: saved.name } : {})
    });
  } catch {
    return notWritten;
  }
  env.hook?.('archive-recorded', { id });
  if (!same()) return changed;
  const stays = removeWorktree(ctx, layout, slug, id, { force: true, head, env, skipped: saved.skipped });
  if (stays) return { line: `kept ${id}: ${stays}`, stop: true };
  return { line: withCount(`archived ${id} ${written.file}`, saved.count) };
}

function cmdCleanup(args, env) {
  const { positional, flags } = takeFlags(args, { '--archive': 'bool' });
  if (positional.length !== 1) throw new Refusal(USAGE);
  const slug = checkSlug(positional[0], env.root);
  const archive = flags['--archive'] === true;
  const ctx = openGit(env);
  const rec = loadRecord(env.root, slug);
  const bad = recordMismatches(ctx, slug, rec);
  if (bad.length) return { code: 2, lines: bad.map((id) => `record mismatch ${id}`) };
  const lines = [];
  let stopped = false;
  for (const [id, st] of rec.ids) {
    if (!st.live) continue;
    const r = cleanOne(ctx, env, slug, id, st, archive);
    lines.push(r.line);
    if (r.stop) stopped = true;
  }
  ctx.git(['worktree', 'prune']);
  return { code: stopped ? 2 : 0, lines };
}

// ---------------------------------------------------------------- leftovers

function cmdLeftovers(args, env) {
  if (args.length !== 0) throw new Refusal(USAGE);
  const ctx = openGit(env);
  const wtRoot = layoutOf(ctx.realRoot, 'x', 'x').wtRoot;
  const prefix = `${sameKey(wtRoot)}${path.sep}`;
  const shape = /^[a-z0-9][a-z0-9-]{0,127}\/(?:t\d{1,3}[a-z]?|proto)$/;
  const lines = [];
  for (const p of listWorktrees(ctx)) {
    const key = sameKey(p);
    if (!key.startsWith(prefix)) continue;
    const rel = path.resolve(p).slice(prefix.length).replaceAll('\\', '/');
    lines.push(`leftover worktree ${shape.test(rel) ? rel : '?'}`);
  }
  const out = ctx.git(['for-each-ref', '--format=%(refname)', '--end-of-options', 'refs/heads/aico-wt/']).out.toString('utf8');
  for (const ref of out.split('\n').filter(Boolean)) {
    const name = ref.slice('refs/heads/'.length);
    lines.push(`leftover branch ${shape.test(name.slice('aico-wt/'.length)) ? name : '?'}`);
  }
  return { code: 0, lines: lines.length ? lines : ['leftovers: none'] };
}

// ---------------------------------------------------------------- protocheck

function protoCommits(ctx, slug, st) {
  const ref = refOf(slug, 'proto');
  const exists = ctx.git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], { codes: [0, 1] });
  let head;
  if (exists.code === 0) head = lineOf(exists.out);
  else if (st.end?.commit) head = st.end.commit;
  else return null;
  if (!FULL_ID.test(head)) return null;
  const lines = (argv) => ctx.git(argv).out.toString('utf8').split('\n').filter(Boolean);
  const own = new Set(lines(['rev-list', '--end-of-options', head, `^${st.base}`]));
  const inRun = lines(['rev-list', '--end-of-options', runRef(slug), `^${st.base}`]).filter((c) => own.has(c)).length;
  const picked = lines(['cherry', '--end-of-options', runRef(slug), head, st.base]).filter((l) => l.startsWith('-')).length;
  return inRun + picked;
}

function cmdProtocheck(args, env) {
  if (args.length !== 1) throw new Refusal(USAGE);
  const slug = checkSlug(args[0], env.root);
  const rec = loadRecord(env.root, slug);
  const st = rec.ids.get('proto');
  if (!st) return { code: 0, lines: ['prototype: none'] };
  let k = null;
  try {
    k = protoCommits(openGit(env), slug, st);
  } catch (error) {
    if (!(error instanceof GitFailure || error instanceof Refusal)) throw error;
  }
  if (k === null) return { code: 2, lines: ['prototype: unknown'] };
  if (k === 0) return { code: 0, lines: ['prototype: not in diff'] };
  return { code: 2, lines: [`prototype: ${k} commits in the run branch`] };
}

// ---------------------------------------------------------------- main

const HANDLERS = { add: cmdAdd, changed: cmdChanged, merge: cmdMerge, cleanup: cmdCleanup, leftovers: cmdLeftovers, protocheck: cmdProtocheck };

// The product root is resolved to its real path once here; every path the script derives, prints or compares starts from it.
function realRootOf(root) {
  const given = typeof root === 'string' && root !== '' ? root : process.cwd();
  return realOf(given) ?? given;
}

export function main(args, { now, root, patchCap, ignoredCap, hook } = {}) {
  const env = {
    root: realRootOf(root),
    now: typeof now === 'number' ? now : Date.now(),
    patchCap: Number.isInteger(patchCap) && patchCap >= 0 ? patchCap : undefined,
    ignoredCaps: {
      files: Number.isInteger(ignoredCap?.files) && ignoredCap.files >= 0 ? ignoredCap.files : IGNORED_CAPS.files,
      file: Number.isInteger(ignoredCap?.file) && ignoredCap.file >= 0 ? ignoredCap.file : IGNORED_CAPS.file,
      total: Number.isInteger(ignoredCap?.total) && ignoredCap.total >= 0 ? ignoredCap.total : IGNORED_CAPS.total
    },
    hook: typeof hook === 'function' ? hook : undefined
  };
  try {
    const list = Array.isArray(args) ? args : [];
    for (const arg of list) {
      if (typeof arg !== 'string') throw new Refusal(USAGE);
      if (CONTROLS.test(arg)) throw new Refusal('argument holds a control character');
      if (arg.length > MAX_ARG_CHARS) throw new Refusal('argument too long');
    }
    const [command, ...rest] = list;
    if (typeof command !== 'string' || !Object.hasOwn(HANDLERS, command)) throw new Refusal(USAGE);
    return HANDLERS[command](rest, env);
  } catch (error) {
    if (error instanceof Refusal) return { code: 3, lines: [`refused: ${error.message}`] };
    if (error instanceof GitFailure) return { code: 1, lines: [`worktree: git failed (${error.message})`] };
    if (error instanceof WorktreeRecordError || error instanceof ParallelRecordError) return { code: 1, lines: [error.message] };
    throw error;
  }
}

function isMainReal() {
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
}

if (process.argv[1] && (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href || isMainReal())) {
  const { code, lines } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
