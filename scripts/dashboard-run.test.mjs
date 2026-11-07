import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './dashboard-run.mjs';

const NAME = '2026-11-04 01.19 - Run Topic';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-run-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.company', 'work', NAME);
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir };
}

const entry = (n, role, file = `${n}-${role}.md`) => ({ step: n, role, status: 'done', round: 0, file, verdict: null, gate: null });
const depsFor = (steps, extra = {}) => ({ show: () => ({ steps, gates: [], waves: [], subs: [], round: 0, ...extra }), active: () => ({ slug: null }) });

async function summary(t, content, file = '05-qa.md') {
  const { root, dir } = setup(t);
  fs.writeFileSync(path.join(dir, path.basename(file)), content);
  const out = await run(root, NAME, { deps: depsFor([entry(/^\d+/.exec(file)?.[0] ?? '05', 'qa', file)]) });
  return out.steps[0].summary;
}

test('a Step file name takes 2 or 3 digits and no more', async (t) => {
  assert.equal(await summary(t, '## Did\n- three digits\n', '100-qa.md'), 'three digits');
  assert.equal(await summary(t, '## Did\n- four digits\n', '1000-qa.md'), null);
});

test('unresolved slug gives null', async (t) => {
  const { root } = setup(t);
  assert.equal(await run(root, '..', { deps: depsFor([]) }), null);
  assert.equal(await run(root, '2026-11-04 01.19 - Nope', { deps: depsFor([]) }), null);
});

test('steps carry the Did summary: first 3 non-empty lines, markers removed, one space', async (t) => {
  const text = '---\nstep: 05\n---\nBy: qa\n## Did\n\n- one\n* two\n\n3. three\n- four\n## Next\n- later\n';
  assert.equal(await summary(t, text), 'one two three');
});

test('summary is cut at 300 characters and loses control characters', async (t) => {
  assert.equal((await summary(t, `## Did\n- ${'a'.repeat(400)}\n`)).length, 300);
  assert.equal(await summary(t, '## Did\n- a\u0007b‮c d\n'), 'abcd');
});

test('markup stays plain text', async (t) => {
  assert.equal(await summary(t, '## Did\n- <script>alert(1)</script> **x**\n'), '<script>alert(1)</script> **x**');
});

test('summary is null for a missing Did, an empty Did, a big file and a name outside the pattern', async (t) => {
  assert.equal(await summary(t, '## Next\n- x\n'), null);
  assert.equal(await summary(t, '## Did\n\n## Next\n- x\n'), null);
  assert.equal(await summary(t, `## Did\n- x\n${'y'.repeat(33 * 1024)}`), null);
  assert.equal(await summary(t, '## Did\n- ok\n', '05-QA.md'), null);
  assert.equal(await summary(t, '## Did\n- ok\n', '../05-qa.md'), null);
  assert.equal(await summary(t, '## Did\n- ok\n', 'sub/05-qa.md'), null);
});

test('summary is null for invalid UTF-8', async (t) => {
  const { root, dir } = setup(t);
  fs.writeFileSync(path.join(dir, '05-qa.md'), Buffer.concat([Buffer.from('## Did\n- '), Buffer.from([0xff, 0xfe]), Buffer.from('\n')]));
  const out = await run(root, NAME, { deps: depsFor([entry('05', 'qa')]) });
  assert.equal(out.steps[0].summary, null);
  assert.equal(out.steps[0].role, 'qa');
});

test('a file of exactly 32 KiB is read', async (t) => {
  const head = '## Did\n- fine\n## Next\n';
  assert.equal(await summary(t, head + 'z'.repeat(32 * 1024 - head.length)), 'fine');
});

test('a hard-linked file gives null', async (t) => {
  const { root, dir } = setup(t);
  fs.writeFileSync(path.join(dir, '05-qa.md'), '## Did\n- ok\n');
  fs.linkSync(path.join(dir, '05-qa.md'), path.join(root, 'other.md'));
  const out = await run(root, NAME, { deps: depsFor([entry('05', 'qa')]) });
  assert.equal(out.steps[0].summary, null);
});

