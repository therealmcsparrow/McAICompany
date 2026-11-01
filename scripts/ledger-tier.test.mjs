import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRecord, main } from './ledger.mjs';

const REPO = path.join(import.meta.dirname, '..');
const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'ledger-v1');
const NOW = Date.parse('2026-10-28T12:00:00Z');
const FLOOR = { release: '0.16.0', floor: { architect: 'opus' }, protected: ['architect'], downgraded: [], warnings: [] };
const floorOf = () => () => ({ ...FLOOR });
const boom = () => {
  throw new Error('no floor');
};

// Every test works in its own temp project dir and plugin dir, removed when the test ends.
function sandbox(t, version = '0.19.0') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-tier-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pluginRoot = path.join(dir, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'company'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'aico', version }));
  fs.copyFileSync(path.join(REPO, 'company', 'tier-sets.json'), path.join(pluginRoot, 'company', 'tier-sets.json'));
  return { dir, pluginRoot };
}

const call = (sb, args, loadFloor = floorOf()) => main(args, { now: NOW, root: sb.dir, pluginRoot: sb.pluginRoot, loadFloor });
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const jl = (...recs) => `${recs.map((r) => JSON.stringify(r)).join('\n')}\n`;
const ledgerFile = (sb, name) => path.join(sb.dir, '.company', 'ledger', `${name}.jsonl`);
const readLines = (sb, name) => fs.readFileSync(ledgerFile(sb, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const writeLedger = (sb, name, ...recs) => {
  fs.mkdirSync(path.dirname(ledgerFile(sb, name)), { recursive: true });
  fs.writeFileSync(ledgerFile(sb, name), jl(...recs));
};
const workDir = (sb, slug) => {
  const dir = path.join(sb.dir, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const begin = (over = {}) => ({ v: 1, at: '2026-10-28T10:00:00Z', ev: 'begin', pb: 'feature', tier: 'low', path: 'short', why: 'short', rev: 1, base: SHA, skip: over.path === 'full' ? [] : ['design-researcher', 'brand-artist'], ...over });
const raiseEv = (tier, cause = 'step') => ({ v: 1, at: '2026-10-28T11:00:00Z', ev: 'raise', tier, cause });
const writeTierPath = (sb, slug, ...events) => fs.writeFileSync(path.join(workDir(sb, slug), 'tier-path.jsonl'), jl(...events));
function writeRunState(sb, slug, tier) {
  const dir = workDir(sb, slug);
  const events = [['2026-10-28T09:00:00Z', 'start'], ['2026-10-28T11:30:00Z', 'gate', { gate: 'ship', result: 'passed' }]];
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), jl(...events.map(([at, ev, rest]) => ({ v: 1, at, ev, ...rest }))));
  fs.writeFileSync(path.join(dir, '01-qa.md'), `---\nstep: 01\nrole: qa\ntask: x\nstatus: done\nround: 0\nbase-commit: abc1234\nrisk-tier: ${tier}\n---\n## Did\n`);
}

// ---------- the new keys, hostile cases first ----------

const meta = (over = {}) => ({ v: 1, run: 'demo', kind: 'meta', aico: '0.19.0', pb: 'feature', sets: 1, ...over });
const shipRec = (over = {}) => ({ v: 1, run: 'demo', kind: 'ship', acs: 2, path: 'short', raised: 0, ...over });

test('validateRecord refuses every value of pb outside feature and fix', () => {
  for (const pb of ['Feature', 'FIX', 'feature ', 'feature\n', 'fixx', '', 'both', 1, 0, true, null, ['fix'], { a: 'fix' }, '__proto__']) {
    assert.equal(validateRecord(meta({ pb })).ok, false, JSON.stringify(pb));
  }
});

test('validateRecord refuses text, floats, negatives, booleans and out-of-range for sets', () => {
  for (const sets of ['1', '', '1\n', 0, -1, 1000, 1.5, 0.1, 1e3, 1e21, NaN, Infinity, null, true, false, [1], { a: 1 }, 2 ** 53]) {
    assert.equal(validateRecord(meta({ sets })).ok, false, JSON.stringify(sets));
  }
});

test('validateRecord accepts the edges of sets and the optional pb and sets', () => {
  assert.equal(validateRecord(meta({ sets: 1 })).ok, true);
  assert.equal(validateRecord(meta({ sets: 999 })).ok, true);
  assert.equal(validateRecord(meta({ pb: 'fix' })).ok, true);
  const bare = { v: 1, run: 'demo', kind: 'meta', aico: '0.19.0' };
  assert.equal(validateRecord(bare).ok, true);
  assert.equal(validateRecord({ ...bare, pb: 'fix' }).ok, true);
  assert.equal(validateRecord({ ...bare, sets: 3 }).ok, true);
  assert.equal(validateRecord({ ...bare, floor: '0.16.0', pb: 'fix', sets: 3 }).ok, true);
});

test('validateRecord refuses every value of path and raised outside the allow-list', () => {
  for (const p of ['Short', 'FULL', 'shorter', 'short ', 'short\n', '', 'low', 'none', 1, 0, true, null, ['short'], { a: 1 }]) {
    assert.equal(validateRecord(shipRec({ path: p })).ok, false, JSON.stringify(p));
  }
  for (const raised of ['0', '1', '', 'true', 2, -1, 0.5, 1.5, 1e3, NaN, Infinity, null, true, false, [1], { a: 1 }]) {
    assert.equal(validateRecord(shipRec({ raised })).ok, false, JSON.stringify(raised));
  }
});

test('validateRecord accepts path full or short and raised 0 or 1, each on its own', () => {
  for (const p of ['full', 'short']) assert.equal(validateRecord(shipRec({ path: p })).ok, true);
  for (const raised of [0, 1]) assert.equal(validateRecord(shipRec({ raised })).ok, true);
  assert.equal(validateRecord({ v: 1, run: 'demo', kind: 'ship', acs: 2, path: 'short' }).ok, true);
  assert.equal(validateRecord({ v: 1, run: 'demo', kind: 'ship', acs: 2, raised: 1 }).ok, true);
});

test('pb and sets are refused on every other kind, path and raised on every kind but ship', () => {
  const step = { v: 1, run: 'demo', kind: 'step', id: '01', role: 'architect', agent: 'a1', src: 'notification', ctx_end: 5 };
  const par = { v: 1, run: 'demo', kind: 'par', cap: 4, peak: 3, waits: 1, out: 0 };
  assert.equal(validateRecord(step).ok, true);
  for (const rec of [step, par, { v: 1, run: 'demo', kind: 'ship', acs: 1 }]) {
    assert.equal(validateRecord({ ...rec, pb: 'fix' }).ok, false, `${rec.kind} pb`);
    assert.equal(validateRecord({ ...rec, sets: 1 }).ok, false, `${rec.kind} sets`);
  }
  for (const rec of [step, par, { v: 1, run: 'demo', kind: 'meta', aico: '0.19.0' }]) {
    assert.equal(validateRecord({ ...rec, path: 'short' }).ok, false, `${rec.kind} path`);
    assert.equal(validateRecord({ ...rec, raised: 1 }).ok, false, `${rec.kind} raised`);
  }
});

test('a meta line holds no key outside v, run, kind, aico, floor, pb, sets', () => {
  for (const key of ['tier', 'path', 'raised', 'note', 'rev', 'why', 'base', 'cause', 'set', 'skipped']) {
    assert.equal(validateRecord({ ...meta(), [key]: 'x' }).ok, false, key);
    assert.equal(validateRecord({ ...meta(), [key]: 1 }).ok, false, key);
  }
  for (const key of ['pb', 'sets', 'aico', 'run', 'kind']) {
    const rec = meta();
    delete rec[key];
    assert.equal(validateRecord(rec).ok, key === 'pb' || key === 'sets', `without ${key}`);
  }
});

// ---------- ship reads the tier record ----------

test('ship with a short low record writes pb and sets on meta, path and raised on ship', (t) => {
  const sb = sandbox(t);
  writeTierPath(sb, 'demo', begin({ rev: 4 }));
  const r = call(sb, ['ship', 'demo', '2']);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 1);
  assert.doesNotMatch(r.lines[0], /warnings:/);
  const recs = readLines(sb, 'demo');
  assert.deepEqual(recs.map((x) => x.kind), ['meta', 'ship']);
  assert.deepEqual(recs[0], { v: 1, run: 'demo', kind: 'meta', aico: '0.19.0', floor: '0.16.0', pb: 'feature', sets: 4 });
  assert.deepEqual(recs[1], { v: 1, run: 'demo', kind: 'ship', acs: 2, tier: 'low', path: 'short', raised: 0 });
});

test('ship with rev 0 leaves sets out of meta', (t) => {
  const sb = sandbox(t);
  writeTierPath(sb, 'demo', begin({ rev: 0, path: 'full', why: 'setting', pb: 'fix' }));
  assert.equal(call(sb, ['ship', 'demo', '1']).code, 0);
  const [m, s] = readLines(sb, 'demo');
  assert.deepEqual(m, { v: 1, run: 'demo', kind: 'meta', aico: '0.19.0', floor: '0.16.0', pb: 'fix' });
  assert.deepEqual(s, { v: 1, run: 'demo', kind: 'ship', acs: 1, tier: 'low', path: 'full', raised: 0 });
});

test('a raised record writes raised 1 and the raised tier', (t) => {
  const sb = sandbox(t);
  writeTierPath(sb, 'demo', begin(), raiseEv('medium'), raiseEv('high', 'plan'));
  assert.equal(call(sb, ['ship', 'demo', '1']).code, 0);
  assert.deepEqual(readLines(sb, 'demo')[1], { v: 1, run: 'demo', kind: 'ship', acs: 1, tier: 'high', path: 'short', raised: 1 });
});

test('ship tier is the higher of the run-state tier and the record tier', (t) => {
  for (const [state, record, want] of [['low', 'medium', 'medium'], ['high', 'low', 'high'], ['medium', 'medium', 'medium'], ['low', 'low', 'low']]) {
    const sb = sandbox(t);
    writeRunState(sb, 'demo', state);
    writeTierPath(sb, 'demo', begin(),...(record === 'low' ? [] : [raiseEv(record)]));
    assert.equal(call(sb, ['ship', 'demo', '1']).code, 0);
    const s = readLines(sb, 'demo').find((x) => x.kind === 'ship');
    assert.equal(s.tier, want, `${state}/${record}`);
    assert.equal(s.t_start, '2026-10-28T09:00:00Z', 'the timed keys stay');
  }
});

test('state none writes none of the four keys and no warning', (t) => {
  const sb = sandbox(t);
  const r = call(sb, ['ship', 'demo', '2']);
  assert.doesNotMatch(r.lines[0], /warnings:/);
  const [m, s] = readLines(sb, 'demo');
  assert.deepEqual(m, { v: 1, run: 'demo', kind: 'meta', aico: '0.19.0', floor: '0.16.0' });
  assert.deepEqual(s, { v: 1, run: 'demo', kind: 'ship', acs: 2 });
});

test('a broken record writes none of the four keys, counts one warning and ship still succeeds', (t) => {
  const bodies = [
    '{ not json\n',
    `${JSON.stringify(begin())}`,
    `${JSON.stringify(begin({ pb: 'both' }))}\n`,
    `${JSON.stringify(begin({ rev: 1000 }))}\n`,
    `${JSON.stringify(begin())}\n${JSON.stringify(begin())}\n`,
    `${JSON.stringify(begin())}\n${JSON.stringify(raiseEv('low'))}\n`,
    `${JSON.stringify({ ...begin(), extra: 1 })}\n`,
    `${JSON.stringify(begin())}\n`.repeat(2),
    'x'.repeat(40000)
  ];
  for (const body of bodies) {
    const sb = sandbox(t);
    fs.writeFileSync(path.join(workDir(sb, 'demo'), 'tier-path.jsonl'), body);
    const r = call(sb, ['ship', 'demo', '2']);
    assert.equal(r.code, 0, body.slice(0, 30));
    assert.equal(r.lines.length, 1);
    assert.match(r.lines[0], /warnings: 1 \| cost: not recorded$/, body.slice(0, 30));
    const recs = readLines(sb, 'demo');
    assert.deepEqual(recs.map((x) => x.kind), ['meta', 'ship']);
    assert.deepEqual(Object.keys(recs[0]), ['v', 'run', 'kind', 'aico', 'floor'], 'no partial meta');
    assert.deepEqual(recs[1], { v: 1, run: 'demo', kind: 'ship', acs: 2 }, 'no partial ship');
  }
});

test('a missing sets data file still gives the keys the record holds, with no warning', (t) => {
  const sb = sandbox(t);
  fs.rmSync(path.join(sb.pluginRoot, 'company'), { recursive: true });
  writeTierPath(sb, 'demo', begin({ rev: 2 }));
  const r = call(sb, ['ship', 'demo', '2']);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.lines[0], /warnings:/);
  const [m, s] = readLines(sb, 'demo');
  assert.equal(m.sets, 2);
  assert.equal(s.path, 'short');
});

