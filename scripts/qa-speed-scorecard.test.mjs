// Acceptance tests for the run scorecard (token-ledger v1.1, run-state v1.3), the CI plugin job,
// the release validate step and scripts/stable.mjs. Every test works in a temp folder; git tests use a
// temp bare remote, a per-test git config file and no system config. Nothing touches the real home.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from './ledger.mjs';
import { run as runState, show } from './run-state.mjs';

const here = import.meta.dirname;
const repoRoot = path.join(here, '..');
const LEDGER = path.join(here, 'ledger.mjs');
const RELEASE = path.join(here, 'release.mjs');
const STABLE = path.join(here, 'stable.mjs');
const FIXTURES = path.join(here, 'fixtures', 'ledger-v1');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-speed-scorecard-'));
// A ledger build that ignores the injected root writes into this folder, never into the repo.
const decoy = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-speed-decoy-'));
after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(decoy, { recursive: true, force: true });
});
process.chdir(decoy);

let counter = 0;
function mkRoot() {
  const root = path.join(base, `root${counter++}`);
  fs.mkdirSync(path.join(root, '.company', 'ledger'), { recursive: true });
  return root;
}

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const at = (day, h, m = 0, s = 0) => iso(Date.UTC(2026, 9, day, h, m, s));
const T = (h, m = 0, s = 0) => at(27, h, m, s);
const epoch = (text) => Date.parse(text);
const NOW = epoch(T(12, 16));

const led = (root, args, now = NOW) => main(args, { now, root });
const ledgerFile = (root, run) => path.join(root, '.company', 'ledger', `${run}.jsonl`);
const readLines = (root, run) => fs.readFileSync(ledgerFile(root, run), 'utf8').split('\n').filter(Boolean);
const readJsonl = (root, run) => readLines(root, run).map((l) => JSON.parse(l));

function writeLedger(root, run, lines) {
  fs.writeFileSync(ledgerFile(root, run), lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
}

function cleanEnv(root) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_CONFIG') || k === 'XDG_CONFIG_HOME') delete env[k];
  const home = `${root}-home`;
  fs.mkdirSync(home, { recursive: true });
  return { ...env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), MCSPARROW_HOME: path.join(home, '.mcsparrow') };
}

function cli(root, args) {
  return spawnSync(process.execPath, [LEDGER, ...args], { cwd: root, encoding: 'utf8', env: cleanEnv(root) });
}

const transcript = (run, id, agent, spend) => ({
  v: 1, run, kind: 'step', id, role: 'backend-engineer', agent, src: 'transcript',
  tokens: { in: spend, cache_write: 0, cache_read: 1000, out: 0 }
});
const notification = (run, id, agent, extra = {}) => ({ v: 1, run, kind: 'step', id, role: 'backend-engineer', agent, src: 'notification', ctx_end: 5000, ...extra });
const clean = (o) => JSON.parse(JSON.stringify(o));

// A shipped run with a v1.1 ship record. minutes = run time, wait in minutes, perAc = spend per AC.
function prior(root, name, i, o = {}) {
  const { minutes = 60, wait = 5, perAc = 500, acs = 2, fix = 1, high = 0, rej = 0, tier, day = 10 + i, untimed = false } = o;
  const start = Date.UTC(2026, 9, day, 9, 0, 0);
  const ship = untimed
    ? { v: 1, run: name, kind: 'ship', acs, fix_rounds: fix, high_blockers: high }
    : clean({
      v: 1, run: name, kind: 'ship', acs, fix_rounds: fix, high_blockers: high, tier,
      t_start: iso(start), t_ship: iso(start + minutes * 60000), wait: wait * 60, rej_brief: 0, rej_plan: 0, rej_ship: rej
    });
  writeLedger(root, name, [transcript(name, '01', `a${i}`, perAc * acs), ship]);
}

function stepFile(root, slug, tier) {
  const dir = path.join(root, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  const fm = ['step: 01', 'role: backend-engineer', `task: ${slug}`, 'status: done', 'round: 0', 'base-commit: abc1234', `risk-tier: ${tier}`, 'acceptance-ids: [AC1]'];
  fs.writeFileSync(path.join(dir, '01-backend-engineer.md'), `---\n${fm.join('\n')}\n---\nBy: Test\n## Did\n- x\n`);
}

function runStateFile(root, slug, events) {
  const dir = path.join(root, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), events.map(([when, f]) => JSON.stringify({ v: 1, at: when, ...f })).join('\n') + '\n');
}

const ask = (gate) => ({ ev: 'ask', gate });
const gate = (g, result) => ({ ev: 'gate', gate: g, result });
// Run time 2h15m, CEO wait 660 s, one Plan reject and one Ship reject.
const FULL = [
  [T(10, 0), { ev: 'start' }],
  [T(10, 5), ask('brief')], [T(10, 7), gate('brief', 'passed')],
  [T(10, 30), ask('plan')], [T(10, 31), gate('plan', 'changed')],
  [T(10, 40), ask('plan')], [T(10, 42), gate('plan', 'passed')],
  [T(12, 0), ask('ship')], [T(12, 1), gate('ship', 'stopped')],
  [T(12, 10), ask('ship')], [T(12, 15), gate('ship', 'passed')]
];
const ENDED = [...FULL, [T(12, 16), { ev: 'end', outcome: 'ship' }]];

// The run under test: run-state, a Step file for the tier, and one reconciled Step.
function thisRun(root, { slug = 'feat-now', events = FULL, tier = 'high', spend = 2000 } = {}) {
  if (events) runStateFile(root, slug, events);
  if (tier) stepFile(root, slug, tier);
  writeLedger(root, slug, spend === null ? [notification(slug, '01', 'ax')] : [transcript(slug, '01', 'ax', spend)]);
}

const PRIOR_FIVE = [
  { minutes: 60, wait: 5, perAc: 400, fix: 0, high: 0, rej: 0, tier: 'medium' },
  { minutes: 90, wait: 10, perAc: 500, fix: 1, high: 0, rej: 1, tier: 'high' },
  { minutes: 120, wait: 15, perAc: 600, fix: 1, high: 1, rej: 2, tier: 'medium' },
  { minutes: 180, wait: 20, perAc: 800, fix: 2, high: 2, rej: 2, tier: 'high' },
  { minutes: 240, wait: 25, perAc: 1000, fix: 3, high: 5, rej: 4, tier: 'medium' }
];
function fivePriors(root) {
  PRIOR_FIVE.forEach((o, i) => prior(root, `prev-${i + 1}`, i + 1, o));
}

// ---------- hostile input (the allow-list and the time checks) ----------

