import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run as runState } from './run-state.mjs';
import { main as planTasks } from './plan-tasks.mjs';
import { main as planCheck, verifyPlans } from './plan-check.mjs';
import { resolveSettings } from './settings.mjs';

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const SLUG = 'demo';
const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

const CLEAN = [
  '## Tasks',
  '### T1 first task',
  '- role: backend-engineer',
  '- files: a/one.js',
  '- depends-on: none',
  '- parallel: yes',
  '### T2 second task',
  '- role: backend-engineer',
  '- files: b/two.js',
  '- depends-on: none',
  '- parallel: yes',
  ''
].join('\n');
const OPEN = `## Steps\nTBD which store\n${CLEAN}`;
const DECIDED = `## Steps\nDecided: use sqlite because it is local\n${CLEAN}`;

function env({ policy = 'block', projectPolicy } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gate-'));
  roots.push(base);
  const home = path.join(base, 'home');
  const product = path.join(base, 'product');
  const pluginRoot = path.join(base, 'plugin');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'agents', 'backend-engineer.md'), 'agent\n');
  const dir = path.join(product, '.company', 'work', SLUG);
  fs.mkdirSync(dir, { recursive: true });
  const e = { base, home, product, pluginRoot, dir };
  e.setUser = (p) => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ aico_settings: { version: 1, plan_check: { policy: p } } }));
  e.setProject = (p) => {
    fs.mkdirSync(path.join(product, '.company'), { recursive: true });
    fs.writeFileSync(path.join(product, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, plan_check: { policy: p } } }));
  };
  if (policy) e.setUser(policy);
  if (projectPolicy) e.setProject(projectPolicy);
  e.plan = (text, name = '02-plan.md') => fs.writeFileSync(path.join(dir, name), text);
  e.state = (...a) => runState(a, { root: product, now: NOW, home });
  e.tasks = (...a) => planTasks(a, { root: product, now: NOW, home, pluginRoot });
  e.check = (...a) => planCheck(a, { root: product, now: NOW, home });
  e.begin = (name = '02-plan.md') => e.tasks('begin', SLUG, name, '--cap', '3', '--mode', 'parallel');
  e.file = (n) => path.join(dir, n);
  e.read = (n) => (fs.existsSync(e.file(n)) ? fs.readFileSync(e.file(n), 'utf8') : '');
  return e;
}

function linkOrSkip(t, fn) {
  try {
    fn();
    return true;
  } catch {
    t.skip('links cannot be created here');
    return false;
  }
}

const refusedGate = (r) => {
  assert.equal(r.code === 2 || r.code === 3, true, JSON.stringify(r));
  const text = r.out ?? r.lines.join('\n');
  assert.match(text, /^refused: plan gate: /);
};

// Both Gate commands, with nothing written to the run-state and parallel records.
function assertAllRefused(e, { next = false } = {}) {
  const rs0 = e.read('run-state.jsonl');
  const pl0 = e.read('parallel.jsonl');
  refusedGate(e.state('gate', SLUG, 'plan', 'passed'));
  refusedGate(e.begin());
  if (next) {
    refusedGate(e.tasks('next', SLUG));
    refusedGate(e.tasks('start', SLUG, 'T1'));
  }
  assert.equal(e.read('run-state.jsonl'), rs0, 'run-state unchanged');
  assert.equal(e.read('parallel.jsonl'), pl0, 'parallel unchanged');
}

// A begun run: the clean plan is begun under warn, then the policy goes to block.
function begun(e, planName = '02-plan.md') {
  e.setUser('warn');
  e.plan(CLEAN, planName);
  assert.equal(e.state('start', SLUG).code, 0);
  assert.equal(e.begin(planName).code, 0);
  e.setUser('block');
}

