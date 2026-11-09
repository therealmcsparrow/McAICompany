// Work folder names (contract: docs/contracts/work-folder-name.md v3.0). Pure logic, no imports:
// every file call goes through the `io` object the caller passes ({ fs, path, platform }).
// Every pattern is anchored and every input is length-capped before a pattern runs.

export const SUFFIXES = ['Build', 'Draft'];
export const MAX_TOPIC = 60;
export const MAX_WORDS = 5;
export const MAX_TOPIC_FILE = 4096;
const MAX_NAME = 120;
const MAX_NUMBER = 9;
const SEP = ' - ';

const TOPIC_RE = /^[A-Z0-9][A-Za-z0-9]*(?:[ -][A-Z0-9][A-Za-z0-9]*)*$/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LEGACY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2})$/;
const FORBIDDEN_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const NUMBER_RE = /^[2-9]$/;

export class WorkFolderRefusal extends Error {}

const refuse = reason => {
  throw new WorkFolderRefusal(reason);
};

const isSuffixWord = word => SUFFIXES.some(s => s.toLowerCase() === word.toLowerCase());
const capitalise = part => (part ? part[0].toUpperCase() + part.slice(1) : part);

// The allow-list for a Topic: ASCII Title Case words, at most 60 characters and 5 words, and a last
// non-numeric word that is not a suffix word.
export function checkTopic(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TOPIC) return false;
  if (!TOPIC_RE.test(text)) return false;
  const words = text.split(' ');
  if (words.length > MAX_WORDS) return false;
  for (let i = words.length - 1; i >= 0; i--) {
    if (/^[0-9]+$/.test(words[i])) continue;
    return !isSuffixWord(words[i]);
  }
  return true;
}

export function checkPlaybookId(id) {
  return typeof id === 'string' && id.length >= 1 && id.length <= 64 && ID_RE.test(id);
}

// Fallback Topic: the id with each hyphen part capitalised. null when it fails checkTopic.
export function fallbackTopic(id) {
  if (!checkPlaybookId(id)) return null;
  const topic = id.split('-').map(capitalise).join('-');
  return checkTopic(topic) ? topic : null;
}

export function isLegacySlug(name) {
  return typeof name === 'string' && LEGACY_RE.test(name);
}

