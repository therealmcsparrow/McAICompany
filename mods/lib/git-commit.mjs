// Finds a `git commit` in a Bash or PowerShell command line. Total: never throws.
// Doubt counts as a commit: what the parser cannot place but that names git and commit is one.

const MAX_PARSE = 65536;
const MAX_REPO = 4096;

const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'time', 'nohup', 'command', 'builtin', 'exec']);
const WRAPPERS = new Set([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe',
  'eval', 'sudo', 'doas', 'su', 'env', 'xargs', 'invoke-expression', 'iex', 'start-process', 'start', 'invoke-command', 'icm',
  'wsl', 'ssh', 'runas', 'nice', 'timeout', 'watch', 'script'
]);
const CD = new Set(['cd', 'chdir', 'set-location', 'sl', 'pushd', 'push-location']);
const GLOBAL_WITH_VALUE = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--attr-source']);
const LONG_WITH_VALUE = new Set([
  'message', 'file', 'author', 'date', 'reuse-message', 'reedit-message', 'fixup', 'squash', 'template', 'cleanup',
  'pathspec-from-file', 'trailer'
]);
const LONG_PLAIN = new Set([
  'amend', 'no-edit', 'edit', 'signoff', 'no-signoff', 'verify', 'no-verify', 'allow-empty', 'allow-empty-message', 'quiet',
  'verbose', 'dry-run', 'short', 'branch', 'porcelain', 'long', 'null', 'status', 'no-status', 'reset-author',
  'no-post-rewrite', 'gpg-sign', 'no-gpg-sign', 'untracked-files'
]);
const LONG_WORKTREE = new Set(['all', 'include', 'only', 'patch', 'interactive']);
const SHORT_WITH_VALUE = new Set(['m', 'F', 'C', 'c', 't']);
const SHORT_OPTIONAL_VALUE = new Set(['u', 'S']);
const SHORT_WORKTREE = new Set(['a', 'i', 'o', 'p']);

function isAbsolute(p) {
  return /^([/\\~$]|[A-Za-z]:)/.test(p);
}

function joinRepo(base, next) {
  if (base === null || isAbsolute(next)) return next;
  return `${base.replace(/[/\\]+$/, '')}/${next}`;
}

function cap(p) {
  return p.length > MAX_REPO ? p.slice(0, MAX_REPO) : p;
}

function namesGitAndCommit(text) {
  const git = /\bgit(?:\.exe)?\b/i.exec(text);
  if (!git) return false;
  return /\bcommit\b/.test(text.slice(git.index + git[0].length));
}

// Splits a command line into statements of unquoted tokens.
function parse(src, ps) {
  const statements = [];
  let tokens = [];
  let cur = '';
  let has = false;
  let start = 0;
  let unterminated = false;
  const endToken = () => {
    if (has) tokens.push(cur);
    cur = '';
    has = false;
  };
  const endStatement = (i) => {
    endToken();
    if (tokens.length > 0) statements.push({ tokens, raw: src.slice(start, i) });
    tokens = [];
    start = i + 1;
  };
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t') {
      endToken();
      i++;
    } else if (c === '\n' || c === '\r') {
      endStatement(i);
      i++;
    } else if (c === ';' || c === '(' || c === ')' || c === '{' || c === '}') {
      endStatement(i);
      i++;
    } else if (c === '|') {
      endStatement(i);
      i += src[i + 1] === '|' ? 2 : 1;
    } else if (c === '&') {
      if (src[i + 1] === '&') {
        endStatement(i);
        i += 2;
      } else if (ps && tokens.length === 0 && !has) {
        i++;
      } else {
        endStatement(i);
        i++;
      }
    } else if (c === '#' && !has) {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === "'") {
      has = true;
      const close = src.indexOf("'", i + 1);
      if (close === -1) {
        cur += src.slice(i + 1);
        unterminated = true;
        i = n;
      } else {
        cur += src.slice(i + 1, close);
        i = close + 1;
      }
    } else if (c === '"') {
      has = true;
      const esc = ps ? '`' : '\\';
      i++;
      let closed = false;
      while (i < n) {
        const d = src[i];
        if (d === esc && i + 1 < n) {
          cur += src[i + 1];
          i += 2;
        } else if (d === '"') {
          closed = true;
          i++;
          break;
        } else {
          cur += d;
          i++;
        }
      }
      if (!closed) unterminated = true;
    } else if ((ps && c === '`') || (!ps && c === '\\')) {
      if (src[i + 1] === '\n') i += 2;
      else if (src[i + 1] === '\r' && src[i + 2] === '\n') i += 3;
      else if (i + 1 < n) {
        has = true;
        cur += src[i + 1];
        i += 2;
      } else i++;
      if (src[i - 1] === '\n') endToken();
    } else {
      has = true;
      cur += c;
      i++;
    }
  }
  endStatement(n);
  return { statements, unterminated };
}

