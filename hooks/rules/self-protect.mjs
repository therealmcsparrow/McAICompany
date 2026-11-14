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
  return { prot, entries, homes, mshs, plugins, bases };
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

const PS_HERE = /@(["'])[ \t]*\r?\n([\s\S]*?)\r?\n\1@([^\n]*)/g;
const PIPED_TEXT = /(["'])((?:\\.|(?!\1)[\s\S])*)\1[ \t]*\|[ \t]*([^\n|;&]*)/g;

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
  for (const m of text.matchAll(PS_HERE)) {
    if (headWords(m[3]).some(isStdinRunner) && programDenied(m[2])) return true;
  }
  for (const m of text.matchAll(PIPED_TEXT)) {
    if (headWords(m[3]).some(isStdinRunner) && programDenied(m[2])) return true;
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
      if (hits(ctx, t.word, t.ancestor)) return true;
      if (names && /^\$|\$\(/.test(t.word) && !VAR_LED.test(t.word)) return true;
      acc.writes.push(t.word);
    }
  }
  if (depth >= MAX_DEPTH) return false;
  return subshells.some((s) => analyze(ctx, s, powershell, depth + 1, acc));
}

function judgeShell(ctx, command, powershell) {
  const acc = { cd: false, cdProt: false, writes: [] };
  if (stdinProgramDenied(command) || dotnetWriteDenied(command)) return true;
  if (analyze(ctx, command, powershell, 0, acc)) return true;
  if (!acc.cd) return false;
  return acc.writes.some((w) => isRelative(w) && (acc.cdProt || ctx.bases.has(tailOf(normalizePath(w)))));
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
