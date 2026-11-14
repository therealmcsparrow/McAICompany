// Guard git-add.M-SEC1: staging must name files one by one.
// judge(event, snapshot) is pure and synchronous: it reads the normalized event and returns a verdict object.
import { normalizePath } from '../lib/paths.mjs';

const RULE = 'git-add.M-SEC1';
const MESSAGE = 'aico guard git-add.M-SEC1: stage files by name, one path at a time; no all/update flags, directories, patterns or commit -a.';
const MAX_COMMAND_CHARS = 200000;
const MAX_DEPTH = 3;

const ADD_LONG = [
  'verbose', 'dry-run', 'force', 'interactive', 'patch', 'edit', 'update', 'all', 'no-all',
  'ignore-removal', 'no-ignore-removal', 'intent-to-add', 'refresh', 'ignore-errors', 'ignore-missing',
  'renormalize', 'chmod', 'pathspec-from-file', 'pathspec-file-nul', 'sparse', 'no-warn-embedded-repo',
];
const ADD_DENY = new Set(['all', 'update', 'no-ignore-removal', 'pathspec-from-file']);
const COMMIT_LONG = [
  'all', 'amend', 'author', 'date', 'message', 'file', 'template', 'reuse-message', 'reedit-message',
  'fixup', 'squash', 'signoff', 'no-signoff', 'verify', 'no-verify', 'edit', 'no-edit', 'allow-empty',
  'allow-empty-message', 'cleanup', 'status', 'no-status', 'quiet', 'verbose', 'dry-run', 'short',
  'branch', 'porcelain', 'long', 'null', 'only', 'include', 'interactive', 'patch', 'untracked-files',
  'gpg-sign', 'no-gpg-sign', 'trailer', 'pathspec-from-file', 'pathspec-file-nul', 'reset-author',
  'no-post-rewrite',
];
const COMMIT_DENY = new Set(['all', 'pathspec-from-file']);
const COMMIT_VALUE_LONG = new Set([
  'author', 'date', 'message', 'file', 'template', 'reuse-message', 'reedit-message', 'fixup', 'squash',
  'cleanup', 'trailer',
]);
const GIT_GLOBAL_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const FLAG_WRAPPERS = new Set(['env', 'sudo', 'nice', 'nohup', 'time', 'command']);
const KEYWORD_WRAPPERS = new Set(['exec', 'builtin', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '!']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd', 'eval']);
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

function allow() {
  return { v: 'allow' };
}

function resolveLong(name, list) {
  if (list.includes(name)) return name;
  if (name === '') return null;
  const hits = list.filter((l) => l.startsWith(name));
  return hits.length === 1 ? hits[0] : null;
}

function stripHeredocs(text) {
  return text.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2(?=\n|$)/g, ' ');
}

// Splits a command text into statements of unquoted words. Quotes are removed and adjacent
// pieces join into one word, as the shell does. `onSubshell` receives the text of each
// double-quoted string that holds a command substitution.
function split(text, powershell, onSubshell) {
  const stmts = [];
  let cur = [];
  let word = '';
  let has = false;
  let wordParen = 0;
  const endWord = () => {
    if (has) cur.push(word);
    word = '';
    has = false;
    wordParen = 0;
  };
  const endStmt = () => {
    endWord();
    if (cur.length) stmts.push(cur);
    cur = [];
  };
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (c === "'") {
      has = true;
      let j = text.indexOf("'", i + 1);
      if (j === -1) j = n;
      word += text.slice(i + 1, j);
      i = j;
    } else if (c === '"') {
      has = true;
      let j = i + 1;
      let piece = '';
      while (j < n && text[j] !== '"') {
        const d = text[j];
        if (powershell && d === '`' && j + 1 < n) { piece += text[j + 1]; j += 2; continue; }
        if (!powershell && d === '\\' && text[j + 1] === '"') { piece += '"'; j += 2; continue; }
        piece += d;
        j++;
      }
      if (piece.includes('$(') || (!powershell && piece.includes('`'))) onSubshell(piece);
      word += piece;
      i = j;
    } else if (c === '\\' && text[i + 1] === '\n') {
      i++;
      endWord();
    } else if (c === '\\' && text[i + 1] === '\r' && text[i + 2] === '\n') {
      i += 2;
      endWord();
    } else if (c === '`') {
      if (powershell) {
        if (text[i + 1] === '\n') { i++; endWord(); } else if (i + 1 < n) { has = true; word += text[i + 1]; i++; }
      } else {
        endStmt();
      }
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
    } else if (c === '\n' || c === ';' || c === '|' || c === '&') {
      endStmt();
    } else if (c === '<' || c === '>') {
      if (has && /^\d+$/.test(word)) { word = ''; has = false; }
      endStmt();
    } else if (c === '(') {
      if (!has || word === '$') { word = ''; has = false; endStmt(); } else { wordParen++; word += c; }
    } else if (c === ')') {
      if (wordParen > 0) { wordParen--; word += c; } else endStmt();
    } else if ((c === '{' || c === '}') && !has && /^[\s;]?$/.test(text[i + 1] ?? '')) {
      endStmt();
    } else {
      has = true;
      word += c;
    }
  }
  endStmt();
  return stmts;
}

