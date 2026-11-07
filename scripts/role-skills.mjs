// Role skills commands: migrate the old project.md skill sections into the skill catalog and Role
// selections, count what is left to migrate, and report whether design selections are stale.
// Reads and writes files only. It starts no process and never runs a stored command.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseDesignSkills, parseSkillsSection } from './install-skills.mjs';
import { readCatalog, readBaseline, eligibleRoles, addUserEntry, validateEntry, userCatalogPath, licenseAsTyped } from './skill-catalog.mjs';
import { checkLayers, readLayer, resolveSettings, loadModelFloor, layerFileProblem } from './settings.mjs';

const MAX_FILE_BYTES = 256 * 1024;
const MAX_LINES = 100;
const MAX_LINE_CHARS = 500;
const MAX_ROLE_SKILLS = 5;
const STALE_DAYS = 180;
const OLD_IMPECCABLE = 'npx -y impeccable skills install';
const KEY = 'aico_settings';

const UI_FIRST = ['ui-ux-designer', 'frontend-engineer', 'desktop-engineer', 'game-engineer', 'brand-artist'];
const inOfferOrder = (target, roles) => (target.skillcategory === 'design'
  ? [...UI_FIRST.filter((r) => roles.includes(r)), ...roles.filter((r) => !UI_FIRST.includes(r))]
  : roles);

const SECTIONS = [
  { heading: '## Design skills', parse: parseDesignSkills, none: '- (none yet; the design-researcher proposes them)', category: () => 'design' },
  { heading: '## Skills', parse: parseSkillsSection, none: '- (none yet; the skill-researcher proposes them)', category: (area) => (area === 'company-type' ? 'product' : 'engineering') }
];

// Lines the old sections held: name, source and license come first in both formats.
const HEAD_RE = /^- (?:area: [^;]+; )?name: ([^;]+); source: ([^;]+); license: ([^;]+); /;
const SPEC_RE = /^(\d{1,5}):([a-z0-9:*-]{1,129})$/;
const CATEGORY_SPEC_RE = /^(\d{1,5}):([a-z0-9:*-]{1,129})=([a-z]{1,20})$/;
const ROLES_RE = /^[a-z][a-z0-9-]{0,40}(?:,[a-z][a-z0-9-]{0,40}){0,39}$/;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const todayUtc = () => new Date().toISOString().slice(0, 10);
const stay = (reason) => ({ stay: reason });

class Stop extends Error {}

// The error line for an unexpected failure: a stop or a baseline catalog message passes, anything else is named by `fallback`.
export function failLine(err, fallback) {
  if (err instanceof Stop) return `ERROR ${err.message}`;
  const m = err && typeof err.message === 'string' ? err.message : '';
  return m.startsWith('ERROR baseline catalog') ? m.split('\n')[0].slice(0, 200) : `ERROR ${fallback}`;
}

// ---------- safe file access ----------

