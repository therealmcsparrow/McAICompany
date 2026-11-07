import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSbom, hashesFrom, licensesFrom, safeUrl, serialize, SbomError } from './sbom.mjs';

const script = path.join(import.meta.dirname, 'sbom.mjs');
const SHA512 = Buffer.alloc(64, 0xab);
const SHA1 = Buffer.alloc(20, 0x12);
const sri512 = `sha512-${SHA512.toString('base64')}`;
const sri1 = `sha1-${SHA1.toString('base64')}`;

const CATEGORIES = {
  engineering: ['architect', 'devops'],
  design: ['ui-ux-designer'],
  security: ['security'],
  quality: ['qa'],
  product: ['product-manager'],
  research: ['skill-researcher'],
  content: ['writer']
};

function catalog({ groups, entries }) {
  return { schema: 1, categories: CATEGORIES, groups, entries };
}

const SKILLS = catalog({
  groups: {
    core: ['find-skills', 'impeccable', { include: 'research' }],
    research: ['find-skills'],
    go: ['golang-*']
  },
  entries: [
    { skillname: 'find-skills', skillcategory: 'research', skillrepo: 'vercel-labs/skills', license: 'MIT' },
    { skillname: 'impeccable', skillcategory: 'design', skillinstaller: 'npx -y impeccable@4.8.0 skills install', license: 'Apache-2.0' },
    { skillname: 'golang-*', skillcategory: 'engineering', skillrepo: 'samber/cc-skills-golang' },
    { skillname: 'aico:ui-design', skillcategory: 'design', skillplugin: 'aico' }
  ]
});

const LOCK = {
  lockfileVersion: 3,
  packages: {
    '': { name: 'ci', version: '0.0.0', devDependencies: { '@scope/tool': '1.2.3', plain: '2.0.0' } },
    'node_modules/@scope/tool': {
      version: '1.2.3',
      resolved: 'https://registry.npmjs.org/@scope/tool/-/tool-1.2.3.tgz',
      integrity: sri512,
      dev: true,
      license: 'MIT',
      dependencies: { plain: '^2.0.0', shared: '^1.0.0' },
      optionalDependencies: { 'absent-opt': '^1.0.0' }
    },
    'node_modules/plain': { version: '2.0.0', integrity: `${sri1} ${sri512}`, license: '(MIT OR Apache-2.0)' },
    'node_modules/shared': { version: '1.0.0', license: 'SEE LICENSE IN README.md' },
    'node_modules/@scope/tool/node_modules/shared': { version: '1.1.0', integrity: 'sha384-AAAA', resolved: 'git+ssh://u:pw@host/x.git' },
    'node_modules/ghost': { version: '3.0.0', resolved: 'https://user:secret@registry.example/ghost.tgz', integrity: 'sha512-notbase64!' }
  }
};

function project(t, { skills = SKILLS, lock = LOCK, plugin = { name: 'aico', version: '1.2.3', license: 'UNLICENSED', homepage: 'https://example.com/aico' } } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbom-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (rel, v) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof v === 'string' ? v : JSON.stringify(v));
  };
  put('.claude-plugin/plugin.json', plugin);
  put('deps/3rdpartyskills.json', skills);
  put('tools/claude-cli/package-lock.json', lock);
  return { root, put };
}

const COMPONENT_TYPES = ['application', 'framework', 'library', 'container', 'platform', 'operating-system', 'device', 'device-driver', 'firmware', 'file', 'machine-learning-model', 'data', 'cryptographic-asset'];

