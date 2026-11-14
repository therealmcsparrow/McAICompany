// Guard self-protect.M-SEC1: plugin and settings files are not written by a tool call.
// judge(event, snapshot) is pure and synchronous: it reads the normalized event and returns a verdict object.
// It never reads the snapshot or the event env, so no stored switch weakens it.
import { normalizePath } from '../lib/paths.mjs';

const RULE = 'self-protect.M-SEC1';
const MESSAGE = 'aico guard self-protect.M-SEC1: plugin and settings files are protected; change them through the settings console.';
const MAX_COMMAND_CHARS = 200000;
const MAX_DEPTH = 3;
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

const SETTINGS_WORDS = [
  'settings.json', 'settings.local.json', 'config.json', '.mcsparrow', 'mcsparrow_home', 'hook-snapshots',
  'pins.json', 'rules.json', 'guard.jsonl', 'claude_plugin_root', '.claude', 'plugins/cache', 'plugins\\cache',
  'set-mod', 'hook-pins',
];
const FIXED_BASES = [
  'config.json', 'settings.json', 'settings.local.json', 'guard.jsonl', 'denies.jsonl', 'pins.json', 'rules.json', 'hooks.json',
];

const WRAPPERS = new Set(['env', 'sudo', 'nice', 'nohup', 'time', 'command', 'exec', 'builtin', '{', '}', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until']);
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

const CD_VERBS = new Set(['cd', 'pushd', 'set-location', 'sl', 'chdir', 'push-location']);
const WRITE_ALL = new Set(['tee', 'out-file', 'set-content', 'add-content', 'clear-content', 'sc', 'ac', 'new-item', 'ni', 'touch', 'truncate', 'mkdir', 'md', 'mklink']);
const WRITE_LAST = new Set(['cp', 'copy', 'copy-item', 'cpi', 'xcopy', 'robocopy', 'install', 'rsync', 'ln', 'scp']);
const MOVE = new Set(['mv', 'move', 'move-item', 'mi', 'rename-item', 'ren', 'rename']);
const DELETE = new Set(['rm', 'del', 'erase', 'rmdir', 'rd', 'remove-item', 'ri', 'unlink', 'shred']);
const GIT_WRITE = new Set(['checkout', 'restore', 'rm', 'mv']);
const GIT_GLOBAL_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const DEST_FLAGS = new Set(['-t', '--target-directory', '-destination', '-dest']);

const GLOB_CHARS = /[*?[{]/;
const RISKY_UNRESOLVED = /[*?[{$%`]/;
const MAX_GLOB_CHARS = 256;
const MAX_VARIANTS = 64;

const INTERPRETERS = {
  node: /^(?:--(?:e[v]al|print)(?:=|$)|-[a-z]*[ep][a-z]*$)/,
  nodejs: /^(?:--(?:e[v]al|print)(?:=|$)|-[a-z]*[ep][a-z]*$)/,
  python: /^-[A-Za-z]*c$/,
  python3: /^-[A-Za-z]*c$/,
  py: /^-[A-Za-z]*c$/,
  pwsh: /^-c(?:o|om|omm|omma|omman|ommand)?$/i,
  powershell: /^-c(?:o|om|omm|omma|omman|ommand)?$/i,
  bash: /^-[a-z]*c[a-z]*$/,
  sh: /^-[a-z]*c[a-z]*$/,
  zsh: /^-[a-z]*c[a-z]*$/,
  dash: /^-[a-z]*c[a-z]*$/,
  ksh: /^-[a-z]*c[a-z]*$/,
  cmd: /^\/[ck]$/i,
  perl: /^-[a-z]*e[a-z]*$/,
  ruby: /^-[a-z]*e[a-z]*$/,
};
const POWERSHELLS = new Set(['pwsh', 'powershell']);
const ENCODED = /^-(?:e|ec|en[a-z]*)$/i;
const EVAL_VERBS = new Set(['iex', 'invoke-expression']);
const RUNNERS = new Set(['node', 'nodejs', 'bun', 'deno', 'tsx', 'ts-node', 'npx', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd', 'python', 'python3', 'py', 'perl', 'ruby', 'start', 'call']);

const HOME_VAR = /^(?:~|\$HOME|\$\{HOME\}|\$env:HOME|\$env:USERPROFILE|%USERPROFILE%|%HOMEDRIVE%%HOMEPATH%)(?=[\\/]|$)/i;
const MSH_VAR = /^(?:\$MCSPARROW_HOME|\$\{MCSPARROW_HOME\}|\$env:MCSPARROW_HOME|%MCSPARROW_HOME%)(?=[\\/]|$)/i;
const PLUGIN_VAR = /^(?:\$CLAUDE_PLUGIN_ROOT|\$\{CLAUDE_PLUGIN_ROOT\}|\$env:CLAUDE_PLUGIN_ROOT|%CLAUDE_PLUGIN_ROOT%)(?=[\\/]|$)/i;

const VAR_LED = /^(?:~|\$(?:env:)?\{?(?:HOME|USERPROFILE|MCSPARROW_HOME|CLAUDE_PLUGIN_ROOT)|%(?:USERPROFILE|HOMEDRIVE|MCSPARROW_HOME|CLAUDE_PLUGIN_ROOT)%)/i;

function allow() {
  return { v: 'allow' };
}

function deny() {
  return { v: 'deny', rule: RULE, message: MESSAGE };
}

function stripHeredocs(text) {
  return text.replace(/(<<-?\s*(['"]?)(\w+)\2)([^\n]*)\n[\s\S]*?\n[ \t]*\3(?=\n|$)/g, '$1$4');
}

// Splits a command text into statements: words with quotes removed, and redirection targets.
// `onSubshell` receives the text of each double-quoted string that holds a command substitution.
function tokenize(text, powershell, onSubshell) {
  const stmts = [];
  let words = [];
  let redirs = [];
  let word = '';
  let has = false;
  let pending = null;
  const endWord = () => {
    if (has) {
      if (pending === 'out') redirs.push(word);
      else if (pending !== 'skip') words.push(word);
    }
    if (has) pending = null;
    word = '';
    has = false;
  };
  const endStmt = () => {
    endWord();
    pending = null;
    if (words.length || redirs.length) stmts.push({ words, redirs });
    words = [];
    redirs = [];
  };
  const n = text.length;
  const redirect = (from) => {
    if (has && /^\d+$/.test(word)) { word = ''; has = false; } else endWord();
    let i = from;
    while (text[i] === '>') i++;
    if (text[i] === '|') i++;
    if (text[i] === '&') { i++; pending = 'skip'; } else pending = 'out';
    return i - 1;
  };
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
        if (!powershell && d === '\\' && (text[j + 1] === '"' || text[j + 1] === '\\')) { piece += text[j + 1]; j += 2; continue; }
        piece += d;
        j++;
      }
      if (piece.includes('$(') || (!powershell && piece.includes('`'))) onSubshell(piece);
      word += piece;
      i = j;
    } else if (c === '\\' && text[i + 1] === '\n') {
      i++;
      endWord();
    } else if (c === '`') {
      if (powershell) {
        if (i + 1 < n) { has = true; word += text[i + 1]; i++; }
      } else {
        endStmt();
      }
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
    } else if (c === '\n' || c === ';' || c === '|' || c === '(' || c === ')') {
      endStmt();
    } else if (c === '&') {
      if (text[i + 1] === '>') i = redirect(i + 1);
      else endStmt();
    } else if (c === '>') {
      i = redirect(i);
    } else if (c === '<') {
      endWord();
      let j = i;
      while (text[j] === '<') j++;
      if (text[j] === '-') j++;
      pending = 'skip';
      i = j - 1;
    } else {
      has = true;
      word += c;
    }
  }
  endStmt();
  return stmts;
}

function baseOf(token) {
  const t = token.toLowerCase();
  const base = t.slice(Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\')) + 1);
  return base.replace(/\.(?:exe|cmd|bat|ps1)$/, '');
}

function tailOf(norm) {
  return norm.slice(norm.lastIndexOf('/') + 1);
}

function isFlag(a) {
  return a.startsWith('-') && a.length > 1;
}

function isRelative(word) {
  return !/^(?:[A-Za-z]:|[\\/]|~|\$|%)/.test(word);
}

function makeContext(event) {
  const tool = event.tool;
  const prot = [];
  if (Array.isArray(event.protected)) {
    for (const p of event.protected) {
      if (typeof p === 'string') {
        const norm = normalizePath(p);
        if (norm !== '') prot.push(norm);
      }
    }
  }
  const entries = new Map();
  if (Array.isArray(tool.paths)) {
    for (const e of tool.paths) {
      if (e && typeof e === 'object' && typeof e.raw === 'string' && !entries.has(e.raw)) entries.set(e.raw, e);
    }
  }
  const homes = new Set();
  const mshs = new Set();
  const plugins = new Set();
  for (const p of prot) {
    const h = /^(.+?)\/\.(?:mcsparrow|claude)(?=\/|$)/.exec(p);
    if (h) { homes.add(h[1]); mshs.add(`${h[1]}/.mcsparrow`); }
    const m = /^(.+)\/(?:config\.json|hook-snapshots)(?=\/|$)/.exec(p);
    if (m) mshs.add(m[1]);
    const pl = /^(.*\/plugins\/cache\/[^/]+\/[^/]+\/[^/]+)/.exec(p);
    if (pl) plugins.add(pl[1]);
  }
  const bases = new Set(FIXED_BASES);
  for (const p of prot) bases.add(tailOf(p));
  const protSegs = prot.map((p) => p.split('/'));
  const limited = entries.has('');
  return { prot, protSegs, entries, homes, mshs, plugins, bases, limited };
}

function insideProtected(ctx, norm) {
  if (norm === '') return false;
  return ctx.prot.some((p) => norm === p || norm.startsWith(`${p}/`));
}

function holdsProtected(ctx, norm) {
  if (norm === '' || !/^(?:[a-z]:|\/)/.test(norm)) return false;
  const pre = norm.endsWith('/') ? norm : `${norm}/`;
  return ctx.prot.some((p) => p.startsWith(pre));
}

function inferred(ctx, word) {
  const out = [];
  for (const [re, set] of [[HOME_VAR, ctx.homes], [MSH_VAR, ctx.mshs], [PLUGIN_VAR, ctx.plugins]]) {
    const m = re.exec(word);
    if (!m) continue;
    const rest = word.slice(m[0].length);
    for (const root of set) out.push(`${root}/${rest}`);
  }
  return out;
}

function forms(ctx, word) {
  const out = [word];
  const e = ctx.entries.get(word);
  if (e) {
    for (const k of ['expanded', 'real']) if (typeof e[k] === 'string') out.push(e[k]);
  }
  out.push(...inferred(ctx, word));
  return out;
}

function hits(ctx, word, ancestor) {
  if (VAR_LED.test(word) && namesSettingsWord(word)) return true;
  for (const f of forms(ctx, word)) {
    const norm = normalizePath(f);
    if (insideProtected(ctx, norm)) return true;
    if (ancestor && holdsProtected(ctx, norm)) return true;
  }
  return false;
}

function namesSettingsWord(text) {
  const t = text.toLowerCase();
  return SETTINGS_WORDS.some((w) => t.includes(w));
}

function nonFlags(args) {
  return args.filter((a) => !isFlag(a));
}

function destinationValues(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i].toLowerCase();
    if (DEST_FLAGS.has(a) && i + 1 < args.length) out.push(args[i + 1]);
    else if (a.startsWith('--target-directory=')) out.push(args[i].slice(19));
  }
  return out;
}

function inlineDenied(words) {
  for (let i = 0; i < words.length; i++) {
    const base = baseOf(words[i]);
    if (EVAL_VERBS.has(base)) {
      if (namesSettingsWord(words.slice(i + 1).join(' '))) return true;
      continue;
    }
    const flag = INTERPRETERS[base];
    if (!flag) continue;
    const rest = words.slice(i + 1);
    if (POWERSHELLS.has(base) && rest.some((a) => ENCODED.test(a))) return true;
    if (rest.some((a) => flag.test(a)) && namesSettingsWord(words.slice(i).join(' '))) return true;
  }
  return false;
}

function guardScriptDenied(words, vi, verb) {
  let settingsAt = -1;
  for (let i = 0; i < words.length; i++) {
    const b = baseOf(words[i]);
    if (b === 'hook-pins.mjs' && (i === vi || RUNNERS.has(verb))) return true;
    if (b === 'settings.mjs') settingsAt = i;
    else if (settingsAt !== -1 && words[i].toLowerCase() === 'set-mod') return true;
  }
  return false;
}

function verbIndex(words) {
  let i = 0;
  while (i < words.length) {
    const t = words[i];
    if (ENV_ASSIGN.test(t)) { i++; continue; }
    if (WRAPPERS.has(baseOf(t))) {
      i++;
      while (i < words.length && (isFlag(words[i]) || ENV_ASSIGN.test(words[i]))) i++;
      continue;
    }
    break;
  }
  return i;
}

function gitTargets(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += GIT_GLOBAL_VALUE.has(args[i]) ? 2 : 1;
  if (i >= args.length) return [];
  if (!GIT_WRITE.has(args[i].toLowerCase())) return [];
  return nonFlags(args.slice(i + 1));
}

// The first brace group that holds a comma list or a `..` sequence, as { i, j, cuts, seq }.
function braceGroup(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    let depth = 0;
    const cuts = [];
    let seq = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          if (cuts.length > 0 || seq) return { i, j, cuts, seq };
          break;
        }
      } else if (depth === 1 && c === ',') cuts.push(j);
      else if (depth === 1 && c === '.' && s[j + 1] === '.') seq = true;
    }
  }
  return null;
}

