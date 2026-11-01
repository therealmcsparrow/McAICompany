#!/usr/bin/env node
// Step split (contract: docs/contracts/step-split.md v1). Node built-ins only.
// uses: docs/contracts/review-depth.md v1.3 docs/contracts/work-folder-name.md v1
// Usage: node scripts/step-split.mjs review '<run>' <base> <round> [--max-lines <n>] [--max-files <n>]
//        node scripts/step-split.mjs fix '<run>' <round> <handoff>...
//        node scripts/step-split.mjs show '<run>' <r|f><round>
// Splits a review or a Fix round into groups small enough for one context window.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readInside } from './handoff-lint.mjs';
import { WorkFolderRefusal, checkWorkDirs, exactWorkPath, isWorkFolder } from '../mods/lib/work-folder.mjs';

const MAX_LINES = 1200;
const MAX_FILES = 25;
const MAX_BLOCKERS = 8;
const MAX_HANDOFFS = 50;
const MAX_HANDOFF_BYTES = 1024 * 1024;
const MAX_GROUP_BYTES = 1024 * 1024;
const MAX_JSON = 8 * 1024 * 1024;
const MAX_PATH = 300;
const MAX_PATH_LISTED = 4096;
const MAX_GROUPS = 9999;
const EXEC_TIMEOUT_MS = 60000;
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ROUND = /^(?:0|[1-9]\d{0,2})$/;
const LIMIT = /^[1-9]\d{0,6}$/;
// C0/C1 controls, line and paragraph separators and bidi controls never reach stdout or a group file.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const HANDOFF_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}\.md$/;
const ROW = /^- \[(contract|spec|security|test|comprehension)\] (?:[RT]-\d{1,4} )?(.+)$/;
const USAGE = "usage: review '<run>' <base> <round> [--max-lines <n>] [--max-files <n>] | fix '<run>' <round> <handoff>... | show '<run>' <r|f><round>";
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

class Refused extends Error {}

const refuse = (msg) => {
  throw new Refused(msg);
};

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The run folder as a real directory under the exact-spelling work tree; returns its path.
function runFolder(root, run) {
  if (typeof run !== 'string' || !isWorkFolder(run)) refuse('bad run name');
  const io = { fs, path };
  try {
    checkWorkDirs(io, root);
    if (exactWorkPath(io, root, [run]) !== 'exact') refuse('run folder not found');
  } catch (error) {
    if (error instanceof WorkFolderRefusal) refuse(error.message);
    throw error;
  }
  const dir = path.join(root, '.company', 'work', run);
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return refuse('run folder not found');
  }
  if (st.isSymbolicLink() || !st.isDirectory()) refuse('run folder is not a plain folder');
  return dir;
}

// lstat of a path: null when absent, else the stats.
function stat(p) {
  try {
    return fs.lstatSync(p);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return refuse('split folder unreadable');
  }
}

// The split folder: null when absent, else its path (a plain directory).
function splitDir(runDir) {
  const dir = path.join(runDir, 'split');
  const st = stat(dir);
  if (st === null) return null;
  if (st.isSymbolicLink() || !st.isDirectory()) refuse('split is not a plain folder');
  return dir;
}

