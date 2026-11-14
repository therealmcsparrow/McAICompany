// Pure logic of the Switchboard pane: manifests to rows, deny lines, `set-mod` answers and message lines.
// No engine object, no Node import, no npm package.
const MAX_MANIFEST = 8192;
const MAX_TITLE = 60;
const MAX_RULE = 60;
const MAX_MESSAGE = 200;
const MAX_DENIES = 5;
const KEBAB = /^[a-z][a-z0-9-]{0,40}$/;
const RULE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SWITCH = /^mods\.([a-z][a-z0-9_]{0,40})\.enabled$/;
const EVENT = /^[A-Za-z][A-Za-z0-9]{0,40}$/;
// Control, zero-width and bidi code units, by range.
const BAD = [[0, 31], [127, 159], [8203, 8207], [8232, 8238], [8294, 8297], [65279, 65279]];
const isBad = (c) => BAD.some(([a, b]) => c >= a && c <= b);
const KEYS = ['v', 'id', 'kind', 'title', 'owner', 'sessions', 'events', 'rules', 'fail', 'switch', 'lock', 'upstream'];
const FIXED = {
  guard: { sessions: 'all', fail: 'closed', lock: true, hasSwitch: false },
  gate: { sessions: 'lead', fail: 'closed', lock: true, hasSwitch: false },
  saver: { sessions: 'lead', fail: 'open', lock: false, hasSwitch: true },
};

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isList = (v, re, max) => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && re.test(x));

// One line of text: control and bidi characters become spaces, cut to `max` characters with an ellipsis.
function clean(value, max) {
  if (typeof value !== 'string') return '';
  const head = value.length > max ? value.slice(0, max + 1) : value;
  let flat = '';
  for (let i = 0; i < head.length; i++) flat += isBad(head.charCodeAt(i)) ? ' ' : head[i];
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut) + '…';
}

