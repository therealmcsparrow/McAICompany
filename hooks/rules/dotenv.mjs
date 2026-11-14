// dotenv.M-SEC1: deny any tool call whose path names a `.env` file.
// `.env` and `.env.<x>` deny; `.env.example`, `.env.sample`, `.env.template` pass.
// Pure: reads only the event it is given, returns a verdict.
import { normalizePath } from '../lib/paths.mjs';

const RULE = 'dotenv.M-SEC1';
const MESSAGE = 'aico guard dotenv.M-SEC1: .env files are not read or written';
const TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template']);
const MAX_PATH_CHARS = 4096;
const MAX_COMMAND_CHARS = 65536;
const SEPARATORS = /[\s;|&<>()"'`,=]+/;

function baseName(normalized) {
  const slash = normalized.lastIndexOf('/');
  const base = slash === -1 ? normalized : normalized.slice(slash + 1);
  return /^[a-z]:/.test(base) ? base.slice(2) : base;
}

const SHORT_NAME = /^env~\d+(\.[a-z0-9]{0,3})?$/i;
const GLOB_CHARS = /[*?[]/;
const GLOB_SAMPLES = ['.env', '.env.x'];

function globRegex(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '[') {
      const close = pattern.indexOf(']', i + 2);
      if (close === -1) out += '\\[';
      else {
        let body = pattern.slice(i + 1, close).replace(/\\/g, '\\\\');
        if (body[0] === '!') body = '^' + body.slice(1);
        out += '[' + body + ']';
        i = close;
      }
    } else out += c.replace(/[.+^${}()|\\\]]/g, '\\$&');
  }
  return out;
}

function globNamesDotenv(base) {
  if (!GLOB_CHARS.test(base) || base.length > 256) return false;
  const samples = base.includes('~') ? [...GLOB_SAMPLES, 'env~1'] : GLOB_SAMPLES;
  if (!base.startsWith('.') && !base.includes('~')) return false;
  let re;
  try { re = new RegExp('^' + globRegex(base) + '$', 'i'); } catch { return false; }
  return samples.some((sample) => re.test(sample) && !TEMPLATES.has(sample));
}

function namesDotenv(base) {
  if (TEMPLATES.has(base)) return false;
  if (base === '.env') return true;
  if (base.startsWith('.env.')) return true;
  if (SHORT_NAME.test(base)) return true;
  if (/^\.env[*?[{]/.test(base)) return true;
  return globNamesDotenv(base);
}

// Shell quote removal: quotes vanish, so .e''nv reads as .env; split only outside quotes.
function shellWords(command) {
  const words = [];
  let cur = '';
  let quote = '';
  const flush = () => { if (cur !== '') words.push(cur); cur = ''; };
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = '';
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      if (cur.endsWith('$')) cur = cur.slice(0, -1);
    } else if (/[\s;|&<>()`]/.test(c)) flush();
    else cur += c;
  }
  flush();
  return words;
}

function commandTokens(command) {
  const out = new Set(command.split(SEPARATORS));
  for (const word of shellWords(command)) {
    out.add(word);
    out.add(word.replace(/\\(.)/g, '$1'));
    for (const part of word.split(SEPARATORS)) out.add(part);
  }
  return out;
}

function deniesPath(raw) {
  if (typeof raw !== 'string' || raw === '') return false;
  if (raw.length > MAX_PATH_CHARS) return true;
  return namesDotenv(baseName(normalizePath(raw)));
}

function deniesToken(token) {
  if (token === '' || token.length > MAX_PATH_CHARS) return false;
  return namesDotenv(baseName(normalizePath(token)));
}

export function judge(event) {
  const tool = event?.tool;
  if (!tool || typeof tool !== 'object') return { v: 'allow' };
  const verdict = { v: 'deny', rule: RULE, message: MESSAGE };
  if (Array.isArray(tool.paths)) {
    for (const entry of tool.paths) {
      if (!entry || typeof entry !== 'object') continue;
      if (deniesPath(entry.raw) || deniesPath(entry.expanded) || deniesPath(entry.real)) return verdict;
    }
  }
  if (typeof tool.command === 'string') {
    for (const token of commandTokens(tool.command.slice(0, MAX_COMMAND_CHARS))) {
      if (deniesToken(token)) return verdict;
    }
  }
  return { v: 'allow' };
}
