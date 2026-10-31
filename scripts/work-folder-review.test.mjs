import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { branchId } from '../mods/lib/work-folder.mjs';
import { main as citedMain } from './cited.mjs';

const root = path.join(import.meta.dirname, '..');
const ruleCheck = path.join(import.meta.dirname, 'rule-check.mjs');
const reviewDepth = path.join(import.meta.dirname, 'review-depth.mjs');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wfr-home-'));
const tmpDirs = [HOME];
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const ENV = () => {
  const e = { ...process.env, HOME, USERPROFILE: HOME, MCSPARROW_HOME: path.join(HOME, 'mcs'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(HOME, 'none') };
  delete e.NODE_TEST_CONTEXT;
  return e;
};

const NEW_NAME = '2026-10-30 22.42 - Build Draft Flow';
const LEGACY = 'idea-20261030-2242-build-draft';

// A repo whose HEAD sits on refs/heads/aico/<branch> after one commit past the base.
function repo(branch) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wfr-'));
  tmpDirs.push(d);
  const g = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8', env: ENV() });
  g('init', '-q', '--initial-branch=main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.excludesFile', os.devNull);
  fs.mkdirSync(path.join(d, '.company'));
  fs.writeFileSync(path.join(d, '.company/project.md'), '# P\n\n## Core\n- skills/pipeline: wiring\n\n## Modules\n- (none yet)\n');
  fs.writeFileSync(path.join(d, 'a.txt'), 'a\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  const base = g('rev-parse', 'HEAD').stdout.trim();
  g('checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(d, 'b.txt'), 'b\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'work');
  return { d, base };
}

const node = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: ENV() });

describe('run ref from the branch id', () => {
  it('branchId of a new name starts the ref after aico/', () => {
    assert.equal(branchId(NEW_NAME), '2026-10-30-2242-build-draft-flow');
  });

  for (const [label, name] of [['new name', NEW_NAME], ['legacy slug', LEGACY]]) {
    it(`review-depth accepts ${label} on its branch`, () => {
      const { d, base } = repo(`aico/${branchId(name)}`);
      const r = node(reviewDepth, [base, '--run', name, '--risk', 'low'], d);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.stdout, 'standard\n');
    });

    it(`review-depth gives full when ${label} is not the head`, () => {
      const { d, base } = repo('aico/other');
      const r = node(reviewDepth, [base, '--run', name, '--risk', 'low'], d);
      assert.match(r.stdout, /^full\nreason: head not on run branch\n$/);
    });

    it(`rule-check text accepts ${label} on its branch`, () => {
      const { d, base } = repo(`aico/${branchId(name)}`);
      const r = node(ruleCheck, ['text', '--base', base, '--run', name], d);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /no binary-marked text files/);
    });

    it(`rule-check text refuses ${label} when the head is elsewhere`, () => {
      const { d, base } = repo('aico/other');
      const r = node(ruleCheck, ['text', '--base', base, '--run', name], d);
      assert.equal(r.status, 3);
      assert.match(r.stdout, /refused: head not on run branch/);
    });
  }

  it('the literal new name is never the branch', () => {
    const { d, base } = repo(`aico/${NEW_NAME.replaceAll(' ', '_')}`);
    const r = node(reviewDepth, [base, '--run', NEW_NAME, '--risk', 'low'], d);
    assert.match(r.stdout, /head not on run branch/);
  });
});

describe('hostile run names are refused before git runs', () => {
  const BAD = [
    '', ' ', '..', '../x', 'a/b', '-x', '--run', 'a b', 'A', 'x\n', "x'y", 'x$(id)', 'x`id`', 'x;id', 'x‮y', 'é',
    '2026-10-30 22.42 - Build', '2026-10-30 22.42 - Foo Build 2', '2026-10-30 22.42 - foo', '2026-10-30 22.42 -  Foo',
    '2026-13-30 22.42 - Foo', '2026-10-30 22.42 - Foo ', ' 2026-10-30 22.42 - Foo', '2026-10-30 22.42 - Foo\r', 'a'.repeat(200),
    `2026-10-30 22.42 - ${'Word '.repeat(30)}`
  ];
  for (const name of BAD) {
    it(`refuses ${JSON.stringify(name).slice(0, 40)}`, () => {
      const { d, base } = repo('aico/other');
      const a = node(reviewDepth, [base, '--run', name], d);
      assert.equal(a.status, 2, a.stdout);
      assert.match(a.stdout, /^refused: /);
      const b = node(ruleCheck, ['text', '--base', base, '--run', name], d);
      assert.equal(b.status, 3, b.stdout);
      assert.match(b.stdout, /^refused: bad run/);
    });
  }
});

describe('cited report lists new and legacy folders', () => {
  it('counts both and skips other names', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wfr-cited-'));
    tmpDirs.push(d);
    const agents = path.join(d, 'agents');
    fs.mkdirSync(agents);
    for (const r of ['product-manager', 'architect']) fs.writeFileSync(path.join(agents, `${r}.md`), '---\nname: x\n---\n');
    const work = path.join(d, '.company', 'work');
    const names = [NEW_NAME, LEGACY, 'Not A Run', '2026-10-30 22.42 - Build', 'UPPER'];
    for (const n of names) {
      fs.mkdirSync(path.join(work, n), { recursive: true });
      fs.writeFileSync(path.join(work, n, '01-product-manager.md'), 'x\n');
      fs.writeFileSync(path.join(work, n, '02-architect.md'), 'Reads 01-product-manager.\n');
    }
    const r = citedMain(['report', '--runs', '10'], { root: d, agentsDir: agents });
    assert.equal(r.code, 0);
    assert.equal(r.lines[0], 'cited-report: runs 2');
    assert.ok(r.lines.includes('cited product-manager: 2 of 2'), r.lines.join('\n'));
  });
});

describe('agent and skill text', () => {
  const lines = [['agents/code-reviewer.md', 16], ['agents/security.md', 16], ['agents/senior-engineer.md', 19]];
  for (const [file, n] of lines) {
    it(`${file}:${n} quotes the run value`, () => {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      assert.ok(!text.includes('\r'));
      const all = text.split('\n');
      assert.ok(all.length <= 51, `${file} has ${all.length} lines`);
      const line = all[n - 1];
      assert.ok(line.includes("rule-check.mjs run --base <Base commit> --run '<slug>'"), line);
      assert.ok(line.includes("rule-check.mjs text --base <Base commit> --run '<slug>'"), line);
      assert.ok(!/--run <slug>/.test(line));
    });
  }

  it('review skill names refs/heads/ plus the printed branch value, as is', () => {
    const text = fs.readFileSync(path.join(root, 'skills/review/SKILL.md'), 'utf8');
    assert.ok(!text.includes('\r'));
    assert.ok(text.split('\n').length <= 126);
    assert.ok(text.includes("work-folder.mjs branch '<run>'"));
    assert.ok(text.includes('`refs/heads/` plus the `branch:` value'));
    assert.ok(text.includes('never prefix `aico/` again'));
    assert.ok(!text.includes('refs/heads/aico/<slug>'));
  });
});
