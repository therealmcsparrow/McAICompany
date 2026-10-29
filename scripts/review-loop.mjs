#!/usr/bin/env node
// Review loop (contract: docs/contracts/review-loop.md v1). Node built-ins only.
// uses: docs/contracts/handoff.md v1.3
// Keeps the retry and "not run" count of review dispatches and the run-branch commit each repair round starts from in one
// append-only record, and decides churn from git hunks of the judging diff. Arguments, the record, review-file text and
// git output are untrusted: values are allow-listed before use, sizes are capped before parsing, and any failed or
// unparsable git call ends in "unknown", never in a pass.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { contests, parseLocations } from './handoff-lint.mjs';

export const REVIEW_ROLES = ['code-reviewer', 'fresh-reviewer', 'qa', 'security', 'pentester', 'vuln-scanner', 'senior-engineer',
  'accessibility-tester', 'hands-on-tester', 'persona-tester', 'legal'];
const SECURITY_LANES = new Set(['security', 'pentester', 'vuln-scanner']);
const REASONS = ['crash', 'no-handoff', 'lint'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STEP = /^\d{2,3}$/;
const ROUND = /^[0-5]$/;
const CONTROLS = /[\u0000-\u001f\u007f]/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MAX_ARG_CHARS = 4096;
const MAX_LINE_BYTES = 512;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_RECORD_LINES = 500;
const GIT_TIMEOUT_MS = 30000;
const GIT_MAX_BYTES = 8 * 1024 * 1024;
const MAX_PATHS = 5000;
const USAGE = 'usage: attempt <slug> <step> <role> <round> <reason> | mark <slug> <round> --base <full id> | churn <slug> <round> --base <full id> | gate <slug> [--base <full id>]';

class Refusal extends Error {}
class GitUnknown extends Error {}

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
  for (const part of ['.company', 'work', slug]) {
    dir = path.join(dir, part);
    const st = lstatOrNull(dir);
    if (!st) return null;
    if (!st.isDirectory()) return 'unsafe';
  }
  return dir;
}

function lineProblem(rec, hexLen) {
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return 'line is not an object';
  const keys = Object.keys(rec).sort().join(',');
  if (rec.v !== 1) return 'v must be 1';
  if (typeof rec.at !== 'string' || !AT.test(rec.at)) return 'at is not a UTC time';
  if (!Number.isInteger(rec.round) || rec.round < 0 || rec.round > 5) return 'round must be 0-5';
  if (rec.ev === 'mark') {
    if (keys !== 'at,commit,ev,round,v') return 'mark keys';
    if (typeof rec.commit !== 'string' || !(hexLen ? new RegExp(`^[0-9a-f]{${hexLen}}$`) : /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/).test(rec.commit)) return 'commit is not a full id';
    return null;
  }
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
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new TypeError('review-loop: bad slug');
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

// ---------------------------------------------------------------- git (judging form)

const childEnv = (extra) => {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
  return { ...env, ...extra };
};

function run(args, cwd, env) {
  const r = spawnSync('git', args, { cwd, env, shell: false, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BYTES, windowsHide: true });
  if (r.error || r.signal || r.status === null) return { ok: false, code: null, out: Buffer.alloc(0) };
  return { ok: true, code: r.status, out: r.stdout };
}

class Git {
  constructor(root) {
    const top = run(['rev-parse', '--show-toplevel'], root, childEnv({}));
    const text = top.ok && top.code === 0 ? top.out.toString('utf8') : '';
    this.top = text.endsWith('\n') ? text.slice(0, -1) : text;
    if (!this.top || this.top.includes('\n')) throw new GitUnknown('top level');
    this.noGraft = null;
  }

  // Graft check in the plain judging env (no GIT_GRAFT_FILE of ours): anything at the printed path ends the run.
  graftCheck() {
    const r = run(['rev-parse', '--git-path', 'info/grafts'], this.top, childEnv({ GIT_NO_REPLACE_OBJECTS: '1' }));
    const text = r.ok && r.code === 0 ? r.out.toString('utf8') : '';
    const p = text.endsWith('\n') ? text.slice(0, -1) : text;
    if (!p || p.includes('\n')) throw new GitUnknown('graft check');
    let st;
    try { st = fs.lstatSync(path.resolve(this.top, p)); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw new GitUnknown('graft check');
    }
    if (st) throw new GitUnknown('grafts file present');
  }

  // Every call after the top-level one: graft check, replace refs off, no optional locks, no fsmonitor.
  call(sub, { judging = false } = {}) {
    this.graftCheck();
    if (!this.noGraft) {
      this.noGraft = path.join(os.tmpdir(), `aico-no-grafts-${crypto.randomBytes(8).toString('hex')}`);
      if (lstatOrNull(this.noGraft)) throw new GitUnknown('graft file name taken');
    }
    const env = childEnv({ GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: this.noGraft, ...(judging ? { GIT_LITERAL_PATHSPECS: '1' } : {}) });
    const args = ['--no-replace-objects', '--no-optional-locks', ...(judging ? ['--literal-pathspecs'] : []), '-c', 'core.fsmonitor=false',
      ...(judging ? ['-c', 'diff.ignoreSubmodules=none'] : []), ...sub];
    const r = run(args, this.top, env);
    if (!r.ok) throw new GitUnknown('git call failed');
    return r;
  }

  // Exit 0 → text; any other exit → failure.
  text(sub, opts) {
    const r = this.call(sub, opts);
    if (r.code !== 0) throw new GitUnknown('git call failed');
    return r.out;
  }

  line(sub) {
    const s = this.text(sub).toString('utf8');
    if (!s.endsWith('\n')) throw new GitUnknown('git output');
    const v = s.slice(0, -1);
    if (v.includes('\n')) throw new GitUnknown('git output');
    return v;
  }

  hexLength() {
    const f = this.line(['rev-parse', '--show-object-format']);
    if (f === 'sha1') return 40;
    if (f === 'sha256') return 64;
    throw new GitUnknown('object format');
  }

  // A commit id spelled as a full id; the id must name a commit.
  commit(id, hex) {
    if (typeof id !== 'string' || !new RegExp(`^[0-9a-f]{${hex}}$`).test(id)) throw new GitUnknown('id is not a full id');
    const got = this.line(['rev-parse', '--verify', '--end-of-options', `${id}^{commit}`]);
    if (got !== id) throw new GitUnknown('id is not a commit');
    return id;
  }

  // git.M4: 0 = ancestor, 1 = not, anything else is a failure.
  isAncestor(a, b) {
    const r = this.call(['merge-base', '--is-ancestor', '--end-of-options', a, b]);
    if (r.code === 0) return true;
    if (r.code === 1) return false;
    throw new GitUnknown('ancestor check failed');
  }
}

const DIFF_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-color', '--no-relative', '--ignore-submodules=none'];

// ---------------------------------------------------------------- hunks

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d{1,9})(?:,(\d{1,9}))? @@/;