// Every Must of the CycloneDX rules on a generated BOM.
function checkBom(bom) {
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.equal(bom.specVersion, '1.6');
  assert.ok(Number.isInteger(bom.version) && bom.version >= 1);
  assert.match(bom.serialNumber, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(Array.isArray(bom.metadata.tools.components), 'tools in object form');
  assert.match(bom.metadata.timestamp, /Z$/);
  assert.equal(bom.metadata.component.type, 'application');
  assert.ok(!('vulnerabilities' in bom));
  const all = [bom.metadata.component, ...bom.components];
  const refs = new Set();
  for (const c of all) {
    assert.ok(COMPONENT_TYPES.includes(c.type), c.type);
    assert.ok(typeof c.name === 'string' && c.name !== '');
    assert.ok(!refs.has(c['bom-ref']), `duplicate ${c['bom-ref']}`);
    refs.add(c['bom-ref']);
    for (const h of c.hashes ?? []) {
      assert.ok(h.alg === 'SHA-512' ? /^[0-9a-f]{128}$/.test(h.content) : h.alg === 'SHA-1' && /^[0-9a-f]{40}$/.test(h.content));
    }
    if (c.purl?.startsWith('pkg:npm/')) assert.match(c.purl, /^pkg:npm\/(%40[^/@]+\/)?[^/@%]+@\d+\.\d+\.\d+/);
    for (const l of c.licenses ?? []) assert.ok(('license' in l) !== ('expression' in l));
  }
  for (const d of bom.dependencies) {
    assert.ok(refs.has(d.ref), d.ref);
    for (const r of d.dependsOn) assert.ok(refs.has(r), r);
  }
}

test('the SBOM lists the plugin, every grouped skill once and every lockfile package', (t) => {
  const { root } = project(t);
  const bom = buildSbom({ root });
  checkBom(bom);
  assert.equal(bom.metadata.component.name, 'aico');
  assert.equal(bom.metadata.component.version, '1.2.3');
  const names = bom.components.map((c) => `${c.name}@${c.version ?? ''}`).sort();
  assert.deepEqual(names, [
    '@scope/tool@1.2.3', 'find-skills@', 'ghost@3.0.0', 'golang-*@', 'impeccable@', 'plain@2.0.0', 'shared@1.0.0', 'shared@1.1.0'
  ]);
  const find = bom.components.find((c) => c.name === 'find-skills');
  assert.equal(find.properties[0].value, 'core,research');
});

test('a skill in no group adds no component, and the old file is not read', (t) => {
  const { root, put } = project(t);
  put('deps/skills.json', { core: [{ name: 'only-in-old-file', source: 'a/b' }] });
  const refs = buildSbom({ root }).components.map((c) => c['bom-ref']).filter((r) => r.startsWith('skill:')).sort();
  assert.deepEqual(refs, ['skill:find-skills@vercel-labs/skills', 'skill:golang-*@samber/cc-skills-golang', 'skill:impeccable@local']);
});

test('a component keeps the wildcard and command forms, and takes its licence from the baseline', (t) => {
  const bom = buildSbom({ root: project(t).root });
  const wild = bom.components.find((c) => c.name === 'golang-*');
  assert.equal(wild.purl, 'pkg:github/samber/cc-skills-golang');
  assert.equal(wild.licenses, undefined);
  const cmd = bom.components.find((c) => c.name === 'impeccable');
  assert.equal(cmd.purl, undefined);
  assert.deepEqual(cmd.licenses, [{ license: { id: 'Apache-2.0' } }]);
});

test('the shipped baseline gives the bom-ref set the old inventory gave', () => {
  const bom = buildSbom({ root: path.join(import.meta.dirname, '..') });
  const refs = bom.components.map((c) => c['bom-ref']).filter((r) => r.startsWith('skill:')).sort();
  assert.deepEqual(refs, [
    'skill:auth-implementation-patterns@wshobson/agents', 'skill:find-skills@vercel-labs/skills', 'skill:frontend-ui-engineering@addyosmani/agent-skills',
    'skill:golang-*@samber/cc-skills-golang', 'skill:hallmark@nutlope/hallmark', 'skill:impeccable@local', 'skill:security-and-hardening@addyosmani/agent-skills',
    'skill:security-review@getsentry/skills', 'skill:tanstack-form@tanstack-skills/tanstack-skills', 'skill:tanstack-query@tanstack-skills/tanstack-skills',
    'skill:tanstack-router@tanstack-skills/tanstack-skills', 'skill:tanstack-table@tanstack-skills/tanstack-skills',
    'skill:two-factor-authentication-best-practices@better-auth/skills', 'skill:typescript-advanced-types@wshobson/agents',
    'skill:vercel-composition-patterns@vercel-labs/agent-skills', 'skill:vercel-react-best-practices@vercel-labs/agent-skills'
  ].sort());
  assert.ok(!refs.some((r) => r.includes('ui-design')));
});

test('npm purls encode the scope and use the lockfile version', (t) => {
  const bom = buildSbom({ root: project(t).root });
  assert.equal(bom.components.find((c) => c.name === '@scope/tool').purl, 'pkg:npm/%40scope/tool@1.2.3');
});

test('hashes come only from recorded integrity, one entry per SRI value, nothing for a missing or odd one', (t) => {
  const bom = buildSbom({ root: project(t).root });
  const by = (n, v) => bom.components.find((c) => c.name === n && c.version === v);
  assert.deepEqual(by('@scope/tool', '1.2.3').hashes, [{ alg: 'SHA-512', content: SHA512.toString('hex') }]);
  assert.deepEqual(by('plain', '2.0.0').hashes, [{ alg: 'SHA-1', content: SHA1.toString('hex') }, { alg: 'SHA-512', content: SHA512.toString('hex') }]);
  assert.equal(by('shared', '1.0.0').hashes, undefined);
  assert.equal(by('shared', '1.1.0').hashes, undefined);
  assert.equal(by('ghost', '3.0.0').hashes, undefined);
  assert.deepEqual(hashesFrom('sha512-AAAA'), []);
  assert.deepEqual(hashesFrom(undefined), []);
  assert.deepEqual(hashesFrom(`${sri1} ${sri1}`).length, 1);
});

test('licences use one form per component', () => {
  assert.deepEqual(licensesFrom('MIT'), [{ license: { id: 'MIT' } }]);
  assert.deepEqual(licensesFrom('(MIT OR Apache-2.0)'), [{ expression: '(MIT OR Apache-2.0)' }]);
  assert.deepEqual(licensesFrom('SEE LICENSE IN README.md'), [{ license: { name: 'SEE LICENSE IN README.md' } }]);
  assert.equal(licensesFrom('x'.repeat(201)), undefined);
  assert.equal(licensesFrom('a\nb'), undefined);
  assert.equal(licensesFrom({}), undefined);
});

test('dev packages are kept and marked, not dropped', (t) => {
  const bom = buildSbom({ root: project(t).root });
  const tool = bom.components.find((c) => c.name === '@scope/tool');
  assert.deepEqual(tool.properties, [{ name: 'aico:dev', value: 'true' }]);
});

test('dependencies resolve the nearest node_modules and the composition states completeness', (t) => {
  const bom = buildSbom({ root: project(t).root });
  const dep = (ref) => bom.dependencies.find((d) => d.ref === ref).dependsOn;
  assert.deepEqual(dep('pkg:npm/%40scope/tool@1.2.3').sort(), ['pkg:npm/plain@2.0.0', 'pkg:npm/shared@1.1.0']);
  const root = bom.dependencies.find((d) => d.ref === bom.metadata.component['bom-ref']).dependsOn;
  assert.ok(root.includes('pkg:npm/%40scope/tool@1.2.3') && root.includes('pkg:npm/plain@2.0.0') && root.includes('skill:find-skills@vercel-labs/skills'));
  assert.equal(bom.compositions[0].aggregate, 'complete');
  assert.equal(bom.compositions[1].aggregate, 'unknown');
  const lock = structuredClone(LOCK);
  lock.packages['node_modules/plain'].dependencies = { missing: '^1.0.0' };
  assert.equal(buildSbom({ root: project(t, { lock }).root }).compositions[0].aggregate, 'incomplete');
});

test('resolved URLs with credentials, other schemes and local paths are dropped', (t) => {
  const bom = buildSbom({ root: project(t).root });
  assert.deepEqual(bom.components.find((c) => c.name === '@scope/tool').externalReferences, [{ type: 'distribution', url: 'https://registry.npmjs.org/@scope/tool/-/tool-1.2.3.tgz' }]);
  assert.equal(bom.components.find((c) => c.name === 'ghost').externalReferences, undefined);
  const text = serialize(bom);
  assert.ok(!text.includes('secret') && !text.includes('git+ssh') && !text.includes(os.tmpdir()));
  for (const bad of ['file:///etc/passwd', 'C:\\x', '/usr/x', 'http://a/', 'https://u@a/', 'https://u:p@a/', 'https://' + 'a'.repeat(600), 5]) assert.equal(safeUrl(bad), undefined, String(bad));
});

test('the creator is a project URL, never an email address', (t) => {
  const { root } = project(t, { plugin: { name: 'aico', version: '1.2.3', author: { name: 'X', email: 'x@example.com' }, homepage: 'https://example.com/aico' } });
  const text = serialize(buildSbom({ root }));
  assert.ok(!text.includes('@example.com'));
  assert.equal(JSON.parse(text).metadata.tools.components[0].externalReferences[0].url, 'https://example.com/aico');
  const none = buildSbom({ root: project(t, { plugin: { name: 'aico', version: '1.2.3', homepage: 'mailto:a@b.c' } }).root });
  assert.equal(none.metadata.tools.components[0].externalReferences, undefined);
});

test('the serial number is random per build and the output is LF with no BSI claim', (t) => {
  const { root } = project(t);
  const a = buildSbom({ root });
  const b = buildSbom({ root });
  assert.notEqual(a.serialNumber, b.serialNumber);
  const text = serialize(a);
  assert.ok(!text.includes('\r') && text.endsWith('}\n'));
  assert.ok(!/TR-03183|\bBSI\b/i.test(text));
});

test('hostile inputs stop the build', (t) => {
  const cases = {
    'lock not v3': { ...LOCK, lockfileVersion: 2 },
    'lock bad name': { lockfileVersion: 3, packages: { 'node_modules/../evil': { version: '1.0.0' } } },
    'lock bad version': { lockfileVersion: 3, packages: { 'node_modules/a': { version: '^1.0.0' } } },
    'lock no version': { lockfileVersion: 3, packages: { 'node_modules/a': {} } },
    'lock entry not object': { lockfileVersion: 3, packages: { 'node_modules/a': 5 } },
    'lock too many': { lockfileVersion: 3, packages: Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`node_modules/p${i}`, { version: '1.0.0' }])) }
  };
  for (const [label, lock] of Object.entries(cases)) assert.throws(() => buildSbom({ root: project(t, { lock }).root }), SbomError, label);
  const entry = (e) => catalog({ groups: { core: ['a'] }, entries: [{ skillname: 'a', skillcategory: 'engineering', skillrepo: 'o/r', ...e }] });
  const skills = {
    'baseline not object': [],
    'baseline group not list': catalog({ groups: { core: {} }, entries: SKILLS.entries }),
    'baseline bad name': entry({ skillname: 'a b' }),
    'baseline bad source': entry({ skillrepo: '../x' }),
    'baseline entry not object': catalog({ groups: { core: [] }, entries: [5] }),
    'baseline unknown key': { ...SKILLS, extra: 1 },
    'baseline text not json': 'not json'
  };
  for (const [label, s] of Object.entries(skills)) assert.throws(() => buildSbom({ root: project(t, { skills: s }).root }), SbomError, label);
  assert.throws(() => buildSbom({ root: project(t, { plugin: { name: 'aico', version: '1.2' } }).root }), SbomError);
  const bigSkills = project(t, { skills: ' '.repeat(9 * 1024 * 1024) });
  assert.throws(() => buildSbom({ root: bigSkills.root }), /larger than/);
  const big = project(t);
  big.put('tools/claude-cli/package-lock.json', ' '.repeat(9 * 1024 * 1024));
  assert.throws(() => buildSbom({ root: big.root }), /larger than/);
});