const GOOD_A = transcript('hostile', '01', 'a1', 100);
const GOOD_B = transcript('hostile', '02', 'a2', 200);
const SHIP = { v: 1, run: 'hostile', kind: 'ship', acs: 1 };
const TIMED = { t_start: at(10, 9), t_ship: at(10, 10), wait: 60 };
const bad = (rec) => ({ rec });
const HOSTILE = {
  'unknown key prompt': bad({ ...GOOD_A, prompt: 'write me a plan' }),
  'unknown key note with free text': bad({ ...GOOD_A, note: 'free text here' }),
  'path value': bad({ ...GOOD_A, path: 'C:\\Users\\someone\\secret.txt' }),
  'name value': bad({ ...GOOD_A, name: 'Carlo' }),
  'unknown key on ship': bad({ ...SHIP, note: 'x' }),
  'ship with role': bad({ ...SHIP, role: 'qa' }),
  'ship with agent': bad({ ...SHIP, agent: 'a1' }),
  'ship with src': bad({ ...SHIP, src: 'notification' }),
  'proto key': { raw: JSON.stringify(GOOD_A).replace(/\}$/, ',"__proto__":{"x":1}}') },
  't1 on a transcript': bad({ ...GOOD_A, t1: T(10) }),
  't0 on a transcript': bad({ ...GOOD_A, t0: T(10) }),
  't1 on a ship': bad({ ...SHIP, t1: T(10) }),
  't0 on a ship': bad({ ...SHIP, t0: T(10) }),
  't1 on a total': bad({ v: 1, run: 'hostile', kind: 'total', id: 'abcdef12', role: 'lead', src: 'transcript', dispatches: 1, tokens: GOOD_A.tokens, t1: T(10) }),
  't0 without t1': bad({ ...notification('hostile', '01', 'a1'), t0: T(10) }),
  't0 later than t1': bad({ ...notification('hostile', '01', 'a1'), t0: T(11), t1: T(10) }),
  't1 with milliseconds': bad({ ...notification('hostile', '01', 'a1'), t1: '2026-10-27T10:00:00.000Z' }),
  't1 with a space': bad({ ...notification('hostile', '01', 'a1'), t1: '2026-10-27 10:00:00Z' }),
  't1 lowercase z': bad({ ...notification('hostile', '01', 'a1'), t1: '2026-10-27T10:00:00z' }),
  't1 not a real date': bad({ ...notification('hostile', '01', 'a1'), t1: '2026-02-30T10:00:00Z' }),
  't1 hour 24': bad({ ...notification('hostile', '01', 'a1'), t1: '2026-10-27T24:00:00Z' }),
  't1 before 2026': bad({ ...notification('hostile', '01', 'a1'), t1: '2025-12-31T23:59:59Z' }),
  't1 in 2100': bad({ ...notification('hostile', '01', 'a1'), t1: '2100-01-01T00:00:00Z' }),
  't1 a number': bad({ ...notification('hostile', '01', 'a1'), t1: 1790000000 }),
  't1 free text': bad({ ...notification('hostile', '01', 'a1'), t1: 'just now' }),
  't1 null': bad({ ...notification('hostile', '01', 'a1'), t1: null }),
  'tier outside the list': bad({ ...SHIP, ...TIMED, tier: 'extreme' }),
  'tier capitalised': bad({ ...SHIP, ...TIMED, tier: 'High' }),
  'tier an array': bad({ ...SHIP, ...TIMED, tier: ['high'] }),
  'tier on a step': bad({ ...GOOD_A, tier: 'high' }),
  'wait on a step': bad({ ...GOOD_A, wait: 5 }),
  'rej_ship on a step': bad({ ...GOOD_A, rej_ship: 1 }),
  't_start on a step': bad({ ...GOOD_A, t_start: T(9) }),
  'wait negative': bad({ ...SHIP, ...TIMED, wait: -1 }),
  'wait a string': bad({ ...SHIP, ...TIMED, wait: '5' }),
  'wait over a year': bad({ ...SHIP, ...TIMED, wait: 31536001 }),
  'wait fractional': bad({ ...SHIP, ...TIMED, wait: 1.5 }),
  'wait above the run time': bad({ ...SHIP, ...TIMED, wait: 3601 }),
  'rej_brief over 1000': bad({ ...SHIP, ...TIMED, rej_brief: 1001 }),
  'rej_plan negative': bad({ ...SHIP, ...TIMED, rej_plan: -1 }),
  'rej_ship fractional': bad({ ...SHIP, ...TIMED, rej_ship: 1.5 }),
  't_start alone': bad({ ...SHIP, t_start: at(10, 9) }),
  't_ship alone': bad({ ...SHIP, t_ship: at(10, 10) }),
  't_start later than t_ship': bad({ ...SHIP, t_start: at(10, 11), t_ship: at(10, 10) }),
  't_ship free text': bad({ ...SHIP, t_start: at(10, 9), t_ship: 'after the gate' }),
  'fix_rounds a string': bad({ ...SHIP, fix_rounds: '1' }),
  'line over 512 bytes': { raw: JSON.stringify(GOOD_A) + ' '.repeat(600) },
  'not JSON': { raw: 'please summarise the brief for me' },
  'truncated JSON': { raw: '{"v":1,"run":"hostile",' },
  'JSON array': { raw: '[]' },
  'JSON null': { raw: 'null' }
};

for (const [name, c] of Object.entries(HOSTILE)) {
  test(`AC7 hostile: ${name} is skipped with a warning and no valid line is lost`, (t) => {
    const root = mkRoot();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    writeLedger(root, 'hostile', [GOOD_A, c.raw ?? c.rec, GOOD_B]);
    const r = led(root, ['report', 'hostile', '--json']);
    assert.equal(r.code, 0);
    const out = JSON.parse(r.lines.join('\n'));
    assert.equal(out.rows.length, 2);
    assert.deepEqual(out.warnings, ['warning: line 2 skipped']);
    assert.equal(out.totals.spend, 300);
  });
}

test('AC7 control: valid v1.1 lines are read with no warning', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLedger(root, 'hostile', [
    GOOD_A,
    { ...notification('hostile', '02', 'a2'), tool_uses: 3, ms: 61000, t0: T(9, 58, 59), t1: T(10) },
    { ...SHIP, ...TIMED, tier: 'high', rej_brief: 0, rej_plan: 1, rej_ship: 2, fix_rounds: 1, high_blockers: 0 },
    { ...SHIP, t_start: at(10, 9), t_ship: at(10, 10), wait: 3600 }
  ]);
  const out = JSON.parse(led(root, ['report', 'hostile', '--json']).lines.join('\n'));
  assert.deepEqual(out.warnings, []);
  assert.equal(out.rows.length, 2);
});

test('AC7 the ledger holds only allow-listed keys, enums, numbers and UTC times after a full run', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  thisRun(root);
  assert.equal(led(root, ['add', 'feat-now', 'step', '02', 'qa', 'a2', '4000', '7', '95000']).code, 0);
  assert.equal(led(root, ['ship', 'feat-now', '4', '1', '2']).code, 0);
  const allowed = new Set(['v', 'run', 'kind', 'id', 'role', 'agent', 'src', 'ctx_end', 'tokens', 'reqs', 'tool_uses', 'ms', 'model',
    'dispatches', 'acs', 'fix_rounds', 'high_blockers', 't0', 't1', 'tier', 't_start', 't_ship', 'wait', 'rej_brief', 'rej_plan', 'rej_ship']);
  const text = fs.readFileSync(ledgerFile(root, 'feat-now'), 'utf8');
  for (const rec of text.split('\n').filter(Boolean).map((l) => JSON.parse(l))) {
    for (const k of Object.keys(rec)) assert.ok(allowed.has(k), `key ${k}`);
  }
  assert.ok(!text.includes(root), 'a path is stored');
  assert.ok(!text.includes(path.basename(root)), 'a folder name is stored');
  assert.ok(!/backend-engineer\.md|run-state|\.company/.test(text), 'a file name is stored');
});

test('AC7 the CLI refuses extra, malformed and path-like arguments and writes nothing', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cases = [
    ['add', 'x', 'step', '01', 'qa', 'a1', '100', '1', '1000', 'extra'],
    ['add', '../x', 'step', '01', 'qa', 'a1', '100'],
    ['add', 'x', 'step', '01', 'qa', 'a1/../b', '100'],
    ['add', 'x', 'step', '01', 'qa', 'a1', '100', '100001'],
    ['add', 'x', 'step', '01', 'qa', 'a1', '100', '1', '86400001'],
    ['add', 'x', 'step', '01', 'qa', 'a1', '100', '1', '1e3'],
    ['add', 'x', 'step', '01', 'qa', 'a1', '100', '1', '-5'],
    ['add', 'x', 'step', '01', 'qa', 'a1', '100', '1', ''],
    ['add', 'x', 'step', '01', 'qa', 'a1', '10000001'],
    ['ship', 'x', '3', '1', '2', 'extra'],
    ['ship', 'x', '-1'],
    ['ship', 'x', '3', '1', '2', '--baseline', 'a/b,c,d'],
    ['ship', '..\\x', '3'],
    ['scorecard', '../x'],
    ['scorecard', 'x', '--baseline', 'a,b,c,d,e,f,g,h,i,j,k'],
    ['report', 'x', '--acs', '100001'],
    ['report', 'x', '--acs', '-1'],
    ['report', 'x', '--acs', 'ten'],
    ['report', 'x', '--acs']
  ];
  for (const args of cases) {
    const r = led(root, args);
    assert.equal(r.code, 2, `accepted ${JSON.stringify(args)}`);
    assert.match(r.lines.join('\n'), /^refused: /);
  }
  assert.deepEqual(fs.readdirSync(path.join(root, '.company', 'ledger')), []);
});

test('AC7 the comparison set reads at most 500 ledger files and says so', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let i = 0; i < 501; i += 1) {
    const name = `old-${String(i).padStart(3, '0')}`;
    writeLedger(root, name, [{ v: 1, run: name, kind: 'ship', acs: 1 }]);
    fs.utimesSync(ledgerFile(root, name), new Date(2026, 0, 1, 0, 0, i), new Date(2026, 0, 1, 0, 0, i));
  }
  thisRun(root);
  const r = led(root, ['ship', 'feat-now', '4', '1', '2']);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /excluded: (499|500)\b/);
  assert.match(r.lines[0], /warnings: [1-9]\d*$/);
});

