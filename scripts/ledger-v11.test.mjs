import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateRecord, main } from './ledger.mjs';

const script = path.join(import.meta.dirname, 'ledger.mjs');
const FAKE_HOME = path.join(import.meta.dirname, '..', 'tests', 'fixtures', 'ledger', 'claude-home');
const NOW = Date.parse('2026-10-27T12:00:00Z');
const BASE_COMMIT = '246448c';

// Every test works in its own temp project dir, removed when the test ends.
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-v11-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  return { dir, home };
}

// In-process call with an injected root and clock.
// The plugin root points at a folder without plugin.json, so ship writes no meta line here.
const call = (sb, args, now = NOW) => main(args, { now, root: sb.dir, pluginRoot: sb.home });

function cli(sb, args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: sb.dir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: FAKE_HOME, HOME: sb.home, USERPROFILE: sb.home }
  });
  return { status: r.status, out: r.stdout };
}

const ledgerFile = (sb, name) => path.join(sb.dir, '.company', 'ledger', `${name}.jsonl`);
const readLines = (sb, name) => fs.readFileSync(ledgerFile(sb, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const writeLedger = (sb, name, text) => {
  fs.mkdirSync(path.dirname(ledgerFile(sb, name)), { recursive: true });
  fs.writeFileSync(ledgerFile(sb, name), text);
};
const isoSec = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const jl = (...recs) => `${recs.map((r) => JSON.stringify(r)).join('\n')}\n`;

const shipRec = (run, over = {}) => ({ v: 1, run, kind: 'ship', acs: 4, ...over });
const noteRec = (run, id, agent) => ({ v: 1, run, kind: 'step', id, role: 'architect', agent, src: 'notification', ctx_end: 100 });
const countRec = (run, id, agent, n) => ({
  v: 1, run, kind: 'step', id, role: 'architect', agent, src: 'transcript', tokens: { in: n, cache_write: 0, cache_read: 5, out: 0 }
});
const totalRec = (run, spend) => ({
  v: 1, run, kind: 'total', id: 'abcdef12', role: 'lead', src: 'transcript', dispatches: 1, tokens: { in: spend, cache_write: 0, cache_read: 0, out: 0 }
});
const goodNotification = noteRec('demo', '01', 'aaa111');

// A timed, reconciled run: `min` minutes of run time, `spend` over `acs` ACs.
function shipped(sb, name, { end = '2026-10-01T10:00:00Z', min = 60, wait = 10, spend = 400, acs = 4, ...extra } = {}) {
  const tShip = Date.parse(end);
  writeLedger(sb, name, jl(
    noteRec(name, '01', 'a1'),
    countRec(name, '01', 'a1', spend),
    shipRec(name, { acs, t_start: isoSec(tShip - min * 60000), t_ship: end, wait, ...extra })
  ));
}

// ---------- schema ----------

test('validateRecord accepts t0 and t1 only on a notification dispatch record', () => {
  const t1 = '2026-10-27T12:00:00Z';
  assert.equal(validateRecord({ ...goodNotification, t1 }).ok, true);
  assert.equal(validateRecord({ ...goodNotification, t1, t0: '2026-10-27T11:58:30Z' }).ok, true);
  assert.equal(validateRecord({ ...goodNotification, t1, t0: t1 }).ok, true);
  assert.equal(validateRecord({ ...goodNotification, t1: '2099-12-31T23:59:59Z' }).ok, true);
  assert.equal(validateRecord({ ...goodNotification, t1: '2026-01-01T00:00:00Z' }).ok, true);
  const counts = { in: 1, cache_write: 0, cache_read: 0, out: 0 };
  const bad = [
    { ...goodNotification, t0: t1 },
    { ...goodNotification, t1, t0: '2026-10-27T12:00:01Z' },
    { ...goodNotification, t1: '2026-10-27T12:00:00.000Z' },
    { ...goodNotification, t1: '2026-10-27t12:00:00z' },
    { ...goodNotification, t1: '2026-02-30T12:00:00Z' },
    { ...goodNotification, t1: '2026-10-27T24:00:00Z' },
    { ...goodNotification, t1: '2025-12-31T23:59:59Z' },
    { ...goodNotification, t1: '2100-01-01T00:00:00Z' },
    { ...goodNotification, t1: 1792000000 },
    { ...goodNotification, t1: '__proto__' },
    { v: 1, run: 'demo', kind: 'step', id: '01', role: 'architect', agent: 'a1', src: 'transcript', t1, tokens: counts },
    { v: 1, run: 'demo', kind: 'reflect', id: '01', role: 'lead', src: 'mod', t1, tokens: counts },
    { ...totalRec('demo', 1), t1 },
    shipRec('demo', { t1 })
  ];
  for (const rec of bad) assert.equal(validateRecord(rec).ok, false, JSON.stringify(rec));
});

test('validateRecord checks the v1.1 ship keys', () => {
  const full = shipRec('demo', {
    tier: 'high', t_start: '2026-10-27T10:00:00Z', t_ship: '2026-10-27T12:00:00Z', wait: 600, rej_brief: 1, rej_plan: 0, rej_ship: 1000
  });
  assert.equal(validateRecord(full).ok, true);
  assert.equal(validateRecord(shipRec('demo', { fix_rounds: 1 })).ok, true);
  assert.equal(validateRecord(shipRec('demo', { t_start: '2026-10-27T10:00:00Z', t_ship: '2026-10-27T10:00:00Z', wait: 0 })).ok, true);
  assert.equal(validateRecord({ ...full, wait: 7200 }).ok, true);
  const times = { t_start: '2026-10-27T10:00:00Z', t_ship: '2026-10-27T12:00:00Z' };
  const bad = [
    { ...full, tier: 'unknown' },
    { ...full, tier: 'extreme' },
    { ...full, tier: 3 },
    { ...full, t_ship: undefined },
    shipRec('demo', { t_ship: '2026-10-27T12:00:00Z' }),
    { ...full, t_start: '2026-10-27T12:00:01Z' },
    { ...full, wait: 7201 },
    { ...full, wait: -1 },
    { ...full, wait: 1.5 },
    { ...full, wait: '5' },
    { ...full, rej_ship: 1001 },
    { ...full, rej_brief: -1 },
    { ...full, note: 'free text' },
    { ...full, t0: '2026-10-27T10:00:00Z' },
    { ...full, t1: '2026-10-27T10:00:00Z' },
    shipRec('demo', { ...times, t_start: '2025-12-31T23:59:59Z' }),
    shipRec('demo', { ...times, t_ship: '2100-01-01T00:00:00Z' }),
    shipRec('demo', { wait: 31536001, t_start: '2026-01-01T00:00:00Z', t_ship: '2099-01-01T00:00:00Z' })
  ];
  for (const rec of bad) assert.equal(validateRecord(rec).ok, false, JSON.stringify(rec));
});

test('ship-only keys are refused on every other record', () => {
  const extras = [{ tier: 'low' }, { wait: 1 }, { rej_brief: 1 }, { rej_plan: 1 }, { rej_ship: 1 }, { t_start: '2026-10-27T10:00:00Z' }, { t_ship: '2026-10-27T10:00:00Z' }];
  for (const extra of extras) assert.equal(validateRecord({ ...goodNotification, ...extra }).ok, false, JSON.stringify(extra));
});

// ---------- add ----------

test('add stamps t1 from the clock and t0 from ms', (t) => {
  const sb = sandbox(t);
  assert.equal(call(sb, ['add', 'demo', 'step', '01', 'architect', 'a1', '500', '3', '90999']).code, 0);
  assert.equal(call(sb, ['add', 'demo', 'step', '02', 'architect', 'a2', '500']).code, 0);
  assert.equal(call(sb, ['add', 'demo', 'step', '03', 'architect', 'a3', '0', '0', '0']).code, 0);
  const [a, b, c] = readLines(sb, 'demo');
  assert.equal(a.t1, '2026-10-27T12:00:00Z');
  assert.equal(a.t0, '2026-10-27T11:58:30Z');
  assert.equal(a.ms, 90999);
  assert.equal(b.t1, '2026-10-27T12:00:00Z');
  assert.equal(Object.hasOwn(b, 't0'), false);
  assert.equal(c.t0, c.t1);
});

test('add refuses a clock or a t0 before 2026 and writes nothing', (t) => {
  const sb = sandbox(t);
  const early = call(sb, ['add', 'demo', 'step', '01', 'architect', 'a1', '5'], Date.parse('2025-12-31T23:59:59Z'));
  assert.equal(early.code, 2);
  assert.match(early.lines[0], /^refused: /);
  const justAfter = Date.parse('2026-01-01T00:00:30Z');
  const spans = call(sb, ['add', 'demo', 'step', '01', 'architect', 'a1', '5', '1', '31000'], justAfter);
  assert.equal(spans.code, 2);
  assert.equal(fs.existsSync(ledgerFile(sb, 'demo')), false);
  assert.equal(call(sb, ['add', 'demo', 'step', '01', 'architect', 'a1', '5', '1', '30000'], justAfter).code, 0);
});

test('the CLI uses the real clock and the working directory', (t) => {
  const sb = sandbox(t);
  assert.equal(cli(sb, ['add', 'demo', 'step', '01', 'architect', 'a1', '5', '1', '1000']).status, 0);
  const [rec] = readLines(sb, 'demo');
  assert.equal(validateRecord(rec).ok, true);
  assert.match(rec.t1, /^20\d\d-/);
});

test('main writes under the injected root, not the working directory', (t) => {
  const sb = sandbox(t);
  const other = sandbox(t);
  call(sb, ['add', 'demo', 'step', '01', 'architect', 'a1', '5']);
  assert.equal(fs.existsSync(ledgerFile(sb, 'demo')), true);
  assert.equal(fs.existsSync(ledgerFile(other, 'demo')), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), '.company', 'ledger', 'demo.jsonl')), false);
});

