#!/usr/bin/env node
// Resolves and stores aico settings (aico-settings v1): per-Role name, model and effort,
// pipeline behaviour and Gates. Precedence per field: project > user > plugin.
// User layer: <home>/config.json key aico_settings. Project layer: .company/settings.json key aico_settings.
// Unlocks count only from the user layer.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NAME_RE } from './check.mjs';
import { headerEnd, resolve as resolveLanguage, validate as validateLanguage } from './language.mjs';

export const MODELS = ['opus', 'sonnet', 'haiku', 'fable', 'inherit'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const LANES = ['security', 'compliance', 'legal', 'persona', 'hands_on', 'accessibility'];
export const GATES = ['brief', 'plan', 'ship', 'installs'];
export const LOCKABLE = ['ship', 'security', 'installs'];
export const CONTEXT_CAP_MIN = 60000;
export const CONTEXT_CAP_MAX = 1000000;
export const CONTEXT_CAP_DEFAULT = 150000;
export const DEBATES = ['crossfire', 'full_pass'];
export const PIPELINE_DEFAULTS = {
  fix_rounds: 2,
  dispatch: 'parallel',
  context_cap: CONTEXT_CAP_DEFAULT,
  lanes: { security: true, compliance: true, legal: 'auto', persona: true, hands_on: true, accessibility: true }
};
export const GATE_DEFAULTS = { brief: 'ask', plan: 'ask', ship: 'ask', installs: 'ask' };
export const BRAINSTORM_DEFAULTS = { film_script: false, debate: 'crossfire' };

export const PROFILE_FIELDS = ['product_type', 'engagement', 'client', 'audience', 'goal', 'stack', 'languages', 'voice', 'license', 'jurisdiction'];

const KEY = 'aico_settings';
const OPTION_FIELDS = ['product_type', 'engagement', 'voice'];
const MAX_TEXT = 200;
const LEGAL = ['auto', 'on', 'off'];
const DISPATCH = ['parallel', 'sequential'];
const GATE_VALUES = ['ask', 'auto'];
const LOCKED_GATES = ['ship', 'installs'];
const LOCKED_LANES = ['security', 'compliance'];
const ROLE_FIELDS = ['name', 'model', 'effort'];
const MAX_FILE_BYTES = 1024 * 1024;
const USAGE = 'usage: settings.mjs get [key] | serve [--no-open]';
const DEFAULT_PLUGIN_ROOT = path.join(import.meta.dirname, '..');

export class Refusal extends Error {}

function homeDir(home) {
  if (home) return home;
  if (process.env.MCSPARROW_HOME) return process.env.MCSPARROW_HOME;
  return path.join(os.homedir(), '.mcsparrow');
}

function layerPath(level, { home, cwd } = {}) {
  if (level === 'user') return path.join(homeDir(home), 'config.json');
  if (level === 'project') return path.join(cwd ?? process.cwd(), '.company', 'settings.json');
  throw new Refusal('level must be user or project');
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Shows a key from a file only when it is plainly safe to print.
const label = (k) => (/^[A-Za-z0-9_-]{1,40}$/.test(k) ? k : JSON.stringify(String(k).slice(0, 40)));

// Returns the file's bytes, or null when it doesn't exist. Too large or unreadable throws Refusal.
function readBounded(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Refusal(`${file} cannot be read (${error.code ?? 'error'})`);
  }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_FILE_BYTES) throw new Refusal(`${file} is too large`);
  try {
    return fs.readFileSync(file);
  } catch (error) {
    throw new Refusal(`${file} cannot be read (${error.code ?? 'error'})`);
  }
}

