// The Lead cache clock follows the cache lifetime read from the transcript: 5 min, 1 h, or an assumed 1 h.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../mods/lib/cache-clock.mjs';
import * as guard from '../mods/lib/guard.mjs';
import { fmtClock } from '../mods/lib/format.mjs';

const { EMPTY_CLOCK, SUBAGENT_LINE, cacheClock, clockLines, clockStatus, noteRequest } = lib;
const MIN = 60_000;
const T0 = Date.parse('2026-10-26T10:00:00Z');

const ASSUMED = '1 h (assumed)';
const HOSTILE = [
  null,
  undefined,
  '',
  ' 5m',
  '5m ',
  '5M',
  '1H',
  '5m‮',
  '5m​',
  '‮5m',
  '5m\n1h',
  '5m\r\n',
  300000,
  5,
  0,
  NaN,
  true,
  {},
  { ttl: '5m' },
  ['5m'],
  '__proto__',
  'constructor',
  'toString',
  '2h',
  '10m',
  'x'.repeat(100000),
];

function fn(name) {
  assert.equal(typeof lib[name], 'function', `mods/lib/cache-clock.mjs exports ${name}`);
  return lib[name];
}

function view(state, nowMs) {
  const clock = cacheClock(state, nowMs);
  return { lines: clockLines(clock, fn('lifetimeLabel')(state)), status: clockStatus(clock) };
}

// ---- AC4: a 5 minute reading

test('AC4 noteTtl 5m keeps the last request and sets a measured 5 minute lifetime', () => {
  const noteTtl = fn('noteTtl');
  assert.deepEqual(noteTtl(EMPTY_CLOCK, '5m'), { lastRequestMs: null, lifetimeMs: 5 * MIN, source: 'measured' });
  assert.deepEqual(noteTtl(noteRequest(EMPTY_CLOCK, T0), '5m'), { lastRequestMs: T0, lifetimeMs: 5 * MIN, source: 'measured' });
});

test('AC4 a request after a 5m reading expires at the request plus 5 minutes', () => {
  const state = noteRequest(fn('noteTtl')(EMPTY_CLOCK, '5m'), T0);
  assert.deepEqual(cacheClock(state, T0), { kind: 'valid', expiresMs: T0 + 5 * MIN, minutesLeft: 5 });
  assert.equal(cacheClock(state, T0 + 5 * MIN - 1).kind, 'valid');
  assert.deepEqual(cacheClock(state, T0 + 5 * MIN), { kind: 'expired', expiresMs: T0 + 5 * MIN });
  assert.equal(cacheClock(state, T0 + 61 * MIN).kind, 'expired');
});

test('AC4 pane lines say Lifetime: 5 min (measured); the status reads 5m at the request and exp at +5 min', () => {
  const state = noteRequest(fn('noteTtl')(EMPTY_CLOCK, '5m'), T0);
  assert.equal(fn('lifetimeLabel')(state), '5 min (measured)');
  const at = view(state, T0);
  assert.deepEqual(at.lines, [`Lead cache: expires ${fmtClock(T0 + 5 * MIN)} (in 5 min)`, 'Lifetime: 5 min (measured)', SUBAGENT_LINE]);
  assert.equal(at.status, '5m');
  const mid = view(state, T0 + 2 * MIN + 1);
  assert.equal(mid.status, '3m');
  const gone = view(state, T0 + 5 * MIN);
  assert.deepEqual(gone.lines, [`Lead cache: expired ${fmtClock(T0 + 5 * MIN)}; the next turn rewrites it`, 'Lifetime: 5 min (measured)', SUBAGENT_LINE]);
  assert.equal(gone.status, 'exp');
});

test('AC4 a reading that arrives after the request applies from that request on', () => {
  const late = fn('noteTtl')(noteRequest(EMPTY_CLOCK, T0), '5m');
  const early = noteRequest(fn('noteTtl')(EMPTY_CLOCK, '5m'), T0);
  assert.deepEqual(late, early);
  assert.equal(view(late, T0 + MIN).status, '4m');
});

test('AC4 the reading persists across requests and changes only on a new reading', () => {
  const noteTtl = fn('noteTtl');
  let state = noteRequest(noteTtl(EMPTY_CLOCK, '5m'), T0);
  state = noteRequest(state, T0 + 10 * MIN);
  state = noteRequest(state, T0 + 20 * MIN, 'assumed');
  assert.deepEqual(state, { lastRequestMs: T0 + 20 * MIN, lifetimeMs: 5 * MIN, source: 'measured' });
  state = noteTtl(state, '1h');
  assert.deepEqual(state, { lastRequestMs: T0 + 20 * MIN, lifetimeMs: 60 * MIN, source: 'measured' });
  state = noteTtl(state, '5m');
  assert.equal(state.lifetimeMs, 5 * MIN);
});

