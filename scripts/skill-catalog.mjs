// Third-party skill catalog: the plugin's baseline file and the user's own file.
// Reads, validates and reports status with file reads only. It starts no process and never
// runs a stored command; the installer decides what to do with an entry.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASELINE_FILE = path.join(import.meta.dirname, '..', 'deps', '3rdpartyskills.json');
const USER_DIR = '.mcsparrow';
const USER_FILE = '3rdpartyskills.json';
const MAX_FILE_BYTES = 256 * 1024;
const MAX_USER_ENTRIES = 200;
const MAX_BASELINE_ENTRIES = 200;
const MAX_HASH_FILES = 2000;
const MAX_HASH_BYTES = 64 * 1024 * 1024;
const MAX_HASH_VISITS = 10000;
const MAX_HASH_DEPTH = 32;
const MAX_LISTED_NAMES = 5000;

const CATEGORIES = Object.freeze(['engineering', 'design', 'security', 'quality', 'product', 'research', 'content']);
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ROLE_RE = /^[a-z][a-z0-9-]{0,40}$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const TOKEN_RE = /^[A-Za-z0-9@._/:=+-]+$/;
const PACKAGE_RE = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*@\d+\.\d+\.\d+$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SPACE_SEPARATOR_RE = /^\p{Zs}$/u;
const LICENSE_BAD_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u180e\u2065\u{e0000}-\u{e007f}]/u;

// A license as typed: plain space separators (Zs) are cut at the edges; any other invisible character,
// at the edge or inside, gives null instead of being trimmed away. Blank text comes back as ''.
export function licenseAsTyped(raw) {
  // A linear scan from both ends: a regex with a trailing run is quadratic on a long inner run of spaces.
  let start = 0;
  let end = raw.length;
  while (start < end && SPACE_SEPARATOR_RE.test(raw[start])) start++;
  while (end > start && SPACE_SEPARATOR_RE.test(raw[end - 1])) end--;
  const text = raw.slice(start, end);
  return LICENSE_BAD_RE.test(text) ? null : text;
}
const ENTRY_KEYS = new Set(['skillname', 'skillcategory', 'skillrepo', 'skillinstaller', 'skillplugin', 'skillcommit', 'license', 'vetted', 'hash']);
const SOURCE_KEYS = ['skillrepo', 'skillinstaller', 'skillplugin'];
const ENTRY_ORDER = ['skillname', 'skillcategory', 'skillrepo', 'skillinstaller', 'skillplugin', 'skillcommit', 'license', 'vetted', 'hash'];

const MOVED_WARNING = 'role skills: MCSPARROW_HOME is set, the user catalog is not read';
const NO_LICENSE_TEXT = 'no license on record';

const has = (o, k) => Object.hasOwn(o, k) && o[k] !== undefined;
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const todayUtc = () => new Date().toISOString().slice(0, 10);

function realDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d && s <= todayUtc();
}

// ---------- locations ----------

// The operating system's answer. os.homedir() follows HOME and USERPROFILE, which a repo can set.
function userHome() {
  return os.userInfo().homedir;
}

export function userCatalogPath({ home } = {}) {
  return path.join(typeof home === 'string' ? home : userHome(), USER_DIR, USER_FILE);
}

