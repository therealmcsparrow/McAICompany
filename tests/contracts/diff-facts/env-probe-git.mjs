// Test runner: runs scripts/diff-facts.mjs main() and records the environment of every git child.
// Usage: node env-probe-git.mjs <diff-facts args...>   env DF_LOG = file that gets one JSON line per git call:
//   { "sub": <first non-option word after the prefix>, "env": { <every GIT_* variable the child got> } }
import cp from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const log = process.env.DF_LOG;
const real = cp.execFileSync;

cp.execFileSync = (file, args, opts) => {
  if (file === 'git' && Array.isArray(args)) {
    const env = {};
    for (const [k, v] of Object.entries(opts?.env ?? {})) if (/^GIT_/i.test(k)) env[k] = v;
    const words = args.filter(a => typeof a === 'string' && !a.startsWith('-') && !a.includes('='));
    appendFileSync(log, `${JSON.stringify({ sub: words[0] ?? '', env })}\n`);
  }
  return real(file, args, opts);
};
syncBuiltinESMExports();

const here = dirname(fileURLToPath(import.meta.url));
const { main } = await import(pathToFileURL(resolve(here, '../../../scripts/diff-facts.mjs')).href);
const r = main(process.argv.slice(2));
process.stdout.write(r.out);
process.exitCode = r.code;
