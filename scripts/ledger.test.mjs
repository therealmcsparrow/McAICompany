import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateRecord } from './ledger.mjs';

const script = path.join(import.meta.dirname, 'ledger.mjs');
const fixtures = path.join(import.meta.dirname, '..', 'tests', 'fixtures', 'ledger');
const FAKE_HOME = path.join(fixtures, 'claude-home');
const BASELINE = path.join(fixtures, 'baseline-counts.json');
const MiB = 1024 * 1024;

// Every test works in its own temp project dir; the real user home is never touched.
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  return { dir, home };
}

function run(sb, args, { claude = FAKE_HOME } = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: sb.dir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: claude, HOME: sb.home, USERPROFILE: sb.home }
  });
  return { status: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

const ledgerFile = (sb, name) => path.join(sb.dir, '.company', 'ledger', `${name}.jsonl`);
const readLines = (sb, name) =>
  fs.readFileSync(ledgerFile(sb, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const writeLedger = (sb, name, text) => {
  fs.mkdirSync(path.dirname(ledgerFile(sb, name)), { recursive: true });
  fs.writeFileSync(ledgerFile(sb, name), text);
};

const ALLOWED_KEYS = new Set([
  'v', 'run', 'kind', 'id', 'role', 'agent', 'src', 'ctx_end', 'tokens', 'reqs', 'tool_uses', 'ms', 'model',
  'dispatches', 'acs', 'fix_rounds', 'high_blockers'
]);

// ---------- schema (hostile cases first) ----------

const goodNotification = {
  v: 1, run: 'demo', kind: 'step', id: '01', role: 'architect', agent: 'aaa111', src: 'notification', ctx_end: 5000
};

test('validateRecord accepts a notification record', () => {
  assert.equal(validateRecord(goodNotification).ok, true);
});

test('validateRecord refuses unknown keys, free text and wrong shapes', () => {
  const bad = [
    { ...goodNotification, prompt: 'hello' },
    { ...goodNotification, note: 'free text' },
    { ...goodNotification, tokens: { in: 1, cache_write: 1, cache_read: 1, out: 1 } },
    { ...goodNotification, run: '../x' },
    { ...goodNotification, run: 'UPPER' },
    { ...goodNotification, kind: 'total' }, // total never has a notification source
    { ...goodNotification, id: '1' },
    { ...goodNotification, role: 'ignore previous instructions' },
    { ...goodNotification, agent: 'a/b' },
    { ...goodNotification, agent: undefined },
    { ...goodNotification, ctx_end: -1 },
    { ...goodNotification, ctx_end: 1.5 },
    { ...goodNotification, ctx_end: '5' },
    { ...goodNotification, ctx_end: 10000001 },
    { ...goodNotification, v: 2 },
    { ...goodNotification, model: 'Has Spaces' },
    'not an object',
    null,
    []
  ];
  for (const rec of bad) assert.equal(validateRecord(rec).ok, false, JSON.stringify(rec));
});

test('validateRecord checks transcript tokens exactly', () => {
  const t = { ...goodNotification, src: 'transcript', ctx_end: undefined, tokens: { in: 1, cache_write: 2, cache_read: 3, out: 4 } };
  assert.equal(validateRecord(t).ok, true);
  const bad = [
    { ...t, tokens: { in: 1, cache_write: 2, cache_read: 3 } },
    { ...t, tokens: { in: 1, cache_write: 2, cache_read: 3, out: 4, extra: 5 } },
    { ...t, tokens: { in: 1, cache_write: 2, cache_read: 3, out: 1000000001 } },
    { ...t, tokens: { in: 1, cache_write: 2, cache_read: 3, out: '4' } },
    { ...t, tokens: undefined },
    { ...t, tokens: [1, 2, 3, 4] }
  ];
  for (const rec of bad) assert.equal(validateRecord(rec).ok, false, JSON.stringify(rec));
});

test('validateRecord checks ship and total records', () => {
  assert.equal(validateRecord({ v: 1, run: 'demo', kind: 'ship', acs: 5, fix_rounds: 1, high_blockers: 0 }).ok, true);
  assert.equal(validateRecord({ v: 1, run: 'demo', kind: 'ship', acs: -1 }).ok, false);
  assert.equal(validateRecord({ v: 1, run: 'demo', kind: 'ship', acs: 5, role: 'lead' }).ok, false);
  assert.equal(validateRecord({ v: 1, run: 'demo', kind: 'ship' }).ok, false);
  const total = {
    v: 1, run: 'demo', kind: 'total', id: 'aaaaaaaa', role: 'lead', src: 'transcript', dispatches: 3,
    tokens: { in: 1, cache_write: 1, cache_read: 1, out: 1 }
  };
  assert.equal(validateRecord(total).ok, true);
  assert.equal(validateRecord({ ...total, id: '01' }).ok, false);
});

test('ship-only count fields are refused on every other record type, whatever their value (Art. 5(1)(c))', () => {
  const total = {
    v: 1, run: 'demo', kind: 'total', id: 'aaaaaaaa', role: 'lead', src: 'transcript', dispatches: 3,
    tokens: { in: 1, cache_write: 1, cache_read: 1, out: 1 }
  };
  const transcript = { ...goodNotification, src: 'transcript', ctx_end: undefined, tokens: { in: 1, cache_write: 2, cache_read: 3, out: 4 } };
  for (const base of [goodNotification, transcript, total, { ...goodNotification, kind: 'round', id: 'R2' }]) {
    for (const key of ['acs', 'fix_rounds', 'high_blockers']) {
      for (const value of ['Jane Doe', 'jane@example.com', 5, -1, null, { name: 'x' }]) {
        assert.equal(validateRecord({ ...base, [key]: value }).ok, false, `${base.kind} ${key}=${JSON.stringify(value)}`);
      }
    }
  }
});

test('ship counts must be integers, also as free text', () => {
  const ship = { v: 1, run: 'demo', kind: 'ship', acs: 5 };
  for (const key of ['acs', 'fix_rounds', 'high_blockers']) {
    for (const value of ['Jane Doe', 'jane@example.com', '5', 1.5, -1, null, true, [], { n: 1 }, 100001]) {
      assert.equal(validateRecord({ ...ship, [key]: value }).ok, false, `${key}=${JSON.stringify(value)}`);
    }
  }
  assert.equal(validateRecord({ ...ship, fix_rounds: undefined }).ok, true);
});

test('key checks ignore inherited properties (node.M-SEC2)', () => {
  const inherited = Object.create({ agent: 'a/b', dispatches: 3, ctx_end: 'x', tokens: 'x', reqs: 'x', model: 'X Y' });
  Object.assign(inherited, goodNotification);
  delete inherited.agent;
  assert.equal(validateRecord(inherited).ok, false, 'agent required: an inherited agent does not count');
  const proto = Object.create({ fix_rounds: 'Jane Doe' });
  Object.assign(proto, { v: 1, run: 'demo', kind: 'ship', acs: 5 });
  assert.equal(validateRecord(proto).ok, true, 'inherited fields are not read');
  const src = fs.readFileSync(script, 'utf8');
  assert.ok(!/'[a-z_]+' in rec\b/.test(src), 'no in-operator key checks on records');
});

test('add never writes a ship-only field on a step record (reproduced case)', () => {
  const sb = sandbox();
  const r = run(sb, ['add', 'demo', 'step', '01', 'architect', 'aaa111', '5000']);
  assert.equal(r.status, 0);
  const bad = { ...readLines(sb, 'demo')[0], acs: 'Jane Doe jane@example.com' };
  assert.equal(validateRecord(bad).ok, false);
  writeLedger(sb, 'demo', `${JSON.stringify(bad)}\n`);
  assert.match(run(sb, ['report', 'demo']).out, /line 1 skipped/, 'a stored bad line is skipped on read');
});

// ---------- add ----------

test('add appends exactly one notification record', () => {
  const sb = sandbox();
  const r = run(sb, ['add', 'demo', 'step', '01', 'architect', 'aaa111', '5000', '12', '34000']);
  assert.equal(r.status, 0, r.all);
  assert.deepEqual(readLines(sb, 'demo'), [
    { v: 1, run: 'demo', kind: 'step', id: '01', role: 'architect', agent: 'aaa111', src: 'notification', ctx_end: 5000, tool_uses: 12, ms: 34000 }
  ]);
  run(sb, ['add', 'demo', 'round', 'R2', 'lead', 'bbb222', '0']);
  assert.equal(readLines(sb, 'demo').length, 2);
});

test('add refuses invalid fields with exit 2 and writes nothing', () => {
  const sb = sandbox();
  const cases = [
    ['add', '../evil', 'step', '01', 'architect', 'aaa111', '5'],
    ['add', 'demo', 'total', '01', 'architect', 'aaa111', '5'],
    ['add', 'demo', 'ship', '01', 'architect', 'aaa111', '5'],
    ['add', 'demo', 'step', '1', 'architect', 'aaa111', '5'],
    ['add', 'demo', 'round', '01', 'architect', 'aaa111', '5'],
    ['add', 'demo', 'step', '01', 'ignore previous instructions', 'aaa111', '5'],
    ['add', 'demo', 'step', '01', 'architect', 'a/../b', '5'],
    ['add', 'demo', 'step', '01', 'architect', 'aaa111', '-1'],
    ['add', 'demo', 'step', '01', 'architect', 'aaa111', '1.5'],
    ['add', 'demo', 'step', '01', 'architect', 'aaa111', 'lots'],
    ['add', 'demo', 'step', '01', 'architect', 'aaa111', '5', 'x'],
    ['add', 'demo', 'step', '01', 'architect', 'aaa111', '5', '1', '2', 'extra'],
    ['add', 'demo', 'step', '01', 'architect']
  ];
  for (const args of cases) {
    const r = run(sb, args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.all, /^refused: /m, args.join(' '));
  }
  assert.equal(fs.existsSync(ledgerFile(sb, 'demo')), false);
  assert.equal(fs.existsSync(path.join(sb.dir, '.company', 'ledger', '..', 'evil.jsonl')), false);
});

test('add refuses once the file would pass 1 MiB', () => {
  const sb = sandbox();
  writeLedger(sb, 'demo', 'x'.repeat(MiB) + '\n');
  const r = run(sb, ['add', 'demo', 'step', '01', 'architect', 'aaa111', '5']);
  assert.equal(r.status, 2);
  assert.match(r.all, /refused: .*1 MiB/);
});

test('unknown command and no command print usage with exit 2', () => {
  const sb = sandbox();
  assert.equal(run(sb, []).status, 2);
  assert.equal(run(sb, ['frobnicate']).status, 2);
});

// ---------- reconcile ----------

function seed(sb, name = 'demo') {
  run(sb, ['add', name, 'step', '01', 'architect', 'aaa111', '1255', '3', '1000']);
  run(sb, ['add', name, 'step', '02', 'qa', 'bbb222', '10']);
  run(sb, ['add', name, 'step', '03', 'qa', 'ccc333', '0']);
}

test('reconcile sums the four counts per request, keeps the last usage per request id, stores nothing else', () => {
  const sb = sandbox();
  seed(sb);
  const r = run(sb, ['reconcile', 'demo']);
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /reconciled: 2, not reconciled: 1/);
  const recs = readLines(sb, 'demo').filter((x) => x.src === 'transcript');
  assert.equal(recs.length, 2);
  assert.deepEqual(recs[0], {
    v: 1, run: 'demo', kind: 'step', id: '01', role: 'architect', agent: 'aaa111', src: 'transcript',
    ctx_end: 1255, tokens: { in: 15, cache_write: 120, cache_read: 2200, out: 110 }, reqs: 2, tool_uses: 3, ms: 1000,
    model: 'claude-sonnet-5-5'
  });
  // an invalid model id is dropped, not stored
  assert.equal('model' in recs[1], false);
  assert.deepEqual(recs[1].tokens, { in: 1, cache_write: 2, cache_read: 3, out: 4 });
  assert.equal(recs[1].reqs, 1);
});

test('reconcile never copies transcript text into the ledger or the output (Art. 5(1)(c))', () => {
  const sb = sandbox();
  seed(sb);
  const r = run(sb, ['reconcile', 'demo']);
  const text = fs.readFileSync(ledgerFile(sb, 'demo'), 'utf8');
  for (const needle of ['SECRET', 'ignore previous', 'polluted']) {
    assert.equal(text.includes(needle), false, needle);
    assert.equal(r.all.includes(needle), false, needle);
  }
  for (const rec of readLines(sb, 'demo')) {
    for (const k of Object.keys(rec)) assert.ok(ALLOWED_KEYS.has(k), k);
    assert.equal(validateRecord(rec).ok, true);
  }
});

test('reconcile is idempotent: a reconciled agent is not appended again', () => {
  const sb = sandbox();
  seed(sb);
  run(sb, ['reconcile', 'demo']);
  const before = fs.readFileSync(ledgerFile(sb, 'demo'), 'utf8');
  const r = run(sb, ['reconcile', 'demo']);
  assert.equal(r.status, 0);
  assert.match(r.out, /reconciled: 0, not reconciled: 1/);
  assert.equal(fs.readFileSync(ledgerFile(sb, 'demo'), 'utf8'), before);
});

test('reconcile with an unreadable claude home leaves everything unreconciled, exit 0', () => {
  const sb = sandbox();
  seed(sb);
  const r = run(sb, ['reconcile', 'demo'], { claude: path.join(sb.dir, 'does-not-exist') });
  assert.equal(r.status, 0);
  assert.match(r.out, /reconciled: 0, not reconciled: 3/);
});

test('reconcile with no ledger prints a note and exits 0', () => {
  const sb = sandbox();
  const r = run(sb, ['reconcile', 'demo']);
  assert.equal(r.status, 0);
  assert.match(r.out, /no ledger for demo/);
});

test('reconcile skips a transcript over 64 MiB and a line over 8 MiB with a size warning', () => {
  const sb = sandbox();
  const claude = path.join(sb.dir, 'claude');
  const sub = path.join(claude, 'projects', 'p', 's', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const big = path.join(sub, 'agent-big111.jsonl');
  fs.writeFileSync(big, '');
  fs.truncateSync(big, 64 * MiB + 1); // sparse, cheap
  const line = path.join(sub, 'agent-line222.jsonl');
  fs.writeFileSync(
    line,
    '{"type":"assistant","requestId":"r","message":{"usage":{"input_tokens":1,"output_tokens":1}}}\n' +
      '{"pad":"' + 'a'.repeat(8 * MiB + 10) + '"}\n'
  );
  const ok = path.join(sub, 'agent-ok333.jsonl');
  fs.writeFileSync(ok, '{"type":"assistant","requestId":"r","message":{"usage":{"input_tokens":1,"output_tokens":2}}}\n');
  run(sb, ['add', 'demo', 'step', '01', 'architect', 'big111', '1']);
  run(sb, ['add', 'demo', 'step', '02', 'architect', 'line222', '1']);
  run(sb, ['add', 'demo', 'step', '03', 'architect', 'ok333', '1']);
  const r = run(sb, ['reconcile', 'demo'], { claude });
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /warning: big111 skipped \(size\)/);
  assert.match(r.out, /warning: line222 skipped \(size\)/);
  assert.match(r.out, /reconciled: 1, not reconciled: 2/);
});

test('reconcile ignores a ledger line whose agent could escape the transcript folder', () => {
  const sb = sandbox();
  writeLedger(
    sb, 'demo',
    JSON.stringify({ v: 1, run: 'demo', kind: 'step', id: '01', role: 'qa', agent: '../../../etc/passwd', src: 'notification', ctx_end: 1 }) + '\n'
  );
  const r = run(sb, ['reconcile', 'demo']);
  assert.equal(r.status, 0);
  assert.match(r.out, /warning: line 1 skipped/);
  assert.match(r.out, /reconciled: 0, not reconciled: 0/);
});

test('reconcile refuses an invalid run name', () => {
  const sb = sandbox();
  const r = run(sb, ['reconcile', '../x']);
  assert.equal(r.status, 2);
  assert.match(r.all, /refused: /);
});

// ---------- import ----------

test('import writes one total and one ship record from an allow-listed baseline entry', () => {
  const sb = sandbox();
  const r = run(sb, ['import', BASELINE, 'aaaaaaaa aico/alpha', 'baseline-alpha', '10']);
  assert.equal(r.status, 0, r.all);
  assert.deepEqual(readLines(sb, 'baseline-alpha'), [
    {
      v: 1, run: 'baseline-alpha', kind: 'total', id: 'aaaaaaaa', role: 'lead', src: 'transcript', reqs: 60, dispatches: 20,
      tokens: { in: 100, cache_write: 9000, cache_read: 100000, out: 10900 }
    },
    { v: 1, run: 'baseline-alpha', kind: 'ship', acs: 10 }
  ]);
  const text = fs.readFileSync(ledgerFile(sb, 'baseline-alpha'), 'utf8');
  for (const needle of ['roles', 'notif_total', 'aico:qa', '2026-10-16']) assert.equal(text.includes(needle), false, needle);
});

test('import refuses an entry with an extra key, a __proto__ key, or a non-integer count', () => {
  const sb = sandbox();
  for (const key of ['dddddddd aico/extra', 'eeeeeeee aico/proto', 'ffffffff aico/float']) {
    const r = run(sb, ['import', BASELINE, key, 'baseline-x', '1']);
    assert.equal(r.status, 2, key);
    assert.match(r.all, /^refused: /m);
    assert.equal(r.all.includes('SECRET'), false);
  }
  assert.equal(fs.existsSync(ledgerFile(sb, 'baseline-x')), false);
});

test('import refuses bad keys, a missing key, bad acs and an existing run', () => {
  const sb = sandbox();
  const cases = [
    ['import', BASELINE, '../../x', 'baseline-x', '1'],
    ['import', BASELINE, 'toString', 'baseline-x', '1'],
    ['import', BASELINE, '__proto__', 'baseline-x', '1'],
    ['import', BASELINE, 'zzzzzzzz nope', 'baseline-x', '1'],
    ['import', BASELINE, 'aaaaaaaa aico/alpha', 'baseline-x', '-1'],
    ['import', BASELINE, 'aaaaaaaa aico/alpha', 'baseline-x', 'many'],
    ['import', BASELINE, 'aaaaaaaa aico/alpha', '../x', '1'],
    ['import', path.join(sb.dir, 'missing.json'), 'aaaaaaaa aico/alpha', 'baseline-x', '1']
  ];
  for (const args of cases) {
    const r = run(sb, args);
    assert.equal(r.status, 2, args.slice(2).join(' | '));
    assert.match(r.all, /^refused: /m);
  }
  assert.equal(run(sb, ['import', BASELINE, 'aaaaaaaa aico/alpha', 'baseline-x', '4']).status, 0);
  const again = run(sb, ['import', BASELINE, 'bbbbbbbb aico/beta', 'baseline-x', '4']);
  assert.equal(again.status, 2);
  assert.match(again.all, /refused: .*exists/);
  assert.equal(readLines(sb, 'baseline-x').length, 2);
});

test('import refuses a baseline file over 1 MiB and one that is not a JSON object', () => {
  const sb = sandbox();
  const big = path.join(sb.dir, 'big.json');
  fs.writeFileSync(big, '{"aaaaaaaa x":{"pad":"' + 'a'.repeat(MiB) + '"}}');
  assert.equal(run(sb, ['import', big, 'aaaaaaaa x', 'baseline-x', '1']).status, 2);
  const arr = path.join(sb.dir, 'arr.json');
  fs.writeFileSync(arr, '[1,2]');
  assert.equal(run(sb, ['import', arr, 'aaaaaaaa x', 'baseline-x', '1']).status, 2);
  const junk = path.join(sb.dir, 'junk.json');
  fs.writeFileSync(junk, '{nope');
  assert.equal(run(sb, ['import', junk, 'aaaaaaaa x', 'baseline-x', '1']).status, 2);
});

// ---------- ship ----------

test('ship appends the ship record and refuses bad numbers', () => {
  const sb = sandbox();
  assert.equal(run(sb, ['ship', 'demo', '5', '2', '1']).status, 0);
  assert.deepEqual(readLines(sb, 'demo'), [{ v: 1, run: 'demo', kind: 'ship', acs: 5, fix_rounds: 2, high_blockers: 1 }]);
  for (const args of [['ship', 'demo', 'x'], ['ship', 'demo', '-1'], ['ship', 'demo', '5', '1.5'], ['ship', '../x', '5']]) {
    const r = run(sb, args);
    assert.equal(r.status, 2, args.join(' '));
  }
  assert.equal(readLines(sb, 'demo').length, 1);
});

// ---------- report ----------

function importBaselines(sb) {
  assert.equal(run(sb, ['import', BASELINE, 'aaaaaaaa aico/alpha', 'baseline-alpha', '10']).status, 0);
  assert.equal(run(sb, ['import', BASELINE, 'bbbbbbbb aico/beta', 'baseline-beta', '10']).status, 0);
  assert.equal(run(sb, ['import', BASELINE, 'cccccccc feat/gamma', 'baseline-gamma', '5']).status, 0);
}

test('report with no ledger prints a note and exits 0', () => {
  const sb = sandbox();
  const r = run(sb, ['report', 'demo']);
  assert.equal(r.status, 0);
  assert.match(r.out, /no ledger for demo/);
});

test('report shows spend and cache read apart, per shipped AC, and counts unreconciled records', () => {
  const sb = sandbox();
  seed(sb);
  run(sb, ['reconcile', 'demo']);
  run(sb, ['ship', 'demo', '5']);
  const r = run(sb, ['report', 'demo']);
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /spend: 252 total, 50 per AC/);
  assert.match(r.out, /cache read: 2203 total, 441 per AC/);
  assert.match(r.out, /not reconciled: 1/);
  // an unreconciled record shows its context size only, and a 0 reads as unknown, never as zero
  assert.match(r.out, /step 03 qa .*context at end unknown/);
  assert.match(r.out, /step 01 architect .*spend 245 .*cache read 2200/);
  // spend and cache read are never one number
  assert.equal(r.out.includes('2455'), false);
});

test('report compares against the median of the baseline runs', () => {
  const sb = sandbox();
  importBaselines(sb);
  seed(sb);
  run(sb, ['reconcile', 'demo']);
  run(sb, ['ship', 'demo', '5']);
  const r = run(sb, ['report', 'demo', '--baseline', 'baseline-alpha,baseline-beta,baseline-gamma']);
  assert.equal(r.status, 0, r.all);
  // per AC: 2000, 3000, 8000 -> median 3000; 50 vs 3000 = -98%
  assert.match(r.out, /spend median 3000 per AC, delta -98%/);
  // cache read per AC: 10000, 20000, 60000 -> median 20000; 441 vs 20000 = -98%
  assert.match(r.out, /cache read median 20000 per AC, delta -98%/);
});

test('report reads a baseline run the same way as any run', () => {
  const sb = sandbox();
  importBaselines(sb);
  const r = run(sb, ['report', 'baseline-alpha']);
  assert.match(r.out, /spend: 20000 total, 2000 per AC/);
  assert.match(r.out, /cache read: 100000 total, 10000 per AC/);
});

test('report with nothing reconciled shows context at end and no spend', () => {
  const sb = sandbox();
  seed(sb);
  const r = run(sb, ['report', 'demo']);
  assert.equal(r.status, 0);
  assert.match(r.out, /spend: n\/a \(nothing reconciled\)/);
  assert.match(r.out, /context at end/);
  assert.match(r.out, /not reconciled: 3/);
});

test('report skips bad lines with a warning and still exits 0', () => {
  const sb = sandbox();
  writeLedger(
    sb, 'demo',
    'not json\n' +
      JSON.stringify({ ...goodNotification, run: 'demo', prompt: 'SECRET' }) + '\n' +
      JSON.stringify({ ...goodNotification, run: 'demo' }) + '\n'
  );
  const r = run(sb, ['report', 'demo']);
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /warning: line 1 skipped/);
  assert.match(r.out, /warning: line 2 skipped/);
  assert.equal(r.all.includes('SECRET'), false);
  assert.match(r.out, /step 01 architect/);
});

