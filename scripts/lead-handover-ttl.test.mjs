// Tests for lead-handoff v2.2: the Lead cache lifetime `ttl` in lead-context.json and `ctx --json`.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { measure, start, main } from './lead-handover.mjs';

const here = import.meta.dirname;
const SCRIPT = path.join(here, 'lead-handover.mjs');

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const tag = (id) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 12);

// One product root and one Claude config dir per test; nothing reads the real home.
function fixture() {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'lead-ttl-')));
  tmps.push(base);
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const dir = path.join(root, '.company', 'work', 'demo-run');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'projects', 'p1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now() - 60000), ev: 'start' })}\n`);
  return { base, root, claudeDir, dir, slug: 'demo-run', file: path.join(dir, 'lead-context.json'), transcript: path.join(claudeDir, 'projects', 'p1', 'session.jsonl') };
}

const BASE_USAGE = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 30000 };
// An assistant line whose usage carries the given cache_creation split (undefined: no split object).
function line(cacheCreation, extra = {}, usageExtra = {}) {
  const usage = { ...BASE_USAGE, ...usageExtra };
  if (cacheCreation !== undefined) usage.cache_creation = cacheCreation;
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'SECRET-PHRASE reply' }], usage }, ...extra };
}
const split = (m5, h1) => ({ ephemeral_5m_input_tokens: m5, ephemeral_1h_input_tokens: h1 });
const write = (fx, rows) => fs.writeFileSync(fx.transcript, `${rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`);
const stop = (fx, session) => JSON.stringify({ hook_event_name: 'Stop', transcript_path: fx.transcript, ...(session ? { session_id: session } : {}) });
const opts = (fx) => ({ root: fx.root, claudeDir: fx.claudeDir, env: {} });
const stored = (fx) => JSON.parse(fs.readFileSync(fx.file, 'utf8'));
const ttlOf = (fx, rows, session) => { write(fx, rows); measure(stop(fx, session), opts(fx)); return stored(fx).ttl; };

describe('hostile split values: ttl stays null, never a guess, no crash', () => {
  const hostile = [
    ['string counts', split('5', '1')],
    ['float counts', split(1.5, 2.5)],
    ['negative counts', split(-5, -1)],
    ['null counts', split(null, null)],
    ['boolean counts', split(true, true)],
    ['array counts', split([1], [1])],
    ['zero counts', split(0, 0)],
    ['empty split object', {}],
    ['split not an object', 'five'],
    ['split null', null],
    ['no split at all', undefined],
  ];
  for (const [name, s] of hostile) {
    test(`${name} give ttl null and the reading is still written`, () => {
      const fx = fixture();
      write(fx, [line(s)]);
      const r = measure(stop(fx), opts(fx));
      assert.deepEqual(r, { code: 0, err: '' });
      const o = stored(fx);
      assert.equal(o.ctx, 31500);
      assert.equal(Object.hasOwn(o, 'ttl'), true);
      assert.equal(o.ttl, null);
    });
  }

  test('a count of 1e999 (parsed as Infinity) and a text count give ttl null', () => {
    const fx = fixture();
    const raw = JSON.stringify(line(undefined)).replace('"output_tokens":500', '"output_tokens":500,"cache_creation":{"ephemeral_5m_input_tokens":1e999,"ephemeral_1h_input_tokens":"NaN"}');
    assert.ok(raw.includes('1e999'));
    assert.equal(ttlOf(fx, [raw]), null);
  });

  test('a malformed JSON line as the newest line is skipped: the older valid split wins', () => {
    const fx = fixture();
    assert.equal(ttlOf(fx, [line(split(0, 9)), '{"type":"assistant","message":{"usage":{"cache_creation":{"ephemeral_5m_input_tokens":5']), '1h');
  });

  test('a hostile newest line does not erase the previous ttl of the same session', () => {
    const fx = fixture();
    assert.equal(ttlOf(fx, [line(split(0, 9))], 'sess-a'), '1h');
    assert.equal(ttlOf(fx, [line(split('5', -1))], 'sess-a'), '1h');
  });

  test('a hostile newest line gives null when the session changed', () => {
    const fx = fixture();
    assert.equal(ttlOf(fx, [line(split(0, 9))], 'sess-a'), '1h');
    assert.equal(ttlOf(fx, [line(split('5', -1))], 'sess-b'), null);
  });

  test('a split line pushed out of the 1 MiB tail is not read: ttl stays null', () => {
    const fx = fixture();
    const filler = line(undefined);
    filler.pad = 'x'.repeat(200000);
    const rows = [line(split(7, 0))];
    for (let i = 0; i < 7; i++) rows.push(filler);
    assert.equal(ttlOf(fx, rows), null);
  });

  test('a single line over the tail bound with a split inside it gives no crash and ttl null', () => {
    const fx = fixture();
    const big = line(split(5, 5));
    big.pad = 'x'.repeat(1100000);
    write(fx, [line(undefined), big]);
    const r = measure(stop(fx), opts(fx));
    assert.deepEqual(r, { code: 0, err: '' });
    const o = fs.existsSync(fx.file) ? stored(fx) : { ttl: null };
    assert.equal(o.ttl, null);
  });

  test('a sidechain line with a split is ignored', () => {
    const fx = fixture();
    assert.equal(ttlOf(fx, [line(undefined), line(split(5, 0), { isSidechain: true })]), null);
  });
});

