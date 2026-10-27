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
import { NAME_RE, PERSONALITY_KEYS, personalityProblem } from './check.mjs';
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
export const REVIEW_FORMATS = ['plain', 'pilot'];
export const PIPELINE_DEFAULTS = {
  fix_rounds: 2,
  dispatch: 'parallel',
  context_cap: CONTEXT_CAP_DEFAULT,
  review_format: 'plain',
  lanes: { security: true, compliance: true, legal: 'auto', persona: true, hands_on: true, accessibility: true }
};
export const GATE_DEFAULTS = { brief: 'ask', plan: 'ask', ship: 'ask', installs: 'ask' };
export const BRAINSTORM_DEFAULTS = { film_script: false, debate: 'crossfire' };
export const MODS = ['savvy', 'cache_tax', 'reflect', 'blast_radius'];
export const MODS_DEFAULTS = {
  savvy: { enabled: true, pane: 'auto' },
  cache_tax: { enabled: true, pane: 'command' },
  reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' },
  blast_radius: { enabled: true, core: 'ask', contract: 'warn', security: 'ask' }
};
export const SKILLSPECTOR_MODES = ['no-llm', 'claude_cli'];
export const SKILLSPECTOR_DEFAULTS = { mode: 'no-llm' };

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
  return { roles, pipeline: structuredClone(PIPELINE_DEFAULTS), gates: { ...GATE_DEFAULTS }, brainstorm: { ...BRAINSTORM_DEFAULTS }, mods: structuredClone(MODS_DEFAULTS), skillspector: { ...SKILLSPECTOR_DEFAULTS } };
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
  context_cap: CONTEXT_CAP,
  review_format: { ok: (v) => REVIEW_FORMATS.includes(v), msg: `pipeline.review_format must be ${REVIEW_FORMATS.join(' or ')}` }
};
const BRAINSTORM_RULES = {
  film_script: BOOLEAN,
  debate: { ok: (v) => DEBATES.includes(v), msg: `brainstorm.debate must be ${DEBATES.join(' or ')}` }
};
const modBool = (mod, key) => ({ ok: (v) => typeof v === 'boolean', msg: `mods.${mod}.${key} must be true or false` });
const modOneOf = (mod, key, values) => ({ ok: (v) => values.includes(v), msg: `mods.${mod}.${key} must be ${values.join(' or ')}` });
const MOD_RULES = {
  savvy: { enabled: modBool('savvy', 'enabled'), pane: modOneOf('savvy', 'pane', ['auto', 'command']) },
  cache_tax: { enabled: modBool('cache_tax', 'enabled'), pane: modOneOf('cache_tax', 'pane', ['auto', 'command']) },
  reflect: {
    enabled: modBool('reflect', 'enabled'),
    step_check: modBool('reflect', 'step_check'),
    retrospective: modBool('reflect', 'retrospective'),
    mode: modOneOf('reflect', 'mode', ['deterministic', 'model'])
  },
  blast_radius: {
    enabled: modBool('blast_radius', 'enabled'),
    core: modOneOf('blast_radius', 'core', ['ask', 'warn']),
    contract: modOneOf('blast_radius', 'contract', ['ask', 'warn']),
    security: modOneOf('blast_radius', 'security', ['ask', 'warn'])
  }
};
const SKILLSPECTOR_RULES = {
  mode: { ok: (v) => SKILLSPECTOR_MODES.includes(v), msg: `skillspector.mode must be ${SKILLSPECTOR_MODES.join(' or ')}` }
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

// A personality key is shown in a refusal only when it is plainly safe to print.
const personalityLabel = (k) => (/^[a-z_]{1,20}$/.test(k) ? k : '?');

// Path-first reasons that never echo a value. Only the five allowed keys are ever copied into the result.
function sanitizePersonality(value, at, reasons) {
  const clean = {};
  if (!isObject(value)) { reasons.push(`${at}: must be an object`); return clean; }
  for (const key of Object.keys(value)) {
    if (!PERSONALITY_KEYS.includes(key)) { reasons.push(`${at}.${personalityLabel(key)}: unknown key`); continue; }
    const problem = personalityProblem(key, value[key]);
    if (problem) reasons.push(`${at}.${key}: ${problem}`);
    else clean[key] = value[key];
  }
  return clean;
}

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
        const fields = checkFields(value[role], ROLE_RULES, `roles.${role}`, reasons, ['personality']);
        if (Object.hasOwn(value[role], 'personality')) {
          const personality = sanitizePersonality(value[role].personality, `roles.${role}.personality`, reasons);
          if (notEmpty(personality)) fields.personality = personality;
        }
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
    } else if (key === 'mods') {
      if (!isObject(value)) { reasons.push('mods: must be an object'); continue; }
      const mods = Object.create(null);
      for (const mod of Object.keys(value)) {
        if (!Object.hasOwn(MOD_RULES, mod)) { reasons.push(`mods.${label(mod)}: unknown key`); continue; }
        if (!isObject(value[mod])) { reasons.push(`mods.${mod}: must be an object`); continue; }
        const fields = checkFields(value[mod], MOD_RULES[mod], `mods.${mod}`, reasons);
        if (notEmpty(fields)) mods[mod] = fields;
      }
      if (notEmpty(mods)) clean.mods = mods;
    } else if (key === 'skillspector') {
      if (!isObject(value)) { reasons.push('skillspector: must be an object'); continue; }
      const skillspector = Object.assign(Object.create(null), checkFields(value, SKILLSPECTOR_RULES, 'skillspector', reasons));
      if (notEmpty(skillspector)) clean.skillspector = skillspector;
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
    return { raw: refusedRaw(file, error), layer: empty, warnings: [error.message], reasons: [] };
  }
  if (bytes === null) return { raw: '', layer: empty, warnings: [], reasons: [] };
  let data;
  try {
    data = parseConfig(file, bytes);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return { raw: bytes, layer: empty, warnings: [error.message], reasons: [] };
  }
  if (!Object.hasOwn(data, KEY)) return { raw: bytes, layer: empty, warnings: [], reasons: [] };
  const { clean, reasons } = sanitize(data[KEY], roleNames);
  return { raw: bytes, layer: clean, warnings: reasons.map((r) => `${file}: ignoring ${r}`), reasons };
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

