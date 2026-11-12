// The Lead's prompt cache clock: when the main loop's cached prefix expires.
// Pure: no engine object, no Node import, no npm package.
//
// The lifetime comes from a reading of the Lead's cache (`noteTtl`: 5 min or 1 h, measured);
// without one it is an assumed hour, labelled `1 h (assumed)`.
import { cleanText } from './guard.mjs';
import { cellWidth, fit, fmtClock } from './format.mjs';

export const MAIN_LIFETIME_MS = 60 * 60 * 1000;
export const SUBAGENT_LIFETIME_MS = 5 * 60 * 1000;
export const LIFETIME_LABEL = '1 h (measured)';
export const ASSUMED_LABEL = '1 h (assumed)';
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

const TTL_LIFETIME = { '5m': SUBAGENT_LIFETIME_MS, '1h': MAIN_LIFETIME_MS };

function isLifetime(ms) {
  return ms === SUBAGENT_LIFETIME_MS || ms === MAIN_LIFETIME_MS;
}

// The lifetime a state counts against: 5 or 60 minutes, anything else is 60.
function lifetimeOf(state) {
  if (state === null || typeof state !== 'object' || !Object.hasOwn(state, 'lifetimeMs')) return MAIN_LIFETIME_MS;
  return isLifetime(state.lifetimeMs) ? state.lifetimeMs : MAIN_LIFETIME_MS;
}

// The kept { lifetimeMs, source } of a state, or null when it holds no valid reading.
function keptOf(state) {
  if (state === null || typeof state !== 'object' || !Object.hasOwn(state, 'lifetimeMs') || !Object.hasOwn(state, 'source')) return null;
  const { lifetimeMs, source } = state;
  return isLifetime(lifetimeMs) && (source === 'measured' || source === 'assumed') ? { lifetimeMs, source } : null;
}

// The state after a reading of the Lead's cache lifetime: '5m' or '1h' is measured, anything else an assumed hour.
// The last request time is kept.
export function noteTtl(state, ttl) {
  const last = lastOf(state);
  const isKnown = typeof ttl === 'string' && Object.hasOwn(TTL_LIFETIME, ttl);
  return {
    lastRequestMs: last,
    lifetimeMs: isKnown ? TTL_LIFETIME[ttl] : MAIN_LIFETIME_MS,
    source: isKnown ? 'measured' : 'assumed'
  };
}

// The state after a main-loop request at `nowMs`. A request restarts the entry; an older time never moves it back.
// A valid earlier lifetime stays; otherwise it is 60 minutes with the source `fallback` (default `measured`).
export function noteRequest(state, nowMs, fallback) {
  const previous = lastOf(state);
  const kept = keptOf(state) ?? { lifetimeMs: MAIN_LIFETIME_MS, source: fallback === 'assumed' ? 'assumed' : 'measured' };
  if (!isTime(nowMs)) return previous === null ? { ...EMPTY_CLOCK } : { lastRequestMs: previous, ...kept };
  const last = previous !== null && previous > nowMs ? previous : nowMs;
  return { lastRequestMs: last, ...kept };
}

// The lifetime label of a state, from fixed strings.
export function lifetimeLabel(state) {
  const kept = keptOf(state);
  if (kept !== null && kept.lifetimeMs === SUBAGENT_LIFETIME_MS) return '5 min (measured)';
  if (kept !== null && kept.source === 'assumed') return ASSUMED_LABEL;
  return LIFETIME_LABEL;
}

// { kind: 'unknown' } | { kind: 'valid', expiresMs, minutesLeft } | { kind: 'expired', expiresMs }
export function cacheClock(state, nowMs) {
  const last = lastOf(state);
  if (last === null || !isTime(nowMs) || nowMs < last) return { kind: 'unknown' };
  const expiresMs = last + lifetimeOf(state);
  if (nowMs >= expiresMs) return { kind: 'expired', expiresMs };
  return { kind: 'valid', expiresMs, minutesLeft: Math.ceil((expiresMs - nowMs) / 60000) };
}

// The pane lines, not yet wrapped.
export function clockLines(clock, label = LIFETIME_LABEL) {
  const lines = [];
  if (clock && clock.kind === 'valid') {
    lines.push(`Lead cache: expires ${fmtClock(clock.expiresMs)} (in ${clock.minutesLeft} min)`);
    lines.push(`Lifetime: ${label}`);
  } else if (clock && clock.kind === 'expired') {
    lines.push(`Lead cache: expired ${fmtClock(clock.expiresMs)}; the next turn rewrites it`);
    lines.push(`Lifetime: ${label}`);
  } else {
    lines.push('Lead cache: unknown');
  }
  lines.push(SUBAGENT_LINE);
  return lines;
}

// The status text: `42m`, `exp` or `?`.
export function clockStatus(clock) {
  if (clock && clock.kind === 'valid') return `${clock.minutesLeft}m`;
  if (clock && clock.kind === 'expired') return 'exp';
  return '?';
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
