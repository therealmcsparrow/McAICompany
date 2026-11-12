import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Contract token-breakdown v1: scripts/token-breakdown.mjs over synthetic ledgers and transcripts.
// Fixture arithmetic (context = in + cache write + cache read; carried = added x later requests):
//   run R1 (newest): subagent spend 8090 = product-manager 4970 + architect 3120.
//     transcript of agentpm1 (6 requests): added file reads 1995, test output 20, command output 1500,
//     other tool results 100, reply 50, prompt 1010 (sum 4675); carried 7980, 60, 3000, 100, 0, 5050 (sum 16190).
//     the transcripts of agentar1 and agentpm3 are gone.
//   run R2 (older): subagent spend 7760 = qa 7760. transcript of agentqa2 (4 requests): carried
//     test output 11000, prompt 1515, file reads 0.
//   both runs: carried test output 11060, file reads 7980, prompt 6565, command output 3000 (sum 28705).
//   Lead window of R1 (10:00:00Z to 11:00:00Z): two requests, spend 333 + 444 = 777.

const script = path.join(import.meta.dirname, 'token-breakdown.mjs');
const ledgerScript = path.join(import.meta.dirname, 'ledger.mjs');
const FIX = path.join(import.meta.dirname, '..', 'tests', 'fixtures', 'token-breakdown');
const R1 = 'P20260302.000001/01-feature';
const R2 = 'P20260301.000001/01-feature';
const R1_DIR = path.join('.company', 'work', 'P20260302.000001', '01-feature');
const LEAD_UUID = '11111111-2222-4333-8444-555555555555';
const MARKERS = [
  'SECRET-PROMPT-MARKER', 'SECRET-REPLY-MARKER', 'SECRET-PATH-MARKER', 'SECRET-RESULT-MARKER', 'SECRET-TESTCMD-MARKER',
  'SECRET-JUNK-MARKER', 'SECRET-BADPATH-MARKER', 'SECRET-CMD-MARKER', 'SECRET-URL-MARKER', 'SECRET-LEADPATH-MARKER',
  'SECRET-LEADREPLY-MARKER', LEAD_UUID
];
const hash12 = (id) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 12);

// A fresh product folder and claude home copied from the fixtures; home variables point into the temp dir.
function sandbox(t, { ledgers, claudeHome = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-breakdown-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const proj = path.join(dir, 'proj');
  const home = path.join(dir, 'home');
  const claude = path.join(dir, 'claude');
  fs.mkdirSync(path.join(proj, '.company', 'ledger'), { recursive: true });
  fs.mkdirSync(home);
  for (const name of ledgers ?? fs.readdirSync(path.join(FIX, 'ledger'))) {
    fs.copyFileSync(path.join(FIX, 'ledger', name), path.join(proj, '.company', 'ledger', name));
  }
  if (claudeHome) fs.cpSync(path.join(FIX, 'claude-home'), claude, { recursive: true });
  else fs.mkdirSync(claude);
  const agentFile = (agent, sess) => path.join(claude, 'projects', 'proj-a', sess, 'subagents', `agent-${agent}.jsonl`);
  return { dir, proj, home, claude, agentFile };
}

function run(sb, args = [], extraEnv = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: sb.proj,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, CLAUDE_CONFIG_DIR: sb.claude,
      MCSPARROW_HOME: path.join(sb.dir, 'mcsparrow'), HOME: sb.home, USERPROFILE: sb.home, ...extraEnv
    }
  });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function reportJson(sb, runId) {
  const r = spawnSync(process.execPath, [ledgerScript, 'report', runId, '--json'], {
    cwd: sb.proj, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, CLAUDE_CONFIG_DIR: sb.claude, HOME: sb.home, USERPROFILE: sb.home }
  });
  return JSON.parse(r.stdout);
}

function withLead(sb, session = hash12(LEAD_UUID)) {
  const dir = path.join(sb.proj, R1_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'lead-context.json'), `${JSON.stringify({ v: 1, session, ctx: 1000, peak: 2000, at: '2026-03-02T10:50:00Z' })}\n`);
}

const lines = (text) => text.split('\n').map((l) => l.trimEnd()).filter((l) => l !== '');
const idAt = (text, id) => text.indexOf(id);

