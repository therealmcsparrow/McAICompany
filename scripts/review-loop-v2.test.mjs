import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as reviewLoop from './review-loop.mjs';

// review-loop v2.0 (AC6): `mark` and `churn` are gone; `gate` has no second-reviewer check; `attempt` and `gate` stay.
const { main } = reviewLoop;
const SLUG = 'demo';
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const SCRIPT = path.join(import.meta.dirname, 'review-loop.mjs');
const saved = {};
let home;

before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'review-loop-v2-home-'));
  fs.writeFileSync(path.join(home, 'gitconfig'), '');
  const set = {
    HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, 'xdg'), MCSPARROW_HOME: path.join(home, 'mcs'),
    GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com'
  };
  for (const [k, v] of Object.entries(set)) { saved[k] = process.env[k]; process.env[k] = v; }
});
after(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(home, { recursive: true, force: true });
});

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-loop-v2-'));
  roots.push(root);
  git(root, 'init', '--quiet');
  git(root, 'checkout', '--quiet', '-b', `aico/${SLUG}`);
  fs.writeFileSync(path.join(root, 'a.txt'), Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  fs.mkdirSync(path.join(root, '.company', 'work', SLUG), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), '.company/\n');
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '--message=base');
  return { root, base: git(root, 'rev-parse', 'HEAD') };
}

const run = (root, ...args) => main(args, { root, now: NOW });
const folder = (root) => path.join(root, '.company', 'work', SLUG);
const handoff = (root, name, role, rows, extra = '') => fs.writeFileSync(path.join(folder(root), name),
  `---\nstep: 02\nrole: ${role}\ntask: ${SLUG}\nstatus: done\nround: 0\n${extra}---\nBy: t\n## Blocking\n${rows.map((r) => `- ${r}`).join('\n') || '- none'}\n## Next\n- x\n`);

describe('mark and churn are removed', () => {
  for (const cmd of ['mark', 'churn']) {
    test(`${cmd} is refused as an unknown command (exit 3) and nothing is recorded`, () => {
      const { root, base } = makeRepo();
      const r = run(root, cmd, SLUG, '0', '--base', base);
      assert.equal(r.code, 3, r.lines.join('\n'));
      assert.match(r.lines[0], /^refused: /);
      assert.equal(fs.existsSync(path.join(folder(root), 'review-loop.jsonl')), false, 'no record is written');
    });

    test(`${cmd} through the CLI exits 3`, () => {
      const { root, base } = makeRepo();
      const r = spawnSync(process.execPath, [SCRIPT, cmd, SLUG, '0', '--base', base], { cwd: root, encoding: 'utf8' });
      assert.equal(r.status, 3, r.stdout + r.stderr);
    });
  }

  test('the usage line names attempt and gate only', () => {
    const { root } = makeRepo();
    const r = run(root, 'nope');
    assert.equal(r.code, 3);
    const text = r.lines.join('\n');
    assert.match(text, /attempt/);
    assert.match(text, /gate/);
    assert.doesNotMatch(text, /\bmark\b/);
    assert.doesNotMatch(text, /\bchurn\b/);
  });

  test('gate with --base is no longer an option: it takes the slug only', () => {
    const { root, base } = makeRepo();
    assert.equal(run(root, 'gate', SLUG, '--base', base).code, 3);
  });

  test('the module no longer exports the second-reviewer helper', () => {
    assert.equal(Object.hasOwn(reviewLoop, 'bothReviewersRan'), false);
  });
});

describe('attempt and gate are kept', () => {
  test('attempt: first call retries, second call is not run', () => {
    const { root } = makeRepo();
    assert.deepEqual(run(root, 'attempt', SLUG, '05', 'qa', '0', 'crash'), { code: 0, lines: ['retry qa'] });
    assert.deepEqual(run(root, 'attempt', SLUG, '05', 'qa', '0', 'crash'), { code: 0, lines: ['not run qa round 0'] });
  });

  test('gate prints not run lines with the blocking prefix for security lanes only', () => {
    const { root } = makeRepo();
    for (const [step, role] of [['05', 'security'], ['06', 'qa']]) {
      run(root, 'attempt', SLUG, step, role, '1', 'crash');
      run(root, 'attempt', SLUG, step, role, '1', 'crash');
    }
    assert.deepEqual(run(root, 'gate', SLUG), { code: 0, lines: ['blocking: not run security round 1', 'not run qa round 1'] });
  });

  test('a clean run prints the one fixed line', () => {
    const { root } = makeRepo();
    assert.deepEqual(run(root, 'gate', SLUG), { code: 0, lines: ['review-loop: nothing to report'] });
  });
});

describe('gate has no second-reviewer check', () => {
  test('a one-sided Blocking finding next to a code-mode fresh-reviewer Handoff prints no single line', () => {
    const { root } = makeRepo();
    handoff(root, '02-code-reviewer.md', 'code-reviewer', ['R-1 a.txt:10 — x — fix']);
    handoff(root, '03-fresh-reviewer.md', 'fresh-reviewer', [], 'review-mode: code\nmodel: opus\n');
    const r = run(root, 'gate', SLUG);
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, ['review-loop: nothing to report']);
  });

  test('a one-sided finding from the fresh reviewer prints no single line either', () => {
    const { root } = makeRepo();
    handoff(root, '02-code-reviewer.md', 'code-reviewer', []);
    handoff(root, '03-fresh-reviewer.md', 'fresh-reviewer', ['R-1 a.txt:12 — x — fix'], 'review-mode: code\nmodel: opus\n');
    const r = run(root, 'gate', SLUG);
    assert.ok(!r.lines.some((l) => l.startsWith('single ')), r.lines.join('\n'));
  });

  test('a row with no location prints no single ? line', () => {
    const { root } = makeRepo();
    handoff(root, '02-code-reviewer.md', 'code-reviewer', ['R-1 the plan is vague — fix it']);
    handoff(root, '03-fresh-reviewer.md', 'fresh-reviewer', [], 'review-mode: code\nmodel: opus\n');
    const r = run(root, 'gate', SLUG);
    assert.ok(!r.lines.some((l) => l.startsWith('single ')), r.lines.join('\n'));
  });

  test('a hostile second-reviewer Handoff no longer makes the gate print single: unknown or exit 2', () => {
    const { root } = makeRepo();
    handoff(root, '02-code-reviewer.md', 'code-reviewer', []);
    fs.writeFileSync(path.join(folder(root), '03-fresh-reviewer.md'), 'x'.repeat(100000));
    const r = run(root, 'gate', SLUG);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.ok(!r.lines.some((l) => l.startsWith('single')), r.lines.join('\n'));
  });
});
