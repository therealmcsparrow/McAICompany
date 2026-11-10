import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

// Progress lines of `rule-check run` on stderr: start, one line per check, heartbeat, end. Stdout and exit code stay as before.

const script = path.join(import.meta.dirname, 'rule-check.mjs');
const SLUG = 'prog';
const MiB = 1024 * 1024;
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

const made = [];
function tmp(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  made.push(dir);
  return dir;
}
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// Environment minus the test-runner context and any inherited GIT_ keys; the home dirs are per call.
function env(extra = {}) {
  const home = tmp('rcp-home-');
  const e = {};
  for (const [k, v] of Object.entries(process.env)) if (k !== 'NODE_TEST_CONTEXT' && !/^GIT_/i.test(k) && !/^AICO_PROGRESS/.test(k)) e[k] = v;
  return { ...e, HOME: home, USERPROFILE: home, MCSPARROW_HOME: path.join(home, 'mh'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, 'none'), ...extra };
}

function git(root, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.test', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', env: env() });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

const RULES = {
  'proj.M5': 'Agent files are short',
  'proj.S1': 'Built-ins only',
  'proj.M-SEC1': 'Input is data'
};

const standards = () => `library: ~/lib\nsigned-off: 2026-10-26 (architect)\n## Packs\n## Project rules\n${Object.entries(RULES).map(([id, text]) => `- ${id} — ${text} — source: https://x.test`).join('\n')}\n## Exceptions\n## Debt\n`;
const bind = (rule, argv, text = sha256(RULES[rule])) => ({ rule, text, argv });
const SLEEP = 'setTimeout(() => {}, 1000)';
const FAIL = 'process.exit(1)';
const SECRET = 'SECRET-ARG-9f3a';

// Two argv checks: "slow" sleeps one second and passes, "bad" exits 1 and yields one row.
function twoChecks() {
  return {
    version: 1,
    checks: {
      slow: bind('proj.S1', [process.execPath, '-e', `${SLEEP} /* ${SECRET} */`]),
      bad: bind('proj.M5', [process.execPath, '-e', FAIL])
    }
  };
}

function makeRepo({ checks, standardsText = standards() }) {
  const root = tmp('rcp-root-');
  if (standardsText !== null) write(root, '.company/standards.md', standardsText);
  if (checks !== null) write(root, '.company/checks.json', typeof checks === 'string' ? checks : JSON.stringify(checks));
  write(root, 'seed.txt', 'seed\n');
  git(root, 'init', '-q', '-b', `aico/${SLUG}`);
  git(root, 'add', '-A', '-f');
  git(root, 'commit', '-q', '-m', 'seed');
  const base = git(root, 'rev-parse', 'HEAD');
  git(root, 'commit', '-q', '-m', 'tip', '--allow-empty');
  return { root, base };
}

const runArgs = (r, command = 'run') => [command, '--base', r.base, '--run', SLUG, '--root', r.root];

// Runs the CLI, stamping each stderr line with its arrival time (ms since spawn).
function runCli(r, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [script, ...args], { cwd: r.root, env: env(extraEnv), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    const lines = [];
    let partial = '';
    child.stdout.setEncoding('utf8').on('data', d => { out += d; });
    child.stderr.setEncoding('utf8').on('data', d => {
      err += d;
      partial += d;
      const parts = partial.split('\n');
      partial = parts.pop();
      for (const text of parts) lines.push({ text, at: Date.now() - t0 });
    });
    child.on('error', reject);
    child.on('close', code => {
      if (partial) lines.push({ text: partial, at: Date.now() - t0 });
      resolve({ status: code, out, err, lines, ms: Date.now() - t0 });
    });
  });
}

// What the same run printed on stdout before progress existed: the library call, which stays silent.
function libraryRun(r, args) {
  const code = `import { main } from ${JSON.stringify(new URL(`file:///${script.replace(/\\/g, '/')}`).href)};\nconst { code, lines } = main(JSON.parse(process.argv[1]));\nprocess.stdout.write(JSON.stringify({ code, lines }));\n`;
  const c = spawnSync(process.execPath, ['--input-type=module', '-e', code, JSON.stringify(args)], { cwd: r.root, encoding: 'utf8', env: env(), maxBuffer: 64 * MiB });
  assert.equal(c.status, 0, c.stderr);
  return { stderr: c.stderr, ...JSON.parse(c.stdout) };
}

