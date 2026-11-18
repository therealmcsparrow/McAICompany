#!/usr/bin/env node
// contract: docs/contracts/mod-manifest.md v1.1
// Checks the hook set of a plugin root. Usage:
//   hook-check.mjs ci|setup [--root <plugin root>]   exit 1 and one line per problem
//   hook-check.mjs denies --session <key> --json     newest 5 deny rows of a session, read-only
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_FILE = 256 * 1024;
const MAX_MANIFEST = 8 * 1024;
const MAX_LOG = 4 * 1024 * 1024;
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const RULE_RE = /^[a-z][a-z0-9-]{0,23}\.(M-SEC|M|S|Y)\d+$/;
const EVENT_RE = /^[A-Z][A-Za-z]{2,40}$/;
const MODULE_RE = /^[a-z0-9][a-z0-9.-]*\.mjs$/;
const PURE_FILES = ['hooks/lib/paths.mjs', 'hooks/lib/rule-id.mjs'];
const KEYS = ['v', 'id', 'kind', 'title', 'owner', 'sessions', 'events', 'rules', 'fail', 'switch', 'lock', 'upstream'];
const KIND_FIXED = {
  guard: { sessions: 'all', fail: 'closed', lock: true },
  gate: { sessions: 'lead', fail: 'closed', lock: true },
  saver: { sessions: 'lead', fail: 'open', lock: false },
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Hash input: line-ending-normalized bytes (CRLF read as LF) so a CRLF working copy and an LF clone pin alike; a buffer with a NUL byte is binary and hashed as is.
function pinBytes(buf) {
  if (buf.includes(0)) return buf;
  const out = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue;
    out[n++] = buf[i];
  }
  return out.subarray(0, n);
}
const sha = (buf) => crypto.createHash('sha256').update(pinBytes(buf)).digest('hex');

function readText(file, max = MAX_FILE) {
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > max) throw new Error('not a regular file or too large');
  return fs.readFileSync(file, 'utf8');
}
const readJson = (file, max) => JSON.parse(readText(file, max));

// ---- pins -------------------------------------------------------------------------------------------------

const FIXED_PINS = ['hooks/rules.json', 'hooks/hooks.json', 'hooks/schema/hook-fields.json', 'company/model-floor.json'];
const PIN_FOLDERS = [['hooks/lib', /\.mjs$/], ['hooks/rules', /\.mjs$/], ['hooks/manifests', /\.json$/]];

function pinSet(root) {
  const out = [];
  if (fs.existsSync(path.join(root, 'scripts', 'hook-host.mjs'))) out.push('scripts/hook-host.mjs');
  for (const [dir, re] of PIN_FOLDERS) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { /* folder absent */ }
    for (const e of names.sort((a, b) => (a.name < b.name ? -1 : 1))) if (!e.isFile() || re.test(e.name)) out.push(`${dir}/${e.name}`);
  }
  for (const rel of FIXED_PINS) if (fs.existsSync(path.join(root, rel))) out.push(rel);
  return out;
}

function checkPins(root, problems) {
  let pins;
  try { pins = readJson(path.join(root, 'hooks', 'pins.json')); } catch {
    problems.push('hooks/pins.json: missing or unreadable');
    return;
  }
  if (isObj(pins) && isObj(pins.files)) pins = pins.files;
  if (!isObj(pins)) { problems.push('hooks/pins.json: not a map of file to hash'); return; }
  const actual = pinSet(root);
  const have = new Set(actual);
  const bad = new Set();
  for (const [rel, hash] of Object.entries(pins)) {
    if (!have.has(rel)) { bad.add(rel); continue; }
    try { if (sha(fs.readFileSync(path.join(root, rel))) !== hash) bad.add(rel); } catch { bad.add(rel); }
  }
  for (const rel of actual) if (!Object.hasOwn(pins, rel)) bad.add(rel);
  for (const rel of bad) problems.push(`pins-mismatch: ${rel}`);
}

// ---- manifests --------------------------------------------------------------------------------------------

