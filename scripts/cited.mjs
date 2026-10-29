#!/usr/bin/env node
// Never-cited report (contract: docs/contracts/cited-report.md v1). Node built-ins only.
// Read-only: nothing is written. Step files are untrusted text: each is size-capped, read without following links, and
// matched with anchored patterns of bounded length. Output holds Role names from the plugin's agents folder, never file text.
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Frozen here: nothing read from a Handoff can change it.
export const KEEP_LANES = Object.freeze(['security', 'pentester', 'vuln-scanner', 'legal', 'accessibility-tester', 'senior-engineer']);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STEP_RE = /^(\d{2,3})-((?:spike-)?([a-z][a-z-]{0,39}))\.md$/;
const PLAN_RE = /^(?:\d{2,3}-)?(?:architect-)?plan(?:-[a-z0-9]+)?\.md$/;
// A cite names a Step by `NN-role` (a file name, a path ending in it, or a bare id), or by prose `Step NN`; read_next entries match the same way.
const CITE_RE = /(?<![0-9A-Za-z-])(\d{2,3}-[a-z][a-z-]{0,63})(?:\.md)?(?![0-9A-Za-z-])/g;
// Prose cite: `Step 11` names every Step numbered 11 of the same run (a Role's own number is shared by parallel Steps).
const STEP_CITE_RE = /(?<![0-9A-Za-z-])[Ss]teps? (\d{2,3})(?![0-9A-Za-z])/g;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_RUN_DIRS = 1000;
const MAX_FILES_PER_RUN = 500;
const AGENTS_DIR = join(import.meta.dirname, '..', 'agents');

class Refusal extends Error {}
const refuse = reason => { throw new Refusal(reason); };

const lstatOrNull = p => { try { return lstatSync(p); } catch { return null; } };

// Whole file as UTF-8 text, or null: not a plain single-link file, over the cap, or not valid UTF-8.
function readText(file) {
  const st = lstatOrNull(file);
  if (!st || !st.isFile() || st.size > MAX_FILE_BYTES) return null;
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const f = fstatSync(fd);
    if (!f.isFile() || f.nlink !== 1 || f.size > MAX_FILE_BYTES) return null;
    const buf = Buffer.alloc(f.size);
    let off = 0;
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, off));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function knownRoles(agentsDir) {
  try {
    return new Set(readdirSync(agentsDir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).filter(r => /^[a-z][a-z-]{0,39}$/.test(r)));
  } catch {
    return new Set();
  }
}

// Newest run folders first by folder time. Linked folders and non-folders are counted, not read.
function runFolders(root, state) {
  const work = join(root, '.company', 'work');
  let names;
  try { names = readdirSync(work).filter(n => SLUG_RE.test(n)).sort().slice(0, MAX_RUN_DIRS); } catch { return []; }
  const dirs = [];
  for (const slug of names) {
    const dir = join(work, slug);
    const st = lstatOrNull(dir);
    if (!st) continue;
    if (!st.isDirectory()) { if (st.isSymbolicLink()) state.skipped++; continue; }
    dirs.push({ slug, dir, time: st.mtimeMs });
  }
  // A linked folder reads as a symbolic link or a junction: lstat of a junction reports a directory on some hosts, so check again.
  return dirs.filter(d => {
    try {
      if (lstatSync(d.dir).isSymbolicLink()) { state.skipped++; return false; }
      return true;
    } catch { return false; }
  }).sort((a, b) => b.time - a.time || (a.slug < b.slug ? -1 : 1));
}

// One run: the valid Steps as [{ nn, stem, role, cites:Set }]. Counts every skipped file in state.
function readRun(dir, roles, state) {
  let names;
  try { names = readdirSync(dir).filter(f => STEP_RE.test(f) && !PLAN_RE.test(f)).sort().slice(0, MAX_FILES_PER_RUN); } catch { return []; }
  const steps = [];
  for (const name of names) {
    const m = STEP_RE.exec(name);
    const nn = Number(m[1]);
    if (nn === 0) continue;
    if (!roles.has(m[3]) || state.bytes >= MAX_TOTAL_BYTES) { state.skipped++; continue; }
    const text = readText(join(dir, name));
    if (text === null) { state.skipped++; continue; }
    state.bytes += Buffer.byteLength(text);
    const cites = new Set();
    for (const c of text.matchAll(CITE_RE)) cites.add(c[1]);
    const nums = new Set();
    for (const c of text.matchAll(STEP_CITE_RE)) nums.add(Number(c[1]));
    steps.push({ nn, stem: `${m[1]}-${m[2]}`, role: m[3], cites, nums });
  }
  return steps;
}

export function report(root, n, { agentsDir = AGENTS_DIR } = {}) {
  const roles = knownRoles(agentsDir);
  const state = { skipped: 0, bytes: 0 };
  const written = new Map();
  const cited = new Map();
  let runs = 0;
  for (const r of runFolders(root, state)) {
    if (runs >= n) break;
    const steps = readRun(r.dir, roles, state);
    if (steps.length === 0) continue;
    runs++;
    for (const s of steps) {
      written.set(s.role, (written.get(s.role) ?? 0) + 1);
      if (steps.some(l => l.nn > s.nn && (l.cites.has(s.stem) || l.nums.has(s.nn)))) cited.set(s.role, (cited.get(s.role) ?? 0) + 1);
    }
  }
  const lines = [`cited-report: runs ${runs}`];
  const keep = new Set(KEEP_LANES);
  for (const role of [...new Set([...written.keys(), ...KEEP_LANES])].sort()) {
    if (keep.has(role)) { lines.push(`keep ${role}`); continue; }
    const w = written.get(role);
    const c = cited.get(role) ?? 0;
    lines.push(c === 0 ? `never cited ${role}` : `cited ${role}: ${c} of ${w}`);
  }
  lines.push(`skipped ${state.skipped}`);
  return { code: 0, lines };
}

function parseRuns(value) {
  if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 50) refuse('--runs must be a whole number from 1 to 50');
  return Number(value);
}

const USAGE = 'usage: cited.mjs report --runs <1-50>';

// Returns { code, lines }. Exit 0 done, 3 refused.
export function main(args, { root = process.cwd(), agentsDir } = {}) {
  try {
    if (args.length !== 3 || args[0] !== 'report' || args[1] !== '--runs') refuse(USAGE);
    return report(root, parseRuns(args[2]), agentsDir ? { agentsDir } : {});
  } catch (e) {
    if (e instanceof Refusal) return { code: 3, lines: [`refused: ${e.message}`] };
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { code, lines } = main(process.argv.slice(2));
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