const identity = (s) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}`;

// Reads a regular file that has no link and one name. The open handle is checked against the path
// so a swap between the check and the read is caught. Returns null when the file is missing.
function readPlain(file, label) {
  let l;
  try { l = fs.lstatSync(file, { bigint: true }); } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw new Stop(`${label} cannot be read`);
  }
  if (l.isSymbolicLink() || !l.isFile() || l.nlink !== 1n) throw new Stop(`${label} is not a plain file`);
  if (l.size > BigInt(MAX_FILE_BYTES)) throw new Stop(`${label} is too large`);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const s = fs.fstatSync(fd, { bigint: true });
    if (s.dev !== l.dev || s.ino !== l.ino || s.nlink !== 1n) throw new Stop(`${label} changed while reading`);
    return { text: fs.readFileSync(fd, 'utf8'), id: identity(l) };
  } catch (e) {
    if (e instanceof Stop) throw e;
    throw new Stop(`${label} cannot be read`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Writes through an exclusive temp file and a rename. When the file existed it must be unchanged since the read.
function writePlain(file, text, before, label) {
  if (before !== null) {
    let l;
    try { l = fs.lstatSync(file, { bigint: true }); } catch { throw new Stop(`${label} changed while migrating`); }
    if (l.isSymbolicLink() || !l.isFile() || identity(l) !== before) throw new Stop(`${label} changed while migrating`);
  } else if (fs.existsSync(file)) throw new Stop(`${label} changed while migrating`);
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* not created */ }
    throw new Stop(`${label} cannot be written`);
  }
}

function realDir(dir) {
  try {
    const s = fs.lstatSync(dir);
    return s.isDirectory() && !s.isSymbolicLink();
  } catch { return false; }
}

function writable(dir) {
  let at = dir;
  for (let i = 0; i < 64; i++) {
    try {
      const s = fs.lstatSync(at);
      if (s.isSymbolicLink() || !s.isDirectory()) return false;
      fs.accessSync(at, fs.constants.W_OK);
      return true;
    } catch (e) {
      if (!e || e.code !== 'ENOENT') return false;
      const up = path.dirname(at);
      if (up === at) return false;
      at = up;
    }
  }
  return false;
}

// ---------- reading the old sections ----------

function sectionBody(lines, heading) {
  const start = lines.findIndex((l) => l.replace(/\r$/, '').trimEnd() === heading);
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const text = lines[i].replace(/\r$/, '');
    if (text.startsWith('## ')) break;
    out.push({ n: i + 1, text });
  }
  return out;
}

function isBody(text, none) {
  const t = text.trim();
  return t !== '' && !(t.startsWith('<!--') && t.endsWith('-->')) && text !== none;
}

// Names the failed field of an old section parser, never the text.
function failedField(err) {
  const m = /line \d+: ([a-z]+) /.exec(String(err && err.message));
  return m ? m[1] : 'line';
}

// ---------- classification of one line ----------

function sameSource(entry, cand) {
  return (entry.skillrepo ?? null) === (cand.skillrepo ?? null) && (entry.skillplugin ?? null) === (cand.skillplugin ?? null) && (entry.skillinstaller ?? null) === (cand.skillinstaller ?? null);
}

// Judges one old section line. Mirrors: the old section parsers (design-skills-section, skills-section),
// which are the only readers of that text, plus the catalog entry check that the user file applies.
// Threats covered: hostile project text (long lines, shell text in a command, bad license, name clashes);
// a command is compared byte for byte with the list and never run. First match wins, in the order of the
// migration rules. A line that stays carries only its reason, never its text.
function classify(text, section, ctx) {
  const m = HEAD_RE.exec(text);
  if (text.length > MAX_LINE_CHARS || !m) return stay('not a skill line');
  const [, name, source, license] = m;
  const isUi = name === 'aico:ui-design' && source === 'plugin aico';
  let e;
  try {
    const self = {};
    if (source.length >= 3 && source.startsWith('`') && source.endsWith('`')) self.own = [{ name, install: source.slice(1, -1) }];
    [e] = section.parse(`${section.heading}\n${text}`, self, ctx.today);
  } catch (err) {
    const field = failedField(err);
    if (field === 'line') return stay('not a skill line');
    if (license === '-' && !isUi) return stay('no license');
    return stay(`${field} not valid`);
  }
  if (e === undefined) return stay('not a skill line');
  if (isUi) {
    const base = ctx.baseByName.get('aico:ui-design');
    return base ? { kind: 'selection', target: base, e } : stay('name clash with the list');
  }
  if (license === '-') return stay('no license');
  const base = ctx.baseByName.get(e.name);
  if (e.install !== undefined) {
    const same = base && typeof base.skillinstaller === 'string' && (e.install === base.skillinstaller || (e.name === 'impeccable' && e.install === OLD_IMPECCABLE));
    return same ? { kind: 'selection', target: ctx.byName.get(e.name) ?? base, e } : stay('command differs from the list');
  }
  if (e.plugin === undefined && e.commit === undefined) {
    return base && base.skillrepo === e.source ? { kind: 'selection', target: ctx.byName.get(e.name) ?? base, e } : stay('repo line has no commit');
  }
  const cand = { skillname: e.name, skillcategory: base ? base.skillcategory : section.category(e.area), license: e.license };
  if (e.plugin !== undefined) cand.skillplugin = e.plugin;
  else { cand.skillrepo = e.source; cand.skillcommit = e.commit; }
  if (e.vetted !== '-') cand.vetted = e.vetted;
  const v = validateEntry(cand, 'user');
  if (!v.ok) return stay(`${v.field} not valid`);
  const entry = v.entry;
  const own = ctx.userByName.get(e.name);
  if (own) {
    if (!sameSource(own, entry)) return stay('name clash with your list');
    if (entry.skillplugin !== undefined || own.skillcommit === entry.skillcommit) return { kind: 'selection', target: own, e };
    return { kind: 'choice', entry, target: own, e };
  }
  if (base) {
    if (base.skillrepo !== undefined && base.skillrepo === entry.skillrepo) return { kind: 'pin', entry, target: base, e };
    if (base.skillplugin !== undefined && base.skillplugin === entry.skillplugin) return { kind: 'selection', target: base, e };
    return stay('name clash with the list');
  }
  return { kind: 'entry', entry, target: entry, e };
}

// ---------- scan ----------

function protectedRoles(pluginRoot) {
  return new Set(loadModelFloor(pluginRoot).protected);
}

function projectList(cwd) {
  const file = path.join(cwd, '.company', 'settings.json');
  const read = readPlain(file, 'project settings');
  let data = {};
  if (read !== null) {
    try { data = JSON.parse(read.text); } catch { throw new Stop('project settings is not valid JSON'); }
    if (!isPlain(data)) throw new Stop('project settings is not valid JSON');
  }
  return { file, id: read === null ? null : read.id, data };
}

function roleNames(data, role) {
  const list = data[KEY]?.roles?.[role]?.skills;
  return Array.isArray(list) ? list.filter((x) => isPlain(x) && typeof x.name === 'string').map((x) => x.name) : [];
}

function scan(opts) {
  const { cwd, home, pluginRoot } = opts;
  const today = opts.todayDate;
  const file = path.join(cwd, '.company', 'project.md');
  const read = readPlain(file, 'project.md');
  if (read === null) return { empty: true, items: [] };
  const baseline = readBaseline();
  const catalog = readCatalog({ home });
  const baseByName = new Map(baseline.entries.map((x) => [x.skillname, x]));
  const byName = new Map(catalog.entries.map((x) => [x.skillname, x]));
  const userByName = new Map(catalog.entries.filter((x) => x.layer === 'user' || x.pinned === true).map((x) => [x.skillname, x]));
  const guarded = protectedRoles(pluginRoot);
  const project = projectList(cwd);
  const lines = read.text.split('\n');
  const items = [];
  const fresh = new Map();
  for (const section of SECTIONS) {
    const body = sectionBody(lines, section.heading).filter(({ text }) => isBody(text, section.none));
    body.forEach(({ n, text }, i) => {
      const res = i >= MAX_LINES ? stay('too many lines') : classify(text, section, { today, baseByName, byName, userByName });
      if (res.entry && !userByName.has(res.entry.skillname)) {
        userByName.set(res.entry.skillname, res.entry);
        fresh.set(res.entry.skillname, { entry: res.entry, kind: res.kind });
      } else if (res.kind === 'choice' && fresh.get(res.target.skillname)?.entry === res.target) {
        // The entry exists only once an earlier line writes it, so there is no listed commit to move.
        Object.assign(res, stay('commit differs from an earlier line'));
      } else if (res.kind === 'selection' && fresh.get(res.target.skillname)?.entry === res.target) {
        // The entry exists only once a line writes it, so whichever line is chosen writes it.
        const first = fresh.get(res.target.skillname);
        res.entry = first.entry;
        res.kind = first.kind;
      }
      // A new entry from a Skills line has no category of its own; the CEO picks one from the closed list.
      if (res.kind === 'entry' && section.heading === '## Skills') res.pickCategory = true;
      if (res.target && !res.stay) {
        const openFor = (target) => inOfferOrder(target, eligibleRoles(target, baseline.categories).filter((r) => !guarded.has(r)))
          .filter((r) => { const have = roleNames(project.data, r); return have.includes(res.target.skillname) || have.length < MAX_ROLE_SKILLS; });
        if (res.pickCategory) {
          const keys = categoryChoices(baseline);
          const first = res.target.skillcategory;
          const ordered = [...keys.filter((k) => k === first), ...keys.filter((k) => k !== first)];
          const choices = ordered.map((k) => [k, openFor({ skillcategory: k })]).filter(([, r]) => r.length > 0);
          const reachable = ordered.some((k) => eligibleRoles({ skillcategory: k }, baseline.categories).some((r) => !guarded.has(r)));
          if (choices.length === 0) Object.assign(res, stay(reachable ? 'Role already has 5' : 'no Role can take it'));
          else {
            res.choices = choices;
            res.offer = choices.find(([k]) => k === first)?.[1] ?? [];
          }
        } else {
          const roles = inOfferOrder(res.target, eligibleRoles(res.target, baseline.categories).filter((r) => !guarded.has(r)));
          const open = openFor(res.target);
          if (roles.length === 0) Object.assign(res, stay('no Role can take it'));
          else if (open.length === 0) Object.assign(res, stay('Role already has 5'));
          else res.offer = open;
        }
      }
      items.push({ n, section, text, res });
    });
  }
  return { empty: false, read, file, lines, items, project, baseline, catalog, home };
}

const shown = (e) => {
  const src = e.install !== undefined ? 'command from the list' : e.plugin !== undefined ? `plugin ${e.plugin}` : e.source;
  return `${e.name}, source ${src}${e.commit ? `, commit ${e.commit}` : ''}, license ${e.license}, vetted ${e.vetted}, approved ${e.approved}`;
};

// Categories a new entry may take from a Skills line: the baseline categories, never security.
const categoryChoices = (baseline) => Object.keys(baseline.categories).filter((c) => c !== 'security');

const WHAT = { selection: 'selection only', entry: 'new entry in your list', pin: 'pin on the list entry', choice: 'commit differs from your list: keep (stays) or move' };

// ---------- preflight ----------

function preflight(opts) {
  const catalog = readCatalog({ home: opts.home });
  if (catalog.warnings.some((w) => w.includes('MCSPARROW_HOME'))) return 'ERROR user catalog: MCSPARROW_HOME is set';
  if (catalog.warnings.length > 0) return 'ERROR user catalog: no home';
  if (catalog.errors.length > 0) return catalog.errors[0];
  let file;
  try { file = userCatalogPath({ home: opts.home }); } catch { return 'ERROR user catalog: no home'; }
  if (!writable(path.dirname(file))) return 'ERROR user catalog: cannot write';
  const problem = layerFileProblem('project', { home: opts.settingsHome, cwd: opts.cwd });
  if (problem !== null) return `ERROR project settings: ${problem.replace(/^.*[\\/]/, '')}`;
  if (!realDir(path.join(opts.cwd, '.company')) || !writable(path.join(opts.cwd, '.company'))) return 'ERROR project settings: cannot write';
  return null;
}

// ---------- migrate ----------

function archiveName(dir, today) {
  for (let i = 1; i < 100; i++) {
    const f = path.join(dir, `skill-sections-${today}${i === 1 ? '' : `-${i}`}.md`);
    if (!fs.existsSync(f)) return f;
  }
  throw new Stop('archive cannot be written');
}

function stamp(opts) {
  return opts.today ?? todayUtc();
}

export function migrate(options = {}) {
  const opts = normalize(options);
  const out = [];
  try {
    const first = preflight(opts);
    if (first !== null) return { ok: false, lines: [first] };
    const s = scan(opts);
    if (s.empty || s.items.length === 0) return { ok: true, changed: false, lines: ['nothing to migrate'] };
    const chosen = new Map();
    for (const c of options.choices ?? []) chosen.set(c.n, c);
    if (!options.apply) {
      for (const { n, res } of s.items) {
        if (res.stay) out.push(`line ${n}: stays, ${res.stay}`);
        else if (res.choices) out.push(`line ${n}: ${shown(res.e)}; ${WHAT[res.kind]}; choose its category; ${res.choices.map(([k, r]) => `Category: ${k}; Roles: ${r.join(', ')}`).join('; ')}`);
        else out.push(`line ${n}: ${shown(res.e)}; ${WHAT[res.kind]}; Category: ${res.target.skillcategory}; Roles: ${res.offer.join(', ')}`);
      }
      return { ok: true, changed: false, lines: out };
    }
    return execute(s, opts, chosen, new Set(options.moves ?? []), out);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    out.push(`ERROR ${e.message}`);
    return { ok: false, changed: false, lines: out };
  }
}

function normalize(o) {
  const cwd = path.resolve(o.cwd ?? process.cwd());
  const today = stamp(o);
  const [y, m, d] = today.split('-').map(Number);
  return { cwd, home: o.home, settingsHome: o.home ? path.join(o.home, '.mcsparrow') : undefined, today, todayDate: new Date(y, m - 1, d), pluginRoot: o.pluginRoot ?? path.join(import.meta.dirname, '..') };
}

function execute(s, opts, chosen, moves, out) {
  const done = [];
  const adds = new Map();
  const count = (role) => roleNames(s.project.data, role).length + (adds.get(role)?.length ?? 0);
  const settled = new Map();
  for (const item of s.items) {
    const { n, res } = item;
    const c = chosen.get(n);
    if (res.stay) { out.push(`line ${n}: stays, ${res.stay}`); continue; }
    if (!c) { out.push(`line ${n}: not chosen`); continue; }
    if (c.name !== res.e.name) { out.push(`line ${n}: stays, line changed`); continue; }
    if (res.kind === 'choice' && !moves.has(`${n}:${c.name}`)) { out.push(`line ${n}: stays, commit differs from your list`); continue; }
    let offer = res.offer;
    let category = res.entry?.skillcategory;
    if (c.category !== undefined) {
      if (!res.choices) { out.push(`line ${n}: stays, category comes from the list`); continue; }
      const pick = res.choices.find(([k]) => k === c.category);
      if (!pick) { out.push(`line ${n}: stays, category not offered`); continue; }
      category = c.category;
      offer = pick[1];
    } else if (res.choices) {
      // A same-name line after a settled one follows that category; any other line needs its own choice.
      if (!settled.has(res.entry.skillname)) { out.push(`line ${n}: stays, no category chosen`); continue; }
      category = settled.get(res.entry.skillname);
      offer = res.choices.find(([k]) => k === category)?.[1] ?? [];
    }
    if (res.choices && settled.has(res.entry.skillname) && settled.get(res.entry.skillname) !== category) { out.push(`line ${n}: stays, category differs from an earlier line`); continue; }
    if (c.roles.some((r) => !offer.includes(r))) { out.push(`line ${n}: stays, Role not offered`); continue; }
    const name = res.target.skillname;
    const roles = c.roles.filter((r) => roleNames(s.project.data, r).includes(name) || (adds.get(r) ?? []).some((x) => x.name === name) || count(r) < MAX_ROLE_SKILLS);
    if (roles.length < c.roles.length) { out.push(`line ${n}: stays, Role already has 5`); continue; }
    for (const r of roles) {
      if (roleNames(s.project.data, r).includes(name) || (adds.get(r) ?? []).some((x) => x.name === name)) continue;
      adds.set(r, [...(adds.get(r) ?? []), { name, approved: res.e.approved }]);
    }
    if (res.entry) {
      res.entry.skillcategory = category;
      settled.set(res.entry.skillname, category);
    }
    done.push({ item, roles });
  }
  if (done.length === 0) return { ok: true, changed: false, lines: out };

  const dir = path.join(opts.cwd, '.company', 'archive');
  const note = [];
  const stopped = (e) => { out.push(`ERROR ${e.message}`, `done so far: ${note.join(', ') || 'nothing'}; project.md is unchanged`); return { ok: false, changed: note.length > 0, lines: out }; };
  try {
    // Names that become entries only after the catalog write cannot be checked yet; the write checks them again.
    const later = new Set(done.filter((d) => d.item.res.entry).map((d) => d.item.res.target.skillname));
    checkAdds(mergedLayer(s.project.data, adds, (name) => later.has(name)), adds, opts);
  } catch (e) {
    return stopped(e instanceof Stop ? e : new Stop('cannot write'));
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!realDir(dir)) throw new Stop('archive cannot be written');
    const text = SECTIONS.map((sec) => {
      const rows = done.filter((d) => d.item.section === sec).map((d) => d.item.text);
      return rows.length ? `${sec.heading}\n${rows.join('\n')}\n` : '';
    }).join('\n');
    const f = archiveName(dir, opts.today);
    fs.writeFileSync(f, `# Archived skill lines, ${opts.today}\n\n${text}`, { flag: 'wx' });
    note.push('archive written');
  } catch (e) {
    return stopped(e instanceof Stop ? e : new Stop('archive cannot be written'));
  }
  const written = new Set();
  for (const { item } of done) {
    const { res } = item;
    if (!res.entry || written.has(res.entry.skillname)) continue;
    written.add(res.entry.skillname);
    const w = addUserEntry(res.entry, { home: opts.home, moveCommit: res.kind === 'choice' });
    if (!w.ok) return stopped(new Stop(w.error));
    note.push(`${res.entry.skillname} in your list`);
  }
  try {
    writeSettings(s, opts, adds);
    note.push('selections written');
    clearLines(s, done.map((d) => d.item));
    note.push('lines cleared');
  } catch (e) {
    return stopped(e instanceof Stop ? e : new Stop('cannot write'));
  }
  for (const { item, roles } of done) out.push(`line ${item.n}: migrated, ${item.res.entry ? 'entry in your list, ' : ''}selected for ${roles.join(', ')}`);
  out.sort((a, b) => Number(/^line (\d+)/.exec(a)?.[1] ?? 0) - Number(/^line (\d+)/.exec(b)?.[1] ?? 0));
  return { ok: true, changed: true, lines: out };
}