const sameFolder = (a, b) => {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

// The home the user layer lives under, or null with a reason. An explicit home is the test seam.
function layerHome(opts) {
  if (opts && typeof opts.home === 'string' && opts.home !== '') return { home: opts.home, warning: null };
  let home;
  try { home = userHome(); } catch { return { home: null, warning: 'role skills: the home folder is unknown, the user catalog is not read' }; }
  if (typeof home !== 'string' || home === '') return { home: null, warning: 'role skills: the home folder is unknown, the user catalog is not read' };
  const moved = process.env.MCSPARROW_HOME;
  if (typeof moved === 'string' && moved !== '' && !sameFolder(moved, path.join(home, USER_DIR))) return { home: null, warning: MOVED_WARNING };
  return { home, warning: null };
}

// ---------- entry validation ----------

const fail = (field, reason) => ({ ok: false, field, reason });

// Validates one catalog entry for a layer, 'baseline' or 'user'.
// Mirrors: JSON.parse output that the installer later passes to git and npx as argument tokens and
// uses as path segments, and that pages show to the CEO as plain text.
// Threats covered: prototype keys, unknown keys, shell operators and spaces in commands, path
// traversal in names, control, format and invisible characters in text, oversize text, unreal dates.
// A refusal names the field and a fixed reason, never the value.
export function validateEntry(entry, layer) {
  if (layer !== 'baseline' && layer !== 'user') return fail('layer', 'bad value');
  if (!isPlain(entry)) return fail('entry', 'not an object');
  for (const k of Object.keys(entry)) {
    if (!ENTRY_KEYS.has(k)) return fail('entry', 'unknown key');
  }
  const out = {};
  const user = layer === 'user';

  const name = entry.skillname;
  if (!has(entry, 'skillname')) return fail('skillname', 'missing');
  if (typeof name !== 'string' || name.length > (name.includes(':') ? 129 : 65)) return fail('skillname', 'bad value');
  let plugin = null;
  let wildcard = false;
  if (name.includes(':')) {
    const parts = name.split(':');
    if (parts.length !== 2 || !NAME_RE.test(parts[0]) || !NAME_RE.test(parts[1])) return fail('skillname', 'bad value');
    plugin = parts[0];
  } else if (name.endsWith('*')) {
    if (!NAME_RE.test(name.slice(0, -1))) return fail('skillname', 'bad value');
    if (user) return fail('skillname', 'wildcard not allowed');
    wildcard = true;
  } else if (!NAME_RE.test(name)) return fail('skillname', 'bad value');
  out.skillname = name;

  if (!has(entry, 'skillcategory')) return fail('skillcategory', 'missing');
  if (typeof entry.skillcategory !== 'string' || !CATEGORIES.includes(entry.skillcategory)) return fail('skillcategory', 'bad value');
  out.skillcategory = entry.skillcategory;

  const sources = SOURCE_KEYS.filter((k) => has(entry, k));
  if (sources.length === 0) return fail('skillrepo', 'missing source');
  if (sources.length > 1) return fail('skillrepo', 'more than one source');
  const kind = sources[0];
  if (kind === 'skillrepo') {
    const v = entry.skillrepo;
    if (typeof v !== 'string' || v.length > 140 || !REPO_RE.test(v)) return fail('skillrepo', 'bad value');
    const repo = v.split('/')[1];
    if (repo === '.' || repo === '..') return fail('skillrepo', 'bad value');
    if (plugin !== null) return fail('skillrepo', 'bad value');
  } else if (kind === 'skillinstaller') {
    const v = entry.skillinstaller;
    if (typeof v !== 'string' || v.length === 0 || v.length > 200) return fail('skillinstaller', 'bad value');
    const tokens = v.split(' ');
    if (tokens.some((t) => t === '' || !TOKEN_RE.test(t))) return fail('skillinstaller', 'bad value');
    if (tokens.filter((t) => PACKAGE_RE.test(t)).length !== 1) return fail('skillinstaller', 'bad value');
    if (plugin !== null) return fail('skillinstaller', 'bad value');
  } else {
    const v = entry.skillplugin;
    if (typeof v !== 'string' || !NAME_RE.test(v)) return fail('skillplugin', 'bad value');
    if (plugin === null || plugin !== v) return fail('skillplugin', 'bad value');
  }
  if (plugin !== null && kind !== 'skillplugin') return fail('skillplugin', 'missing');
  out[kind] = entry[kind];

  if (has(entry, 'skillcommit')) {
    if (kind !== 'skillrepo') return fail('skillcommit', 'not allowed');
    if (typeof entry.skillcommit !== 'string' || !COMMIT_RE.test(entry.skillcommit)) return fail('skillcommit', 'bad value');
    out.skillcommit = entry.skillcommit;
  } else if (user && kind === 'skillrepo') return fail('skillcommit', 'missing');

  if (has(entry, 'license')) {
    const raw = entry.license;
    if (typeof raw !== 'string' || raw.length > 1024) return fail('license', 'bad value');
    const text = licenseAsTyped(raw);
    if (text === null || text === '' || [...text].length > 64) return fail('license', 'bad value');
    out.license = text;
  } else if (user) return fail('license', 'missing');

  if (has(entry, 'vetted')) {
    if (!realDate(entry.vetted)) return fail('vetted', 'bad value');
    out.vetted = entry.vetted;
  }
  if (has(entry, 'hash')) {
    if (!user) return fail('hash', 'not allowed');
    if (typeof entry.hash !== 'string' || !HASH_RE.test(entry.hash)) return fail('hash', 'bad value');
    if (kind !== 'skillrepo' || !has(entry, 'skillcommit')) return fail('hash', 'not allowed');
    out.hash = entry.hash;
  }
  const ordered = {};
  for (const k of ENTRY_ORDER) if (Object.hasOwn(out, k)) ordered[k] = out[k];
  return { ok: true, entry: ordered };
}

// ---------- baseline ----------

const baselineError = (detail) => new Error(`ERROR baseline catalog: ${detail}`);

// Parses and checks the baseline text; throws `ERROR baseline catalog: <detail>`.
export function parseBaseline(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE_BYTES) throw baselineError('file too large');
  let doc;
  try { doc = JSON.parse(text); } catch { throw baselineError('bad JSON'); }
  if (!isPlain(doc)) throw baselineError('not an object');
  const keys = Object.keys(doc);
  if (keys.length !== 4 || !['schema', 'categories', 'groups', 'entries'].every((k) => Object.hasOwn(doc, k))) throw baselineError('keys');
  if (doc.schema !== 1) throw baselineError('schema');

  if (!isPlain(doc.categories) || Object.keys(doc.categories).join(',') !== CATEGORIES.join(',')) throw baselineError('categories');
  const categories = {};
  for (const c of CATEGORIES) {
    const roles = doc.categories[c];
    if (!Array.isArray(roles) || roles.length === 0 || roles.length > 40 || roles.some((r) => typeof r !== 'string' || !ROLE_RE.test(r)) || new Set(roles).size !== roles.length) throw baselineError('categories');
    categories[c] = [...roles];
  }

  if (!Array.isArray(doc.entries) || doc.entries.length === 0 || doc.entries.length > MAX_BASELINE_ENTRIES) throw baselineError('entries');
  const entries = [];
  const names = new Set();
  doc.entries.forEach((raw, i) => {
    const v = validateEntry(raw, 'baseline');
    if (!v.ok) throw baselineError(`entry ${i + 1}: ${v.field} ${v.reason}`);
    if (names.has(v.entry.skillname)) throw baselineError(`entry ${i + 1}: skillname duplicate`);
    names.add(v.entry.skillname);
    entries.push(v.entry);
  });

  if (!isPlain(doc.groups)) throw baselineError('groups');
  const groups = {};
  const groupNames = Object.keys(doc.groups);
  for (const g of groupNames) {
    if (!NAME_RE.test(g) || !Array.isArray(doc.groups[g])) throw baselineError('groups');
    groups[g] = doc.groups[g].map((item) => {
      if (typeof item === 'string') {
        if (!names.has(item)) throw baselineError('groups: unknown skillname');
        return item;
      }
      if (isPlain(item) && Object.keys(item).length === 1 && typeof item.include === 'string' && groupNames.includes(item.include)) return { include: item.include };
      throw baselineError('groups: bad item');
    });
  }
  const base = { schema: 1, categories, groups, entries };
  try { for (const g of groupNames) expandGroups(base, [g]); } catch { throw baselineError('groups: include cycle'); }
  return base;
}