test('a prototype key in the lockfile or skills list changes nothing', (t) => {
  const lock = JSON.parse('{"lockfileVersion":3,"packages":{"":{"dependencies":{"__proto__":"1.0.0","constructor":"1.0.0"}},"node_modules/a":{"version":"1.0.0","__proto__":{"dev":true}}}}');
  const bom = buildSbom({ root: project(t, { lock }).root });
  assert.equal(bom.components.find((c) => c.name === 'a').properties, undefined);
  assert.equal(bom.compositions[0].aggregate, 'incomplete');
});

test('the command writes the file or prints, and refuses extra arguments', (t) => {
  const { root } = project(t);
  const env = { ...process.env, HOME: root, USERPROFILE: root };
  const out = path.join(root, 'out.json');
  assert.equal(spawnSync(process.execPath, [script, out], { cwd: root, encoding: 'utf8', env }).status, 0);
  checkBom(JSON.parse(fs.readFileSync(out, 'utf8')));
  const printed = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env });
  checkBom(JSON.parse(printed.stdout));
  assert.notEqual(spawnSync(process.execPath, [script, 'a', 'b'], { cwd: root, encoding: 'utf8', env }).status, 0);
  fs.rmSync(path.join(root, 'deps'), { recursive: true });
  const miss = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env });
  assert.notEqual(miss.status, 0);
  assert.match(miss.stderr, /^sbom: /);
});