// The project layer with the added selections, as a copy. `skip` leaves out names not to add.
function mergedLayer(data, adds, skip = () => false) {
  const layer = structuredClone(isPlain(data[KEY]) ? data[KEY] : { version: 1 });
  if (!isPlain(layer.roles)) layer.roles = {};
  for (const [role, list] of adds) {
    if (!isPlain(layer.roles[role])) layer.roles[role] = {};
    const have = Array.isArray(layer.roles[role].skills) ? layer.roles[role].skills : [];
    const next = have.slice();
    for (const item of list) {
      if (skip(item.name)) continue;
      const at = next.findIndex((x) => isPlain(x) && x.name === item.name);
      if (at === -1) next.push(item);
      else next[at] = { ...next[at], approved: item.approved };
    }
    layer.roles[role].skills = next;
  }
  return layer;
}

// Checks every Role's fields, but the skill list only on the Roles the run adds to: a stale list on another Role stays as it is.
function checkAdds(layer, adds, opts) {
  const scoped = {
    ...layer,
    roles: Object.fromEntries(Object.entries(layer.roles).map(([role, value]) => {
      if (adds.has(role) || !isPlain(value)) return [role, value];
      const { skills, ...rest } = value;
      return [role, rest];
    })),
  };
  const userLayer = readLayer('user', { home: opts.settingsHome }).layer;
  const reasons = checkLayers(userLayer, scoped, { home: opts.home, pluginRoot: opts.pluginRoot, levels: ['project'] });
  if (reasons.length > 0) throw new Stop(`project settings refused: ${reasons.map((r) => r.replace(/^project /, '')).join('; ')}`);
}

