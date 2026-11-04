#!/usr/bin/env node
// Provider CLI for roadmap-list v1: reads the frontmatter of roadmap files, writes nothing.
// Node built-ins only. File names and contents are untrusted and validated here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_FILES = 200;
const MAX_READ = 4096;
const MAX_VALUE = 200;
const KEEP = ['topic', 'started', 'status'];
const LANES = [
  { lane: 'roadmap', dir: [] },
  { lane: 'not-now', dir: ['Not now'] },
  { lane: 'to-check', dir: ['to-check'] },
];
const USAGE = 'usage: roadmap list --json';
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const STRIP = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

const lstat = p => { try { return fs.lstatSync(p); } catch { return null; } };

function clean(v) {
  const s = v.replace(STRIP, '').trim();
  return s === '' ? null : Array.from(s).slice(0, MAX_VALUE).join('');
}

// Splits the buffer on LF into byte slices; the last slice has no LF after it.
function byteLines(buf) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) { lines.push({ bytes: buf.subarray(start, i), complete: true }); start = i + 1; }
  }
  lines.push({ bytes: buf.subarray(start), complete: false });
  return lines;
}

// Returns { topic, started, status } or null when the file has no readable frontmatter.
function readFrontmatter(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW);
    if (!fs.fstatSync(fd).isFile()) return null;
    const buf = Buffer.alloc(MAX_READ);
    const n = fs.readSync(fd, buf, 0, MAX_READ, 0);
    const atEof = n < MAX_READ;
    const lines = byteLines(buf.subarray(0, n));
    const isFence = l => l.bytes.toString('latin1').replace(/\r$/, '') === '---';
    if (!isFence(lines[0]) || !lines[0].complete) return null;
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (isFence(lines[i]) && (lines[i].complete || atEof)) { end = i; break; }
    }
    if (end < 0) return null;
    const dec = new TextDecoder('utf-8', { fatal: true });
    const out = { topic: null, started: null, status: null };
    const seen = new Set();
    for (let i = 1; i < end; i++) {
      const line = dec.decode(lines[i].bytes).replace(/\r$/, '');
      const m = /^([A-Za-z_][\w-]*):(.*)$/s.exec(line);
      if (!m || !KEEP.includes(m[1]) || seen.has(m[1])) continue;
      seen.add(m[1]);
      out[m[1]] = clean(m[2]);
    }
    return out;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

export function listRoadmap(root) {
  const result = { v: 1, items: [], warnings: [] };
  const top = path.join(root, '.company', 'roadmap');
  const topStat = lstat(top);
  if (!topStat || !topStat.isDirectory()) return result;
  let count = 0;
  let over = false;
  for (const { lane, dir } of LANES) {
    const folder = path.join(top, ...dir);
    const st = lstat(folder);
    if (!st || !st.isDirectory()) continue;
    let names;
    try { names = fs.readdirSync(folder); } catch { continue; }
    names = names.filter(n => n.toLowerCase().endsWith('.md')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    let place = 0;
    for (const name of names) {
      const fst = lstat(path.join(folder, name));
      if (!fst || !fst.isFile()) continue;
      place++;
      if (count >= MAX_FILES) { over = true; continue; }
      count++;
      const fm = readFrontmatter(path.join(folder, name));
      if (!fm) { result.warnings.push(`${lane} file ${place} skipped`); continue; }
      result.items.push({ file: name, topic: fm.topic, started: fm.started, status: fm.status, lane });
    }
  }
  if (over) result.warnings.push('over 200 items');
  return result;
}

export function main(argv, { root = process.cwd(), out = s => process.stdout.write(s) } = {}) {
  if (argv.length === 2 && argv[0] === 'list' && argv[1] === '--json') {
    out(`${JSON.stringify(listRoadmap(root))}\n`);
    return 0;
  }
  out(`${USAGE}\n`);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