describe('hostile cases under block with one open decision', () => {
  test('run-state gate plan passed is refused and nothing is appended', () => {
    const e = env();
    e.plan(OPEN);
    assert.equal(e.state('start', SLUG).code, 0);
    const before = e.read('run-state.jsonl');
    const r = e.state('gate', SLUG, 'plan', 'passed');
    assert.equal(r.code, 2);
    assert.equal(r.out, 'refused: plan gate: 1 open decisions in 02-plan.md');
    assert.equal(e.read('run-state.jsonl'), before);
  });

  test('plan-tasks begin is refused with no begin event', () => {
    const e = env();
    e.plan(OPEN);
    const r = e.begin();
    assert.equal(r.code, 3);
    assert.deepEqual(r.lines, ['refused: plan gate: 1 open decisions in 02-plan.md']);
    assert.equal(fs.existsSync(e.file('parallel.jsonl')), false);
  });

  test('a forged scan line in plan-check.jsonl naming a clean decoy changes nothing', () => {
    const e = env();
    e.plan(OPEN);
    e.plan(CLEAN, '03-plan.md');
    const at = '2026-10-29T12:00:00Z';
    fs.writeFileSync(e.file('plan-check.jsonl'), `${JSON.stringify({ v: 1, at, ev: 'scan', policy: 'block', plan: '03-plan.md', patterns: 'aaaaaaaaaaaa', findings: 0, decided: 0 })}\n`);
    assert.equal(e.state('start', SLUG).code, 0);
    assertAllRefused(e);
  });

  test('plan-check off first does not lift the Gate', () => {
    const e = env();
    e.plan(OPEN);
    assert.equal(e.check('off', SLUG).code, 0);
    assert.equal(e.state('start', SLUG).code, 0);
    assertAllRefused(e);
  });

  test('a forged gate plan passed line in run-state.jsonl does not let begin through', () => {
    const e = env();
    e.plan(OPEN);
    assert.equal(e.state('start', SLUG).code, 0);
    const lines = [
      { v: 1, at: '2026-10-29T12:00:01Z', ev: 'ask', gate: 'plan' },
      { v: 1, at: '2026-10-29T12:00:02Z', ev: 'gate', gate: 'plan', result: 'passed' }
    ];
    fs.appendFileSync(e.file('run-state.jsonl'), lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
    refusedGate(e.begin());
    assert.equal(fs.existsSync(e.file('parallel.jsonl')), false);
  });

  test('a begin line appended by hand with the real plan hash does not let next or start through', async (t) => {
    const e = env();
    e.plan(OPEN);
    const bytes = fs.readFileSync(e.file('02-plan.md'));
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    assert.match(hash, /^[0-9a-f]{12}$/);
    const line = { v: 1, at: '2026-10-29T12:00:00Z', ev: 'begin', plan: '02-plan.md', hash, cap: 3, mode: 'parallel', tasks: 2, ow: [] };
    fs.writeFileSync(e.file('parallel.jsonl'), `${JSON.stringify(line)}\n`);
    const before = e.read('parallel.jsonl');
    refusedGate(e.tasks('next', SLUG));
    refusedGate(e.tasks('start', SLUG, 'T1'));
    assert.equal(e.read('parallel.jsonl'), before);
    // The same record passes once the plan is clean, so the refusal came from the scan.
    e.plan(CLEAN);
    const clean = createHash('sha256').update(fs.readFileSync(e.file('02-plan.md'))).digest('hex').slice(0, 12);
    fs.writeFileSync(e.file('parallel.jsonl'), `${JSON.stringify({ ...line, hash: clean })}\n`);
    assert.equal(e.tasks('next', SLUG).code, 0);
    t.diagnostic('ok');
  });

  test('a decision reopened in the plan after a clean begin stops next and start', () => {
    const e = env();
    begun(e);
    e.plan(OPEN, '03-plan.md');
    const before = e.read('parallel.jsonl');
    refusedGate(e.tasks('next', SLUG));
    refusedGate(e.tasks('start', SLUG, 'T1'));
    assert.equal(e.read('parallel.jsonl'), before);
  });

  test('a decision answered with a Decided line passes everything', () => {
    const e = env();
    e.plan(DECIDED);
    assert.equal(e.state('start', SLUG).code, 0);
    assert.equal(e.begin().code, 0);
    assert.equal(e.tasks('next', SLUG).code, 0);
    assert.equal(e.tasks('start', SLUG, 'T1').code, 0);
    assert.equal(e.state('gate', SLUG, 'plan', 'passed').code, 0);
  });

  test('02-plan.md as a symbolic link beside a clean 03-plan.md is an unreadable error', (t) => {
    const e = env();
    begun(e, '03-plan.md');
    e.setUser('block');
    if (!linkOrSkip(t, () => fs.symlinkSync(e.file('03-plan.md'), e.file('02-plan.md')))) return;
    const v = e.check('verify', SLUG);
    assert.equal(v.code, 1);
    assert.deepEqual(v.lines, ['plan-check (block): error unreadable']);
    assertAllRefused(e, { next: true });
  });

  test('02-plan.md as a hard link beside a clean 03-plan.md is an unreadable error', (t) => {
    const e = env();
    begun(e, '03-plan.md');
    if (!linkOrSkip(t, () => fs.linkSync(e.file('03-plan.md'), e.file('02-plan.md')))) return;
    const v = e.check('verify', SLUG);
    assert.equal(v.code, 1);
    assert.deepEqual(v.lines, ['plan-check (block): error unreadable']);
    assertAllRefused(e, { next: true });
  });

  test('a directory named like a plan is an unreadable error', () => {
    const e = env();
    e.plan(CLEAN, '03-plan.md');
    fs.mkdirSync(e.file('02-plan.md'));
    assert.deepEqual(e.check('verify', SLUG).lines, ['plan-check (block): error unreadable']);
  });

  test('the only plan file being a link is an unreadable error', (t) => {
    const e = env();
    const target = path.join(e.base, 'elsewhere.md');
    fs.writeFileSync(target, CLEAN);
    if (!linkOrSkip(t, () => fs.symlinkSync(target, e.file('02-plan.md')))) return;
    assert.deepEqual(e.check('verify', SLUG).lines, ['plan-check (block): error unreadable']);
    assert.equal(e.state('start', SLUG).code, 0);
    assertAllRefused(e);
  });

  test('a run folder with no plan file is no plan', () => {
    const e = env();
    fs.writeFileSync(e.file('notes.md'), 'x\n');
    assert.deepEqual(e.check('verify', SLUG).lines, ['plan-check (block): error no plan']);
    assert.equal(e.state('start', SLUG).code, 0);
    assert.equal(e.state('gate', SLUG, 'plan', 'passed').out, 'refused: plan gate: no plan');
    assert.equal(e.begin().lines[0], 'refused: plan gate: no plan');
  });

  test('a run folder that is a link or a missing run folder is refused', (t) => {
    const e = env();
    fs.rmSync(e.dir, { recursive: true });
    assert.equal(e.check('verify', SLUG).code, 1);
    assert.equal(e.begin().lines[0], 'refused: plan gate: no plan');
    const real = path.join(e.base, 'real');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, '02-plan.md'), CLEAN);
    if (!linkOrSkip(t, () => fs.symlinkSync(real, e.dir, 'junction'))) return;
    assert.deepEqual(e.check('verify', SLUG).lines, ['plan-check (block): error unreadable']);
    assert.equal(e.begin().lines[0], 'refused: plan gate: unreadable');
  });

  test('a plan over the size cap is too large', () => {
    const e = env();
    e.plan(`${CLEAN}\n${'x'.repeat(300 * 1024)}\n`);
    assert.deepEqual(e.check('verify', SLUG).lines, ['plan-check (block): error too large']);
    assert.equal(e.begin().lines[0], 'refused: plan gate: too large');
  });

  test('a plan that is not UTF-8 is unreadable', () => {
    const e = env();
    fs.writeFileSync(e.file('02-plan.md'), Buffer.from([0xff, 0xfe, 0x41]));
    assert.deepEqual(e.check('verify', SLUG).lines, ['plan-check (block): error unreadable']);
  });

  test('a patterns file that cannot be read refuses every Gate command', () => {
    const e = env();
    e.plan(CLEAN);
    const plugin = path.join(e.base, 'plugin-copy');
    const scripts = path.join(plugin, 'scripts');
    fs.mkdirSync(scripts, { recursive: true });
    for (const f of fs.readdirSync(import.meta.dirname)) {
      if (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) fs.copyFileSync(path.join(import.meta.dirname, f), path.join(scripts, f));
    }
    const sandbox = { cwd: e.product, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: e.home, HOME: e.home, USERPROFILE: e.home } };
    const node = (script, ...a) => spawnSync(process.execPath, [path.join(scripts, script), ...a], sandbox);
    for (const d of ['agents', 'company']) fs.cpSync(path.join(import.meta.dirname, '..', d), path.join(plugin, d), { recursive: true });
    // The patterns file is absent from the copy.
    assert.equal(node('run-state.mjs', 'start', SLUG).status, 0);
    const gate = node('run-state.mjs', 'gate', SLUG, 'plan', 'passed');
    assert.equal(gate.status, 2);
    assert.match(gate.stdout, /^refused: plan gate: patterns/);
    const begin = node('plan-tasks.mjs', 'begin', SLUG, '02-plan.md', '--cap', '3', '--mode', 'parallel');
    assert.equal(begin.status, 3);
    assert.match(begin.stdout, /^refused: plan gate: patterns/);
    const verify = node('plan-check.mjs', 'verify', SLUG);
    assert.equal(verify.status, 1);
    assert.equal(verify.stdout.trim(), 'plan-check (block): error patterns');
    assert.equal(fs.existsSync(e.file('parallel.jsonl')), false);
  });
});