// The first two path segments name an area when no Module is known.
function areaOf(file) {
  const segs = file.replace(/\\/g, '/').replace(/^\.\//, '').split('/').filter(Boolean);
  return segs.slice(0, 2).join('/');
}

// Greedy packing of units { area, name, weight, size } into groups; one unit over `maxSize` stands alone.
// Units arrive area by area; an area that does not fit in a group by itself is split unit by unit.
function pack(units, maxSize, maxCount) {
  const groups = [];
  let cur = null;
  const flush = () => {
    if (cur) groups.push(cur);
    cur = null;
  };
  const areas = new Map();
  for (const u of units) {
    if (!areas.has(u.area)) areas.set(u.area, []);
    areas.get(u.area).push(u);
  }
  const place = (list) => {
    const size = list.reduce((n, u) => n + u.size, 0);
    if (cur && (cur.size + size > maxSize || cur.items.length + list.length > maxCount)) flush();
    if (!cur) cur = { size: 0, items: [], areas: [] };
    cur.size += size;
    cur.items.push(...list);
    for (const u of list) if (!cur.areas.includes(u.area)) cur.areas.push(u.area);
  };
  for (const name of [...areas.keys()].sort(byName)) {
    const list = areas.get(name).sort((a, b) => byName(a.name, b.name));
    const size = list.reduce((n, u) => n + u.size, 0);
    if (size <= maxSize && list.length <= maxCount) place(list);
    else for (const u of list) {
      if (u.size > maxSize) {
        flush();
        place([u]);
        flush();
      } else place([u]);
    }
  }
  flush();
  return groups;
}

// Writes the files of one split into a temp folder, then renames it to its final name as the last act.
function publish(runDir, kind, round, files) {
  let dir = splitDir(runDir);
  const target = `${kind}${round}`;
  if (dir !== null && stat(path.join(dir, target)) !== null) refuse('split exists');
  if (dir === null) {
    dir = path.join(runDir, 'split');
    try {
      fs.mkdirSync(dir);
    } catch {
      refuse('split folder cannot be created');
    }
  }
  const tmp = path.join(dir, `.tmp-${target}-${process.pid}`);
  try {
    if (stat(tmp) !== null) fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp);
    for (const [name, text] of files) fs.writeFileSync(path.join(tmp, name), text, { flag: 'wx', encoding: 'utf8' });
    fs.renameSync(tmp, path.join(dir, target));
  } catch {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    refuse(stat(path.join(dir, target)) !== null ? 'split exists' : 'split could not be written');
  }
  return target;
}

const rel = (run, target, name) => `.company/work/${run}/split/${target}/${name}`;

// ---- review ----

function runDepth(base, run, root, exec) {
  const argv = [path.join(SCRIPTS_DIR, 'review-depth.mjs'), base, '--run', run, '--json', '--lines'];
  let text;
  try {
    text = exec(process.execPath, argv, { cwd: root, encoding: 'utf8', maxBuffer: MAX_JSON, timeout: EXEC_TIMEOUT_MS, windowsHide: true });
  } catch {
    return refuse('no full path list (review-depth failed)');
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return refuse('no full path list (review-depth output unreadable)');
  }
  if (!json || typeof json !== 'object' || json.v !== 1 || !Array.isArray(json.paths) || !Array.isArray(json.reasons) || typeof json.truncated !== 'boolean') {
    refuse('no full path list (review-depth output unreadable)');
  }
  for (const r of json.reasons) {
    if (r && typeof r === 'object' && r.path === '*' && r.rule !== 'core unknown at base') {
      refuse(`no full path list (${typeof r.rule === 'string' ? r.rule.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 80) : 'unknown'})`);
    }
  }
  if (json.truncated) refuse('no full path list (truncated)');
  if (json.paths.length === 0) refuse('no full path list (paths: [])');
  return json.paths.map((p) => {
    const ok = p && typeof p.path === 'string' && p.path.length > 0 && p.path.length <= MAX_PATH_LISTED && !UNSAFE_CHARS.test(p.path)
      && Number.isSafeInteger(p.lines) && p.lines >= 0;
    if (!ok) refuse('no full path list (bad path entry)');
    return { path: p.path, lines: p.lines, module: typeof p.module === 'string' ? p.module : null };
  });
}

function parseLimit(value, flag) {
  if (typeof value !== 'string' || !LIMIT.test(value)) refuse(`${flag} needs a whole number from 1 to 9999999`);
  return Number(value);
}

