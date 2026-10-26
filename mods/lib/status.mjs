// The one status line of the plugin: `aico · <savvy> · <cost> · <blast> · <reflect>`.
import { cleanText } from './guard.mjs';

export const STATUS_MAX = 160;
const PREFIX = 'aico · ';
const SEP = ' · ';
const ORDER = ['savvy', 'cost', 'blast', 'reflect'];
const DROP = ['reflect', 'cost', 'blast'];

function onePart(value) {
  const text = cleanText(value, STATUS_MAX + 1);
  return text === undefined ? '' : text.replace(/\s+/g, ' ').trim();
}

// Returns the line, or undefined when no mod has anything to say.
export function composeStatus(parts) {
  if (parts === null || typeof parts !== 'object') return undefined;
  const have = {};
  for (const key of ORDER) {
    const text = onePart(Object.hasOwn(parts, key) ? parts[key] : undefined);
    if (text !== '') have[key] = text;
  }
  const line = () => PREFIX + ORDER.filter((k) => k in have).map((k) => have[k]).join(SEP);
  if (Object.keys(have).length === 0) return undefined;
  for (const key of DROP) {
    if (line().length <= STATUS_MAX) break;
    if (Object.keys(have).length > 1) delete have[key];
  }
  if (line().length <= STATUS_MAX) return line();
  const first = ORDER.find((k) => k in have);
  const room = STATUS_MAX - PREFIX.length;
  have[first] = cleanText(have[first], room);
  return line();
}