// Comma braces are expanded; a `{a..b}` sequence becomes `*`. Null when the result would pass the cap.
function expandBraces(word) {
  const work = [word];
  const done = [];
  while (work.length > 0) {
    if (work.length + done.length > MAX_VARIANTS) return null;
    const s = work.pop();
    const g = braceGroup(s);
    if (!g) { done.push(s); continue; }
    const head = s.slice(0, g.i);
    const tail = s.slice(g.j + 1);
    if (g.cuts.length === 0) { work.push(`${head}*${tail}`); continue; }
    const bounds = [g.i, ...g.cuts, g.j];
    for (let k = 0; k + 1 < bounds.length; k++) work.push(head + s.slice(bounds[k] + 1, bounds[k + 1]) + tail);
  }
  return done;
}

function setMatches(body, ch) {
  let negate = false;
  let i = 0;
  if (body[0] === '!' || body[0] === '^') { negate = true; i = 1; }
  const set = body.slice(i);
  if (set.includes('[:') || set.includes('[=') || set.includes('[.')) return true;
  let found = false;
  for (let k = 0; k < set.length; k++) {
    if (set[k + 1] === '-' && k + 2 < set.length) {
      if (set[k] > set[k + 2] || (ch >= set[k] && ch <= set[k + 2])) found = true;
      k += 2;
    } else if (set[k] === ch) found = true;
  }
  return negate ? !found : found;
}

