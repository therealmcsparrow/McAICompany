// Red tests for plan-check v1.7 and plan-review v1.4 (T23): a v3 run slug `<ProjectID>/<NN>-<playbook>` is accepted by
// plan-check (gate, off, wave, verify, read, readRecord), plan-check-verdict (verdict, history) and plan-review
// (lines, majors, gate). AC18 (v3 slugs pass the checks) and AC12 (reader rule: v2, v1.1 and legacy stay byte-identical).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main as check, readRecord } from './plan-check.mjs';
import { main as verdictMain } from './plan-check-verdict.mjs';
import { main as review } from './plan-review.mjs';

const HERE = import.meta.dirname;
const NOW = Date.parse('2026-11-09T10:20:30Z');
const ID = 'P20261109.000009';
const V3 = `${ID}/01-feature`;
const V3B = `${ID}/02-fix`;
const V2 = `${ID}-15.52.35`;
const KEY = `${ID}~01-feature`;
const PLAN = '02-plan.md';
const RPLAN = '02-architect-plan.md';
const TASK_PLAN = `# Plan\n\n### ${ID}-T5 build it\n- do the thing, TBD\n\n## Steps\n1. fine\n`;

const temps = [];
after(() => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-check-v3-'));
  temps.push(d);
  return d;
};
const put = (root, rel, text) => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const work = (slug, ...rest) => ['.company', 'work', slug, ...rest].join('/');
const recFile = (root, slug) => path.join(root, ...work(slug, 'plan-check.jsonl').split('/'));
const records = (root, slug) => fs.readFileSync(recFile(root, slug), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const cli = (root, args) => check(args, { now: NOW, root });

function root3(slug = V3, text = TASK_PLAN) {
  const root = tmp();
  put(root, work(slug, PLAN), text);
  return root;
}

// ---------------------------------------------------------------- plan-check

describe('plan-check on a v3 slug (AC18, AC12)', () => {
  test('gate warn scans the plan in the run folder and records under the v3 folder', () => {
    const root = root3();
    const r = cli(root, ['gate', V3, PLAN, '--policy', 'warn']);
    assert.deepEqual(r, { code: 0, lines: ['plan-check (warn): 1 open decision, 0 decided', '02-plan.md:4 | TBD | a placeholder: the plan does not say what to build here'] });
    const recs = records(root, V3);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].ev, 'scan');
    assert.equal(recs[0].plan, PLAN);
    assert.equal(fs.existsSync(path.join(root, '.company', 'work', `${ID}~01-feature`)), false);
  });

  test('gate output is byte-identical for a v3 slug and a v2 slug with the same plan (AC12)', () => {
    const a = cli(root3(V3), ['gate', V3, PLAN, '--policy', 'block']);
    const b = cli(root3(V2), ['gate', V2, PLAN, '--policy', 'block']);
    assert.deepEqual(a, b);
    assert.equal(a.lines.length, 2, 'summary line plus one finding row');
    assert.equal(a.code, b.code);
  });

  test('gate --json for a v3 slug has the v1 shape and the finding row', () => {
    const r = cli(root3(), ['gate', V3, PLAN, '--policy', 'warn', '--json']);
    assert.equal(r.code, 0);
    const obj = JSON.parse(r.lines.join('\n'));
    assert.equal(obj.v, 1);
    assert.equal(obj.count, 1);
    assert.equal(obj.findings[0].file, PLAN);
    assert.equal('slug' in obj, false, 'v1.6 --json has no slug key');
  });

  test('read, wave, off and verify work on a v3 slug', () => {
    const root = root3();
    assert.equal(cli(root, ['gate', V3, PLAN, '--policy', 'warn']).code, 0);
    const read = cli(root, ['read', V3]);
    assert.equal(read.code, 0);
    const view = JSON.parse(read.lines.join('\n'));
    assert.equal(view.slug, V3);
    assert.equal(view.state, 'on');
    assert.equal(cli(root, ['wave', V3, '1']).code, 0);
    assert.equal(records(root, V3).at(-1).ev, 'wave');
    const ver = cli(root, ['verify', V3, PLAN]);
    assert.notEqual(ver.code, 3, ver.lines.join('\n'));
    assert.equal(cli(root, ['off', V3]).code, 0);
    assert.equal(records(root, V3).at(-1).ev, 'off');
  });

  test('readRecord takes a v3 slug: none before any scan, the slug as given after one', () => {
    const root = root3();
    assert.deepEqual(readRecord(root, V3), { v: 1, slug: V3, state: 'none' });
    cli(root, ['gate', V3, PLAN, '--policy', 'warn']);
    const view = readRecord(root, V3);
    assert.equal(view.slug, V3);
    assert.equal(view.state, 'on');
  });

  test('two runs of one project keep separate records', () => {
    const root = root3();
    put(root, work(V3B, PLAN), '# Plan\n## Steps\n1. fine\n');
    assert.equal(cli(root, ['gate', V3, PLAN, '--policy', 'warn']).code, 0);
    assert.equal(cli(root, ['gate', V3B, PLAN, '--policy', 'warn']).code, 0);
    assert.equal(records(root, V3).length, 1);
    assert.equal(records(root, V3B).length, 1);
    assert.equal(records(root, V3)[0].findings, 1);
    assert.equal(records(root, V3B)[0].findings, 0);
  });

  test('a malformed v3 slug is refused with exit 3 and nothing written (after a good one passes)', () => {
    const root = root3();
    put(root, work(`${ID}/01-x`, PLAN), TASK_PLAN);
    assert.equal(cli(root, ['gate', V3, PLAN, '--policy', 'warn']).code, 0, 'a valid v3 slug is accepted');
    const bad = [ID, `${ID}/`, `${ID}/1-x`, `${ID}/01-Bad`, `${ID}/01-x/extra`, `${ID}\\01-feature`, `${ID}/../${ID}/01-feature`, `${ID}/00-x`, `${ID}/01-feature/`, `P20261109.0000090/01-x`];
    for (const slug of bad) {
      const r = cli(root, ['gate', slug, PLAN, '--policy', 'warn']);
      assert.equal(r.code, 3, `${slug}: ${r.lines.join('|')}`);
      assert.equal(r.lines[0], 'refused: bad slug');
    }
    assert.equal(fs.existsSync(recFile(root, `${ID}/01-x`)), false);
  });

  test('a v3 slug without a run folder is refused, a wrongly spelled one too', () => {
    const root = root3();
    assert.equal(cli(root, ['gate', V3, PLAN, '--policy', 'warn']).code, 0, 'a valid v3 slug is accepted');
    const missing = cli(root, ['gate', `${ID}/09-feature`, PLAN, '--policy', 'warn']);
    assert.equal(missing.code, 3);
    assert.match(missing.lines[0], /^refused: /);
    assert.equal(fs.existsSync(path.join(root, '.company', 'work', ID, '09-feature')), false);
  });

  test('a project folder that is a plain file is refused for its run', () => {
    const root = tmp();
    put(root, `.company/work/${ID}`, 'not a folder');
    const r = cli(root, ['gate', V3, PLAN, '--policy', 'warn']);
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: /);
    assert.equal(cli(root3(), ['gate', V3, PLAN, '--policy', 'warn']).code, 0, 'the same slug works when the folder is real');
  });

  test('spawned CLI accepts a v3 slug (the argument holds one /)', () => {
    const root = root3();
    const r = spawnSync(process.execPath, [path.join(HERE, 'plan-check.mjs'), 'gate', V3, PLAN, '--policy', 'warn'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stdout, 'plan-check (warn): 1 open decision, 0 decided\n02-plan.md:4 | TBD | a placeholder: the plan does not say what to build here\n');
  });

  test('a v2 slug and a legacy slug keep working (AC12)', () => {
    for (const slug of [V2, 'demo']) {
      const root = root3(slug);
      assert.equal(cli(root, ['gate', slug, PLAN, '--policy', 'warn']).code, 0);
      assert.equal(readRecord(root, slug).slug, slug);
    }
    const root = root3(V3);
    assert.equal(cli(root, ['gate', V3, PLAN, '--policy', 'warn']).code, 0);
  });
});

