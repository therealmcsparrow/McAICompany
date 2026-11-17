#!/usr/bin/env node
// Static smoke check for HTML pages: a few markup barriers, found with one linear scan and no browser.
// Usage: node scripts/a11y-smoke.mjs [file.html ...]
// With files: checks exactly those. Without: tracked *.html under the working directory
// (git ls-files), minus any path with a "fixtures" folder.
// Exit 0: no barrier found. Exit 1: a barrier or an unreadable file.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_REPORTED = 40;
const MAX_ANCHOR_TEXT = 2000;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export function esc(s) {
  return String(s).replace(CONTROL, (c) => {
    if (c === '\n') return '\\n';
    if (c === '\r') return '\\r';
    if (c === '\t') return '\\t';
    return `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`;
  });
}

const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
const isNameChar = (c) => (c >= 48 && c <= 58) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95;
const isAlpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

// Parses attributes from src starting at i. Returns { attrs, end } where end is the index after '>'
// (or src.length when the tag never closes).
function parseAttrs(src, i) {
  const attrs = new Map();
  const n = src.length;
  while (i < n) {
    let c = src.charCodeAt(i);
    if (isSpace(c) || c === 47) { i++; continue; }
    if (c === 62) return { attrs, end: i + 1 };
    const ns = i;
    i++;
    while (i < n) {
      c = src.charCodeAt(i);
      if (isSpace(c) || c === 61 || c === 62 || c === 47) break;
      i++;
    }
    const name = src.slice(ns, i).toLowerCase();
    while (i < n && isSpace(src.charCodeAt(i))) i++;
    let value = '';
    if (i < n && src.charCodeAt(i) === 61) {
      i++;
      while (i < n && isSpace(src.charCodeAt(i))) i++;
      c = i < n ? src.charCodeAt(i) : 0;
      if (c === 34 || c === 39) {
        const close = src.indexOf(src[i], i + 1);
        if (close < 0) { value = src.slice(i + 1); i = n; } else { value = src.slice(i + 1, close); i = close + 1; }
      } else {
        const vs = i;
        while (i < n) {
          c = src.charCodeAt(i);
          if (isSpace(c) || c === 62) break;
          i++;
        }
        value = src.slice(vs, i);
      }
    }
    if (!attrs.has(name)) attrs.set(name, value);
  }
  return { attrs, end: n };
}

function stripCssComments(css) {
  let out = '';
  let i = 0;
  for (;;) {
    const s = css.indexOf('/*', i);
    if (s < 0) return out + css.slice(i);
    out += css.slice(i, s);
    const e = css.indexOf('*/', s + 2);
    if (e < 0) return out;
    i = e + 2;
  }
}

const OUTLINE_OFF = /(?:^|[;\s])outline\s*:\s*(?:none|0(?![.\d]))/i;

