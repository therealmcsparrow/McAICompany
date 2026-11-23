import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, readReviewLoop, ReviewLoopRecordError } from './review-loop.mjs';

const SLUG = 'demo';
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const saved = {};
let home;

// Per-test git config and home, so no test reads the user's git configuration.
before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'review-loop-home-'));
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
});

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const numbered = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

function makeRepo({ branch = `aico/${SLUG}` } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-loop-'));
  roots.push(root);
  git(root, 'init', '--quiet');
  git(root, 'checkout', '--quiet', '-b', branch);
  fs.writeFileSync(path.join(root, 'a.txt'), numbered(50));
  fs.writeFileSync(path.join(root, 'b.txt'), numbered(10));
  fs.mkdirSync(path.join(root, '.company', 'work', SLUG), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), '.company/\n');
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '--message=base');
  return { root, base: git(root, 'rev-parse', 'HEAD') };
}

const run = (root, ...args) => main(args, { root, now: NOW });
const folder = (root) => path.join(root, '.company', 'work', SLUG);

function handoff(root, name, role, round, rows, status = 'done') {
  const body = rows.map((r) => `- ${r}`).join('\n') || '- none';
  fs.writeFileSync(path.join(folder(root), name), `---\nstep: 01\nrole: ${role}\ntask: ${SLUG}\nstatus: ${status}\nround: ${round}\n---\nBy: t\n## Blocking\n${body}\n## Next\n- x\n`);
}

function commitEdit(root, file, fn, msg = 'fix') {
  const p = path.join(root, file);
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  fs.writeFileSync(p, fn(lines).join('\n'));
  git(root, 'commit', '--quiet', '--all', `--message=${msg}`);
}

const recordText = (root) => fs.readFileSync(path.join(folder(root), 'review-loop.jsonl'), 'utf8');

describe('attempt', () => {
  test('first failure retries, second is not run, steps are separate', () => {
    const { root } = makeRepo();
    assert.deepEqual(run(root, 'attempt', SLUG, '05', 'qa', '0', 'crash'), { code: 0, lines: ['retry qa'] });
    assert.deepEqual(run(root, 'attempt', SLUG, '06', 'qa', '0', 'lint'), { code: 0, lines: ['retry qa'] });
    assert.deepEqual(run(root, 'attempt', SLUG, '05', 'qa', '0', 'no-handoff'), { code: 0, lines: ['not run qa round 0'] });
    assert.deepEqual(run(root, 'attempt', SLUG, '06', 'qa', '1', 'crash'), { code: 0, lines: ['retry qa'] });
    const events = readReviewLoop(root, SLUG);
    assert.deepEqual(events.map((e) => e.ev), ['attempt', 'attempt', 'notrun', 'attempt']);
    assert.equal(events[0].at, '2026-10-29T12:00:00Z');
    assert.equal(events[2].reason, 'no-handoff');
  });

  test('a third failure after not run is refused and writes nothing', () => {
    const { root } = makeRepo();
    for (let i = 0; i < 2; i++) run(root, 'attempt', SLUG, '05', 'security', '0', 'crash');
    const before = recordText(root);
    const r = run(root, 'attempt', SLUG, '05', 'security', '0', 'crash');
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: /);
    assert.equal(recordText(root), before);
  });

  test('hostile arguments are refused before anything is written', () => {
    const { root } = makeRepo();
    const bad = [
      ['attempt', '../x', '05', 'qa', '0', 'crash'],
      ['attempt', SLUG, '5', 'qa', '0', 'crash'],
      ['attempt', SLUG, '05', 'architect', '0', 'crash'],
      ['attempt', SLUG, '05', 'qa', '6', 'crash'],
      ['attempt', SLUG, '05', 'qa', '0', 'other'],
      ['attempt', SLUG, '05', 'qa\n', '0', 'crash'],
      ['attempt', SLUG, '05', 'qa', '0', 'crash', 'extra'],
      ['attempt', SLUG, '05', 'qa', '0', 'x'.repeat(5000)],
      ['nope'],
      [],
    ];
    for (const args of bad) assert.equal(run(root, ...args).code, 3, JSON.stringify(args).slice(0, 80));
    assert.equal(fs.existsSync(path.join(folder(root), 'review-loop.jsonl')), false);
  });
});

describe('record', () => {
  const line = (o) => JSON.stringify({ v: 1, at: '2026-10-29T12:00:00Z', ev: 'attempt', role: 'qa', round: 0, step: '05', reason: 'crash', ...o }) + '\n';
  const put = (root, text) => fs.writeFileSync(path.join(folder(root), 'review-loop.jsonl'), text);

  test('reader fails loud on shape, size and line limits', () => {
    const { root } = makeRepo();
    const cases = {
      empty: '',
      noLf: line({}).trimEnd(),
      badJson: '{nope}\n',
      extraKey: line({ extra: 1 }),
      badRole: line({ role: 'architect' }),
      badReason: line({ reason: 'x' }),
      badRound: line({ round: 9 }),
      badEv: line({ ev: 'remove' }),
      cr: line({}).replace('\n', '\r\n'),
      longLine: line({ at: '2026-10-29T12:00:00Z', step: '05'.padEnd(600, 'x') }),
      tooManyLines: line({}).repeat(501),
      tooBig: line({}).repeat(100) + ' '.repeat(65 * 1024),
    };
    for (const [name, text] of Object.entries(cases)) {
      put(root, text);
      assert.throws(() => readReviewLoop(root, SLUG), ReviewLoopRecordError, name);
      assert.equal(run(root, 'gate', SLUG).code, 1, name);
      assert.equal(run(root, 'attempt', SLUG, '05', 'qa', '0', 'crash').code, 1, name);
    }
  });

  test('a file with two hard links is refused', () => {
    const { root } = makeRepo();
    run(root, 'attempt', SLUG, '05', 'qa', '0', 'crash');
    fs.linkSync(path.join(folder(root), 'review-loop.jsonl'), path.join(root, 'other.jsonl'));
    assert.throws(() => readReviewLoop(root, SLUG), /link/);
    assert.equal(run(root, 'attempt', SLUG, '05', 'qa', '0', 'crash').code, 1);
  });

  test('a run folder that is a plain folder with no record reads as empty', () => {
    const { root } = makeRepo();
    assert.deepEqual(readReviewLoop(root, SLUG), []);
    assert.throws(() => readReviewLoop(root, '../x'), TypeError);
  });
});

describe('gate', () => {
  test('prints not run lines, a blocking prefix for security lanes only', () => {
    const { root } = makeRepo();
    for (const [step, role, round] of [['05', 'security', '1'], ['06', 'qa', '1'], ['07', 'pentester', '0'], ['08', 'vuln-scanner', '2']]) {
      run(root, 'attempt', SLUG, step, role, round, 'crash');
      run(root, 'attempt', SLUG, step, role, round, 'crash');
    }
    run(root, 'attempt', SLUG, '09', 'legal', '0', 'lint');
    const r = run(root, 'gate', SLUG);
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, ['blocking: not run security round 1', 'not run qa round 1', 'blocking: not run pentester round 0', 'blocking: not run vuln-scanner round 2']);
  });

  test('a clean run prints one fixed line', () => {
    const { root } = makeRepo();
    assert.deepEqual(run(root, 'gate', SLUG), { code: 0, lines: ['review-loop: nothing to report'] });
  });
});
