#!/usr/bin/env node
// Resolves the company type of a project from the plugin's type manifests.
//   resolve | check-playbook <name> | check-role <role> | roles | pick [--max <n>] <role>... | list | set <id> [--json]
// Output is readable lines; --json prints the machine form. The registry is built from a readdir of
// company/types/. A value from the project is only ever compared with registry keys (Object.hasOwn); it is
// never joined into a path. Refusals name a bad argument only in a safe form and echo no project value.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_PLUGIN_ROOT = path.join(import.meta.dirname, '..');

export const TYPE_ORDER = Object.freeze(['software', 'research', 'marketing', 'design']);
export const ALWAYS = Object.freeze(['help', 'version', 'language', 'settings', 'setup', 'lead', 'triage', 'skillspector', 'reprompt']);
export const CEO_ONLY = Object.freeze(['help', 'version', 'language', 'settings', 'setup', 'skillspector', 'pentest']);

const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const HINT_LINE_RE = /^argument-hint:[ 	]*\S/;
const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;
const LABEL_RE = /^[A-Za-z0-9 -]{1,40}$/;
const HINT_RE = /^[a-z0-9][a-z0-9 -]{0,59}$/;
const FILE_RE = /^([a-z][a-z0-9-]{0,31})\.json$/;
const SHIP_KINDS = ['release', 'deliver-report', 'publish', 'design-handoff'];
const LANES = ['security', 'compliance', 'legal', 'persona', 'hands_on', 'accessibility'];
const CHECKS = ['claims-cited', 'ai-disclosure', 'asset-licences', 'handoff-package'];
const MANIFEST_MAX = 64 * 1024;
const PROJECT_MAX = 256 * 1024;
const SKILL_MAX = 256 * 1024;

const ALLOWED = TYPE_ORDER.join(', ');
const USAGE = 'usage: company-type.mjs resolve | check-playbook <name> | check-role <role> | roles | pick [--max <n>] <role>... | list | set <id> [--json]';
const NAME_RULE = 'use a-z, 0-9 and -, start with a letter, at most 32 characters';
const SHOWN_RE = /^[\x21-\x7E]{1,40}$/;

// An argument in a form that is safe to print.
const shown = arg => {
  const text = String(arg);
  return SHOWN_RE.test(text) && !/["`]/.test(text) ? `"${text}"` : `(${[...text].length} characters, not shown)`;
};

class Refusal extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}
const invalid = (id, rule) => new Refusal(`type manifest ${id} invalid: ${rule}`, 3);

