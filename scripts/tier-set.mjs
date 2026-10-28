#!/usr/bin/env node
// Tier sets (contract: docs/contracts/tier-sets.md v1). Node built-ins only.
// Picks the Roles and lanes of a feature or fix run from the plugin data file company/tier-sets.json,
// decides the run tier and the short or full path, checks plan and diff paths for forced-high hits, and
// keeps a per-run record in .company/work/<slug>/tier-path.jsonl. The record holds enums, integers, a sha
// and a time only. Plans, project.md, git output, the data file and every CLI argument are untrusted data:
// output holds fixed words, known entry names and paths that passed the path rule.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parsePlan, normalizePath } from './plan-tasks.mjs';
import { show } from './run-state.mjs';

const KiB = 1024;
const MAX_DATA_BYTES = 16 * KiB;
const MAX_RECORD_BYTES = 16 * KiB;
const MAX_RECORD_LINES = 100;
const MAX_RECORD_LINE_BYTES = 256;
const MAX_PLAN_BYTES = 256 * KiB;
const MAX_PROJECT_BYTES = 64 * KiB;
const MAX_ARG_CHARS = 4096;
const MAX_GIT_BYTES = 8 * 1024 * KiB;
const GIT_TIMEOUT_MS = 30000;
const MAX_HIT_LINES = 5;

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLAN_NAME = /^(\d{2,3}-)?(architect-)?plan(-[a-z0-9]+)?\.md$/;
const SHA = /^[0-9a-f]{7,40}$/;
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
    'product-manager', 'design-researcher', 'architect', 'ui-ux-designer', 'brand-artist', 'spikes', 'persona-tester',
    'senior-engineer-research', 'senior-engineer-map', 'ruleset-sign-off', 'builders', 'asset-artists', 'code-reviewer', 'qa',
    'security', 'senior-engineer-compliance', 'legal', 'hands-on-tester', 'accessibility-tester', 'writer', 'localizer', 'devops'
  ]),
  fix: Object.freeze(['qa-reproduce', 'owning-engineer', 'code-reviewer', 'qa-rerun', 'security', 'devops'])
});

const REQUIRED = {
  feature: ['product-manager', 'builders', 'code-reviewer', 'qa', 'legal', 'accessibility-tester'],
  fix: ['qa-reproduce', 'owning-engineer', 'code-reviewer', 'qa-rerun']
};

export const FORCED_HIGH_V1 = Object.freeze(
  ('auth authn authz authentication authorization authorize oauth oauth2 oidc saml sso jwt login logout signin signup session sessions ' +
    'password passwords passwd credential credentials mfa 2fa totp rbac acl permission permissions secret secrets keystore crypto ' +
    'payment payments billing checkout invoice invoices stripe paypal mollie subscription subscriptions refund refunds pii gdpr ' +
    'consent personal privacy migration migrations migrate alembic flyway liquibase').split(' ')
);

const USAGE = [
  'usage: tier-set.mjs <command>',
  '  sets',
  '  preview <slug> --playbook <feature|fix> --triage <low|medium|high> --short <on|off> [--ceo full]',
  '  begin <slug> --playbook <feature|fix> --triage <low|medium|high> --short <on|off> --base <sha> [--ceo full]',
  '  sync <slug> [--plan <plan>] [--diff]',
  '  raise <slug> <medium|high>',
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
  for (const part of ['.company', 'work', slug]) {
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
      if (t !== 'low' && !sameList(list, ROUTE_V018[pb])) return `${pb} ${t} differs from the v0.18 route`;
    }
  }
  const fh = data.forced_high;
  if (!Array.isArray(fh) || fh.length < 1 || fh.length > 200 || fh.some((x) => typeof x !== 'string' || !TOKEN.test(x)) || new Set(fh).size !== fh.length) {
    return 'forced_high';
  }
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

