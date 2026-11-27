#!/usr/bin/env node
// Tier sets (contract: docs/contracts/tier-sets.md v2.1). Node built-ins only.
// Picks the Roles and lanes of a feature or fix run from the plugin data file company/tier-sets.json,
// decides the run tier and the short or full path, checks plan and diff paths for forced-high hits, and
// keeps a per-run record in .company/work/<slug>/tier-path.jsonl. The record holds enums, integers, a sha
// and a time only. Plans, project.md, git output, the data file and every CLI argument are untrusted data:
// output holds fixed words, known entry names and paths that passed the path rule.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parsePlan, normalizePath } from './plan-tasks.mjs';
import { show } from './run-state.mjs';
import { FORCED_HIGH_V1, tokens } from './forced-tokens.mjs';
import { WorkFolderRefusal, branchId, exactWorkPath, isBranchId, isRunSlug, workParts } from '../mods/lib/work-folder.mjs';

const KiB = 1024;
const MAX_DATA_BYTES = 16 * KiB;
const MAX_RECORD_BYTES = 16 * KiB;
const MAX_RECORD_LINES = 100;
const MAX_RECORD_LINE_BYTES = 512;
const MAX_PLAN_BYTES = 256 * KiB;
const MAX_PROJECT_BYTES = 64 * KiB;
const MAX_ARG_CHARS = 4096;
const MAX_GIT_BYTES = 8 * 1024 * KiB;
const GIT_TIMEOUT_MS = 30000;
const MAX_HIT_LINES = 5;

const PLAN_NAME = /^(\d{2,3}-)?(architect-)?plan(-[a-z0-9]+)?\.md$/;
const SHA = /^[0-9a-f]{7,64}$/;
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_CANDIDATES = 16;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ECHO = /^[a-z0-9-]{1,40}$/;
const TOKEN = /^[a-z0-9]{2,32}$/;
const CONTROLS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const PLAYBOOKS = ['feature', 'fix'];
const TIERS = ['low', 'medium', 'high'];
const RANK = { low: 0, medium: 1, high: 2 };
const WHY = ['short', 'refused', 'tier', 'setting', 'ceo'];
const CAUSES = ['step', 'plan', 'diff', 'sets', 'ceo'];

export const ROUTE_V018 = Object.freeze({
  feature: Object.freeze([
    'product-manager', 'prototype', 'design-researcher', 'architect', 'ui-ux-designer', 'brand-artist', 'spikes', 'persona-tester',
    'senior-engineer-research', 'senior-engineer-map', 'ruleset-sign-off', 'plan-review', 'builders', 'asset-artists', 'code-reviewer',
    'qa', 'security', 'senior-engineer-compliance', 'legal', 'hands-on-tester', 'accessibility-tester', 'writer',
    'destination-spec', 'localizer', 'devops'
  ]),
  fix: Object.freeze(['qa-reproduce', 'owning-engineer', 'code-reviewer', 'qa-rerun', 'security', 'devops'])
});

// The high-only entries: a medium start skips them, and a raise to high owes them (`add before ship:`).
const MEDIUM_DROP = { feature: ['senior-engineer-compliance'], fix: [] };

const REQUIRED = {
  feature: ['product-manager', 'builders', 'code-reviewer', 'qa', 'legal', 'accessibility-tester'],
  fix: ['qa-reproduce', 'owning-engineer', 'code-reviewer', 'qa-rerun']
};

export { FORCED_HIGH_V1, tokens };

export const CORE_FIXED = Object.freeze(['.company/project.md', '.company/settings.json', '.company/standards.md']);

const USAGE = [
  'usage: tier-set.mjs <command>',
  '  sets',
  '  preview <slug> --playbook <feature|fix> --triage <low|medium|high> --short <on|off> [--ceo <short|full>]',
  '  begin <slug> --playbook <feature|fix> --triage <low|medium|high> --short <on|off> --base <sha> [--ceo <short|full>]',
  '  sync <slug> [--plan <plan>] [--diff] [--base <sha>]',
  '  raise <slug> <medium|high>',
  '  ran <slug> <entry>',
  '  read <slug>'
].join('\n');

export class TierPathRecordError extends Error {
  constructor(slug, line, reason) {
    super(`tier-path record ${slug} line ${line}: ${reason}`);
    this.name = 'TierPathRecordError';
    this.reason = reason;
  }
}

class Refusal extends Error {}

// ---------------------------------------------------------------- files

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

// A plain file: a regular file with exactly one hard link.
const isPlain = (st) => st.isFile() && st.nlink === 1;

// Opens without following a link, checks the handle is the inspected file, reads at most max + 1 bytes.
function readOpened(file, expect, max) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (!openedMatches(fd, expect)) throw new Error('file changed');
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

function openedMatches(fd, expect) {
  const f = fs.fstatSync(fd);
  return isPlain(f) && (!expect || (f.dev === expect.dev && f.ino === expect.ino));
}

function decode(bytes) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

// The run folder with no link in .company, .company/work or the slug folder. null when absent, 'unsafe' when a link or not a folder.
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

// ---------------------------------------------------------------- data file

const echo = (x) => (typeof x === 'string' && ECHO.test(x) ? x : '?');
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const keysAre = (obj, keys) => {
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(obj, k));
};
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function refusedSets(reason) {
  const sets = { feature: {}, fix: {} };
  for (const pb of PLAYBOOKS) for (const t of TIERS) sets[pb][t] = [...ROUTE_V018[pb]];
  return { ok: false, rev: 0, sets, forced_high: [...FORCED_HIGH_V1], reason };
}