// Returns the number of :focus rules in css that switch the outline off.
function focusOutlineHits(css, hits) {
  const text = stripCssComments(css);
  let seg = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const selector = text.slice(seg, open).trim();
    if (selector.startsWith('@')) { i = open + 1; seg = i; continue; }
    const close = text.indexOf('}', open + 1);
    const body = close < 0 ? text.slice(open + 1) : text.slice(open + 1, close);
    if (/:focus/i.test(selector) && !/:not\(\s*:focus/i.test(selector) && !/:focus\s*:not\(/i.test(selector) && OUTLINE_OFF.test(body)) {
      hits.push(selector.length > 60 ? `${selector.slice(0, 60)}...` : selector);
    }
    if (close < 0) break;
    i = close + 1;
    seg = i;
  }
}

function lineAt(src, pos) {
  let line = 1;
  let i = -1;
  while ((i = src.indexOf('\n', i + 1)) >= 0 && i < pos) line++;
  return line;
}

const hasOwnName = (a) => (a.get('aria-label') ?? '').trim() !== '' || (a.get('aria-labelledby') ?? '').trim() !== '' || (a.get('title') ?? '').trim() !== '';

export function checkSource(src) {
  const found = [];
  const add = (rule, msg, pos) => found.push({ rule, msg, pos });
  const lower = src.toLowerCase();
  const n = src.length;
  let i = 0;
  let htmlSeen = false;
  let mainCount = 0;
  let nameful = 0;
  let openLabels = 0;
  const labelFor = new Set();
  const ids = new Set();
  const pendingFields = [];
  const skipTargets = [];
  const stacks = { button: [], a: [] };
  const css = [];

  const finishAnchor = (e, endPos) => {
    const text = src.slice(e.openEnd, Math.min(endPos, e.openEnd + MAX_ANCHOR_TEXT)).replace(/<[^>]*>/g, ' ');
    if (e.href.length > 1 && /skip/i.test(text)) skipTargets.push({ id: e.href.slice(1), pos: e.pos });
    if (!e.own && nameful === e.nameful) add('link name', 'link has no accessible name (text, aria-label or aria-labelledby)', e.pos);
  };

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      if (/\S/.test(src.slice(i))) nameful++;
      break;
    }
    if (lt > i && /\S/.test(src.slice(i, lt))) nameful++;
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      if (e < 0) break;
      i = e + 3;
      continue;
    }
    const c1 = lt + 1 < n ? src.charCodeAt(lt + 1) : 0;
    if (c1 === 33 || c1 === 63) {
      const e = src.indexOf('>', lt + 2);
      if (e < 0) break;
      i = e + 1;
      continue;
    }
    const closing = c1 === 47;
    const ns = lt + (closing ? 2 : 1);
    if (!isAlpha(ns < n ? src.charCodeAt(ns) : 0)) { i = lt + 1; continue; }
    let ne = ns;
    while (ne < n && isNameChar(src.charCodeAt(ne))) ne++;
    const name = lower.slice(ns, ne);
    if (closing) {
      const e = src.indexOf('>', ne);
      const endPos = e < 0 ? n : e + 1;
      if (name === 'label' && openLabels > 0) openLabels--;
      if (name === 'button' || name === 'a') {
        const st = stacks[name];
        const ent = st.pop();
        if (ent) {
          if (name === 'a') finishAnchor(ent, lt);
          else if (!ent.own && nameful === ent.nameful) add('button name', 'button has no accessible name (text, aria-label or aria-labelledby)', ent.pos);
        }
      }
      if (e < 0) break;
      i = endPos;
      continue;
    }
    const { attrs, end } = parseAttrs(src, ne);
    const own = hasOwnName(attrs);
    if ((attrs.get('aria-label') ?? '').trim() !== '') nameful++;
    const idv = attrs.get('id');
    if (idv) ids.add(idv);
    switch (name) {
      case 'html':
        htmlSeen = true;
        if ((attrs.get('lang') ?? '').trim() === '') add('lang', 'html element has no lang attribute value', lt);
        break;
      case 'main':
        mainCount++;
        if (mainCount === 2) add('main', 'more than one main landmark', lt);
        break;
      case 'img':
        if ((attrs.get('alt') ?? '').trim() !== '') nameful++;
        break;
      case 'label':
        openLabels++;
        if (attrs.has('for')) labelFor.add(attrs.get('for'));
        break;
      case 'button':
        if (!own) stacks.button.push({ pos: lt, nameful, own });
        break;
      case 'a':
        if (attrs.has('href')) {
          const href = attrs.get('href').trim();
          if (!own || href.startsWith('#')) stacks.a.push({ pos: lt, nameful, own, href: href.startsWith('#') ? href : '', openEnd: end });
        }
        break;
      case 'input': {
        const type = (attrs.get('type') ?? 'text').trim().toLowerCase();
        if (type === 'hidden' || type === 'submit' || type === 'reset') break;
        const named = own || openLabels > 0
          || ((type === 'button') && (attrs.get('value') ?? '').trim() !== '')
          || ((type === 'image') && (attrs.get('alt') ?? '').trim() !== '');
        if (!named) {
          if (type !== 'button' && type !== 'image' && idv) pendingFields.push({ tag: 'input', id: idv, pos: lt });
          else add('input name', 'input has no accessible name (label, aria-label or aria-labelledby)', lt);
        }
        break;
      }
      case 'select':
      case 'textarea':
        if (!own && openLabels === 0) {
          if (idv) pendingFields.push({ tag: name, id: idv, pos: lt });
          else add(`${name} name`, `${name} has no accessible name (label, aria-label or aria-labelledby)`, lt);
        }
        break;
      default:
    }
    if (name === 'script' || name === 'style') {
      const e = lower.indexOf(`</${name}`, end);
      const stop = e < 0 ? n : e;
      if (name === 'style') css.push(src.slice(end, stop));
      if (e < 0) break;
      i = stop;
      continue;
    }
    i = end;
  }

  for (const ent of stacks.button) {
    if (nameful === ent.nameful) add('button name', 'button has no accessible name (text, aria-label or aria-labelledby)', ent.pos);
  }
  for (const ent of stacks.a) finishAnchor(ent, n);
  for (const f of pendingFields) {
    if (!labelFor.has(f.id)) add(`${f.tag} name`, `${f.tag} has no accessible name (label, aria-label or aria-labelledby)`, f.pos);
  }
  if (!htmlSeen) add('lang', 'no html element, so no lang attribute', 0);
  if (mainCount === 0) add('main', 'no main landmark', 0);
  for (const s of skipTargets) {
    if (!ids.has(s.id)) add('skip link', 'skip link points to an id that is not on the page', s.pos);
  }
  const hits = [];
  for (const block of css) focusOutlineHits(block, hits);
  for (const sel of hits) add('focus outline', `focus rule "${esc(sel)}" removes the outline`, 0);
  return found;
}

