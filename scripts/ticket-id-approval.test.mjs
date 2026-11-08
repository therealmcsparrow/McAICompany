// Tests for project-id naming in ticket-approval, draft-input and wayfinder
// (work-folder-name v2.0, ticket-approval v1.5, draft-input v1.5, wayfinder v1.1).
// Hostile cases come first in each group; the clock is injected; every root is a fresh temp dir.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main as approve } from './ticket-approval.mjs';
import { main as draft } from './draft-input.mjs';
import { main as wayfinder } from './wayfinder.mjs';

const ID1 = 'P20261108.000001';
const ID2 = 'P20261108.000002';
const PARENT = `${ID1}-22.25.00`;
const EARLIER = `${ID1}-22.30.00`;
const HELPER = `${ID1}-22.31.07`;
const DATE = new Date(2026, 10, 8, 22, 31, 7);
const BASE = 'a'.repeat(40);
const DESC = 'Rename projects by one ID';
const SUMMARY = (run = 'first feature', extra = '') => `${DESC}\n\nRun: ${run}\n${extra}`;
const SIBLINGS = `Siblings: ${ID2}\n`;
const NL = '\n';

const roots = [];
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-id-home-'));
const saved = {};
before(() => {
  for (const k of ['MCSPARROW_HOME', 'HOME', 'USERPROFILE']) { saved[k] = process.env[k]; process.env[k] = home; }
});
after(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  for (const r of [...roots, home]) fs.rmSync(r, { recursive: true, force: true });
});

function product(files = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-id-')));
  roots.push(root);
  const put = (rel, body) => {
    const file = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  };
  put('.company/project.md', ['# Project profile', '', '## Core', '- skills/pipeline: run setup', '', '## Modules', '- skills/other: x', ''].join(NL));
  for (const [rel, body] of Object.entries(files)) put(rel, body);
  const work = path.join(root, '.company', 'work');
  return { root, put, work, dir: (n) => path.join(work, n) };
}

const tree = (root) => {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      out.push(path.relative(root, p).split(path.sep).join('/'));
      if (e.isDirectory()) walk(p);
    }
  };
  walk(root);
  return out.sort();
};
const bytes = (root) => tree(root).map((p) => {
  const f = path.join(root, p);
  return `${p}:${fs.statSync(f).isFile() ? fs.readFileSync(f, 'utf8') : ''}`;
});

const block = (id, title = 'a task') => [`### ${id} ${title}`, '- role: backend-engineer', `- files: src/${id.replace(/\W/g, '')}.mjs`, '- depends-on: none', ''].join(NL);
const plan = (...blocks) => ['# Plan: demo', '', `Base commit: ${BASE}`, '', '## Tasks', '', ...blocks].join(NL) + NL;
const V2_PLAN = plan(block(`${ID1}-T1`), block(`${ID1}-T2`));

// ------------------------------------------------------------------ ticket-approval