function validStamp(stamp) {
  if (typeof stamp !== 'string' || stamp.length !== 16) return false;
  const m = STAMP_RE.exec(stamp);
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (h > 23 || mi > 59 || mo < 1 || mo > 12 || d < 1) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

// Local start time as `YYYY-MM-DD HH.MM`.
export function stampOf(date) {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
}

// A stem passes when it, or it minus one trailing ` <n>`, passes checkTopic.
function stemOk(stem) {
  if (checkTopic(stem)) return true;
  const cut = stem.length > 2 && stem[stem.length - 2] === ' ' && NUMBER_RE.test(stem[stem.length - 1]);
  return cut && checkTopic(stem.slice(0, -2));
}

// New names only. { stamp, stem, suffix, number } or null. A `Build` helper never takes a number.
export function parseName(name) {
  if (typeof name !== 'string' || name.length > MAX_NAME || name.length < 19) return null;
  const stamp = name.slice(0, 16);
  if (!validStamp(stamp) || name.slice(16, 19) !== SEP) return null;
  const words = name.slice(19).split(' ');
  let suffix = null;
  let number = null;
  const last = words[words.length - 1];
  const before = words[words.length - 2];
  if (words.length >= 3 && NUMBER_RE.test(last) && SUFFIXES.includes(before)) {
    if (before === 'Build') return null;
    number = Number(last);
    suffix = before;
    words.length -= 2;
  } else if (SUFFIXES.includes(last)) {
    suffix = last;
    words.length -= 1;
  }
  const stem = words.join(' ');
  if (!stemOk(stem)) return null;
  return { stamp, stem, suffix, number };
}

// Project ID: `P<yyyymmdd>.<n>`, a real date, n of 6 digits (not all zero) or 7 to 9 digits without a leading zero.
const PROJECT_RE = /^P(\d{4})(\d{2})(\d{2})\.(\d{6}|[1-9]\d{6,8})$/;
const PROJECT_TIME_RE = /^([01]\d|2[0-3])\.([0-5]\d)\.([0-5]\d)$/;
const BRANCH_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const MAX_PROJECT_ID = 19;
const MAX_PROJECT_NAME = 28;
const MAX_DESCRIPTION = 120;
const MAX_SIBLINGS = 20;
const MAX_ENTRIES = 5000;
const MAX_RUN_FOLDERS = 50;
const SUMMARY = '00-summary.md';
const SUMMARY_HEAD = 2048;
const SUMMARY_FULL = 1024 * 1024;
const KINDS = ['first', 'later', 'build', 'draft'];
const RUN_RE = /^Run: (first|later|build|draft) ([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const DESCRIPTION_BAD_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}᠎⁥\u{E0000}-\u{E007F}]/u;

function realDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function isProjectId(text) {
  if (typeof text !== 'string' || text.length > MAX_PROJECT_ID) return false;
  const m = PROJECT_RE.exec(text);
  if (!m || Number(m[4]) === 0) return false;
  return realDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

// `<ProjectID>-HH.MM.SS` -> { id, day, n, time } or null.
export function parseProject(name) {
  if (typeof name !== 'string' || name.length > MAX_PROJECT_NAME) return null;
  const cut = name.indexOf('-');
  if (cut < 0) return null;
  const id = name.slice(0, cut);
  const time = name.slice(cut + 1);
  if (!isProjectId(id) || !PROJECT_TIME_RE.test(time)) return null;
  return { id, day: id.slice(1, 9), n: Number(id.slice(10)), time };
}

// v3 run slug `<ProjectID>/<NN>-<playbook>`: NN 01-999, at most 80 characters. { id, nn, playbook } or null.
const MAX_RUN_SLUG = 80;
const RUN_SLUG_RE = /^(P\d{8}\.\d{6,9})\/(0[1-9]|[1-9]\d|[1-9]\d\d)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
export function parseRun(slug) {
  if (typeof slug !== 'string' || slug.length > MAX_RUN_SLUG) return null;
  const m = RUN_SLUG_RE.exec(slug);
  if (!m || !isProjectId(m[1]) || m[3].length > 64) return null;
  return { id: m[1], nn: m[2], playbook: m[3] };
}

export function projectIdOf(name) {
  const p = parseProject(name);
  if (p !== null) return p.id;
  const r = parseRun(name);
  return r === null ? null : r.id;
}

export function isBranchId(text) {
  if (typeof text !== 'string' || text.length > 128) return false;
  return isProjectId(text) || BRANCH_RE.test(text);
}

const dayOf = date => `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
const clockOf = date => `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
const validDate = date => date instanceof Date && !Number.isNaN(date.getTime());

// 1 plus the highest number among the v2 names and bare project folder names of that local day, else 000001.
export function nextProjectId(date, names) {
  if (!validDate(date)) return refuse('usage');
  const day = dayOf(date);
  let top = 0;
  for (const name of names) {
    const p = parseProject(name) ?? (isProjectId(name) ? { day: name.slice(1, 9), n: Number(name.slice(10)) } : null);
    if (p !== null && p.day === day && p.n > top) top = p.n;
  }
  const n = top + 1;
  const id = `P${day}.${n <= 999999 ? pad(n, 6) : String(n)}`;
  return isProjectId(id) ? id : refuse('bad project');
}

// One line, 1 to 120 characters, not only spaces, none of the Cc, Cf, Zl, Zp or Default_Ignorable_Code_Point characters or the other listed ones.
export function checkDescription(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_DESCRIPTION * 2) return false;
  if ([...text].length > MAX_DESCRIPTION || text.trim() === '') return false;
  return !DESCRIPTION_BAD_RE.test(text);
}

// { description } or { error }. The text itself is never in the result.
export function summaryDescription(text) {
  if (typeof text !== 'string') return { error: 'missing description' };
  const head = text.slice(0, SUMMARY_HEAD);
  const nl = head.indexOf('\n');
  const first = nl < 0 ? head : head.slice(0, nl);
  if (!checkDescription(first)) return { error: 'missing description' };
  if (nl >= 0 && nl + 1 < text.length && text[nl + 1] !== '\n') return { error: 'multi-line description' };
  return { description: first };
}

// Line 3: `Run: <kind> <playbook>` -> { kind, playbook } or null.
export function runOf(text) {
  if (typeof text !== 'string') return null;
  const line = text.slice(0, SUMMARY_HEAD).split('\n')[2];
  if (line === undefined || line.length > 80) return null;
  const m = RUN_RE.exec(line);
  return m && m[2].length <= 64 ? { kind: m[1], playbook: m[2] } : null;
}

const siblingsOk = line => {
  if (typeof line !== 'string' || !line.startsWith('Siblings: ') || line.length > 10 + MAX_SIBLINGS * 20) return false;
  const ids = line.slice(10).split(' ');
  return ids.length >= 1 && ids.length <= MAX_SIBLINGS && ids.every(isProjectId);
};

export function isWorkFolder(name) {
  return parseProject(name) !== null || parseName(name) !== null || isLegacySlug(name);
}

export function isRunSlug(text) {
  return parseRun(text) !== null || isWorkFolder(text);
}

// [id, '<NN>-<playbook>'] for a v3 slug, [name] for a v2, v1.1 or legacy name, null for neither.
export function workParts(slug) {
  const r = parseRun(slug);
  if (r !== null) return [r.id, slug.slice(r.id.length + 1)];
  return isWorkFolder(slug) ? [slug] : null;
}

// Flat key for file names: `<ProjectID>~<NN>-<playbook>` for a v3 slug, the name itself otherwise. null for neither.
export function runKey(slug) {
  const parts = workParts(slug);
  if (parts === null) return null;
  return parts.length === 2 ? `${parts[0]}~${parts[1]}` : slug;
}

// Reverse of runKey: `<ProjectID>~<NN>-<playbook>` -> `<ProjectID>/<NN>-<playbook>`; a work folder name -> itself; else null.
export function slugOfKey(key) {
  if (typeof key !== 'string' || key.length > MAX_RUN_SLUG) return null;
  if (isWorkFolder(key)) return key;
  const cut = key.indexOf('~');
  if (cut < 0 || key.indexOf('~', cut + 1) >= 0) return null;
  const slug = `${key.slice(0, cut)}/${key.slice(cut + 1)}`;
  return parseRun(slug) === null ? null : slug;
}

// Ticket ID rules of a folder: { id, head, src }. `src` is the ID as regex source (the dot escaped), `id` matches a whole
// ID, `head` matches an ID at the start of a heading. null when `name` is not a work folder.
const LOCAL_TICKET = 'T\\d{1,3}[a-z]?';
const TICKET_AFTER = '(?=$|[\\s:.)-])';
export function ticketPattern(name) {
  const pid = projectIdOf(name);
  if (pid === null && !isWorkFolder(name)) return null;
  const src = pid === null ? LOCAL_TICKET : `${pid.replace('.', '\\.')}-${LOCAL_TICKET}`;
  return { id: new RegExp(`^${src}$`), head: new RegExp(`^(${src})${TICKET_AFTER}`), src };
}

// A heading that opens a task section in either form (no folder known).
export function isTicketHeading(title) {
  if (typeof title !== 'string') return false;
  const text = title.slice(0, MAX_PROJECT_ID + 40);
  const cut = text.indexOf('-T');
  const rest = cut > 0 && cut <= MAX_PROJECT_ID && isProjectId(text.slice(0, cut)) ? text.slice(cut + 1) : text;
  return new RegExp(`^${LOCAL_TICKET}${TICKET_AFTER}`).test(rest);
}

// The `T<n>` part of a ticket ID, for file names inside a run folder; null when not an ID.
export function ticketLocal(id) {
  if (typeof id !== 'string' || id.length > MAX_PROJECT_ID + 8) return null;
  const cut = id.indexOf('-T');
  const local = cut > 0 && isProjectId(id.slice(0, cut)) ? id.slice(cut + 1) : id;
  return new RegExp(`^${LOCAL_TICKET}$`).test(local) ? local : null;
}

// Git ref part for a work folder name; legacy names map to themselves, a v2 name to its project ID.
export function branchId(name) {
  if (isLegacySlug(name)) return name;
  const pid = projectIdOf(name);
  if (pid !== null) return pid;
  const p = parseName(name);
  if (!p) return null;
  const rest = name.slice(19).toLowerCase().replaceAll(' ', '-');
  return `${name.slice(0, 10)}-${name.slice(11, 13)}${name.slice(14, 16)}-${rest}`;
}

// Candidate names of a new primary run: the plain name, then ` 2` to ` 9`.
export function candidates(stamp, topic) {
  if (!validStamp(stamp) || !checkTopic(topic)) return [];
  const out = [`${stamp}${SEP}${topic}`];
  for (let n = 2; n <= MAX_NUMBER; n++) out.push(`${stamp}${SEP}${topic} ${n}`);
  return out;
}

// First candidate for which isTaken(name) is false, or null.
export function newName(stamp, topic, isTaken) {
  return candidates(stamp, topic).find(name => !isTaken(name)) ?? null;
}

function legacyStem(slug) {
  const m = /^(.*?)-(?:build|draft)(?:-[2-9])?$/.exec(slug);
  const base = m ? m[1] : slug;
  return base.split('-').map(capitalise).join(' ');
}

// Helper folder name. `suffix` is Build or Draft; `stamp` is the new run's own local time (used by Draft);
// `fallback` is a draft-input `--for` word used only when a legacy parent's stem fails the Topic check;
// `isTaken(name)` says whether a name is in use. null: bad input, or every Draft number taken.
export function helperName(parent, suffix, { stamp, fallback, date, isTaken = () => false } = {}) {
  if (!SUFFIXES.includes(suffix)) return null;
  const pid = projectIdOf(parent);
  if (pid !== null) {
    if (!validDate(date)) return null;
    const name = `${pid}-${clockOf(date)}`;
    return isTaken(name) ? null : name;
  }
  let at;
  let stem;
  if (isLegacySlug(parent)) {
    if (suffix === 'Build') {
      const name = `${parent}-build`;
      return isLegacySlug(name) ? name : null;
    }
    at = stamp;
    stem = legacyStem(parent);
    if (!stemOk(stem)) {
      stem = fallback === undefined ? null : fallbackTopic(fallback);
      if (stem === null) return null;
    }
  } else {
    const p = parseName(parent);
    if (!p) return null;
    stem = p.stem;
    at = suffix === 'Build' ? p.stamp : stamp;
  }
  if (!validStamp(at)) return null;
  const base = `${at}${SEP}${stem} ${suffix}`;
  if (suffix === 'Build') return parseName(base) ? base : null;
  const names = [base];
  for (let n = 2; n <= MAX_NUMBER; n++) names.push(`${base} ${n}`);
  const free = names.find(name => !isTaken(name));
  return free !== undefined && parseName(free) ? free : null;
}

const asciiFold = text => text.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32));