test('an excluded run reads no record and writes none of the keys', (t) => {
  const sb = sandbox(t);
  for (const name of ['brainstorm-20261028-1000', 'replay-x', 'baseline-x']) {
    writeTierPath(sb, name, begin());
    assert.equal(call(sb, ['ship', name, '2']).lines[0], 'ship recorded (excluded run)');
    assert.deepEqual(readLines(sb, name), [{ v: 1, run: name, kind: 'ship', acs: 2 }]);
  }
});

test('the ledger text holds no path, text or free value from the record', (t) => {
  const sb = sandbox(t);
  writeTierPath(sb, 'demo', begin({ base: 'abcdef1234567'.padEnd(40, '0') }), raiseEv('medium', 'diff'));
  call(sb, ['ship', 'demo', '2']);
  const text = fs.readFileSync(ledgerFile(sb, 'demo'), 'utf8');
  assert.doesNotMatch(text, /abcdef|cause|diff|why|base|\.md|src\//);
});

// ---------- the scorecard ----------

test('scorecard shows path short beside the tier, only when the last ship has it', (t) => {
  const sb = sandbox(t);
  writeLedger(sb, 'a', shipRec({ run: 'a', tier: 'low' }));
  writeLedger(sb, 'b', shipRec({ run: 'b', tier: 'low', path: 'full' }));
  writeLedger(sb, 'c', shipRec({ run: 'c', path: 'short' }));
  writeLedger(sb, 'd', { v: 1, run: 'd', kind: 'ship', acs: 2, tier: 'low', raised: 1 });
  assert.match(call(sb, ['scorecard', 'a']).lines[0], /^scorecard a \(tier low, path short\): time untimed /);
  assert.match(call(sb, ['scorecard', 'b']).lines[0], /^scorecard b \(tier low\): time untimed /);
  assert.match(call(sb, ['scorecard', 'c']).lines[0], /^scorecard c \(tier unknown, path short\): time untimed /);
  assert.match(call(sb, ['scorecard', 'd']).lines[0], /^scorecard d \(tier low\): time untimed /);
});

test('ship prints the path short scorecard line', (t) => {
  const sb = sandbox(t);
  writeTierPath(sb, 'demo', begin());
  assert.match(call(sb, ['ship', 'demo', '2']).lines[0], /^scorecard demo \(tier low, path short\): /);
});

// ---------- v1.3 files give the same numbers ----------

const sha = (lines) => crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
const GOLD_REPORT = {
  'baseline-research-team': '8a3f018d8aab26d2', 'baseline-role-effort': 'ace6ae8b26f0dd12', 'baseline-v0-3': 'a30ce9bab0f185fd',
  'brainstorm-20261027-1140': '3cf75e4e93f727fd', 'triage-hardening': '7f4d952b22347ae0'
};
const GOLD_SCORE_FIXTURES = {
  'baseline-research-team': 'scorecard baseline-research-team (tier unknown): time untimed (no baseline) | CEO wait ? (no baseline) | spend/AC 123450 (no baseline) | fix rounds ? (no baseline) | high blockers ? (no baseline) | gate rejects ? (no baseline) | excluded: 4 | cost: not recorded',
  'baseline-role-effort': 'scorecard baseline-role-effort (tier unknown): time untimed (no baseline) | CEO wait ? (no baseline) | spend/AC 197164 (no baseline) | fix rounds ? (no baseline) | high blockers ? (no baseline) | gate rejects ? (no baseline) | excluded: 4 | cost: not recorded',
  'baseline-v0-3': 'scorecard baseline-v0-3 (tier unknown): time untimed (no baseline) | CEO wait ? (no baseline) | spend/AC 111829 (no baseline) | fix rounds ? (no baseline) | high blockers ? (no baseline) | gate rejects ? (no baseline) | excluded: 4 | cost: not recorded',
  'brainstorm-20261027-1140': 'no ship record for brainstorm-20261027-1140',
  'triage-hardening': 'scorecard triage-hardening (tier unknown): time untimed (no baseline) | CEO wait ? (no baseline) | spend/AC not reconciled (no baseline) | fix rounds 1 (no baseline) | high blockers 6 (no baseline) | gate rejects ? (no baseline) | excluded: 4 | cost: not recorded'
};
const GOLD_MODEL_FIXTURES = 'model verdict: insufficient (n=0) | runs 0 v0.17, 0 v0.16 (plan check ?) | spend/AC ? (v0.16 ?) | downgraded spend/AC ? (v0.16 ?) | fix rounds median ? (v0.16 ?) | high blockers median ? (v0.16 ?) | downgraded: none | lower model: 0 of 0 | excluded: 0 | not counted: 1';
const GOLD_PAR_FIXTURES = 'parallel verdict: insufficient (n=0) | runs 0 v0.18, 0 v0.17 (plan check ?, floor 0.16.0) | time minus CEO wait median ? (v0.17 ?) | wall clock median ? (v0.17 ?) | fix rounds median ? (v0.17 ?) | high blockers median ? (v0.17 ?) | gate rejects median ? (v0.17 ?) | spend/AC ? (v0.17 ?) | out-of-list median ? | cap median ? | excluded: 0 | not counted: 1';

function copyFixtures(sb) {
  fs.mkdirSync(path.join(sb.dir, '.company', 'ledger'), { recursive: true });
  for (const f of fs.readdirSync(FIXTURES).filter((n) => n.endsWith('.jsonl'))) fs.copyFileSync(path.join(FIXTURES, f), ledgerFile(sb, f.slice(0, -6)));
}

test('report, scorecard and both verdicts give the v1.3 numbers on every v1.3 fixture', (t) => {
  const sb = sandbox(t);
  copyFixtures(sb);
  for (const [run, hash] of Object.entries(GOLD_REPORT)) {
    const expected = fs.readFileSync(path.join(FIXTURES, 'expected', run.startsWith('brainstorm') ? 'brainstorm.report.txt' : `${run}.report.txt`), 'utf8');
    const lines = call(sb, ['report', run]).lines;
    assert.equal(`${lines.join('\n')}\n`, expected, run);
    assert.equal(sha(lines), hash, run);
    assert.deepEqual(call(sb, ['scorecard', run]).lines, [GOLD_SCORE_FIXTURES[run]], run);
  }
  assert.deepEqual(call(sb, ['model-verdict']).lines, [GOLD_MODEL_FIXTURES]);
  assert.deepEqual(call(sb, ['parallel-verdict']).lines, [GOLD_PAR_FIXTURES]);
});

const PARALLEL_CAP = path.join(REPO, '.company', 'ledger', 'parallel-cap.jsonl');
test('the parallel-cap ledger gives the same numbers, copied to a temp dir', { skip: !fs.existsSync(PARALLEL_CAP) && 'the gitignored run ledger is not in this checkout' }, (t) => {
  const sb = sandbox(t);
  copyFixtures(sb);
  fs.copyFileSync(PARALLEL_CAP, ledgerFile(sb, 'parallel-cap'));
  assert.equal(sha(call(sb, ['report', 'parallel-cap']).lines), '4081a682b87eaca1');
  assert.deepEqual(call(sb, ['scorecard', 'parallel-cap']).lines, [
    'scorecard parallel-cap (tier high): time 3h34m (no baseline) | CEO wait 1h43m (no baseline) | spend/AC 192760 (no baseline) | fix rounds 3 (no baseline) | high blockers 9 (no baseline) | gate rejects 1 (no baseline) | excluded: 5 | cost: not recorded'
  ]);
  assert.deepEqual(call(sb, ['scorecard', 'triage-hardening']).lines, [
    'scorecard triage-hardening (tier unknown): time untimed (median 3h34m) | CEO wait ? (median 1h43m) | spend/AC not reconciled (median 192760) | fix rounds 1 (median 3) | high blockers 6 (median 9) | gate rejects ? (median 1) | all tiers n=1 | excluded: 4 | cost: not recorded'
  ]);
  assert.deepEqual(call(sb, ['model-verdict']).lines, [
    'model verdict: insufficient (n=1) | runs 1 v0.17, 0 v0.16 (plan check none) | spend/AC 192760 (v0.16 ?) | downgraded spend/AC 0 (v0.16 ?) | fix rounds median 3.0 (v0.16 ?) | high blockers median 9.0 (v0.16 ?) | downgraded: none | lower model: 0 of 0 | excluded: 0 | not counted: 1'
  ]);
  assert.deepEqual(call(sb, ['parallel-verdict']).lines, [
    'parallel verdict: insufficient (n=0) | runs 0 v0.18, 1 v0.17 (plan check ?, floor 0.16.0) | time minus CEO wait median ? (v0.17 1h51m) | wall clock median ? (v0.17 3h34m) | fix rounds median ? (v0.17 3.0) | high blockers median ? (v0.17 9.0) | gate rejects median ? (v0.17 1.0) | spend/AC ? (v0.17 192760) | out-of-list median ? | cap median ? | excluded: 0 | not counted: 1'
  ]);
});

// ---------- run builders for the verdicts ----------

const T0 = Date.parse('2026-10-01T10:00:00Z');
const HOUR = 3600000;

// One counted run. `kind`: short (0.19, path short), full (0.19, path full), old (no meta), old18 (0.18 meta, builders and par for the parallel verdict).
function run(sb, name, o = {}) {
  const { pb = 'feature', kind = 'short', tier = 'low', secs = 300, wait = 0, fix = 0, high = 0, rej = 0, spend = 1000, acs = 2, raised = 0, i = 0, cap, floor, noPath = false, stepRole, aico } = o;
  const end = T0 + i * HOUR;
  const role = stepRole ?? (pb === 'feature' ? 'product-manager' : 'qa');
  const recs = [
    { v: 1, run: name, kind: 'step', id: '01', role, agent: `a${i}x`, src: 'notification', ctx_end: 10 },
    { v: 1, run: name, kind: 'step', id: '01', role, agent: `a${i}x`, src: 'transcript', tokens: { in: spend, cache_write: 0, cache_read: 5, out: 0 } }
  ];
  if (kind === 'short' || kind === 'full') recs.push({ v: 1, run: name, kind: 'meta', aico: aico ?? '0.19.0', ...(floor ? { floor } : {}), pb, sets: 1 });
  if (kind === 'old18') recs.push({ v: 1, run: name, kind: 'meta', aico: aico ?? '0.18.0', floor: '0.16.0' });
  if (kind === 'old17') recs.push({ v: 1, run: name, kind: 'meta', aico: '0.17.0' });
  if (cap !== undefined) recs.push({ v: 1, run: name, kind: 'par', cap, peak: 1, waits: 0, out: 0 });
  recs.push({
    v: 1, run: name, kind: 'ship', acs, fix_rounds: fix, high_blockers: high, tier,
    t_start: iso(end - secs * 1000), t_ship: iso(end), wait, rej_ship: rej,
    ...(noPath || kind === 'old' || kind === 'old18' || kind === 'old17' ? {} : { path: kind === 'short' ? 'short' : 'full', raised })
  });
  writeLedger(sb, name, ...recs);
}

// A reconciled dispatch (notification and transcript) as two ledger lines.
const stepPair = (name, id, role, agent) => jl(
  { v: 1, run: name, kind: 'step', id, role, agent, src: 'notification', ctx_end: 1 },
  { v: 1, run: name, kind: 'step', id, role, agent, src: 'transcript', tokens: { in: 1, cache_write: 0, cache_read: 0, out: 0 } }
);

const verdict = (sb, args = ['--runs', '3'], loadFloor) => call(sb, ['low-path-verdict', ...args], loadFloor);
const feature = (r) => r.lines[0];
const fix = (r) => r.lines[1];

// Three short and three before runs for a playbook; `short` and `before` override the run fields.
function fill(sb, pb, n, short = {}, before = {}, beforeKind = 'old') {
  for (let i = 0; i < n; i += 1) {
    run(sb, `${pb}-s${i}`, { pb, kind: 'short', i: 100 + i, ...short });
    run(sb, `${pb}-b${i}`, { pb, kind: beforeKind, i, secs: 400, ...before });
  }
}

// ---------- low-path-verdict: arguments, hostile cases first ----------

test('low-path-verdict refuses --runs outside 3 to 50 and anything but digits, exit 2', (t) => {
  const sb = sandbox(t);
  for (const args of [['--runs'], ['--runs', '2'], ['--runs', '51'], ['--runs', '100'], ['--runs', '0'], ['--runs', '-5'], ['--runs', '5x'], ['--runs', '1e1'],
    ['--runs', ''], ['--runs', ' 5'], ['--runs', '5\n'], ['--runs', '3.5'], ['--runs', '0x10'], ['--runs', '999999999999'], ['5'], ['--run', '5'],
    ['--runs', '5', '--runs', '6'], ['--runs', '5', 'extra'], ['--baseline', 'a'], ['--runs', '٣']]) {
    const r = verdict(sb, args);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.equal(r.lines.length, 1, JSON.stringify(args));
    assert.match(r.lines[0], /^refused: /, JSON.stringify(args));
  }
});

test('low-path-verdict accepts 3, 50 and the default, prints exactly two lines, feature then fix, writes nothing', (t) => {
  const sb = sandbox(t);
  copyFixtures(sb);
  const before = fs.readdirSync(path.join(sb.dir, '.company', 'ledger')).map((f) => fs.readFileSync(ledgerFile(sb, f.slice(0, -6)), 'utf8'));
  for (const args of [[], ['--runs', '3'], ['--runs', '50'], ['--runs', '07']]) {
    const r = verdict(sb, args);
    assert.equal(r.code, 0, JSON.stringify(args));
    assert.equal(r.lines.length, 2);
    assert.match(r.lines[0], /^low-path verdict feature: insufficient \(n=0\) \| runs 0 short, 0 before /);
    assert.match(r.lines[1], /^low-path verdict fix: insufficient \(n=0\) \| runs 0 short, 0 before /);
  }
  const after = fs.readdirSync(path.join(sb.dir, '.company', 'ledger')).map((f) => fs.readFileSync(ledgerFile(sb, f.slice(0, -6)), 'utf8'));
  assert.deepEqual(after, before);
});

test('an empty or missing ledger folder gives two insufficient lines, exit 0', (t) => {
  const sb = sandbox(t);
  const r = verdict(sb);
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 2);
  assert.match(feature(r), /^low-path verdict feature: insufficient \(n=0\) \| runs 0 short, 0 before \(plan check \?, floor \?, cap \?\) \| time minus CEO wait median \? \(before \?\)/);
});