test('AC7 files with an invalid run name are ignored by the comparison set', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  prior(root, 'prev-1', 1);
  const shipLine = fs.readFileSync(ledgerFile(root, 'prev-1'), 'utf8');
  for (const name of ['BAD_NAME.jsonl', '.hidden.jsonl', 'has space.jsonl', 'notes.txt']) {
    fs.writeFileSync(path.join(root, '.company', 'ledger', name), shipLine);
  }
  fs.mkdirSync(path.join(root, '.company', 'ledger', 'dir-run.jsonl'));
  thisRun(root);
  const r = led(root, ['ship', 'feat-now', '4', '1', '2']);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /all tiers n=1 \| excluded: 0/);
});

// ---------- Step times ----------

test('AC1 add stamps t1 = now and t0 = t1 - floor(ms / 1000)', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = led(root, ['add', 'feat-now', 'step', '05', 'backend-engineer', 'a1', '64000', '12', '95999'], epoch(T(10)));
  assert.equal(r.code, 0);
  assert.deepEqual(readJsonl(root, 'feat-now'), [{
    v: 1, run: 'feat-now', kind: 'step', id: '05', role: 'backend-engineer', agent: 'a1', src: 'notification', ctx_end: 64000,
    tool_uses: 12, ms: 95999, t0: T(9, 58, 25), t1: T(10)
  }]);
});

test('AC1 add without ms writes t1 and no t0; whole seconds only', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  led(root, ['add', 'feat-now', 'step', '05', 'qa', 'a1', '100'], epoch(T(10)) + 789);
  led(root, ['add', 'feat-now', 'step', '06', 'qa', 'a2', '100', '4'], epoch(T(10)));
  led(root, ['add', 'feat-now', 'round', 'R1', 'qa', 'a3', '100', '4', '999'], epoch(T(10)));
  const [a, b, c] = readJsonl(root, 'feat-now');
  assert.equal(a.t1, T(10));
  assert.ok(!('t0' in a) && !('t0' in b));
  assert.equal(b.t1, T(10));
  assert.equal(c.t0, T(10));
});

test('AC1 add refuses a t0 before 2026-01-01 and writes nothing', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = led(root, ['add', 'feat-now', 'step', '05', 'qa', 'a1', '100', '1', '61000'], Date.UTC(2026, 0, 1, 0, 1, 0));
  assert.equal(r.code, 2);
  assert.match(r.lines[0], /^refused: /);
  assert.equal(fs.existsSync(ledgerFile(root, 'feat-now')), false);
  const edge = led(root, ['add', 'feat-now', 'step', '05', 'qa', 'a1', '100', '1', '60000'], Date.UTC(2026, 0, 1, 0, 1, 0));
  assert.equal(edge.code, 0);
  assert.equal(readJsonl(root, 'feat-now')[0].t0, '2026-01-01T00:00:00Z');
});

test('AC1 add refuses a clock outside 2026-01-01 up to 2100-01-01', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const now of [Date.UTC(2025, 11, 31, 23, 59, 59), Date.UTC(2100, 0, 1, 0, 0, 0)]) {
    assert.equal(led(root, ['add', 'feat-now', 'step', '05', 'qa', 'a1', '100'], now).code, 2);
  }
  assert.equal(fs.existsSync(ledgerFile(root, 'feat-now')), false);
});

test('AC1 main writes under the injected root, not the working directory', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(led(root, ['add', 'feat-now', 'step', '05', 'qa', 'a1', '100']).code, 0);
  assert.equal(fs.existsSync(ledgerFile(root, 'feat-now')), true);
  assert.equal(fs.existsSync(path.join(decoy, '.company')), false, 'wrote under the cwd');
});

test('AC1 the CLI add writes a t1 within the clock bounds', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = Math.floor(Date.now() / 1000) * 1000;
  const r = cli(root, ['add', 'feat-now', 'step', '05', 'qa', 'a1', '100', '2', '5000']);
  assert.equal(r.status, 0, r.stderr);
  const rec = readJsonl(root, 'feat-now')[0];
  assert.ok(epoch(rec.t1) >= before && epoch(rec.t1) <= Date.now() + 1000);
  assert.equal(epoch(rec.t1) - epoch(rec.t0), 5000);
});

test('AC1 a malformed time on read is skipped, not trusted', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLedger(root, 'feat-now', [notification('feat-now', '01', 'a1', { t0: '2026-10-27T99:00:00Z', t1: T(10) })]);
  const r = led(root, ['report', 'feat-now']);
  assert.equal(r.code, 0);
  assert.ok(r.lines.includes('warning: line 1 skipped'));
});

// ---------- ship record ----------

test('AC2 ship holds tier, run start, Ship Gate time, CEO wait and Gate rejects from run-state', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  thisRun(root);
  const r = led(root, ['ship', 'feat-now', '4', '1', '2']);
  assert.equal(r.code, 0);
  const rec = readJsonl(root, 'feat-now').at(-1);
  assert.deepEqual(rec, {
    v: 1, run: 'feat-now', kind: 'ship', acs: 4, fix_rounds: 1, high_blockers: 2, tier: 'high',
    t_start: T(10), t_ship: T(12, 15), wait: 660, rej_brief: 0, rej_plan: 1, rej_ship: 1
  });
});

test('AC2 the same record comes out of an ended run', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  thisRun(root, { events: ENDED });
  led(root, ['ship', 'feat-now', '4', '1', '2'], epoch(T(13)));
  const rec = readJsonl(root, 'feat-now').at(-1);
  assert.equal(rec.t_start, T(10));
  assert.equal(rec.t_ship, T(12, 15));
  assert.equal(rec.wait, 660);
});

test('AC2 a Gate with no ask adds nothing to the CEO wait', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  thisRun(root, {
    events: [[T(10), { ev: 'start' }], [T(10, 1), gate('brief', 'passed')], [T(10, 2), gate('plan', 'passed')],
      [T(10, 10), ask('ship')], [T(10, 20), gate('ship', 'passed')]]
  });
  led(root, ['ship', 'feat-now', '1']);
  const rec = readJsonl(root, 'feat-now').at(-1);
  assert.equal(rec.wait, 600);
  assert.equal(rec.rej_brief + rec.rej_plan + rec.rej_ship, 0);
});

test('AC2 t_ship is the last passed ship Gate, and a stopped one alone leaves the run untimed', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  thisRun(root, { events: [...FULL, [T(13), gate('ship', 'passed')]] });
  led(root, ['ship', 'feat-now', '4', '1', '2']);
  assert.equal(readJsonl(root, 'feat-now').at(-1).t_ship, T(13));
  const root2 = mkRoot();
  t.after(() => fs.rmSync(root2, { recursive: true, force: true }));
  thisRun(root2, { events: FULL.slice(0, -1) });
  const r = led(root2, ['ship', 'feat-now', '4', '1', '2']);
  assert.equal(r.code, 0);
  const rec = readJsonl(root2, 'feat-now').at(-1);
  assert.ok(!('t_start' in rec) && !('t_ship' in rec) && !('wait' in rec));
  assert.match(r.lines[0], /time untimed/);
});

test('AC2 without run-state the ship record is a plain v1 record and the line still prints', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  thisRun(root, { events: null, tier: null });
  const r = led(root, ['ship', 'feat-now', '4', '1', '2']);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 1);
  assert.deepEqual(readJsonl(root, 'feat-now').at(-1), { v: 1, run: 'feat-now', kind: 'ship', acs: 4, fix_rounds: 1, high_blockers: 2 });
  assert.match(r.lines[0], /^scorecard feat-now \(tier unknown\): time untimed/);
});

test('AC2 an unreadable run-state still gives a record and exit 0', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  thisRun(root, { events: null });
  fs.mkdirSync(path.join(root, '.company', 'work', 'feat-now', 'run-state.jsonl'));
  const r = led(root, ['ship', 'feat-now', '4']);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 1);
  assert.ok(!('t_ship' in readJsonl(root, 'feat-now').at(-1)));
});

test('AC2 a stale run-state keeps its times', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  thisRun(root);
  led(root, ['ship', 'feat-now', '4', '1', '2'], epoch(T(12, 16)) + 3 * 86400000);
  assert.equal(readJsonl(root, 'feat-now').at(-1).t_ship, T(12, 15));
});