// One path segment as glob tokens: literal, `?`, `*` or a bracket set.
function compileSeg(raw) {
  const seg = raw.replaceAll('\u0001', ':');
  const out = [];
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '*') {
      if (!out.length || out[out.length - 1].k !== '*') out.push({ k: '*' });
    } else if (c === '?') out.push({ k: '?' });
    else if (c === '[') {
      let j = i + 1;
      if (seg[j] === '!' || seg[j] === '^') j++;
      if (seg[j] === ']') j++;
      while (j < seg.length && seg[j] !== ']') {
        if (seg[j] === '[' && /[:=.]/.test(seg[j + 1] || '')) {
          const e = seg.indexOf(`${seg[j + 1]}]`, j + 2);
          if (e !== -1) { j = e + 2; continue; }
        }
        j++;
      }
      if (j >= seg.length) out.push({ k: 'c', c });
      else { out.push({ k: 'set', body: seg.slice(i + 1, j) }); i = j; }
    } else out.push({ k: 'c', c });
  }
  return out;
}

function oneMatches(t, ch) {
  if (t.k === '?') return true;
  if (t.k === 'set') return setMatches(t.body, ch);
  return t.c === ch;
}

// Greedy match with one star mark: work is at most the segment length times the pattern length.
function segMatches(tokens, str) {
  let p = 0;
  let s = 0;
  let star = -1;
  let mark = 0;
  while (s < str.length) {
    const t = tokens[p];
    if (t && t.k === '*') { star = p++; mark = s; }
    else if (t && oneMatches(t, str[s])) { p++; s++; }
    else if (star !== -1) { p = star + 1; s = ++mark; }
    else return false;
  }
  while (p < tokens.length && tokens[p].k === '*') p++;
  return p === tokens.length;
}