// ---------- low-path-verdict: states ----------

test('pass: fast enough, no guard higher, no raised, feature spend per AC', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3, { secs: 300, spend: 1000, acs: 2 }, { spend: 1000, acs: 2 });
  const r = verdict(sb);
  assert.equal(r.code, 0);
  const line = feature(r);
  assert.match(line, /^low-path verdict feature: pass \| runs 3 short, 3 before \(plan check none, floor none, cap none\) \| /);
  assert.match(line, / \| time minus CEO wait median 5m \(before 7m\) \| /);
  assert.match(line, / \| fix rounds median 0\.0 \(before 0\.0\) \| high blockers median 0\.0 \(before 0\.0\) \| gate rejects median 0\.0 \(before 0\.0\) \| /);
  assert.match(line, / \| spend\/AC 500 \(before 500\) \| raised 0 of 3 \| excluded: 0 \| not counted: 0$/);
  assert.doesNotMatch(line, /roll back/);
  assert.match(fix(r), /^low-path verdict fix: insufficient \(n=0\)/);
});

test('fix prints spend per run, not per AC', (t) => {
  const sb = sandbox(t);
  fill(sb, 'fix', 3, { spend: 900, acs: 3 }, { spend: 1000, acs: 1 });
  const line = fix(verdict(sb));
  assert.match(line, /^low-path verdict fix: pass \| /);
  assert.match(line, / \| spend\/run 900 \(before 1000\) \| /);
  assert.doesNotMatch(line, /spend\/AC/);
  assert.match(feature(verdict(sb)), /insufficient/);
});

