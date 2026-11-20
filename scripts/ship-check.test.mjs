import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ship-check v1.0 (T13 QA; plan task T27): one command runs every Ship Gate check in a fixed order and prints one block.
// The script is copied, with its relative imports, into a temp plugin tree whose sibling check scripts are stubs. Each stub
// answers from stub.json and logs its argv to calls.log, so the tests pin what ship-check asks and how it reads the answers,
// never what the real siblings print. The tree check runs against a real temp git repo.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const STUBBED = ['handoff-lint', 'rule-check', 'ledger', 'worktree', 'run-guard', 'lead-handover', 'review-loop', 'tier-set', 'route'];

const ID = 'P20261120.000091';
const SLUG = `${ID}/01-feature`;
const BRANCH = `aico/${ID}`;

const temps = [];
after(() => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

// Copies a script and the files it imports through relative specifiers (never a stubbed sibling).
function copyClosure(rel, to, seen = new Set()) {
  const abs = path.join(REPO, rel);
  if (seen.has(abs)) return;
  seen.add(abs);
  const dest = path.join(to, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const text = fs.readFileSync(abs, 'utf8');
  fs.writeFileSync(dest, text);
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const next = path.relative(REPO, path.resolve(path.dirname(abs), m[1])).split(path.sep).join('/');
    if (STUBBED.some((s) => next === `scripts/${s}.mjs`)) continue;
    if (fs.existsSync(path.join(REPO, next))) copyClosure(next, to, seen);
  }
}

const STUB = `import fs from 'node:fs';
const name = process.argv[1].replace(/\\\\/g, '/').split('/').pop().replace(/\\.mjs$/, '');
const cfg = JSON.parse(fs.readFileSync(new URL('../stub.json', import.meta.url), 'utf8'));
fs.appendFileSync(new URL('../calls.log', import.meta.url), [name, ...process.argv.slice(2)].join(' ') + '\\n');
const r = cfg[name + ' ' + (process.argv[2] ?? '')] ?? cfg[name] ?? {};
if (r.out) process.stdout.write(r.out + '\\n');
process.exit(r.code ?? 0);
`;

function git(root, ...args) {
  const r = spawnSync('git', args, {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, '..', 'gitconfig') }
  });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

// stub: { '<name>': { out, code } or '<name> <first arg>': { out, code } }
function fixture(stub = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-check-'));
  temps.push(base);
  fs.writeFileSync(path.join(base, 'gitconfig'), '');
  const plugin = path.join(base, 'plugin');
  copyClosure('scripts/ship-check.mjs', plugin);
  for (const s of STUBBED) fs.writeFileSync(path.join(plugin, 'scripts', `${s}.mjs`), STUB);
  fs.writeFileSync(path.join(plugin, 'stub.json'), JSON.stringify(stub));
  fs.writeFileSync(path.join(plugin, 'calls.log'), '');
  for (const d of ['agents', 'company']) fs.cpSync(path.join(REPO, d), path.join(plugin, d), { recursive: true });
  const root = path.join(base, 'repo');
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(root, '.company', 'work', ID, '01-feature'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'one\n');
  git(root, 'init', '-q');
  git(root, 'checkout', '-q', '-b', BRANCH);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  const base0 = git(root, 'rev-parse', 'HEAD');
  const run = (args) => {
    const r = spawnSync(process.execPath, [path.join(plugin, 'scripts', 'ship-check.mjs'), ...(args ?? [SLUG, '--base', base0, '--branch', BRANCH])], {
      cwd: root, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home }
    });
    return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
  };
  const calls = () => fs.readFileSync(path.join(plugin, 'calls.log'), 'utf8').split('\n').filter(Boolean);
  return { root, base0, run, calls };
}

const line = (out, name) => out.split('\n').find((l) => l.startsWith(`${name}: `));
const LAST = /^ship-check: (\d+) blocking, (\d+) info$/;

test('clean run: every check reported in Contract order, last line counts, exit 0', () => {
  const f = fixture();
  const r = f.run();
  assert.equal(r.code, 0, r.all);
  const names = r.out.split('\n').filter((l) => /^[a-z-]+: /.test(l) && !l.startsWith('ship-check:')).map((l) => l.split(':')[0]);
  const first = [];
  for (const n of names) if (!first.includes(n)) first.push(n);
  assert.deepEqual(first, ['tree', 'contests', 'drift', 'ledger', 'review-loop', 'tier', 'lead', 'worktrees'], r.out);
  const last = r.out.trim().split('\n').at(-1);
  const m = LAST.exec(last);
  assert.ok(m, last);
  assert.equal(m[1], '0');
  assert.equal(line(r.out, 'worktrees'), 'worktrees: off');
});

test('tier blocks when the sync prints "add before ship:" (an entry owed after a raise); exit 1; the other checks still ran', () => {
  const f = fixture({ 'tier-set sync': { out: 'tier-path: feature tier high\nadd before ship: security-reviewer' } });
  const r = f.run();
  assert.equal(r.code, 1, r.all);
  assert.match(line(r.out, 'tier'), /^tier: block — /);
  assert.match(r.out.trim().split('\n').at(-1), /^ship-check: [1-9]\d* blocking, \d+ info$/);
  const done = f.calls().map((c) => c.split(' ')[0]);
  for (const s of ['handoff-lint', 'rule-check', 'review-loop', 'lead-handover']) assert.ok(done.includes(s), `${s} still ran: ${done}`);
});

