// The plugin's own version, read from the text of its `.claude-plugin/plugin.json`. Pure: no engine object, no Node import.
const SEMVER = /^\d+\.\d+\.\d+$/;
// The status part is `v` plus the version inside 9 cells, so 8 characters at most (`10.20.30`).
const VERSION_MAX = 8;
const TEXT_MAX = 65536;

// Returns `x.y.z`, or undefined for anything else (never raw file text).
export function parseVersion(text) {
  if (typeof text !== 'string' || text.length > TEXT_MAX) return undefined;
  try {
    const json = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (json === null || typeof json !== 'object' || !Object.hasOwn(json, 'version')) return undefined;
    const v = json.version;
    return typeof v === 'string' && v.length <= VERSION_MAX && SEMVER.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}