function writeSettings(s, opts, adds) {
  const data = s.project.data;
  const layer = mergedLayer(data, adds);
  checkAdds(layer, adds, opts);
  data[KEY] = layer;
  writePlain(s.project.file, `${JSON.stringify(data, null, 2)}\n`, s.project.id, 'project settings');
}

// Removes the migrated lines; a section left with no line gets its placeholder back.
function clearLines(s, items) {
  const drop = new Set(items.map((i) => i.n));
  const lines = s.lines.slice();
  for (const section of SECTIONS) {
    const body = sectionBody(lines, section.heading).filter(({ text }) => isBody(text, section.none));
    if (body.length === 0 || !body.every(({ n }) => drop.has(n))) continue;
    const eol = lines[body[0].n - 1].endsWith('\r') ? '\r' : '';
    lines[body[0].n - 1] = `${section.none}${eol}`;
    for (const { n } of body.slice(1)) drop.add(n);
    drop.delete(body[0].n);
  }
  const text = lines.filter((_, i) => !drop.has(i + 1)).join('\n');
  writePlain(s.file, text, s.read.id, 'project.md');
}

// ---------- pending and stale ----------

// How many skill lines the old sections hold, and how many of them migrate would offer. Both 0 with no
// project.md; any other problem reading it throws.
export function pendingCounts(options = {}) {
  const s = scan(normalize(options));
  const lines = s.items.filter(({ res }) => res.stay !== 'not a skill line');
  return { total: lines.length, migrate: lines.filter(({ res }) => !res.stay).length };
}

