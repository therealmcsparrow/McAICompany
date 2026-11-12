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
const WATCHDOG_GRACE_MS = 30000;
const WATCHDOG = path.join(path.dirname(SELF), 'test-watchdog.mjs');
const REFUSE_TIMEOUT = 'aico test: bad --test-timeout';
const REFUSE_ISOLATION = 'aico test: --test-isolation=none is not supported';

// Lists the files an argument list selects, as given (literal paths) or `<dir>/<name>` (patterns).
// Returns null when the selection is not known. Handles literal paths and `<dir>/*<suffix>`;
// anything else (other wildcards, paths outside the repo root) is unknown rather than guessed.
// Flags are not patterns.
export function selectFiles(args, root = ROOT) {
  const out = [];
  for (const arg of args) {
    if (typeof arg === 'string' && arg.startsWith('-')) continue;
    if (typeof arg !== 'string' || arg.length === 0) return null;
    if (!/[*?[\]{}]/.test(arg)) {
      out.push(arg.replaceAll('\\', '/'));
      continue;
    }
    const norm = arg.replaceAll('\\', '/');
    const m = /^([^*?[\]{}]+)\/\*([^*?[\]{}/]*)$/.exec(norm);
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
    for (const d of names) if (d.isFile() && d.name.endsWith(m[2])) out.push(`${m[1]}/${d.name}`);
  }
  return out;
}

// Counts the files an argument list selects. Returns null when the count is not known.
export function countFiles(args, root = ROOT) {
  const files = selectFiles(args, root);
  return files === null ? null : files.length;
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
    writeFileList(finished);
  }
}

// Writes the completed-file list once, at run end, when AICO_TEST_FILES_OUT names a path.
function writeFileList(finished) {
  const target = process.env.AICO_TEST_FILES_OUT;
  if (typeof target !== 'string' || target === '') return;
  try {
    const out = path.resolve(target);
    const names = [...finished];
    const sorted = names.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, sorted.map((n) => `${n}
`).join(''));
  } catch (e) {
    process.stderr.write(`aico test: cannot write file list: ${e.code ?? 'error'}
`);
  }
}

const MAX_LIST_BYTES = 1048576;
const MAX_SHOWN = 300;

function safeShown(line) {
  return line.slice(0, MAX_SHOWN).replace(/[^ -~]/g, '?');
}

// Reads the plain *.txt files directly inside dir. Returns { lists } or { error }.
function readLists(dir) {
  let entries;
  try {
    if (!fs.lstatSync(dir).isDirectory()) return { error: 'not a folder' };
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return { error: `cannot read folder (${e.code ?? 'error'})` };
  }
  const lists = [];
  for (const d of entries.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))) {
    if (!d.isFile() || !d.name.endsWith('.txt')) continue;
    const file = path.join(dir, d.name);
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile()) continue;
      if (st.size > MAX_LIST_BYTES) return { error: 'a list is over 1 MiB' };
      lists.push(fs.readFileSync(file, 'utf8').split('\n'));
    } catch (e) {
      return { error: `cannot read a list (${e.code ?? 'error'})` };
    }
  }
  return { lists };
}

// Cover mode: runs no tests; checks the shard lists against the selected files.
function runCover(dir, patterns) {
  process.stderr.write('cover: checking shard lists\n');
  const selected = selectFiles(patterns);
  if (selected === null) {
    process.stdout.write('cover: error cannot list the patterns\n');
    return 1;
  }
  const want = new Set(selected);
  const r = readLists(dir);
  if (r.error) {
    process.stdout.write(`cover: error ${r.error}\n`);
    return 1;
  }
  if (r.lists.length === 0) {
    process.stdout.write('cover: error no list found\n');
    return 1;
  }
  const counts = new Map();
  for (const lines of r.lists) {
    for (const line of lines) if (line !== '') counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const findings = [];
  for (const f of want) if (!counts.has(f)) findings.push(`missing ${safeShown(f)}`);
  for (const [f, k] of counts) {
    if (!want.has(f)) findings.push(`unknown ${safeShown(f)}`);
    else if (k > 1) findings.push(`twice ${safeShown(f)} ${k}`);
  }
  if (findings.length > 0) {
    findings.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    process.stdout.write(findings.map((l) => `${l}\n`).join(''));
    return 1;
  }
  process.stdout.write(`cover: ${want.size} files, ${r.lists.length} lists, ok\n`);
  return 0;
}

// Pure: decides the node argv or a refusal line. Flags keep their order and precede the patterns.
export function planRun(args) {
  let coverDir = null;
  const flags = [];
  for (const a of args) {
    if (!a.startsWith('-')) continue;
    if (a.startsWith('--aico-cover=')) {
      coverDir = a.slice('--aico-cover='.length);
    } else flags.push(a);
  }
  const patterns = args.filter((a) => !a.startsWith('-'));
  let hasTimeout = false;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f.startsWith('--test-timeout=')) {
      const v = f.slice('--test-timeout='.length);
      if (!/^[1-9]\d{0,7}$/.test(v) || Number(v) > MAX_TIMEOUT_MS) return { refuse: REFUSE_TIMEOUT };
      hasTimeout = true;
      timeoutMs = Number(v);
    } else if (f === '--test-isolation=none' || f === '--experimental-test-isolation=none') {
      return { refuse: REFUSE_ISOLATION };
    }
  }
  for (let i = 0; i < args.length - 1; i++) {
    if ((args[i] === '--test-isolation' || args[i] === '--experimental-test-isolation') && args[i + 1] === 'none') {
      return { refuse: REFUSE_ISOLATION };
    }
  }
  const deadlineMs = timeoutMs + Math.min(timeoutMs, WATCHDOG_GRACE_MS);
  const argv = [
    `--import=${pathToFileURL(WATCHDOG).href}`,
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
  return { argv, patterns, totalKnown: !sharded, coverDir, deadlineMs, env: { AICO_TEST_WATCHDOG_MS: String(deadlineMs) } };
}

function main(args) {
  const plan = planRun(args);
  if (plan.refuse) {
    process.stderr.write(`${plan.refuse}
`);
    return 1;
  }
  if (plan.coverDir !== null) return runCover(plan.coverDir, plan.patterns);
  const known = plan.totalKnown ? countFiles(plan.patterns) : null;
  const env = { ...process.env, ...plan.env };
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
