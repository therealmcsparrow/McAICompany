import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// main hands the process check, the start-time identity and the liveness check on to the typing step.

const here = path.dirname(fileURLToPath(import.meta.url));
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const load = () => import(pathToFileURL(path.join(here, 'lead-replace.mjs')).href);

const T0 = Date.parse('2026-11-15T10:00:00Z');
const SESSION = 'aaaaaaaaaaaa';
const SLUG = 'demo-run';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-wiring-'));
  tmps.push(root);
  const dir = path.join(root, '.company', 'work', SLUG);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'lead-replace.json'), `${JSON.stringify({ v: 1, session: SESSION, armAt: iso(T0 - 10000), state: 'waiting-background' })}\n`);
  fs.writeFileSync(path.join(dir, 'lead-context.json'), `${JSON.stringify({ v: 1, session: SESSION, ctx: 1, peak: 2, at: iso(T0), ttl: null })}\n`);
  return { root, dir };
}

function run(identify) {
  const fx = setup();
  const seen = { opts: null, identifyCalls: [] };
  const alive = () => true;
  const deps = {
    list: async () => [],
    alive,
    identify: async (pid) => { seen.identifyCalls.push(pid); return identify(pid); },
    now: () => T0 + 100000,
    sleep: async () => {},
    type: async (text, opts) => { seen.opts = opts; return 'typed'; },
  };
  return load().then(({ main }) => main([SLUG, '4242'], fx.root, deps)).then((code) => ({ code, seen, alive, deps }));
}

describe('main passes the typing step its checks', () => {
  test('identify, alive and baseline reach the type call', async () => {
    const base = { image: 'claude.exe', created: T0 - 60000 };
    const { code, seen, alive } = await run(() => base);
    assert.equal(code, 0);
    assert.ok(seen.opts, 'type called');
    assert.equal(typeof seen.opts.identify, 'function', 'identify passed');
    assert.equal(seen.opts.alive, alive, 'alive passed');
    assert.deepEqual(seen.opts.baseline, base, 'baseline is the identity read at start');
    assert.equal(seen.opts.claudePid, 4242);
  });

  test('the identity is read for the claude pid, and the passed identify is the same seam', async () => {
    const { seen } = await run(() => ({ image: 'claude.exe', created: 1 }));
    assert.deepEqual(seen.identifyCalls, [4242], 'baseline read once for the pid');
    const again = await seen.opts.identify(4242);
    assert.deepEqual(again, { image: 'claude.exe', created: 1 });
    assert.deepEqual(seen.identifyCalls, [4242, 4242], 'type receives the injected identify');
  });

  test('when the start identity cannot be read, baseline is null (typing then refuses)', async () => {
    const { seen } = await run(() => { throw new Error('no cim'); });
    assert.ok(seen.opts, 'type called');
    assert.equal(seen.opts.baseline, null);
    assert.equal(typeof seen.opts.identify, 'function');
  });
});
