#!/usr/bin/env node
// Contract drift (contract: docs/contracts/contract-index.md v1). Node built-ins only; read-only, writes nothing.
// The index is computed from the `# Contract: <name> v<x>[.<y>]` headers, so no second list exists.
// Checks: a Module's declared Contract version, version cites in skills and agents, and the
// paths and exports the Contracts and ADRs point at. Scanned text is untrusted: every pattern is
// anchored or bounded, files over the cap are skipped, and paths are joined lexically under the root.
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 2_000_000;
const MAX_DEPTH = 6;
const MAX_FILES = 5000;
const HEADER = /^# Contract: ([a-z][a-z0-9]*(?:-[a-z0-9]+)*) v(\d+(?:\.\d+)?)[ \t]*$/;
const MODULE_LINE = /contract: docs\/contracts\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.md v(\d+(?:\.\d+)?)(?![\w.])/;
const USES_LINE = /^\/\/ uses: (.{1,400})$/;
const USES_ITEM = /docs\/contracts\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.md v(\d+(?:\.\d+)?)(?![\w.])/g;
const CITE = /(^|[^A-Za-z0-9_-])([a-z][a-z0-9]*(?:-[a-z0-9]+)*) v(\d+)(?:\.(\d+))?(?!\w|\.\d)/g;
const TICKED = /`([^`\n]{1,200})`/g;
const ANCHOR = /^([A-Za-z][\w.-]*)\/[\w.\/-]*$/;
const PLACEHOLDER_STEM = /(?:^|\/)[A-Za-z](?:\.[a-z]+)?$/;
const EXPORT_NOTE = /`([A-Za-z_$][\w$]*)(?:\([^`]*\))?` exported by `([^`\s]{1,200})`/g;

export function parseVersion(text) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  return m ? { major: Number(m[1]), minor: m[2] === undefined ? 0 : Number(m[2]) } : null;
}
const show = v => `v${v.major}${v.minor ? `.${v.minor}` : ''}`;

function readText(abs) {
  try {
    const st = lstatSync(abs);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return readFileSync(abs, 'utf8');
  } catch { return null; }
}

function listMarkdown(root, rel, depth = 0, out = []) {
  if (depth > MAX_DEPTH || out.length > MAX_FILES) return out;
  let entries;
  try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const r = `${rel}/${e.name}`;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) listMarkdown(root, r, depth + 1, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(r);
  }
  return out.sort();
}

export function buildIndex(root) {
  const index = new Map();
  let names;
  try { names = readdirSync(join(root, 'docs', 'contracts')).filter(n => n.endsWith('.md')).sort(); } catch { return index; }
  for (const n of names) {
    const text = readText(join(root, 'docs', 'contracts', n));
    const first = text === null ? null : text.slice(0, 300).split(/\r?\n/, 1)[0];
    const m = first === null ? null : HEADER.exec(first);
    const v = m ? parseVersion(m[2]) : null;
    if (m && v) index.set(m[1], { ...v, file: `docs/contracts/${n}` });
  }
  return index;
}

// A cite is valid when the major is the current one and the minor is not newer (ADR 0007).
const validCite = (cite, cur) => cite.major === cur.major && cite.minor <= cur.minor;

function lines(text) { return text.split(/\r?\n/); }

function checkModules(root, index, errors) {
  let names;
  try { names = readdirSync(join(root, 'scripts')).filter(n => n.endsWith('.mjs') && !n.endsWith('.test.mjs')).sort(); } catch { return; }
  for (const n of names) {
    const rel = `scripts/${n}`;
    const text = readText(join(root, rel));
    if (text === null) continue;
    const head = lines(text.slice(0, 2000)).slice(0, 4);
    const m = MODULE_LINE.exec(head[1] ?? '');
    if (m) {
      const declared = parseVersion(m[2]);
      const cur = index.get(m[1]);
      if (!cur) errors.push(`ERROR module ${rel} contract ${m[1]} declares ${show(declared)}, no such Contract`);
      else if (declared.major !== cur.major || declared.minor !== cur.minor)
        errors.push(`ERROR module ${rel} contract ${m[1]} declares ${show(declared)}, file ${show(cur)}`);
    }
    const u = USES_LINE.exec(head[2] ?? '');
    if (u) {
      for (const it of u[1].matchAll(USES_ITEM)) {
        const cite = parseVersion(it[2]);
        const cur = index.get(it[1]);
        if (!cur) errors.push(`ERROR ${rel}:3 cites ${it[1]} ${show(cite)}, no such Contract`);
        else if (!validCite(cite, cur)) errors.push(`ERROR ${rel}:3 cites ${it[1]} ${show(cite)}, current ${show(cur)}`);
      }
    }
  }
}

function checkCites(root, index, errors) {
  const files = ['skills', 'agents'].flatMap(d => listMarkdown(root, d));
  for (const rel of files) {
    const text = readText(join(root, rel));
    if (text === null) continue;
    lines(text).forEach((line, i) => {
      for (const m of line.matchAll(CITE)) {
        const cur = index.get(m[2]);
        if (!cur) continue;
        const cite = { major: Number(m[3]), minor: m[4] === undefined ? 0 : Number(m[4]) };
        if (!validCite(cite, cur)) errors.push(`ERROR ${rel}:${i + 1} cites ${m[2]} ${show(cite)}, current ${show(cur)}`);
      }
    });
  }
}

function exportsName(text, name) {
  const decl = new RegExp(`^export\\s+(?:async\\s+)?(?:function\\*?|const|let|var|class)\\s+${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'm');
  if (decl.test(text)) return true;
  for (const b of text.matchAll(/^export\s*\{([^}]{0,4000})\}/gm))
    for (const part of b[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      if ((bits[1] ?? bits[0]).trim() === name) return true;
    }
  return false;
}