test('AC1: names the count of shipped runs and every run ID, newest first, skipping unshipped and brainstorm runs', (t) => {
  const r = run(sandbox(t));
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /runs: 2\b/);
  assert.ok(r.out.includes('P20260302.000001'), 'newest run listed');
  assert.ok(r.out.includes('P20260301.000001'), 'older run listed');
  assert.ok(idAt(r.out, 'P20260302.000001') < idAt(r.out, 'P20260301.000001'), 'newest first');
  assert.ok(!r.out.includes('P20260303.000001'), 'a run without a ship record is not a shipped run');
  assert.ok(!r.out.includes('brainstorm-demo'), 'brainstorm runs are excluded');
});

test('AC1: --runs 1 keeps only the newest shipped run', (t) => {
  const r = run(sandbox(t), ['--runs', '1']);
  assert.equal(r.status, 0, r.err);
  assert.ok(r.out.includes('P20260302.000001'));
  assert.ok(!r.out.includes('P20260301.000001'));
});

test('AC1: per Role spend and the subagent total equal what report prints, with no mismatch', (t) => {
  const sb = sandbox(t);
  const expected = new Map();
  for (const id of [R1, R2]) {
    const rep = reportJson(sb, id);
    const roles = new Map();
    for (const row of rep.rows) roles.set(row.role, (roles.get(row.role) ?? 0) + row.spend);
    assert.equal([...roles.values()].reduce((a, b) => a + b, 0), rep.totals.spend, 'fixture is consistent');
    expected.set(id, { roles, total: rep.totals.spend });
  }
  assert.equal(expected.get(R1).total, 8090);
  assert.equal(expected.get(R2).total, 7760);
  const r = run(sb);
  assert.equal(r.status, 0, r.err);
  for (const { roles, total } of expected.values()) {
    assert.match(r.out, new RegExp(`\\b${total}\\b`), `total ${total}`);
    for (const [role, spend] of roles) {
      assert.ok(r.out.includes(role), `role ${role}`);
      assert.match(r.out, new RegExp(`\\b${spend}\\b`), `${role} spend ${spend}`);
    }
  }
  assert.doesNotMatch(r.out, /mismatch/i);
});

test('AC1: the Lead row says not measurable from records with a reason when no session is known', (t) => {
  const r = run(sandbox(t));
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Lead[^\n]*not measurable from records: \S/i);
});

test('AC1: the Lead row counts only requests inside the ledger time window, each request once', (t) => {
  const sb = sandbox(t);
  withLead(sb);
  const r = run(sb, ['--runs', '1']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Lead[^\n]*\b777\b/i);
  for (const outside of ['12223', '24446', '37446', '1111', '22222']) {
    assert.doesNotMatch(r.out, new RegExp(`\\b${outside}\\b`), `outside-window spend ${outside} left out`);
  }
  assert.doesNotMatch(r.out, /\b1221\b|\b1665\b/, 'the duplicate request line is not counted twice');
});

test('AC1: a session that is not 12 hex digits, or has no transcript, gives Lead not measurable and no crash', (t) => {
  for (const session of ['../../evil', '..\\..\\evil', 'ABCDEF123456', '000000000000', 'a'.repeat(13)]) {
    const sb = sandbox(t);
    withLead(sb, session);
    const r = run(sb, ['--runs', '1']);
    assert.equal(r.status, 0, `${session}: ${r.err}`);
    assert.match(r.out, /Lead[^\n]*not measurable from records: \S/i, session);
    assert.doesNotMatch(r.all, /\b777\b/);
  }
});

test('AC1: a Lead session named by a handover event is found', (t) => {
  const sb = sandbox(t);
  const dir = path.join(sb.proj, R1_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const event = {
    v: 1, n: 1, at: '2026-03-02T10:55:00Z', ev: 'handover', file: 'lead-handoff-1.md', tokens: 1000, window: null,
    trigger: 'context', session: hash12(LEAD_UUID)
  };
  fs.writeFileSync(path.join(dir, 'lead-handover.jsonl'), `${JSON.stringify(event)}\n`);
  const r = run(sb, ['--runs', '1']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Lead[^\n]*\b777\b/i);
});

test('AC2: shares of added and carried tokens per category on a fixture with Read, test and other tool calls', (t) => {
  const r = run(sandbox(t), ['--runs', '1']);
  assert.equal(r.status, 0, r.err);
  for (const category of ['file reads', 'test output', 'command output', 'other tool results']) {
    assert.ok(r.out.includes(category), `category ${category}`);
  }
  assert.match(r.out, /\b(49\.3|49)%/, 'file reads carried 7980 of 16190');
  assert.match(r.out, /\b(42\.7|43)%/, 'file reads added 1995 of 4675');
  assert.match(r.out, /\b(32\.1|32)%/, 'command output added 1500 of 4675');
  assert.match(r.out, /\b(18\.5|19)%/, 'command output carried 3000 of 16190');
});

test('AC2: a malformed line and a mistyped usage line are skipped, not guessed', (t) => {
  const r = run(sandbox(t), ['--runs', '1']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Top sink: file reads (49\.3|49)% of carried tokens/, 'the 9999-valued line did not enter the shares');
  assert.doesNotMatch(r.all, /NaN|undefined|Infinity/);
});

test('AC2: a dispatch whose transcript is gone is named not measurable from records and left out of the shares', (t) => {
  const r = run(sandbox(t), ['--runs', '1']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /not measurable from records[^\n]*transcript/i);
  assert.match(r.out, /Top sink: file reads (49\.3|49)%/, 'shares cover only the transcript that exists');
});

test('AC2: with every transcript gone each category is not measurable from records and nothing is estimated', (t) => {
  const sb = sandbox(t, { claudeHome: false });
  const r = run(sb);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /not measurable from records/);
  assert.ok(r.out.includes('P20260302.000001') && r.out.includes('P20260301.000001'));
  assert.doesNotMatch(r.out, /\d+(\.\d+)?% of carried/);
  assert.doesNotMatch(r.all, /NaN|undefined|Infinity/);
});

