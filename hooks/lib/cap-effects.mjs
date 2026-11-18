// Engine side of the `cap` guard: active-run lookup, the guard record and the effects a `cap.M1` verdict names.
// Rules never write; every write of the guard record happens here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importPinned } from './dep-pins.mjs';

export const GUARD_RECORD = 'guard.jsonl';
const MAX_LINES = 1000;
const MAX_LINE = 512;
const HANDOFF_NAME = /^[0-9]{2,3}[a-z]?-[a-z0-9-]{1,64}\.md$/;
const LEDGER_NAME = /^[0-9]{2,3}[a-z]?-[a-z0-9-]{1,64}\.findings\.md$/;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

const lstatOrNull = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const isFile = (p) => { const l = lstatOrNull(p); return l !== null && l.isFile() && !l.isSymbolicLink(); };
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// The host checks the import graph before it loads this file; importPinned checks it again before each script loads.
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function modules() {
  const [lh, rs] = await Promise.all([importPinned(PLUGIN_ROOT, 'scripts/lead-handover.mjs'), importPinned(PLUGIN_ROOT, 'scripts/run-state.mjs')]);
  return { lh, rs };
}

function readSmall(file) {
  const l = lstatOrNull(file);
  if (!l || l.isSymbolicLink() || !l.isFile() || l.size > MAX_LINES * (MAX_LINE + 1)) return null;
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

// The tree that holds .company: a worktree's cwd keeps none, so follow its .git pointer (confirmed from both sides).
export function mainRoot(cwd) {
  const g = path.join(cwd, '.git');
  const l = lstatOrNull(g);
  if (!l || !l.isFile()) return cwd;
  const text = readSmall(g);
  const m = text === null ? null : /^gitdir: (.+?)\r?\n?$/.exec(text);
  if (!m) return cwd;
  const gitdir = path.resolve(cwd, m[1]);
  const wt = path.dirname(gitdir);
  if (path.basename(wt) !== 'worktrees' || path.basename(path.dirname(wt)) !== '.git') return cwd;
  const main = path.dirname(path.dirname(wt));
  const back = readSmall(path.join(gitdir, 'gitdir'));
  const common = readSmall(path.join(gitdir, 'commondir'));
  if (back === null || common === null) return cwd;
  if (path.resolve(gitdir, back.trim()) !== path.resolve(g)) return cwd;
  if (path.resolve(gitdir, common.trim()) !== path.join(main, '.git')) return cwd;
  const w = lstatOrNull(path.join(main, '.company', 'work'));
  return w && w.isDirectory() && !w.isSymbolicLink() ? main : cwd;
}

// Valid rows of the guard record of a run folder.
export function readGuard(dir) {
  const text = readSmall(path.join(dir, GUARD_RECORD));
  if (text === null) return { rows: [], count: 0 };
  const lines = text.split('\n').filter((l) => l.length > 0);
  const rows = [];
  for (const l of lines) {
    if (Buffer.byteLength(l) > MAX_LINE) continue;
    try {
      const o = JSON.parse(l);
      if (o && typeof o === 'object' && o.v === 1 && typeof o.ev === 'string') rows.push(o);
    } catch { /* ignore a bad line */ }
  }
  return { rows, count: lines.length };
}

function appendGuard(dir, count, fields, now) {
  if (count >= MAX_LINES) return false;
  const line = `${JSON.stringify({ v: 1, at: iso(now), ...fields })}\n`;
  if (Buffer.byteLength(line) > MAX_LINE + 1) return false;
  const file = path.join(dir, GUARD_RECORD);
  try {
    const l = lstatOrNull(file);
    if (l && (l.isSymbolicLink() || !l.isFile())) return false;
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | NOFOLLOW, 0o644);
    try { fs.writeSync(fd, line); } finally { fs.closeSync(fd); }
    return true;
  } catch { return false; }
}

