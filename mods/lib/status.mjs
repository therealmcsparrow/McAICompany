// The one status line of the plugin: `v<x.y.z> · <savvy> · <cost> · <reflect>` (the host adds its own 8 cell prefix).
import { cellWidth, fit } from './format.mjs';

export const STATUS_MAX = 70;
// Stands in the first slot while no run part (`savvy`) is set, when the caller asks for it.
export const IDLE = 'aico idle';
// Per-part caps in terminal cells: 8 + 17 + 13 + 10 + 3 * 3 = 57; the caps sum to 57 <= STATUS_MAX 70, and STATUS_MAX 70 + HOST_RESERVE 10 (8 cell host prefix + 2 spare) = 80 columns.
export const STATUS_CAPS = Object.freeze({ version: 8, savvy: 17, cost: 13, reflect: 10 });
const SEP = ' · ';
const ORDER = ['version', 'savvy', 'cost', 'reflect'];
const DROP = ['reflect', 'cost'];

function onePart(value, cap) {
  if (typeof value !== 'string') return '';
  return fit(value.slice(0, cap * 4 + 8).replace(/\s+/g, ' ').trim(), cap);
}

// Returns the line, or undefined when no mod has anything to say (with `options.idle === true` that is `IDLE`).
export function composeStatus(parts, options) {
  const idle = options !== null && typeof options === 'object' && options.idle === true;
  if (parts === null || typeof parts !== 'object') return idle ? IDLE : undefined;
  const max = options !== null && typeof options === 'object' && Number.isSafeInteger(options.max) ? options.max : STATUS_MAX;
  const have = {};
  for (const key of ORDER) {
    if (!Object.hasOwn(parts, key)) continue;
    const text = onePart(parts[key], STATUS_CAPS[key]);
    if (text !== '') have[key] = text;
  }
  if (idle && !('savvy' in have)) have.savvy = IDLE;
  if (Object.keys(have).length === 0) return undefined;
  const line = () => ORDER.filter((k) => k in have).map((k) => have[k]).join(SEP);
  for (const key of DROP) {
    if (cellWidth(line()) <= max) break;
    if (Object.keys(have).length > 1) delete have[key];
  }
  if (cellWidth(line()) <= max) return line();
  // The version stays whole; the first other part gives way. A line of the version alone is cut only as a last resort.
  const first = ORDER.find((k) => k !== 'version' && k in have);
  if (first === undefined) have.version = fit(have.version, Math.max(1, max));
  else {
    const rest = cellWidth(line()) - cellWidth(have[first]);
    have[first] = fit(have[first], Math.max(1, max - rest));
  }
  return line();
}
