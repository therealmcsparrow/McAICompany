import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const progressUrl = pathToFileURL(path.join(here, 'progress.mjs')).href;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// The probe runs one scripted scenario against createProgress in a child, so the
// real stderr and stdout of the process can be captured. The "block" op parks the
// main thread in spawnSync, as the long synchronous commands do.
const probePath = path.join(tmp, 'probe.mjs');
fs.writeFileSync(probePath, [
  `import { createProgress } from ${JSON.stringify(progressUrl)};`,
  "import { spawnSync } from 'node:child_process';",
  'const cfg = JSON.parse(process.argv[2]);',
  'const p = createProgress({ command: cfg.command, total: cfg.total, unit: cfg.unit });',
  'for (const s of cfg.ops) {',
  "  if (s.op === 'start') p.start();",
  "  else if (s.op === 'begin') p.begin(s.item);",
  "  else if (s.op === 'done') p.done(s.item, s.ok);",
  "  else if (s.op === 'end') p.end();",
  "  else if (s.op === 'block') spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, ' + s.ms + ')']);",
  '}',
  ''
].join('\n'));

const home = path.join(tmp, 'home');
fs.mkdirSync(home);

function probeEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  delete env.AICO_PROGRESS_HEARTBEAT_MS;
  Object.assign(env, extra);
  env.MCSPARROW_HOME = home;
  env.HOME = home;
  env.USERPROFILE = home;
  return env;
}

function run(cfg, extraEnv = {}, timeoutMs = 20000) {
  const full = { command: 'aico check', total: 3, unit: 'phases', ...cfg };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [probePath, JSON.stringify(full)], {
      env: probeEnv(extraEnv),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut, lines: stderr.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')) });
    });
  });
}

const DONE_RE = /\b(\d+)\/(\d+)\b/;

test('start line names the command and the item count, first on stderr', async () => {
  const r = await run({ ops: [{ op: 'start' }, { op: 'end' }] });
  assert.equal(r.status, 0);
  assert.equal(r.lines[0], 'aico check: start, 3 phases');
});

test('every finished item prints one n/total line with its name and verdict, in order', async () => {
  const r = await run({
    ops: [
      { op: 'start' },
      { op: 'begin', item: 'alpha' }, { op: 'done', item: 'alpha', ok: true },
      { op: 'begin', item: 'beta' }, { op: 'done', item: 'beta', ok: false },
      { op: 'begin', item: 'gamma' }, { op: 'done', item: 'gamma', ok: true },
      { op: 'end' }
    ]
  });
  const doneLines = r.lines.filter((l) => DONE_RE.test(l));
  assert.equal(doneLines.length, 3);
  assert.equal(doneLines[0], 'aico check: 1/3 alpha ok');
  assert.equal(doneLines[1], 'aico check: 2/3 beta fail');
  assert.equal(doneLines[2], 'aico check: 3/3 gamma ok');
});

test('done works without a begin', async () => {
  const r = await run({ ops: [{ op: 'start' }, { op: 'done', item: 'solo', ok: true }, { op: 'end' }] });
  assert.ok(r.lines.includes('aico check: 1/3 solo ok'), r.stderr);
});

test('end line is last and carries pass count, fail count and elapsed seconds', async () => {
  const r = await run({
    ops: [
      { op: 'start' },
      { op: 'done', item: 'a', ok: true },
      { op: 'done', item: 'b', ok: false },
      { op: 'done', item: 'c', ok: true },
      { op: 'block', ms: 1100 },
      { op: 'end' }
    ]
  });
  const last = r.lines[r.lines.length - 1];
  const m = /^aico check: end, 2 ok, 1 fail, (\d+(?:\.\d+)?)s$/.exec(last);
  assert.ok(m, `end line was: ${last}`);
  const secs = Number(m[1]);
  assert.ok(secs >= 1 && secs < 30, `elapsed ${secs}`);
});