test('AC2: a transcript line over 8 MiB makes that transcript not measurable (size) and the run goes on', (t) => {
  const sb = sandbox(t);
  fs.writeFileSync(sb.agentFile('agentpm1', 'sess-r1'), `${'a'.repeat(8 * 1024 * 1024 + 10)}\n`);
  const r = run(sb, ['--runs', '2']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /not measurable[^\n]*size/i);
  assert.match(r.out, /Top sink: test output /, 'the readable transcript still ranks');
});

test('AC2: a transcript file over 64 MiB is not measurable (size) and is not read', (t) => {
  const sb = sandbox(t);
  const file = sb.agentFile('agentpm1', 'sess-r1');
  fs.truncateSync(file, 64 * 1024 * 1024 + 1);
  const r = run(sb, ['--runs', '2']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /not measurable[^\n]*size/i);
});

test('AC2: a linked transcript file is not followed', (t) => {
  const sb = sandbox(t);
  const outside = path.join(sb.dir, 'outside.jsonl');
  const row = (n, usage, tool) => JSON.stringify({
    type: 'assistant', uuid: `o${n}`, requestId: `oreq${n}`,
    message: { id: `omsg${n}`, usage, content: tool ? [{ type: 'tool_use', id: 'x', name: 'Read', input: { file_path: '/x' } }] : [] }
  });
  fs.writeFileSync(outside, [
    row(1, { input_tokens: 1, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 1 }, true),
    row(2, { input_tokens: 1, cache_creation_input_tokens: 1000000, cache_read_input_tokens: 100, output_tokens: 1 }, true),
    row(3, { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1000100, output_tokens: 1 }, false)
  ].join('\n') + '\n');
  const file = sb.agentFile('agentpm1', 'sess-r1');
  fs.rmSync(file);
  try {
    fs.symlinkSync(outside, file);
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') return t.skip('symlinks are not permitted in this environment');
    throw error;
  }
  const r = run(sb, ['--runs', '2']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Top sink: test output /, 'the linked file did not add its file reads');
  assert.match(r.out, /not measurable from records/);
});

test('AC3: the output ends with the ranked top sink line and a yes recommendation when test output ranks first', (t) => {
  const r = run(sandbox(t), ['--runs', '2']);
  assert.equal(r.status, 0, r.err);
  const last = lines(r.out).slice(-2);
  const sink = last.find((l) => l.startsWith('Top sink:'));
  const hook = last.find((l) => l.startsWith('Test-output tail hook:'));
  assert.ok(sink && hook, `last two lines: ${JSON.stringify(last)}`);
  assert.match(sink, /^Top sink: test output (38\.5\d?|39)% of carried tokens \(2 runs\)$/);
  assert.match(hook, /^Test-output tail hook: yes\b/);
  assert.ok((hook.match(/\d+(\.\d+)?%/g) ?? []).length >= 2, 'the two deciding shares are shown');
});

