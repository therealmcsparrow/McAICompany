import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { main, parseRow } from './step-split.mjs';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-home-'));
const temps = [HOME];
after(() => {
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = (name) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `ss-${name}-`));
  temps.push(d);
  return d;
};

const SLUG = 'sp';
const SHA = 'a'.repeat(40);
const depthScript = path.join(import.meta.dirname, 'review-depth.mjs');
const ENV = () => {
  const e = { ...process.env, HOME, USERPROFILE: HOME, MCSPARROW_HOME: path.join(HOME, 'mcs'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(HOME, 'none') };
  delete e.NODE_TEST_CONTEXT;
  for (const k of Object.keys(e)) if (/^GIT_/i.test(k) && k !== 'GIT_CONFIG_NOSYSTEM' && k !== 'GIT_CONFIG_GLOBAL') delete e[k];
  return e;
};
const realExec = (file, args, o) => execFileSync(file, args, { ...o, env: ENV() });

function repo({ profile = true } = {}) {
  const d = tmp('repo');
  const g = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8', env: ENV() });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.excludesFile', os.devNull);
  if (profile) {
    fs.mkdirSync(path.join(d, '.company'));
    fs.writeFileSync(path.join(d, '.company/project.md'), '# P\n\n## Core\n- core/x: wiring\n\n## Modules\n- (none yet)\n');
  }
  fs.writeFileSync(path.join(d, 'a.txt'), 'a\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  const base = g('rev-parse', 'HEAD').stdout.trim();
  g('checkout', '-q', '-b', `aico/${SLUG}`);
  fs.mkdirSync(path.join(d, '.company/work', SLUG), { recursive: true });
  const commit = (files) => {
    for (const [file, n] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(d, file)), { recursive: true });
      fs.writeFileSync(path.join(d, file), 'line\n'.repeat(n));
    }
    g('add', '-A');
    g('commit', '-q', '-m', 'c');
  };
  return { d, base, commit };
}

// A project folder with a run folder and a stubbed review-depth answer.
function stubbed(answer) {
  const d = tmp('stub');
  fs.mkdirSync(path.join(d, '.company/work', SLUG), { recursive: true });
  const calls = [];
  const exec = (file, args, o) => {
    calls.push([file, ...args]);
    if (answer instanceof Error) throw answer;
    return typeof answer === 'string' ? answer : JSON.stringify(answer);
  };
  return { d, calls, exec };
}
const depth = (over = {}) => ({ v: 1, source: 'base', base: SHA, tier: 'unknown', depth: 'standard', paths: [{ path: 'a/b/x.mjs', categories: [], module: null, lines: 10 }], reasons: [], truncated: false, ...over });
const splitDirOf = (d) => path.join(d, '.company/work', SLUG, 'split');
const files = (dir) => Object.fromEntries(fs.readdirSync(dir).sort().map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')]));

test('review: a 3000-line diff splits into 3 groups of at most 1200 lines in split/r1', () => {
  const { d, base, commit } = repo();
  commit({ 'alpha/one/a.mjs': 1000, 'beta/two/b.mjs': 1000, 'gamma/three/c.mjs': 1000 });
  const r = main(['review', SLUG, base, '1'], { root: d, exec: realExec });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^groups: 3\n/);
  const dir = path.join(splitDirOf(d), 'r1');
  assert.deepEqual(Object.keys(files(dir)), ['g1.txt', 'g2.txt', 'g3.txt']);
  assert.equal(files(dir)['g1.txt'], 'alpha/one/a.mjs\n');
  assert.match(r.out, /group 1: 1000 lines, 1 files: alpha\/one\n/);
  assert.deepEqual(fs.readdirSync(splitDirOf(d)), ['r1']);
});

