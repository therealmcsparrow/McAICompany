import test from 'node:test';
import assert from 'node:assert/strict';
import { TEXT, decideVerify, ownFailure, parseGateCommand, recordPath, writeTarget } from '../mods/lib/plan-gate.mjs';

const ROOT = 'C:/plugins/aico/0.20.0';
const A = `node ${ROOT}/scripts/run-state.mjs gate run-one plan passed`;
const B = `node ${ROOT}/scripts/run.mjs run-state gate run-one plan passed`;
const out = (policy, state, count) => JSON.stringify({ v: 1, policy, state, count, plan: null });

test('both recorded forms of the plan Gate give the slug', () => {
  assert.equal(parseGateCommand(A), 'run-one');
  assert.equal(parseGateCommand(B), 'run-one');
  assert.equal(parseGateCommand('node scripts/run-state.mjs gate run-one plan passed'), 'run-one');
  assert.equal(parseGateCommand('node C:\\p\\aico\\scripts\\run-state.mjs gate run-one plan passed'), 'run-one');
});

test('a command that only looks similar is not judged', () => {
  const near = [
    `${A};`, `${A} && x`, `${A} | x`, `${A}\n`, `${A}\r`, `${A} `, ` ${A}`, `${A} #`, `FOO=1 ${A}`, `& ${A}`,
    `"node" ${ROOT}/scripts/run-state.mjs gate run-one plan passed`,
    `node "${ROOT}/scripts/run-state.mjs" gate run-one plan passed`,
    `node ${ROOT}/scripts/run-state.mjs gate 'run-one' plan passed`,
    `node ${ROOT}/scripts/other.mjs gate run-one plan passed`,
    `node ${ROOT}/scripts/run-state.mjs gate run-one plan changed`,
    `node ${ROOT}/scripts/run-state.mjs gate run-one brief passed`,
    `node ${ROOT}/scripts/run-state.mjs gate Run-One plan passed`,
    `node ${ROOT}/scripts/run-state.mjs gate run-one plan passed x`,
    `node ${ROOT}/scripts/run-state.mjs  gate run-one plan passed`,
    `node ${ROOT}/scripts/run-state.mjs\tgate run-one plan passed`,
    `node ${ROOT}/scripts/run-state.mjs gate $S plan passed`,
    `node ${ROOT}/scripts/run-state.mjs gate ../x plan passed`,
    `node ${ROOT}/scripts/run-state.mjs gate run-one\u0430 plan passed`,
    `node ${ROOT}/xscripts/run-state.mjs gate run-one plan passed`,
    `node ${ROOT}/scripts/run.mjs gate run-one plan passed`,
    `node ${ROOT}/scripts/run.mjs run-state gate run-one plan changed`,
    `node --require x ${ROOT}/scripts/run-state.mjs gate run-one plan passed`,
    `node -- ${ROOT}/scripts/run-state.mjs gate run-one plan passed`,
    `node -x/scripts/run-state.mjs gate run-one plan passed`,
    `node $(x)/scripts/run-state.mjs gate run-one plan passed`,
    `node ${'a'.repeat(5000)}/scripts/run-state.mjs gate run-one plan passed`,
    `node ${ROOT}/scripts/run-state.mjs gate ${'a'.repeat(65)} plan passed`,
    '', null, undefined, 7, {}, ['node']
  ];
  for (const command of near) assert.equal(parseGateCommand(command), null, String(command).slice(0, 80));
});

test('a long hostile command is bounded and fast', () => {
  const started = Date.now();
  parseGateCommand(`node ${'/'.repeat(4000)}scripts/run-state.mjs gate x plan passed`);
  parseGateCommand(' '.repeat(4000));
  assert.ok(Date.now() - started < 200);
});

test('a run-state record path under work/ is found, in every form that reaches the file', () => {
  for (const path of [
    '/work/.company/work/run-one/run-state.jsonl', 'C:\\w\\.company\\work\\run-one\\run-state.jsonl', '.company/work/run-one/run-state.jsonl',
    'work/run-one/run-state.jsonl', '/w/.company/work/run-one/RUN-STATE.JSONL', '/w/.company/work/run-one/run-state.jsonl.',
    '/w/.company/work/run-one/run-state.jsonl ', '/w/.company/work/run-one/run-state.jsonl::$DATA'
  ]) assert.deepEqual(recordPath(path), { slug: 'run-one' }, path);
  assert.deepEqual(recordPath('/w/.company/work/Bad_Slug/run-state.jsonl'), { slug: null });
  assert.deepEqual(recordPath('/w/.company/work/../run-state.jsonl'), { slug: null });
});

