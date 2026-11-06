#!/usr/bin/env node
// Installs the standalone skills aico points to (deps/skills.json) that are not installed yet.
// Usage: node install-skills.mjs [group ...] [--project <root>/.company/project.md] [--dry-run | --missing]
//       node install-skills.mjs --retired | --remove <name> [--dry-run]
//   default group: core. Groups `design` and `skills` need --project. contract: docs/contracts/skills-manifest.md v2.6
import { readFileSync, readdirSync, existsSync, statSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, dirname, basename, delimiter, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const PROJECT_GROUPS = ['design', 'skills'];
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
  return `npx -y ${SKILLS_CLI} add ${sourceToken(e)} -s ${skill}${e.scope === 'project' ? '' : ' -g'} -a claude-code -y`;
}

// A project entry with a commit installs exactly that commit; the skills CLI reads `#<ref>`.
function sourceToken(e) {
  if (e.commit === undefined || e.scope !== 'project') return e.source;
  if (typeof e.commit !== 'string' || !SHA_RE.test(e.commit)) throw new Error('invalid manifest entry');
  return `${e.source}#${e.commit}`;
}

// Off Windows the same command runs as argv with no shell (node.M-SEC1); the wildcard is a bare `*`.
function argvFor(e) {
  const skill = e.name.endsWith('*') ? '*' : e.name;
  return ['-y', SKILLS_CLI, 'add', sourceToken(e), '-s', skill, ...(e.scope === 'project' ? [] : ['-g']), '-a', 'claude-code', '-y'];
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
    catch (e) { failed.push({ cmd, error: e?.code === 'ETIMEDOUT' ? TIMEOUT_TEXT : String(e?.message ?? e) }); }
  }
  return { ok, failed };
}

function installedSkills(home, projectRoot) {
  const dirs = [join(home, '.claude', 'skills')];
  if (projectRoot) dirs.push(join(projectRoot, '.claude', 'skills'), join(projectRoot, '.agents', 'skills'));
  return new Set(dirs.filter(existsSync).flatMap(d => readdirSync(d)));
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

function cleanEnv(root, binOnly = false) {
  const env = skillsEnv();
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
function fetchSkillsCli(home, runners) {
  const [name, version] = SKILLS_CLI.split('@');
  const dir = join(home, '.mcsparrow', 'cli', `${name}-${version}`);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, 'package.json'))) writeFileSync(join(dir, 'package.json'), '{"private":true}\n');
  const opts = { cwd: dir, timeout: INSTALL_TIMEOUT_MS, env: cleanEnv(dir), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' };
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
export function installExec(home, runners = { execSync, execFileSync }) {
  return (cmd, cwd, argv) => {
    const args = skillsArgs(cmd, argv);
    if (args) {
      const bin = fetchSkillsCli(home, runners);
      return runners.execFileSync(process.execPath, [bin, ...args], { cwd, timeout: INSTALL_TIMEOUT_MS, env: cleanEnv(cwd, resolve(cwd) === resolve(home)), stdio: 'inherit' });
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
export function retiredSkills(manifest, releasesDir) {
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
  return [...names].filter(n => !manifestMatches(manifest, n)).sort();
}

// Retired names that sit in <home>/.claude/skills as a folder or a link (a listing entry; nothing is followed).
function retiredInstalled(manifest, releasesDir, home) {
  const dir = join(home, '.claude', 'skills');
  let listed;
  try { listed = new Set(readdirSync(dir)); } catch { return []; }
  return retiredSkills(manifest, releasesDir).filter(n => listed.has(n));
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
  const { manifest, releasesDir, home, dry, platform, log, exec, standIn, timeoutMs } = opts;
  if (!NAME_RE.test(name) || !retiredInstalled(manifest, releasesDir, home).includes(name)) {
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
  const exec = env.exec ?? installExec(env.home ?? homedir());
  const cwd = env.cwd ?? process.cwd();
  const platform = env.platform ?? process.platform;
  try {
    let dry = false, listMissing = false, projectArg = null, retired = false, removeName = null, remove = false;
    const groups = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--dry-run') dry = true;
      else if (a === '--missing') listMissing = true;
      else if (a === '--retired') retired = true;
      else if (a === '--remove') { remove = true; removeName = args[++i] ?? ''; }
      else if (a === '--project') {
        projectArg = args[++i];
        if (!projectArg || projectArg.startsWith('--')) throw new Error('--project must point to <root>/.company/project.md');
      } else if (a.startsWith('--')) throw new Error('unknown flag');
      else groups.push(a);
    }
    const manifest = env.manifest ?? JSON.parse(readFileSync(join(ROOT, 'deps', 'skills.json'), 'utf8'));
    if (retired || remove) {
      if ((retired && remove) || listMissing || projectArg || groups.length) throw new Error('--retired and --remove take no group or other mode flag');
      const home = env.home ?? homedir();
      const releasesDir = env.releasesDir ?? join(ROOT, 'releases');
      if (retired) { retiredInstalled(manifest, releasesDir, home).forEach(n => log(`retired ${n}`)); return 0; }
      return removeRetired(removeName, { manifest, releasesDir, home, dry, platform, log, exec: env.exec, standIn: env.standIn, timeoutMs: env.timeoutMs ?? REMOVE_TIMEOUT_MS });
    }
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
    // A manifest command (impeccable) is never run at any scope: it is third-party and uninspected. Print it and a warning for the CEO to run by hand, in a dry run too.
    const manual = cmds.filter(c => !skillsArgs(c.cmd, c.argv));
    const runnable = cmds.filter(c => !manual.includes(c));
    const color = env.color ?? (process.stdout.isTTY && !process.env.NO_COLOR);
    const printManual = () => manual.forEach(c => {
      log(`manual ${c.cmd}`);
      const name = Object.values(manifest).flat().find(e => e?.install === c.cmd)?.name ?? 'This command';
      const text = `WARNING: ${name} is a third-party installer that aico has not inspected, so it was not run. To install it, run it yourself from your home folder only, never from a product folder, because a repo's own copy of the package would run instead. Run it only if you trust it: cd ~ && ${c.cmd}`;
      log(color ? `[33m${text}[0m` : text);
    });
    runnable.forEach(c => log(`${dry ? '[dry-run] ' : '$ '}${show(c)}`));
    if (dry) { printManual(); return 0; }
    // User-scope installs have no product folder; run them from home so a repo's node_modules or .npmrc cannot steer npx.
    const homeDir = env.home ?? homedir();
    const { ok, failed } = runAll(runnable.map(c => (c.cwd ? c : { ...c, cwd: homeDir })), exec);
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
  process.exit(main(process.argv.slice(2)));
}
