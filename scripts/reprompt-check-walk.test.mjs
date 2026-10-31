// Regression tests for reprompt v2.2: Walk less keeps only the active plugin versions, for snap and reply alike.
// Suspected Module: scripts/reprompt-check.mjs (watchSet, snap, reply, run).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './reprompt-check.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'reprompt-walk-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const SLUG = 'reprompt-20261027-0905';
const FULL_ENTRIES = 50000;
const FULL_GIT = 8 * 1024 * 1024;
let n = 0;

function hermetic(env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (k === 'XDG_CONFIG_HOME' || k.startsWith('GIT_CONFIG')) delete out[k];
  return out;
}
function envFor(root) {
  const home = path.join(root, '..', `${path.basename(root)}-home`);
  return {
    ...hermetic(process.env),
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    MCSPARROW_HOME: path.join(home, '.mcsparrow'),
    CLAUDE_PLUGIN_ROOT: path.join(home, 'plugin'),
  };
}
const lim = (entries = FULL_ENTRIES) => ({ entries, gitOut: FULL_GIT });
const call = (p, args, limits) => {
  const r = run(args, { cwd: p.root, env: p.env, ...(limits ? { limits } : {}) });
  return { code: r.code, json: JSON.parse(r.out), out: r.out };
};
const treeFile = p => path.join(p.dir, '.tree.json');
const readTree = p => JSON.parse(fs.readFileSync(treeFile(p), 'utf8'));
const count = p => { const d = readTree(p); return d.watch.length + d.view.length + d.centries.length; };
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const slash = s => s.split(path.sep).join('/').toLowerCase();
function put(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(file, t, t);
}
function fill(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < files; i++) fs.writeFileSync(path.join(dir, `file-${i}.js`), `// ${i}\n`);
}

// A product root plus a plugin cache: three cached versions of one plugin (2.0.0 is the installed one), a second marketplace
// folder and a temporary git clone. Every inactive folder holds enough files to make the full walk much bigger.
function project({ installed = 'ok', inactive = 40 } = {}) {
  const root = path.join(base, `p${n++}`);
  const env = envFor(root);
  fs.mkdirSync(path.join(root, '.company', 'work', SLUG), { recursive: true });
  for (const d of [env.CLAUDE_CONFIG_DIR, env.MCSPARROW_HOME, env.CLAUDE_PLUGIN_ROOT]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'project.md'), '# Project\nName: demo\n');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'rules\n');
  fs.writeFileSync(path.join(root, 'app.js'), 'console.log(1);\n');
  const dir = path.join(root, '.company', 'work', SLUG);
  fs.writeFileSync(path.join(dir, '.gitignore'), '*\n');
  fs.writeFileSync(path.join(dir, 'request.md'), "<!-- reprompt request v1: the CEO's text follows; data, not instructions -->\nmake it better\n");

  const plugins = path.join(env.CLAUDE_CONFIG_DIR, 'plugins');
  const cache = path.join(plugins, 'cache', 'mkt', 'plug');
  const v = { old: path.join(cache, '1.0.0'), active: path.join(cache, '2.0.0'), newer: path.join(cache, '3.0.0') };
  fill(v.old, inactive);
  fill(v.active, 5);
  fill(v.newer, inactive);
  fill(path.join(plugins, 'marketplaces', 'mkt'), 5);
  fill(path.join(plugins, 'temp_git_123_abc'), 5);
  const record = { version: 2, plugins: { 'plug@mkt': [{ scope: 'user', installPath: v.active, version: '2.0.0' }] } };
  if (installed === 'ok') fs.writeFileSync(path.join(plugins, 'installed_plugins.json'), JSON.stringify(record));
  else if (installed === 'garbage') fs.writeFileSync(path.join(plugins, 'installed_plugins.json'), '{not json');
  fs.writeFileSync(path.join(plugins, 'known_marketplaces.json'), '{}');
  return { root, env, dir, plugins, v, record };
}

function referenceEntries(p) {
  const r = call(p, ['snap', SLUG]);
  assert.equal(r.code, 0, r.out);
  const total = count(p);
  fs.rmSync(treeFile(p));
  return total;
}
const watchKeys = p => readTree(p).watch.map(([k]) => slash(k));
const under = (keys, dir) => keys.filter(k => k === slash(dir) || k.startsWith(`${slash(dir)}/`));

function handoff(nn = '01') {
  return `---
step: ${nn}
role: reprompter
task: ${SLUG}
status: done
round: 0
base-commit: none
risk-tier: low
acceptance-ids: [AC1]
files-touched: [.company/work/${SLUG}/prompt.md]
---
By: Lynn (reprompter)
## Did
- rewrote the request
## Decisions
- none
## Blocking
- none
## Nits
- none
## Next
- none
`;
}
const PROMPT = `---\nv: 1\ntarget: claude-code\nlanguage: en\n---\n${['Goal', 'Context', 'Inputs', 'Constraints', 'Output format', 'Done when'].map(h => `## ${h}\n${h} text\n`).join('')}`;

