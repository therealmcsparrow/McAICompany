import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { turn } from './lead-handover.mjs';

// A turn mark (lead-turn.json) is written when the Lead starts a turn (UserPromptSubmit) or a tool call (PreToolUse).
// typeInto refuses to type when the mark of the session is newer than the Stop reading it accepted.

const here = path.dirname(fileURLToPath(import.meta.url));
const load = () => import(pathToFileURL(path.join(here, 'lead-replace.mjs')).href);

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const T0 = Date.parse('2026-11-15T10:00:00Z');
const h12 = (id) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 12);
const FROZEN = 'abcdef012345';
const NEW = '0123456789ab';
const PROMPT = 'aico lead hand-over: run lead-handover read first.';

function product() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-mark-'));
  tmps.push(root);
  const dir = path.join(root, '.company', 'work', 'demo-run');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now() - 60000), ev: 'start' })}\n`);
  return { root, dir, file: path.join(dir, 'lead-turn.json') };
}

describe('turn adapter', () => {
  const ev = (name, extra = {}) => JSON.stringify({ hook_event_name: name, session_id: 'lead-session-1', ...extra });

  for (const name of ['UserPromptSubmit', 'PreToolUse']) {
    test(`${name} of the Lead writes the mark with the hashed session and a time`, () => {
      const p = product();
      const r = turn(ev(name), { root: p.root, now: T0 + 250 });
      assert.deepEqual(r, { code: 0, err: '' });
      assert.deepEqual(JSON.parse(fs.readFileSync(p.file, 'utf8')), { v: 1, session: h12('lead-session-1'), at: '2026-11-15T10:00:00.250Z' });
      assert.deepEqual(fs.readdirSync(p.dir).filter((n) => n.includes('turn')), ['lead-turn.json']);
    });
  }

  test('a Step (agent_id present) writes nothing', () => {
    const p = product();
    turn(ev('PreToolUse', { agent_id: 'a1' }), { root: p.root, now: T0 });
    turn(ev('UserPromptSubmit', { agent_id: 'a1' }), { root: p.root, now: T0 });
    assert.equal(fs.existsSync(p.file), false);
  });

  test('other events and input that is not JSON write nothing', () => {
    const p = product();
    turn(ev('Stop'), { root: p.root, now: T0 });
    turn(ev('SessionStart'), { root: p.root, now: T0 });
    turn('not json', { root: p.root, now: T0 });
    assert.equal(fs.existsSync(p.file), false);
  });

  test('a later turn replaces the mark with the newer time', () => {
    const p = product();
    turn(ev('UserPromptSubmit'), { root: p.root, now: T0 });
    turn(ev('PreToolUse'), { root: p.root, now: T0 + 7000 });
    assert.equal(JSON.parse(fs.readFileSync(p.file, 'utf8')).at, '2026-11-15T10:00:07.000Z');
  });

  test('hooks.json runs the adapter on UserPromptSubmit and PreToolUse', () => {
    const hooks = JSON.parse(fs.readFileSync(path.join(here, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
    for (const name of ['UserPromptSubmit', 'PreToolUse']) {
      const cmds = (hooks[name] ?? []).flatMap((g) => g.hooks.map((x) => x.command));
      assert.ok(cmds.some((c) => /lead-handover\.mjs" turn$/.test(c)), `${name} has no turn hook`);
    }
  });
});

describe('typeInto with a turn mark', () => {
  const mark = (dir, session, atIso) => fs.writeFileSync(path.join(dir, 'lead-turn.json'), `${JSON.stringify({ v: 1, session, at: atIso })}\n`);
  const reading = (dir, session, atMs) => fs.writeFileSync(path.join(dir, 'lead-context.json'),
    `${JSON.stringify({ v: 1, session, ctx: 1000, peak: 170000, at: iso(atMs), ttl: null })}\n`);
  function setup() {
    const p = product();
    const c = { t: T0, calls: 0 };
    c.now = () => c.t;
    c.sleep = async (ms) => { c.t += ms; if (c.onSleep) c.onSleep(ms, c.t); };
    const r = { calls: [] };
    r.run = async (argv, input) => {
      const text = input.toString('utf8');
      r.calls.push(text);
      if (text.startsWith('/clear')) reading(p.dir, NEW, c.t + 500);
      return { status: 0 };
    };
    const accepted = { session: FROZEN, at: iso(T0) };
    const opts = { platform: 'win32', run: r.run, dir: p.dir, session: FROZEN, claudePid: 4242, now: c.now, sleep: c.sleep, accepted };
    return { p, c, r, opts };
  }

  test('a mark newer than the accepted reading -> nothing typed, failed: turn changed', async () => {
    const { typeInto } = await load();
    const s = setup();
    reading(s.p.dir, FROZEN, T0);
    mark(s.p.dir, FROZEN, '2026-11-15T10:00:05.000Z');
    assert.equal(await typeInto(PROMPT, s.opts), 'failed: turn changed');
    assert.deepEqual(s.r.calls, []);
  });

  test('a mark in the same second as the Stop reading, or older -> typed', async () => {
    const { typeInto } = await load();
    const s = setup();
    reading(s.p.dir, FROZEN, T0);
    mark(s.p.dir, FROZEN, '2026-11-15T10:00:00.900Z');
    assert.equal(await typeInto(PROMPT, s.opts), 'typed');
    assert.deepEqual(s.r.calls, ['/clear\r', `${PROMPT}\r`]);
  });

  // R-14: both sessions write through the real `turn` adapter, so the test holds for any mark layout.
  const twoSessions = (order) => {
    const s = setup();
    const frozen = 'frozen-lead-session';
    const other = 'other-main-session';
    s.opts.session = h12(frozen);
    s.opts.accepted = { session: h12(frozen), at: iso(T0) };
    reading(s.p.dir, h12(frozen), T0);
    const ev = (id) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: id });
    const roles = { frozen, other };
    for (const [who, dt] of order) turn(ev(roles[who]), { root: s.p.root, now: T0 + dt });
    return s;
  };

  test('frozen Lead starts a turn after the Stop reading, then another main session marks -> nothing typed', async () => {
    const { typeInto } = await load();
    const s = twoSessions([['frozen', 5000], ['other', 6000]]);
    assert.equal(await typeInto(PROMPT, s.opts), 'failed: turn changed');
    assert.deepEqual(s.r.calls, []);
  });

  test('another main session marks first, then the frozen Lead starts a turn -> nothing typed', async () => {
    const { typeInto } = await load();
    const s = twoSessions([['other', 5000], ['frozen', 6000]]);
    assert.equal(await typeInto(PROMPT, s.opts), 'failed: turn changed');
    assert.deepEqual(s.r.calls, []);
  });

  test('the reading is gone before /clear -> nothing typed', async () => {
    const { typeInto } = await load();
    const s = setup();
    assert.equal(await typeInto(PROMPT, s.opts), 'failed: turn changed');
    assert.deepEqual(s.r.calls, []);
  });

  test('the reading is not the accepted one (same session, later Stop) -> nothing typed', async () => {
    const { typeInto } = await load();
    const s = setup();
    reading(s.p.dir, FROZEN, T0 + 3000);
    assert.equal(await typeInto(PROMPT, s.opts), 'failed: turn changed');
    assert.deepEqual(s.r.calls, []);
  });

  test('a mark that cannot be read counts as a new turn', async () => {
    const { typeInto } = await load();
    const s = setup();
    reading(s.p.dir, FROZEN, T0);
    fs.writeFileSync(path.join(s.p.dir, 'lead-turn.json'), '{broken');
    assert.equal(await typeInto(PROMPT, s.opts), 'failed: turn changed');
    assert.deepEqual(s.r.calls, []);
  });

  test('a mark that is valid JSON of the wrong shape counts as a new turn', async () => {
    const { typeInto } = await load();
    for (const body of ['{}', '{"v":1,"session":"abc"}', '{"v":1,"session":5,"at":"2026-11-15T10:00:00Z"}', '{"v":1,"session":"abc","at":"nope"}']) {
      const s = setup();
      reading(s.p.dir, FROZEN, T0);
      fs.writeFileSync(path.join(s.p.dir, 'lead-turn.json'), body);
      assert.equal(await typeInto(PROMPT, s.opts), 'failed: turn changed', body);
      assert.deepEqual(s.r.calls, [], body);
    }
  });

  test('a mark one second after the Stop reading -> nothing typed', async () => {
    const { typeInto } = await load();
    const s = setup();
    reading(s.p.dir, FROZEN, T0);
    mark(s.p.dir, FROZEN, '2026-11-15T10:00:01.000Z');
    assert.equal(await typeInto(PROMPT, s.opts), 'failed: turn changed');
    assert.deepEqual(s.r.calls, []);
  });

  test('the accepted reading is of another session than the one frozen -> nothing typed', async () => {
    const { typeInto } = await load();
    const s = setup();
    reading(s.p.dir, FROZEN, T0);
    s.opts.accepted = { session: 'ffffffffffff', at: iso(T0) };
    assert.equal(await typeInto(PROMPT, s.opts), 'failed: turn changed');
    assert.deepEqual(s.r.calls, []);
  });

  test('the new session marks a turn during the settle wait -> the prompt is not typed', async () => {
    const { typeInto } = await load();
    const s = setup();
    reading(s.p.dir, FROZEN, T0);
    s.c.onSleep = (ms, t) => { if (ms === 2000) mark(s.p.dir, NEW, new Date(t + 2000).toISOString()); };
    assert.equal(await typeInto(PROMPT, s.opts), 'failed: turn changed');
    assert.deepEqual(s.r.calls, ['/clear\r']);
  });
});

describe('turnOver and main hand the accepted reading to typeInto', () => {
  test('turnOver calls onAccept with the reading it accepted', async () => {
    const { turnOver } = await load();
    const p = product();
    fs.writeFileSync(path.join(p.dir, 'lead-context.json'), `${JSON.stringify({ v: 1, session: FROZEN, ctx: 1, peak: 1, at: iso(T0 + 5000), ttl: null })}\n`);
    let got = null;
    const out = await turnOver({ dir: p.dir, session: FROZEN, armAt: iso(T0), claudePid: 1, now: () => T0, sleep: async () => {}, onAccept: (o) => { got = o; } });
    assert.equal(out, 'done');
    assert.deepEqual({ session: got.session, at: got.at }, { session: FROZEN, at: iso(T0 + 5000) });
  });

  test('main passes that reading as `accepted` to the typer', async () => {
    const { main } = await load();
    const p = product();
    const slug = 'P20261115.000001/01-fix';
    p.dir = path.join(p.root, '.company', 'work', 'P20261115.000001', '01-fix');
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, 'lead-replace.json'), `${JSON.stringify({ v: 1, session: FROZEN, armAt: iso(T0), state: 'waiting-background' })}\n`);
    fs.writeFileSync(path.join(p.dir, 'lead-context.json'), `${JSON.stringify({ v: 1, session: FROZEN, ctx: 1, peak: 1, at: iso(T0 + 5000), ttl: null })}\n`);
    let seen = null;
    const type = async (text, o) => { seen = o.accepted; return 'typed'; };
    const code = await main([slug, '4242'], p.root, { alive: () => true, identify: async () => ({ image: 'claude.exe', created: 1 }), list: async () => [], type, now: () => T0 + 6000, sleep: async () => {} });
    assert.equal(code, 0);
    assert.deepEqual({ session: seen.session, at: seen.at }, { session: FROZEN, at: iso(T0 + 5000) });
  });
});