// New-side line ranges per patch section; a deletion hunk (+s,0) covers lines s and s+1.
function hunksOf(patch) {
  const sections = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) { sections.push([]); continue; }
    const m = HUNK.exec(line);
    if (!m || !sections.length) continue;
    const s = Number(m[1]);
    const c = m[2] === undefined ? 1 : Number(m[2]);
    sections.at(-1).push(c === 0 ? { from: s, to: s + 1 } : { from: s, to: s + c - 1 });
  }
  return sections;
}

// path → ranges for the judging diff from `from` to `to`.
function judgingHunks(git, from, to) {
  const tail = ['--end-of-options', from, to, '--'];
  const stat = git.text(['diff', ...DIFF_FLAGS, '--numstat', '-z', '--no-renames', ...tail], { judging: true }).toString('utf8');
  const files = [];
  const parts = stat.split('\0');
  if (parts.pop() !== '') throw new GitUnknown('numstat output');
  for (const rec of parts) {
    const a = rec.indexOf('\t');
    const b = rec.indexOf('\t', a + 1);
    if (a < 0 || b < 0) throw new GitUnknown('numstat output');
    files.push({ path: rec.slice(b + 1), binary: rec.slice(0, a) === '-' && rec.slice(a + 1, b) === '-' });
  }
  if (files.length > MAX_PATHS) throw new GitUnknown('too many paths');
  const patch = git.text(['diff', ...DIFF_FLAGS, '--unified=0', '--no-renames', ...tail], { judging: true }).toString('utf8');
  const sections = hunksOf(patch);
  if (sections.length !== files.length) throw new GitUnknown('patch and numstat differ');
  const out = new Map();
  files.forEach((f, i) => {
    let ranges = sections[i];
    if (f.binary) ranges = binaryRanges(git, from, to, f.path);
    if (!out.has(f.path)) out.set(f.path, []);
    out.get(f.path).push(...ranges);
  });
  return out;
}

const blobNul = (git, commit, p) => {
  const r = git.call(['rev-parse', '--verify', '--quiet', '--end-of-options', `${commit}:${p}`]);
  if (r.code === 1) return false;
  if (r.code !== 0) throw new GitUnknown('blob lookup');
  const id = r.out.toString('utf8').replace(/\n$/, '');
  if (!/^[0-9a-f]{40,64}$/.test(id)) throw new GitUnknown('blob lookup');
  if (git.line(['cat-file', '-t', '--end-of-options', id]) !== 'blob') throw new GitUnknown('not a blob');
  return git.text(['cat-file', 'blob', '--end-of-options', id]).subarray(0, 8000).includes(0);
};

