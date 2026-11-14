import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.join(import.meta.dirname, 'ledger.mjs');
const RUN = 'cap-demo';

// Every test gets its own product root and Claude home; HOME and USERPROFILE never point at the real one.
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-cap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  const claude = path.join(home, '.claude');
  fs.mkdirSync(claude, { recursive: true });
  return { dir, home, claude };
}

function run(sb, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: sb.dir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: sb.claude, MCSPARROW_HOME: path.join(sb.home, '.mcsparrow'), HOME: sb.home, USERPROFILE: sb.home }
  });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr };
}

const ledgerLines = (sb) =>
  fs.readFileSync(path.join(sb.dir, '.company', 'ledger', `${RUN}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const assistant = (req, usage) => JSON.stringify({ type: 'assistant', requestId: req, message: { id: `m-${req}`, model: 'claude-x', usage } }) + '\n';

function transcriptDir(sb, session = 'sess1', proj = '-proj') {
  const dir = path.join(sb.claude, 'projects', proj, session, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const ctx = (sb, ...ids) => JSON.parse(run(sb, ['agent-ctx', ...ids, '--json']).out);

// A run-state file: one start per cap given (undefined = a start without a cap), an end between segments.
// A raw value is written as given, for the hostile cases.
function runState(sb, ...caps) {
  const dir = path.join(sb.dir, '.company', 'work', RUN);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  caps.forEach((cap, i) => {
    if (i > 0) lines.push(JSON.stringify({ v: 1, at: `2026-11-14T10:0${i}:00Z`, ev: 'end', outcome: 'abort' }));
    lines.push(JSON.stringify({ v: 1, at: `2026-11-14T10:0${i}:30Z`, ev: 'start', ...(cap === undefined ? {} : { cap }) }));
  });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${lines.join('\n')}\n`);
}

const settingsFile = (sb, cap) => {
  fs.mkdirSync(path.join(sb.dir, '.company'), { recursive: true });
  fs.writeFileSync(path.join(sb.dir, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, pipeline: { context_cap: cap } } }));
};

const add = (sb, n, step = '07', role = 'backend-engineer') => run(sb, ['add', RUN, 'step', step, role, `a${step}`, String(n)]);
const overLine = (n, cap, step = '07', role = 'backend-engineer') => `over cap: step ${step} ${role} ctx_end ${n} > ${cap}`;

// ---------- add: hostile and boundary cases first ----------

test('add above the hard limit is still refused with exit 2 and writes nothing', (t) => {
  const sb = sandbox(t);
  runState(sb, 120000);
  const r = run(sb, ['add', RUN, 'step', '01', 'architect', 'a1', '10000001']);
  assert.equal(r.code, 2);
  assert.match(r.out, /^refused:/);
  assert.equal(fs.existsSync(path.join(sb.dir, '.company', 'ledger')), false);
});

test('hostile recorded caps (string, null, negative, below 60000, above 1000000, fraction, object) fall back to 180000 and echo nothing of the value', (t) => {
  for (const bad of ['120000', null, -1, 0, 59999, 1000001, 120000.5, '; rm -rf', { a: 1 }, [120000]]) {
    const sb = sandbox(t);
    runState(sb, bad);
    const ok = add(sb, 130000);
    assert.equal(ok.code, 0, JSON.stringify(bad));
    assert.equal(ok.out, '', JSON.stringify(bad));
    const r = add(sb, 180001, '08');
    assert.equal(r.code, 4, JSON.stringify(bad));
    assert.equal(r.out, overLine(180001, 180000, '08'), JSON.stringify(bad));
  }
});

test('AC11: run cap 120000: 130000 writes the row, prints the over cap line with that cap and exits 4', (t) => {
  const sb = sandbox(t);
  runState(sb, 120000);
  const r = add(sb, 130000);
  assert.equal(r.code, 4);
  assert.equal(r.out, overLine(130000, 120000));
  const rows = ledgerLines(sb);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ctx_end, 130000);
});

test('AC11: run cap 120000: 120000 and below exit 0 with no output, 120001 exits 4', (t) => {
  const sb = sandbox(t);
  runState(sb, 120000);
  for (const n of [0, 85500, 95000, 108000, 120000]) {
    const r = add(sb, n);
    assert.equal(r.code, 0, String(n));
    assert.equal(r.out, '', String(n));
  }
  const over = add(sb, 120001);
  assert.equal(over.code, 4);
  assert.equal(over.out, overLine(120001, 120000));
  assert.equal(ledgerLines(sb).length, 6);
});

