import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { contextHandover, measure, start } from './lead-handover.mjs';

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const HANDOVER = pathToFileURL(path.join(import.meta.dirname, 'lead-handover.mjs')).href;

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-race-'));
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const dir = path.join(root, '.company', 'work', 'demo-run');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'projects', 'p1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now() - 60000), ev: 'start' })}\n`);
  return { base, root, claudeDir, dir, file: path.join(dir, 'lead-context.json'), lock: path.join(dir, 'lead-context.lock') };
}

function transcript(fx, total, name = 'session.jsonl') {
  const file = path.join(fx.claudeDir, 'projects', 'p1', name);
  const usage = { input_tokens: 1000, cache_read_input_tokens: total - 1500, output_tokens: 500 };
  const row = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage } };
  fs.writeFileSync(file, `${JSON.stringify(row)}\n`);
  return file;
}

const stopBody = (file) => JSON.stringify({ hook_event_name: 'Stop', transcript_path: file });
const startBody = JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'sess-b' });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const reading = (fx) => JSON.parse(fs.readFileSync(fx.file, 'utf8'));
const optsOf = (fx) => ({ root: fx.root, claudeDir: fx.claudeDir, env: {} });

// Starts a second writer in its own process, so it really runs while this process holds the reading lock.
function otherWriter(fx, total) {
  const marker = path.join(fx.base, 'ready');
  const script = path.join(fx.base, 'other.mjs');
  const body = stopBody(transcript(fx, total, 'other.jsonl'));
  fs.writeFileSync(script, [
    "import fs from 'node:fs';",
    `import { measure } from ${JSON.stringify(HANDOVER)};`,
    'const [root, claudeDir, marker, body] = process.argv.slice(2);',
    "fs.writeFileSync(marker, 'x');",
    'measure(body, { root, claudeDir, env: {} });',
    '',
  ].join('\n'));
  const child = spawn(process.execPath, [script, fx.root, fx.claudeDir, marker, body], { stdio: 'ignore' });
  const done = new Promise((resolve) => child.on('exit', resolve));
  return { marker, done };
}

// Runs the second writer in the gap between the outer writer's read and its rename. The outer writer stays in the gap
// until the second writer is about to write, then a little longer.
async function interleave(fx, total, outer) {
  const real = fs.renameSync;
  let other = null;
  fs.renameSync = function patched(from, ...rest) {
    if (!other && typeof from === 'string' && path.basename(from).startsWith('.lead-context.json.')) {
      other = otherWriter(fx, total);
      for (let i = 0; i < 500 && !fs.existsSync(other.marker); i++) sleep(20);
      sleep(120);
    }
    return real.call(this, from, ...rest);
  };
  try { outer(); } finally { fs.renameSync = real; }
  assert.ok(other, 'the outer writer reached its rename');
  assert.ok(fs.existsSync(other.marker), 'the second writer started');
  await other.done;
}