// A path the diff calls binary: decided by blob content. Real binary → the whole file counts as one hunk;
// text under an attribute → the one-path --text diff.
function binaryRanges(git, from, to, p) {
  if (blobNul(git, from, p) || blobNul(git, to, p)) return [{ from: 1, to: Infinity }];
  const tail = ['--end-of-options', from, to, '--', p];
  const names = git.text(['diff', ...DIFF_FLAGS, '--name-only', '-z', '--no-renames', ...tail], { judging: true }).toString('utf8');
  if (names !== `${p}\0`) throw new GitUnknown('one-path check');
  const patch = git.text(['diff', ...DIFF_FLAGS, '--text', '--unified=0', '--no-renames', ...tail], { judging: true }).toString('utf8');
  const sections = hunksOf(patch);
  if (sections.length !== 1) throw new GitUnknown('one-path patch');
  return sections[0];
}

// ---------------------------------------------------------------- churn

const overlap = (loc, r) => {
  if (loc.from === null) return Math.max(r.from, 1);
  const lo = Math.max(loc.from, r.from);
  return lo <= Math.min(loc.to, r.to) ? Math.max(lo, 1) : 0;
};
const normPath = (p) => p.replace(/^(?:\.\/)+/, '');

// The mark of a round from the record: exactly one, else null.
function markOf(events, round) {
  const marks = events.filter((e) => e.ev === 'mark' && e.round === round);
  return marks.length === 1 ? marks[0] : null;
}

function reviewerLineages(runFolder) {
  const c = contests(runFolder);
  if (c.errors.includes('cannot read run folder')) throw new GitUnknown('run folder');
  return c.lineages.filter((l) => REVIEW_ROLES.includes(l.role) && l.mode !== 'plan' && l.holders.length > 0);
}

// Returns { lines, unknown }. Churn is judged only from recorded and re-read facts.
function churn(root, slug, round, base) {
  const unknown = { lines: ['churn: unknown'], unknown: true };
  try {
    const events = loadRecord(root, slug).events;
    const mark = markOf(events, round);
    if (!mark) return unknown;
    const git = new Git(root);
    const hex = git.hexLength();
    git.commit(base, hex);
    const markCommit = git.commit(mark.commit, hex);
    const ref = `refs/heads/aico/${slug}`;
    const head = git.call(['symbolic-ref', '--quiet', 'HEAD']);
    if (head.code !== 0 || head.out.toString('utf8') !== `${ref}\n`) return unknown;
    const tip = git.commit(git.line(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]), hex);
    if (!git.isAncestor(base, markCommit) || !git.isAncestor(markCommit, tip)) return unknown;
    const hunks = judgingHunks(git, markCommit, tip);
    const dir = runDir(root, slug);
    if (typeof dir !== 'string' || dir === 'unsafe') return unknown;
    const lineages = reviewerLineages(dir);
    const first = (l) => l.holders[0];
    const fresh = lineages.filter((l) => first(l).round === round);
    const earlier = lineages.filter((l) => first(l).round < round);
    const locs = (l) => parseLocations(first(l).text).map((x) => ({ ...x, path: normPath(x.path) }));
    const lines = [];
    let noLoc = 0;
    for (const l of fresh) {
      const ls = locs(l);
      if (!ls.length) { noLoc += 1; continue; }
      let hit = null;
      for (const loc of ls) {
        for (const r of hunks.get(loc.path) ?? []) {
          const n = overlap(loc, r);
          if (n) { hit = { path: loc.path, n }; break; }
        }
        if (hit) break;
      }
      if (!hit) continue;
      lines.push(`churn ${l.key} ${hit.path}:${hit.n}`);
      for (const e of earlier) if (locs(e).some((x) => x.path === hit.path)) lines.push(`fixed-before ${e.key}`);
    }
    if (!lines.length) lines.push('churn: none');
    if (noLoc) lines.push(`churn: ${noLoc} rows without a location`);
    return { lines, unknown: false };
  } catch (error) {
    if (error instanceof GitUnknown || error instanceof ReviewLoopRecordError) return unknown;
    throw error;
  }
}

// ---------------------------------------------------------------- commands

const checkSlug = (s) => {
  if (typeof s !== 'string' || !SLUG.test(s)) throw new Refusal('slug must match ^[a-z0-9][a-z0-9-]{0,63}$');
  return s;
};
const checkRound = (s) => {
  if (typeof s !== 'string' || !ROUND.test(s)) throw new Refusal('round must be 0-5');
  return Number(s);
};
const checkBase = (s) => {
  if (typeof s !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(s)) throw new Refusal('--base must be a full object id');
  return s;
};