function review(args, root, exec) {
  const [run, base, round, ...rest] = args;
  if (run === undefined || base === undefined || round === undefined) refuse(USAGE);
  let maxLines = MAX_LINES;
  let maxFiles = MAX_FILES;
  const seen = new Set();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if ((flag !== '--max-lines' && flag !== '--max-files') || seen.has(flag)) refuse(USAGE);
    seen.add(flag);
    const n = parseLimit(rest[i + 1], flag);
    if (flag === '--max-lines') maxLines = n;
    else maxFiles = n;
  }
  if (!FULL_SHA.test(base)) refuse('base must be a full object id (40 or 64 hex)');
  if (!ROUND.test(round)) refuse('round must be a whole number');
  const runDir = runFolder(root, run);
  const dir = splitDir(runDir);
  if (dir !== null && stat(path.join(dir, `r${round}`)) !== null) refuse('split exists');
  const entries = runDepth(base, run, root, exec);
  const units = entries.map((e) => ({ area: e.module ?? areaOf(e.path), name: e.path, size: e.lines }));
  const groups = pack(units, maxLines, maxFiles);
  if (groups.length > MAX_GROUPS) refuse('too many groups');
  const target = publish(runDir, 'r', round, groups.map((g, i) => [`g${i + 1}.txt`, `${g.items.map((u) => u.name).join('\n')}\n`]));
  const out = [`groups: ${groups.length}`];
  groups.forEach((g, i) => {
    out.push(`group ${i + 1}: ${g.size} lines, ${g.items.length} files: ${g.areas.join(', ')}`, `  ${rel(run, target, `g${i + 1}.txt`)}`);
  });
  return `${out.join('\n')}\n`;
}

// ---- fix ----

// The bullet lines under `## Blocking` of a file as { text, no } (1-based line number).
function blockingLines(text) {
  const out = [];
  let inside = false;
  text.replace(/\r/g, '').split('\n').forEach((line, i) => {
    if (/^##\s/.test(line)) {
      inside = /^##\s+Blocking\s*$/.test(line);
      return;
    }
    if (inside && /^- /.test(line) && !/^- \(?none\.?\)?\s*$/i.test(line)) out.push({ text: line, no: i + 1 });
  });
  return out;
}

// { tag, file, line } for a Blocking row, or null when the line is not one.
export function parseRow(text) {
  const m = ROW.exec(text);
  if (!m) return null;
  if (m[2][0] === ' ') return null;
  // A path ends within MAX_PATH characters of its start, so only that window is searched.
  const rest = m[2].slice(0, MAX_PATH + 24);
  const colon = /:(\d+)/.exec(rest);
  const dash = rest.indexOf(' — ');
  const cuts = [colon ? colon.index : -1, dash].filter((n) => n >= 0);
  if (cuts.length === 0) return null;
  const at = Math.min(...cuts);
  const file = rest.slice(0, at);
  if (file.length < 1 || file.length > MAX_PATH) return null;
  return { tag: m[1], file, line: colon && colon.index === at ? colon[1] : null };
}

// Text of a file below the real root (proj.M-SEC7: real path equals the path, one link, handle ties to lstat); null when absent.
function readPlain(root, segments, cap) {
  let realRoot;
  try {
    realRoot = checkWorkDirs({ fs, path }, root).realRoot;
  } catch {
    return refuse('split folder unreadable');
  }
  const r = readInside(realRoot, segments, cap);
  if (r.status === 'missing') return null;
  if (r.status !== 'ok') refuse(segments.includes('split') ? 'split file is not a plain file within the size limit' : 'handoff is not a plain file within the size limit');
  return r.text;
}

function readHandoff(root, runDir, run, name) {
  const base = name.replace(/\\/g, '/').split('/').pop();
  const prefix = `.company/work/${run}/`;
  const given = name.replace(/\\/g, '/');
  if (given !== base && given !== `${prefix}${base}`) refuse('handoff must be a file in the run folder');
  if (!HANDOFF_NAME.test(base)) refuse('bad handoff name');
  try {
    if (exactWorkPath({ fs, path }, root, [run, base]) !== 'exact') refuse('handoff not found');
  } catch (error) {
    if (error instanceof WorkFolderRefusal) refuse(error.message);
    throw error;
  }
  const r = readPlain(root, ['.company', 'work', run, base], MAX_HANDOFF_BYTES);
  if (r === null) refuse('handoff not found');
  return { name: base, text: r };
}