const segsMatch = (pat, segs) => pat.every((t, i) => segMatches(t, segs[i]));

function patternForms(ctx, word) {
  const out = new Set();
  for (const f of forms(ctx, word)) {
    out.add(normalizePath(f));
    out.add(normalizePath(/^[A-Za-z]:/.test(f) ? f.slice(0, 2) + f.slice(2).replaceAll(':', '\u0001') : f.replaceAll(':', '\u0001')));
  }
  out.delete('');
  return [...out];
}

// A glob-shaped write target hits when its pattern matches a protected path, or a folder above one when the
// verb acts on the folder itself. Absolute forms align from the root; relative ones align to the path's end.
function globHit(ctx, t, acc) {
  const w = t.word;
  if (!GLOB_CHARS.test(w)) return false;
  if (w.length > MAX_GLOB_CHARS) return true;
  const variants = expandBraces(w);
  if (variants === null) return true;
  acc.variants += variants.length;
  if (acc.variants > MAX_VARIANTS) return true;
  for (const v of variants) {
    const cands = patternForms(ctx, v);
    const abs = cands.filter((n) => /^(?:[a-z]:|\/)/.test(n));
    if (abs.length > 0) {
      for (const n of abs) {
        const pat = n.split('/').map(compileSeg);
        for (const ps of ctx.protSegs) {
          const len = Math.min(pat.length, ps.length);
          if (!segsMatch(pat.slice(0, len), ps)) continue;
          if (pat.length >= ps.length || t.ancestor) return true;
        }
      }
      continue;
    }
    for (const n of cands) {
      const segs = n.split('/');
      const pat = segs.map(compileSeg);
      for (const ps of ctx.protSegs) {
        const top = t.ancestor ? segs.length : ps.length;
        for (let end = ps.length; end >= top && end >= segs.length; end--) {
          if (segsMatch(pat, ps.slice(end - segs.length, end))) return true;
        }
      }
    }
  }
  return false;
}

