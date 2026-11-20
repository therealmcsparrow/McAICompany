import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const notice = () => read('NOTICE');

test('NOTICE credits Ben AI by name', () => {
  assert.match(notice(), /Ben AI/);
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

test('no pack file or folder is tracked in the repository tree', () => {
  const top = fs.readdirSync(root);
  assert.ok(!top.some((n) => /^token-saving/i.test(n)), 'no token-saving folder at the root');
  assert.ok(!fs.existsSync(path.join(root, 'plugins', 'model-router')), 'no vendored model-router');
});