function validate(data) {
  if (!isObject(data) || !keysAre(data, ['v', 'rev', 'playbooks', 'forced_high'])) return 'shape';
  if (data.v !== 1 || !Number.isInteger(data.rev) || data.rev < 1 || data.rev > 999) return 'shape';
  if (!isObject(data.playbooks)) return 'shape';
  for (const key of Object.keys(data.playbooks)) {
    if (!PLAYBOOKS.includes(key)) return `unknown playbook ${echo(key)}`;
  }
  for (const pb of PLAYBOOKS) {
    if (!Object.hasOwn(data.playbooks, pb)) return `missing playbook ${pb}`;
  }
  for (const pb of PLAYBOOKS) {
    const tiers = data.playbooks[pb];
    if (!isObject(tiers)) return `missing tier ${pb} low`;
    for (const key of Object.keys(tiers)) {
      if (!TIERS.includes(key)) return `unknown tier ${echo(key)}`;
    }
    for (const t of TIERS) {
      if (!Object.hasOwn(tiers, t)) return `missing tier ${pb} ${t}`;
    }
    for (const t of TIERS) {
      const list = tiers[t];
      if (!Array.isArray(list)) return `${pb} ${t} not a list`;
      const index = new Map(ROUTE_V018[pb].map((e, i) => [e, i]));
      for (const e of list) {
        if (typeof e !== 'string' || !index.has(e)) return `unknown entry ${echo(e)}`;
      }
      for (let i = 1; i < list.length; i++) {
        if (index.get(list[i]) <= index.get(list[i - 1])) return `${pb} ${t} order`;
      }
      for (const need of REQUIRED[pb]) {
        if (!list.includes(need)) return `${pb} ${t} lacks ${need}`;
      }
      const want = t === 'medium' ? ROUTE_V018[pb].filter((e) => !MEDIUM_DROP[pb].includes(e)) : ROUTE_V018[pb];
      if (t !== 'low' && !sameList(list, want)) return `${pb} ${t} differs from the v2.0 route`;
    }
  }
  const fh = data.forced_high;
  if (!Array.isArray(fh) || fh.length < 1 || fh.length > 200 || fh.some((x) => typeof x !== 'string' || !TOKEN.test(x)) || new Set(fh).size !== fh.length) {
    return 'forced_high';
  }
  const missing = FORCED_HIGH_V1.find((x) => !fh.includes(x));
  if (missing) return `forced_high lacks ${missing}`;
  return null;
}

export function loadTierSets(pluginRoot) {
  const file = path.join(typeof pluginRoot === 'string' && pluginRoot !== '' ? pluginRoot : defaultPluginRoot(), 'company', 'tier-sets.json');
  let st;
  try {
    st = lstatOrNull(file);
  } catch {
    return refusedSets('unreadable');
  }
  if (!st) return refusedSets('missing');
  if (!isPlain(st)) return refusedSets('unreadable');
  if (st.size > MAX_DATA_BYTES) return refusedSets('too large');
  let bytes;
  try {
    bytes = readOpened(file, st, MAX_DATA_BYTES);
  } catch {
    return refusedSets('unreadable');
  }
  if (bytes.length > MAX_DATA_BYTES) return refusedSets('too large');
  let text;
  try {
    text = decode(bytes);
  } catch {
    return refusedSets('unreadable');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return refusedSets('invalid json');
  }
  const reason = validate(data);
  if (reason) return refusedSets(reason);
  const sets = { feature: {}, fix: {} };
  for (const pb of PLAYBOOKS) for (const t of TIERS) sets[pb][t] = [...data.playbooks[pb][t]];
  return { ok: true, rev: data.rev, sets, forced_high: [...data.forced_high], reason: null };
}

function defaultPluginRoot() {
  return path.resolve(import.meta.dirname, '..');
}

// ---------------------------------------------------------------- forced-high check

// The check key of a path: separators unified, trailing dots and spaces dropped per segment, lower case, no trailing slash.
function trimAlias(segment) {
  let end = segment.length;
  while (end > 0 && (segment[end - 1] === '.' || segment[end - 1] === ' ')) end--;
  return end === 0 ? segment : segment.slice(0, end);
}

function checkKey(p) {
  return p.replaceAll('\\', '/').split('/').map(trimAlias).join('/').toLowerCase().replace(/\/$/, '');
}

function safeEcho(p) {
  const n = normalizePath(p);
  return n.ok ? n.path : '?';
}

// Returns the hits for a list of paths: { reason: 'contract' | 'core' | 'pattern <token>', path }. core holds path keys.
export function checkPaths(paths, { core = [], forcedHigh = FORCED_HIGH_V1 } = {}) {
  const coreKeys = [...core, ...CORE_FIXED].map((c) => checkKey(String(c))).filter((c) => c !== '');
  const forced = new Set(forcedHigh);
  const hits = [];
  for (const original of paths) {
    const p = String(original);
    const key = checkKey(p);
    if (key === 'docs/contracts' || key.startsWith('docs/contracts/')) {
      hits.push({ reason: 'contract', path: safeEcho(p) });
      continue;
    }
    if (coreKeys.some((c) => key === c || key.startsWith(`${c}/`))) {
      hits.push({ reason: 'core', path: safeEcho(p) });
      continue;
    }
    if (key === '.company' || key.startsWith('.company/')) continue;
    let found = null;
    for (const segment of p.replaceAll('\\', '/').split('/')) {
      found = tokens(trimAlias(segment)).find((t) => forced.has(t)) ?? null;
      if (found) break;
    }
    if (found) hits.push({ reason: `pattern ${found}`, path: safeEcho(p) });
  }
  return hits;
}

// The Core paths of .company/project.md at the base commit: { core, warning } or { unknown: true }.
function readCore(env, base) {
  if (typeof base !== 'string' || !FULL_SHA.test(base)) return { unknown: true };
  let text;
  try {
    const bytes = gitRun(env, ['cat-file', 'blob', '--end-of-options', `${base}:.company/project.md`]);
    if (bytes.length > MAX_PROJECT_BYTES) return { unknown: true };
    text = decode(bytes);
  } catch {
    return { unknown: true };
  }
  return parseCore(text);
}