describe('ticket-approval on a v2 project (AC3, AC5)', () => {
  function fx(files = {}, planText = V2_PLAN) {
    const p = product({ [`.company/work/${PARENT}/plan.md`]: planText, [`.company/work/${PARENT}/00-summary.md`]: SUMMARY(), ...files });
    const run = (...args) => approve(args, { now: DATE.getTime(), root: p.root });
    const events = () => {
      const f = path.join(p.dir(PARENT), 'tickets.jsonl');
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(NL).filter(Boolean).map((l) => JSON.parse(l)) : [];
    };
    return { ...p, run, events };
  }
  const approved = (f) => {
    assert.equal(f.run('tickets', PARENT, 'plan.md', '--phase', 'd').code, 0);
    for (const id of [`${ID1}-T1`, `${ID1}-T2`, 'S0']) assert.equal(f.run('ticket', PARENT, id, 'approve').code, 0, id);
  };

  test('AC5: a bare T<n> and a ticket of another project are refused and write nothing', () => {
    const f = fx();
    f.run('tickets', PARENT, 'plan.md', '--phase', 'd');
    const before = bytes(f.root);
    for (const id of ['T1', 'T2', `${ID2}-T1`, `${ID1}-T9`, `${ID1.toLowerCase()}-T1`, `${ID1}-t1`, `${ID1}-T0001`]) {
      const r = f.run('ticket', PARENT, id, 'approve');
      assert.equal(r.code, 3, id);
      assert.match(r.lines[0], /^refused: /, id);
    }
    assert.deepEqual(bytes(f.root), before);
    assert.deepEqual(f.events().map((e) => e.ev), ['plan']);
  });

  test('AC5: heads with a bare ID or a foreign project ID are no tickets', () => {
    const f = fx({}, plan(block('T1'), block(`${ID2}-T1`), block(`${ID1}-T3`)));
    const r = f.run('tickets', PARENT, 'plan.md', '--phase', 'd');
    assert.equal(r.code, 0, r.lines.join(NL));
    assert.equal(r.lines[0], 'tickets 1 phase d');
    assert.ok(r.lines.includes(`ask ${ID1}-T3 new`));
    assert.equal(r.lines.some((l) => l === 'ask T1 new' || l.includes(ID2)), false);
  });

  test('AC9: a project ID alone, a lowercase p and a name without seconds are no folder', () => {
    const f = fx();
    for (const slug of [ID1, PARENT.toLowerCase(), `${ID1}-22.25`, `${ID1}-22.25.60`, `${ID1}.5-22.25.00`, `P20261308.000001-22.25.00`]) {
      const r = f.run('read', slug);
      assert.equal(r.code, 3, slug);
      assert.equal(r.lines[0], 'refused: bad slug', slug);
    }
  });

  test('AC5: full ticket IDs are listed, approved and read back', () => {
    const f = fx();
    const r = f.run('tickets', PARENT, 'plan.md', '--phase', 'd');
    assert.equal(r.code, 0, r.lines.join(NL));
    assert.deepEqual(r.lines.slice(0, 3), ['tickets 2 phase d', `ask ${ID1}-T1 new`, `ask ${ID1}-T2 new`]);
    assert.equal(f.run('ticket', PARENT, `${ID1}-T1`, 'approve').code, 0);
    const read = f.run('read', PARENT);
    assert.equal(read.code, 0, read.lines.join(NL));
    assert.ok(read.lines.some((l) => l.includes(`"id":"${ID1}-T1"`)));
    assert.deepEqual(f.events().map((e) => e.id).filter(Boolean), [`${ID1}-T1`]);
  });

  test('AC3: build-plan makes <ID>-HH.MM.SS with the plan and a Build summary', () => {
    const f = fx();
    approved(f);
    const r = f.run('build-plan', PARENT);
    assert.equal(r.code, 0, r.lines.join(NL));
    assert.equal(r.lines[0], 'built 2 tickets');
    assert.ok(r.lines.includes(`plan: .company/work/${HELPER}/plan.md`));
    assert.deepEqual(fs.readdirSync(f.work).sort(), [PARENT, HELPER]);
    assert.deepEqual(fs.readdirSync(f.dir(HELPER)).sort(), ['00-summary.md', 'plan.md']);
    assert.equal(fs.readFileSync(path.join(f.dir(HELPER), '00-summary.md'), 'utf8'), SUMMARY('build feature'));
    const text = fs.readFileSync(path.join(f.dir(HELPER), 'plan.md'), 'utf8');
    assert.ok(text.includes(`### ${ID1}-T1 a task`) && text.includes(`### ${ID1}-T2 a task`));
    assert.equal(f.events().at(-1).ev, 'build');
    assert.deepEqual(f.events().at(-1).ids, [`${ID1}-T1`, `${ID1}-T2`]);
  });

  test('AC3: the Build summary keeps the parent Playbook and its Siblings line', () => {
    const f = fx({ [`.company/work/${PARENT}/00-summary.md`]: SUMMARY('later fix', SIBLINGS) });
    approved(f);
    assert.equal(f.run('build-plan', PARENT).code, 0);
    assert.equal(fs.readFileSync(path.join(f.dir(HELPER), '00-summary.md'), 'utf8'), SUMMARY('build fix', SIBLINGS));
  });

  test('AC3: a run of the project at another second does not block the Build run', () => {
    const f = fx({ [`.company/work/${EARLIER}/00-summary.md`]: SUMMARY('draft grill') });
    approved(f);
    const r = f.run('build-plan', PARENT);
    assert.equal(r.code, 0, r.lines.join(NL));
    assert.ok(fs.existsSync(path.join(f.dir(HELPER), 'plan.md')));
  });

  test('AC3: a clash at the same second is refused and creates nothing', () => {
    const f = fx({ [`.company/work/${HELPER}/00-summary.md`]: 'taken\n' });
    approved(f);
    const before = bytes(f.root);
    const r = f.run('build-plan', PARENT);
    assert.equal(r.code, 3);
    assert.equal(r.lines[0], 'refused: too many runs this second');
    assert.deepEqual(bytes(f.root), before);
  });

  test('AC3: a clash with an empty folder of that second is refused, no event is written', () => {
    const f = fx();
    approved(f);
    fs.mkdirSync(f.dir(HELPER));
    const r = f.run('build-plan', PARENT);
    assert.equal(r.code, 3);
    assert.equal(r.lines[0], 'refused: too many runs this second');
    assert.deepEqual(fs.readdirSync(f.dir(HELPER)), []);
    assert.equal(f.events().some((e) => e.ev === 'build'), false);
  });
});

