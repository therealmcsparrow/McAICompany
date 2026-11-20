import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// step-close v1.0 (T13 QA; plan tasks T25, T26): one command runs lint, scope, commit, ledger, done and next in the
// Contract's Order and prints one block. Driven through the CLI on a temp git repo; no production file is read but the script.
// The plan-tasks record is written as lines (begin, start) because the record is what step-close reads, never what it writes.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'step-close.mjs');
const REPO = path.resolve(HERE, '..');
const HANDOFF_V = /^# Contract: (handoff v\d+\.\d+)/.exec(fs.readFileSync(path.join(REPO, 'docs', 'contracts', 'handoff.md'), 'utf8'))[1];

const ID = 'P20261120.000090';
const SLUG = `${ID}/01-feature`;
const KEY = `${ID}~01-feature`;
const T1 = `${ID}-T1`;
const T2 = `${ID}-T2`;
const BASE = '079d7863b895c7359738a05977681fdbc33b4997';
const MSG = 'test: close the step';

const temps = [];
after(() => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

function env(home, extra = {}) {
  const gcfg = path.join(home, 'gitconfig');
  if (!fs.existsSync(gcfg)) fs.writeFileSync(gcfg, '');
  return {
    ...process.env, MCSPARROW_HOME: home, GIT_CONFIG_GLOBAL: gcfg, GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid', ...extra
  };
}

function git(root, home, ...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: env(home) });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

const handoff = ({ task = SLUG, role = 'qa', step = '05', touched = [], did = '- x', status = 'done' } = {}) => `---
step: ${step}
role: ${role}
task: ${task}
status: ${status}
round: 0
base-commit: ${BASE}
risk-tier: high
acceptance-ids: [AC1]
files-touched: [${touched.join(', ')}]
contracts: [${HANDOFF_V}]
---
By: ${role}
## Did
${did}
## Decisions
- y
## Blocking
- none
## Nits
- none
## Next
- z
`;

const PLAN = `# Plan

## Tasks

### ${T1} first
- role: backend-engineer
- files: src/a.txt
- depends-on: none
- parallel: yes

### ${T2} second
- role: backend-engineer
- files: src/b.txt
- depends-on: none
- parallel: yes
`;