test('review: a second run is refused and leaves the folder untouched', () => {
  const { d, base, commit } = repo();
  commit({ 'alpha/one/a.mjs': 10 });
  assert.equal(main(['review', SLUG, base, '1'], { root: d, exec: realExec }).code, 0);
  const before = files(path.join(splitDirOf(d), 'r1'));
  const r = main(['review', SLUG, base, '1'], { root: d, exec: realExec });
  assert.deepEqual(r, { code: 2, out: 'refused: split exists\n' });
  assert.deepEqual(files(path.join(splitDirOf(d), 'r1')), before);
  assert.deepEqual(fs.readdirSync(splitDirOf(d)), ['r1']);
});

test('review: one file over the limit is its own group', () => {
  const { d, base, commit } = repo();
  commit({ 'alpha/one/a.mjs': 5, 'alpha/one/big.mjs': 1500, 'alpha/one/z.mjs': 5 });
  const r = main(['review', SLUG, base, '2'], { root: d, exec: realExec });
  assert.equal(r.code, 0, r.out);
  const f = files(path.join(splitDirOf(d), 'r2'));
  assert.equal(f['g1.txt'], 'alpha/one/a.mjs\n');
  assert.equal(f['g2.txt'], 'alpha/one/big.mjs\n');
  assert.equal(f['g3.txt'], 'alpha/one/z.mjs\n');
});

test('review: a group never holds more than max-files files', () => {
  const { d, base, commit } = repo();
  const many = {};
  for (let i = 0; i < 7; i++) many[`area/sub/f${i}.mjs`] = 1;
  commit(many);
  const r = main(['review', SLUG, base, '1', '--max-files', '3', '--max-lines', '50'], { root: d, exec: realExec });
  assert.equal(r.code, 0, r.out);
  const f = files(path.join(splitDirOf(d), 'r1'));
  assert.deepEqual(Object.values(f).map((t) => t.split('\n').filter(Boolean).length), [3, 3, 1]);
});

test('review: areas pack greedily in name order', () => {
  const s = stubbed(depth({ paths: [
    { path: 'zeta/q/a.mjs', categories: [], module: null, lines: 700 },
    { path: 'alpha/q/b.mjs', categories: [], module: null, lines: 600 },
    { path: 'alpha/q/c.mjs', categories: [], module: null, lines: 500 },
    { path: 'mod/c.mjs', categories: [], module: 'ledger', lines: 100 }
  ] }));
  const r = main(['review', SLUG, SHA, '1'], { root: s.d, exec: s.exec });
  assert.equal(r.code, 0, r.out);
  const f = files(path.join(splitDirOf(s.d), 'r1'));
  assert.equal(f['g1.txt'], 'alpha/q/b.mjs\nalpha/q/c.mjs\nmod/c.mjs\n');
  assert.equal(f['g2.txt'], 'zeta/q/a.mjs\n');
});

test('review: a leftover temp folder is ignored by review and show', () => {
  const { d, base, commit } = repo();
  commit({ 'alpha/one/a.mjs': 10 });
  const tmpDir = path.join(splitDirOf(d), '.tmp-r1-1');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'g1.txt'), 'old\n');
  assert.equal(main(['show', SLUG, 'r1'], { root: d }).out, 'groups: 0\n');
  assert.equal(main(['review', SLUG, base, '1'], { root: d, exec: realExec }).code, 0);
  assert.equal(files(path.join(splitDirOf(d), 'r1'))['g1.txt'], 'alpha/one/a.mjs\n');
});

test('review: refuses on truncated, each star reason and an empty list, writing nothing', () => {
  const cases = [
    [depth({ truncated: true }), /no full path list \(truncated\)/],
    [depth({ paths: [] }), /no full path list \(paths: \[\]\)/],
    ...['grafts file present', 'head not on run branch', 'diff unavailable', 'no run ref', 'risk tier — high'].map((rule) => [
      depth({ depth: 'full', paths: [], reasons: [{ path: '*', rule }] }), new RegExp(`no full path list \\(${rule}\\)`)]),
    [depth({ reasons: [{ path: 'x', rule: 'core path' }, { path: '*', rule: 'grafts file present' }] }), /grafts file present/],
    ['not json', /unreadable/],
    [new Error('exit 2'), /review-depth failed/],
    [depth({ paths: [{ path: 'a\nb', categories: [], module: null, lines: 1 }] }), /bad path entry/],
    [depth({ paths: [{ path: 'a', categories: [], module: null, lines: -1 }] }), /bad path entry/]
  ];
  for (const [answer, re] of cases) {
    const s = stubbed(answer);
    const r = main(['review', SLUG, SHA, '1'], { root: s.d, exec: s.exec });
    assert.equal(r.code, 2, String(re));
    assert.match(r.out, re);
    assert.ok(r.out.startsWith('refused: '));
    assert.equal(fs.existsSync(splitDirOf(s.d)), false, String(re));
  }
});