test('stdout stays empty and the exit code is 0', async () => {
  const r = await run({
    ops: [{ op: 'start' }, { op: 'begin', item: 'x' }, { op: 'done', item: 'x', ok: false }, { op: 'end' }]
  });
  assert.equal(r.stdout, '');
  assert.equal(r.status, 0);
});

test('no line is printed after end, even with a running item and a short heartbeat', async () => {
  const r = await run({
    ops: [{ op: 'start' }, { op: 'begin', item: 'busy' }, { op: 'end' }, { op: 'block', ms: 500 }]
  }, { AICO_PROGRESS_HEARTBEAT_MS: '50' });
  assert.match(r.lines[r.lines.length - 1], /^aico check: end, /);
  assert.equal(r.lines.filter((l) => /: end, /.test(l)).length, 1);
  assert.equal(r.lines.length, 2, r.stderr);
});

test('heartbeat fires while the main thread is blocked in spawnSync, naming the item and elapsed time', async () => {
  const r = await run({
    ops: [
      { op: 'start' },
      { op: 'begin', item: 'slow-item' },
      { op: 'block', ms: 700 },
      { op: 'done', item: 'slow-item', ok: true },
      { op: 'end' }
    ]
  }, { AICO_PROGRESS_HEARTBEAT_MS: '100' });
  const doneIdx = r.lines.findIndex((l) => DONE_RE.test(l));
  assert.ok(doneIdx > 1, `expected a line between start and done:\n${r.stderr}`);
  const beats = r.lines.slice(1, doneIdx);
  assert.ok(beats.length >= 1 && beats.length <= 9, `beats: ${beats.length}`);
  for (const b of beats) {
    assert.match(b, /^aico check: /);
    assert.ok(b.includes('slow-item'), b);
    assert.match(b, /\d+(?:\.\d+)?s\b/);
  }
  assert.match(r.lines[r.lines.length - 1], /^aico check: end, /);
});

test('no heartbeat while the helper has printed a line within the interval', async () => {
  const r = await run({
    ops: [{ op: 'start' }, { op: 'begin', item: 'quick' }, { op: 'done', item: 'quick', ok: true }, { op: 'end' }]
  }, { AICO_PROGRESS_HEARTBEAT_MS: '60000' });
  assert.equal(r.lines.length, 3, r.stderr);
});

test('a worker left running does not keep the process alive', async () => {
  const r = await run({ ops: [{ op: 'start' }, { op: 'begin', item: 'never-ends' }] },
    { AICO_PROGRESS_HEARTBEAT_MS: '50' }, 8000);
  assert.equal(r.timedOut, false);
  assert.equal(r.status, 0);
});

const badBeatValues = ['abc', '0', '1e3', '99999999', '-5', '49', '60001', '', '1.5', ' 100'];
for (const value of badBeatValues) {
  test(`heartbeat interval ${JSON.stringify(value)} falls back to the 10 s default`, async () => {
    const r = await run({
      ops: [{ op: 'start' }, { op: 'begin', item: 'idle' }, { op: 'block', ms: 450 }, { op: 'end' }]
    }, { AICO_PROGRESS_HEARTBEAT_MS: value });
    assert.equal(r.status, 0);
    assert.equal(r.lines.length, 2, r.stderr);
  });
}

test('the lowest allowed heartbeat interval (50) is honoured', async () => {
  const r = await run({
    ops: [{ op: 'start' }, { op: 'begin', item: 'idle' }, { op: 'block', ms: 600 }, { op: 'end' }]
  }, { AICO_PROGRESS_HEARTBEAT_MS: '50' });
  assert.equal(r.lines[0], 'aico check: start, 3 phases');
  assert.ok(r.lines.length > 2, r.stderr);
  assert.ok(r.lines.slice(1, -1).every((l) => l.includes('idle')), r.stderr);
});