test('reconcile never copies t0 or t1 to a transcript record', (t) => {
  const sb = sandbox(t);
  cli(sb, ['add', 'demo', 'step', '01', 'architect', 'aaa111', '10', '1', '2000']);
  cli(sb, ['reconcile', 'demo']);
  const recs = readLines(sb, 'demo');
  assert.equal(recs.length, 2);
  assert.equal(recs[1].src, 'transcript');
  assert.equal(Object.hasOwn(recs[1], 't1'), false);
  assert.equal(Object.hasOwn(recs[1], 't0'), false);
});

// ---------- report ----------

test('report output for v1 ledgers matches the v1 script byte for byte', (t) => {
  const git = spawnSync('git', ['show', `${BASE_COMMIT}:scripts/ledger.mjs`], { cwd: import.meta.dirname, encoding: 'utf8' });
  if (git.status !== 0) return t.skip('base script not available');
  const sb = sandbox(t);
  const baseScript = path.join(sb.home, 'ledger-v1.mjs');
  fs.writeFileSync(baseScript, git.stdout);
  const mod = { v: 1, run: 'old', kind: 'reflect', id: 'RT', role: 'lead', src: 'mod', tokens: { in: 1, cache_write: 2, cache_read: 3, out: 4 } };
  writeLedger(sb, 'old', `${jl(
    noteRec('old', '01', 'a1'), countRec('old', '01', 'a1', 300), noteRec('old', '02', 'a2'), mod,
    shipRec('old', { acs: 3, fix_rounds: 1, high_blockers: 0 })
  )}not json\n`);
  writeLedger(sb, 'baseline-a', jl(totalRec('baseline-a', 1000), shipRec('baseline-a', { acs: 2 })));
  const env = { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: FAKE_HOME, HOME: sb.home, USERPROFILE: sb.home };
  const argLists = [['report', 'old'], ['report', 'old', '--baseline', 'baseline-a'], ['report', 'old', '--json'], ['report', 'nope'], ['brainstorm-report', 'old']];
  for (const args of argLists) {
    const before = spawnSync(process.execPath, [baseScript, ...args], { cwd: sb.dir, encoding: 'utf8', env });
    const after = spawnSync(process.execPath, [script, ...args], { cwd: sb.dir, encoding: 'utf8', env });
    assert.equal(after.stdout, before.stdout, args.join(' '));
    assert.equal(after.status, before.status, args.join(' '));
  }
});

