// The Lead's prompt cache clock: when the main loop's cached prefix expires.
// Pure: no engine object, no Node import, no npm package.
//
// One lifetime source: the API types carry no 1 hour / 5 minute split on a turn's
// usage (only the four token counts), so the lifetime is the constant measured for
// the main loop, labelled `1 h (measured)`.
import { cleanText } from './guard.mjs';
import { cellWidth, fit, fmtClock } from './format.mjs';

export const MAIN_LIFETIME_MS = 60 * 60 * 1000;
export const SUBAGENT_LIFETIME_MS = 5 * 60 * 1000;
export const LIFETIME_LABEL = '1 h (measured)';
export const SUBAGENT_LINE = 'Subagent caches last 5 minutes; nothing keeps them warm.';
export const EMPTY_CLOCK = { lastRequestMs: null, lifetimeMs: null, source: null };

const MAX_TIME_MS = 8.64e15;
const MAX_WRAP_CHARS = 600;
const MAX_WRAP_ROWS = 8;

function isTime(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms <= MAX_TIME_MS - MAIN_LIFETIME_MS;
}

function lastOf(state) {
  if (state === null || typeof state !== 'object' || !Object.hasOwn(state, 'lastRequestMs')) return null;
  return isTime(state.lastRequestMs) ? state.lastRequestMs : null;
}

// The state after a main-loop request at `nowMs`. A request restarts the entry; an older time never moves it back.
export function noteRequest(state, nowMs) {
  const previous = lastOf(state);
  if (!isTime(nowMs)) return previous === null ? { ...EMPTY_CLOCK } : { lastRequestMs: previous, lifetimeMs: MAIN_LIFETIME_MS, source: 'measured' };
  const last = previous !== null && previous > nowMs ? previous : nowMs;
  return { lastRequestMs: last, lifetimeMs: MAIN_LIFETIME_MS, source: 'measured' };
}

// { kind: 'unknown' } | { kind: 'valid', expiresMs, minutesLeft } | { kind: 'expired', expiresMs }
export function cacheClock(state, nowMs) {
  const last = lastOf(state);
  if (last === null || !isTime(nowMs) || nowMs < last) return { kind: 'unknown' };
  const expiresMs = last + MAIN_LIFETIME_MS;
  if (nowMs >= expiresMs) return { kind: 'expired', expiresMs };
  return { kind: 'valid', expiresMs, minutesLeft: Math.ceil((expiresMs - nowMs) / 60000) };
}

// The pane lines, not yet wrapped.
export function clockLines(clock) {
  const lines = [];
  if (clock && clock.kind === 'valid') {
    lines.push(`Lead cache: expires ${fmtClock(clock.expiresMs)} (in ${clock.minutesLeft} min)`);
    lines.push(`Lifetime: ${LIFETIME_LABEL}`);
  } else if (clock && clock.kind === 'expired') {
    lines.push(`Lead cache: expired ${fmtClock(clock.expiresMs)}; the next turn rewrites it`);
    lines.push(`Lifetime: ${LIFETIME_LABEL}`);
  } else {
    lines.push('Lead cache: unknown');
  }
  lines.push(SUBAGENT_LINE);
  return lines;
}

// The status text: `cache 42m`, `cache expired` or `cache ?`.
export function clockStatus(clock) {
  if (clock && clock.kind === 'valid') return `cache ${clock.minutesLeft}m`;
  if (clock && clock.kind === 'expired') return 'cache expired';
  return 'cache ?';
}

// Breaks text at spaces into rows of at most `width` cells; a word wider than a row is cut with an ellipsis.
export function wrap(text, width) {
  const flat = cleanText(text, MAX_WRAP_CHARS);
  if (flat === undefined || !Number.isInteger(width) || width < 1) return [''];
  const rows = [];
  let row = '';
  for (const word of flat.split(' ')) {
    if (word === '') continue;
    const piece = cellWidth(word) > width ? fit(word, width) : word;
    if (row === '') {
      row = piece;
    } else if (cellWidth(row) + 1 + cellWidth(piece) <= width) {
      row += ` ${piece}`;
    } else {
      rows.push(row);
      row = piece;
    }
    if (rows.length >= MAX_WRAP_ROWS) return rows;
  }
  rows.push(row);
  return rows;
}
