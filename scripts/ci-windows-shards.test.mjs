// T9: static reads of .github/workflows/ci.yml for the sharded Windows jobs
// (test-run v1.1 `## CI jobs`; AC1, AC3, AC5, AC7).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

function jobOf(name) {
  const start = ci.indexOf(`\n  ${name}:`);
  if (start < 0) return '';
  const next = ci.slice(start + 1).search(/\n  [a-z-]+:\n/);
  return next < 0 ? ci.slice(start) : ci.slice(start, start + 1 + next);
}
const check = jobOf('check');
const win = jobOf('windows-test');
const agg = jobOf('windows-check');
// The step (split on list dashes at step level) that contains the needle.
function step(job, needle) {
  return job.split(/\n      - /).find((p) => p.includes(needle)) ?? '';
}
const runLines = (job) => job.split('\n').filter((l) => /^\s*(- )?run:/.test(l));

describe('check job keeps ubuntu and macos only (AC1)', () => {
  test('matrix is [ubuntu-latest, macos-latest]', () => {
    assert.match(check, /os: \[ubuntu-latest, macos-latest\]/);
    assert.doesNotMatch(check, /windows-latest/);
  });
  test('check still runs npm test then npm run check', () => {
    assert.ok(check.indexOf('npm test') > 0);
    assert.ok(check.indexOf('npm run check') > check.indexOf('npm test'));
  });
});

describe('windows-test job shards the tests (AC1, AC3)', () => {
  test('exists with a 4 shard matrix, fail-fast false, windows-latest', () => {
    assert.ok(win, 'windows-test job missing');
    assert.match(win, /shard: \[1, 2, 3, 4\]/);
    assert.match(win, /fail-fast: false/);
    assert.match(win, /runs-on: windows-latest/);
  });
  test('checks out into a path with a space', () => {
    assert.ok(win.includes('actions/checkout'));
    const checkout = win.slice(win.indexOf('actions/checkout'), win.indexOf('actions/setup-node'));
    assert.match(checkout, /path: [^\n]* [^\n]*/);
  });
  test('AICO_TEST_SHARD and AICO_TEST_FILES_OUT are set in env: blocks', () => {
    assert.match(win, /AICO_TEST_SHARD: [^\n]*\$\{\{ matrix\.shard \}\}\/4/);
    assert.match(win, /AICO_TEST_FILES_OUT: [^\n]*shard-files[^\n]*shard-\$\{\{ matrix\.shard \}\}\.txt/);
    assert.match(win, /env:\n(?:\s+[A-Z_]+: [^\n]*\n)*?\s+AICO_TEST_SHARD:/);
  });
  test('hostile: no ${{ }} expression on any run: line', () => {
    assert.ok(win);
    for (const l of runLines(win)) assert.doesNotMatch(l, /\$\{\{/, l);
  });
  test('the test run line is npm test -- "--test-shard=$AICO_TEST_SHARD"', () => {
    assert.ok(win.includes('run: npm test -- "--test-shard=$AICO_TEST_SHARD"'));
  });
  test('npm run check runs only under matrix.shard == 1, after npm test', () => {
    const s = step(win, 'npm run check');
    assert.ok(s, 'no npm run check step');
    assert.match(s, /if: matrix\.shard == 1/);
    assert.equal((win.match(/npm run check/g) ?? []).length, 1);
    assert.ok(win.indexOf('npm run check') > win.indexOf('npm test'));
  });
  test('uploads shard-files-<shard> even when tests fail', () => {
    const s = step(win, 'actions/upload-artifact');
    assert.ok(s, 'no upload step');
    assert.match(s, /if: always\(\)/);
    assert.match(s, /name: shard-files-\$\{\{ matrix\.shard \}\}/);
  });
});

describe('windows-check aggregate job (AC5, AC7)', () => {
  test('is named check (windows-latest), needs windows-test, always runs, on ubuntu', () => {
    assert.ok(agg, 'windows-check job missing');
    assert.match(agg, /name: check \(windows-latest\)/);
    assert.match(agg, /needs: windows-test/);
    assert.match(agg, /\n    if: always\(\)/);
    assert.match(agg, /runs-on: ubuntu-latest/);
  });
  test('downloads shard lists merged into one folder', () => {
    const s = step(agg, 'actions/download-artifact');
    assert.ok(s, 'no download step');
    assert.match(s, /merge-multiple: true/);
    assert.match(s, /shard-files-\*/);
  });
  test('runs cover mode with --aico-cover=', () => {
    assert.match(agg, /npm test -- "--aico-cover=/);
  });
  test('reads needs.windows-test.result through env:, never on a run: line', () => {
    assert.match(agg, /[A-Z_]+: \$\{\{ needs\.windows-test\.result \}\}/);
    assert.ok(agg);
    for (const l of runLines(agg)) assert.doesNotMatch(l, /\$\{\{/, l);
  });
  test('the shard-result step runs with if: always() so cover and shard failures both show', () => {
    const s = step(agg, 'needs.windows-test.result');
    assert.ok(s, 'no result step');
    assert.match(s, /if: always\(\)/);
  });
});

describe('actions stay pinned (AC7)', () => {
  test('every uses: is a full commit', () => {
    for (const m of ci.matchAll(/uses: ([^\s]+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
    assert.ok(win, 'windows-test job missing');
  });
});