test('AC2 brainstorm, replay and baseline runs get no v1.1 key and an excluded message', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const slug of ['brainstorm-20261027-1140', 'replay-new', 'baseline-x']) {
    thisRun(root, { slug });
    const r = led(root, ['ship', slug, '3', '1', '2']);
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, ['ship recorded (excluded run)']);
    assert.deepEqual(readJsonl(root, slug).at(-1), { v: 1, run: slug, kind: 'ship', acs: 3, fix_rounds: 1, high_blockers: 2 });
  }
});

test('AC2 a v1 ship command (acs only) still works', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = led(root, ['ship', 'solo', '2']);
  assert.equal(r.code, 0);
  assert.equal(readJsonl(root, 'solo').at(-1).acs, 2);
});

// ---------- the one line ----------

const FIVE_LINE = 'scorecard feat-now (tier high): time 2h15m (median 2h00m) | CEO wait 11m (median 15m) | spend/AC 500 (median 600) | ' +
  'fix rounds 1 (median 1) | high blockers 2 (median 1) | gate rejects 2 (median 2) | all tiers | excluded: 0';

test('AC3 ship returns exactly one line with each value beside its median of the last 5 runs', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fivePriors(root);
  thisRun(root);
  const r = led(root, ['ship', 'feat-now', '4', '1', '2']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, [FIVE_LINE]);
});

test('AC3 the CLI prints exactly one stdout line for ship and nothing on stderr', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fivePriors(root);
  thisRun(root, { events: ENDED });
  const r = cli(root, ['ship', 'feat-now', '4', '1', '2']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, `${FIVE_LINE}\n`);
});

test('AC3 scorecard prints the same line after the fact, and ship is not repeated by it', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fivePriors(root);
  thisRun(root);
  led(root, ['ship', 'feat-now', '4', '1', '2']);
  const before = fs.readFileSync(ledgerFile(root, 'feat-now'), 'utf8');
  const r = led(root, ['scorecard', 'feat-now']);
  assert.deepEqual(r.lines, [FIVE_LINE]);
  assert.equal(fs.readFileSync(ledgerFile(root, 'feat-now'), 'utf8'), before);
});

test('AC3 scorecard says so when there is no ledger or no ship record, exit 0', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(led(root, ['scorecard', 'nothing']), { code: 0, lines: ['no ledger for nothing'] });
  writeLedger(root, 'half', [transcript('half', '01', 'a1', 10)]);
  assert.deepEqual(led(root, ['scorecard', 'half']), { code: 0, lines: ['no ship record for half'] });
});

test('AC3 scorecard uses the last ship record of the run', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  thisRun(root);
  led(root, ['ship', 'feat-now', '4', '1', '2']);
  led(root, ['ship', 'feat-now', '2', '0', '0']);
  const line = led(root, ['scorecard', 'feat-now']).lines[0];
  assert.match(line, /spend\/AC 1000 /);
  assert.match(line, /fix rounds 0 /);
});

test('AC3 durations read <h>h<mm>m, or <m>m under one hour', (t) => {
  for (const [minutes, text] of [[5, '5m'], [59, '59m'], [60, '1h00m'], [65, '1h05m'], [600, '10h00m']]) {
    const root = mkRoot();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    thisRun(root, { events: [[T(8), { ev: 'start' }], [at(27, 8, minutes), gate('ship', 'passed')]] });
    const line = led(root, ['ship', 'feat-now', '1']).lines[0];
    assert.match(line, new RegExp(`time ${text} \\(`), `${minutes} minutes -> ${line}`);
  }
});

// ---------- medians from fewer than 5 runs ----------

test('AC4 no earlier shipped run reads no baseline and leaves the label out', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  thisRun(root);
  const r = led(root, ['ship', 'feat-now', '4', '1', '2']);
  assert.deepEqual(r.lines, ['scorecard feat-now (tier high): time 2h15m (no baseline) | CEO wait 11m (no baseline) | ' +
    'spend/AC 500 (no baseline) | fix rounds 1 (no baseline) | high blockers 2 (no baseline) | gate rejects 2 (no baseline) | excluded: 0']);
});

test('AC4 one to four earlier runs show n=<k>', (t) => {
  for (const k of [1, 2, 3, 4]) {
    const root = mkRoot();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    PRIOR_FIVE.slice(0, k).forEach((o, i) => prior(root, `prev-${i + 1}`, i + 1, o));
    thisRun(root);
    const line = led(root, ['ship', 'feat-now', '4', '1', '2']).lines[0];
    assert.match(line, new RegExp(`\\| all tiers n=${k} \\| excluded: 0$`), line);
  }
});

test('AC4 an even count uses the mean of the two middle values', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  [60, 120, 180, 240].forEach((minutes, i) => prior(root, `prev-${i + 1}`, i + 1, { minutes, perAc: 100 * (i + 1) }));
  thisRun(root);
  const line = led(root, ['ship', 'feat-now', '4', '1', '2']).lines[0];
  assert.match(line, /time 2h15m \(median 2h30m\)/);
  assert.match(line, /spend\/AC 500 \(median 250\)/);
});

test('AC4 the set is the 5 newest by Ship Gate time, not by file order or mtime', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const i of [7, 6, 5, 4, 3, 2, 1]) prior(root, `prev-${i}`, i, { minutes: i <= 2 ? 900 : 60, day: 10 + i });
  thisRun(root);
  const line = led(root, ['ship', 'feat-now', '4', '1', '2']).lines[0];
  assert.match(line, /time 2h15m \(median 1h00m\)/);
  assert.match(line, /\| all tiers \| excluded: 0$/);
});

test('AC4 runs shipped later than this one, and this run itself, stay out of the set', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  prior(root, 'prev-1', 1, { minutes: 60 });
  prior(root, 'later', 1, { minutes: 999, day: 28 });
  thisRun(root);
  led(root, ['ship', 'feat-now', '4', '1', '2']);
  const line = led(root, ['scorecard', 'feat-now']).lines[0];
  assert.match(line, /time 2h15m \(median 1h00m\)/);
  assert.match(line, /all tiers n=1 \|/);
});

test('AC4 with a tier and 5 runs of that tier the set is those 5 and the label says tier', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let i = 0; i < 5; i += 1) prior(root, `high-${i}`, i, { minutes: 60, tier: 'high', day: 10 + i });
  for (let i = 0; i < 3; i += 1) prior(root, `med-${i}`, i, { minutes: 300, tier: 'medium', day: 15 + i });
  thisRun(root);
  const line = led(root, ['ship', 'feat-now', '4', '1', '2']).lines[0];
  assert.match(line, /time 2h15m \(median 1h00m\)/);
  assert.match(line, /\| tier high \| excluded: 0$/);
});

test('AC4 with 4 runs of the tier the set falls back to all tiers', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let i = 1; i <= 4; i += 1) prior(root, `high-${i}`, i, { minutes: 60, tier: 'high', day: 10 + i });
  for (let i = 5; i <= 7; i += 1) prior(root, `med-${i}`, i, { minutes: 300, tier: 'medium', day: 10 + i });
  thisRun(root);
  const line = led(root, ['ship', 'feat-now', '4', '1', '2']).lines[0];
  assert.match(line, /time 2h15m \(median 5h00m\)/);
  assert.match(line, /\| all tiers \| excluded: 0$/);
});

test('AC4 a value no earlier run holds reads median ?, and a missing value of this run reads ?', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let i = 1; i <= 2; i += 1) {
    const name = `prev-${i}`;
    const start = Date.UTC(2026, 9, 10 + i, 9);
    writeLedger(root, name, [transcript(name, '01', `a${i}`, 1000), { v: 1, run: name, kind: 'ship', acs: 2, t_start: iso(start), t_ship: iso(start + 3600000), wait: 0 }]);
  }
  thisRun(root);
  const line = led(root, ['ship', 'feat-now', '4']).lines[0];
  assert.match(line, /fix rounds \? \(median \?\)/);
  assert.match(line, /high blockers \? \(median \?\)/);
  assert.match(line, /time 2h15m \(median 1h00m\)/);
});

test('AC4 a run with no tier reads tier unknown and uses all tiers', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fivePriors(root);
  thisRun(root, { tier: null });
  const line = led(root, ['ship', 'feat-now', '4', '1', '2']).lines[0];
  assert.match(line, /^scorecard feat-now \(tier unknown\):/);
  assert.match(line, /\| all tiers \|/);
  assert.ok(!('tier' in readJsonl(root, 'feat-now').at(-1)));
});

// ---------- excluded runs ----------

