import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './plan-review.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const CASES = path.join(REPO, 'tests', 'plan-review');
const REAL_EVAL = path.join(CASES, 'eval.jsonl');
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const MAX_PLAN_BYTES = 256 * 1024;

const SEEDS = ['ac-without-task', 'contract-break', 'missing-depends-on', 'shared-hot-file', 'trust-rule'];
const CONTROL = 'control';
const TAGS = ['contract', 'spec', 'security', 'test', 'comprehension'];

const caseText = (name, file) => fs.readFileSync(path.join(CASES, name, file), 'utf8');
const planLines = (name) => caseText(name, 'plan.md').split('\n').slice(0, -1);
const expectedOf = (name) => JSON.parse(caseText(name, 'expected.json'));
const rangeText = (name) => {
  const [a, b] = expectedOf(name).lines;
  return planLines(name).slice(a - 1, b);
};

const realEvalBefore = fs.existsSync(REAL_EVAL) ? fs.readFileSync(REAL_EVAL, 'utf8') : null;
const temps = [];
after(() => {
  for (const t of temps) fs.rmSync(t, { recursive: true, force: true });
  const now = fs.existsSync(REAL_EVAL) ? fs.readFileSync(REAL_EVAL, 'utf8') : null;
  assert.equal(now, realEvalBefore, 'the eval record of the repo is never written by a test');
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-review-eval-'));
  temps.push(dir);
  return dir;
}

function put(root, rel, text) {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

describe('AC3 fixture set', () => {
  test('holds exactly the five seeded cases and one control, each with plan.md and expected.json only', () => {
    const dirs = fs.readdirSync(CASES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    assert.deepEqual(dirs, [...SEEDS, CONTROL].sort());
    for (const d of dirs) {
      assert.deepEqual(fs.readdirSync(path.join(CASES, d)).sort(), ['expected.json', 'plan.md'], d);
    }
  });

  test('the control expected.json is exactly the control shape', () => {
    assert.deepEqual(expectedOf(CONTROL), { v: 1, control: true });
  });

  test('every seeded expected.json has exactly the scored keys, its own plan path and a known tag', () => {
    for (const name of SEEDS) {
      const e = expectedOf(name);
      assert.deepEqual(Object.keys(e).sort(), ['file', 'lines', 'tag', 'v'], name);
      assert.equal(e.v, 1);
      assert.equal(e.file, `tests/plan-review/${name}/plan.md`);
      assert.ok(TAGS.includes(e.tag), name);
      assert.ok(Array.isArray(e.lines) && e.lines.length === 2 && e.lines.every(Number.isInteger), name);
      assert.ok(e.lines[0] >= 1 && e.lines[0] <= e.lines[1], name);
    }
  });

  test('every seeded range exists in its plan.md', () => {
    for (const name of SEEDS) {
      const e = expectedOf(name);
      assert.ok(e.lines[1] <= planLines(name).length, `${name}: range ends past the last line`);
      assert.equal(rangeText(name).length, e.lines[1] - e.lines[0] + 1, name);
    }
  });

  test('every seeded range holds the seeded text', () => {
    const marker = {
      'contract-break': (r) => r.length === 1 && /reads the run name from the current git branch/.test(r[0]),
      'missing-depends-on': (r) => /^### T3 /.test(r[0]) && r.includes('- depends-on: none') && r.some((l) => /imports `readParallel` from `\.\/plan-tasks\.mjs`/.test(l)),
      'trust-rule': (r) => r.length === 1 && /without the commit-path filter/.test(r[0]),
      'shared-hot-file': (r) => r.filter((l) => /^- files: .*package\.json/.test(l)).length === 2,
      'ac-without-task': (r) => r.length === 1 && /^\| AC16 \| .* \| T7 \|$/.test(r[0])
    };
    assert.deepEqual(Object.keys(marker).sort(), SEEDS);
    for (const name of SEEDS) assert.ok(marker[name](rangeText(name)), name);
  });

  test('the only difference from the control lies inside the expected range', () => {
    const base = planLines(CONTROL);
    for (const name of SEEDS) {
      const plan = planLines(name);
      let head = 0;
      while (head < base.length && head < plan.length && base[head] === plan[head]) head += 1;
      let tail = 0;
      while (tail < base.length - head && tail < plan.length - head && base[base.length - 1 - tail] === plan[plan.length - 1 - tail]) tail += 1;
      assert.ok(plan.length > head + tail, `${name}: plan equals the control`);
      const [a, b] = expectedOf(name).lines;
      assert.ok(head + 1 >= a && plan.length - tail <= b, `${name}: changed lines ${head + 1}-${plan.length - tail} outside ${a}-${b}`);
    }
  });

  test('the control holds none of the seeded text and keeps the dependency the seed removes', () => {
    const control = caseText(CONTROL, 'plan.md');
    assert.doesNotMatch(control, /reads the run name from the current git branch/);
    assert.doesNotMatch(control, /without the commit-path filter/);
    assert.doesNotMatch(control, /^\| AC16 \|/m);
    assert.doesNotMatch(control, /^- files: .*package\.json/m);
    assert.equal(planLines(CONTROL)[67], '- depends-on: T1');
  });
});

describe('contract-break seed is contradicted only by the cited Contract', () => {
  test('the Contract the plan cites holds the rule the seeded line breaks', () => {
    const contract = fs.readFileSync(path.join(REPO, 'docs', 'contracts', 'token-ledger.md'), 'utf8');
    assert.match(contract, /It is never derived from a branch, a session or a time window\./);
    assert.match(caseText('contract-break', 'plan.md'), /^\| `token-ledger` \| v1\.2 → \*\*v1\.3\*\* \|/m);
  });

  test('no other line of the plan speaks of a branch or of deriving the run name', () => {
    const plan = planLines('contract-break');
    const [seeded] = expectedOf('contract-break').lines;
    plan.forEach((line, i) => {
      if (i + 1 === seeded) return;
      assert.doesNotMatch(line, /\bbranch(es)?\b/i, `line ${i + 1}`);
      assert.doesNotMatch(line, /derive[sd]? (from|the run)/i, `line ${i + 1}`);
    });
  });
});

describe('fixture hygiene', () => {
  test('plan.md and expected.json are LF only, UTF-8 without a byte order mark, ending in one line feed', () => {
    for (const name of [...SEEDS, CONTROL]) {
      for (const file of ['plan.md', 'expected.json']) {
        const buf = fs.readFileSync(path.join(CASES, name, file));
        assert.ok(!buf.includes(13), `${name}/${file} holds a CR`);
        assert.notDeepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name}/${file} has a BOM`);
        assert.equal(buf[buf.length - 1], 10, `${name}/${file}`);
        assert.notEqual(buf[buf.length - 2], 10, `${name}/${file} ends in a blank line`);
        assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(buf).length > 0, true);
      }
      assert.ok(fs.statSync(path.join(CASES, name, 'plan.md')).size <= MAX_PLAN_BYTES, name);
    }
  });

  test('no plan carries a Name: line or a roster display name', () => {
    const names = Object.values(JSON.parse(fs.readFileSync(path.join(REPO, 'company', 'names.json'), 'utf8')));
    assert.ok(names.length >= 30);
    for (const name of [...SEEDS, CONTROL]) {
      const text = caseText(name, 'plan.md');
      assert.doesNotMatch(text, /^\s*Name:/m, name);
      assert.match(text, /^By: architect\./m, name);
      for (const n of names) {
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${n}(?![\\p{L}\\p{N}])`, 'u');
        assert.doesNotMatch(text, re, `${name} holds the display name ${n}`);
      }
    }
  });

  test('every plan is a plan with seven tasks and the four task fields each', () => {
    for (const name of [...SEEDS, CONTROL]) {
      const plan = planLines(name);
      const heads = plan.filter((l) => /^### T\d+ /.test(l));
      assert.equal(heads.length, 7, name);
      for (const field of ['role', 'files', 'depends-on', 'parallel']) {
        assert.equal(plan.filter((l) => l.startsWith(`- ${field}: `)).length, 7, `${name} ${field}`);
      }
    }
  });
});

describe('lines reads a seeded plan', () => {
  test('the Contract the contract-break plan cites is listed for the reader', () => {
    const root = tmp();
    fs.cpSync(path.join(REPO, 'docs', 'contracts'), path.join(root, 'docs', 'contracts'), { recursive: true });
    put(root, '.company/work/demo/02-architect-plan.md', caseText('contract-break', 'plan.md'));
    put(root, '.company/work/demo/02-architect.md', '# architect\n');
    const r = main(['lines', 'demo', '02-architect-plan.md', '--mode', 'plan', '--after', '02-architect.md'], { root, now: NOW });
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines.slice(0, 3), [
      'Input Handoffs: none: plan review',
      'Review inputs: .company/work/demo/plan-review/inputs.md',
      'After first pass: .company/work/demo/02-architect.md'
    ]);
    const inputs = fs.readFileSync(path.join(root, '.company', 'work', 'demo', 'plan-review', 'inputs.md'), 'utf8').split('\n');
    assert.ok(inputs.includes('docs/contracts/token-ledger.md'));
    assert.ok(inputs.includes('docs/contracts/aico-settings.md'));
  });
});

const NAMES = [...SEEDS, CONTROL].sort();

// A staging root: the cases at tests/plan-review and an empty results folder, outside the repo.
function stage() {
  const root = tmp();
  fs.cpSync(CASES, path.join(root, 'tests', 'plan-review'), { recursive: true, filter: (src) => path.basename(src) !== 'eval.jsonl' });
  fs.mkdirSync(path.join(root, 'work', 'results'), { recursive: true });
  return root;
}

function resultText(rows, role = 'fresh-reviewer') {
  const paraphrase = 'The plan splits one feature into seven tasks, each with a role, a file list, a dependency list and a parallel mark. '
    + 'It shows the order the tasks run in, the contracts it changes and a map from each acceptance criterion to the tasks that prove it.';
  return [
    '---', 'step: 04', `role: ${role}`, 'task: eval', 'review-mode: plan', 'status: done', 'round: 0', 'base-commit: 922f4ef', 'risk-tier: high',
    'acceptance-ids: [AC3]', 'contracts: [plan-review v1]', '---',
    `By: ${role}`, '## Paraphrase', paraphrase, '## First pass', '- none', '## Did', '- read the plan', '## Decisions', '- none',
    '## Blocking', ...(rows.length === 0 ? ['- none'] : rows), '## Next', '- none', ''
  ].join('\n');
}

const rowFor = (name, n, tag, at) => {
  const e = expectedOf(name);
  const where = at ?? `${e.lines[0]}`;
  return `- [${tag ?? e.tag}] R-${n} ${e.file}:${where} — the task contradicts the plan or a cited Contract — change the task`;
};

function writeResults(root, rowsByCase) {
  for (const [name, rows] of Object.entries(rowsByCase)) {
    put(root, `work/results/${name}.md`, resultText(rows));
  }
}

const score = (root, ...extra) => main(['score', 'tests/plan-review', 'work/results', ...extra], { root, now: NOW });
const caughtLine = (root, ...extra) => score(root, ...extra).lines.at(-1);

function allCaught(root) {
  writeResults(root, Object.fromEntries(SEEDS.map((s, i) => [s, [rowFor(s, i + 1)]])));
}

describe('AC3 scoring of hand-written results', () => {
  test('a result that flags every seed is caught 5 of 5 and the control is counted apart', () => {
    const root = stage();
    allCaught(root);
    put(root, 'work/results/control.md', resultText(['- [spec] R-1 tests/plan-review/control/plan.md:12 — something — fix it']));
    const r = score(root);
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, [
      'case ac-without-task caught',
      'case contract-break caught',
      'control control 1 blocking',
      'case missing-depends-on caught',
      'case shared-hot-file caught',
      'case trust-rule caught',
      'caught 5 of 5'
    ]);
  });

  test('the control is not in n: six case folders give n = 5, whatever the control holds', () => {
    const root = stage();
    allCaught(root);
    put(root, 'work/results/control.md', resultText([
      '- [spec] R-1 tests/plan-review/control/plan.md:12 — a — b', '- [contract] R-2 tests/plan-review/control/plan.md:60-70 — c — d', '- [security] R-3 tests/plan-review/control/plan.md — e — f'
    ]));
    const r = score(root);
    assert.ok(r.lines.includes('control control 3 blocking'));
    assert.equal(r.lines.at(-1), 'caught 5 of 5');
    assert.equal(r.lines.filter((l) => l.startsWith('case ')).length, 5);
  });

  test('a control with a none row prints 0 blocking, one with no result prints missing, and n stays 5', () => {
    const root = stage();
    allCaught(root);
    assert.ok(score(root).lines.includes('control control missing'));
    put(root, 'work/results/control.md', resultText([]));
    assert.ok(score(root).lines.includes('control control 0 blocking'));
    assert.equal(caughtLine(root), 'caught 5 of 5');
  });

  test('one seed missed is 4 of 5, which meets the target', () => {
    const root = stage();
    for (const missed of SEEDS) {
      allCaught(root);
      fs.rmSync(path.join(root, 'work', 'results', `${missed}.md`));
      const r = score(root);
      assert.ok(r.lines.includes(`case ${missed} missed`), missed);
      assert.equal(r.lines.at(-1), 'caught 4 of 5', missed);
    }
  });

  test('no result at all is 0 of 5', () => {
    const root = stage();
    const r = score(root);
    assert.equal(r.code, 0);
    assert.equal(r.lines.at(-1), 'caught 0 of 5');
    assert.ok(r.lines.includes('control control missing'));
  });

  test('a row one line before or after the range misses; the first and the last line of the range catch', () => {
    const root = stage();
    for (const name of SEEDS) {
      const e = expectedOf(name);
      const at = (where) => {
        writeResults(root, { [name]: [rowFor(name, 1, undefined, where)] });
        return score(root).lines.includes(`case ${name} caught`);
      };
      assert.equal(at(`${e.lines[0] - 1}`), false, `${name} before`);
      assert.equal(at(`${e.lines[1] + 1}`), false, `${name} after`);
      assert.equal(at(`${e.lines[0]}`), true, `${name} first`);
      assert.equal(at(`${e.lines[1]}`), true, `${name} last`);
      assert.equal(at(`${e.lines[0] - 5}-${e.lines[1] + 5}`), true, `${name} spanning`);
    }
  });

  test('a row on the whole plan file catches; a row on another case plan or on the Contract does not', () => {
    const root = stage();
    writeResults(root, { 'trust-rule': ['- [security] R-1 tests/plan-review/trust-rule/plan.md — the whole plan — change it'] });
    assert.ok(score(root).lines.includes('case trust-rule caught'));
    writeResults(root, { 'trust-rule': [
      '- [security] R-1 tests/plan-review/contract-break/plan.md:79 — wrong case — x',
      '- [security] R-2 docs/contracts/token-ledger.md:79 — wrong file — y'
    ] });
    assert.ok(score(root).lines.includes('case trust-rule missed'));
  });

  test('a row with several locations catches when any one overlaps', () => {
    const root = stage();
    writeResults(root, { 'contract-break': [
      '- [contract] R-1 docs/contracts/token-ledger.md:20, tests/plan-review/contract-break/plan.md:71 — breaks the Contract — change the task'
    ] });
    assert.ok(score(root).lines.includes('case contract-break caught'));
  });

  test('only Blocking rows count: a First pass bullet, a Decisions line or a Nits line on the range does not', () => {
    const root = stage();
    const e = expectedOf('trust-rule');
    const at = `${e.file}:79`;
    const text = [
      '---', 'step: 04', 'role: fresh-reviewer', 'review-mode: plan', 'status: done', 'round: 0', '---',
      'By: fresh-reviewer', '## Paraphrase', 'p', '## First pass', `- R-1 ${at} — seen`, '## Decisions', `- ${at} — kept`,
      '## Blocking', '- none', '## Nits', `- ${at} — nit`, '## Next', '- none', ''
    ].join('\n');
    assert.equal(text.split(`${e.file}:79`).length - 1, 3);
    put(root, 'work/results/trust-rule.md', text);
    assert.ok(score(root).lines.includes('case trust-rule missed'));
  });

  test('--tag: the row tag must equal the expected tag; without --tag any tag catches', () => {
    const root = stage();
    writeResults(root, Object.fromEntries(SEEDS.map((s, i) => [s, [rowFor(s, i + 1, 'test')]])));
    assert.equal(caughtLine(root), 'caught 5 of 5');
    assert.equal(caughtLine(root, '--tag'), 'caught 0 of 5');
    allCaught(root);
    assert.equal(caughtLine(root, '--tag'), 'caught 5 of 5');
    writeResults(root, { 'contract-break': [rowFor('contract-break', 1, 'spec')] });
    const r = score(root, '--tag');
    assert.ok(r.lines.includes('case contract-break missed'));
    assert.equal(r.lines.at(-1), 'caught 4 of 5');
  });

  test('a result from another Role counts as missed', () => {
    const root = stage();
    allCaught(root);
    put(root, 'work/results/shared-hot-file.md', resultText([rowFor('shared-hot-file', 1)], 'architect'));
    const r = score(root);
    assert.ok(r.lines.includes('case shared-hot-file missed'));
    assert.equal(r.lines.at(-1), 'caught 4 of 5');
  });

  test('a code-reviewer result is scored the same way', () => {
    const root = stage();
    put(root, 'work/results/contract-break.md', resultText([rowFor('contract-break', 1)], 'code-reviewer'));
    assert.ok(score(root).lines.includes('case contract-break caught'));
  });
});

