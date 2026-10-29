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

describe('mark', () => {
  test('records the run branch commit; a second mark is refused and the record is unchanged', () => {
    const { root, base } = makeRepo();
    const r = run(root, 'mark', SLUG, '1', '--base', base);
    assert.equal(r.code, 0);
    assert.deepEqual(readReviewLoop(root, SLUG).map(({ ev, round, commit }) => ({ ev, round, commit })), [{ ev: 'mark', round: 1, commit: base }]);
    const before = recordText(root);
    const again = run(root, 'mark', SLUG, '1', '--base', base);
    assert.deepEqual(again, { code: 3, lines: ['refused: round 1 already marked'] });
    assert.equal(recordText(root), before);
    assert.equal(run(root, 'mark', SLUG, '2', '--base', base).code, 0);
  });

  test('HEAD off the run ref, a base that is not an ancestor, and bad ids are refused', () => {
    const { root, base } = makeRepo();
    commitEdit(root, 'a.txt', (l) => l.map((x, i) => (i === 0 ? 'changed' : x)));
    const tip = git(root, 'rev-parse', 'HEAD');
    assert.equal(run(root, 'mark', SLUG, '1', '--base', tip).code, 0);
    git(root, 'checkout', '--quiet', '-b', 'side', base);
    git(root, 'commit', '--quiet', '--allow-empty', '--message=side');
    const side = git(root, 'rev-parse', 'HEAD');
    git(root, 'checkout', '--quiet', `aico/${SLUG}`);
    assert.equal(run(root, 'mark', SLUG, '2', '--base', side).code, 3);
    git(root, 'checkout', '--quiet', '--detach');
    assert.equal(run(root, 'mark', SLUG, '2', '--base', base).code, 3);
    git(root, 'checkout', '--quiet', 'side');
    assert.equal(run(root, 'mark', SLUG, '2', '--base', side).code, 3);
    git(root, 'checkout', '--quiet', `aico/${SLUG}`);
    for (const id of ['HEAD', base.slice(0, 12), base.toUpperCase(), '--upload-pack=x', `${base}\n`, '']) {
      assert.equal(run(root, 'mark', SLUG, '2', '--base', id).code, 3, id);
    }
    assert.equal(run(root, 'mark', SLUG, '2', '--base', 'f'.repeat(40)).code, 1);
    assert.equal(readReviewLoop(root, SLUG).length, 1);
  });

  test('inherited GIT_ variables never reach git', () => {
    const { root, base } = makeRepo();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'review-loop-other-'));
    roots.push(other);
    process.env.GIT_DIR = path.join(other, 'nowhere');
    process.env.GIT_WORK_TREE = other;
    try {
      assert.equal(run(root, 'mark', SLUG, '1', '--base', base).code, 0);
    } finally {
      delete process.env.GIT_DIR;
      delete process.env.GIT_WORK_TREE;
    }
  });

  test('a grafts file stops mark', () => {
    const { root, base } = makeRepo();
    fs.writeFileSync(path.join(root, '.git', 'info', 'grafts'), '');
    const r = run(root, 'mark', SLUG, '1', '--base', base);
    assert.equal(r.code, 1);
    assert.equal(fs.existsSync(path.join(folder(root), 'review-loop.jsonl')), false);
  });
});

