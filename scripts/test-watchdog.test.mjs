// QA-first tests for the per-file watchdog (test-run contract, "Per-file watchdog", AC4).
// Imports of the not-yet-built modules are dynamic so each test fails by name until T8 lands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'scripts', 'test-run.mjs');
const WATCHDOG = path.join(ROOT, 'scripts', 'test-watchdog.mjs');
const FIX = 'tests/fixtures/test-run';
const OPEN = `${FIX}/open-handle.fixture.mjs`;
const TLA_HANDLE = `${FIX}/tla-handle.fixture.mjs`;
const TLA_ONLY = `${FIX}/tla-only.fixture.mjs`;
const PASS = 'tests/fixtures/progress/pass-a.fixture.mjs';

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['NODE_TEST_CONTEXT', 'AICO_PROGRESS_HEARTBEAT_MS', 'AICO_TEST_TOTAL', 'AICO_TEST_WATCHDOG_MS', 'AICO_TEST_FILES_OUT']) delete env[k];
  return Object.assign(env, extra);
}

function runner(args, extraEnv = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [RUNNER, ...args], {
    cwd: ROOT,
    env: cleanEnv(extraEnv),
    encoding: 'utf8',
    timeout: 90000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: r.status, signal: r.signal, out: r.stdout ?? '', err: r.stderr ?? '', ms: Date.now() - t0 };
}

const all = (r) => `${r.out}\n${r.err}`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One shared run: two hangers and a passer, D = 4000 ms.
let shared;
function sharedRun() {
  if (!shared) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-wd-'));
    const list = path.join(dir, 'files.txt');
    const r = runner(['--test-timeout=2000', OPEN, TLA_HANDLE, PASS], { AICO_TEST_FILES_OUT: list });
    shared = { r, list: fs.existsSync(list) ? fs.readFileSync(list, 'utf8').split('\n').filter(Boolean) : [] };
  }
  return shared;
}

test('AC4 open-handle file fails by name at about D with the exact stderr line', () => {
  const { r } = sharedRun();
  const line = `aico test: watchdog: ${OPEN} did not end within 4000 ms`;
  assert.ok(all(r).includes(line), `missing line "${line}" in:\n${all(r)}`);
  assert.ok(r.ms >= 3500, `ended too early (${r.ms} ms)`);
  assert.ok(r.ms < 40000, `run took ${r.ms} ms, the hang was not cut at D`);
});

test('AC4 tla-handle file fails by name at about D with the exact stderr line', () => {
  const { r } = sharedRun();
  const line = `aico test: watchdog: ${TLA_HANDLE} did not end within 4000 ms`;
  assert.ok(all(r).includes(line), `missing line "${line}" in:\n${all(r)}`);
});

test('AC4 the run exits non-zero and shows a failed progress line per hanging file', () => {
  const { r } = sharedRun();
  assert.notEqual(r.code, 0, `exit ${r.code} signal ${r.signal}`);
  for (const f of ['open-handle.fixture.mjs', 'tla-handle.fixture.mjs']) {
    assert.match(r.err, new RegExp(`\\d+/\\d+ \\S*${esc(f)} fail`), `no fail progress line for ${f} in:\n${r.err}`);
  }
});

test('AC4 hanging files stay in the AICO_TEST_FILES_OUT list and the passing file runs on', () => {
  const { r, list } = sharedRun();
  assert.ok(list.includes(OPEN), `list: ${list}`);
  assert.ok(list.includes(TLA_HANDLE), `list: ${list}`);
  assert.ok(list.includes(PASS), `list: ${list}`);
  assert.match(r.err, /\d+\/\d+ \S*pass-a\.fixture\.mjs ok/, `pass-a not ok in:\n${r.err}`);
  assert.doesNotMatch(all(r), /watchdog: \S*pass-a/);
});

test('AC4 tla-only fails by node itself well before D, with no watchdog line', () => {
  // T = 20000 so D = 40000 ms; node must fail the file when the loop drains.
  const r = runner(['--test-timeout=20000', TLA_ONLY]);
  assert.notEqual(r.code, 0, `exit ${r.code}`);
  assert.ok(r.ms < 15000, `took ${r.ms} ms, not well before D`);
  assert.doesNotMatch(all(r), /aico test: watchdog:/);
  assert.match(r.err, /\d+\/\d+ \S*tla-only\.fixture\.mjs fail/, `no fail line in:\n${r.err}`);
});