test('report --acs sets the per-AC divisor without a ship record', (t) => {
  const sb = sandbox(t);
  writeLedger(sb, 'demo', jl(noteRec('demo', '01', 'a1'), countRec('demo', '01', 'a1', 300)));
  const withAcs = call(sb, ['report', 'demo', '--acs', '3']);
  assert.equal(withAcs.code, 0);
  assert.ok(withAcs.lines.includes('spend: 300 total, 100 per AC (3 ACs)'), withAcs.lines.join('|'));
  const none = 'spend: 300 total, per AC n/a (no shipped ACs recorded)';
  assert.ok(call(sb, ['report', 'demo']).lines.includes(none));
  assert.ok(call(sb, ['report', 'demo', '--acs', '0']).lines.includes(none));
  const json = JSON.parse(call(sb, ['report', 'demo', '--json', '--acs', '3']).lines[0]);
  assert.equal(json.per_ac.spend, 100);
});

test('report --acs beats the last ship record and refuses bad values', (t) => {
  const sb = sandbox(t);
  writeLedger(sb, 'demo', jl(countRec('demo', '01', 'a1', 300), shipRec('demo', { acs: 10 })));
  assert.ok(call(sb, ['report', 'demo', '--acs', '5']).lines.includes('spend: 300 total, 60 per AC (5 ACs)'));
  const bad = [['--acs'], ['--acs', '-1'], ['--acs', '1.5'], ['--acs', 'x'], ['--acs', '100001'], ['--acs', '1', '--acs', '2'], ['--acs', '1e3']];
  for (const flags of bad) assert.equal(call(sb, ['report', 'demo', ...flags]).code, 2, flags.join(' '));
});

