import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './plan-review.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const CASES = path.join(REPO, 'tests', 'code-review');
const REAL_CODE_EVAL = path.join(CASES, 'eval.jsonl');
const REAL_PLAN_EVAL = path.join(REPO, 'tests', 'plan-review', 'eval.jsonl');
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);

const NAMES = ['mocked-unit', 'self-asserting-setup'];
const FILES = ['diff.patch', 'expected.json', 'plan.md'];

const caseText = (name, file) => fs.readFileSync(path.join(CASES, name, file), 'utf8');
const expectedOf = (name) => JSON.parse(caseText(name, 'expected.json'));

// Unified diff reader: { path, hunks: [{ oldStart, oldLen, newStart, newLen, added: Map<newLine, text>, counted }] } per file.
function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of text.split('\n').slice(0, -1)) {
    const head = /^\+\+\+ b\/(.+)$/.exec(line);
    if (head && (hunk === null || (hunk.oldSeen >= hunk.oldLen && hunk.newSeen >= hunk.newLen))) {
      file = { path: head[1], hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) {
      hunk = {
        oldLen: h[2] === undefined ? 1 : Number(h[2]),
        newLen: h[4] === undefined ? 1 : Number(h[4]),
        oldSeen: 0,
        newSeen: 0,
        added: new Map(),
        context: new Map()
      };
      oldLine = Number(h[1]);
      newLine = Number(h[3]);
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk || (hunk.oldSeen >= hunk.oldLen && hunk.newSeen >= hunk.newLen)) continue;
    const mark = line[0];
    if (mark === '+') {
      hunk.added.set(newLine, line.slice(1));
      newLine += 1;
      hunk.newSeen += 1;
    } else if (mark === '-') {
      oldLine += 1;
      hunk.oldSeen += 1;
    } else if (mark === ' ') {
      hunk.context.set(newLine, line.slice(1));
      oldLine += 1;
      newLine += 1;
      hunk.oldSeen += 1;
      hunk.newSeen += 1;
    }
  }
  return files;
}

const addedLine = (name, file, n) => {
  const f = parseDiff(caseText(name, 'diff.patch')).find((x) => x.path === file);
  for (const h of f?.hunks ?? []) if (h.added.has(n)) return h.added.get(n);
  return undefined;
};

const realEvalBefore = [REAL_CODE_EVAL, REAL_PLAN_EVAL].map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null));
const temps = [];
after(() => {
  for (const t of temps) fs.rmSync(t, { recursive: true, force: true });
  const now = [REAL_CODE_EVAL, REAL_PLAN_EVAL].map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null));
  assert.deepEqual(now, realEvalBefore, 'the eval records of the repo are never written by a test');
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-review-eval-'));
  temps.push(dir);
  return dir;
}