test('tier blocks when route owed prints "owed: security"', () => {
  const f = fixture({ 'route owed': { out: 'owed: security' } });
  const r = f.run();
  assert.equal(r.code, 1, r.all);
  assert.match(line(r.out, 'tier'), /^tier: block — /);
});

test('tier does not block on "owed: none" and a clean sync: info line, exit 0', () => {
  const f = fixture({ 'tier-set sync': { out: 'tier-path: feature tier high' }, 'route owed': { out: 'owed: none' } });
  const r = f.run();
  assert.equal(r.code, 0, r.all);
  assert.match(line(r.out, 'tier'), /^tier: info — /);
});

test('tier blocks when the sync exits non-zero, and when route owed exits non-zero', () => {
  const a = fixture({ 'tier-set sync': { out: 'tier-path: broken', code: 1 } }).run();
  assert.equal(a.code, 1, a.all);
  assert.match(line(a.out, 'tier'), /^tier: block/);
  const b = fixture({ 'route owed': { out: 'owed: none', code: 3 } }).run();
  assert.equal(b.code, 1, b.all);
  assert.match(line(b.out, 'tier'), /^tier: block/);
});

test('tier runs the sync with --diff and the Lead\'s base first, then route owed (a raise found by the sync counts)', () => {
  const f = fixture();
  f.run();
  const calls = f.calls();
  const sync = calls.findIndex((c) => c.startsWith('tier-set sync'));
  const owed = calls.findIndex((c) => c.startsWith('route owed'));
  assert.ok(sync >= 0 && owed > sync, calls.join('\n'));
  assert.equal(calls[sync], `tier-set sync ${SLUG} --diff --base ${f.base0}`);
  assert.equal(calls[owed], `route owed ${SLUG}`);
});

test('untracked files give an info line only: count plus paths, never a block', () => {
  const f = fixture();
  for (const n of ['one', 'two', 'three', 'four', 'five', 'six', 'seven']) fs.writeFileSync(path.join(f.root, `new-${n}.txt`), 'x\n');
  fs.writeFileSync(path.join(f.root, 'odd$name.txt'), 'x\n');
  const r = f.run();
  assert.equal(r.code, 0, r.all);
  const tree = line(r.out, 'tree');
  assert.match(tree, /^tree: info — 8 untracked$/, r.out);
  const listed = r.out.split('\n').filter((l) => /^ {2}\S/.test(l) && /new-|odd/.test(l));
  assert.ok(listed.length <= 5, `at most 5 paths: ${listed.length}`);
  assert.ok(!r.out.includes('odd$name'), 'a path failing the step-close character rule is never printed');
  assert.ok(!/tree: block/.test(r.out));
});

test('a changed tracked file blocks the tree check; so does a HEAD on another branch', () => {
  const dirty = fixture();
  fs.writeFileSync(path.join(dirty.root, 'tracked.txt'), 'two\n');
  const a = dirty.run();
  assert.equal(a.code, 1, a.all);
  assert.match(line(a.out, 'tree'), /^tree: block/);

  const other = fixture();
  git(other.root, 'checkout', '-q', '-b', 'aico/elsewhere');
  const b = other.run();
  assert.equal(b.code, 1, b.all);
  assert.match(line(b.out, 'tree'), /^tree: block/);
});

test('one failing check never stops the others: contests and drift block, later checks still run', () => {
  const f = fixture({ 'handoff-lint': { out: 'unresolved: R-1' }, 'rule-check': { out: 'drift', code: 1 } });
  const r = f.run();
  assert.equal(r.code, 1, r.all);
  assert.match(line(r.out, 'contests'), /^contests: block/);
  assert.match(line(r.out, 'drift'), /^drift: block/);
  const done = f.calls().map((c) => c.split(' ')[0]);
  for (const s of ['ledger', 'review-loop', 'tier-set', 'route', 'lead-handover']) assert.ok(done.includes(s), `${s} ran: ${done}`);
  assert.match(r.out.trim().split('\n').at(-1), /^ship-check: [2-9]\d* blocking/);
});

test('a ledger failure is cost info only, never a block', () => {
  const f = fixture({ ledger: { out: 'cost: n/a', code: 1 } });
  const r = f.run();
  assert.doesNotMatch(line(r.out, 'ledger') ?? '', /block/, r.out);
});

test('refused arguments exit 2 and run nothing', () => {
  const f = fixture();
  const good = [SLUG, '--base', f.base0, '--branch', BRANCH];
  const cases = [
    [SLUG, '--base', 'abc', '--branch', BRANCH],
    [SLUG, '--base', f.base0, '--branch', 'main'],
    [...good, '--acs', '0'],
    [...good, '--acs', '1000'],
    ['not a slug', '--base', f.base0, '--branch', BRANCH],
    [SLUG, '--branch', BRANCH]
  ];
  for (const args of cases) {
    const r = f.run(args);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.all}`);
  }
  assert.deepEqual(f.calls(), [], 'no check ran');
});
