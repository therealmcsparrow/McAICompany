import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readCost, costText, metricsPath } from './cost-source.mjs';
import { main } from './ledger.mjs';
import { append } from './run-state.mjs';

const here = import.meta.dirname;
const FIXTURE = path.join(here, 'fixtures', 'cost', 's1-body.jsonl');
const LEDGER_FIXTURES = path.join(here, 'fixtures', 'ledger-v1');
const SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const RUN = 'demo';
// The fixture's points lie between 1793235661173 ms and 1793235662481 ms.
const T0 = 1793235660000;
const T_SUB = T0 + 10000;
const T_END = T0 + 20000;
const TEXT = 'cost 0.03 USD (approximate, Claude Code telemetry)';

// A per-test project root and a per-test MCSPARROW_HOME; nothing reads the real home.
function sandbox(t, { sessions = [SESSION] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-cost-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'product');
  const home = path.join(dir, 'home');
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(home, 'otel'), { recursive: true });
  const was = process.env.MCSPARROW_HOME;
  process.env.MCSPARROW_HOME = home;
  t.after(() => {
    if (was === undefined) delete process.env.MCSPARROW_HOME;
    else process.env.MCSPARROW_HOME = was;
  });
  const sb = { dir, root, home, file: path.join(home, 'otel', 'metrics.jsonl') };
  if (sessions) startRun(sb, RUN, sessions);
  return sb;
}

function startRun(sb, run, sessions, { end = T_END } = {}) {
  append(sb.root, run, { ev: 'start' }, { now: T0 });
  sessions.forEach((session, i) => {
    const id = String(i).padStart(12, '0');
    append(sb.root, run, { ev: 'sub', role: 'architect', id, phase: 'start', session }, { now: T_SUB });
    append(sb.root, run, { ev: 'sub', role: 'architect', id, phase: 'stop', session }, { now: T_SUB + 1000 });
  });
  append(sb.root, run, { ev: 'gate', gate: 'ship', result: 'passed' }, { now: end });
}

const fixtureText = () => fs.readFileSync(FIXTURE, 'utf8');
const nano = (ms, extra = 0n) => String(BigInt(ms) * 1000000n + extra);

// One OTLP metrics line with a single cost point.
function body({ session = SESSION, start = nano(T0 + 5000), time = nano(T0 + 6000), value = { asDouble: 0.01 }, temporality = 1, unit = 'USD', name = 'claude_code.cost.usage', attrs, extraAttrs = [] } = {}) {
  const attributes = attrs ?? [
    ...(session === null ? [] : [{ key: 'session.id', value: { stringValue: session } }]),
    { key: 'query_source', value: { stringValue: 'main' } },
    ...extraAttrs
  ];
  const sum = { isMonotonic: true, dataPoints: [{ attributes, startTimeUnixNano: start, timeUnixNano: time, ...value }] };
  if (temporality !== 'missing') sum.aggregationTemporality = temporality;
  return JSON.stringify({ resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [{ metrics: [{ name, unit, sum }] }] }] });
}

const write = (sb, text) => fs.writeFileSync(sb.file, text);
const none = (r, reason) => assert.deepEqual(r, { state: 'none', reason });
const read = (sb, run = RUN) => readCost(sb.root, run);
const score = (sb, run = RUN) => main(['scorecard', run], { root: sb.root, now: T_END });
const lastSegment = (line) => line.split(' | ').at(-1);