export function pending(options = {}) {
  return pendingCounts(options).total;
}

// True when no design skill is selected for a UI Role (the five in UI_FIRST), or the newest approval
// is over 180 days old or has no valid date. Reports only; approving again is not done here.
export function stale(options = {}) {
  const opts = normalize(options);
  const baseline = readBaseline();
  const catalog = readCatalog({ home: opts.home });
  const category = new Map(catalog.entries.map((e) => [e.skillname, e.skillcategory]));
  const resolved = resolveSettings({ home: opts.settingsHome, cwd: opts.cwd, pluginRoot: opts.pluginRoot });
  const names = new Set();
  let newest = null;
  for (const role of UI_FIRST.filter((r) => baseline.categories.design.includes(r))) {
    for (const sel of resolved.roles[role]?.skills ?? []) {
      if (category.get(sel.name) !== 'design') continue;
      names.add(sel.name);
      if (typeof sel.approved === 'string' && (newest === null || sel.approved > newest)) newest = sel.approved;
    }
  }
  let reason = null;
  if (names.size === 0) reason = 'no design selection';
  else if (newest === null) reason = 'no valid date';
  else {
    const days = (Date.parse(`${opts.today}T00:00:00Z`) - Date.parse(`${newest}T00:00:00Z`)) / 86400000;
    if (days > STALE_DAYS) reason = 'older than 180 days';
  }
  return { stale: reason !== null, reason, names: [...names].sort() };
}

