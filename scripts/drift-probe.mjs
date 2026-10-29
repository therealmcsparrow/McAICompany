#!/usr/bin/env node
// Drift probe (contract: docs/contracts/contract-index.md v1). Node built-ins only; read-only, writes nothing.
// A Contract sentence introduced by "word for word" or "exact text" must appear byte for byte in every file the
// line names and in at least one test file. Scanned text is untrusted: patterns are anchored or bounded, files
// over the cap are skipped, and paths are joined lexically under the root.
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 2_000_000;
const MAX_LINE = 20_000;
const MAX_FILES = 5000;
const MAX_DEPTH = 6;
const MIN_SENTENCE = 20;
const MARKER = /\b(?:word for word|exact text)\b/i;
const TICKED = /`([^`\n]{1,2000})`/g;
const PATH_TOKEN = /^([A-Za-z][\w.-]*)\/[\w.\/-]*$/;

function readText(abs) {
  try {
    const st = lstatSync(abs);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return readFileSync(abs, 'utf8');
  } catch { return null; }
}

function isDir(abs) {
  try { return lstatSync(abs).isDirectory(); } catch { return false; }
}

function listFiles(root, rel, keep, depth = 0, out = []) {
  if (depth > MAX_DEPTH || out.length > MAX_FILES) return out;
  let entries;
  try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.isSymbolicLink()) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) listFiles(root, r, keep, depth + 1, out);
    else if (e.isFile() && keep(e.name)) out.push(r);
  }
  return out.sort();
}

// A path token is a named file when it starts in a folder at the repo root and the file exists there.
function namedFile(root, token) {
  const path = token.split(/\s/, 1)[0].replace(/:\d+(?:-\d+)?$/, '');
  if (!PATH_TOKEN.test(path) || path.split('/').includes('..')) return null;
  const base = resolve(root) + sep;
  const abs = resolve(root, path);
  if (!abs.startsWith(base) || !isDir(join(root, path.split('/', 1)[0]))) return null;
  try { return lstatSync(abs).isFile() ? path : null; } catch { return null; }
}

// Sentences of one Contract line: backticked spans after the first marker that hold a space and are long enough.
export function sentencesOf(line) {
  if (line.length > MAX_LINE) return null;
  const m = MARKER.exec(line);
  if (!m) return null;
  const after = line.slice(m.index + m[0].length);
  const spans = [...after.matchAll(TICKED)].map(x => x[1]);
  const sentence = spans.find(s => s.length >= MIN_SENTENCE && /\s/.test(s) && !PATH_TOKEN.test(s));
  if (sentence === undefined) return null;
  const files = [...new Set([...line.matchAll(TICKED)].map(x => x[1]).filter(s => s !== sentence))];
  return { sentence, tokens: files };
}

const isTest = rel => /\.test\.mjs$/.test(rel);

export function probe(root) {
  const errors = [];
  const contracts = listFiles(root, 'docs/contracts', n => n.endsWith('.md'));
  const tests = listFiles(root, 'scripts', n => n.endsWith('.test.mjs')).concat(listFiles(root, 'tests', n => n.endsWith('.test.mjs')));
  const cache = new Map();
  const text = rel => {
    if (!cache.has(rel)) cache.set(rel, readText(join(root, rel)));
    return cache.get(rel);
  };
  for (const rel of contracts) {
    const body = text(rel);
    if (body === null) continue;
    body.split(/\r?\n/).forEach((line, i) => {
      const hit = sentencesOf(line);
      if (!hit) return;
      const where = `${rel}:${i + 1}`;
      const named = [...new Set(hit.tokens.map(t => namedFile(root, t)).filter(p => p && p !== rel))];
      for (const f of named) {
        const t = text(f);
        if (t !== null && !t.includes(hit.sentence)) errors.push(`ERROR ${where} sentence differs from ${f}`);
      }
      const namedTests = named.filter(isTest);
      if (namedTests.length === 0 && !tests.some(f => text(f)?.includes(hit.sentence))) {
        errors.push(`ERROR ${where} sentence not found in any test file (scripts or tests)`);
      }
    });
  }
  return [...new Set(errors)];
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const root = resolve(process.argv[2] ?? join(fileURLToPath(import.meta.url), '..', '..'));
  const errors = probe(root);
  errors.forEach(l => console.log(l));
  console.log(`${errors.length} error(s)`);
  process.exit(errors.length ? 1 : 0);
}