test('report with a missing baseline run notes it and still exits 0', () => {
  const sb = sandbox();
  seed(sb);
  const r = run(sb, ['report', 'demo', '--baseline', 'baseline-none']);
  assert.equal(r.status, 0);
  assert.match(r.out, /baseline baseline-none: no ledger/);
});

test('report refuses a bad run name or a bad flag with exit 2', () => {
  const sb = sandbox();
  assert.equal(run(sb, ['report', '../x']).status, 2);
  assert.equal(run(sb, ['report', 'demo', '--bogus']).status, 2);
  assert.equal(run(sb, ['report', 'demo', '--baseline', 'a/b']).status, 2);
});

// ---------- brainstorm-report ----------

function transcriptRec(run_, kind, id, agent, t) {
  return JSON.stringify({ v: 1, run: run_, kind, id, role: 'lead', agent, src: 'transcript', tokens: t }) + '\n';
}

test('brainstorm-report counts from round 2 on, the crossfire share and the deltas', () => {
  const sb = sandbox();
  writeLedger(
    sb, 'brainstorm-20261026-1200',
    transcriptRec('brainstorm-20261026-1200', 'round', 'R1', 'a1', { in: 1000, cache_write: 0, cache_read: 50000, out: 0 }) +
      transcriptRec('brainstorm-20261026-1200', 'round', 'R2', 'a2', { in: 100, cache_write: 100, cache_read: 1000, out: 100 }) +
      transcriptRec('brainstorm-20261026-1200', 'crossfire', 'R2', 'a3', { in: 50, cache_write: 50, cache_read: 500, out: 100 }) +
      transcriptRec('brainstorm-20261026-1200', 'round', 'R3', 'a4', { in: 100, cache_write: 100, cache_read: 1000, out: 100 }) +
      JSON.stringify({ v: 1, run: 'brainstorm-20261026-1200', kind: 'round', id: 'R3', role: 'lead', agent: 'a5', src: 'notification', ctx_end: 9 }) + '\n'
  );
  writeLedger(
    sb, 'replay-old',
    transcriptRec('replay-old', 'round', 'R1', 'o1', { in: 9999, cache_write: 0, cache_read: 0, out: 0 }) +
      transcriptRec('replay-old', 'round', 'R2', 'o2', { in: 300, cache_write: 300, cache_read: 3000, out: 400 }) +
      transcriptRec('replay-old', 'round', 'R3', 'o3', { in: 300, cache_write: 300, cache_read: 3000, out: 400 })
  );
  const r = run(sb, ['brainstorm-report', 'brainstorm-20261026-1200', '--against', 'replay-old']);
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /R2 .*spend 500 .*cache read 1500/); // 100+100+100 + 50+50+100
  assert.match(r.out, /R3 .*spend 300 .*cache read 1000/);
  assert.equal(/R1 /.test(r.out), false);
  assert.match(r.out, /spend: 800 total/);
  assert.match(r.out, /cache read: 2500 total/);
  assert.match(r.out, /crossfire share: 25% of spend/); // 200 / 800
  assert.match(r.out, /not reconciled: 1/);
  // against replay-old: spend 2000 (R2+R3), cache read 6000
  assert.match(r.out, /spend delta -60%/);
  assert.match(r.out, /cache read delta -58%/);
});