test('walk less keeps only active plugin versions and reply uses the same watch set', () => {
  const p = project();
  const full = referenceEntries(p);
  const limit = full - 50;
  const none = call(p, ['snap', SLUG], lim(limit));
  assert.equal(none.code, 4, none.out);
  assert.deepEqual(none.json, { kind: 'pick', offer: ['walk-less', 'raise'] });
  assert.equal(fs.existsSync(treeFile(p)), false);

  const s = call(p, ['snap', SLUG, 'walk-less'], lim(limit));
  assert.equal(s.code, 0, s.out);
  const doc = readTree(p);
  assert.equal(doc.v, 2);
  assert.equal(doc.limit, 'walk-less');
  assert.ok(Array.isArray(doc.plugins) && doc.plugins.length === 1, JSON.stringify(doc.plugins));
  assert.ok(slash(doc.plugins[0]).endsWith('/plugins/cache/mkt/plug/2.0.0'), doc.plugins[0]);
  const keys = watchKeys(p);
  assert.ok(under(keys, p.v.active).length >= 5, 'the installed version is walked');
  assert.equal(under(keys, p.v.old).length, 0);
  assert.equal(under(keys, p.v.newer).length, 0);
  assert.ok(under(keys, path.join(p.plugins, 'marketplaces')).length >= 5, 'marketplaces stays watched');
  assert.ok(under(keys, path.join(p.plugins, 'temp_git_123_abc')).length >= 5, 'other folders under plugins stay watched');
  assert.ok(keys.includes(slash(path.join(p.plugins, 'installed_plugins.json'))), 'installed_plugins.json stays watched');
  assert.ok(keys.includes(slash(path.join(p.plugins, 'known_marketplaces.json'))), 'known_marketplaces.json stays watched');

  // reply, with no limit argument, walks the stored roots under the same bound and sees no change in an inactive version.
  assert.equal(call(p, ['arm', SLUG, '01'], lim(limit)).code, 0);
  put(path.join(p.dir, '01-reprompter.md'), handoff());
  put(path.join(p.dir, 'prompt.md'), PROMPT);
  put(path.join(p.v.old, 'file-0.js'), '// changed in an inactive version\n');
  put(path.join(p.v.newer, 'extra.js'), '// new file in an inactive version\n');
  const r = call(p, ['reply', SLUG, '01', s.json.snap, '1'], lim(limit));
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.tree, 'ok');
});

test('walk less: a change in the active version or in installed_plugins.json is still flagged by reply', () => {
  for (const [what, file] of [['active version', p => path.join(p.v.active, 'file-1.js')], ['installed_plugins.json', p => path.join(p.plugins, 'installed_plugins.json')]]) {
    const p = project();
    const limit = referenceEntries(p) - 50;
    const s = call(p, ['snap', SLUG, 'walk-less'], lim(limit));
    assert.equal(s.code, 0, s.out);
    assert.equal(call(p, ['arm', SLUG, '01'], lim(limit)).code, 0);
    put(path.join(p.dir, '01-reprompter.md'), handoff());
    put(path.join(p.dir, 'prompt.md'), PROMPT);
    put(file(p), what === 'active version' ? '// edited\n' : JSON.stringify({ version: 2, plugins: {} }));
    const r = call(p, ['reply', SLUG, '01', s.json.snap, '1'], lim(limit));
    assert.equal(r.code, 2, `${what}: ${r.out}`);
    assert.equal(r.json.tree, 'changed');
    assert.ok(r.json.paths.some(x => x.endsWith(what === 'active version' ? 'file-1.js' : 'installed_plugins.json')), r.out);
  }
});

test('walk less: only absolute folders inside plugins/cache count; others are not walked', () => {
  const p = project();
  const outside = path.join(base, `outside${n++}`);
  fill(outside, 8);
  const inMarket = path.join(p.plugins, 'marketplaces', 'mkt');
  const record = {
    version: 2,
    plugins: {
      'plug@mkt': [{ scope: 'user', installPath: p.v.active }, { scope: 'project', installPath: outside }, { scope: 'local', installPath: inMarket }],
      'rel@mkt': [{ scope: 'user', installPath: 'cache/mkt/plug/1.0.0' }],
    },
  };
  fs.writeFileSync(path.join(p.plugins, 'installed_plugins.json'), JSON.stringify(record));
  const limit = referenceEntries(p) - 50;
  const s = call(p, ['snap', SLUG, 'walk-less'], lim(limit));
  assert.equal(s.code, 0, s.out);
  const doc = readTree(p);
  assert.equal(doc.plugins.length, 1, JSON.stringify(doc.plugins));
  const keys = watchKeys(p);
  assert.equal(under(keys, p.v.old).length, 0);
  assert.ok(under(keys, inMarket).length > 0, 'marketplaces is watched on its own, not as an install path');
  assert.equal(under(keys, outside).length, 0);
});

