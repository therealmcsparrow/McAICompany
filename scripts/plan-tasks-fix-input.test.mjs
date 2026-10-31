import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, readParallel, ParallelRecordError } from './plan-tasks.mjs';
import { main as guard } from './run-guard.mjs';
import { main as ledger } from './ledger.mjs';

// Bug: `plan-tasks` refuses `input-fix.md`, the copy that `draft-input take --for fix` prints, as `plan-name`.
// Suspected Module: scripts/plan-tasks.mjs (PLAN_NAME at readPlan, planFor and the begin record check).
// AC1 check and begin take the name; AC2 every later record read takes it; AC3 the old names still pass;
// AC4 look-alikes still exit 1 plan-name (an exact, case-sensitive compare).
const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const ROLES = ['backend-engineer', 'qa'];
const NAME = 'input-fix.md';
const SLUG = 'demo';

let home;
let envBackup;
const roots = [];

before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-fix-home-'));
  envBackup = { ...process.env };
  process.env.MCSPARROW_HOME = path.join(home, 'mcs');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});

after(() => {
  for (const key of ['MCSPARROW_HOME', 'HOME', 'USERPROFILE']) {
    if (envBackup[key] === undefined) delete process.env[key];
    else process.env[key] = envBackup[key];
  }
  fs.rmSync(home, { recursive: true, force: true });
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

const task = (id, deps = 'none') =>
  `### ${id} title of ${id}\n- role: backend-engineer\n- files: ${id.toLowerCase()}/file.js\n- depends-on: ${deps}\n- parallel: yes\n`;
const PLAN = `${['# Plan', '', '## Tasks', '', task('T1'), task('T2', 'T1')].join('\n')}\n`;

// A temp product root with an isolated home and no settings (policy warn), plugin agents, and a plan file named `name`.
function fixture(name = NAME, text = PLAN) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-fix-'));
  roots.push(root);
  const pluginRoot = path.join(root, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'aico', version: '0.24.0' }));
  for (const a of ROLES) fs.writeFileSync(path.join(pluginRoot, 'agents', `${a}.md`), 'agent\n');
  const product = path.join(root, 'product');
  const dir = path.join(product, '.company', 'work', SLUG);
  fs.mkdirSync(dir, { recursive: true });
  if (name !== null) fs.writeFileSync(path.join(dir, name), text);
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(homeDir);
  const run = (...args) => main(args, { now: NOW, root: product, pluginRoot, home: homeDir });
  return { root: product, pluginRoot, dir, run, record: path.join(dir, 'parallel.jsonl') };
}

const events = (fx) => fs.readFileSync(fx.record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('AC1 check and begin take input-fix.md', () => {
  test('input-fix.md is a plan name for check', () => {
    const fx = fixture();
    const r = fx.run('check', SLUG, NAME, '--cap', '4', '--mode', 'sequential');
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.doesNotMatch(r.lines.join('\n'), /error/);
  });

  test('begin on input-fix.md writes a begin record naming it', () => {
    const fx = fixture();
    const r = fx.run('begin', SLUG, NAME, '--cap', '4', '--mode', 'sequential');
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(r.lines.at(-1), 'begun');
    const [first] = events(fx);
    assert.equal(first.ev, 'begin');
    assert.equal(first.plan, NAME);
    assert.equal(first.mode, 'sequential');
    assert.equal(first.tasks, 2);
  });

  test('check and begin on the copy still refuse a missing file with plan-missing, not plan-name', () => {
    const fx = fixture(null);
    assert.deepEqual(fx.run('check', SLUG, NAME, '--cap', '4', '--mode', 'sequential'), { code: 1, lines: ['plan-tasks: error plan-missing'] });
    assert.deepEqual(fx.run('begin', SLUG, NAME, '--cap', '4', '--mode', 'sequential'), { code: 1, lines: ['plan-tasks: error plan-missing'] });
  });
});

describe('AC2 every record read takes the begun input-fix.md', () => {
  function begun() {
    const fx = fixture();
    const r = fx.run('begin', SLUG, NAME, '--cap', '4', '--mode', 'sequential');
    assert.equal(r.code, 0, `begin: ${r.lines.join('\n')}`);
    return fx;
  }

  test('next offers the first ticket', () => {
    const fx = begun();
    const r = fx.run('next', SLUG);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.ok(r.lines.includes('start T1 backend-engineer'), r.lines.join('\n'));
    assert.ok(r.lines.some((l) => /^wait T2/.test(l)), r.lines.join('\n'));
  });

  test('brief writes the task brief from the copy', () => {
    const fx = begun();
    const r = fx.run('brief', SLUG, 'T1');
    assert.deepEqual(r, { code: 0, lines: [`Task brief: .company/work/${SLUG}/tasks/T1.md`] });
    assert.match(fs.readFileSync(path.join(fx.dir, 'tasks', 'T1.md'), 'utf8'), /T1/);
  });

  test('start and done run a ticket through the copy', () => {
    const fx = begun();
    assert.equal(fx.run('start', SLUG, 'T1').code, 0);
    assert.equal(fx.run('done', SLUG, 'T1').code, 0);
    const next = fx.run('next', SLUG);
    assert.ok(next.lines.includes('start T2 backend-engineer'), next.lines.join('\n'));
  });

  test('read and readParallel show the run as on, with the copy as its plan', () => {
    const fx = begun();
    const r = fx.run('read', SLUG);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(JSON.parse(r.lines[0]).state, 'on');
    assert.equal(readParallel(fx.root, SLUG).state, 'on');
  });

  test('a hand-written begin record naming input-fix.md is a valid record', () => {
    const fx = fixture(null);
    const begin = { v: 1, at: '2026-10-31T10:00:00Z', ev: 'begin', plan: NAME, hash: 'abcdef012345', cap: 4, mode: 'sequential', tasks: 2, ow: [] };
    fs.writeFileSync(fx.record, `${JSON.stringify(begin)}\n`);
    assert.equal(readParallel(fx.root, SLUG).state, 'on');
    assert.equal(fx.run('read', SLUG).code, 0);
  });

  test('run-guard gate reads the record: a files line with counts, not unknown', () => {
    const fx = begun();
    const r = guard(['gate', SLUG], { root: fx.root });
    assert.equal(r.code, 0);
    assert.match(r.lines[0], /^guardrail files: \d+ sibling, \d+ extra, \d+ archived, \d+ conflicts$/, r.lines[0]);
  });

  test('ledger ship writes the par line from the record, with no warning', () => {
    const fx = begun();
    fx.run('start', SLUG, 'T1');
    fx.run('done', SLUG, 'T1');
    const loadFloor = () => ({ release: '0.16.0', floor: { architect: 'opus' }, protected: ['architect'], downgraded: [], warnings: [] });
    // ledger writes under <root>/.company/ledger, so the product root is the sandbox root
    const r = ledger(['ship', SLUG, '2'], { now: NOW, root: fx.root, pluginRoot: fx.pluginRoot, loadFloor });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.lines[0], /warnings:/, r.lines[0]);
    const kinds = fs.readFileSync(path.join(fx.root, '.company', 'ledger', `${SLUG}.jsonl`), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l).kind);
    assert.deepEqual(kinds, ['meta', 'par', 'ship']);
  });
});