function manifestProblem(m, fileId) {
  if (!isObj(m)) return 'not an object';
  const keys = Object.keys(m);
  for (const k of keys) if (!KEYS.includes(k)) return `unknown key ${k}`;
  for (const k of KEYS) if (!Object.hasOwn(m, k)) return `missing key ${k}`;
  if (m.v !== 1) return 'v must be 1';
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return 'id is not a valid id';
  if (m.id !== fileId) return `id ${m.id} differs from the file name`;
  if (!Object.hasOwn(KIND_FIXED, m.kind)) return 'kind must be guard, saver or gate';
  if (typeof m.title !== 'string' || m.title.length < 1 || m.title.length > 60 || /[\u0000-\u001f\u007f]/.test(m.title)) return 'title must be 1-60 printable characters';
  if (typeof m.owner !== 'string' || !ID_RE.test(m.owner)) return 'owner is not a Role id';
  const fixed = KIND_FIXED[m.kind];
  if (m.sessions !== fixed.sessions) return `${m.kind} needs sessions ${fixed.sessions}`;
  if (m.fail !== fixed.fail) return `${m.kind} needs fail ${fixed.fail}`;
  if (m.lock !== fixed.lock) return `${m.kind} needs lock ${fixed.lock}`;
  if (!Array.isArray(m.events) || !m.events.every((e) => typeof e === 'string' && EVENT_RE.test(e))) return 'events must be a list of event names';
  if (!Array.isArray(m.rules) || !m.rules.every((r) => typeof r === 'string' && RULE_RE.test(r))) return 'rules must be a list of rule IDs';
  if (m.kind === 'guard' && m.rules.length === 0) return 'a guard needs at least one rule';
  if ((m.kind === 'guard' || m.kind === 'gate') && m.events.length === 0) return `a ${m.kind} needs at least one event`;
  if (m.kind === 'saver') {
    if (typeof m.switch !== 'string' || m.switch !== `mods.${m.id.replace(/-/g, '_')}.enabled`) return 'saver switch must be mods.<id_with_underscores>.enabled';
  } else if (m.switch !== null) return `${m.kind} needs switch null`;
  if (m.upstream !== null) {
    const u = m.upstream;
    if (!isObj(u) || Object.keys(u).sort().join() !== 'licence,name,version' || !Object.values(u).every((x) => typeof x === 'string' && x.length > 0)) return 'upstream must be null or { name, version, licence }';
  }
  return null;
}

function loadManifests(root, problems) {
  const dir = path.join(root, 'hooks', 'manifests');
  const out = new Map();
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { /* none */ }
  for (const name of names) {
    const id = name.slice(0, -5);
    const rel = `hooks/manifests/${name}`;
    let m;
    try { m = readJson(path.join(dir, name), MAX_MANIFEST); } catch { problems.push(`manifest ${id}: ${rel} unreadable or not JSON`); continue; }
    const bad = manifestProblem(m, id);
    if (bad) { problems.push(`manifest ${id}: invalid, ${bad}`); continue; }
    out.set(id, m);
  }
  return out;
}

// ---- wiring and coverage ----------------------------------------------------------------------------------

function wiredEvents(root, problems) {
  const set = new Set();
  try {
    const h = readJson(path.join(root, 'hooks', 'hooks.json'));
    if (isObj(h) && isObj(h.hooks)) for (const k of Object.keys(h.hooks)) set.add(k);
  } catch { problems.push('hooks/hooks.json: missing or not JSON'); }
  return set;
}

function registerText(root) {
  for (const name of ['register.tsx', 'register.ts', 'register.mjs']) {
    try { return readText(path.join(root, 'hooks', name)); } catch { /* next */ }
  }
  return '';
}