test('a linked file gives null', async (t) => {
  const { root, dir } = setup(t);
  fs.writeFileSync(path.join(root, 'outside.md'), '## Did\n- secret\n');
  try {
    fs.symlinkSync(path.join(root, 'outside.md'), path.join(dir, '05-qa.md'));
  } catch (error) {
    t.skip(`links not permitted: ${error.code}`);
    return;
  }
  const out = await run(root, NAME, { deps: depsFor([entry('05', 'qa')]) });
  assert.equal(out.steps[0].summary, null);
});

test('a missing file keeps the Step listed', async (t) => {
  const { root } = setup(t);
  const out = await run(root, NAME, { deps: depsFor([entry('05', 'qa')]) });
  assert.deepEqual(out.steps, [{ step: '05', role: 'qa', status: 'done', round: 0, summary: null }]);
});

test('only the first 200 files are read', async (t) => {
  const { root, dir } = setup(t);
  const steps = [];
  for (let i = 0; i < 201; i++) {
    const n = String(i % 100).padStart(2, '0');
    const file = `${n}-r${i}.md`;
    fs.writeFileSync(path.join(dir, file), '## Did\n- ok\n');
    steps.push(entry(n, `r${i}`, file));
  }
  const out = await run(root, NAME, { deps: depsFor(steps) });
  assert.equal(out.steps.length, 201);
  assert.equal(out.steps[199].summary, 'ok');
  assert.equal(out.steps[200].summary, null);
});

test('active is null when the run is not the active one', async (t) => {
  const { root } = setup(t);
  const out = await run(root, NAME, { deps: depsFor([]) });
  assert.equal(out.active, null);
});

test('active run: Gates, waves, Role times, over-cap Steps, Fix rounds', async (t) => {
  const { root } = setup(t);
  const view = {
    steps: [], round: 2,
    gates: [{ gate: 'brief', result: 'passed', at: 'x', wait: 120 }, { gate: 'plan', result: 'passed', at: 'y', wait: null }],
    waves: [{ wave: 1, at: 'a' }, { wave: 2, at: 'b' }],
    subs: [
      { role: 'qa', id: '1', start: 's', stop: 'e', ms: 5000 },
      { role: 'architect', id: '2', start: 's', stop: null, ms: null },
      { role: 'qa', id: '3', start: 's', stop: 'e', ms: 2500 },
      { role: 'qa', id: '4', start: 's', stop: null, ms: null },
    ],
  };
  const over = [{ step: '07', role: 'backend-engineer', ctxEnd: 99000 }];
  const calls = [];
  const deps = {
    show: () => view,
    active: () => ({ slug: NAME }),
    readLedger: async (r, s) => { calls.push(s); return { state: 'ok', totals: { spend: 1, cacheRead: 2 }, overCap: over }; },
  };
  const out = await run(root, NAME, { deps });
  assert.deepEqual(out.active, {
    gates: [{ gate: 'brief', result: 'passed', waitS: 120 }, { gate: 'plan', result: 'passed', waitS: null }],
    waves: [{ wave: 1, at: 'a' }, { wave: 2, at: 'b' }],
    roleTimes: [{ role: 'qa', ms: 7500, steps: 3 }, { role: 'architect', ms: 0, steps: 1 }],
    overCap: over,
    fixRounds: 2,
  });
  assert.deepEqual(calls, [NAME]);
});

test('active run with an unavailable or throwing ledger has no over-cap rows', async (t) => {
  const { root } = setup(t);
  const base = { show: () => ({ steps: [] }), active: () => ({ slug: NAME }) };
  const a = await run(root, NAME, { deps: { ...base, readLedger: async () => ({ state: 'unavailable', totals: null, overCap: [] }) } });
  assert.deepEqual(a.active.overCap, []);
  const b = await run(root, NAME, { deps: { ...base, readLedger: async () => { throw new Error('x'); } } });
  assert.deepEqual(b.active.overCap, []);
  assert.equal(b.active.fixRounds, 0);
});

test('ledger is not read for a run that is not active', async (t) => {
  const { root } = setup(t);
  let called = false;
  await run(root, NAME, { deps: { ...depsFor([]), readLedger: async () => { called = true; } } });
  assert.equal(called, false);
});

test('a show failure gives an empty run, not a throw', async (t) => {
  const { root } = setup(t);
  const out = await run(root, NAME, { deps: { show: () => { throw new Error('bad'); }, active: () => ({ slug: null }) } });
  assert.deepEqual(out, { v: 1, slug: NAME, steps: [], rounds: [], routing: [], active: null });
});
