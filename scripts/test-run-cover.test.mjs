import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'scripts', 'test-run.mjs');
const FIX = 'tests/fixtures/progress';
const GLOB = `${FIX}/*.fixture.mjs`;
const ALL = ['fail', 'pass-a', 'pass-b', 'slow'].map((n) => `${FIX}/${n}.fixture.mjs`);

function cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.AICO_PROGRESS_HEARTBEAT_MS;
  delete env.AICO_TEST_TOTAL;
  delete env.AICO_TEST_FILES_OUT;
  return env;
}

function cover(dir, patterns = [GLOB]) {
  const r = spawnSync(process.execPath, [RUNNER, `--aico-cover=${dir}`, ...patterns], {
    cwd: ROOT,
    env: cleanEnv(),
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const all = `${r.stdout}${r.stderr}`.replace(/\r\n/g, '\n');
  return { code: r.status, out: r.stdout.replace(/\r\n/g, '\n'), err: r.stderr, all };
}

const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});
function mkdir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-cover-'));
  made.push(d);
  return d;
}
const list = (dir, name, files) => fs.writeFileSync(path.join(dir, name), files.join('\n') + '\n');
const lines = (s) => s.split('\n').filter((l) => l.length > 0);
const findings = (s) => lines(s).filter((l) => /^(missing|twice|unknown) /.test(l));

test('cover: lists that hold every file once print the ok line, exit 0', () => {
  const d = mkdir();
  list(d, 'shard-1.txt', [ALL[0], ALL[1]]);
  list(d, 'shard-2.txt', [ALL[2], ALL[3]]);
  const r = cover(d);
  assert.equal(r.code, 0, r.all);
  assert.ok(lines(r.all).includes('cover: 4 files, 2 lists, ok'), r.all);
  assert.deepEqual(findings(r.all), []);
});

test('cover: missing files print one sorted missing line each, exit 1', () => {
  const d = mkdir();
  list(d, 'a.txt', [ALL[1], ALL[2]]);
  const r = cover(d);
  assert.equal(r.code, 1, r.all);
  assert.deepEqual(findings(r.all), [`missing ${ALL[0]}`, `missing ${ALL[3]}`]);
  assert.ok(!/cover: \d+ files/.test(r.all), 'no ok line with findings');
});

test('cover: a file in the lists k times prints `twice <file> <k>`', () => {
  const d = mkdir();
  list(d, 'a.txt', ALL);
  list(d, 'b.txt', [ALL[1]]);
  list(d, 'c.txt', [ALL[1]]);
  list(d, 'd.txt', [ALL[2]]);
  const r = cover(d);
  assert.equal(r.code, 1, r.all);
  assert.deepEqual(findings(r.all), [`twice ${ALL[1]} 3`, `twice ${ALL[2]} 2`]);
});

test('cover: a listed file the patterns do not select prints unknown', () => {
  const d = mkdir();
  list(d, 'a.txt', [...ALL, 'tests/zzz-gone.test.mjs', 'tests/aaa-gone.test.mjs']);
  const r = cover(d);
  assert.equal(r.code, 1, r.all);
  assert.deepEqual(findings(r.all), ['unknown tests/aaa-gone.test.mjs', 'unknown tests/zzz-gone.test.mjs']);
});

test('cover: findings of all kinds are sorted together', () => {
  const d = mkdir();
  list(d, 'a.txt', [ALL[1], ALL[1], 'tests/x.test.mjs']);
  const r = cover(d);
  const f = findings(r.all);
  assert.equal(r.code, 1);
  assert.deepEqual(f, [...f].sort());
  assert.ok(f.includes(`twice ${ALL[1]} 2`));
  assert.ok(f.includes('unknown tests/x.test.mjs'));
  assert.ok(f.includes(`missing ${ALL[0]}`));
});