describe('churn', () => {
  // Round 0 raised R-1 on a.txt; round 1 edits lines 10-14; the re-review raises R-3.
  function scenario(rows3, edit = (l) => l.map((x, i) => (i >= 9 && i <= 13 ? `${x} fixed` : x))) {
    const { root, base } = makeRepo();
    handoff(root, '02-code-reviewer.md', 'code-reviewer', 0, ['R-1 a.txt:30 — old finding — fix it']);
    assert.equal(run(root, 'mark', SLUG, '1', '--base', base).code, 0);
    commitEdit(root, 'a.txt', edit);
    handoff(root, '04-code-reviewer.md', 'code-reviewer', 1, rows3);
    return { root, base };
  }

  test('a new finding inside a hunk of the Fix round is churn, with the earlier finding in that path', () => {
    const { root, base } = scenario(['R-3 a.txt:12 — new problem — fix it']);
    const r = run(root, 'churn', SLUG, '1', '--base', base);
    assert.equal(r.code, 2);
    assert.deepEqual(r.lines, ['churn 04-code-reviewer:R-3 a.txt:12', 'fixed-before 02-code-reviewer:R-1']);
  });

  test('a new finding outside every hunk is not churn', () => {
    const { root, base } = scenario(['R-3 a.txt:40 — elsewhere — fix it']);
    assert.deepEqual(run(root, 'churn', SLUG, '1', '--base', base), { code: 0, lines: ['churn: none'] });
  });

  test('a row with two locations, a range and a whole-file location', () => {
    let s = scenario(['R-3 a.txt:40, a.txt:13-20 — two places — fix it']);
    assert.match(run(s.root, 'churn', SLUG, '1', '--base', s.base).lines[0], /^churn 04-code-reviewer:R-3 a\.txt:13$/);
    s = scenario(['R-3 a.txt — whole file — fix it']);
    assert.match(run(s.root, 'churn', SLUG, '1', '--base', s.base).lines[0], /^churn 04-code-reviewer:R-3 a\.txt:10$/);
    s = scenario(['R-3 b.txt — other file — fix it']);
    assert.deepEqual(run(s.root, 'churn', SLUG, '1', '--base', s.base).lines, ['churn: none']);
  });

  test('a deletion hunk covers the lines on both sides of it', () => {
    const del = (l) => [...l.slice(0, 19), ...l.slice(22)];
    let s = scenario(['R-3 a.txt:20 — near the gap — fix it'], del);
    assert.equal(run(s.root, 'churn', SLUG, '1', '--base', s.base).code, 2);
    s = scenario(['R-3 a.txt:19 — before the gap — fix it'], del);
    assert.equal(run(s.root, 'churn', SLUG, '1', '--base', s.base).code, 2);
    s = scenario(['R-3 a.txt:25 — after the gap — fix it'], del);
    assert.deepEqual(run(s.root, 'churn', SLUG, '1', '--base', s.base).lines, ['churn: none']);
  });

  test('a row without a location is counted, not matched', () => {
    const { root, base } = scenario(['R-3 the design is unclear — fix it']);
    assert.deepEqual(run(root, 'churn', SLUG, '1', '--base', base).lines, ['churn: none', 'churn: 1 rows without a location']);
  });

  test('a finding of an earlier round never counts as new', () => {
    const { root, base } = scenario(['R-1 a.txt:12 — same finding again — fix it']);
    assert.deepEqual(run(root, 'churn', SLUG, '1', '--base', base).lines, ['churn: none']);
  });

  test('a binary file changed in the Fix round counts as a whole-file hunk', () => {
    const { root, base } = makeRepo();
    fs.writeFileSync(path.join(root, 'img.bin'), Buffer.from([0, 1, 2, 3]));
    git(root, 'add', '--all');
    git(root, 'commit', '--quiet', '--message=bin');
    const base2 = git(root, 'rev-parse', 'HEAD');
    handoff(root, '02-code-reviewer.md', 'code-reviewer', 0, ['R-1 b.txt:3 — x — fix']);
    assert.equal(run(root, 'mark', SLUG, '1', '--base', base).code, 0);
    fs.writeFileSync(path.join(root, 'img.bin'), Buffer.from([0, 9, 9, 9, 9]));
    git(root, 'commit', '--quiet', '--all', '--message=bin2');
    handoff(root, '04-code-reviewer.md', 'code-reviewer', 1, ['R-3 img.bin:2 — bad bytes — fix']);
    assert.equal(base2.length, 40);
    assert.match(run(root, 'churn', SLUG, '1', '--base', base).lines[0], /^churn 04-code-reviewer:R-3 img\.bin:/);
  });

  test('text hidden by a -diff attribute is still read as text', () => {
    const { root, base } = makeRepo();
    fs.writeFileSync(path.join(root, '.git', 'info', 'attributes'), 'a.txt -diff\n');
    handoff(root, '02-code-reviewer.md', 'code-reviewer', 0, ['R-1 b.txt:3 — x — fix']);
    assert.equal(run(root, 'mark', SLUG, '1', '--base', base).code, 0);
    commitEdit(root, 'a.txt', (l) => l.map((x, i) => (i >= 9 && i <= 13 ? `${x} fixed` : x)));
    handoff(root, '04-code-reviewer.md', 'code-reviewer', 1, ['R-3 a.txt:12 — new — fix']);
    assert.equal(run(root, 'churn', SLUG, '1', '--base', base).lines[0], 'churn 04-code-reviewer:R-3 a.txt:12');
  });

  test('no mark, two marks, a grafts file, HEAD off the run ref and a bad base all give churn: unknown', () => {
    let s = scenario(['R-3 a.txt:40 — x — fix']);
    assert.deepEqual(run(s.root, 'churn', SLUG, '2', '--base', s.base), { code: 2, lines: ['churn: unknown'] });
    assert.equal(run(s.root, 'churn', SLUG, '1', '--base', s.base).code, 0);

    const mark = recordText(s.root).trimEnd();
    fs.appendFileSync(path.join(folder(s.root), 'review-loop.jsonl'), `${mark}\n`);
    assert.deepEqual(run(s.root, 'churn', SLUG, '1', '--base', s.base), { code: 2, lines: ['churn: unknown'] });

    s = scenario(['R-3 a.txt:12 — x — fix']);
    fs.writeFileSync(path.join(s.root, '.git', 'info', 'grafts'), '');
    assert.deepEqual(run(s.root, 'churn', SLUG, '1', '--base', s.base), { code: 2, lines: ['churn: unknown'] });

    s = scenario(['R-3 a.txt:12 — x — fix']);
    git(s.root, 'checkout', '--quiet', '--detach');
    assert.deepEqual(run(s.root, 'churn', SLUG, '1', '--base', s.base), { code: 2, lines: ['churn: unknown'] });

    s = scenario(['R-3 a.txt:12 — x — fix']);
    assert.deepEqual(run(s.root, 'churn', SLUG, '1', '--base', 'a'.repeat(40)), { code: 2, lines: ['churn: unknown'] });
    assert.equal(run(s.root, 'churn', SLUG, '1', '--base', '--oops').code, 3);
  });

  test('a record that cannot be read gives churn: unknown, not a pass', () => {
    const { root, base } = scenario(['R-3 a.txt:12 — x — fix']);
    fs.writeFileSync(path.join(folder(root), 'review-loop.jsonl'), 'garbage\n');
    assert.deepEqual(run(root, 'churn', SLUG, '1', '--base', base), { code: 2, lines: ['churn: unknown'] });
  });

  test('a plan-mode fresh reviewer finding is not code churn', () => {
    const { root, base } = scenario(['R-3 a.txt:40 — x — fix']);
    fs.writeFileSync(path.join(folder(root), '05-fresh-reviewer.md'),
      `---\nstep: 05\nrole: fresh-reviewer\ntask: ${SLUG}\nstatus: done\nround: 1\nreview-mode: plan\n---\nBy: t\n## Blocking\n- R-1 a.txt:12 — plan finding — fix\n## Next\n- x\n`);
    assert.deepEqual(run(root, 'churn', SLUG, '1', '--base', base).lines, ['churn: none']);
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

  test('a marked round needs --base; with it the churn lines reach the gate', () => {
    const { root, base } = makeRepo();
    handoff(root, '02-code-reviewer.md', 'code-reviewer', 0, ['R-1 b.txt:3 — x — fix']);
    run(root, 'mark', SLUG, '1', '--base', base);
    commitEdit(root, 'a.txt', (l) => l.map((x, i) => (i >= 9 && i <= 13 ? `${x} fixed` : x)));
    handoff(root, '04-code-reviewer.md', 'code-reviewer', 1, ['R-3 a.txt:12 — new — fix']);
    assert.deepEqual(run(root, 'gate', SLUG), { code: 2, lines: ['churn: unknown'] });
    assert.deepEqual(run(root, 'gate', SLUG, '--base', base).lines, ['churn 04-code-reviewer:R-3 a.txt:12']);
  });

  test('single lists a one-sided Blocking finding and not overlapping ones', () => {
    const { root } = makeRepo();
    handoff(root, '02-code-reviewer.md', 'code-reviewer', 0, ['R-1 a.txt:10-14 — shared — fix', 'R-2 b.txt:3 — only mine — fix']);
    fs.writeFileSync(path.join(folder(root), '03-fresh-reviewer.md'),
      `---\nstep: 03\nrole: fresh-reviewer\ntask: ${SLUG}\nstatus: done\nround: 0\nreview-mode: code\nmodel: opus\n---\nBy: t\n## Blocking\n- R-1 a.txt:12 — shared — fix\n- R-2 a.txt:40 — only theirs — fix\n## Next\n- x\n`);
    const r = run(root, 'gate', SLUG);
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, ['single 02-code-reviewer:R-2 b.txt', 'single 03-fresh-reviewer:R-2 a.txt']);
  });

  const freshCode = (root, name, rows) => fs.writeFileSync(path.join(folder(root), name),
    `---\nstep: 03\nrole: fresh-reviewer\ntask: ${SLUG}\nstatus: done\nround: 0\nreview-mode: code\nmodel: opus\n---\nBy: t\n## Blocking\n${rows.map((r) => `- ${r}`).join('\n')}\n## Next\n- x\n`);

  test('one reviewer blocks and the other is clear: single is printed', () => {
    const { root } = makeRepo();
    handoff(root, '02-code-reviewer.md', 'code-reviewer', 0, ['R-1 a.txt:10 — x — fix']);
    freshCode(root, '03-fresh-reviewer.md', []);
    assert.deepEqual(run(root, 'gate', SLUG).lines, ['single 02-code-reviewer:R-1 a.txt']);
  });

  test('the second reviewer blocks and the Code Reviewer is clear: single is printed', () => {
    const { root } = makeRepo();
    handoff(root, '02-code-reviewer.md', 'code-reviewer', 0, []);
    freshCode(root, '03-fresh-reviewer.md', ['R-1 a.txt:12 — x — fix']);
    assert.deepEqual(run(root, 'gate', SLUG).lines, ['single 03-fresh-reviewer:R-1 a.txt']);
  });

  test('a Blocking row with no readable location prints single <key> ?', () => {
    const { root } = makeRepo();
    handoff(root, '02-code-reviewer.md', 'code-reviewer', 0, ['R-1 the plan is vague — fix it']);
    freshCode(root, '03-fresh-reviewer.md', []);
    assert.deepEqual(run(root, 'gate', SLUG).lines, ['single 02-code-reviewer:R-1 ?']);
  });

  test('a plan-mode fresh reviewer does not count as the second reviewer', () => {
    const { root } = makeRepo();
    handoff(root, '02-code-reviewer.md', 'code-reviewer', 0, ['R-1 a.txt:10 — x — fix']);
    fs.writeFileSync(path.join(folder(root), '03-fresh-reviewer.md'),
      `---\nstep: 03\nrole: fresh-reviewer\ntask: ${SLUG}\nstatus: done\nround: 0\nreview-mode: plan\n---\nBy: t\n## Next\n- x\n`);
    assert.deepEqual(run(root, 'gate', SLUG).lines, ['review-loop: nothing to report']);
  });

  test('no second reviewer Handoff means no single lines', () => {
    const { root } = makeRepo();
    handoff(root, '02-code-reviewer.md', 'code-reviewer', 0, ['R-1 a.txt:10 — x — fix']);
    assert.deepEqual(run(root, 'gate', SLUG).lines, ['review-loop: nothing to report']);
  });
});
