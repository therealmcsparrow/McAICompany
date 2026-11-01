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
    env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: sb.claude, HOME: sb.home, USERPROFILE: sb.home }
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

// ---------- add: hostile and boundary cases first ----------

test('add above the hard limit is still refused with exit 2 and writes nothing', (t) => {
  const sb = sandbox(t);
  const r = run(sb, ['add', RUN, 'step', '01', 'architect', 'a1', '10000001']);
  assert.equal(r.code, 2);
  assert.match(r.out, /^refused:/);
  assert.equal(fs.existsSync(path.join(sb.dir, '.company', 'ledger')), false);
});

test('add at 95000 and below is unchanged: exit 0, no over cap line', (t) => {
  const sb = sandbox(t);
  for (const n of ['0', '85500', '95000']) {
    const r = run(sb, ['add', RUN, 'step', '01', 'architect', 'a1', n]);
    assert.equal(r.code, 0, n);
    assert.equal(r.out, '', n);
  }
  assert.equal(ledgerLines(sb).length, 3);
});

test('add above 95000 writes the row, prints the over cap line and exits 4', (t) => {
  const sb = sandbox(t);
  const r = run(sb, ['add', RUN, 'step', '07', 'backend-engineer', 'a7', '96000']);
  assert.equal(r.code, 4);
  assert.equal(r.out, 'over cap: step 07 backend-engineer ctx_end 96000 > 95000');
  const rows = ledgerLines(sb);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ctx_end, 96000);
  assert.equal(run(sb, ['add', RUN, 'step', '08', 'qa', 'a8', '10000000']).code, 4);
});

test('add above the cap with a bad other field is a refusal, not exit 4', (t) => {
  const sb = sandbox(t);
  const r = run(sb, ['add', RUN, 'bogus', '07', 'qa', 'a7', '96000']);
  assert.equal(r.code, 2);
  assert.equal(fs.existsSync(path.join(sb.dir, '.company', 'ledger')), false);
});

// ---------- report ----------

test('report text ends with an over cap line and report --json keeps its keys', (t) => {
  const sb = sandbox(t);
  assert.equal(run(sb, ['add', RUN, 'step', '01', 'architect', 'a1', '1000']).code, 0);
  const none = run(sb, ['report', RUN]);
  assert.equal(none.code, 0);
  assert.ok(!/over cap/.test(none.out), none.out);
  const before = run(sb, ['report', RUN, '--json']).out;
  assert.equal(run(sb, ['add', RUN, 'step', '02', 'qa', 'a2', '96000']).code, 4);
  assert.equal(run(sb, ['add', RUN, 'step', '03', 'qa', 'a3', '99000']).code, 4);
  const text = run(sb, ['report', RUN]).out.split('\n');
  assert.ok(text.includes('over cap: 2 steps (max 99000)'), text.join('|'));
  const json = JSON.parse(run(sb, ['report', RUN, '--json']).out);
  assert.deepEqual(Object.keys(json), ['v', 'run', 'rows', 'totals', 'per_ac', 'not_reconciled', 'warnings']);
  assert.equal(JSON.parse(before).rows.length, 1);
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