function ledgerShipped(sb, run = RUN) {
  const dir = path.join(sb.root, '.company', 'ledger');
  fs.mkdirSync(dir, { recursive: true });
  const recs = [
    { v: 1, run, kind: 'step', id: '01', role: 'architect', agent: 'a1', src: 'notification', ctx_end: 100 },
    { v: 1, run, kind: 'step', id: '01', role: 'architect', agent: 'a1', src: 'transcript', tokens: { in: 400, cache_write: 0, cache_read: 5, out: 0 } },
    { v: 1, run, kind: 'ship', acs: 4, fix_rounds: 2, high_blockers: 0, t_start: '2026-10-01T09:00:00Z', t_ship: '2026-10-01T10:05:00Z' }
  ];
  fs.writeFileSync(path.join(dir, `${run}.jsonl`), `${recs.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

describe('the captured body', () => {
  test('a session inside the window gives the sum and the scorecard segment', (t) => {
    const sb = sandbox(t);
    write(sb, fixtureText());
    const r = read(sb);
    assert.deepEqual(r, { state: 'recorded', micros: 32000, points: 3, skipped: 0 });
    assert.equal(costText(r), TEXT);
    ledgerShipped(sb);
    const out = score(sb);
    assert.equal(out.code, 0);
    assert.equal(lastSegment(out.lines[0]), TEXT);
  });

  test('the file path is under MCSPARROW_HOME, else the user home', (t) => {
    const sb = sandbox(t);
    assert.equal(metricsPath(), path.join(sb.home, 'otel', 'metrics.jsonl'));
    delete process.env.MCSPARROW_HOME;
    assert.equal(metricsPath(), path.join(os.homedir(), '.mcsparrow', 'otel', 'metrics.jsonl'));
  });

  test('the fixture has the account attributes, none of them is output', (t) => {
    const sb = sandbox(t);
    const raw = fixtureText();
    for (const secret of ['fixture.person@example.invalid', 'acct-uuid-fixture', 'acct-id-fixture', 'org-fixture', 'user.email']) {
      assert.ok(raw.includes(secret), `fixture carries ${secret}`);
    }
    write(sb, raw);
    ledgerShipped(sb);
    const seen = [JSON.stringify(read(sb)), costText(read(sb)), ...score(sb).lines, ...main(['receipt', RUN], { root: sb.root, now: T_END }).lines];
    for (const text of seen) {
      for (const secret of ['fixture.person', 'example.invalid', 'acct-', 'org-fixture', 'user.', SESSION, 'session']) {
        assert.ok(!text.includes(secret), `${secret} in output: ${text}`);
      }
    }
  });
});

describe('rounding', () => {
  test('a non-zero sum under half a cent says under 0.01', (t) => {
    const sb = sandbox(t);
    write(sb, `${body({ value: { asDouble: 0.004 } })}\n`);
    const r = read(sb);
    assert.equal(r.micros, 4000);
    assert.equal(costText(r), 'cost under 0.01 USD (approximate, Claude Code telemetry)');
  });

  test('half a cent rounds up, a zero sum prints 0.00', (t) => {
    const sb = sandbox(t);
    write(sb, `${body({ value: { asDouble: 0.005 } })}\n`);
    assert.equal(costText(read(sb)), 'cost 0.01 USD (approximate, Claude Code telemetry)');
    write(sb, `${body({ value: { asDouble: 0.00499 } })}\n`);
    assert.equal(costText(read(sb)), 'cost under 0.01 USD (approximate, Claude Code telemetry)');
    write(sb, `${body({ value: { asDouble: 0 } })}\n`);
    assert.equal(costText(read(sb)), 'cost 0.00 USD (approximate, Claude Code telemetry)');
    write(sb, `${body({ value: { asDouble: 12.345 } })}\n`);
    assert.equal(costText(read(sb)), 'cost 12.35 USD (approximate, Claude Code telemetry)');
  });

  test('the scorecard segment follows the same text', (t) => {
    const sb = sandbox(t);
    ledgerShipped(sb);
    write(sb, `${body({ value: { asDouble: 0.004 } })}\n`);
    assert.equal(lastSegment(score(sb).lines[0]), 'cost under 0.01 USD (approximate, Claude Code telemetry)');
  });
});

describe('not recorded', () => {
  const cases = [
    ['a point of another session', () => body({ session: OTHER }), 'no-points'],
    ['a point before the window', () => body({ start: nano(T0 - 9000), time: nano(T0 - 1000) }), 'no-points'],
    ['a point after the window', () => body({ start: nano(T_END + 1000), time: nano(T_END + 2000) }), 'no-points'],
    ['a point without session.id', () => body({ session: null }), 'no-points'],
    ['temporality 2', () => body({ temporality: 2 }), 'temporality'],
    ['temporality 0', () => body({ temporality: 0 }), 'temporality'],
    ['temporality missing', () => body({ temporality: 'missing' }), 'temporality'],
    ['temporality as text', () => body({ temporality: '1' }), 'temporality'],
    ['another unit', () => body({ unit: 'tokens' }), 'no-points'],
    ['another metric', () => body({ name: 'claude_code.token.usage' }), 'no-points'],
    ['an empty file', () => '', 'no-points']
  ];
  for (const [name, make, reason] of cases) {
    test(name, (t) => {
      const sb = sandbox(t);
      write(sb, `${make()}\n`);
      none(read(sb), reason);
      ledgerShipped(sb);
      assert.equal(lastSegment(score(sb).lines[0]), 'cost: not recorded');
    });
  }

  test('a missing file', (t) => {
    const sb = sandbox(t);
    none(read(sb), 'no-file');
    ledgerShipped(sb);
    assert.equal(lastSegment(score(sb).lines[0]), 'cost: not recorded');
  });

  test('a link to the file', (t) => {
    const sb = sandbox(t);
    const real = path.join(sb.dir, 'real.jsonl');
    fs.writeFileSync(real, fixtureText());
    try {
      fs.symlinkSync(real, sb.file);
    } catch {
      t.skip('symlinks not permitted here');
      return;
    }
    none(read(sb), 'unreadable');
  });

  test('a directory in the file place, and a link as the folder', (t) => {
    const sb = sandbox(t);
    fs.mkdirSync(sb.file);
    none(read(sb), 'unreadable');
    const elsewhere = path.join(sb.dir, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, 'metrics.jsonl'), fixtureText());
    fs.rmSync(path.join(sb.home, 'otel'), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(sb.home, 'otel'), 'junction');
    none(read(sb), 'unreadable');
  });

  test('a hard-linked file', (t) => {
    const sb = sandbox(t);
    write(sb, fixtureText());
    fs.linkSync(sb.file, path.join(sb.dir, 'second'));
    none(read(sb), 'unreadable');
  });

  test('an over-cap file and an over-cap line', (t) => {
    const sb = sandbox(t);
    write(sb, fixtureText());
    none(readCost(sb.root, RUN, { limits: { file: 100 } }), 'too-large');
    none(readCost(sb.root, RUN, { limits: { line: 100 } }), 'too-large');
    assert.equal(readCost(sb.root, RUN, { limits: { file: 1 << 20, line: 1 << 20 } }).state, 'recorded');
  });

  test('the real caps are 256 MiB and 1 MiB', (t) => {
    const sb = sandbox(t);
    write(sb, `${'x'.repeat(1024 * 1024 + 1)}\n${fixtureText()}`);
    none(read(sb), 'too-large');
    write(sb, `{"pad":"${'x'.repeat(1024 * 1024 - 20)}"}\n${fixtureText()}`);
    const r = read(sb);
    assert.equal(r.state, 'recorded');
    assert.equal(r.skipped, 1);
  });

  test('a run without a recorded session never opens the file', (t) => {
    const sb = sandbox(t, { sessions: [] });
    startRun(sb, 'bare', []);
    none(readCost(sb.root, 'bare'), 'no-session');
    none(readCost(sb.root, 'never-started'), 'no-session');
    none(readCost(sb.root, 'Bad Slug'), 'no-session');
    // a directory in the file's place would be 'unreadable' if it were opened
    fs.mkdirSync(sb.file);
    none(readCost(sb.root, 'bare'), 'no-session');
  });
});

describe('temporality is judged on the matched sessions only', () => {
  test('a cumulative point of another session does not matter', (t) => {
    const sb = sandbox(t);
    write(sb, `${body({ session: OTHER, temporality: 2, value: { asDouble: 5 } })}\n${fixtureText()}`);
    assert.deepEqual(read(sb), { state: 'recorded', micros: 32000, points: 3, skipped: 0 });
  });

  test('one non-delta point of a matched session gives none, with no partial sum', (t) => {
    const sb = sandbox(t);
    write(sb, `${fixtureText()}${body({ temporality: 2, value: { asDouble: 5 } })}\n`);
    none(read(sb), 'temporality');
    write(sb, `${body({ temporality: 2, value: { asDouble: 5 } })}\n${fixtureText()}`);
    none(read(sb), 'temporality');
  });

  test('a cumulative point outside the window still decides for its matched session', (t) => {
    const sb = sandbox(t);
    write(sb, `${fixtureText()}${body({ temporality: 2, start: nano(T0 - 9000), time: nano(T0 - 1000) })}\n`);
    none(read(sb), 'temporality');
  });
});

describe('the window', () => {
  const START_NS = BigInt(T0) * 1000000n;
  const END_NS = BigInt(T_END) * 1000000n;
  test('the run window is the start record to the last record', (t) => {
    const sb = sandbox(t);
    write(sb, `${body({ start: nano(T0 + 1000), time: nano(T_END - 1000) })}\n`);
    assert.equal(read(sb).state, 'recorded');
  });

  test('the edges are inclusive, to the nanosecond', (t) => {
    const sb = sandbox(t);
    const at = (s, e) => {
      write(sb, `${body({ start: String(s), time: String(e) })}\n`);
      return read(sb);
    };
    assert.equal(at(START_NS - 5000n, START_NS).state, 'recorded');
    assert.equal(at(START_NS - 5000n, START_NS - 1n).state, 'none');
    assert.equal(at(END_NS, END_NS + 5000n).state, 'recorded');
    assert.equal(at(END_NS + 1n, END_NS + 5000n).state, 'none');
    // above 2^53 a float would merge neighbouring nanoseconds
    assert.ok(START_NS > 2n ** 53n);
    assert.equal(Number(START_NS - 1n), Number(START_NS));
    assert.equal(at(START_NS - 5000n, START_NS - 1n).state, 'none');
  });

  test('an interval that spans the whole window, or reaches in from one side, counts whole', (t) => {
    const sb = sandbox(t);
    write(sb, `${body({ start: nano(T0 - 30000), time: nano(T_END + 30000), value: { asDouble: 0.5 } })}\n`);
    assert.equal(read(sb).micros, 500000);
  });

  test('times as numbers that are not safe integers, or as junk, do not count', (t) => {
    const sb = sandbox(t);
    for (const bad of [{ time: Number(nano(T0 + 1000)) }, { time: 'abc' }, { time: '-5' }, { time: '1e18' }, { start: null }, { start: nano(T0 + 5000), time: nano(T0 + 4000) }]) {
      write(sb, `${body({ ...bad })}\n`);
      assert.equal(read(sb).state, 'none', JSON.stringify(bad));
    }
  });
});

describe('values and attributes', () => {
  test('asInt as a number or a decimal string, asDouble, all scaled once', (t) => {
    const sb = sandbox(t);
    write(sb, [body({ value: { asInt: 2 } }), body({ value: { asInt: '3' } }), body({ value: { asDouble: 0.000001 } })].join('\n'));
    assert.deepEqual(read(sb), { state: 'recorded', micros: 5000001, points: 3, skipped: 0 });
  });

  test('sums are exact in integer micro-USD', (t) => {
    const sb = sandbox(t);
    write(sb, `${Array.from({ length: 1000 }, () => body({ value: { asDouble: 0.000001 } })).join('\n')}\n`);
    assert.equal(read(sb).micros, 1000);
  });

  test('bad values are skipped and counted: negative, not finite, both fields, text, huge', (t) => {
    const sb = sandbox(t);
    const bads = [{ asDouble: -1 }, { asDouble: 'x' }, { asInt: 'x' }, { asInt: '1.5' }, { asInt: -3 }, { asDouble: 1, asInt: 1 }, { asDouble: 1e300 }, {}, { asInt: '99999999999999999999' }];
    write(sb, `${bads.map((value) => body({ value })).join('\n')}\n${body({ value: { asDouble: 0.01 } })}\n`);
    assert.deepEqual(read(sb), { state: 'recorded', micros: 10000, points: 1, skipped: bads.length });
  });

  test('query_source of any value counts, and the attribute is not needed', (t) => {
    const sb = sandbox(t);
    const sources = ['main', 'subagent', 'auxiliary', 'something-new'];
    write(sb, `${sources.map((s) => body({ attrs: [{ key: 'session.id', value: { stringValue: SESSION } }, { key: 'query_source', value: { stringValue: s } }] })).join('\n')}\n${body({ attrs: [{ key: 'session.id', value: { stringValue: SESSION } }] })}\n`);
    assert.equal(read(sb).points, 5);
  });

  test('session.id is matched by exact key and exact value', (t) => {
    const LETTERS = 'abcdef01-2345-4678-89ab-cdef01234567';
    const sb = sandbox(t, { sessions: [LETTERS] });
    const mk = (key, value) => body({ attrs: [{ key, value }] });
    write(sb, [
      mk('session_id', { stringValue: LETTERS }),
      mk('Session.id', { stringValue: LETTERS }),
      mk('session.id', { stringValue: LETTERS.toUpperCase() }),
      mk('session.id', { stringValue: ` ${LETTERS}` }),
      mk('session.id', { stringValue: `${LETTERS}x` }),
      mk('session.id', { intValue: '1' }),
      mk('session.id', { stringValue: 7 }),
      mk('session.id', 'text'),
      JSON.stringify({ resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: 'claude_code.cost.usage', unit: 'USD', sum: { aggregationTemporality: 1, dataPoints: [{ attributes: { 'session.id': LETTERS }, startTimeUnixNano: nano(T0 + 1000), timeUnixNano: nano(T0 + 2000), asDouble: 1 }] } }] }] }] })
    ].join('\n'));
    none(read(sb), 'no-points');
  });

  test('a session.id that appears twice with different values is not attributed', (t) => {
    const sb = sandbox(t);
    const dup = (a, b) => body({ attrs: [{ key: 'session.id', value: { stringValue: a } }, { key: 'session.id', value: { stringValue: b } }] });
    write(sb, `${dup(SESSION, OTHER)}\n`);
    none(read(sb), 'no-points');
    write(sb, `${dup(SESSION, SESSION)}\n`);
    assert.equal(read(sb).state, 'recorded');
  });

  test('every session of the run counts: the Lead and a further one', (t) => {
    const sb = sandbox(t, { sessions: [SESSION, OTHER] });
    write(sb, `${body({ session: SESSION })}\n${body({ session: OTHER })}\n${body({ session: '33333333-3333-4333-8333-333333333333' })}\n`);
    assert.equal(read(sb).micros, 20000);
  });

  test('unknown fields are ignored and prototype keys do nothing', (t) => {
    const sb = sandbox(t);
    const line = body().replace('{"resourceMetrics"', '{"__proto__":{"resourceMetrics":[]},"extra":1,"resourceMetrics"');
    write(sb, `${line}\n`);
    assert.equal(read(sb).micros, 10000);
    assert.equal({}.resourceMetrics, undefined);
    write(sb, '{"__proto__":{"resourceMetrics":[1]}}\n');
    none(read(sb), 'no-points');
    assert.equal({}.resourceMetrics, undefined);
  });

  test('a metric whose sum, points or attributes have the wrong shape is skipped without a throw', (t) => {
    const sb = sandbox(t);
    const m = (metric) => JSON.stringify({ resourceMetrics: [{ scopeMetrics: [{ metrics: [metric] }] }] });
    write(sb, [
      m(null), m('x'), m({ name: 'claude_code.cost.usage', unit: 'USD' }), m({ name: 'claude_code.cost.usage', unit: 'USD', sum: [] }),
      m({ name: 'claude_code.cost.usage', unit: 'USD', sum: { aggregationTemporality: 1, dataPoints: 'x' } }),
      m({ name: 'claude_code.cost.usage', unit: 'USD', sum: { aggregationTemporality: 1, dataPoints: [null, 3, { attributes: 'x' }] } }),
      JSON.stringify({ resourceMetrics: [null, { scopeMetrics: 'x' }, { scopeMetrics: [null, { metrics: 'x' }] }] })
    ].join('\n'));
    none(read(sb), 'no-points');
  });
});

describe('lines', () => {
  test('a truncated last line is skipped and counted, the rest counts', (t) => {
    const sb = sandbox(t);
    const last = body();
    write(sb, `${fixtureText()}${last.slice(0, last.length - 40)}`);
    assert.deepEqual(read(sb), { state: 'recorded', micros: 32000, points: 3, skipped: 1 });
  });

  test('a line that is not an object with resourceMetrics is skipped and counted', (t) => {
    const sb = sandbox(t);
    write(sb, `[]\n"x"\n42\nnull\n{}\n{"resourceMetrics":5}\nnot json\n${fixtureText()}`);
    assert.deepEqual(read(sb), { state: 'recorded', micros: 32000, points: 3, skipped: 7 });
  });

  test('blank lines and CRLF line ends are fine and not counted', (t) => {
    const sb = sandbox(t);
    write(sb, `\n${fixtureText().replace(/\n/g, '\r\n')}\n`);
    assert.deepEqual(read(sb), { state: 'recorded', micros: 32000, points: 3, skipped: 0 });
  });

  test('a last line without a newline that parses counts', (t) => {
    const sb = sandbox(t);
    write(sb, body());
    assert.equal(read(sb).state, 'recorded');
  });
});

describe('the source', () => {
  const src = fs.readFileSync(path.join(here, 'cost-source.mjs'), 'utf8');
  test('no path computes cost from tokens or reads the request events', () => {
    for (const bad of ['api_request', 'cost_usd', 'input_tokens', 'output_tokens', 'token.usage', 'price', 'cache_read']) {
      assert.ok(!src.includes(bad), `cost-source.mjs mentions ${bad}`);
    }
    assert.ok(src.includes('claude_code.cost.usage'));
  });

  test('it reads no environment variable beyond MCSPARROW_HOME and no OTEL_ variable', () => {
    assert.ok(!/OTEL_/.test(src));
    assert.deepEqual([...src.matchAll(/process\.env\.(\w+)/g)].map((m) => m[1]), ['MCSPARROW_HOME']);
  });

  test('it keeps no account or resource attribute names', () => {
    for (const bad of ['user.email', 'account_uuid', 'account_id', 'organization.id', 'user.id']) {
      assert.ok(!src.includes(bad), `cost-source.mjs mentions ${bad}`);
    }
  });

  test('it prints nothing and imports only built-ins and run-state', () => {
    assert.ok(!/console\.|process\.stdout|process\.stderr/.test(src));
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]).sort();
    assert.deepEqual(imports, ['./run-state.mjs', 'node:fs', 'node:os', 'node:path']);
  });

  test('the words bill, charge and spend never describe the number', () => {
    const text = [costText({ state: 'recorded', micros: 1234567, points: 1, skipped: 0 }), costText({ state: 'none', reason: 'no-file' })].join(' ');
    assert.ok(!/(bill|billed|charge|spend)/i.test(text));
    assert.ok(!/(bill|billed|charge|spend)/i.test(src));
  });
});

describe('receipt', () => {
  const receipt = (sb, ...rest) => main(['receipt', RUN, ...rest], { root: sb.root, now: T_END });

  test('prints only recorded keys: no ledger, no run-state', (t) => {
    const sb = sandbox(t, { sessions: null });
    assert.deepEqual(receipt(sb), { code: 0, lines: ['no records for demo'] });
  });

  test('a ledger with time, tokens, Gates and Fix rounds, and the cost line when recorded', (t) => {
    const sb = sandbox(t);
    ledgerShipped(sb);
    write(sb, fixtureText());
    const out = receipt(sb);
    assert.equal(out.code, 0);
    assert.deepEqual(out.lines, [
      'receipt demo',
      'time 1h05m',
      'tokens in 400, cache_write 0, cache_read 5, out 0',
      'gates ship passed',
      'fix rounds 2',
      TEXT
    ]);
  });

  test('no cost line when cost is not recorded, no time saved without a baseline', (t) => {
    const sb = sandbox(t);
    ledgerShipped(sb);
    const out = receipt(sb);
    assert.ok(out.lines.every((l) => !l.startsWith('cost') && !l.startsWith('time saved')));
    assert.ok(!out.lines.join('\n').includes('not recorded'));
  });

  test('a ledger without a ship record prints only what is recorded', (t) => {
    const sb = sandbox(t, { sessions: null });
    const dir = path.join(sb.root, '.company', 'ledger');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${RUN}.jsonl`), `${JSON.stringify({ v: 1, run: RUN, kind: 'step', id: '01', role: 'architect', agent: 'a1', src: 'transcript', tokens: { in: 1, cache_write: 2, cache_read: 3, out: 4 } })}\n`);
    assert.deepEqual(receipt(sb).lines, ['receipt demo', 'tokens in 1, cache_write 2, cache_read 3, out 4']);
  });

  test('time saved only with a baseline run on record and only when faster', (t) => {
    const sb = sandbox(t);
    ledgerShipped(sb);
    const dir = path.join(sb.root, '.company', 'ledger');
    const base = (name, minutes) => fs.writeFileSync(path.join(dir, `${name}.jsonl`), `${JSON.stringify({ v: 1, run: name, kind: 'ship', acs: 1, t_start: '2026-09-01T09:00:00Z', t_ship: new Date(Date.parse('2026-09-01T09:00:00Z') + minutes * 60000).toISOString().replace('.000Z', 'Z') })}\n`);
    base('old-a', 100);
    base('old-b', 120);
    base('old-c', 140);
    const out = receipt(sb, '--baseline', 'old-a,old-b,old-c');
    assert.ok(out.lines.includes('time saved 55m (baseline median 2h00m of 3 runs)'), out.lines.join('\n'));
    base('old-a', 10);
    base('old-b', 20);
    base('old-c', 30);
    assert.ok(receipt(sb, '--baseline', 'old-a,old-b,old-c').lines.every((l) => !l.startsWith('time saved')));
    assert.ok(receipt(sb, '--baseline', 'old-missing').lines.every((l) => !l.startsWith('time saved')));
    assert.equal(receipt(sb, '--baseline', 'old-a', '--baseline', 'old-b').code, 2);
  });

  test('usage errors are refused', (t) => {
    const sb = sandbox(t);
    assert.equal(main(['receipt'], { root: sb.root }).code, 2);
    assert.equal(main(['receipt', 'Bad Run'], { root: sb.root }).code, 2);
    assert.equal(main(['receipt', RUN, '--x'], { root: sb.root }).code, 2);
  });
});

