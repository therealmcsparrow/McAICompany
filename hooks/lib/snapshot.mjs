// Settings snapshots: written at Lead SessionStart and at every SubagentStart, read by every guarded call.
import fs from 'node:fs';
import path from 'node:path';
import { hash12 } from './event.mjs';
import { MODS_DEFAULTS } from './mods-defaults.mjs';

export const MAX_BYTES = 4096;
export const MAX_STEP_FILES = 200;
// The cap numbers live in hooks/rules/cap.mjs. A plugin root without that rule has no cap guard: any integer is accepted.
const CAP = await import('../rules/cap.mjs').then(
  (m) => ({ min: m.MIN_THRESHOLD, max: m.MAX_THRESHOLD, def: m.DEFAULT_THRESHOLD }),
  () => ({ min: 1, max: Number.MAX_SAFE_INTEGER, def: Number.MAX_SAFE_INTEGER })
);
const MAX_WARNINGS = 5;
const MAX_WARNING_CHARS = 160;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export const snapshotFolder = (mcsHome) => path.join(mcsHome, 'hook-snapshots');
export const rootKey = (root) => hash12(root ?? '');
export const leadFile = (mcsHome, root) => path.join(snapshotFolder(mcsHome), rootKey(root), 'lead.json');
export const stepFile = (mcsHome, agentKey) => path.join(snapshotFolder(mcsHome), 'steps', `step-${agentKey}.json`);
export const denyDir = (mcsHome, root) => path.join(snapshotFolder(mcsHome), rootKey(root));

function layer(file, warnings, label) {
  try {
    const o = readJson(file);
    return isObj(o) ? (isObj(o.aico_settings) ? o.aico_settings : o) : {};
  } catch (e) {
    if (e.code !== 'ENOENT') warnings.push(`${label}: unreadable, defaults apply`);
    return {};
  }
}

const walk = (o, keys) => keys.reduce((cur, k) => (isObj(cur) && Object.hasOwn(cur, k) ? cur[k] : undefined), o);

// A saver's default is the plugin default of its switch (MODS_DEFAULTS); a switch the table does not know counts as on.
const savedDefault = (keys) => {
  const d = walk({ mods: MODS_DEFAULTS }, keys);
  return typeof d === 'boolean' ? d : true;
};

// Effective settings for the snapshot: the cap threshold (user level only) and one switch per saver manifest.
export function resolveSnapshotSettings({ mcsHome, root, manifests }) {
  const warnings = [];
  const user = layer(path.join(mcsHome, 'config.json'), warnings, 'config.json');
  const project = root ? layer(path.join(root, '.company', 'settings.json'), warnings, '.company/settings.json') : {};
  let threshold = CAP.def;
  const cap = walk(user, ['pipeline', 'context_cap']);
  if (cap !== undefined) {
    if (Number.isInteger(cap) && cap >= CAP.min && cap <= CAP.max) threshold = cap;
    else warnings.push(`pipeline.context_cap: ignoring the stored value, valid is ${CAP.min}-${CAP.max}`);
  }
  const savers = {};
  for (const m of manifests) {
    if (m.kind !== 'saver' || typeof m.switch !== 'string') continue;
    const keys = m.switch.split('.');
    const p = walk(project, keys);
    const u = walk(user, keys);
    savers[m.id] = typeof p === 'boolean' ? p : typeof u === 'boolean' ? u : savedDefault(keys);
  }
  return { threshold, savers, warnings };
}

// The snapshot object, or null when the model floor cannot be read.
export function buildSnapshot({ pluginRoot, mcsHome, root, manifests, drift, now = Date.now() }) {
  let floor;
  try {
    const f = readJson(path.join(pluginRoot, 'company', 'model-floor.json'));
    if (!isObj(f) || !isObj(f.floor)) return null;
    floor = f.floor;
  } catch { return null; }
  const s = resolveSnapshotSettings({ mcsHome, root, manifests });
  const snap = {
    v: 1, at: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'), threshold: s.threshold, savers: s.savers, floor,
    drift: drift === true,
    settingsWarnings: s.warnings.slice(0, MAX_WARNINGS).map((w) => w.slice(0, MAX_WARNING_CHARS))
  };
  return Buffer.byteLength(JSON.stringify(snap)) <= MAX_BYTES ? snap : null;
}

export function validSnapshot(s) {
  return isObj(s) && s.v === 1 && typeof s.at === 'string' && Number.isInteger(s.threshold) && s.threshold > 0
    && isObj(s.savers) && isObj(s.floor) && typeof s.drift === 'boolean' && Array.isArray(s.settingsWarnings);
}

function parseSnapshot(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return { ok: false };
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return validSnapshot(s) ? { ok: true, snapshot: s } : { ok: false };
  } catch (e) { return { ok: false, missing: e.code === 'ENOENT' }; }
}

// A Step reads its own file, else its root's lead.json; a Lead reads lead.json.
export function readSnapshot({ mcsHome, root }, event) {
  if (event.session === 'step' && event.agentKey) {
    const own = parseSnapshot(stepFile(mcsHome, event.agentKey));
    if (own.ok || !own.missing) return own;
  }
  return parseSnapshot(leadFile(mcsHome, root));
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* none */ }
    throw e;
  }
}

export function writeLead({ mcsHome, root }, snap) {
  try { writeAtomic(leadFile(mcsHome, root), JSON.stringify(snap)); return true; } catch { return false; }
}

// Written once per agentKey; the oldest files beyond the limit are deleted.
export function writeStepOnce({ mcsHome }, agentKey, snap) {
  const file = stepFile(mcsHome, agentKey);
  try {
    if (fs.existsSync(file)) return true;
    writeAtomic(file, JSON.stringify(snap));
    const dir = path.dirname(file);
    const keep = path.basename(file);
    const all = fs.readdirSync(dir).filter((n) => /^step-[0-9a-z]+\.json$/.test(n) && n !== keep)
      .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => a.t - b.t);
    for (const { n } of all.slice(0, Math.max(0, all.length + 1 - MAX_STEP_FILES))) {
      try { fs.unlinkSync(path.join(dir, n)); } catch { /* gone */ }
    }
    return true;
  } catch { return false; }
}