export function readBaseline() {
  let st;
  try { st = fs.lstatSync(BASELINE_FILE); } catch { throw baselineError('missing'); }
  if (!st.isFile()) throw baselineError('not a file');
  if (st.size > MAX_FILE_BYTES) throw baselineError('file too large');
  return parseBaseline(fs.readFileSync(BASELINE_FILE, 'utf8'));
}

// Expands group names (all groups when omitted) into entries: includes in place, first sight wins.
export function expandGroups(baseline, groups) {
  const byName = new Map(baseline.entries.map((e) => [e.skillname, e]));
  const names = groups === undefined ? Object.keys(baseline.groups) : groups;
  const out = [];
  const seen = new Set();
  const visit = (g, stack) => {
    if (!Object.hasOwn(baseline.groups, g)) throw new Error('unknown group');
    if (stack.includes(g)) throw new Error('include cycle');
    for (const item of baseline.groups[g]) {
      if (typeof item === 'string') {
        if (!seen.has(item) && byName.has(item)) { seen.add(item); out.push(byName.get(item)); }
      } else visit(item.include, [...stack, g]);
    }
  };
  for (const g of names) visit(g, []);
  return out;
}

export function eligibleRoles(entry, categories) {
  if (!isPlain(entry) || !isPlain(categories)) return [];
  const c = entry.skillcategory;
  return typeof c === 'string' && Object.hasOwn(categories, c) && Array.isArray(categories[c]) ? [...categories[c]] : [];
}