// ---------- add and record ----------

const MAX_INPUT = 64 * 1024;
const MAX_ROLES_IN = 40;
const ADD_KEYS = ['name', 'repo', 'command', 'category', 'commit', 'license'];
const ADD_FLAGS = ['save', 'move'];
const ROLE_ONE_RE = /^[a-z][a-z0-9-]{0,40}$/;
const PROBE = { skillcategory: 'engineering', skillrepo: 'a/a', skillcommit: '0'.repeat(40), license: 'x' };
const USER_FILE_TEXT = '~/.mcsparrow/3rdpartyskills.json';

// One line of JSON from stdin. More than one non-empty line or more than 64 KiB is refused.
function readInput(ctx) {
  let text;
  if (typeof ctx.stdin === 'string') text = ctx.stdin;
  else {
    const chunks = [];
    const buf = Buffer.alloc(8192);
    let total = 0;
    for (;;) {
      let n;
      try { n = fs.readSync(0, buf, 0, buf.length, null); } catch { break; }
      if (n === 0) break;
      total += n;
      if (total > MAX_INPUT) throw new Stop('input is too large');
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    text = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(text) > MAX_INPUT) throw new Stop('input is too large');
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Stop('input is empty');
  if (lines.length > 1) throw new Stop('input has more than one line');
  let data;
  try { data = JSON.parse(lines[0]); } catch { throw new Stop('input is not valid JSON'); }
  if (!isPlain(data)) throw new Stop('input is not a JSON object');
  return data;
}

// Checks one field alone by building an entry around it from valid stand-ins.
function checkField(field, value) {
  let e;
  if (field === 'name') {
    if (/[:*]/.test(value)) return 'bad value';
    e = { ...PROBE, skillname: value };
  } else if (field === 'repo') e = { ...PROBE, skillname: 'probe', skillrepo: value };
  else if (field === 'command') e = { skillname: 'probe', skillcategory: 'engineering', skillinstaller: value, license: 'x' };
  else if (field === 'category') e = { ...PROBE, skillname: 'probe', skillcategory: value };
  else if (field === 'commit') e = { ...PROBE, skillname: 'probe', skillcommit: value };
  else e = { ...PROBE, skillname: 'probe', license: value };
  const v = validateEntry(e, 'user');
  return v.ok ? null : v.reason;
}

const sameSrc = (a, b) => (a.skillrepo ?? null) === (b.skillrepo ?? null) && (a.skillinstaller ?? null) === (b.skillinstaller ?? null) && (a.skillplugin ?? null) === (b.skillplugin ?? null);

// The name's standing against your list and the baseline for one source.
function standing(name, src, commit, catalog, baseline) {
  const user = catalog.entries.find((x) => x.skillname === name && (x.layer === 'user' || x.pinned === true));
  if (user) {
    if (!sameSrc(user, src)) return { error: 'taken' };
    if (src.skillrepo === undefined || commit === undefined) return src.skillrepo === undefined ? { error: 'taken' } : { user };
    return user.skillcommit === commit ? { error: 'taken' } : { pin: user };
  }
  const base = baseline.entries.find((x) => x.skillname === name);
  if (base) {
    if (base.skillrepo !== undefined && src.skillrepo === base.skillrepo) return { base };
    return { error: 'taken' };
  }
  return {};
}

export function add(input, options = {}) {
  const home = options.home;
  const catalog = readCatalog({ home });
  if (catalog.warnings.some((w) => w.includes('MCSPARROW_HOME'))) return { ok: false, lines: [catalog.warnings.find((w) => w.includes('MCSPARROW_HOME'))] };
  if (catalog.warnings.length > 0) return { ok: false, lines: ['ERROR user catalog: no home'] };
  if (catalog.errors.length > 0) return { ok: false, lines: [catalog.errors[0]] };
  const baseline = readBaseline();
  const fail = (line) => ({ ok: false, lines: [line] });

  for (const k of Object.keys(input)) if (!ADD_KEYS.includes(k) && !ADD_FLAGS.includes(k)) return fail('ERROR input: unknown field');
  for (const k of ADD_FLAGS) if (Object.hasOwn(input, k) && typeof input[k] !== 'boolean') return fail(`ERROR ${k}: bad value`);
  const given = {};
  for (const k of ADD_KEYS) {
    if (!Object.hasOwn(input, k)) continue;
    const v = input[k];
    if (typeof v !== 'string') return fail(`ERROR ${k}: bad value`);
    if (/[\r\n]/.test(v)) return fail(`ERROR ${k}: line break`);
    if (v === '') continue;
    const typed = k === 'license' ? licenseAsTyped(v) : v;
    if (typed === null) return fail(`ERROR ${k}: bad value`);
    const reason = checkField(k, typed);
    if (reason !== null) return fail(`ERROR ${k}: ${reason}`);
    given[k] = typed;
  }
  if (given.repo !== undefined && given.command !== undefined) return fail('ERROR command: a skill has one source, a repo or a command');
  if (given.commit !== undefined && given.repo === undefined) return fail('ERROR commit: needs a repo');
  const src = given.repo !== undefined ? { skillrepo: given.repo } : given.command !== undefined ? { skillinstaller: given.command } : null;

  const lines = [`ok: ${Object.keys(given).join(', ') || 'nothing yet'}`];
  let st = {};
  if (given.name !== undefined && src !== null) {
    st = standing(given.name, src, given.commit, catalog, baseline);
    if (st.error) return fail('ERROR name: taken');
  }
  if (st.pin) lines.push(`pin: ${st.pin.skillcommit.slice(0, 7)} -> ${given.commit.slice(0, 7)}`);

  const missing = [];
  if (given.name === undefined) missing.push('name');
  if (src === null) missing.push('repo or command');
  if (given.repo !== undefined && given.commit === undefined) missing.push('commit');
  if (given.category === undefined) missing.push('category');
  if (given.license === undefined) missing.push('license');
  if (missing.length > 0) {
    if (input.save === true) return fail(`ERROR input: missing ${missing.join(', ')}`);
    lines.push(`missing: ${missing.join(', ')}`);
    return { ok: true, lines };
  }
  if (input.move === true && !st.pin) return fail('ERROR move: no other commit in your list');

  const entry = { skillname: given.name, skillcategory: st.base ? st.base.skillcategory : given.category, ...src, license: given.license };
  if (given.commit !== undefined) entry.skillcommit = given.commit;
  const v = validateEntry(entry, 'user');
  if (!v.ok) return fail(`ERROR ${v.field} ${v.reason}`);
  const category = st.pin ? st.pin.skillcategory : v.entry.skillcategory;
  const roles = eligibleRoles({ skillcategory: category }, baseline.categories);
  lines.push('preview',
    `Name: ${given.name}`,
    ...(given.repo !== undefined ? [`Repo: ${given.repo}`, `Commit: ${given.commit}`] : [`Command: ${given.command} (stored text, aico never runs it)`]),
    `Category: ${category}`,
    `Roles that can select it: ${roles.join(', ')}`,
    `License: ${v.entry.license}, as you stated it; nothing checks it.`,
    given.repo !== undefined ? 'The scan runs when you install it. It stays not vetted until an install scans it clean.' : 'A skill added as a command is never scanned and shows as not vetted.',
    st.pin ? `Saving moves it to this commit in your list, ${USER_FILE_TEXT}, and clears its hash and vetted date; its category and selections stay; it installs nothing.`
      : `Saving adds it to your list, ${USER_FILE_TEXT}; it installs nothing.`);
  if (input.save !== true) return { ok: true, lines };
  if (st.pin && input.move !== true) return fail('ERROR name: another commit, set move to save it');
  const w = addUserEntry(v.entry, { home, moveCommit: input.move === true });
  if (!w.ok) return fail(w.error);
  return { ok: true, lines: [`saved: ${given.name}`] };
}

export function record(input, options = {}) {
  const opts = normalize(options);
  const fail = (line) => ({ ok: false, lines: [line] });
  try {
    for (const k of Object.keys(input)) if (k !== 'entry' && k !== 'license' && k !== 'roles') return fail('ERROR input: unknown field');
    const { entry, license, roles } = input;
    if (!isPlain(entry)) return fail('ERROR entry: bad value');
    for (const k of ['license', 'vetted', 'hash']) if (Object.hasOwn(entry, k)) return fail(`ERROR entry: ${k} not allowed`);
    const v = validateEntry(entry, 'baseline');
    if (!v.ok) return fail(`ERROR entry: ${v.field} ${v.reason}`);
    const e = v.entry;
    if (!Array.isArray(roles) || roles.length > MAX_ROLES_IN || roles.some((r) => typeof r !== 'string' || !ROLE_ONE_RE.test(r))) return fail('ERROR roles: bad value');
    if (license !== undefined && typeof license !== 'string') return fail('ERROR license: bad value');
    const chosen = [...new Set(roles)];

    const first = preflight(opts);
    if (first !== null) return fail(first);
    const catalog = readCatalog({ home: opts.home });
    const baseline = readBaseline();
    const user = catalog.entries.find((x) => x.skillname === e.skillname && (x.layer === 'user' || x.pinned === true));
    const base = baseline.entries.find((x) => x.skillname === e.skillname);
    const same = (x) => sameSrc(x, e) && (x.skillcommit ?? null) === (e.skillcommit ?? null);
    const existing = user ?? base;
    const needEntry = !(existing && same(existing));
    if (needEntry && existing && e.skillrepo === undefined) return fail('ERROR entry: source differs from the list');
    if (needEntry && !existing && e.skillrepo === undefined && e.skillplugin === undefined) return fail('ERROR entry: a command is in no list');

    const guarded = protectedRoles(opts.pluginRoot);
    const category = (existing ?? e).skillcategory;
    const offered = eligibleRoles({ skillcategory: category }, baseline.categories);
    const project = projectList(opts.cwd);
    for (const r of chosen) {
      if (!offered.includes(r) || guarded.has(r)) return fail('ERROR roles: a Role is not offered for this skill');
      const have = roleNames(project.data, r);
      if (!have.includes(e.skillname) && have.length >= MAX_ROLE_SKILLS) return fail('ERROR roles: a Role already has 5');
    }

    const out = [];
    if (needEntry) {
      const text = typeof license === 'string' ? licenseAsTyped(license) : '';
      if (text === null) return fail('ERROR license: bad value');
      if (text === '' || text === '-') return { ok: true, lines: [`no license stated: ${e.skillname}`] };
      const u = validateEntry({ ...e, license: text }, 'user');
      if (!u.ok) return fail(`ERROR license: ${u.reason}`);
      const w = addUserEntry(u.entry, { home: opts.home });
      if (!w.ok) return fail(w.error);
      out.push(w.changed ? `entry added: ${e.skillname}` : `entry unchanged: ${e.skillname}`);
    }
    if (chosen.length > 0) {
      const adds = new Map(chosen.map((r) => [r, [{ name: e.skillname, approved: opts.today }]]));
      writeSettings({ project }, opts, adds);
    }
    out.push(`recorded: ${e.skillname}${chosen.length ? `, Roles ${chosen.join(', ')}` : ''}`);
    return { ok: true, lines: out };
  } catch (err) {
    return fail(failLine(err, 'record failed'));
  }
}

const USAGE = [
  'role-skills add      one line of JSON on stdin: { name, repo | command, commit, category, license, save, move }',
  'role-skills record   one line of JSON on stdin: { entry, license, roles }',
  'role-skills migrate  [--apply] [--line <n>:<name>=<role>[,<role>]] [--category <n>:<name>=<key>] [--move <n>:<name>]',
  'role-skills pending | stale',
  'Values never go on the command line.'
];

// ---------- command line ----------

// Mirrors: the shell words of this command line. Only line numbers, skill names and Role ids in fixed patterns pass;
// no path, URL or free text is accepted. Threats covered: injection through values, oversize lists.
function parseArgs(args) {
  const o = { apply: false, choices: [], moves: [] };
  const categories = new Map();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--apply') { o.apply = true; continue; }
    if (a === '--category') {
      const m = CATEGORY_SPEC_RE.exec(args[++i] ?? '');
      if (!m || categories.has(Number(m[1]))) return null;
      categories.set(Number(m[1]), { name: m[2], category: m[3] });
      continue;
    }
    if (a === '--line' || a === '--move') {
      const v = args[++i];
      if (typeof v !== 'string') return null;
      if (a === '--move') { if (!SPEC_RE.test(v)) return null; o.moves.push(v); continue; }
      const eq = v.indexOf('=');
      const m = eq > 0 ? SPEC_RE.exec(v.slice(0, eq)) : null;
      const roles = eq > 0 ? v.slice(eq + 1) : '';
      if (!m || !ROLES_RE.test(roles)) return null;
      o.choices.push({ n: Number(m[1]), name: m[2], roles: [...new Set(roles.split(','))] });
      continue;
    }
    return null;
  }
  for (const [n, { name, category }] of categories) {
    const c = o.choices.find((x) => x.n === n && x.name === name);
    if (!c) return null;
    c.category = category;
  }
  return o;
}

