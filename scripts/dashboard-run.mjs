// Run detail JSON for the dashboard drawer: Steps with a Did summary, round chips, reviewer routing and active-run data.
import fs from 'node:fs';
import path from 'node:path';
import { isWorkFolder, exactWorkPath } from '../mods/lib/work-folder.mjs';
import { show as showRun, active as activeRun } from './run-state.mjs';
import { readLedger } from './dashboard-tokens.mjs';

const MAX_SLUG = 300;
const MAX_FILES = 200;
const MAX_DID_FILE = 32 * 1024;
const MAX_SUMMARY = 300;
const DID_LINES = 3;
const STEP_FILE = /^\d{2,3}-[a-z0-9-]+\.md$/;
const REVIEWERS = ['code-reviewer', 'fresh-reviewer', 'security', 'pentester', 'vuln-scanner', 'accessibility-tester'];
const GATE_VALUES = ['pass', 'fail'];
const REVIEW_VALUES = ['approve', 'changes', 'blocked'];
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const IO = { fs, path };

// The slug when `raw` (a URL path part, still encoded) names a real run folder inside `.company/work`, else null.
// Validator for untrusted URL input; mirrors the path resolver (fs.realpath/lstat). Covers: oversize, double
// decoding, traversal, case-fold collisions, symlink/junction escapes of the folder or of `.company/work` (CWE-22, CWE-59).
export function resolveRunSlug(root, raw) {
  try {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_SLUG) return null;
    const slug = decodeURIComponent(raw);
    if (!isWorkFolder(slug)) return null;
    if (exactWorkPath(IO, root, [slug]) !== 'exact') return null;
    const work = path.join(root, '.company', 'work');
    const folder = path.join(work, slug);
    if (!fs.lstatSync(folder).isDirectory()) return null;
    const realWork = path.join(fs.realpathSync.native(root), '.company', 'work');
    if (fs.realpathSync.native(work) !== realWork) return null;
    if (fs.realpathSync.native(folder) !== path.join(realWork, slug)) return null;
    return slug;
  } catch {
    return null;
  }
}

// Reviewer Roles of the Steps, first-seen order.
export function routing(steps) {
  const out = [];
  for (const s of Array.isArray(steps) ? steps : []) {
    if (s && REVIEWERS.includes(s.role) && !out.includes(s.role)) out.push(s.role);
  }
  return out;
}

// Reads the Did section of one Step file named by an untrusted run record.
// Validator for untrusted file names and bodies; mirrors the file opener (fs.open) and a plain-text renderer.
// Covers: name pattern, links and hard links, swap between check and open, oversize, invalid UTF-8, control characters (CWE-22, CWE-59, CWE-367).
function didSummary(folder, realFolder, file) {
  let fd = null;
  try {
    if (typeof file !== 'string' || !STEP_FILE.test(file)) return null;
    const full = path.join(folder, file);
    const st = fs.lstatSync(full, { bigint: true });
    if (!st.isFile() || st.nlink !== 1n || st.size > BigInt(MAX_DID_FILE)) return null;
    if (fs.realpathSync.native(full) !== path.join(realFolder, file)) return null;
    fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const ft = fs.fstatSync(fd, { bigint: true });
    if (!ft.isFile() || ft.nlink !== 1n || ft.dev !== st.dev || ft.ino !== st.ino || ft.size > BigInt(MAX_DID_FILE)) return null;
    // Reads at most cap+1 bytes so a file that grows after fstat cannot pass the cap.
    const buf = Buffer.alloc(MAX_DID_FILE + 1);
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    if (off > MAX_DID_FILE) return null;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, off));
    const lines = text.split(/\r\n|\r|\n/);
    const start = lines.findIndex((l) => /^##[ \t]+Did[ \t]*$/.test(l));
    if (start < 0) return null;
    const picked = [];
    for (const line of lines.slice(start + 1)) {
      if (/^#{1,2}[ \t]/.test(line)) break;
      const body = line.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/, '').trim();
      if (body === '') continue;
      picked.push(body);
      if (picked.length === DID_LINES) break;
    }
    if (picked.length === 0) return null;
    return picked.join(' ').replace(CONTROL, '').slice(0, MAX_SUMMARY);
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

const stepNo = (s) => Number.parseInt(s.step, 10) || 0;

function roundsOf(steps) {
  const nums = [...new Set(steps.map((s) => s.round).filter((r) => Number.isInteger(r)))].sort((a, b) => a - b);
  return nums.map((round) => {
    const inRound = steps.filter((s) => s.round === round).sort((a, b) => stepNo(b) - stepNo(a));
    const gate = inRound.find((s) => GATE_VALUES.includes(s.gate));
    const review = inRound.find((s) => REVIEW_VALUES.includes(s.verdict));
    return { round, gate: gate ? gate.gate : null, review: review ? review.verdict : null };
  });
}

function roleTimes(subs) {
  const by = new Map();
  for (const s of Array.isArray(subs) ? subs : []) {
    const t = by.get(s.role) || { role: s.role, ms: 0, steps: 0 };
    if (Number.isFinite(s.ms)) t.ms += s.ms;
    t.steps += 1;
    by.set(s.role, t);
  }
  return [...by.values()];
}

export async function run(root, slug, { now = Date.now(), deps = {} } = {}) {
  const resolved = resolveRunSlug(root, slug);
  if (resolved === null) return null;
  const show = deps.show || showRun;
  const active = deps.active || activeRun;
  const ledger = deps.readLedger || readLedger;
  let view;
  try { view = show(root, resolved, { now }) || {}; } catch { view = {}; }
  const list = Array.isArray(view.steps) ? view.steps : [];
  const folder = path.join(root, '.company', 'work', resolved);
  let realFolder = null;
  try { realFolder = fs.realpathSync.native(folder); } catch { /* summaries stay null */ }
  const steps = list.map((s, i) => ({
    step: s.step, role: s.role, status: s.status, round: s.round,
    summary: realFolder && i < MAX_FILES ? didSummary(folder, realFolder, s.file) : null,
  }));
  const out = { v: 1, slug: resolved, steps, rounds: roundsOf(list), routing: routing(list), active: null };
  let current = null;
  try { current = active(root, { now }).slug; } catch { /* not active */ }
  if (current === resolved) {
    let tokens = null;
    try { tokens = await ledger(root, resolved); } catch { /* no over-cap rows */ }
    out.active = {
      gates: (view.gates || []).map((g) => ({ gate: g.gate, result: g.result, waitS: g.wait ?? null })),
      waves: (view.waves || []).map((w) => ({ wave: w.wave, at: w.at })),
      roleTimes: roleTimes(view.subs),
      overCap: tokens && tokens.state === 'ok' ? tokens.overCap : [],
      fixRounds: view.round ?? 0,
    };
  }
  return out;
}