test('cover: non-.txt files and subfolders in the dir are ignored', () => {
  const d = mkdir();
  list(d, 'good.txt', ALL);
  list(d, 'notes.md', ['tests/ignored.test.mjs']);
  list(d, 'data.txt.bak', ['tests/ignored2.test.mjs']);
  fs.mkdirSync(path.join(d, 'sub'));
  list(path.join(d, 'sub'), 'inner.txt', ['tests/ignored3.test.mjs']);
  const r = cover(d);
  assert.equal(r.code, 0, r.all);
  assert.ok(lines(r.all).includes('cover: 4 files, 1 lists, ok'), r.all);
});

test('cover: no list in the dir -> cover: error, exit 1', () => {
  const d = mkdir();
  const r = cover(d);
  assert.equal(r.code, 1, r.all);
  assert.ok(lines(r.all).some((l) => /^cover: error \S/.test(l)), r.all);
  assert.ok(!/ok$/m.test(r.all));
});

test('cover: empty --aico-cover= prints one cover: error line on stdout, exit 1, runs no tests', () => {
  const r = cover('');
  assert.equal(r.code, 1, r.all);
  const errs = lines(r.out).filter((l) => /^cover: error \S/.test(l));
  assert.equal(errs.length, 1, r.all);
  assert.doesNotMatch(r.err, /bad --aico-cover/);
  assert.ok(!/^# (tests|pass|fail)/m.test(r.all) && !/TAP version/.test(r.all), r.all);
});

test('cover: missing dir -> cover: error, exit 1', () => {
  const d = path.join(mkdir(), 'does-not-exist');
  const r = cover(d);
  assert.equal(r.code, 1, r.all);
  assert.ok(lines(r.all).some((l) => /^cover: error \S/.test(l)), r.all);
});

test('cover: a list over 1 MiB -> cover: error, exit 1, no list content repeated', () => {
  const d = mkdir();
  const secret = 'SECRET-LIST-CONTENT-7f3a';
  fs.writeFileSync(path.join(d, 'big.txt'), (secret + '\n').repeat(Math.ceil((1024 * 1024 + 10) / (secret.length + 1))));
  const r = cover(d);
  assert.equal(r.code, 1, r.all);
  assert.ok(lines(r.all).some((l) => /^cover: error \S/.test(l)), r.all);
  assert.ok(!r.all.includes(secret), 'reason must not repeat list content');
});

test('cover: a list of exactly 1 MiB is still read', () => {
  const d = mkdir();
  const head = ALL.join('\n') + '\n';
  // pad with blank lines up to exactly 1 MiB
  fs.writeFileSync(path.join(d, 'edge.txt'), head + '\n'.repeat(1024 * 1024 - head.length));
  assert.equal(fs.statSync(path.join(d, 'edge.txt')).size, 1024 * 1024);
  const r = cover(d);
  assert.equal(r.code, 0, r.all);
});

test('cover: runs no tests (fixtures never execute)', () => {
  const d = mkdir();
  list(d, 'a.txt', ALL);
  const r = cover(d);
  assert.equal(r.code, 0, r.all);
  // the failing fixture would make node exit non-zero and print TAP/spec output
  assert.ok(!/^# (tests|pass|fail)/m.test(r.all), r.all);
  assert.ok(!/✖|✔|TAP version/.test(r.all), r.all);
});

test('cover: --aico-cover= never reaches node (planRun)', async () => {
  const mod = await import(pathToFileURL(RUNNER).href);
  assert.equal(typeof mod.planRun, 'function', 'planRun is exported');
  const plan = mod.planRun([`--aico-cover=/tmp/some dir`, GLOB]);
  assert.equal(plan.refuse, undefined);
  assert.equal(plan.coverDir, '/tmp/some dir');
  assert.ok(Array.isArray(plan.argv));
  assert.ok(!plan.argv.some((a) => String(a).includes('--aico-cover')), 'flag stripped from argv');
  assert.ok(plan.argv.includes(GLOB), 'patterns kept');
});

test('cover: planRun without the flag gives coverDir null', async () => {
  const mod = await import(pathToFileURL(RUNNER).href);
  assert.equal(typeof mod.planRun, 'function', 'planRun is exported');
  const plan = mod.planRun([GLOB]);
  assert.equal(plan.coverDir, null);
});