export function selectable(entry) {
  if (isPlain(entry) && typeof entry.skillname === 'string' && entry.skillname.endsWith('*')) return { ok: false, reason: 'a wildcard names no one skill' };
  return { ok: true };
}

// A scan result is approvable when it passed, or had only findings that do not block and none high or critical.
export function approvable(scan, hash) {
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) return false;
  if (!isPlain(scan)) return false;
  if (scan.verdict === 'pass') return true;
  return scan.verdict === 'findings' && scan.blocking === false && isPlain(scan.counts) && scan.counts.critical === 0 && scan.counts.high === 0;
}

// ---------- user file ----------

// Reads the user file as raw parsed JSON. Link, size and shape are checked before any entry is used.
function readUserDoc(file) {
  let st;
  try { st = fs.lstatSync(file); } catch (e) { return e && e.code === 'ENOENT' ? { state: 'missing' } : { state: 'error', code: 'bad JSON' }; }
  if (st.isSymbolicLink()) return { state: 'error', code: 'link' };
  if (!st.isFile()) return { state: 'error', code: 'bad JSON' };
  if (st.size > MAX_FILE_BYTES) return { state: 'error', code: 'file too large' };
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { state: 'error', code: 'bad JSON' }; }
  if (!isPlain(doc) || doc.schema !== 1 || !Array.isArray(doc.entries)) return { state: 'error', code: 'bad JSON' };
  if (Object.keys(doc).some((k) => k !== 'schema' && k !== 'entries')) return { state: 'error', code: 'bad JSON' };
  if (doc.entries.length > MAX_USER_ENTRIES) return { state: 'error', code: 'file too large' };
  return { state: 'ok', doc };
}

const sameSource = (a, b) => SOURCE_KEYS.every((k) => (has(a, k) ? a[k] : null) === (has(b, k) ? b[k] : null));

