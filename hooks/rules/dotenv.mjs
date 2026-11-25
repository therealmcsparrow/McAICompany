// dotenv.M-SEC1: deny any tool call whose path names a `.env` file.
// `.env` and `.env.<x>` deny; `.env.example`, `.env.sample`, `.env.template` pass.
// Pure: reads only the event it is given, returns a verdict. Anything it cannot decide denies.
import { normalizePath } from '../lib/paths.mjs';

const RULE = 'dotenv.M-SEC1';
const MESSAGE = 'aico guard dotenv.M-SEC1: .env files are not read or written';
const TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template']);
const MAX_PATH_CHARS = 4096;
const MAX_COMMAND_CHARS = 65536;
const SEPARATORS = /[\s;|&<>()"'`,=]+/;

// Replaces each `{a..b}` group (no `{`, `}` or `,` inside) by a star in one pass.
function starSequenceBraces(word) {
  let out = '';
  let i = 0;
  const n = word.length;
  while (i < n) {
    const open = word.indexOf('{', i);
    if (open === -1) break;
    let j = open + 1;
    while (j < n && word[j] !== '{' && word[j] !== '}' && word[j] !== ',') j += 1;
    out += word.slice(i, open);
    if (j < n && word[j] === '}' && word.slice(open + 1, j).includes('..')) {
      out += '*';
      i = j + 1;
    } else {
      out += word.slice(open, j);
      i = j;
    }
  }
  return out + word.slice(i);
}

function baseName(normalized) {
  const slash = normalized.lastIndexOf('/');
  const base = slash === -1 ? normalized : normalized.slice(slash + 1);
  return /^[a-z]:/.test(base) ? base.slice(2) : base;
}

const SHORT_NAME = /^env~\d+(\.[a-z0-9]{0,3})?$/i;
const GLOB_CHARS = /[*?[]/;
const GLOB_SAMPLES = ['.env', '.env.x', '.env.local', '.env.production', '.env.development', '.env.test'];
const MAX_GLOB_CHARS = 256;
const MAX_BRACE_ALTERNATIVES = 1024;
const BRACE_WORK_CHARS = 4 * 1024 * 1024;

const POSIX_CLASSES = {
  alpha: /[a-z]/i, digit: /[0-9]/, alnum: /[a-z0-9]/i, upper: /[A-Z]/, lower: /[a-z]/,
  xdigit: /[0-9a-f]/i, punct: /[!-/:-@[-`{-~]/, space: /\s/, blank: /[ \t]/,
  cntrl: /[\x00-\x1f\x7f]/, print: /[\x20-\x7e]/, graph: /[\x21-\x7e]/, word: /\w/,
};

// Parses a bracket expression at pattern[start]; null when it never closes (a literal bracket).
// A class or range it cannot read exactly makes the set match every character.
function parseSet(pattern, start) {
  let j = start + 1;
  let negate = false;
  let unsure = false;
  if (pattern[j] === '!' || pattern[j] === '^') { negate = true; j += 1; }
  const first = j;
  const items = [];
  while (j < pattern.length) {
    let c = pattern[j];
    if (c === ']' && j > first) {
      const test = (ch) => {
        const variants = [ch.toLowerCase(), ch.toUpperCase()];
        const hit = items.some((item) => variants.some((x) => (item.cls ? item.cls.test(x) : x >= item.lo && x <= item.hi)));
        return unsure ? true : (negate ? !hit : hit);
      };
      return { test, next: j };
    }
    if (c === '[' && pattern[j + 1] === ':') {
      const end = pattern.indexOf(':]', j + 2);
      if (end !== -1) {
        const name = pattern.slice(j + 2, end);
        if (Object.hasOwn(POSIX_CLASSES, name)) items.push({ cls: POSIX_CLASSES[name] }); else unsure = true;
        j = end + 2;
        continue;
      }
    }
    if (c === '\\' && j + 1 < pattern.length) { j += 1; c = pattern[j]; }
    if (pattern[j + 1] === '-' && j + 2 < pattern.length && pattern[j + 2] !== ']') {
      let lo = c;
      let hi = pattern[j + 2];
      if (lo > hi) { unsure = true; [lo, hi] = [hi, lo]; }
      items.push({ lo, hi });
      j += 3;
      continue;
    }
    items.push({ lo: c, hi: c });
    j += 1;
  }
  return null;
}

function globTokens(pattern) {
  const tokens = [];
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*') {
      if (!tokens.length || tokens[tokens.length - 1].t !== 'star') tokens.push({ t: 'star' });
    } else if (c === '?') tokens.push({ t: 'any' });
    else if (c === '[') {
      const set = parseSet(pattern, i);
      if (set) { tokens.push({ t: 'set', test: set.test }); i = set.next; } else tokens.push({ t: 'lit', c: '[' });
    } else if (c === '\\' && i + 1 < pattern.length) { i += 1; tokens.push({ t: 'lit', c: pattern[i].toLowerCase() }); }
    else tokens.push({ t: 'lit', c: c.toLowerCase() });
  }
  return tokens;
}

function tokenFits(token, ch) {
  if (token.t === 'any') return true;
  if (token.t === 'set') return token.test(ch);
  return token.c === ch.toLowerCase();
}

// Wildcard match with single-star backtracking: O(pattern * text), no regex.
function globMatches(tokens, text) {
  let ti = 0;
  let si = 0;
  let starT = -1;
  let starS = 0;
  while (si < text.length) {
    if (ti < tokens.length && tokens[ti].t === 'star') { starT = ti; starS = si; ti += 1; }
    else if (ti < tokens.length && tokenFits(tokens[ti], text[si])) { ti += 1; si += 1; }
    else if (starT !== -1) { starS += 1; si = starS; ti = starT + 1; }
    else return false;
  }
  while (ti < tokens.length && tokens[ti].t === 'star') ti += 1;
  return ti === tokens.length;
}

// A star that stands for a shell expansion is a guess, not a typed wildcard: a non-dot base
// from an expansion must hold a letter of the name and match `.env` itself.
// Bash `*` and `?` never match a leading dot, so a base typed in a Bash command that opens with one
// cannot name .env there. Tool path globs and PowerShell wildcards do match it (leadingWild).
function globNamesDotenv(base, fromExpansion, leadingWild) {
  if (!GLOB_CHARS.test(base)) return false;
  if (base.length > MAX_GLOB_CHARS) return true;
  if (!leadingWild && !fromExpansion && (base[0] === '*' || base[0] === '?')) return false;
  if (fromExpansion && !base.startsWith('.') && !base.includes('~') && !/[env]/i.test(base)) return false;
  const samples = base.includes('~') ? [...GLOB_SAMPLES, 'env~1'] : GLOB_SAMPLES;
  const tokens = globTokens(base);
  return samples.some((sample) => globMatches(tokens, sample));
}

// Finds the first top-level brace group holding a comma: { start, end, parts }.
function findBraceGroup(s) {
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\') { i += 1; continue; }
    if (s[i] !== '{') continue;
    let depth = 0;
    let last = i + 1;
    const parts = [];
    for (let j = i; j < s.length; j += 1) {
      const c = s[j];
      if (c === '\\') j += 1;
      else if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          if (!parts.length) break;
          parts.push(s.slice(last, j));
          return { start: i, end: j, parts };
        }
      } else if (c === ',' && depth === 1) { parts.push(s.slice(last, j)); last = j + 1; }
    }
  }
  return null;
}

// Brace expansion as the shell does it; null when the work bound is exceeded.
function expandBraces(text, budget) {
  if (!text.includes('{') || !text.includes(',')) return [text];
  const queue = [text];
  const done = [];
  while (queue.length) {
    const item = queue.pop();
    const group = findBraceGroup(item);
    if (!group) done.push(item);
    else {
      const head = item.slice(0, group.start);
      const tail = item.slice(group.end + 1);
      for (const part of group.parts) {
        const next = head + part + tail;
        budget.left -= next.length;
        queue.push(next);
      }
    }
    if (done.length + queue.length > MAX_BRACE_ALTERNATIVES || budget.left < 0) return null;
  }
  return done;
}

function namesDotenv(base, fromExpansion = false, leadingWild = true) {
  if (TEMPLATES.has(base)) return false;
  if (base === '.env') return true;
  if (base.startsWith('.env.')) return true;
  if (SHORT_NAME.test(base)) return true;
  if (/^\.env[*?[{]/.test(base)) return true;
  return globNamesDotenv(base, fromExpansion, leadingWild);
}

const ANSI_SIMPLE = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
const ANSI_NUMERIC = { x: [2, 16], u: [4, 16], U: [8, 16] };

// Decodes the ANSI-C escape whose letter sits at text[i]; returns [chars, next index].
function ansiEscape(text, i) {
  const c = text[i];
  const octal = c >= '0' && c <= '7';
  if (octal || Object.hasOwn(ANSI_NUMERIC, c)) {
    const [width, base] = octal ? [3, 8] : ANSI_NUMERIC[c];
    const digit = base === 8 ? /[0-7]/ : /[0-9a-f]/i;
    let j = octal ? i : i + 1;
    let n = '';
    while (j < text.length && n.length < width && digit.test(text[j])) { n += text[j]; j += 1; }
    if (n === '') return ['\\' + c, i + 1];
    const code = parseInt(n, base);
    return [code > 0x10ffff ? '' : String.fromCodePoint(code), j];
  }
  return [Object.hasOwn(ANSI_SIMPLE, c) ? ANSI_SIMPLE[c] : c, i + 1];
}

// Shell quote removal: quotes vanish and $'..' escapes decode, so .e''nv and $'.e\x6ev' read as .env.
function shellWords(command) {
  const words = [];
  let cur = '';
  let quote = '';
  let ansi = false;
  const flush = () => { if (cur !== '') words.push(cur); cur = ''; };
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote) {
      if (ansi && c === '\\' && i + 1 < command.length) {
        const [chars, next] = ansiEscape(command, i + 1);
        cur += chars;
        i = next - 1;
      } else if (c === quote) { quote = ''; ansi = false; }
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      ansi = c === "'" && cur.endsWith('$');
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

// True when any brace alternative of the spelling names a denied file; unbounded expansion denies.
function deniesSpelling(text, budget, fromExpansion = false, leadingWild = true) {
  const alternatives = expandBraces(text, budget);
  if (alternatives === null) return true;
  return alternatives.some((alt) => namesDotenv(baseName(normalizePath(alt)), fromExpansion, leadingWild)
    || (alt.includes('[') && namesDotenv(baseName(alt.replace(/\\/g, '/')), fromExpansion, leadingWild)));
}

function deniesPath(raw, budget) {
  if (typeof raw !== 'string' || raw === '') return false;
  if (raw.length > MAX_PATH_CHARS) return true;
  return deniesSpelling(raw, budget);
}

// An over-long token with no separator inside it is one path: it denies. One with separators
// is checked through its parts.
function deniesToken(token, budget, leadingWild) {
  if (token === '') return false;
  if (token.length > MAX_PATH_CHARS) return !SEPARATORS.test(token);
  return deniesSpelling(token, budget, false, leadingWild);
}

// A Bash command that starts PowerShell hands its words to PowerShell, whose wildcards match a leading dot.
const POWERSHELL_HOST = /powershell|pwsh/i;

const PARAM_NAME = /[A-Za-z0-9_]/;

// Index of the delimiter closing the group opened at text[open]; text.length when unclosed.
function groupEnd(text, open, openCh, closeCh) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === openCh) depth += 1;
    else if (text[i] === closeCh) { depth -= 1; if (depth === 0) return i; }
  }
  return text.length;
}

// Index of the last character of the expansion starting at text[i]; i when the dollar is literal.
function expansionEnd(text, i) {
  const next = text[i + 1];
  if (next === '(') return groupEnd(text, i + 1, '(', ')');
  if (next === '{') return groupEnd(text, i + 1, '{', '}');
  if (next !== undefined && PARAM_NAME.test(next)) {
    let j = i + 1;
    while (j + 1 < text.length && PARAM_NAME.test(text[j + 1])) j += 1;
    return j;
  }
  if (next !== undefined && '@*#?!$-'.includes(next)) return i + 1;
  return i;
}

// Words as the shell splits them, each expansion and sequence brace replaced by a star:
// whatever it yields, it may spell a dotenv name.
// With hosted set, the command is text for PowerShell: quote characters group nothing and expand everywhere.
function expansionWords(command, hosted = false) {
  const words = [];
  let cur = '';
  let quote = '';
  const flush = () => { if (cur !== '') words.push(starSequenceBraces(cur)); cur = ''; };
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (hosted && (c === '"' || c === "'")) continue;
    if (quote === "'") { if (c === "'") quote = ''; else cur += c; continue; }
    if (c === '$') {
      const end = expansionEnd(command, i);
      if (end > i) { cur += '*'; i = end; continue; }
    }
    if (c === '`') {
      const end = command.indexOf('`', i + 1);
      cur += '*';
      i = end === -1 ? command.length : end;
    } else if (quote) { if (c === quote) quote = ''; else cur += c; }
    else if (c === '"' || c === "'") quote = c;
    else if (/[\s;|&<>()]/.test(c)) flush();
    else cur += c;
  }
  flush();
  return words;
}

// A heredoc operator: `<<DELIM`, `<<-DELIM`, `<<'DELIM'`, `<<"DELIM"` or `<<\DELIM` (never `<<<`).
const HEREDOC_OP = /(?<!<)<<(?!<)(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([A-Za-z_][A-Za-z0-9_.-]*))/g;

// Splits heredoc bodies out of a command. The shell never glob-expands a body, so `.*` in code
// written through `cat > f <<'EOF'` names no file. A body may still be fed to a shell, so it is
// checked for literal dotenv names only. An unclosed body runs to the end.
function splitHeredocs(command) {
  const lines = command.split('\n');
  const shell = [];
  const bodies = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    shell.push(line);
    i += 1;
    for (const m of line.matchAll(HEREDOC_OP)) {
      const delim = m[2] ?? m[3] ?? m[4];
      const body = [];
      while (i < lines.length) {
        const l = lines[i].replace(/\r$/, '');
        i += 1;
        if ((m[1] === '-' ? l.replace(/^\t+/, '') : l) === delim) break;
        body.push(l);
      }
      bodies.push(body.join('\n'));
    }
  }
  return { shell: shell.join('\n'), bodies };
}

function literalDotenv(token) {
  const base = baseName(normalizePath(token.replace(/\\(.)/g, '$1')));
  if (TEMPLATES.has(base)) return false;
  return base === '.env' || base.startsWith('.env.') || SHORT_NAME.test(base);
}

function decide(event) {
  const tool = event?.tool;
  if (!tool || typeof tool !== 'object') return false;
  const budget = { left: BRACE_WORK_CHARS };
  const leadingWild = !(tool.name === 'Bash' && typeof tool.command === 'string' && !POWERSHELL_HOST.test(tool.command));
  if (Array.isArray(tool.paths)) {
    for (const entry of tool.paths) {
      if (!entry || typeof entry !== 'object') continue;
      if (deniesPath(entry.raw, budget) || deniesPath(entry.expanded, budget) || deniesPath(entry.real, budget)) return true;
    }
  }
  if (typeof tool.command === 'string') {
    if (tool.command.length > MAX_COMMAND_CHARS) return true;
    const { shell, bodies } = splitHeredocs(tool.command);
    for (const body of bodies) {
      if (body.split(SEPARATORS).some(literalDotenv)) return true;
    }
    for (const token of commandTokens(shell)) {
      if (deniesToken(token, budget, leadingWild)) return true;
    }
    for (const word of expansionWords(shell, tool.name === 'Bash' && POWERSHELL_HOST.test(tool.command))) {
      if (word.length > MAX_PATH_CHARS && !SEPARATORS.test(word)) return true;
      if (word.length <= MAX_PATH_CHARS && deniesSpelling(word, budget, true, leadingWild)) return true;
    }
  }
  return false;
}

export function judge(event) {
  let denied;
  try { denied = decide(event); } catch { denied = true; }
  return denied ? { v: 'deny', rule: RULE, message: MESSAGE } : { v: 'allow' };
}