test('AC11: a larger run cap lifts the line: 200000 recorded, 190000 passes, 200001 exits 4', (t) => {
  const sb = sandbox(t);
  runState(sb, 200000);
  assert.equal(add(sb, 190000).code, 0);
  const r = add(sb, 200001, '08', 'qa');
  assert.equal(r.code, 4);
  assert.equal(r.out, overLine(200001, 200000, '08', 'qa'));
});

test('AC8: the first recorded cap holds when a resumed segment records another', (t) => {
  const sb = sandbox(t);
  runState(sb, 120000, 150000);
  assert.equal(add(sb, 130000).code, 4);
  assert.equal(add(sb, 130000, '08').out, overLine(130000, 120000, '08'));
});

test('AC9: no run state and no stored setting: the cap is 180000, never 95000', (t) => {
  const sb = sandbox(t);
  for (const n of [95001, 150000, 180000]) {
    const r = add(sb, n);
    assert.equal(r.code, 0, String(n));
    assert.equal(r.out, '', String(n));
  }
  const r = add(sb, 180001);
  assert.equal(r.code, 4);
  assert.equal(r.out, overLine(180001, 180000));
});

test('a run-state start without a cap falls back to 180000', (t) => {
  const sb = sandbox(t);
  runState(sb, undefined);
  assert.equal(add(sb, 150000).code, 0);
  assert.equal(add(sb, 180001).out, overLine(180001, 180000));
});

test('no run state: the current pipeline.context_cap setting applies', (t) => {
  const sb = sandbox(t);
  settingsFile(sb, 150000);
  assert.equal(add(sb, 150000).code, 0);
  assert.equal(add(sb, 150001).out, overLine(150001, 150000));
});

test('a recorded cap beats the current setting', (t) => {
  const sb = sandbox(t);
  settingsFile(sb, 150000);
  runState(sb, 120000);
  assert.equal(add(sb, 130000).out, overLine(130000, 120000));
});

test('add above the cap with a bad other field is a refusal, not exit 4', (t) => {
  const sb = sandbox(t);
  runState(sb, 120000);
  const r = run(sb, ['add', RUN, 'bogus', '07', 'qa', 'a7', '130000']);
  assert.equal(r.code, 2);
  assert.equal(fs.existsSync(path.join(sb.dir, '.company', 'ledger')), false);
});

// ---------- report ----------

test('report text ends with an over cap line for the run cap and report --json adds cap', (t) => {
  const sb = sandbox(t);
  runState(sb, 120000);
  assert.equal(add(sb, 1000, '01', 'architect').code, 0);
  const none = run(sb, ['report', RUN]);
  assert.equal(none.code, 0);
  assert.ok(!/over cap/.test(none.out), none.out);
  assert.equal(add(sb, 119000, '02', 'qa').code, 0);
  assert.equal(add(sb, 121000, '03', 'qa').code, 4);
  assert.equal(add(sb, 130000, '04', 'qa').code, 4);
  const text = run(sb, ['report', RUN]).out.split('\n');
  assert.ok(text.includes('over cap: 2 steps (max 130000)'), text.join('|'));
  const json = JSON.parse(run(sb, ['report', RUN, '--json']).out);
  assert.deepEqual(Object.keys(json).sort(), ['cap', 'not_reconciled', 'per_ac', 'rows', 'run', 'totals', 'v', 'warnings']);
  assert.equal(json.cap, 120000);
});

test('report --json cap is 180000 with no recorded cap, and 95001 is not over cap in the text', (t) => {
  const sb = sandbox(t);
  assert.equal(add(sb, 95001, '01', 'qa').code, 0);
  assert.equal(JSON.parse(run(sb, ['report', RUN, '--json']).out).cap, 180000);
  assert.ok(!/over cap/.test(run(sb, ['report', RUN]).out));
});

// ---------- agent-ctx ----------