export function readCatalog(opts = {}) {
  const baseline = readBaseline();
  const entries = baseline.entries.map((e) => ({ ...e, layer: 'baseline' }));
  const errors = [];
  const clashes = [];
  const warnings = [];
  const where = layerHome(opts);
  if (where.warning) warnings.push(where.warning);
  if (where.home === null) return { entries, errors, clashes, warnings };

  const read = readUserDoc(path.join(where.home, USER_DIR, USER_FILE));
  if (read.state === 'error') errors.push(`ERROR user catalog: ${read.code}`);
  if (read.state !== 'ok') return { entries, errors, clashes, warnings };

  const baseByName = new Map(entries.map((e, i) => [e.skillname, i]));
  const seen = new Set();
  read.doc.entries.forEach((raw, i) => {
    const v = validateEntry(raw, 'user');
    if (!v.ok) { errors.push(`ERROR user catalog entry ${i + 1}: ${v.field} ${v.reason}`); return; }
    const e = v.entry;
    if (seen.has(e.skillname)) { errors.push(`ERROR user catalog entry ${i + 1}: skillname duplicate`); return; }
    seen.add(e.skillname);
    if (baseByName.has(e.skillname)) {
      const at = baseByName.get(e.skillname);
      const base = entries[at];
      const pin = has(base, 'skillrepo') && sameSource(base, e) && has(e, 'skillcommit');
      clashes.push({ skillname: e.skillname, pinned: pin });
      if (pin) {
        const merged = { skillname: base.skillname, skillcategory: base.skillcategory, skillrepo: base.skillrepo, skillcommit: e.skillcommit, license: e.license };
        if (has(e, 'vetted')) merged.vetted = e.vetted;
        if (has(e, 'hash')) merged.hash = e.hash;
        entries[at] = { ...merged, layer: 'baseline', pinned: true };
      }
      return;
    }
    entries.push({ ...e, layer: 'user' });
  });
  return { entries, errors, clashes, warnings };
}

// ---------- folder hash ----------

// The same files, order and bytes as the scan's folder hash. Null for a link at the top, a
// missing folder, or a folder over the file, size, entry or depth bound.
export function boundedFolderHash(dir) {
  if (typeof dir !== 'string' || dir === '') return null;
  let top;
  try { top = fs.lstatSync(dir); } catch { return null; }
  if (!top.isDirectory() || top.isSymbolicLink()) return null;
  const files = [];
  const stack = [{ dir, depth: 0 }];
  let visits = 0;
  let bytes = 0;
  try {
    while (stack.length > 0) {
      const { dir: current, depth } = stack.pop();
      if (depth > MAX_HASH_DEPTH) return null;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (++visits > MAX_HASH_VISITS) return null;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '.git' || entry.name === 'node_modules') continue;
          stack.push({ dir: full, depth: depth + 1 });
        } else if (entry.isFile()) {
          bytes += fs.lstatSync(full).size;
          if (files.length + 1 > MAX_HASH_FILES || bytes > MAX_HASH_BYTES) return null;
          files.push({ relativePath: path.relative(dir, full).split('\\').join('/'), full });
        }
      }
    }
    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const hash = createHash('sha256');
    for (const f of files) {
      hash.update(f.relativePath);
      hash.update(fs.readFileSync(f.full));
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

// ---------- status ----------

const SKILL_ROOTS = ['.agents', '.claude'];

// The skills folders under a root as { dir, through }. Every segment is lstat'ed. A link, junction included,
// is not followed unless `followLinks` is set; then the folder is listed with `through: true`, so a caller
// can count what is in it without ever proving it.
function skillsDirs(root, followLinks = false) {
  const out = [];
  for (const first of SKILL_ROOTS) {
    let cur = root;
    let through = false;
    let ok = true;
    for (const seg of [first, 'skills']) {
      cur = path.join(cur, seg);
      let st;
      try { st = fs.lstatSync(cur); } catch { ok = false; break; }
      if (st.isSymbolicLink()) {
        if (!followLinks) { ok = false; break; }
        through = true;
        try { st = fs.statSync(cur); } catch { ok = false; break; }
      }
      if (!st.isDirectory()) { ok = false; break; }
    }
    if (ok) out.push({ dir: cur, through });
  }
  return out;
}

// The segments of a root that are links, as '.agents', '.agents/skills', '.claude' or '.claude/skills'.
// A link at the first segment hides the second, so only the first is named.
export function linkedSegments(rootDir) {
  const out = [];
  for (const first of SKILL_ROOTS) {
    for (const seg of [first, `${first}/skills`]) {
      let st;
      try { st = fs.lstatSync(path.join(rootDir, ...seg.split('/'))); } catch { break; }
      if (st.isSymbolicLink()) { out.push(seg); break; }
      if (!st.isDirectory()) break;
    }
  }
  return out;
}

function probeName(root, name, followLinks = false) {
  const found = [];
  for (const { dir, through } of skillsDirs(root, followLinks)) {
    const full = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    found.push({ full, link: st.isSymbolicLink(), dir: st.isDirectory(), through });
  }
  return found;
}

function probePrefix(root, prefix, followLinks = false) {
  for (const { dir } of skillsDirs(root, followLinks)) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, MAX_LISTED_NAMES); } catch { continue; }
    if (entries.some((e) => (e.isDirectory() || e.isSymbolicLink()) && e.name.startsWith(prefix) && e.name.length > prefix.length && NAME_RE.test(e.name))) return true;
  }
  return false;
}