function commandBase(token) {
  const bases = new Set();
  for (const t of [token, token.replaceAll('\\', '')]) {
    const base = t.slice(Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\')) + 1).toLowerCase();
    bases.add(base.endsWith('.exe') ? base.slice(0, -4) : base);
  }
  return [...bases];
}

function badPathspec(value, dirs) {
  let v = value;
  if (v.includes('$') || v.includes('`')) return true;
  if (v.startsWith(':')) {
    if (!v.startsWith(':/') || v === ':/') return true;
    v = v.slice(2);
  }
  if (/[*?[]/.test(v)) return true;
  const s = v.replaceAll('\\', '/');
  if (s.endsWith('/')) return true;
  if (/^[. ]*$/.test(s.slice(s.lastIndexOf('/') + 1))) return true;
  if (dirs.failClosed && !/[\\/]/.test(v) && !/^[~$%.]/.test(v) && !/\.[A-Za-z0-9]{1,8}$/.test(v)) return true;
  const norm = normalizePath(v);
  return norm !== '' && dirs.has(norm);
}

function judgeAdd(args, dirs) {
  let literal = false;
  for (const a of args) {
    if (literal) {
      if (badPathspec(a, dirs)) return true;
    } else if (a === '--') {
      literal = true;
    } else if (a.startsWith('--')) {
      const full = resolveLong(a.slice(2).split('=')[0], ADD_LONG);
      if (full !== null && ADD_DENY.has(full)) return true;
    } else if (a.startsWith('-') && a.length > 1) {
      if (/[Au]/.test(a.slice(1))) return true;
    } else if (badPathspec(a, dirs)) {
      return true;
    }
  }
  return false;
}

function judgeCommit(args, dirs) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return args.slice(i + 1).some((p) => badPathspec(p, dirs));
    if (a.startsWith('--')) {
      const full = resolveLong(a.slice(2).split('=')[0], COMMIT_LONG);
      if (full !== null && COMMIT_DENY.has(full)) return true;
      if (full !== null && COMMIT_VALUE_LONG.has(full) && !a.includes('=')) i++;
    } else if (a.startsWith('-') && a.length > 1) {
      for (let k = 1; k < a.length; k++) {
        const ch = a[k];
        if (ch === 'a') return true;
        if ('mFCct'.includes(ch)) {
          if (k === a.length - 1) i++;
          break;
        }
        if (ch === 'u' || ch === 'S') break;
      }
    } else if (badPathspec(a, dirs)) {
      return true;
    }
  }
  return false;
}

function judgeGit(args, dirs) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += GIT_GLOBAL_VALUE.has(args[i]) ? 2 : 1;
  if (i >= args.length) return false;
  const sub = args[i].replaceAll('\\', '').toLowerCase();
  const rest = args.slice(i + 1);
  if (sub === 'add' || sub === 'stage') return judgeAdd(rest, dirs);
  if (sub === 'commit') return judgeCommit(rest, dirs);
  return false;
}

function judgeStatement(toks, powershell, dirs, depth) {
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (ENV_ASSIGN.test(t)) { i++; continue; }
    const base = commandBase(t)[0];
    if (FLAG_WRAPPERS.has(base)) {
      i++;
      while (i < toks.length && (toks[i].startsWith('-') || ENV_ASSIGN.test(toks[i]))) i++;
      continue;
    }
    if (KEYWORD_WRAPPERS.has(base)) { i++; continue; }
    break;
  }
  if (i >= toks.length) return false;
  const bases = commandBase(toks[i]);
  const rest = toks.slice(i + 1);
  if (bases.includes('git')) return judgeGit(rest, dirs);
  if (depth < MAX_DEPTH && bases.some((b) => SHELLS.has(b))) {
    if (rest.some((t) => /git/i.test(t) && judgeText(t, powershell, dirs, depth + 1))) return true;
    return judgeText(rest.join(' '), powershell, dirs, depth + 1);
  }
  return false;
}

function judgeText(text, powershell, dirs, depth) {
  const subshells = [];
  const stmts = split(text, powershell, (s) => subshells.push(s));
  if (stmts.some((toks) => judgeStatement(toks, powershell, dirs, depth))) return true;
  if (depth >= MAX_DEPTH) return false;
  return subshells.some((s) => judgeText(stripHeredocs(s), powershell, dirs, depth + 1));
}

export function judge(event) {
  const tool = event && event.tool;
  if (!tool || (tool.name !== 'Bash' && tool.name !== 'PowerShell')) return allow();
  const command = tool.command;
  if (typeof command !== 'string') return allow();
  const deny = { v: 'deny', rule: RULE, message: MESSAGE };
  if (command.length > MAX_COMMAND_CHARS) return /git/i.test(command) ? deny : allow();
  const dirs = new Set();
  if (Array.isArray(tool.paths)) {
    for (const p of tool.paths) {
      if (p && p.dir === true && typeof p.raw === 'string') {
        const norm = normalizePath(p.raw);
        if (p.raw === '') dirs.failClosed = true;
        else if (norm !== '') dirs.add(norm);
      }
    }
  }
  return judgeText(command, tool.name === 'PowerShell', dirs, 0) ? deny : allow();
}