test('brainstorm-report with no ledger or no rounds exits 0', () => {
  const sb = sandbox();
  const r = run(sb, ['brainstorm-report', 'brainstorm-20261026-1200']);
  assert.equal(r.status, 0);
  assert.match(r.out, /no ledger for/);
  writeLedger(sb, 'replay-x', transcriptRec('replay-x', 'round', 'R1', 'a1', { in: 1, cache_write: 1, cache_read: 1, out: 1 }));
  const r2 = run(sb, ['brainstorm-report', 'replay-x']);
  assert.equal(r2.status, 0);
  assert.match(r2.out, /no rounds from round 2 on/);
});

// ---------- mod records (add-mod) ----------

const goodMod = {
  v: 1, run: 'demo', kind: 'reflect', id: '05', role: 'lead', src: 'mod', tokens: { in: 100, cache_write: 10, cache_read: 1000, out: 50 }
};

test('validateRecord refuses every hostile mod record before it accepts the good one', () => {
  const bad = [
    { ...goodMod, agent: 'a1' },
    { ...goodMod, ctx_end: 5 },
    { ...goodMod, ctx_end: 0 },
    { ...goodMod, kind: 'keepwarm', id: 'W1' },
    { ...goodMod, kind: 'step' },
    { ...goodMod, kind: 'round', id: 'R1' },
    { ...goodMod, kind: 'total', id: 'aaaaaaaa', dispatches: 1 },
    { ...goodMod, kind: 'ship' },
    { ...goodMod, id: '5' },
    { ...goodMod, id: 'W1' },
    { ...goodMod, id: 'R1' },
    { ...goodMod, id: 'RT2' },
    { ...goodMod, id: 'rt' },
    { ...goodMod, role: 'architect' },
    { ...goodMod, role: undefined },
    { ...goodMod, tokens: undefined },
    { ...goodMod, tokens: { in: 1, cache_write: 1, cache_read: 1 } },
    { ...goodMod, tokens: { in: 1, cache_write: 1, cache_read: 1, out: 1, extra: 1 } },
    { ...goodMod, tokens: { in: 1, cache_write: 1, cache_read: 1, out: -1 } },
    { ...goodMod, tokens: { in: 1, cache_write: 1, cache_read: 1, out: 1000000001 } },
    { ...goodMod, tokens: { in: '1', cache_write: 1, cache_read: 1, out: 1 } },
    { ...goodMod, prompt: 'hello' },
    { ...goodMod, model: 'Has Spaces' },
    { ...goodMod, ms: 86400001 },
    { ...goodNotification, src: 'mod' },
    { ...goodNotification, kind: 'reflect', id: '05', role: 'lead', agent: undefined }
  ];
  for (const rec of bad) assert.equal(validateRecord(rec).ok, false, JSON.stringify(rec));
  assert.equal(validateRecord(goodMod).ok, true);
  assert.equal(validateRecord({ ...goodMod, id: 'RT', model: 'claude-sonnet-5-5', ms: 900, reqs: 1 }).ok, true);
});

