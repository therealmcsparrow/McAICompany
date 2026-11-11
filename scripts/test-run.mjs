// npm test wrapper and node:test reporter in one file.
// contract: docs/contracts/test-run.md v1.1
// CLI: node scripts/test-run.mjs [flag...] <test file or "<dir>/*<suffix>" pattern>...
//   flags reach node unchanged and come before the patterns; --test-timeout defaults to 20 minutes.
//   runs `node --test` with node's reporter on stdout (unchanged) and this file as a
//   second reporter on stderr, which prints one progress line per test file.
// Reporter: default export, reads TestsStream events only, never parses reporter text.
// --test-reporter and --test-reporter-destination are Stability 2 (stable) on Node 24 and 26;
// re-check them on each Node major.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProgress } from './progress.mjs';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');
const MAX_TOTAL = 1000000;
const DEFAULT_TIMEOUT_MS = 1200000;
const MAX_TIMEOUT_MS = 86400000;
const REFUSE_TIMEOUT = 'aico test: bad --test-timeout';
const REFUSE_ISOLATION = 'aico test: --test-isolation=none is not supported';

// Counts the files an argument list selects. Returns null when the count is not known.
// Handles literal paths and `<dir>/*<suffix>`; anything else (other wildcards, paths
// outside the repo root) makes the total unknown rather than guessed. Flags are not patterns.
export function countFiles(args, root = ROOT) {
  let total = 0;
  for (const arg of args) {
    if (typeof arg === 'string' && arg.startsWith('-')) continue;
    if (typeof arg !== 'string' || arg.length === 0) return null;
    if (!/[*?[\]{}]/.test(arg)) {
      total += 1;
      continue;
    }
    const m = /^([^*?[\]{}]+)\/\*([^*?[\]{}/]*)$/.exec(arg.replaceAll('\\', '/'));
    if (!m) return null;
    const dir = path.resolve(root, m[1]);
    const inside = path.relative(root, dir);
    if (inside.startsWith('..') || path.isAbsolute(inside)) return null;
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    total += names.filter((d) => d.isFile() && d.name.endsWith(m[2])).length;
  }
  return total;
}

function shown(file) {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

// node:test reporter. A file is begun on its file-level test:enqueue and done on its
// file-level test:complete (nesting 0, name equal to the file's relative path).
export default async function* reporter(source) {
  const raw = process.env.AICO_TEST_TOTAL;
  const total = typeof raw === 'string' && /^\d{1,7}$/.test(raw) && Number(raw) <= MAX_TOTAL ? Number(raw) : '?';
  const progress = createProgress({ command: 'aico test', total, unit: 'files' });
  progress.start();
  const open = new Set();
  const finished = new Set();
  try {
    for await (const event of source) {
      const d = event.data;
      if (!d || d.nesting !== 0 || typeof d.file !== 'string' || d.file === '') continue;
      const isFile = d.name === path.relative(process.cwd(), d.file) || d.name === d.file;
      if (!isFile) continue;
      const name = shown(d.file);
      if (event.type === 'test:enqueue' && !open.has(name) && !finished.has(name)) {
        open.add(name);
        progress.begin(name);
      } else if (event.type === 'test:complete' && !finished.has(name)) {
        open.delete(name);
        finished.add(name);
        progress.done(name, d.details?.passed === true);
      }
    }
  } finally {
    progress.end();
  }
}

// Pure: decides the node argv or a refusal line. Flags keep their order and precede the patterns.
export function planRun(args) {
  const flags = args.filter((a) => a.startsWith('-'));
  const patterns = args.filter((a) => !a.startsWith('-'));
  let hasTimeout = false;
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f.startsWith('--test-timeout=')) {
      const v = f.slice('--test-timeout='.length);
      if (!/^[1-9]\d{0,7}$/.test(v) || Number(v) > MAX_TIMEOUT_MS) return { refuse: REFUSE_TIMEOUT };
      hasTimeout = true;
    } else if (f === '--test-isolation=none' || f === '--experimental-test-isolation=none') {
      return { refuse: REFUSE_ISOLATION };
    }
  }
  for (let i = 0; i < args.length - 1; i++) {
    if ((args[i] === '--test-isolation' || args[i] === '--experimental-test-isolation') && args[i + 1] === 'none') {
      return { refuse: REFUSE_ISOLATION };
    }
  }
  const argv = [
    '--test',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    `--test-reporter=${pathToFileURL(SELF).href}`,
    '--test-reporter-destination=stderr',
    ...(hasTimeout ? [] : [`--test-timeout=${DEFAULT_TIMEOUT_MS}`]),
    ...flags,
    ...patterns
  ];
  const sharded = flags.some((f) => f.startsWith('--test-shard='));
  return { argv, patterns, totalKnown: !sharded };
}

function main(args) {
  const plan = planRun(args);
  if (plan.refuse) {
    process.stderr.write(`${plan.refuse}
`);
    return 1;
  }
  const known = plan.totalKnown ? countFiles(plan.patterns) : null;
  const env = { ...process.env };
  delete env.AICO_TEST_TOTAL;
  if (known !== null) env.AICO_TEST_TOTAL = String(known);
  const r = spawnSync(process.execPath, plan.argv, { cwd: process.cwd(), env, stdio: 'inherit' });
  if (r.error) {
    process.stderr.write(`aico test: cannot start node --test: ${r.error.code ?? 'error'}\n`);
    return 1;
  }
  if (r.signal) return 1;
  return r.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  process.exitCode = main(process.argv.slice(2));
}