// Tokens of one segment: split after a lower-case letter or digit that precedes an upper-case letter, lower-case, split on non-alphanumerics.
export function tokens(segment) {
  if (typeof segment !== 'string') return [];
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== '');
}

function safeEcho(p) {
  const n = normalizePath(p);
  return n.ok ? n.path : '?';
}

// Returns the hits for a list of paths: { reason: 'contract' | 'core' | 'pattern <token>', path }. core holds path keys.
export function checkPaths(paths, { core = [], forcedHigh = FORCED_HIGH_V1 } = {}) {
  const coreKeys = [...core].map((c) => checkKey(String(c))).filter((c) => c !== '');
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

// The Core paths of .company/project.md: { core, warning } or { unknown: true }.
function readCore(root) {
  const file = path.join(root, '.company', 'project.md');
  let text;
  try {
    const st = lstatOrNull(file);
    if (!st || !isPlain(st) || st.size > MAX_PROJECT_BYTES) return { unknown: true };
    const bytes = readOpened(file, st, MAX_PROJECT_BYTES);
    if (bytes.length > MAX_PROJECT_BYTES) return { unknown: true };
    text = decode(bytes);
  } catch {
    return { unknown: true };
  }
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
    const parsed = parsePlan(decode(bytes));
    if (parsed.tooMany || parsed.tasks.length === 0 || parsed.tasks.some((t) => !t.filesValid)) return null;
    return parsed.tasks.flatMap((t) => t.items);
  } catch {
    return null;
  }
}