test('add-mod appends exactly one src mod record with role lead and the four counts', () => {
  const sb = sandbox();
  const r = run(sb, ['add-mod', 'demo', 'reflect', '05', '100', '10', '1000', '50', 'claude-sonnet-5-5', '800']);
  assert.equal(r.status, 0, r.all);
  assert.deepEqual(readLines(sb, 'demo'), [{
    v: 1, run: 'demo', kind: 'reflect', id: '05', role: 'lead', src: 'mod',
    tokens: { in: 100, cache_write: 10, cache_read: 1000, out: 50 }, ms: 800, model: 'claude-sonnet-5-5'
  }]);
  assert.equal(run(sb, ['add-mod', 'demo', 'reflect', 'RT', '1', '2', '3', '4']).status, 0);
  assert.equal(readLines(sb, 'demo').length, 2);
  assert.equal(Object.hasOwn(readLines(sb, 'demo')[1], 'model'), false);
});

test('add-mod refuses every other kind, bad ids and bad numbers with exit 2 and writes nothing', () => {
  const sb = sandbox();
  const cases = [
    ['add-mod', 'demo', 'keepwarm', 'W1', '1', '1', '1', '1'],
    ['add-mod', 'demo', 'keepwarm', '05', '1', '1', '1', '1'],
    ['add-mod', 'demo', 'agent', '05', '1', '1', '1', '1'],
    ['add-mod', 'demo', 'ctx_end', '05', '1', '1', '1', '1'],
    ['add-mod', 'demo', 'step', '05', '1', '1', '1', '1'],
    ['add-mod', 'demo', 'total', 'aaaaaaaa', '1', '1', '1', '1'],
    ['add-mod', 'demo', 'ship', '05', '1', '1', '1', '1'],
    ['add-mod', 'demo', 'reflect', '5', '1', '1', '1', '1'],
    ['add-mod', 'demo', 'reflect', 'R1', '1', '1', '1', '1'],
    ['add-mod', 'demo', 'reflect', '05', '-1', '1', '1', '1'],
    ['add-mod', 'demo', 'reflect', '05', '1.5', '1', '1', '1'],
    ['add-mod', 'demo', 'reflect', '05', 'x', '1', '1', '1'],
    ['add-mod', 'demo', 'reflect', '05', '1000000001', '1', '1', '1'],
    ['add-mod', 'demo', 'reflect', '05', '1', '1', '1', '1', 'Bad Model'],
    ['add-mod', 'demo', 'reflect', '05', '1', '1', '1', '1', 'ok-model', '86400001'],
    ['add-mod', 'demo', 'reflect', '05', '1', '1', '1', '1', 'ok-model', '1', 'extra'],
    ['add-mod', 'demo', 'reflect', '05', '1', '1', '1'],
    ['add-mod', '../x', 'reflect', '05', '1', '1', '1', '1'],
    ['add-mod', 'UPPER', 'reflect', '05', '1', '1', '1', '1'],
    ['add-mod']
  ];
  for (const args of cases) {
    const r = run(sb, args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.out, /^refused: /, args.join(' '));
  }
  assert.equal(fs.existsSync(ledgerFile(sb, 'demo')), false);
});

