#!/usr/bin/env node
// Review loop (contract: docs/contracts/review-loop.md v2.0). Node built-ins only.
// uses: docs/contracts/work-folder-name.md v3.0
// Keeps the retry and "not run" count of review dispatches in one append-only record and prints the Ship Gate lines.
// Arguments and the record are untrusted: values are allow-listed before use and sizes are capped before parsing.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isRunSlug, workParts, exactWorkPath, WorkFolderRefusal } from '../mods/lib/work-folder.mjs';

export const REVIEW_ROLES = ['code-reviewer', 'fresh-reviewer', 'qa', 'security', 'pentester', 'vuln-scanner', 'senior-engineer',
  'accessibility-tester', 'hands-on-tester', 'persona-tester', 'legal'];
const SECURITY_LANES = new Set(['security', 'pentester', 'vuln-scanner']);
const REASONS = ['crash', 'no-handoff', 'lint'];
const STEP = /^\d{2,3}$/;
const ROUND = /^[0-5]$/;
const CONTROLS = /[\u0000-\u001f\u007f]/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MAX_ARG_CHARS = 4096;
const MAX_LINE_BYTES = 512;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_RECORD_LINES = 500;
const USAGE = 'usage: attempt <slug> <step> <role> <round> <reason> | gate <slug>';

class Refusal extends Error {}

export class ReviewLoopRecordError extends Error {
  constructor(slug, line, reason) {
    super(`review-loop: record of ${slug} unreadable${line ? ` at line ${line}` : ''}: ${reason}`);
    this.name = 'ReviewLoopRecordError';
    this.reason = reason;
  }
}

// ---------------------------------------------------------------- record

const lstatOrNull = (p) => {
  try { return fs.lstatSync(p); } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
};
const isPlain = (st) => st.isFile() && st.nlink === 1;
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

function runDir(root, slug) {
  let dir = root;
  for (const part of ['.company', 'work', ...(workParts(slug) ?? [slug])]) {
    dir = path.join(dir, part);
    const st = lstatOrNull(dir);
    if (!st) return null;
    if (!st.isDirectory()) return 'unsafe';
  }
  return dir;
}

function lineProblem(rec) {
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return 'line is not an object';
  const keys = Object.keys(rec).sort().join(',');
  if (rec.v !== 1) return 'v must be 1';
  if (typeof rec.at !== 'string' || !AT.test(rec.at)) return 'at is not a UTC time';
  if (!Number.isInteger(rec.round) || rec.round < 0 || rec.round > 5) return 'round must be 0-5';
  if (rec.ev !== 'attempt' && rec.ev !== 'notrun') return 'ev is not allowed';
  if (keys !== 'at,ev,reason,role,round,step,v') return `${rec.ev} keys`;
  if (!REVIEW_ROLES.includes(rec.role)) return 'role is not a review Role';
  if (typeof rec.step !== 'string' || !STEP.test(rec.step)) return 'step must be NN';
  if (!REASONS.includes(rec.reason)) return 'reason is not allowed';
  return null;
}

function parseRecord(slug, text) {
  const fail = (line, reason) => new ReviewLoopRecordError(slug, line, reason);
  if (Buffer.byteLength(text) > MAX_RECORD_BYTES) throw fail(0, 'file over 64 KiB');
  if (text === '') throw fail(0, 'file is empty');
  const lines = text.split('\n');
  if (lines.pop() !== '') throw fail(lines.length, 'no line feed at the end');
  if (lines.length > MAX_RECORD_LINES) throw fail(0, 'file over 500 lines');
  const events = [];
  lines.forEach((line, i) => {
    const n = i + 1;
    if (line.includes('\r')) throw fail(n, 'carriage return');
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw fail(n, 'line over 512 bytes');
    let rec;
    try { rec = JSON.parse(line); } catch { throw fail(n, 'not valid JSON'); }
    const problem = lineProblem(rec);
    if (problem) throw fail(n, problem);
    events.push(rec);
  });
  return events;
}

// The record with every check; `events` is [] when no file exists.
function loadRecord(root, slug) {
  const fail = (reason) => new ReviewLoopRecordError(slug, 0, reason);
  const dir = runDir(root, slug);
  if (dir === 'unsafe') throw fail('run folder is a link or not a folder');
  if (dir === null) return { dir: null, file: null, events: [], text: '', stat: null };
  const file = path.join(dir, 'review-loop.jsonl');
  const st = lstatOrNull(file);
  if (!st) return { dir, file, events: [], text: '', stat: null };
  if (!isPlain(st)) throw fail('record is a link or not a file');
  if (st.size > MAX_RECORD_BYTES) throw fail('file over 64 KiB');
  let text;
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const f = fs.fstatSync(fd);
    if (!isPlain(f) || !sameFile(f, st)) throw new Error('changed');
    const buf = Buffer.alloc(Math.min(f.size, MAX_RECORD_BYTES + 1));
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, off));
  } catch {
    throw fail('record cannot be read');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return { dir, file, text, events: parseRecord(slug, text), stat: st };
}

