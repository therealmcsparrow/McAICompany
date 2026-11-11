import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'scripts', 'test-run.mjs');
const FIX = 'tests/fixtures/progress';
const PASS_A = `${FIX}/pass-a.fixture.mjs`;
const PASS_B = `${FIX}/pass-b.fixture.mjs`;
const FAIL = `${FIX}/fail.fixture.mjs`;

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aico-files-out-'));
}

function run(args, extraEnv = {}) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.AICO_TEST_TOTAL;
  delete env.AICO_TEST_FILES_OUT;
  Object.assign(env, extraEnv);
  const r = spawnSync(process.execPath, [RUNNER, ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('File list: passed and failed files are both listed, sorted, repo-relative with / and LF', () => {
  const dir = tmp();
  const out = path.join(dir, 'files.txt');
  const r = run([PASS_B, FAIL, PASS_A], { AICO_TEST_FILES_OUT: out });
  assert.notEqual(r.code, 0, 'the failing fixture must fail the run');
  assert.ok(fs.existsSync(out), `list not written; stderr:\n${r.err}`);
  const buf = fs.readFileSync(out);
  const text = buf.toString('utf8');
  assert.equal(text, [FAIL, PASS_A, PASS_B].sort().join('\n') + '\n');
  assert.ok(!text.includes('\r'), 'no CR');
  assert.ok(!text.includes(String.fromCharCode(92)), 'no backslash');
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), 'exactly one final LF');
  for (const l of text.split('\n').filter(Boolean)) assert.ok(!path.isAbsolute(l), l);
});

test('File list: parent folder is created when missing', () => {
  const dir = tmp();
  const out = path.join(dir, 'a', 'b', 'files.txt');
  run([PASS_A], { AICO_TEST_FILES_OUT: out });
  assert.equal(fs.readFileSync(out, 'utf8'), `${PASS_A}\n`);
});

test('File list: unset writes nothing', () => {
  const dir = tmp();
  const r = run([PASS_A]);
  assert.equal(r.code, 0);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.ok(!fs.existsSync(path.join(ROOT, 'undefined')));
});

test('File list: empty value writes nothing and does not break the run', () => {
  const dir = tmp();
  const before = fs.readdirSync(ROOT).sort();
  const r = run([PASS_A], { AICO_TEST_FILES_OUT: '' });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.deepEqual(fs.readdirSync(ROOT).sort(), before, 'no stray file in the cwd');
});

test('File list: with --test-shard=1/2 and 2/2 each list holds only that shard, together all files', () => {
  const all = [FAIL, PASS_A, PASS_B].sort();
  const lists = [];
  for (const shard of ['1/2', '2/2']) {
    const out = path.join(tmp(), 'f.txt');
    run([`--test-shard=${shard}`, PASS_A, PASS_B, FAIL], { AICO_TEST_FILES_OUT: out });
    assert.ok(fs.existsSync(out), `no list for shard ${shard}`);
    const l = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean);
    assert.deepEqual(l, [...l].sort(), 'sorted');
    assert.ok(l.length > 0 && l.length < all.length, `shard ${shard} must be a strict part: ${l}`);
    lists.push(l);
  }
  assert.deepEqual(lists[0].filter((f) => lists[1].includes(f)), [], 'shards are disjoint');
  assert.deepEqual([...lists[0], ...lists[1]].sort(), all);
});
