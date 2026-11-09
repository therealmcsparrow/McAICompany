import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRunSlug } from './dashboard-run.mjs';

const NAME = '2026-11-04 01.19 - Skillset Dashboard Draft';

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-slug-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.company', 'work', NAME), { recursive: true });
  return root;
}

test('only the valid percent-encoded name resolves', (t) => {
  const root = makeRoot(t);
  const bad = ['..', '%2e%2e', '%2F', '%252e%252e', '%E0%A4%A', '', 'a'.repeat(301)];
  for (const raw of bad) assert.equal(resolveRunSlug(root, raw), null, raw);
  assert.equal(resolveRunSlug(root, encodeURIComponent(NAME)), NAME);
  assert.equal(resolveRunSlug(root, NAME.replaceAll(' ', '%20')), NAME);
});

test('decodes once: a double-encoded valid name does not resolve', (t) => {
  const root = makeRoot(t);
  assert.equal(resolveRunSlug(root, encodeURIComponent(encodeURIComponent(NAME))), null);
});

test('a wrong-case name does not resolve', (t) => {
  const root = makeRoot(t);
  assert.equal(resolveRunSlug(root, encodeURIComponent(NAME.replace('Skillset', 'skillset'))), null);
  assert.equal(resolveRunSlug(root, encodeURIComponent(NAME.toUpperCase())), null);
});

test('a missing folder and a non-folder do not resolve', (t) => {
  const root = makeRoot(t);
  assert.equal(resolveRunSlug(root, encodeURIComponent('2026-11-04 01.19 - Other Topic')), null);
  const file = '2026-11-04 01.20 - File Topic';
  fs.writeFileSync(path.join(root, '.company', 'work', file), 'x');
  assert.equal(resolveRunSlug(root, encodeURIComponent(file)), null);
});

test('a linked folder (junction on Windows) does not resolve', (t) => {
  const root = makeRoot(t);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-slug-target-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const linked = '2026-11-04 01.21 - Linked Topic';
  try {
    fs.symlinkSync(target, path.join(root, '.company', 'work', linked), 'junction');
  } catch (error) {
    t.skip(`links not permitted: ${error.code}`);
    return;
  }
  assert.equal(resolveRunSlug(root, encodeURIComponent(linked)), null);
});

test('a legacy slug resolves', (t) => {
  const root = makeRoot(t);
  const legacy = 'old-run-one';
  fs.mkdirSync(path.join(root, '.company', 'work', legacy));
  assert.equal(resolveRunSlug(root, legacy), legacy);
});

test('a .company/work folder linked outside the product does not resolve', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-slug-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-slug-out-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(outside, NAME), { recursive: true });
  fs.mkdirSync(path.join(root, '.company'), { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(root, '.company', 'work'), 'junction');
  } catch (error) {
    t.skip(`links not permitted: ${error.code}`);
    return;
  }
  assert.equal(resolveRunSlug(root, encodeURIComponent(NAME)), null);
});

// Round 2: dev/ino are compared as BigInt and reads are bounded through the handle.
import { run } from './dashboard-run.mjs';

function summaryOf(root, file) {
  const show = () => ({ steps: [{ step: 1, role: 'qa', status: 'done', round: 1, file }] });
  return run(root, NAME, { deps: { show, active: () => null, readLedger: () => [] } }).then((v) => v && v.steps[0].summary);
}

function patched(t, name, wrap) {
  const orig = fs[name];
  fs[name] = wrap(orig);
  t.after(() => { fs[name] = orig; });
}

test('did summary stats use bigint dev and ino', async (t) => {
  const root = makeRoot(t);
  fs.writeFileSync(path.join(root, '.company', 'work', NAME, '01-qa.md'), '## Did\n- ok\n');
  const seen = [];
  for (const name of ['lstatSync', 'fstatSync']) {
    patched(t, name, (orig) => function (target, opts) {
      if (typeof target !== 'number' || name === 'fstatSync') seen.push([name, opts && opts.bigint === true]);
      return orig.apply(this, arguments);
    });
  }
  assert.equal(await summaryOf(root, '01-qa.md'), 'ok');
  const mine = seen.filter(([n]) => n === 'fstatSync');
  assert.ok(mine.length > 0 && mine.every(([, b]) => b), 'fstat must use bigint');
  assert.ok(seen.filter(([n]) => n === 'lstatSync').some(([, b]) => b), 'lstat must use bigint');
});

test('a file that grows past the cap after fstat is refused', async (t) => {
  const root = makeRoot(t);
  const big = '## Did\n- ok\n' + 'x'.repeat(40 * 1024);
  fs.writeFileSync(path.join(root, '.company', 'work', NAME, '01-qa.md'), big);
  const lie = (orig) => function (target, opts) {
    const st = orig.apply(this, arguments);
    if (typeof target !== 'number') return st;
    return new Proxy(st, { get: (o, k) => (k === 'size' ? (opts && opts.bigint ? 10n : 10) : typeof o[k] === 'function' ? o[k].bind(o) : o[k]) });
  };
  patched(t, 'fstatSync', lie);
  const lst = fs.lstatSync;
  patched(t, 'lstatSync', (orig) => function (target, opts) {
    const st = orig.apply(this, arguments);
    if (!String(target).endsWith('01-qa.md')) return st;
    return new Proxy(st, { get: (o, k) => (k === 'size' ? (opts && opts.bigint ? 10n : 10) : typeof o[k] === 'function' ? o[k].bind(o) : o[k]) });
  });
  void lst;
  assert.equal(await summaryOf(root, '01-qa.md'), null);
});