test('feature spend is the sum over the sum of ACs, fix spend is the sum over runs', (t) => {
  const sb = sandbox(t);
  // short: spend 1100 over 1 + 3 + 1 ACs = 220/AC (the middle of the per-run values would be 100); before: 500/AC
  run(sb, 'f-s0', { kind: 'short', i: 100, spend: 100, acs: 1 });
  run(sb, 'f-s1', { kind: 'short', i: 101, spend: 900, acs: 3 });
  run(sb, 'f-s2', { kind: 'short', i: 102, spend: 100, acs: 1 });
  for (let i = 0; i < 3; i += 1) run(sb, `f-b${i}`, { kind: 'old', i, secs: 400, spend: 1000, acs: 2 });
  assert.match(feature(verdict(sb)), / \| spend\/AC 220 \(before 500\) \| /);
});

test('insufficient with fewer than --runs on either side, n is the smaller set', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3);
  assert.match(feature(verdict(sb, ['--runs', '4'])), /^low-path verdict feature: insufficient \(n=3\) \| runs 3 short, 3 before /);
  run(sb, 'feature-b9', { kind: 'old', i: 9, secs: 400 });
  assert.match(feature(verdict(sb, ['--runs', '4'])), /insufficient \(n=3\)/);
  fs.rmSync(ledgerFile(sb, 'feature-s2'));
  assert.match(feature(verdict(sb, ['--runs', '3'])), /^low-path verdict feature: insufficient \(n=2\) \| runs 2 short, 3 before /);
  assert.match(feature(verdict(sb, ['--runs', '3'])), /raised 0 of 2/);
});

