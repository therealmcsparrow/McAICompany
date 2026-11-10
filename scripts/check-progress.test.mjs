import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as checkMod from './check.mjs';

const { check } = checkMod;
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check.mjs');
const phases = () => checkMod.CHECK_PHASES;

const tempDirs = [];
after(() => { for (const d of tempDirs) rmSync(d, { recursive: true, force: true }); });

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'check-progress-'));
  tempDirs.push(root);
  return root;
}

const skillText = (name, extra = '') => `---\nname: ${name}\ndescription: A fixture skill.\n---\n${extra}`;

// Root with one valid skill: no error, no warning.
function cleanRoot() {
  const root = tempRoot();
  mkdirSync(join(root, 'skills', 'alpha'), { recursive: true });
  writeFileSync(join(root, 'skills', 'alpha', 'SKILL.md'), skillText('alpha', 'body\n'));
  return root;
}

// Root whose only finding is a size warning.
function warnRoot() {
  const root = tempRoot();
  mkdirSync(join(root, 'skills', 'alpha'), { recursive: true });
  writeFileSync(join(root, 'skills', 'alpha', 'SKILL.md'), skillText('alpha', 'line\n'.repeat(200)));
  return root;
}

// Root with an ERROR (skill without frontmatter) and a hostile description in a second skill.
function errorRoot() {
  const root = tempRoot();
  mkdirSync(join(root, 'skills', 'alpha'), { recursive: true });
  writeFileSync(join(root, 'skills', 'alpha', 'SKILL.md'), 'no frontmatter here\n');
  mkdirSync(join(root, 'skills', 'beta'), { recursive: true });
  writeFileSync(join(root, 'skills', 'beta', 'SKILL.md'), `---\nname: beta\ndescription: evil \u202e\u001b[31m \u200b text\n---\nbody\n`);
  return root;
}

function cli(args, root) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.AICO_PROGRESS_HEARTBEAT_MS;
  const home = tempRoot();
  env.MCSPARROW_HOME = join(home, 'mcsparrow');
  env.HOME = home;
  env.USERPROFILE = home;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env, cwd: root, timeout: 120000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function stdoutOf(root) {
  const { errors, warnings, notes } = check(root);
  return [...errors, ...warnings, ...notes, `${errors.length} error(s), ${warnings.length} warning(s)`].join('\n') + '\n';
}

const lines = s => (s === '' ? [] : s.replace(/\n$/, '').split('\n'));
const ITEM_RE = /^aico check: (\d+)\/(\d+) (.+) (ok|fail) \d+\.\d s$/;
const END_RE = /^aico check: end, (\d+) pass, (\d+) fail, \d+\.\d s$/;

function recorder(t) {
  const calls = [];
  const tracker = {
    start: () => calls.push(['start']),
    begin: item => calls.push(['begin', item]),
    done: (item, ok) => calls.push(['done', item, ok]),
    end: () => calls.push(['end'])
  };
  const factory = t.mock.fn(() => tracker);
  return { calls, factory };
}

test('CHECK_PHASES is a non-empty list of unique plain phase names (AC1)', () => {
  const list = phases();
  assert.ok(Array.isArray(list) && list.length > 0, 'CHECK_PHASES must be a non-empty array');
  assert.equal(new Set(list).size, list.length);
  for (const p of list) assert.match(p, /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,59}$/);
});

test('check without progress prints nothing on stderr or stdout (AC1)', () => {
  const root = cleanRoot();
  const code = `import { check } from ${JSON.stringify(new URL('./check.mjs', import.meta.url).href)}; check(process.argv[1]);`;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code, root], { encoding: 'utf8', env, timeout: 120000 });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, '');
});

test('check with a progress factory calls it once with the phase count (AC1)', t => {
  const { calls, factory } = recorder(t);
  check(cleanRoot(), { progress: factory });
  assert.equal(factory.mock.callCount(), 1);
  assert.deepEqual(factory.mock.calls[0].arguments, [phases().length]);
  assert.deepEqual(calls[0], ['start']);
});

test('check reports one done per phase, in CHECK_PHASES order (AC2)', t => {
  const { calls, factory } = recorder(t);
  check(cleanRoot(), { progress: factory });
  const done = calls.filter(c => c[0] === 'done');
  assert.deepEqual(done.map(c => c[1]), phases());
  for (const c of done) assert.equal(typeof c[2], 'boolean');
  const begun = calls.filter(c => c[0] === 'begin').map(c => c[1]);
  if (begun.length) assert.deepEqual(begun, phases());
  const last = calls.at(-1);
  if (calls.some(c => c[0] === 'end')) assert.deepEqual(last, ['end']);
  assert.ok(calls.indexOf(calls.find(c => c[0] === 'done')) > 0, 'start comes before the first done');
});

test('a phase that adds an ERROR is reported as fail (AC2)', t => {
  const { calls, factory } = recorder(t);
  const result = check(errorRoot(), { progress: factory });
  assert.ok(result.errors.length > 0);
  const failed = calls.filter(c => c[0] === 'done' && c[2] === false);
  assert.ok(failed.length >= 1, 'at least one phase must be fail');
  assert.ok(calls.filter(c => c[0] === 'done' && c[2] === true).length >= 1, 'phases without an ERROR stay ok');
});

