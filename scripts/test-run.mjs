// npm test wrapper and node:test reporter in one file.
// CLI: node scripts/test-run.mjs <test file or "<dir>/*<suffix>" pattern>...
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

// Counts the files an argument list selects. Returns null when the count is not known.
// Handles literal paths and `<dir>/*<suffix>`; anything else (flags, other wildcards, paths
// outside the repo root) makes the total unknown rather than guessed.
export function countFiles(args, root = ROOT) {
  let total = 0;
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length === 0 || arg.startsWith('-')) return null;
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
  const progress = createProgress({ command: 'test-run', total, unit: 'files' });
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

function main(args) {
  const known = countFiles(args);
  const env = { ...process.env };
  delete env.AICO_TEST_TOTAL;
  if (known !== null) env.AICO_TEST_TOTAL = String(known);
  const r = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=spec',
      '--test-reporter-destination=stdout',
      `--test-reporter=${pathToFileURL(SELF).href}`,
      '--test-reporter-destination=stderr',
      ...args
    ],
    { cwd: process.cwd(), env, stdio: 'inherit' }
  );
  if (r.error) {
    process.stderr.write(`test-run: cannot start node --test: ${r.error.code ?? 'error'}\n`);
    return 1;
  }
  if (r.signal) return 1;
  return r.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  process.exitCode = main(process.argv.slice(2));
}
