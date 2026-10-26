#!/usr/bin/env node
// Installs the standalone skills aico points to (deps/skills.json) that are not installed yet.
// Usage: node install-skills.mjs [group ...] [--project <root>/.company/project.md] [--dry-run | --missing]
//   default group: core. Groups `design` and `skills` need --project. Contract: docs/contracts/skills-manifest.md.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

// The skills CLI pin: one constant, bumped in a change of its own (agentsec.S1).
export const SKILLS_CLI = 'skills@1.7.4';

// Allow-lists (agentsec.M-SEC7, ADR 0005). Every check is a full-match, anchored pattern.
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MANIFEST_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}\*?$/;
const PLUGIN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LICENSE_RE = /^[A-Za-z0-9.+-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LINE_RE = /^- name: ([^;]+); source: ([^;]+); license: ([^;]+); vetted: ([^;]+); why: ([^;]+); approved: ([^;]+)$/;
const WHY_BAD_RE = /[`<>\u0000-\u001f\u007f]/;
const SKILLS_LINE_RE = /^- area: (stack|product-type|company-type); name: ([^;]+); source: ([^;]+); license: ([^;]+); vetted: ([^;]+); why: ([^;]+); approved: ([^;]+)$/;
const MAX_SKILLS_TOTAL = 15;
const PROJECT_GROUPS = ['design', 'skills'];
const DESIGN_SECTION = { heading: '## Design skills', label: 'design skill', none: '- (none yet; the design-researcher proposes them)', re: LINE_RE, areas: false, plugins: true };
const SKILLS_SECTION = { heading: '## Skills', label: 'skills', none: '- (none yet; the skill-researcher proposes them)', re: SKILLS_LINE_RE, areas: true, plugins: false };
const MAX_FILE_BYTES = 256 * 1024;
const MAX_LINE_CHARS = 500;
const MAX_ENTRIES = 5;

class DesignSkillError extends Error {}
// Never echoes the offending text, only where it is and which field failed.
const failIn = (label, n, field, reason) => {
  throw new DesignSkillError(n ? `${label} line ${n}: ${field} ${reason}` : `${label} file: ${field} ${reason}`);
};
const fail = (n, field, reason) => failIn(DESIGN_SECTION.label, n, field, reason);

function validRepo(source) {
  if (!REPO_RE.test(source)) return false;
  const repo = source.slice(source.indexOf('/') + 1);
  return repo !== '.' && repo !== '..' && !repo.startsWith('-');
}

function validDate(s, today) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  // The user types the local calendar day, so compare against the local day, not UTC.
  const pad = n => String(n).padStart(2, '0');
  return s <= `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

// Parses one skill section of a project.md into entries. Throws DesignSkillError on any failure.
function parseSection(markdown, manifest, today, cfg) {
  const fail = (n, field, reason) => failIn(cfg.label, n, field, reason);
  if (typeof markdown !== 'string') return [];
  if (Buffer.byteLength(markdown, 'utf8') > MAX_FILE_BYTES) fail(0, 'file', 'too large');
  const lines = markdown.split('\n');
  const start = lines.findIndex(l => l.replace(/\r$/, '').trimEnd() === cfg.heading);
  if (start === -1) return [];
  const section = [];
  for (let i = start + 1; i < lines.length; i++) {
    const text = lines[i].replace(/\r$/, '');
    if (text.startsWith('## ')) break;
    section.push({ n: i + 1, text });
  }
  // Size caps first, before any pattern runs.
  for (const { n, text } of section) if (text.length > MAX_LINE_CHARS) fail(n, 'line', 'too long');
  const body = section.filter(({ text }) => {
    const t = text.trim();
    return t !== '' && !(t.startsWith('<!--') && t.endsWith('-->'));
  });
  if (body.length === 1 && body[0].text === cfg.none) return [];
  const manifestCmds = [];
  for (const entries of Object.values(manifest)) {
    for (const e of Array.isArray(entries) ? entries : []) {
      if (typeof e?.install === 'string') manifestCmds.push([e.name, e.install]);
    }
  }
  const out = [];
  const perArea = {};
  for (const { n, text } of body) {
    if (!text.startsWith('- ')) fail(n, 'line', 'malformed');
    if (out.length >= (cfg.areas ? MAX_SKILLS_TOTAL : MAX_ENTRIES)) fail(n, 'entries', 'too many entries');
    const m = cfg.re.exec(text);
    if (!m) fail(n, 'line', 'malformed');
    const fields = m.slice(1);
    const area = cfg.areas ? fields.shift() : undefined;
    const [name, source, license, vetted, why, approved] = fields;
    if (area) {
      perArea[area] = (perArea[area] ?? 0) + 1;
      if (perArea[area] > MAX_ENTRIES) fail(n, 'entries', 'too many entries');
    }
    let kind, plugin, cmd;
    if (source.length >= 3 && source.startsWith('`') && source.endsWith('`')) {
      kind = 'command'; cmd = source.slice(1, -1);
      if (!manifestCmds.some(([nm, c]) => nm === name && c === cmd)) fail(n, 'source', 'not a manifest command');
      if (!NAME_RE.test(name)) fail(n, 'name', 'invalid');
    } else if (source.startsWith('plugin ')) {
      if (!cfg.plugins) fail(n, 'source', 'invalid');
      kind = 'plugin'; plugin = source.slice(7);
      if (!PLUGIN_RE.test(plugin)) fail(n, 'source', 'invalid plugin');
      const parts = name.split(':');
      if (parts.length !== 2 || !PLUGIN_RE.test(parts[0]) || !PLUGIN_RE.test(parts[1]) || parts[0] !== plugin) fail(n, 'name', 'invalid');
    } else {
      kind = 'repo';
      if (!validRepo(source)) fail(n, 'source', 'invalid');
      if (!NAME_RE.test(name)) fail(n, 'name', 'invalid');
    }
    if (license === 'NONE' || license === 'NOASSERTION' || !LICENSE_RE.test(license)) fail(n, 'license', 'invalid');
    if (license === '-' && kind !== 'plugin') fail(n, 'license', 'invalid');
    if (vetted === '-' ? kind !== 'plugin' : !validDate(vetted, today)) fail(n, 'vetted', 'invalid');
    if (!validDate(approved, today)) fail(n, 'approved', 'invalid');
    if (why.length < 1 || why.length > 200 || WHY_BAD_RE.test(why)) fail(n, 'why', 'invalid');
    const entry = { name, license, vetted, approved, why };
    if (area) entry.area = area;
    if (kind === 'repo') entry.source = source;
    else if (kind === 'command') entry.install = cmd;
    else entry.plugin = plugin;
    out.push(entry);
  }
  return out;
}

// Parses `## Design skills` (design-skills-section v1).
export function parseDesignSkills(markdown, manifest = {}, today = new Date()) {
  return parseSection(markdown, manifest, today, DESIGN_SECTION);
}

// Parses `## Skills` (skills-section v1).
export function parseSkillsSection(markdown, manifest = {}, today = new Date()) {
  return parseSection(markdown, manifest, today, SKILLS_SECTION);
}

// Expands includes into a flat entry list; entries from groups `design` and `skills` carry scope 'project'.
export function expand(manifest, groups) {
  const out = [];
  const visit = (g, stack) => {
    if (!Object.hasOwn(manifest, g) || !Array.isArray(manifest[g])) throw new Error(`unknown group ${g}`);
    if (stack.includes(g)) throw new Error(`include cycle ${[...stack.slice(stack.indexOf(g)), g].join(' -> ')}`);
    for (const e of manifest[g]) {
      if (e && e.include !== undefined) visit(e.include, [...stack, g]);
      else if (e && typeof e.name === 'string') out.push({ ...e, scope: PROJECT_GROUPS.includes(g) ? 'project' : 'user' });
      else throw new Error(`invalid manifest entry in group ${g}`);
    }
  };
  for (const g of groups) visit(g, []);
  return out;
}

function isInstalled(entry, installed) {
  return entry.name.endsWith('*')
    ? [...installed].some(s => s.startsWith(entry.name.slice(0, -1)))
    : installed.has(entry.name);
}

// Entries still to install. Plugin entries and names with ':' are never installed by the script.
export function missing(manifest, groups, installed) {
  const seen = new Set();
  return expand(manifest, groups).filter(e => {
    if (e.plugin !== undefined || e.name.includes(':')) return false;
    if (isInstalled(e, installed)) return false;
    const key = `${e.scope}|${e.name}|${e.source ?? e.install}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

function commandFor(e, platform) {
  if (typeof e.install === 'string') return e.install;
  if (typeof e.source !== 'string' || !(e.scope === 'project' ? NAME_RE : MANIFEST_NAME_RE).test(e.name) || !validRepo(e.source)) {
    throw new Error('invalid manifest entry');
  }
  const star = platform === 'win32' ? '"*"' : "'*'";
  const skill = e.name.endsWith('*') ? star : e.name;
  return `npx -y ${SKILLS_CLI} add ${e.source} -s ${skill}${e.scope === 'project' ? '' : ' -g'} -a claude-code -y`;
}

// Off Windows the same command runs as argv with no shell (node.M-SEC1); the wildcard is a bare `*`.
function argvFor(e) {
  const skill = e.name.endsWith('*') ? '*' : e.name;
  return ['-y', SKILLS_CLI, 'add', e.source, '-s', skill, ...(e.scope === 'project' ? [] : ['-g']), '-a', 'claude-code', '-y'];
}

// Groups `design` and `skills` exist only when --project supplied them: { root, design, skills }.
function withDesign(manifest, project) {
  const eff = { ...manifest };
  for (const g of PROJECT_GROUPS) {
    delete eff[g];
    if (project) eff[g] = project[g].map(e => ({ ...e }));
  }
  return eff;
}

// Returns [{ cmd, cwd?, argv? }]. Project-group commands carry the product root as cwd.
export function plan(manifest, groups, installed, platform = process.platform, project = null) {
  const seen = new Set();
  const cmds = [];
  for (const e of missing(withDesign(manifest, project), groups, installed)) {
    const item = { cmd: commandFor(e, platform) };
    if (typeof e.install !== 'string' && platform !== 'win32') item.argv = argvFor(e);
    if (e.scope === 'project') item.cwd = project.root;
    const key = `${item.cwd ?? ''}|${item.cmd}`;
    if (!seen.has(key)) { seen.add(key); cmds.push(item); }
  }
  return cmds;
}

// Runs every command; a failure is recorded, not thrown. Items are strings or { cmd, cwd, argv }.
export function runAll(items, exec) {
  const ok = [], failed = [];
  for (const item of items) {
    const { cmd, cwd, argv } = typeof item === 'string' ? { cmd: item } : item;
    try { exec(cmd, cwd, argv); ok.push(cmd); }
    catch (e) { failed.push({ cmd, error: String(e?.message ?? e) }); }
  }
  return { ok, failed };
}

function installedSkills(home, projectRoot) {
  const dirs = [join(home, '.claude', 'skills')];
  if (projectRoot) dirs.push(join(projectRoot, '.claude', 'skills'), join(projectRoot, '.agents', 'skills'));
  return new Set(dirs.filter(existsSync).flatMap(d => readdirSync(d)));
}

function loadProject(p, cwd, today, manifest) {
  const abs = resolve(cwd, p);
  if (basename(abs) !== 'project.md' || basename(dirname(abs)) !== '.company') {
    throw new Error('--project must point to <root>/.company/project.md');
  }
  const root = dirname(dirname(abs));
  if (!existsSync(abs)) return { root, design: [], skills: [] };
  if (statSync(abs).size > MAX_FILE_BYTES) fail(0, 'file', 'too large');
  const text = readFileSync(abs, 'utf8');
  return { root, design: parseDesignSkills(text, manifest, today), skills: parseSkillsSection(text, manifest, today) };
}

// Returns the exit code. Everything outside is injectable so tests never run npx or touch the real home.
export function main(args, env = {}) {
  const log = env.log ?? console.log;
  const exec = env.exec ?? ((cmd, cwd, argv) => (argv ? execFileSync('npx', argv, { cwd, stdio: 'inherit' }) : execSync(cmd, { cwd, stdio: 'inherit' })));
  const cwd = env.cwd ?? process.cwd();
  const platform = env.platform ?? process.platform;
  try {
    let dry = false, listMissing = false, projectArg = null;
    const groups = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--dry-run') dry = true;
      else if (a === '--missing') listMissing = true;
      else if (a === '--project') {
        projectArg = args[++i];
        if (!projectArg || projectArg.startsWith('--')) throw new Error('--project must point to <root>/.company/project.md');
      } else if (a.startsWith('--')) throw new Error('unknown flag');
      else groups.push(a);
    }
    const manifest = env.manifest ?? JSON.parse(readFileSync(join(ROOT, 'deps', 'skills.json'), 'utf8'));
    // Parse first: a bad design or skills line stops everything, nothing is installed in any group.
    const project = projectArg ? loadProject(projectArg, cwd, env.today ?? new Date(), manifest) : null;
    const installed = installedSkills(env.home ?? homedir(), project?.root);
    const want = groups.length ? groups : ['core'];
    if (listMissing) {
      missing(withDesign(manifest, project), want, installed).forEach(e => log(`missing ${e.name}`));
      return 0;
    }
    const cmds = plan(manifest, want, installed, platform, project);
    if (!cmds.length) { log('All skills already installed.'); return 0; }
    const show = ({ cmd, cwd: c }) => `${c ? `(in ${c}) ` : ''}${cmd}`;
    cmds.forEach(c => log(`${dry ? '[dry-run] ' : '$ '}${show(c)}`));
    if (dry) return 0;
    const { ok, failed } = runAll(cmds, exec);
    failed.forEach(f => log(`FAILED ${f.cmd}: ${f.error}`));
    log(`${ok.length} installed, ${failed.length} failed`);
    return failed.length ? 1 : 0;
  } catch (e) {
    log(`ERROR ${e?.message ?? e}`);
    return 1;
  }
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  process.exit(main(process.argv.slice(2)));
}