test('AC4 a passing file at the default T is not delayed', () => {
  const r = runner([PASS]);
  assert.equal(r.code, 0, `exit ${r.code}:\n${all(r)}`);
  assert.ok(r.ms < 20000, `took ${r.ms} ms`);
  assert.doesNotMatch(all(r), /aico test: watchdog:/);
});

test('AC4 an inherited AICO_TEST_WATCHDOG_MS is replaced by the computed deadline', () => {
  const r = runner(['--test-timeout=2000', OPEN], { AICO_TEST_WATCHDOG_MS: '600000' });
  assert.ok(all(r).includes(`aico test: watchdog: ${OPEN} did not end within 4000 ms`), all(r));
  assert.ok(r.ms < 40000, `took ${r.ms} ms`);
});

test('AC4 armDeadline returns null with --test in execArgv', async () => {
  const { armDeadline } = await import(pathToFileURL(WATCHDOG).href);
  assert.equal(armDeadline({ AICO_TEST_WATCHDOG_MS: '4000' }, ['--test']), null);
  assert.equal(armDeadline({ AICO_TEST_WATCHDOG_MS: '4000' }, ['--import=x', '--test', '--test-timeout=1']), null);
});

test('AC4 armDeadline checks --test by exact element, not prefix', async () => {
  const { armDeadline } = await import(pathToFileURL(WATCHDOG).href);
  assert.equal(armDeadline({ AICO_TEST_WATCHDOG_MS: '4000' }, ['--test-timeout=2000', '--test-shard=1/4']), 4000);
});

test('AC4 armDeadline returns null for a missing or non-whole env value', async () => {
  const { armDeadline } = await import(pathToFileURL(WATCHDOG).href);
  for (const v of [undefined, '', 'abc', '1.5', '-5', '12ab', ' ', '1e3']) {
    assert.equal(armDeadline(v === undefined ? {} : { AICO_TEST_WATCHDOG_MS: v }, []), null, `value ${JSON.stringify(v)}`);
  }
});

test('AC4 armDeadline returns the number otherwise', async () => {
  const { armDeadline } = await import(pathToFileURL(WATCHDOG).href);
  assert.equal(armDeadline({ AICO_TEST_WATCHDOG_MS: '4000' }, []), 4000);
  assert.equal(armDeadline({ AICO_TEST_WATCHDOG_MS: '1230000' }, ['--import=x']), 1230000);
});

test('AC4 planRun deadlineMs = T + min(T, 30000)', async () => {
  const { planRun } = await import(pathToFileURL(RUNNER).href);
  const cases = [[[], 1230000], [['--test-timeout=2000'], 4000], [['--test-timeout=100000'], 130000], [['--test-timeout=30000'], 60000]];
  for (const [flags, want] of cases) {
    const p = planRun([...flags, PASS]);
    assert.equal(p.refuse, undefined, `refused: ${p.refuse}`);
    assert.equal(p.deadlineMs, want, `flags ${flags}`);
  }
});

test('AC4 planRun argv starts with the --import file URL of test-watchdog.mjs', async () => {
  const { planRun } = await import(pathToFileURL(RUNNER).href);
  const p = planRun([PASS]);
  assert.ok(Array.isArray(p.argv), 'argv is an array');
  assert.match(p.argv[0], /^--import=file:\/\/\/.+test-watchdog\.mjs$/);
  assert.equal(p.argv[0], `--import=${pathToFileURL(WATCHDOG).href}`);
});

test('AC4 planRun replaces an inherited AICO_TEST_WATCHDOG_MS', async () => {
  const { planRun } = await import(pathToFileURL(RUNNER).href);
  const prev = process.env.AICO_TEST_WATCHDOG_MS;
  process.env.AICO_TEST_WATCHDOG_MS = '999';
  try {
    const p = planRun(['--test-timeout=2000', PASS]);
    assert.equal(p.deadlineMs, 4000);
    if (p.env) assert.equal(p.env.AICO_TEST_WATCHDOG_MS, '4000');
  } finally {
    if (prev === undefined) delete process.env.AICO_TEST_WATCHDOG_MS;
    else process.env.AICO_TEST_WATCHDOG_MS = prev;
  }
});