describe('what the Gate leaves alone under block', () => {
  test('done, lines and scope of a running task still work with an open decision', () => {
    const e = env();
    begun(e);
    e.setUser('warn');
    assert.equal(e.tasks('start', SLUG, 'T1').code, 0);
    e.setUser('block');
    e.plan(OPEN, '03-plan.md');
    assert.equal(e.tasks('lines', SLUG, 'T1').code, 0);
    assert.equal(e.tasks('scope', SLUG, 'T1', '--', 'a/one.js').code, 0);
    assert.equal(e.tasks('done', SLUG, 'T1').code, 0);
    assert.equal(e.tasks('check', SLUG, '02-plan.md', '--cap', '3', '--mode', 'parallel').code, 0);
  });

  test('gate plan changed and stopped are never checked', () => {
    const e = env();
    e.plan(OPEN);
    assert.equal(e.state('start', SLUG).code, 0);
    assert.equal(e.state('gate', SLUG, 'plan', 'changed').code, 0);
    assert.equal(e.state('gate', SLUG, 'plan', 'stopped').code, 0);
    const e2 = env();
    assert.equal(e2.state('start', SLUG).code, 0);
    assert.equal(e2.state('gate', SLUG, 'plan', 'changed').code, 0);
  });

  test('other Gates are not checked', () => {
    const e = env();
    e.plan(OPEN);
    assert.equal(e.state('start', SLUG).code, 0);
    assert.equal(e.state('gate', SLUG, 'brief', 'passed').code, 0);
    assert.equal(e.state('gate', SLUG, 'ship', 'passed').code, 0);
  });

  test('with no open decisions every command passes as before', () => {
    const e = env();
    e.plan(CLEAN);
    assert.equal(e.state('start', SLUG).code, 0);
    assert.equal(e.state('gate', SLUG, 'plan', 'passed').code, 0);
    assert.equal(e.begin().code, 0);
    assert.equal(e.tasks('next', SLUG).code, 0);
    assert.equal(e.tasks('start', SLUG, 'T1').code, 0);
  });

  test('under warn and off an open decision does not stop any command', () => {
    for (const policy of ['warn', 'off', null]) {
      const e = env({ policy });
      e.plan(OPEN);
      assert.equal(e.state('start', SLUG).code, 0, String(policy));
      assert.equal(e.state('gate', SLUG, 'plan', 'passed').code, 0, String(policy));
      assert.equal(e.begin().code, 0, String(policy));
      assert.equal(e.tasks('next', SLUG).code, 0, String(policy));
      assert.equal(e.tasks('start', SLUG, 'T1').code, 0, String(policy));
    }
  });

  test('under warn a run-state gate on a run with no plan file is not refused', () => {
    const e = env({ policy: 'warn' });
    assert.equal(e.state('start', SLUG).code, 0);
    assert.equal(e.state('gate', SLUG, 'plan', 'passed').code, 0);
  });
});

