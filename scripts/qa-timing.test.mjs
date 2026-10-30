import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// Remove the temp dirs this file made, once the run is over.
const __tmpDirs = [];
const __mkdtemp = fs.mkdtempSync;
const __rmTree = fs.rmSync;
fs.mkdtempSync = (...a) => { const d = __mkdtemp(...a); __tmpDirs.push(d); return d; };
process.on('exit', () => { for (const d of __tmpDirs) { try { __rmTree(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const script = path.join(import.meta.dirname, 'qa-timing.mjs');
const QUICK = "import {test} from 'node:test'; test('q', () => {});";
const SLOW = "import {test} from 'node:test'; test('s', async () => { await new Promise((r) => setTimeout(r, 150)); });";

function makeRoot(budgets, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-timing-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'tests'));
  const defaults = { 'alpha.mjs': '', 'alpha.test.mjs': SLOW, 'beta.mjs': '', 'beta.test.mjs': QUICK };
  for (const [name, body] of Object.entries({ ...defaults, ...files })) {
    fs.writeFileSync(path.join(root, 'scripts', name), body);
  }
  if (budgets !== null) {
    fs.writeFileSync(path.join(root, 'tests', 'budgets.json'), typeof budgets === 'string' ? budgets : JSON.stringify(budgets));
  }
  return root;
}

function run(root, extra = []) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [script, '--root', root, ...extra], { encoding: 'utf8', env, timeout: 120000 });
  return { code: r.status, out: r.stdout.trim().split('\n').filter(Boolean) };
}

test('a test file over its budget prints one line with the Module and both numbers, exit 0', () => {
  const root = makeRoot({ v: 1, default_ms: 600000, modules: { alpha: 1 } });
  const r = run(root);
  assert.equal(r.code, 0);
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^over budget alpha: \d+ ms of 1 ms$/);
});

test('a file under budget prints nothing', () => {
  const root = makeRoot({ v: 1, default_ms: 600000, modules: { alpha: 600000 } });
  const r = run(root);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, []);
});

test('a Module with no budget uses the default', () => {
  const root = makeRoot({ v: 1, default_ms: 1, modules: { alpha: 600000 } });
  const r = run(root);
  assert.equal(r.code, 0);
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^over budget beta: \d+ ms of 1 ms$/);
});

test('a Module named like an Object prototype key gets the default', () => {
  const root = makeRoot({ v: 1, default_ms: 1, modules: {} }, { 'constructor.mjs': '', 'constructor.test.mjs': QUICK });
  const r = run(root, ['--module', 'constructor']);
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^over budget constructor: \d+ ms of 1 ms$/);
});

test('a test file belongs to the Module with the longest matching stem', () => {
  const root = makeRoot(
    { v: 1, default_ms: 600000, modules: { alpha: 600000, 'alpha-extra': 1 } },
    { 'alpha-extra.mjs': '', 'alpha-extra.test.mjs': QUICK }
  );
  const r = run(root);
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^over budget alpha-extra: /);
});

test('--module limits the run to one Module', () => {
  const root = makeRoot({ v: 1, default_ms: 1, modules: {} });
  const r = run(root, ['--module', 'beta']);
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^over budget beta: /);
});

const BAD = [
  ['not json', '{nope'],
  ['wrong version', { v: 2, default_ms: 10, modules: {} }],
  ['missing default', { v: 1, modules: {} }],
  ['string number', { v: 1, default_ms: '10', modules: {} }],
  ['negative', { v: 1, default_ms: 10, modules: { alpha: -5 } }],
  ['zero', { v: 1, default_ms: 0, modules: {} }],
  ['float', { v: 1, default_ms: 1.5, modules: {} }],
  ['huge', { v: 1, default_ms: 1e12, modules: {} }],
  ['bad key', { v: 1, default_ms: 10, modules: { '../x': 5 } }],
  ['proto key', '{"v":1,"default_ms":10,"modules":{"__proto__":5}}'],
  ['extra key', { v: 1, default_ms: 10, modules: {}, more: 1 }],
  ['array', []],
  ['modules array', { v: 1, default_ms: 10, modules: [] }],
  ['oversize', ' '.repeat(70000)]
];
for (const [name, body] of BAD) {
  test(`a bad budgets file (${name}) gives one error line, exit 0`, () => {
    const root = makeRoot(body);
    const r = run(root);
    assert.equal(r.code, 0);
    assert.equal(r.out.length, 1);
    assert.match(r.out[0], /^qa-timing: error [^\n]+$/);
  });
}

test('a missing budgets file gives one error line', () => {
  const r = run(makeRoot(null));
  assert.equal(r.code, 0);
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^qa-timing: error /);
});

test('a budgets file that is a link is refused', (t) => {
  const root = makeRoot(null);
  const real = path.join(root, 'real.json');
  fs.writeFileSync(real, JSON.stringify({ v: 1, default_ms: 600000, modules: {} }));
  try {
    fs.symlinkSync(real, path.join(root, 'tests', 'budgets.json'));
  } catch {
    t.skip('symlinks not allowed here');
    return;
  }
  const r = run(root);
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^qa-timing: error /);
});

test('an unknown argument gives one error line, exit 0', () => {
  const r = run(makeRoot({ v: 1, default_ms: 600000, modules: {} }), ['--shell', 'x']);
  assert.equal(r.code, 0);
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^qa-timing: error /);
});

test('a --module value that is not a stem gives one error line', () => {
  const r = run(makeRoot({ v: 1, default_ms: 600000, modules: {} }), ['--module', '../x']);
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^qa-timing: error /);
});

test('the repo budgets file is valid and names only real script stems', () => {
  const file = path.join(import.meta.dirname, '..', 'tests', 'budgets.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(data.v, 1);
  assert.ok(Number.isInteger(data.default_ms) && data.default_ms > 0);
  for (const stem of Object.keys(data.modules)) {
    assert.ok(fs.existsSync(path.join(import.meta.dirname, `${stem}.mjs`)), `no script for ${stem}`);
  }
});
