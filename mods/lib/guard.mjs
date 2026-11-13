// Allow-list guards for the JSON the mods read from the plugin scripts.
// Pure: no engine object, no Node import, no npm package.
import { isRunSlug } from './work-folder.mjs';

export const MAX_STDOUT = 262144;
export const MAX_CTX = 10000000;
// A subagent id: the ledger's pattern, without a leading dash so it can never read as an option in argv.
export const AGENT_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
const MAX_OUTPUT_TEXT = 65536;
const MAX_OUTPUT_LINE = 300;
// The folder part is one segment or two (a v3 run) and checked by isRunSlug; only the shape of the rest is read here.
const OUTPUT_LINE = /^Output: \.company\/work\/([^/]{1,120}(?:\/[^/]{1,80})?)\/(\d{2,3})-([a-z][a-z0-9-]{0,40})\.md$/;
const MAX_DEPTH = 32;
const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

// Mirrors MODS_DEFAULTS in scripts/settings.mjs (a test keeps them equal).
export const MODS_DEFAULTS = {
  savvy: { enabled: true, pane: 'auto' },
  cache_tax: { enabled: true, pane: 'command' },
  reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' }
};

export function trimEol(text) {
  if (typeof text !== 'string') return '';
  let end = text.length;
  while (end > 0 && (text.charCodeAt(end - 1) === 10 || text.charCodeAt(end - 1) === 13)) end--;
  return text.slice(0, end);
}

function dropLoneHigh(text) {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}

// One line of text: control and bidi characters become spaces, cut to `max` characters with an ellipsis.
export function cleanText(value, max) {
  if (typeof value !== 'string') return undefined;
  const head = value.length > max ? value.slice(0, max + 1) : value;
  const flat = head.replace(CONTROL, ' ');
  if (flat.length <= max) return flat;
  if (max < 1) return '';
  return dropLoneHigh(flat.slice(0, max - 1)) + '…';
}

function clean(value, depth) {
  if (depth > MAX_DEPTH) throw new Error('too deep');
  if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out = Object.create(null);
    for (const key of Object.keys(value)) {
      if (DANGEROUS.has(key)) continue;
      out[key] = clean(value[key], depth + 1);
    }
    return out;
  }
  return value;
}

export function parseJson(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'json' };
  if (text.length > MAX_STDOUT) return { ok: false, reason: 'oversize' };
  try {
    return { ok: true, value: clean(JSON.parse(text), 0) };
  } catch {
    return { ok: false, reason: 'json' };
  }
}

// A guard returns the cleaned value, or undefined when the value is not allowed.
export const str = (max) => (v) => cleanText(v, max);
export const int = (min, max) => (v) => (Number.isInteger(v) && v >= min && v <= max ? v : undefined);
export const bool = (v) => (typeof v === 'boolean' ? v : undefined);
export const oneOf = (list) => (v) => (typeof v === 'string' && list.includes(v) ? v : undefined);
export const pattern = (re) => (v) => (typeof v === 'string' && v.length <= 256 && re.test(v) ? v : undefined);
export const opt = (g) => (v) => (v === undefined || v === null ? null : g(v));
export const or = (...guards) => (v) => {
  for (const g of guards) {
    const r = g(v);
    if (r !== undefined) return r;
  }
  return undefined;
};