const HEARTBEAT = { AICO_PROGRESS_HEARTBEAT_MS: '200' };
const texts = lines => lines.map(l => l.text);

test('AC1: the first stderr line names the command and the check count', async () => {
  const r = makeRepo({ checks: twoChecks() });
  const res = await runCli(r, runArgs(r), HEARTBEAT);
  assert.equal(res.status, 0, res.err);
  assert.match(res.lines[0].text, /^aico rule-check: start, 2 \w+$/, res.err);
});

test('AC2: one line per finished check shows n/total, in order', async () => {
  const r = makeRepo({ checks: twoChecks() });
  const res = await runCli(r, runArgs(r), HEARTBEAT);
  const t = texts(res.lines);
  const first = t.findIndex(l => /\b1\/2\b/.test(l));
  const second = t.findIndex(l => /\b2\/2\b/.test(l));
  assert.ok(first > 0, res.err);
  assert.ok(second > first, res.err);
  assert.ok(t[first].includes('slow'), t[first]);
  assert.ok(t[second].includes('bad'), t[second]);
});

test('AC2: a check running past the heartbeat interval gets a line with its id and elapsed seconds', async () => {
  const r = makeRepo({ checks: twoChecks() });
  const res = await runCli(r, runArgs(r), HEARTBEAT);
  const t = texts(res.lines);
  const done = t.findIndex(l => /\b1\/2\b/.test(l));
  assert.ok(done > 0, res.err);
  const beats = res.lines.slice(1, done).filter(l => l.text.includes('slow') && /\d+(?:\.\d+)?\s?s\b/.test(l.text));
  assert.ok(beats.length >= 1, `no heartbeat before the first check finished:\n${res.err}`);
  assert.ok(beats[0].at >= 150, `heartbeat at ${beats[0].at} ms is earlier than the interval`);
  assert.ok(beats.length <= 6, `heartbeat flood: ${beats.length} lines`);
  assert.ok(res.lines[done].at - res.lines[0].at >= 800, 'the slow check ran about one second');
});

test('AC2: with no interval override a quick run prints no heartbeat', async () => {
  const checks = { version: 1, checks: { fast: bind('proj.S1', [process.execPath, '-e', 'process.exit(0)']) } };
  const r = makeRepo({ checks });
  const res = await runCli(r, runArgs(r));
  assert.equal(res.lines.length, 3, res.err);
});

test('AC3: the last stderr line gives pass and fail counts and elapsed seconds; nothing follows it', async () => {
  const r = makeRepo({ checks: twoChecks() });
  const res = await runCli(r, runArgs(r), HEARTBEAT);
  const last = res.lines.at(-1).text;
  assert.match(last, /^aico rule-check: /, last);
  assert.match(last, /\b1 ok/, last);
  assert.match(last, /\b1 fail/, last);
  assert.match(last, /\d+(?:\.\d+)? ?s\b/, last);
  assert.ok(res.err.endsWith('\n'));
  assert.ok(res.ms - res.lines.at(-1).at < 5000);
});

test('AC3: a binding whose rule text changed counts as a fail', async () => {
  const checks = {
    version: 1,
    checks: {
      stale: bind('proj.M5', [process.execPath, '-e', 'process.exit(0)'], sha256('an older wording')),
      fine: bind('proj.S1', [process.execPath, '-e', 'process.exit(0)'])
    }
  };
  const r = makeRepo({ checks });
  const res = await runCli(r, runArgs(r), HEARTBEAT);
  assert.match(res.lines[0].text, /start, 2 \w+/, res.err);
  const last = res.lines.at(-1).text;
  assert.match(last, /\b1 ok/, last);
  assert.match(last, /\b1 fail/, last);
});

