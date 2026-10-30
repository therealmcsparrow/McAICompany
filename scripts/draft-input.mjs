#!/usr/bin/env node
// Draft input (contract: docs/contracts/draft-input.md v1). Node built-ins only.
// `arg` turns the argument file into a fixed result line, `free` picks a slug that never reuses earlier work,
// `take` copies a file input once, `stale` compares a draft plan's paths with HEAD.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizePath } from './plan-tasks.mjs';
import { readPlanLines } from './plan-markdown.mjs';
import { checkText } from './spec-check.mjs';
import { parseGrill } from './grill.mjs';

const FORS = ['grill', 'to-spec', 'to-tickets', 'feature'];
const MAX_ARG = 4096;
const BAD_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

class Refused extends Error {}

function words(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function cutSlug(s) {
  return s.slice(0, 62).replace(/-+$/, '');
}

function baseSlug(text) {
  return cutSlug(words(text).split('-').filter(Boolean).slice(0, 5).join('-')) || 'draft';
}

const AC_LINE = /^(?:[-*] )?\**AC\d{1,3}\**:/;
const TASK_HEAD = /^(T\d{1,3}[a-z]?)(?=$|[\s:.)-])/;
const SPEC_CAP = 64 * 1024;

const splitLines = (text) => text.split(/\r\n|\r|\n/);

function frontmatter(lines) {
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  return end === -1 ? null : lines.slice(1, end);
}

function taskCount(text) {
  let inTasks = false;
  let count = 0;
  for (const { kind, level, title } of readPlanLines(text).lines) {
    if (kind !== 'heading') continue;
    if (level === 2 && title.trim() === 'Tasks') inTasks = true;
    else if (inTasks && level >= 2 && level <= 4 && TASK_HEAD.test(title.trim())) count++;
  }
  return count;
}

const acCount = (lines) => lines.filter((l) => AC_LINE.test(l.trim())).length;

function classify(text) {
  const lines = splitLines(text);
  const fm = frontmatter(lines);
  if (lines[4] === '---' && fm && fm.length === 3 && /^slug:/.test(fm[0]) && /^version:/.test(fm[1]) && /^shipped:/.test(fm[2])) return { kind: 'spec', lines };
  if (fm && fm.includes('format: 1') && lines.includes('## Log')) return { kind: 'grill', lines };
  const tasks = taskCount(text);
  if (tasks > 0) return { kind: 'plan', lines, tasks };
  if (acCount(lines) > 0) return { kind: 'brief', lines };
  return { kind: 'text', lines };
}

// A section of the spec holds at least one non-blank line before the next "## " line.
function sectionFilled(lines, heading) {
  const at = lines.indexOf(heading);
  if (at === -1) return false;
  for (let i = at + 1; i < lines.length && !lines[i].startsWith('## '); i++) if (lines[i].trim() !== '') return true;
  return false;
}

function missingFor(forWhat, c) {
  if (forWhat !== 'to-tickets' || c.kind === 'brief') return [];
  if (c.kind !== 'spec') return ['a spec (## Problem, ## Solution) or a brief (AC<n>: lines)'];
  return ['## Problem', '## Solution'].filter((h) => !sectionFilled(c.lines, h));
}

function summary(c, text, bytes) {
  if (c.kind === 'spec') {
    if (bytes.length > SPEC_CAP) return 'spec: not ready, over 64 KiB';
    const errors = checkText(text);
    return errors.length === 0 ? 'spec: ready' : `spec: not ready, ${errors.length} errors`;
  }
  if (c.kind === 'grill') {
    const g = parseGrill(text);
    return `grill: ${g.answered} answered, ${g.open.length} open`;
  }
  if (c.kind === 'plan') return `plan: ${c.tasks} tasks`;
  if (c.kind === 'brief') return `brief: ${acCount(c.lines)} criteria`;
  const n = c.lines.length - (c.lines.at(-1) === '' ? 1 : 0);
  return `text: ${n} lines`;
}

const WIN = process.platform === 'win32';
const CASE_FOLD = WIN || process.platform === 'darwin';
const MAX_BYTES = 256 * 1024;
const sameName = (a, b) => (CASE_FOLD ? a.toLowerCase() === b.toLowerCase() : a === b);

function realRootOf(root) {
  try {
    return fs.realpathSync.native(root);
  } catch {
    throw new Refused('outside the product root');
  }
}

const inside = (realRoot, p) => {
  const r = path.relative(realRoot, p);
  return r !== '' && !r.startsWith('..') && !path.isAbsolute(r);
};