describe('ticket-approval on legacy folders is unchanged (AC7, green before and after by design)', () => {
  const legacy = (slug) => {
    const p = product({ [`.company/work/${slug}/plan.md`]: plan(block('T1'), block('T2')) });
    const run = (...args) => approve(args, { now: DATE.getTime(), root: p.root });
    run('tickets', slug, 'plan.md', '--phase', 'd');
    for (const id of ['T1', 'S0']) assert.equal(run('ticket', slug, id, 'approve').code, 0);
    return { ...p, run };
  };

  test('a legacy slug keeps bare T<n> and the -build folder', () => {
    const f = legacy('demo');
    assert.equal(f.run('ticket', 'demo', `${ID1}-T1`, 'approve').code, 3);
    const r = f.run('build-plan', 'demo');
    assert.equal(r.code, 0, r.lines.join(NL));
    assert.ok(r.lines.includes('plan: .company/work/demo-build/plan.md'));
  });

  test('a v1.1 folder keeps its Build suffix', () => {
    const slug = '2026-11-08 20.27 - Pocock Large Items';
    const f = legacy(slug);
    const r = f.run('build-plan', slug);
    assert.equal(r.code, 0, r.lines.join(NL));
    assert.ok(r.lines.includes(`plan: .company/work/${slug} Build/plan.md`));
  });
});

// ------------------------------------------------------------------ draft-input

