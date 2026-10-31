import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main as planReview } from './plan-review.mjs';
import { main as reviewLoop, readReviewLoop } from './review-loop.mjs';
import { branchId } from '../mods/lib/work-folder.mjs';

const NAME = '2026-10-30 22.42 - Cache Warmup';
const ID = '2026-10-30-2242-cache-warmup';
const LEGACY = 'demo';
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const BAD = [
  'Cache Warmup',
  '2026-10-30 22.42 - cache warmup',
  '2026-13-30 22.42 - Cache Warmup',
  '2026-10-30 22.42 - Cache Warmup ',
  '2026-10-30 22.42 - Cache Warmup\n',
  '2026-10-30 22.42 - Cache‮Warmup',
  `2026-10-30 22.42 - Cache${"'"}Warmup`,
  '2026-10-30 22.42 - $(touch x)',
  '../2026-10-30 22.42 - Cache Warmup',
  '2026-10-30 22.42 - Cache Warmup/..',
  'Demo',
  '',
  'a'.repeat(200),
];

const saved = {};
let home;
const roots = [];

// Per-test home and git config, so no test reads the user's own.
before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-loop-home-'));
  fs.writeFileSync(path.join(home, 'gitconfig'), '');
  const set = {
    HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, 'xdg'), MCSPARROW_HOME: path.join(home, 'mcs'),
    GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
  };
  for (const [k, v] of Object.entries(set)) { saved[k] = process.env[k]; process.env[k] = v; }
});
after(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(home, { recursive: true, force: true });
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function makeRepo(slug, branch) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-loop-'));
  roots.push(root);
  git(root, 'init', '--quiet');
  git(root, 'checkout', '--quiet', '-b', branch);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  fs.mkdirSync(path.join(root, '.company', 'work', slug), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), '.company/\n');
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '--message=base');
  return { root, base: git(root, 'rev-parse', 'HEAD') };
}

const runDir = (root, slug) => path.join(root, '.company', 'work', slug);

describe('plan-review run names', () => {
  function planRepo(slug) {
    const { root } = makeRepo(slug, 'main');
    fs.writeFileSync(path.join(runDir(root, slug), 'plan.md'), '# Plan\n- files: a.txt\n');
    fs.writeFileSync(path.join(runDir(root, slug), '01-architect.md'), '---\nrole: architect\n---\n');
    return root;
  }

  for (const slug of [NAME, LEGACY]) {
    test(`lines accepts ${slug}`, () => {
      const root = planRepo(slug);
      const r = planReview(['lines', slug, 'plan.md', '--mode', 'plan', '--after', '01-architect.md'], { root });
      assert.equal(r.code, 0, r.lines.join('\n'));
      assert.ok(r.lines.includes(`Review inputs: .company/work/${slug}/plan-review/inputs.md`));
      const body = fs.readFileSync(path.join(runDir(root, slug), 'plan-review', 'inputs.md'), 'utf8');
      assert.ok(body.includes(`.company/work/${slug}/plan.md`));
      assert.ok(body.includes('a.txt'));
    });
  }

  test('gate accepts a new name', () => {
    const root = planRepo(NAME);
    fs.writeFileSync(path.join(runDir(root, NAME), '02-fresh-reviewer.md'),
      '---\nrole: fresh-reviewer\n---\n## Paraphrase\nit does x\n## First pass\n- R-1 a\n## Blocking\n- none\n');
    const r = planReview(['gate', NAME, '02-fresh-reviewer.md'], { root });
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.deepEqual(r.lines, ['paraphrase:', '> it does x', 'first pass: 1 findings']);
  });

  for (const bad of BAD) {
    test(`refuses ${JSON.stringify(bad).slice(0, 40)} without echo`, () => {
      const root = planRepo(NAME);
      for (const args of [
        ['lines', bad, 'plan.md', '--mode', 'plan', '--after', '01-architect.md'],
        ['gate', bad, '01-architect.md'],
      ]) {
        const r = planReview(args, { root });
        assert.equal(r.code, 3);
        assert.equal(r.lines.length, 1);
        assert.match(r.lines[0], /^refused: (bad slug|argument holds a control character)$/);
      }
    });
  }

  test('case names keep their own pattern', () => {
    const { root } = makeRepo(LEGACY, 'main');
    const cases = path.join(root, 'cases');
    const results = path.join(root, 'results');
    fs.mkdirSync(path.join(cases, 'one'), { recursive: true });
    fs.mkdirSync(path.join(cases, NAME), { recursive: true });
    fs.mkdirSync(results);
    fs.writeFileSync(path.join(cases, 'one', 'plan.md'), 'x\n');
    fs.writeFileSync(path.join(cases, 'one', 'expected.json'), '{"v":1,"control":true}');
    const r = planReview(['score', 'cases', 'results'], { root });
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.deepEqual(r.lines, ['control one missing', 'caught 0 of 0']);
  });
});