const licenseText = (entry) => (has(entry, 'license') && typeof entry.license === 'string' && entry.license.trim() !== '' ? `${entry.license.trim()}, as stated, not checked` : NO_LICENSE_TEXT);

// The vetted line as the installer's status line writes it. An entry from the old list (user layer or a pin)
// without a scan hash was not scanned here.
export function vettedText(entry, vetted) {
  if (vetted === null || vetted === undefined) return 'not vetted';
  const own = entry.layer === 'user' || entry.pinned === true;
  return own && typeof entry.hash !== 'string' ? `vetted ${vetted}, from the old list, not scanned here` : `vetted ${vetted}`;
}

export function skillStatus(entry, { home, productRoot, scope } = {}) {
  const license = licenseText(entry);
  const result = (status, place, vetted = null) => ({ status, place, license, vetted });
  if (!isPlain(entry) || typeof entry.skillname !== 'string') return result('not found', null);
  if (has(entry, 'skillplugin')) return result('checked at run start', null, realDate(entry.vetted) ? entry.vetted : null);

  const name = entry.skillname;
  const wildcard = name.endsWith('*');
  const base = wildcard ? name.slice(0, -1) : name;
  if (name.length > 65 || !NAME_RE.test(base)) return result('not found', null);

  const roots = [];
  if (scope !== 'user' && typeof productRoot === 'string' && productRoot !== '') roots.push({ label: 'project', dir: productRoot });
  let homeDir = typeof home === 'string' && home !== '' ? home : null;
  if (homeDir === null) { try { homeDir = userHome(); } catch { homeDir = null; } }
  if (homeDir) roots.push({ label: 'user', dir: homeDir });

  const repo = has(entry, 'skillrepo');
  const pinned = repo && has(entry, 'skillcommit');
  const vetted = !has(entry, 'skillinstaller') && realDate(entry.vetted) ? entry.vetted : null;

  if (wildcard) {
    for (const r of roots) if (probePrefix(r.dir, base, r.label === 'project')) return result('installed (name only)', r.label, vetted);
    return result('not found', null, vetted);
  }
  if (!pinned) {
    for (const r of roots) if (probeName(r.dir, name, r.label === 'project').some((i) => i.dir || i.link)) return result('installed (name only)', r.label, vetted);
    return result('not found', null, vetted);
  }
  const bound = typeof entry.hash === 'string' && HASH_RE.test(entry.hash) ? entry.hash : null;
  let place = null;
  let failing = null;
  for (const r of roots) {
    const got = itemsProven(r.dir, name, bound, { place: r.label });
    if (!got.present) continue;
    if (place === null) place = r.label;
    if (!got.ok && failing === null) failing = r.label;
  }
  if (place === null) return result('missing', null, vetted);
  return result(failing === null ? 'installed' : 'folder not recognized', failing ?? place, vetted);
}

