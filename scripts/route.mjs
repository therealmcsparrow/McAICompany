#!/usr/bin/env node
// contract: docs/contracts/route.md v1.0
// The Steps of a run as data: a route ledger with a reason for every skip and merge, a Step budget lint
// and a fail-open `next` decision. Node built-ins only; facts are read only through `readLatest`.
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync, writeSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readLatest, main as factsMain } from './diff-facts.mjs';
import { isRunSlug, workParts } from '../mods/lib/work-folder.mjs';

const KiB = 1024;
const MAX_DATA_BYTES = 16 * KiB;
const MAX_DRAFT_BYTES = 64 * KiB;
const MAX_LEDGER_BYTES = 64 * KiB;
const MAX_LINE_BYTES = 4096;
const MAX_HANDOFF_HEAD = 2048;
const MAX_HANDOFFS = 500;
const MAX_SOURCE = 200;
const MAX_WHY = 120;
const PLAYBOOKS = ['feature', 'fix'];
const SIZES = ['XS', 'S', 'M', 'L'];
const CONDITIONS = ['ui_changed', 'strings_changed', 'contract_changed', 'languages>1'];
const FLAG_CONDITIONS = ['ui_changed', 'strings_changed', 'contract_changed'];
const NEVER_SKIP = ['qa', 'security'];
const MERGE_ROLE = `code-reviewer`;
const SLUG = /^[a-z][a-z0-9-]{0,40}$/;
const HANDOFF_NAME = /^(\d{2,3})-[a-z][a-z0-9-]{0,40}\.md$/;
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

class Refusal extends Error {}
const refuse = (reason) => { throw new Refusal(reason); };

const clean = (text, max = 60) => String(text).slice(0, max).replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, '?');
const validWhy = (w) => typeof w === 'string' && w.length >= 1 && w.length <= MAX_WHY && !CONTROL.test(w);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------- safe reads

