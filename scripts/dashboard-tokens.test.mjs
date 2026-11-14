import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { readLedger } from './dashboard-tokens.mjs';

const SLUG = '2026-11-04 01.19 - Demo Run';

function makeRoot(t, slug = SLUG) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-tokens-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.company', 'ledger'), { recursive: true });
  const file = path.join(root, '.company', 'ledger', `${slug}.jsonl`);
  fs.writeFileSync(file, '{"v":1}\n');
  return { root, file };
}

const report = (rows, extra = {}) => JSON.stringify({
  v: 1, run: SLUG, rows,
  totals: { spend: 1200, cache_read: 3400, cache_write: 5, cache_write_share: 0, by_kind: {} },
  ...extra
});

// Fake child: behaviour(child) decides what it does once spawned.
function fakeSpawn(behaviour) {
  const calls = [];
  const spawn = (file, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    calls.push({ file, args, opts, child });
    setImmediate(() => behaviour(child, calls.length));
    return child;
  };
  return { spawn, calls };
}

const reply = (text, code = 0) => (child) => {
  child.stdout.emit('data', Buffer.from(text));
  child.emit('close', code);
};

const overOf = async (t, rows, extra) => {
  const { root } = makeRoot(t);
  const { spawn } = fakeSpawn(reply(report(rows, extra)));
  return (await readLedger(root, SLUG, { spawn, cache: new Map() })).overCap;
};