function importedMods(text) {
  const out = new Set();
  const re = /(?:from\s*|import\s*)['"]([^'"\n]+)['"]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const mm = /^(?:\.\.\/mods|\.\/mods|\.\.\/\.\.\/mods)\/([^'"]+?)(?:\.(?:tsx?|mjs|js))?$/.exec(m[1]);
    if (mm) out.add(mm[1]);
  }
  return [...out];
}

function checkCoverage(root, manifests, problems) {
  const reg = registerText(root);
  for (const mod of importedMods(reg)) {
    if (mod.startsWith('shared/') || mod.startsWith('lib/') || mod.includes('/')) continue;
    if (!manifests.has(mod)) problems.push(`mod ${mod}: mods/${mod} is registered but hooks/manifests/${mod}.json is missing`);
  }

  const wired = wiredEvents(root, problems);
  for (const [id, m] of manifests) {
    for (const ev of m.events) {
      if (wired.has(ev)) continue;
      if (new RegExp(`['"\`]${ev}['"\`]`).test(reg)) continue;
      problems.push(`mod ${id}: event ${ev} is wired by no hooks/hooks.json entry or register hook`);
    }
  }

  const owners = new Map();
  for (const m of manifests.values()) for (const r of m.rules) owners.set(r, [...(owners.get(r) || []), m]);
  for (const [rule, list] of owners) if (list.length > 1) problems.push(`${rule}: listed by ${list.length} manifests`);

  let rows = [];
  try {
    rows = readJson(path.join(root, 'hooks', 'rules.json'));
    if (!Array.isArray(rows)) throw new Error('not a list');
  } catch { problems.push('hooks/rules.json: missing or not a list'); rows = []; }

  const rowRules = new Set();
  const rowModules = new Set();
  for (const row of rows) {
    if (!isObj(row) || typeof row.rule !== 'string' || typeof row.module !== 'string' || !MODULE_RE.test(row.module)) {
      problems.push(`hooks/rules.json: a row is malformed (${isObj(row) && typeof row.rule === 'string' ? row.rule : 'no rule ID'})`);
      continue;
    }
    rowRules.add(row.rule);
    rowModules.add(row.module);
    const list = owners.get(row.rule);
    if (!list) { problems.push(`${row.rule}: rule-table row has no manifest`); continue; }
    if (list.length === 1 && list[0].fail !== row.fail) problems.push(`${row.rule}: row fail ${row.fail} differs from manifest ${list[0].id} fail ${list[0].fail}`);
    if (!fs.existsSync(path.join(root, 'hooks', 'rules', row.module))) problems.push(`${row.rule}: rule module hooks/rules/${row.module} is missing`);
  }
  for (const [id, m] of manifests) {
    for (const r of m.rules) if (!rowRules.has(r)) problems.push(`${r}: manifest ${id} lists a rule with no rule-table row`);
  }

  let files = [];
  try { files = fs.readdirSync(path.join(root, 'hooks', 'rules')).filter((n) => n.endsWith('.mjs')).sort(); } catch { /* none */ }
  for (const f of files) if (!rowModules.has(f)) problems.push(`rule module ${f.slice(0, -4)}: hooks/rules/${f} has no rule-table row`);

  for (const m of manifests.values()) {
    if (m.kind !== 'guard') continue;
    for (const r of m.rules) {
      let names = [];
      try { names = fs.readdirSync(path.join(root, 'hooks', 'fixtures', r)); } catch { /* none */ }
      for (const kind of ['pass', 'block']) {
        if (!names.some((n) => n.startsWith(`${kind}-`) && n.endsWith('.json'))) problems.push(`${r}: guard has no ${kind} fixture in hooks/fixtures/${r}`);
      }
    }
  }
}

// ---- purity -----------------------------------------------------------------------------------------------

// Blanks comments; `code` also blanks the body of string literals (single-line quotes end at a newline).
function strip(src) {
  let plain = '';
  let code = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (; i < stop; i++) if (src[i] === '\n') { plain += '\n'; code += '\n'; }
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      for (; j < n; j++) {
        if (src[j] === '\\') { j++; continue; }
        if (src[j] === c) break;
        if (src[j] === '\n' && c !== '`') break;
      }
      plain += src.slice(i, j + 1);
      code += c + ' '.repeat(Math.max(0, j - i - 1)) + (src[j] === c ? c : '');
      i = j + 1;
      continue;
    }
    plain += c; code += c; i++;
  }
  return { plain, code };
}