test('AC5 brainstorm, replay, baseline and untimed runs are left out of the medians and counted', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.copyFileSync(path.join(FIXTURES, 'brainstorm-20261027-1140.jsonl'), ledgerFile(root, 'brainstorm-20261027-1140'));
  fs.copyFileSync(path.join(FIXTURES, 'baseline-v0-3.jsonl'), ledgerFile(root, 'baseline-v0-3'));
  prior(root, 'replay-x', 1, { minutes: 999 });
  prior(root, 'old-run', 2, { untimed: true });
  writeLedger(root, 'no-ship', [transcript('no-ship', '01', 'a9', 100)]);
  prior(root, 'prev-1', 3, { minutes: 60 });
  prior(root, 'prev-2', 4, { minutes: 120 });
  thisRun(root);
  const r = led(root, ['ship', 'feat-now', '4', '1', '2']);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /time 2h15m \(median 1h30m\)/);
  assert.match(r.lines[0], /\| all tiers n=2 \| excluded: 4$/);
});

test('AC5 an untimed run still prints a line and compares with the timed runs', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fivePriors(root);
  thisRun(root, { events: null, tier: null });
  const r = led(root, ['ship', 'feat-now', '4', '1', '2']);
  assert.equal(r.code, 0);
  assert.match(r.lines[0], /time untimed \(median 2h00m\)/);
  assert.match(r.lines[0], /CEO wait \? \(median 15m\)/);
});

test('AC5 exit is 0 when every other file is excluded', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of fs.readdirSync(FIXTURES).filter((n) => n.endsWith('.jsonl'))) fs.copyFileSync(path.join(FIXTURES, f), path.join(root, '.company', 'ledger', f));
  thisRun(root);
  const r = cli(root, ['ship', 'feat-now', '4', '1', '2']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /excluded: 5\n$/);
});

// ---------- v1 files read as before ----------

const GOLDEN = [
  ['triage-hardening', ['report', 'triage-hardening'], 'triage-hardening.report.txt'],
  ['triage-hardening with the baseline', ['report', 'triage-hardening', '--baseline', 'baseline-research-team,baseline-role-effort,baseline-v0-3'], 'triage-hardening.report-baseline.txt'],
  ['triage-hardening as JSON', ['report', 'triage-hardening', '--json'], 'triage-hardening.report-json.txt'],
  ['baseline-research-team', ['report', 'baseline-research-team'], 'baseline-research-team.report.txt'],
  ['baseline-role-effort', ['report', 'baseline-role-effort'], 'baseline-role-effort.report.txt'],
  ['baseline-v0-3', ['report', 'baseline-v0-3'], 'baseline-v0-3.report.txt'],
  ['a brainstorm', ['report', 'brainstorm-20261027-1140'], 'brainstorm.report.txt'],
  ['a brainstorm round report', ['brainstorm-report', 'brainstorm-20261027-1140'], 'brainstorm.brainstorm-report.txt']
];

function fixtureRoot(t) {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of fs.readdirSync(FIXTURES).filter((n) => n.endsWith('.jsonl'))) fs.copyFileSync(path.join(FIXTURES, f), path.join(root, '.company', 'ledger', f));
  return root;
}

for (const [name, args, file] of GOLDEN) {
  test(`AC6 ${name}: the CLI output equals the output of the base script`, (t) => {
    const root = fixtureRoot(t);
    const expected = fs.readFileSync(path.join(FIXTURES, 'expected', file), 'utf8');
    const r = cli(root, args);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, expected);
  });

  test(`AC6 ${name}: main gives the same lines`, (t) => {
    const root = fixtureRoot(t);
    const expected = fs.readFileSync(path.join(FIXTURES, 'expected', file), 'utf8');
    const r = led(root, args);
    assert.equal(r.code, 0);
    assert.equal(`${r.lines.join('\n')}\n`, expected);
  });
}

test('AC6 the fixtures are what the base script reads: 38 lines in triage-hardening, no v1.1 key anywhere', () => {
  for (const f of fs.readdirSync(FIXTURES).filter((n) => n.endsWith('.jsonl'))) {
    const text = fs.readFileSync(path.join(FIXTURES, f), 'utf8');
    assert.ok(!/"(t0|t1|t_start|t_ship|wait|tier|rej_brief|rej_plan|rej_ship)"/.test(text), f);
    assert.ok(!text.includes('\r'));
  }
  assert.equal(fs.readFileSync(path.join(FIXTURES, 'triage-hardening.jsonl'), 'utf8').split('\n').filter(Boolean).length, 38);
});

test('AC6 report --acs replaces the per-AC divisor and changes nothing else', (t) => {
  const root = fixtureRoot(t);
  const same = led(root, ['report', 'triage-hardening', '--acs', '3']);
  assert.equal(`${same.lines.join('\n')}\n`, fs.readFileSync(path.join(FIXTURES, 'expected', 'triage-hardening.report.txt'), 'utf8'));
  const six = led(root, ['report', 'triage-hardening', '--acs', '6']).lines;
  assert.ok(six.includes('spend: 1646492 total, 274415 per AC (6 ACs)'), six.join('\n'));
  assert.ok(six.includes('cache read: 17675258 total, 2945876 per AC (6 ACs)'), six.join('\n'));
});

test('AC6 report --acs gives the Ship Gate cost line before any ship record exists', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLedger(root, 'pre-ship', [transcript('pre-ship', '01', 'a1', 2000)]);
  const lines = led(root, ['report', 'pre-ship', '--acs', '2']).lines;
  assert.ok(lines.includes('spend: 2000 total, 1000 per AC (2 ACs)'), lines.join('\n'));
  assert.ok(lines.includes('cache read: 1000 total, 500 per AC (2 ACs)'), lines.join('\n'));
});

test('AC6 a v1.1 ship record does not change the spend numbers of the v1 steps', (t) => {
  const root = fixtureRoot(t);
  const before = led(root, ['report', 'triage-hardening']).lines.filter((l) => /^(spend|cache read):/.test(l));
  fs.appendFileSync(ledgerFile(root, 'triage-hardening'), JSON.stringify({ v: 1, run: 'triage-hardening', kind: 'ship', acs: 3, t_start: at(10, 9), t_ship: at(10, 10), wait: 0 }) + '\n');
  const after2 = led(root, ['report', 'triage-hardening']).lines.filter((l) => /^(spend|cache read):/.test(l));
  assert.deepEqual(after2, before);
});

// ---------- never blocks ----------

test('AC8 scorecard and ship exit 0 on damaged ledgers, run-state and an empty ledger folder', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(ledgerFile(root, 'junk'), 'not json\n{"v":1}\n\u0000\u0000\n');
  fs.writeFileSync(ledgerFile(root, 'empty'), '');
  prior(root, 'prev-1', 1);
  thisRun(root, { events: null });
  fs.writeFileSync(path.join(root, '.company', 'work', 'feat-now', 'run-state.jsonl'), '{"v":1,"at":"nope"}\ngarbage\n');
  const ship = led(root, ['ship', 'feat-now', '4']);
  assert.equal(ship.code, 0);
  assert.equal(ship.lines.length, 1);
  const card = led(root, ['scorecard', 'feat-now']);
  assert.equal(card.code, 0);
  assert.equal(card.lines.length, 1);
  assert.equal(led(root, ['scorecard', 'junk']).code, 0);
});

test('AC8 warnings from bad lines are counted on the line, not thrown', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  prior(root, 'prev-1', 1);
  fs.appendFileSync(ledgerFile(root, 'prev-1'), 'garbage\n');
  thisRun(root);
  fs.appendFileSync(ledgerFile(root, 'feat-now'), 'garbage\n');
  const r = led(root, ['ship', 'feat-now', '4', '1', '2']);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /warnings: [1-9]\d*$/);
});

test('AC8 a run whose spend is not reconciled still ships, and says so', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fivePriors(root);
  thisRun(root, { spend: null });
  const r = led(root, ['ship', 'feat-now', '4', '1', '2']);
  assert.equal(r.code, 0);
  assert.match(r.lines[0], /spend\/AC not reconciled \(median 600\)/);
  const zero = mkRoot();
  t.after(() => fs.rmSync(zero, { recursive: true, force: true }));
  thisRun(zero);
  assert.match(led(zero, ['ship', 'feat-now', '0']).lines[0], /spend\/AC not reconciled/);
});

test('AC8 the scorecard writes nothing to the ledger folder', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fivePriors(root);
  thisRun(root);
  led(root, ['ship', 'feat-now', '4', '1', '2']);
  const snapshot = () => fs.readdirSync(path.join(root, '.company', 'ledger')).sort().map((f) => [f, fs.readFileSync(path.join(root, '.company', 'ledger', f), 'utf8')]);
  const before = snapshot();
  led(root, ['scorecard', 'feat-now']);
  assert.deepEqual(snapshot(), before);
});

