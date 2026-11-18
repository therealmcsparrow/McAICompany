import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// every pin is the SHA-256 of the LF content git stores, so a clean clone or plugin install verifies.
// Read-only git only: `git show HEAD:<file>` bytes against the pins as committed.
const root = path.resolve(import.meta.dirname, '..');
const show = (rel) => execFileSync('git', ['-C', root, 'show', `HEAD:${rel}`], { maxBuffer: 64 * 1024 * 1024 });
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const inGit = (() => { try { show('hooks/pins.json'); return true; } catch { return false; } })();
const opts = { skip: !inGit && 'no git history for hooks/pins.json' };

test('every hooks/pins.json pin equals the SHA-256 of its committed git blob', opts, () => {
  const pins = JSON.parse(show('hooks/pins.json').toString('utf8'));
  const bad = Object.entries(pins.files).filter(([rel, hash]) => sha(show(rel)) !== hash).map(([rel]) => rel);
  assert.deepEqual(bad, []);
});

test('every hooks/lib/dep-hashes.mjs hash equals the SHA-256 of its committed git blob', opts, () => {
  const text = show('hooks/lib/dep-hashes.mjs').toString('utf8');
  const hashes = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const bad = Object.entries(hashes).filter(([rel, hash]) => sha(show(rel)) !== hash).map(([rel]) => rel);
  assert.deepEqual(bad, []);
});

test('the committed pinned blobs are LF only', opts, () => {
  const pins = JSON.parse(show('hooks/pins.json').toString('utf8'));
  assert.deepEqual(Object.keys(pins.files).filter((rel) => show(rel).includes(13)), []);
});
