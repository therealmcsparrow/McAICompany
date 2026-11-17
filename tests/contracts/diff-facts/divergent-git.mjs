// Test runner: runs scripts/diff-facts.mjs main() with a git whose two -z -M calls can disagree.
// Usage: node divergent-git.mjs <diff-facts args...>   env DF_MODE, DF_PATH (see below), run with cwd = the repo.
// Modes (all act on the output of the real git):
//   none            pass through (control)
//   numstat-drop    remove DF_PATH from the --numstat output
//   numstat-extra   add a numstat record for DF_PATH (a path the status call did not list)
//   status-drop     remove DF_PATH from the --name-status output
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.env.DF_MODE ?? 'none';
const target = process.env.DF_PATH ?? '';
const real = cp.execFileSync;

const split = buf => { const t = buf.toString('latin1').split('\0'); if (t.at(-1) === '') t.pop(); return t; };
const join = t => Buffer.from(t.map(x => `${x}\0`).join(''), 'latin1');

cp.execFileSync = (file, args, opts) => {
  const out = real(file, args, opts);
  if (file !== 'git' || !Array.isArray(args)) return out;
  if (args.includes('--numstat')) {
    const t = split(out);
    if (mode === 'numstat-drop') return join(t.filter(r => r.split('\t').slice(2).join('\t') !== target));
    if (mode === 'numstat-extra') return join([...t, `1\t1\t${target}`]);
  }
  if (args.includes('--name-status') && mode === 'status-drop') {
    const t = split(out);
    const keep = [];
    for (let i = 0; i < t.length; i += 2) if (t[i + 1] !== target) keep.push(t[i], t[i + 1]);
    return join(keep);
  }
  return out;
};
syncBuiltinESMExports();

const here = dirname(fileURLToPath(import.meta.url));
const { main } = await import(pathToFileURL(resolve(here, '../../../scripts/diff-facts.mjs')).href);
const r = main(process.argv.slice(2));
process.stdout.write(r.out);
process.exitCode = r.code;