// Exact-spelling check for `.company`, `work` and then each part of `rel` under `.company/work`, compared with the
// directory entries (same rule on every file system). 'exact': every part is listed as typed. 'missing': a part is
// not listed in any letter case. A part listed only in another ASCII letter case throws `wrong letter case`; the
// ASCII fold only picks these words, it never grants access. When twins exist the typed spelling wins.
export function exactWorkPath(io, root, rel = []) {
  const { fs, path } = io;
  let dir = root;
  for (const part of ['.company', 'work', ...rel]) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return 'missing';
    }
    if (!names.includes(part)) {
      const want = asciiFold(part);
      if (names.some(n => asciiFold(n) === want)) return refuse('wrong letter case');
      return 'missing';
    }
    dir = path.join(dir, part);
  }
  return 'exact';
}

// Real directory (no link) whose real path is where it should be.
function realDir(io, root, realRoot, rel) {
  const { fs, path } = io;
  const full = path.join(root, ...rel);
  let real;
  try {
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink() || !st.isDirectory()) return refuse('bad topic path');
    real = fs.realpathSync.native(full);
  } catch (error) {
    if (error instanceof WorkFolderRefusal) throw error;
    return refuse('bad topic path');
  }
  const want = path.join(realRoot, ...rel);
  if (real !== want) refuse('bad topic path');
  return full;
}

