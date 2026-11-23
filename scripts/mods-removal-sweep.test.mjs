import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const exists = (rel) => fs.existsSync(path.join(root, rel));

const MAX_FILE_BYTES = 1024 * 1024;
const PROGRESS_EVERY = 250;

const DELETED = [
  'mods/blast-radius.ts',
  'mods/lib/blast.mjs',
  'mods/test/blast-radius.test.tsx',
  'scripts/blast-drift.test.mjs',
  'documentation/mods/blast-radius.md'
];

function importPattern(name) {
  return new RegExp(`(?:\\bimport\\b|\\brequire\\b|\\bfrom\\b)[^\\n]*${name}(?:\\.mjs)?['"\`]`);
}

function progress(line) {
  fs.writeSync(2, `mods-removal-sweep: ${line}\n`);
}

describe('removed mod files', () => {
  for (const rel of DELETED) {
    test(`AC2: ${rel} is deleted`, () => {
      assert.equal(exists(rel), false);
    });
  }

});

describe('git-commit detector removal', () => {
  test('mods/lib/git-commit.mjs does not exist', () => {
    assert.equal(exists('mods/lib/git-commit.mjs'), false);
  });

  test('no tracked file outside CHANGELOG and Contract headers imports git-commit', () => {
    const name = ['git', 'commit'].join('-');
    const importer = importPattern(name);
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
      .toString('utf8').split('\0').filter(Boolean)
      .filter((rel) => rel !== 'CHANGELOG.md' && !rel.startsWith('docs/contracts/'));
    progress(`import walk start, ${files.length} tracked files`);
    const hits = [];
    for (const [n, rel] of files.entries()) {
      if ((n + 1) % PROGRESS_EVERY === 0) progress(`import walk ${n + 1}/${files.length} files`);
      if (!exists(rel)) continue;
      const abs = path.join(root, rel);
      if (fs.statSync(abs).size > MAX_FILE_BYTES) continue;
      if (importer.test(fs.readFileSync(abs, 'utf8'))) hits.push(rel);
    }
    progress(`import walk done, ${hits.length} importing files`);
    assert.deepEqual(hits, []);
  });

  test('the import pattern matches real import, require and from lines', () => {
    const name = ['git', 'commit'].join('-');
    const importer = importPattern(name);
    assert.match(`import { x } from './lib/${name}.mjs';`, importer);
    assert.match(`const x = require('../${name}');`, importer);
    assert.doesNotMatch(`// the ${name} detector is gone`, importer);
  });
});
