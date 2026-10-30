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
  assert.ok(!text.split('### alpha')[1].includes(': not recorded'), text);
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

const EVAL_FILES = { plan: ['tests', 'plan-review', 'eval.jsonl'], code: ['tests', 'code-review', 'eval.jsonl'] };

function evalFile(root, kind, text) {
  const file = path.join(root, ...EVAL_FILES[kind]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}
const rec = (o) => JSON.stringify({ v: 1, aico: '0.21.0', at: '2026-10-29T09:30:00Z', caught: 4, total: 5, ...o });
const planLine = (text) => text.split('\n').find((l) => l.startsWith('plan review eval:'));
const codeLine = (text) => text.split('\n').find((l) => l.startsWith('code review eval:'));
const report = (root) => gateReport({ root, version: '0.21.0' });

test('hostile eval files read not recorded and never fail the report', (t) => {
  const root = tmp(t);
  evalFile(root, 'plan', 'x'.repeat(2 * 1024 * 1024));
  evalFile(root, 'code', rec({ caught: '2' }) + '\n');
  let text = report(root);
  assert.equal(planLine(text), 'plan review eval: not recorded');
  assert.equal(codeLine(text), 'code review eval: not recorded');
  const bad = [
    rec({ caught: -1 }), rec({ caught: 1.5 }), rec({ total: null }), rec({ caught: 6 }), rec({ aico: 5 }),
    rec({ at: '2026-13-45T99:99:99Z' }), rec({ at: 'yesterday' }), rec({ v: 2 }), '[1]', '"x"', 'null', '{not json',
    rec({ caught: '3' }),
    rec({ at: '2026-10-29T09:30:00Z\n# injected' })
  ];
  for (const line of bad) {
    evalFile(root, 'plan', `${line}\n`);
    text = report(root);
    assert.equal(planLine(text), 'plan review eval: not recorded', line);
    assert.ok(!text.includes('injected') && !text.includes('\r'));
  }
  evalFile(root, 'plan', 'x'.repeat(3000) + '\n' + rec({ caught: 3, total: 5 }) + '\n');
  assert.equal(planLine(report(root)), 'plan review eval: 3 of 5 (2026-10-29)');
});

test('an eval record with a __proto__ key never changes the line or the prototype', (t) => {
  const root = tmp(t);
  evalFile(root, 'plan', '{"v":1,"aico":"0.21.0","at":"2026-10-29T09:30:00Z","caught":3,"total":5,"__proto__":{"caught":9},"constructor":{"x":1}}\n');
  assert.equal(planLine(report(root)), 'plan review eval: 3 of 5 (2026-10-29)');
  assert.equal({}.caught, undefined);
});

test('an eval file that is a link reads not recorded', (t) => {
  const root = tmp(t);
  const real = path.join(root, 'real.jsonl');
  fs.writeFileSync(real, rec() + '\n');
  const file = path.join(root, ...EVAL_FILES.plan);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.symlinkSync(real, file);
  } catch {
    t.skip('symlinks are not allowed here');
    return;
  }
  assert.equal(planLine(report(root)), 'plan review eval: not recorded');
});

test('a folder or a linked parent in place of the eval file reads not recorded', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, ...EVAL_FILES.plan), { recursive: true });
  assert.equal(planLine(report(root)), 'plan review eval: not recorded');
  const other = path.join(root, 'elsewhere');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'eval.jsonl'), rec() + '\n');
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  try {
    fs.symlinkSync(other, path.join(root, 'tests', 'code-review'), 'junction');
  } catch {
    return;
  }
  assert.equal(codeLine(report(root)), 'code review eval: not recorded');
});

test('the plan review line comes from the last record of the matching version', (t) => {
  const root = tmp(t);
  evalFile(root, 'plan', [rec({ aico: '0.20.0', caught: 5 }), rec({ caught: 2, at: '2026-10-28T01:00:00Z' }), rec({ caught: 4 }), rec({ aico: '0.22.0', caught: 1 })].join('\n') + '\n');
  assert.equal(planLine(report(root)), 'plan review eval: 4 of 5 (2026-10-29)');
});

test('the line reads not recorded when no record names the version or the file is missing', (t) => {
  const root = tmp(t);
  assert.equal(planLine(report(root)), 'plan review eval: not recorded');
  evalFile(root, 'plan', rec({ aico: '0.20.0' }) + '\n');
  assert.equal(planLine(report(root)), 'plan review eval: not recorded');
});

test('the code review line follows the plan review line, from its own file', (t) => {
  const root = tmp(t);
  evalFile(root, 'plan', rec() + '\n');
  evalFile(root, 'code', [rec({ caught: 1, total: 2 }), rec({ caught: 2, total: 2, at: '2026-10-30T00:00:00Z' })].join('\n') + '\n');
  const lines = report(root).split('\n');
  const i = lines.indexOf('plan review eval: 4 of 5 (2026-10-29)');
  assert.ok(i >= 0);
  assert.equal(lines[i + 1], 'code review eval: 2 of 2 (2026-10-30)');
});

test('the eval lines print with no runs and with runs, and a record of another version is not used', (t) => {
  const root = tmp(t);
  evalFile(root, 'code', rec({ aico: '0.20.0' }) + '\n');
  assert.match(report(root), /Runs: not recorded for this version\./);
  assert.equal(codeLine(report(root)), 'code review eval: not recorded');
  fullRun(root, 'zeta', '0.21.0');
  const text = report(root);
  assert.match(text, /Runs: 1/);
  assert.equal(planLine(text), 'plan review eval: not recorded');
});