// An anchor starts in a folder that exists at the repo root; a one-letter file name is an example.
function isAnchor(root, path) {
  const m = ANCHOR.exec(path);
  if (!m || PLACEHOLDER_STEM.test(path)) return false;
  try { return lstatSync(join(root, m[1])).isDirectory(); } catch { return false; }
}

function checkAnchors(root, errors) {
  const files = [...listMarkdown(root, 'docs/contracts'), ...listMarkdown(root, 'docs/adr')];
  const base = resolve(root) + sep;
  for (const rel of files) {
    const text = readText(join(root, rel));
    if (text === null) continue;
    const docName = /^docs\/contracts\/(.+)\.md$/.exec(rel)?.[1] ?? rel;
    lines(text).forEach((line, i) => {
      for (const m of line.matchAll(TICKED)) {
        const path = m[1].split(/\s/, 1)[0].replace(/:\d+(?:-\d+)?$/, '');
        if (!isAnchor(root, path)) continue;
        if (path.split('/').includes('..')) { errors.push(`ERROR ${rel}:${i + 1} anchor ${path} refused`); continue; }
        if (!resolve(root, path).startsWith(base) || !existsSync(join(root, path))) errors.push(`ERROR ${rel}:${i + 1} anchor ${path} missing`);
      }
      for (const m of line.matchAll(EXPORT_NOTE)) {
        const path = m[2];
        if (!isAnchor(root, path) || path.split('/').includes('..') || !existsSync(join(root, path))) continue;
        const src = readText(join(root, path));
        if (src !== null && !exportsName(src, m[1])) errors.push(`ERROR ${docName} provider ${path} lacks export ${m[1]}`);
      }
    });
  }
}

export function checkDrift(root) {
  const index = buildIndex(root);
  const errors = [];
  checkModules(root, index, errors);
  checkCites(root, index, errors);
  checkAnchors(root, errors);
  return [...new Set(errors)];
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const root = resolve(process.argv[2] ?? join(fileURLToPath(import.meta.url), '..', '..'));
  const errors = checkDrift(root);
  errors.forEach(l => console.log(l));
  console.log(`${errors.length} error(s)`);
  process.exit(errors.length ? 1 : 0);
}