// ---------------------------------------------------------------- plan-check-verdict

const verdict = (root, args) => verdictMain(args, { root });

describe('plan-check-verdict on v3 runs (AC12)', () => {
  const planPath = (slug) => work(slug, PLAN);

  test('history scans the plan of a v3 run from the working tree and prints its path', () => {
    const root = tmp();
    put(root, planPath(V3), '# Plan\n## Steps\n1. TBD\n');
    const r = verdict(root, ['history']);
    assert.equal(r.code, 0, r.lines.join('|'));
    assert.ok(r.lines.some((l) => l.startsWith(`.company/work/${V3}/${PLAN}@`) && l.endsWith(': 1 findings')), r.lines.join('|'));
    assert.equal(r.lines.at(-1), 'history: 1 plans, 1 findings, false-positive rate: no labels');
  });

  test('history lists a v2 plan and a v3 plan side by side', () => {
    const root = tmp();
    put(root, planPath(V2), '# Plan\n## Steps\n1. TBD\n');
    put(root, planPath(V3), '# Plan\n## Steps\n1. TBD\n');
    const r = verdict(root, ['history']);
    assert.equal(r.code, 0);
    assert.equal(r.lines.at(-1), 'history: 2 plans, 2 findings, false-positive rate: no labels');
  });

  test('history ignores a plan two folders below a v3 run and a plan in a bare project folder', () => {
    const root = tmp();
    put(root, planPath(V3), '# Plan\n## Steps\n1. TBD\n');
    put(root, `.company/work/${V3}/deep/${PLAN}`, '# Plan\n## Steps\n1. TBD\n');
    put(root, `.company/work/${ID}/${PLAN}`, '# Plan\n## Steps\n1. TBD\n');
    const r = verdict(root, ['history']);
    assert.equal(r.lines.at(-1), 'history: 1 plans, 1 findings, false-positive rate: no labels');
  });

  test('verdict counts v3 runs: ledger file named by runKey, ship record run is the slug', () => {
    const root = tmp();
    const day = (i) => `2026-10-${String(10 + i).padStart(2, '0')}`;
    const mk = (slug, i, side, fix) => {
      const dir = work(slug);
      const d = day(i);
      put(root, `${dir}/00-summary.md`, '# done\n');
      put(root, `${dir}/${PLAN}`, '# Plan\n');
      put(root, `${dir}/03-backend-engineer.md`, `---\nstep: 03\nrole: backend-engineer\ntask: x\nstatus: done\nround: ${fix}\nbase-commit: abc1234\nrisk-tier: medium\n---\n## Did\n`);
      put(root, `${dir}/run-state.jsonl`, [
        { v: 1, at: `${d}T08:00:00Z`, ev: 'start' },
        { v: 1, at: `${d}T12:00:00Z`, ev: 'gate', gate: 'ship', result: 'passed' }
      ].map((o) => JSON.stringify(o)).join('\n') + '\n');
      if (side === 'on') put(root, `${dir}/plan-check.jsonl`, `${JSON.stringify({ v: 1, at: `${d}T08:30:00Z`, ev: 'scan', policy: 'warn', plan: PLAN, patterns: 'abcdef012345', findings: 0, decided: 0 })}\n`);
      // Step files and summary dated before the ship gate answer, so the round counts (plan-check v1.7 handoffRounds)
      const t = new Date(`${d}T09:00:00Z`);
      for (const f of ['00-summary.md', PLAN, '03-backend-engineer.md']) fs.utimesSync(path.join(root, ...work(slug, f).split('/')), t, t);
      const key = slug.replace('/', '~');
      put(root, `.company/ledger/${key}.jsonl`, `${JSON.stringify({ v: 1, run: slug, kind: 'ship', acs: 3, fix_rounds: fix })}\n`);
    };
    for (let i = 0; i < 3; i += 1) mk(`P2026101${i}.00000${i + 1}/01-feature`, i, 'base', 2);
    for (let i = 0; i < 3; i += 1) mk(`P2026102${i}.00000${i + 1}/01-feature`, i + 3, 'on', 0);
    const r = verdict(root, ['verdict', '--runs', '3']);
    assert.equal(r.code, 0, r.lines.join('|'));
    assert.match(r.lines[0], /^plan-check verdict: pass \| check on: median 0\.0 \(n=3\) \| baseline: median 2\.0 \(n=3\)/);
  });
});

