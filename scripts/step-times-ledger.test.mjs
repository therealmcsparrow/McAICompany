// Tests for step-times v1.4 (C10, T30, spike T42 = yes): SubagentStop also writes the ledger row.
// A Role Step: the dispatch (first user row of the Step transcript) names `Output: .../07-qa.md` -> row step 07, role qa.
// The Lead (`aico:project-manager`): one `lead` row. Any failure: nothing printed, no row, exit 0.
// The payload shape is scripts/fixtures/step-times/subagent-stop-payload.json (T42). Red until T30 lands.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { handle } from './step-times.mjs';

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const HERE = import.meta.dirname;
// The T42 fixture holds raw Windows backslashes, so it is not valid JSON as committed; double them before parsing.
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'step-times', 'subagent-stop-payload.json'), 'utf8').replace(/\\/g, '\\\\'));
const SLUG = 'P20261120.000001/01-lead';
const SESSION = '3f2a9c1e-7b4d-4e0a-9c55-0a1b2c3d4e5f';

const STUB = `import fs from 'node:fs';
import path from 'node:path';
const here = import.meta.dirname;
const a = process.argv.slice(2);
if (a[0] === 'active') process.stdout.write(JSON.stringify({ slug: ${JSON.stringify(SLUG)} }));
else fs.appendFileSync(path.join(here, 'calls.jsonl'), JSON.stringify(a) + '\\n');
`;

const usage = (n) => ({ input_tokens: n, cache_creation_input_tokens: 1000, cache_read_input_tokens: 20000, output_tokens: 50 });
const userRow = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const asstRow = (n, tools = 0) => ({
  type: 'assistant',
  message: { role: 'assistant', usage: usage(n), content: Array.from({ length: tools }, (_, i) => ({ type: 'tool_use', id: `t${i}`, name: 'Read', input: {} })) }
});

function sandbox(rowsOfTranscript) {
  const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'st-ledger-'));
  roots.push(d);
  fs.writeFileSync(path.join(d, 'run-state.mjs'), STUB);
  fs.mkdirSync(path.join(d, '.company'), { recursive: true });
  const transcript = path.join(d, 'agent-a99810bc7fa401597.jsonl');
  if (rowsOfTranscript) fs.writeFileSync(transcript, rowsOfTranscript.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { d, transcript };
}
const payload = (sb, over = {}) => JSON.stringify({
  ...FIXTURE, _note: undefined, _timed_read: undefined,
  session_id: SESSION, cwd: sb.d, agent_transcript_path: sb.transcript, transcript_path: path.join(sb.d, 'parent.jsonl'),
  hook_event_name: 'SubagentStop', ...over
});
const stop = (sb, text) => handle(text, 'stop', { runStatePath: path.join(sb.d, 'run-state.mjs'), cwd: sb.d });
function ledgerRows(sb) {
  const dir = path.join(sb.d, '.company', 'ledger');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
}
const dispatch = 'Goal: do it.\nOutput: .company/work/P20261120.000001/01-lead/07-qa.md\nRisk tier: high';

test('a Role Step whose dispatch names Output 07-qa.md writes one ledger row: step 07, role qa, source hook', async () => {
  const sb = sandbox([userRow(dispatch), asstRow(100, 2), asstRow(5000, 3)]);
  await stop(sb, payload(sb));
  const rows = ledgerRows(sb).filter((r) => r.kind === 'step');
  assert.equal(rows.length, 1, JSON.stringify(ledgerRows(sb)));
  assert.equal(rows[0].id, '07');
  assert.equal(rows[0].role, 'qa');
  assert.equal(rows[0].src, 'hook');
  assert.equal(rows[0].agent, 'a99810bc7fa401597');
  assert.equal(rows[0].tool_uses, 5);
  assert.equal(rows[0].ctx_end, 5000 + 1000 + 20000 + 50);
});

test('the sub event for the Step is still written', async () => {
  const sb = sandbox([userRow(dispatch), asstRow(100)]);
  await stop(sb, payload(sb));
  const calls = fs.existsSync(path.join(sb.d, 'calls.jsonl')) ? fs.readFileSync(path.join(sb.d, 'calls.jsonl'), 'utf8') : '';
  assert.match(calls, /"sub"/);
});

test('the same SubagentStop twice leaves one row', async () => {
  const sb = sandbox([userRow(dispatch), asstRow(100)]);
  await stop(sb, payload(sb));
  await stop(sb, payload(sb));
  assert.equal(ledgerRows(sb).filter((r) => r.kind === 'step').length, 1);
});

test('the Lead (agent_type aico:project-manager) writes one lead row and no step row', async () => {
  const sb = sandbox([userRow('Run the playbook.'), asstRow(100), asstRow(90000, 4)]);
  await stop(sb, payload(sb, { agent_type: 'aico:project-manager', agent_id: 'lead-agent-1' }));
  const rows = ledgerRows(sb);
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.equal(rows[0].kind, 'lead');
  assert.equal(rows[0].role, 'lead');
  assert.equal(rows[0].src, 'hook');
  assert.equal(rows[0].agent, 'lead-agent-1');
});

test('the Lead stopping twice with the same agent id leaves one row', async () => {
  const sb = sandbox([userRow('Run.'), asstRow(100)]);
  const p = payload(sb, { agent_type: 'aico:project-manager', agent_id: 'lead-agent-1' });
  await stop(sb, p);
  await stop(sb, p);
  assert.equal(ledgerRows(sb).filter((r) => r.kind === 'lead').length, 1);
});

test('failures write no row and never throw: missing transcript, no Output line, empty file, bad JSON', async () => {
  const cases = [sandbox(null), sandbox([userRow('no output line here'), asstRow(10)]), sandbox([])];
  for (const sb of cases) await assert.doesNotReject(stop(sb, payload(sb)));
  for (const sb of cases) assert.deepEqual(ledgerRows(sb).filter((r) => r.kind === 'step'), []);
  const sb = sandbox([userRow(dispatch)]);
  fs.writeFileSync(sb.transcript, 'not json\n{"half":');
  await assert.doesNotReject(stop(sb, payload(sb)));
  await assert.doesNotReject(stop(sb, '{not json'));
  assert.deepEqual(ledgerRows(sb), []);
});

test('an Output path with a traversal or a non-Step name writes no row', async () => {
  for (const out of ['../../../etc/07-qa.md', '.company/work/x/qa.md', '.company/work/x/7-qa.md']) {
    const sb = sandbox([userRow(`Output: ${out}`), asstRow(10)]);
    await stop(sb, payload(sb));
    assert.deepEqual(ledgerRows(sb).filter((r) => r.kind === 'step'), [], out);
  }
});

test('the SubagentStart phase writes no ledger row', async () => {
  const sb = sandbox([userRow(dispatch), asstRow(100)]);
  await handle(payload(sb, { hook_event_name: 'SubagentStart' }), 'start', { runStatePath: path.join(sb.d, 'run-state.mjs'), cwd: sb.d });
  assert.deepEqual(ledgerRows(sb), []);
});

test('the hook script exits 0 with no output on a SubagentStop payload with no active run', () => {
  const sb = sandbox([userRow(dispatch), asstRow(100)]);
  const r = spawnSync(process.execPath, [path.join(HERE, 'step-times.mjs'), 'stop'], { input: payload(sb), cwd: sb.d, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});