test('another file is not a run-state record', () => {
  for (const path of [
    '/w/.company/work/run-one/02-plan.md', '/w/.company/work/run-one/run-state.jsonl.bak', '/w/src/run-state.jsonl',
    '/w/.company/work/run-state.jsonl', '/w/.company/work/run-one/sub/run-state.jsonl', '', null, 7, `/${'a'.repeat(5000)}/run-state.jsonl`
  ]) assert.equal(recordPath(path), null, String(path).slice(0, 60));
});

test('writeTarget reads own string keys only', () => {
  assert.equal(writeTarget({ file_path: '/a' }), '/a');
  assert.equal(writeTarget({ notebook_path: '/b' }), '/b');
  assert.equal(writeTarget(JSON.parse('{"__proto__": {"file_path": "/x"}}')), null);
  assert.equal(writeTarget(Object.create({ file_path: '/x' })), null);
  assert.equal(writeTarget({ file_path: 7 }), null);
  assert.equal(writeTarget(null), null);
});

test('block with open decisions denies with the count', () => {
  assert.deepEqual(decideVerify({ exitCode: 2, stdout: out('block', 'open', 1) }, null), {
    policy: 'block', action: 'deny', text: 'aico plan gate: 1 open decision; answer or settle them in the plan'
  });
  assert.equal(decideVerify({ exitCode: 2, stdout: out('block', 'open', 4) }, null).text, 'aico plan gate: 4 open decisions; answer or settle them in the plan');
  assert.equal(decideVerify({ exitCode: 2, stdout: 'x' }, null).action, 'deny');
});

test('no findings passes', () => {
  assert.deepEqual(decideVerify({ exitCode: 0, stdout: out('block', 'pass', 0) }, null), { policy: 'block', action: 'next', text: '' });
  assert.equal(decideVerify({ exitCode: 0, stdout: out('off', 'open', 2) }, null).action, 'next');
});

test('warn with findings passes with a count toast', () => {
  assert.deepEqual(decideVerify({ exitCode: 0, stdout: out('warn', 'open', 3) }, null), {
    policy: 'warn', action: 'toast', text: 'aico plan gate: 3 open decisions (warn)'
  });
});

test('a verify error is a toast under warn and a deny under block', () => {
  assert.deepEqual(decideVerify({ exitCode: 1, stdout: out('warn', 'error', 0) }, null), { policy: 'warn', action: 'toast', text: TEXT.error });
  assert.equal(decideVerify({ exitCode: 1, stdout: out('block', 'error', 0) }, null).action, 'deny');
});

test('a failure follows the last policy when the answer has none', () => {
  for (const bad of [null, undefined, { exitCode: 7, stdout: '' }, { exitCode: 0, stdout: 'x' }, { exitCode: 0, stdout: out('x', 'pass', 0) }, { exitCode: 0, stdout: out('warn', 'pass', -1) },
    { exitCode: 0, stdout: out('warn', 'pass', 1.5) }, { exitCode: 0, stdout: '['.repeat(100) }, { exitCode: 0, stdout: 'a'.repeat(70000) }, { exitCode: 0, isStdoutTruncated: true, stdout: out('warn', 'pass', 0) }]) {
    assert.equal(decideVerify(bad, 'block').action, 'deny');
    assert.equal(decideVerify(bad, 'warn').action, 'toast');
    assert.equal(decideVerify(bad, null).action, 'toast');
  }
});

test('the count in a deny is a bounded integer, never plan text', () => {
  const text = decideVerify({ exitCode: 2, stdout: JSON.stringify({ v: 1, policy: 'block', state: 'open', count: 2, plan: 'SECRET' }) }, null).text;
  assert.ok(!text.includes('SECRET'));
  assert.equal(decideVerify({ exitCode: 2, stdout: out('block', 'open', 'x') }, null).text, 'aico plan gate: open decisions; answer or settle them in the plan');
});

test('the mod failing is refused only under block', () => {
  assert.equal(ownFailure('block'), 'deny');
  for (const last of ['warn', 'off', null]) assert.equal(ownFailure(last), 'next');
});
