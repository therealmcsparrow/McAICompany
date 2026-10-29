// The one-line "mods are loaded" text shown once at session start. Pure: no engine object, no Node import.
const NAMES = [
  ['savvy', 'Savvy'],
  ['cache_tax', 'Cache Tax'],
  ['reflect', 'Reflect'],
  ['blast_radius', 'Blast Radius'],
];
const SEMVER = /^\d+\.\d+\.\d+$/;

// `mods` is the resolved settings value; `known` is false when the settings call failed (the defaults then stand in).
// `version` is the plugin version `x.y.z`; anything else leaves it out.
export function readyText(mods, known, version) {
  const note = known === true ? '' : ' (settings unknown)';
  const head = typeof version === 'string' && version.length <= 8 && SEMVER.test(version) ? `aico ${version}` : 'aico';
  if (mods === null || typeof mods !== 'object') return `${head} mods ready${note}`;
  const on = NAMES.filter(([key]) => {
    const one = Object.hasOwn(mods, key) ? mods[key] : undefined;
    return one !== null && typeof one === 'object' && one.enabled === true;
  }).map(([, name]) => name);
  return `${head} mods ready${note}: ${on.length > 0 ? on.join(', ') : 'none on'}`;
}