test('sets: only the newest --runs of each side count', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3);
  // older and slow short runs, older and fast before runs: left out of the newest three of each side
  for (let i = 0; i < 3; i += 1) {
    run(sb, `feature-old-s${i}`, { kind: 'short', i: 50 + i, secs: 5000 });
    run(sb, `feature-old-b${i}`, { kind: 'old', i: -10 - i, secs: 10 });
  }
  const line = feature(verdict(sb));
  assert.match(line, /pass \| runs 3 short, 3 before/);
  assert.match(line, /median 5m \(before 7m\)/);
  assert.match(feature(verdict(sb, ['--runs', '6'])), /runs 6 short, 6 before/);
});

test('the floor cannot be loaded: insufficient, never pass', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3);
  fill(sb, 'fix', 3);
  const r = verdict(sb, ['--runs', '3'], boom);
  assert.match(feature(r), /^low-path verdict feature: insufficient \(n=3\) \| /);
  assert.match(fix(r), /^low-path verdict fix: insufficient \(n=3\) \| /);
  assert.match(feature(r), /warnings: \d+$/);
  for (const bad of [() => null, () => ({}), () => ({ floor: 1, downgraded: 1 }), () => 'x']) {
    assert.match(feature(verdict(sb, ['--runs', '3'], bad)), /^low-path verdict feature: insufficient/);
  }
});