test('a measure running in another process while start holds the lock keeps the newer peak', async () => {
  const fx = fixture();
  try {
    const opts = optsOf(fx);
    measure(stopBody(transcript(fx, 10000)), opts);
    await interleave(fx, 70000, () => start(startBody, opts));
    assert.equal(reading(fx).peak, 70000);
    assert.equal(fs.existsSync(fx.lock), false);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('a measure running in another process while a measure holds the lock keeps the newer peak', async () => {
  const fx = fixture();
  try {
    const opts = optsOf(fx);
    measure(stopBody(transcript(fx, 10000)), opts);
    await interleave(fx, 70000, () => measure(stopBody(transcript(fx, 30000)), opts));
    assert.equal(reading(fx).peak, 70000);
    assert.equal(fs.existsSync(fx.lock), false);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('a held lock that is released during the wait lets the write land', () => {
  const fx = fixture();
  const realWait = Atomics.wait;
  try {
    const opts = optsOf(fx);
    fs.writeFileSync(fx.lock, '');
    let waits = 0;
    Atomics.wait = function patched(...args) {
      waits += 1;
      try { fs.unlinkSync(fx.lock); } catch { /* already gone */ }
      return realWait.apply(this, args);
    };
    measure(stopBody(transcript(fx, 40000)), opts);
    Atomics.wait = realWait;
    assert.ok(waits >= 1, 'the writer waited for the lock');
    assert.equal(reading(fx).peak, 40000);
    assert.equal(fs.existsSync(fx.lock), false);
  } finally { Atomics.wait = realWait; fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('measure skips its write when the lock stays held, and leaves that lock alone', () => {
  const fx = fixture();
  try {
    const opts = optsOf(fx);
    measure(stopBody(transcript(fx, 10000)), opts);
    const before = fs.readFileSync(fx.file, 'utf8');
    fs.writeFileSync(fx.lock, '');
    const t0 = Date.now();
    measure(stopBody(transcript(fx, 70000)), opts);
    const took = Date.now() - t0;
    assert.equal(fs.readFileSync(fx.file, 'utf8'), before);
    assert.equal(fs.existsSync(fx.lock), true);
    assert.ok(took >= 400 && took < 2000, `the wait is bounded (${took} ms)`);
    assert.deepEqual(fs.readdirSync(fx.dir).filter((n) => n.endsWith('.tmp')), []);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('a lock older than the stale age is replaced and released', () => {
  const fx = fixture();
  try {
    const opts = optsOf(fx);
    fs.writeFileSync(fx.lock, '');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(fx.lock, old, old);
    measure(stopBody(transcript(fx, 50000)), opts);
    assert.equal(reading(fx).peak, 50000);
    assert.equal(fs.existsSync(fx.lock), false);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('a lock with a future mtime counts as stale: replaced at once, no wait', () => {
  const fx = fixture();
  try {
    const opts = optsOf(fx);
    fs.writeFileSync(fx.lock, '');
    const future = new Date(Date.now() + 3600 * 1000);
    fs.utimesSync(fx.lock, future, future);
    const t0 = Date.now();
    measure(stopBody(transcript(fx, 50000)), opts);
    assert.ok(Date.now() - t0 < 400, 'no lock wait');
    assert.equal(reading(fx).peak, 50000);
    assert.equal(fs.existsSync(fx.lock), false);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('the lock is released when the write fails', () => {
  const fx = fixture();
  const real = fs.renameSync;
  try {
    const opts = optsOf(fx);
    measure(stopBody(transcript(fx, 10000)), opts);
    fs.renameSync = function patched(from, ...rest) {
      if (typeof from === 'string' && path.basename(from).startsWith('.lead-context.json.')) throw new Error('rename refused');
      return real.call(this, from, ...rest);
    };
    measure(stopBody(transcript(fx, 70000)), opts);
    fs.renameSync = real;
    assert.equal(fs.existsSync(fx.lock), false);
    assert.deepEqual(fs.readdirSync(fx.dir).filter((n) => n.endsWith('.tmp')), []);
    assert.equal(reading(fx).peak, 10000);
  } finally { fs.renameSync = real; fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('a folder at the lock name costs no wait and measure still records', () => {
  const fx = fixture();
  try {
    const opts = optsOf(fx);
    measure(stopBody(transcript(fx, 10000)), opts);
    fs.mkdirSync(fx.lock);
    const t0 = Date.now();
    measure(stopBody(transcript(fx, 70000)), opts);
    assert.ok(Date.now() - t0 < 100, 'no lock wait');
    assert.equal(reading(fx).peak, 70000);
    assert.equal(fs.statSync(fx.lock).isDirectory(), true, 'the folder is left alone');
    measure(stopBody(transcript(fx, 80000)), opts);
    assert.equal(reading(fx).peak, 80000, 'later readings still record');
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('a link at the lock name costs no wait and measure still records', () => {
  const fx = fixture();
  try {
    const opts = optsOf(fx);
    measure(stopBody(transcript(fx, 10000)), opts);
    const target = path.join(fx.base, 'elsewhere');
    fs.mkdirSync(target);
    fs.symlinkSync(target, fx.lock, 'junction');
    const t0 = Date.now();
    measure(stopBody(transcript(fx, 70000)), opts);
    assert.ok(Date.now() - t0 < 100, 'no lock wait');
    assert.equal(reading(fx).peak, 70000);
    assert.equal(fs.lstatSync(fx.lock).isSymbolicLink(), true, 'the link is left alone');
    assert.deepEqual(fs.readdirSync(target), []);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('start writes its reading while the lock stays held, and leaves that lock alone', () => {
  const fx = fixture();
  try {
    const opts = optsOf(fx);
    measure(stopBody(transcript(fx, 60000)), opts);
    const before = reading(fx);
    fs.writeFileSync(fx.lock, '');
    const t0 = Date.now();
    start(startBody, opts);
    const took = Date.now() - t0;
    const r = reading(fx);
    assert.match(r.session, /^[0-9a-f]{12}$/);
    assert.notEqual(r.session, before.session, 'the new session is recorded');
    assert.equal(r.ctx, null);
    assert.equal(r.peak, 60000);
    assert.equal(fs.existsSync(fx.lock), true);
    assert.ok(took < 2000, `the wait is bounded (${took} ms)`);
    assert.deepEqual(fs.readdirSync(fx.dir).filter((n) => n.endsWith('.tmp')), []);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('a freeze lock dated more than 30 seconds ahead is replaced and removed', () => {
  const fx = fixture();
  try {
    const slug = '2026-11-03-0712-demo';
    const runDir = path.join(fx.root, '.company', 'work', slug);
    fs.renameSync(fx.dir, runDir);
    const lock = path.join(runDir, 'lead-freeze.lock');
    fs.writeFileSync(lock, '');
    const future = new Date(Date.now() + 3600 * 1000);
    fs.utimesSync(lock, future, future);
    contextHandover(fx.root, slug, { tokens: 86000, session: 'abcdef012345' });
    assert.equal(fs.existsSync(lock), false);
    assert.ok(fs.readdirSync(runDir).some((n) => n.startsWith('lead-handoff-')), 'the Handoff was written');
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('a freeze lock dated within 30 seconds ahead still counts as held', () => {
  const fx = fixture();
  try {
    const slug = '2026-11-03-0712-demo';
    const runDir = path.join(fx.root, '.company', 'work', slug);
    fs.renameSync(fx.dir, runDir);
    const lock = path.join(runDir, 'lead-freeze.lock');
    fs.writeFileSync(lock, '');
    const near = new Date(Date.now() + 5000);
    fs.utimesSync(lock, near, near);
    assert.throws(() => contextHandover(fx.root, slug, { tokens: 86000, session: 'abcdef012345' }));
    assert.equal(fs.existsSync(lock), true);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});