// A relative glob after a directory change may name a protected base inside the new directory.
function globBaseHit(ctx, word) {
  if (!GLOB_CHARS.test(word)) return false;
  if (word.length > MAX_GLOB_CHARS) return true;
  const variants = expandBraces(word);
  if (variants === null) return true;
  for (const v of variants) {
    const tail = compileSeg(tailOf(v.replaceAll('\\', '/').toLowerCase()));
    for (const b of ctx.bases) if (segMatches(tail, b)) return true;
  }
  return false;
}

// Collects every write target of a statement as { word, ancestor }.
function targetsOf(words, redirs) {
  const out = redirs.map((word) => ({ word, ancestor: false }));
  const vi = verbIndex(words);
  if (vi >= words.length) return out;
  const verb = baseOf(words[vi]);
  const args = words.slice(vi + 1);
  const add = (list, ancestor) => { for (const word of list) out.push({ word, ancestor }); };
  if (WRITE_ALL.has(verb)) add(nonFlags(args), false);
  else if (WRITE_LAST.has(verb)) {
    const pos = nonFlags(args);
    if (pos.length) add([pos[pos.length - 1]], false);
    add(destinationValues(args), false);
  } else if (MOVE.has(verb)) {
    add(nonFlags(args), true);
    add(destinationValues(args), false);
  } else if (DELETE.has(verb)) add(nonFlags(args), true);
  else if (verb === 'sed' && args.some((a) => /^(?:-[A-Za-z]*i[A-Za-z.]*|--in-place(?:=.*)?)$/.test(a))) add(nonFlags(args), false);
  else if (verb === 'git') add(gitTargets(args), false);
  return out;
}