const BLAST_CATEGORIES = ['core', 'contract', 'security'];

// Resolves `mods.*`: free keys per field, then the three lock rules (aico-settings v1.1).
function resolveMods(user, project, { isUnlocked, broken, ignored, warnings }) {
  const out = structuredClone(MODS_DEFAULTS);
  const u = (mod, key) => user.mods?.[mod]?.[key];
  const p = (mod, key) => project.mods?.[mod]?.[key];
  for (const mod of ['savvy', 'cache_tax', 'reflect']) {
    for (const key of Object.keys(MODS_DEFAULTS[mod])) {
      if (mod === 'reflect' && key === 'mode') continue;
      out[mod][key] = pick(p(mod, key), u(mod, key), MODS_DEFAULTS[mod][key])[0];
    }
  }
  if (broken) {
    // A broken project layer may have lost a tightening, so the user's loosening does not count.
    const userLoosens = BLAST_CATEGORIES.some((c) => u('blast_radius', c) !== undefined && u('blast_radius', c) !== MODS_DEFAULTS.blast_radius[c])
      || u('blast_radius', 'enabled') === false || u('reflect', 'mode') === 'model';
    if (userLoosens) warnings.push('project settings have problems: mods.blast_radius held at its plugin defaults, mods.reflect.mode held deterministic');
    return out;
  }
  // Lock 1: Reflect model counts only from the user level; a project may only say deterministic.
  out.reflect.mode = u('reflect', 'mode') ?? MODS_DEFAULTS.reflect.mode;
  if (p('reflect', 'mode') === 'model') ignored.push('mods.reflect.mode: model from project counts only from your user settings');
  else if (p('reflect', 'mode') !== undefined) out.reflect.mode = p('reflect', 'mode');
  // Lock 2: a project only tightens Blast Radius. Lock 3: security warn and off need the user unlock.
  const blast = out.blast_radius;
  for (const c of BLAST_CATEGORIES) {
    blast[c] = u('blast_radius', c) ?? MODS_DEFAULTS.blast_radius[c];
    if (p('blast_radius', c) === 'ask') blast[c] = 'ask';
    else if (p('blast_radius', c) === 'warn') ignored.push(`mods.blast_radius.${c}: warn from project can only tighten`);
  }
  if (blast.security === 'warn' && !isUnlocked('security')) {
    blast.security = 'ask';
    ignored.push('mods.blast_radius.security: warn from user needs the user unlock security');
  }
  blast.enabled = u('blast_radius', 'enabled') ?? true;
  if (p('blast_radius', 'enabled') === true) blast.enabled = true;
  else if (p('blast_radius', 'enabled') === false) ignored.push('mods.blast_radius.enabled: off from project can only tighten');
  if (blast.enabled === false && !isUnlocked('security')) {
    blast.enabled = true;
    ignored.push('mods.blast_radius.enabled: off from user needs the user unlock security');
  }
  return out;
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
    review_format: pick(project.pipeline?.review_format, user.pipeline?.review_format, PIPELINE_DEFAULTS.review_format)[0],
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

  // The data switch: claude_cli counts only from the user level; a project may only say no-llm.
  const skillspector = { mode: user.skillspector?.mode ?? SKILLSPECTOR_DEFAULTS.mode };
  if (project.skillspector?.mode === 'claude_cli') ignored.push('skillspector.mode: claude_cli from project needs the user level');
  else if (project.skillspector?.mode !== undefined) skillspector.mode = project.skillspector.mode;

  const mods = resolveMods(user, project, { isUnlocked, broken: p.warnings.length > 0, ignored, warnings });

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
  return { revision, roles, pipeline, gates, brainstorm, mods, skillspector, unlocked: [...unlocked], ignored, warnings, language, profile };
}