test('totals and over-cap rows are judged against the report cap', async (t) => {
  const { root } = makeRoot(t);
  const rows = [
    { id: '05', role: 'qa', ctx_end: 40000 },
    { id: '06', role: 'backend-engineer', ctx_end: 96000 },
    { id: '07', role: 'frontend-engineer', ctx_end: null },
    { id: '08', role: 'code-reviewer', ctx_end: 130000 }
  ];
  const { spawn, calls } = fakeSpawn(reply(report(rows, { cap: 120000 })));
  const out = await readLedger(root, SLUG, { spawn, cache: new Map() });
  assert.deepEqual(out, {
    state: 'ok', totals: { spend: 1200, cacheRead: 3400 },
    overCap: [{ step: '08', role: 'code-reviewer', ctxEnd: 130000 }]
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, process.execPath);
  assert.deepEqual(calls[0].args.slice(1), ['report', SLUG, '--json']);
  assert.ok(calls[0].args[0].endsWith('ledger.mjs'));
  assert.equal(calls[0].opts.shell, false);
  assert.equal(calls[0].opts.cwd, root);
});

test('AC11: the report cap is the line: exactly the cap is not over, one above is', async (t) => {
  const rows = [{ id: '05', role: 'qa', ctx_end: 120000 }, { id: '06', role: 'qa', ctx_end: 120001 }];
  assert.deepEqual(await overOf(t, rows, { cap: 120000 }), [{ step: '06', role: 'qa', ctxEnd: 120001 }]);
  assert.deepEqual(await overOf(t, rows, { cap: 200000 }), []);
});

test('AC9: a report without cap uses 180000, so 95001 is not over cap', async (t) => {
  const rows = [{ id: '05', role: 'qa', ctx_end: 95001 }, { id: '06', role: 'qa', ctx_end: 180000 }, { id: '07', role: 'qa', ctx_end: 180001 }];
  assert.deepEqual(await overOf(t, rows), [{ step: '07', role: 'qa', ctxEnd: 180001 }]);
});

test('a hostile report cap (string, null, negative, fraction, below 60000, above 1000000, object) falls back to 180000', async (t) => {
  const rows = [{ id: '05', role: 'qa', ctx_end: 130000 }, { id: '06', role: 'qa', ctx_end: 180001 }];
  for (const cap of ['120000', null, -1, 0, 120000.5, 59999, 1000001, NaN, Infinity, { a: 1 }, [120000], true]) {
    assert.deepEqual(await overOf(t, rows, { cap }), [{ step: '06', role: 'qa', ctxEnd: 180001 }], JSON.stringify(cap));
  }
});

test('an unchanged ledger spawns once, a changed one again', async (t) => {
  const { root, file } = makeRoot(t);
  const { spawn, calls } = fakeSpawn(reply(report([])));
  const cache = new Map();
  await readLedger(root, SLUG, { spawn, cache });
  await readLedger(root, SLUG, { spawn, cache });
  assert.equal(calls.length, 1);
  fs.appendFileSync(file, '{"v":1,"more":true}\n');
  await readLedger(root, SLUG, { spawn, cache });
  assert.equal(calls.length, 2);
});

test('concurrent calls for one unchanged ledger share one spawn', async (t) => {
  const { root } = makeRoot(t);
  const { spawn, calls } = fakeSpawn(reply(report([])));
  const cache = new Map();
  await Promise.all([readLedger(root, SLUG, { spawn, cache }), readLedger(root, SLUG, { spawn, cache })]);
  assert.equal(calls.length, 1);
});

test('failures are cached as unavailable', async (t) => {
  const { root } = makeRoot(t);
  const { spawn, calls } = fakeSpawn(reply('', 1));
  const cache = new Map();
  assert.equal((await readLedger(root, SLUG, { spawn, cache })).state, 'unavailable');
  assert.equal((await readLedger(root, SLUG, { spawn, cache })).state, 'unavailable');
  assert.equal(calls.length, 1);
});

test('exit 1 gives unavailable', async (t) => {
  const { root } = makeRoot(t);
  const { spawn } = fakeSpawn(reply(report([]), 1));
  assert.deepEqual(await readLedger(root, SLUG, { spawn, cache: new Map() }), { state: 'unavailable', totals: null, overCap: [] });
});

test('bad JSON gives unavailable', async (t) => {
  const { root } = makeRoot(t);
  const { spawn } = fakeSpawn(reply('not json'));
  assert.equal((await readLedger(root, SLUG, { spawn, cache: new Map() })).state, 'unavailable');
});

test('report v other than 1 or bad totals give unavailable', async (t) => {
  const { root } = makeRoot(t);
  for (const text of [
    report([], { v: 2 }),
    report([], { totals: { spend: -1, cache_read: 0 } }),
    report([], { totals: { spend: '5', cache_read: 0 } }),
    report([], { rows: 'x' }),
    'null',
    '[]'
  ]) {
    const { spawn } = fakeSpawn(reply(text));
    assert.equal((await readLedger(root, SLUG, { spawn, cache: new Map() })).state, 'unavailable', text);
  }
});

test('a timeout kills the child and gives unavailable', async (t) => {
  const { root } = makeRoot(t);
  const { spawn, calls } = fakeSpawn(() => {});
  const out = await readLedger(root, SLUG, { spawn, timeoutMs: 20, cache: new Map() });
  assert.equal(out.state, 'unavailable');
  assert.equal(calls[0].child.killed, true);
});

test('a spawn error event and a throwing spawn give unavailable', async (t) => {
  const { root } = makeRoot(t);
  const { spawn } = fakeSpawn((child) => child.emit('error', new Error('boom')));
  assert.equal((await readLedger(root, SLUG, { spawn, cache: new Map() })).state, 'unavailable');
  const throwing = () => { throw new Error('nope'); };
  assert.equal((await readLedger(root, SLUG, { spawn: throwing, cache: new Map() })).state, 'unavailable');
});

test('output over 1 MiB gives unavailable and kills the child', async (t) => {
  const { root } = makeRoot(t);
  const { spawn, calls } = fakeSpawn((child) => {
    child.stdout.emit('data', Buffer.alloc(1024 * 1024));
    child.stdout.emit('data', Buffer.alloc(1));
  });
  assert.equal((await readLedger(root, SLUG, { spawn, cache: new Map() })).state, 'unavailable');
  assert.equal(calls[0].child.killed, true);
});

test('a missing ledger is none with no spawn', async (t) => {
  const { root } = makeRoot(t);
  const { spawn, calls } = fakeSpawn(reply(report([])));
  const out = await readLedger(root, '2026-11-04 02.00 - Other Run', { spawn, cache: new Map() });
  assert.deepEqual(out, { state: 'none', totals: null, overCap: [] });
  assert.equal(calls.length, 0);
});

test('a linked ledger counts as missing with no spawn', async (t) => {
  const { root, file } = makeRoot(t);
  const target = path.join(root, 'real.jsonl');
  fs.writeFileSync(target, '{}\n');
  fs.rmSync(file);
  try { fs.symlinkSync(target, file); } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') return t.skip('symlinks not permitted');
    throw error;
  }
  const { spawn, calls } = fakeSpawn(reply(report([])));
  assert.equal((await readLedger(root, SLUG, { spawn, cache: new Map() })).state, 'none');
  assert.equal(calls.length, 0);
});

test('a slug that is not a work folder name is unavailable with no spawn', async (t) => {
  const { root } = makeRoot(t);
  const { spawn, calls } = fakeSpawn(reply(report([])));
  for (const slug of ['../x', '..', 'a/b', '', null, undefined, 5]) {
    assert.equal((await readLedger(root, slug, { spawn, cache: new Map() })).state, 'unavailable');
  }
  assert.equal(calls.length, 0);
});

test('at most 4 children run at once; a fifth call waits for a free slot', async (t) => {
  const { root: shared } = makeRoot(t);
  const slugs = [0, 1, 2, 3, 4].map((i) => `2026-11-04 03.0${i} - Run ${i}`);
  for (const slug of slugs) fs.writeFileSync(path.join(shared, '.company', 'ledger', `${slug}.jsonl`), '{}\n');
  const held = [];
  const { spawn, calls } = fakeSpawn((child) => held.push(child));
  const cache = new Map();
  const all = slugs.map((slug) => readLedger(shared, slug, { spawn, cache }));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 4);
  held[0].stdout.emit('data', Buffer.from(report([])));
  held[0].emit('close', 0);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 5);
  for (const child of held.slice(1)) {
    child.stdout.emit('data', Buffer.from(report([])));
    child.emit('close', 0);
  }
  const results = await Promise.all(all);
  assert.ok(results.every((r) => r.state === 'ok'));
});