// A repo with one commit holding src/{a,b,free,clean}.txt; the working tree changes src/{a,b,free}.txt and adds a Handoff.
function fixture({ running = [], withRecord = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'step-close-'));
  temps.push(base);
  const root = path.join(base, 'repo');
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const f of ['a', 'b', 'free', 'clean']) fs.writeFileSync(path.join(root, 'src', `${f}.txt`), `${f}\n`);
  git(root, home, 'init', '-q');
  git(root, home, 'add', '-A');
  git(root, home, 'commit', '-q', '-m', 'init');
  for (const f of ['a', 'b', 'free']) fs.writeFileSync(path.join(root, 'src', `${f}.txt`), `${f} changed\n`);
  const dir = path.join(root, '.company', 'work', ...SLUG.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '..', '00-project.md'), 'A demo project\n');
  if (withRecord) {
    const bytes = Buffer.from(PLAN);
    fs.writeFileSync(path.join(dir, '02-plan.md'), bytes);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    const at = '2026-11-20T10:00:00Z';
    const lines = [{ v: 1, at, ev: 'begin', plan: '02-plan.md', hash, cap: 3, mode: 'parallel', tasks: 2, ow: [] }];
    for (const task of running) lines.push({ v: 1, at, ev: 'start', task, round: 0, ow: [] });
    fs.writeFileSync(path.join(dir, 'parallel.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  }
  const ledger = path.join(root, '.company', 'ledger', `${KEY}.jsonl`);
  const run = ({ step = '05', role = 'qa', text, args = [], handoffRel } = {}) => {
    const rel = handoffRel ?? `.company/work/${SLUG}/${step}-${role}.md`;
    if (text !== undefined) fs.writeFileSync(path.join(root, ...rel.split('/')), text);
    const r = spawnSync(process.execPath, [SCRIPT, SLUG, step, role, '--handoff', rel, '--msg', MSG, ...args], { cwd: root, encoding: 'utf8', env: env(home) });
    return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
  };
  const head = () => git(root, home, 'rev-parse', 'HEAD').trim();
  const count = () => Number(git(root, home, 'rev-list', '--count', 'HEAD').trim());
  const committed = () => git(root, home, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
  const hookRow = (over = {}) => {
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    const row = { v: 1, run: SLUG, kind: 'step', id: '05', role: 'qa', agent: 'a1', source: 'hook', ctx_end: 1000, t1: '2026-11-20T10:00:00Z', ...over };
    fs.appendFileSync(ledger, `${JSON.stringify(row)}\n`);
  };
  const rows = () => (fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).length : 0);
  return { root, home, dir, run, head, count, committed, hookRow, rows, ledger };
}

const FIRST = /^step-close: 05 qa lint ok, commit [0-9a-f]{7,40}, (\d+) paths, (\d+) dropped, ledger (hook|added|missing)$/;

test('happy path: Handoff and files-touched are committed with --msg, first line follows the Output contract, ledger missing', () => {
  const f = fixture();
  const before = f.count();
  const r = f.run({ text: handoff({ touched: ['src/free.txt'] }) });
  assert.equal(r.code, 0, r.all);
  const m = FIRST.exec(r.out.split('\n')[0]);
  assert.ok(m, r.out);
  assert.equal(m[1], '2');
  assert.equal(m[2], '0');
  assert.equal(m[3], 'missing');
  assert.equal(f.count(), before + 1);
  assert.equal(git(f.root, f.home, 'log', '-1', '--format=%s').trim(), MSG);
  assert.deepEqual(f.committed().sort(), [`.company/work/${SLUG}/05-qa.md`, 'src/free.txt'].sort());
  assert.equal(f.rows(), 0, 'no ledger row without --usage and without a hook row');
});

test('commit candidates are the Handoff and files-touched only: a path named only in ## Did is not committed', () => {
  const f = fixture();
  const r = f.run({ text: handoff({ touched: ['src/free.txt'], did: '- edited src/a.txt and src/b.txt too' }) });
  assert.equal(r.code, 0, r.all);
  const files = f.committed();
  assert.ok(files.includes('src/free.txt'));
  assert.ok(!files.includes('src/a.txt'), files.join());
  assert.ok(!files.includes('src/b.txt'), files.join());
  assert.match(git(f.root, f.home, 'status', '--porcelain'), / M src\/a\.txt/, 'the Did-only path stays uncommitted');
});

test('lint failure: exit 1, "step-close: lint failed", nothing committed, no ledger row even with --usage', () => {
  const f = fixture();
  const before = f.head();
  const r = f.run({ text: 'not a handoff\n', args: ['--usage', '1000,3,500'] });
  assert.equal(r.code, 1, r.all);
  assert.match(r.out, /step-close: lint failed/);
  assert.equal(f.head(), before);
  assert.equal(f.rows(), 0);
  assert.ok(!/ledger (hook|added|missing)/.test(r.out), 'a stage that did not run prints nothing');
});

test('scope failure with --task (task not running): exit 1, "step-close: scope failed", nothing committed, no ledger row', () => {
  const f = fixture({ running: [], withRecord: true });
  const before = f.head();
  const r = f.run({ text: handoff({ task: SLUG, touched: ['src/a.txt'] }), args: ['--task', T1, '--usage', '1000,3,500'] });
  assert.equal(r.code, 1, r.all);
  assert.match(r.out, /step-close: scope failed/);
  assert.equal(f.head(), before);
  assert.equal(f.rows(), 0, 'a scope failure never leaves a ledger row');
});

test('without --task, an unreadable plan-tasks record fails closed: scope failed, nothing committed', () => {
  const f = fixture({ running: [T1], withRecord: true });
  fs.writeFileSync(path.join(f.dir, 'parallel.jsonl'), 'this is not json\n');
  const before = f.head();
  const r = f.run({ text: handoff({ touched: ['src/free.txt'] }), args: ['--usage', '1000,3,500'] });
  assert.equal(r.code, 1, r.all);
  assert.match(r.out, /step-close: scope failed/);
  assert.equal(f.head(), before);
  assert.equal(f.rows(), 0);
});

test('without --task, a path in a running task\'s set is dropped and the rest is committed', () => {
  const f = fixture({ running: [T1], withRecord: true });
  const r = f.run({ text: handoff({ touched: ['src/a.txt', 'src/free.txt'] }) });
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, new RegExp(`^dropped: src/a\\.txt \\(task ${T1}\\)$`, 'm'));
  const files = f.committed();
  assert.ok(!files.includes('src/a.txt'), files.join());
  assert.ok(files.includes('src/free.txt'));
  assert.match(r.out.split('\n')[0], /, 1 dropped, /);
});

test('with --task, a sibling running task\'s path is dropped and the own path is committed', () => {
  const f = fixture({ running: [T1, T2], withRecord: true });
  const r = f.run({ text: handoff({ task: SLUG, touched: ['src/a.txt', 'src/b.txt'] }), args: ['--task', T1] });
  assert.match(r.out, new RegExp(`^dropped: src/b\\.txt \\(task ${T2}\\)$`, 'm'), r.all);
  const files = f.committed();
  assert.ok(files.includes('src/a.txt'), files.join());
  assert.ok(!files.includes('src/b.txt'), files.join());
});

test('a hook row (source hook, same step and role) prints "ledger: hook" and --usage adds no row', () => {
  const f = fixture();
  f.hookRow();
  const r = f.run({ text: handoff({ touched: ['src/free.txt'] }), args: ['--usage', '1000,3,500'] });
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /^ledger: hook$/m);
  assert.match(r.out.split('\n')[0], /ledger hook$/);
  assert.equal(f.rows(), 1, 'the hook row stays the only row');
});