// Step 2 of the contract: `.company` and `.company/work` are real folders inside the real root. Returns their paths.
export function checkWorkDirs(io, root) {
  let realRoot;
  try {
    realRoot = io.fs.realpathSync.native(root);
  } catch {
    return refuse('bad topic path');
  }
  if (exactWorkPath(io, root) === 'missing') return refuse('bad topic path');
  const company = realDir(io, root, realRoot, ['.company']);
  const work = realDir(io, root, realRoot, ['.company', 'work']);
  return { company, work, realRoot };
}

function topicEntry(io, root, id) {
  if (!checkPlaybookId(id)) refuse('bad playbook');
  const { company, realRoot } = checkWorkDirs(io, root);
  const { fs, path } = io;
  const file = path.join(company, `work-folder-topic-${id}.txt`);
  let parent;
  try {
    parent = fs.realpathSync.native(path.dirname(file));
  } catch {
    return refuse('bad topic path');
  }
  const want = path.join(realRoot, '.company');
  if (parent !== want) refuse('bad topic path');
  let st = null;
  try {
    st = fs.lstatSync(file, { bigint: true });
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') refuse('bad topic path');
  }
  return { file, st };
}

function remove(io, file) {
  try {
    io.fs.unlinkSync(file);
  } catch {
    refuse('bad topic path');
  }
}

