#!/usr/bin/env node
// contract: docs/contracts/context-guard.md v1
// uses: docs/contracts/lead-handoff.md v1.7 docs/contracts/run-state.md v1.7
// Hard hand-over at HANDOVER_AT, done outside the agent: a PreToolUse hook refuses tools to a Step that is at
// the hand-over point, and a SubagentStop hook blocks that Step's stop once when no Handoff was announced.
// Hook input is untrusted: only allow-listed fields are read, the content of a Write never. The guard record
// holds enums, UTC times, file names and truncated hashes. Any failure allows the tool (fail open).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  HANDOVER_AT, findRun, transcriptTokens, claudeDirOf, workDir, lstatOrNull, openRegular, readSmall, iso,
} from './lead-handover.mjs';

export const STEP_REASON = 'aico context cap: this Step reached the hand-over point. Write your Handoff with status: handover to your Output path now, then end. Every other tool is refused.';
export const STOP_REASON = 'aico context cap: this Step was refused tools at the hand-over point. If your Handoff is not written yet, write it now with status: handover to your Output path. Then end.';

const MAX_STDIN = 4 * 1024 * 1024;
const MAX_ARG = 4096;
const MAX_LINES = 1000;
const MAX_LINE = 512;
const SELF_EXIT_MS = 4000;
const AGENT_RE = /^[A-Za-z0-9_-]{1,128}$/;
const HANDOFF_NAME = /^[0-9]{2,3}[a-z]?-[a-z0-9-]{1,64}\.md$/;
const RECORD = 'context-guard.jsonl';
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

const silent = { code: 0, out: '', err: '' };
const hash12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const str = (o, k) => (Object.hasOwn(o, k) && typeof o[k] === 'string' ? o[k] : undefined);

function parse(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_STDIN) return null;
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
  const input = Object.hasOwn(o, 'tool_input') && o.tool_input !== null && typeof o.tool_input === 'object' ? o.tool_input : {};
  return {
    event: str(o, 'hook_event_name'),
    transcript: str(o, 'transcript_path'),
    agent: str(o, 'agent_id'),
    hasAgent: Object.hasOwn(o, 'agent_id'),
    tool: str(o, 'tool_name'),
    file: Object.hasOwn(input, 'file_path') && typeof input.file_path === 'string' ? input.file_path : undefined,
    stopActive: o.stop_hook_active === true,
  };
}

function options(o = {}) {
  const env = o.env ?? process.env;
  return { root: o.root ?? process.cwd(), claudeDir: o.claudeDir ?? claudeDirOf(env), env, now: o.now ?? Date.now() };
}

// The tree that holds .company: a worktree's cwd keeps no .company (it is untracked), so follow its .git pointer.
function mainRoot(cwd) {
  const g = path.join(cwd, '.git');
  const l = lstatOrNull(g);
  if (!l || !l.isFile()) return cwd;
  const text = readSmall(g, 4096);
  const m = text === null ? null : /^gitdir: (.+?)\r?\n?$/.exec(text);
  if (!m) return cwd;
  const gitdir = path.resolve(cwd, m[1]);
  const wt = path.dirname(gitdir);
  if (path.basename(wt) !== 'worktrees' || path.basename(path.dirname(wt)) !== '.git') return cwd;
  const main = path.dirname(path.dirname(wt));
  const w = lstatOrNull(path.join(main, '.company', 'work'));
  return w && w.isDirectory() && !w.isSymbolicLink() ? main : cwd;
}

function runOf(root, now) {
  const base = mainRoot(root);
  const slug = findRun(base, now);
  if (!slug) return null;
  const dir = workDir(base, slug);
  return dir ? { slug, dir } : null;
}

function stepFile(transcript, agent) {
  if (typeof transcript !== 'string' || transcript.length === 0 || transcript.length > MAX_ARG || !transcript.endsWith('.jsonl')) return null;
  if (typeof agent !== 'string' || !AGENT_RE.test(agent)) return null;
  return path.join(transcript.slice(0, -'.jsonl'.length), 'subagents', `agent-${agent}.jsonl`);
}

// Valid lines of the guard record; a bad line is ignored, an unreadable record is empty.
function loadGuard(dir) {
  const text = readSmall(path.join(dir, RECORD), MAX_LINES * (MAX_LINE + 1));
  if (text === null) return { lines: [], count: 0 };
  const raw = text.split('\n').filter((l) => l.length > 0);
  const lines = [];
  for (const l of raw) {
    if (Buffer.byteLength(l) > MAX_LINE) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    if (o === null || typeof o !== 'object' || o.v !== 1 || typeof o.at !== 'string' || !AT_RE.test(o.at)) continue;
    if (typeof o.id !== 'string' || !/^[0-9a-f]{12}$/.test(o.id)) continue;
    if (o.ev === 'deny' || (o.ev === 'handoff' && typeof o.file === 'string' && HANDOFF_NAME.test(o.file))) lines.push(o);
  }
  return { lines, count: raw.length };
}