test('add refuses kind reflect: the Lead write path cannot write a mod record', () => {
  const sb = sandbox();
  assert.equal(run(sb, ['add', 'demo', 'reflect', '05', 'lead', 'a1', '10']).status, 2);
  assert.equal(fs.existsSync(ledgerFile(sb, 'demo')), false);
});

test('a hand-written mod line with an agent, a ctx_end or kind keepwarm is skipped on read', () => {
  const sb = sandbox();
  writeLedger(
    sb, 'demo',
    [{ ...goodMod, agent: 'a1' }, { ...goodMod, ctx_end: 5 }, { ...goodMod, kind: 'keepwarm', id: 'W1' }, goodMod]
      .map((x) => JSON.stringify(x)).join('\n') + '\n'
  );
  const r = run(sb, ['report', 'demo']);
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /warning: line 1 skipped/);
  assert.match(r.out, /warning: line 2 skipped/);
  assert.match(r.out, /warning: line 3 skipped/);
  assert.equal(/warning: line 4/.test(r.out), false);
  assert.match(r.out, /spend: 160 total/);
});

test('src mod counts in the text report totals, listed under its own kind', () => {
  const sb = sandbox();
  seed(sb);
  run(sb, ['reconcile', 'demo']);
  run(sb, ['add-mod', 'demo', 'reflect', '05', '100', '10', '1000', '50']);
  run(sb, ['ship', 'demo', '4']);
  const r = run(sb, ['report', 'demo']);
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /reflect 05 lead .*spend 160 .*cache read 1000/);
  assert.match(r.out, /spend: 412 total, 103 per AC/); // 252 + 160
  assert.match(r.out, /cache read: 3203 total/); // 2203 + 1000
  assert.match(r.out, /not reconciled: 1/);
});