// The file text, or null when the entry is not safe to read or does not hold clean UTF-8.
function readSmall(io, file, st) {
  const { fs } = io;
  if (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1n || st.size > BigInt(MAX_TOPIC_FILE)) return null;
  const flags = fs.constants.O_RDONLY | (io.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW ?? 0));
  let fd;
  try {
    fd = fs.openSync(file, flags);
  } catch {
    return null;
  }
  try {
    const f = fs.fstatSync(fd, { bigint: true });
    if (!f.isFile() || f.dev !== st.dev || f.ino !== st.ino || f.nlink !== 1n || f.size > BigInt(MAX_TOPIC_FILE)) return null;
    const buf = Buffer.alloc(Number(f.size) + 1);
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    if (off > MAX_TOPIC_FILE) return null;
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf.subarray(0, off));
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// Steps 2-7 for one Topic file. mode `file`: a missing entry refuses `no topic file`. mode `none`: nothing is read,
// a stale entry is removed. Returns { topic } with the checked Topic, or { topic: null } for the fallback.
// The entry is removed whenever it exists, and never before the id and both folders passed.
export function readTopicFile(io, root, id, mode, check = checkTopic) {
  if (mode !== 'file' && mode !== 'none') refuse('usage');
  const { file, st } = topicEntry(io, root, id);
  if (st === null) {
    if (mode === 'file') refuse('no topic file');
    return { topic: null };
  }
  const text = mode === 'file' ? readSmall(io, file, st) : null;
  remove(io, file);
  if (text === null) return { topic: null };
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (FORBIDDEN_RE.test(body) || !check(body)) return { topic: null };
  return { topic: body };
}

// Steps 1-3 and 6 only: remove a stale Topic file. Returns `cleared` or `no topic file`.
export function clearTopicFile(io, root, id) {
  const { file, st } = topicEntry(io, root, id);
  if (st === null) return 'no topic file';
  remove(io, file);
  return 'cleared';
}

// Run folders of v2 projects.

const NOFOLLOW = io => (io.platform === 'win32' ? 0 : (io.fs.constants.O_NOFOLLOW ?? 0));

function isRealDirAt(io, full, want) {
  try {
    const st = io.fs.lstatSync(full);
    return !st.isSymbolicLink() && st.isDirectory() && io.fs.realpathSync.native(full) === want;
  } catch {
    return false;
  }
}

function listWork(io, work) {
  try {
    return io.fs.readdirSync(work);
  } catch {
    return refuse('bad topic path');
  }
}

// The real folders of one project under .company/work, in name order. A link or a plain file is skipped.
function projectFolders(io, realRoot, work, names, id) {
  const base = io.path.join(realRoot, '.company', 'work');
  return names
    .filter(n => projectIdOf(n) === id && isRealDirAt(io, io.path.join(work, n), io.path.join(base, n)))
    .sort();
}

// `00-summary.md` of one run folder opened by the full rule: real folder, real file inside the root (no link, one link
// count), the descriptor is the entry that was checked. { fd, size } or null.
function openSummary(io, realRoot, work, name, flag, leaf = SUMMARY) {
  const { fs, path } = io;
  const rel = [].concat(name);
  const realWork = path.join(realRoot, '.company', 'work');
  const base = path.join(realWork, ...rel);
  const file = path.join(work, ...rel, leaf);
  let fd = null;
  try {
    for (let i = 1; i <= rel.length; i++) {
      if (!isRealDirAt(io, path.join(work, ...rel.slice(0, i)), path.join(realWork, ...rel.slice(0, i)))) return null;
    }
    const st = fs.lstatSync(file, { bigint: true });
    if (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1n) return null;
    if (fs.realpathSync.native(file) !== path.join(base, leaf)) return null;
    fd = fs.openSync(file, flag | NOFOLLOW(io));
    const f = fs.fstatSync(fd, { bigint: true });
    if (!f.isFile() || f.dev !== st.dev || f.ino !== st.ino || f.nlink !== 1n) {
      fs.closeSync(fd);
      return null;
    }
    return { fd, size: Number(f.size) };
  } catch {
    if (fd !== null) fs.closeSync(fd);
    return null;
  }
}