function listTracked() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return out.split('\0').filter((p) => p !== '' && /\.html$/i.test(p) && !p.split('/').includes('fixtures'));
}

function main() {
  const t0 = Date.now();
  const lines = [];
  let failed = 0;
  let barriers = 0;
  let files = process.argv.slice(2);
  if (files.length === 0) {
    try {
      files = listTracked();
    } catch {
      process.stdout.write('smoke check: cannot list tracked files with git\n');
      process.exit(1);
    }
  }
  process.stderr.write(`a11y smoke check: start, ${files.length} file(s)\n`);
  files.forEach((file, idx) => {
    const label = esc(file);
    process.stderr.write(`a11y smoke check: [${idx + 1}/${files.length}] ${label}\n`);
    let src;
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) throw Object.assign(new Error('x'), { code: 'NOTFILE' });
      if (st.size > MAX_BYTES) throw Object.assign(new Error('x'), { code: 'TOOBIG' });
      src = fs.readFileSync(file, 'utf8');
    } catch (err) {
      const why = err.code === 'NOTFILE' ? 'not a regular file' : err.code === 'TOOBIG' ? `larger than ${MAX_BYTES} bytes` : `cannot read (${esc(err.code ?? 'error')})`;
      lines.push(`${label}: unreadable: ${why}`);
      barriers++;
      failed++;
      return;
    }
    const found = checkSource(src);
    barriers += found.length;
    if (found.length > 0) failed++;
    found.slice(0, MAX_REPORTED).forEach((f) => {
      lines.push(`${label}:${lineAt(src, f.pos)}: ${f.rule}: ${f.msg}`);
    });
    if (found.length > MAX_REPORTED) lines.push(`${label}: ${found.length - MAX_REPORTED} more barrier(s) not shown`);
  });
  lines.push(barriers === 0
    ? `smoke check: ${files.length} file(s), no barrier found (a smoke check covers a few markup rules, not a full audit)`
    : `smoke check: ${files.length} file(s), ${barriers} barrier(s) found`);
  process.stdout.write(`${lines.join('\n')}\n`);
  process.stderr.write(`a11y smoke check: done, ${files.length - failed}/${files.length} file(s) passed, ${barriers} barrier(s), ${Math.round((Date.now() - t0) / 1000)}s\n`);
  process.exitCode = barriers === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
