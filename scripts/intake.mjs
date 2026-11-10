#!/usr/bin/env node
// Provider CLI for intake-record v1.1: outcomes of requests that never got a run folder.
// Node built-ins only. Records hold enums, times and a Topic; every line read is validated.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkTopic, isRunSlug } from '../mods/lib/work-folder.mjs';

const MAX_LINE = 256;
const MAX_FILE = 64 * 1024;
const MAX_LINES = 1000;
const MAX_ITEMS = 200;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const OUTCOMES = ['intake', 'needs-info', 'rejected'];
const KEYS = ['v', 'at', 'id', 'outcome', 'topic', 'slug'];
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ID_RE = /^[0-9a-f]{12}$/;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const USAGE = 'usage: intake add <outcome> <topic> [<slug>] | set <id> <outcome> [<slug>] | list --json';

class Refused extends Error {}
class Usage extends Error {}
const refuse = reason => { throw new Refused(reason); };

const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function validSlug(slug) {
  return typeof slug === 'string' && slug.length <= 120 && isRunSlug(slug);
}

// Returns the record as read when every rule holds, else null.
function validRecord(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
  const keys = Object.keys(o);
  if (keys.some(k => !KEYS.includes(k))) return null;
  if (o.v !== 1 || typeof o.at !== 'string' || !AT_RE.test(o.at) || Number.isNaN(Date.parse(o.at))) return null;
  if (typeof o.id !== 'string' || !ID_RE.test(o.id)) return null;
  if (!OUTCOMES.includes(o.outcome)) return null;
  if (!checkTopic(o.topic)) return null;
  if ('slug' in o && !validSlug(o.slug)) return null;
  const rec = { v: 1, at: o.at, id: o.id, outcome: o.outcome, topic: o.topic };
  if ('slug' in o) rec.slug = o.slug;
  return rec;
}

function isPlainDir(p) {
  try {
    const st = fs.lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink() ? 'dir' : 'other';
  } catch (e) {
    if (e.code === 'ENOENT') return 'none';
    return 'other';
  }
}

// 'none' | 'ok' | 'link'
function folderState(root) {
  for (const p of [path.join(root, '.company'), path.join(root, '.company', 'intake')]) {
    const s = isPlainDir(p);
    if (s === 'other') return 'link';
    if (s === 'none') return 'none';
  }
  return 'ok';
}