// ---------- report --json ----------

const json = (sb, args, opts) => {
  const r = run(sb, ['report', 'demo', ...args], opts);
  assert.equal(r.status, 0, r.all);
  return { text: r.out, data: JSON.parse(r.out) };
};

function mixed(sb) {
  seed(sb);
  run(sb, ['reconcile', 'demo']);
  run(sb, ['add-mod', 'demo', 'reflect', '05', '100', '10', '1000', '50', 'claude-sonnet-5-5', '800']);
  run(sb, ['ship', 'demo', '4']);
}

test('report --json prints one JSON object with the contract shape', () => {
  const sb = sandbox();
  mixed(sb);
  const { text, data } = json(sb, ['--json']);
  assert.equal(text.trim().split('\n').length, 1);
  assert.deepEqual(Object.keys(data), ['v', 'run', 'rows', 'totals', 'per_ac', 'not_reconciled', 'warnings']);
  assert.equal(data.v, 1);
  assert.equal(data.run, 'demo');
  assert.deepEqual(data.rows.map((x) => [x.kind, x.id, x.state]), [
    ['step', '01', 'reconciled'], ['step', '02', 'reconciled'], ['step', '03', 'unreconciled'], ['reflect', '05', 'reconciled']
  ]);
  assert.deepEqual(data.rows[0], {
    kind: 'step', id: '01', role: 'architect', agent: 'aaa111', state: 'reconciled',
    tokens: { in: 15, cache_write: 120, cache_read: 2200, out: 110 }, spend: 245, ctx_end: 1255, ms: 1000, model: 'claude-sonnet-5-5'
  });
  assert.deepEqual(data.rows[2], {
    kind: 'step', id: '03', role: 'qa', agent: 'ccc333', state: 'unreconciled', tokens: null, spend: null, ctx_end: null, ms: null, model: null
  });
  assert.deepEqual(data.rows[3], {
    kind: 'reflect', id: '05', role: 'lead', agent: null, state: 'reconciled',
    tokens: { in: 100, cache_write: 10, cache_read: 1000, out: 50 }, spend: 160, ctx_end: null, ms: 800, model: 'claude-sonnet-5-5'
  });
  assert.deepEqual(data.totals, {
    spend: 412, cache_read: 3203, cache_write: 132, cache_write_share: Math.round((132 / 412) * 10000) / 10000,
    by_kind: { step: 252, reflect: 160 }
  });
  assert.deepEqual(data.per_ac, { spend: 103, cache_read: 801 });
  assert.equal(data.not_reconciled, 1);
  assert.deepEqual(data.warnings, []);
});