// Reads a file by the real-path rule; returns the bytes or throws Refused.
function readFile(realRoot, rel, maxBytes = MAX_BYTES) {
  const lexical = path.join(realRoot, ...rel.split('/'));
  let real;
  try {
    real = fs.realpathSync.native(lexical);
  } catch {
    try {
      if (fs.lstatSync(lexical).isSymbolicLink()) throw new Refused('link');
    } catch (error) {
      if (error instanceof Refused) throw error;
    }
    throw new Refused('missing');
  }
  if (!sameName(real, lexical)) throw new Refused('link');
  if (!inside(realRoot, real)) throw new Refused('outside the product root');
  let st;
  try {
    st = fs.lstatSync(real, { bigint: true });
  } catch {
    throw new Refused('missing');
  }
  if (st.isSymbolicLink()) throw new Refused('link');
  if (!st.isFile()) throw new Refused('not a regular file');
  if (st.nlink !== 1n) throw new Refused('hard-linked');
  let fd;
  try {
    fd = fs.openSync(real, fs.constants.O_RDONLY | (WIN ? 0 : (fs.constants.O_NOFOLLOW ?? 0)));
  } catch (error) {
    throw new Refused(error && error.code === 'ELOOP' ? 'link' : 'missing');
  }
  try {
    const f = fs.fstatSync(fd, { bigint: true });
    if (!f.isFile() || f.dev !== st.dev || f.ino !== st.ino) throw new Refused('not a regular file');
    if (f.nlink !== 1n) throw new Refused('hard-linked');
    if (f.size > BigInt(maxBytes)) throw new Refused('too large');
    const buf = Buffer.alloc(Number(f.size) + 1);
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    if (off > maxBytes) throw new Refused('too large');
    const bytes = buf.subarray(0, off);
    if (bytes.includes(0)) throw new Refused('not UTF-8');
    try {
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Refused('not UTF-8');
    }
    return Buffer.from(bytes);
  } finally {
    fs.closeSync(fd);
  }
}

// Splits "<fixed words> --for <word>" and returns the positional values and the for word.
function parseFor(args, { needFor = true } = {}) {
  const i = args.indexOf('--for');
  if (!needFor) {
    if (i !== -1) throw new Refused('usage');
    return { rest: args, forWhat: null };
  }
  if (i === -1 || args.indexOf('--for', i + 1) !== -1 || i !== args.length - 2 || !FORS.includes(args[i + 1])) throw new Refused('usage');
  return { rest: args.slice(0, i), forWhat: args[i + 1] };
}

function checkArgs(args) {
  for (const a of args) {
    if (typeof a !== 'string' || a.length > MAX_ARG || BAD_CHAR.test(a)) throw new Refused('argument is not accepted');
  }
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const WORK_FILE = /^\.company\/work\/([a-z0-9][a-z0-9-]{0,63})\/(.+)$/;
const DRAFT_PATH = /^\.company\/work\/[a-z0-9][a-z0-9-]{0,63}\/(?:grill|spec|plan)\.md$/;
const DRAFT_NAMES = new Set(['grill.md', 'spec.md', 'plan.md']);
const OUTPUT = { grill: 'grill.md', 'to-spec': 'spec.md', 'to-tickets': 'plan.md' };

function isFree(realRoot, slug, forWhat) {
  const dir = path.join(realRoot, '.company', 'work', slug);
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch (error) {
    return error && error.code === 'ENOENT';
  }
  if (forWhat === 'feature' || !st.isDirectory()) return false;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return false;
  }
  for (const name of names) {
    if (!DRAFT_NAMES.has(name) && !/^input-[a-z-]+\.md$/.test(name)) return false;
    let e;
    try {
      e = fs.lstatSync(path.join(dir, name));
    } catch {
      return false;
    }
    if (!e.isFile()) return false;
  }
  return !names.includes(OUTPUT[forWhat]) && !names.includes(`input-${forWhat}.md`);
}

// The first free candidate: the slug itself, then <slug cut to 62>-2 to -9.
function pickFree(realRoot, slug, forWhat) {
  if (!SLUG.test(slug)) throw new Refused('bad slug');
  const b = cutSlug(slug);
  const candidates = [slug];
  for (let n = 2; n <= 9; n++) candidates.push(`${b}-${n}`);
  const found = candidates.find((c) => SLUG.test(c) && isFree(realRoot, c, forWhat));
  if (!found) throw new Refused('no free slug');
  return found;
}

function free(args, root) {
  const { rest, forWhat } = parseFor(args);
  if (rest.length !== 1) throw new Refused('usage');
  return { code: 0, lines: [`slug: ${pickFree(realRootOf(root), rest[0], forWhat)}`] };
}

// Makes one folder level at a time; every level must be a real folder, never a link.
function ensureFolder(realRoot, parts) {
  let current = realRoot;
  for (const part of parts) {
    current = path.join(current, part);
    let st = null;
    try {
      st = fs.lstatSync(current);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw new Refused('link');
    }
    if (st === null) {
      fs.mkdirSync(current);
      st = fs.lstatSync(current);
    }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Refused('link');
    let real;
    try {
      real = fs.realpathSync.native(current);
    } catch {
      throw new Refused('link');
    }
    if (!sameName(real, current)) throw new Refused('link');
  }
  return current;
}