// ---------- the 30% target ----------

const BASE_NAMES = ['base-a', 'base-b', 'base-c'];
// Baseline spend per AC 1000, 2000, 3000 (median 2000); quality medians fix 2, high 3.
function baselines(root, quality = [[2, 4], [3, 2], [1, 3]]) {
  const per = [[10, 10000], [10, 20000], [3, 9000]];
  BASE_NAMES.forEach((name, i) => {
    const total = { v: 1, run: name, kind: 'total', id: `0000000${i}`, role: 'lead', src: 'transcript', reqs: 10, dispatches: 3, tokens: { in: per[i][1], cache_write: 0, cache_read: 5, out: 0 } };
    const q = quality[i];
    const ship = q ? { v: 1, run: name, kind: 'ship', acs: per[i][0], fix_rounds: q[0], high_blockers: q[1] } : { v: 1, run: name, kind: 'ship', acs: per[i][0] };
    writeLedger(root, name, [total, ship]);
  });
}
const BASE_ARGS = ['--baseline', BASE_NAMES.join(',')];

function target(t, o = {}) {
  const { spend, acs = 5, quality, shipArgs } = o;
  const fix = 'fix' in o ? o.fix : 2;
  const high = 'high' in o ? o.high : 3;
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  baselines(root, quality);
  thisRun(root, { spend });
  const r = led(root, shipArgs ?? ['ship', 'feat-now', String(acs), ...(fix === null ? [] : [String(fix)]), ...(high === null ? [] : [String(high)]), ...BASE_ARGS]);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 1);
  return r.lines[0];
}

test('AC13 met: 30% fewer tokens per AC with Fix rounds and high blockers no higher than the baseline median', (t) => {
  const line = target(t, { spend: 7000 });
  assert.match(line, /\| 30% target: -30% vs 2000\/AC, met$/);
});

test('AC13 the boundary uses the unrounded value: 1400.4 per AC is missed although it prints -30%', (t) => {
  const line = target(t, { spend: 7002 });
  assert.match(line, /spend\/AC 1400 /);
  assert.match(line, /\| 30% target: -30% vs 2000\/AC, missed$/);
});

test('AC13 missed when Fix rounds are above the baseline median', (t) => {
  assert.match(target(t, { spend: 5000, fix: 3 }), /30% target: -50% vs 2000\/AC, missed$/);
});

test('AC13 missed when high blockers are above the baseline median', (t) => {
  assert.match(target(t, { spend: 5000, high: 4 }), /30% target: -50% vs 2000\/AC, missed$/);
});

test('AC13 missed when the spend per AC is not 30% lower', (t) => {
  assert.match(target(t, { spend: 12000 }), /30% target: \+20% vs 2000\/AC, missed$/);
});

test('AC13 not reconciled when no baseline run holds both quality numbers (the real baselines)', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of ['baseline-research-team', 'baseline-role-effort', 'baseline-v0-3']) fs.copyFileSync(path.join(FIXTURES, `${f}.jsonl`), ledgerFile(root, f));
  thisRun(root, { spend: 1000 });
  const r = led(root, ['ship', 'feat-now', '5', '1', '1', '--baseline', 'baseline-research-team,baseline-role-effort,baseline-v0-3']);
  assert.equal(r.code, 0);
  assert.match(r.lines[0], /\| 30% target: -\d+% vs \d+\/AC, not reconciled$/);
});

test('AC13 not reconciled when the baseline quality numbers are missing, even with a small spend', (t) => {
  assert.match(target(t, { spend: 5000, quality: [null, null, null] }), /30% target: -50% vs 2000\/AC, not reconciled$/);
});

test('AC13 baseline quality medians use only the baseline runs that hold both numbers', (t) => {
  const met = target(t, { spend: 5000, fix: 2, high: 3, quality: [null, [3, 4], [1, 2]] });
  assert.match(met, /30% target: -50% vs 2000\/AC, met$/);
  const missed = target(t, { spend: 5000, fix: 3, high: 3, quality: [null, [3, 4], [1, 2]] });
  assert.match(missed, /, missed$/);
});

test('AC13 not reconciled when this run has no Fix round or high blocker count', (t) => {
  assert.match(target(t, { spend: 5000, fix: null, high: null }), /, not reconciled$/);
});

test('AC13 not reconciled when this run spend per AC is not reconciled; never met or missed', (t) => {
  const line = target(t, { spend: null });
  const seg = line.split(' | ').find((s) => s.startsWith('30% target'));
  assert.ok(seg, line);
  assert.match(seg, /not reconciled$/);
  assert.ok(!/met|missed/.test(seg.replace('not reconciled', '')));
});

test('AC13 no target segment without --baseline', (t) => {
  const line = target(t, { spend: 5000, shipArgs: ['ship', 'feat-now', '5', '2', '3'] });
  assert.ok(!line.includes('30% target'));
});

test('AC13 scorecard shows the target only when given --baseline, with the same text as ship', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  baselines(root);
  thisRun(root, { spend: 7000 });
  const shipped = led(root, ['ship', 'feat-now', '5', '2', '3', ...BASE_ARGS]).lines[0];
  assert.equal(led(root, ['scorecard', 'feat-now', ...BASE_ARGS]).lines[0], shipped);
  assert.ok(!led(root, ['scorecard', 'feat-now']).lines[0].includes('30% target'));
});

// ---------- run-state v1.3 (the source of the CEO wait) ----------

test('AC2 run-state ask is recorded, refused without an open run and for an unknown Gate', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(runState(['ask', 'demo', 'brief'], { root, now: epoch(T(9)) }).code, 2);
  assert.equal(runState(['start', 'demo'], { root, now: epoch(T(9)) }).code, 0);
  assert.equal(runState(['ask', 'demo', 'nope'], { root, now: epoch(T(9, 1)) }).code, 2);
  assert.equal(runState(['ask', 'demo', 'brief'], { root, now: epoch(T(9, 1)) }).code, 0);
  const lines = fs.readFileSync(path.join(root, '.company', 'work', 'demo', 'run-state.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(lines.at(-1), { v: 1, at: T(9, 1), ev: 'ask', gate: 'brief' });
});

test('AC2 run-state view: wait is the seconds from the latest ask after the previous gate of the same Gate', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slug = 'demo';
  const step = (cmd, when) => assert.equal(runState(cmd, { root, now: epoch(when) }).code, 0, cmd.join(' '));
  step(['start', slug], T(9));
  step(['ask', slug, 'brief'], T(9, 1));
  step(['ask', slug, 'brief'], T(9, 2));
  step(['gate', slug, 'brief', 'passed'], T(9, 5));
  step(['gate', slug, 'plan', 'passed'], T(9, 6));
  step(['ask', slug, 'ship'], T(9, 7));
  step(['gate', slug, 'ship', 'changed'], T(9, 8));
  step(['ask', slug, 'ship'], T(9, 20));
  step(['gate', slug, 'ship', 'passed'], T(9, 30));
  const view = show(root, slug, { now: epoch(T(9, 31)) });
  assert.deepEqual(view.gates.map((g) => [g.gate, g.result, g.wait]), [['brief', 'passed', 180], ['plan', 'passed', null], ['ship', 'changed', 60], ['ship', 'passed', 600]]);
});

test('AC2 run-state view: a v1.2 file reads wait null on every Gate entry', (t) => {
  const root = mkRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  runStateFile(root, 'demo', [[T(9), { ev: 'start' }], [T(9, 5), gate('brief', 'passed')]]);
  assert.deepEqual(show(root, 'demo', { now: epoch(T(9, 6)) }).gates, [{ gate: 'brief', result: 'passed', at: T(9, 5), wait: null }]);
});

// ---------- CI ----------

const ciText = () => fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
const stepsOf = (text) => text.split(/\n(?=\s*- (?:name|run|uses|id|if|env|shell|with):)/);
const jobsOf = (text) => text.split(/\n(?=  [A-Za-z][\w-]*:\s*\n)/);
// Lines of every `run:` value in a block of YAML text.
function runLines(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const keyIndent = m[1].length + (lines[i].trimStart().startsWith('- ') ? 2 : 0);
    if (m[2] && !/^[|>][+-]?$/.test(m[2])) {
      out.push(m[2]);
      continue;
    }
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === '') continue;
      if (lines[j].length - lines[j].trimStart().length <= keyIndent) break;
      out.push(lines[j]);
    }
  }
  return out;
}

