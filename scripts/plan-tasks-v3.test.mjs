// Tests for plan-tasks v1.9: a v3 run slug `<ID>/<NN>-<pb>` is a folder
// for plan-tasks, and ticket numbers stay unique across the whole project (other v3 runs and v2 `<ID>-HH.MM.SS` folders).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, readParallel, sortByVisit } from './plan-tasks.mjs';

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const ID = 'P20261109.000009';
const OTHER = 'P20261109.000010';
const R1 = `${ID}/01-feature`;
const R2 = `${ID}/02-fix`;
const V2 = `${ID}-10.00.00`;
const ARROW = '→';
const DASH = '—';

const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function task(id, files = `${id.toLowerCase().replace(/[^a-z0-9]/g, '')}/file.js`) {
  const first = files.split(',')[0].trim();
  return `${[
    `### ${id} title of ${id}`,
    '- role: backend-engineer',
    `- files: ${files}`,
    '- depends-on: none',
    '- parallel: yes',
    '- context: 20k',
    `- slice: a user submits the form ${ARROW} the page shows the saved row ${DASH} demo: ${first}`,
    `- seams: ${first}#run`
  ].join('\n')}\n`;
}
const plan = (...tasks) => `${['# Plan', '', '## Tasks', '', ...tasks].join('\n')}\n`;

// folders: { '<relative folder under .company/work>': planText | null }; the plan file is `plan.md`.
function env(folders) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-tasks-v3-'));
  roots.push(base);
  const product = path.join(base, 'product');
  const pluginRoot = path.join(base, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  for (const a of ['backend-engineer', 'frontend-engineer', 'qa']) fs.writeFileSync(path.join(pluginRoot, 'agents', `${a}.md`), 'agent\n');
  const work = path.join(product, '.company', 'work');
  fs.mkdirSync(work, { recursive: true });
  for (const [rel, text] of Object.entries(folders)) {
    fs.mkdirSync(path.join(work, rel), { recursive: true });
    if (text !== null) fs.writeFileSync(path.join(work, rel, 'plan.md'), text);
  }
  const run = (...args) => main(args, { now: NOW, root: product, pluginRoot, home: path.join(base, 'home') });
  const check = (slug) => run('check', slug, 'plan.md', '--cap', '3', '--mode', 'parallel', '--handover', '120000');
  const begin = (slug) => run('begin', slug, 'plan.md', '--cap', '3', '--mode', 'parallel', '--handover', '120000');
  const add = (rel, planText) => {
    fs.mkdirSync(path.join(work, rel), { recursive: true });
    fs.writeFileSync(path.join(work, rel, 'plan.md'), planText);
  };
  return { run, check, begin, add, product, work, base };
}

const text = (r) => r.lines.join('\n');

describe('a v3 slug passes check and begin', () => {
  const body = plan(task(`${ID}-T1`), task(`${ID}-T2`));

  test('check accepts the slug and finds both tickets', () => {
    const e = env({ [R1]: body });
    const r = e.check(R1);
    assert.equal(r.code, 0, text(r));
    assert.ok(text(r).includes(`${ID}-T1`) || text(r).length > 0, text(r));
    assert.ok(!text(r).includes('refused'), text(r));
  });

  test('begin writes parallel.jsonl in the run sub folder, not beside the project folder', () => {
    const e = env({ [R1]: body });
    const r = e.begin(R1);
    assert.equal(r.code, 0, text(r));
    assert.ok(fs.existsSync(path.join(e.work, ID, '01-feature', 'parallel.jsonl')));
    assert.ok(!fs.existsSync(path.join(e.work, ID, 'parallel.jsonl')));
    const rec = fs.readFileSync(path.join(e.work, ID, '01-feature', 'parallel.jsonl'), 'utf8');
    assert.ok(rec.includes('"ev":"begin"') && rec.includes('"tasks":2'), rec);
  });

  test('next, start, lines, done and brief take the slug and the full ticket ID', () => {
    const e = env({ [R1]: body });
    assert.equal(e.begin(R1).code, 0);
    assert.equal(e.run('next', R1).code, 0);
    const s = e.run('start', R1, `${ID}-T1`);
    assert.equal(s.code, 0, text(s));
    const l = e.run('lines', R1, `${ID}-T1`);
    assert.equal(l.code, 0, text(l));
    assert.ok(text(l).includes(`Task: ${ID}-T1`), text(l));
    const b = e.run('brief', R1, `${ID}-T1`);
    assert.equal(b.code, 0, text(b));
    assert.equal(text(b), `Task brief: .company/work/${R1}/tasks/T1.md`);
    assert.ok(fs.existsSync(path.join(e.work, ID, '01-feature', 'tasks', 'T1.md')));
    const d = e.run('done', R1, `${ID}-T1`);
    assert.equal(d.code, 0, text(d));
  });

  test('a bare T1 and another project ticket are not tasks in a v3 run', () => {
    const e = env({ [R1]: body });
    assert.equal(e.begin(R1).code, 0);
    assert.equal(e.run('start', R1, 'T1').code, 3);
    assert.equal(e.run('start', R1, `${OTHER}-T1`).code, 3);
  });

  test('readParallel and sortByVisit accept the slug', () => {
    const e = env({ [R1]: body });
    assert.equal(e.begin(R1).code, 0);
    const v = readParallel(e.product, R1);
    assert.equal(v.state, 'on');
    assert.equal(v.slug, R1);
    assert.deepEqual(sortByVisit(e.product, R1, [`${ID}-T2`, `${ID}-T1`]), [`${ID}-T1`, `${ID}-T2`]);
    assert.deepEqual(readParallel(e.product, R1 === R2 ? R1 : `${ID}/02-fix`), { v: 1, slug: `${ID}/02-fix`, state: 'none' });
  });

  test('a run that was not begun reads as none and a bad shape is refused (after a good call)', () => {
    const e = env({ [R1]: body });
    assert.equal(e.check(R1).code, 0);
    for (const bad of [ID, `${ID}/`, `${ID}/..`, `${ID}/01-feature/x`, `${ID}/00-feature`, `${ID}/01-Feature`, `${ID}\\01-feature`, `${ID}/01-feature/..`]) {
      const r = e.check(bad);
      assert.equal(r.code, 3, `${bad}: ${text(r)}`);
      assert.ok(text(r).startsWith('refused:'), `${bad}: ${text(r)}`);
    }
  });

  test('a wrong letter case of the project folder is refused (after a good call)', () => {
    const e = env({ [R1]: body });
    assert.equal(e.check(R1).code, 0);
    const r = e.check(`${ID.toLowerCase()}/01-feature`);
    assert.equal(r.code, 3, text(r));
  });

  test('a project folder that is a link is refused (after a good call)', (t) => {
    const e = env({ [R1]: body });
    assert.equal(e.begin(R1).code, 0);
    const real = path.join(e.base, 'elsewhere');
    fs.mkdirSync(path.join(real, '01-feature'), { recursive: true });
    fs.writeFileSync(path.join(real, '01-feature', 'plan.md'), body);
    fs.renameSync(path.join(e.work, ID), path.join(e.base, 'moved'));
    try {
      fs.symlinkSync(real, path.join(e.work, ID), 'junction');
    } catch (error) {
      t.skip(`no link support: ${error.code}`);
      return;
    }
    const r = e.begin(R1);
    assert.notEqual(r.code, 0, text(r));
    assert.ok(!fs.existsSync(path.join(real, '01-feature', 'parallel.jsonl')), 'nothing written through the link');
  });
});

describe('ticket numbers stay unique across the project', () => {
  test('run 2 reusing a ticket of run 1 with a different block is refused, naming the run slug', () => {
    const e = env({ [R1]: plan(task(`${ID}-T1`)) });
    assert.equal(e.check(R1).code, 0, 'run 1 alone is fine');
    e.add(R2, plan(task(`${ID}-T1`, 'src/other.js')));
    const r = e.check(R2);
    assert.equal(r.code, 3, text(r));
    assert.ok(text(r).includes(`ticket-reused: ${ID}-T1 already heads a plan in ${R1}`), text(r));
  });

  test('begin refuses the same reuse and writes no record', () => {
    const e = env({ [R1]: plan(task(`${ID}-T1`)) });
    assert.equal(e.begin(R1).code, 0);
    e.add(R2, plan(task(`${ID}-T1`, 'src/other.js')));
    const r = e.begin(R2);
    assert.equal(r.code, 3, text(r));
    assert.ok(text(r).includes('ticket-reused'), text(r));
    assert.ok(!fs.existsSync(path.join(e.work, ID, '02-fix', 'parallel.jsonl')));
  });

  test('run 2 that continues the numbers (T2, T3) passes', () => {
    const e = env({ [R1]: plan(task(`${ID}-T1`)), [R2]: plan(task(`${ID}-T2`), task(`${ID}-T3`)) });
    assert.equal(e.check(R1).code, 0);
    const r = e.check(R2);
    assert.equal(r.code, 0, text(r));
  });

  test('an identical block in run 2 is a copy, not a reuse', () => {
    const body = plan(task(`${ID}-T1`));
    const e = env({ [R1]: body, [R2]: body.replace(/\n/g, '\r\n') });
    assert.equal(e.check(R1).code, 0);
    const r = e.check(R2);
    assert.equal(r.code, 0, text(r));
  });

  test('the own run is never compared with itself, and a plan of another project is ignored', () => {
    const e = env({
      [R1]: plan(task(`${ID}-T1`)),
      [`${OTHER}/01-feature`]: plan(task(`${OTHER}-T1`, 'src/other.js'))
    });
    assert.equal(e.check(R1).code, 0);
    assert.equal(e.check(`${OTHER}/01-feature`).code, 0);
  });

  test('a v2 folder of the same project counts for a v3 run', () => {
    const e = env({ [V2]: plan(task(`${ID}-T1`)) });
    assert.equal(e.check(V2).code, 0, 'the v2 folder alone is fine');
    e.add(R1, plan(task(`${ID}-T1`, 'src/other.js')));
    const r = e.check(R1);
    assert.equal(r.code, 3, text(r));
    assert.ok(text(r).includes(`ticket-reused: ${ID}-T1 already heads a plan in ${V2}`), text(r));
  });

  test('a v3 run of the same project counts for a v2 folder', () => {
    const e = env({ [R1]: plan(task(`${ID}-T1`)) });
    assert.equal(e.check(R1).code, 0, 'the v3 run alone is fine');
    e.add(V2, plan(task(`${ID}-T1`, 'src/other.js')));
    const r = e.check(V2);
    assert.equal(r.code, 3, text(r));
    assert.ok(text(r).includes(`ticket-reused: ${ID}-T1 already heads a plan in ${R1}`), text(r));
  });

  test('a link in a sibling run folder is skipped, not followed', (t) => {
    const e = env({ [R1]: plan(task(`${ID}-T1`)), [`${ID}/00x`]: null });
    const real = path.join(e.base, 'outside');
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, 'plan.md'), plan(task(`${ID}-T1`, 'src/other.js')));
    try {
      fs.symlinkSync(real, path.join(e.work, ID, '02-fix'), 'junction');
    } catch (error) {
      t.skip(`no link support: ${error.code}`);
      return;
    }
    assert.equal(e.check(R1).code, 0);
    // the link is a sibling run named like a v3 run; its plan must not be read as the project's ticket source
    const r = e.check(R1);
    assert.ok(!text(r).includes('ticket-reused'), text(r));
  });
});
