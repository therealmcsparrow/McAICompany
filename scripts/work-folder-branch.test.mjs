import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { main as tierMain } from './tier-set.mjs';
import { main as wtMain } from './worktree.mjs';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const NEW = '2026-10-30 23.45 - Fix Login';
const ID = '2026-10-30-2345-fix-login';
const LEGACY = 'demo';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-branch-home-'));
const SAVED = {};
for (const key of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'APPDATA']) {
  SAVED[key] = process.env[key];
  process.env[key] = HOME;
}
const GLOBAL_CONFIG = path.join(HOME, 'gitconfig');
fs.writeFileSync(GLOBAL_CONFIG, '');
process.env.GIT_CONFIG_GLOBAL = GLOBAL_CONFIG;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const bases = [HOME];
after(() => {
  for (const key of Object.keys(SAVED)) {
    if (SAVED[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED[key];
  }
  delete process.env.GIT_CONFIG_GLOBAL;
  delete process.env.GIT_CONFIG_NOSYSTEM;
  for (const b of bases) fs.rmSync(b, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\n$/, '');
}

// A repo on branch aico/<branch>, one commit, and the run folder `name` under .company/work.
function makeRepo(name, branch) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-branch-')));
  bases.push(base);
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', `--initial-branch=aico/${branch}`);
  for (const [k, v] of [['user.name', 'Test'], ['user.email', 'test@example.com'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) {
    git(repo, 'config', k, v);
  }
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  fs.mkdirSync(path.join(repo, '.company'));
  fs.writeFileSync(path.join(repo, '.company', 'project.md'), '## Core\n- skills/pipeline: run setup\n\n## Modules\n');
  git(repo, 'add', '--all');
  git(repo, 'commit', '--quiet', '--message=base');
  const runDir = path.join(repo, '.company', 'work', name);
  fs.mkdirSync(runDir, { recursive: true });
  return {
    base, repo, runDir,
    g: (...a) => git(repo, ...a),
    head: () => git(repo, 'rev-parse', 'HEAD'),
    wtRoot: path.join(base, 'repo.aico-wt'),
    commit(file, text) {
      fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      fs.writeFileSync(path.join(repo, file), text);
      git(repo, 'add', '--all');
      git(repo, 'commit', '--quiet', '--message=work');
      return git(repo, 'rev-parse', 'HEAD');
    }
  };
}

// Names that are neither a legacy slug nor a new work folder name.
const HOSTILE = [
  '2026-10-30 23.45 - fix login',
  '2026-10-30 23.45 - Fix Login ',
  ' 2026-10-30 23.45 - Fix Login',
  '2026-10-30 23.45 - Fix  Login',
  '2026-10-30 23.45 - Fix Login Build 2',
  '2026-10-30 23.45 - Fix Login Draft 10',
  '2026-13-30 23.45 - Fix Login',
  '2026-10-30 24.00 - Fix Login',
  '2026-10-30-23.45 - Fix Login',
  '2026-10-30 23.45 - Fix/Login',
  '2026-10-30 23.45 - Fix ../Login',
  '2026-10-30 23.45 - Fix‮Login',
  '2026-10-30 23.45 - Fix Login\n',
  '2026-10-30 23.45 - Fix Login\u0000x',
  '2026-10-30 23.45 - Fix\\Login',
  '2026-10-30 23.45 - -Fix Login',
  '2026-10-30 23.45 - ' + 'Word '.repeat(20),
  '../x',
  '..',
  'Demo',
  'aico/demo',
  'a b',
  '--end-of-options',
  '-demo'
];

describe('tier-set with a new run name', () => {
  function begun(name, branch) {
    const r = makeRepo(name, branch);
    const first = r.head();
    const b = tierMain(['begin', name, '--playbook', 'feature', '--triage', 'low', '--short', 'on', '--base', first, '--ceo', 'short'], { now: NOW, root: r.repo });
    assert.equal(b.code, 0, b.lines.join('\n'));
    return { r, first };
  }

  test('begin, read and a diff on aico/<branch id> work for a new name', () => {
    const { r, first } = begun(NEW, ID);
    const rec = tierMain(['read', NEW], { now: NOW, root: r.repo });
    assert.equal(rec.code, 0, rec.lines.join('\n'));
    assert.equal(JSON.parse(rec.lines[0]).slug, NEW);
    assert.ok(fs.existsSync(path.join(r.runDir, 'tier-path.jsonl')));
    r.commit('src/auth/x.ts', 'export {}\n');
    const s = tierMain(['sync', NEW, '--diff', '--base', first], { now: NOW, root: r.repo });
    assert.equal(s.code, 0, s.lines.join('\n'));
    assert.ok(s.lines.includes('check: high: pattern auth src/auth/x.ts'), s.lines.join('\n'));
    assert.ok(!s.lines.includes('check: high: diff unknown'), s.lines.join('\n'));
  });

  test('a new name on a branch that is not its branch id reads the diff as unknown', () => {
    const { r, first } = begun(NEW, 'demo');
    r.commit('src/auth/x.ts', 'export {}\n');
    const s = tierMain(['sync', NEW, '--diff', '--base', first], { now: NOW, root: r.repo });
    assert.ok(s.lines.includes('check: high: diff unknown'), s.lines.join('\n'));
    const other = begun(NEW, `${ID}-2`);
    other.r.commit('src/auth/x.ts', 'export {}\n');
    const t = tierMain(['sync', NEW, '--diff', '--base', other.first], { now: NOW, root: other.r.repo });
    assert.ok(t.lines.includes('check: high: diff unknown'), t.lines.join('\n'));
  });

  test('a legacy slug still reads aico/<slug>', () => {
    const { r, first } = begun(LEGACY, LEGACY);
    r.commit('src/auth/x.ts', 'export {}\n');
    const s = tierMain(['sync', LEGACY, '--diff', '--base', first], { now: NOW, root: r.repo });
    assert.ok(s.lines.includes('check: high: pattern auth src/auth/x.ts'), s.lines.join('\n'));
  });

  test('hostile run names are refused before any file or git call', () => {
    const r = makeRepo(LEGACY, LEGACY);
    const calls = [];
    const git2 = (argv) => {
      calls.push(argv);
      throw new Error('git must not run');
    };
    const first = r.head();
    for (const name of HOSTILE) {
      for (const args of [['read', name], ['preview', name, '--playbook', 'feature', '--triage', 'low', '--short', 'on'], ['raise', name, 'high'],
        ['begin', name, '--playbook', 'feature', '--triage', 'low', '--short', 'on', '--base', first], ['sync', name, '--diff', '--base', first]]) {
        const res = tierMain(args, { now: NOW, root: r.repo, git: git2 });
        assert.equal(res.code, 3, JSON.stringify([name, args[0]]));
        assert.match(res.lines[0], /^refused: /, JSON.stringify([name, args[0]]));
      }
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(fs.readdirSync(path.join(r.repo, '.company', 'work')), [LEGACY]);
    assert.deepEqual(fs.readdirSync(path.join(r.repo, '.company', 'work', LEGACY)), []);
  });
});

describe('worktree with a new run name', () => {
  function writeWave(r, name, ids) {
    const at = '2026-10-30T10:00:00Z';
    const byNumber = [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    const planText = `# Plan\n\n## Tasks\n\n${byNumber.map((id) => `### ${id} title of ${id}\n`).join('\n')}`;
    fs.writeFileSync(path.join(r.runDir, '02-plan.md'), planText);
    const hash = crypto.createHash('sha256').update(planText).digest('hex').slice(0, 12);
    const lines = [{ v: 1, at, ev: 'begin', plan: '02-plan.md', hash, cap: 3, mode: 'waves', tasks: ids.length, ow: [] }];
    for (const id of ids) lines.push({ v: 1, at, ev: 'start', task: id, round: 0, ow: [] });
    fs.writeFileSync(path.join(r.runDir, 'parallel.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  }

  const run = (r, ...args) => wtMain(args, { root: r.repo, now: NOW });

  test('add, merge and cleanup use aico/<id> and aico-wt/<id>/<task>; folders hold only the branch id', () => {
    const r = makeRepo(NEW, ID);
    writeWave(r, NEW, ['T1']);
    const added = run(r, 'add', NEW, 't1', '--base', r.head());
    const wt = path.join(r.wtRoot, ID, 't1');
    assert.deepEqual(added, { code: 0, lines: [`Worktree: ${wt}`] });
    assert.deepEqual(fs.readdirSync(r.wtRoot), [ID]);
    assert.equal(r.g('for-each-ref', '--format=%(refname)', 'refs/heads/aico-wt/'), `refs/heads/aico-wt/${ID}/t1`);
    assert.equal(r.g('symbolic-ref', 'HEAD'), `refs/heads/aico/${ID}`);
    const events = fs.readFileSync(path.join(r.runDir, 'worktrees.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(events.length, 1);
    assert.equal(events[0].ev, 'add');

    fs.writeFileSync(path.join(wt, 'task.txt'), 'task\n');
    git(wt, 'add', '--all');
    git(wt, 'commit', '--quiet', '--message=t1');
    const changed = run(r, 'changed', NEW, 't1');
    assert.equal(changed.code, 0, changed.lines.join('\n'));

    const merged = run(r, 'merge', NEW);
    assert.equal(merged.code, 0, merged.lines.join('\n'));
    assert.ok(fs.existsSync(path.join(r.repo, 'task.txt')));
    assert.match(r.g('log', '-1', '--format=%s'), /^merge: /);

    const clean = run(r, 'cleanup', NEW);
    assert.equal(clean.code, 0, clean.lines.join('\n'));
    assert.equal(r.g('for-each-ref', '--format=%(refname)', 'refs/heads/aico-wt/'), '');
    assert.equal(fs.existsSync(wt), false);
  });

  test('leftovers names a new-id branch and folder in full', () => {
    const r = makeRepo(NEW, ID);
    writeWave(r, NEW, ['T1']);
    assert.equal(run(r, 'add', NEW, 't1', '--base', r.head()).code, 0);
    const res = run(r, 'leftovers');
    assert.deepEqual(res.lines, [`leftover worktree ${ID}/t1`, `leftover branch aico-wt/${ID}/t1`]);
  });

  test('HEAD on another branch refuses add and names the run ref', () => {
    const r = makeRepo(NEW, 'demo');
    writeWave(r, NEW, ['T1']);
    const res = run(r, 'add', NEW, 't1', '--base', r.head());
    assert.deepEqual(res, { code: 3, lines: [`refused: HEAD is not refs/heads/aico/${ID}`] });
    assert.equal(fs.existsSync(r.wtRoot), false);
  });

  test('a legacy slug keeps aico-wt/<slug>/<id> and the folder <slug>', () => {
    const r = makeRepo(LEGACY, LEGACY);
    writeWave(r, LEGACY, ['T1']);
    const added = run(r, 'add', LEGACY, 't1', '--base', r.head());
    assert.deepEqual(added, { code: 0, lines: [`Worktree: ${path.join(r.wtRoot, LEGACY, 't1')}`] });
    assert.equal(r.g('for-each-ref', '--format=%(refname)', 'refs/heads/aico-wt/'), 'refs/heads/aico-wt/demo/t1');
  });

  test('hostile run names are refused with no git ref, folder or record written', () => {
    const r = makeRepo(LEGACY, LEGACY);
    writeWave(r, LEGACY, ['T1']);
    const before = r.g('for-each-ref', '--format=%(refname) %(objectname)');
    const base = r.head();
    for (const name of HOSTILE) {
      for (const args of [['add', name, 't1', '--base', base], ['changed', name, 't1'], ['merge', name], ['cleanup', name], ['protocheck', name]]) {
        const res = run(r, ...args);
        assert.equal(res.code, 3, JSON.stringify([name, args[0]]));
        assert.match(res.lines[0], /^refused: /);
      }
    }
    assert.equal(r.g('for-each-ref', '--format=%(refname) %(objectname)'), before);
    assert.equal(fs.existsSync(r.wtRoot), false);
    assert.equal(fs.existsSync(path.join(r.runDir, 'worktrees.jsonl')), false);
    assert.equal(r.g('status', '--porcelain', '--untracked-files=no'), '');
  });
});