// The active run and this session's facts (`hook-event` v1 `run`), or null.
export async function resolveRun(event, root, now = Date.now()) {
  const { lh, rs } = await modules();
  const base = mainRoot(root);
  const slug = lh.findRun(base, now);
  if (!slug) return null;
  const dir = lh.workDir(base, slug);
  if (!dir) return null;
  let frozen;
  let stepRunning;
  try {
    frozen = lh.loadRecord(dir).some((e) => e.ev === 'handover' && e.trigger === 'context' && e.session === event.sessionKey);
    stepRunning = rs.show(base, slug, { now }).subs.some((s) => s.start !== null && s.stop === null);
  } catch {
    // An active run whose state cannot be read is not "no run": the cap rule fails closed on it.
    return { error: true, slug, folder: dir };
  }
  const mine = event.agentKey ? readGuard(dir).rows.filter((r) => r.id === event.agentKey) : [];
  return {
    slug, folder: dir, stepRunning, frozen,
    agent: {
      deny: mine.some((r) => r.ev === 'deny'),
      // A Handoff counts once its file is on disk; a recorded stop block counts as the one allowed pass.
      handoff: mine.some((r) => r.ev === 'stop' || (r.ev === 'handoff' && typeof r.file === 'string' && HANDOFF_NAME.test(r.file) && isFile(path.join(dir, r.file)))),
      ledger: mine.some((r) => r.ev === 'ledger')
    }
  };
}

// One `guards-off` row per session in the active run's guard record.
export async function recordGuardsOff(event, root, now = Date.now()) {
  try {
    const { lh } = await modules();
    const base = mainRoot(root);
    const slug = lh.findRun(base, now);
    const dir = slug ? lh.workDir(base, slug) : null;
    if (!dir) return false;
    const { rows, count } = readGuard(dir);
    if (rows.some((r) => r.ev === 'guards-off' && r.session === event.sessionKey)) return false;
    return appendGuard(dir, count, { ev: 'guards-off', session: event.sessionKey }, now);
  } catch { return false; }
}

// The file of this session's last context `handover` event, or null.
function lastHandoverFile(lh, run, session) {
  try {
    const hits = lh.loadRecord(run.folder).filter((e) => e.ev === 'handover' && e.trigger === 'context' && e.session === session && typeof e.file === 'string' && HANDOFF_FILE.test(e.file));
    return hits.length > 0 ? hits[hits.length - 1].file : null;
  } catch { return null; }
}
const HANDOFF_FILE = /^lead-handoff-[1-9]\d{0,3}\.md$/;

// Applies the effect of a `cap.M1` verdict. Returns { extra }: output keys to merge into the hook output.
export async function applyEffect(verdict, event, root, now = Date.now()) {
  const extra = {};
  try {
    const run = event.run;
    switch (verdict.effect) {
      case 'cap-step-record': {
        if (!run || !event.agentKey) break;
        const { rows, count } = readGuard(run.folder);
        const mine = rows.filter((r) => r.id === event.agentKey);
        if (verdict.v === 'deny') {
          if (!mine.some((r) => r.ev === 'deny')) appendGuard(run.folder, count, { ev: 'deny', id: event.agentKey }, now);
          break;
        }
        const first = event.tool && event.tool.paths[0];
        const name = first && first.real ? path.basename(first.real) : '';
        const ev = HANDOFF_NAME.test(name) ? 'handoff' : LEDGER_NAME.test(name) ? 'ledger' : null;
        if (ev && !mine.some((r) => r.ev === ev && (ev === 'ledger' || r.file === name))) appendGuard(run.folder, count, { ev, id: event.agentKey, file: name }, now);
        break;
      }
      case 'cap-lead-freeze': {
        if (!run) break;
        const { lh } = await modules();
        let name = null;
        try { name = lh.contextHandover(mainRoot(root), run.slug, { tokens: event.tokens.total, session: event.sessionKey, now }); } catch { /* refused: the deny stands */ }
        if (typeof name !== 'string') name = lastHandoverFile(lh, run, event.sessionKey);
        if (name) extra.reasonSuffix = `handoff: .company/work/${run.slug}/${name}`;
        break;
      }
      case 'cap-lead-frozen': {
        if (!run) break;
        const { lh } = await modules();
        const name = lastHandoverFile(lh, run, event.sessionKey);
        if (name) extra.reasonSuffix = `handoff: .company/work/${run.slug}/${name}`;
        break;
      }
      case 'cap-warn':
        if (verdict.message) extra.systemMessage = verdict.message;
        break;
      default:
        break;
    }
  } catch { /* the verdict stands unrecorded */ }
  return { extra };
}

// One `stop` row per agent: the stop block is given once.
export function recordStopBlock(event, now = Date.now()) {
  try {
    const run = event.run;
    if (!run || !event.agentKey) return false;
    const { rows, count } = readGuard(run.folder);
    if (rows.some((r) => r.id === event.agentKey && r.ev === 'stop')) return false;
    return appendGuard(run.folder, count, { ev: 'stop', id: event.agentKey }, now);
  } catch { return false; }
}