// `--base <id>` as the one trailing option pair.
function takeBase(rest, required) {
  if (rest.length === 0 && !required) return null;
  if (rest.length !== 2 || rest[0] !== '--base') throw new Refusal(USAGE);
  return checkBase(rest[1]);
}

function attemptCmd(args, env) {
  if (args.length !== 5) throw new Refusal(USAGE);
  const slug = checkSlug(args[0]);
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

function markCmd(args, env) {
  if (args.length < 1) throw new Refusal(USAGE);
  const slug = checkSlug(args[0]);
  const round = checkRound(args[1]);
  const base = takeBase(args.slice(2), true);
  const cur = loadRecord(env.root, slug);
  if (cur.events.some((e) => e.ev === 'mark' && e.round === round)) throw new Refusal(`round ${round} already marked`);
  let commit;
  try {
    const git = new Git(env.root);
    const hex = git.hexLength();
    git.commit(base, hex);
    const ref = `refs/heads/aico/${slug}`;
    const head = git.call(['symbolic-ref', '--quiet', 'HEAD']);
    if (head.code !== 0 && head.code !== 1) throw new GitUnknown('symbolic-ref');
    if (head.code !== 0 || head.out.toString('utf8') !== `${ref}\n`) throw new Refusal(`HEAD is not ${ref}`);
    commit = git.commit(git.line(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]), hex);
    if (!git.isAncestor(base, commit)) throw new Refusal('--base is not an ancestor of the run branch');
  } catch (error) {
    if (error instanceof GitUnknown) return { code: 1, lines: [`review-loop: git check failed (${error.message})`] };
    throw error;
  }
  appendEvent(env.root, slug, { v: 1, at: utc(env.now), ev: 'mark', round, commit });
  return { code: 0, lines: [`marked round ${round} ${commit}`] };
}

function churnCmd(args, env) {
  if (args.length < 1) throw new Refusal(USAGE);
  const slug = checkSlug(args[0]);
  const round = checkRound(args[1]);
  const base = takeBase(args.slice(2), true);
  const r = churn(env.root, slug, round, base);
  return { code: r.unknown || r.lines.some((l) => l.startsWith('churn ')) ? 2 : 0, lines: r.lines };
}

const BLOCKING_STATES = new Set(['open', 'contested', 'escalated', 'upheld', 'rejected']);

// A blocking finding of one reviewer that no blocking finding of the other overlaps.
function singles(runFolder) {
  const lineages = reviewerLineages(runFolder).filter((l) => l.role === 'code-reviewer' || l.role === 'fresh-reviewer');
  if (!lineages.some((l) => l.role === 'fresh-reviewer') || !lineages.some((l) => l.role === 'code-reviewer')) return [];
  const live = lineages.filter((l) => BLOCKING_STATES.has(l.state));
  const locs = (l) => parseLocations(l.holders[0].text).map((x) => ({ ...x, path: normPath(x.path) }));
  const touches = (a, b) => a.path === b.path && (a.from === null || b.from === null || (a.from <= b.to && b.from <= a.to));
  const out = [];
  for (const l of live) {
    const seen = new Set();
    for (const loc of locs(l)) {
      const other = live.some((o) => o.role !== l.role && locs(o).some((x) => touches(loc, x)));
      if (!other && !seen.has(loc.path)) { seen.add(loc.path); out.push(`single ${l.key} ${loc.path}`); }
    }
  }
  return out;
}

function gateCmd(args, env) {
  if (args.length < 1) throw new Refusal(USAGE);
  const slug = checkSlug(args[0]);
  const base = takeBase(args.slice(1), false);
  const events = loadRecord(env.root, slug).events;
  const lines = [];
  let code = 0;
  for (const e of events.filter((x) => x.ev === 'notrun')) {
    lines.push(`${SECURITY_LANES.has(e.role) ? 'blocking: ' : ''}not run ${e.role} round ${e.round}`);
  }
  const rounds = [...new Set(events.filter((e) => e.ev === 'mark').map((e) => e.round))].sort((a, b) => a - b);
  for (const round of rounds) {
    const r = base ? churn(env.root, slug, round, base) : { lines: ['churn: unknown'], unknown: true };
    if (r.unknown) { lines.push('churn: unknown'); code = 2; continue; }
    lines.push(...r.lines.filter((l) => l.startsWith('churn ') || l.startsWith('fixed-before ')));
  }
  const dir = runDir(env.root, slug);
  if (typeof dir === 'string' && dir !== 'unsafe') {
    try { lines.push(...singles(dir)); } catch (error) {
      if (!(error instanceof GitUnknown)) throw error;
      lines.push('single: unknown');
      code = 2;
    }
  }
  if (!lines.length) lines.push('review-loop: nothing to report');
  return { code, lines };
}

const HANDLERS = { attempt: attemptCmd, mark: markCmd, churn: churnCmd, gate: gateCmd };

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