const own = (o, k) => (o !== null && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined);
const PERSONALITY_REASON_RE = /^(roles\.[a-z0-9-]+\.personality(?:\.[a-z_?]{1,20})?): (.+)$/;
const DEFAULTS_AT = 'company/personalities.json';
const safeName = (k) => (/^[A-Za-z0-9_-]{1,40}$/.test(k) ? k : '?');

// The plugin's default personalities as { role: { key: value } } for valid entries only. Never throws.
function personalityDefaults(pluginRoot, roleNames, warnings) {
  const out = Object.create(null);
  let data;
  try {
    const bytes = readBounded(path.join(pluginRoot, 'company', 'personalities.json'));
    if (bytes === null) return out;
    data = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    warnings.push(`${DEFAULTS_AT}: ${error instanceof Refusal ? 'cannot be read' : 'is not valid JSON'}`);
    return out;
  }
  if (!isObject(data)) { warnings.push(`${DEFAULTS_AT}: must be an object of role to personality`); return out; }
  for (const role of Object.keys(data)) {
    if (!roleNames.has(role)) { warnings.push(`${DEFAULTS_AT}: ${safeName(role)} is not a Role`); continue; }
    if (!isObject(data[role])) { warnings.push(`${DEFAULTS_AT}: ${role}: must be an object`); continue; }
    const entry = Object.create(null);
    for (const key of Object.keys(data[role])) {
      if (!PERSONALITY_KEYS.includes(key)) { warnings.push(`${DEFAULTS_AT}: ${role}.${safeName(key)}: unknown key`); continue; }
      const problem = personalityProblem(key, data[role][key]);
      if (problem) warnings.push(`${DEFAULTS_AT}: ${role}.${key}: ignored, ${problem}`);
      else entry[key] = data[role][key];
    }
    out[role] = entry;
  }
  return out;
}

// Resolved personality per Role and key (aico-settings v1.3): project, else user, else plugin default.
// Only scripts/personality.mjs and scripts/settings-server.mjs may import this. `ignored` lists the stored
// values that failed their rule, with their level, for the settings page; it never holds a value.
export function resolvePersonalities({ home, cwd, pluginRoot = DEFAULT_PLUGIN_ROOT } = {}) {
  const roleNames = roleNamesOf(pluginRoot);
  const layers = [['user', loadLayer('user', { home, cwd }, roleNames)], ['project', loadLayer('project', { home, cwd }, roleNames)]];
  const warnings = [];
  const ignored = [];
  const defaults = personalityDefaults(pluginRoot, roleNames, warnings);
  for (const [level, loaded] of layers) {
    for (const reason of loaded.reasons) {
      const m = PERSONALITY_REASON_RE.exec(reason);
      if (!m) continue;
      const line = `${m[1]}: ignored, ${m[2]}`;
      if (!warnings.includes(line)) warnings.push(line);
      ignored.push({ level, path: m[1], reason: m[2] });
    }
  }
  const [user, project] = [layers[0][1].layer, layers[1][1].layer];
  const roles = Object.create(null);
  for (const role of roleNames) {
    const entry = Object.create(null);
    for (const key of PERSONALITY_KEYS) {
      const [value, source] = pick(
        own(own(own(project.roles, role), 'personality'), key),
        own(own(own(user.roles, role), 'personality'), key),
        own(defaults[role], key)
      );
      if (value !== undefined) entry[key] = { value, source };
    }
    roles[role] = entry;
  }
  return { roles, warnings, ignored };
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
