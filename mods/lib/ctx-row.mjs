// Context rows of the run pane: pure text and id handling, no engine object.
import { UNKNOWN } from './format.mjs';
import { AGENT_ID, MAX_CTX } from './guard.mjs';
import { CONTEXT_CAP_DEFAULT, CONTEXT_CAP_MIN, CONTEXT_CAP_MAX, handoverOf } from './context-cap.mjs';

export const NEAR_CAP = handoverOf(CONTEXT_CAP_DEFAULT);
export const OVER_CAP = CONTEXT_CAP_DEFAULT;
export const CHUNK_SIZE = 8;
export const MAX_CALLS = 5;

// Whole tokens below 1000, else thousands with one decimal: `850`, `90.0k`.
export function fmtCtx(n) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_CTX) return UNKNOWN;
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
}

// The run's marks: a whole cap 60000-1000000, and with it a whole handover up to that cap; anything else reads the defaults.
function marks(cap, handover) {
  const okCap = Number.isInteger(cap) && cap >= CONTEXT_CAP_MIN && cap <= CONTEXT_CAP_MAX;
  const over = okCap ? cap : CONTEXT_CAP_DEFAULT;
  if (!okCap) return { near: NEAR_CAP, over };
  const okNear = Number.isInteger(handover) && handover >= 1 && handover <= over;
  return { near: okNear ? handover : handoverOf(over), over };
}

function capNote(n, cap, handover) {
  const m = marks(cap, handover);
  if (n > m.over) return ' over cap';
  if (n > m.near) return ' near cap';
  return '';
}

// The one note for the status part: `over cap` beats `near cap`; anything that is not a count is ignored.
export function worstNote(counts, cap, handover) {
  if (!Array.isArray(counts)) return '';
  const m = marks(cap, handover);
  let note = '';
  for (const n of counts) {
    if (!Number.isInteger(n)) continue;
    if (n > m.over) return 'over cap';
    if (n > m.near) note = 'near cap';
  }
  return note;
}

// `ctx 90.0k near cap`, or `ctx ?` for anything that is not a count.
export function ctxCell(n, cap, handover) {
  const text = fmtCtx(n);
  return text === UNKNOWN ? `ctx ${UNKNOWN}` : `ctx ${text}${capNote(n, cap, handover)}`;
}

export function leadRow(n, cap, handover) {
  return `Lead ${ctxCell(n, cap, handover)}`;
}

// Valid, distinct ids only, in order, in chunks for one call each; at most MAX_CALLS chunks.
export function idChunks(ids) {
  const seen = new Set();
  const good = [];
  if (!Array.isArray(ids)) return [];
  for (const id of ids) {
    if (typeof id !== 'string' || !AGENT_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    good.push(id);
    if (good.length >= CHUNK_SIZE * MAX_CALLS) break;
  }
  const chunks = [];
  for (let i = 0; i < good.length; i += CHUNK_SIZE) chunks.push(good.slice(i, i + CHUNK_SIZE));
  return chunks;
}

// Pairs for the asked ids: the answered count, else null. An id that was not asked is dropped.
export function pairUp(asked, answer) {
  const found = new Map();
  if (answer !== null && typeof answer === 'object' && Array.isArray(answer.agents)) {
    for (const one of answer.agents) found.set(one.agent, one.ctx);
  }
  return asked.map((id) => ({ id, ctx: found.has(id) ? found.get(id) : null }));
}
