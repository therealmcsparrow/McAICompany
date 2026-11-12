// Tests for test-run v1.1 `## Command` (flags, default timeout, shard, refusals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'scripts', 'test-run.mjs');
const PASS_A = 'tests/fixtures/progress/pass-a.fixture.mjs';
const PASS_B = 'tests/fixtures/progress/pass-b.fixture.mjs';
const HANG = 'tests/fixtures/test-run/never-settles.fixture.mjs';

function cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.AICO_TEST_WATCHDOG_MS;
  delete env.AICO_TEST_FILES_OUT;
  delete env.AICO_TEST_TOTAL;
  return env;
}

function run(args) {
  const r = spawnSync(process.execPath, [RUNNER, ...args], {
    cwd: ROOT,
    env: cleanEnv(),
    encoding: 'utf8',
    timeout: 90000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

const lines = (s) => s.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
const { planRun } = await import('./test-run.mjs');

function plan(args) {
  assert.equal(typeof planRun, 'function', 'scripts/test-run.mjs must export planRun(args)');
  return planRun(args);
}

const timeouts = (argv) => argv.filter((a) => a.startsWith('--test-timeout='));

test('planRun puts flags in any order before the patterns, unchanged', () => {
  const flags = ['--test-shard=1/2', '--test-name-pattern=foo'];
  const pats = [PASS_A, 'scripts/*.test.mjs'];
  for (const args of [[...flags, ...pats], [PASS_A, flags[0], 'scripts/*.test.mjs', flags[1]], [...pats, ...flags]]) {
    const { argv } = plan(args);
    assert.ok(Array.isArray(argv));
    for (const f of flags) assert.ok(argv.includes(f), `${f} kept in ${argv}`);
    const lastFlag = Math.max(...argv.map((a, i) => (a.startsWith('-') ? i : -1)));
    const firstPat = Math.min(...pats.map((p) => argv.indexOf(p)));
    assert.ok(firstPat > lastFlag, `patterns after all flags in ${argv}`);
    assert.deepEqual(argv.slice(firstPat), pats);
    assert.ok(argv.indexOf(flags[0]) < argv.indexOf(flags[1]), 'given flag order kept');
  }
});

test('planRun adds --test-timeout=1200000 exactly once when absent', () => {
  const { argv } = plan([PASS_A]);
  assert.deepEqual(timeouts(argv), ['--test-timeout=1200000']);
});

test('planRun lets a given --test-timeout= replace the default', () => {
  const { argv } = plan(['--test-timeout=500', PASS_A]);
  assert.deepEqual(timeouts(argv), ['--test-timeout=500']);
});

test('planRun refuses bad --test-timeout and isolation=none with the Contract line', () => {
  const bad = {
    '--test-timeout=0': 'aico test: bad --test-timeout',
    '--test-timeout=abc': 'aico test: bad --test-timeout',
    '--test-timeout=86400001': 'aico test: bad --test-timeout',
    '--test-isolation=none': 'aico test: --test-isolation=none is not supported',
    '--experimental-test-isolation=none': 'aico test: --test-isolation=none is not supported',
  };
  for (const [flag, line] of Object.entries(bad)) {
    assert.equal(plan([flag, PASS_A]).refuse, line, flag);
  }
  assert.equal(plan(['--test-timeout=86400000', PASS_A]).refuse, undefined);
  assert.equal(plan(['--test-timeout=1', PASS_A]).refuse, undefined);
});

test('shards 1/2 and 2/2 each run one file, together both, none twice', () => {
  const seen = [];
  assert.ok(plan(['--test-shard=1/2', PASS_A, PASS_B]).argv.includes('--test-shard=1/2'));
  for (const shard of ['1/2', '2/2']) {
    const r = run([`--test-shard=${shard}`, PASS_A, PASS_B]);
    assert.equal(r.code, 0, `shard ${shard}:\n${r.err}`);
    const done = lines(r.err).filter((l) => /\bpass-[ab]\.fixture\.mjs\b/.test(l) && /\bok\b/.test(l));
    assert.equal(done.length, 1, `shard ${shard} ran one file:\n${r.err}`);
    seen.push(done[0].match(/pass-[ab]\.fixture\.mjs/)[0]);
  }
  assert.deepEqual([...seen].sort(), ['pass-a.fixture.mjs', 'pass-b.fixture.mjs']);
});

test('with --test-shard= the start line total is ?', () => {
  assert.equal(plan(['--test-shard=1/2', PASS_A, PASS_B]).refuse, undefined);
  const r = run(['--test-shard=1/2', PASS_A, PASS_B]);
  const first = lines(r.err)[0] ?? '';
  assert.match(first, /^aico test: start, \? files/);
});

test('--test-timeout=500 fails a never-settling test by name and exits non-zero', () => {
  assert.deepEqual(timeouts(plan(['--test-timeout=500', HANG]).argv), ['--test-timeout=500']);
  const r = run(['--test-timeout=500', HANG]);
  assert.notEqual(r.code, 0, `exit ${r.code}\n${r.out}`);
  assert.match(r.out + r.err, /never settles/);
  assert.match(r.err, /never-settles\.fixture\.mjs[^\n]*\bfail\b/);
});

test('refusals exit 1 with exactly the Contract stderr line and empty stdout', () => {
  const cases = [
    ['--test-timeout=0', 'aico test: bad --test-timeout'],
    ['--test-timeout=abc', 'aico test: bad --test-timeout'],
    ['--test-timeout=86400001', 'aico test: bad --test-timeout'],
    ['--test-isolation=none', 'aico test: --test-isolation=none is not supported'],
    ['--experimental-test-isolation=none', 'aico test: --test-isolation=none is not supported'],
  ];
  for (const [flag, line] of cases) {
    const r = run([flag, PASS_A]);
    assert.equal(r.code, 1, `${flag} exit`);
    assert.equal(r.err.replace(/\r\n/g, '\n'), `${line}\n`, `${flag} stderr`);
    assert.equal(r.out, '', `${flag} stdout`);
  }
});

test('AC6 no flags runs the full set of the given patterns', () => {
  const r = run([PASS_A, PASS_B]);
  assert.equal(r.code, 0, r.err);
  const done = lines(r.err).filter((l) => /\b[12]\/2\b/.test(l) && /\bok\b/.test(l));
  assert.equal(done.length, 2, r.err);
  assert.match(lines(r.err)[0], /start, 2 files/);
});