// ---------- ship ----------

function writeRunState(sb, slug, events, steps = [['01-architect.md', 'architect', 'high']]) {
  const dir = path.join(sb.dir, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), jl(...events.map(([at, ev, rest]) => ({ v: 1, at, ev, ...rest }))));
  for (const [name, role, tier] of steps) {
    fs.writeFileSync(path.join(dir, name), `---\nstep: ${name.slice(0, 2)}\nrole: ${role}\ntask: x\nstatus: done\nround: 0\nbase-commit: abc1234\nrisk-tier: ${tier}\n---\n## Did\n`);
  }
}

const FULL_RUN = [
  ['2026-10-27T10:00:00Z', 'start'],
  ['2026-10-27T10:10:00Z', 'gate', { gate: 'brief', result: 'changed' }],
  ['2026-10-27T10:20:00Z', 'gate', { gate: 'brief', result: 'passed' }],
  ['2026-10-27T10:30:00Z', 'gate', { gate: 'plan', result: 'stopped' }],
  ['2026-10-27T10:40:00Z', 'gate', { gate: 'plan', result: 'changed' }],
  ['2026-10-27T10:50:00Z', 'gate', { gate: 'plan', result: 'passed' }],
  ['2026-10-27T11:30:00Z', 'gate', { gate: 'ship', result: 'passed' }]
];

test('ship fills the v1.1 keys from the run-state view and prints one scorecard line', (t) => {
  const sb = sandbox(t);
  writeRunState(sb, 'feat', FULL_RUN);
  const r = call(sb, ['ship', 'feat', '4', '1', '0']);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /^scorecard feat \(tier high\): time 1h30m \(no baseline\)/);
  assert.deepEqual(readLines(sb, 'feat'), [{
    v: 1, run: 'feat', kind: 'ship', acs: 4, fix_rounds: 1, high_blockers: 0, tier: 'high',
    t_start: '2026-10-27T10:00:00Z', t_ship: '2026-10-27T11:30:00Z', wait: 0, rej_brief: 1, rej_plan: 2, rej_ship: 0
  }]);
});

test('ship writes an untimed record when run-state is missing, open or has no passed ship Gate', (t) => {
  const sb = sandbox(t);
  const missing = call(sb, ['ship', 'a-run', '2']);
  assert.equal(missing.code, 0);
  assert.equal(missing.lines.length, 1);
  assert.match(missing.lines[0], /^scorecard a-run \(tier unknown\): time untimed /);
  assert.deepEqual(readLines(sb, 'a-run'), [{ v: 1, run: 'a-run', kind: 'ship', acs: 2 }]);
  writeRunState(sb, 'open', FULL_RUN.slice(0, 6));
  assert.equal(call(sb, ['ship', 'open', '2']).code, 0);
  assert.deepEqual(readLines(sb, 'open'), [{ v: 1, run: 'open', kind: 'ship', acs: 2 }]);
  writeRunState(sb, 'rejected', [...FULL_RUN.slice(0, 6), ['2026-10-27T11:30:00Z', 'gate', { gate: 'ship', result: 'stopped' }]]);
  assert.equal(call(sb, ['ship', 'rejected', '2']).code, 0);
  assert.deepEqual(readLines(sb, 'rejected'), [{ v: 1, run: 'rejected', kind: 'ship', acs: 2 }]);
});

test('ship survives a damaged run-state and a start before 2026', (t) => {
  const sb = sandbox(t);
  const dir = path.join(sb.dir, '.company', 'work', 'broken');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), '{"not":"a record"}\n\u0000\n');
  assert.equal(call(sb, ['ship', 'broken', '1']).code, 0);
  assert.deepEqual(readLines(sb, 'broken'), [{ v: 1, run: 'broken', kind: 'ship', acs: 1 }]);
  writeRunState(sb, 'ancient', [['2025-06-01T10:00:00Z', 'start'], ['2025-06-01T11:00:00Z', 'gate', { gate: 'ship', result: 'passed' }]]);
  const r = call(sb, ['ship', 'ancient', '1']);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 1);
  assert.deepEqual(readLines(sb, 'ancient'), [{ v: 1, run: 'ancient', kind: 'ship', acs: 1 }]);
});

test('ship leaves tier out when the view tier is unknown', (t) => {
  const sb = sandbox(t);
  writeRunState(sb, 'feat', FULL_RUN, []);
  assert.equal(call(sb, ['ship', 'feat', '4']).code, 0);
  const [rec] = readLines(sb, 'feat');
  assert.equal(Object.hasOwn(rec, 'tier'), false);
  assert.equal(rec.t_ship, '2026-10-27T11:30:00Z');
});