test('AC9 a CI job runs claude plugin validate --strict and nothing makes it non-blocking', () => {
  const text = ciText();
  const validate = stepsOf(text).filter((s) => /claude plugin validate --strict \./.test(s));
  assert.equal(validate.length, 1, 'one validate step');
  assert.ok(!/continue-on-error/.test(validate[0]), 'validate step has continue-on-error');
  assert.ok(!/plugin eval/.test(validate[0]), 'validate shares a step with eval');
  const job = jobsOf(text).find((j) => /claude plugin validate --strict/.test(j));
  assert.ok(job);
  assert.ok(!/^\s{4}continue-on-error/m.test(job), 'job-level continue-on-error');
  assert.ok(!/\|\|\s*true/.test(validate[0]));
  assert.ok(!/--profile/.test(validate[0]));
});

test('AC9 the plugin job is read-only, pull_request only, pinned and free of expressions in run', () => {
  const text = ciText();
  assert.match(text, /^on:\s*\n\s+pull_request:/m);
  assert.ok(!/pull_request_target/.test(text));
  assert.match(text, /^permissions:\s*\n\s+contents: read/m);
  const job = jobsOf(text).find((j) => /claude plugin validate --strict/.test(j));
  assert.ok(job, 'plugin job');
  assert.match(job, /permissions:\s*\n\s+contents: read/);
  assert.match(job, /persist-credentials: false/);
  assert.match(job, /DISABLE_TELEMETRY: ?"?1"?/);
  assert.match(job, /CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: ?"?1"?/);
  for (const l of runLines(text)) assert.ok(!l.includes('${{'), `expression in run: ${l}`);
  for (const l of text.split('\n').filter((x) => /\buses:/.test(x))) assert.match(l, /uses: [\w./-]+@[0-9a-f]{40}\b/, l);
});

test('AC9 the CLI comes from the CI-only tool package with an exact pin, a lockfile and npm ci', () => {
  const pkgFile = path.join(repoRoot, 'tools', 'claude-cli', 'package.json');
  assert.ok(fs.existsSync(pkgFile), 'tools/claude-cli/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.devDependencies['@anthropic-ai/claude-code'], '2.1.311');
  assert.ok(!pkg.scripts || Object.keys(pkg.scripts).length === 0);
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tools', 'claude-cli', 'package-lock.json'), 'utf8'));
  assert.equal(lock.lockfileVersion, 3);
  assert.ok(lock.packages['node_modules/@anthropic-ai/claude-code'].integrity);
  const root = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.ok(!root.dependencies && !root.devDependencies, 'root package.json stays dependency-free');
  const text = ciText();
  assert.match(text, /RUNNER_TEMP/);
  assert.match(text, /tools\/claude-cli/);
  assert.match(text, /npm ci/);
});

test('AC10 plugin eval is a report-only step with both skip messages and a cost cap', () => {
  const text = ciText();
  const evals = stepsOf(text).filter((s) => /claude plugin eval/.test(s));
  assert.equal(evals.length, 1);
  assert.match(evals[0], /continue-on-error: true/);
  assert.match(evals[0], /plugin eval skipped: no suite/);
  assert.match(evals[0], /plugin eval skipped: no key/);
  assert.match(evals[0], /--no-publish/);
  assert.match(evals[0], /--trust-plugin/);
  assert.match(evals[0], /--max-cost-usd/);
  assert.match(evals[0], /--runs 1/);
  assert.match(evals[0], /--ablation none/);
  assert.ok(!/claude plugin validate/.test(evals[0]));
});

test('AC10 v0.15 adds no eval suite', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'evals')), false);
});

// ---------- release validates before it tags ----------

const GIT_ENV_FILE_TEXT = '[user]\n\tname = T\n\temail = t@example.com\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n';

function gitEnv(dir, extra = {}) {
  const cfg = path.join(dir, 'gitconfig');
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, GIT_ENV_FILE_TEXT);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k === 'XDG_CONFIG_HOME') delete env[k];
  return {
    ...env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', HOME: dir, USERPROFILE: dir,
    CLAUDE_CONFIG_DIR: path.join(dir, '.claude'), ...extra
  };
}

function git(cwd, env, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
const gitTry = (cwd, env, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env });

const CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n### Added\n- A new thing.\n\n## [0.10.0] - 2026-10-26\n\n- Old.\n';