describe('measure reads the split from the transcript tail', () => {
  test('5m only gives 5m', () => { assert.equal(ttlOf(fixture(), [line(split(4000, 0))]), '5m'); });
  test('1h only gives 1h', () => { assert.equal(ttlOf(fixture(), [line(split(0, 4000))]), '1h'); });
  test('both counts above 0 give 5m, the earliest-expiring part', () => { assert.equal(ttlOf(fixture(), [line(split(100, 4000))]), '5m'); });
  test('only the 5m key present gives 5m', () => { assert.equal(ttlOf(fixture(), [line({ ephemeral_5m_input_tokens: 3 })]), '5m'); });
  test('only the 1h key present gives 1h', () => { assert.equal(ttlOf(fixture(), [line({ ephemeral_1h_input_tokens: 3 })]), '1h'); });

  test('the newest line with a split wins over an older one', () => {
    assert.equal(ttlOf(fixture(), [line(split(0, 9)), line(split(9, 0))]), '5m');
    assert.equal(ttlOf(fixture(), [line(split(9, 0)), line(split(0, 9))]), '1h');
  });

  test('a newer line with zero counts is passed over for the older line with a split', () => {
    assert.equal(ttlOf(fixture(), [line(split(0, 9)), line(split(0, 0))]), '1h');
  });

  test('no split in the tail and no previous reading gives null', () => {
    assert.equal(ttlOf(fixture(), [line(undefined)]), null);
  });

  test('no split in the tail keeps the previous ttl of the same session', () => {
    const fx = fixture();
    assert.equal(ttlOf(fx, [line(split(5, 0))], 'sess-a'), '5m');
    assert.equal(ttlOf(fx, [line(undefined)], 'sess-a'), '5m');
  });

  test('no split in the tail after a session change gives null', () => {
    const fx = fixture();
    assert.equal(ttlOf(fx, [line(split(5, 0))], 'sess-a'), '5m');
    assert.equal(ttlOf(fx, [line(undefined)], 'sess-b'), null);
  });

  test('a new split replaces the previous ttl', () => {
    const fx = fixture();
    assert.equal(ttlOf(fx, [line(split(5, 0))], 'sess-a'), '5m');
    assert.equal(ttlOf(fx, [line(split(0, 5))], 'sess-a'), '1h');
  });

  test('ttl is the last key, ctx and peak are unchanged, the file is small and holds no transcript text', () => {
    const fx = fixture();
    write(fx, [{ type: 'user', message: { role: 'user', content: 'SECRET-PHRASE from the CEO' } }, line(split(5, 0))]);
    measure(stop(fx, 'sess-a'), opts(fx));
    const text = fs.readFileSync(fx.file, 'utf8');
    const o = JSON.parse(text);
    assert.deepEqual(Object.keys(o), ['v', 'session', 'ctx', 'peak', 'at', 'ttl']);
    assert.equal(o.session, tag('sess-a'));
    assert.equal(o.ctx, 31500);
    assert.equal(o.peak, 31500);
    assert.ok(Buffer.byteLength(text) <= 256, `${Buffer.byteLength(text)} bytes`);
    assert.ok(!text.includes('SECRET-PHRASE') && !text.includes('\r'));
    assert.ok(text.endsWith('}\n'));
  });

  test('the file stays at most 256 bytes for the largest numbers', () => {
    const fx = fixture();
    write(fx, [line(split(5, 5), {}, { input_tokens: 9999999, output_tokens: 1 })]);
    measure(stop(fx, 'x'.repeat(100)), opts(fx));
    assert.ok(fs.statSync(fx.file).size <= 256);
    assert.equal(stored(fx).ttl, '5m');
  });
});