// Every present item under one root must count: a real folder must hash equal to `hash`, and a link must
// lead to the proven .agents folder of the same root. At place `project`, a folder reached through a linked
// segment counts as present and never proves. Returns { present, ok }.
export function itemsProven(rootDir, name, hash, { place } = {}) {
  const bound = typeof hash === 'string' && HASH_RE.test(hash) ? hash : null;
  const items = probeName(rootDir, name, place === 'project');
  if (items.length === 0) return { present: false, ok: false };
  const agents = path.join(rootDir, '.agents', 'skills', name);
  const proven = (item) => bound !== null && !item.link && item.dir && boundedFolderHash(item.full) === bound;
  let ok = true;
  for (const item of items) {
    if (item.through) { ok = false; continue; }
    if (!item.link) { if (!proven(item)) ok = false; continue; }
    const home = items.find((o) => !o.through && !o.link && sameFolder(o.full, agents));
    if (!home || !proven(home) || !linkLeadsTo(item.full, agents)) ok = false;
  }
  return { present: true, ok };
}

// Compares where the link physically leads, not its text, so no spelling of the path needs reasoning about.
function linkLeadsTo(link, target) {
  try { return sameFolder(fs.realpathSync(link), fs.realpathSync(target)); } catch { return false; }
}

// ---------- writes ----------

const writeFail = (error) => ({ ok: false, error });
const CANNOT_WRITE = 'ERROR user catalog: cannot write';