function isPlain(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function obj(spec) {
  const keys = Object.keys(spec);
  return (v) => {
    if (!isPlain(v)) return undefined;
    const out = Object.create(null);
    for (const key of keys) {
      const r = spec[key](Object.hasOwn(v, key) ? v[key] : undefined);
      if (r === undefined) return undefined;
      out[key] = r;
    }
    return out;
  };
}

export function arr(g, max, skipInvalid = false) {
  return (v) => {
    if (!Array.isArray(v) || v.length > max) return undefined;
    const out = [];
    for (const item of v) {
      const r = g(item);
      if (r === undefined) {
        if (skipInvalid) continue;
        return undefined;
      }
      out.push(r);
    }
    return out;
  };
}

export function rec(keyPattern, g, max) {
  return (v) => {
    if (!isPlain(v)) return undefined;
    const keys = Object.keys(v);
    if (keys.length > max) return undefined;
    const out = Object.create(null);
    for (const key of keys) {
      if (!keyPattern.test(key)) return undefined;
      const r = g(v[key]);
      if (r === undefined) return undefined;
      out[key] = r;
    }
    return out;
  };
}

// The result of `$.process.run`, as { ok: true, value } or { ok: false, reason }.
export function interpretRun(result, guard) {
  if (!result || typeof result !== 'object' || result.exitCode !== 0) return { ok: false, reason: 'exit' };
  if (result.isStdoutTruncated === true) return { ok: false, reason: 'oversize' };
  const parsed = parseJson(trimEol(result.stdout));
  if (!parsed.ok) return parsed;
  const value = guard(parsed.value);
  return value === undefined ? { ok: false, reason: 'guard' } : { ok: true, value };
}

const ROLE_KEY = /^[a-z][a-z0-9-]{0,40}$/;
// A run slug as the scripts print it: a work folder name, a legacy slug or a v3 `<ProjectID>/<NN>-<playbook>`.
export const workFolder = (v) => (typeof v === 'string' && v.length <= 120 && isRunSlug(v) ? v : undefined);

// The first `Output:` dispatch line of a text: { slug, step, role }, or null. One trailing CR is dropped from a line,
// a line over 300 characters is skipped, and the folder must pass isRunSlug.
export function parseOutputText(text) {
  if (typeof text !== 'string') return null;
  const head = text.length > MAX_OUTPUT_TEXT ? text.slice(0, MAX_OUTPUT_TEXT) : text;
  for (const raw of head.split('\n')) {
    const found = parseOutputLine(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
    if (found !== null) return found;
  }
  return null;
}

// One line, no line end: { slug, step, role } when it is an `Output:` dispatch line with a work folder name, else null.
export function parseOutputLine(line) {
  if (typeof line !== 'string' || line.length > MAX_OUTPUT_LINE) return null;
  const m = OUTPUT_LINE.exec(line);
  return m !== null && isRunSlug(m[1]) ? { slug: m[1], step: m[2], role: m[3] } : null;
}
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const paneMode = oneOf(['auto', 'command']);
const stamp = pattern(STAMP);
const tier = oneOf(['low', 'medium', 'high', 'unknown']);

// `settings.mjs get`: the mods block and the Role names only.
export const guardSettings = obj({
  roles: rec(ROLE_KEY, obj({ name: str(40) }), 64),
  mods: obj({
    savvy: obj({ enabled: bool, pane: paneMode }),
    cache_tax: obj({ enabled: bool, pane: paneMode }),
    reflect: obj({ enabled: bool, step_check: bool, retrospective: bool, mode: oneOf(['deterministic', 'model']) })
  })
});

const runView = obj({
  v: int(1, 1),
  slug: workFolder,
  state: oneOf(['running', 'ended', 'stale', 'none']),
  started: opt(stamp),
  ended: opt(stamp),
  outcome: opt(oneOf(['ship', 'abort'])),
  wave: opt(int(1, 99)),
  gates: arr(obj({ gate: oneOf(['brief', 'plan', 'ship']), result: oneOf(['passed', 'changed', 'stopped']), at: stamp }), 16),
  round: or(int(0, 99), oneOf(['unknown'])),
  tier,
  steps: arr(obj({
    step: pattern(/^\d{2,3}$/),
    role: pattern(ROLE_KEY),
    status: oneOf(['done', 'blocked', 'needs-ceo', 'handover', 'unknown']),
    round: or(int(0, 99), oneOf(['unknown'])),
    file: pattern(/^\d{2,3}-[a-z0-9-]{1,80}\.md$/),
    mtime: stamp
  }), 200),
  warnings: arr(str(80), 64, true)
});

// `run-state.mjs active --json`.
export const guardRunActive = obj({ slug: opt(workFolder), view: opt(runView) });

// A count, or null: a missing key is not allowed.
const ctxCount = (v) => (v === null ? null : int(0, MAX_CTX)(v));

// `ledger.mjs agent-ctx <ids> --json`.
export const guardAgentCtx = obj({
  v: int(1, 1),
  agents: arr(obj({ agent: pattern(AGENT_ID), ctx: ctxCount }), 8)
});

// `lead-handover.mjs ctx <slug> --json`.
export const guardLeadCtx = obj({
  v: int(1, 1),
  ctx: ctxCount,
  peak: ctxCount,
  at: (v) => (v === null ? null : stamp(v))
});

const TTL_VALUES = ['5m', '1h'];

// `lead-handover.mjs ctx <slug> --json`, the `ttl` key only: '5m', '1h' or null. A missing or other value is null.
export const guardLeadTtl = (v) => {
  if (!isPlain(v)) return undefined;
  const ttl = Object.hasOwn(v, 'ttl') && typeof v.ttl === 'string' && TTL_VALUES.includes(v.ttl) ? v.ttl : null;
  return { v: 1, ttl };
};