// The Core paths of a project.md text: { core, warning } or { unknown: true } when it has no `## Core` heading.
function parseCore(text) {
  const lines = text.replace(/<!--[\s\S]*?(?:-->|$)/g, '').split('\n').map((l) => l.replace(/\r$/, ''));
  const start = lines.findIndex((l) => l.trimEnd() === '## Core');
  if (start === -1) return { unknown: true };
  const core = [];
  let skipped = 0;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (!line.startsWith('- ')) continue;
    const body = line.slice(2);
    const cut = body.indexOf(': ');
    let item = (cut === -1 ? body : body.slice(0, cut)).trim();
    if (item.length >= 2 && item.startsWith('`') && item.endsWith('`')) item = item.slice(1, -1);
    if (item.startsWith('(') && item.endsWith(')')) continue;
    const n = normalizePath(item);
    if (n.ok && (item.includes('/') || item.includes('.'))) core.push(n.key);
    else skipped++;
  }
  return { core, warning: skipped > 0 ? `warning: ${skipped} core items are not paths, not checked` : null };
}

// ---------------------------------------------------------------- local state (v1.2)
// A product that does not track .company/ (no `.company` entry at the base) keeps its governance files and Core list
// only in the working copy, and a checkout may hold untracked .gitignore files that predate the run. `begin` pins both
// with a sha256 taken before any Role runs; `sync` trusts them only when the hash is unchanged, else it fails closed.

const GOV_FILES = Object.freeze(['.company/project.md', ...CORE_FIXED.filter((f) => f !== '.company/project.md')]);
const isCompanyPath = (p) => {
  const key = checkKey(p);
  return key === '.company' || key.startsWith('.company/');
};

// true when .company/project.md is in the base tree, false when the base has none; throws on a git failure.
// The blob read the Core check makes anyway comes first; only when it fails does ls-tree tell absent from broken.
function baseHasProject(env, base) {
  try {
    gitRun(env, ['cat-file', '-e', '--end-of-options', `${base}:.company/project.md`]);
    return true;
  } catch {
    return gitRun(env, ['ls-tree', '--name-only', '-z', '--end-of-options', base, '--', '.company/project.md'], 'diff').length > 0;
  }
}

// Hash of files at the top level: path, then size and bytes, or `-` when absent. null on any doubt.
// Also returns the bytes read per path, so a caller parses exactly what was hashed.
function hashFiles(top, rels) {
  const h = createHash('sha256');
  const bytesOf = new Map();
  for (const rel of rels) {
    h.update(`${rel}\0`);
    const file = path.join(top, rel);
    const st = lstatOrNull(file);
    if (!st) {
      h.update('-\0');
      continue;
    }
    if (!isPlain(st) || st.size > MAX_PROJECT_BYTES) return null;
    const bytes = readOpened(file, st, MAX_PROJECT_BYTES);
    if (bytes.length > MAX_PROJECT_BYTES) return null;
    h.update(`${bytes.length}\0`);
    h.update(bytes);
    bytesOf.set(rel, bytes);
  }
  return { hex: h.digest('hex'), bytesOf };
}

// { tracked, local, gov, project }: tracked = project.md is in the base tree; local = hash of the untracked .gitignore
// files (outside .company/ when it is untracked), only when there is one; gov = hash of project.md and CORE_FIXED in the
// working copy, only when the base has no project.md and the working copy has one. A failure leaves a value null,
// which the check reads as "not pinned".
function localState(env, base) {
  const out = { tracked: null, local: null, gov: null, project: null };
  try {
    const { top } = gitStart(env);
    out.tracked = baseHasProject(env, base);
    const ignores = gitRun(env, ['ls-files', '--others', '-z', '--', ':(glob)**/.gitignore'], 'glob').toString('utf8')
      .split('\0').filter((p) => p !== '' && (out.tracked || !isCompanyPath(p))).sort();
    if (ignores.length > 0) out.local = hashFiles(top, ignores)?.hex ?? null;
    if (!out.tracked) {
      const g = hashFiles(top, GOV_FILES);
      if (g && g.bytesOf.has('.company/project.md')) {
        out.gov = g.hex;
        out.project = g.bytesOf.get('.company/project.md');
      }
    }
  } catch {
    return { tracked: out.tracked, local: null, gov: null, project: null };
  }
  return out;
}

function readPlanPaths(root, slug, name) {
  if (typeof name !== 'string' || !PLAN_NAME.test(name)) return null;
  const dir = runDir(root, slug);
  if (typeof dir !== 'string' || dir === 'unsafe') return null;
  const file = path.join(dir, name);
  try {
    const st = lstatOrNull(file);
    if (!st || !isPlain(st) || st.size > MAX_PLAN_BYTES) return null;
    const bytes = readOpened(file, st, MAX_PLAN_BYTES);
    if (bytes.length > MAX_PLAN_BYTES) return null;
    const parsed = parsePlan(decode(bytes), { slug });
    if (parsed.tooMany || parsed.tasks.length === 0 || parsed.tasks.some((t) => !t.filesValid)) return null;
    return parsed.tasks.flatMap((t) => t.items);
  } catch {
    return null;
  }
}

