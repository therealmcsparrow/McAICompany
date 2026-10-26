// Finds a `git commit` in a Bash or PowerShell command line. Total: never throws.
// Detection is an allow-list. A command is not a commit only when every statement is a cd, a harmless text tool,
// or `git` with a literal subcommand from ALLOWED. Anything else that could commit counts as a commit, and the
// gate then asks: a program name or subcommand the parser cannot read, an alias, another program whose text
// names git and commit, a repository or index override. The gate always reads worktree, staged and untracked
// files, so a result carries no scope.

const MAX_PARSE = 65536;
const MAX_REPO = 4096;

const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'time', 'nohup', 'command', 'builtin', 'exec']);
const CD = new Set(['cd', 'chdir', 'set-location', 'sl', 'pushd', 'push-location']);

// Programs that only print, search or list, or shell words that run nothing: their text may name git and commit.
const HARMLESS = new Set([
  'echo', 'printf', 'write-output', 'write-host', 'write-error', 'write-warning', 'write-verbose', 'write-information',
  'grep', 'egrep', 'fgrep', 'select-string', 'sls', 'cat', 'type', 'get-content', 'gc', 'ls', 'dir', 'gci', 'get-childitem',
  'head', 'tail', 'wc', 'sort', 'uniq', 'pwd', 'true', 'false', 'fi', 'done', 'esac', 'test', 'sleep', 'which', 'where', 'date',
  'get-date', 'mkdir', 'touch', 'export', 'unset', 'exit', 'set'
]);

// git subcommands that never create a commit on a branch (stash keeps its work on its own ref).
const ALLOWED = new Set([
  'status', 'log', 'diff', 'show', 'add', 'stage', 'fetch', 'push', 'branch', 'tag', 'remote', 'ls-files', 'ls-tree', 'ls-remote',
  'rev-parse', 'rev-list', 'blame', 'annotate', 'grep', 'describe', 'config', 'init', 'clone', 'checkout', 'switch', 'restore', 'reset',
  'stash', 'mv', 'rm', 'clean', 'shortlog', 'whatchanged', 'show-ref', 'show-branch', 'cat-file', 'diff-tree', 'diff-index',
  'diff-files', 'for-each-ref', 'merge-base', 'name-rev', 'version', 'help', 'worktree', 'gc', 'fsck', 'count-objects', 'reflog',
  'archive', 'format-patch', 'symbolic-ref', 'check-ignore', 'check-attr', 'var', 'commit-graph', 'range-diff', 'verify-commit',
  'verify-tag', 'apply', 'sparse-checkout', 'maintenance', 'prune', 'pack-refs', 'repack'
]);
// Subcommands that take options which run a program (git accepts abbreviated and clustered options, and clone has its own -c):
// when the command names a commit they are never cleared, whatever their options.
const RUNS_PROGRAMS = new Set(['clone', 'fetch', 'push', 'ls-remote', 'archive', 'grep']);
const GLOBAL_PLAIN = new Set([
  '-p', '--paginate', '-P', '--no-pager', '--no-replace-objects', '--bare', '--literal-pathspecs', '--glob-pathspecs',
  '--noglob-pathspecs', '--icase-pathspecs', '--no-optional-locks', '--no-advice', '--version', '--help', '-h', '-v'
]);
const GLOBAL_WITH_VALUE = new Set(['--namespace', '--super-prefix', '--attr-source']);