test('agent-ctx refuses hostile ids and a bad count before any file lookup', (t) => {
  const sb = sandbox(t);
  const bad = [['..'], ['../x'], ['-x'], ['a/b'], ['a\\b'], ['a b'], [''], ['x'.repeat(65)], ['a.b'], []];
  for (const ids of bad) {
    const r = run(sb, ['agent-ctx', ...ids, '--json']);
    assert.equal(r.code, 2, JSON.stringify(ids));
    assert.match(r.out, /^refused:/);
  }
  const nine = Array.from({ length: 9 }, (_, i) => `a${i}`);
  assert.equal(run(sb, ['agent-ctx', ...nine, '--json']).code, 2);
  assert.equal(run(sb, ['agent-ctx', 'a1', '--json', '--json']).code, 2);
});

test('agent-ctx gives the last request usage sum, order kept, null for a missing file', (t) => {
  const sb = sandbox(t);
  const dir = transcriptDir(sb);
  fs.writeFileSync(path.join(dir, 'agent-a1.jsonl'),
    assistant('r1', { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 }) +
    'not json\n' +
    assistant('r2', { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 3000, output_tokens: 40 }));
  const r = run(sb, ['agent-ctx', 'a1', 'zz9', 'a1', '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out), { v: 1, agents: [{ agent: 'a1', ctx: 3250 }, { agent: 'zz9', ctx: null }, { agent: 'a1', ctx: 3250 }] });
});

test('agent-ctx finds the transcript under any project and session folder', (t) => {
  const sb = sandbox(t);
  const dir = transcriptDir(sb, 'sess-other', '-Z--other-cwd');
  fs.writeFileSync(path.join(dir, 'agent-a12f28d5ca81d685f.jsonl'),
    assistant('r1', { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 }));
  assert.equal(ctx(sb, 'a12f28d5ca81d685f').agents[0].ctx, 10);
});

test('agent-ctx gives null for a transcript that is a link', (t) => {
  const sb = sandbox(t);
  const dir = transcriptDir(sb);
  const outside = path.join(sb.dir, 'outside.jsonl');
  fs.writeFileSync(outside, assistant('r1', { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 }));
  try {
    fs.symlinkSync(outside, path.join(dir, 'agent-lnk.jsonl'));
  } catch {
    t.skip('symlinks not permitted here');
    return;
  }
  const r = run(sb, ['agent-ctx', 'lnk', '--json']);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).agents[0].ctx, null);
});

test('agent-ctx gives null for a directory named like a transcript', (t) => {
  const sb = sandbox(t);
  fs.mkdirSync(path.join(transcriptDir(sb), 'agent-dir1.jsonl'));
  assert.equal(ctx(sb, 'dir1').agents[0].ctx, null);
});

test('agent-ctx gives null for a file over 64 MiB and for a line over 8 MiB', (t) => {
  const sb = sandbox(t);
  const dir = transcriptDir(sb);
  const big = path.join(dir, 'agent-big.jsonl');
  fs.closeSync(fs.openSync(big, 'w'));
  fs.truncateSync(big, 64 * 1024 * 1024 + 1);
  fs.writeFileSync(path.join(dir, 'agent-long.jsonl'), `${'x'.repeat(8 * 1024 * 1024 + 10)}\n` +
    assistant('r1', { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 }));
  const r = run(sb, ['agent-ctx', 'big', 'long', '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out).agents.map((a) => a.ctx), [null, null]);
});

test('agent-ctx ignores non-integer and hostile usage values and never writes', (t) => {
  const sb = sandbox(t);
  const dir = transcriptDir(sb);
  fs.writeFileSync(path.join(dir, 'agent-h1.jsonl'),
    assistant('r1', { input_tokens: '5', cache_creation_input_tokens: -1, cache_read_input_tokens: 1.5, output_tokens: null }) +
    '{"type":"assistant","requestId":"r2","message":{"usage":{"__proto__":{"input_tokens":9},"input_tokens":3}}}\n');
  const before = fs.readdirSync(sb.dir).sort();
  assert.equal(ctx(sb, 'h1').agents[0].ctx, 3);
  assert.deepEqual(fs.readdirSync(sb.dir).sort(), before);
  assert.equal(fs.existsSync(path.join(sb.dir, '.company')), false);
});

test('agent-ctx with no claude home folder gives null and exit 0', (t) => {
  const sb = sandbox(t);
  const r = run(sb, ['agent-ctx', 'a1', '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out), { v: 1, agents: [{ agent: 'a1', ctx: null }] });
});
