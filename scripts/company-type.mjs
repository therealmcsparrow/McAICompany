#!/usr/bin/env node
// Resolves the company type of a project from the plugin's type manifests.
//   resolve | check-playbook <name> | check-role <role> | roles | list | set <id>
// The registry is built from a readdir of company/types/. A value from the project is only ever compared
// with registry keys (Object.hasOwn); it is never joined into a path. Refusals echo no project value.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_PLUGIN_ROOT = path.join(import.meta.dirname, '..');

export const TYPE_ORDER = Object.freeze(['software', 'research', 'marketing', 'design']);
export const ALWAYS = Object.freeze(['help', 'version', 'language', 'settings', 'setup', 'lead', 'triage', 'skillspector']);

const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
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

const AC9 = `company_type is not valid; allowed: ${TYPE_ORDER.join(', ')}`;
const USAGE = 'usage: company-type.mjs resolve | check-playbook <name> | check-role <role> | roles | list | set <id>';

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
    if (end > 0 && lines.slice(1, end).includes('disable-model-invocation: true')) out.add(name);
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
  only(m, ['v', 'id', 'label', 'roles', 'playbooks', 'ship', 'skill_search']);
  if (m.v !== 1) throw invalid(id, 'v must be 1');
  if (m.id !== id) throw invalid(id, 'id must equal the file name');
  if (typeof m.label !== 'string' || !LABEL_RE.test(m.label)) throw invalid(id, 'label');
  if (!uniqueList(m.roles, 1, 40, r => typeof r === 'string' && SLUG_RE.test(r) && agents.has(r))) throw invalid(id, 'roles');
  if (!m.roles.includes('skill-researcher')) throw invalid(id, 'roles must include skill-researcher');
  if (!uniqueList(m.playbooks, 1, 40, p => typeof p === 'string' && SLUG_RE.test(p) && !ALWAYS.includes(p) && playbooks.has(p))) throw invalid(id, 'playbooks');
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

// Lines that start outside a comment: { start, end (before the line feed), text (a trailing CR dropped) }.
function visibleLines(text) {
  const spans = commentSpans(text);
  const lines = [];
  let i = 0;
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    while (i < spans.length && spans[i][1] <= start) i += 1;
    const hidden = i < spans.length && spans[i][0] <= start;
    if (!hidden && (end > start || start < text.length)) lines.push({ start, end, text: text.slice(start, end).replace(/\r$/, '') });
    start = end + 1;
  }
  return lines;
}

const typeLines = text => visibleLines(text).filter(l => l.text.startsWith('company_type:'));

// The project value, or null when no .company/project.md or no line. Throws the AC9 refusal for anything unsafe.
function readProject(cwd) {
  const dir = lstat(path.join(cwd, '.company'));
  if (dir === null) return null;
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Refusal(AC9);
  let file;
  try {
    file = readRegularFile(path.join(cwd, '.company', 'project.md'), PROJECT_MAX);
  } catch {
    throw new Refusal(AC9);
  }
  if (file === null) return null;
  if (file.problem) throw new Refusal(AC9);
  return file.text;
}

function projectType(text, registry) {
  if (text === null) return null;
  const lines = typeLines(text);
  if (lines.length === 0) return null;
  if (lines.length > 1) throw new Refusal(AC9);
  const value = lines[0].text.slice('company_type:'.length).replace(/^[ \t]+|[ \t]+$/g, '');
  if (!ID_RE.test(value) || !Object.hasOwn(registry, value)) throw new Refusal(AC9);
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
    ship: { kind: m.ship.kind, meaning: m.ship.meaning, lanes: [...m.ship.lanes], checks: [...m.ship.checks] },
    skill_search: { hints: [...m.skill_search.hints] }
  };
}

function checkMember(kind, name, ctx) {
  if (typeof name !== 'string' || !ID_RE.test(name)) throw new Refusal(USAGE);
  const r = resolve(ctx);
  const list = kind === 'playbook' ? r.playbooks : r.roles;
  if (!list.includes(name)) throw new Refusal(`${name} is not part of the ${r.id} company; allowed: ${list.join(', ')}`);
  return JSON.stringify(r);
}

function list(ctx) {
  const registry = loadRegistry(ctx.pluginRoot);
  return JSON.stringify(TYPE_ORDER.filter(id => Object.hasOwn(registry, id)).map(id => ({ id, label: registry[id].label, ship_meaning: registry[id].ship.meaning })));
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

function setType(id, { cwd, pluginRoot }) {
  const registry = loadRegistry(pluginRoot);
  if (typeof id !== 'string' || !ID_RE.test(id) || !Object.hasOwn(registry, id)) throw new Refusal(AC9);
  const text = readProject(cwd);
  if (text === null) throw new Refusal('no .company/project.md');
  if (typeLines(text).length > 0) throw new Refusal('company_type already set; switching types is not supported');
  const next = insertLine(text, id);
  const lines = typeLines(next);
  if (lines.length !== 1 || lines[0].text !== `company_type: ${id}`) throw new Refusal('cannot place the company_type line');
  writeAtomic(path.join(cwd, '.company', 'project.md'), next);
  return `set ${id}`;
}

// Returns { code, out }.
export function run(args, { cwd = process.cwd(), pluginRoot = DEFAULT_PLUGIN_ROOT } = {}) {
  try {
    const [command, ...rest] = args;
    const ctx = { cwd, pluginRoot };
    if (command === 'resolve' && rest.length === 0) return { code: 0, out: JSON.stringify(resolve(ctx)) };
    if (command === 'check-playbook' && rest.length === 1) return { code: 0, out: checkMember('playbook', rest[0], ctx) };
    if (command === 'check-role' && rest.length === 1) return { code: 0, out: checkMember('role', rest[0], ctx) };
    if (command === 'roles' && rest.length === 0) return { code: 0, out: resolve(ctx).roles.join('\n') };
    if (command === 'list' && rest.length === 0) return { code: 0, out: list(ctx) };
    if (command === 'set' && rest.length === 1) return { code: 0, out: setType(rest[0], ctx) };
    throw new Refusal(USAGE);
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