test('AC4 an older request time never moves the clock back under a 5m reading', () => {
  const state = noteRequest(noteRequest(fn('noteTtl')(EMPTY_CLOCK, '5m'), T0 + 30 * MIN), T0 + 10 * MIN);
  assert.equal(state.lastRequestMs, T0 + 30 * MIN);
  assert.equal(cacheClock(state, T0 + 30 * MIN).expiresMs, T0 + 35 * MIN);
});

// ---- AC5: a 1 hour reading is the old output, byte for byte

test('AC5 a 1h reading gives the same state as noteRequest(EMPTY_CLOCK, t), whatever the order', () => {
  const noteTtl = fn('noteTtl');
  const old = noteRequest(EMPTY_CLOCK, T0);
  assert.deepEqual(noteRequest(noteTtl(EMPTY_CLOCK, '1h'), T0), old);
  assert.deepEqual(noteTtl(noteRequest(EMPTY_CLOCK, T0), '1h'), old);
  assert.equal(JSON.stringify(noteRequest(noteTtl(EMPTY_CLOCK, '1h'), T0)), JSON.stringify(old));
});

test('AC5 pane lines and status are byte-identical to the 1 h (measured) output', () => {
  const old = noteRequest(EMPTY_CLOCK, T0);
  const read = noteRequest(fn('noteTtl')(EMPTY_CLOCK, '1h'), T0);
  assert.equal(fn('lifetimeLabel')(read), lib.LIFETIME_LABEL);
  assert.equal(lib.LIFETIME_LABEL, '1 h (measured)');
  for (const offset of [0, 18 * MIN, 59 * MIN + 1, 60 * MIN, 70 * MIN]) {
    const clock = cacheClock(old, T0 + offset);
    assert.equal(JSON.stringify(view(read, T0 + offset).lines), JSON.stringify(clockLines(clock)), `lines at +${offset}`);
    assert.equal(view(read, T0 + offset).status, clockStatus(clock), `status at +${offset}`);
  }
  assert.equal(view(read, T0).status, '60m');
});

test('AC5 clockLines without a label keeps the v1.8 default', () => {
  const clock = cacheClock(noteRequest(EMPTY_CLOCK, T0), T0 + MIN);
  assert.equal(clockLines(clock)[1], 'Lifetime: 1 h (measured)');
  assert.equal(clockLines(clock, undefined)[1], 'Lifetime: 1 h (measured)');
});

// ---- AC6: unknown lifetime is an assumed hour, never a throw

test('AC6 noteRequest with the assumed fallback and no reading is 60 min, assumed', () => {
  assert.deepEqual(noteRequest(EMPTY_CLOCK, T0, 'assumed'), { lastRequestMs: T0, lifetimeMs: 60 * MIN, source: 'assumed' });
  assert.deepEqual(noteRequest(EMPTY_CLOCK, T0), { lastRequestMs: T0, lifetimeMs: 60 * MIN, source: 'measured' });
  assert.equal(fn('lifetimeLabel')(noteRequest(EMPTY_CLOCK, T0, 'assumed')), ASSUMED);
});

test('AC6 the assumed fallback never overrides a valid earlier reading', () => {
  for (const [ttl, ms] of [['5m', 5 * MIN], ['1h', 60 * MIN]]) {
    const state = noteRequest(fn('noteTtl')(EMPTY_CLOCK, ttl), T0, 'assumed');
    assert.deepEqual(state, { lastRequestMs: T0, lifetimeMs: ms, source: 'measured' });
  }
});

test('AC6 pane lines name 1 h (assumed) and count minutes against 60', () => {
  const state = noteRequest(EMPTY_CLOCK, T0, 'assumed');
  const { lines, status } = view(state, T0 + 18 * MIN);
  assert.deepEqual(lines, [`Lead cache: expires ${fmtClock(T0 + 60 * MIN)} (in 42 min)`, `Lifetime: ${ASSUMED}`, SUBAGENT_LINE]);
  assert.equal(status, '42m');
  assert.equal(view(state, T0 + 61 * MIN).status, 'exp');
});

for (const [index, bad] of HOSTILE.entries()) {
  test(`AC6 hostile reading #${index} gives 60 min, assumed, no throw`, () => {
    const noteTtl = fn('noteTtl');
    const shown = typeof bad === 'string' && bad.length > 100 ? `${bad.length} chars` : JSON.stringify(bad);
    const state = noteRequest(noteTtl(EMPTY_CLOCK, bad), T0);
    assert.equal(state.lastRequestMs, T0, shown);
    assert.equal(state.lifetimeMs, 60 * MIN, shown);
    assert.equal(state.source, 'assumed', shown);
    assert.equal(fn('lifetimeLabel')(state), ASSUMED, shown);
    const { lines, status } = view(state, T0 + MIN);
    assert.equal(status, '59m');
    const text = [...lines, status].join('\n');
    if (typeof bad === 'string' && bad.length > 0) assert.equal(text.includes(bad), false, 'the raw value is never shown');
    assert.match(text, /Lifetime: 1 h \(assumed\)/);
    // A bad reading also resets an earlier good one.
    const reset = noteTtl(noteTtl(EMPTY_CLOCK, '5m'), bad);
    assert.equal(reset.lifetimeMs, 60 * MIN, shown);
    assert.equal(reset.source, 'assumed', shown);
  });
}