function defaultGit(args, { cwd, env }) {
  return execFileSync('git', args, { cwd, env, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_GIT_BYTES, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
}

const GIT_KEY = /^GIT_/i;

// The environment of the process without any GIT_ key, whatever its case.
function cleanGitEnv() {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) if (!GIT_KEY.test(key)) out[key] = value;
  return out;
}

// 'ENOENT' when nothing is at the path; any other code, or 'exists', is a reason to refuse.
function lstatCode(file) {
  try {
    fs.lstatSync(file);
    return 'exists';
  } catch (error) {
    return error && typeof error.code === 'string' ? error.code : 'unknown';
  }
}

function spawnGit(env, args, cwd, gitEnv) {
  const out = env.git(args, { cwd, env: gitEnv });
  const buf = Buffer.isBuffer(out) ? out : Buffer.from(String(out ?? ''), 'utf8');
  if (buf.length > MAX_GIT_BYTES) throw new Error('output too large');
  return buf;
}

// Resolves the top level, checks that no grafts file exists and picks the absent grafts path for later calls.
// The result is kept for the whole command; a failure is kept too, so no later call runs.
function gitStart(env) {
  const state = env.gitState;
  if (state.failed) throw new Error('git setup failed');
  if (state.ready) return state;
  state.failed = true;
  const base = ['--no-replace-objects', '--no-optional-locks', '-c', 'core.fsmonitor=false'];
  const topText = spawnGit(env, [...base, 'rev-parse', '--show-toplevel'], env.root, cleanGitEnv()).toString('utf8').replace(/\r?\n$/, '');
  if (topText === '' || topText.includes('\n') || topText.includes('\0')) throw new Error('no top level');
  const top = path.resolve(topText);
  const printed = spawnGit(env, [...base, 'rev-parse', '--git-path', 'info/grafts'], top, { ...cleanGitEnv(), GIT_NO_REPLACE_OBJECTS: '1' })
    .toString('utf8').replace(/\r?\n$/, '');
  if (printed === '' || printed.includes('\n') || printed.includes('\0')) throw new Error('no grafts path');
  if (lstatCode(path.resolve(top, printed)) !== 'ENOENT') throw new Error('grafts file');
  const noGrafts = path.join(os.tmpdir(), `aico-no-grafts-${randomBytes(8).toString('hex')}`);
  if (lstatCode(noGrafts) !== 'ENOENT') throw new Error('grafts path taken');
  state.top = top;
  state.noGrafts = noGrafts;
  state.ready = true;
  state.failed = false;
  return state;
}

// One git call: fixed argument array, no shell, the top level as cwd. Returns the output as a Buffer; throws on a failure or an output
// over the cap. Mode 'diff' is the judging diff (literal pathspecs); mode 'glob' is the one call that needs pathspec globs.
function gitRun(env, sub, mode = 'plain') {
  const { top, noGrafts } = gitStart(env);
  const literal = mode === 'diff';
  const args = [
    '--no-replace-objects', '--no-optional-locks', ...(literal ? ['--literal-pathspecs'] : []),
    '-c', 'core.fsmonitor=false', ...(literal ? ['-c', 'diff.ignoreSubmodules=none'] : []), ...sub
  ];
  const gitEnv = { ...cleanGitEnv(), GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: noGrafts, ...(literal ? { GIT_LITERAL_PATHSPECS: '1' } : {}) };
  return spawnGit(env, args, top, gitEnv);
}

// The full id length of the repository's object format: 40 for sha1, 64 for sha256. Throws on any other answer.
function objectFormat(env) {
  const name = gitRun(env, ['rev-parse', '--show-object-format']).toString('utf8').replace(/\r?\n$/, '');
  if (name === 'sha1') return 40;
  if (name === 'sha256') return 64;
  throw new Error('unknown object format');
}

// The one full commit id a --base value names, as { id } or { fail }. Every length goes through object-name lookup only,
// never refs. The base must be an ancestor of HEAD: exit 0 is yes, exit 1 is no, anything else is a failed check.
// It makes no object-format call and never throws; len is the full id length of the repository.
function resolveBaseId(env, base, len) {
  const notOne = { fail: 'base is not one commit' };
  let id;
  try {
    if (typeof base !== 'string' || base.length > len) return notOne;
    const exact = new RegExp(`^[0-9a-f]{${len}}$`);
    const ids = gitRun(env, ['rev-parse', `--disambiguate=${base}`]).toString('utf8').split('\n').filter((l) => l !== '');
    if (ids.length === 0 || ids.length > MAX_CANDIDATES || ids.some((x) => !exact.test(x))) return notOne;
    const commits = ids.filter((x) => gitRun(env, ['cat-file', '-t', '--end-of-options', x]).toString('utf8').trim() === 'commit');
    if (commits.length !== 1) return notOne;
    id = commits[0];
  } catch {
    return notOne;
  }
  try {
    gitRun(env, ['merge-base', '--is-ancestor', '--end-of-options', id, 'HEAD']);
  } catch (error) {
    return { fail: error && error.status === 1 ? 'base is not an ancestor of HEAD' : 'ancestor check failed' };
  }
  return { id };
}

const DIFF_FLAGS = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-relative', '--ignore-submodules=none', '--name-only', '-z', '--no-renames'];

// Paths of the work since base, or null when any check or git call fails. The base is used only when it is a full commit id.
// The committed diff ends at the run branch itself; the worktree diff and the untracked lists are read only when HEAD is that branch.
function readDiffPaths(env, base, slug) {
  if (typeof base !== 'string' || !FULL_SHA.test(base) || typeof slug !== 'string' || !isRunSlug(slug)) return null;
  const id = branchId(slug);
  if (typeof id !== 'string' || !isBranchId(id)) return null;
  const ref = `refs/heads/aico/${id}`;
  const tracked = new Set();
  const untracked = new Set();
  const add = (set, buf) => {
    for (const p of buf.toString('utf8').split('\0')) if (p !== '') set.add(p);
  };
  try {
    gitRun(env, ['cat-file', '-e', '--end-of-options', `${base}^{commit}`]);
    if (gitRun(env, ['symbolic-ref', '-q', 'HEAD']).toString('utf8') !== `${ref}\n`) return null;
    gitRun(env, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
    add(tracked, gitRun(env, [...DIFF_FLAGS, '--end-of-options', base, ref, '--'], 'diff'));
    add(tracked, gitRun(env, [...DIFF_FLAGS, '--end-of-options', 'HEAD', '--'], 'diff'));
    add(untracked, gitRun(env, ['ls-files', '--others', '--exclude-per-directory=.gitignore', '-z']));
    add(untracked, gitRun(env, ['ls-files', '--others', '-z', '--', ':(glob)**/.gitignore'], 'glob'));
  } catch {
    return null;
  }
  return { tracked: [...tracked], untracked: [...untracked].filter((p) => !tracked.has(p)) };
}

// A path whose last segment is a .gitignore, with the aliases a Windows file system gives it.
function isIgnoreFile(p) {
  const last = trimAlias(p.replaceAll('\\', '/').split('/').at(-1)).toLowerCase();
  return last === '.gitignore' || last === 'gitign~1';
}

// ---------------------------------------------------------------- record

const BEGIN_KEYS = ['v', 'at', 'ev', 'pb', 'tier', 'path', 'why', 'rev', 'base', 'skip'];
const BEGIN_PINS = ['local', 'gov'];
const HEX64 = /^[0-9a-f]{64}$/;
// The begin keys of a record: the fixed ones plus any of the optional v1.2 pins it carries.
const beginKeysOf = (rec) => [...BEGIN_KEYS, ...BEGIN_PINS.filter((k) => Object.hasOwn(rec, k))];
const RAISE_KEYS = ['v', 'at', 'ev', 'tier', 'cause'];
const RAN_KEYS = ['v', 'at', 'ev', 'entry'];

// The skip list of a begin line: route entries in route order, no repeats, none required, empty on a full path.
function skipValid(rec) {
  if (!Array.isArray(rec.skip)) return false;
  if (rec.path === 'full' && rec.tier !== 'medium') return rec.skip.length === 0;
  const index = new Map(ROUTE_V018[rec.pb].map((e, i) => [e, i]));
  let last = -1;
  for (const e of rec.skip) {
    if (typeof e !== 'string' || !index.has(e) || REQUIRED[rec.pb].includes(e) || index.get(e) <= last) return false;
    last = index.get(e);
  }
  return true;
}

function parseRecordText(slug, text) {
  const records = [];
  if (text === '') return records;
  if (!text.endsWith('\n')) throw new TierPathRecordError(slug, 1, 'line not closed');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length > MAX_RECORD_LINES) throw new TierPathRecordError(slug, 0, 'more than 100 lines');
  let tier = null;
  let beginRec = null;
  const ranSet = new Set();
  lines.forEach((line, i) => {
    const n = i + 1;
    const bad = (reason) => new TierPathRecordError(slug, n, reason);
    if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_LINE_BYTES) throw bad('line over 512 bytes');
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      throw bad('not json');
    }
    if (!isObject(rec)) throw bad('not an object');
    if (rec.v !== 1) throw bad('unknown v');
    if (rec.ev !== 'begin' && rec.ev !== 'raise' && rec.ev !== 'ran') throw bad('unknown ev');
    if (!keysAre(rec, rec.ev === 'begin' ? beginKeysOf(rec) : rec.ev === 'raise' ? RAISE_KEYS : RAN_KEYS)) throw bad('keys');
    if (typeof rec.at !== 'string' || !TIME.test(rec.at)) throw bad('at');
    if (rec.ev === 'ran') {
      if (i === 0) throw bad('first line is not begin');
      if (tier === beginRec.tier) throw bad('ran before a raise');
      if (typeof rec.entry !== 'string' || !beginRec.skip.includes(rec.entry) || ranSet.has(rec.entry)) throw bad('entry');
      ranSet.add(rec.entry);
      records.push(rec);
      return;
    }
    if (!TIERS.includes(rec.tier)) throw bad('tier');
    if (rec.ev === 'begin') {
      if (i !== 0) throw bad('second begin');
      if (!PLAYBOOKS.includes(rec.pb)) throw bad('pb');
      if (rec.path !== 'short' && rec.path !== 'full') throw bad('path');
      if (!WHY.includes(rec.why)) throw bad('why');
      if (!Number.isInteger(rec.rev) || rec.rev < 0 || rec.rev > 999) throw bad('rev');
      if (typeof rec.base !== 'string' || !FULL_SHA.test(rec.base)) throw bad('base');
      if (!skipValid(rec)) throw bad('skip');
      for (const k of BEGIN_PINS) if (Object.hasOwn(rec, k) && (typeof rec[k] !== 'string' || !HEX64.test(rec[k]))) throw bad(k);
      tier = rec.tier;
      beginRec = rec;
    } else {
      if (i === 0) throw bad('first line is not begin');
      if (!CAUSES.includes(rec.cause)) throw bad('cause');
      if (RANK[rec.tier] <= RANK[tier]) throw bad('raise is not above the current tier');
      tier = rec.tier;
    }
    records.push(rec);
  });
  return records;
}

