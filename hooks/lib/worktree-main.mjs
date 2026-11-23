// Main tree of a linked git worktree. Kept apart from event.mjs so importers do not load the hook engine.
import fs from 'node:fs';
import path from 'node:path';

const MAX_PATH = 4096;
// UNC (\\host, //host) and device (\\?\, \\.\) prefixes: never followed.
const REMOTE = /^[\\/]{2}/;

export function realOf(p, cwd) {
  if (typeof p !== 'string' || p.length === 0 || p.length > MAX_PATH || p.includes('\u0000')) return null;
  let cur;
  try { cur = path.resolve(cwd || process.cwd(), p); } catch { return null; }
  const rest = [];
  for (;;) {
    try {
      const r = fs.realpathSync.native(cur);
      return rest.length > 0 ? path.join(r, ...rest.reverse()) : r;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return null;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

const readSmall = (file) => {
  try {
    const l = fs.lstatSync(file);
    if (l.isSymbolicLink() || !l.isFile() || l.size > 4096) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
};

// The main tree of a linked git worktree, from the nearest `.git` pointer file above cwd; null when the
// pointer is absent, names a UNC or device path, or is not confirmed from both sides (back link, common dir).
export function worktreeMain(cwd) {
  const start = realOf(cwd || '.', process.cwd());
  if (!start) return null;
  for (let cur = start; ; cur = path.dirname(cur)) {
    const g = path.join(cur, '.git');
    let l = null;
    try { l = fs.lstatSync(g); } catch { /* none here */ }
    if (l && l.isDirectory()) return null;
    if (l && l.isFile()) {
      const text = readSmall(g);
      const m = text === null ? null : /^gitdir: (.+?)\r?\n?$/.exec(text);
      if (!m || REMOTE.test(m[1])) return null;
      const gitdir = path.resolve(cur, m[1]);
      if (REMOTE.test(gitdir)) return null;
      const wt = path.dirname(gitdir);
      if (path.basename(wt) !== 'worktrees' || path.basename(path.dirname(wt)) !== '.git') return null;
      const main = path.dirname(path.dirname(wt));
      const back = readSmall(path.join(gitdir, 'gitdir'));
      const common = readSmall(path.join(gitdir, 'commondir'));
      if (back === null || common === null) return null;
      if (REMOTE.test(back.trim()) || REMOTE.test(common.trim())) return null;
      if (realOf(path.resolve(gitdir, back.trim())) !== realOf(g)) return null;
      if (realOf(path.resolve(gitdir, common.trim())) !== realOf(path.join(main, '.git'))) return null;
      return main;
    }
    if (path.dirname(cur) === cur) return null;
  }
}
