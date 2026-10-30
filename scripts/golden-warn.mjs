#!/usr/bin/env node
// Golden warn: names every stored Handoff fixture that lacks a required section. Warn only, always exit 0.
// Node built-ins only; read-only. Usage: node scripts/golden-warn.mjs [dir]  (default tests/golden)
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED = [['Did', 'Summary'], 'Blocking', 'Next'];

export function missingSections(text) {
  const seen = new Set();
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    const m = !fence && /^## (.+?)\s*$/.exec(line);
    if (m) seen.add(m[1]);
  }
  const out = [];
  for (const need of REQUIRED) {
    const names = Array.isArray(need) ? need : [need];
    if (!names.some((n) => seen.has(n))) out.push(names[0]);
  }
  return out;
}

export function warnings(dir) {
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); }
  catch { return [`warning: ${dir} unreadable`]; }
  const out = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(join(dir, f), 'utf8'); } catch { out.push(`warning: ${f} unreadable`); continue; }
    for (const s of missingSections(text)) out.push(`warning: ${f} missing ## ${s}`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'golden');
  for (const w of warnings(dir)) console.log(w);
}