test('review: core unknown at base with a full list still splits by first two segments', () => {
  const s = stubbed(depth({ depth: 'full', paths: [
    { path: 'src/lib/a.mjs', categories: [], module: null, lines: 5 },
    { path: 'src/lib/deep/b.mjs', categories: [], module: null, lines: 5 }
  ], reasons: [{ path: '*', rule: 'core unknown at base' }] }));
  const r = main(['review', SLUG, SHA, '1'], { root: s.d, exec: s.exec });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /group 1: 10 lines, 2 files: src\/lib\n/);
});

test('review: no project profile at the base still splits and review-depth without --lines is unchanged', () => {
  const { d, base, commit } = repo({ profile: false });
  commit({ 'alpha/one/a.mjs': 20, 'beta/two/b.mjs': 30 });
  const r = main(['review', SLUG, base, '1'], { root: d, exec: realExec });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /group 1: 50 lines, 2 files: alpha\/one, beta\/two\n/);
  const plain = spawnSync(process.execPath, [depthScript, base, '--run', SLUG, '--json'], { cwd: d, encoding: 'utf8', env: ENV() });
  assert.equal(plain.stdout, JSON.stringify({ v: 1, source: 'base', base, tier: 'unknown', depth: 'full', paths: [], reasons: [{ path: '*', rule: 'core unknown at base' }], truncated: false }) + '\n');
  const lines = spawnSync(process.execPath, [depthScript, base, '--run', SLUG, '--json', '--lines'], { cwd: d, encoding: 'utf8', env: ENV() });
  const j = JSON.parse(lines.stdout);
  assert.equal(j.depth, 'full');
  assert.deepEqual(j.reasons, [{ path: '*', rule: 'core unknown at base' }]);
  assert.deepEqual(j.paths.map((p) => [p.path, p.module, p.lines]), [['alpha/one/a.mjs', null, 20], ['beta/two/b.mjs', null, 30]]);
});

test('review-depth --lines: lines are added plus deleted, binary is 0, output without --lines is unchanged', () => {
  const { d, base, commit } = repo();
  commit({ 'src/a.mjs': 4 });
  fs.writeFileSync(path.join(d, 'src/bin.dat'), Buffer.from([0, 1, 2, 0, 3, 0]));
  fs.writeFileSync(path.join(d, 'a.txt'), 'b\nc\n');
  spawnSync('git', ['add', '-A'], { cwd: d, env: ENV() });
  spawnSync('git', ['commit', '-q', '-m', 'd'], { cwd: d, env: ENV() });
  const withLines = JSON.parse(spawnSync(process.execPath, [depthScript, base, '--run', SLUG, '--json', '--lines'], { cwd: d, encoding: 'utf8', env: ENV() }).stdout);
  const byPath = Object.fromEntries(withLines.paths.map((p) => [p.path, p.lines]));
  assert.deepEqual(byPath, { 'a.txt': 3, 'src/a.mjs': 4, 'src/bin.dat': 0 });
  const plain = JSON.parse(spawnSync(process.execPath, [depthScript, base, '--run', SLUG, '--json'], { cwd: d, encoding: 'utf8', env: ENV() }).stdout);
  assert.ok(plain.paths.every((p) => !('lines' in p)));
  const text = spawnSync(process.execPath, [depthScript, base, '--run', SLUG, '--lines'], { cwd: d, encoding: 'utf8', env: ENV() });
  assert.equal(text.status, 2);
});

