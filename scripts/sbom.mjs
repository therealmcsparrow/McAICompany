#!/usr/bin/env node
// Usage: node scripts/sbom.mjs [<out file>] (contract: docs/contracts/release.md v1)
// Builds the CycloneDX 1.6 SBOM of one plugin version (contract: docs/contracts/release.md v1). Node built-ins only.
// Inputs: .claude-plugin/plugin.json, deps/skills.json and tools/claude-cli/package-lock.json under the working directory.
// Every input is untrusted data: sizes are capped, names and versions are matched against allow-lists, and anything
// that does not match stops the build (a partial SBOM is never written).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MiB = 1024 * 1024;
export const LOCKFILE = 'tools/claude-cli/package-lock.json';
const MAX_BYTES = 8 * MiB;
const MAX_PACKAGES = 5000;
const MAX_SKILLS = 500;
const MAX_URL = 500;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const NPM_NAME = /^(@[A-Za-z0-9][A-Za-z0-9._~-]{0,213}\/)?[A-Za-z0-9][A-Za-z0-9._~-]{0,213}$/;
const NPM_VERSION = /^\d{1,9}\.\d{1,9}\.\d{1,9}(-[0-9A-Za-z.-]{1,64})?(\+[0-9A-Za-z.-]{1,64})?$/;
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:*-]{0,99}$/;
const SKILL_SOURCE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const NODE_MODULES_TAIL = /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+$/;
const SRI = /^(sha1|sha512)-([A-Za-z0-9+/]+={0,2})$/;
// Valid SPDX licence identifiers that appear in practice; any other string is kept as a licence name.
const SPDX_IDS = new Set([
  '0BSD', 'AFL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'Apache-2.0', 'Artistic-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause',
  'BSL-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'CC0-1.0', 'EPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later',
  'ISC', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'MIT', 'MIT-0', 'MPL-2.0', 'Python-2.0',
  'Unlicense', 'WTFPL', 'Zlib'
]);

export class SbomError extends Error {}
const fail = (msg) => {
  throw new SbomError(msg);
};

// Reads a regular file (no link) of at most MAX_BYTES and parses it as JSON.
function readJson(root, rel) {
  const file = path.join(root, rel);
  let st;
  try {
    st = fs.lstatSync(file);
  } catch {
    return fail(`${rel} is missing`);
  }
  if (!st.isFile()) return fail(`${rel} is not a plain file`);
  if (st.size > MAX_BYTES) return fail(`${rel} is larger than ${MAX_BYTES / MiB} MiB`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fail(`${rel} is not valid JSON`);
  }
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o, k) => (isObject(o) && Object.hasOwn(o, k) ? o[k] : undefined);

// An https URL without credentials, or undefined. Local paths, other schemes and userinfo are dropped.
export function safeUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL) return undefined;
  let u;
  try {
    u = new URL(value);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.hostname === '') return undefined;
  u.hash = '';
  return u.toString();
}

// npm integrity: one or more space-separated SRI values. Only sha512 and sha1 with a correct length become hashes.
export function hashesFrom(integrity) {
  if (typeof integrity !== 'string' || integrity.length > 1000) return [];
  const out = [];
  for (const token of integrity.trim().split(/\s+/)) {
    const m = SRI.exec(token);
    if (!m) continue;
    const bytes = Buffer.from(m[2], 'base64');
    const want = m[1] === 'sha512' ? 64 : 20;
    if (bytes.length !== want || bytes.toString('base64') !== m[2]) continue;
    const entry = { alg: m[1] === 'sha512' ? 'SHA-512' : 'SHA-1', content: bytes.toString('hex') };
    if (!out.some((h) => h.alg === entry.alg && h.content === entry.content)) out.push(entry);
  }
  return out;
}

// One licence form per component: id for a valid SPDX id, expression for an SPDX expression, otherwise a name.
export function licensesFrom(value) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text === '' || text.length > 200 || /[\u0000-\u001f\u007f]/.test(text)) return undefined;
  if (SPDX_IDS.has(text)) return [{ license: { id: text } }];
  const tokens = text.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
  const ops = new Set(['AND', 'OR', 'WITH']);
  const isExpr = /\s(AND|OR)\s/.test(text) && tokens.every((t) => ops.has(t) || SPDX_IDS.has(t));
  if (isExpr) return [{ expression: text }];
  return [{ license: { name: text } }];
}

