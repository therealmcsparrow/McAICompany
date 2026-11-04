// Token totals and over-cap Steps of one run, read through `ledger.mjs report <run> --json` in a child process.
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { isWorkFolder } from '../mods/lib/work-folder.mjs';

const LEDGER_SCRIPT = path.join(import.meta.dirname, 'ledger.mjs');
const CTX_CAP = 95000;
const MAX_OUTPUT = 1024 * 1024;
const MAX_CHILDREN = 4;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_ROWS = 10000;

const defaultCache = new Map();
const waiting = [];
let running = 0;

const unavailable = () => ({ state: 'unavailable', totals: null, overCap: [] });
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

async function slot() {
  if (running >= MAX_CHILDREN) await new Promise((resolve) => waiting.push(resolve));
  else running += 1;
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
}

// Resolves to the stdout text, or null on a non-zero exit, a timeout, output over the cap or a spawn error.
function runChild(spawn, root, slug, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let timer;
    const chunks = [];
    let size = 0;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const stop = () => {
      try { child?.kill(); } catch { /* already gone */ }
    };
    try {
      child = spawn(process.execPath, [LEDGER_SCRIPT, 'report', slug, '--json'], {
        cwd: root, shell: false, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true
      });
    } catch {
      finish(null);
      return;
    }
    timer = setTimeout(() => { stop(); finish(null); }, timeoutMs);
    child.on('error', () => finish(null));
    child.stdout?.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) {
        stop();
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    child.on('close', (code) => finish(code === 0 ? Buffer.concat(chunks).toString('utf8') : null));
  });
}

// Builds the result from untrusted report output, reading only the allow-listed keys.
function parseReport(text) {
  let report;
  try { report = JSON.parse(text); } catch { return unavailable(); }
  if (report === null || typeof report !== 'object' || report.v !== 1) return unavailable();
  const { totals, rows } = report;
  if (totals === null || typeof totals !== 'object') return unavailable();
  if (!isCount(totals.spend) || !isCount(totals.cache_read)) return unavailable();
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) return unavailable();
  const overCap = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object') return unavailable();
    if (!isCount(row.ctx_end) || row.ctx_end <= CTX_CAP) continue;
    if (typeof row.id !== 'string' || typeof row.role !== 'string') return unavailable();
    overCap.push({ step: row.id, role: row.role, ctxEnd: row.ctx_end });
  }
  return { state: 'ok', totals: { spend: totals.spend, cacheRead: totals.cache_read }, overCap };
}

async function load(root, slug, spawn, timeoutMs) {
  await slot();
  try {
    const text = await runChild(spawn, root, slug, timeoutMs);
    return text === null ? unavailable() : parseReport(text);
  } finally {
    release();
  }
}

export async function readLedger(root, slug, { spawn = nodeSpawn, timeoutMs = DEFAULT_TIMEOUT_MS, cache = defaultCache } = {}) {
  try {
    if (typeof slug !== 'string' || !isWorkFolder(slug)) return unavailable();
    let stat;
    try { stat = fs.lstatSync(path.join(root, '.company', 'ledger', `${slug}.jsonl`)); } catch { return { state: 'none', totals: null, overCap: [] }; }
    if (!stat.isFile()) return { state: 'none', totals: null, overCap: [] };
    const key = `${stat.mtimeMs}:${stat.size}`;
    const hit = cache.get(slug);
    if (hit && hit.key === key) return await hit.result;
    const result = load(root, slug, spawn, timeoutMs).catch(unavailable);
    cache.set(slug, { key, result });
    return await result;
  } catch {
    return unavailable();
  }
}
