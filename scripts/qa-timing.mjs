#!/usr/bin/env node
// Usage: node scripts/qa-timing.mjs [--root <dir>] [--module <stem>]
// Runs each test file of a Module on its own and prints one line per file that took longer than the
// Module's budget in tests/budgets.json: `over budget <module>: <ms> ms of <budget> ms`.
// Report only: every path exits 0. A bad budgets file or argument prints one `qa-timing: error` line.
// Uses node:test through its CLI (stability 2); only the wall time is read, never the reporter text.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const STEM = /^[a-z0-9][a-z0-9-]{0,63}$/;
const USAGE = 'usage: qa-timing.mjs [--root <dir>] [--module <stem>]';
const MAX_BUDGET_FILE = 64 * 1024;
const MAX_MS = 3_600_000;
const MAX_MODULES = 500;
const FILE_TIMEOUT_MS = 300_000;

class Refusal extends Error {}

function validMs(n) {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_MS;
}

// Parses the budgets text into { defaultMs, modules }; modules has no prototype.
export function parseBudgets(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Refusal('budgets file is not valid JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Refusal('budgets file must be a JSON object');
  const keys = Object.keys(data);
  if (keys.length !== 3 || !['v', 'default_ms', 'modules'].every((k) => Object.hasOwn(data, k))) {
    throw new Refusal('budgets file must have exactly v, default_ms and modules');
  }
  if (data.v !== 1) throw new Refusal('budgets file v must be 1');
  if (!validMs(data.default_ms)) throw new Refusal(`default_ms must be a whole number from 1 to ${MAX_MS}`);
  const mods = data.modules;
  if (mods === null || typeof mods !== 'object' || Array.isArray(mods)) throw new Refusal('modules must be an object');
  const names = Object.keys(mods);
  if (names.length > MAX_MODULES) throw new Refusal('too many modules');
  const modules = Object.create(null);
  for (const name of names) {
    if (!STEM.test(name)) throw new Refusal('a module key is not a script stem');
    if (!validMs(mods[name])) throw new Refusal(`a module budget must be a whole number from 1 to ${MAX_MS}`);
    modules[name] = mods[name];
  }
  return { defaultMs: data.default_ms, modules };
}

export function budgetFor(budgets, stem) {
  return Object.hasOwn(budgets.modules, stem) ? budgets.modules[stem] : budgets.defaultMs;
}

function readBudgets(file) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch {
    throw new Refusal('budgets file not found');
  }
  if (!st.isFile()) throw new Refusal('budgets file is not a plain file');
  if (st.size > MAX_BUDGET_FILE) throw new Refusal('budgets file is over 64 KiB');
  return parseBudgets(fs.readFileSync(file, 'utf8'));
}

// Maps each Module (script stem) to its test files in scriptsDir. A test file belongs to the
// longest stem S where its name is S.test.mjs or starts with S-.
export function groupTests(scriptsDir) {
  const names = fs.readdirSync(scriptsDir).sort();
  const stems = names.filter((n) => n.endsWith('.mjs') && !n.endsWith('.test.mjs')).map((n) => n.slice(0, -4)).filter((s) => STEM.test(s));
  const groups = new Map();
  for (const name of names) {
    const m = /^([a-z0-9][a-z0-9-]*)\.test\.mjs$/.exec(name);
    if (!m) continue;
    const full = path.join(scriptsDir, name);
    if (!fs.lstatSync(full).isFile()) continue;
    let owner = null;
    for (const s of stems) {
      if ((m[1] === s || m[1].startsWith(`${s}-`)) && (owner === null || s.length > owner.length)) owner = s;
    }
    if (owner === null) continue;
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push(full);
  }
  return groups;
}

// Wall time of one test file in ms: this node, fixed arguments, no shell, output discarded.
export function measure(file, cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const done = () => resolve(Number((process.hrtime.bigint() - start) / 1_000_000n));
    const child = spawn(process.execPath, ['--test', '--test-reporter=spec', file], { cwd, env, stdio: 'ignore', timeout: FILE_TIMEOUT_MS });
    child.on('error', done);
    child.on('close', done);
  });
}

export async function report({ root, only = null, measureFile = measure }) {
  const budgets = readBudgets(path.join(root, 'tests', 'budgets.json'));
  const groups = groupTests(path.join(root, 'scripts'));
  const lines = [];
  for (const stem of [...groups.keys()].sort()) {
    if (only !== null && stem !== only) continue;
    const budget = budgetFor(budgets, stem);
    for (const file of groups.get(stem)) {
      const ms = await measureFile(file, root);
      if (ms > budget) lines.push(`over budget ${stem}: ${ms} ms of ${budget} ms`);
    }
  }
  return lines;
}

function parseArgs(argv) {
  const out = { root: process.cwd(), only: null };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const val = argv[i + 1];
    if (val === undefined) throw new Refusal(USAGE);
    if (flag === '--root') out.root = path.resolve(val);
    else if (flag === '--module') {
      if (!STEM.test(val)) throw new Refusal('--module must be a script stem');
      out.only = val;
    } else throw new Refusal(USAGE);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const line of await report(parseArgs(process.argv.slice(2)))) console.log(line);
  } catch (e) {
    console.log(`qa-timing: error ${e instanceof Refusal ? e.message : 'unexpected failure'}`);
  }
}