test('ship records an excluded run without v1.1 keys', (t) => {
  const sb = sandbox(t);
  for (const name of ['brainstorm-20261027-1000', 'replay-x', 'baseline-x']) {
    writeRunState(sb, name, FULL_RUN);
    const r = call(sb, ['ship', name, '3', '1', '2']);
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, ['ship recorded (excluded run)']);
    assert.deepEqual(readLines(sb, name), [{ v: 1, run: name, kind: 'ship', acs: 3, fix_rounds: 1, high_blockers: 2 }]);
  }
});

test('ship refuses bad arguments before writing', (t) => {
  const sb = sandbox(t);
  const bad = [
    ['ship'], ['ship', 'x'], ['ship', 'x', 'a'], ['ship', 'X', '1'], ['ship', 'x', '1', '2', '3', '4'], ['ship', 'x', '1', '--baseline'],
    ['ship', 'x', '1', '--baseline', 'A,b'], ['ship', 'x', '1', '--baseline', 'a', '--baseline', 'b']
  ];
  for (const args of bad) {
    const r = call(sb, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.lines[0], /^refused: /);
  }
  assert.equal(fs.existsSync(ledgerFile(sb, 'x')), false);
});

test('ship never writes a wait above the run time', (t) => {
  const sb = sandbox(t);
  writeRunState(sb, 'feat', FULL_RUN);
  assert.equal(call(sb, ['ship', 'feat', '1']).code, 0);
  const [rec] = readLines(sb, 'feat');
  assert.ok(rec.wait <= (Date.parse(rec.t_ship) - Date.parse(rec.t_start)) / 1000);
});

test('ship sums the Gate wait values from run-state v1.3', (t) => {
  const sb = sandbox(t);
  writeRunState(sb, 'feat', [
    ['2026-10-27T10:00:00Z', 'start'],
    ['2026-10-27T10:01:00Z', 'ask', { gate: 'brief' }],
    ['2026-10-27T10:11:00Z', 'gate', { gate: 'brief', result: 'passed' }],
    ['2026-10-27T10:20:00Z', 'ask', { gate: 'ship' }],
    ['2026-10-27T10:25:00Z', 'gate', { gate: 'ship', result: 'passed' }]
  ]);
  assert.equal(call(sb, ['ship', 'feat', '1']).code, 0);
  assert.equal(readLines(sb, 'feat')[0].wait, 900);
});

// ---------- scorecard ----------

test('scorecard says so for a missing ledger and a ledger with no ship record', (t) => {
  const sb = sandbox(t);
  assert.deepEqual(call(sb, ['scorecard', 'nope']), { code: 0, lines: ['no ledger for nope'] });
  writeLedger(sb, 'half', jl(noteRec('half', '01', 'a1')));
  assert.deepEqual(call(sb, ['scorecard', 'half']), { code: 0, lines: ['no ship record for half'] });
});

test('scorecard refuses a bad argument list', (t) => {
  const sb = sandbox(t);
  const bad = [['scorecard'], ['scorecard', 'X'], ['scorecard', 'a', '--x'], ['scorecard', 'a', '--baseline'], ['scorecard', 'a', 'b']];
  for (const args of bad) assert.equal(call(sb, args).code, 2, args.join(' '));
});

test('scorecard for a lone run reads no baseline and prints one line', (t) => {
  const sb = sandbox(t);
  shipped(sb, 'solo', { tier: 'medium', fix_rounds: 2, high_blockers: 0, rej_brief: 1, rej_plan: 0, rej_ship: 0, wait: 600 });
  assert.deepEqual(call(sb, ['scorecard', 'solo']), {
    code: 0,
    lines: [
      'scorecard solo (tier medium): time 1h00m (no baseline) | CEO wait 10m (no baseline) | spend/AC 100 (no baseline) | ' +
      'fix rounds 2 (no baseline) | high blockers 0 (no baseline) | gate rejects 1 (no baseline) | excluded: 0 | cost: not recorded'
    ]
  });
});