// ---------------------------------------------------------------- plan-review

const FIX = path.resolve(HERE, '..', 'tests', 'fixtures', 'plan-review');

function product(slug = V3, planText = fs.readFileSync(path.join(FIX, 'plan.md'), 'utf8')) {
  const root = tmp();
  fs.cpSync(path.join(FIX, 'root'), root, { recursive: true });
  const dir = work(slug);
  put(root, `${dir}/${RPLAN}`, planText);
  put(root, `${dir}/01-product-manager.md`, '# pm\n');
  put(root, `${dir}/02-architect.md`, '# architect\n');
  put(root, '.company/standards.md', '# standards\n');
  return root;
}
const rv = (root, ...args) => review(args, { root, now: NOW });
const handoff = () => [
  '---', 'step: 04', 'role: fresh-reviewer', 'review-mode: plan', 'status: done', 'round: 0', '---',
  'By: Fenna (fresh-reviewer)', '## Paraphrase', 'The plan builds a server and a util module, in that order.', '## First pass', '- R-1 a', '- R-2 b',
  '## Decisions', '- none', '## Blocking', '- [comprehension] R-1 a.md:1 — unclear — rewrite', '## Next', '- x', ''
].join('\n');

describe('plan-review on a v3 slug (AC12)', () => {
  test('lines writes inputs.md inside the v3 run folder and names it with the v3 path', () => {
    const root = product();
    const r = rv(root, 'lines', V3, RPLAN, '--mode', 'plan', '--after', '02-architect.md');
    assert.equal(r.code, 0, r.lines.join('|'));
    assert.deepEqual(r.lines.slice(0, 3), [
      'Input Handoffs: none: plan review',
      `Review inputs: .company/work/${V3}/plan-review/inputs.md`,
      `After first pass: .company/work/${V3}/02-architect.md`
    ]);
    const text = fs.readFileSync(path.join(root, '.company', 'work', ID, '01-feature', 'plan-review', 'inputs.md'), 'utf8');
    assert.match(text, new RegExp(`^## Plan\\n\\.company/work/${V3}/${RPLAN}\\n`));
  });

  test('lines output is identical for a v2 slug apart from the path (AC12)', () => {
    const a = rv(product(V3), 'lines', V3, RPLAN, '--mode', 'plan', '--after', '02-architect.md');
    const b = rv(product(V2), 'lines', V2, RPLAN, '--mode', 'plan', '--after', '02-architect.md');
    assert.equal(a.code, 0);
    assert.deepEqual(a.lines.map((l) => l.replaceAll(V3, 'S')), b.lines.map((l) => l.replaceAll(V2, 'S')));
  });

  test('majors finds a Contract major in a v3 run plan; no major gives exit 4', () => {
    const root = product(V3, '# Plan\n\n- token-ledger v1.8 → v2.0\n');
    assert.deepEqual(rv(root, 'majors', V3, RPLAN), { code: 0, lines: ['contract major: line 3'] });
    const quiet = product(V3, '# Plan\n\nnothing here\n');
    assert.deepEqual(rv(quiet, 'majors', V3, RPLAN), { code: 4, lines: ['plan review: not run (no Contract major)'] });
  });

  test('gate reads a Handoff in the v3 run folder', () => {
    const root = product();
    put(root, work(V3, '04-fresh-reviewer.md'), handoff());
    const r = rv(root, 'gate', V3, '04-fresh-reviewer.md');
    assert.equal(r.code, 0, r.lines.join('|'));
    assert.deepEqual(r.lines.slice(-2), ['first pass: 2 findings', 'comprehension 04-fresh-reviewer:R-1']);
  });

  test('a malformed v3 slug is refused with exit 3 (after a good one passes)', () => {
    const root = product();
    assert.equal(rv(root, 'majors', V3, RPLAN).code, 4, 'a valid v3 slug is accepted');
    for (const slug of [ID, `${ID}/`, `${ID}/1-x`, `${ID}/01-feature/x`, `${ID}\\01-feature`, `${ID}/../${V3}`, `${ID}/01-Feature`]) {
      const r = rv(root, 'majors', slug, RPLAN);
      assert.equal(r.code, 3, `${slug}: ${r.lines.join('|')}`);
      assert.equal(r.lines[0], 'refused: bad slug');
    }
  });

  test('a v3 slug whose run folder is missing is refused and nothing is written', () => {
    const root = product();
    assert.equal(rv(root, 'majors', V3, RPLAN).code, 4, 'a valid v3 slug is accepted');
    const r = rv(root, 'lines', V3B, RPLAN, '--mode', 'plan', '--after', '02-architect.md');
    assert.equal(r.code, 3);
    assert.equal(fs.existsSync(path.join(root, '.company', 'work', ID, '02-fix')), false);
  });

  test('a v2 slug and a legacy slug keep working (AC12)', () => {
    for (const slug of [V2, 'demo']) {
      assert.equal(rv(product(slug, '# Plan\n\nnothing\n'), 'majors', slug, RPLAN).code, 4);
    }
    assert.equal(rv(product(V3, '# Plan\n\nnothing\n'), 'majors', V3, RPLAN).code, 4);
  });
});