describe('review-loop run names', () => {
  const run = (root, ...args) => reviewLoop(args, { root, now: NOW });

  test('branch id is the one the run ref uses', () => {
    assert.equal(branchId(NAME), ID);
    assert.equal(branchId(LEGACY), LEGACY);
  });

  test('attempt and readReviewLoop take a new name', () => {
    const { root } = makeRepo(NAME, `aico/${ID}`);
    assert.deepEqual(run(root, 'attempt', NAME, '05', 'qa', '0', 'crash'), { code: 0, lines: ['retry qa'] });
    const events = readReviewLoop(root, NAME);
    assert.equal(events.length, 1);
    assert.ok(fs.existsSync(path.join(runDir(root, NAME), 'review-loop.jsonl')));
  });

  test('mark and churn use refs/heads/aico/<branch id>', () => {
    const { root, base } = makeRepo(NAME, `aico/${ID}`);
    const m = run(root, 'mark', NAME, '1', '--base', base);
    assert.equal(m.code, 0, m.lines.join('\n'));
    const c = run(root, 'churn', NAME, '1', '--base', base);
    assert.deepEqual(c.lines, ['churn: none']);
    assert.equal(c.code, 0);
    assert.equal(run(root, 'gate', NAME, '--base', base).code, 0);
  });

  test('mark on a new name refuses when HEAD is another branch', () => {
    const { root, base } = makeRepo(NAME, 'aico/other');
    const m = run(root, 'mark', NAME, '1', '--base', base);
    assert.equal(m.code, 3);
    assert.deepEqual(m.lines, [`refused: HEAD is not refs/heads/aico/${ID}`]);
    assert.equal(fs.existsSync(path.join(runDir(root, NAME), 'review-loop.jsonl')), false);
  });

  test('legacy slug keeps refs/heads/aico/<slug>', () => {
    const { root, base } = makeRepo(LEGACY, `aico/${LEGACY}`);
    const m = run(root, 'mark', LEGACY, '0', '--base', base);
    assert.equal(m.code, 0, m.lines.join('\n'));
  });

  for (const bad of BAD) {
    test(`refuses ${JSON.stringify(bad).slice(0, 40)} without echo`, () => {
      const { root, base } = makeRepo(NAME, `aico/${ID}`);
      for (const args of [
        ['attempt', bad, '05', 'qa', '0', 'crash'],
        ['mark', bad, '0', '--base', base],
        ['churn', bad, '0', '--base', base],
        ['gate', bad],
      ]) {
        const r = run(root, ...args);
        assert.equal(r.code, 3);
        assert.equal(r.lines.length, 1, `${JSON.stringify(args)} ${r.lines}`);
        assert.match(r.lines[0], /^refused: (slug must be a work folder name|argument holds a control character)$/, JSON.stringify(args));
      }
      assert.throws(() => readReviewLoop(root, bad), TypeError);
    });
  }
});