// The summary text: only its first SUMMARY_HEAD bytes, or all of it (at most SUMMARY_FULL) when `full`. null when unsafe.
function readSummary(io, realRoot, work, name, full, leaf = SUMMARY) {
  const { fs } = io;
  const open = openSummary(io, realRoot, work, name, fs.constants.O_RDONLY, leaf);
  if (open === null) return null;
  try {
    const max = full ? SUMMARY_FULL : SUMMARY_HEAD;
    if (full && open.size > max) return null;
    const len = Math.min(open.size, max);
    const buf = Buffer.alloc(len);
    let off = 0;
    while (off < len) {
      const n = fs.readSync(open.fd, buf, off, len - off, off);
      if (n === 0) break;
      off += n;
    }
    const cuts = open.size > max ? 3 : 0;
    for (let cut = 0; cut <= cuts; cut++) {
      try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf.subarray(0, off - cut));
      } catch {
        // a cut inside a multi-byte character: try one byte less
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    fs.closeSync(open.fd);
  }
}

function writeSummary(io, realRoot, work, name, text, leaf = SUMMARY) {
  const { fs } = io;
  const open = openSummary(io, realRoot, work, name, fs.constants.O_WRONLY, leaf);
  if (open === null) return refuse('bad project');
  try {
    const buf = Buffer.from(text, 'utf8');
    fs.ftruncateSync(open.fd, 0);
    fs.writeSync(open.fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(open.fd);
  }
}

// Names under .company/archive and one folder level below it (never a link, never deeper).
function archiveNames(io, root, realRoot) {
  const { fs, path } = io;
  const read = dir => {
    try {
      return fs.readdirSync(dir).slice(0, MAX_ENTRIES);
    } catch {
      return [];
    }
  };
  const arch = path.join(root, '.company', 'archive');
  const realArch = path.join(realRoot, '.company', 'archive');
  if (!isRealDirAt(io, arch, realArch)) return [];
  const out = [];
  for (const n of read(arch)) {
    out.push(n);
    if (isRealDirAt(io, path.join(arch, n), path.join(realArch, n))) out.push(...read(path.join(arch, n)));
  }
  return out;
}

// Names that count for the next project ID: .company/work and .company/archive (two levels).
export function listProjectNames(io, root) {
  const { work, realRoot } = checkWorkDirs(io, root);
  return [...listWork(io, work), ...archiveNames(io, root, realRoot)];
}

function summaryText(description, kind, playbook, siblings) {
  return `${description}\n\nRun: ${kind} ${playbook}\n${siblings ? `${siblings}\n` : ''}`;
}

function makeFolder(io, work, name, text) {
  const { fs, path } = io;
  const dir = path.join(work, name);
  try {
    fs.mkdirSync(dir);
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    return refuse('bad topic path');
  }
  try {
    fs.writeFileSync(path.join(dir, SUMMARY), text, { flag: 'wx' });
  } catch (error) {
    try {
      fs.rmdirSync(dir);
    } catch {
      // the folder stays; the caller sees the original error
    }
    throw error;
  }
  return true;
}

// A new project: the next project ID and its first run folder, with the description in `00-summary.md`.
// An exact clash takes the next number at the same time, at most 9 tries. Returns { id, name }.
export function makeProject(io, root, date, description, playbook) {
  if (!checkDescription(description)) refuse('usage');
  if (!checkPlaybookId(playbook)) refuse('bad playbook');
  if (!validDate(date)) refuse('usage');
  const names = listProjectNames(io, root);
  const { work } = checkWorkDirs(io, root);
  const tried = [];
  for (let i = 0; i < 9; i++) {
    const id = nextProjectId(date, [...names, ...tried]);
    const name = `${id}-${clockOf(date)}`;
    if (makeFolder(io, work, name, summaryText(description, 'first', playbook, null))) return { id, name };
    tried.push(name);
  }
  return refuse('too many runs this second');
}

// A later run folder of an existing project; the only maker of a continuation folder. Returns the name.
export function makeRun(io, root, id, date, kind, playbook) {
  if (!isProjectId(id)) refuse('bad project');
  if (!KINDS.includes(kind)) refuse('usage');
  if (!checkPlaybookId(playbook)) refuse('bad playbook');
  if (!validDate(date)) refuse('usage');
  const { work, realRoot } = checkWorkDirs(io, root);
  const names = listWork(io, work);
  const folders = projectFolders(io, realRoot, work, names, id);
  if (folders.length === 0) refuse('unknown project');
  const name = `${id}-${clockOf(date)}`;
  if (names.includes(name)) refuse('too many runs this second');
  let description = null;
  let siblings = null;
  for (const folder of folders.slice(0, MAX_RUN_FOLDERS)) {
    const text = readSummary(io, realRoot, work, folder, false);
    if (text === null) continue;
    if (description === null) description = summaryDescription(text).description ?? null;
    if (siblings === null) {
      const line = text.slice(0, SUMMARY_HEAD).split('\n')[3];
      if (siblingsOk(line)) siblings = line;
    }
    if (description !== null && siblings !== null) break;
  }
  const text = summaryText(description ?? fallbackTopic(playbook) ?? 'Run', kind, playbook, siblings);
  if (!makeFolder(io, work, name, text)) refuse('too many runs this second');
  return name;
}

function withSiblings(text, line, at = 3) {
  const lines = text.split('\n');
  while (lines.length < at) lines.push('');
  if (lines[at]?.startsWith('Siblings:')) lines[at] = line;
  else lines.splice(at, 0, line);
  if (lines[lines.length - 1] !== '') lines.push('');
  return lines.join('\n');
}

// Line 4 of every folder of each listed project becomes `Siblings: <the other IDs>`. All checks and reads come before
// the first write. Returns the folder names.
export function linkSiblings(io, root, ids) {
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > MAX_SIBLINGS) refuse('usage');
  if (!ids.every(isProjectId) || new Set(ids).size !== ids.length) refuse('bad project');
  const { work, realRoot } = checkWorkDirs(io, root);
  const names = listWork(io, work);
  const plan = [];
  for (const id of ids) {
    const folders = projectFolders(io, realRoot, work, names, id);
    const v3 = names.includes(id);
    if (folders.length === 0 && !v3) refuse('unknown project');
    const line = `Siblings: ${ids.filter(x => x !== id).sort().join(' ')}`;
    if (v3) {
      const text = readSummary(io, realRoot, work, id, true, PROJECT_FILE);
      if (text === null || summaryDescription(text).description === undefined) refuse('bad project');
      plan.push({ folder: id, text: withSiblings(text, line, 2), leaf: PROJECT_FILE });
    }
    for (const folder of folders) {
      const text = readSummary(io, realRoot, work, folder, true);
      if (text === null || summaryDescription(text).description === undefined) refuse('bad project');
      plan.push({ folder, text: withSiblings(text, line), leaf: SUMMARY });
    }
  }
  for (const { folder, text, leaf } of plan) writeSummary(io, realRoot, work, folder, text, leaf);
  return plan.map(p => p.folder);
}

