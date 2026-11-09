import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './ticket-approval.mjs';

const NOW = new Date(2026, 9, 30, 22, 42, 0).getTime();
const BASE = 'a'.repeat(40);
const ZERO = '000000000000';
const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

const block = (id) => `### ${id} title of ${id}\n- role: backend-engineer\n- files: src/${id.toLowerCase()}.mjs\n- depends-on: none\n`;
const PLAN = `# Plan: demo\n\nBase commit: ${BASE}\n\n## Tasks\n\n${block('T1')}\n${block('T2')}`;

// A flow folder named `name` holding plan.md, with T1 approved.
function flow(name, { approve = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-build-'));
  roots.push(base);
  const root = path.join(base, 'product');
  const dir = path.join(root, '.company', 'work', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plan.md'), PLAN);
  const run = (...args) => main(args, { now: NOW, root });
  assert.equal(run('tickets', name, 'plan.md', '--phase', 'd').code, 0);
  if (approve) {
    assert.equal(run('ticket', name, 'T1', 'approve').code, 0);
    assert.equal(run('ticket', name, 'S0', 'approve').code, 0);
  }
  const work = path.join(root, '.company', 'work');
  return { base, root, dir, run, work, events: () => fs.readFileSync(path.join(dir, 'tickets.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}

const NEW = '2026-10-30 22.42 - Login Idea';

describe('build plan folder name', () => {
  test('a new-name flow builds into its Build helper, no number, and prints the plan path', () => {
    const fx = flow(NEW);
    const r = fx.run('build-plan', NEW);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(r.lines[0], 'built 1 tickets');
    assert.equal(r.lines[1], `plan: .company/work/${NEW} Build/plan.md`);
    assert.ok(fs.existsSync(path.join(fx.work, `${NEW} Build`, 'plan.md')));
    assert.deepEqual(fs.readdirSync(fx.work).sort(), [NEW, `${NEW} Build`]);
    assert.equal(fx.events().at(-1).ev, 'build');
  });

  test('a second build-plan is refused, prints the same plan line and changes nothing', () => {
    const fx = flow(NEW);
    const first = fx.run('build-plan', NEW);
    const file = path.join(fx.work, `${NEW} Build`, 'plan.md');
    const text = fs.readFileSync(file, 'utf8');
    const second = fx.run('build-plan', NEW);
    assert.equal(second.code, 3);
    assert.deepEqual(second.lines, ['refused: file exists', first.lines[1]]);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
    assert.equal(fx.events().filter((e) => e.ev === 'build').length, 1);
  });

  test('a same-minute flow with a collision number builds into its own Build folder', () => {
    const fx = flow(`${NEW} 2`);
    const r = fx.run('build-plan', `${NEW} 2`);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(r.lines[1], `plan: .company/work/${NEW} 2 Build/plan.md`);
    assert.ok(fs.existsSync(path.join(fx.work, `${NEW} 2 Build`, 'plan.md')));
  });

  test('a stem at the length cap still builds', () => {
    const name = `2026-10-30 22.42 - ${'A'.repeat(60)} 2`;
    const fx = flow(name);
    const r = fx.run('build-plan', name);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(r.lines[1], `plan: .company/work/${name} Build/plan.md`);
  });

  test('a legacy flow still makes slug-build and prints its path', () => {
    const fx = flow('idea-20261030-2242');
    const r = fx.run('build-plan', 'idea-20261030-2242');
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(r.lines[1], 'plan: .company/work/idea-20261030-2242-build/plan.md');
    assert.ok(fs.existsSync(path.join(fx.work, 'idea-20261030-2242-build', 'plan.md')));
    const again = fx.run('build-plan', 'idea-20261030-2242');
    assert.deepEqual(again.lines, ['refused: file exists', r.lines[1]]);
  });

  test('a legacy build plan is still read as a plan', () => {
    const fx = flow('demo');
    fx.run('build-plan', 'demo');
    const r = fx.run('tickets', 'demo', 'demo-build/plan.md', '--phase', 'f');
    assert.deepEqual(r.lines, ['tickets 1 phase f', 'skip T1 approved', 'skip S0 approved']);
  });

  test('a new-name build plan is read as a plan and the record keeps the name', () => {
    const fx = flow(NEW);
    fx.run('build-plan', NEW);
    const r = fx.run('tickets', NEW, `${NEW} Build/plan.md`, '--phase', 'f');
    assert.deepEqual(r.lines, ['tickets 1 phase f', 'skip T1 approved', 'skip S0 approved']);
    assert.equal(fx.events().findLast((e) => e.ev === 'plan').plan, `${NEW} Build/plan.md`);
    const read = fx.run('read', NEW);
    assert.equal(read.code, 0, read.lines.join('\n'));
    assert.equal(read.lines[1], `plan ${NEW} Build/plan.md`);
  });

  test('a Build helper folder gets no helper of its own', () => {
    const name = `${NEW} Build`;
    const fx = flow(name);
    const r = fx.run('build-plan', name);
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: /);
    assert.deepEqual(fs.readdirSync(fx.work), [name]);
  });

  test('a linked Build folder is refused and nothing is written through it', (t) => {
    const fx = flow(NEW);
    const outside = path.join(fx.base, 'outside');
    fs.mkdirSync(outside);
    try {
      fs.symlinkSync(outside, path.join(fx.work, `${NEW} Build`), 'junction');
    } catch {
      t.skip('cannot create a link here');
      return;
    }
    assert.equal(fx.run('build-plan', NEW).code, 3);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
});

describe('hostile names', () => {
  const hostile = [
    "2026-10-30 22.42 - Login' Idea",
    '2026-10-30 22.42 - Login $(x)',
    '2026-10-30 22.42 - Login/Idea',
    '2026-10-30 22.42 - Login\\Idea',
    '2026-10-30 22.42 - Login Idea\nx',
    '2026-10-30 22.42 - ..',
    '2026-10-30 22.42 - login idea',
    '2026-10-30 22.42 - Login Idea Build 2',
    '2026-10-30 22.42 - Login Idea.',
    '2026-02-30 22.42 - Login Idea',
    '../outside',
    '.',
    '..'
  ];
  for (const name of hostile) {
    test(`build-plan ${JSON.stringify(name)} is refused and writes nothing`, () => {
      const fx = flow(NEW);
      const before = fs.readdirSync(fx.work).sort();
      for (const args of [['build-plan', name], ['read', name], ['tickets', name, 'plan.md', '--phase', 'f'], ['ticket', name, 'T1', 'approve']]) {
        const r = fx.run(...args);
        assert.equal(r.code, 3, `${args[0]}: ${r.lines.join('|')}`);
      }
      assert.deepEqual(fs.readdirSync(fx.work).sort(), before);
    });
  }

  test('a plan argument with a bad folder name is refused', () => {
    const fx = flow(NEW);
    for (const arg of [`../x/plan.md`, `${NEW}/../plan.md`, `${NEW}/plan.md/`, `login idea/plan.md`, `${NEW}/sub/plan.md`, `${NEW}\\plan.md`]) {
      assert.equal(fx.run('tickets', NEW, arg, '--phase', 'f').code, 3, arg);
    }
  });

  test('a forged plan event naming a bad folder breaks the record', () => {
    const fx = flow(NEW);
    const file = path.join(fx.dir, 'tickets.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const first = JSON.parse(lines[0]);
    first.plan = "x' y/plan.md";
    fs.writeFileSync(file, `${JSON.stringify(first)}\n`);
    const r = fx.run('read', NEW);
    assert.equal(r.code, 1);
    assert.match(r.lines[0], /bad plan|chain broken/);
    assert.equal(ZERO.length, 12);
  });
});

describe('shell use of the printed path', () => {
  test('the single-quoted plan path is one shell word and names the file', () => {
    const fx = flow(NEW);
    const r = fx.run('build-plan', NEW);
    const printed = r.lines[1].slice('plan: '.length);
    const sh = spawnSync('bash', ['-c', `test -f '${printed}' && printf '%s' '${printed}'`], { cwd: fx.root, encoding: 'utf8' });
    assert.equal(sh.error, undefined, 'bash is required');
    assert.equal(sh.status, 0, sh.stderr);
    assert.equal(sh.stdout, printed);
  });
});

describe('skill text', () => {
  const routes = read('skills/idea/references/routes.md');
  const fix = read('skills/fix/SKILL.md');
  const f = routes.slice(routes.indexOf('## Route F'), routes.indexOf('## Route G'));

  test('Route F uses only the printed plan path, single-quoted', () => {
    assert.ok(f.includes('plan: <path>'));
    assert.doesNotMatch(f, /<slug>-build|-build\//);
    assert.match(f, /done '<name>' build --out '<path>'/);
    assert.match(f, /Skill tool[^\n]*'<path>'/);
    assert.doesNotMatch(f, /\.company\/work\/<slug>/);
  });

  test('Capture step 2 reads the Folder paragraph, not a dated slug', () => {
    const cap = routes.slice(routes.indexOf('## Capture'), routes.indexOf('## Forms'));
    assert.doesNotMatch(cap, /YYYYMMDD-HHMM|append `-2` to `-9`/);
    assert.match(cap, /\*\*Folder:\*\*/);
    assert.match(routes, /`ticket-approval` v1\.1/);
  });

  test('the fix Playbook takes a spaced plan path and drops the one-token wording', () => {
    assert.doesNotMatch(fix, /one token with no whitespace|draft-input` v1\.1/);
    assert.match(fix, /\.company\/work\/<name>\/plan\.md/);
    assert.match(fix, /draft-input` v1\.2/);
    assert.match(fix, /take '<path>' --for fix/);
    assert.ok(fix.split('\n').length <= 125);
  });

  test('the contract is v1.5 and names the helper rule', () => {
    const c = read('docs/contracts/ticket-approval.md');
    assert.match(c, /^# Contract: ticket-approval v1\.5/);
    assert.match(c, /helperName/);
    assert.match(c, /plan: <path>/);
    assert.match(read('scripts/ticket-approval.mjs'), /ticket-approval\.md v1\.5/);
  });

  test('no CR byte in the touched text files', () => {
    for (const p of ['skills/idea/references/routes.md', 'skills/fix/SKILL.md', 'docs/contracts/ticket-approval.md', 'scripts/ticket-approval.mjs', 'scripts/work-folder-build.test.mjs']) {
      assert.equal(read(p).includes('\r'), false, p);
    }
  });
});