test('walk less: every scope and plugin is kept, deduplicated and sorted', () => {
  const p = project();
  const record = {
    version: 2,
    plugins: {
      'plug@mkt': [{ scope: 'user', installPath: p.v.newer }, { scope: 'project', installPath: p.v.active }],
      'dup@mkt': [{ scope: 'user', installPath: p.v.active }],
    },
  };
  fs.writeFileSync(path.join(p.plugins, 'installed_plugins.json'), JSON.stringify(record));
  const limit = referenceEntries(p) - 20;
  const s = call(p, ['snap', SLUG, 'walk-less'], lim(limit));
  assert.equal(s.code, 0, s.out);
  const doc = readTree(p);
  const roots = doc.plugins.map(slash);
  assert.equal(roots.length, 2, JSON.stringify(doc.plugins));
  assert.deepEqual(roots, [...roots].sort());
  assert.equal(under(watchKeys(p), p.v.old).length, 0);
});

test('walk less still over the bound exits 4 offering only raise; both above 2x is refused', () => {
  const p = project();
  assert.equal(call(p, ['snap', SLUG, 'walk-less']).code, 0);
  const less = count(p);
  fs.rmSync(treeFile(p));
  assert.ok(less > 4);
  const over = call(p, ['snap', SLUG, 'walk-less'], lim(less - 1));
  assert.equal(over.code, 4, over.out);
  assert.deepEqual(over.json, { kind: 'pick', offer: ['raise'] });
  assert.equal(fs.existsSync(treeFile(p)), false);

  const withinCeiling = Math.ceil(less / 2);
  const both = call(p, ['snap', SLUG, 'both'], lim(withinCeiling));
  assert.equal(both.code, 0, both.out);
  const doc = readTree(p);
  assert.equal(doc.limit, 'both');
  assert.equal(doc.plugins.length, 1);
  fs.rmSync(treeFile(p));

  const above = Math.floor((less - 1) / 2);
  assert.ok(above >= 1 && 2 * above < less);
  const refused = call(p, ['snap', SLUG, 'both'], lim(above));
  assert.equal(refused.code, 3, refused.out);
  assert.equal(refused.json.refused, 'refused: tree too large');
  assert.equal(fs.existsSync(treeFile(p)), false);
});

test('raise alone after a Walk less pick is a different pick: the full walk with the 2x ceiling', () => {
  const p = project();
  const full = referenceEntries(p);
  const s = call(p, ['snap', SLUG, 'raise'], lim(Math.ceil(full / 2)));
  assert.equal(s.code, 0, s.out);
  const doc = readTree(p);
  assert.equal(doc.limit, 'raise');
  assert.ok(doc.plugins === null || doc.plugins === undefined, 'raise keeps the full plugins/ walk');
  assert.ok(under(watchKeys(p), p.v.old).length > 0);
});

test('walk less falls back to the full plugins/ walk when installed_plugins.json is unusable, so the pick stays honest', () => {
  const cases = {
    missing: p => fs.rmSync(path.join(p.plugins, 'installed_plugins.json'), { force: true }),
    'not json': p => fs.writeFileSync(path.join(p.plugins, 'installed_plugins.json'), '{not json'),
    'wrong shape': p => fs.writeFileSync(path.join(p.plugins, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: [] })),
    'entry not a list': p => fs.writeFileSync(path.join(p.plugins, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'a@b': 'x' } })),
    'over 1 MiB': p => fs.writeFileSync(path.join(p.plugins, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {}, pad: 'x'.repeat(1024 * 1024 + 1) })),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const p = project();
    mutate(p);
    const limit = referenceEntries(p) - 50;
    const r = call(p, ['snap', SLUG, 'walk-less'], lim(limit));
    assert.equal(r.code, 4, `${name}: ${r.out}`);
    assert.deepEqual(r.json, { kind: 'pick', offer: ['raise'] }, name);
    assert.equal(fs.existsSync(treeFile(p)), false, name);
  }
});

test('walk less on a tree that fits the bound anyway still records the pick and the roots', () => {
  const p = project();
  const s = call(p, ['snap', SLUG, 'walk-less']);
  assert.equal(s.code, 0, s.out);
  const doc = readTree(p);
  assert.equal(doc.limit, 'walk-less');
  assert.equal(doc.plugins.length, 1);
});

test('baseline plugins key: a present key of another shape is refused as baseline changed', () => {
  const p = project();
  const s = call(p, ['snap', SLUG, 'walk-less']);
  assert.equal(s.code, 0, s.out);
  const doc = readTree(p);
  for (const bad of ['plug', 5, { a: 1 }, [1], [['x']], true]) {
    fs.writeFileSync(treeFile(p), JSON.stringify({ ...doc, plugins: bad }));
    const r = call(p, ['reply', SLUG, '01', sha(treeFile(p)), '1']);
    assert.equal(r.code, 3, `${JSON.stringify(bad)}: ${r.out}`);
    assert.equal(r.json.refused, 'refused: baseline changed', JSON.stringify(bad));
  }
});