// v3 layout: a project folder `<ProjectID>` with `00-project.md` and one sub folder per run.

const PROJECT_FILE = '00-project.md';

function projectText(description, siblings) {
  return `${description}\n\n${siblings ? `${siblings}\n` : ''}`;
}

const runName = (nn, playbook) => `${nn < 100 ? pad(nn) : String(nn)}-${playbook}`;

function makeRunDir(io, work, realWork, id, run, text) {
  const { fs, path } = io;
  const dir = path.join(work, id, run);
  try {
    fs.mkdirSync(dir);
  } catch (error) {
    if (error.code === 'EEXIST') return refuse('too many runs');
    return refuse('bad topic path');
  }
  try {
    if (!isRealDirAt(io, dir, path.join(realWork, id, run))) refuse('bad topic path');
    fs.writeFileSync(path.join(dir, SUMMARY), text, { flag: 'wx' });
  } catch (error) {
    try {
      fs.rmdirSync(dir);
    } catch {
      // the folder stays; the caller sees the original error
    }
    throw error;
  }
}

// Makes `<id>/`, `00-project.md` and the first run folder. false when the project folder exists.
function makeProjectDir(io, work, realWork, id, text, first) {
  const { fs, path } = io;
  const dir = path.join(work, id);
  try {
    fs.mkdirSync(dir);
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    return refuse('bad topic path');
  }
  const file = path.join(dir, PROJECT_FILE);
  let wrote = false;
  try {
    if (!isRealDirAt(io, dir, path.join(realWork, id))) refuse('bad topic path');
    fs.writeFileSync(file, text, { flag: 'wx' });
    wrote = true;
    makeRunDir(io, work, realWork, id, first.run, first.text);
  } catch (error) {
    try {
      if (wrote) fs.unlinkSync(file);
      fs.rmdirSync(dir);
    } catch {
      // the folder stays; the caller sees the original error
    }
    throw error;
  }
  return true;
}