test('scorecard compares with the 5 newest earlier timed runs and shows n only under 5', (t) => {
  const sb = sandbox(t);
  ['02', '03', '04', '05', '06', '07'].forEach((d, i) => shipped(sb, `old-${d}`, {
    end: `2026-10-${d}T10:00:00Z`, min: 30 + i * 10, wait: 60 * (i + 1), spend: 400 * (i + 1), fix_rounds: i, high_blockers: 1, rej_brief: 0, rej_plan: 0, rej_ship: i
  }));
  shipped(sb, 'new', { end: '2026-10-20T10:00:00Z', min: 90, wait: 300, spend: 800, fix_rounds: 1, high_blockers: 0, rej_brief: 1, rej_plan: 0, rej_ship: 0 });
  shipped(sb, 'later', { end: '2026-10-25T10:00:00Z', min: 1 });
  // set = old-03..old-07 (old-02 is the 6th newest); `later` is not earlier than `new`
  assert.equal(
    call(sb, ['scorecard', 'new']).lines[0],
    'scorecard new (tier unknown): time 1h30m (median 1h00m) | CEO wait 5m (median 4m) | spend/AC 200 (median 400) | ' +
    'fix rounds 1 (median 3) | high blockers 0 (median 1) | gate rejects 1 (median 3) | all tiers | excluded: 0 | cost: not recorded'
  );
  assert.match(call(sb, ['scorecard', 'old-04']).lines[0], / \| all tiers n=2 \| excluded: 0 \| cost: not recorded$/);
});

test('scorecard medians of an even set round the mean of the middle two', (t) => {
  const sb = sandbox(t);
  shipped(sb, 'a-1', { end: '2026-10-02T10:00:00Z', min: 10, fix_rounds: 0 });
  shipped(sb, 'a-2', { end: '2026-10-03T10:00:00Z', min: 21, fix_rounds: 1 });
  shipped(sb, 'cur', { end: '2026-10-09T10:00:00Z', min: 5, fix_rounds: 0 });
  const line = call(sb, ['scorecard', 'cur']).lines[0];
  assert.match(line, /time 5m \(median 16m\)/);
  assert.match(line, /fix rounds 0 \(median 1\)/);
});

test('scorecard splits by tier at 5 same-tier runs and falls back to all tiers below that', (t) => {
  const sb = sandbox(t);
  for (let i = 1; i <= 5; i += 1) shipped(sb, `hi-${i}`, { end: `2026-10-0${i}T10:00:00Z`, min: 100, tier: 'high' });
  for (let i = 6; i <= 8; i += 1) shipped(sb, `lo-${i}`, { end: `2026-10-0${i}T10:00:00Z`, min: 10, tier: 'low' });
  shipped(sb, 'cur-high', { end: '2026-10-20T10:00:00Z', min: 50, tier: 'high' });
  shipped(sb, 'cur-low', { end: '2026-10-20T11:00:00Z', min: 50, tier: 'low' });
  const high = call(sb, ['scorecard', 'cur-high']).lines[0];
  assert.match(high, /\(tier high\): time 50m \(median 1h40m\)/);
  assert.match(high, / \| tier high \| excluded: 0 \| cost: not recorded$/);
  const low = call(sb, ['scorecard', 'cur-low']).lines[0];
  assert.match(low, /\(tier low\)/);
  assert.match(low, / \| all tiers \| excluded: 0 \| cost: not recorded$/);
  assert.match(low, /time 50m \(median 10m\)/);
});

test('scorecard excludes brainstorm, replay, baseline and untimed runs and ignores runs with no ship', (t) => {
  const sb = sandbox(t);
  shipped(sb, 'good', { end: '2026-10-02T10:00:00Z', min: 20 });
  for (const name of ['brainstorm-20261001-1000', 'replay-q', 'baseline-q']) shipped(sb, name, { end: '2026-10-03T10:00:00Z', min: 999 });
  writeLedger(sb, 'untimed', jl(shipRec('untimed')));
  writeLedger(sb, 'notshipped', jl(noteRec('notshipped', '01', 'a1')));
  shipped(sb, 'cur', { end: '2026-10-09T10:00:00Z', min: 30 });
  const line = call(sb, ['scorecard', 'cur']).lines[0];
  assert.match(line, /time 30m \(median 20m\)/);
  assert.match(line, / \| all tiers n=1 \| excluded: 4 \| cost: not recorded$/);
});

test('scorecard of an untimed run shows untimed and compares with every eligible run', (t) => {
  const sb = sandbox(t);
  shipped(sb, 'x-1', { end: '2026-10-02T10:00:00Z', min: 20, wait: 600 });
  shipped(sb, 'x-2', { end: '2099-01-02T10:00:00Z', min: 40, wait: 600 });
  writeLedger(sb, 'cur', jl(shipRec('cur', { acs: 1 })));
  const line = call(sb, ['scorecard', 'cur']).lines[0];
  assert.match(line, /^scorecard cur \(tier unknown\): time untimed \(median 30m\) \| CEO wait \? \(median 10m\) \| /);
  assert.match(line, / \| all tiers n=2 \| excluded: 0 \| cost: not recorded$/);
});