test('warnings alone never make a phase fail (AC2)', t => {
  const { calls, factory } = recorder(t);
  const result = check(warnRoot(), { progress: factory });
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.length > 0);
  const done = calls.filter(c => c[0] === 'done');
  assert.equal(done.length, phases().length);
  assert.ok(done.every(c => c[2] === true));
});

test('the check result is the same with and without progress (AC4)', t => {
  for (const make of [cleanRoot, warnRoot, errorRoot]) {
    const root = make();
    const { factory } = recorder(t);
    assert.deepEqual(check(root, { progress: factory }), check(root));
  }
});

test('CLI on a clean root: start, one line per phase, end; stdout and exit code pinned (AC1-AC4)', () => {
  const root = cleanRoot();
  const r = cli([root], root);
  const err = lines(r.stderr);
  const n = phases().length;
  assert.equal(err[0], `aico check: start, ${n} phases`);
  const items = err.slice(1, -1);
  assert.equal(items.length, n);
  items.forEach((l, i) => {
    const m = ITEM_RE.exec(l);
    assert.ok(m, `item line ${i + 1} malformed: ${JSON.stringify(l)}`);
    assert.equal(Number(m[1]), i + 1);
    assert.equal(Number(m[2]), n);
    assert.equal(m[3], phases()[i]);
    assert.equal(m[4], 'ok');
  });
  const end = END_RE.exec(err.at(-1));
  assert.ok(end, `end line malformed: ${JSON.stringify(err.at(-1))}`);
  assert.deepEqual([Number(end[1]), Number(end[2])], [n, 0]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, stdoutOf(root));
  assert.match(r.stdout, /0 error\(s\), 0 warning\(s\)\n$/);
});

test('CLI on a root with an ERROR: fail lines, end counts add up, exit 1, stdout pinned (AC2-AC4)', () => {
  const root = errorRoot();
  const r = cli([root], root);
  const err = lines(r.stderr);
  const n = phases().length;
  assert.equal(err[0], `aico check: start, ${n} phases`);
  const items = err.slice(1, -1).map(l => ITEM_RE.exec(l));
  assert.equal(items.length, n);
  assert.ok(items.every(Boolean), 'every middle line is a phase line');
  const failLines = items.filter(m => m[4] === 'fail').length;
  assert.ok(failLines >= 1);
  const end = END_RE.exec(err.at(-1));
  assert.ok(end, `end line malformed: ${JSON.stringify(err.at(-1))}`);
  assert.deepEqual([Number(end[1]), Number(end[2])], [n - failLines, failLines]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, stdoutOf(root));
  assert.match(r.stdout, /\n[1-9]\d* error\(s\), \d+ warning\(s\)\n$/);
});

test('CLI on a warnings-only root: no fail line, exit 0 (AC2, AC3)', () => {
  const root = warnRoot();
  const r = cli([root], root);
  const err = lines(r.stderr);
  assert.ok(err.slice(1, -1).every(l => ITEM_RE.exec(l)?.[4] === 'ok'));
  assert.equal(END_RE.exec(err.at(-1))?.[2], '0');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, stdoutOf(root));
});

test('CLI stderr carries no file text and no control characters (AC1, hostile input)', () => {
  const root = errorRoot();
  const r = cli([root], root);
  assert.doesNotMatch(r.stderr.replaceAll('\n', ''), /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u3164]/u);
  assert.doesNotMatch(r.stderr, /evil|beta|alpha|no frontmatter/);
  assert.equal(r.stderr.includes('\r'), false);
  assert.ok(r.stderr.endsWith('\n'));
});

test('stdout has no progress line (AC4)', () => {
  const root = cleanRoot();
  assert.doesNotMatch(cli([root], root).stdout, /^aico check:/m);
});

test('--drift prints no progress line and keeps its stdout shape (AC5)', () => {
  const root = tempRoot();
  const r = cli(['--drift', root], root);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /\n?\d+ error\(s\)\n$/);
  assert.doesNotMatch(r.stdout, /aico check:/);
  assert.equal(r.status, r.stdout.endsWith('\n0 error(s)\n') || r.stdout === '0 error(s)\n' ? 0 : 1);
});

test('--drift usage error keeps its single stderr line and exit 2 (AC5)', () => {
  const root = tempRoot();
  const r = cli(['--drift', root, 'extra'], root);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, 'usage: check.mjs --drift [repo root]\n');
  assert.equal(r.stdout, '');
});

test('--packs prints no progress line on a folder and keeps its usage line (AC5)', () => {
  const dir = tempRoot();
  const ok = cli(['--packs', dir], dir);
  assert.equal(ok.status, 0);
  assert.equal(ok.stderr, '');
  assert.equal(ok.stdout, '0 error(s)\n');
  const bad = cli(['--packs'], dir);
  assert.equal(bad.status, 2);
  assert.equal(bad.stderr, 'usage: check.mjs --packs <library folder>\n');
  assert.equal(bad.stdout, '');
});
