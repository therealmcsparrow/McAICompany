// Text formatting for the views: widths in terminal cells, exact integers, times.
import { cleanText } from './guard.mjs';

export const UNKNOWN = '?';

function isWide(cp) {
  return (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd);
}

function isMark(cp) {
  return (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f);
}

function charWidth(ch) {
  const cp = ch.codePointAt(0);
  if (isMark(cp)) return 0;
  return isWide(cp) ? 2 : 1;
}

export function cellWidth(text) {
  if (typeof text !== 'string') return 0;
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  return w;
}

function dropLoneHigh(text) {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}

// Cut to `max` characters, with an ellipsis as the last one.
export function cut(text, max) {
  if (typeof text !== 'string' || max < 1) return '';
  if (text.length <= max) return text;
  return dropLoneHigh(text.slice(0, max - 1)) + '…';
}

// Cut to `width` terminal cells, with an ellipsis; control characters become spaces.
export function fit(text, width) {
  if (width < 1) return '';
  const limit = width * 4 + 8;
  const flat = cleanText(text, limit + 1);
  if (flat === undefined) return '';
  const over = flat.length > limit;
  const head = over ? flat.slice(0, limit) : flat;
  if (!over && cellWidth(head) <= width) return head;
  let out = '';
  let w = 0;
  for (const ch of head) {
    const cw = charWidth(ch);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

export function fmtInt(n) {
  return Number.isSafeInteger(n) ? String(n) : UNKNOWN;
}

export function fmtPct(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return UNKNOWN;
  return String(Math.round((part / whole) * 100));
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return UNKNOWN;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

// Local HH:MM of an epoch time in milliseconds.
export function fmtClock(ms) {
  if (!Number.isFinite(ms)) return UNKNOWN;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return UNKNOWN;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// NO_COLOR set to a non-empty value turns colour off.
export function colorEnabled(noColor) {
  return typeof noColor !== 'string' || noColor === '';
}