function purlNpm(name, version) {
  const [a, b] = name.startsWith('@') ? name.split('/') : [undefined, name];
  const enc = a === undefined ? encodeURIComponent(b) : `${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
  return `pkg:npm/${enc}@${encodeURIComponent(version)}`;
}

function nameOfPath(key, entry) {
  const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
  if (m) return m[1];
  const declared = own(entry, 'name');
  return typeof declared === 'string' ? declared : undefined;
}

// Resolves a dependency name from the package at `from` the way node does: nearest node_modules up the path.
function resolveFrom(packages, from, name) {
  let base = from;
  for (let i = 0; i < 64; i++) {
    const key = `${base === '' ? '' : `${base}/`}node_modules/${name}`;
    if (Object.hasOwn(packages, key)) return key;
    if (base === '') return undefined;
    const cut = base.replace(NODE_MODULES_TAIL, '');
    base = cut === base ? '' : cut;
  }
  return undefined;
}

function lockfileParts(lock) {
  if (!isObject(lock) || lock.lockfileVersion !== 3 || !isObject(lock.packages)) return fail(`${LOCKFILE} is not a lockfileVersion 3 file`);
  const packages = lock.packages;
  const keys = Object.keys(packages);
  if (keys.length > MAX_PACKAGES) return fail(`${LOCKFILE} lists more than ${MAX_PACKAGES} packages`);
  const components = new Map();
  const refOf = new Map();
  const deps = new Map();
  let complete = true;
  for (const key of keys) {
    if (key === '') continue;
    const entry = packages[key];
    if (!isObject(entry)) return fail(`${LOCKFILE}: entry ${JSON.stringify(key.slice(0, 80))} is not an object`);
    if (entry.link === true) continue;
    const name = nameOfPath(key, entry);
    const version = own(entry, 'version');
    if (name === undefined || !NPM_NAME.test(name)) return fail(`${LOCKFILE}: bad package name at ${JSON.stringify(key.slice(0, 80))}`);
    if (typeof version !== 'string' || !NPM_VERSION.test(version)) return fail(`${LOCKFILE}: bad version for ${name}`);
    const purl = purlNpm(name, version);
    refOf.set(key, purl);
    if (components.has(purl)) continue;
    const comp = { type: 'library', 'bom-ref': purl, name, version, purl };
    const hashes = hashesFrom(own(entry, 'integrity'));
    if (hashes.length) comp.hashes = hashes;
    const licenses = licensesFrom(own(entry, 'license'));
    if (licenses) comp.licenses = licenses;
    const url = safeUrl(own(entry, 'resolved'));
    if (url) comp.externalReferences = [{ type: 'distribution', url }];
    if (entry.dev === true) comp.properties = [{ name: 'aico:dev', value: 'true' }];
    components.set(purl, comp);
  }
  for (const key of keys) {
    if (key === '' || !refOf.has(key)) continue;
    const entry = packages[key];
    const wanted = new Set();
    for (const field of ['dependencies', 'optionalDependencies']) {
      const map = own(entry, field);
      if (!isObject(map)) continue;
      for (const dep of Object.keys(map)) {
        const hit = resolveFrom(packages, key, dep);
        if (hit !== undefined && refOf.has(hit)) wanted.add(refOf.get(hit));
        else if (field === 'dependencies') complete = false;
      }
    }
    const ref = refOf.get(key);
    const merged = deps.get(ref) ?? new Set();
    for (const r of wanted) merged.add(r);
    deps.set(ref, merged);
  }
  const root = own(packages, '');
  const direct = new Set();
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const map = own(root, field);
    if (!isObject(map)) continue;
    for (const dep of Object.keys(map)) {
      const hit = resolveFrom(packages, '', dep);
      if (hit !== undefined && refOf.has(hit)) direct.add(refOf.get(hit));
      else complete = false;
    }
  }
  return { components: [...components.values()], deps, direct, complete };
}

function skillParts(manifest) {
  if (!isObject(manifest)) return fail('deps/skills.json is not an object');
  const found = new Map();
  for (const group of Object.keys(manifest)) {
    const list = manifest[group];
    if (!Array.isArray(list)) return fail(`deps/skills.json: group ${JSON.stringify(group.slice(0, 40))} is not a list`);
    for (const e of list) {
      if (!isObject(e)) return fail('deps/skills.json: an entry is not an object');
      if (Object.hasOwn(e, 'include')) continue;
      const name = own(e, 'name');
      const source = own(e, 'source');
      if (typeof name !== 'string' || !SKILL_NAME.test(name)) return fail('deps/skills.json: an entry has a bad name');
      if (source !== undefined && (typeof source !== 'string' || !SKILL_SOURCE.test(source))) return fail(`deps/skills.json: bad source for ${name}`);
      const ref = `skill:${name}@${source ?? 'local'}`;
      const prior = found.get(ref);
      if (prior) {
        if (!prior.groups.includes(group)) prior.groups.push(group);
        continue;
      }
      if (found.size >= MAX_SKILLS) return fail(`deps/skills.json lists more than ${MAX_SKILLS} skills`);
      const comp = { type: 'library', 'bom-ref': ref, name };
      if (source !== undefined) {
        comp.group = source;
        comp.purl = `pkg:github/${source}`;
      }
      const licenses = licensesFrom(own(e, 'license'));
      if (licenses) comp.licenses = licenses;
      found.set(ref, { comp, groups: [group] });
    }
  }
  return [...found.values()].map(({ comp, groups }) => {
    const props = [{ name: 'aico:groups', value: groups.join(',') }];
    return { ...comp, properties: props };
  });
}

// The SBOM object for the version in `.claude-plugin/plugin.json` under `root`. `now` and `serial` are for tests.
export function buildSbom({ root, now = new Date(), serial = crypto.randomUUID() } = {}) {
  const plugin = readJson(root, '.claude-plugin/plugin.json');
  const version = own(plugin, 'version');
  if (typeof version !== 'string' || !SEMVER.test(version)) return fail('.claude-plugin/plugin.json has no plain semver "version"');
  const skills = skillParts(readJson(root, 'deps/skills.json'));
  const lock = lockfileParts(readJson(root, LOCKFILE));
  const home = safeUrl(own(plugin, 'homepage')) ?? safeUrl(isObject(own(plugin, 'repository')) ? own(plugin.repository, 'url') : own(plugin, 'repository'));
  const site = home ? [{ type: 'website', url: home }] : undefined;
  const appRef = `pkg:generic/aico@${version}`;
  const license = licensesFrom(own(plugin, 'license'));
  const app = {
    type: 'application',
    'bom-ref': appRef,
    name: 'aico',
    version,
    purl: appRef,
    ...(license ? { licenses: license } : {}),
    ...(site ? { externalReferences: site } : {})
  };
  const components = [...skills, ...lock.components];
  const refs = new Set([appRef]);
  for (const c of components) {
    if (refs.has(c['bom-ref'])) return fail(`duplicate bom-ref ${JSON.stringify(c['bom-ref'].slice(0, 80))}`);
    refs.add(c['bom-ref']);
  }
  const dependencies = [{ ref: appRef, dependsOn: [...skills.map((s) => s['bom-ref']), ...lock.direct] }];
  for (const s of skills) dependencies.push({ ref: s['bom-ref'], dependsOn: [] });
  for (const c of lock.components) dependencies.push({ ref: c['bom-ref'], dependsOn: [...(lock.deps.get(c['bom-ref']) ?? [])] });
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${serial}`,
    version: 1,
    metadata: {
      timestamp: now.toISOString(),
      tools: { components: [{ type: 'application', name: 'aico-sbom', version, ...(site ? { externalReferences: site } : {}) }] },
      component: app
    },
    components,
    dependencies,
    compositions: [
      { aggregate: lock.complete ? 'complete' : 'incomplete', assemblies: lock.components.map((c) => c['bom-ref']) },
      { aggregate: 'unknown', assemblies: skills.map((s) => s['bom-ref']) }
    ]
  };
}

export function serialize(bom) {
  return `${JSON.stringify(bom, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    console.error('usage: node scripts/sbom.mjs [<out file>]');
    process.exit(1);
  }
  try {
    const text = serialize(buildSbom({ root: process.cwd() }));
    if (args.length === 1) fs.writeFileSync(args[0], text);
    else process.stdout.write(text);
  } catch (e) {
    if (!(e instanceof SbomError)) throw e;
    console.error(`sbom: ${e.message}`);
    process.exit(1);
  }
}