test('report --json numbers equal the text report numbers', () => {
  const sb = sandbox();
  mixed(sb);
  const text = run(sb, ['report', 'demo']).out;
  const { data } = json(sb, ['--json']);
  const num = (re) => Number(text.match(re)[1]);
  assert.equal(num(/^spend: (\d+) total/m), data.totals.spend);
  assert.equal(num(/^cache read: (\d+) total/m), data.totals.cache_read);
  assert.equal(num(/^spend: \d+ total, (\d+) per AC/m), data.per_ac.spend);
  assert.equal(num(/^cache read: \d+ total, (\d+) per AC/m), data.per_ac.cache_read);
  assert.equal(num(/^not reconciled: (\d+)/m), data.not_reconciled);
  for (const row of data.rows.filter((x) => x.spend !== null)) {
    const line = text.split('\n').find((l) => l.startsWith(`${row.kind} ${row.id} ${row.role} `));
    assert.ok(line, row.id);
    assert.equal(Number(line.match(/spend (\d+)/)[1]), row.spend);
    assert.equal(Number(line.match(/cache read (\d+)/)[1]), row.tokens.cache_read);
  }
  assert.equal(data.rows.reduce((s, x) => s + (x.spend ?? 0), 0), data.totals.spend);
  assert.equal(data.rows.reduce((s, x) => s + (x.tokens?.cache_write ?? 0), 0), data.totals.cache_write);
});

test('report --json with nothing reconciled and no shipped ACs gives nulls and zeros', () => {
  const sb = sandbox();
  seed(sb);
  const { data } = json(sb, ['--json']);
  assert.deepEqual(data.per_ac, { spend: null, cache_read: null });
  assert.deepEqual(data.totals, { spend: 0, cache_read: 0, cache_write: 0, cache_write_share: 0, by_kind: {} });
  assert.equal(data.not_reconciled, 3);
  assert.equal(data.rows.length, 3);
  assert.ok(data.rows.every((x) => x.state === 'unreconciled' && x.tokens === null && x.spend === null));
  assert.equal(data.rows[0].ctx_end, 1255);
  assert.equal(data.rows[2].ctx_end, null); // a 0 is unknown, never zero context
});

test('report --json with no ledger gives rows [] and the no ledger warning, exit 0', () => {
  const sb = sandbox();
  const { data } = json(sb, ['--json']);
  assert.deepEqual(data.rows, []);
  assert.deepEqual(data.warnings, ['no ledger']);
  assert.equal(data.not_reconciled, 0);
  assert.equal(data.totals.spend, 0);
});

test('report --json carries bad-line warnings and never prints skipped content', () => {
  const sb = sandbox();
  writeLedger(sb, 'demo', 'not json\n' + JSON.stringify({ ...goodNotification, run: 'demo', prompt: 'SECRET' }) + '\n' + JSON.stringify({ ...goodNotification, run: 'demo' }) + '\n');
  const r = run(sb, ['report', 'demo', '--json']);
  assert.equal(r.status, 0, r.all);
  const data = JSON.parse(r.out);
  assert.deepEqual(data.warnings, ['warning: line 1 skipped', 'warning: line 2 skipped']);
  assert.equal(r.all.includes('SECRET'), false);
  assert.equal(data.rows.length, 1);
});