test('review: review-depth runs with exactly the fixed argv and no --risk, whatever the run tier', () => {
  const s = stubbed(depth());
  fs.writeFileSync(path.join(s.d, '.company/work', SLUG, 'run-state.json'), '{"tier":"high"}\n');
  const r = main(['review', SLUG, SHA, '1'], { root: s.d, exec: s.exec });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(s.calls, [[process.execPath, depthScript, SHA, '--run', SLUG, '--json', '--lines']]);
});

test('show: prints existing groups, groups: 0 when none', () => {
  const s = stubbed(depth({ paths: [
    { path: 'a/b/x.mjs', categories: [], module: null, lines: 5 },
    { path: 'a/b/y.mjs', categories: [], module: null, lines: 5 }
  ] }));
  assert.equal(main(['show', SLUG, 'r1'], { root: s.d }).out, 'groups: 0\n');
  main(['review', SLUG, SHA, '1'], { root: s.d, exec: s.exec });
  const r = main(['show', SLUG, 'r1'], { root: s.d });
  assert.equal(r.out, `groups: 1\ngroup 1: 2 entries\n  .company/work/${SLUG}/split/r1/g1.txt\n`);
  assert.equal(main(['show', SLUG, 'f1'], { root: s.d }).out, 'groups: 0\n');
});

const handoff = (root, name, blocking) => {
  const text = `---\nstatus: blocked\n---\n## Did\nx\n\n## Blocking\n${blocking.join('\n')}\n\n## Next\n- [spec] z/q.mjs:1 not read\n`;
  fs.writeFileSync(path.join(root, '.company/work', SLUG, name), text);
};

test('parseRow: path ends at the first :digits or the first em dash', () => {
  assert.deepEqual(parseRow('- [spec] R-12 scripts/a b.mjs:40 — bad'), { tag: 'spec', file: 'scripts/a b.mjs', line: '40' });
  assert.deepEqual(parseRow('- [test] scripts/a.mjs — no test'), { tag: 'test', file: 'scripts/a.mjs', line: null });
  assert.deepEqual(parseRow('- [security] T-3 a/b:7 — x:9'), { tag: 'security', file: 'a/b', line: '7' });
  assert.deepEqual(parseRow('- [security] a — x:9'), { tag: 'security', file: 'a', line: null });
  assert.equal(parseRow('- [spec] no path here'), null);
  assert.equal(parseRow('- [other] a:1'), null);
  assert.equal(parseRow('- [spec]  a:1'), null);
  assert.equal(parseRow('- [spec] :4 x'), null);
  assert.equal(parseRow(`- [spec] ${'a'.repeat(301)}:1`), null);
  assert.equal(parseRow(`- [spec] ${'a'.repeat(300)}:1`).file.length, 300);
});

test('fix: groups blockers by area, merges equal keys, routes comprehension and unplaced', () => {
  const s = stubbed(depth());
  handoff(s.d, '10-code-reviewer.md', [
    '- [spec] R-1 scripts/a.mjs:10 — one',
    '- [test] scripts/b.mjs:3 — two',
    '- [comprehension] docs/plan.md:5 — wording',
    '- [spec] src/x/y.mjs:1 — other area',
    'prose line that is not a bullet',
    '- loose bullet without a tag'
  ]);
  handoff(s.d, '11-security.md', ['- [spec] R-9 scripts/a.mjs:10 — same key', '- [security] scripts/a.mjs:11 — new key', '- none']);
  const r = main(['fix', SLUG, '1', '10-code-reviewer.md', '11-security.md'], { root: s.d });
  assert.equal(r.code, 0, r.out);
  const f = files(path.join(splitDirOf(s.d), 'f1'));
  assert.equal(f['g1.txt'], '10-code-reviewer.md:8\n11-security.md:9\n10-code-reviewer.md:9\n10-code-reviewer.md:11\n');
  assert.equal(f['architect.txt'], '10-code-reviewer.md:10\n');
  assert.equal(f['g2.txt'], '10-code-reviewer.md:13\n');
  assert.match(r.out, /^groups: 2\n/);
  assert.match(r.out, /architect: 1 rows\n/);
  assert.equal(main(['fix', SLUG, '1', '10-code-reviewer.md'], { root: s.d }).out, 'refused: split exists\n');
});