// Plain file, no link, bounded size, read through one descriptor. null when missing.
function readPlain(file, cap) {
  let st;
  try { st = lstatSync(file); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    return refuse('unreadable file');
  }
  if (st.isSymbolicLink() || !st.isFile()) return refuse('not a plain file');
  if (st.size > cap) return refuse('file too large');
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | NO_FOLLOW);
    const f = fstatSync(fd);
    if (!f.isFile() || f.size > cap) return refuse('not a plain file');
    const buf = Buffer.alloc(f.size);
    let off = 0;
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return buf.subarray(0, off).toString('utf8');
  } catch (e) {
    if (e instanceof Refusal) throw e;
    return refuse('unreadable file');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// Parses JSON and refuses a `__proto__` key at any depth.
function parseJson(text) {
  let v;
  try { v = JSON.parse(text); } catch { return refuse('not valid JSON'); }
  const walk = (x, depth) => {
    if (depth > 8) refuse('JSON nested too deep');
    if (Array.isArray(x)) { for (const y of x) walk(y, depth + 1); return; }
    if (isPlain(x)) {
      if (Object.hasOwn(x, '__proto__')) refuse('forbidden key');
      for (const k of Object.keys(x)) walk(x[k], depth + 1);
    }
  };
  walk(v, 0);
  return v;
}

// ---------------------------------------------------------------- data files

function agentSlugs(root) {
  try {
    const dir = join(root, 'agents');
    return new Set(readdirSync(dir).filter((n) => n.endsWith('.md') && SLUG.test(n.slice(0, -3))
      && lstatSync(join(dir, n)).isFile()).map((n) => n.slice(0, -3)));
  } catch { return new Set(); }
}

function loadJson(file, label, errors) {
  try {
    const text = readPlain(file, MAX_DATA_BYTES);
    if (text === null) { errors.push(`ERROR route: ${label} is missing`); return null; }
    const v = parseJson(text);
    if (!isPlain(v) || v.v !== 1) { errors.push(`ERROR route: ${label} needs "v": 1`); return null; }
    return v;
  } catch (e) {
    errors.push(`ERROR route: ${label} ${e instanceof Refusal ? e.message : 'unreadable'}`);
    return null;
  }
}

// Reads both data files of a product repo. data = { budgets, when, roles, protectedRoles }.
export function loadData(root, protectedRoles = []) {
  const errors = [];
  const roles = agentSlugs(root);
  const never = new Set([...NEVER_SKIP, ...protectedRoles]);
  const data = { budgets: {}, when: {}, roles, protectedRoles: [...never] };

  const b = loadJson(join(root, 'company', 'step-budgets.json'), 'step-budgets.json', errors);
  if (b !== null) {
    if (!isPlain(b.budgets)) errors.push('ERROR route: step-budgets.json needs a budgets object');
    else {
      for (const k of Object.keys(b.budgets)) {
        const n = b.budgets[k];
        if (!PLAYBOOKS.includes(k)) errors.push(`ERROR route: step-budgets.json unknown Playbook ${clean(k)}`);
        else if (!Number.isInteger(n) || n < 1 || n > 200) errors.push(`ERROR route: step-budgets.json budget for ${k} must be a whole number 1-200`);
        else data.budgets[k] = n;
      }
    }
    if (typeof b.source !== 'string' || b.source.length < 1 || b.source.length > MAX_SOURCE || CONTROL.test(b.source)) {
      errors.push(`ERROR route: step-budgets.json source must be one line of 1-${MAX_SOURCE} characters`);
    }
  }

  const w = loadJson(join(root, 'company', 'role-when.json'), 'role-when.json', errors);
  if (w !== null) {
    if (!isPlain(w.when)) errors.push('ERROR route: role-when.json needs a when object');
    else {
      for (const k of Object.keys(w.when)) {
        const conds = w.when[k];
        const name = clean(k);
        if (!SLUG.test(k) || !roles.has(k)) { errors.push(`ERROR route: role-when.json ${name} has no agents file`); continue; }
        if (never.has(k)) { errors.push(`ERROR route: role-when.json ${name} may not be skipped`); continue; }
        if (!Array.isArray(conds) || conds.length < 1 || conds.length > CONDITIONS.length
          || !conds.every((c) => typeof c === 'string' && CONDITIONS.includes(c))) {
          errors.push(`ERROR route: role-when.json ${name} has an unknown condition`);
          continue;
        }
        data.when[k] = [...conds];
      }
    }
  }
  return { data, errors };
}

export function lintData(root, protectedRoles = []) {
  return loadData(root, protectedRoles).errors;
}

// ---------------------------------------------------------------- route lint

const hasOwn = (o, k) => Object.hasOwn(o, k);

// route = { playbook, size, steps, skips, tasks? }; data as returned by loadData.
// A role name is known when it is in data.roles or is the `tasks` placeholder.
export function lintRoute(route, data) {
  const errors = [];
  const err = (m) => errors.push(`ERROR route: ${m}`);
  if (!isPlain(route) || !isPlain(data)) { err('bad route'); return errors; }
  const budgets = isPlain(data.budgets) ? data.budgets : {};
  const roles = data.roles instanceof Set ? data.roles : new Set(Array.isArray(data.roles) ? data.roles : []);
  const never = new Set([...NEVER_SKIP, ...(Array.isArray(data.protectedRoles) ? data.protectedRoles : [])]);
  const steps = Array.isArray(route.steps) ? route.steps : [];
  const skips = Array.isArray(route.skips) ? route.skips : [];
  const tasks = Number.isInteger(route.tasks) ? route.tasks : 0;

  if (!Array.isArray(route.steps) || route.steps.length < 1 || route.steps.length > 200) err('steps must list 1-200 entries');
  if (!Array.isArray(route.skips) || skips.length > 200) err('skips must be a list of at most 200 entries');
  if (!SIZES.includes(route.size)) err(`bad size ${clean(route.size)}`);

  if (typeof route.playbook !== 'string' || !PLAYBOOKS.includes(route.playbook)) err(`bad playbook ${clean(route.playbook)}`);
  else if (!hasOwn(budgets, route.playbook)) err(`no budget for ${route.playbook}`);
  else {
    const count = steps.length + tasks;
    if (count > budgets[route.playbook]) err(`${route.playbook} over budget: budget ${budgets[route.playbook]}, count ${count}`);
  }

  const known = (r) => typeof r === 'string' && (r === 'tasks' || (SLUG.test(r) && roles.has(r)));
  steps.forEach((s, i) => {
    if (!isPlain(s)) { err(`step ${i} is not an object`); return; }
    if (Object.keys(s).some((k) => !['role', 'why', 'merge'].includes(k))) err(`step ${i} has an unknown key`);
    if (!known(s.role)) err(`unknown role ${clean(s.role)}`);
    if (!validWhy(s.why)) err(`step ${i} has no why`);
    if (hasOwn(s, 'merge')) {
      if (route.size !== 'S') err('merge needs size S');
      if (s.role !== MERGE_ROLE || s.merge !== 'qa') err('merge must be code-reviewer with qa');
    }
  });
  skips.forEach((s, i) => {
    if (!isPlain(s)) { err(`skip ${i} is not an object`); return; }
    if (Object.keys(s).some((k) => !['role', 'why'].includes(k))) err(`skip ${i} has an unknown key`);
    if (!known(s.role) || s.role === 'tasks') err(`unknown role ${clean(s.role)}`);
    else if (never.has(s.role)) err(`${s.role} may not be skipped`);
    if (!validWhy(s.why)) err(`skip ${i} has no why`);
  });
  return errors;
}

// ---------------------------------------------------------------- run folder and ledger

function slugParts(slug) {
  if (typeof slug !== 'string' || slug === '' || CONTROL.test(slug) || /[\\:]/.test(slug) || slug.startsWith('-') || !isRunSlug(slug)) return refuse('bad slug');
  const parts = workParts(slug);
  if (parts === null || parts.some((p) => p === '' || p === '.' || p === '..' || p.startsWith('-') || p.includes('/'))) return refuse('bad slug');
  return parts;
}

// The run folder: every part below `.company/work` must be a real directory, no link.
function runDirOf(root, parts) {
  let real;
  try { real = realpathSync.native(root); } catch { return refuse('bad run folder'); }
  let dir = real;
  for (const p of ['.company', 'work', ...parts]) {
    dir = join(dir, p);
    let st;
    try { st = lstatSync(dir); } catch { return refuse('run folder not found'); }
    if (st.isSymbolicLink() || !st.isDirectory()) return refuse('bad run folder');
  }
  let rr;
  try { rr = realpathSync.native(dir); } catch { return refuse('bad run folder'); }
  if (rr !== dir || !rr.startsWith(real + sep)) return refuse('bad run folder');
  return dir;
}

const EVENTS = ['route', 'tasks', 'step', 'fix'];

function parseLedger(text) {
  const events = [];
  const rows = text.split('\n');
  if (rows[rows.length - 1] === '') rows.pop();
  for (const row of rows) {
    if (Buffer.byteLength(row) > MAX_LINE_BYTES) return refuse('ledger line too long');
    let e;
    try { e = parseJson(row); } catch { return refuse('ledger line is not valid JSON'); }
    if (!isPlain(e) || e.v !== 1 || typeof e.ev !== 'string' || !EVENTS.includes(e.ev)) return refuse('ledger line is not an event');
    events.push(e);
  }
  return events;
}

function readLedger(runDir) {
  const text = readPlain(join(runDir, 'route.jsonl'), MAX_LEDGER_BYTES);
  if (text === null) return { events: [], size: 0 };
  if (text.includes('\r')) return refuse('ledger has a CR byte');
  return { events: parseLedger(text), size: Buffer.byteLength(text) };
}

function appendEvent(runDir, event, size) {
  const line = `${JSON.stringify(event)}\n`;
  const bytes = Buffer.byteLength(line);
  if (bytes > MAX_LINE_BYTES) refuse('event too long');
  if (size + bytes > MAX_LEDGER_BYTES) refuse('ledger would exceed 64 KiB');
  const file = join(runDir, 'route.jsonl');
  let fd;
  try {
    fd = openSync(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NO_FOLLOW, 0o644);
    const st = fstatSync(fd);
    if (!st.isFile() || st.size !== size || st.nlink !== 1) refuse('ledger changed');
    writeSync(fd, line);
  } catch (e) {
    if (e instanceof Refusal) throw e;
    refuse('ledger not written');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// ---------------------------------------------------------------- facts and decisions

function languageCount(root) {
  let text;
  try { text = readPlain(join(root, '.company', 'project.md'), 256 * KiB); } catch { return null; }
  if (text === null) return null;
  const m = /^languages:[ \t]*(.*)$/m.exec(text);
  if (m === null) return null;
  const tokens = m[1].replace(/[[\]`'"]/g, ' ').split(/[,\s]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 50) return null;
  if (!tokens.every((t) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/.test(t))) return null;
  return new Set(tokens.map((t) => t.toLowerCase())).size;
}

const factsName = (facts) => (facts === null ? 'none' : facts.step);

// Role skip from facts: returns a why when a listed condition is false, else null (run).
function skipReason(root, role, data, facts) {
  if (!hasOwn(data.when, role) || data.protectedRoles.includes(role)) return null;
  if (facts === null) return null;
  if (facts.paths.some((p) => p.kind === 'unknown')) return null;
  const conds = data.when[role];
  if (conds.includes('languages>1') && languageCount(root) === null) return null;
  for (const cond of conds) {
    if (FLAG_CONDITIONS.includes(cond)) {
      if (facts[cond] === false) return `${cond} false in facts ${facts.step}`;
    } else if (cond === 'languages>1') {
      const n = languageCount(root);
      if (n !== null && n < 2) return `languages>1 false: ${n} language in project.md (facts ${facts.step})`;
    }
  }
  return null;
}

function needsCeo(runDir) {
  let names;
  try { names = readdirSync(runDir).filter((n) => HANDOFF_NAME.test(n)).sort(); } catch { return 'run folder unreadable'; }
  if (names.length > MAX_HANDOFFS) return 'too many Handoffs to check';
  for (const n of names) {
    let head;
    try { head = readPlain(join(runDir, n), 256 * KiB); } catch { return `Handoff ${n.slice(0, -3)} unreadable`; }
    if (head === null) continue;
    const m = /^---\n([\s\S]*?)\n---/.exec(head.replace(/\r/g, ''));
    if (m === null || m[0].length > MAX_HANDOFF_HEAD) return `Handoff ${n.slice(0, -3)} frontmatter unreadable`;
    const s = /^status:[ \t]*(\S+)[ \t]*$/m.exec(m[1]);
    if (s !== null && s[1] === 'needs-ceo') return `Handoff ${n.slice(0, -3)} has status needs-ceo`;
  }
  return null;
}

// One decision for one route entry. runDir may be null (dry run): the needs-ceo scan is then skipped.
function decide(root, runDir, route, entry, data, facts) {
  if (entry.role === 'tasks') return { do: 'tasks', why: 'run the plan tasks through plan-tasks, then call next again' };
  if (hasOwn(entry, 'merge')) {
    const split = (why) => ({ do: 'split', why: clean(why, MAX_WHY), roles: ['qa', MERGE_ROLE] });
    if (route.size !== 'S') return split('merge needs size S');
    if (facts === null) return split('facts missing: split the merge');
    if (facts.contract_changed !== false) return split(`contract_changed in facts ${facts.step}`);
    if (runDir !== null) {
      const c = needsCeo(runDir);
      if (c !== null) return split(c);
    }
    return { do: 'run', why: `merged qa and code-reviewer: S, contract_changed false in facts ${facts.step}` };
  }
  const why = skipReason(root, entry.role, data, facts);
  if (why !== null) return { do: 'skip', why: clean(why, MAX_WHY) };
  return { do: 'run', why: clean(entry.why, MAX_WHY) };
}

// ---------------------------------------------------------------- CLI

function readDraft(file) {
  if (typeof file !== 'string' || file === '' || file.includes('\0')) refuse('bad draft path');
  const text = readPlain(resolve(file), MAX_DRAFT_BYTES);
  if (text === null) return refuse('draft not found');
  return { text, value: parseJson(text) };
}

function draftRoute(value) {
  if (!isPlain(value) || Object.keys(value).some((k) => !['playbook', 'size', 'steps', 'skips'].includes(k))) {
    return refuse('draft has unknown keys');
  }
  return value;
}

// The protected Roles: the `protected` array of company/model-floor.json, or a refusal.
export function readProtected(root) {
  const unreadable = () => refuse('model floor unreadable');
  let v;
  try {
    const text = readPlain(join(root, 'company', 'model-floor.json'), MAX_DATA_BYTES);
    if (text === null) return unreadable();
    v = parseJson(text);
  } catch { return unreadable(); }
  const list = isPlain(v) && hasOwn(v, 'protected') ? v.protected : null;
  if (!Array.isArray(list) || list.length < 1 || list.length > 50) return unreadable();
  const roles = agentSlugs(root);
  const seen = new Set();
  for (const r of list) {
    if (typeof r !== 'string' || !SLUG.test(r) || !roles.has(r) || seen.has(r)) return unreadable();
    seen.add(r);
  }
  return [...list];
}

async function protectedList(root) {
  return readProtected(root);
}

function printErrors(errors) {
  return `${errors.map((e) => `${e}\n`).join('')}`;
}

function routeFromLedger(events) {
  const route = events.find((e) => e.ev === 'route');
  if (route === undefined) return null;
  const tasks = events.find((e) => e.ev === 'tasks');
  return { playbook: route.playbook, size: route.size, steps: route.steps, skips: route.skips, tasks: tasks ? tasks.n : 0 };
}

function lintEvents(events, data) {
  const errors = [];
  const routes = events.filter((e) => e.ev === 'route');
  if (routes.length !== 1) errors.push('ERROR route: the ledger needs exactly one route event');
  const route = routeFromLedger(events);
  if (route !== null) errors.push(...lintRoute(route, data));
  events.forEach((e, i) => {
    if (e.ev === 'tasks' && !(Number.isInteger(e.n) && e.n >= 1 && e.n <= 200)) errors.push(`ERROR route: event ${i} has a bad task count`);
    if ((e.ev === 'step' || e.ev === 'fix') && !validWhy(e.why)) errors.push(`ERROR route: event ${i} has no why`);
  });
  return errors;
}

async function run(argv, root) {
  const [cmd, ...rest] = argv;
  if (['check', 'dry', 'write', 'tasks', 'fix', 'next'].includes(cmd)) await protectedList(root);
  if (cmd === 'check') {
    if (rest.length !== 1) refuse('usage: check <file>');
    const prot = await protectedList(root);
    const text = readPlain(resolve(rest[0]), MAX_LEDGER_BYTES);
    if (text === null) refuse('file not found');
    const { data, errors: dataErrors } = loadData(root, prot);
    let errors;
    let whole = null;
    try { whole = parseJson(text); } catch (e) { if (e instanceof Refusal && e.message === 'forbidden key') throw e; }
    if (whole !== null && isPlain(whole) && !hasOwn(whole, 'ev')) {
      errors = lintRoute(draftRoute(whole), data);
    } else {
      const events = whole !== null ? [whole] : parseLedger(text.replace(/\r/g, ''));
      errors = lintEvents(events, data);
    }
    const all = [...errors, ...dataErrors];
    return { code: all.length > 0 ? 1 : 0, out: `${printErrors(all)}${all.length} error(s)\n` };
  }

  if (cmd === 'dry') {
    const [file, ...opts] = rest;
    const o = { base: null, head: null };
    for (let i = 0; i < opts.length; i += 2) {
      const k = opts[i];
      if ((k !== '--base' && k !== '--head') || i + 1 >= opts.length || o[k.slice(2)] !== null) refuse('bad option');
      o[k.slice(2)] = opts[i + 1];
    }
    if (o.base === null) refuse('--base is required');
    if (o.head === null) refuse('--head is required');
    const prot = await protectedList(root);
    const route = draftRoute(readDraft(file).value);
    const { data, errors } = loadData(root, prot);
    const lint = [...errors, ...lintRoute(route, data)];
    if (lint.length > 0) return { code: 2, out: `${printErrors(lint)}refused: ${lint.length} lint error(s)\n` };
    const args = ['show', '--base', o.base, '--head', o.head];
    const shown = factsMain(args, root);
    if (shown.code !== 0) return { code: 2, out: shown.out };
    let facts;
    try { facts = parseJson(shown.out); } catch { return refuse('facts unreadable'); }
    if (!isPlain(facts) || !Array.isArray(facts.paths)) refuse('facts unreadable');
    facts.step = typeof facts.step === 'string' ? facts.step : 'dry';
    const rows = route.steps.map((s, i) => {
      const d = decide(root, null, route, s, data, facts);
      return `${i} ${s.role} ${d.do} ${d.why}\n`;
    });
    return { code: 0, out: rows.join('') };
  }

  const slug = rest[0];
  const parts = slugParts(slug);
  const prot = await protectedList(root);
  const runDir = runDirOf(root, parts);
  const { events, size } = readLedger(runDir);
  const { data, errors: dataErrors } = loadData(root, prot);
  const routeEvent = events.find((e) => e.ev === 'route');
  const appended = (event) => appendEvent(runDir, event, size);

  if (cmd === 'write') {
    if (rest.length !== 2) refuse('usage: write <slug> <draft.json>');
    if (routeEvent !== undefined) refuse('route already written');
    const route = draftRoute(readDraft(rest[1]).value);
    const lint = [...dataErrors, ...lintRoute(route, data)];
    if (lint.length > 0) return { code: 2, out: `${printErrors(lint)}refused: ${lint.length} lint error(s)\n` };
    appended({ v: 1, ev: 'route', playbook: route.playbook, size: route.size, steps: route.steps, skips: route.skips });
    return { code: 0, out: 'ok\n' };
  }

  if (cmd === 'tasks') {
    if (rest.length !== 2) refuse('usage: tasks <slug> <n>');
    if (!/^[1-9][0-9]{0,2}$/.test(rest[1]) || Number(rest[1]) > 200) refuse('n must be a whole number 1-200');
    if (routeEvent === undefined) refuse('no route written');
    if (events.some((e) => e.ev === 'tasks')) refuse('tasks already written');
    const n = Number(rest[1]);
    const lint = lintRoute({ ...routeFromLedger(events), tasks: n }, data);
    if (lint.length > 0) return { code: 2, out: `${printErrors(lint)}refused: ${lint.length} lint error(s)\n` };
    appended({ v: 1, ev: 'tasks', n });
    return { code: 0, out: 'ok\n' };
  }

  if (cmd === 'fix') {
    if (rest.length !== 3) refuse('usage: fix <slug> <role> <why>');
    if (routeEvent === undefined) refuse('no route written');
    const [, role, why] = rest;
    if (typeof role !== 'string' || !SLUG.test(role) || !data.roles.has(role)) refuse('unknown role');
    if (!validWhy(why)) refuse('why must be 1-120 characters, no control character');
    appended({ v: 1, ev: 'fix', role, why });
    return { code: 0, out: 'ok\n' };
  }

  if (cmd === 'next') {
    if (rest.length !== 1) refuse('usage: next <slug>');
    if (routeEvent === undefined) refuse('no route written');
    const i = events.filter((e) => e.ev === 'step').length;
    if (i >= routeEvent.steps.length) return { code: 0, out: '{"do":"end"}\n' };
    const entry = routeEvent.steps[i];
    const facts = readLatest(runDir);
    const d = decide(root, runDir, routeEvent, entry, data, facts);
    const fname = factsName(facts);
    appended({ v: 1, ev: 'step', i, role: entry.role, do: d.do, why: d.why, facts: fname });
    const out = { do: d.do, i, role: entry.role, why: d.why, facts: fname };
    if (d.roles) out.roles = d.roles;
    return { code: 0, out: `${JSON.stringify(out)}\n` };
  }

  return refuse('usage: write | tasks | next | fix | dry | check');
}

export async function main(argv, cwd = process.cwd()) {
  try {
    return await run(argv, cwd);
  } catch (e) {
    return { code: 2, out: `refused: ${e instanceof Refusal ? e.message : 'internal error'}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // No top-level await: check.mjs imports this file and is loaded through require().
  main(process.argv.slice(2)).then((r) => {
    process.stdout.write(r.out);
    process.exitCode = r.code;
  });
}