test('a hook row of another role or another step does not count: ledger missing without --usage', () => {
  const f = fixture();
  f.hookRow({ role: 'backend-engineer' });
  f.hookRow({ id: '06' });
  const r = f.run({ text: handoff({ touched: ['src/free.txt'] }) });
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /^ledger: missing$/m);
  assert.equal(f.rows(), 2);
});

test('a row with source other than hook does not count either', () => {
  const f = fixture();
  f.hookRow({ source: 'notification' });
  const r = f.run({ text: handoff({ touched: ['src/free.txt'] }) });
  assert.match(r.out, /^ledger: missing$/m, r.all);
});

test('--usage with no hook row adds the row and prints "ledger: added"', () => {
  const f = fixture();
  const r = f.run({ text: handoff({ touched: ['src/free.txt'] }), args: ['--usage', '1000,3,500'] });
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /^ledger: added$/m);
  assert.equal(f.rows(), 1);
  const row = JSON.parse(fs.readFileSync(f.ledger, 'utf8').trim());
  assert.equal(row.id, '05');
  assert.equal(row.role, 'qa');
  assert.equal(row.ctx_end, 1000);
});

test('the ledger runs after the commit: the Handoff is committed even though the row is only added after', () => {
  const f = fixture();
  const r = f.run({ text: handoff(), args: ['--usage', '1000,3,500'] });
  assert.equal(r.code, 0, r.all);
  assert.ok(f.committed().includes(`.company/work/${SLUG}/05-qa.md`));
});

test('candidates failing the commit rules are dropped, never committed: .env, a parent path, an unchanged file', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, '.env'), 'SECRET=1\n');
  const r = f.run({ text: handoff({ touched: ['.env', '../outside.txt', 'src/clean.txt', 'src/free.txt'] }) });
  assert.equal(r.code, 0, r.all);
  const files = f.committed();
  assert.deepEqual(files.sort(), [`.company/work/${SLUG}/05-qa.md`, 'src/free.txt'].sort());
  assert.equal((r.out.match(/^dropped: /gm) ?? []).length, 3, r.out);
  assert.match(r.out, /^dropped: src\/clean\.txt$/m);
  assert.match(r.out.split('\n')[0], /, 3 dropped, /);
});

test('refused arguments exit 2 and run nothing: bad --msg, unknown role, Handoff path not exact', () => {
  const f = fixture();
  const before = f.head();
  const bad = [
    { args: [], msg: 'fix stuff' },
    { args: [], msg: 'test: $(rm -rf x)' },
    { args: [], msg: 'test: ' + 'x'.repeat(80) }
  ];
  for (const b of bad) {
    fs.writeFileSync(path.join(f.root, '.company', 'work', ...SLUG.split('/'), '05-qa.md'), handoff());
    const r = spawnSync(process.execPath, [SCRIPT, SLUG, '05', 'qa', '--handoff', `.company/work/${SLUG}/05-qa.md`, '--msg', b.msg], { cwd: f.root, encoding: 'utf8', env: env(f.home) });
    assert.equal(r.status, 2, `${b.msg}: ${r.stdout}${r.stderr}`);
  }
  const noRole = f.run({ role: 'no-such-role', text: handoff({ role: 'qa' }) });
  assert.equal(noRole.code, 2, noRole.all);
  const wrongPath = f.run({ handoffRel: `.company/work/${SLUG}/../05-qa.md`, text: undefined });
  assert.equal(wrongPath.code, 2, wrongPath.all);
  assert.equal(f.head(), before);
  assert.equal(f.rows(), 0);
});