// Reads the store: { missing } | { unreadable } | { records, bad: [line numbers] }.
function readStore(root) {
  const file = path.join(root, '.company', 'intake', 'intake.jsonl');
  let fd;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.nlink !== 1 || st.size > MAX_FILE) return { unreadable: true };
    fd = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW);
    const fst = fs.fstatSync(fd);
    if (!fst.isFile() || fst.nlink !== 1 || fst.size > MAX_FILE) return { unreadable: true };
    const buf = Buffer.alloc(fst.size);
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return parse(buf.subarray(0, off));
  } catch (e) {
    if (e.code === 'ENOENT') return { missing: true };
    return { unreadable: true };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function parse(buf) {
  const lines = buf.toString('utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const records = [];
  const bad = [];
  lines.forEach((line, i) => {
    let rec = null;
    if (Buffer.byteLength(line) <= MAX_LINE && !line.includes('\r')) {
      try { rec = validRecord(JSON.parse(line)); } catch { rec = null; }
    }
    if (rec) records.push(rec); else bad.push(i + 1);
  });
  return { records, bad };
}

// Latest record per id (a later line wins a tie), skipping ids older than 90 days.
function latest(records, now) {
  const by = new Map();
  for (const r of records) {
    const cur = by.get(r.id);
    if (!cur || r.at >= cur.at) by.set(r.id, r);
  }
  const fresh = new Map();
  for (const [id, r] of by) if (now - Date.parse(r.at) <= MAX_AGE_MS) fresh.set(id, r);
  return fresh;
}

export function listIntake(root, { now = Date.now() } = {}) {
  const out = { v: 1, items: [], warnings: [] };
  const fs_ = folderState(root);
  if (fs_ === 'none') return out;
  if (fs_ === 'link') return { ...out, warnings: ['intake unreadable'] };
  const store = readStore(root);
  if (store.missing) return out;
  if (store.unreadable) return { ...out, warnings: ['intake unreadable'] };
  out.warnings = store.bad.map(n => `line ${n} skipped`);
  const items = [...latest(store.records, now).values()]
    .reverse()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, MAX_ITEMS)
    .map(r => ({ id: r.id, outcome: r.outcome, topic: r.topic, slug: r.slug ?? null, at: r.at }));
  out.items = items;
  return out;
}

function ensureGitignore(dir) {
  const g = path.join(dir, '.gitignore');
  let st = null;
  try { st = fs.lstatSync(g); } catch (e) { if (e.code !== 'ENOENT') refuse('intake file unreadable'); }
  if (st) {
    if (!st.isFile() || st.nlink !== 1) refuse('intake file unreadable');
    if (st.size <= 16 && fs.readFileSync(g, 'utf8') === '*\n') return;
  }
  writeAtomic(dir, '.gitignore', '*\n');
}

function writeAtomic(dir, name, content) {
  const tmp = path.join(dir, `${name}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, content, { flag: 'wx' });
    fs.renameSync(tmp, path.join(dir, name));
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function mutate(root, now, build) {
  const company = path.join(root, '.company');
  const dir = path.join(company, 'intake');
  if (folderState(root) === 'link') refuse('intake folder is a link');
  fs.mkdirSync(dir, { recursive: true });
  if (folderState(root) !== 'ok') refuse('intake folder is a link');
  const store = readStore(root);
  if (store.unreadable) refuse('intake file unreadable');
  const records = store.missing ? [] : store.records;
  const live = latest(records, now);
  const kept = records.filter(r => live.has(r.id));
  const rec = build(live, iso(now));
  const all = [...kept, rec];
  const text = all.map(r => `${JSON.stringify(r)}\n`).join('');
  if (all.length > MAX_LINES || Buffer.byteLength(text) > MAX_FILE) refuse('intake full');
  ensureGitignore(dir);
  writeAtomic(dir, 'intake.jsonl', text);
  return rec;
}

function checkArgs({ outcome, topic, slug, id }) {
  if (id !== undefined && !(typeof id === 'string' && ID_RE.test(id))) refuse('bad id');
  if (outcome !== undefined && !OUTCOMES.includes(outcome)) refuse('bad outcome');
  if (topic !== undefined && !checkTopic(topic)) refuse('bad topic');
  if (slug !== undefined && !validSlug(slug)) refuse('bad slug');
}

function add(root, now, outcome, topic, slug) {
  checkArgs({ outcome, topic, slug });
  return mutate(root, now, (live, at) => {
    let id;
    do { id = crypto.randomBytes(6).toString('hex'); } while (live.has(id));
    const rec = { v: 1, at, id, outcome, topic };
    if (slug !== undefined) rec.slug = slug;
    return rec;
  });
}

function set(root, now, id, outcome, slug) {
  checkArgs({ id, outcome, slug });
  return mutate(root, now, (live, at) => {
    const prev = live.get(id);
    if (!prev) refuse('unknown id');
    const rec = { v: 1, at, id, outcome, topic: prev.topic };
    const s = slug ?? prev.slug;
    if (s !== undefined) rec.slug = s;
    return rec;
  });
}

export function main(argv, { root = process.cwd(), now = Date.now(), out = s => process.stdout.write(s) } = {}) {
  try {
    const [cmd, ...a] = argv;
    if (cmd === 'list' && a.length === 1 && a[0] === '--json') {
      out(`${JSON.stringify(listIntake(root, { now }))}\n`);
      return 0;
    }
    if (cmd === 'add' && (a.length === 2 || a.length === 3)) {
      const rec = add(root, now, ...a);
      out(`id: ${rec.id}\n`);
      return 0;
    }
    if (cmd === 'set' && (a.length === 2 || a.length === 3)) {
      set(root, now, ...a);
      out('ok\n');
      return 0;
    }
    throw new Usage(USAGE);
  } catch (e) {
    if (e instanceof Refused) { out(`refused: ${e.message}\n`); return 2; }
    if (e instanceof Usage) { out(`${e.message}\n`); return 2; }
    out('refused: intake file unreadable\n');
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