test('scorecard spend per AC needs counts, nothing unreconciled and acs above 0', (t) => {
  const sb = sandbox(t);
  writeLedger(sb, 'nocount', jl(noteRec('nocount', '01', 'a1'), shipRec('nocount')));
  writeLedger(sb, 'partial', jl(noteRec('partial', '01', 'a1'), countRec('partial', '01', 'a1', 100), noteRec('partial', '02', 'a2'), shipRec('partial')));
  writeLedger(sb, 'zero', jl(noteRec('zero', '01', 'a1'), countRec('zero', '01', 'a1', 100), shipRec('zero', { acs: 0 })));
  for (const name of ['nocount', 'partial', 'zero']) assert.match(call(sb, ['scorecard', name]).lines[0], /spend\/AC not reconciled \(no baseline\)/, name);
  shipped(sb, 'base-1', { end: '2026-10-02T10:00:00Z', spend: 400 });
  writeLedger(sb, 'base-2', jl(noteRec('base-2', '01', 'a1'), shipRec('base-2', { t_start: '2026-10-03T09:00:00Z', t_ship: '2026-10-03T10:00:00Z', wait: 0 })));
  shipped(sb, 'cur', { end: '2026-10-09T10:00:00Z', spend: 800 });
  assert.match(call(sb, ['scorecard', 'cur']).lines[0], /spend\/AC 200 \(median 100\)/);
});

test('scorecard shows a missing median or value as ?', (t) => {
  const sb = sandbox(t);
  shipped(sb, 'p-1', { end: '2026-10-02T10:00:00Z' });
  shipped(sb, 'cur', { end: '2026-10-09T10:00:00Z', fix_rounds: 1 });
  const line = call(sb, ['scorecard', 'cur']).lines[0];
  assert.match(line, /fix rounds 1 \(median \?\)/);
  assert.match(line, /high blockers \? \(median \?\)/);
  assert.match(line, /gate rejects \? \(median \?\)/);
});

test('scorecard 30% target: met, missed and not reconciled', (t) => {
  const sb = sandbox(t);
  const quality = (name, spend, fix, high) => writeLedger(sb, name, jl(
    totalRec(name, spend), shipRec(name, { acs: 1, ...(fix === undefined ? {} : { fix_rounds: fix, high_blockers: high }) })
  ));
  quality('baseline-a', 1000, 2, 1);
  quality('baseline-b', 1200, 4, 3);
  quality('baseline-c', 800, undefined);
  const base = ['--baseline', 'baseline-a,baseline-b,baseline-c'];
  // b = median(1000, 1200, 800) = 1000; quality medians over the two runs holding both: fix 3, high 2
  shipped(sb, 'good', { end: '2026-10-09T10:00:00Z', spend: 2800, acs: 4, fix_rounds: 3, high_blockers: 2 });
  assert.match(call(sb, ['scorecard', 'good', ...base]).lines[0], / \| 30% target: -30% vs 1000\/AC, met \| cost: not recorded$/);
  shipped(sb, 'slow', { end: '2026-10-10T10:00:00Z', spend: 2804, acs: 4, fix_rounds: 3, high_blockers: 2 });
  assert.match(call(sb, ['scorecard', 'slow', ...base]).lines[0], / \| 30% target: -30% vs 1000\/AC, missed \| cost: not recorded$/);
  shipped(sb, 'sloppy', { end: '2026-10-11T10:00:00Z', spend: 400, acs: 4, fix_rounds: 4, high_blockers: 2 });
  assert.match(call(sb, ['scorecard', 'sloppy', ...base]).lines[0], / \| 30% target: -90% vs 1000\/AC, missed \| cost: not recorded$/);
  shipped(sb, 'noq', { end: '2026-10-12T10:00:00Z', spend: 400, acs: 4 });
  assert.match(call(sb, ['scorecard', 'noq', ...base]).lines[0], / \| 30% target: -90% vs 1000\/AC, not reconciled \| cost: not recorded$/);
  writeLedger(sb, 'unrec', jl(noteRec('unrec', '01', 'a1'), shipRec('unrec', { fix_rounds: 0, high_blockers: 0 })));
  assert.match(call(sb, ['scorecard', 'unrec', ...base]).lines[0], / \| 30% target: n\/a vs 1000\/AC, not reconciled \| cost: not recorded$/);
  assert.doesNotMatch(call(sb, ['scorecard', 'good']).lines[0], /30% target/);
});