test('fix: an area over 8 blockers splits, unplaced rows never join another group', () => {
  const s = stubbed(depth());
  const rows = [];
  for (let i = 1; i <= 10; i++) rows.push(`- [spec] lib/mod/f.mjs:${i} — r`);
  rows.push('- loose');
  handoff(s.d, '10-qa.md', rows);
  const r = main(['fix', SLUG, '2', `.company/work/${SLUG}/10-qa.md`], { root: s.d });
  assert.equal(r.code, 0, r.out);
  const f = files(path.join(splitDirOf(s.d), 'f2'));
  assert.deepEqual(Object.values(f).map((t) => t.split('\n').filter(Boolean).length), [8, 2, 1]);
  assert.equal(main(['show', SLUG, 'f2'], { root: s.d }).out.split('\n')[0], 'groups: 3');
});

test('fix: refuses a handoff outside the run folder, a bad name and no blocking rows', () => {
  const s = stubbed(depth());
  handoff(s.d, '10-qa.md', ['- none']);
  for (const [args, re] of [
    [['fix', SLUG, '1', '../x.md'], /handoff must be a file in the run folder/],
    [['fix', SLUG, '1', 'a/b/c.md'], /handoff must be a file in the run folder/],
    [['fix', SLUG, '1', 'x.txt'], /bad handoff name/],
    [['fix', SLUG, '1', 'missing.md'], /handoff not found/],
    [['fix', SLUG, '1', '10-qa.md'], /no blocking rows/],
    [['fix', SLUG, '1'], /usage/]
  ]) {
    const r = main(args, { root: s.d });
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.out, re);
  }
  assert.equal(fs.existsSync(splitDirOf(s.d)), false);
});

test('hostile arguments are refused before any write', () => {
  const s = stubbed(depth());
  for (const args of [
    ['review', '../evil', SHA, '1'], ['review', 'Sp', SHA, '1'], ['review', 'nope', SHA, '1'],
    ['review', SLUG, 'HEAD', '1'], ['review', SLUG, SHA, '-1'], ['review', SLUG, SHA, '1x'],
    ['review', SLUG, SHA, '1', '--max-lines', '0'], ['review', SLUG, SHA, '1', '--max-lines', '12 3'],
    ['review', SLUG, SHA, '1', '--max-files'], ['review', SLUG, SHA, '1', '--risk', 'high'],
    ['review', SLUG, SHA, '1', '--max-files', '5', '--max-files', '6'],
    ['show', SLUG, 'x1'], ['show', SLUG, 'r1', 'extra'], ['bogus'], []
  ]) {
    const r = main(args, { root: s.d, exec: s.exec });
    assert.equal(r.code, 2, args.join(' '));
    assert.ok(r.out.startsWith('refused: '), args.join(' '));
  }
  assert.deepEqual(s.calls, []);
  assert.equal(fs.existsSync(splitDirOf(s.d)), false);
});

test('files are LF only and the cli exits 2 with the refusal on stdout', () => {
  const { d, base, commit } = repo();
  commit({ 'alpha/one/a.mjs': 3 });
  const run = (args) => spawnSync(process.execPath, [path.join(import.meta.dirname, 'step-split.mjs'), ...args], { cwd: d, encoding: 'utf8', env: ENV() });
  const ok = run(['review', SLUG, base, '1']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.ok(!fs.readFileSync(path.join(splitDirOf(d), 'r1/g1.txt'), 'utf8').includes('\r'));
  const again = run(['review', SLUG, base, '1']);
  assert.equal(again.status, 2);
  assert.equal(again.stdout, 'refused: split exists\n');
});