test('AC3: the recommendation is no when test output is neither first nor second', (t) => {
  const r = run(sandbox(t), ['--runs', '1']);
  assert.equal(r.status, 0, r.err);
  const last = lines(r.out).slice(-2);
  const sink = last.find((l) => l.startsWith('Top sink:'));
  const hook = last.find((l) => l.startsWith('Test-output tail hook:'));
  assert.ok(sink && hook, `last two lines: ${JSON.stringify(last)}`);
  assert.match(sink, /^Top sink: file reads (49\.3|49)% of carried tokens \(1 runs?\)$/);
  assert.match(hook, /^Test-output tail hook: no\b/);
  assert.ok((hook.match(/\d+(\.\d+)?%/g) ?? []).length >= 2, 'the two deciding shares are shown');
});

test('privacy: no prompt, reply, tool result, command, path, URL or session ID reaches stdout or stderr', (t) => {
  for (const args of [[], ['--json'], ['--runs', '1']]) {
    const sb = sandbox(t);
    withLead(sb);
    const r = run(sb, args);
    assert.equal(r.status, 0, r.err);
    for (const marker of MARKERS) assert.ok(!r.all.includes(marker), `${marker} leaked with ${JSON.stringify(args)}`);
    assert.doesNotMatch(r.all, /node --test|npm test|git status/);
  }
});

test('read-only: nothing is written to the project, the claude home or the temp home', (t) => {
  const sb = sandbox(t);
  withLead(sb);
  const snapshot = () => {
    const out = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else out.push(`${p}:${fs.statSync(p).size}:${fs.statSync(p).mtimeMs}`);
      }
    };
    walk(sb.dir);
    return out.sort();
  };
  const before = snapshot();
  const r = run(sb);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(snapshot(), before);
  assert.ok(!fs.existsSync(path.join(sb.dir, 'mcsparrow')));
});

test('--json prints one JSON object on stdout', (t) => {
  const r = run(sandbox(t), ['--json']);
  assert.equal(r.status, 0, r.err);
  const parsed = JSON.parse(r.out);
  assert.ok(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed));
});

test('progress goes to stderr and stdout stays clean Markdown', (t) => {
  const r = run(sandbox(t));
  assert.equal(r.status, 0, r.err);
  assert.match(r.err, /\b1\/2\b/);
  assert.match(r.err, /\b2\/2\b/);
  assert.doesNotMatch(r.out, /(^|\s)[12]\/2(\s|$)/m, 'no progress line on stdout');
  assert.match(r.out, /^#{1,3} \S/m, 'real headings');
  assert.doesNotMatch(r.out, /\u001b\[/, 'no colour codes');
});

test('no ledger folder content prints runs: 0 and not measurable from records: no shipped runs', (t) => {
  const sb = sandbox(t, { ledgers: [] });
  const r = run(sb);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /runs: 0\b/);
  assert.match(r.out, /not measurable from records: no shipped runs/);
});

test('a missing .company/ledger folder gives the same no-shipped-runs answer', (t) => {
  const sb = sandbox(t);
  fs.rmSync(path.join(sb.proj, '.company'), { recursive: true });
  const r = run(sb);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /runs: 0\b/);
  assert.match(r.out, /not measurable from records: no shipped runs/);
});

