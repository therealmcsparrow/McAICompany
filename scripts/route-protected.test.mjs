import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as route from './route.mjs';
import { PROTECTED_ROLES as SETTINGS_PROTECTED } from './settings.mjs';
import { PROTECTED_ROLES as CHECK_PROTECTED } from './check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

// A fake plugin root holding the data the script reads (company/, agents/) beside a copy of the script.
// The product (cwd) is the folder `product` inside it and holds no plugin data.
function product(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'route-protected-'));
  temps.push(dir);
  for (const d of ['company', 'agents']) cpSync(join(root, d), join(dir, d), { recursive: true });
  for (const f of ['route.mjs', 'diff-facts.mjs']) cpSync(join(root, 'scripts', f), join(dir, 'scripts', f));
  cpSync(join(root, 'mods', 'lib', 'work-folder.mjs'), join(dir, 'mods', 'lib', 'work-folder.mjs'));
  mkdirSync(join(dir, 'product', '.company'), { recursive: true });
  if (mutate) mutate(join(dir, 'company', 'model-floor.json'), dir);
  return dir;
}
const floorWith = (f) => (p) => writeFileSync(p, typeof f === 'string' ? f : JSON.stringify(f));
const sorted = (a) => [...a].sort();

function cli(dir, args) {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', 'route.mjs'), ...args], { cwd: join(dir, 'product'), encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
// A harmless draft; any data-loading command must refuse before using it.
function draft(dir) {
  const f = join(dir, 'product', 'draft.json');
  writeFileSync(f, JSON.stringify({ playbook: 'feature', size: 'M', steps: [{ role: 'qa', why: 'tests' }], skips: [] }));
  return f;
}
const readP = async (dir) => {
  try { return await route.readProtected(dir); } catch { return null; }
};

test('route.mjs exports readProtected', () => {
  assert.equal(typeof route.readProtected, 'function');
});

test('readProtected(repo root) equals both PROTECTED_ROLES exports, as sets', async () => {
  const got = await route.readProtected(root);
  assert.deepEqual(sorted(got), sorted(SETTINGS_PROTECTED));
  assert.deepEqual(sorted(got), sorted(CHECK_PROTECTED));
  const floor = JSON.parse(readFileSync(join(root, 'company', 'model-floor.json'), 'utf8'));
  assert.deepEqual(sorted(got), sorted(floor.protected));
});

test('readProtected reads the file, not a copy: a changed array is returned', async () => {
  const dir = product(floorWith({ ...JSON.parse(readFileSync(join(root, 'company', 'model-floor.json'), 'utf8')), protected: ['architect', 'qa'] }));
  assert.deepEqual(sorted(await route.readProtected(dir)), ['architect', 'qa']);
});

test('route.mjs holds no copy of the list and imports no Core or settings', () => {
  const src = readFileSync(join(root, 'scripts', 'route.mjs'), 'utf8');
  // The test guards the protected list. code-reviewer is also the merge-pair Role of the route
  // contract (merge must be code-reviewer with qa), so it may appear as a plain constant.
  for (const name of ['fresh-reviewer', 'vuln-scanner', 'pentester']) {
    assert.ok(!src.includes(`'${name}'`) && !src.includes(`"${name}"`), `literal ${name}`);
  }
  const names = ['architect', 'code-reviewer', 'fresh-reviewer', 'pentester', 'security', 'vuln-scanner'];
  // A copy of the list would name most of them; code-reviewer (merge) and security (QA/route steps) are ordinary Roles.
  const hits = names.filter((n) => src.includes(`'${n}'`) || src.includes(`"${n}"`) || src.includes('`' + n + '`'));
  assert.ok(hits.length <= 2, `a list of protected slugs: ${hits.join(',')}`);
  assert.doesNotMatch(src, /from\s+['"]\.\/(settings|check)\.mjs['"]/);
  assert.doesNotMatch(src, /import\(\s*['"]\.\/(settings|check)\.mjs['"]/);
});

const broken = {
  'file missing': (p) => rmSync(p),
  'not JSON': floorWith('{ nope'),
  'protected missing': floorWith({ v: 1, floor: {} }),
  'protected not an array': floorWith({ protected: 'architect' }),
  'protected empty': floorWith({ protected: [] }),
  'protected has a duplicate': floorWith({ protected: ['architect', 'architect'] }),
  'protected has a slug with no agents file': floorWith({ protected: ['architect', 'no-such-role'] }),
  'protected has a non-string': floorWith({ protected: ['architect', 7] }),
  'protected has a path-like slug': floorWith({ protected: ['../agents/architect'] }),
  'protected has 51 entries': floorWith({ protected: Array.from({ length: 51 }, (_, i) => `r${i}`) }),
  'file over 16 KiB': floorWith(JSON.stringify({ protected: ['architect'], pad: 'x'.repeat(16 * 1024) })),
  'file is a directory': (p) => { rmSync(p); mkdirSync(p); },
};

for (const [name, mutate] of Object.entries(broken)) {
  test(`broken floor (${name}): readProtected does not return a list`, async () => {
    assert.equal(typeof route.readProtected, 'function');
    const got = await readP(product(mutate));
    assert.ok(!Array.isArray(got) || got.length === 0, String(got));
  });

  test(`broken floor (${name}): check refuses "model floor unreadable"`, () => {
    const dir = product(mutate);
    const r = cli(dir, ['check', draft(dir)]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /^refused: model floor unreadable$/m);
  });

  test(`broken floor (${name}): write refuses and writes nothing`, () => {
    const dir = product(mutate);
    const r = cli(dir, ['write', 'P20261116.000003/01-feature', draft(dir)]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /^refused: model floor unreadable$/m);
    const ls = spawnSync(process.execPath, ['-e', "const f=require('fs');const p='.company/work';process.stdout.write(f.existsSync(p)?'work':'none')"], { cwd: join(dir, 'product'), encoding: 'utf8' });
    assert.equal(ls.stdout, 'none');
  });

  test(`broken floor (${name}): dry, next, tasks, fix also refuse`, () => {
    const dir = product(mutate);
    const slug = 'P20261116.000003/01-feature';
    const cases = [
      ['dry', draft(dir), '--base', 'HEAD'],
      ['next', slug],
      ['tasks', slug, '3'],
      ['fix', slug, 'qa', 'why'],
    ];
    for (const args of cases) {
      const r = cli(dir, args);
      assert.equal(r.code, 2, `${args[0]}: ${r.out}${r.err}`);
      assert.match(r.out, /^refused: model floor unreadable$/m, args[0]);
    }
  });
}

test('intact floor: check does not refuse with model floor unreadable', () => {
  const dir = product();
  const r = cli(dir, ['check', draft(dir)]);
  assert.doesNotMatch(r.out, /model floor unreadable/);
});

test('a model-floor.json in the product folder is never read: the plugin floor stands', () => {
  const dir = product();
  mkdirSync(join(dir, 'product', 'company'), { recursive: true });
  writeFileSync(join(dir, 'product', 'company', 'model-floor.json'), '{ not json');
  const r = cli(dir, ['check', draft(dir)]);
  assert.doesNotMatch(r.out, /model floor unreadable/);
});

test('a broken plugin floor refuses even when the product folder holds a good one', () => {
  const dir = product(floorWith('{ not json'));
  mkdirSync(join(dir, 'product', 'company'), { recursive: true });
  cpSync(join(root, 'company', 'model-floor.json'), join(dir, 'product', 'company', 'model-floor.json'));
  const r = cli(dir, ['check', draft(dir)]);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.out, /^refused: model floor unreadable$/m);
});

test('main(argv, cwd, pluginRoot): the plugin root argument picks the floor, cwd does not', async () => {
  const good = product();
  const bad = product(floorWith('{ not json'));
  const cwd = join(good, 'product');
  const ok = await route.main(['check', draft(good)], cwd, good);
  assert.doesNotMatch(ok.out, /model floor unreadable/);
  const refused = await route.main(['check', draft(good)], cwd, bad);
  assert.equal(refused.code, 2, refused.out);
  assert.match(refused.out, /^refused: model floor unreadable$/m);
});
