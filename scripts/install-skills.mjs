#!/usr/bin/env node
// Installs the standalone skills aico points to (the baseline, deps/3rdpartyskills.json) that are not installed yet.
// Usage: node install-skills.mjs [group ...] [--dry-run | --missing]
//       node install-skills.mjs --retired | --remove <name> [--dry-run]
//       node install-skills.mjs --selected [--dry-run] [--skill=<name> ...] | --status
//   default group: core. Groups are the baseline's own; `design` and `skills` are not among them.
//   A command entry (skillinstaller) is printed, never run. contract: docs/contracts/skills-manifest.md v4.0
import { readFileSync, readdirSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import { join, resolve, dirname, basename, delimiter, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBaseline, readCatalog, skillStatus, approvable, setBoundHash, clearBound, selectable, itemsProven, linkedSegments, vettedText } from './skill-catalog.mjs';
import { vetCandidate, scanInstalled } from './skillspector.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

// The skills CLI pin: one constant, bumped in a change of its own (agentsec.S1).
export const SKILLS_CLI = 'skills@1.7.4';

// Allow-lists (agentsec.M-SEC7, ADR 0005). Every check is a full-match, anchored pattern.
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Command lines that were valid before the manifest pinned them (design-skills-section v1.2).
const OLD_COMMANDS = { impeccable: 'npx -y impeccable skills install' };
const MANIFEST_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}\*?$/;
const PLUGIN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LICENSE_RE = /^[A-Za-z0-9.+-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const LINE_RE = /^- name: ([^;]+); source: ([^;]+); license: ([^;]+); vetted: ([^;]+); (?:commit: ([^;]+); )?why: ([^;]+); approved: ([^;]+)$/;
const WHY_BAD_RE = /[`<>\u0000-\u001f\u007f]/;
const SKILLS_LINE_RE = /^- area: (stack|product-type|company-type); name: ([^;]+); source: ([^;]+); license: ([^;]+); vetted: ([^;]+); commit: ([^;]+); why: ([^;]+); approved: ([^;]+)$/;
const MAX_SKILLS_TOTAL = 15;
const DESIGN_SECTION = { heading: '## Design skills', label: 'design skill', none: '- (none yet; the design-researcher proposes them)', re: LINE_RE, keys: ['name', 'source', 'license', 'vetted', 'commit', 'why', 'approved'], areas: false, plugins: true, commitRequired: false };
const SKILLS_SECTION = { heading: '## Skills', label: 'skills', none: '- (none yet; the skill-researcher proposes them)', re: SKILLS_LINE_RE, keys: ['area', 'name', 'source', 'license', 'vetted', 'commit', 'why', 'approved'], areas: true, plugins: false, commitRequired: true };
const MAX_FILE_BYTES = 256 * 1024;
const MAX_LINE_CHARS = 500;
const MAX_ENTRIES = 5;

class DesignSkillError extends Error {}
// Never echoes the offending text, only where it is and which field failed.
const failIn = (label, n, field, reason) => {
  throw new DesignSkillError(n ? `${label} line ${n}: ${field} ${reason}` : `${label} file: ${field} ${reason}`);
};

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
    const f = Object.create(null);
    cfg.keys.forEach((k, i) => { f[k] = m[i + 1]; });
    const { area, name, source, license, vetted, commit, why, approved } = f;
    if (area) {
      perArea[area] = (perArea[area] ?? 0) + 1;
      if (perArea[area] > MAX_ENTRIES) fail(n, 'entries', 'too many entries');
    }
    let kind, plugin, cmd;
    if (source.length >= 3 && source.startsWith('`') && source.endsWith('`')) {
      kind = 'command'; cmd = source.slice(1, -1);
      // The unpinned impeccable line was valid before the manifest pinned it: it resolves to the pinned command.
      if (OLD_COMMANDS[name] === cmd) {
        const cur = manifestCmds.find(([nm]) => nm === name);
        if (cur) cmd = cur[1];
      }
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
    // A repo line pins a 40-hex commit (required in `## Skills`); a command or plugin line has none (`-` in `## Skills`).
    if (kind === 'repo' ? (commit === undefined ? cfg.commitRequired : !SHA_RE.test(commit)) : commit !== (cfg.commitRequired && kind === 'command' ? '-' : undefined)) fail(n, 'commit', 'invalid');
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
    if (kind === 'repo' && commit !== undefined) entry.commit = commit;
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

// Expands includes into a flat entry list. A group name is looked up by own key only.
export function expand(manifest, groups) {
  const out = [];
  const visit = (g, stack) => {
    if (!Object.hasOwn(manifest, g) || !Array.isArray(manifest[g])) throw new Error(`unknown group ${g}`);
    if (stack.includes(g)) throw new Error(`include cycle ${[...stack.slice(stack.indexOf(g)), g].join(' -> ')}`);
    for (const e of manifest[g]) {
      if (e && e.include !== undefined) visit(e.include, [...stack, g]);
      else if (e && typeof e.name === 'string') out.push({ ...e });
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
    const key = `${e.name}|${e.source ?? e.install}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

function commandFor(e, platform) {
  if (typeof e.install === 'string') return e.install;
  if (typeof e.source !== 'string' || !MANIFEST_NAME_RE.test(e.name) || !validRepo(e.source)) {
    throw new Error('invalid manifest entry');
  }
  const star = platform === 'win32' ? '"*"' : "'*'";
  const skill = e.name.endsWith('*') ? star : e.name;
  return `npx -y ${SKILLS_CLI} add ${e.source} -s ${skill} -g -a claude-code -y`;
}

// Off Windows the same command runs as argv with no shell (node.M-SEC1); the wildcard is a bare `*`.
function argvFor(e) {
  const skill = e.name.endsWith('*') ? '*' : e.name;
  return ['-y', SKILLS_CLI, 'add', e.source, '-s', skill, '-g', '-a', 'claude-code', '-y'];
}

// Turns the baseline into the group map the planner reads: { group: [{ name, source | install } | { include }] }.
// Only a group's own names are listed; an entry in no group (a plugin) is never reached. A license, hash or
// category changes no command, and a user catalog is never read here.
export function manifestFromBaseline(baseline) {
  const byName = new Map(baseline.entries.map(e => [e.skillname, e]));
  const out = {};
  for (const [g, items] of Object.entries(baseline.groups)) {
    out[g] = [];
    for (const item of items) {
      if (typeof item !== 'string') { out[g].push({ include: item.include }); continue; }
      const e = byName.get(item);
      if (!e) continue;
      if (typeof e.skillrepo === 'string') out[g].push({ name: e.skillname, source: e.skillrepo });
      else if (typeof e.skillinstaller === 'string') out[g].push({ name: e.skillname, install: e.skillinstaller });
    }
  }
  return out;
}

// Returns [{ cmd, argv?, manual? }]. A command entry is marked manual by its kind: it is printed, never run.
export function plan(manifest, groups, installed, platform = process.platform) {
  const seen = new Set();
  const cmds = [];
  for (const e of missing(manifest, groups, installed)) {
    const item = { cmd: commandFor(e, platform) };
    if (typeof e.install === 'string') { item.manual = true; item.name = e.name; }
    else if (platform !== 'win32') item.argv = argvFor(e);
    if (!seen.has(item.cmd)) { seen.add(item.cmd); cmds.push(item); }
  }
  return cmds;
}

// Runs every command; a failure is recorded, not thrown. Items are strings or { cmd, cwd, argv }.
export function runAll(items, exec) {
  const ok = [], failed = [];
  for (const item of items) {
    const { cmd, cwd, argv } = typeof item === 'string' ? { cmd: item } : item;
    try { exec(cmd, cwd, argv); ok.push(cmd); }
    catch (e) { failed.push({ cmd, error: e?.code === 'ETIMEDOUT' ? TIMEOUT_TEXT : String(e?.message ?? e) }); }
  }
  return { ok, failed };
}

function installedSkills(home) {
  const dir = join(home, '.claude', 'skills');
  return new Set(existsSync(dir) ? readdirSync(dir) : []);
}

const REMOVE_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 600_000;
const MAX_SBOM_BYTES = 2 * 1024 * 1024;
const SKILL_REF_RE = /^skill:([^@]+)@/;
// Platforms where the skills CLI `remove` was proven to run without a prompt; elsewhere the command is only printed.
const REMOVE_PLATFORMS = new Set(['win32']);
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const TIMEOUT_TEXT = 'timed out, it may still finish';

// Environment of every skills CLI child. DO_NOT_TRACK and DISABLE_TELEMETRY switch off its two telemetry calls
// (/tele/t and /tele/audit, dist/cli.mjs:2809). NoDefaultCurrentDirectoryInExePath stops cmd.exe from picking
// npx.cmd out of the working folder, which is the product root for a project install.
export function skillsEnv(base = process.env) {
  return { ...base, DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1', NoDefaultCurrentDirectoryInExePath: '1' };
}

// PATH for a skills CLI child: absolute entries only, none inside the product root, and no node_modules/.bin of the
// product root or of a folder above it. The folder lookups of the CLI's own children (git, gh) then cannot reach the repo.
// binOnly (user scope, root = home): only node_modules/.bin folders are dropped, so a per-user git or node stays reachable.
export function cleanPath(pathVar, root, binOnly = false) {
  const fold = s => (process.platform === 'win32' ? s.toLowerCase() : s);
  const rootAbs = fold(resolve(root));
  const inside = (p, dir) => p === dir || p.startsWith(dir + sep);
  return String(pathVar ?? '').split(delimiter).filter(entry => {
    if (!entry || !isAbsolute(entry)) return false;
    const p = fold(resolve(entry));
    if (!binOnly && inside(p, rootAbs)) return false;
    if (basename(p) === '.bin' && basename(dirname(p)) === 'node_modules' && inside(rootAbs, dirname(dirname(p)))) return false;
    return true;
  }).join(delimiter);
}

// pinHome: the child sees the given home as HOME and USERPROFILE and no CLAUDE_CONFIG_DIR in any letter case.
function cleanEnv(root, binOnly = false, pinHome = null) {
  const env = skillsEnv();
  if (pinHome !== null) {
    for (const k of Object.keys(env)) if (/^(home|userprofile|claude_config_dir)$/i.test(k)) delete env[k];
    env.HOME = pinHome;
    env.USERPROFILE = pinHome;
  }
  const key = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH';
  const value = cleanPath(env[key], root, binOnly);
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k];
  env[key] = value;
  return env;
}

// Arguments after the pinned CLI name when the command is an `add` of the pinned skills CLI, else null.
function skillsArgs(cmd, argv) {
  if (argv) return argv[0] === '-y' && argv[1] === SKILLS_CLI ? argv.slice(2) : null;
  const head = `npx -y ${SKILLS_CLI} `;
  return cmd.startsWith(head) ? cmd.slice(head.length).split(' ').map(t => (t === '"*"' ? '*' : t)) : null;
}

// npm-cli.js beside the running node: npm is started as `node npm-cli.js`, never through a shim found on PATH.
function npmCli() {
  const dir = dirname(process.execPath);
  const found = [join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(existsSync);
  if (!found) throw new Error('npm-cli.js not found beside node');
  return found;
}

// Fetches the pinned package into a folder aico owns (no install scripts, working folder = that folder) and returns the
// absolute path of its bin file. Nothing in a product folder is read: npm and the package both come from here.
function fetchSkillsCli(home, runners, pinHome = null) {
  const [name, version] = SKILLS_CLI.split('@');
  const dir = join(home, '.mcsparrow', 'cli', `${name}-${version}`);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, 'package.json'))) writeFileSync(join(dir, 'package.json'), '{"private":true}\n');
  const opts = { cwd: dir, timeout: INSTALL_TIMEOUT_MS, env: cleanEnv(dir, false, pinHome), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' };
  try {
    runners.execFileSync(process.execPath, [npmCli(), 'install', '--prefix', dir, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', SKILLS_CLI], opts);
  } catch (e) {
    if (e?.code === 'ETIMEDOUT') throw e;
    throw new Error(`could not fetch ${SKILLS_CLI}: ${errorText(e)}`);
  }
  const pkgDir = join(dir, 'node_modules', name);
  let pkg;
  try { pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')); } catch { throw new Error(`${SKILLS_CLI} is not in the aico folder`); }
  const rel = typeof pkg?.bin === 'string' ? pkg.bin : pkg?.bin?.[name];
  const bin = typeof rel === 'string' ? resolve(pkgDir, rel) : '';
  const inPkg = bin && !relative(pkgDir, bin).startsWith('..') && !isAbsolute(relative(pkgDir, bin));
  if (pkg?.version !== version || !inPkg || !isPlainFile(bin, Infinity)) throw new Error(`${SKILLS_CLI} bin file is missing`);
  return bin;
}

// Home path rules for the one shell form left (Windows cmd, or /bin/sh): it sits in double quotes, so only plain characters pass.
const HOME_SHELL_RE = /^[A-Za-z0-9 _.:\\/()@+-]+$/;

// Runs one install command. The pinned skills CLI never goes through npx or a shell: node runs its bin file by absolute
// path with the working folder (product root for project scope) as cwd and a PATH without product folders. Any other
// manifest command runs through npx from the home folder only.
export function installExec(home, runners = { execSync, execFileSync }, { pinHome = false } = {}) {
  const pin = pinHome ? home : null;
  return (cmd, cwd, argv) => {
    const args = skillsArgs(cmd, argv);
    if (args) {
      const bin = fetchSkillsCli(home, runners, pin);
      return runners.execFileSync(process.execPath, [bin, ...args], { cwd, timeout: INSTALL_TIMEOUT_MS, env: cleanEnv(cwd, resolve(cwd) === resolve(home), pin), stdio: 'inherit' });
    }
    if (resolve(cwd ?? home) !== resolve(home)) throw new Error('this command cannot run in a product folder');
    if (!cmd.startsWith('npx ')) return runners.execSync(cmd, { cwd, timeout: INSTALL_TIMEOUT_MS, env: skillsEnv(), stdio: 'inherit' });
    if (!HOME_SHELL_RE.test(home) || home.endsWith('\\')) throw new Error('home folder cannot be used in a command');
    return runners.execSync(`npx --prefix "${home}" ${cmd.slice(4)}`, { cwd, timeout: INSTALL_TIMEOUT_MS, env: skillsEnv(), stdio: 'inherit' });
  };
}

function manifestMatches(manifest, name) {
  for (const entries of Object.values(manifest)) {
    for (const e of Array.isArray(entries) ? entries : []) {
      if (typeof e?.name !== 'string') continue;
      if (e.name.endsWith('*') ? name.startsWith(e.name.slice(0, -1)) : e.name === name) return true;
    }
  }
  return false;
}

function isPlainFile(p, maxBytes) {
  try { const st = lstatSync(p); return st.isFile() && st.size <= maxBytes; } catch { return false; }
}

// Skill names in the shipped release SBOMs that the current manifest no longer lists, sorted.
// SBOM files are untrusted: links, oversized files and bad JSON are skipped, and a name that is not a plain skill name is dropped.
// Names in `skip` (the user catalog's) are never retired.
export function retiredSkills(manifest, releasesDir, skip = []) {
  const names = new Set();
  let dirs = [];
  try { dirs = readdirSync(releasesDir); } catch { return []; }
  for (const d of dirs) {
    const dir = join(releasesDir, d);
    try { if (!lstatSync(dir).isDirectory()) continue; } catch { continue; }
    const file = join(dir, 'sbom.cdx.json');
    if (!isPlainFile(file, MAX_SBOM_BYTES)) continue;
    let doc;
    try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    for (const c of Array.isArray(doc?.components) ? doc.components : []) {
      const m = typeof c?.['bom-ref'] === 'string' ? SKILL_REF_RE.exec(c['bom-ref']) : null;
      if (m && NAME_RE.test(m[1])) names.add(m[1]);
    }
  }
  const own = new Set(skip);
  return [...names].filter(n => !manifestMatches(manifest, n) && !own.has(n)).sort();
}

// Retired names that sit in <home>/.claude/skills as a folder or a link (a listing entry; nothing is followed).
function retiredInstalled(manifest, releasesDir, home, skip = []) {
  const dir = join(home, '.claude', 'skills');
  let listed;
  try { listed = new Set(readdirSync(dir)); } catch { return []; }
  return retiredSkills(manifest, releasesDir, skip).filter(n => listed.has(n));
}

// Runs a command with stdin ignored and stdout and stderr piped and held. `standIn` swaps the program in tests.
function captureExec(cmd, cwd, argv, standIn, timeout) {
  const opts = { cwd, timeout, env: skillsEnv(), killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' };
  if (standIn) return execFileSync(standIn.file, standIn.args ?? [], opts);
  return argv ? execFileSync('npx', argv, opts) : execSync(cmd, opts);
}

function errorText(e) {
  const err = e?.stderr == null ? '' : String(e.stderr);
  const first = err.split(/\r?\n/).find(l => l.trim() !== '');
  const text = e?.code === 'ETIMEDOUT' ? TIMEOUT_TEXT : (first ?? String(e?.status ?? e?.code ?? 'unknown error'));
  return text.replace(CONTROL_RE, ' ').slice(0, 200);
}

function entryExists(p) {
  try { lstatSync(p); return true; } catch { return false; }
}

function removeRetired(name, opts) {
  const { manifest, releasesDir, home, dry, platform, log, exec, standIn, timeoutMs, skip } = opts;
  if (!NAME_RE.test(name) || !retiredInstalled(manifest, releasesDir, home, skip).includes(name)) {
    log('ERROR not a retired installed skill');
    return 1;
  }
  const argv = ['-y', SKILLS_CLI, 'remove', name, '-g', '-a', 'claude-code', '-y'];
  const cmd = `npx ${argv.join(' ')}`;
  if (dry) { log(`[dry-run] ${cmd}`); return 0; }
  if (!REMOVE_PLATFORMS.has(platform)) { log(`manual ${cmd}`); return 0; }
  try {
    // Run from the home folder: a repo's node_modules or .npmrc must not steer npx (CWE-427). The global remove needs no product folder.
    if (exec) exec(cmd, home, platform === 'win32' ? undefined : argv);
    else captureExec(cmd, home, platform === 'win32' ? undefined : argv, standIn, timeoutMs);
  } catch (e) {
    log(`FAILED ${cmd}: ${errorText(e)}`);
    return 1;
  }
  if (entryExists(join(home, '.claude', 'skills', name))) {
    log(`FAILED ${cmd}: still installed`);
    return 1;
  }
  log(`removed ${name}`);
  return 0;
}

// ---------- selected skills ----------

const SAFE_NAME_RE = /^[a-z0-9][a-z0-9:*-]{0,64}$/;
const SAFE_ROLE_RE = /^[a-z][a-z0-9-]{0,40}$/;
const MAX_SELECTED = 500;
const SETTINGS_TIMEOUT_MS = 30_000;

function readSettingsJson(root) {
  const file = join(ROOT, 'scripts', 'settings.mjs');
  const out = execFileSync(process.execPath, [file, 'get'], { cwd: root, encoding: 'utf8', timeout: SETTINGS_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], env: process.env });
  return JSON.parse(out);
}

// name -> { roles, user }: the skills the resolved settings select. A skill selected at user level by any Role is a user skill.
function selection(settings) {
  const byName = new Map();
  const roles = settings !== null && typeof settings === 'object' && settings.roles !== null && typeof settings.roles === 'object' ? settings.roles : {};
  for (const role of Object.keys(roles)) {
    if (!SAFE_ROLE_RE.test(role)) continue;
    const r = roles[role];
    const list = Array.isArray(r?.skills) ? r.skills.slice(0, 5) : [];
    for (const item of list) {
      if (typeof item?.name !== 'string' || !SAFE_NAME_RE.test(item.name)) continue;
      if (!byName.has(item.name) && byName.size >= MAX_SELECTED) continue;
      const got = byName.get(item.name) ?? { roles: [], user: false };
      got.roles.push(role);
      if (r?.source?.skills === 'user') got.user = true;
      byName.set(item.name, got);
    }
  }
  return new Map([...byName].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function dispatchWord(entry, st) {
  if (entry.skillplugin !== undefined) return 'session list';
  if (st.status === 'installed (name only)') return st.place === 'user' ? 'yes' : 'no';
  return st.status === 'installed' ? 'yes' : 'no';
}

// One machine-read line. The license is free text, so `|` in it is written as %7C and can never add a field.
function statusLine(name, roles, entry, st, dispatch) {
  const license = String(st.license).replaceAll('|', '%7C');
  return `${name} | roles: ${roles} | ${st.status} | place: ${st.place ?? '-'} | license: ${license} | ${vettedText(entry, st.vetted)} | dispatch: ${dispatch ?? dispatchWord(entry, st)}`;
}

const REASON_RE = /^[a-z0-9-]{1,30}$/;

// Says why the scan of the installed copies is not clean. Only fixed words and a reason that passes the same
// allow-list as the scanner's are printed; anything else reads as no usable result.
function scanFailure(after) {
  if (typeof after?.refused === 'string') return `refused: ${after.refused}`;
  const rs = after?.results;
  if (!Array.isArray(rs) || rs.length === 0) return 'no usable result';
  const bad = rs.find((r) => !(r && (r.verdict === 'pass' || r.verdict === 'findings') && r.blocking === false));
  if (bad && bad.verdict === 'findings') return 'verdict findings, blocking';
  if (bad && bad.verdict === 'error' && typeof bad.reason === 'string' && REASON_RE.test(bad.reason)) return `verdict error ${bad.reason}`;
  return 'no usable result';
}

// `--status` and `--selected`: the skills the resolved settings select, looked up in the catalog by name only.
async function runSelected(args, env) {
  const log = env.log ?? console.log;
  try {
    let dry = false, status = false, install = false;
    const only = new Set();
    for (const a of args) {
      if (a.startsWith('--skill=')) {
        const n = a.slice('--skill='.length);
        if (!NAME_RE.test(n)) throw new Error('--skill takes one skill name: lowercase letters, digits and hyphens');
        only.add(n);
      } else if (a === '--dry-run') dry = true;
      else if (a === '--selected') install = true;
      else if (a === '--status') status = true;
      else throw new Error('--selected and --status take only --dry-run, and --selected also --skill=<name>');
    }
    if (install === status) throw new Error('use --selected or --status, not both');
    if (status && dry) throw new Error('--status has no dry run');
    if (status && only.size) throw new Error('--status takes no --skill');
    const home = env.home ?? userInfo().homedir;
    const productRoot = env.productRoot ?? process.cwd();
    const catOpts = env.home ? { home: env.home } : {};
    const settings = env.settings ?? readSettingsJson(productRoot);
    if (settings?.settings_folder_moved !== false) log('settings folder moved');
    const catalog = readCatalog(catOpts);
    catalog.errors.forEach(e => log(e));
    (catalog.warnings ?? []).forEach(w => log(w));
    const byName = new Map(catalog.entries.map(e => [e.skillname, e]));
    const chosen = selection(settings);
    if (only.size) {
      const stray = [...only].filter(n => !chosen.has(n));
      if (stray.length) throw new Error(`not in the selection: ${stray.join(', ')}, nothing installed`);
    }
    const scopeOf = sel => (sel.user ? 'user' : 'project');
    if (status) {
      for (const [name, sel] of chosen) {
        const entry = byName.get(name);
        const roles = sel.roles.join(', ');
        if (!entry || !selectable(entry).ok) { log(`${name} | roles: ${roles} | not in the catalog | place: - | license: no license on record | not vetted | dispatch: no`); continue; }
        const st = skillStatus(entry, { home, productRoot, scope: scopeOf(sel) });
        log(statusLine(name, roles, entry, st));
      }
      // A skill no Role selects reads at project scope and is never dispatched.
      for (const entry of catalog.entries) {
        if (chosen.has(entry.skillname) || !selectable(entry).ok) continue;
        const st = skillStatus(entry, { home, productRoot, scope: 'project' });
        log(statusLine(entry.skillname, '-', entry, st, 'no'));
      }
      return 0;
    }
    const exec = env.exec ?? installExec(home, undefined, { pinHome: true });
    const vet = env.vet ?? vetCandidate;
    const scanAfter = env.scanInstalled ?? scanInstalled;
    const today = env.today ?? new Date().toISOString().slice(0, 10);
    let done = 0, failed = 0;
    for (const [name, sel] of chosen) {
      if (only.size && !only.has(name)) continue;
      const entry = byName.get(name);
      if (!entry || !selectable(entry).ok) { log(`not in the catalog: ${name}`); continue; }
      if (entry.skillplugin !== undefined) { log(`plugin ${name}: skipped, enable it with /plugin`); continue; }
      if (typeof entry.skillinstaller === 'string') {
        log(`manual ${entry.skillinstaller}`);
        log(`WARNING: ${name} is a third-party installer that aico has not inspected, so it was not run and is not vetted. To install it, run it yourself from your home folder only. Run it only if you trust it.`);
        continue;
      }
      const scope = scopeOf(sel);
      const root = scope === 'user' ? home : productRoot;
      const cur = skillStatus(entry, { home, productRoot, scope });
      if (typeof entry.skillcommit !== 'string') {
        log(`needs a pin: ${name}, run /aico:add-skill to pin a commit${cur.status === 'installed (name only)' ? ' (installed, name only)' : ''}`);
        continue;
      }
      const { skillrepo: source, skillcommit: commit } = entry;
      if (typeof source !== 'string' || !validRepo(source) || !SHA_RE.test(commit) || !NAME_RE.test(name)) { log(`ERROR invalid catalog entry: ${name}`); failed++; continue; }
      if (typeof entry.license !== 'string' || entry.license.trim() === '') { log(`no license: ${name}, nothing installed`); failed++; continue; }
      if (cur.status === 'installed') { log(`installed ${name} (${scope})`); done++; continue; }
      // A link or a non-folder on the way to a skills folder under the product root can send the install somewhere
      // else, so nothing is scanned or installed. Under the user home these segments are skipped, not refused.
      if (scope === 'project') {
        const linked = linkedSegments(root);
        if (linked.length > 0) {
          for (const seg of linked) log(`${dry ? '[dry-run] ' : ''}hash differs: ${name}, nothing stored. This is a link or not a folder; delete it by hand: ${seg}`);
          if (!dry) failed++;
          continue;
        }
      }
      const folders = [join(root, '.agents', 'skills', name), join(root, '.claude', 'skills', name)];
      const argv = ['-y', SKILLS_CLI, 'add', `${source}#${commit}`, '-s', name, ...(scope === 'user' ? ['-g'] : []), '-a', 'claude-code', '-y'];
      const cmd = `npx ${argv.join(' ')}`;
      // Never print a command to run in the product folder: a repo's own copy of the CLI would run there.
      const removeHow = scope === 'user'
        ? `run this from your home folder only: npx -y ${SKILLS_CLI} remove ${name} -g -a claude-code -y`
        : `delete these folders by hand: ${folders.join(' and ')}`;
      if (dry) {
        log(`[dry-run] scan ${source} at ${commit}, then:`);
        log(`[dry-run] ${cmd}`);
        log(`[dry-run] working folder: ${root}`);
        continue;
      }
      let v;
      try { v = await vet({ source, commit, name }); } catch { v = { refused: 'scan error' }; }
      if (!v || v.refused !== undefined || v.commit !== commit || !approvable(v.result, v.hash)) {
        const c = clearBound(name, catOpts);
        if (!c.ok) log(c.error);
        log(`scan failed: ${name}, nothing installed, missing`);
        failed++;
        continue;
      }
      // Every folder present at the root must equal the scan, since any of them may be the copy that loads.
      const proven = () => { const got = itemsProven(root, name, v.hash, { place: scope }); return got.present && got.ok; };
      if (scope === 'project') {
        // The home folder is read by the status too, so a differing copy there would leave the skill off every Role.
        const other = itemsProven(home, name, v.hash, { place: 'user' });
        if (other.present && !other.ok) {
          log(`hash differs: ${name}, nothing stored. Your home folder holds another copy; run this from your home folder only: npx -y ${SKILLS_CLI} remove ${name} -g -a claude-code -y`);
          failed++;
          continue;
        }
      }
      if (!proven()) {
        log(`$ ${cmd}`);
        try { exec(cmd, root, argv); } catch (e) { log(`FAILED ${cmd}: ${errorText(e)}`); failed++; continue; }
      }
      if (!proven()) {
        log(`hash differs: ${name}, nothing stored. The folder stays until you remove it; ${removeHow}`);
        failed++;
        continue;
      }
      // The installed copy is scanned before the hash is bound, so a skill that fails here is never dispatched.
      let after;
      try { after = await scanAfter({ name, scope: scope === 'user' ? 'global' : 'project' }, { cwd: productRoot, home }); } catch (e) { after = { refused: 'scan error' }; }
      const rs = after?.results;
      const clean = Array.isArray(rs) && rs.length >= 1 && rs.every((r) => r && (r.verdict === 'pass' || r.verdict === 'findings') && r.blocking === false);
      if (!clean) {
        const c = clearBound(name, catOpts);
        if (!c.ok) log(c.error);
        log(`scan failed after install: ${name}, nothing stored, ${scanFailure(after)}. The folder stays until you remove it; ${removeHow}`);
        failed++;
        continue;
      }
      const w = setBoundHash(name, v.hash, today, catOpts);
      if (!w.ok) { log(w.error); failed++; continue; }
      log(`installed ${name} (${scope}, vetted ${today})`);
      done++;
    }
    log(`${done} installed, ${failed} failed`);
    return failed ? 1 : 0;
  } catch (e) {
    log(`ERROR ${e?.message ?? e}`);
    return 1;
  }
}

// Returns the exit code. Everything outside is injectable so tests never run npx or touch the real home.
export function main(args, env = {}) {
  if (args.includes('--selected') || args.includes('--status')) return runSelected(args, env);
  const log = env.log ?? console.log;
  const exec = env.exec ?? installExec(env.home ?? homedir());
  const platform = env.platform ?? process.platform;
  try {
    let dry = false, listMissing = false, retired = false, removeName = null, remove = false;
    const groups = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--dry-run') dry = true;
      else if (a === '--missing') listMissing = true;
      else if (a === '--retired') retired = true;
      else if (a === '--remove') { remove = true; removeName = args[++i] ?? ''; }
      else if (a.startsWith('--')) throw new Error('unknown flag');
      else groups.push(a);
    }
    const manifest = env.manifest ?? manifestFromBaseline(readBaseline());
    if (retired || remove) {
      if ((retired && remove) || listMissing || groups.length) throw new Error('--retired and --remove take no group or other mode flag');
      const home = env.home ?? homedir();
      const releasesDir = env.releasesDir ?? join(ROOT, 'releases');
      // A name in the user catalog is the CEO's own, so it is never offered as retired.
      const skip = readCatalog(env.home ? { home: env.home } : {}).entries.filter(e => e.layer === 'user').map(e => e.skillname);
      if (retired) { retiredInstalled(manifest, releasesDir, home, skip).forEach(n => log(`retired ${n}`)); return 0; }
      return removeRetired(removeName, { manifest, releasesDir, home, dry, platform, log, exec: env.exec, standIn: env.standIn, timeoutMs: env.timeoutMs ?? REMOVE_TIMEOUT_MS, skip });
    }
    const installed = installedSkills(env.home ?? homedir());
    const want = groups.length ? groups : ['core'];
    if (listMissing) {
      missing(manifest, want, installed).forEach(e => log(`missing ${e.name}`));
      return 0;
    }
    const cmds = plan(manifest, want, installed, platform);
    if (!cmds.length) { log('All skills already installed.'); return 0; }
    const show = ({ cmd }) => cmd;
    // A command entry (impeccable) is never run: it is third-party and uninspected. It is told apart by its kind, never by its text.
    // Print it and a warning for the CEO to run by hand, in a dry run too.
    const manual = cmds.filter(c => c.manual);
    const runnable = cmds.filter(c => !manual.includes(c));
    const color = env.color ?? (process.stdout.isTTY && !process.env.NO_COLOR);
    const printManual = () => manual.forEach(c => {
      log(`manual ${c.cmd}`);
      const name = c.name ?? 'This command';
      const text = `WARNING: ${name} is a third-party installer that aico has not inspected, so it was not run. To install it, run it yourself from your home folder only, never from a product folder, because a repo's own copy of the package would run instead. Run it only if you trust it. First change to your home folder, then run: ${c.cmd}`;
      log(color ? `[33m${text}[0m` : text);
    });
    runnable.forEach(c => log(`${dry ? '[dry-run] ' : '$ '}${show(c)}`));
    if (dry) { printManual(); return 0; }
    // Installs have no product folder; run them from home so a repo's node_modules or .npmrc cannot steer npx.
    const homeDir = env.home ?? homedir();
    const { ok, failed } = runAll(runnable.map(c => ({ ...c, cwd: homeDir })), exec);
    printManual();
    failed.forEach(f => log(`FAILED ${f.cmd}: ${f.error}`));
    log(`${ok.length} installed, ${failed.length} failed`);
    return failed.length ? 1 : 0;
  } catch (e) {
    log(`ERROR ${e?.message ?? e}`);
    return 1;
  }
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  Promise.resolve(main(process.argv.slice(2))).then(code => process.exit(code));
}