const NON_LITERAL = /[$@*?[\]`%!<>]/;
const ENV_REDIRECT = /GIT_(?:DIR|WORK_TREE|INDEX_FILE)\b/i;
const TEXT_REDIRECT = /--git-dir|--work-tree|core\.worktree|GIT_(?:DIR|WORK_TREE|INDEX_FILE)\b/i;
// Subcommands that can put work on a branch without naming commit; their word in the text widens the strict rules.
const LANDS_WORK = /(?<![A-Za-z0-9_-])(?:merge|pull|cherry-pick|revert|am|rebase|stash|reset|update-ref|commit-tree)(?![A-Za-z0-9_-])/i;
const GIT_WORD = /(?<![A-Za-z0-9_./\-])git(?![A-Za-z0-9_.\/-])/i;
const DASH_C = /(?:^|\s)-C\s/;

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
  return /(?<![A-Za-z0-9])git(?![A-Za-z0-9])/i.test(text) && /(?<![A-Za-z0-9])commit(?![A-Za-z0-9])/i.test(text);
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

// A `git` word in any token outside a statement's program position: a payload that calls git from inside an option, a value or a variable.
function nestsGit(statements, ps) {
  for (const st of statements) {
    let k = 0;
    for (; k < st.tokens.length; k++) {
      const t = st.tokens[k];
      const assign = (!ps && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) || (ps && /^\$env:[^=]*=/i.test(t));
      if (assign) {
        if (GIT_WORD.test(t)) return true;
      } else if (!KEYWORDS.has(t)) break;
    }
    for (let j = k + 1; j < st.tokens.length; j++) if (GIT_WORD.test(st.tokens[j])) return true;
  }
  return false;
}

function baseName(token) {
  const cut = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'));
  return (cut === -1 ? token : token.slice(cut + 1)).toLowerCase();
}

function isLiteral(token) {
  return token !== '.' && token !== '&' && !NON_LITERAL.test(token);
}

// Long options that run a program; git accepts any unambiguous prefix, so any prefix of one letter or more (three characters with the dashes) counts.
const RUNNERS = ['--upload-pack', '--receive-pack', '--exec', '--ext-diff', '--open-files-in-pager'];

function runsProgram(toks, from, sub) {
  for (let j = from; j < toks.length; j++) {
    const t = toks[j];
    if (!t.startsWith('-')) continue;
    if (t.startsWith('-O')) return true;
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const name = (eq === -1 ? t : t.slice(0, eq)).toLowerCase();
      if (name.length >= 3 && RUNNERS.some((r) => r.startsWith(name))) return true;
    }
  }
  return false;
}

// `git add` that overrides the ignore rules: -f, a short cluster holding f, or a prefix of --force.
function forcesAdd(toks, from) {
  for (let j = from; j < toks.length; j++) {
    const t = toks[j];
    if (t === '--') return false;
    if (t.startsWith('--')) {
      if (t.length >= 3 && '--force'.startsWith(t.split('=')[0])) return true;
    } else if (t.startsWith('-') && t.slice(1).includes('f')) return true;
  }
  return false;
}

// A `git` statement: a commit (or doubt) unless the subcommand is a literal one that never commits.
function analyseGit(toks, cwd, ctx) {
  const mentionsCommit = ctx.mentionsCommit;
  let repo = null;
  let sure = false;
  let override = false;
  let i = 1;
  while (i < toks.length && toks[i].startsWith('-')) {
    const t = toks[i];
    if (t === '-C') {
      if (toks[i + 1] !== undefined) repo = joinRepo(repo, toks[i + 1]);
      i += 2;
    } else if (t === '-c' || t === '--config-env' || t.startsWith('--config-env=')) {
      const eq = t.indexOf('=');
      const value = t === '-c' || eq === -1 ? toks[i + 1] : t.slice(eq + 1);
      sure = true;
      if (value !== undefined && /^core\.worktree/i.test(value)) override = true;
      i += t === '-c' || eq === -1 ? 2 : 1;
    } else if (t === '--git-dir' || t === '--work-tree') {
      override = true;
      i += 2;
    } else if (t.startsWith('--git-dir=') || t.startsWith('--work-tree=')) {
      override = true;
      i++;
    } else if (GLOBAL_WITH_VALUE.has(t)) {
      i += 2;
    } else if (GLOBAL_PLAIN.has(t)) {
      i++;
    } else {
      sure = true;
      i++;
    }
  }
  const sub = toks[i];
  if (mentionsCommit && (sub === 'config' || RUNS_PROGRAMS.has(sub) || runsProgram(toks, i + 1, sub))) sure = true;
  if ((sub === 'add' || sub === 'stage') && forcesAdd(toks, i + 1)) ctx.force = true;
  if (!sure && (sub === undefined || (isLiteral(sub) && ALLOWED.has(sub)))) return { kind: 'git' };
  return { kind: 'commit', override, repo: repo === null ? cwd : isAbsolute(repo) ? repo : joinRepo(cwd, repo) };
}

// ctx: { mentionsCommit, env, git, force } filled while the statements are read.
function analyse(statement, ps, cwd, ctx) {
  const toks = statement.tokens.slice();
  for (;;) {
    const t = toks[0];
    if (t === undefined) return { kind: 'none' };
    const assign = (!ps && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) || (ps && /^\$env:[^=]*=/i.test(t));
    if (assign) ctx.env = true;
    if (KEYWORDS.has(t) || assign) toks.shift();
    else break;
  }
  if (ps && /^\$env:[^\\/]+$/i.test(toks[0]) && toks[1] !== undefined && toks[1].startsWith('=')) {
    ctx.env = true;
    return { kind: 'none' };
  }
  if (!isLiteral(toks[0])) return { kind: 'dynamic' };
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
  if (prog === 'git' || prog === 'git.exe') {
    ctx.git = true;
    return analyseGit(toks, cwd, ctx);
  }
  if (/^git[.-]/.test(prog)) return { kind: 'commit', override: TEXT_REDIRECT.test(statement.raw), repo: cwd };
  if ((prog === 'export' || prog === 'set') && toks.length > 1) ctx.env = true;
  if (prog === 'printf' && toks.some((t) => t === '-v' || (t.startsWith('-v') && t.length > 2))) ctx.env = true;
  return HARMLESS.has(prog) ? { kind: 'none' } : { kind: 'foreign' };
}

const NOT = Object.freeze({ isCommit: false, repo: null, unknown: false });

function commit(repo, unknown) {
  return { isCommit: true, repo: repo === null ? null : cap(repo), unknown };
}

function intent(command, ps) {
  if (typeof command !== 'string') return { ...NOT };
  if (command.length > MAX_PARSE) return namesGitAndCommit(command) ? commit(null, false) : { ...NOT };
  const { statements, unterminated } = parse(command, ps);
  let cwd = null;
  let found = null;
  let foreign = false;
  let dynamic = false;
  const ctx = { mentionsCommit: /commit/i.test(command) || LANDS_WORK.test(command) || nestsGit(statements, ps), env: false, git: false, force: false };
  for (const st of statements) {
    const r = analyse(st, ps, cwd, ctx);
    if (r.kind === 'cd') cwd = joinRepo(cwd, r.target);
    else if (r.kind === 'commit') found = found === null ? r : found;
    else if (r.kind === 'foreign') foreign = true;
    else if (r.kind === 'dynamic') dynamic = true;
  }
  if (found !== null) return commit(found.repo, ENV_REDIRECT.test(command) || found.override || ctx.force);
  // An environment variable can make git run a program (GIT_EXTERNAL_DIFF, GIT_CONFIG_*, GIT_SSH_COMMAND, ...).
  if (ctx.env && ctx.git && ctx.mentionsCommit) return commit(cwd, ENV_REDIRECT.test(command) || ctx.force);
  const substitution = ps ? command.includes('$(') : command.includes('$(') || command.includes('`');
  const doubt =
    (dynamic && /git|commit/i.test(command)) ||
    (foreign && namesGitAndCommit(command)) ||
    ((unterminated || substitution) && namesGitAndCommit(command));
  if (!doubt) return { ...NOT };
  return commit(cwd, TEXT_REDIRECT.test(command) || DASH_C.test(command) || ctx.force);
}

// shell: 'bash' or 'powershell'. Returns { isCommit, repo: string | null, unknown }.
// `unknown` is true when the repository or index may differ from the session's own: the gate then treats the commit as a security hit.
export function commitIntent(command, shell) {
  try {
    return intent(command, shell === 'powershell');
  } catch {
    return typeof command === 'string' ? commit(null, false) : { ...NOT };
  }
}