describe('start, v2.1 files and ctx --json', () => {
  test('start writes ttl null even after a 5m reading', () => {
    const fx = fixture();
    assert.equal(ttlOf(fx, [line(split(5, 0))], 'sess-a'), '5m');
    start(JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'sess-b' }), opts(fx));
    const o = stored(fx);
    assert.deepEqual(Object.keys(o), ['v', 'session', 'ctx', 'peak', 'at', 'ttl']);
    assert.equal(o.ctx, null);
    assert.equal(o.ttl, null);
    assert.equal(o.peak, 31500);
  });

  test('a v2.1 file without ttl is read as ttl null by ctx --json', () => {
    const fx = fixture();
    fs.writeFileSync(fx.file, `${JSON.stringify({ v: 1, session: tag('s'), ctx: 40000, peak: 50000, at: '2026-11-12T10:00:00Z' })}\n`);
    const r = main(['ctx', fx.slug, '--json'], fx.root, {});
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(r.out), { v: 1, ctx: 40000, peak: 50000, at: '2026-11-12T10:00:00Z', ttl: null });
  });

  test('a v2.1 file without ttl is rewritten with the key at the next Stop, ttl null without a split', () => {
    const fx = fixture();
    const s = 'sess-a';
    fs.writeFileSync(fx.file, `${JSON.stringify({ v: 1, session: tag(s), ctx: 40000, peak: 50000, at: '2026-11-12T10:00:00Z' })}\n`);
    assert.equal(ttlOf(fx, [line(undefined)], s), null);
    const o = stored(fx);
    assert.deepEqual(Object.keys(o), ['v', 'session', 'ctx', 'peak', 'at', 'ttl']);
    assert.equal(o.peak, 50000);
  });

  test('a stored ttl outside 5m, 1h and null is not trusted', () => {
    const fx = fixture();
    for (const bad of ['10m', 5, true, '']) {
      fs.writeFileSync(fx.file, `${JSON.stringify({ v: 1, session: tag('s'), ctx: 1, peak: 2, at: '2026-11-12T10:00:00Z', ttl: bad })}\n`);
      const r = main(['ctx', fx.slug, '--json'], fx.root, {});
      const o = JSON.parse(r.out);
      assert.equal(o.ttl, null, `${JSON.stringify(bad)} -> ${r.out}`);
    }
  });

  test('ctx --json prints ttl after at, from the stored reading', () => {
    const fx = fixture();
    ttlOf(fx, [line(split(0, 7))], 'sess-a');
    const r = main(['ctx', fx.slug, '--json'], fx.root, {});
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(Object.keys(JSON.parse(r.out)), ['v', 'ctx', 'peak', 'at', 'ttl']);
    assert.equal(JSON.parse(r.out).ttl, '1h');
    assert.ok(r.out.endsWith('\n'));
  });

  test('ctx --json without a reading prints ttl null', () => {
    const fx = fixture();
    assert.deepEqual(JSON.parse(main(['ctx', fx.slug, '--json'], fx.root, {}).out), { v: 1, ctx: null, peak: null, at: null, ttl: null });
  });

  test('read lines are unchanged by ttl', () => {
    const fx = fixture();
    ttlOf(fx, [line(split(5, 0))], 'sess-a');
    const lines = main(['read', fx.slug], fx.root, {}).out.split('\n');
    assert.ok(lines.includes('lead ctx 31500'), lines.join('|'));
    assert.ok(lines.includes('lead peak 31500'));
    assert.ok(!lines.some((l) => l.includes('ttl')));
  });

  test('a Stop through the real script (argument array, no shell) writes ttl 5m and ctx --json shows it', () => {
    const fx = fixture();
    write(fx, [line(split(5, 5))]);
    const env = { PATH: process.env.PATH, HOME: fx.base, USERPROFILE: fx.base, MCSPARROW_HOME: fx.base, CLAUDE_CONFIG_DIR: fx.claudeDir };
    const run = (args, input) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: fx.root, encoding: 'utf8', env, input });
    const m = run(['measure'], stop(fx, 'sess-a'));
    assert.equal(m.status, 0, m.stderr);
    const c = run(['ctx', fx.slug, '--json']);
    assert.equal(c.status, 0, c.stdout + c.stderr);
    assert.equal(JSON.parse(c.stdout).ttl, '5m');
  });
});
