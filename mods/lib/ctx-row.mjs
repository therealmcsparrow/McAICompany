// Context rows of the run pane: pure text and id handling, no engine object.
import { UNKNOWN } from './format.mjs';
import { AGENT_ID, MAX_CTX } from './guard.mjs';

export const NEAR_CAP = 85500;
export const OVER_CAP = 95000;
export const CHUNK_SIZE = 8;
export const MAX_CALLS = 5;

// Whole tokens below 1000, else thousands with one decimal: `850`, `90.0k`.
export function fmtCtx(n) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_CTX) return UNKNOWN;
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
}

function capNote(n) {
  if (n > OVER_CAP) return ' over cap';
  if (n > NEAR_CAP) return ' near cap';
  return '';
}

// `ctx 90.0k near cap`, or `ctx ?` for anything that is not a count.
export function ctxCell(n) {
  const text = fmtCtx(n);
  return text === UNKNOWN ? `ctx ${UNKNOWN}` : `ctx ${text}${capNote(n)}`;
}

export function leadRow(n) {
  return `Lead ${ctxCell(n)}`;
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