// dashboard v2.0 (AC16, AC7): a v3 run slug `<ID>/<NN>-<pb>` arrives as `<ID>%2F<NN>-<pb>`.
const PROJ = 'P20261109.000009';
const V3 = `${PROJ}/01-feature`;

function makeV3Root(t) {
  const root = makeRoot(t);
  fs.mkdirSync(path.join(root, '.company', 'work', PROJ, '01-feature'), { recursive: true });
  fs.mkdirSync(path.join(root, '.company', 'work', PROJ, '02-fix'), { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', PROJ, '00-project.md'), 'A project\n');
  fs.writeFileSync(path.join(root, '.company', 'work', PROJ, '03-file'), 'x');
  return root;
}

test('AC16: %2F and %2f decode once to the v3 slug', (t) => {
  const root = makeV3Root(t);
  assert.equal(resolveRunSlug(root, `${PROJ}%2F01-feature`), V3);
  assert.equal(resolveRunSlug(root, `${PROJ}%2f02-fix`), `${PROJ}/02-fix`);
  assert.equal(resolveRunSlug(root, NAME.replaceAll(' ', '%20')), NAME, 'a v2 name still resolves');
});

test('AC16: every other escape, a second slash, dots, backslash or a bad shape is refused', (t) => {
  const root = makeV3Root(t);
  assert.equal(resolveRunSlug(root, `${PROJ}%2F01-feature`), V3, 'control: the valid slug resolves');
  const bad = [
    `${PROJ}%252F01-feature`, `${PROJ}%2F01-feature%2Fx`, `${PROJ}%2F..`, `${PROJ}%2F%2E%2E`, `..%2F01-feature`,
    `${PROJ}%5C01-feature`, `${PROJ}%2F01-feature%20`, `${PROJ}%2F01%2Dfeature`, `%2F01-feature`, `${PROJ}%2F`,
    `${PROJ}%2F01-Feature`, `${PROJ}%2F1-feature`, `${PROJ}%2F00-feature`, `${PROJ}%2F01-feature%00`,
    `${PROJ}%2F%2F01-feature`, `${PROJ}%2F01-feature%2F`, `${PROJ}%2F01-feature%2F..%2F02-fix`,
  ];
  for (const raw of bad) assert.equal(resolveRunSlug(root, raw), null, raw);
});

test('AC16: a v3 slug with no run folder, a file or a missing project is refused', (t) => {
  const root = makeV3Root(t);
  assert.equal(resolveRunSlug(root, `${PROJ}%2F01-feature`), V3, 'control');
  assert.equal(resolveRunSlug(root, `${PROJ}%2F09-nothere`), null);
  assert.equal(resolveRunSlug(root, `${PROJ}%2F03-file`), null);
  assert.equal(resolveRunSlug(root, 'P20260101.000001%2F01-feature'), null);
});

test('AC16: a linked run folder or a linked project folder does not resolve', (t) => {
  const root = makeV3Root(t);
  assert.equal(resolveRunSlug(root, `${PROJ}%2F01-feature`), V3, 'control');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-slug-v3out-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  fs.mkdirSync(path.join(out, '05-fix'));
  const other = 'P20261108.000003';
  try {
    fs.symlinkSync(out, path.join(root, '.company', 'work', other), 'junction');
    fs.symlinkSync(path.join(out, '05-fix'), path.join(root, '.company', 'work', PROJ, '04-link'), 'junction');
  } catch (error) {
    t.skip(`links not permitted: ${error.code}`);
    return;
  }
  assert.equal(resolveRunSlug(root, `${other}%2F05-fix`), null);
  assert.equal(resolveRunSlug(root, `${PROJ}%2F04-link`), null);
});

test('AC16: run() of a v3 slug returns that run and reads its Did summary', async (t) => {
  const root = makeV3Root(t);
  fs.writeFileSync(path.join(root, '.company', 'work', PROJ, '01-feature', '01-qa.md'), '## Did\n- v3 ok\n');
  const seen = [];
  const show = (_r, slug) => { seen.push(slug); return { steps: [{ step: 1, role: 'qa', status: 'done', round: 1, file: '01-qa.md' }] }; };
  const out = await run(root, `${PROJ}%2F01-feature`, { deps: { show, active: () => ({ slug: V3 }), readLedger: () => ({ state: 'none', overCap: [] }) } });
  assert.ok(out, 'run data returns');
  assert.equal(out.slug, V3);
  assert.equal(out.steps[0].summary, 'v3 ok');
  assert.deepEqual(seen, [V3]);
  assert.ok(out.active, 'active data for the active v3 run');
  assert.equal(await run(root, `${PROJ}%2F01-feature%2Fx`, { deps: { show, active: () => ({ slug: null }), readLedger: () => null } }), null);
});