test('bad flags are refused with usage and exit 2', (t) => {
  const sb = sandbox(t);
  for (const args of [['--bogus'], ['--runs'], ['--runs', '0'], ['--runs', '51'], ['--runs', 'x'], ['--runs', '1.5'], ['--runs', '-1'], ['extra']]) {
    const r = run(sb, args);
    assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.all}`);
    assert.match(r.all, /refused: usage/, JSON.stringify(args));
  }
});

test('--runs accepts the bounds 1 and 50', (t) => {
  const sb = sandbox(t);
  for (const n of ['1', '50']) assert.equal(run(sb, ['--runs', n]).status, 0, n);
});

// ---- fix round 1: R-6, hostile run files, duplicate transcripts (commit 0805a30) ----

const R1_LEDGER = 'P20260302.000001~01-feature.jsonl';
const LEAD_FILE = `${LEAD_UUID}.jsonl`;
const NO_SESSION = /Lead[^\n]*not measurable from records: no Lead session recorded/i;

function skipIfNoLink(t, error) {
  if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) {
    t.skip(`cannot create this link here (${error.code})`);
    return true;
  }
  throw error;
}

test('AC3 R-6: the hook is not yes when only file reads is non-zero, even if test output ties at zero', (t) => {
  const sb = sandbox(t, { ledgers: [R1_LEDGER] });
  const row = (n, ctx, tool) => JSON.stringify({
    type: 'assistant', uuid: `f${n}`, requestId: `freq${n}`,
    message: { id: `fmsg${n}`, usage: { input_tokens: 0, cache_creation_input_tokens: ctx, cache_read_input_tokens: 0, output_tokens: 0 },
      content: tool ? [{ type: 'tool_use', id: 'x', name: 'Read', input: { file_path: '/x' } }] : [] }
  });
  // carried: file reads 100 (added 100 after a Read request, one later request), every other category 0.
  fs.writeFileSync(sb.agentFile('agentpm1', 'sess-r1'), [row(1, 0, true), row(2, 100, true), row(3, 100, false)].join('\n') + '\n');
  const r = run(sb, ['--runs', '1']);
  assert.equal(r.status, 0, r.err);
  const last = lines(r.out).slice(-2);
  const sink = last.find((l) => l.startsWith('Top sink:'));
  const hook = last.find((l) => l.startsWith('Test-output tail hook:'));
  assert.ok(sink && hook, `last two lines: ${JSON.stringify(last)}`);
  assert.match(sink, /^Top sink: file reads 100(\.0)?% /);
  assert.doesNotMatch(hook, /^Test-output tail hook: yes\b/);
  assert.match(hook, /^Test-output tail hook: no\b/);
});

test('proj.M4: a hard-linked lead-context.json is read as no session', (t) => {
  const sb = sandbox(t);
  const dir = path.join(sb.proj, R1_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const outside = path.join(sb.dir, 'outside-context.json');
  fs.writeFileSync(outside, `${JSON.stringify({ v: 1, session: hash12(LEAD_UUID), ctx: 1, peak: 2, at: '2026-03-02T10:50:00Z' })}\n`);
  try {
    fs.linkSync(outside, path.join(dir, 'lead-context.json'));
  } catch (error) {
    if (skipIfNoLink(t, error)) return;
  }
  const r = run(sb, ['--runs', '1']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, NO_SESSION);
  assert.doesNotMatch(r.out, /\b777\b/);
});

test('proj.M4: a symlinked lead-context.json is read as no session', (t) => {
  const sb = sandbox(t);
  const dir = path.join(sb.proj, R1_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const outside = path.join(sb.dir, 'outside-context.json');
  fs.writeFileSync(outside, `${JSON.stringify({ v: 1, session: hash12(LEAD_UUID), ctx: 1, peak: 2, at: '2026-03-02T10:50:00Z' })}\n`);
  try {
    fs.symlinkSync(outside, path.join(dir, 'lead-context.json'));
  } catch (error) {
    if (skipIfNoLink(t, error)) return;
  }
  const r = run(sb, ['--runs', '1']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, NO_SESSION);
  assert.doesNotMatch(r.out, /\b777\b/);
});

test('proj.M4: a junctioned run folder is read as no session', (t) => {
  const sb = sandbox(t);
  const target = path.join(sb.dir, 'elsewhere', '01-feature');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'lead-context.json'), `${JSON.stringify({ v: 1, session: hash12(LEAD_UUID), ctx: 1, peak: 2, at: '2026-03-02T10:50:00Z' })}\n`);
  const link = path.join(sb.proj, R1_DIR);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  try {
    fs.symlinkSync(target, link, 'junction');
  } catch (error) {
    if (skipIfNoLink(t, error)) return;
  }
  const r = run(sb, ['--runs', '1']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, NO_SESSION);
  assert.doesNotMatch(r.out, /\b777\b/);
});

test('cct.M2: the same Lead session file under two projects makes the Lead not measurable and sums nothing', (t) => {
  const sb = sandbox(t);
  withLead(sb);
  const other = path.join(sb.claude, 'projects', 'proj-b');
  fs.mkdirSync(other, { recursive: true });
  fs.copyFileSync(path.join(sb.claude, 'projects', 'proj-a', LEAD_FILE), path.join(other, LEAD_FILE));
  const r = run(sb, ['--runs', '1']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Lead[^\n]*not measurable from records: [^\n]*more than one Lead transcript/i);
  assert.doesNotMatch(r.out, /\b777\b/);
  assert.doesNotMatch(r.out, /\b1554\b/, 'the two copies are not summed');
});

test('cct.M2: the same agent transcript under two projects and sessions gives the gap more than one transcript found', (t) => {
  const sb = sandbox(t);
  const dir = path.join(sb.claude, 'projects', 'proj-b', 'sess-copy', 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(sb.agentFile('agentpm1', 'sess-r1'), path.join(dir, 'agent-agentpm1.jsonl'));
  const r = run(sb, ['--runs', '1']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /more than one transcript found/);
  assert.doesNotMatch(r.out, /Top sink: file reads (49\.3|49)%/, 'the ambiguous transcript is not measured');
});
