// Shared test fixture for the exact-letter-case tests: real temp folders, scripts run as child processes
// with the temp folder as cwd (no fs mocks).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const WRONG = 'wrong letter case';
export const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN = path.resolve(SCRIPTS, '..');

const made = [];
export function cleanup() {
  for (const d of made) {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(`${d}.aico-wt`, { recursive: true, force: true });
  }
}

// files: { 'rel/with/slashes': body }. Returns the real root.
export function fixture(files = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'exact-case-')));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) put(root, rel, body);
  return root;
}

export function put(root, rel, body = '') {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

// Every path under root, sorted, with a size for files: a before/after snapshot for "nothing written".
export function tree(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(dir, e.name);
      const rel = path.relative(root, p).split(path.sep).join('/');
      if (e.isDirectory()) {
        out.push(`${rel}/`);
        walk(p);
      } else out.push(`${rel} ${fs.statSync(p).size}`);
    }
  };
  walk(root);
  return out.sort();
}

// Runs scripts/<script> with cwd = root. Returns { code, out, err, all }.
export function cli(script, args, { cwd, input, env } = {}) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
    cwd, input, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000,
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// True when this file system keeps names that differ only in case apart.
export function allowsTwins() {
  const root = fixture();
  fs.mkdirSync(path.join(root, 'ab'));
  try {
    fs.mkdirSync(path.join(root, 'AB'));
    return fs.readdirSync(root).length === 2;
  } catch {
    return false;
  }
}

// Swaps the letter case of every ASCII letter.
export const flip = (s) => s.replace(/[A-Za-z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