// A revision input for a file readBounded refused: size and time when known, else the reason.
function refusedRaw(file, error) {
  try {
    const stat = fs.statSync(file);
    return `refused:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return `refused:${error.message}`;
  }
}

function parseConfig(file, bytes) {
  let data;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Refusal(`${file} is not valid JSON`);
  }
  if (!isObject(data)) throw new Refusal(`${file} is not valid JSON`);
  return data;
}

// Returns the parsed config object, {} when the file is missing, or throws Refusal.
function readConfig(file) {
  const bytes = readBounded(file);
  return bytes === null ? {} : parseConfig(file, bytes);
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A random name opened with 'wx' never follows or reuses something already at that path.
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  let created = false;
  try {
    const fd = fs.openSync(tmp, 'wx');
    created = true;
    try {
      fs.writeFileSync(fd, text);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    // Only remove the temp file this call created, never one that was already there.
    if (created) fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function frontmatter(text) {
  const lines = text.split(/\r?\n/);
  const fields = {};
  if (lines[0] !== '---') return fields;
  for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
    const m = /^(model|effort):\s*(\S+)\s*$/.exec(lines[i]);
    if (m) fields[m[1]] = m[2];
  }
  return fields;
}

export function pluginDefaults(pluginRoot = DEFAULT_PLUGIN_ROOT) {
  let names = {};
  const namesBytes = readBounded(path.join(pluginRoot, 'company', 'names.json'));
  if (namesBytes !== null) names = parseConfig('company/names.json', namesBytes);
  const roles = {};
  const dir = path.join(pluginRoot, 'agents');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const role = file.slice(0, -3);
    const { model, effort } = frontmatter(readBounded(path.join(dir, file)).toString('utf8'));
    const name = typeof names[role] === 'string' && Object.hasOwn(names, role) ? names[role] : role;
    roles[role] = { name, model, effort };
  }
  return { roles, pipeline: structuredClone(PIPELINE_DEFAULTS), gates: { ...GATE_DEFAULTS }, brainstorm: { ...BRAINSTORM_DEFAULTS } };
}

function oneOf(values) {
  return { ok: (v) => values.includes(v), why: `must be one of ${values.join(', ')}` };
}
const BOOLEAN = { ok: (v) => typeof v === 'boolean', why: 'must be true or false' };
// A rule with `msg` is refused with exactly that text (the Contract's wording), not "<path>: <why>".
const CONTEXT_CAP = {
  ok: (v) => Number.isInteger(v) && v >= CONTEXT_CAP_MIN && v <= CONTEXT_CAP_MAX,
  msg: `context_cap must be a whole number from ${CONTEXT_CAP_MIN} to ${CONTEXT_CAP_MAX}`
};
const ROLE_RULES = {
  name: { ok: (v) => typeof v === 'string' && NAME_RE.test(v), why: "must be 1-30 letters, single spaces, hyphens or apostrophes, starting with a letter" },
  model: oneOf(MODELS),
  effort: oneOf(EFFORTS),
  context_cap: CONTEXT_CAP
};
const PIPELINE_RULES = {
  fix_rounds: { ok: (v) => Number.isInteger(v) && v >= 0 && v <= 5, why: 'must be a whole number from 0 to 5' },
  dispatch: oneOf(DISPATCH),
  context_cap: CONTEXT_CAP
};
const BRAINSTORM_RULES = {
  film_script: BOOLEAN,
  debate: { ok: (v) => DEBATES.includes(v), msg: `brainstorm.debate must be ${DEBATES.join(' or ')}` }
};
const LANE_RULES = Object.fromEntries(LANES.map((l) => [l, l === 'legal' ? oneOf(LEGAL) : BOOLEAN]));
const GATE_RULES = Object.fromEntries(GATES.map((g) => [g, oneOf(GATE_VALUES)]));

// Checks the flat fields of `obj` against `rules`; returns the valid ones. Keys in `nested` are skipped.
function checkFields(obj, rules, at, reasons, nested = []) {
  const clean = {};
  for (const k of Object.keys(obj)) {
    if (nested.includes(k)) continue;
    if (!Object.hasOwn(rules, k)) reasons.push(`${at}.${label(k)}: unknown key`);
    else if (!rules[k].ok(obj[k])) reasons.push(rules[k].msg ?? `${at}.${k}: ${rules[k].why}`);
    else clean[k] = obj[k];
  }
  return clean;
}

const notEmpty = (o) => Object.keys(o).length > 0;

// Walks a layer against the schema. Returns { clean, reasons }: clean keeps only valid parts.
function sanitize(layer, roleNames) {
  const reasons = [];
  const clean = { version: 1 };
  if (!isObject(layer)) return { clean, reasons: [`${KEY}: must be an object`] };
  if (layer.version !== 1) return { clean, reasons: ['version: must be 1'] };
  for (const key of Object.keys(layer)) {
    const value = layer[key];
    if (key === 'version') continue;
    if (key === 'roles') {
      if (!isObject(value)) { reasons.push('roles: must be an object'); continue; }
      const roles = {};
      for (const role of Object.keys(value)) {
        if (!roleNames.has(role)) { reasons.push(`roles.${label(role)}: unknown Role`); continue; }
        if (!isObject(value[role])) { reasons.push(`roles.${role}: must be an object`); continue; }
        const fields = checkFields(value[role], ROLE_RULES, `roles.${role}`, reasons);
        if (notEmpty(fields)) roles[role] = fields;
      }
      if (notEmpty(roles)) clean.roles = roles;
    } else if (key === 'pipeline') {
      if (!isObject(value)) { reasons.push('pipeline: must be an object'); continue; }
      const pipeline = checkFields(value, PIPELINE_RULES, 'pipeline', reasons, ['lanes']);
      if (Object.hasOwn(value, 'lanes')) {
        if (!isObject(value.lanes)) reasons.push('pipeline.lanes: must be an object');
        else {
          const lanes = checkFields(value.lanes, LANE_RULES, 'pipeline.lanes', reasons);
          if (notEmpty(lanes)) pipeline.lanes = lanes;
        }
      }
      if (notEmpty(pipeline)) clean.pipeline = pipeline;
    } else if (key === 'gates') {
      if (!isObject(value)) { reasons.push('gates: must be an object'); continue; }
      const gates = checkFields(value, GATE_RULES, 'gates', reasons);
      if (notEmpty(gates)) clean.gates = gates;
    } else if (key === 'brainstorm') {
      if (!isObject(value)) { reasons.push('brainstorm: must be an object'); continue; }
      const brainstorm = checkFields(value, BRAINSTORM_RULES, 'brainstorm', reasons);
      if (notEmpty(brainstorm)) clean.brainstorm = brainstorm;
    } else if (key === 'unlocked') {
      if (!Array.isArray(value)) { reasons.push('unlocked: must be a list'); continue; }
      const unlocked = [];
      for (const item of value) {
        if (!LOCKABLE.includes(item)) reasons.push(`unlocked: ${label(typeof item === 'string' ? item : JSON.stringify(item))} is not lockable (only ${LOCKABLE.join(', ')})`);
        else if (!unlocked.includes(item)) unlocked.push(item);
      }
      if (unlocked.length) clean.unlocked = unlocked;
    } else {
      reasons.push(`${label(key)}: unknown key`);
    }
  }
  return { clean, reasons };
}

export function validateLayer(layer, roleNames) {
  return sanitize(layer, roleNames).reasons;
}

// Reads one layer file. Returns { raw, layer, warnings }; raw feeds the revision hash.
function loadLayer(level, ctx, roleNames) {
  const file = layerPath(level, ctx);
  const empty = { version: 1 };
  let bytes;
  try {
    bytes = readBounded(file);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return { raw: refusedRaw(file, error), layer: empty, warnings: [error.message] };
  }
  if (bytes === null) return { raw: '', layer: empty, warnings: [] };
  let data;
  try {
    data = parseConfig(file, bytes);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return { raw: bytes, layer: empty, warnings: [error.message] };
  }
  if (!Object.hasOwn(data, KEY)) return { raw: bytes, layer: empty, warnings: [] };
  const { clean, reasons } = sanitize(data[KEY], roleNames);
  return { raw: bytes, layer: clean, warnings: reasons.map((r) => `${file}: ignoring ${r}`) };
}

const roleNamesOf = (pluginRoot) => new Set(Object.keys(pluginDefaults(pluginRoot).roles));

export function readLayer(level, { home, cwd, pluginRoot = DEFAULT_PLUGIN_ROOT } = {}) {
  const { layer, warnings } = loadLayer(level, { home, cwd }, roleNamesOf(pluginRoot));
  return { layer, warnings };
}

function resolveRoles(defaults, user, project) {
  const roles = {};
  for (const [role, base] of Object.entries(defaults.roles)) {
    const entry = {};
    const source = {};
    for (const f of ROLE_FIELDS) {
      [entry[f], source[f]] = pick(project.roles?.[role]?.[f], user.roles?.[role]?.[f], base[f]);
    }
    // Role cap, else the global cap, else the plugin default. `source` says which level supplied it.
    const own = pick(project.roles?.[role]?.context_cap, user.roles?.[role]?.context_cap, undefined);
    if (own[0] !== undefined) [entry.context_cap, source.context_cap] = own;
    else {
      const [value, from] = pick(project.pipeline?.context_cap, user.pipeline?.context_cap, PIPELINE_DEFAULTS.context_cap);
      [entry.context_cap, source.context_cap] = [value, from === 'plugin' ? 'plugin' : `pipeline:${from}`];
    }
    roles[role] = { ...entry, source };
  }
  return roles;
}

const pick = (p, u, d) => (p !== undefined ? [p, 'project'] : u !== undefined ? [u, 'user'] : [d, 'plugin']);

// Effective names must be unique, case-insensitive. Returns one reason per clash.
function nameClashes(roles) {
  const seen = new Map();
  const clashes = [];
  for (const [role, { name }] of Object.entries(roles)) {
    const key = name.toLowerCase();
    if (seen.has(key)) clashes.push(`name ${name} is used by both ${seen.get(key)} and ${role}`);
    else seen.set(key, role);
  }
  return clashes;
}

const projectFile = (cwd) => path.join(cwd ?? process.cwd(), '.company', 'project.md');

// Options come from the `a | b | c` values in the project template; `<...>` placeholders are skipped.
export function templateOptions(pluginRoot = DEFAULT_PLUGIN_ROOT) {
  const options = Object.fromEntries(OPTION_FIELDS.map((f) => [f, []]));
  const bytes = readBounded(path.join(pluginRoot, 'skills', 'lead', 'references', 'project-template.md'));
  if (bytes === null) return options;
  const lines = bytes.toString('utf8').split(/\r?\n/);
  for (const line of lines.slice(0, headerEnd(lines))) {
    const m = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
    if (m && OPTION_FIELDS.includes(m[1]) && !m[2].includes('<')) options[m[1]] = m[2].split('|').map((o) => o.trim()).filter(Boolean);
  }
  return options;
}

function profileLines(cwd) {
  const bytes = readBounded(projectFile(cwd));
  if (bytes === null) return null;
  return bytes.toString('utf8').split(/\r?\n/);
}

export function readProfile({ cwd } = {}) {
  const lines = profileLines(cwd);
  if (lines === null) return { hasProject: false, fields: {} };
  const fields = {};
  for (const line of lines.slice(0, headerEnd(lines))) {
    const m = /^([a-z_]+):[ \t]*(.*?)\s*$/.exec(line);
    if (m && PROFILE_FIELDS.includes(m[1]) && !Object.hasOwn(fields, m[1])) fields[m[1]] = m[2];
  }
  return { hasProject: true, fields };
}

// Returns a reason string when `value` is not acceptable for `field`, else null.
function profileProblem(field, value, options) {
  if (typeof value !== 'string' || value.trim() === '') return 'must be text';
  if (/[\u0000-\u001f\u007f]/.test(value)) return 'must be one line without control characters';
  if (value.length > MAX_TEXT) return `must be at most ${MAX_TEXT} characters`;
  if (value !== value.trim()) return 'must not start or end with spaces';
  if (field === 'languages') {
    return value.split(',').every((tag) => validateLanguage(tag.trim()).ok) ? null : 'must be a comma-separated list of language tags';
  }
  if (field === 'voice') {
    return value.split(' + ').every((v) => options.voice.includes(v)) ? null : `must be ${options.voice.join(', ')}, joined with " + "`;
  }
  if (OPTION_FIELDS.includes(field)) return options[field].includes(value) ? null : `must be one of ${options[field].join(', ')}`;
  return null;
}

// Rewrites only the edited header lines of .company/project.md. Unchanged values are not re-validated.
// With dryRun it validates only and writes nothing.
export function writeProfile(changes, { cwd, pluginRoot = DEFAULT_PLUGIN_ROOT, dryRun = false } = {}) {
  const file = projectFile(cwd);
  const bytes = readBounded(file);
  if (bytes === null) throw new Refusal('no .company/project.md');
  if (!isObject(changes)) throw new Refusal('profile changes must be an object');
  const text = bytes.toString('utf8');
  const parts = text.split(/(\r?\n)/); // even indexes are lines, odd are their line breaks
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lineAt = (i) => parts[2 * i];
  const count = Math.ceil(parts.length / 2);
  const stored = readProfile({ cwd }).fields;
  const options = templateOptions(pluginRoot);
  const reasons = [];
  const edits = [];
  for (const field of Object.keys(changes)) {
    if (!PROFILE_FIELDS.includes(field)) { reasons.push(`${label(field)}: unknown profile field`); continue; }
    if (changes[field] === stored[field]) continue;
    const problem = profileProblem(field, changes[field], options);
    if (problem) reasons.push(`${field}: ${problem}`);
    else edits.push(field);
  }
  if (reasons.length) throw new Refusal(reasons.join('; '));
  if (edits.length === 0 || dryRun) return;
  const lines = Array.from({ length: count }, (_, i) => lineAt(i));
  let end = headerEnd(lines);
  for (const field of edits) {
    const line = `${field}: ${changes[field]}`;
    const at = lines.findIndex((l, i) => i < end && l.startsWith(`${field}:`));
    if (at !== -1) {
      parts[2 * at] = line;
      continue;
    }
    // A new field goes after the last key line of the header, or at its end when it has none.
    let last = -1;
    for (let i = 0; i < end; i++) if (/^[a-z_]+:/.test(lines[i])) last = i;
    const index = last === -1 ? end : last + 1;
    if (index < lines.length) parts.splice(2 * index, 0, line, eol);
    else parts.push(eol, line);
    lines.splice(index, 0, line);
    end = headerEnd(lines);
  }
  writeAtomic(file, parts.join(''));
}

export function resolveSettings({ home, cwd, pluginRoot = DEFAULT_PLUGIN_ROOT } = {}) {
  const defaults = pluginDefaults(pluginRoot);
  const roleNames = new Set(Object.keys(defaults.roles));
  const u = loadLayer('user', { home, cwd }, roleNames);
  const p = loadLayer('project', { home, cwd }, roleNames);
  const user = u.layer;
  const project = p.layer;
  const warnings = [...u.warnings, ...p.warnings];
  const ignored = [];
  const unlocked = user.unlocked ?? [];
  for (const k of project.unlocked ?? []) ignored.push(`project unlocked: ${k}`);
  // A project layer with any problem may have lost a re-lock, so the unlocks don't count (fail closed).
  const held = p.warnings.length > 0 && unlocked.length > 0;
  if (held) warnings.push('project settings have problems: ship and installs Gates held at ask, security and compliance lanes held on');
  const isUnlocked = (k) => !held && unlocked.includes(k);

  const roles = resolveRoles(defaults, user, project);
  warnings.push(...nameClashes(roles));

  const pipeline = {
    fix_rounds: pick(project.pipeline?.fix_rounds, user.pipeline?.fix_rounds, PIPELINE_DEFAULTS.fix_rounds)[0],
    dispatch: pick(project.pipeline?.dispatch, user.pipeline?.dispatch, PIPELINE_DEFAULTS.dispatch)[0],
    context_cap: pick(project.pipeline?.context_cap, user.pipeline?.context_cap, PIPELINE_DEFAULTS.context_cap)[0],
    lanes: {}
  };
  // Not locks: no unlock is involved, and a fail-closed project layer does not change them.
  const brainstorm = {};
  for (const k of Object.keys(BRAINSTORM_DEFAULTS)) {
    brainstorm[k] = pick(project.brainstorm?.[k], user.brainstorm?.[k], BRAINSTORM_DEFAULTS[k])[0];
  }
  for (const lane of LANES) {
    const [value, source] = pick(project.pipeline?.lanes?.[lane], user.pipeline?.lanes?.[lane], PIPELINE_DEFAULTS.lanes[lane]);
    if (LOCKED_LANES.includes(lane) && value === false && !isUnlocked('security')) {
      pipeline.lanes[lane] = PIPELINE_DEFAULTS.lanes[lane];
      ignored.push(`pipeline.lanes.${lane}: off from ${source} ${held ? 'held on' : 'needs the user unlock security'}`);
    } else {
      pipeline.lanes[lane] = value;
    }
  }

  const gates = {};
  for (const gate of GATES) {
    const [value, source] = pick(project.gates?.[gate], user.gates?.[gate], GATE_DEFAULTS[gate]);
    if (LOCKED_GATES.includes(gate) && value === 'auto' && !isUnlocked(gate)) {
      gates[gate] = GATE_DEFAULTS[gate];
      ignored.push(`gates.${gate}: auto from ${source} ${held ? 'held at ask' : `needs the user unlock ${gate}`}`);
    } else {
      gates[gate] = value;
    }
  }

  // The revision also covers project.md (profile and project language), so a stale page can't overwrite it.
  let md;
  try {
    md = readBounded(projectFile(cwd)) ?? '';
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    md = refusedRaw(projectFile(cwd), error);
  }
  const revision = createHash('sha256').update(u.raw).update('\0').update(p.raw).update('\0').update(md).digest('hex');
  const language = resolveLanguage({ home, cwd });
  const profile = { ...readProfile({ cwd }), options: templateOptions(pluginRoot) };
  return { revision, roles, pipeline, gates, brainstorm, unlocked: [...unlocked], ignored, warnings, language, profile };
}

// Checks a user and a project layer together, as they would be stored. Returns all reasons.
export function checkLayers(user, project, { pluginRoot = DEFAULT_PLUGIN_ROOT } = {}) {
  const defaults = pluginDefaults(pluginRoot);
  const roleNames = new Set(Object.keys(defaults.roles));
  const u = sanitize(user, roleNames);
  const p = sanitize(project, roleNames);
  const reasons = [...u.reasons.map((r) => `user ${r}`), ...p.reasons.map((r) => `project ${r}`)];
  if (reasons.length === 0) reasons.push(...nameClashes(resolveRoles(defaults, u.clean, p.clean)));
  return reasons;
}

// Returns why the layer file can't be written over (invalid JSON, too large), or null.
export function layerFileProblem(level, { home, cwd } = {}) {
  try {
    readConfig(layerPath(level, { home, cwd }));
    return null;
  } catch (error) {
    if (error instanceof Refusal) return error.message;
    throw error;
  }
}

// `other` is the other level's layer to check names against; it defaults to the stored one.
export function writeLayer(level, layer, { home, cwd, pluginRoot = DEFAULT_PLUGIN_ROOT, other } = {}) {
  const file = layerPath(level, { home, cwd });
  const defaults = pluginDefaults(pluginRoot);
  const roleNames = new Set(Object.keys(defaults.roles));
  const { clean, reasons } = sanitize(layer, roleNames);
  if (reasons.length) throw new Refusal(reasons.join('; '));
  if (other === undefined) other = loadLayer(level === 'user' ? 'project' : 'user', { home, cwd }, roleNames).layer;
  else other = sanitize(other, roleNames).clean;
  const roles = level === 'user' ? resolveRoles(defaults, clean, other) : resolveRoles(defaults, other, clean);
  const clashes = nameClashes(roles);
  if (clashes.length) throw new Refusal(clashes.join('; '));
  if (level === 'project') {
    let isDir = false;
    try {
      isDir = fs.statSync(path.dirname(file)).isDirectory();
    } catch {}
    if (!isDir) throw new Refusal('no .company/ folder');
  }
  const data = readConfig(file);
  data[KEY] = clean;
  writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
}

function lookup(value, dotted) {
  let at = value;
  for (const part of dotted.split('.')) {
    if (at === null || typeof at !== 'object' || !Object.hasOwn(at, part)) return undefined;
    at = at[part];
  }
  return at;
}

// Returns { code, out }, or { code: 0, serve: { open } } for the CLI to start the server.
export function run(args, { home, cwd, pluginRoot = DEFAULT_PLUGIN_ROOT } = {}) {
  try {
    const [command, ...rest] = args;
    if (command === 'get' && rest.length <= 1) {
      const resolved = resolveSettings({ home, cwd, pluginRoot });
      for (const w of resolved.warnings) process.stderr.write(`warning: ${w}\n`);
      if (rest.length === 0) return { code: 0, out: JSON.stringify(resolved) };
      const value = lookup(resolved, rest[0]);
      if (value === undefined) {
        const shown = /^[\w.-]{1,100}$/.test(rest[0]) ? rest[0] : '<invalid key>';
        throw new Refusal(`no setting ${shown}`);
      }
      return { code: 0, out: typeof value === 'string' ? value : JSON.stringify(value) };
    }
    if (command === 'serve' && (rest.length === 0 || (rest.length === 1 && rest[0] === '--no-open'))) {
      return { code: 0, serve: { open: rest.length === 0 } };
    }
    throw new Refusal(USAGE);
  } catch (error) {
    if (error instanceof Refusal) return { code: 2, out: `refused: ${error.message}` };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, out, serve } = run(process.argv.slice(2));
  if (serve) {
    // Not a top-level await: settings-server.mjs imports this module, which must finish evaluating first.
    import('./settings-server.mjs').then(({ startServer }) => startServer({ open: serve.open })).catch((error) => {
      process.stderr.write(`aico settings: ${error.message}\n`);
      process.exitCode = 1;
    });
  } else {
    process.stdout.write(`${out}\n`);
    process.exitCode = code;
  }
}