function purityProblems(src) {
  const out = [];
  const { plain, code } = strip(src);
  const spec = /\b(?:import|export)\b[^;'"()]*?\bfrom\s*['"]([^'"\n]*)['"]|\bimport\s*['"]([^'"\n]*)['"]/g;
  for (let m = spec.exec(plain); m; m = spec.exec(plain)) {
    const s = m[1] ?? m[2];
    if (!/^\.\.?\//.test(s)) out.push(`imports ${s}`);
  }
  const bans = [[/\bimport\s*\(/, 'dynamic import'], [/\brequire\b/, 'require'], [/\bprocess\b/, 'process'], [/\bfetch\b/, 'fetch'],
    [/\beval\b/, 'eval'], [/\bFunction\b/, 'Function constructor'], [/\bglobalThis\b/, 'globalThis'], [/\bWebSocket\b|\bXMLHttpRequest\b/, 'network object'],
    [/\bDeno\b|\bBun\b/, 'runtime global']];
  for (const [re, what] of bans) if (re.test(code)) out.push(`uses ${what}`);
  return out;
}

function checkPurity(root, problems) {
  const files = [];
  try {
    for (const n of fs.readdirSync(path.join(root, 'hooks', 'rules')).sort()) if (n.endsWith('.mjs')) files.push(`hooks/rules/${n}`);
  } catch { /* none */ }
  files.push(...PURE_FILES);
  for (const rel of files) {
    let src;
    try { src = readText(path.join(root, rel)); } catch (e) {
      if (fs.existsSync(path.join(root, rel))) problems.push(`${rel}: unreadable for the purity scan`);
      continue;
    }
    for (const p of purityProblems(src)) problems.push(`${rel}: not pure, ${p}`);
  }
}

// ---- commands ---------------------------------------------------------------------------------------------

export function check(root, progress = () => {}) {
  const problems = [];
  progress('1/4 pins');
  checkPins(root, problems);
  progress('2/4 manifests');
  const manifests = loadManifests(root, problems);
  progress('3/4 wiring and coverage');
  checkCoverage(root, manifests, problems);
  progress('4/4 purity');
  checkPurity(root, problems);
  return problems;
}

function projectRoot(cwd) {
  let start;
  try { start = fs.realpathSync(cwd); } catch { return null; }
  for (let cur = start; ; cur = path.dirname(cur)) {
    try { if (fs.statSync(path.join(cur, '.company')).isDirectory()) return cur; } catch { /* keep climbing */ }
    if (path.dirname(cur) === cur) return start;
  }
}

export function denies(session, env = process.env, cwd = process.cwd()) {
  const home = env.MCSPARROW_HOME || path.join(env.USERPROFILE || env.HOME || os.homedir(), '.mcsparrow');
  const root = projectRoot(cwd);
  if (!root) return [];
  const file = path.join(home, 'hook-snapshots', crypto.createHash('sha256').update(root).digest('hex').slice(0, 12), 'denies.jsonl');
  let text;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_LOG) return [];
    text = fs.readFileSync(file, 'utf8');
  } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      if (isObj(r) && r.session === session) rows.push(r);
    } catch { /* skipped */ }
  }
  return rows.slice(-5);
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const arg = (name) => { const i = rest.indexOf(name); return i !== -1 ? rest[i + 1] : undefined; };
  if (cmd === 'ci' || cmd === 'setup') {
    const root = path.resolve(arg('--root') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
    const problems = check(root, (s) => process.stderr.write(`hook-check ${cmd}: ${s}\n`));
    if (problems.length === 0) { process.stdout.write(`hook-check ${cmd}: ok\n`); return 0; }
    process.stdout.write(`${problems.join('\n')}\n`);
    return 1;
  }
  if (cmd === 'denies') {
    const session = arg('--session');
    if (!session || !rest.includes('--json')) { process.stderr.write('usage: hook-check.mjs denies --session <key> --json\n'); return 2; }
    process.stdout.write(`${JSON.stringify(denies(session))}\n`);
    return 0;
  }
  process.stderr.write('usage: hook-check.mjs ci|setup [--root <plugin root>] | denies --session <key> --json\n');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
