#!/usr/bin/env node
// Decides whether a rule pack can be reused: prints `reuse` or `research <reason>` (rule-pack v1.2).
// Reasons are checked in this order and the first hit is printed: invalid, version, age, advisory.
import { lstatSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPack } from './check.mjs';

const MAX_BYTES = 256 * 1024;
const NEW_DAYS = 90;
const REPO_DAYS = 180;
const VERSION_RE = /^\d{1,6}(\.\d{1,6}){0,2}$/;
const COMPARATORS_RE = /^(?:>=|<=|>|<|=)?\d+(?:\.\d+){0,2}(?: (?:>=|<=|>|<|=)?\d+(?:\.\d+){0,2})*$/;
const COMPARATOR_RE = /^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_VERSIONS = 400;

const tuple = s => { const p = s.split('.').map(Number); while (p.length < 3) p.push(0); return p; };
function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

function dayNumber(s) {
  const m = DATE_RE.exec(s);
  if (!m) return NaN;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t / 86400000 : NaN;
}

const todayString = t => (typeof t === 'string' ? t : new Date().toISOString().slice(0, 10));

// Reads a regular file (no link) within the cap. `missing` is true only when nothing exists at the path.
function readPlain(file) {
  let st;
  try { st = lstatSync(file); } catch (e) { return { missing: e.code === 'ENOENT' || e.code === 'ENOTDIR', text: null }; }
  if (!st.isFile() || st.size > MAX_BYTES) return { missing: false, text: null };
  try { return { missing: false, text: readFileSync(file, 'utf8') }; } catch { return { missing: false, text: null }; }
}

function frontMatter(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const fm = new Map();
  for (const line of lines.slice(1, end)) {
    const m = /^([a-z]+):[ \t]*(.*)$/.exec(line);
    if (m) fm.set(m[1], m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'));
  }
  return fm;
}

function versionOk(version, versions, fileMajor) {
  if (typeof version !== 'string' || !VERSION_RE.test(version)) return false;
  if (typeof versions !== 'string' || versions.length === 0 || versions.length > MAX_VERSIONS) return false;
  const first = Number(version.split('.')[0]);
  const v = tuple(version);
  const dated = fileMajor === null || fileMajor >= 1000;
  if (!dated && first !== fileMajor) return false;
  if (COMPARATORS_RE.test(versions)) {
    return versions.split(' ').every(c => {
      const [, op = '=', num] = COMPARATOR_RE.exec(c);
      const r = compare(v, tuple(num));
      return op === '>=' ? r >= 0 : op === '<=' ? r <= 0 : op === '>' ? r > 0 : op === '<' ? r < 0 : r === 0;
    });
  }
  if (!dated) return true;
  return new RegExp(`(?<![0-9.\\-])${first}(?![0-9.\\-])`).test(versions);
}

const norm = p => (process.platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p);

// repo use earns the 180-day limit only for <root>/.company/standards.md that lists the pack under ## Packs.
function repoListed(standards, root, packName) {
  if (typeof standards !== 'string' || !standards) return false;
  const expected = join(resolve(root), '.company', 'standards.md');
  if (norm(resolve(standards)) !== norm(expected)) return false;
  try { if (!lstatSync(join(resolve(root), '.company')).isDirectory()) return false; } catch { return false; }
  const { text } = readPlain(expected);
  if (text === null) return false;
  let inPacks = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^## (.+)$/.exec(line);
    if (h) { inPacks = h[1].trim() === 'Packs'; continue; }
    if (!inPacks) continue;
    const m = /^- (\S+)/.exec(line);
    if (m && m[1].split(/[\\/]/).at(-1) === packName) return true;
  }
  return false;
}

// True when advisories.json next to the pack is unreadable, malformed, or has an entry for the tool dated after `researched`.
function advisoryHit(dir, tool, researched) {
  const { missing, text } = readPlain(join(dir, 'advisories.json'));
  if (missing) return false;
  if (text === null) return true;
  let data;
  try { data = JSON.parse(text); } catch { return true; }
  if (!Array.isArray(data)) return true;
  const since = dayNumber(researched);
  for (const e of data) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return true;
    if (!['tool', 'date'].every(k => Object.hasOwn(e, k) && typeof e[k] === 'string')) return true;
    const d = dayNumber(e.date);
    if (Number.isNaN(d)) return true;
    if (e.tool === tool && d > since) return true;
  }
  return false;
}

// Returns `reuse` or `research <invalid|version|age|advisory>`.
export function packFresh({ pack, version, use = 'new', standards, root = process.cwd(), today } = {}) {
  const file = typeof pack === 'string' && pack ? resolve(pack) : '';
  const name = basename(file);
  const { text } = file ? readPlain(file) : { text: null };
  if (text === null) return 'research invalid';
  const now = todayString(today);
  if (checkPack(text, { file: name, today: now, maxAgeDays: Infinity }).length) return 'research invalid';
  const fm = frontMatter(text);
  if (!fm) return 'research invalid';
  const mm = /^[^@]+@(\d+)\.md$/.exec(name);
  const fileMajor = mm && mm[1].length <= 9 ? Number(mm[1]) : null;
  if (!versionOk(version, fm.get('versions'), fileMajor)) return 'research version';
  const age = dayNumber(now) - dayNumber(fm.get('researched'));
  const limit = use === 'repo' && repoListed(standards, root, name) ? REPO_DAYS : NEW_DAYS;
  if (!(age <= limit)) return 'research age';
  if (advisoryHit(resolve(file, '..'), fm.get('tool'), fm.get('researched'))) return 'research advisory';
  return 'reuse';
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const args = process.argv.slice(2);
  const opts = {};
  const positional = [];
  let bad = false;
  for (let i = 0; i < args.length; i++) {
    if (['--version', '--use', '--standards', '--root'].includes(args[i])) {
      if (i + 1 >= args.length || Object.hasOwn(opts, args[i])) { bad = true; break; }
      opts[args[i]] = args[++i];
    } else if (args[i].startsWith('--')) { bad = true; break; } else positional.push(args[i]);
  }
  if (bad || positional.length !== 1) {
    console.error('usage: pack-fresh.mjs <pack> --version <v> [--use new|repo] [--standards <file>]');
    process.exit(2);
  }
  console.log(packFresh({
    pack: positional[0], version: opts['--version'], use: opts['--use'] === 'repo' ? 'repo' : 'new',
    standards: opts['--standards'], root: opts['--root'] ? resolve(opts['--root']) : process.cwd(),
  }));
}
