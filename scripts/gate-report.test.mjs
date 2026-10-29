import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gateReport, runsOf } from './gate-report.mjs';
import { run as runState } from './run-state.mjs';

const script = path.join(import.meta.dirname, 'gate-report.mjs');
const T0 = Date.parse('2026-10-20T10:00:00Z');

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-report-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function ledger(root, run, records) {
  const dir = path.join(root, '.company', 'ledger');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${run}.jsonl`), records.map((r) => JSON.stringify({ v: 1, run, ...r })).join('\n') + '\n');
}

const state = (root, secs, ...argv) => {
  const r = runState(argv, { root, now: T0 + secs * 1000 });
  assert.equal(r.code, 0, r.out);
};

// A run with a plan Gate asked at +10 s and passed at +70 s, one CEO form, a Step by two Roles.
function fullRun(root, run, aico) {
  state(root, 0, 'start', run, aico);
  state(root, 10, 'ask', run, 'plan');
  state(root, 20, 'ceo', run, 'plan', '2');
  state(root, 70, 'gate', run, 'plan', 'passed');
  state(root, 80, 'sub', run, 'start', 'architect', 'aaaaaaaaaaaa');
  state(root, 140, 'sub', run, 'stop', 'architect', 'aaaaaaaaaaaa');
  ledger(root, run, [
    { kind: 'meta', aico },
    { kind: 'ship', acs: 3, fix_rounds: 1, t_start: '2026-10-20T10:00:00Z', t_ship: '2026-10-20T10:30:00Z', wait: 60 }
  ]);
}

test('the report holds the Gates, forms, Fix rounds and times of a run of that version', (t) => {
  const root = tmp(t);
  fullRun(root, 'alpha', '0.20.0');
  const text = gateReport({ root, version: '0.20.0' });
  assert.match(text, /^# Gate Report v0\.20\.0\n/);
  assert.match(text, /### alpha/);
  assert.match(text, /- plan: passed, wait 1 min 0 s/);
  assert.match(text, /CEO forms: plan 2/);
  assert.match(text, /Fix rounds: 1/);
  assert.match(text, /Run time: 30 min 0 s/);
  assert.match(text, /Step time by Role: architect 1 min 0 s/);
  assert.ok(!text.includes(': not recorded'), text);
  assert.ok(!text.includes('\r'));
});

test('only runs of that version are listed', (t) => {
  const root = tmp(t);
  fullRun(root, 'alpha', '0.20.0');
  fullRun(root, 'beta', '0.19.1');
  ledger(root, 'brainstorm-20261020-1000', [{ kind: 'meta', aico: '0.20.0' }]);
  ledger(root, 'nometa', [{ kind: 'ship', acs: 1 }]);
  assert.deepEqual(runsOf(root, '0.20.0').map((r) => r.run), ['alpha']);
  const text = gateReport({ root, version: '0.20.0' });
  assert.ok(!text.includes('beta') && !text.includes('nometa') && !text.includes('brainstorm'));
  assert.match(text, /Runs: 1/);
});

test('missing data reads not recorded, never a guess', (t) => {
  const root = tmp(t);
  ledger(root, 'gamma', [{ kind: 'meta', aico: '0.20.0' }]);
  const text = gateReport({ root, version: '0.20.0' });
  for (const label of ['Gates', 'CEO forms', 'Fix rounds', 'Run time', 'Step time by Role']) assert.match(text, new RegExp(`${label}: not recorded`));
});

test('a Gate without an ask has its wait not recorded', (t) => {
  const root = tmp(t);
  state(root, 0, 'start', 'delta', '0.20.0');
  state(root, 5, 'gate', 'delta', 'brief', 'changed');
  ledger(root, 'delta', [{ kind: 'meta', aico: '0.20.0' }]);
  assert.match(gateReport({ root, version: '0.20.0' }), /- brief: changed, wait not recorded/);
});

test('no runs at all says so', (t) => {
  const root = tmp(t);
  assert.match(gateReport({ root, version: '0.20.0' }), /Runs: not recorded for this version\./);
});

test('hostile ledger files are skipped: link, oversize, junk lines, bad names', (t) => {
  const root = tmp(t);
  const dir = path.join(root, '.company', 'ledger');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'big.jsonl'), 'x'.repeat(2 * 1024 * 1024));
  fs.writeFileSync(path.join(dir, 'Bad Name.jsonl'), JSON.stringify({ kind: 'meta', aico: '0.20.0' }));
  fs.writeFileSync(path.join(dir, 'junk.jsonl'), 'not json\n[1]\n"x"\n' + JSON.stringify({ kind: 'meta', aico: '0.20.0' }) + '\n');
  fs.mkdirSync(path.join(dir, 'dir.jsonl'));
  assert.deepEqual(runsOf(root, '0.20.0').map((r) => r.run), ['junk']);
  assert.throws(() => gateReport({ root, version: '0.20.0; x' }), /semver/);
});

test('a role name that is not a role id never reaches the report', (t) => {
  const root = tmp(t);
  state(root, 0, 'start', 'eps', '0.20.0');
  state(root, 5, 'sub', 'eps', 'start', 'architect', 'bbbbbbbbbbbb');
  state(root, 9, 'sub', 'eps', 'stop', 'architect', 'bbbbbbbbbbbb');
  ledger(root, 'eps', [{ kind: 'meta', aico: '0.20.0' }]);
  const text = gateReport({ root, version: '0.20.0' });
  assert.match(text, /architect 4 s/);
});

test('the command prints the report and refuses a bad version', (t) => {
  const root = tmp(t);
  const env = { ...process.env, HOME: root, USERPROFILE: root, MCSPARROW_HOME: path.join(root, 'mh') };
  const ok = spawnSync(process.execPath, [script, '0.20.0'], { cwd: root, encoding: 'utf8', env });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^# Gate Report v0\.20\.0\n/);
  const bad = spawnSync(process.execPath, [script, '1.2'], { cwd: root, encoding: 'utf8', env });
  assert.notEqual(bad.status, 0);
});
