// The Lesson text rules, as an allow-list. Pure: no Node imports, so a mod and a script share one rule.
export const MIN_TEXT = 10;
export const MAX_TEXT = 240;
// Allow-list: letters, digits, a plain space and . , ; : ! ? ' " ( ) - _ / %
export const TEXT_RE = /^[\p{L}\p{N} .,;:!?'"()\-_/%]+$/u;

// Returns null when the text may be written, else the reason it is refused.
export function checkText(text) {
  if (typeof text !== 'string') return 'text must be a string';
  if (/[\p{C}\p{Zl}\p{Zp}]/u.test(text)) return 'text must be one line with no control character';
  const t = text.trim();
  if (t.length < MIN_TEXT || t.length > MAX_TEXT) return `text must be ${MIN_TEXT}-${MAX_TEXT} characters`;
  if (t.startsWith('-')) return 'text must not start with -';
  if (!TEXT_RE.test(t)) return 'text may hold only letters, digits, spaces and the marks . , ; : ! ? \' " ( ) - _ / %';
  return null;
}