test('AC6 noteTtl keeps the last request time through a bad reading', () => {
  const state = fn('noteTtl')(noteRequest(EMPTY_CLOCK, T0), 'nope');
  assert.deepEqual(state, { lastRequestMs: T0, lifetimeMs: 60 * MIN, source: 'assumed' });
});

test('AC6 noteTtl, noteRequest and lifetimeLabel survive hostile state', () => {
  const noteTtl = fn('noteTtl');
  const protoState = JSON.parse('{"__proto__":{"lastRequestMs":5,"lifetimeMs":300000,"source":"measured"}}');
  const states = [null, undefined, 0, 'x', [], {}, protoState, { lastRequestMs: 'a', lifetimeMs: 'b', source: 'c' }, { lastRequestMs: T0, lifetimeMs: 7 * MIN, source: 'measured' }, { lastRequestMs: T0, lifetimeMs: -1, source: 'assumed' }];
  for (const state of states) {
    assert.doesNotThrow(() => noteTtl(state, '5m'));
    assert.doesNotThrow(() => noteRequest(state, T0, 'assumed'));
    assert.doesNotThrow(() => fn('lifetimeLabel')(state));
    assert.equal(noteTtl(state, '5m').lastRequestMs === null || typeof noteTtl(state, '5m').lastRequestMs === 'number', true);
  }
  assert.equal(noteTtl(protoState, '5m').lastRequestMs, null);
});

test('AC6 a lifetime other than 5 or 60 minutes counts as 60 and is never trusted', () => {
  for (const lifetimeMs of [7 * MIN, 0, -1, NaN, '300000', null, 1e15]) {
    const state = { lastRequestMs: T0, lifetimeMs, source: 'measured' };
    assert.deepEqual(cacheClock(state, T0), { kind: 'valid', expiresMs: T0 + 60 * MIN, minutesLeft: 60 });
    const next = noteRequest(state, T0 + MIN, 'assumed');
    assert.equal(next.lifetimeMs, 60 * MIN);
    assert.equal(next.source, 'assumed');
  }
});

test('AC6 noteTtl does not change the state it is given', () => {
  const state = Object.freeze({ lastRequestMs: T0, lifetimeMs: 60 * MIN, source: 'measured' });
  const next = fn('noteTtl')(state, '5m');
  assert.notEqual(next, state);
  assert.equal(state.lifetimeMs, 60 * MIN);
});

test('AC6 an unknown clock has no lifetime line whatever the label', () => {
  assert.deepEqual(clockLines({ kind: 'unknown' }, '5 min (measured)'), ['Lead cache: unknown', SUBAGENT_LINE]);
});

// ---- guardLeadTtl: the one reader of the ttl key

const CTX = { v: 1, ctx: 42000, peak: 50000, at: '2026-10-26T10:05:00Z' };
const guardOf = () => {
  assert.equal(typeof guard.guardLeadTtl, 'function', 'mods/lib/guard.mjs exports guardLeadTtl');
  return guard.guardLeadTtl;
};
const ttlOf = (value) => {
  const out = guardOf()(value);
  return out === undefined ? undefined : out.ttl;
};

test('guardLeadTtl returns the ttl key of a ctx answer: 5m, 1h or null', () => {
  assert.equal(ttlOf({ ...CTX, ttl: '5m' }), '5m');
  assert.equal(ttlOf({ ...CTX, ttl: '1h' }), '1h');
  assert.equal(ttlOf({ ...CTX, ttl: null }), null);
});

test('guardLeadTtl reads a missing ttl key (an older script) as null', () => {
  assert.equal(ttlOf(CTX), null);
});

test('guardLeadTtl never lets a hostile value through', () => {
  for (const bad of HOSTILE.filter(v => v !== null && v !== undefined)) {
    const out = guardOf()({ ...CTX, ttl: bad });
    assert.ok(out === undefined || out.ttl === null, `ttl ${typeof bad === 'string' ? bad.slice(0, 20) : JSON.stringify(bad)}`);
  }
  assert.ok([undefined, null].includes(ttlOf(JSON.parse('{"v":1,"__proto__":{"ttl":"5m"}}'))), 'an inherited ttl is not read');
  for (const notAnAnswer of [null, undefined, 'x', 5, [], [{ ttl: '5m' }]]) {
    assert.ok([undefined, null].includes(ttlOf(notAnAnswer)), String(notAnAnswer));
  }
});