test('scorecard 30% target is not reconciled when no baseline holds both quality values or counts', (t) => {
  const sb = sandbox(t);
  writeLedger(sb, 'baseline-a', jl(totalRec('baseline-a', 1000), shipRec('baseline-a', { acs: 1, fix_rounds: 2 })));
  shipped(sb, 'cur', { spend: 400, acs: 4, fix_rounds: 0, high_blockers: 0 });
  assert.match(call(sb, ['scorecard', 'cur', '--baseline', 'baseline-a']).lines[0], / \| 30% target: -90% vs 1000\/AC, not reconciled \| cost: not recorded$/);
  assert.match(call(sb, ['scorecard', 'cur', '--baseline', 'baseline-missing']).lines[0], / \| 30% target: n\/a vs \?\/AC, not reconciled \| cost: not recorded$/);
});

test('ship --baseline prints the 30% target in its one line', (t) => {
  const sb = sandbox(t);
  writeLedger(sb, 'baseline-a', jl(totalRec('baseline-a', 1000), shipRec('baseline-a', { acs: 1, fix_rounds: 2, high_blockers: 1 })));
  writeLedger(sb, 'feat', jl(noteRec('feat', '01', 'a1'), countRec('feat', '01', 'a1', 600)));
  const r = call(sb, ['ship', 'feat', '1', '1', '1', '--baseline', 'baseline-a']);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], / \| 30% target: -40% vs 1000\/AC, met \| cost: not recorded$/);
});

test('scorecard counts skipped lines and unreadable files as warnings', (t) => {
  const sb = sandbox(t);
  shipped(sb, 'p-1', { end: '2026-10-02T10:00:00Z' });
  fs.appendFileSync(ledgerFile(sb, 'p-1'), 'garbage\n{"v":1}\n');
  fs.mkdirSync(ledgerFile(sb, 'dir-like'));
  shipped(sb, 'cur', { end: '2026-10-09T10:00:00Z' });
  fs.appendFileSync(ledgerFile(sb, 'cur'), 'oops\n');
  const line = call(sb, ['scorecard', 'cur']).lines[0];
  assert.match(line, / \| excluded: 0 \| warnings: 4 \| cost: not recorded$/);
  assert.equal(line.includes('\n'), false);
});

test('scorecard skips hostile ledger lines', (t) => {
  const sb = sandbox(t);
  writeLedger(sb, 'evil', `{"__proto__":{"polluted":true},"v":1,"run":"evil","kind":"ship","acs":1}\n${JSON.stringify(shipRec('evil', { acs: 1 }))}\n`);
  const r = call(sb, ['scorecard', 'evil']);
  assert.match(r.lines[0], /^scorecard evil /);
  assert.match(r.lines[0], /warnings: 1 \| cost: not recorded$/);
  assert.equal({}.polluted, undefined);
});

test('scorecard reads at most 500 comparison files and warns', (t) => {
  const sb = sandbox(t);
  fs.mkdirSync(path.dirname(ledgerFile(sb, 'x')), { recursive: true });
  for (let i = 0; i < 501; i += 1) {
    const name = `many-${String(i).padStart(3, '0')}`;
    fs.writeFileSync(ledgerFile(sb, name), jl(shipRec(name, { t_start: '2026-10-01T09:00:00Z', t_ship: '2026-10-01T10:00:00Z', wait: 0 })));
    const when = new Date(Date.UTC(2026, 0, 1) + i * 1000);
    fs.utimesSync(ledgerFile(sb, name), when, when);
  }
  shipped(sb, 'cur', { end: '2026-10-09T10:00:00Z' });
  assert.match(call(sb, ['scorecard', 'cur']).lines[0], / \| all tiers \| excluded: 0 \| warnings: 1 \| cost: not recorded$/);
});

test('scorecard compares only files with a valid run name', (t) => {
  const sb = sandbox(t);
  shipped(sb, 'good', { end: '2026-10-02T10:00:00Z' });
  fs.writeFileSync(path.join(sb.dir, '.company', 'ledger', 'Bad_Name.jsonl'), jl(shipRec('good')));
  shipped(sb, 'cur', { end: '2026-10-09T10:00:00Z' });
  assert.match(call(sb, ['scorecard', 'cur']).lines[0], / \| all tiers n=1 \| excluded: 0 \| cost: not recorded$/);
});

test('the scorecard command through the CLI prints one line and exits 0', (t) => {
  const sb = sandbox(t);
  shipped(sb, 'cur', { end: '2026-10-09T10:00:00Z' });
  const r = cli(sb, ['scorecard', 'cur']);
  assert.equal(r.status, 0);
  assert.equal(r.out.split('\n').filter(Boolean).length, 1);
  assert.equal(cli(sb, ['scorecard', 'cur', '--bogus']).status, 2);
});

test('this test file is LF only', () => {
  assert.equal(fs.readFileSync(import.meta.filename).includes(13), false);
});