describe('draft-input on a v2 project (AC3, AC5)', () => {
  const BUILD_PLAN = plan(block(`${ID1}-T1`));
  const run = (root, ...args) => draft(args, { root, now: DATE });
  const refused = (r, reason) => {
    assert.equal(r.code, 3);
    assert.deepEqual(r.lines, [`refused: ${reason}`]);
  };
  const parent = (files = {}) => product({
    [`.company/work/${PARENT}/plan.md`]: BUILD_PLAN,
    [`.company/work/${PARENT}/00-summary.md`]: SUMMARY('build feature'),
    ...files
  });
  const PATH = `.company/work/${PARENT}/plan.md`;

  test('AC9: a project ID alone, a lowercase p and a name without seconds are no folder', () => {
    const p = parent();
    const before = bytes(p.root);
    for (const folder of [ID1, PARENT.toLowerCase(), `${ID1}-22.25`, `${ID1}-22.25.60`, `${ID1}.5-22.25.00`]) {
      const r = run(p.root, 'take', `.company/work/${folder}/plan.md`, '--for', 'fix');
      assert.equal(r.code, 3, folder);
      assert.match(r.lines[0], /^refused: /, folder);
    }
    assert.deepEqual(bytes(p.root), before);
  });

  test('AC3: take --for feature makes <ID>-HH.MM.SS with the copy and a Draft summary', () => {
    const p = parent();
    const r = run(p.root, 'take', PATH, '--for', 'feature');
    assert.equal(r.code, 0, r.lines.join(NL));
    assert.equal(r.lines[0], `slug: ${HELPER}`);
    assert.equal(r.lines[1], `input: .company/work/${HELPER}/input-feature.md`);
    assert.deepEqual(fs.readdirSync(p.dir(HELPER)).sort(), ['00-summary.md', 'input-feature.md']);
    assert.equal(fs.readFileSync(path.join(p.dir(HELPER), 'input-feature.md'), 'utf8'), BUILD_PLAN);
    assert.equal(fs.readFileSync(path.join(p.dir(HELPER), '00-summary.md'), 'utf8'), SUMMARY('draft feature'));
  });

  test('AC3: the Draft summary copies the Siblings line', () => {
    const p = parent({ [`.company/work/${PARENT}/00-summary.md`]: SUMMARY('build feature', SIBLINGS) });
    assert.equal(run(p.root, 'take', PATH, '--for', 'feature').code, 0);
    assert.equal(fs.readFileSync(path.join(p.dir(HELPER), '00-summary.md'), 'utf8'), SUMMARY('draft feature', SIBLINGS));
  });

  test('AC3: an earlier run of the project with the same branch id does not block a Draft run', () => {
    const p = parent({ [`.company/work/${EARLIER}/00-summary.md`]: SUMMARY('draft grill') });
    const r = run(p.root, 'take', PATH, '--for', 'feature');
    assert.equal(r.code, 0, r.lines.join(NL));
    assert.equal(r.lines[0], `slug: ${HELPER}`);
  });

  test('AC3: a clash at the same second is refused and creates nothing', () => {
    const p = parent({ [`.company/work/${HELPER}/00-summary.md`]: 'taken\n' });
    const before = bytes(p.root);
    refused(run(p.root, 'take', PATH, '--for', 'feature'), 'too many runs this second');
    assert.deepEqual(bytes(p.root), before);
  });

  test('draft chain: 00-summary.md is an allowed entry, the folder is reused', () => {
    const p = product({ [`.company/work/${PARENT}/grill.md`]: 'Some grill text\n', [`.company/work/${PARENT}/00-summary.md`]: SUMMARY() });
    const r = run(p.root, 'take', `.company/work/${PARENT}/grill.md`, '--for', 'to-spec');
    assert.equal(r.code, 0, r.lines.join(NL));
    assert.equal(r.lines[0], `slug: ${PARENT}`);
    assert.ok(fs.existsSync(path.join(p.dir(PARENT), 'input-to-spec.md')));
    assert.deepEqual(fs.readdirSync(p.work), [PARENT]);
  });

  test('draft chain: 00-summary.md is allowed by its exact name only', () => {
    const variants = ['00-Summary.md', '00-SUMMARY.MD', '00-summary.md.txt', '00-summary.md~'];
    if (process.platform !== 'win32') variants.push('00-summary.md.', '00-summary.md ');
    for (const name of variants) {
      const p = product({ [`.company/work/${PARENT}/grill.md`]: 'Some grill text\n', [`.company/work/${PARENT}/${name}`]: SUMMARY() });
      const r = run(p.root, 'take', `.company/work/${PARENT}/grill.md`, '--for', 'to-spec');
      assert.notEqual(r.lines[0], `slug: ${PARENT}`, name);
      assert.equal(fs.existsSync(path.join(p.dir(PARENT), 'input-to-spec.md')), false, name);
    }
  });

  test('draft chain: a Handoff or a subfolder still makes the folder taken', () => {
    for (const extra of ['01-product-manager.md', 'sub/x.md']) {
      const p = product({
        [`.company/work/${PARENT}/grill.md`]: 'Some grill text\n', [`.company/work/${PARENT}/00-summary.md`]: SUMMARY(),
        [`.company/work/${PARENT}/${extra}`]: 'x\n'
      });
      const r = run(p.root, 'take', `.company/work/${PARENT}/grill.md`, '--for', 'to-spec');
      assert.equal(r.code, 0, r.lines.join(NL));
      assert.equal(r.lines[0], `slug: ${HELPER}`, extra);
      assert.equal(fs.existsSync(path.join(p.dir(PARENT), 'input-to-spec.md')), false, extra);
    }
  });

  describe('--for fix needs a build summary', () => {
    const FIX_REFUSED = (files, label) => test(`refused, nothing written: ${label}`, () => {
      const p = parent(files);
      const before = bytes(p.root);
      refused(run(p.root, 'take', PATH, '--for', 'fix'), 'not a build plan');
      assert.deepEqual(bytes(p.root), before);
    });

    test('line 3 says build: the copy and a Draft summary are made', () => {
      const p = parent();
      const r = run(p.root, 'take', PATH, '--for', 'fix');
      assert.equal(r.code, 0, r.lines.join(NL));
      assert.equal(r.lines[0], `slug: ${HELPER}`);
      assert.equal(r.lines[1], `input: .company/work/${HELPER}/input-fix.md`);
      assert.equal(fs.readFileSync(path.join(p.dir(HELPER), 'input-fix.md'), 'utf8'), BUILD_PLAN);
      assert.equal(fs.readFileSync(path.join(p.dir(HELPER), '00-summary.md'), 'utf8'), SUMMARY('draft fix'));
    });

    for (const kind of ['first fix', 'later fix', 'draft fix', 'first build']) {
      FIX_REFUSED({ [`.company/work/${PARENT}/00-summary.md`]: SUMMARY(kind) }, `Run: ${kind}`);
    }
    for (const line of ['Run: build', 'Run:build feature', 'run: build feature', 'Run: Build feature', 'Run: build  feature', 'Run: build feature extra', 'Run: build Feature', 'Run: build ../x']) {
      FIX_REFUSED({ [`.company/work/${PARENT}/00-summary.md`]: `${DESC}\n\n${line}\n` }, `malformed ${JSON.stringify(line)}`);
    }
    FIX_REFUSED({ [`.company/work/${PARENT}/00-summary.md`]: `${DESC}\nRun: build feature\n` }, 'line 2 not empty');
    FIX_REFUSED({ [`.company/work/${PARENT}/00-summary.md`]: `${DESC}\n` }, 'no Run line');
    FIX_REFUSED({ [`.company/work/${PARENT}/00-summary.md`]: `${DESC}\n\nRun: build feature\n`.replaceAll('\n', '\r\n') }, 'CRLF summary');
    FIX_REFUSED({ [`.company/work/${PARENT}/00-summary.md`]: '' }, 'empty summary');
    FIX_REFUSED({ [`.company/work/${PARENT}/00-summary.md`]: `${DESC}\n\nRun: build feature\n${'x'.repeat(300 * 1024)}` }, 'oversize summary');
    FIX_REFUSED({ [`.company/work/${PARENT}/00-summary.md`]: Buffer.from([0xff, 0xfe, 0x0a]).toString('latin1') }, 'not UTF-8 summary');

    test('refused: no summary at all', () => {
      const p = parent();
      fs.rmSync(path.join(p.dir(PARENT), '00-summary.md'));
      const before = bytes(p.root);
      refused(run(p.root, 'take', PATH, '--for', 'fix'), 'not a build plan');
      assert.deepEqual(bytes(p.root), before);
    });

    test('refused: summary under another letter case', () => {
      const p = parent();
      fs.renameSync(path.join(p.dir(PARENT), '00-summary.md'), path.join(p.dir(PARENT), '00-Summary.md'));
      refused(run(p.root, 'take', PATH, '--for', 'fix'), 'not a build plan');
    });

    test('refused: summary is a link', (t) => {
      const p = parent();
      const outside = product({ 'real.md': SUMMARY('build feature') });
      const link = path.join(p.dir(PARENT), '00-summary.md');
      fs.rmSync(link);
      try {
        fs.symlinkSync(path.join(outside.root, 'real.md'), link);
      } catch (error) {
        if (error?.code === 'EPERM' || error?.code === 'EACCES') return t.skip('no symlink right');
        throw error;
      }
      refused(run(p.root, 'take', PATH, '--for', 'fix'), 'not a build plan');
    });

    test('refused: summary is hard-linked', () => {
      const p = parent();
      fs.linkSync(path.join(p.dir(PARENT), '00-summary.md'), path.join(p.root, 'alias.md'));
      refused(run(p.root, 'take', PATH, '--for', 'fix'), 'not a build plan');
    });

    test('refused: summary is a folder', () => {
      const p = parent();
      const s = path.join(p.dir(PARENT), '00-summary.md');
      fs.rmSync(s);
      fs.mkdirSync(s);
      refused(run(p.root, 'take', PATH, '--for', 'fix'), 'not a build plan');
    });

    test('refused: any other file than plan.md of a build run', () => {
      const p = parent({ [`.company/work/${PARENT}/grill.md`]: BUILD_PLAN, [`.company/work/${PARENT}/sub/plan.md`]: BUILD_PLAN });
      refused(run(p.root, 'take', `.company/work/${PARENT}/grill.md`, '--for', 'fix'), 'not a build plan');
      refused(run(p.root, 'take', `.company/work/${PARENT}/sub/plan.md`, '--for', 'fix'), 'not a build plan');
    });

    test('a Build suffix no longer makes a v2 folder a build plan', () => {
      const p = product({
        [`.company/work/${PARENT}/plan.md`]: BUILD_PLAN, [`.company/work/${PARENT}/00-summary.md`]: SUMMARY('first fix'),
        [`.company/work/${EARLIER}/plan.md`]: BUILD_PLAN, [`.company/work/${EARLIER}/00-summary.md`]: SUMMARY('build feature')
      });
      refused(run(p.root, 'take', PATH, '--for', 'fix'), 'not a build plan');
      assert.equal(run(p.root, 'take', `.company/work/${EARLIER}/plan.md`, '--for', 'fix').code, 0);
    });
  });
});