function lstat(p) {
  try {
    return fs.lstatSync(p);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function readRegularFile(file, max) {
  const st = lstat(file);
  if (st === null) return null;
  if (!st.isFile() || st.isSymbolicLink()) return { problem: 'not a regular file' };
  if (st.size > max) return { problem: 'too large' };
  const buf = fs.readFileSync(file);
  if (buf.length > max) return { problem: 'too large' };
  return { text: buf.toString('latin1') };
}

// Names of entries under a plugin folder, from readdir only.
function listNames(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function playbookNames(pluginRoot) {
  const out = new Set();
  const skillsDir = path.join(pluginRoot, 'skills');
  for (const name of listNames(skillsDir)) {
    if (!SLUG_RE.test(name)) continue;
    const file = readRegularFile(path.join(skillsDir, name, 'SKILL.md'), SKILL_MAX);
    if (file === null || file.problem) continue;
    const lines = file.text.split('\n').map(l => l.replace(/\r$/, ''));
    if (lines[0] !== '---') continue;
    const end = lines.indexOf('---', 1);
    if (end > 0 && lines.slice(1, end).some(l => HINT_LINE_RE.test(l))) out.add(name);
  }
  return out;
}

function agentNames(pluginRoot) {
  const out = new Set();
  for (const f of listNames(path.join(pluginRoot, 'agents'))) if (f.endsWith('.md') && SLUG_RE.test(f.slice(0, -3))) out.add(f.slice(0, -3));
  return out;
}

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function uniqueList(list, min, max, itemOk) {
  return Array.isArray(list) && list.length >= min && list.length <= max && list.every(itemOk) && new Set(list).size === list.length;
}

// Throws a Refusal naming the broken rule. Pure apart from the sets it is given.
function validateManifest(id, m, { agents, playbooks }) {
  if (!isPlain(m)) throw invalid(id, 'not an object');
  const only = (obj, keys) => {
    for (const key of Object.keys(obj)) if (!keys.includes(key)) throw invalid(id, 'unknown key');
    for (const key of keys) if (!Object.hasOwn(obj, key)) throw invalid(id, `${key} missing`);
  };
  only(m, ['v', 'id', 'label', 'roles', 'playbooks', 'work', 'ship', 'skill_search']);
  if (m.v !== 1) throw invalid(id, 'v must be 1');
  if (m.id !== id) throw invalid(id, 'id must equal the file name');
  if (typeof m.label !== 'string' || !LABEL_RE.test(m.label)) throw invalid(id, 'label');
  if (!uniqueList(m.roles, 1, 40, r => typeof r === 'string' && SLUG_RE.test(r) && agents.has(r))) throw invalid(id, 'roles');
  if (!m.roles.includes('skill-researcher')) throw invalid(id, 'roles must include skill-researcher');
  if (!m.roles.includes('reprompter')) throw invalid(id, 'roles must include reprompter');
  if (!uniqueList(m.playbooks, 1, 40, p => typeof p === 'string' && SLUG_RE.test(p) && !ALWAYS.includes(p) && playbooks.has(p))) throw invalid(id, 'playbooks');
  if (!uniqueList(m.work, 1, 3, w => typeof w === 'string' && m.playbooks.includes(w))) throw invalid(id, 'work');
  if (!isPlain(m.ship)) throw invalid(id, 'ship');
  only(m.ship, ['kind', 'meaning', 'lanes', 'checks']);
  if (!SHIP_KINDS.includes(m.ship.kind)) throw invalid(id, 'ship.kind');
  const meaning = m.ship.meaning;
  if (typeof meaning !== 'string' || meaning.length < 1 || meaning.length > 240 || /[\u0000-\u001f\u007f`<>]/.test(meaning)) throw invalid(id, 'ship.meaning');
  if (!uniqueList(m.ship.lanes, 0, 6, l => LANES.includes(l))) throw invalid(id, 'ship.lanes');
  if (!uniqueList(m.ship.checks, 0, 4, c => CHECKS.includes(c))) throw invalid(id, 'ship.checks');
  if (!isPlain(m.skill_search)) throw invalid(id, 'skill_search');
  only(m.skill_search, ['hints']);
  if (!uniqueList(m.skill_search.hints, 0, 5, h => typeof h === 'string' && HINT_RE.test(h))) throw invalid(id, 'skill_search.hints');
}

// The registry: a null-prototype object keyed by type id, built from a readdir of company/types/.
// Throws a Refusal (exit 3) for any entry or manifest that breaks a rule, or when software is missing.
export function loadRegistry(pluginRoot = DEFAULT_PLUGIN_ROOT) {
  const dir = path.join(pluginRoot, 'company', 'types');
  const sets = { agents: agentNames(pluginRoot), playbooks: playbookNames(pluginRoot) };
  const registry = Object.create(null);
  for (const file of listNames(dir).sort()) {
    const match = FILE_RE.exec(file);
    if (!match || !TYPE_ORDER.includes(match[1])) throw invalid('?', 'file name');
    const id = match[1];
    const read = readRegularFile(path.join(dir, file), MANIFEST_MAX);
    if (read === null) throw invalid(id, 'missing');
    if (read.problem) throw invalid(id, read.problem);
    let parsed;
    try {
      parsed = JSON.parse(read.text);
    } catch {
      throw invalid(id, 'not JSON');
    }
    validateManifest(id, parsed, sets);
    registry[id] = Object.freeze(parsed);
  }
  if (!Object.hasOwn(registry, 'software')) throw invalid('software', 'missing');
  return registry;
}

// Spans of HTML comments in the text; an unterminated one runs to the end.
function commentSpans(text) {
  const spans = [];
  let at = 0;
  for (;;) {
    const open = text.indexOf('<!--', at);
    if (open === -1) return spans;
    const close = text.indexOf('-->', open + 4);
    const end = close === -1 ? text.length : close + 3;
    spans.push([open, end]);
    at = end;
  }
}

// Lines that start outside a comment: { no (from 1), start, end (before the line feed), text (a trailing CR dropped) }.
function visibleLines(text) {
  const spans = commentSpans(text);
  const lines = [];
  let i = 0;
  let start = 0;
  let no = 0;
  while (start <= text.length) {
    no += 1;
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    while (i < spans.length && spans[i][1] <= start) i += 1;
    const hidden = i < spans.length && spans[i][0] <= start;
    if (!hidden && (end > start || start < text.length)) lines.push({ no, start, end, text: text.slice(start, end).replace(/\r$/, '') });
    start = end + 1;
  }
  return lines;
}

const EXACT = 'company_type:';
// The text is read as latin1, so a UTF-8 byte order mark shows as three characters.
const lookAlike = t => /^company_type[ \t]*:/.test(t.replace(/^(?:[ \t]|ï»¿|﻿)+/, '').replace(/[A-Z]/g, c => c.toLowerCase()));

// Lines that read as a company_type line: the exact form, and the near misses.
function typeLines(text) {
  const lines = visibleLines(text);
  return {
    exact: lines.filter(l => l.text.startsWith(EXACT)),
    odd: lines.filter(l => !l.text.startsWith(EXACT) && lookAlike(l.text))
  };
}

const cannotRead = reason => new Refusal(`cannot read .company/project.md (${reason}), so the company type is unknown; fix the file and run again`);
const noAccess = error => cannotRead(error.code === 'EACCES' || error.code === 'EPERM' ? 'no permission' : 'read error');

// Opens read-only, checks the opened descriptor, and reads at most PROJECT_MAX bytes. Null when there is no file.
function readOpened(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    if (error.code === 'EISDIR') throw cannotRead('not a regular file');
    let other = null;
    try {
      other = fs.statSync(file);
    } catch { /* keep the open error */ }
    if (other !== null && !other.isFile()) throw cannotRead('not a regular file');
    throw noAccess(error);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw cannotRead('not a regular file');
    if (st.size > PROJECT_MAX) throw cannotRead('larger than 256 KiB');
    const buf = Buffer.alloc(PROJECT_MAX + 1);
    let got = 0;
    while (got < buf.length) {
      const n = fs.readSync(fd, buf, got, buf.length - got, null);
      if (n === 0) break;
      got += n;
    }
    if (got > PROJECT_MAX) throw cannotRead('larger than 256 KiB');
    return buf.toString('latin1', 0, got);
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw noAccess(error);
  } finally {
    fs.closeSync(fd);
  }
}

// The project text, or null when there is no .company/project.md. Links are followed: the value read is only
// compared with registry keys, so a link adds nothing a committed file could not.
function readProject(cwd) {
  let dir;
  try {
    dir = fs.statSync(path.join(cwd, '.company'));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw new Refusal('cannot read .company, so the company type is unknown; fix the folder and run again');
  }
  if (!dir.isDirectory()) throw new Refusal('.company is not a folder, so the company type is unknown');
  return readOpened(path.join(cwd, '.company', 'project.md'));
}

const lineList = lines => `${lines.slice(0, -1).map(l => l.no).join(', ')}, ${lines.at(-1).no}`;

function projectType(text, registry) {
  if (text === null) return null;
  const { exact, odd } = typeLines(text);
  if (odd.length > 0) throw new Refusal(`line ${odd[0].no} of .company/project.md looks like a company_type line but is not "company_type: <id>" at the start of the line; allowed: ${ALLOWED}`);
  if (exact.length === 0) return null;
  if (exact.length > 1) throw new Refusal(`.company/project.md has ${exact.length} company_type lines (lines ${lineList(exact)}); keep one; allowed: ${ALLOWED}`);
  const value = exact[0].text.slice(EXACT.length).replace(/^[ \t]+|[ \t]+$/g, '');
  if (!ID_RE.test(value) || !Object.hasOwn(registry, value)) throw new Refusal(`company_type on line ${exact[0].no} of .company/project.md is not valid; allowed: ${ALLOWED}`);
  return value;
}

function resolve({ cwd, pluginRoot }) {
  const registry = loadRegistry(pluginRoot);
  const fromProject = projectType(readProject(cwd), registry);
  const id = fromProject ?? 'software';
  const m = registry[id];
  return {
    v: 1,
    id,
    source: fromProject === null ? 'default' : 'project',
    label: m.label,
    roles: [...m.roles],
    playbooks: [...m.playbooks, ...ALWAYS],
    work: [...m.work],
    ship: { kind: m.ship.kind, meaning: m.ship.meaning, lanes: [...m.ship.lanes], checks: [...m.ship.checks] },
    skill_search: { hints: [...m.skill_search.hints] }
  };
}

const orNone = (items, sep = ', ') => (items.length === 0 ? 'none' : items.join(sep));

function typeLinesOf(r) {
  const first = r.source === 'project'
    ? `company type: ${r.id} (${r.label}), from .company/project.md`
    : `company type: ${r.id} (${r.label}), default: no company_type line`;
  return [
    first,
    `roles: ${orNone(r.roles)}`,
    `playbooks: ${orNone(r.playbooks)}`,
    `work: ${orNone(r.work)}`,
    `ship: ${r.ship.kind}. ${r.ship.meaning}`,
    `ship lanes: ${orNone(r.ship.lanes)}`,
    `ship checks: ${orNone(r.ship.checks)}`,
    `skill search hints: ${orNone(r.skill_search.hints, '; ')}`
  ];
}

function checkMember(kind, name, ctx, json) {
  const r = resolve(ctx);
  const members = kind === 'playbook' ? r.playbooks : r.roles;
  if (!members.includes(name)) throw new Refusal(`${name} is not part of the ${r.id} company; allowed: ${members.join(', ')}`);
  return json ? JSON.stringify(r) : [`ok: ${name} is part of the ${r.id} company`, ...typeLinesOf(r)].join('\n');
}

function pick({ max, names }, ctx, json) {
  const r = resolve(ctx);
  const got = names.filter(n => r.roles.includes(n)).slice(0, max);
  if (got.length === 0) throw new Refusal(`none of ${names.join(', ')} is part of the ${r.id} company; allowed: ${r.roles.join(', ')}`);
  return json ? JSON.stringify(got) : got.join('\n');
}

function list(ctx, json) {
  const registry = loadRegistry(ctx.pluginRoot);
  const rows = TYPE_ORDER.filter(id => Object.hasOwn(registry, id)).map(id => ({ id, label: registry[id].label, ship_meaning: registry[id].ship.meaning }));
  return json ? JSON.stringify(rows) : rows.map(r => `${r.id}: ${r.label}. Ship means: ${r.ship_meaning}`).join('\n');
}

function writeAtomic(file, text) {
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  let created = false;
  try {
    const fd = fs.openSync(tmp, 'wx');
    created = true;
    try {
      fs.writeFileSync(fd, text, 'latin1');
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    if (created) fs.rmSync(tmp, { force: true });
    throw error;
  }
}

// Adds `company_type: <id>` as the line before product_type: (else after the first comment, else at the top).
function insertLine(text, id) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const line = `company_type: ${id}${eol}`;
  const product = visibleLines(text).find(l => l.text.startsWith('product_type:'));
  if (product) return text.slice(0, product.start) + line + text.slice(product.start);
  const spans = commentSpans(text);
  if (spans.length === 0) return line + text;
  const feed = text.indexOf('\n', spans[0][1]);
  if (feed === -1) return text + (text.endsWith('\n') ? '' : eol) + line;
  return text.slice(0, feed + 1) + line + text.slice(feed + 1);
}

// Writes never follow links: the folder and the file must be what lstat says they are.
function setType(id, { cwd, pluginRoot }, json) {
  const registry = loadRegistry(pluginRoot);
  if (!ID_RE.test(id) || !Object.hasOwn(registry, id)) throw new Refusal(`${shown(id)} is not a company type; allowed: ${ALLOWED}`);
  const link = () => new Refusal('.company/project.md is a link; set writes only a regular file in a real .company folder');
  const dir = lstat(path.join(cwd, '.company'));
  if (dir === null) throw new Refusal('no .company/project.md');
  if (dir.isSymbolicLink()) throw link();
  if (!dir.isDirectory()) throw new Refusal('.company is not a folder, so the company type is unknown');
  const file = path.join(cwd, '.company', 'project.md');
  const st = lstat(file);
  if (st === null) throw new Refusal('no .company/project.md');
  if (st.isSymbolicLink()) throw link();
  const text = readOpened(file);
  if (text === null) throw new Refusal('no .company/project.md');
  const before = typeLines(text);
  if (before.exact.length + before.odd.length > 0) throw new Refusal('company_type already set; switching types is not supported');
  const next = insertLine(text, id);
  const after = typeLines(next);
  if (after.odd.length !== 0 || after.exact.length !== 1 || after.exact[0].text !== `company_type: ${id}`) throw new Refusal('cannot place the company_type line');
  writeAtomic(file, next);
  return json ? JSON.stringify({ v: 1, set: id }) : `set ${id}`;
}

const NEEDS = Object.freeze({
  __proto__: null,
  resolve: 'no arguments',
  roles: 'no arguments',
  list: 'no arguments',
  'check-playbook': 'one Playbook name',
  'check-role': 'one Role name',
  set: 'one company type',
  pick: '1 to 8 Role names'
});

function checkName(kind, name) {
  if (!ID_RE.test(name)) throw new Refusal(`${kind} name ${shown(name)} is not valid: ${NAME_RULE}`);
  return name;
}

function parsePick(rest) {
  let max = null;
  const names = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--max') {
      if (max !== null) throw new Refusal('"--max" is given twice');
      const value = rest[i + 1];
      if (typeof value !== 'string' || !/^[1-4]$/.test(value)) throw new Refusal('--max must be a whole number from 1 to 4');
      max = Number(value);
      i += 1;
    } else {
      names.push(rest[i]);
    }
  }
  if (names.length < 1 || names.length > 8) throw new Refusal(`pick needs ${NEEDS.pick}; ${USAGE}`);
  const seen = new Set();
  for (const name of names) {
    checkName('Role', name);
    if (seen.has(name)) throw new Refusal(`${shown(name)} is given twice`);
    seen.add(name);
  }
  return { max: max ?? 1, names };
}

// Returns { code, out }.
export function run(args, { cwd = process.cwd(), pluginRoot = DEFAULT_PLUGIN_ROOT } = {}) {
  try {
    if (!Array.isArray(args) || args.length === 0) throw new Refusal(`no command; ${USAGE}`);
    const [command, ...all] = args.map(String);
    if (!(command in NEEDS)) throw new Refusal(`unknown command ${shown(command)}; ${USAGE}`);
    const flags = all.filter(a => a === '--json').length;
    if (flags > 1) throw new Refusal('"--json" is given twice');
    const json = flags === 1;
    const rest = all.filter(a => a !== '--json');
    const ctx = { cwd, pluginRoot };
    let out;
    if (command === 'pick') {
      out = pick(parsePick(rest), ctx, json);
    } else {
      const want = NEEDS[command].startsWith('no ') ? 0 : 1;
      if (rest.length !== want) throw new Refusal(`${command} needs ${NEEDS[command]}; ${USAGE}`);
      if (command === 'resolve') out = json ? JSON.stringify(resolve(ctx)) : typeLinesOf(resolve(ctx)).join('\n');
      else if (command === 'check-playbook') out = checkMember('playbook', checkName('Playbook', rest[0]), ctx, json);
      else if (command === 'check-role') out = checkMember('role', checkName('Role', rest[0]), ctx, json);
      else if (command === 'roles') out = json ? JSON.stringify(resolve(ctx).roles) : resolve(ctx).roles.join('\n');
      else if (command === 'list') out = list(ctx, json);
      else out = setType(rest[0], ctx, json);
    }
    return { code: 0, out };
  } catch (error) {
    if (error instanceof Refusal) return { code: error.code, out: `refused: ${error.message}` };
    return { code: 2, out: 'refused: could not read the company type' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, out } = run(process.argv.slice(2));
  process.stdout.write(`${out}\n`);
  process.exitCode = code;
}