describe('AC3 the old plan names still pass', () => {
  for (const name of ['plan.md', '02-plan.md', '003-plan.md', 'architect-plan.md', '02-architect-plan.md', 'plan-api.md', '02-plan-v2.md']) {
    test(`${name} checks and begins`, () => {
      const fx = fixture(name);
      assert.equal(fx.run('check', SLUG, name, '--cap', '4', '--mode', 'sequential').code, 0);
      const r = fx.run('begin', SLUG, name, '--cap', '4', '--mode', 'sequential');
      assert.equal(r.code, 0, r.lines.join('\n'));
      assert.equal(events(fx)[0].plan, name);
      assert.equal(fx.run('next', SLUG).code, 0);
      assert.equal(fx.run('read', SLUG).code, 0);
    });
  }
});

describe('AC4 look-alikes exit 1 plan-name', () => {
  const lookAlikes = [
    'Input-Fix.md', 'INPUT-FIX.MD', 'input-fix.MD', 'input-Fix.md', 'input-fix.Md',
    'input-fix.md.md', 'input-fix.mdx', 'input-fix.md.', 'input-fix.md ', 'input-fix', 'input-fix.txt',
    'xinput-fix.md', 'input-fix-2.md', 'input-fix_.md', 'input_fix.md', 'input fix.md', 'input-fixmd', 'inputfix.md', 'input-fix.m',
    '-input-fix.md', '02-input-fix.md', 'input-input-fix.md', 'input-fix.md ', 'input‑fix.md',
    'input-fix.md/', 'sub/input-fix.md', '../input-fix.md', '..\\input-fix.md', './input-fix.md', '/input-fix.md', 'C:input-fix.md',
    'input-fix.md:stream', 'input-fix.md\\', '', ' input-fix.md'
  ];
  const sameFile = (a, b) => a.toLowerCase() === b.toLowerCase();

  for (const name of lookAlikes) {
    test(`${JSON.stringify(name)} is refused by check and by begin, and begins nothing`, () => {
      // Never create a case variant next to input-fix.md: on Windows it is the same file. Any other look-alike gets a
      // real file of that name where the file system allows it, so the refusal comes from the name, not a missing file.
      const fx = fixture(null);
      fs.writeFileSync(path.join(fx.dir, NAME), PLAN);
      if (name !== '' && !sameFile(name, NAME)) {
        try { fs.writeFileSync(path.join(fx.dir, name), PLAN); } catch { /* not a legal file name here */ }
      }
      const refused = { code: 1, lines: ['plan-tasks: error plan-name'] };
      assert.deepEqual(fx.run('check', SLUG, name, '--cap', '4', '--mode', 'sequential'), refused);
      assert.deepEqual(fx.run('begin', SLUG, name, '--cap', '4', '--mode', 'sequential'), refused);
      assert.equal(fs.existsSync(fx.record), false, 'no record was written');
    });
  }

  test('a case variant has no file of its own: the refusal is still plan-name', () => {
    const fx = fixture();
    for (const name of ['Input-Fix.md', 'INPUT-FIX.MD']) {
      assert.deepEqual(fx.run('check', SLUG, name, '--cap', '4', '--mode', 'sequential'), { code: 1, lines: ['plan-tasks: error plan-name'] });
    }
  });

  test('a record whose begin names a look-alike is refused on read', () => {
    for (const plan of ['Input-Fix.md', 'input-fix.md.md', 'xinput-fix.md', 'input-fix', 'sub/input-fix.md', 'notes.md']) {
      const fx = fixture(null);
      const begin = { v: 1, at: '2026-10-31T10:00:00Z', ev: 'begin', plan, hash: 'abcdef012345', cap: 4, mode: 'sequential', tasks: 2, ow: [] };
      fs.writeFileSync(fx.record, `${JSON.stringify(begin)}\n`);
      assert.throws(() => readParallel(fx.root, SLUG), ParallelRecordError, plan);
      const r = fx.run('read', SLUG);
      assert.equal(r.code, 1, plan);
    }
  });
});