describe('draft-input on legacy folders is unchanged (AC7, green before and after by design)', () => {
  test('a legacy -build plan and a v1.1 Build folder still give a Draft helper', () => {
    const PLAN = '# Build plan\n\n## Tasks\n\n### T1 First ticket\nfiles: a.mjs\n';
    const p = product({ '.company/work/flow-build/plan.md': PLAN, '.company/work/2026-11-08 20.27 - Flow Build/plan.md': PLAN });
    const a = draft(['take', '.company/work/flow-build/plan.md', '--for', 'fix'], { root: p.root, now: new Date(2026, 10, 8, 22, 31) });
    assert.equal(a.lines[0], 'slug: 2026-11-08 22.31 - Flow Draft');
    const b = draft(['take', '.company/work/2026-11-08 20.27 - Flow Build/plan.md', '--for', 'fix'], { root: p.root, now: new Date(2026, 10, 8, 22, 31) });
    assert.equal(b.lines[0], 'slug: 2026-11-08 22.31 - Flow Draft 2');
  });
});

// ------------------------------------------------------------------ wayfinder

describe('wayfinder anchors on a v2 plan (AC5)', () => {
  function check(anchorPath, files = {}) {
    const p = product({
      'docs/a.md': '# a\n',
      [`.company/work/${PARENT}/plan.md`]: plan(block(`${ID1}-T1`), block(`${ID1}-T3b`)),
      ...files
    });
    const map = [
      '# Wayfinder: demo effort', '', '## Decisions', '- D-1 ship it — src: docs/a.md', '',
      '## Open', '- O-1 which runner — src: docs/a.md', '', '## Pointers', `- ${anchorPath} — plan`, ''
    ].join(NL);
    p.put('.company/wayfinder/demo.md', map);
    const r = wayfinder(['check', '.company/wayfinder/demo.md'], { root: p.root });
    return { ...r, errors: r.lines.filter((l) => l.startsWith('ERROR ')) };
  }
  const at = (anchor) => `.company/work/${PARENT}/plan.md#${anchor}`;

  test('a foreign project ticket and a bare T<n> do not resolve', () => {
    for (const anchor of [`${ID2}-T1`, 'T1', `${ID1}-T2`, `${ID1.toLowerCase()}-T1`]) {
      const r = check(at(anchor));
      assert.equal(r.code, 1, anchor);
      assert.equal(r.errors.length, 1, anchor);
    }
    assert.deepEqual(check(at(`${ID2}-T1`)).errors, [`ERROR 10: task missing ${ID2}-T1 in .company/work/${PARENT}/plan.md`]);
  });

  test('a full ticket ID resolves to its plan heading', () => {
    for (const anchor of [`${ID1}-T1`, `${ID1}-T3b`]) {
      const r = check(at(anchor));
      assert.deepEqual(r.errors, [], anchor);
      assert.equal(r.code, 0, anchor);
    }
  });

  test('a full ticket ID resolves in input-fix.md too', () => {
    const r = check(`.company/work/${PARENT}/input-fix.md#${ID1}-T1`, { [`.company/work/${PARENT}/input-fix.md`]: plan(block(`${ID1}-T1`)) });
    assert.deepEqual(r.errors, []);
    assert.equal(r.code, 0);
  });

  test('a legacy folder keeps bare T<n> anchors and refuses a full ID', () => {
    const files = { '.company/work/demo/plan.md': plan(block('T1')) };
    assert.equal(check('.company/work/demo/plan.md#T1', files).code, 0);
    assert.equal(check(`.company/work/demo/plan.md#${ID1}-T1`, files).code, 1);
  });
});
