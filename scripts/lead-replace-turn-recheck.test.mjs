import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Regression: scripts/lead-replace.mjs types blind keystrokes
// with Enter; the UI state (lead-context.json) is not re-read right before each send, so a new turn between the check and the
// send can put a permission dialog up and the typed Enter confirms its default. Red until typeInto re-reads lead-context.json
// before each send and aborts (any 'failed: ...' result, nothing typed) when the reading changed.
// Seam: typeInto(text, { platform, run, dir, session, claudePid, now, sleep }) as in tests/lead-launch-mcp/lead-replace.test.mjs.

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, 'lead-replace.mjs');
const load = () => import(pathToFileURL(SCRIPT).href);

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const T0 = Date.parse('2026-11-15T10:00:00Z');
const FROZEN = 'abcdef012345';
const NEW = 'newsession001';
const PROMPT = 'aico lead hand-over: run lead-handover read first.';

function runDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-replace-s2-'));
  tmps.push(root);
  const dir = path.join(root, '.company', 'work', 'P20261115.000001', '01-fix');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const reading = (dir, session, atMs) => fs.writeFileSync(path.join(dir, 'lead-context.json'),
  `${JSON.stringify({ v: 1, session, ctx: 1000, peak: 170000, at: iso(atMs), ttl: null })}\n`);

// Fake clock; onSleep(ms, t) lets a test change the UI state while the helper waits.
function clock(onSleep = () => {}) {
  const c = { t: T0, calls: 0 };
  c.now = () => c.t;
  c.sleep = async (ms) => {
    c.calls += 1;
    if (c.calls > 100000) throw new Error('runaway wait loop');
    c.t += ms;
    onSleep(ms, c.t);
  };
  return c;
}

function runner(dir, c) {
  const r = { calls: [] };
  r.run = async (argv, input) => {
    const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
    r.calls.push(text);
    if (text.startsWith('/clear')) reading(dir, NEW, c.t + 500);
    return { status: 0 };
  };
  return r;
}

const opts = (dir, r, c) => ({ platform: 'win32', run: r.run, dir, session: FROZEN, claudePid: 4242, now: c.now, sleep: c.sleep });

describe('S-2: UI state re-checked right before each send', () => {
  test('control: unchanged readings -> typed, /clear then the prompt', async () => {
    const { typeInto } = await load();
    const dir = runDir();
    reading(dir, FROZEN, T0);
    const c = clock();
    const r = runner(dir, c);
    assert.equal(await typeInto(PROMPT, opts(dir, r, c)), 'typed');
    assert.deepEqual(r.calls, ['/clear\r', `${PROMPT}\r`]);
  });

  test('a new turn during the settle wait (reading changed) -> the prompt + Enter is not typed', async () => {
    const { typeInto } = await load();
    const dir = runDir();
    reading(dir, FROZEN, T0);
    // The settle wait is the only 2000 ms sleep; a turn (CEO prompt, notification) lands in it and rewrites the reading.
    const c = clock((ms, t) => { if (ms === 2000) reading(dir, NEW, t + 1000); });
    const r = runner(dir, c);
    const out = await typeInto(PROMPT, opts(dir, r, c));
    assert.deepEqual(r.calls, ['/clear\r'], 'only /clear was typed; the second blind Enter must not be sent');
    assert.match(out, /^failed: /);
  });

  test('the frozen session is already gone before the first send -> /clear is not typed', async () => {
    const { typeInto } = await load();
    const dir = runDir();
    reading(dir, NEW, T0);   // the Lead was already replaced; /clear would wipe the new session
    const c = clock();
    const r = runner(dir, c);
    const out = await typeInto(PROMPT, opts(dir, r, c));
    assert.deepEqual(r.calls, [], 'nothing may be typed');
    assert.match(out, /^failed: /);
  });
});
