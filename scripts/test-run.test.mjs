import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'scripts', 'test-run.mjs');
const FIX = 'tests/fixtures/progress';
const PASS_A = `${FIX}/pass-a.fixture.mjs`;
const PASS_B = `${FIX}/pass-b.fixture.mjs`;
const FAIL = `${FIX}/fail.fixture.mjs`;
const SLOW = `${FIX}/slow.fixture.mjs`;

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  delete env.AICO_PROGRESS_HEARTBEAT_MS;
  delete env.AICO_TEST_TOTAL;
  Object.assign(env, extra);
  return env;
}

function run(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: cleanEnv(extraEnv),
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: r.status, signal: r.signal, out: r.stdout, err: r.stderr };
}

const wrapped = (files, env) => run([RUNNER, ...files], env);
const bare = (files) => run(['--test', ...files]);

function mask(s) {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/duration_ms[ :]+[\d.]+/g, 'duration_ms X')
    .replace(/\(?\b\d+(\.\d+)?\s?ms\b\)?/g, 'Xms');
}

const lines = (s) => s.split('\n').filter((l) => l.length > 0);

test('AC1 start line is the first stderr line and names the command and file count', () => {
  const r = wrapped([PASS_A, PASS_B]);
  const first = lines(r.err)[0] ?? '';
  assert.match(first, /^aico test: /);
  assert.match(first, /start/i);
  assert.match(first, /\b2\b/);
});

test('AC2 each finished file prints n/total with its name', () => {
  const r = wrapped([PASS_A, PASS_B]);
  const ls = lines(r.err);
  const a = ls.findIndex((l) => /\b\d\/2\b/.test(l) && l.includes('pass-a.fixture.mjs'));
  const b = ls.findIndex((l) => /\b\d\/2\b/.test(l) && l.includes('pass-b.fixture.mjs'));
  assert.ok(a >= 0, `no n/2 line for pass-a in:\n${r.err}`);
  assert.ok(b >= 0, `no n/2 line for pass-b in:\n${r.err}`);
  const counts = ls.filter((l) => /\b[12]\/2\b/.test(l)).map((l) => l.match(/\b([12])\/2\b/)[1]);
  assert.ok(counts.includes('1') && counts.includes('2'), `counts ${counts}`);
});

test('AC2 a file over the heartbeat interval prints a heartbeat with its name before it finishes', () => {
  const r = wrapped([SLOW], { AICO_PROGRESS_HEARTBEAT_MS: '200' });
  const ls = lines(r.err);
  const doneIdx = ls.findIndex((l) => /\b1\/1\b/.test(l));
  assert.ok(doneIdx >= 0, `no 1/1 line in:\n${r.err}`);
  const beats = ls.slice(0, doneIdx).filter((l) => l.includes('slow.fixture.mjs') && /\d+(\.\d+)?\s*s\b/.test(l));
  assert.ok(beats.length >= 1, `no heartbeat with name and seconds before the 1/1 line in:\n${r.err}`);
});

test('AC2 no heartbeat when every file is faster than the interval', () => {
  const r = wrapped([PASS_A], { AICO_PROGRESS_HEARTBEAT_MS: '60000' });
  const named = lines(r.err).filter((l) => l.includes('pass-a.fixture.mjs'));
  assert.equal(named.length, 1, `expected one line naming the file, got:\n${r.err}`);
});

test('AC3 last stderr line has pass and fail counts and seconds, on pass', () => {
  const r = wrapped([PASS_A, PASS_B]);
  const last = lines(r.err).at(-1) ?? '';
  assert.match(last, /^aico test: end, 2 ok, 0 fail, \d+(?:\.\d+)?s$/);
  assert.equal(r.code, 0);
});

test('AC3 last stderr line counts the failing file, on fail', () => {
  const r = wrapped([PASS_A, FAIL]);
  const last = lines(r.err).at(-1) ?? '';
  assert.match(last, /^aico test: end, 1 ok, 1 fail, \d+(?:\.\d+)?s$/);
});

test('AC3 no heartbeat or other line follows the end line', () => {
  const r = wrapped([SLOW], { AICO_PROGRESS_HEARTBEAT_MS: '50' });
  const ls = lines(r.err);
  const endIdx = ls.map((l) => /: end, \d+ ok, \d+ fail, /.test(l)).lastIndexOf(true);
  assert.equal(endIdx, ls.length - 1, `end line is not last in:\n${r.err}`);
});

test('AC4 stdout and exit code equal bare node --test on a passing set', () => {
  const files = [PASS_A, PASS_B];
  const w = wrapped(files);
  const b = bare(files);
  assert.equal(w.code, b.code);
  assert.equal(w.code, 0);
  assert.equal(mask(w.out), mask(b.out));
});

test('AC4 stdout and exit code equal bare node --test on a failing set', () => {
  const files = [PASS_A, FAIL];
  const w = wrapped(files);
  const b = bare(files);
  assert.notEqual(b.code, 0);
  assert.equal(w.code, b.code);
  assert.equal(mask(w.out), mask(b.out));
});

test('AC4 stdout carries no progress line', () => {
  const r = wrapped([PASS_A, PASS_B]);
  assert.match(r.err, /\b2\/2\b/);
  assert.match(r.out, /pass/i);
  assert.doesNotMatch(r.out, /\b[12]\/2\b.*fixture/);
  assert.doesNotMatch(r.out, /aico test: start/i);
});

test('AC4 a failing run keeps the node not ok lines off the progress lines', () => {
  const r = wrapped([FAIL]);
  assert.match(r.err, /\b1\/1\b/);
  for (const l of lines(r.err)) {
    assert.doesNotMatch(l, /^(not ok|✖)/, `progress line starts like a test failure: ${l}`);
  }
});

test('AC6 non-TTY stderr is plain lines: no byte below 0x20 except LF', () => {
  for (const r of [
    wrapped([PASS_A, PASS_B]),
    wrapped([PASS_A, FAIL]),
    wrapped([SLOW], { AICO_PROGRESS_HEARTBEAT_MS: '200' }),
  ]) {
    assert.ok(r.err.length > 0, 'stderr is empty');
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(r.err, /[\x00-\x09\x0b-\x1f\x7f]/);
    assert.ok(r.err.endsWith('\n'));
  }
});

test('AC6 start, n/total, heartbeat and end all appear in one non-TTY run', () => {
  const r = wrapped([PASS_A, SLOW], { AICO_PROGRESS_HEARTBEAT_MS: '200' });
  const ls = lines(r.err);
  assert.match(ls[0], /start/i);
  assert.ok(ls.some((l) => /\b1\/2\b/.test(l)));
  assert.ok(ls.some((l) => /\b2\/2\b/.test(l)));
  assert.ok(ls.some((l) => l.includes('slow.fixture.mjs') && !/\b\d\/2\b/.test(l) && /\d+(\.\d+)?\s*s\b/.test(l)));
  assert.match(ls.at(-1), /^aico test: end, \d+ ok, \d+ fail, \d+(?:\.\d+)?s$/);
});