export function main(args, ctx = {}) {
  const log = ctx.log ?? ((s) => console.log(s));
  const base = { cwd: ctx.cwd, home: ctx.home, today: ctx.today, pluginRoot: ctx.pluginRoot };
  const [cmd, ...rest] = args;
  try {
    if (cmd === 'pending' && rest.length === 0) {
      const c = pendingCounts(base);
      log(`pending: ${c.total}`);
      log(`can migrate: ${c.migrate}`);
      return 0;
    }
    if (cmd === 'stale' && rest.length === 0) {
      const r = stale(base);
      log(`stale: ${r.stale ? 'yes' : 'no'}${r.reason ? `, ${r.reason}` : ''}`);
      log(`design selections: ${r.names.length}${r.names.length ? ` (${r.names.join(', ')})` : ''}`);
      return 0;
    }
    if (cmd === 'migrate') {
      const o = parseArgs(rest);
      if (o === null) { log('ERROR usage: migrate [--apply] [--line <n>:<name>=<role>[,<role>]]... [--category <n>:<name>=<category>]... [--move <n>:<name>]...'); return 1; }
      const r = migrate({ ...base, ...o });
      r.lines.forEach(log);
      return r.ok ? 0 : 1;
    }
    if (cmd === 'help' && rest.length === 0) { USAGE.forEach(log); return 0; }
    if (cmd === 'add' || cmd === 'record') {
      if (rest.length > 0) { log(`ERROR usage: role-skills ${cmd} takes its values as one line of JSON on stdin, not on the command line`); return 1; }
      const input = readInput(ctx);
      const r = cmd === 'add' ? add(input, base) : record(input, base);
      r.lines.forEach(log);
      return r.ok ? 0 : 1;
    }
    log('ERROR usage: role-skills add | record | migrate | pending | stale | help');
    return 1;
  } catch (e) {
    log(failLine(e, 'role-skills failed'));
    return 1;
  }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