function fix(args, root) {
  const [run, round, ...names] = args;
  if (run === undefined || round === undefined || names.length === 0) refuse(USAGE);
  if (!ROUND.test(round)) refuse('round must be a whole number');
  if (names.length > MAX_HANDOFFS) refuse('more than 50 handoffs');
  const runDir = runFolder(root, run);
  const dir = splitDir(runDir);
  if (dir !== null && stat(path.join(dir, `f${round}`)) !== null) refuse('split exists');
  const keys = new Set();
  const placed = [];
  const unplaced = [];
  const architect = [];
  for (const name of [...new Set(names)]) {
    const h = readHandoff(root, runDir, run, name);
    for (const row of blockingLines(h.text)) {
      const entry = `${h.name}:${row.no}`;
      const parsed = parseRow(row.text);
      if (parsed === null) {
        unplaced.push({ area: 'unplaced', name: entry, size: 1 });
        continue;
      }
      const key = `${parsed.tag} ${parsed.file}${parsed.line === null ? '' : `:${parsed.line}`}`;
      if (keys.has(key)) continue;
      keys.add(key);
      if (parsed.tag === 'comprehension') architect.push(entry);
      else placed.push({ area: areaOf(parsed.file), name: entry, size: 1, order: placed.length });
    }
  }
  if (placed.length + unplaced.length + architect.length === 0) refuse('no blocking rows');
  const groups = [...pack(placed, MAX_BLOCKERS, MAX_BLOCKERS), ...pack(unplaced, MAX_BLOCKERS, MAX_BLOCKERS)];
  if (groups.length > MAX_GROUPS) refuse('too many groups');
  const files = groups.map((g, i) => [`g${i + 1}.txt`, `${g.items.map((u) => u.name).join('\n')}\n`]);
  if (architect.length) files.push(['architect.txt', `${architect.join('\n')}\n`]);
  const target = publish(runDir, 'f', round, files);
  const out = [`groups: ${groups.length}`];
  groups.forEach((g, i) => {
    out.push(`group ${i + 1}: ${g.items.length} blockers: ${g.areas.join(', ')}`, `  ${rel(run, target, `g${i + 1}.txt`)}`);
  });
  if (architect.length) out.push(`architect: ${architect.length} rows`, `  ${rel(run, target, 'architect.txt')}`);
  return `${out.join('\n')}\n`;
}

// ---- show ----

function countEntries(root, run, which, name) {
  const text = readPlain(root, ['.company', 'work', run, 'split', which, name], MAX_GROUP_BYTES);
  return text === null ? null : text.split('\n').filter(Boolean).length;
}

function show(args, root) {
  const [run, which, ...extra] = args;
  if (run === undefined || which === undefined || extra.length) refuse(USAGE);
  const m = /^([rf])(0|[1-9]\d{0,2})$/.exec(which);
  if (!m) refuse('show needs r<round> or f<round>');
  const runDir = runFolder(root, run);
  const dir = splitDir(runDir);
  const folder = dir === null ? null : path.join(dir, which);
  const st = folder === null ? null : stat(folder);
  if (st === null) return 'groups: 0\n';
  if (st.isSymbolicLink() || !st.isDirectory()) refuse('split folder is not a plain folder');
  let names;
  try {
    names = fs.readdirSync(folder);
  } catch {
    return refuse('split folder unreadable');
  }
  const nums = names.map((n) => /^g([1-9]\d{0,3})\.txt$/.exec(n)).filter(Boolean).map((x) => Number(x[1])).sort((a, b) => a - b);
  const out = [`groups: ${nums.length}`];
  for (const n of nums) out.push(`group ${n}: ${countEntries(root, run, which, `g${n}.txt`)} entries`, `  ${rel(run, which, `g${n}.txt`)}`);
  if (m[1] === 'f' && names.includes('architect.txt')) {
    out.push(`architect: ${countEntries(root, run, which, 'architect.txt')} rows`, `  ${rel(run, which, 'architect.txt')}`);
  }
  return `${out.join('\n')}\n`;
}

// { code, out } for one invocation; `root` is the project folder, `exec` runs review-depth.
export function main(argv, { root = process.cwd(), exec = execFileSync } = {}) {
  try {
    const [cmd, ...args] = argv;
    if (cmd === 'review') return { code: 0, out: review(args, root, exec) };
    if (cmd === 'fix') return { code: 0, out: fix(args, root) };
    if (cmd === 'show') return { code: 0, out: show(args, root) };
    return refuse(USAGE);
  } catch (error) {
    if (error instanceof Refused) return { code: 2, out: `refused: ${error.message}\n` };
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out } = main(process.argv.slice(2));
  process.stdout.write(out);
  process.exitCode = code;
}