describe('scorecard and report on the v1.4 fixtures', () => {
  const runs = fs.readdirSync(LEDGER_FIXTURES).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6));

  test('only the new last segment differs, report bytes do not change', (t) => {
    const sb = sandbox(t, { sessions: null });
    const dir = path.join(sb.root, '.company', 'ledger');
    fs.mkdirSync(dir, { recursive: true });
    for (const run of runs) fs.copyFileSync(path.join(LEDGER_FIXTURES, `${run}.jsonl`), path.join(dir, `${run}.jsonl`));
    let scored = 0;
    for (const run of runs) {
      const card = main(['scorecard', run], { root: sb.root, now: T_END }).lines;
      if (card[0].startsWith('scorecard ')) {
        scored += 1;
        assert.ok(card[0].endsWith(' | cost: not recorded'), card[0]);
        assert.ok(!card[0].slice(0, -' | cost: not recorded'.length).includes('cost'), card[0]);
      } else {
        assert.ok(!card[0].includes('cost'));
      }
      const report = main(['report', run], { root: sb.root, now: T_END }).lines.join('\n');
      const exp = path.join(LEDGER_FIXTURES, 'expected', `${run}.report.txt`);
      if (fs.existsSync(exp)) assert.equal(`${report}\n`, fs.readFileSync(exp, 'utf8').replace(/\r\n/g, '\n'), run);
    }
    assert.ok(scored >= 1);
  });
});

describe('the CLI', () => {
  test('scorecard and receipt run from the command line with MCSPARROW_HOME set', (t) => {
    const sb = sandbox(t);
    ledgerShipped(sb);
    write(sb, fixtureText());
    for (const [args, tail] of [[['scorecard', RUN], TEXT], [['receipt', RUN], TEXT]]) {
      const r = spawnSync(process.execPath, [path.join(here, 'ledger.mjs'), ...args], {
        cwd: sb.root,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, MCSPARROW_HOME: sb.home, HOME: sb.home, USERPROFILE: sb.home }
      });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.trimEnd().endsWith(tail), r.stdout);
      assert.ok(!r.stdout.includes('\r'));
    }
  });
});