// ---------- low-path-verdict: the time edge (0.75) ----------

test('time edge: exactly 0.75 of the before time passes, one second more fails', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3, { secs: 300 }, { secs: 400 });
  assert.match(feature(verdict(sb)), /: pass \|/);
  const sb2 = sandbox(t);
  fill(sb2, 'feature', 3, { secs: 301 }, { secs: 400 });
  const line = feature(verdict(sb2));
  assert.match(line, /: fail \|/);
  assert.match(line, / \| roll back: set pipeline\.short_path to off$/);
});

test('time minus CEO wait is the compared value, wall time is not', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3, { secs: 1000, wait: 700 }, { secs: 1000, wait: 600 });
  // short 300 vs before 400
  assert.match(feature(verdict(sb)), /: pass \| .* median 5m \(before 7m\)/);
});

test('medians are exact: an even set compares the true middle value unrounded', (t) => {
  const mk = (t2, beforeTimes) => {
    const sb = sandbox(t2);
    [100, 200, 300, 400].forEach((s, i) => run(sb, `f-s${i}`, { kind: 'short', i: 100 + i, secs: s }));
    beforeTimes.forEach((s, i) => run(sb, `f-b${i}`, { kind: 'old', i, secs: s }));
    return feature(verdict(sb, ['--runs', '4']));
  };
  // short median 250; 0.75 x 335 = 251.25 passes, 0.75 x 333 = 249.75 fails
  assert.match(mk(t, [330, 330, 340, 340]), /: pass \|/);
  assert.match(mk(t, [330, 330, 336, 336]), /: fail \|/);
});

// ---------- low-path-verdict: guards ----------

test('each guard fails the verdict when the short median is higher', (t) => {
  const cases = [
    ['fix rounds', { fix: 1 }, {}],
    ['high blockers', { high: 1 }, {}],
    ['gate rejects', { rej: 1 }, {}],
    ['spend', { spend: 1001 }, { spend: 1000 }]
  ];
  for (const [name, short, before] of cases) {
    const sb = sandbox(t);
    fill(sb, 'feature', 3, short, before);
    assert.match(feature(verdict(sb)), /: fail \|/, name);
  }
});

test('a guard equal to the before side passes, spend included', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3, { fix: 1, high: 1, rej: 1, spend: 1000 }, { fix: 1, high: 1, rej: 1, spend: 1000 });
  assert.match(feature(verdict(sb)), /: pass \|/);
});

test('raised share edge: 1 of 5 passes (0.20), 2 of 5 fails', (t) => {
  const mk = (t2, raisedCount) => {
    const sb = sandbox(t2);
    for (let i = 0; i < 5; i += 1) run(sb, `f-s${i}`, { kind: 'short', i: 100 + i, raised: i < raisedCount ? 1 : 0 });
    for (let i = 0; i < 5; i += 1) run(sb, `f-b${i}`, { kind: 'old', i, secs: 400 });
    return feature(verdict(sb, ['--runs', '5']));
  };
  assert.match(mk(t, 0), /: pass \| .*raised 0 of 5/);
  assert.match(mk(t, 1), /: pass \| .*raised 1 of 5/);
  assert.match(mk(t, 2), /: fail \| .*raised 2 of 5/);
});

test('raised with three runs: even one raised run fails (1 > 0.6)', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3);
  run(sb, 'feature-s2', { kind: 'short', i: 102, raised: 1 });
  assert.match(feature(verdict(sb)), /: fail \| .*raised 1 of 3/);
});

test('the playbooks are judged apart', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3);
  fill(sb, 'fix', 3, { fix: 2 }, {});
  const r = verdict(sb);
  assert.match(feature(r), /^low-path verdict feature: pass /);
  assert.match(fix(r), /^low-path verdict fix: fail /);
});

// ---------- low-path-verdict: playbook, side and keys ----------

test('pre-0.19 playbook inference: a product-manager step is feature, a first step by qa is fix, else not counted', (t) => {
  const sb = sandbox(t);
  run(sb, 'a-feature', { kind: 'old', stepRole: 'product-manager', i: 1 });
  run(sb, 'a-fix', { kind: 'old', stepRole: 'qa', i: 2 });
  run(sb, 'a-other', { kind: 'old', stepRole: 'architect', i: 3 });
  const r = verdict(sb);
  assert.match(feature(r), /runs 0 short, 1 before .*not counted: 1$/);
  assert.match(fix(r), /runs 0 short, 1 before .*not counted: 1$/);
});