describe('verify', () => {
  test('--json prints exactly the result keys and exit 2 under block with an open decision', () => {
    const e = env();
    e.plan(OPEN);
    const r = e.check('verify', SLUG, '--json');
    assert.equal(r.code, 2);
    const o = JSON.parse(r.lines[0]);
    assert.deepEqual(Object.keys(o), ['v', 'policy', 'state', 'count', 'plan']);
    assert.deepEqual(o, { v: 1, policy: 'block', state: 'open', count: 1, plan: '02-plan.md' });
    assert.deepEqual(e.check('verify', SLUG).lines, ['plan-check (block): 1 open decision, 0 decided']);
  });

  test('--json for an error carries reason', () => {
    const e = env();
    const o = JSON.parse(e.check('verify', SLUG, '--json').lines[0]);
    assert.deepEqual(o, { v: 1, policy: 'block', state: 'error', count: 0, plan: null, reason: 'no plan' });
  });

  test('exit 0 under warn and off with open decisions, exit 1 on error under any policy', () => {
    for (const policy of ['warn', 'off']) {
      const e = env({ policy });
      e.plan(OPEN);
      assert.equal(e.check('verify', SLUG).code, 0, policy);
      fs.rmSync(e.file('02-plan.md'));
      assert.equal(e.check('verify', SLUG).code, 1, policy);
    }
  });

  test('pass with decided lines, counts decided', () => {
    const e = env();
    e.plan(DECIDED);
    const r = e.check('verify', SLUG);
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, ['plan-check (block): 0 open decisions, 1 decided']);
    assert.deepEqual(verifyPlans({ root: e.product, home: e.home, slug: SLUG }), { v: 1, policy: 'block', state: 'pass', count: 0, plan: null });
  });

  test('a named plan is the only one scanned, and a bad name is unreadable', () => {
    const e = env();
    e.plan(OPEN, '02-plan.md');
    e.plan(CLEAN, '03-plan.md');
    assert.equal(e.check('verify', SLUG, '03-plan.md').code, 0);
    assert.equal(e.check('verify', SLUG, '02-plan.md').code, 2);
    assert.equal(e.check('verify', SLUG, '../x').code, 1);
  });

  test('changes no file and reads no record', () => {
    const e = env();
    e.plan(OPEN);
    fs.writeFileSync(e.file('plan-check.jsonl'), 'not json at all\n');
    fs.writeFileSync(e.file('run-state.jsonl'), 'junk\n');
    fs.writeFileSync(e.file('parallel.jsonl'), 'junk\n');
    const snap = () => fs.readdirSync(e.dir).sort().map((n) => [n, fs.readFileSync(e.file(n), 'utf8'), fs.statSync(e.file(n)).mtimeMs]);
    const before = snap();
    assert.equal(e.check('verify', SLUG).code, 2);
    assert.deepEqual(snap(), before);
  });

  test('bad slug is refused and a slug with a path is never joined', () => {
    const e = env();
    assert.equal(e.check('verify', '../demo').code, 3);
    assert.throws(() => verifyPlans({ root: e.product, home: e.home, slug: '../demo' }));
  });
});

