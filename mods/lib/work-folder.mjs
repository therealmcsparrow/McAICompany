// Work folder names (contract: docs/contracts/work-folder-name.md v1.1). Pure logic, no imports:
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

export function isWorkFolder(name) {
  return parseName(name) !== null || isLegacySlug(name);
}

// Git ref part for a work folder name; legacy names map to themselves.
export function branchId(name) {
  if (isLegacySlug(name)) return name;
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
export function helperName(parent, suffix, { stamp, fallback, isTaken = () => false } = {}) {
  if (!SUFFIXES.includes(suffix)) return null;
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
export function readTopicFile(io, root, id, mode) {
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
  if (FORBIDDEN_RE.test(body) || !checkTopic(body)) return { topic: null };
  return { topic: body };
}

// Steps 1-3 and 6 only: remove a stale Topic file. Returns `cleared` or `no topic file`.
export function clearTopicFile(io, root, id) {
  const { file, st } = topicEntry(io, root, id);
  if (st === null) return 'no topic file';
  remove(io, file);
  return 'cleared';
}
