import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { turn } from './lead-handover.mjs';

// R-23 (fail closed, as for an oversize payload): a Lead UserPromptSubmit/PreToolUse payload that is not JSON, or has
// no or an over-long session_id, still writes a turn mark with session null, so lead-replace refuses to type.

const here = path.dirname(fileURLToPath(import.meta.url));
const load = () => import(pathToFileURL(path.join(here, 'lead-replace.mjs')).href);
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const T0 = Date.parse('2026-11-15T10:00:00Z');
const FROZEN = 'abcdef012345';
const PROMPT = 'aico lead hand-over: run lead-handover read first.';
const h12 = (id) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 12);

function product() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-bad-'));
  tmps.push(root);
  const dir = path.join(root, '.company', 'work', 'demo-run');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now() - 60000), ev: 'start' })}\n`);
  return { root, dir, file: path.join(dir, 'lead-turn.json') };
}
const body = (name, extra) => JSON.stringify({ hook_event_name: name, ...extra });
const markOf = (p) => JSON.parse(fs.readFileSync(p.file, 'utf8'));

describe('R-23 bad turn input fails closed', () => {
  for (const name of ['UserPromptSubmit', 'PreToolUse']) {
    const cases = {
      'input that is not JSON': 'not json',
      'empty input': '',
      'truncated JSON': '{"hook_event_name":"' + name + '","session_id":"x"',
    };
    // A non-JSON payload has no event name to check; it marks regardless of which hook sent it.
    for (const [label, text] of Object.entries(cases)) {
      test(`${name}: ${label} writes a mark with session null`, () => {
        const p = product();
        assert.deepEqual(turn(text, { root: p.root, now: T0 + 250 }), { code: 0, err: '' });
        assert.deepEqual(markOf(p), { v: 1, session: null, at: '2026-11-15T10:00:00.250Z' });
      });
    }
    const sessions = {
      'no session_id': {},
      'empty session_id': { session_id: '' },
      'session_id not a string': { session_id: 7 },
      'null session_id': { session_id: null },
      'over-long session_id (513)': { session_id: 'a'.repeat(513) },
    };
    for (const [label, extra] of Object.entries(sessions)) {
      test(`${name}: ${label} writes a mark with session null`, () => {
        const p = product();
        assert.deepEqual(turn(body(name, extra), { root: p.root, now: T0 + 250 }), { code: 0, err: '' });
        assert.deepEqual(markOf(p), { v: 1, session: null, at: '2026-11-15T10:00:00.250Z' });
      });
    }
  }

  test('a session_id of exactly 512 characters is still hashed', () => {
    const p = product();
    const id = 'a'.repeat(512);
    turn(body('PreToolUse', { session_id: id }), { root: p.root, now: T0 });
    assert.equal(markOf(p).session, h12(id));
  });

  test('a Step (agent_id) with a bad session_id still writes nothing', () => {
    const p = product();
    turn(body('PreToolUse', { agent_id: 'a1' }), { root: p.root, now: T0 });
    turn(body('UserPromptSubmit', { agent_id: 'a1', session_id: 'a'.repeat(513) }), { root: p.root, now: T0 });
    assert.equal(fs.existsSync(p.file), false);
  });

  test('another event with no session_id writes nothing', () => {
    const p = product();
    turn(body('Stop', {}), { root: p.root, now: T0 });
    turn(body('SessionStart', { session_id: '' }), { root: p.root, now: T0 });
    assert.equal(fs.existsSync(p.file), false);
  });

  test('no active run: bad input writes nothing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-bad-none-'));
    tmps.push(root);
    turn('not json', { root, now: T0 });
    assert.equal(fs.existsSync(path.join(root, '.company')), false);
  });

  test('bad input after the Stop reading: lead-replace types nothing (failed: turn changed)', async () => {
    const { typeInto } = await load();
    for (const text of ['not json', body('UserPromptSubmit', {}), body('PreToolUse', { session_id: 'a'.repeat(513) })]) {
      const p = product();
      fs.writeFileSync(path.join(p.dir, 'lead-context.json'), `${JSON.stringify({ v: 1, session: FROZEN, ctx: 1000, peak: 170000, at: iso(T0), ttl: null })}\n`);
      turn(text, { root: p.root, now: T0 + 5000 });
      const calls = [];
      const c = { t: T0 + 6000 };
      const run = async (argv, input) => { calls.push(input.toString('utf8')); return { status: 0 }; };
      const r = await typeInto(PROMPT, { platform: 'win32', run, dir: p.dir, session: FROZEN, claudePid: 4242, now: () => c.t, sleep: async (ms) => { c.t += ms; if (c.t > T0 + 120000) throw new Error('typeInto did not give up'); }, accepted: { session: FROZEN, at: iso(T0) } });
      assert.equal(r, 'failed: turn changed', text.slice(0, 30));
      assert.deepEqual(calls, [], text.slice(0, 30));
    }
  });
});
