// Pure rules of the reprompt write gate: the spawn check, the path match and the tool allow-list.
// No engine object, no Node import, no npm package.

import { cleanText } from './guard.mjs';

export const SPAWN_SCAN = 65536;
export const MAX_PATH = 4096;
export const ARM_TTL_MS = 1_800_000;

const REPROMPTER = /^(aico:)?reprompter$/;
const OUTPUT = /^Output: \.company\/work\/(reprompt-\d{8}-\d{4}(?:-[2-9])?)\/(\d{2,3})-reprompter\.md$/;
const SLUG = /^reprompt-\d{8}-\d{4}(?:-[2-9])?$/;
const NN = /^\d{2,3}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const DRIVE = /^[A-Za-z]:$/;
const BAD_END = /[. ]$/;
const RUN_FILE = /^(request|answers-\d+|edit-\d+|prompt|\d{2,3}-reprompter)\.md$/;
const UPPER = /[A-Z]/g;

export function isReprompter(type) {
  return typeof type === 'string' && REPROMPTER.test(type);
}

export function isWindowsRoot(root) {
  return typeof root === 'string' && /^[A-Za-z]:/.test(root);
}

// Only ASCII letters fold: a non-ASCII look-alike (U+212A) must stay different.
function fold(text, ci) {
  return ci ? text.replace(UPPER, (c) => c.toLowerCase()) : text;
}

// The path as one canonical string, or null. Absolute only; `\` reads as `/`; no `.`, `..`, empty
// segment, `:` beyond the drive colon, control character, or segment ending in a dot or a space.
export function cleanPath(value, ci) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH) return null;
  const text = value.replace(/\\/g, '/');
  if (CONTROL.test(text)) return null;
  const parts = text.split('/');
  let prefix;
  if (parts[0] === '') prefix = '';
  else if (DRIVE.test(parts[0])) prefix = parts[0];
  else return null;
  const rest = parts.slice(1);
  if (rest.length === 0) return null;
  for (const seg of rest) {
    if (seg === '' || seg === '.' || seg === '..' || seg.includes(':') || BAD_END.test(seg)) return null;
  }
  return fold(`${prefix}/${rest.join('/')}`, ci);
}

// The one `Output:` line of a dispatch, read from complete lines of the first 64 KiB.
// Another line starting with `Output:` makes the dispatch ambiguous, so it is refused.
export function parseOutputLine(prompt) {
  if (typeof prompt !== 'string') return null;
  let head = prompt;
  if (prompt.length > SPAWN_SCAN) {
    head = prompt.slice(0, SPAWN_SCAN);
    head = head.slice(0, head.lastIndexOf('\n') + 1);
  }
  let found = null;
  let seen = 0;
  for (const line of head.split('\n')) {
    if (!line.startsWith('Output:')) continue;
    seen++;
    const m = OUTPUT.exec(line);
    if (m !== null) found = { slug: m[1], nn: m[2] };
  }
  return seen === 1 ? found : null;
}

// `{ slug, nn }` when the spawn of a reprompter is well formed, else null.
export function checkSpawn(e, root) {
  if (e === null || typeof e !== 'object') return null;
  if (e.fork === true || e.isTeammate !== undefined || e.workflow !== undefined || e.resume !== undefined) return null;
  const ci = isWindowsRoot(root);
  const here = cleanPath(root, ci);
  if (here === null) return null;
  if (e.cwd !== undefined && cleanPath(e.cwd, ci) !== here) return null;
  return parseOutputLine(e.prompt);
}

function ownString(input, key) {
  if (input === null || typeof input !== 'object' || !Object.hasOwn(input, key)) return undefined;
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

// Whether a recorded reprompter may make this call. `rec` is `{ slug, nn, root }`.
export function allowsTool(tool, input, rec, pluginRoot) {
  if (tool === 'Skill') return ownString(input, 'skill') === 'aico:handoff';
  if (tool !== 'Write' && tool !== 'Read') return false;
  if (rec === null || typeof rec !== 'object' || !SLUG.test(rec.slug) || !NN.test(rec.nn)) return false;
  const ci = isWindowsRoot(rec.root);
  const root = cleanPath(rec.root, ci);
  const path = cleanPath(ownString(input, 'file_path'), ci);
  if (root === null || path === null) return false;
  const run = `${root}/${fold('.company/work/', ci)}${fold(rec.slug, ci)}`;
  if (tool === 'Write') return path === `${run}/prompt.md` || path === `${run}/${rec.nn}-reprompter.md`;
  if (path === `${root}/${fold('.company/project.md', ci)}`) return true;
  if (path.startsWith(`${run}/`)) {
    const name = path.slice(run.length + 1);
    return !name.includes('/') && RUN_FILE.test(name);
  }
  const plugin = cleanPath(pluginRoot, ci);
  if (plugin === null) return false;
  return path === `${plugin}/${fold('company/PROFILE.md', ci)}` || path.startsWith(`${plugin}/skills/handoff/`);
}

// Whether a run-state text holds an end line: one LF-split line that parses to an object with ev "end".
export function runEnded(text) {
  if (typeof text !== 'string') return false;
  for (const line of text.split('\n')) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row !== null && typeof row === 'object' && !Array.isArray(row) && Object.hasOwn(row, 'ev') && row.ev === 'end') return true;
  }
  return false;
}

// Whether an armed-run entry still holds: inside the time window, marker a plain file, run not ended.
export function armLive(entry, now, { markerFile, ended } = {}) {
  const age = now - entry.at;
  if (!(age >= 0) || age > ARM_TTL_MS) return false;
  return markerFile === true && ended !== true;
}

// A bounded record map: the oldest record goes first.
export function remember(map, key, value, max) {
  map.delete(key);
  while (map.size >= max) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
  map.set(key, value);
}

function toolLabel(tool) {
  return cleanText(tool, 40) ?? '?';
}

export function refusalReason(tool) {
  return `aico reprompt gate: ${toolLabel(tool)} refused; the reprompter may write only prompt.md and its Handoff in its run folder`;
}

export function refusalToast(tool, input) {
  return `aico: reprompter ${toolLabel(tool)} refused: ${cleanText(ownString(input, 'file_path'), 80) ?? ''}`;
}

// Guard for `reprompt-check.mjs arm`: exactly `{"armed":"<nn>"}`.
export function guardArmed(nn) {
  return (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== 'armed' || !Object.hasOwn(value, 'armed') || value.armed !== nn) return undefined;
    return nn;
  };
}