// Interpreter words whose standard input is a program. A heredoc or here-string on such a line is code, not data.
const STDIN_RUNNERS = new Set([...Object.keys(INTERPRETERS), 'bun', 'deno', 'tsx', 'ts-node', 'npx']);
const isStdinRunner = (word) => {
  const b = baseOf(word);
  return STDIN_RUNNERS.has(b) || /^(?:python|pypy|node)[\d.]*$/.test(b);
};
const HOMEISH = /homedir|expanduser|path\.home|environ|proces[s]\.env|userprofile|getenv|\$home|%userprofile%|\bhome\b/i;
const WRITEISH = /write|\bopen\s*\(|append|copy|rename|unlink|remove|truncate|\bcreate|\bsave|>>?\s*['"`]/i;
const HEREDOC = /<<-?[ \t]*(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)(?:\n[ \t]*\2(?=\n|$)|$)/g;
const HERESTRING = /^([^\n]*?)<<<([^\n]*)$/gm;

// A program fed to an interpreter on stdin denies when it names a settings word, or reaches for the home
// folder or environment and writes: the target may be built at run time, so it cannot be read from the text.
function programDenied(body) {
  return namesSettingsWord(body) || (HOMEISH.test(body) && WRITEISH.test(body));
}

const PS_HERE_OPEN = /@(["'])[ \t]*\r?\n/g;
const PIPE_AFTER = /[ \t]*\|[ \t]*([^\n|;&]*)/y;

// Quoted text followed by a pipe, found in one forward scan: [text, first words of the receiving command].
// A backslash skips the next character; a quote after a backslash also counts as a closer, so a text that ends in a
// lone backslash is still read. Each quote kind that never closes is dropped after one scan.
function* pipedTexts(text) {
  const unclosed = new Set();
  const pipeAt = (at) => { PIPE_AFTER.lastIndex = at; return PIPE_AFTER.exec(text); };
  let i = 0;
  while (i < text.length) {
    const q = text[i];
    if (q !== '"' && q !== "'") { i++; continue; }
    if (unclosed.has(q)) { i++; continue; }
    let j = i + 1;
    let escaped = null;
    let closer = -1;
    while (j < text.length) {
      const c = text[j];
      if (c === '\\') {
        if (text[j + 1] === q) {
          const hit = pipeAt(j + 2);
          if (hit) escaped = { at: j, end: PIPE_AFTER.lastIndex, rest: hit[1] };
        }
        j += 2;
        continue;
      }
      if (c === q) { closer = j; break; }
      j++;
    }
    const plain = closer >= 0 ? pipeAt(closer + 1) : null;
    if (plain) {
      yield [text.slice(i + 1, closer), plain[1]];
      i = PIPE_AFTER.lastIndex;
    } else if (escaped) {
      yield [text.slice(i + 1, escaped.at + 1), escaped.rest];
      i = escaped.end;
    } else if (closer >= 0) {
      i = closer + 1;
    } else {
      unclosed.add(q);
      i++;
    }
  }
}

// PowerShell here-strings found in one forward pass: [body, rest of the closing line].
function* psHereStrings(text) {
  const exhausted = new Set();
  let pos = 0;
  while (pos < text.length) {
    PS_HERE_OPEN.lastIndex = pos;
    const open = PS_HERE_OPEN.exec(text);
    if (!open) return;
    const q = open[1];
    const bodyStart = open.index + open[0].length;
    if (exhausted.has(q)) { pos = open.index + 1; continue; }
    const close = text.indexOf(`\n${q}@`, bodyStart);
    if (close === -1) { exhausted.add(q); pos = open.index + 1; continue; }
    const lineEnd = text.indexOf('\n', close + 3);
    const end = lineEnd === -1 ? text.length : lineEnd;
    const bodyEnd = close > bodyStart && text[close - 1] === '\r' ? close - 1 : close;
    yield [text.slice(bodyStart, bodyEnd), text.slice(close + 3, end)];
    pos = end;
  }
}

function stdinProgramDenied(text) {
  if (!/<<|@["']|\|/.test(text)) return false;
  const headWords = (head) => head.split(/[\s;|&()]+/).filter(Boolean);
  for (const m of text.matchAll(HEREDOC)) {
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const head = `${text.slice(lineStart, m.index)} ${m[3]}`;
    if (headWords(head).some(isStdinRunner) && programDenied(m[4])) return true;
  }
  for (const m of text.matchAll(HERESTRING)) {
    if (headWords(m[1]).some(isStdinRunner) && programDenied(m[2])) return true;
  }
  for (const [body, rest] of psHereStrings(text)) {
    if (headWords(rest).some(isStdinRunner) && programDenied(body)) return true;
  }
  for (const [body, rest] of pipedTexts(text)) {
    if (headWords(rest).some(isStdinRunner) && programDenied(body)) return true;
  }
  return false;
}

const NET_FILE_CALL = /\[(?:system\.)?io\.(?:file|directory)\]::(\w+)\s*\(\s*/gi;
const NET_WRITE_METHOD = /^(?:write|append|create|copy|move|delete|replace|set|openwrite|open$)/i;
const NET_WRITER_NEW = /(?:\[(?:system\.)?io\.(?:streamwriter|filestream|binarywriter)\]::new|new-object\s+(?:system\.)?io\.(?:streamwriter|filestream|binarywriter))\s*\(?\s*/gi;

// A .NET file write is allowed only when its first argument is a quoted literal that names no settings word.
function netTargetDenied(text, from) {
  const c = text[from];
  if (c !== '"' && c !== "'") return true;
  const end = text.indexOf(c, from + 1);
  if (end === -1) return true;
  const after = /^\s*([,)])/.exec(text.slice(end + 1, end + 20));
  if (!after) return true;
  const call = text.slice(from, text.indexOf(')', end) === -1 ? from + 400 : text.indexOf(')', end));
  return namesSettingsWord(text.slice(from, end + 1)) || namesSettingsWord(call);
}

function dotnetWriteDenied(text) {
  if (!text.includes('::') && !/new-object/i.test(text)) return false;
  for (const m of text.matchAll(NET_FILE_CALL)) {
    if (NET_WRITE_METHOD.test(m[1]) && netTargetDenied(text, m.index + m[0].length)) return true;
  }
  for (const m of text.matchAll(NET_WRITER_NEW)) {
    if (netTargetDenied(text, m.index + m[0].length)) return true;
  }
  return false;
}

// With the token list cut short, a target the host never resolved is judged by its text alone.
function unresolvedRisky(ctx, word) {
  if (ctx.entries.has(word)) return false;
  return RISKY_UNRESOLVED.test(word) || namesSettingsWord(word) || ctx.bases.has(tailOf(normalizePath(word)));
}

function analyze(ctx, text, powershell, depth, acc) {
  const subshells = [];
  const stripped = stripHeredocs(text);
  const stmts = tokenize(stripped, powershell, (s) => subshells.push(s));
  const names = namesSettingsWord(stripped);
  for (const { words, redirs } of stmts) {
    const vi = verbIndex(words);
    const verb = vi < words.length ? baseOf(words[vi]) : '';
    if (guardScriptDenied(words, vi, verb) || inlineDenied(words)) return true;
    if (CD_VERBS.has(verb)) {
      acc.cd = true;
      const target = nonFlags(words.slice(vi + 1))[0];
      if (target !== undefined && hits(ctx, target, false)) acc.cdProt = true;
    }
    for (const t of targetsOf(words, redirs)) {
      if (hits(ctx, t.word, t.ancestor) || globHit(ctx, t, acc)) return true;
      if (ctx.limited && unresolvedRisky(ctx, t.word)) return true;
      if (names && /^\$|\$\(/.test(t.word) && !VAR_LED.test(t.word)) return true;
      acc.writes.push(t.word);
    }
  }
  if (depth >= MAX_DEPTH) return false;
  return subshells.some((s) => analyze(ctx, s, powershell, depth + 1, acc));
}

function judgeShell(ctx, command, powershell) {
  const acc = { cd: false, cdProt: false, writes: [], variants: 0 };
  if (stdinProgramDenied(command) || dotnetWriteDenied(command)) return true;
  if (analyze(ctx, command, powershell, 0, acc)) return true;
  if (!acc.cd) return false;
  return acc.writes.some((w) => isRelative(w) && (acc.cdProt || ctx.bases.has(tailOf(normalizePath(w))) || globBaseHit(ctx, w)));
}

function judgeFile(ctx, tool) {
  if (!Array.isArray(tool.paths)) return false;
  for (const e of tool.paths) {
    if (!e || typeof e !== 'object') continue;
    for (const k of ['raw', 'expanded', 'real']) {
      if (typeof e[k] === 'string' && insideProtected(ctx, normalizePath(e[k]))) return true;
    }
  }
  return false;
}

export function judge(event) {
  const tool = event && event.tool;
  if (!tool || typeof tool !== 'object') return allow();
  const ctx = makeContext(event);
  if (FILE_TOOLS.has(tool.name)) return judgeFile(ctx, tool) ? deny() : allow();
  if (!SHELL_TOOLS.has(tool.name) || typeof tool.command !== 'string') return allow();
  if (tool.command.length > MAX_COMMAND_CHARS) return deny();
  return judgeShell(ctx, tool.command, tool.name === 'PowerShell') ? deny() : allow();
}