describe('policy resolution, block wins', () => {
  const policyOf = (e) => resolveSettings({ home: e.home, cwd: e.product, pluginRoot: e.pluginRoot });

  test('a user block with a project warn or off resolves block and lists the project value', () => {
    for (const p of ['warn', 'off']) {
      const e = env({ policy: 'block', projectPolicy: p });
      const r = policyOf(e);
      assert.equal(r.plan_check.policy, 'block', p);
      assert.deepEqual(r.ignored.filter((i) => i.startsWith('plan_check.policy')), ['plan_check.policy: a project cannot lower a user block']);
    }
  });

  test('a project block with a user warn or off resolves block, nothing ignored', () => {
    for (const u of ['warn', 'off']) {
      const e = env({ policy: u, projectPolicy: 'block' });
      const r = policyOf(e);
      assert.equal(r.plan_check.policy, 'block', u);
      assert.deepEqual(r.ignored.filter((i) => i.startsWith('plan_check')), []);
    }
  });

  test('a broken project layer with a user block stays block', () => {
    const e = env({ policy: 'block' });
    fs.mkdirSync(path.join(e.product, '.company'), { recursive: true });
    fs.writeFileSync(path.join(e.product, '.company', 'settings.json'), '{ not json');
    assert.equal(policyOf(e).plan_check.policy, 'block');
    const bad = env({ policy: 'block' });
    fs.mkdirSync(path.join(bad.product, '.company'), { recursive: true });
    fs.writeFileSync(path.join(bad.product, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, plan_check: { policy: 'nope' }, bogus: 1 } }));
    assert.equal(policyOf(bad).plan_check.policy, 'block');
  });

  test('a project off under a user block cannot lift the Gate', () => {
    const e = env({ policy: 'block', projectPolicy: 'off' });
    e.plan(OPEN);
    assert.equal(e.state('start', SLUG).code, 0);
    assertAllRefused(e);
  });

  test('without a user block the project value counts as before', () => {
    assert.equal(policyOf(env({ policy: 'warn', projectPolicy: 'off' })).plan_check.policy, 'off');
    assert.equal(policyOf(env({ policy: null, projectPolicy: 'warn' })).plan_check.policy, 'warn');
    assert.equal(policyOf(env({ policy: 'off' })).plan_check.policy, 'off');
    assert.equal(policyOf(env({ policy: null })).plan_check.policy, 'warn');
  });
});