test('inference: a product-manager step beats a first qa step; only the lowest step id decides a fix', (t) => {
  const sb = sandbox(t);
  run(sb, 'a-both', { kind: 'old', stepRole: 'qa', i: 1 });
  const file = ledgerFile(sb, 'a-both');
  fs.appendFileSync(file, stepPair('a-both', '02', 'product-manager', 'a9'));
  run(sb, 'a-late-qa', { kind: 'old', stepRole: 'architect', i: 2 });
  fs.appendFileSync(ledgerFile(sb, 'a-late-qa'), stepPair('a-late-qa', '05', 'qa', 'a8'));
  const r = verdict(sb);
  assert.match(feature(r), /runs 0 short, 1 before /);
  assert.match(fix(r), /runs 0 short, 0 before .*not counted: 1$/);
});

test('a 0.18 run is read like a pre-0.19 run; a 0.17 run too', (t) => {
  const sb = sandbox(t);
  run(sb, 'old-18', { kind: 'old18', i: 1 });
  run(sb, 'old-17', { kind: 'old17', i: 2 });
  assert.match(feature(verdict(sb)), /runs 0 short, 2 before /);
});

test('a 0.19 run takes its playbook from meta pb only', (t) => {
  const sb = sandbox(t);
  run(sb, 'n-short', { kind: 'short', pb: 'fix', stepRole: 'product-manager', i: 1 });
  const r = verdict(sb);
  assert.match(fix(r), /runs 1 short, 0 before /);
  assert.match(feature(r), /runs 0 short, 0 before /);
  // a 0.19 run whose meta has no pb is in neither
  const rec = readLines(sb, 'n-short');
  writeLedger(sb, 'n-nopb', ...rec.map((x) => (x.kind === 'meta' ? { v: 1, run: 'n-nopb', kind: 'meta', aico: '0.19.0' } : { ...x, run: 'n-nopb' })));
  const r2 = verdict(sb);
  assert.match(fix(r2), /runs 1 short, 0 before .*not counted: 1$/);
});

test('before side: ship tier low is required, for pre-0.19 and for 0.19 path full', (t) => {
  const sb = sandbox(t);
  run(sb, 'b-old-low', { kind: 'old', tier: 'low', i: 1 });
  run(sb, 'b-old-med', { kind: 'old', tier: 'medium', i: 2 });
  run(sb, 'b-old-high', { kind: 'old', tier: 'high', i: 3 });
  run(sb, 'b-full-low', { kind: 'full', tier: 'low', i: 4 });
  run(sb, 'b-full-med', { kind: 'full', tier: 'medium', i: 5 });
  run(sb, 'b-full-high', { kind: 'full', tier: 'high', i: 6 });
  const line = feature(verdict(sb));
  assert.match(line, /runs 0 short, 2 before .*excluded: 0 \| not counted: 4$/);
});

test('a pre-0.19 run with no tier on its ship is not a before run', (t) => {
  const sb = sandbox(t);
  run(sb, 'b-old', { kind: 'old', i: 1 });
  const recs = readLines(sb, 'b-old').map((x) => {
    if (x.kind === 'ship') delete x.tier;
    return x;
  });
  writeLedger(sb, 'b-old', ...recs);
  assert.match(feature(verdict(sb)), /runs 0 short, 0 before .*not counted: 1$/);
});

test('a 0.19 run needs a path on its ship; short with a ship tier other than low still counts as short', (t) => {
  const sb = sandbox(t);
  run(sb, 'p-nopath', { kind: 'full', noPath: true, i: 1 });
  run(sb, 'p-short-med', { kind: 'short', tier: 'medium', raised: 1, i: 2 });
  const line = feature(verdict(sb));
  assert.match(line, /runs 1 short, 0 before .*raised 1 of 1 \| excluded: 0 \| not counted: 1$/);
});

test('the 0.19 path full run counts as before (CEO choice), with the same side as a pre-0.19 low run', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3, {}, {}, 'full');
  const line = feature(verdict(sb));
  assert.match(line, /^low-path verdict feature: pass \| runs 3 short, 3 before /);
});

test('a run before 0.19.0 with path short on its ship is not a short run', (t) => {
  const sb = sandbox(t);
  run(sb, 'x-18', { kind: 'old18', i: 1 });
  const recs = readLines(sb, 'x-18').map((x) => (x.kind === 'ship' ? { ...x, path: 'short', raised: 0 } : x));
  writeLedger(sb, 'x-18', ...recs);
  assert.match(feature(verdict(sb)), /runs 0 short, 1 before .*not counted: 0$/);
});

test('keys: runs with another plan check, floor or cap key than the newest short run are excluded', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3, { cap: 4, floor: '0.16.0' }, { cap: 4, floor: '0.16.0' }, 'full');
  // newest short run holds the reference keys: cap 4, floor 0.16.0
  run(sb, 'feature-odd-cap', { kind: 'short', i: 50, cap: 2, floor: '0.16.0' });
  run(sb, 'feature-odd-floor', { kind: 'short', i: 51, cap: 4, floor: '0.18.0' });
  run(sb, 'feature-no-floor', { kind: 'full', i: 52, cap: 4 });
  run(sb, 'feature-no-cap', { kind: 'full', i: 53, floor: '0.16.0' });
  const line = feature(verdict(sb));
  assert.match(line, /^low-path verdict feature: pass \| runs 3 short, 3 before \(plan check none, floor 0\.16\.0, cap 4\) /);
  assert.match(line, /excluded: 4 \| not counted: 0$/);
});

test('keys: floor key for a 0.17 run without a floor is 0.16.0, a run with no meta has floor none', (t) => {
  const sb = sandbox(t);
  // reference: a short run with no floor and no par line → floor none, cap none
  fill(sb, 'feature', 3);
  run(sb, 'feature-17', { kind: 'old17', i: 60 });
  const line = feature(verdict(sb));
  assert.match(line, /\(plan check none, floor none, cap none\)/);
  assert.match(line, /excluded: 1 \| not counted: 0$/);
  const sb2 = sandbox(t);
  fill(sb2, 'feature', 3, { floor: '0.16.0' }, {});
  run(sb2, 'feature-17', { kind: 'old17', i: 60 });
  assert.match(feature(verdict(sb2)), /runs 3 short, 1 before \(plan check none, floor 0\.16\.0, cap none\).*excluded: 3 /);
});

