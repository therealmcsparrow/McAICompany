// The one status line of the plugin: `aico · <savvy> · <blast> · <cost> · <reflect>`.
import { cellWidth, fit } from './format.mjs';

export const STATUS_MAX = 80;
// Per-part caps in terminal cells: 7 + 64 + 3 * 3 = 80, so all four parts always fit on one line.
export const STATUS_CAPS = Object.freeze({ savvy: 24, blast: 10, cost: 20, reflect: 10 });
const PREFIX = 'aico · ';
const SEP = ' · ';
const ORDER = ['savvy', 'blast', 'cost', 'reflect'];
const DROP = ['reflect', 'cost', 'blast'];

function onePart(value, cap) {
  if (typeof value !== 'string') return '';
  return fit(value.slice(0, cap * 4 + 8).replace(/\s+/g, ' ').trim(), cap);
}

// Returns the line, or undefined when no mod has anything to say.
export function composeStatus(parts, options) {
  if (parts === null || typeof parts !== 'object') return undefined;
  const max = options !== null && typeof options === 'object' && Number.isSafeInteger(options.max) ? options.max : STATUS_MAX;
  const have = {};
  for (const key of ORDER) {
    if (!Object.hasOwn(parts, key)) continue;
    const text = onePart(parts[key], STATUS_CAPS[key]);
    if (text !== '') have[key] = text;
  }
  if (Object.keys(have).length === 0) return undefined;
  const line = () => PREFIX + ORDER.filter((k) => k in have).map((k) => have[k]).join(SEP);
  for (const key of DROP) {
    if (cellWidth(line()) <= max) break;
    if (Object.keys(have).length > 1) delete have[key];
  }
  if (cellWidth(line()) <= max) return line();
  const first = ORDER.find((k) => k in have);
  have[first] = fit(have[first], Math.max(1, max - cellWidth(PREFIX)));
  return line();
}