export function readReviewLoop(root, slug) {
  if (!isRunSlug(slug)) throw new TypeError('review-loop: bad slug');
  return loadRecord(root, slug).events;
}

function utc(now) {
  if (!Number.isFinite(now)) throw new Refusal('clock is not a time');
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Appends one line. The first line is written with O_CREAT|O_EXCL; the opened handle is then checked against an lstat.
function appendEvent(root, slug, rec) {
  const cur = loadRecord(root, slug);
  if (!cur.dir) throw new Refusal('run folder missing');
  const line = `${JSON.stringify(rec)}\n`;
  if (Buffer.byteLength(line) - 1 > MAX_LINE_BYTES) throw new Refusal('record line too long');
  try { parseRecord(slug, cur.text + line); } catch (error) {
    if (error instanceof ReviewLoopRecordError) throw new Refusal(`record refuses the event: ${error.reason}`);
    throw error;
  }
  const nofollow = fs.constants.O_NOFOLLOW ?? 0;
  const flags = cur.stat
    ? fs.constants.O_WRONLY | fs.constants.O_APPEND | nofollow
    : fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_EXCL | nofollow;
  let fd;
  try {
    fd = fs.openSync(cur.file, flags, 0o644);
    const f = fs.fstatSync(fd);
    const now = lstatOrNull(cur.file);
    if (!isPlain(f) || !now || !isPlain(now) || !sameFile(f, now) || (cur.stat && !sameFile(f, cur.stat))) throw new Error('file changed');
    fs.writeSync(fd, line);
  } catch {
    throw new Refusal('record cannot be written');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------- commands

const checkSlug = (s, root) => {
  if (!isRunSlug(s)) throw new Refusal('slug must be a work folder name');
  try { exactWorkPath({ fs, path }, root, workParts(s)); } catch (error) {
    if (error instanceof WorkFolderRefusal) throw new Refusal(error.message);
    throw error;
  }
  return s;
};
const checkRound = (s) => {
  if (typeof s !== 'string' || !ROUND.test(s)) throw new Refusal('round must be 0-5');
  return Number(s);
};
function attemptCmd(args, env) {
  if (args.length !== 5) throw new Refusal(USAGE);
  const slug = checkSlug(args[0], env.root);
  if (!STEP.test(args[1])) throw new Refusal('step must be NN');
  if (!REVIEW_ROLES.includes(args[2])) throw new Refusal('role is not a review Role');
  const round = checkRound(args[3]);
  if (!REASONS.includes(args[4])) throw new Refusal('reason must be crash, no-handoff or lint');
  const [, step, role, , reason] = args;
  const events = loadRecord(env.root, slug).events;
  const same = (e) => e.role === role && e.round === round && e.step === step;
  if (events.some((e) => e.ev === 'notrun' && same(e))) throw new Refusal(`${role} round ${round} is already not run`);
  const first = !events.some((e) => e.ev === 'attempt' && same(e));
  appendEvent(env.root, slug, { v: 1, at: utc(env.now), ev: first ? 'attempt' : 'notrun', role, round, step, reason });
  return { code: 0, lines: [first ? `retry ${role}` : `not run ${role} round ${round}`] };
}

function gateCmd(args, env) {
  if (args.length !== 1) throw new Refusal(USAGE);
  const slug = checkSlug(args[0], env.root);
  const events = loadRecord(env.root, slug).events;
  const lines = events.filter((x) => x.ev === 'notrun')
    .map((e) => `${SECURITY_LANES.has(e.role) ? 'blocking: ' : ''}not run ${e.role} round ${e.round}`);
  if (!lines.length) lines.push('review-loop: nothing to report');
  return { code: 0, lines };
}

const HANDLERS = { attempt: attemptCmd, gate: gateCmd };

export function main(args, env = {}) {
  const e = { root: env.root ?? process.cwd(), now: env.now ?? Date.now() };
  try {
    const list = Array.isArray(args) ? args : [];
    for (const arg of list) {
      if (typeof arg !== 'string') throw new Refusal(USAGE);
      if (CONTROLS.test(arg)) throw new Refusal('argument holds a control character');
      if (arg.length > MAX_ARG_CHARS) throw new Refusal('argument too long');
    }
    const [command, ...rest] = list;
    if (typeof command !== 'string' || !Object.hasOwn(HANDLERS, command)) throw new Refusal(USAGE);
    return HANDLERS[command](rest, e);
  } catch (error) {
    if (error instanceof Refusal) return { code: 3, lines: [`refused: ${error.message}`] };
    if (error instanceof ReviewLoopRecordError) return { code: 1, lines: [error.message] };
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
