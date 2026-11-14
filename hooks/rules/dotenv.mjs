// dotenv.M-SEC1: deny any tool call whose path names a `.env` file.
// `.env` and `.env.<x>` deny; `.env.example`, `.env.sample`, `.env.template` pass.
// Pure: reads only the event it is given, returns a verdict.
import { normalizePath } from '../lib/paths.mjs';

const RULE = 'dotenv.M-SEC1';
const MESSAGE = 'aico guard dotenv.M-SEC1: .env files are not read or written';
const TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template']);
const MAX_PATH_CHARS = 4096;
const SEPARATORS = /[\s;|&<>()"'`,=]+/;

function baseName(normalized) {
  const slash = normalized.lastIndexOf('/');
  const base = slash === -1 ? normalized : normalized.slice(slash + 1);
  return /^[a-z]:/.test(base) ? base.slice(2) : base;
}

function namesDotenv(base) {
  if (TEMPLATES.has(base)) return false;
  if (base === '.env') return true;
  if (base.startsWith('.env.')) return true;
  return /^\.env[*?[{]/.test(base);
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

export async function judge(event) {
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
    for (const token of tool.command.split(SEPARATORS)) {
      if (deniesToken(token)) return verdict;
    }
  }
  return { v: 'allow' };
}