function loadRecord(root, slug) {
  const fail = (reason) => new TierPathRecordError(slug, 0, reason);
  const dir = runDir(root, slug);
  if (dir === null) return { dir: null, file: null, text: '', records: [] };
  if (dir === 'unsafe') throw fail('run folder is a link or not a folder');
  const file = path.join(dir, 'tier-path.jsonl');
  const st = lstatOrNull(file);
  if (!st) return { dir, file, text: '', records: [], stat: null };
  if (!isPlain(st)) throw fail('record is a link or not a file');
  if (st.size > MAX_RECORD_BYTES) throw fail('file over 16 KiB');
  let bytes;
  try {
    bytes = readOpened(file, st, MAX_RECORD_BYTES);
  } catch {
    throw fail('record is a link or not a file');
  }
  if (bytes.length > MAX_RECORD_BYTES) throw fail('file over 16 KiB');
  let text;
  try {
    text = decode(bytes);
  } catch {
    throw fail('not valid UTF-8');
  }
  return { dir, file, text, records: parseRecordText(slug, text), stat: st };
}

// Appends one line. The result is validated first, so the file is never extended into a broken one.
function appendRecord(cur, slug, rec) {
  if (!cur.dir) throw new Refusal('run folder missing');
  const line = `${JSON.stringify(rec)}\n`;
  if (Buffer.byteLength(line, 'utf8') - 1 > MAX_RECORD_LINE_BYTES) throw new Refusal('record line too long');
  if (Buffer.byteLength(cur.text + line, 'utf8') > MAX_RECORD_BYTES) throw new Refusal('record over 16 KiB');
  try {
    parseRecordText(slug, cur.text + line);
  } catch (error) {
    if (error instanceof TierPathRecordError) throw new Refusal(`record refuses the event: ${error.reason}`);
    throw error;
  }
  const nofollow = fs.constants.O_NOFOLLOW ?? 0;
  // A new file is created exclusively, so a planted link or file is never followed or reused.
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | nofollow | (cur.stat ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL);
  let fd;
  try {
    fd = fs.openSync(cur.file, flags, 0o644);
    if (!openedMatches(fd, cur.stat ?? undefined)) throw new Error('file changed');
    fs.writeSync(fd, line);
  } catch {
    throw new Refusal('record cannot be written');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------- view

function utc(now) {
  if (!Number.isFinite(now)) throw new Refusal('clock is not a time');
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// The view is built from the record alone: what was skipped is what begin recorded.
function buildView(slug, records) {
  const begin = records[0];
  const raises = records.filter((r) => r.ev === 'raise');
  const ran = new Set(records.filter((r) => r.ev === 'ran').map((r) => r.entry));
  const tier = raises.length > 0 ? raises.at(-1).tier : begin.tier;
  const cause = raises.length > 0 ? raises[0].cause : null;
  const route = ROUTE_V018[begin.pb];
  const raised = raises.length > 0;
  const set = raised ? [...route] : route.filter((e) => !begin.skip.includes(e));
  return {
    v: 1, slug, state: 'on', pb: begin.pb, start_tier: begin.tier, tier, path: begin.path, why: begin.why, rev: begin.rev,
    base: begin.base, raised, cause, skipped: [...begin.skip], set, add: raised ? begin.skip.filter((e) => !ran.has(e)) : []
  };
}

export function readTierPath(root, slug) {
  if (typeof slug !== 'string' || !isRunSlug(slug)) throw new TierPathRecordError('?', 0, 'bad slug');
  const cur = loadRecord(root, slug);
  if (cur.records.length === 0) return { v: 1, slug, state: 'none' };
  return buildView(slug, cur.records);
}

function statusLines(view, note = null) {
  const lines = [`tier-path: ${view.pb} tier ${view.tier} path ${view.path} rev ${view.rev}`];
  if (view.path === 'short') {
    lines.push(view.raised ? `path: short, raised to ${view.tier} (${view.cause})` : 'path: short (low)');
  } else if (view.start_tier === 'low') {
    lines.push(`path: full (${view.why})`);
  }
  if (view.skipped.length > 0 && !view.raised) lines.push(`skipped by tier: ${view.skipped.join(', ')}`);
  if (view.add.length > 0) lines.push(`add before ship: ${view.add.join(', ')}`);
  lines.push(`set: ${view.set.join(', ')}`);
  if (note) lines.push(note);
  return lines;
}

// ---------------------------------------------------------------- commands

function takeFlags(args, { values = [], bools = [] }) {
  const out = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    if (Object.hasOwn(out, a)) throw new Refusal(USAGE);
    if (bools.includes(a)) out[a] = true;
    else if (values.includes(a)) {
      const v = args[++i];
      if (typeof v !== 'string' || v.startsWith('--')) throw new Refusal(USAGE);
      out[a] = v;
    } else throw new Refusal(USAGE);
  }
  return { flags: out, positional };
}

const oneOf = (list, v, label) => {
  if (!list.includes(v)) throw new Refusal(`${label} must be ${list.join(', ')}`);
  return v;
};

// The exact spelling of the run folder on disk; a letter-case variant is refused before any read or write.
function exactSlug(root, slug) {
  try {
    exactWorkPath({ fs, path }, root, workParts(slug) ?? [slug]);
  } catch (error) {
    if (error instanceof WorkFolderRefusal) throw new Refusal(error.message);
    throw error;
  }
}

function slugArg(positional, count, root) {
  if (positional.length !== count) throw new Refusal(USAGE);
  if (!isRunSlug(positional[0])) throw new Refusal('bad slug');
  exactSlug(root, positional[0]);
  return positional[0];
}

function runTier(env, slug, triage) {
  let step = 'unknown';
  try {
    step = show(env.root, slug, { now: env.now }).tier;
  } catch {
    step = 'unknown';
  }
  const stepRank = Object.hasOwn(RANK, step) ? RANK[step] : 0;
  return { rank: Math.max(RANK[triage], stepRank), stepRank };
}

function beginRecord(env, slug, flags, sets, base, ceoDefault) {
  const pb = oneOf(PLAYBOOKS, flags['--playbook'], 'playbook');
  const triage = oneOf(TIERS, flags['--triage'], 'triage');
  const short = oneOf(['on', 'off'], flags['--short'], 'short');
  const ceo = Object.hasOwn(flags, '--ceo') ? oneOf(['short', 'full'], flags['--ceo'], 'ceo') : ceoDefault;
  const tier = TIERS[runTier(env, slug, triage).rank];
  let why = 'short';
  if (!sets.ok) why = 'refused';
  else if (tier !== 'low') why = 'tier';
  else if (short === 'off') why = 'setting';
  else if (ceo !== 'short') why = 'ceo';
  const short_ = why === 'short';
  const skip = short_ || tier === 'medium' ? ROUTE_V018[pb].filter((e) => !sets.sets[pb][tier].includes(e)) : [];
  return { v: 1, at: utc(env.now), ev: 'begin', pb, tier, path: short_ ? 'short' : 'full', why, rev: sets.rev, base, skip };
}

function cmdSets(args, env) {
  if (args.length !== 0) throw new Refusal(USAGE);
  const sets = loadTierSets(env.pluginRoot);
  const lines = [sets.ok ? `tier-sets: rev ${sets.rev}` : `tier-sets: refused ${sets.reason}`];
  for (const pb of PLAYBOOKS) for (const t of TIERS) lines.push(`${pb} ${t}: ${sets.sets[pb][t].join(', ')}`);
  return { code: 0, lines };
}

function cmdPreview(args, env, write) {
  const { flags, positional } = takeFlags(args, { values: ['--playbook', '--triage', '--short', '--base', '--ceo'] });
  const slug = slugArg(positional, 1, env.root);
  if (write) {
    if (!Object.hasOwn(flags, '--base') || !SHA.test(flags['--base'])) throw new Refusal('base must be a commit sha');
  } else if (Object.hasOwn(flags, '--base')) throw new Refusal(USAGE);
  const sets = loadTierSets(env.pluginRoot);
  let rec;
  let cur = null;
  if (write) {
    cur = loadRecord(env.root, slug);
    if (cur.records.length > 0) throw new Refusal('a begin record exists');
    if (!cur.dir) throw new Refusal('run folder missing');
    let len;
    try {
      len = objectFormat(env);
    } catch {
      throw new Refusal('base is not one commit');
    }
    const resolved = resolveBaseId(env, flags['--base'], len);
    if (resolved.fail) throw new Refusal(resolved.fail);
    rec = beginRecord(env, slug, flags, sets, resolved.id, 'full');
    const pins = localState(env, resolved.id);
    if (pins.local) rec.local = pins.local;
    if (pins.gov) rec.gov = pins.gov;
    appendRecord(cur, slug, rec);
  } else {
    rec = beginRecord(env, slug, flags, sets, '0'.repeat(40), 'short');
  }
  const view = buildView(slug, [rec]);
  return { code: 0, lines: statusLines(view, sets.ok ? null : `tier-sets: refused ${sets.reason}`) };
}

// The major of a Contract header line `# Contract: <name> v<major>.<minor>`, or null.
function headerMajor(text) {
  const m = /^# Contract: \S+ v(\d{1,4})\.\d{1,4}\s*$/.exec(String(text).split(/\r?\n/, 1)[0]);
  return m ? Number(m[1]) : null;
}

// True when a Contract file of the diff is a major change: deleted, header unreadable, a different major, or any doubt.
// A new file (not in the base) and a same-major edit are not. A file under docs/contracts that is not a .md file counts as major.
function contractMajor(env, base, p) {
  if (!/^docs\/contracts\/[^/]+\.md$/.test(p)) return true;
  try {
    const { top } = gitStart(env);
    const file = path.join(top, p);
    const st = lstatOrNull(file);
    if (!st || !isPlain(st) || st.size > 1048576) return true;
    const now = headerMajor(decode(readOpened(file, st, 1048576)));
    if (now === null) return true;
    if (gitRun(env, ['ls-tree', '--name-only', '-z', '--end-of-options', base, '--', p], 'diff').length === 0) return false;
    const before = headerMajor(gitRun(env, ['cat-file', 'blob', '--end-of-options', `${base}:${p}`]).toString('utf8'));
    return before === null || before !== now;
  } catch {
    return true;
  }
}

function checkTo(env, slug, recBase, leadBase, flags, pins = {}) {
  const hits = [];
  let paths = 0;
  let warning = null;
  const wantPlan = Object.hasOwn(flags, '--plan');
  const wantDiff = flags['--diff'] === true;
  if (!wantPlan && !wantDiff) return null;
  // The base check: the Lead's own base, resolved afresh, must be exactly the recorded base. The object format is read
  // once, before any other git call. Any failure leaves no base, so Core and the diff are unknown and nothing else runs.
  let base = null;
  try {
    const len = objectFormat(env);
    if (typeof leadBase === 'string' && leadBase.length <= len && typeof recBase === 'string' && recBase.length === len) {
      const r = resolveBaseId(env, leadBase, len);
      if (r.id === recBase) base = r.id;
    }
  } catch {
    base = null;
  }
  const formatOk = base !== null;
  // v1.2: the local state now, compared with the pins begin took. Only an unchanged pin is trusted.
  // A record without pins (v1.1 and older, or a begin whose pin failed) keeps the v1.1 check unchanged.
  const pinned = typeof pins.gov === 'string' || typeof pins.local === 'string';
  const now = formatOk && pinned ? localState(env, base) : { tracked: null, local: null, gov: null, project: null };
  const govSame = now.tracked === false && typeof pins.gov === 'string' && now.gov === pins.gov;
  const localSame = now.tracked !== null && typeof pins.local === 'string' && now.local === pins.local;
  let core = { unknown: true };
  if (formatOk && (!pinned || now.tracked === true)) core = readCore(env, base);
  else if (govSame && now.project !== null) {
    try {
      core = parseCore(decode(now.project));
    } catch {
      core = { unknown: true };
    }
  }
  const all = [];
  if (core.unknown) hits.push({ source: 'core', reason: 'core unknown', path: null });
  else warning = core.warning;
  if (wantPlan) {
    const items = readPlanPaths(env.root, slug, flags['--plan']);
    if (items === null) hits.push({ source: 'plan', reason: 'plan files unknown', path: null });
    else all.push(...items.map((p) => ({ source: 'plan', p })));
  }
  if (wantDiff) {
    const items = formatOk ? readDiffPaths(env, base, slug) : null;
    if (items === null) hits.push({ source: 'diff', reason: 'diff unknown', path: null });
    else {
      all.push(...items.tracked.map((p) => ({ source: 'diff', p })));
      // Untracked .company/ files of a product that does not track .company/ are its local governance state:
      // checked through the gov pin, never listed. Untracked .gitignore files the local pin proves unchanged are no hit.
      const local = items.untracked.filter((p) => !(govSame && isCompanyPath(p)));
      all.push(...local.map((p) => ({ source: 'diff', p, pinned: localSame })));
    }
  }
  paths = new Set(all.map((x) => x.p)).size;
  for (const x of all) {
    if (x.source === 'diff' && isIgnoreFile(x.p) && !x.pinned) hits.push({ source: 'diff', reason: 'ignore file changed', path: safeEcho(x.p) });
  }
  if (!core.unknown) {
    for (const x of all) {
      if (x.source === 'diff' && isIgnoreFile(x.p)) continue;
      const one = checkPaths([x.p], { core: core.core, forcedHigh: env.forcedHigh });
      if (x.source === 'diff' && one.length > 0 && one[0].reason === 'contract' && !contractMajor(env, base, x.p)) continue;
      if (one.length > 0) hits.push({ source: x.source, reason: one[0].reason, path: one[0].path });
    }
  }
  return { hits, paths, warning };
}

function checkLines(check) {
  const lines = [];
  if (check.hits.length === 0) lines.push(`check: ${check.paths} paths, none forced high`);
  else {
    for (const h of check.hits.slice(0, MAX_HIT_LINES)) lines.push(h.path === null ? `check: high: ${h.reason}` : `check: high: ${h.reason} ${h.path}`);
    if (check.hits.length > MAX_HIT_LINES) lines.push(`check: +${check.hits.length - MAX_HIT_LINES} more`);
  }
  if (check.warning) lines.push(check.warning);
  return lines;
}

function cmdSync(args, env) {
  const { flags, positional } = takeFlags(args, { values: ['--plan', '--base'], bools: ['--diff'] });
  const slug = slugArg(positional, 1, env.root);
  if (Object.hasOwn(flags, '--plan') && !PLAN_NAME.test(flags['--plan'])) throw new Refusal('bad plan name');
  if (Object.hasOwn(flags, '--base')) {
    if (!Object.hasOwn(flags, '--plan') && flags['--diff'] !== true) throw new Refusal(USAGE);
    if (!SHA.test(flags['--base'])) throw new Refusal('base must be a commit sha');
  }
  const cur = loadRecord(env.root, slug);
  if (cur.records.length === 0) return { code: 0, lines: ['tier-path: none'] };
  const sets = loadTierSets(env.pluginRoot);
  const view = buildView(slug, cur.records);
  const env2 = { ...env, forcedHigh: sets.forced_high };
  const check = checkTo(env2, slug, view.base, flags['--base'], flags, { local: cur.records[0].local, gov: cur.records[0].gov });
  const step = runTier(env, slug, 'low').stepRank;
  const short = view.path === 'short';
  const changed = short && sets.ok && sets.rev !== view.rev;
  const setsHit = short && (!sets.ok || changed);
  let cause = null;
  let target = RANK[view.tier];
  if (setsHit && RANK.high > target) {
    cause = 'sets';
    target = RANK.high;
  } else if (check && check.hits.some((h) => h.source === 'diff') && RANK.high > target) {
    cause = 'diff';
    target = RANK.high;
  } else if (check && check.hits.some((h) => h.source !== 'diff') && RANK.high > target) {
    cause = 'plan';
    target = RANK.high;
  } else if (step > target) {
    cause = 'step';
    target = step;
  }
  let records = cur.records;
  if (cause) {
    const rec = { v: 1, at: utc(env.now), ev: 'raise', tier: TIERS[target], cause };
    appendRecord(cur, slug, rec);
    records = [...records, rec];
  }
  const note = setsHit ? (sets.ok ? 'tier-sets: changed since begin' : `tier-sets: refused ${sets.reason}`) : null;
  const out = statusLines(buildView(slug, records), note);
  if (check) out.push(...checkLines(check));
  return { code: 0, lines: out };
}

function cmdRaise(args, env) {
  const { positional } = takeFlags(args, {});
  if (positional.length !== 2) throw new Refusal(USAGE);
  const slug = slugArg([positional[0]], 1, env.root);
  const tier = oneOf(['medium', 'high'], positional[1], 'tier');
  const cur = loadRecord(env.root, slug);
  if (cur.records.length === 0) throw new Refusal('no begin record for this run');
  let records = cur.records;
  const view = buildView(slug, records);
  if (RANK[tier] > RANK[view.tier]) {
    const rec = { v: 1, at: utc(env.now), ev: 'raise', tier, cause: 'ceo' };
    appendRecord(cur, slug, rec);
    records = [...records, rec];
  }
  return { code: 0, lines: statusLines(buildView(slug, records)) };
}

function cmdRan(args, env) {
  const { positional } = takeFlags(args, {});
  if (positional.length !== 2) throw new Refusal(USAGE);
  const slug = slugArg([positional[0]], 1, env.root);
  const cur = loadRecord(env.root, slug);
  if (cur.records.length === 0) throw new Refusal('no begin record for this run');
  const view = buildView(slug, cur.records);
  const entry = positional[1];
  if (!view.add.includes(entry)) throw new Refusal('entry is not owed');
  const rec = { v: 1, at: utc(env.now), ev: 'ran', entry };
  appendRecord(cur, slug, rec);
  return { code: 0, lines: statusLines(buildView(slug, [...cur.records, rec])) };
}

function cmdRead(args, env) {
  const { positional } = takeFlags(args, {});
  const slug = slugArg(positional, 1, env.root);
  const cur = loadRecord(env.root, slug);
  if (cur.records.length === 0) return { code: 0, lines: [JSON.stringify({ v: 1, slug, state: 'none' })] };
  return { code: 0, lines: [JSON.stringify(buildView(slug, cur.records))] };
}

const HANDLERS = {
  sets: cmdSets,
  preview: (a, e) => cmdPreview(a, e, false),
  begin: (a, e) => cmdPreview(a, e, true),
  sync: cmdSync,
  raise: cmdRaise,
  ran: cmdRan,
  read: cmdRead
};

// `now` (epoch ms), `root` (the product root), `pluginRoot` and `git` (a function over an argument array) are for callers that inject them.
export function main(args, { now, root, pluginRoot, git } = {}) {
  const env = {
    root: typeof root === 'string' && root !== '' ? root : process.cwd(),
    now: typeof now === 'number' ? now : Date.now(),
    pluginRoot: typeof pluginRoot === 'string' && pluginRoot !== '' ? pluginRoot : defaultPluginRoot(),
    git: typeof git === 'function' ? git : defaultGit,
    gitState: {}
  };
  try {
    const list = Array.isArray(args) ? args : [];
    for (const arg of list) {
      if (typeof arg !== 'string') throw new Refusal(USAGE);
      if (arg.length > MAX_ARG_CHARS) throw new Refusal('argument too long');
      if (CONTROLS.test(arg)) throw new Refusal('argument holds a control character');
    }
    const [command, ...rest] = list;
    if (typeof command !== 'string' || !Object.hasOwn(HANDLERS, command)) throw new Refusal(USAGE);
    return HANDLERS[command](rest, env);
  } catch (error) {
    if (error instanceof Refusal) return { code: 3, lines: [`refused: ${error.message}`] };
    if (error instanceof TierPathRecordError) return { code: 1, lines: [error.message] };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, lines } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