function writeNew(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (WIN ? 0 : (fs.constants.O_NOFOLLOW ?? 0)), 0o644);
  } catch {
    throw new Refused('no free slug');
  }
  try {
    fs.writeSync(fd, bytes);
  } finally {
    fs.closeSync(fd);
  }
}

function takeBase(rel) {
  const m = WORK_FILE.exec(rel);
  if (m) {
    const s = m[1];
    if (m[2] === 'grill.md' || m[2] === 'spec.md') return cutSlug(s);
    return `${cutSlug(s.slice(0, 56))}-draft`;
  }
  return baseSlug(path.basename(rel, path.extname(rel)));
}

function take(args, root) {
  const { rest, forWhat } = parseFor(args);
  if (rest.length !== 1) throw new Refused('usage');
  const norm = normalizePath(rest[0]);
  if (!norm.ok) throw new Refused(`path ${norm.reason}`);
  const rel = norm.path;
  if (forWhat === 'feature' && !DRAFT_PATH.test(rel)) throw new Refused('not a draft file');
  const realRoot = realRootOf(root);
  const bytes = readFile(realRoot, rel);
  const text = bytes.toString('utf8');
  const c = classify(text);
  const gaps = missingFor(forWhat, c);
  if (gaps.length > 0) return { code: 4, lines: gaps.map((g) => `missing: ${g}`) };
  const slug = pickFree(realRoot, takeBase(rel), forWhat);
  const dir = ensureFolder(realRoot, ['.company', 'work', slug]);
  writeNew(path.join(dir, `input-${forWhat}.md`), bytes);
  return { code: 0, lines: [`slug: ${slug}`, `input: .company/work/${slug}/input-${forWhat}.md`, `kind: ${c.kind}`, summary(c, text, bytes)] };
}

const MAX_ARG_FILE = 4096;

// Removes the argument file once an entry exists at the path; unlink never follows a link, and nothing is removed
// through a linked or missing .company folder.
function removeArgFile(realRoot, name) {
  try {
    const parent = fs.lstatSync(path.join(realRoot, '.company'));
    if (parent.isSymbolicLink() || !parent.isDirectory()) return;
    fs.unlinkSync(path.join(realRoot, '.company', name));
  } catch {
    // nothing to remove
  }
}

function argText(realRoot, forWhat) {
  const name = `draft-input-arg-${forWhat}.txt`;
  const lexical = path.join(realRoot, '.company', name);
  try {
    fs.lstatSync(lexical);
  } catch {
    throw new Refused('no argument file');
  }
  try {
    let bytes;
    try {
      bytes = readFile(realRoot, `.company/${name}`, MAX_ARG_FILE);
    } catch (error) {
      if (error instanceof Refused && error.message === 'too large') throw new Refused('argument is not accepted');
      throw error;
    }
    let text = bytes.toString('utf8');
    if (text.endsWith('\n')) text = text.slice(0, -1);
    if (BAD_CHAR.test(text)) throw new Refused('argument is not accepted');
    return text.trim();
  } finally {
    removeArgFile(realRoot, name);
  }
}

function arg(args, root) {
  const { rest, forWhat } = parseFor(args);
  if (rest.length !== 0) throw new Refused('usage');
  const realRoot = realRootOf(root);
  const text = argText(realRoot, forWhat);
  if (text === '') throw new Refused('no argument');
  if (forWhat === 'grill') {
    const m = /^resume ([a-z0-9][a-z0-9-]{0,63})$/.exec(text) ?? /^\.company\/work\/([a-z0-9][a-z0-9-]{0,63})\/grill\.md$/.exec(text.replaceAll('\\', '/'));
    if (m) return { code: 0, lines: [`arg: resume ${m[1]}`] };
  }
  if (!/\s/.test(text) && (/[/\\]/.test(text) || /\.(?:md|txt)$/.test(text))) {
    const norm = normalizePath(text);
    if (!norm.ok) throw new Refused(`path ${norm.reason}`);
    return { code: 0, lines: [`arg: file ${norm.path}`] };
  }
  if (forWhat === 'to-tickets') throw new Refused('needs a file');
  if (forWhat === 'feature') return { code: 0, lines: ['arg: idea'] };
  return { code: 0, lines: ['arg: idea', `slug: ${pickFree(realRoot, baseSlug(text), forWhat)}`] };
}

export function main(args, { root = process.cwd() } = {}) {
  try {
    checkArgs(args);
    if (args[0] === 'take') return take(args.slice(1), root);
    if (args[0] === 'free') return free(args.slice(1), root);
    if (args[0] === 'arg') return arg(args.slice(1), root);
    throw new Refused('usage');
  } catch (error) {
    if (error instanceof Refused) return { code: 3, lines: [`refused: ${error.message}`] };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, lines } = main(process.argv.slice(2));
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