function isUpstream(v) {
  if (v === null) return true;
  if (!isPlain(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 3 && ['name', 'version', 'licence'].every((k) => typeof v[k] === 'string' && v[k].length > 0 && v[k].length <= 80);
}

// A manifest of `mod-manifest` v1 as an object, or undefined: exactly its keys, each of its type, the fixed keys of its kind.
export function parseManifest(text) {
  if (typeof text !== 'string' || text.length > MAX_MANIFEST) return undefined;
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isPlain(m)) return undefined;
  const own = Object.keys(m);
  if (own.length !== KEYS.length || !KEYS.every((k) => Object.hasOwn(m, k))) return undefined;
  if (m.v !== 1 || typeof m.id !== 'string' || !KEBAB.test(m.id)) return undefined;
  if (typeof m.kind !== 'string' || !Object.hasOwn(FIXED, m.kind)) return undefined;
  const fixed = FIXED[m.kind];
  if (typeof m.title !== 'string' || m.title.length < 1 || m.title.length > MAX_TITLE) return undefined;
  if (typeof m.owner !== 'string' || !KEBAB.test(m.owner)) return undefined;
  if (m.sessions !== fixed.sessions || m.fail !== fixed.fail || m.lock !== fixed.lock) return undefined;
  if (!isList(m.events, EVENT, 16) || !isList(m.rules, RULE_ID, 16)) return undefined;
  if (m.kind !== 'saver' && m.events.length === 0) return undefined;
  if (fixed.hasSwitch) {
    if (typeof m.switch !== 'string' || !SWITCH.test(m.switch)) return undefined;
  } else if (m.switch !== null) {
    return undefined;
  }
  if (!isUpstream(m.upstream)) return undefined;
  return { v: 1, id: m.id, kind: m.kind, title: m.title, owner: m.owner, sessions: m.sessions, events: m.events, rules: m.rules, fail: m.fail, switch: m.switch, lock: m.lock, upstream: m.upstream };
}

function switchValue(mods, key) {
  const m = SWITCH.exec(key);
  if (m === null || !isPlain(mods) || !Object.hasOwn(mods, m[1])) return undefined;
  const one = mods[m[1]];
  return isPlain(one) && typeof one.enabled === 'boolean' ? one.enabled : undefined;
}

// The second line of a row: what the mod is and where it runs, from its manifest only.
function detail(m) {
  const scope = m.sessions === 'all' ? 'main chat and task steps' : 'main chat only';
  const what = m.kind === 'saver' ? `setting ${clean(String(m.switch), 60)}` : m.rules.length > 0 ? `rule ${m.rules.map((r) => clean(r, 40)).join(', ')}` : 'gate';
  return clean(`${clean(m.title, MAX_TITLE)}: ${what}, ${scope}`, 120);
}

// Rows of the two groups: guards and gates read-only, savers with their switch. The switchboard has no row for itself.
// `settings` is { known, mods }; a saver whose value is unknown cannot change.
export function rows(manifests, settings) {
  const known = isPlain(settings) && settings.known === true;
  const mods = isPlain(settings) ? settings.mods : undefined;
  const out = { guards: [], savers: [] };
  for (const m of Array.isArray(manifests) ? manifests : []) {
    if (m.kind === 'saver') {
      if (m.id === 'switchboard') continue;
      const value = known ? switchValue(mods, m.switch) : undefined;
      const state = value === undefined ? 'UNKNOWN' : value ? 'ON' : 'OFF';
      out.savers.push({ id: m.id, title: clean(m.title, MAX_TITLE), kind: m.kind, state, canChange: value !== undefined, key: m.switch, detail: detail(m) });
    } else {
      out.guards.push({ id: m.id, title: clean(m.title, MAX_TITLE), kind: m.kind, state: 'LOCKED ON', canChange: false, key: null, detail: detail(m) });
    }
  }
  return out;
}

function timeOf(at) {
  if (typeof at !== 'string') return undefined;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? undefined : ms;
}

function hhmm(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// The newest five lines of `hook-check.mjs denies --json`: `<rule>, main chat|task step, <hh:mm>`, plus the failure word when the row is not a deny.
export function denyLines(text) {
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const items = [];
  for (const row of list) {
    if (!isPlain(row) || typeof row.rule !== 'string') continue;
    items.push({ row, ms: timeOf(row.at) });
  }
  const order = items.map((item, i) => ({ item, i }));
  order.sort((a, b) => (b.item.ms ?? -Infinity) - (a.item.ms ?? -Infinity) || a.i - b.i);
  return order.slice(0, MAX_DENIES).map(({ item }) => {
    const { row, ms } = item;
    const who = typeof row.agent === 'string' && row.agent.length > 0 ? 'task step' : 'main chat';
    const parts = [clean(row.rule, MAX_RULE), who];
    if (ms !== undefined) parts.push(hhmm(ms));
    if (typeof row.kind === 'string' && row.kind !== 'deny') parts.push(clean(row.kind, 20));
    return parts.join(', ');
  });
}

const OK_ANSWER = /^set mods\.[a-z][a-z0-9_]{0,40}\.(?:enabled|seen) (?:true|false|on|off)$/;

function trimEol(text) {
  let end = text.length;
  while (end > 0 && (text.charCodeAt(end - 1) === 10 || text.charCodeAt(end - 1) === 13)) end--;
  return text.slice(0, end);
}

// The answer of `settings.mjs set-mod`: ok, or the message line. Only a `refused: ` answer of exit 2 is shown, cleaned; everything else is a fixed text.
export function parseSetMod(result) {
  const fail = { ok: false, message: 'aico could not change that setting.' };
  if (!isPlain(result) || typeof result.stdout !== 'string' || result.stdout.length > 4096) return fail;
  const line = trimEol(result.stdout);
  if (result.exitCode === 0) return OK_ANSWER.test(line) ? { ok: true } : fail;
  if (result.exitCode === 2 && line.startsWith('refused: ') && !line.includes('\n')) return { ok: false, message: clean(line, MAX_MESSAGE) };
  return fail;
}

export function lockedMessage(id) {
  return `${clean(id, 41)} is locked on and cannot be changed here.`;
}

export function toggledMessage(id, isOn) {
  return `${clean(id, 41)} set ${isOn ? 'ON' : 'OFF'}. Applies when the next task step starts.`;
}

// The `mods` block of `settings.mjs get` (its text, or the parsed value) as { <key>: { enabled?, seen? } }, booleans only; undefined when it is not an object.
export function modsFlags(text) {
  let value = text;
  if (typeof text === 'string') {
    try {
      value = JSON.parse(text);
    } catch {
      return undefined;
    }
  }
  if (!isPlain(value) || !isPlain(value.mods)) return undefined;
  const out = {};
  for (const key of Object.keys(value.mods)) {
    const one = value.mods[key];
    if (!SWITCH.test(`mods.${key}.enabled`) || !isPlain(one)) continue;
    const flags = {};
    if (typeof one.enabled === 'boolean') flags.enabled = one.enabled;
    if (typeof one.seen === 'boolean') flags.seen = one.seen;
    out[key] = flags;
  }
  return out;
}
