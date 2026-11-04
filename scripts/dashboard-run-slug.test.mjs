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