function defaultGit(args, { cwd }) {
  return execFileSync('git', args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_GIT_BYTES, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
}

// Paths of the work since base, or null when any git call fails. The base is used only after the sha rule.
function readDiffPaths(root, base, git) {
  if (typeof base !== 'string' || !SHA.test(base)) return null;
  const calls = [
    ['cat-file', '-e', `${base}^{commit}`],
    ['diff', '--name-only', '-z', '--no-renames', base, 'HEAD', '--'],
    ['diff', '--name-only', '-z', '--no-renames', 'HEAD', '--'],
    ['ls-files', '--others', '--exclude-standard', '-z']
  ];
  const all = new Set();
  try {
    calls.forEach((args, i) => {
      const out = git(args, { cwd: root });
      const buf = Buffer.isBuffer(out) ? out : Buffer.from(String(out ?? ''), 'utf8');
      if (buf.length > MAX_GIT_BYTES) throw new Error('output too large');
      if (i === 0) return;
      for (const p of buf.toString('utf8').split('\0')) if (p !== '') all.add(p);
    });
  } catch {
    return null;
  }
  return [...all];
}

// ---------------------------------------------------------------- record

const BEGIN_KEYS = ['v', 'at', 'ev', 'pb', 'tier', 'path', 'why', 'rev', 'base'];
const RAISE_KEYS = ['v', 'at', 'ev', 'tier', 'cause'];

function parseRecordText(slug, text) {
  const records = [];
  if (text === '') return records;
  if (!text.endsWith('\n')) throw new TierPathRecordError(slug, 1, 'line not closed');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length > MAX_RECORD_LINES) throw new TierPathRecordError(slug, 0, 'more than 100 lines');
  let tier = null;
  lines.forEach((line, i) => {
    const n = i + 1;
    const bad = (reason) => new TierPathRecordError(slug, n, reason);
    if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_LINE_BYTES) throw bad('line over 256 bytes');
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      throw bad('not json');
    }
    if (!isObject(rec)) throw bad('not an object');
    if (rec.v !== 1) throw bad('unknown v');
    if (rec.ev !== 'begin' && rec.ev !== 'raise') throw bad('unknown ev');
    if (!keysAre(rec, rec.ev === 'begin' ? BEGIN_KEYS : RAISE_KEYS)) throw bad('keys');
    if (typeof rec.at !== 'string' || !TIME.test(rec.at)) throw bad('at');
    if (!TIERS.includes(rec.tier)) throw bad('tier');
    if (rec.ev === 'begin') {
      if (i !== 0) throw bad('second begin');
      if (!PLAYBOOKS.includes(rec.pb)) throw bad('pb');
      if (rec.path !== 'short' && rec.path !== 'full') throw bad('path');
      if (!WHY.includes(rec.why)) throw bad('why');
      if (!Number.isInteger(rec.rev) || rec.rev < 0 || rec.rev > 999) throw bad('rev');
      if (typeof rec.base !== 'string' || !SHA.test(rec.base)) throw bad('base');
      tier = rec.tier;
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

function buildView(slug, records, loaded) {
  const begin = records[0];
  const raises = records.filter((r) => r.ev === 'raise');
  const tier = raises.length > 0 ? raises.at(-1).tier : begin.tier;
  const cause = raises.length > 0 ? raises[0].cause : null;
  const route = ROUTE_V018[begin.pb];
  const short = begin.path === 'short';
  const set = short && cause !== 'sets' ? [...loaded.sets[begin.pb][tier]] : [...route];
  const beginSet = short ? loaded.sets[begin.pb][begin.tier] : route;
  const skipped = short ? route.filter((e) => !beginSet.includes(e)) : [];
  const add = skipped.filter((e) => set.includes(e));
  return {
    v: 1, slug, state: 'on', pb: begin.pb, start_tier: begin.tier, tier, path: begin.path, why: begin.why, rev: begin.rev,
    base: begin.base, raised: raises.length > 0, cause, skipped, set, add
  };
}

export function readTierPath(root, slug, { pluginRoot } = {}) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new TierPathRecordError('?', 0, 'bad slug');
  const cur = loadRecord(root, slug);
  if (cur.records.length === 0) return { v: 1, slug, state: 'none' };
  return buildView(slug, cur.records, loadTierSets(pluginRoot));
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

function slugArg(positional, count) {
  if (positional.length !== count) throw new Refusal(USAGE);
  if (!SLUG.test(positional[0])) throw new Refusal('bad slug');
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

function beginRecord(env, slug, flags, sets) {
  const pb = oneOf(PLAYBOOKS, flags['--playbook'], 'playbook');
  const triage = oneOf(TIERS, flags['--triage'], 'triage');
  const short = oneOf(['on', 'off'], flags['--short'], 'short');
  if (Object.hasOwn(flags, '--ceo') && flags['--ceo'] !== 'full') throw new Refusal('ceo must be full');
  const tier = TIERS[runTier(env, slug, triage).rank];
  let why = 'short';
  if (!sets.ok) why = 'refused';
  else if (tier !== 'low') why = 'tier';
  else if (short === 'off') why = 'setting';
  else if (flags['--ceo'] === 'full') why = 'ceo';
  return { v: 1, at: utc(env.now), ev: 'begin', pb, tier, path: why === 'short' ? 'short' : 'full', why, rev: sets.rev, base: flags['--base'] ?? '0000000' };
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
  const slug = slugArg(positional, 1);
  if (write) {
    if (!Object.hasOwn(flags, '--base') || !SHA.test(flags['--base'])) throw new Refusal('base must be a commit sha');
  } else if (Object.hasOwn(flags, '--base')) throw new Refusal(USAGE);
  const sets = loadTierSets(env.pluginRoot);
  const rec = beginRecord(env, slug, flags, sets);
  const cur = loadRecord(env.root, slug);
  if (write) {
    if (cur.records.length > 0) throw new Refusal('a begin record exists');
    appendRecord(cur, slug, rec);
  }
  const view = buildView(slug, [rec], sets);
  return { code: 0, lines: statusLines(view, sets.ok ? null : `tier-sets: refused ${sets.reason}`) };
}

function checkTo(env, slug, base, flags) {
  const hits = [];
  let paths = 0;
  let warning = null;
  const wantPlan = Object.hasOwn(flags, '--plan');
  const wantDiff = flags['--diff'] === true;
  if (!wantPlan && !wantDiff) return null;
  const core = readCore(env.root);
  const all = [];
  if (core.unknown) hits.push({ source: 'core', reason: 'core unknown', path: null });
  else warning = core.warning;
  if (wantPlan) {
    const items = readPlanPaths(env.root, slug, flags['--plan']);
    if (items === null) hits.push({ source: 'plan', reason: 'plan files unknown', path: null });
    else all.push(...items.map((p) => ({ source: 'plan', p })));
  }
  if (wantDiff) {
    const items = readDiffPaths(env.root, base, env.git);
    if (items === null) hits.push({ source: 'diff', reason: 'diff unknown', path: null });
    else all.push(...items.map((p) => ({ source: 'diff', p })));
  }
  paths = new Set(all.map((x) => x.p)).size;
  if (!core.unknown) {
    for (const x of all) {
      const one = checkPaths([x.p], { core: core.core, forcedHigh: env.forcedHigh });
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
  const { flags, positional } = takeFlags(args, { values: ['--plan'], bools: ['--diff'] });
  const slug = slugArg(positional, 1);
  if (Object.hasOwn(flags, '--plan') && !PLAN_NAME.test(flags['--plan'])) throw new Refusal('bad plan name');
  const cur = loadRecord(env.root, slug);
  if (cur.records.length === 0) return { code: 0, lines: ['tier-path: none'] };
  const sets = loadTierSets(env.pluginRoot);
  const view = buildView(slug, cur.records, sets);
  const env2 = { ...env, forcedHigh: sets.forced_high };
  const check = checkTo(env2, slug, view.base, flags);
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
  const out = statusLines(buildView(slug, records, sets), note);
  if (check) out.push(...checkLines(check));
  return { code: 0, lines: out };
}

function cmdRaise(args, env) {
  const { positional } = takeFlags(args, {});
  if (positional.length !== 2) throw new Refusal(USAGE);
  const slug = slugArg([positional[0]], 1);
  const tier = oneOf(['medium', 'high'], positional[1], 'tier');
  const cur = loadRecord(env.root, slug);
  if (cur.records.length === 0) throw new Refusal('no begin record for this run');
  const sets = loadTierSets(env.pluginRoot);
  let records = cur.records;
  const view = buildView(slug, records, sets);
  if (RANK[tier] > RANK[view.tier]) {
    const rec = { v: 1, at: utc(env.now), ev: 'raise', tier, cause: 'ceo' };
    appendRecord(cur, slug, rec);
    records = [...records, rec];
  }
  const after = buildView(slug, records, sets);
  return { code: 0, lines: statusLines(after, after.path === 'short' && !sets.ok ? `tier-sets: refused ${sets.reason}` : null) };
}

function cmdRead(args, env) {
  const { positional } = takeFlags(args, {});
  const slug = slugArg(positional, 1);
  const cur = loadRecord(env.root, slug);
  if (cur.records.length === 0) return { code: 0, lines: [JSON.stringify({ v: 1, slug, state: 'none' })] };
  return { code: 0, lines: [JSON.stringify(buildView(slug, cur.records, loadTierSets(env.pluginRoot)))] };
}

const HANDLERS = {
  sets: cmdSets,
  preview: (a, e) => cmdPreview(a, e, false),
  begin: (a, e) => cmdPreview(a, e, true),
  sync: cmdSync,
  raise: cmdRaise,
  read: cmdRead
};

// `now` (epoch ms), `root` (the product root), `pluginRoot` and `git` (a function over an argument array) are for callers that inject them.
export function main(args, { now, root, pluginRoot, git } = {}) {
  const env = {
    root: typeof root === 'string' && root !== '' ? root : process.cwd(),
    now: typeof now === 'number' ? now : Date.now(),
    pluginRoot: typeof pluginRoot === 'string' && pluginRoot !== '' ? pluginRoot : defaultPluginRoot(),
    git: typeof git === 'function' ? git : defaultGit
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
