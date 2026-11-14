import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PAGE = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));
const DOC = fs.readFileSync(path.join(import.meta.dirname, '..', 'documentation', 'mods', 'switchboard.md'), 'utf8');
const MODS_SRC = fs.readFileSync(path.join(import.meta.dirname, '..', 'mods', 'switchboard.tsx'), 'utf8');

const listOf = (name) => {
  const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(SCRIPT);
  assert.ok(m, `${name} exists`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

test('settings page lists every switchable mod, so the Switchboard can be switched back on', () => {
  const mods = listOf('MODS');
  for (const id of ['switchboard', 'savings', 'efficient_browser_use', 'savvy', 'cache_tax', 'reflect']) {
    assert.ok(mods.includes(id), `MODS has ${id}`);
    assert.ok(new RegExp(`\\b${id}:\\s*'[^']+'`).test(SCRIPT.slice(SCRIPT.indexOf('const MOD_LABELS'), SCRIPT.indexOf('const MOD_LABELS') + 400)), `label for ${id}`);
  }
});

test('settings page shows a Pane row only for mods that have a pane key', () => {
  const m = /function renderMods\([\s\S]*?\n\}\n/.exec(SCRIPT);
  assert.ok(m, 'renderMods exists');
  assert.ok(/PANE_MODS/.test(m[0]), 'Pane row is gated by PANE_MODS');
  assert.deepEqual(listOf('PANE_MODS'), ['savvy', 'cache_tax']);
});

test('the off text and the docs line both point at /aico:settings, and the docs name the Switchboard unit', () => {
  assert.ok(/switch it on in \/aico:settings/.test(MODS_SRC));
  assert.ok(/`\/aico:settings` \(Mods tab, Switchboard unit, Power\)/.test(DOC));
});