test('AC4: stdout bytes and exit code equal the silent library run on the same input', async () => {
  const r = makeRepo({ checks: twoChecks() });
  const res = await runCli(r, runArgs(r), HEARTBEAT);
  const lib = libraryRun(r, runArgs(r));
  assert.equal(res.status, lib.code);
  assert.equal(res.status, 0);
  assert.equal(res.out, `${lib.lines.join('\n')}\n`);
  const rows = res.out.split('\n').filter(Boolean);
  assert.equal(rows.length, 1, res.out);
  assert.match(rows[0], /^T-1 \| - \| bad exited 1: /);
});

test('AC4: main() called without progress writes nothing to stderr', () => {
  const r = makeRepo({ checks: twoChecks() });
  const lib = libraryRun(r, runArgs(r));
  assert.equal(lib.stderr, '');
  assert.equal(lib.code, 0);
});

test('AC4: a refusal keeps its stdout line, exit code and an empty stderr', async () => {
  const r = makeRepo({ checks: twoChecks() });
  const res = await runCli(r, ['run', '--base', 'zzz', '--run', SLUG, '--root', r.root]);
  assert.equal(res.out, 'refused: bad base\n');
  assert.equal(res.status, 3);
  assert.equal(res.err, '');
});

test('AC5: early returns and the other commands print nothing on stderr', async () => {
  const cases = [
    ['no ruleset', makeRepo({ checks: null, standardsText: null }), 'run'],
    ['no checks bound', makeRepo({ checks: null }), 'run'],
    ['config invalid', makeRepo({ checks: '{ not json' }), 'run'],
    ['list', makeRepo({ checks: twoChecks() }), 'list'],
    ['drift', makeRepo({ checks: twoChecks() }), 'drift'],
    ['slices', makeRepo({ checks: twoChecks() }), 'slices'],
    ['text', makeRepo({ checks: twoChecks() }), 'text'],
    ['fill-security', makeRepo({ checks: twoChecks() }), 'fill-security']
  ];
  for (const [name, r, command] of cases) {
    const res = await runCli(r, runArgs(r, command), HEARTBEAT);
    assert.equal(res.err, '', `${name}: ${res.err}`);
  }
});

test('AC5: a config error keeps exit 2 on stdout and prints no progress line', async () => {
  const r = makeRepo({ checks: { version: 2, checks: {} } });
  const res = await runCli(r, runArgs(r));
  assert.match(res.out, /tool config invalid: version must be 1/);
  assert.equal(res.err, '');
  assert.equal(res.status, 2);
});

test('AC6/AC7: progress is plain lines with no control characters and never echoes argv, rule text or a raw hostile id', async () => {
  const r = makeRepo({ checks: twoChecks() });
  const res = await runCli(r, runArgs(r), HEARTBEAT);
  assert.ok(res.err.length > 0);
  assert.doesNotMatch(res.err, /[\u0000-\u0009\u000b-\u001f\u007f\u0080-\u009f‪-‮⁦-⁩]/);
  assert.ok(!res.err.includes(SECRET), 'argv text leaked');
  for (const text of Object.values(RULES)) assert.ok(!res.err.includes(text), `rule text leaked: ${text}`);
  for (const l of res.lines) {
    assert.doesNotMatch(l.text, /^(?:not ok|✖)/, l.text);
    assert.ok(l.text.startsWith('aico rule-check:'), l.text);
  }
});

test('AC7: a hostile check id is refused as config and appears in no progress line', async () => {
  const checks = `{"version":1,"checks":{"evil\\u202e\\nfake-line":${JSON.stringify(bind('proj.S1', [process.execPath, '-e', 'process.exit(0)']))}}}`;
  const r = makeRepo({ checks });
  const res = await runCli(r, runArgs(r), HEARTBEAT);
  assert.match(res.out, /tool config invalid: bad check id/);
  assert.equal(res.status, 2);
  assert.doesNotMatch(res.err, /[‮⁦-⁩]|fake-line|evil/);
  assert.doesNotMatch(res.out, /[‮]|fake-line/);
});