function baseName(token) {
  const cut = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'));
  return (cut === -1 ? token : token.slice(cut + 1)).toLowerCase();
}

// The scope and the options of the commit that starts at toks[i] (the word `commit`).
function commitScope(toks, i) {
  let worktree = false;
  for (let j = i + 1; j < toks.length; j++) {
    const t = toks[j];
    if (t === '--') {
      if (j + 1 < toks.length) worktree = true;
      break;
    }
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const name = eq === -1 ? t.slice(2) : t.slice(2, eq);
      if (LONG_WORKTREE.has(name)) worktree = true;
      else if (LONG_WITH_VALUE.has(name)) {
        if (eq === -1) j++;
      } else if (!LONG_PLAIN.has(name)) worktree = true;
    } else if (t.startsWith('-') && t.length > 1) {
      for (let k = 1; k < t.length; k++) {
        const ch = t[k];
        if (SHORT_WORKTREE.has(ch)) worktree = true;
        if (SHORT_WITH_VALUE.has(ch)) {
          if (k === t.length - 1) j++;
          break;
        }
        if (SHORT_OPTIONAL_VALUE.has(ch)) break;
      }
    } else {
      worktree = true;
    }
  }
  return worktree ? 'worktree' : 'staged';
}

function analyse(statement, ps, cwd) {
  const toks = statement.tokens.slice();
  for (;;) {
    const t = toks[0];
    if (t === undefined) return { kind: 'none' };
    if (KEYWORDS.has(t) || (!ps && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) || (ps && /^\$env:[^=]*=/i.test(t))) toks.shift();
    else break;
  }
  const prog = baseName(toks[0]);
  if (CD.has(prog)) {
    let target = '~';
    for (let j = 1; j < toks.length; j++) {
      const t = toks[j];
      if (/^-(path|literalpath)$/i.test(t)) {
        if (toks[j + 1] !== undefined) target = toks[j + 1];
        break;
      }
      if (!t.startsWith('-') || t === '-') {
        target = t;
        break;
      }
    }
    return { kind: 'cd', target: cap(target) };
  }
  if (WRAPPERS.has(prog)) return namesGitAndCommit(statement.raw) ? { kind: 'commit', scope: 'worktree', repo: cwd } : { kind: 'none' };
  if (prog !== 'git' && prog !== 'git.exe') return { kind: 'none' };
  let repo = null;
  let i = 1;
  while (i < toks.length && toks[i].startsWith('-')) {
    const t = toks[i];
    if (t === '-C') {
      if (toks[i + 1] !== undefined) repo = joinRepo(repo, toks[i + 1]);
      i += 2;
    } else if (GLOBAL_WITH_VALUE.has(t)) i += 2;
    else i++;
  }
  if (toks[i] !== 'commit') return { kind: 'none' };
  return { kind: 'commit', scope: commitScope(toks, i), repo: repo === null ? cwd : isAbsolute(repo) ? repo : joinRepo(cwd, repo) };
}

const NOT = Object.freeze({ isCommit: false, scope: null, repo: null });

function doubt(repo) {
  return { isCommit: true, scope: 'worktree', repo };
}

function intent(command, ps) {
  if (typeof command !== 'string') return { ...NOT };
  if (command.length > MAX_PARSE) return namesGitAndCommit(command) ? doubt(null) : { ...NOT };
  const { statements, unterminated } = parse(command, ps);
  let cwd = null;
  let found = null;
  for (const st of statements) {
    const r = analyse(st, ps, cwd);
    if (r.kind === 'cd') cwd = joinRepo(cwd, r.target);
    else if (r.kind === 'commit') {
      if (found === null) found = r;
      else if (r.scope === 'worktree') found = { ...found, scope: 'worktree' };
    }
  }
  if (found !== null) return { isCommit: true, scope: found.scope, repo: found.repo === null ? null : cap(found.repo) };
  const substitution = ps ? command.includes('$(') : command.includes('$(') || command.includes('`');
  if ((unterminated || substitution) && namesGitAndCommit(command)) return doubt(cwd === null ? null : cap(cwd));
  return { ...NOT };
}

// shell: 'bash' or 'powershell'. Returns { isCommit, scope: 'staged' | 'worktree' | null, repo: string | null }.
export function commitIntent(command, shell) {
  try {
    return intent(command, shell === 'powershell');
  } catch {
    return typeof command === 'string' ? doubt(null) : { ...NOT };
  }
}
