// Pins for the plugin files the engine loads after the pins check, outside the pinned folders: the entry scripts
// and everything they import, one SHA-256 each (hooks/lib/dep-hashes.mjs, written by scripts/hook-pins.mjs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEP_HASHES } from './dep-hashes.mjs';

export const DEP_ENTRIES = ['scripts/lead-handover.mjs', 'scripts/run-state.mjs'];
const MAX_FILES = 200;
const MAX_BYTES = 1024 * 1024;
const FROM_RE = /(?:^|\n)\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.[^'"\n]*)['"]/g;
const BARE_RE = /(?:^|\n)\s*import\s*['"](\.[^'"\n]*)['"]/g;
const DYNAMIC_RE = /\bimport\(\s*['"](\.[^'"\n]*)['"]\s*\)/g;

const posix = (p) => p.split(path.sep).join('/');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const inside = (root, abs) => { const r = path.relative(root, abs); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };
const inPinnedFolder = (rel) => rel.startsWith('hooks/lib/') || rel.startsWith('hooks/rules/');

// The files an import graph reaches from the entries, as plugin-relative paths. Files of the pinned folders end a
// branch: the pins already cover them. { files, bad }: `bad` lists a file that is missing, too large, outside the
// plugin root or past the file cap.
export function depClosure(root, entries = DEP_ENTRIES) {
  const files = new Set();
  const bad = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const rel = queue.shift();
    if (files.has(rel) || inPinnedFolder(rel)) continue;
    if (files.size >= MAX_FILES) { bad.push(rel); continue; }
    files.add(rel);
    let text;
    try {
      const abs = path.join(root, rel);
      if (fs.statSync(abs).size > MAX_BYTES) { bad.push(rel); continue; }
      text = fs.readFileSync(abs, 'utf8');
    } catch { bad.push(rel); continue; }
    for (const re of [FROM_RE, BARE_RE, DYNAMIC_RE]) {
      for (const m of text.matchAll(re)) {
        const abs = path.resolve(root, path.dirname(rel), m[1]);
        if (!inside(root, abs)) { bad.push(`${rel} -> ${m[1]}`); continue; }
        queue.push(posix(path.relative(root, abs)));
      }
    }
  }
  return { files: [...files].sort(), bad };
}

export function depHashes(root, entries = DEP_ENTRIES) {
  const { files, bad } = depClosure(root, entries);
  const out = {};
  for (const rel of files) { try { out[rel] = sha(fs.readFileSync(path.join(root, rel))); } catch { /* listed in bad */ } }
  return { hashes: out, bad };
}

// Plugin-relative paths that differ from the recorded hashes: a changed or missing file, or a file the graph now
// reaches that has no recorded hash. Empty when every loaded file is as pinned.
export function verifyDeps(root, expected = DEP_HASHES, entries = DEP_ENTRIES) {
  const now = depHashes(root, entries);
  const bad = new Set(now.bad);
  for (const [rel, hash] of Object.entries(expected)) if (now.hashes[rel] !== hash) bad.add(rel);
  for (const rel of Object.keys(now.hashes)) if (!Object.hasOwn(expected, rel)) bad.add(rel);
  return [...bad];
}

// Imports one pinned entry script after the whole graph matches its hashes.
export async function importPinned(root, rel) {
  const bad = verifyDeps(root);
  if (bad.length > 0) throw new Error(`pins-mismatch: ${bad.slice(0, 5).join(', ')}`);
  return import(pathToFileURL(path.join(root, rel)).href);
}