function checkRunPlaybook(id, playbook) {
  if (!checkPlaybookId(playbook)) refuse('bad playbook');
  if (parseRun(`${id}/01-${playbook}`) === null) refuse('bad playbook');
}

// A new v3 project: the next project ID, `00-project.md` and run `01-<playbook>`. Returns { id, name }.
export function makeProjectV3(io, root, date, description, playbook) {
  if (!checkDescription(description)) refuse('usage');
  if (!validDate(date)) refuse('usage');
  checkRunPlaybook('P20000101.000001', playbook);
  const names = listProjectNames(io, root);
  const { work, realRoot } = checkWorkDirs(io, root);
  const realWork = io.path.join(realRoot, '.company', 'work');
  const tried = [];
  const run = runName(1, playbook);
  const first = { run, text: summaryText(description, 'first', playbook, null) };
  for (let i = 0; i < 9; i++) {
    const id = nextProjectId(date, [...names, ...tried]);
    if (makeProjectDir(io, work, realWork, id, projectText(description, null), first)) return { id, name: `${id}/${run}` };
    tried.push(id);
  }
  return refuse('too many runs this second');
}

function nextRunNumber(io, work, id) {
  const { fs, path } = io;
  let entries;
  try {
    entries = fs.readdirSync(path.join(work, id)).slice(0, MAX_ENTRIES);
  } catch {
    return refuse('bad project');
  }
  let top = 0;
  for (const entry of entries) {
    const r = parseRun(`${id}/${entry}`);
    if (r === null || Number(r.nn) <= top) continue;
    try {
      const st = fs.lstatSync(path.join(work, id, entry));
      if (!st.isSymbolicLink() && st.isDirectory()) top = Number(r.nn);
    } catch {
      // skipped
    }
  }
  return top + 1;
}

// A later run of a project in the v3 layout. A v3 project gets the next `NN-<playbook>` folder; a project with only v2
// folders gets a v3 project folder (description and Siblings copied from them) and run 01. Returns the run slug.
export function makeRunV3(io, root, id, date, playbook) {
  if (!isProjectId(id)) refuse('bad project');
  checkRunPlaybook(id, playbook);
  if (!validDate(date)) refuse('usage');
  const { work, realRoot } = checkWorkDirs(io, root);
  const realWork = io.path.join(realRoot, '.company', 'work');
  const names = listWork(io, work);
  if (names.includes(id)) {
    if (!isRealDirAt(io, io.path.join(work, id), io.path.join(realWork, id))) refuse('bad project');
    const nn = nextRunNumber(io, work, id);
    if (nn > 999) refuse('too many runs');
    const head = readSummary(io, realRoot, work, id, false, PROJECT_FILE);
    const description = (head === null ? null : summaryDescription(head).description) ?? fallbackTopic(playbook) ?? 'Run';
    const run = runName(nn, playbook);
    makeRunDir(io, work, realWork, id, run, summaryText(description, 'later', playbook, null));
    return `${id}/${run}`;
  }
  const folders = projectFolders(io, realRoot, work, names, id);
  if (folders.length === 0) refuse('unknown project');
  let description = null;
  let siblings = null;
  for (const folder of folders.slice(0, MAX_RUN_FOLDERS)) {
    const text = readSummary(io, realRoot, work, folder, false);
    if (text === null) continue;
    if (description === null) description = summaryDescription(text).description ?? null;
    if (siblings === null) {
      const line = text.slice(0, SUMMARY_HEAD).split('\n')[3];
      if (siblingsOk(line)) siblings = line;
    }
    if (description !== null && siblings !== null) break;
  }
  description ??= fallbackTopic(playbook) ?? 'Run';
  const run = runName(1, playbook);
  const first = { run, text: summaryText(description, 'later', playbook, null) };
  if (!makeProjectDir(io, work, realWork, id, projectText(description, siblings), first)) refuse('too many runs');
  return `${id}/${run}`;
}