const hostile = [
  ['U+202E bidi override', '‮'],
  ['U+200B zero width space', '​'],
  ['U+2028 line separator', ' '],
  ['U+2029 paragraph separator', ' '],
  ['U+3164 hangul filler', 'ㅤ'],
  ['U+180E mongolian vowel separator', '᠎'],
  ['U+2065 unassigned default ignorable', '⁥'],
  ['U+E0041 tag character', '\u{E0041}'],
  ['U+0000 NUL', '\u0000'],
  ['U+0085 next line', '\u0085'],
  ['CR', '\r'],
  ['LF', '\n'],
  ['ESC', '\u001B'],
  ['DEL', '\u007F']
];
for (const [label, ch] of hostile) {
  test(`item with ${label} prints as ? and cannot forge or alter a line`, async () => {
    const item = `p${ch}s`;
    const r = await run({
      ops: [{ op: 'start' }, { op: 'begin', item }, { op: 'done', item, ok: true }, { op: 'end' }]
    });
    assert.equal(r.status, 0);
    assert.equal(r.lines.length, 3, JSON.stringify(r.stderr));
    assert.equal(r.lines[1], 'aico check: 1/3 p?s ok');
    for (const l of r.lines) assert.match(l, /^[\x20-\x7E]+$/);
  });
}

test('item longer than 120 characters is cut to 120', async () => {
  const item = 'x'.repeat(500);
  const r = await run({ ops: [{ op: 'start' }, { op: 'done', item, ok: true }, { op: 'end' }] });
  const line = r.lines[1];
  assert.ok(line.includes('x'.repeat(120)), line);
  assert.ok(!line.includes('x'.repeat(121)), line);
  assert.ok(line.length < 200, `line length ${line.length}`);
});

test('a hostile long path is both replaced and cut', async () => {
  const item = `dir‮/${'y​'.repeat(250)}`;
  const r = await run({ ops: [{ op: 'start' }, { op: 'done', item, ok: false }, { op: 'end' }] });
  assert.equal(r.lines.length, 3, JSON.stringify(r.stderr));
  assert.match(r.lines[1], /^[\x20-\x7E]+$/);
  assert.ok(r.lines[1].includes('dir?/'), r.lines[1]);
  assert.ok(r.lines[1].length < 200);
});

test('heartbeat lines sanitize the running item name too', async () => {
  const item = 'a‮b\u001B[31m\r\nc';
  const r = await run({
    ops: [{ op: 'start' }, { op: 'begin', item }, { op: 'block', ms: 500 }, { op: 'end' }]
  }, { AICO_PROGRESS_HEARTBEAT_MS: '100' });
  assert.ok(r.lines.length > 2, r.stderr);
  for (const l of r.lines) assert.match(l, /^[\x20-\x7E]+$/);
});

test('no progress line starts with "not ok" or the failure mark', async () => {
  const r = await run({
    ops: [
      { op: 'start' },
      { op: 'begin', item: 'not ok 1 - x' }, { op: 'done', item: 'not ok 1 - x', ok: false },
      { op: 'begin', item: '✖ y' }, { op: 'done', item: '✖ y', ok: false },
      { op: 'end' }
    ]
  });
  assert.equal(r.lines.length, 4, r.stderr);
  assert.equal(r.lines[0], 'aico check: start, 3 phases');
  for (const l of r.lines) {
    assert.ok(!l.startsWith('not ok'), l);
    assert.ok(!l.startsWith('✖'), l);
  }
});

test('plain output: only printable ASCII and newline, no carriage return or escape', async () => {
  const r = await run({
    ops: [
      { op: 'start' },
      { op: 'begin', item: 'f1' }, { op: 'block', ms: 300 }, { op: 'done', item: 'f1', ok: true },
      { op: 'end' }
    ]
  }, { AICO_PROGRESS_HEARTBEAT_MS: '100' });
  assert.ok(!/[\x00-\x09\x0B-\x1F\x7F]/.test(r.stderr), JSON.stringify(r.stderr));
  assert.ok(r.stderr.endsWith('\n'));
});