function releaseBox(t) {
  const dir = fs.mkdtempSync(path.join(base, 'rel-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = gitEnv(dir);
  const root = path.join(dir, 'work');
  const origin = path.join(dir, 'origin.git');
  fs.mkdirSync(root);
  git(dir, env, 'init', '--bare', '-q', origin);
  git(root, env, 'init', '-q');
  git(root, env, 'remote', 'add', 'origin', origin);
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  w('.claude-plugin/plugin.json', '{\n  "name": "aico",\n  "version": "0.10.0",\n  "description": "x"\n}\n');
  w('documentation/README.md', '# Docs\n\n**Current: 0.10.0** (32 Role agents).\n');
  w('CHANGELOG.md', CHANGELOG);
  w('scripts/check.mjs', 'console.log("check ok");\n');
  w('scripts/ok.mjs', 'console.log("tests ok");\n');
  w('package.json', '{ "name": "t", "type": "module", "scripts": { "test": "node scripts/ok.mjs" } }\n');
  git(root, env, 'add', '-A');
  git(root, env, 'commit', '-q', '-m', 'init');
  const fake = path.join(dir, 'fake-claude.mjs');
  fs.writeFileSync(fake, [
    "import fs from 'node:fs';",
    "const plugin = JSON.parse(fs.readFileSync('.claude-plugin/plugin.json', 'utf8'));",
    "fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), version: plugin.version }) + '\\n');",
    'process.exit(Number(process.env.FAKE_CLAUDE_EXIT ?? 0));',
    ''
  ].join('\n'));
  const log = path.join(dir, 'claude.log');
  return { dir, root, origin, env, fake, log };
}

function release(box, version, extra = {}) {
  const env = { ...box.env, AICO_CLAUDE_BIN: box.fake, FAKE_CLAUDE_LOG: box.log, FAKE_CLAUDE_EXIT: '0', ...extra };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return spawnSync(process.execPath, [RELEASE, version], { cwd: box.root, encoding: 'utf8', env });
}

test('AC11 a passing validate makes the annotated vX.Y.Z tag; validate ran after the bump with fixed arguments', (t) => {
  const box = releaseBox(t);
  const r = release(box, '0.11.0');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(git(box.root, box.env, 'cat-file', '-t', 'refs/tags/v0.11.0'), 'tag');
  const calls = fs.readFileSync(box.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['plugin', 'validate', '--strict', '.']);
  assert.equal(calls[0].version, '0.11.0');
  assert.equal(fs.realpathSync(calls[0].cwd), fs.realpathSync(box.root));
  assert.equal(git(box.root, box.env, 'status', '--porcelain'), '');
});

test('AC11 a failing validate restores the files and makes no commit and no tag', (t) => {
  const box = releaseBox(t);
  const head = git(box.root, box.env, 'rev-parse', 'HEAD');
  const r = release(box, '0.11.0', { FAKE_CLAUDE_EXIT: '1' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /validate/);
  assert.equal(git(box.root, box.env, 'tag', '--list'), '');
  assert.equal(git(box.root, box.env, 'rev-parse', 'HEAD'), head);
  assert.equal(git(box.root, box.env, 'status', '--porcelain'), '');
  assert.match(fs.readFileSync(path.join(box.root, '.claude-plugin', 'plugin.json'), 'utf8'), /"version": "0\.10\.0"/);
  assert.match(fs.readFileSync(path.join(box.root, 'CHANGELOG.md'), 'utf8'), /## \[Unreleased\]\n\n### Added/);
});

test('AC11 fail closed: a missing, relative or .cmd CLI path and a shell string make no tag', (t) => {
  const box = releaseBox(t);
  const head = git(box.root, box.env, 'rev-parse', 'HEAD');
  const cmd = path.join(box.dir, 'claude.cmd');
  fs.writeFileSync(cmd, '@echo off\r\necho x > "%~dp0RAN"\r\n');
  const cases = [
    path.join(box.dir, 'does-not-exist.mjs'),
    'claude',
    './fake-claude.mjs',
    cmd,
    `${box.fake}; touch ${path.join(box.dir, 'PWNED')}`,
    `${process.execPath} && echo hi`
  ];
  for (const bin of cases) {
    const r = release(box, '0.11.0', { AICO_CLAUDE_BIN: bin });
    assert.notEqual(r.status, 0, `released with ${bin}`);
    assert.equal(git(box.root, box.env, 'tag', '--list'), '', bin);
    assert.equal(git(box.root, box.env, 'rev-parse', 'HEAD'), head);
    assert.equal(git(box.root, box.env, 'status', '--porcelain'), '', bin);
  }
  assert.equal(fs.existsSync(path.join(box.dir, 'PWNED')), false);
  assert.equal(fs.existsSync(path.join(box.dir, 'RAN')), false);
  assert.ok(!fs.existsSync(box.log), 'fake CLI ran for a refused path');
});

test('AC11 release never pushes and uses no shell, with validate in the source', (t) => {
  const box = releaseBox(t);
  fs.writeFileSync(path.join(box.root, '.git', 'hooks', 'pre-push'), `#!/bin/sh\necho pushed > "${path.join(box.dir, 'PUSHED').split(path.sep).join('/')}"\nexit 1\n`, { mode: 0o755 });
  assert.equal(release(box, '0.11.0').status, 0);
  assert.equal(fs.existsSync(path.join(box.dir, 'PUSHED')), false);
  assert.equal(git(box.origin, box.env, 'for-each-ref'), '');
  const src = fs.readFileSync(RELEASE, 'utf8');
  assert.ok(!/shell:\s*true/.test(src));
  assert.match(src, /plugin/);
  assert.match(src, /AICO_CLAUDE_BIN/);
});

// ---------- stable ----------

function stableBox(t) {
  const dir = fs.mkdtempSync(path.join(base, 'stable-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = gitEnv(dir);
  const origin = path.join(dir, 'origin.git');
  const root = path.join(dir, 'work');
  fs.mkdirSync(root);
  git(dir, env, 'init', '--bare', '-q', '-b', 'main', origin);
  git(root, env, 'init', '-q', '-b', 'main');
  git(root, env, 'remote', 'add', 'origin', origin);
  const commit = (name) => {
    fs.writeFileSync(path.join(root, `${name}.txt`), name);
    git(root, env, 'add', '-A');
    git(root, env, 'commit', '-q', '-m', name);
    return git(root, env, 'rev-parse', 'HEAD');
  };
  const box = { dir, env, origin, root, commit, c1: commit('one') };
  git(root, env, 'push', '-q', 'origin', 'main');
  return box;
}
const tagAt = (box, version, rev = 'HEAD') => git(box.root, box.env, 'tag', '-a', `v${version}`, '-m', `v${version}`, rev);
const stable = (box, ...args) => assert.ok(fs.existsSync(STABLE), 'scripts/stable.mjs is missing') ?? spawnSync(process.execPath, [STABLE, ...args], { cwd: box.root, encoding: 'utf8', env: box.env });
const remoteRef = (box, ref) => gitTry(box.origin, box.env, 'rev-parse', '--verify', '-q', ref).stdout.trim();
const originRefs = (box) => git(box.origin, box.env, 'for-each-ref', '--format=%(refname) %(objectname)');

test('AC12 stable.mjs moves stable to a merged annotated tag, pushes the tag, and prints one line', (t) => {
  const box = stableBox(t);
  tagAt(box, '1.0.0');
  const r = stable(box, '1.0.0');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.stdout.trim(), `stable -> v1.0.0 (${box.c1.slice(0, 7)})`);
  assert.equal(remoteRef(box, 'refs/heads/stable'), box.c1);
  assert.equal(git(box.origin, box.env, 'cat-file', '-t', 'refs/tags/v1.0.0'), 'tag');
  assert.equal(remoteRef(box, 'refs/tags/v1.0.0'), git(box.root, box.env, 'rev-parse', 'refs/tags/v1.0.0'));
});

test('AC12 running it twice is safe, and a newer tag then an earlier tag moves stable both ways', (t) => {
  const box = stableBox(t);
  tagAt(box, '1.0.0');
  assert.equal(stable(box, '1.0.0').status, 0);
  assert.equal(stable(box, '1.0.0').status, 0);
  const c2 = box.commit('two');
  git(box.root, box.env, 'push', '-q', 'origin', 'main');
  tagAt(box, '1.1.0');
  assert.equal(stable(box, '1.1.0').status, 0);
  assert.equal(remoteRef(box, 'refs/heads/stable'), c2);
  const back = stable(box, '1.0.0');
  assert.equal(back.status, 0, back.stderr);
  assert.equal(remoteRef(box, 'refs/heads/stable'), box.c1);
  assert.equal(remoteRef(box, 'refs/tags/v1.1.0'), git(box.root, box.env, 'rev-parse', 'refs/tags/v1.1.0'), 'a tag moved');
});

test('AC12 stable.mjs refuses a tag that is not merged into origin/main, and pushes nothing', (t) => {
  const box = stableBox(t);
  git(box.root, box.env, 'checkout', '-q', '-b', 'feature');
  box.commit('side');
  tagAt(box, '2.0.0');
  const before = originRefs(box);
  const r = stable(box, '2.0.0');
  assert.notEqual(r.status, 0);
  assert.equal(originRefs(box), before);
});

test('AC12 stable.mjs refuses a lightweight tag and a missing tag', (t) => {
  const box = stableBox(t);
  git(box.root, box.env, 'tag', 'v3.0.0');
  const before = originRefs(box);
  assert.notEqual(stable(box, '3.0.0').status, 0);
  assert.notEqual(stable(box, '9.9.9').status, 0);
  assert.equal(originRefs(box), before);
});

test('AC12 stable.mjs refuses when the remote tag points at another object, and leaves stable alone', (t) => {
  const box = stableBox(t);
  const c2 = box.commit('two');
  git(box.root, box.env, 'push', '-q', 'origin', 'main');
  git(box.origin, box.env, 'tag', '-a', 'v4.0.0', '-m', 'other', box.c1);
  git(box.root, box.env, 'tag', '-a', 'v4.0.0', '-m', 'local', c2);
  const before = originRefs(box);
  const r = stable(box, '4.0.0');
  assert.notEqual(r.status, 0);
  assert.equal(originRefs(box), before);
  assert.equal(remoteRef(box, 'refs/heads/stable'), '');
});

test('AC12 stable.mjs takes a version of plain x.y.z only; nothing reaches git or a shell', (t) => {
  const box = stableBox(t);
  tagAt(box, '1.0.0');
  const before = originRefs(box);
  const badVersions = ['', '1.0', 'v1.0.0', '1.0.0-rc1', '01.0.0', '1.0.0 ', '-1.0.0', '--help', '--force', '1.0.0; touch PWNED', '$(touch PWNED)',
    '1.0.0\n2.0.0', 'refs/tags/v1.0.0', '1.0.0^{commit}', '..', '1.0.0..1.0.1', 'main'];
  for (const v of badVersions) {
    const r = stable(box, v);
    assert.notEqual(r.status, 0, `accepted ${JSON.stringify(v)}`);
  }
  assert.notEqual(stable(box).status, 0);
  assert.notEqual(stable(box, '1.0.0', '1.0.1').status, 0);
  assert.equal(originRefs(box), before);
  assert.equal(fs.existsSync(path.join(box.root, 'PWNED')), false);
});

test('AC12 stable.mjs source: fixed git argument lists, a leased push, full refs, no shell', () => {
  const src = fs.readFileSync(STABLE, 'utf8');
  assert.ok(!/shell:\s*true/.test(src));
  assert.ok(!/\bexec(Sync)?\(/.test(src));
  assert.match(src, /--force-with-lease=refs\/heads\/stable:/);
  assert.ok(!/--force(?!-with-lease)/.test(src), 'a bare force');
  assert.ok(!/(^|[^\w/])\+refs/.test(src), 'a forced refspec');
  assert.match(src, /GIT_TERMINAL_PROMPT/);
  assert.match(src, /--end-of-options/);
  assert.match(src, /merge-base/);
});

test('AC12 package.json has an npm run stable script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.stable ?? '', /scripts\/stable\.mjs/);
});

test('AC12 the docs name the stable ref and give one command to install an earlier tag', () => {
  const text = fs.readFileSync(path.join(repoRoot, 'documentation', 'getting-started.md'), 'utf8');
  assert.match(text, /\bstable\b/);
  assert.match(text, /(marketplace|ref)[^\n]*v\d+\.\d+\.\d+/);
});