test('a run that is not counted by the shared rules adds to not counted', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3);
  run(sb, 'feature-untimed', { kind: 'short', i: 300 });
  const recs = readLines(sb, 'feature-untimed').map((x) => {
    if (x.kind === 'ship') {
      delete x.t_start;
      delete x.t_ship;
      delete x.wait;
    }
    return x;
  });
  writeLedger(sb, 'feature-untimed', ...recs);
  run(sb, 'feature-unreconciled', { kind: 'short', i: 301 });
  writeLedger(sb, 'feature-unreconciled', ...readLines(sb, 'feature-unreconciled').filter((x) => x.src !== 'transcript'));
  assert.match(feature(verdict(sb)), /runs 3 short, 3 before .* \| not counted: 2$/);
});

test('brainstorm, replay and baseline files are left out and not counted', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3);
  for (const name of ['brainstorm-20261028-1000', 'replay-x', 'baseline-x']) run(sb, name, { kind: 'short', i: 400 });
  assert.match(feature(verdict(sb)), /runs 3 short, 3 before .* \| not counted: 0$/);
});

// ---------- low-path-verdict: the line ----------

test('the line holds no percent sign, currency or saving word and no error reads as pass', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3);
  fill(sb, 'fix', 3, { fix: 3 });
  for (const r of [verdict(sb), verdict(sb, ['--runs', '3'], boom), verdict(sb, ['--runs', '9'])]) {
    for (const line of r.lines) {
      assert.doesNotMatch(line, /%|\$|€|£|saving|saved|cheaper|faster/i);
      assert.equal(line.includes('\n'), false);
    }
  }
  assert.doesNotMatch(verdict(sb, ['--runs', '3'], boom).lines.join(' '), /: pass/);
});

test('a bad line in a ledger is skipped and counted in warnings', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3);
  fs.appendFileSync(ledgerFile(sb, 'feature-s0'), '{ not json\n');
  fs.appendFileSync(ledgerFile(sb, 'feature-s1'), `${JSON.stringify({ v: 1, run: 'feature-s1', kind: 'meta', aico: '0.19.0', pb: 'both' })}\n`);
  const line = feature(verdict(sb));
  assert.match(line, /^low-path verdict feature: pass /);
  assert.match(line, / \| warnings: 2$/);
});

test('a ledger over its size limit is not read and counts as not counted', (t) => {
  const sb = sandbox(t);
  fill(sb, 'feature', 3);
  fs.appendFileSync(ledgerFile(sb, 'feature-s0'), `${'x'.repeat(1024 * 1024 + 10)}\n`);
  assert.match(feature(verdict(sb)), /runs 2 short, 3 before .* \| not counted: 1$/);
});

// ---------- the parallel verdict leaves short runs out ----------

const BUILDERS = (name, i) => stepPair(name, '03', 'backend-engineer', `b${i}0`) + stepPair(name, '04', 'frontend-engineer', `b${i}1`);

function parRuns(sb, pb18 = 3) {
  const builders = (name, i) => fs.appendFileSync(ledgerFile(sb, name), BUILDERS(name, i));
  for (let i = 0; i < pb18; i += 1) {
    run(sb, `p18-${i}`, { kind: 'full', aico: '0.18.0', cap: 4, floor: '0.16.0', i: 100 + i, secs: 300, noPath: true });
    builders(`p18-${i}`, i);
    run(sb, `p17-${i}`, { kind: 'old17', i, secs: 600 });
    builders(`p17-${i}`, i + 10);
  }
}

test('parallel-verdict gives the same line with and without a short run, except not counted', (t) => {
  const sb = sandbox(t);
  parRuns(sb);
  const base = call(sb, ['parallel-verdict', '--runs', '3']).lines[0];
  assert.match(base, /^parallel verdict: pass \| runs 3 v0\.18, 3 v0\.17 /);
  assert.match(base, /not counted: 0$/);
  run(sb, 'p19-short', { kind: 'short', aico: '0.19.0', cap: 4, floor: '0.16.0', i: 500, secs: 10 });
  fs.appendFileSync(ledgerFile(sb, 'p19-short'), BUILDERS('p19-short', 90));
  const withShort = call(sb, ['parallel-verdict', '--runs', '3']).lines[0];
  assert.equal(withShort, base.replace(/not counted: 0$/, 'not counted: 1'));
});

test('parallel-verdict still counts a 0.19 run with path full as a v0.18 run', (t) => {
  const sb = sandbox(t);
  parRuns(sb, 2);
  run(sb, 'p19-full', { kind: 'full', aico: '0.19.0', cap: 4, floor: '0.16.0', i: 500, secs: 300 });
  fs.appendFileSync(ledgerFile(sb, 'p19-full'), BUILDERS('p19-full', 91));
  const line = call(sb, ['parallel-verdict', '--runs', '3']).lines[0];
  assert.match(line, /runs 3 v0\.18, 2 v0\.17 /);
});

test('model-verdict is unchanged by short runs and by the new keys', (t) => {
  const sb = sandbox(t);
  const before = call(sb, ['model-verdict']).lines;
  run(sb, 'm-short', { kind: 'short', i: 1 });
  run(sb, 'm-17', { kind: 'old17', i: 2 });
  const after = call(sb, ['model-verdict']).lines[0];
  assert.match(after, /^model verdict: insufficient \(n=1\) \| runs 1 v0\.17, 0 v0\.16 /);
  assert.match(after, /not counted: 1$/);
  assert.match(before[0], /not counted: 0$/);
});

// ---------- housekeeping ----------

test('the usage text lists low-path-verdict and an unknown command is refused', (t) => {
  const sb = sandbox(t);
  const r = call(sb, ['nope']);
  assert.equal(r.code, 2);
  assert.match(r.lines[0], /low-path-verdict \[--runs <3-50>\]/);
});

test('the script and this test are LF only and the script imports readTierPath with the node: prefix elsewhere', () => {
  for (const f of ['ledger.mjs', 'ledger-tier.test.mjs']) assert.equal(fs.readFileSync(path.join(import.meta.dirname, f)).includes(13), false, f);
  const src = fs.readFileSync(path.join(import.meta.dirname, 'ledger.mjs'), 'utf8');
  assert.match(src, /import \{ readTierPath \} from '\.\/tier-set\.mjs';/);
  assert.doesNotMatch(src, /from '(fs|os|path|url)'/);
});