// Atomic write: an exclusive temp file in the same folder, then a rename. A link at the folder or target refuses.
function writeUserDoc(home, doc) {
  const dir = path.join(home, USER_DIR);
  const file = path.join(dir, USER_FILE);
  let tmp = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const d = fs.lstatSync(dir);
    if (d.isSymbolicLink() || !d.isDirectory()) return writeFail(CANNOT_WRITE);
    try {
      const t = fs.lstatSync(file);
      if (t.isSymbolicLink() || !t.isFile()) return writeFail(CANNOT_WRITE);
    } catch (e) { if (!e || e.code !== 'ENOENT') return writeFail(CANNOT_WRITE); }
    const text = `${JSON.stringify(doc, null, 2)}\n`;
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) return writeFail(CANNOT_WRITE);
    tmp = path.join(dir, `.${USER_FILE}.${randomBytes(8).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch {
    if (tmp !== null) { try { fs.unlinkSync(tmp); } catch { /* already gone */ } }
    return writeFail(CANNOT_WRITE);
  }
}

// Loads the user file for a write; a missing file is an empty one, an unreadable one refuses.
function loadForWrite(opts) {
  const where = layerHome(opts);
  if (where.home === null) return { error: `ERROR user catalog: ${where.warning === MOVED_WARNING ? 'MCSPARROW_HOME is set' : 'no home'}` };
  const read = readUserDoc(path.join(where.home, USER_DIR, USER_FILE));
  if (read.state === 'error') return { error: `ERROR user catalog: ${read.code}` };
  const doc = read.state === 'ok' ? read.doc : { schema: 1, entries: [] };
  // Every stored row is rewritten, so every row must pass the checks a new one does.
  for (let i = 0; i < doc.entries.length; i++) {
    const v = validateEntry(doc.entries[i], 'user');
    if (!v.ok) return { error: `ERROR user catalog entry ${i + 1}: ${v.field} ${v.reason}` };
  }
  return { home: where.home, doc };
}

const findRaw = (doc, name) => doc.entries.findIndex((e) => isPlain(e) && Object.hasOwn(e, 'skillname') && e.skillname === name);

// Adds a user entry. One commit per name: an equal entry writes nothing, another commit needs
// moveCommit (it sets the commit and license and clears hash and vetted), another source is refused.
export function addUserEntry(entry, { home, moveCommit } = {}) {
  const v = validateEntry(entry, 'user');
  if (!v.ok) return writeFail(`ERROR user catalog entry: ${v.field} ${v.reason}`);
  const e = v.entry;
  const loaded = loadForWrite({ home });
  if (loaded.error) return writeFail(loaded.error);
  const base = readBaseline().entries.find((b) => b.skillname === e.skillname);
  if (base && !(has(base, 'skillrepo') && sameSource(base, e) && has(e, 'skillcommit'))) return writeFail('ERROR user catalog entry: skillname clashes with the baseline');

  const at = findRaw(loaded.doc, e.skillname);
  if (at === -1) {
    if (loaded.doc.entries.length >= MAX_USER_ENTRIES) return writeFail('ERROR user catalog: too many entries');
    loaded.doc.entries.push(e);
  } else {
    const old = validateEntry(loaded.doc.entries[at], 'user');
    if (!old.ok) return writeFail(`ERROR user catalog entry ${at + 1}: ${old.field} ${old.reason}`);
    const o = old.entry;
    if (!sameSource(o, e)) return writeFail('ERROR user catalog entry: skillname exists with another source');
    const sameCommit = (o.skillcommit ?? null) === (e.skillcommit ?? null);
    if (sameCommit) {
      if (o.license === e.license && o.skillcategory === e.skillcategory) return { ok: true, changed: false };
      return writeFail('ERROR user catalog entry: skillname exists with other values');
    }
    if (moveCommit !== true) return writeFail('ERROR user catalog entry: skillname exists with another commit');
    const moved = { ...o, skillcommit: e.skillcommit, license: e.license };
    delete moved.hash;
    delete moved.vetted;
    const again = validateEntry(moved, 'user');
    if (!again.ok) return writeFail(`ERROR user catalog entry: ${again.field} ${again.reason}`);
    loaded.doc.entries[at] = again.entry;
  }
  const w = writeUserDoc(loaded.home, loaded.doc);
  return w.ok ? { ok: true, changed: true } : w;
}

// Writes the scan hash and the vetted date together, or neither.
export function setBoundHash(name, hash, vetted, { home } = {}) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return writeFail('ERROR user catalog entry: skillname bad value');
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) return writeFail('ERROR user catalog entry: hash bad value');
  if (!realDate(vetted)) return writeFail('ERROR user catalog entry: vetted bad value');
  const loaded = loadForWrite({ home });
  if (loaded.error) return writeFail(loaded.error);
  const at = findRaw(loaded.doc, name);
  if (at === -1) return writeFail('ERROR user catalog entry: skillname not found');
  const old = validateEntry(loaded.doc.entries[at], 'user');
  if (!old.ok) return writeFail(`ERROR user catalog entry ${at + 1}: ${old.field} ${old.reason}`);
  const next = validateEntry({ ...old.entry, hash, vetted }, 'user');
  if (!next.ok) return writeFail(`ERROR user catalog entry ${at + 1}: ${next.field} ${next.reason}`);
  loaded.doc.entries[at] = next.entry;
  const w = writeUserDoc(loaded.home, loaded.doc);
  return w.ok ? { ok: true, changed: true } : w;
}

// Clears the scan hash and the vetted date together.
export function clearBound(name, { home } = {}) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return writeFail('ERROR user catalog entry: skillname bad value');
  const loaded = loadForWrite({ home });
  if (loaded.error) return writeFail(loaded.error);
  const at = findRaw(loaded.doc, name);
  if (at === -1) return writeFail('ERROR user catalog entry: skillname not found');
  const raw = loaded.doc.entries[at];
  if (!Object.hasOwn(raw, 'hash') && !Object.hasOwn(raw, 'vetted')) return { ok: true, changed: false };
  const next = { ...raw };
  delete next.hash;
  delete next.vetted;
  loaded.doc.entries[at] = next;
  const w = writeUserDoc(loaded.home, loaded.doc);
  return w.ok ? { ok: true, changed: true } : w;
}