describe('AC3 record', () => {
  test('--record appends one line with caught, total and the control sum, to the staged record only', () => {
    const root = stage();
    allCaught(root);
    put(root, 'work/results/control.md', resultText(['- [spec] R-1 tests/plan-review/control/plan.md:12 — a — b', '- [spec] R-2 tests/plan-review/control/plan.md:13 — c — d']));
    const r = score(root, '--record', '0.21.0');
    assert.equal(r.code, 0);
    assert.equal(r.lines.at(-1), 'caught 5 of 5');
    const file = path.join(root, 'tests', 'plan-review', 'eval.jsonl');
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1,"aico":"0.21.0","at":"2026-10-29T12:00:00Z","caught":5,"total":5,"control":2}\n');
    fs.rmSync(path.join(root, 'work', 'results', 'trust-rule.md'));
    score(root, '--record', '0.21.1');
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => [l.aico, l.caught, l.total]), [['0.21.0', 5, 5], ['0.21.1', 4, 5]]);
  });

  test('the staged copy of the cases leaves the repo cases untouched', () => {
    const before = NAMES.map((n) => caseText(n, 'plan.md') + caseText(n, 'expected.json'));
    const root = stage();
    allCaught(root);
    score(root, '--record', '0.21.0');
    assert.deepEqual(NAMES.map((n) => caseText(n, 'plan.md') + caseText(n, 'expected.json')), before);
  });
});