test('report refuses a repeated flag, --json with --baseline, and --baseline without a list', () => {
  const sb = sandbox();
  seed(sb);
  for (const flags of [['--json', '--json'], ['--live', '--live'], ['--json', '--baseline', 'a'], ['--baseline'], ['--live', '--bogus']]) {
    assert.equal(run(sb, ['report', 'demo', ...flags]).status, 2, flags.join(' '));
  }
});

// ---------- report --live ----------

const listing = (dir) => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  return walk(dir).sort().map((f) => `${path.relative(dir, f)}:${fs.statSync(f).size}`);
};

test('report --live writes nothing and shows unreconciled agents as live', () => {
  const sb = sandbox();
  seed(sb);
  run(sb, ['add-mod', 'demo', 'reflect', '05', '100', '10', '1000', '50']);
  const before = { ledger: fs.readFileSync(ledgerFile(sb, 'demo'), 'utf8'), files: listing(sb.dir) };
  const { data } = json(sb, ['--json', '--live']);
  assert.deepEqual(data.rows.map((x) => [x.id, x.state]), [['01', 'live'], ['02', 'live'], ['03', 'unreconciled'], ['05', 'reconciled']]);
  assert.equal(data.rows[0].spend, 245);
  assert.equal(data.rows[2].tokens, null);
  assert.equal(data.not_reconciled, 1);
  assert.equal(data.totals.spend, 252 + 160);
  run(sb, ['report', 'demo', '--live']);
  assert.equal(fs.readFileSync(ledgerFile(sb, 'demo'), 'utf8'), before.ledger);
  assert.deepEqual(listing(sb.dir), before.files);
});

test('report --live equals reconcile then report, text and json', () => {
  const sb = sandbox();
  seed(sb);
  run(sb, ['ship', 'demo', '5']);
  run(sb, ['add-mod', 'demo', 'reflect', 'RT', '7', '8', '9', '10']);
  const liveText = run(sb, ['report', 'demo', '--live']).out;
  const liveJson = json(sb, ['--json', '--live']).data;
  assert.equal(run(sb, ['reconcile', 'demo']).status, 0);
  const afterText = run(sb, ['report', 'demo']).out;
  const afterJson = json(sb, ['--json']).data;
  assert.equal(liveText, afterText);
  const norm = (d) => ({ ...d, rows: d.rows.map((x) => ({ ...x, state: x.state === 'live' ? 'reconciled' : x.state })) });
  assert.deepEqual(norm(liveJson), afterJson);
  assert.match(liveText, /spend: 277 total, 55 per AC/);
});

test('report --live with an unreadable claude home leaves everything unreconciled, exit 0', () => {
  const sb = sandbox();
  seed(sb);
  const { data } = json(sb, ['--json', '--live'], { claude: path.join(sb.dir, 'none') });
  assert.equal(data.not_reconciled, 3);
  assert.ok(data.rows.every((x) => x.state === 'unreconciled'));
});

test('report --live after reconcile has no live rows and never reads a reconciled agent again', () => {
  const sb = sandbox();
  seed(sb);
  run(sb, ['reconcile', 'demo']);
  const { data } = json(sb, ['--json', '--live'], { claude: path.join(sb.dir, 'none') });
  assert.ok(data.rows.every((x) => x.state !== 'live'));
  assert.equal(data.totals.spend, 252);
});

test('report --live never echoes transcript text (Art. 5(1)(c))', () => {
  const sb = sandbox();
  seed(sb);
  const r = run(sb, ['report', 'demo', '--live', '--json']);
  for (const needle of ['SECRET', 'ignore previous', 'polluted']) assert.equal(r.all.includes(needle), false, needle);
});

test('report --live skips a transcript over the line limit with a size warning and writes nothing', () => {
  const sb = sandbox();
  const claude = path.join(sb.dir, 'claude');
  const dir = path.join(claude, 'projects', 'p', 's', 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  const fd = fs.openSync(path.join(dir, 'agent-aaa111.jsonl'), 'w');
  const chunk = Buffer.alloc(MiB, 97);
  for (let i = 0; i < 9; i += 1) fs.writeSync(fd, chunk);
  fs.writeSync(fd, '\n');
  fs.closeSync(fd);
  run(sb, ['add', 'demo', 'step', '01', 'architect', 'aaa111', '10']);
  const before = fs.readFileSync(ledgerFile(sb, 'demo'), 'utf8');
  const { data } = json(sb, ['--json', '--live'], { claude });
  assert.deepEqual(data.warnings, ['warning: aaa111 skipped (size)']);
  assert.equal(data.rows[0].state, 'unreconciled');
  assert.equal(data.not_reconciled, 1);
  assert.equal(fs.readFileSync(ledgerFile(sb, 'demo'), 'utf8'), before);
});

// ---------- end to end and LF ----------

test('whole flow: add, reconcile, ship, report', () => {
  const sb = sandbox();
  seed(sb, 'flow');
  assert.equal(run(sb, ['reconcile', 'flow']).status, 0);
  assert.equal(run(sb, ['ship', 'flow', '2', '0', '0']).status, 0);
  const r = run(sb, ['report', 'flow']);
  assert.equal(r.status, 0);
  assert.match(r.out, /spend: 252 total, 126 per AC/);
});

test('files written and the fixtures are LF only', () => {
  const sb = sandbox();
  seed(sb);
  run(sb, ['reconcile', 'demo']);
  assert.equal(fs.readFileSync(ledgerFile(sb, 'demo')).includes(13), false);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of [...walk(fixtures), script, import.meta.filename]) assert.equal(fs.readFileSync(f).includes(13), false, f);
});
