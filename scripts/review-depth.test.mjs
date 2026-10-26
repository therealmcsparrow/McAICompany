import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { classify } from './review-depth.mjs';

const script = path.join(import.meta.dirname, 'review-depth.mjs');
const CORE = ['skills/handoff', 'scripts/check.mjs'];

test('classify: plain source is standard', () => {
  assert.equal(classify(['src/util.mjs', 'README.md'], { core: CORE, risk: 'low' }).depth, 'standard');
});

test('classify: risk high forces full', () => {
  assert.equal(classify(['src/util.mjs'], { core: CORE, risk: 'high' }).depth, 'full');
});

test('classify: core file and core folder', () => {
  assert.equal(classify(['scripts/check.mjs'], { core: CORE }).depth, 'full');
  assert.equal(classify(['skills/handoff/SKILL.md'], { core: CORE }).depth, 'full');
  assert.equal(classify(['skills/handoffs/x.md'], { core: CORE }).depth, 'standard');
  assert.equal(classify(['scripts/check.mjs.bak'], { core: CORE }).depth, 'standard');
});

test('classify: contract paths', () => {
  for (const p of ['docs/contracts/x.md', 'a/contracts/y.ts', 'api/x.proto', 'openapi.yaml', 'a/asyncapi.json']) {
    assert.equal(classify([p], { core: [] }).depth, 'full', p);
  }
});

test('classify: security paths', () => {
  for (const p of ['src/auth.ts', 'src/Login/view.ts', 'lib/session-store.js', 'db/migrations/001.sql',
    '.github/workflows/ci.yml', 'agents/x.md', '.company/standards.md', '.company/standards/a.md',
    '.company/checks.json', '.company/settings.json', 'package.json', 'sub/package-lock.json', 'deps/a.txt',
    'src/payments/x.ts', 'src/permissions.ts', 'src/secret.ts', 'src/crypto.ts']) {
    assert.equal(classify([p], { core: [] }).depth, 'full', p);
  }
  assert.equal(classify(['agents/sub/x.txt'], { core: [] }).depth, 'standard');
});

test('classify: reasons list only the forcing paths', () => {
  const r = classify(['src/a.mjs', 'src/auth.mjs'], { core: [] });
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0], /^reason: src\/auth\.mjs — /);
});

function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-'));
  const g = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' });
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(d, '.company'));
  fs.writeFileSync(path.join(d, '.company/project.md'), '# P\n\n## Core\n<!-- c -->\n- skills/pipeline: wiring\n- scripts/check.mjs: gate\n\n## Modules\n- (none yet)\n');
  fs.writeFileSync(path.join(d, 'a.txt'), 'a\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  const base = g('rev-parse', 'HEAD').stdout.trim();
  const commit = (file) => {
    fs.mkdirSync(path.dirname(path.join(d, file)), { recursive: true });
    fs.writeFileSync(path.join(d, file), 'x\n');
    g('add', '-A');
    g('commit', '-q', '-m', 'c');
  };
  return { d, base, commit };
}
const run = (d, args) => spawnSync('node', [script, ...args], { cwd: d, encoding: 'utf8' });

test('cli: standard for a plain diff', () => {
  const { d, base, commit } = repo();
  commit('src/util.mjs');
  const r = run(d, [base]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'standard\n');
});

test('cli: full with reason for a core path read from project.md', () => {
  const { d, base, commit } = repo();
  commit('skills/pipeline/SKILL.md');
  const r = run(d, [base]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.split('\n')[0], 'full');
  assert.match(r.stdout, /reason: skills\/pipeline\/SKILL\.md — core/);
});

test('cli: path with spaces is handled whole', () => {
  const { d, base, commit } = repo();
  commit('my docs/login page.md');
  assert.match(run(d, [base]).stdout, /reason: my docs\/login page\.md — /);
});

test('cli: --risk high forces full', () => {
  const { d, base, commit } = repo();
  commit('src/util.mjs');
  assert.equal(run(d, [base, '--risk', 'high']).stdout.split('\n')[0], 'full');
});

test('cli: refuses bad sha and bad risk with exit 2', () => {
  const { d, base } = repo();
  for (const args of [['zzzz'], ['HEAD; rm -rf'], [base, '--risk', 'extreme'], [base, '--risk'], []]) {
    const r = run(d, args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stdout, /^refused: /);
  }
});

test('cli: unreadable diff is full with diff unavailable', () => {
  const { d } = repo();
  const r = run(d, ['deadbeef']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'full\nreason: diff unavailable\n');
});

test('no CR bytes in output or source', () => {
  const { d, base, commit } = repo();
  commit('src/auth.mjs');
  assert.ok(!run(d, [base]).stdout.includes('\r'));
  assert.ok(!fs.readFileSync(script, 'utf8').includes('\r'));
});