function put(root, rel, text) {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

describe('AC19 fixture set', () => {
  test('holds exactly the two code cases, each with plan.md, diff.patch and expected.json only', () => {
    const entries = fs.readdirSync(CASES, { withFileTypes: true }).filter((e) => e.name !== 'eval.jsonl');
    assert.deepEqual(entries.map((e) => e.name).sort(), NAMES);
    for (const e of entries) assert.ok(e.isDirectory(), e.name);
    for (const name of NAMES) assert.deepEqual(fs.readdirSync(path.join(CASES, name)).sort(), FILES, name);
  });

  test('every expected.json has exactly the scored keys, the tag test and a file the diff changes', () => {
    for (const name of NAMES) {
      const e = expectedOf(name);
      assert.deepEqual(Object.keys(e).sort(), ['file', 'lines', 'tag', 'v'], name);
      assert.equal(e.v, 1);
      assert.equal(e.tag, 'test', name);
      assert.ok(Array.isArray(e.lines) && e.lines.length === 2 && e.lines.every(Number.isInteger), name);
      assert.ok(e.lines[0] >= 1 && e.lines[0] <= e.lines[1], name);
      assert.ok(parseDiff(caseText(name, 'diff.patch')).some((f) => f.path === e.file), `${name}: ${e.file} is not in the diff`);
    }
  });

  test('every expected line is an added line on the new side of the diff', () => {
    for (const name of NAMES) {
      const e = expectedOf(name);
      for (let n = e.lines[0]; n <= e.lines[1]; n += 1) {
        assert.notEqual(addedLine(name, e.file, n), undefined, `${name}: new-side line ${n} of ${e.file} is not an added line`);
      }
    }
  });

  test('the expected range holds the seeded test text and nothing else of the diff', () => {
    const range = (name) => {
      const [a, b] = expectedOf(name).lines;
      return Array.from({ length: b - a + 1 }, (_, i) => addedLine(name, expectedOf(name).file, a + i));
    };
    const self = range('self-asserting-setup');
    assert.ok(self.some((l) => /const expected = 180;/.test(l)));
    assert.ok(self.some((l) => /assert\.equal\(discounted\.total, expected\);/.test(l)));
    assert.ok(!self.some((l) => /applyDiscount\(/.test(l)), 'the seeded test never calls the unit');
    const mocked = range('mocked-unit');
    assert.ok(mocked.some((l) => /mock\.method\(mailQueue, 'drain'/.test(l)));
    assert.ok(mocked.some((l) => /mailQueue\.drain\.mock\.callCount\(\)/.test(l)));
  });

  test('each hunk header counts the lines it holds, and the diff ends every hunk at a line feed', () => {
    for (const name of NAMES) {
      const text = caseText(name, 'diff.patch');
      assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), name);
      const files = parseDiff(text);
      assert.ok(files.length >= 2, `${name}: a source file and a test file`);
      for (const f of files) {
        assert.ok(f.hunks.length >= 1, `${name} ${f.path}`);
        for (const h of f.hunks) {
          assert.equal(h.oldSeen, h.oldLen, `${name} ${f.path} old side`);
          assert.equal(h.newSeen, h.newLen, `${name} ${f.path} new side`);
        }
      }
    }
  });

  test('the diff changes the unit and its test file, and the expected file is the test file', () => {
    for (const name of NAMES) {
      const paths = parseDiff(caseText(name, 'diff.patch')).map((f) => f.path);
      const test = expectedOf(name).file;
      assert.match(test, /\.test\.mjs$/);
      assert.ok(paths.includes(test.replace(/\.test\.mjs$/, '.mjs')), `${name}: the unit is in the diff`);
    }
  });

  test('the plan of each case lists the test task with the expected file in its files line', () => {
    for (const name of NAMES) {
      const plan = caseText(name, 'plan.md');
      const lines = plan.split('\n');
      assert.ok(lines.includes(`- files: ${expectedOf(name).file}`), name);
      assert.equal(lines.filter((l) => /^### T\d+ /.test(l)).length, 2, name);
      for (const field of ['role', 'files', 'depends-on', 'parallel']) {
        assert.equal(lines.filter((l) => l.startsWith(`- ${field}: `)).length, 2, `${name} ${field}`);
      }
    }
  });
});

describe('fixture hygiene', () => {
  test('every fixture file is LF only, UTF-8 without a byte order mark, ending in one line feed', () => {
    for (const name of NAMES) {
      for (const file of FILES) {
        const buf = fs.readFileSync(path.join(CASES, name, file));
        assert.ok(!buf.includes(13), `${name}/${file} holds a CR`);
        assert.notDeepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name}/${file} has a BOM`);
        assert.equal(buf[buf.length - 1], 10, `${name}/${file}`);
        assert.notEqual(buf[buf.length - 2], 10, `${name}/${file} ends in a blank line`);
        assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(buf), `${name}/${file}`);
      }
    }
  });

  test('no fixture holds a .git entry, a symlink or a folder beyond the case folders', () => {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        assert.notEqual(e.name, '.git', dir);
        assert.ok(!e.isSymbolicLink(), path.join(dir, e.name));
        if (e.isDirectory()) walk(path.join(dir, e.name));
      }
    };
    walk(CASES);
  });

  test('no fixture carries a Name: line or a roster display name; each plan is written by the architect', () => {
    const names = Object.values(JSON.parse(fs.readFileSync(path.join(REPO, 'company', 'names.json'), 'utf8')));
    assert.ok(names.length >= 30);
    for (const name of NAMES) {
      for (const file of FILES) {
        const text = caseText(name, file);
        assert.doesNotMatch(text, /^\s*Name:/m, `${name}/${file}`);
        for (const n of names) {
          const re = new RegExp(`(?<![\\p{L}\\p{N}])${n}(?![\\p{L}\\p{N}])`, 'u');
          assert.doesNotMatch(text, re, `${name}/${file} holds the display name ${n}`);
        }
      }
      assert.match(caseText(name, 'plan.md'), /^By: architect\./m, name);
    }
  });

  test('the diff names no seed, flaw, Step, reviewer or AI in a comment or a string', () => {
    for (const name of NAMES) {
      assert.doesNotMatch(caseText(name, 'diff.patch'), /\b(seed|seeded|flaw|bug|Step|Handoff|reviewer|agent|AI|Claude)\b/i, name);
    }
  });

  test('the diff never touches the paths of the repo it sits in', () => {
    for (const name of NAMES) {
      for (const f of parseDiff(caseText(name, 'diff.patch'))) {
        assert.ok(!path.isAbsolute(f.path) && !f.path.split('/').includes('..'), `${name} ${f.path}`);
        assert.ok(f.path.startsWith('src/'), `${name} ${f.path}`);
        assert.ok(!fs.existsSync(path.join(REPO, ...f.path.split('/'))), `${name}: ${f.path} exists in this repo`);
      }
    }
  });
});

// A staging root: the cases at tests/code-review and an empty results folder, outside the repo.
function stage() {
  const root = tmp();
  fs.cpSync(CASES, path.join(root, 'tests', 'code-review'), { recursive: true, filter: (src) => path.basename(src) !== 'eval.jsonl' });
  fs.mkdirSync(path.join(root, 'work', 'results'), { recursive: true });
  return root;
}

function resultText(rows, role = 'code-reviewer') {
  const fresh = role === 'fresh-reviewer';
  const fm = ['---', 'step: 04', `role: ${role}`, 'task: eval'];
  if (fresh) fm.push('review-mode: code', 'model: opus');
  fm.push('status: done', 'round: 0', 'base-commit: 922f4ef', 'risk-tier: high', 'acceptance-ids: [AC19]', 'contracts: [plan-review v1]', '---');
  const body = [`By: ${role}`];
  if (fresh) {
    body.push('## Paraphrase',
      'The change adds one function and its tests to a small module. The tests are meant to show that the function does what the plan says, '
      + 'including the failure case, and to fail when the function is wrong.',
      '## First pass', '- none');
  }
  body.push('## Did', '- read the plan and the diff', '## Decisions', '- none', '## Blocking', ...(rows.length === 0 ? ['- none'] : rows), '## Next', '- none', '');
  return [...fm, ...body].join('\n');
}

const rowFor = (name, n, tag, at) => {
  const e = expectedOf(name);
  return `- [${tag ?? e.tag}] R-${n} ${e.file}:${at ?? e.lines[0]} — the test does not exercise the unit it names — test the unit through its public signature`;
};

function writeResults(root, rowsByCase, role) {
  for (const [name, rows] of Object.entries(rowsByCase)) put(root, `work/results/${name}.md`, resultText(rows, role));
}

const allCaught = (root, role) => writeResults(root, Object.fromEntries(NAMES.map((s, i) => [s, [rowFor(s, i + 1)]])), role);
const score = (root, ...extra) => main(['score', 'tests/code-review', 'work/results', ...extra], { root, now: NOW });
const caughtLine = (root, ...extra) => score(root, ...extra).lines.at(-1);

describe('AC19 scoring of hand-written results', () => {
  test('a result that flags both cases with the tag test is caught 2 of 2 under --tag', () => {
    const root = stage();
    allCaught(root);
    const r = score(root, '--tag');
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, ['case mocked-unit caught', 'case self-asserting-setup caught', 'caught 2 of 2']);
  });

  test('a fresh-reviewer result in code mode scores the same as a code-reviewer result', () => {
    const root = stage();
    allCaught(root, 'fresh-reviewer');
    assert.equal(caughtLine(root, '--tag'), 'caught 2 of 2');
  });

  test('--tag: a row with another tag misses, and without --tag it still catches', () => {
    const root = stage();
    for (const tag of ['spec', 'contract', 'security', 'comprehension']) {
      writeResults(root, { 'mocked-unit': [rowFor('mocked-unit', 1, tag)], 'self-asserting-setup': [rowFor('self-asserting-setup', 2)] });
      const r = score(root, '--tag');
      assert.ok(r.lines.includes('case mocked-unit missed'), tag);
      assert.equal(r.lines.at(-1), 'caught 1 of 2', tag);
      assert.equal(caughtLine(root), 'caught 2 of 2', tag);
    }
  });

  test('a row with no tag at all misses under --tag', () => {
    const root = stage();
    const e = expectedOf('mocked-unit');
    writeResults(root, { 'mocked-unit': [`- R-1 ${e.file}:${e.lines[0]} — untagged — fix`] });
    assert.ok(score(root, '--tag').lines.includes('case mocked-unit missed'));
    assert.ok(score(root).lines.includes('case mocked-unit caught'));
  });

  test('one case flagged is 1 of 2; none is 0 of 2', () => {
    const root = stage();
    writeResults(root, { 'self-asserting-setup': [rowFor('self-asserting-setup', 1)] });
    const one = score(root, '--tag');
    assert.deepEqual(one.lines, ['case mocked-unit missed', 'case self-asserting-setup caught', 'caught 1 of 2']);
    fs.rmSync(path.join(root, 'work', 'results', 'self-asserting-setup.md'));
    assert.equal(caughtLine(root, '--tag'), 'caught 0 of 2');
  });

  test('a row one line before or after the range misses; the first and the last line of the range catch', () => {
    const root = stage();
    for (const name of NAMES) {
      const e = expectedOf(name);
      const at = (where) => {
        writeResults(root, { [name]: [rowFor(name, 1, undefined, where)] });
        return score(root, '--tag').lines.includes(`case ${name} caught`);
      };
      assert.equal(at(`${e.lines[0] - 1}`), false, `${name} before`);
      assert.equal(at(`${e.lines[1] + 1}`), false, `${name} after`);
      assert.equal(at(`${e.lines[0]}`), true, `${name} first`);
      assert.equal(at(`${e.lines[1]}`), true, `${name} last`);
      assert.equal(at(`${e.lines[0] - 3}-${e.lines[1] + 3}`), true, `${name} spanning`);
    }
  });

  test('a row on the whole test file catches; a row on the unit file or on the other case test file does not', () => {
    const root = stage();
    const e = expectedOf('mocked-unit');
    writeResults(root, { 'mocked-unit': [`- [test] R-1 ${e.file} — the whole file — change it`] });
    assert.ok(score(root, '--tag').lines.includes('case mocked-unit caught'));
    writeResults(root, { 'mocked-unit': [
      `- [test] R-1 ${e.file.replace('.test.mjs', '.mjs')}:${e.lines[0]} — the unit file — x`,
      `- [test] R-2 ${expectedOf('self-asserting-setup').file}:${e.lines[0]} — the other case — y`
    ] });
    assert.ok(score(root, '--tag').lines.includes('case mocked-unit missed'));
  });

  test('only Blocking rows count: a Nits line or a Decisions line on the range does not', () => {
    const root = stage();
    const e = expectedOf('self-asserting-setup');
    const at = `${e.file}:${e.lines[0]}`;
    put(root, 'work/results/self-asserting-setup.md', [
      '---', 'step: 04', 'role: code-reviewer', 'status: done', 'round: 0', '---', 'By: code-reviewer',
      '## Decisions', `- ${at} — kept`, '## Blocking', '- none', '## Nits', `- [test] ${at} — nit`, '## Next', '- none', ''
    ].join('\n'));
    assert.ok(score(root, '--tag').lines.includes('case self-asserting-setup missed'));
  });

  test('a result from another Role counts as missed', () => {
    const root = stage();
    allCaught(root);
    put(root, 'work/results/mocked-unit.md', resultText([rowFor('mocked-unit', 1)], 'qa'));
    const r = score(root, '--tag');
    assert.ok(r.lines.includes('case mocked-unit missed'));
    assert.equal(r.lines.at(-1), 'caught 1 of 2');
  });

  test('a row cited on a file the diff does not hold misses', () => {
    const root = stage();
    writeResults(root, { 'mocked-unit': ['- [test] R-1 src/mail/other.test.mjs:16 — wrong file — x'] });
    assert.ok(score(root, '--tag').lines.includes('case mocked-unit missed'));
  });
});

describe('AC19 record', () => {
  test('--record with --kind code appends one line to the staged code record and writes no plan record', () => {
    const root = stage();
    allCaught(root);
    const r = score(root, '--tag', '--record', '0.21.0', '--kind', 'code');
    assert.equal(r.code, 0);
    assert.equal(r.lines.at(-1), 'caught 2 of 2');
    const file = path.join(root, 'tests', 'code-review', 'eval.jsonl');
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1,"aico":"0.21.0","at":"2026-10-29T12:00:00Z","caught":2,"total":2}\n');
    assert.ok(!fs.existsSync(path.join(root, 'tests', 'plan-review')), 'the plan record folder is not made');
    fs.rmSync(path.join(root, 'work', 'results', 'mocked-unit.md'));
    score(root, '--tag', '--record', '0.21.1', '--kind', 'code');
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => [l.aico, l.caught, l.total]), [['0.21.0', 2, 2], ['0.21.1', 1, 2]]);
  });

  test('--kind without --record, or with another value, is refused and writes nothing', () => {
    const root = stage();
    allCaught(root);
    const noRecord = score(root, '--kind', 'code');
    assert.equal(noRecord.code, 3);
    const bad = score(root, '--record', '0.21.0', '--kind', 'other');
    assert.equal(bad.code, 3);
    assert.ok(!fs.existsSync(path.join(root, 'tests', 'code-review', 'eval.jsonl')));
  });

  test('without --kind the record goes to the plan file, never to the code file', () => {
    const root = stage();
    allCaught(root);
    score(root, '--tag', '--record', '0.21.0');
    assert.ok(fs.existsSync(path.join(root, 'tests', 'plan-review', 'eval.jsonl')));
    assert.ok(!fs.existsSync(path.join(root, 'tests', 'code-review', 'eval.jsonl')));
  });

  test('the staged copy leaves the repo cases untouched', () => {
    const before = NAMES.map((n) => FILES.map((f) => caseText(n, f)).join('\n'));
    const root = stage();
    allCaught(root);
    score(root, '--tag', '--record', '0.21.0', '--kind', 'code');
    assert.deepEqual(NAMES.map((n) => FILES.map((f) => caseText(n, f)).join('\n')), before);
  });
});