function appendGuard(dir, count, fields, now) {
  if (count >= MAX_LINES) return false;
  const line = `${JSON.stringify({ v: 1, at: iso(now), ...fields })}\n`;
  if (Buffer.byteLength(line) > MAX_LINE + 1) return false;
  const file = path.join(dir, RECORD);
  try {
    if (!lstatOrNull(file)) {
      try {
        const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o644);
        try { fs.writeSync(fd, line); } finally { fs.closeSync(fd); }
        return true;
      } catch (e) { if (e.code !== 'EEXIST') return false; }
    }
    const h = openRegular(file, fs.constants.O_WRONLY | fs.constants.O_APPEND);
    if (!h) return false;
    try { fs.writeSync(h.fd, line); } finally { fs.closeSync(h.fd); }
    return true;
  } catch { return false; }
}

// A Write of a new Handoff file directly in the run folder: the file name, else null.
function handoffTarget(file, cwd, run) {
  if (typeof file !== 'string' || file.length === 0 || file.length > MAX_ARG || file.includes('\0')) return null;
  const abs = path.resolve(cwd, file);
  const name = path.basename(abs);
  if (!HANDOFF_NAME.test(name)) return null;
  try {
    if (fs.realpathSync.native(path.dirname(abs)) !== fs.realpathSync.native(run.dir)) return null;
  } catch { return null; }
  return lstatOrNull(abs) === null ? name : null;
}

const deny = (reason) => ({
  code: 0,
  out: `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`,
  err: '',
});

// PreToolUse adapter. Returns { code, out, err }; never throws.
export function pre(text, opts) {
  try {
    const { root, claudeDir, env, now } = options(opts);
    if (env?.AICO_CONTEXT_GUARD === 'off') return silent;
    const p = parse(text);
    if (!p || p.event !== 'PreToolUse' || !p.hasAgent) return silent;
    const file = stepFile(p.transcript, p.agent);
    if (!file) return silent;
    const tokens = transcriptTokens(file, claudeDir, true);
    if (tokens === null || tokens < HANDOVER_AT) return silent;
    const run = runOf(root, now);
    if (!run) return silent;
    const id = hash12(p.agent);
    const rec = loadGuard(run.dir);
    if (p.tool === 'Write') {
      const name = handoffTarget(p.file, mainRoot(root), run);
      if (name) {
        appendGuard(run.dir, rec.count, { ev: 'handoff', id, file: name }, now);
        return silent;
      }
    }
    if (!rec.lines.some((l) => l.ev === 'deny' && l.id === id)) appendGuard(run.dir, rec.count, { ev: 'deny', id }, now);
    return deny(STEP_REASON);
  } catch { return silent; }
}

// SubagentStop adapter: blocks the stop once for a Step that was refused tools and announced no Handoff file.
export function subagentStop(text, opts) {
  try {
    const { root, env, now } = options(opts);
    if (env?.AICO_CONTEXT_GUARD === 'off') return silent;
    const p = parse(text);
    if (!p || p.stopActive || typeof p.agent !== 'string' || !AGENT_RE.test(p.agent)) return silent;
    const run = runOf(root, now);
    if (!run) return silent;
    const id = hash12(p.agent);
    const mine = loadGuard(run.dir).lines.filter((l) => l.id === id);
    if (!mine.some((l) => l.ev === 'deny')) return silent;
    for (const l of mine.filter((x) => x.ev === 'handoff')) {
      const f = lstatOrNull(path.join(run.dir, l.file));
      if (f && f.isFile() && !f.isSymbolicLink()) return silent;
    }
    return { code: 0, out: `${JSON.stringify({ decision: 'block', reason: STOP_REASON })}\n`, err: '' };
  } catch { return silent; }
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let over = false;
    process.stdin.on('data', (c) => {
      total += c.length;
      if (total > MAX_STDIN) over = true;
      else chunks.push(c);
    });
    const done = () => resolve(over ? '' : Buffer.concat(chunks).toString('utf8'));
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    process.stdin.on('close', done);
  });
}

async function hook(kind) {
  setTimeout(() => process.exit(0), SELF_EXIT_MS).unref();
  const text = await readStdin();
  const r = kind === 'pre' ? pre(text) : subagentStop(text);
  if (r.out) process.stdout.write(r.out);
  if (r.err) process.stderr.write(r.err);
  process.exitCode = r.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [cmd] = process.argv.slice(2);
  if ((cmd === 'pre' || cmd === 'subagent-stop') && process.argv.length === 3) {
    hook(cmd).catch(() => { process.exitCode = 0; });
  }
}
