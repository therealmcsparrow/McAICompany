#!/usr/bin/env node
// Resolves and stores aico settings (aico-settings v1): per-Role name, model and effort,
// pipeline behaviour and Gates. Precedence per field: project > user > plugin.
// User layer: <home>/config.json key aico_settings. Project layer: .company/settings.json key aico_settings.
// Unlocks count only from the user layer.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NAME_RE, PERSONALITY_KEYS, personalityProblem } from './check.mjs';
import { headerEnd, resolve as resolveLanguage, validate as validateLanguage } from './language.mjs';
import { eligibleRoles, readBaseline, readCatalog, selectable } from './skill-catalog.mjs';

export const MODELS = ['opus', 'sonnet', 'haiku', 'fable', 'inherit'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const LANES = ['security', 'compliance', 'legal', 'persona', 'hands_on', 'accessibility'];
export const GATES = ['brief', 'plan', 'ship', 'installs'];
export const LOCKABLE = ['ship', 'security', 'installs'];
export const CONTEXT_CAP_MIN = 60000;
export const CONTEXT_CAP_MAX = 1000000;
// The fixed cap every dispatch carries. Stored `context_cap` values are still validated but never read.
export const CONTEXT_CAP_DEFAULT = 95000;
export const DEBATES = ['crossfire', 'full_pass'];
export const REVIEW_FORMATS = ['plain', 'pilot'];
export const SECOND_REVIEWER_MODELS = ['default', 'opus', 'sonnet', 'haiku', 'fable'];
export const PIPELINE_DEFAULTS = {
  fix_rounds: 2,
  dispatch: 'parallel',
  parallel_cap: 4,
  short_path: 'on',
  second_reviewer: 'off',
  second_reviewer_model: 'default',
  worktrees: 'off',
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
export const REPROMPT_DEFAULTS = { question_rounds: 1 };
export const PLAN_CHECK_POLICIES = ['off', 'warn', 'block'];
export const PLAN_CHECK_RUNS_MIN = 3;
export const PLAN_CHECK_RUNS_MAX = 50;
export const PLAN_CHECK_DEFAULTS = { policy: 'warn', runs: 5 };

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
const MAX_SKILLS = 5;
const MAX_SKILL_NAME = 130;
const SKILL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOT_SELECTABLE = 'not selectable for this Role';
const PROJECT_PROTECTED = 'a project cannot set this for a protected Role';
const USAGE = 'usage: settings.mjs get [key] | serve [--no-open] | model-env';
const FLOOR_FILE_MAX = 16 * 1024;
const FLOOR_FAILED = 'model floor: company/model-floor.json unreadable, every Role held at opus';
const LOCK_ECHO = ['haiku', 'sonnet', 'fable'];
const VERSION_TIMEOUT_MS = 5000;
const VAR_SHOWN_RE = /^[A-Za-z0-9._:[\]-]{1,64}$/;
export const MODEL_RANK = Object.freeze({ haiku: 1, sonnet: 2, opus: 3 });
export const PROTECTED_ROLES = Object.freeze(['architect', 'code-reviewer', 'fresh-reviewer', 'pentester', 'security', 'vuln-scanner']);
const sameRoles = (list, want) => list.length === want.length && want.every((r) => list.includes(r));
const rankOf = (m) => (typeof m === 'string' && Object.hasOwn(MODEL_RANK, m) ? MODEL_RANK[m] : 0);
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
  return { roles, pipeline: structuredClone(PIPELINE_DEFAULTS), gates: { ...GATE_DEFAULTS }, brainstorm: { ...BRAINSTORM_DEFAULTS }, mods: structuredClone(MODS_DEFAULTS), skillspector: { ...SKILLSPECTOR_DEFAULTS }, reprompt: { ...REPROMPT_DEFAULTS }, plan_check: { ...PLAN_CHECK_DEFAULTS } };
}

// company/model-floor.json (aico-settings v1.6). Unreadable or invalid fails closed: every Role protected at opus.
export function loadModelFloor(pluginRoot = DEFAULT_PLUGIN_ROOT) {
  const roles = pluginDefaults(pluginRoot).roles;
  const names = Object.keys(roles);
  const failed = () => ({
    release: null,
    floor: Object.fromEntries(names.map((r) => [r, 'opus'])),
    protected: [...names],
    downgraded: [],
    warnings: [FLOOR_FAILED]
  });
  let data;
  try {
    const file = path.join(pluginRoot, 'company', 'model-floor.json');
    if (fs.statSync(file).size > FLOOR_FILE_MAX) return failed();
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return failed();
  }
  const keys = isObject(data) ? Object.keys(data) : [];
  if (keys.length !== 4 || !['v', 'release', 'floor', 'protected'].every((k) => keys.includes(k))) return failed();
  if (!isObject(data) || data.v !== 1 || typeof data.release !== 'string' || !/^\d+\.\d+\.\d+$/.test(data.release)) return failed();
  if (!isObject(data.floor) || !Array.isArray(data.protected) || !sameRoles(data.protected, PROTECTED_ROLES)) return failed();
  const floor = Object.create(null);
  for (const role of names) {
    if (!Object.hasOwn(data.floor, role) || !rankOf(data.floor[role])) return failed();
    floor[role] = data.floor[role];
  }
  const protectedRoles = names.filter((r) => data.protected.includes(r));
  const downgraded = names.filter((r) => rankOf(roles[r].model) < rankOf(floor[r]));
  return { release: data.release, floor: { ...floor }, protected: protectedRoles, downgraded, warnings: [] };
}

// Protected Roles never run below their floor: a lower stored model is not applied (aico-settings v1.6).
function applyFloor(roles, table, warnings) {
  const guarded = new Set(table.protected);
  for (const [role, entry] of Object.entries(roles)) {
    entry.floor = table.floor[role];
    entry.protected = guarded.has(role);
    if (!entry.protected || entry.model === 'inherit' || rankOf(entry.model) >= rankOf(entry.floor)) continue;
    if (table.release !== null) {
      const shown = LOCK_ECHO.includes(entry.model) ? entry.model : '(other)';
      warnings.push(`roles.${role}.model: ${shown} is below the protected floor ${entry.floor}, not applied`);
    }
    entry.model = entry.floor;
    entry.source.model = 'floor';
  }
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
  parallel_cap: { ok: (v) => Number.isInteger(v) && v >= 3 && v <= 5, msg: 'pipeline.parallel_cap must be a whole number from 3 to 5' },
  short_path: { ok: (v) => v === 'on' || v === 'off', msg: 'pipeline.short_path must be on or off' },
  context_cap: CONTEXT_CAP,
  review_format: { ok: (v) => REVIEW_FORMATS.includes(v), msg: `pipeline.review_format must be ${REVIEW_FORMATS.join(' or ')}` },
  second_reviewer: { ok: (v) => v === 'on' || v === 'off', msg: 'pipeline.second_reviewer must be off or on' },
  worktrees: { ok: (v) => v === 'on' || v === 'off', msg: 'pipeline.worktrees must be off or on' }
};

// The second reviewer's model counts only when it is `default` or ranked at or above the floor (fable is unranked).
const secondReviewerModelRule = (floor) => ({
  ok: (v) => v === 'default' || (typeof v === 'string' && SECOND_REVIEWER_MODELS.includes(v) && rankOf(v) > 0 && rankOf(v) >= rankOf(floor)),
  msg: `pipeline.second_reviewer_model must be default or a model at or above the code-reviewer floor (${floor})`
});
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
const REPROMPT_RULES = {
  question_rounds: { ok: (v) => Number.isInteger(v) && v >= 0 && v <= 3, msg: 'reprompt.question_rounds must be a whole number from 0 to 3' }
};
const PLAN_CHECK_RULES = {
  policy: { ok: (v) => PLAN_CHECK_POLICIES.includes(v), msg: `plan_check.policy must be ${PLAN_CHECK_POLICIES.slice(0, -1).join(', ')} or ${PLAN_CHECK_POLICIES.at(-1)}` },
  runs: {
    ok: (v) => Number.isInteger(v) && v >= PLAN_CHECK_RUNS_MIN && v <= PLAN_CHECK_RUNS_MAX,
    msg: `plan_check.runs must be a whole number from ${PLAN_CHECK_RUNS_MIN} to ${PLAN_CHECK_RUNS_MAX}`
  }
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


const todayUtc = () => new Date().toISOString().slice(0, 10);

// A real calendar date, not after today, as the server clock sees it.
function realDate(v) {
  if (typeof v !== 'string' || !SKILL_DATE_RE.test(v)) return false;
  const at = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === v && v <= todayUtc();
}

// Checks the shape of a stored skills list: a list of at most 5 objects holding only name and approved.
// Mirrors: JSON.parse output that is later used as a lookup key into the skill catalog, never as a path or a command.
// Threats covered: wrong types, over-long lists and names, unknown keys, prototype keys, unreal or future dates.
// A reason names the field, never the stored value. An invalid date is dropped, which leaves the entry without one.
function sanitizeSkills(value, at, reasons) {
  if (!Array.isArray(value)) { reasons.push(`${at}: must be a list`); return undefined; }
  if (value.length > MAX_SKILLS) { reasons.push(`${at}: must be at most ${MAX_SKILLS} skills`); return undefined; }
  const out = [];
  for (const item of value) {
    if (!isObject(item)) { reasons.push(`${at}: each entry must be an object`); return undefined; }
    if (Object.keys(item).some((k) => k !== 'name' && k !== 'approved')) { reasons.push(`${at}: an entry has an unknown key`); return undefined; }
    if (!Object.hasOwn(item, 'name') || typeof item.name !== 'string' || item.name.length < 1 || item.name.length > MAX_SKILL_NAME) {
      reasons.push(`${at}: each entry needs a name of 1 to ${MAX_SKILL_NAME} characters`);
      return undefined;
    }
    const entry = { name: item.name };
    if (Object.hasOwn(item, 'approved') && realDate(item.approved)) entry.approved = item.approved;
    out.push(entry);
  }
  return out;
}

// A wrong-shape skills list warns as `roles.<role>.skills: ignored, <reason>`; any other stored field keeps the file prefix.
const storedWarning = (file) => (r) => {
  const m = /^(roles\.[^.\s]+\.skills): (.*)$/s.exec(r);
  return m ? `${m[1]}: ignored, ${m[2]}` : `${file}: ignoring ${r}`;
};

const sameFolder = (a, b) => {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

// True when the settings folder is not <os.userInfo().homedir>/.mcsparrow, or the user home cannot be read.
// os.homedir() follows HOME and USERPROFILE, which a repo's own settings can set, so it is not trusted here.
// An explicit `home` option is the test seam and counts as the user's own folder.
function settingsFolderMoved(home) {
  if (typeof home === 'string' && home !== '') return false;
  try {
    const mine = os.userInfo().homedir;
    if (typeof mine !== 'string' || mine === '') return true;
    return !sameFolder(homeDir(), path.join(mine, '.mcsparrow'));
  } catch {
    return true;
  }
}

// The catalog as a lookup by name plus the category table, or null when it cannot be read.
function skillCatalog(home) {
  try {
    const { entries, errors } = readCatalog({ home });
    return { byName: new Map(entries.map((e) => [e.skillname, e])), categories: readBaseline().categories, listProblem: errors.length > 0 };
  } catch {
    return null;
  }
}

// The catalog entry a stored name stands for, when this Role may select it; else null.
function selectableEntry(catalog, role, name) {
  if (catalog === null || typeof name !== 'string') return null;
  const entry = catalog.byName.get(name);
  if (entry === undefined || !selectable(entry).ok) return null;
  return eligibleRoles(entry, catalog.categories).includes(role) ? entry : null;
}

const skillPath = (role, n) => `roles.${role}.skills[${n}].name: ${NOT_SELECTABLE}`;

// The stored list resolved against the catalog: the catalog's own names, repeats and unselectable names dropped.
function resolveList(list, role, catalog, ignored) {
  const seen = new Set();
  const out = [];
  list.forEach((item, n) => {
    const entry = selectableEntry(catalog, role, item.name);
    if (entry === null || seen.has(entry.skillname)) {
      const line = skillPath(role, n);
      if (!ignored.includes(line)) ignored.push(line);
      return;
    }
    seen.add(entry.skillname);
    out.push({ name: entry.skillname, approved: item.approved ?? null });
  });
  return out;
}

// Sets skills and source.skills on every resolved Role: project list, else user list, else none.
function applySkills(roles, user, project, { home, moved, ignored, warnings }) {
  const stored = (layer, role) => own(own(layer.roles, role), 'skills');
  const roleList = Object.keys(roles);
  const any = roleList.some((r) => [stored(user, r), stored(project, r)].some((l) => Array.isArray(l) && l.length > 0));
  const catalog = any ? skillCatalog(home) : null;
  if (any && catalog === null) warnings.push('role skills: the catalog cannot be read, stored names are ignored');
  if (moved && roleList.some((r) => stored(user, r) !== undefined)) warnings.push('role skills: the settings folder is not the user home, the user level is not counted');
  for (const role of roleList) {
    const userList = moved ? undefined : stored(user, role);
    const projectList = stored(project, role);
    let skills = [];
    let source = 'plugin';
    const fromUser = () => {
      if (userList === undefined) return;
      skills = resolveList(userList, role, catalog, ignored);
      source = 'user';
    };
    if (projectList === undefined) fromUser();
    else if (roles[role].protected) {
      ignored.push(`roles.${role}.skills: ${PROJECT_PROTECTED}`);
      fromUser();
    } else if (projectList.length === 0) {
      source = 'project';
    } else {
      const resolved = resolveList(projectList, role, catalog, ignored);
      if (resolved.length > 0) { skills = resolved; source = 'project'; } else fromUser();
    }
    roles[role].skills = skills;
    roles[role].source.skills = source;
  }
}

// True when the user layer's skills cannot be read against the catalog: the settings folder is moved, the
// catalog cannot be read, or the user catalog reports a problem. A list that repeats the stored names exactly,
// at either level, is then taken back as it stands.
function userUnread(home) {
  if (settingsFolderMoved(home)) return true;
  const catalog = skillCatalog(home);
  return catalog === null || catalog.listProblem;
}

const sameStoredNames = (before, names) => {
  const old = Array.isArray(before) ? before.map((e) => e.name) : [];
  return old.length === names.length && old.every((n, i) => n === names[i]);
};

// Reasons a layer's skills lists cannot be stored. Names the field, never the value.
function skillProblems(level, layer, { home, pluginRoot, stored }) {
  const lists = Object.entries(layer.roles ?? {}).filter(([, f]) => Array.isArray(f.skills));
  if (lists.length === 0) return [];
  const guarded = new Set(loadModelFloor(pluginRoot).protected);
  const reasons = [];
  let catalog;
  let unread;
  for (const [role, { skills }] of lists) {
    if (level === 'project' && guarded.has(role)) { reasons.push(`roles.${role}.skills: ${PROJECT_PROTECTED}`); continue; }
    if (skills.length === 0) continue;
    if (stored !== undefined) {
      unread ??= userUnread(home);
      if (unread && sameStoredNames(own(own(stored.roles, role), 'skills'), skills.map((e) => e.name))) continue;
    }
    catalog ??= skillCatalog(home);
    const seen = new Set();
    skills.forEach((item, n) => {
      const entry = selectableEntry(catalog, role, item.name);
      if (entry === null || seen.has(entry.skillname)) reasons.push(skillPath(role, n));
      else seen.add(entry.skillname);
    });
  }
  return reasons;
}

// True when a Role's new list of names differs from the stored names that are still selectable for it. A stored
// name the catalog no longer offers does not count, so dropping it is not a change.
function skillsChanged(before, names, role, catalogOf) {
  const old = Array.isArray(before) ? before : [];
  const keptAll = old.length === 0 ? [] : old.filter((e) => selectableEntry(catalogOf(), role, e.name) !== null).map((e) => e.name);
  const kept = [...new Set(keptAll)];
  return kept.length !== names.length || names.some((n) => !kept.includes(n));
}

// The server clock dates a pick. A Role whose list gained or lost a name gets today on every selection;
// an unchanged Role keeps the dates already stored. A date from the caller is never used.
function stampApproved(layer, stored, { home }) {
  let catalog;
  let unread;
  const catalogOf = () => (catalog === undefined ? (catalog = skillCatalog(home)) : catalog);
  for (const [role, fields] of Object.entries(layer.roles ?? {})) {
    if (!Array.isArray(fields.skills)) continue;
    const before = own(own(stored.roles, role), 'skills');
    const had = new Map((before ?? []).map((e) => [e.name, e.approved]));
    const names = [...new Set(fields.skills.map((e) => e.name))];
    const sent = fields.skills.map((e) => e.name);
    if (sameStoredNames(before, sent)) unread ??= userUnread(home);
    const changed = unread === true && sameStoredNames(before, sent) ? false : skillsChanged(before, names, role, catalogOf);
    fields.skills = fields.skills.map(({ name }) => {
      const date = changed ? todayUtc() : had.get(name);
      return date === undefined ? { name } : { name, approved: date };
    });
  }
}

// While the settings folder is not the user home, a user-level skills list may not change: the user level is
// not counted there. Names the field only.
function movedSkillProblems(clean, stored, home) {
  let catalog;
  const catalogOf = () => (catalog === undefined ? (catalog = skillCatalog(home)) : catalog);
  const roles = new Set([...Object.keys(clean.roles ?? {}), ...Object.keys(stored.roles ?? {})]);
  const reasons = [];
  for (const role of roles) {
    const next = own(own(clean.roles, role), 'skills');
    const before = own(own(stored.roles, role), 'skills');
    if (next === undefined && !(Array.isArray(before) && before.length > 0)) continue;
    const names = [...new Set((next ?? []).map((e) => e.name))];
    if (sameStoredNames(before, (next ?? []).map((e) => e.name))) continue;
    if (skillsChanged(before, names, role, catalogOf)) reasons.push(`roles.${role}.skills: the settings folder is not the user home, the user list cannot change here`);
  }
  return reasons;
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
function sanitize(layer, roleNames, floor = 'opus') {
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
        const fields = checkFields(value[role], ROLE_RULES, `roles.${role}`, reasons, ['personality', 'skills']);
        if (Object.hasOwn(value[role], 'skills')) {
          const skills = sanitizeSkills(value[role].skills, `roles.${role}.skills`, reasons);
          if (skills !== undefined) fields.skills = skills;
        }
        if (Object.hasOwn(value[role], 'personality')) {
          const personality = sanitizePersonality(value[role].personality, `roles.${role}.personality`, reasons);
          if (notEmpty(personality)) fields.personality = personality;
        }
        if (notEmpty(fields)) roles[role] = fields;
      }
      if (notEmpty(roles)) clean.roles = roles;
    } else if (key === 'pipeline') {
      if (!isObject(value)) { reasons.push('pipeline: must be an object'); continue; }
      const pipeline = checkFields(value, { ...PIPELINE_RULES, second_reviewer_model: secondReviewerModelRule(floor) }, 'pipeline', reasons, ['lanes']);
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
    } else if (key === 'reprompt') {
      if (!isObject(value)) { reasons.push('reprompt: must be an object'); continue; }
      const reprompt = Object.assign(Object.create(null), checkFields(value, REPROMPT_RULES, 'reprompt', reasons));
      if (notEmpty(reprompt)) clean.reprompt = reprompt;
    } else if (key === 'plan_check') {
      if (!isObject(value)) { reasons.push('plan_check: must be an object'); continue; }
      const planCheck = Object.create(null);
      for (const k of Object.keys(value)) {
        if (!Object.hasOwn(PLAN_CHECK_RULES, k)) reasons.push(`plan_check.${/^[a-z_]{1,20}$/.test(k) ? k : '?'}: unknown key`);
        else if (!PLAN_CHECK_RULES[k].ok(value[k])) reasons.push(PLAN_CHECK_RULES[k].msg);
        else planCheck[k] = value[k];
      }
      if (notEmpty(planCheck)) clean.plan_check = planCheck;
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

export function validateLayer(layer, roleNames, floor = 'opus') {
  return sanitize(layer, roleNames, floor).reasons;
}

// Reads one layer file. Returns { raw, layer, warnings }; raw feeds the revision hash.
function loadLayer(level, ctx, roleNames, floor = 'opus') {
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
  const { clean, reasons } = sanitize(data[KEY], roleNames, floor);
  return { raw: bytes, layer: clean, warnings: reasons.map(storedWarning(file)), reasons };
}

// The code-reviewer floor from the model floor file; an unreadable file gives opus.
function reviewerFloor(pluginRoot) {
  const f = loadModelFloor(pluginRoot).floor['code-reviewer'];
  return rankOf(f) > 0 ? f : 'opus';
}

const roleNamesOf = (pluginRoot) => new Set(Object.keys(pluginDefaults(pluginRoot).roles));

export function readLayer(level, { home, cwd, pluginRoot = DEFAULT_PLUGIN_ROOT } = {}) {
  const { layer, warnings } = loadLayer(level, { home, cwd }, roleNamesOf(pluginRoot), reviewerFloor(pluginRoot));
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
    // Deprecated key: stored values are validated elsewhere and have no effect.
    [entry.context_cap, source.context_cap] = [CONTEXT_CAP_DEFAULT, 'plugin'];
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

// Controls, every format character (zero-width, bidi, tag characters, U+2065), line and paragraph separators,
// Mongolian vowel separator and U+2065 named so a Unicode table that drops them cannot reopen the hole.
const PROFILE_BAD_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}᠎⁥\u{E0000}-\u{E007F}]/u;

// Returns a reason string when `value` is not acceptable for `field`, else null.
function profileProblem(field, value, options) {
  if (typeof value !== 'string' || value.trim() === '') return 'must be text';
  if (!value.isWellFormed()) return 'must be well-formed text';
  if (PROFILE_BAD_RE.test(value)) return 'must be one line without control, invisible or direction characters';
  if (value.includes('<!--') || value.includes('-->')) return 'must not contain comment marks';
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

function canonicalLanguages(value) {
  return value.split(',').map((tag) => tag.replace(tag.trim(), Intl.getCanonicalLocales(tag.trim())[0])).join(',');
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
    else {
      if (field === 'languages') changes = { ...changes, languages: canonicalLanguages(changes.languages) };
      edits.push(field);
    }
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

// Off wins: a user or project off, or a project layer with any problem, gives off. A project on never overrides a user off.
function resolvePlanPolicy(user, project, ignored) {
  const u = Object.hasOwn(user.plan_check ?? {}, 'policy') ? user.plan_check.policy : undefined;
  const p = Object.hasOwn(project.plan_check ?? {}, 'policy') ? project.plan_check.policy : undefined;
  if (u === 'block') {
    if (p !== undefined && p !== 'block') ignored.push('plan_check.policy: a project cannot lower a user block');
    return 'block';
  }
  return pick(p, u, PLAN_CHECK_DEFAULTS.policy)[0];
}

// Pipeline keys that count only from the user level; a project value is ignored and listed.
function userOnly(user, project, key, ignored) {
  if (Object.hasOwn(project.pipeline ?? {}, key)) ignored.push(`pipeline.${key}: set it at the user level`);
  return Object.hasOwn(user.pipeline ?? {}, key) ? user.pipeline[key] : PIPELINE_DEFAULTS[key];
}

// `default` follows the fresh-reviewer's resolved model, never below the code-reviewer floor; an unreadable floor file gives opus.
function effectiveReviewerModel(setting, resolved, table) {
  if (setting !== 'default') return setting;
  if (table.release === null) return 'opus';
  const floor = rankOf(table.floor['code-reviewer']) > 0 ? table.floor['code-reviewer'] : 'opus';
  return rankOf(resolved) >= rankOf(floor) && rankOf(resolved) > 0 ? resolved : floor;
}

function resolveShortPath(user, project, broken, ignored) {
  const u = user.pipeline?.short_path;
  const p = project.pipeline?.short_path;
  if (u === 'off' && p === 'on') ignored.push('pipeline.short_path: a project can only turn the short path off');
  if (broken || u === 'off' || p === 'off') return 'off';
  return PIPELINE_DEFAULTS.short_path;
}

export function resolveSettings({ home, cwd, pluginRoot = DEFAULT_PLUGIN_ROOT } = {}) {
  const defaults = pluginDefaults(pluginRoot);
  const roleNames = new Set(Object.keys(defaults.roles));
  const floorName = reviewerFloor(pluginRoot);
  const u = loadLayer('user', { home, cwd }, roleNames, floorName);
  const p = loadLayer('project', { home, cwd }, roleNames, floorName);
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
  const table = loadModelFloor(pluginRoot);
  warnings.push(...table.warnings);
  applyFloor(roles, table, warnings);
  const moved = settingsFolderMoved(home);
  applySkills(roles, user, project, { home, moved, ignored, warnings });
  warnings.push(...nameClashes(roles));

  const pipeline = {
    fix_rounds: pick(project.pipeline?.fix_rounds, user.pipeline?.fix_rounds, PIPELINE_DEFAULTS.fix_rounds)[0],
    dispatch: pick(project.pipeline?.dispatch, user.pipeline?.dispatch, PIPELINE_DEFAULTS.dispatch)[0],
    parallel_cap: pick(project.pipeline?.parallel_cap, user.pipeline?.parallel_cap, PIPELINE_DEFAULTS.parallel_cap)[0],
    short_path: resolveShortPath(user, project, p.warnings.length > 0, ignored),
    second_reviewer: userOnly(user, project, 'second_reviewer', ignored),
    second_reviewer_model: userOnly(user, project, 'second_reviewer_model', ignored),
    second_reviewer_model_effective: null,
    worktrees: userOnly(user, project, 'worktrees', ignored),
    context_cap: CONTEXT_CAP_DEFAULT,
    review_format: pick(project.pipeline?.review_format, user.pipeline?.review_format, PIPELINE_DEFAULTS.review_format)[0],
    lanes: {}
  };
  pipeline.second_reviewer_model_effective = effectiveReviewerModel(pipeline.second_reviewer_model, roles['fresh-reviewer']?.model, table);
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

  // Not a lock: a project value counts, and a fail-closed project layer does not change it.
  const reprompt = { question_rounds: pick(project.reprompt?.question_rounds, user.reprompt?.question_rounds, REPROMPT_DEFAULTS.question_rounds)[0] };

  // Block wins: a project value counts, except that it never lowers a user block. A fail-closed project layer
  // is an empty layer, so it never lowers one either.
  const plan_check = {
    policy: resolvePlanPolicy(user, project, ignored),
    runs: pick(project.plan_check?.runs, user.plan_check?.runs, PLAN_CHECK_DEFAULTS.runs)[0]
  };

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
  return { revision, roles, pipeline, gates, brainstorm, mods, skillspector, reprompt, plan_check, unlocked: [...unlocked], settings_folder_moved: moved, ignored, warnings, language, profile };
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

// Checks a user and a project layer together, as they would be stored. Returns all reasons. Skills lists are
// checked only for the levels named in `levels` (default both): a stale list in the level not being saved stays.
export function checkLayers(user, project, { pluginRoot = DEFAULT_PLUGIN_ROOT, home, cwd, levels = ['user', 'project'] } = {}) {
  const defaults = pluginDefaults(pluginRoot);
  const roleNames = new Set(Object.keys(defaults.roles));
  const floorName = reviewerFloor(pluginRoot);
  const u = sanitize(user, roleNames, floorName);
  const p = sanitize(project, roleNames, floorName);
  const reasons = [...u.reasons.map((r) => `user ${r}`), ...p.reasons.map((r) => `project ${r}`)];
  if (reasons.length === 0) {
    if (levels.includes('user')) {
      const stored = loadLayer('user', { home }, roleNames, floorName).layer;
      const movedReasons = settingsFolderMoved(home) ? movedSkillProblems(u.clean, stored, home) : [];
      const found = movedReasons.length > 0 ? movedReasons : skillProblems('user', u.clean, { home, pluginRoot, stored });
      reasons.push(...found.map((r) => `user ${r}`));
    }
    if (levels.includes('project')) {
      const stored = typeof cwd === 'string' ? loadLayer('project', { home, cwd }, roleNames, floorName).layer : undefined;
      reasons.push(...skillProblems('project', p.clean, { home, pluginRoot, stored }).map((r) => `project ${r}`));
    }
  }
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
  const floorName = reviewerFloor(pluginRoot);
  const { clean, reasons } = sanitize(layer, roleNames, floorName);
  if (reasons.length) throw new Refusal(reasons.join('; '));
  const storedLayer = loadLayer(level, { home, cwd }, roleNames, floorName).layer;
  if (level === 'user' && settingsFolderMoved(home)) {
    const moved = movedSkillProblems(clean, storedLayer, home);
    if (moved.length) throw new Refusal(moved.join('; '));
  }
  const skillReasons = skillProblems(level, clean, { home, pluginRoot, stored: storedLayer });
  if (skillReasons.length) throw new Refusal(skillReasons.join('; '));
  stampApproved(clean, storedLayer, { home });
  if (other === undefined) other = loadLayer(level === 'user' ? 'project' : 'user', { home, cwd }, roleNames, floorName).layer;
  else other = sanitize(other, roleNames, floorName).clean;
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

const parseVersion = (text) => {
  const m = /(?<!\d)(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?!\d)/.exec(String(text).slice(0, 256));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const atLeast = (v, min) => {
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
  return true;
};

const samePlace = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const realOf = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const insideOrSame = (dir, root) => {
  if (samePlace(dir, root)) return true;
  const rel = path.relative(root, dir);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
};
// Windows: only a plain drive-letter path is read; device (\\?\, \\.\), UNC and every other spelling are refused.
const WIN_DRIVE_RE = /^[A-Za-z]:\\/;

// The absolute path of `claude` found by walking PATH here, or null. Empty, relative, and current-folder or
// product-folder entries are skipped, so a program planted in a cloned repo is never found.
export function resolveClaude({ env = process.env, cwd = process.cwd(), productRoot = cwd } = {}) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path');
  const list = key ? String(env[key] ?? '') : '';
  const blocked = [realOf(cwd), realOf(productRoot)];
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  for (const entry of list.split(path.delimiter)) {
    if (!entry || !path.isAbsolute(entry)) continue;
    if (process.platform === 'win32' && !WIN_DRIVE_RE.test(entry)) continue;
    const dir = realOf(entry);
    if (blocked.some((root) => insideOrSame(dir, root))) continue;
    const file = path.join(dir, name);
    try {
      if (!fs.statSync(file).isFile()) continue;
      if (process.platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {}
  }
  return null;
}

// What each source says about the Claude Code version: { agent, cli }, each [major, minor, patch] or null.
// `agent` reads AI_AGENT (no process); `cli` runs the resolved absolute claude with --version from the temp
// folder (no shell, 5 s limit, small output cap).
export function readClaudeSources({ env = process.env, exec = execFileSync, cwd = process.cwd(), productRoot = cwd } = {}) {
  const m = /^claude-code_(\d{1,4})-(\d{1,4})-(\d{1,4})(?:_|$)/.exec(String(env.AI_AGENT ?? '').slice(0, 128));
  const agent = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  let cli = null;
  const bin = resolveClaude({ env, cwd, productRoot });
  if (bin) {
    try {
      cli = parseVersion(exec(bin, ['--version'], { encoding: 'utf8', cwd: os.tmpdir(), timeout: VERSION_TIMEOUT_MS, maxBuffer: 4096, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch {}
  }
  return { agent, cli };
}

const lowerOf = ({ agent, cli }) => (agent && cli ? (atLeast(agent, cli) ? cli : agent) : agent ?? cli);

// The running Claude Code version as [major, minor, patch], or null. When both sources answer and differ the lower one wins.
export function readClaudeVersion(options = {}) {
  return lowerOf(readClaudeSources(options));
}

const sameVersion = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

// The `model-env` line, or '' when neither variable is set (aico-settings v1.6). Besides the two named variables it reads AI_AGENT and PATH (through `readSources`).
// `readVersion` (one version) counts as confirmed by both sources; `readSources` gives each source separately.
export function modelEnvLine({ env = process.env, readVersion, readSources = () => readClaudeSources({ env }) } = {}) {
  const raw = env.CLAUDE_CODE_SUBAGENT_MODEL ?? '';
  const rawForce = env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE ?? '';
  const set = raw !== '' && raw !== 'inherit';
  const force = rawForce !== '' && rawForce !== '0';
  if (!set && !force) return '';
  const shown = (v) => (v === '' ? 'unset' : VAR_SHOWN_RE.test(v) ? v : '(hidden)');
  let version;
  let confirmed;
  if (readVersion) { version = readVersion(); confirmed = !!version; }
  else {
    const sources = readSources();
    version = lowerOf(sources);
    confirmed = !!(sources.agent && sources.cli && sameVersion(sources.agent, sources.cli));
  }
  let effect;
  let kept = false;
  let unconfirmed = false;
  if (!version) effect = "version unknown, may override every Role's model";
  else if (!atLeast(version, [2, 1, 251]) && set) effect = "overrides every Role's model, the Agent model included";
  else if (force && atLeast(version, [2, 1, 257])) effect = set ? `forces ${shown(raw)} on every Role` : "forces the main conversation's model on every Role";
  else if (force && !confirmed) { effect = "version not confirmed by both sources, FORCE may force a model on every Role"; unconfirmed = true; }
  else if (set) { effect = 'a default only; every aico Role sets model in its frontmatter, so no Role changes'; kept = true; }
  else { effect = 'FORCE needs Claude Code 2.1.257; no Role changes'; kept = true; }
  const ver = version && !unconfirmed ? version.join('.') : 'unknown';
  return `model env: CLAUDE_CODE_SUBAGENT_MODEL=${shown(raw)} CLAUDE_CODE_SUBAGENT_MODEL_FORCE=${shown(rawForce)}, Claude Code ${ver}: ${effect}; floor ${kept ? 'kept' : 'bypassed'}`;
}

// Returns { code, out }, or { code: 0, serve: { open } } for the CLI to start the server.
export function run(args, { home, cwd, pluginRoot = DEFAULT_PLUGIN_ROOT, env, readVersion } = {}) {
  try {
    const [command, ...rest] = args;
    if (command === 'model-env' && rest.length === 0) return { code: 0, out: modelEnvLine({ env, readVersion }) };
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
    if (out !== '') process.stdout.write(`${out}\n`);
    process.exitCode = code;
  }
}
