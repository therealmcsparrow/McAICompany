import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const notice = () => read('NOTICE');
const table = () => read('docs', 'pack-clash-table.md');

const licenceRows = () => {
  const lines = table().split(/\r?\n/);
  const start = lines.findIndex((l) => /^## Licence check/.test(l));
  assert.ok(start >= 0, 'licence check section exists');
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines
    .slice(start, end < 0 ? undefined : end)
    .filter((l) => /^\|/.test(l) && !/^\|\s*(Pack mod|-)/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
};

test('NOTICE credits Ben AI by name', () => {
  assert.match(notice(), /Ben AI/);
});

test('NOTICE names the upstream marketplace and every upstream version the licence table records', () => {
  const n = notice();
  assert.match(n, /token-saving-mods/);
  const rows = licenceRows();
  assert.ok(rows.length >= 9, `licence table has a row per pack mod, got ${rows.length}`);
  for (const [mod, version] of rows) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${mod} has a version`);
    assert.ok(n.includes(`${mod} ${version}`), `NOTICE names ${mod} ${version}`);
  }
});

test('NOTICE states the clean-room position and grants no licence', () => {
  const n = notice().replace(/\s+/g, ' ');
  assert.match(n, /no licence/i);
  assert.match(n, /No code, text or structure of the pack is copied/);
  assert.match(n, /behaviour description only/);
  assert.match(n, /docs\/pack-clash-table\.md/);
  assert.match(n, /not a licence grant/);
});

test('NOTICE gives the MIT notice for model-router and says its code is unused', () => {
  const n = notice().replace(/\s+/g, ' ');
  assert.match(n, /MIT licence/);
  assert.match(n, /Copyright \(c\) 2025 Daniel \(San\) Avila/);
  assert.match(n, /No code of it is used in this release/);
});

test('licence table records a licence result for every pack mod before any verdict', () => {
  const t = table();
  const licenceAt = t.search(/^## Licence check/m);
  const verdictAt = t.search(/Verdict words:/);
  assert.ok(licenceAt >= 0 && verdictAt > licenceAt, 'licence check precedes the verdict table');
  const rows = licenceRows();
  const names = rows.map((r) => r[0]);
  for (const mod of ['cache-clock', 'efficient-browser-use', 'effort-optimizer', 'handoff', 'input-router', 'mods', 'research-router', 'savings-proof', 'model-router']) {
    assert.ok(names.includes(mod), `licence row for ${mod}`);
  }
  for (const r of rows) {
    assert.ok(r[2] && r[4], `${r[0]} has a licence result and a derivation answer`);
  }
});

test('every pack mod without a licence is marked no derivation and the clean-room rule exists', () => {
  const rows = licenceRows();
  const unlicensed = rows.filter((r) => /^none/i.test(r[2]));
  assert.equal(unlicensed.length, 8);
  for (const r of unlicensed) assert.equal(r[4], 'no', `${r[0]} derivation`);
  const mit = rows.find((r) => r[0] === 'model-router');
  assert.match(mit[2], /^MIT/);
  assert.match(table(), /^## Clean-room rule/m);
});

test('no pack file or folder is tracked in the repository tree', () => {
  const top = fs.readdirSync(root);
  assert.ok(!top.some((n) => /^token-saving/i.test(n)), 'no token-saving folder at the root');
  assert.ok(!fs.existsSync(path.join(root, 'plugins', 'model-router')), 'no vendored model-router');
});
