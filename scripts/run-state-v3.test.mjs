// Tests for run-state v1.10 write side, kept under v2.0 (run slugs `<ID>/<NN>-<playbook>`, `projects --json`).
// Output shape: { v: 1, projects: [{ id, activity }], warnings: [] }.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as rs from './run-state.mjs';

const SCRIPT = fileURLToPath(new URL('./run-state.mjs', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-v3-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const T0 = Date.parse('2026-11-09T12:00:00Z');
const H = 60 * 60 * 1000;
const ID = 'P20261109.000001';
const ID2 = 'P20261109.000002';
const ID3 = 'P20261109.000003';
const ID4 = 'P20261109.000004';
const SLUG = `${ID}/01-feature`;

let n = 0;
function repo() {
  const root = path.join(base, `r${n++}`);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}
const work = root => path.join(root, '.company', 'work');
const go = (root, args, ms = 0) => rs.run(args, { root, now: T0 + ms });
const stateFile = (root, slug) => path.join(work(root), ...slug.split('/'), 'run-state.jsonl');
const touch = (file, ms) => fs.utimesSync(file, new Date(T0 + ms), new Date(T0 + ms));

// A v3 project folder with run folders `<NN>-<playbook>`, each with a 00-summary.md (file mtime = T0 + ms).
function v3(root, id, runs = ['01-feature'], ms = -24 * H) {
  const p = path.join(work(root), id);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, '00-project.md'), 'Secret Project Description\n');
  touch(path.join(p, '00-project.md'), ms);
  for (const r of runs) {
    fs.mkdirSync(path.join(p, r));
    fs.writeFileSync(path.join(p, r, '00-summary.md'), 'Secret Project Description\n\nRun: first feature\n');
    touch(path.join(p, r, '00-summary.md'), ms);
  }
}
// A v2 run folder: top-level `<ID>-HH.MM.SS` (the bare ID folder is the v3 project folder). Returns the folder name.
function v2(root, id, ms = -24 * H) {
  const name = `${id}-10.00.00`;
  const p = path.join(work(root), name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, '00-summary.md'), 'Secret Project Description\n\nRun: first feature\n');
  touch(path.join(p, '00-summary.md'), ms);
  return name;
}
const ids = r => r.projects.map(p => p.id);
const stepFile = (root, slug, file, num) =>
  fs.writeFileSync(path.join(work(root), ...slug.split('/'), file),
    `---\nstep: ${num}\nrole: qa\nstatus: done\nround: 1\nrisk-tier: high\n---\nBody\n`);

describe('run slugs in start/step/end/show (AC1, AC7)', () => {
  test('start writes run-state.jsonl inside the run folder, not beside the project', () => {
    const root = repo();
    v3(root, ID);
    const r = go(root, ['start', SLUG]);
    assert.deepEqual(r, { out: `ok: start ${SLUG}`, code: 0 });
    const rec = JSON.parse(fs.readFileSync(stateFile(root, SLUG), 'utf8').trim());
    assert.equal(rec.ev, 'start');
    assert.equal(fs.existsSync(path.join(work(root), ID, 'run-state.jsonl')), false);
    assert.deepEqual(fs.readdirSync(work(root)), [ID]);
  });

  test('show reads the nested file: slug echoed, state running then ended, Step files listed', () => {
    const root = repo();
    v3(root, ID);
    go(root, ['start', SLUG]);
    stepFile(root, SLUG, '03-qa.md', '03');
    const v = rs.show(root, SLUG, { now: T0 + 1000 });
    assert.equal(v.slug, SLUG);
    assert.equal(v.state, 'running');
    assert.deepEqual(v.steps.map(s => [s.step, s.role, s.file]), [['03', 'qa', '03-qa.md']]);
    assert.equal(v.tier, 'high');
    assert.equal(go(root, ['end', SLUG, 'ship'], 2000).code, 0);
    const e = JSON.parse(go(root, ['show', SLUG, '--json'], 3000).out);
    assert.equal(e.state, 'ended');
    assert.equal(e.outcome, 'ship');
  });

  test('wave, ask and gate entries land in the nested file', () => {
    const root = repo();
    v3(root, ID);
    go(root, ['start', SLUG]);
    assert.equal(go(root, ['wave', SLUG, '2'], 1000).code, 0);
    assert.equal(go(root, ['ask', SLUG, 'plan'], 2000).code, 0);
    assert.equal(go(root, ['gate', SLUG, 'plan', 'passed'], 5000).code, 0);
    const v = rs.show(root, SLUG, { now: T0 + 6000 });
    assert.equal(v.wave, 2);
    assert.equal(v.gates[0].wait, 3);
  });

  test('a second start on an open run and an end without a start are refused', () => {
    const root = repo();
    v3(root, ID);
    assert.match(go(root, ['end', SLUG, 'ship']).out, /^refused: no open run/);
    go(root, ['start', SLUG]);
    assert.deepEqual(go(root, ['start', SLUG], 1000), { out: `refused: run ${SLUG} already started`, code: 2 });
  });

  test('two runs of one project keep separate state', () => {
    const root = repo();
    v3(root, ID, ['01-feature', '02-fix']);
    go(root, ['start', `${ID}/01-feature`]);
    go(root, ['end', `${ID}/01-feature`, 'ship'], 1000);
    go(root, ['start', `${ID}/02-fix`], 2000);
    assert.equal(rs.show(root, `${ID}/01-feature`, { now: T0 + 3000 }).state, 'ended');
    assert.equal(rs.show(root, `${ID}/02-fix`, { now: T0 + 3000 }).state, 'running');
  });

  for (const bad of [`${ID}/1-feature`, `${ID}/00-feature`, `${ID}/01-Feature`, `${ID}/../01-feature`, `${ID}/01-feature/x`, `${ID}//01-feature`, `${ID}\\01-feature`, `${ID}/01-`, 'x/01-feature']) {
    test(`bad run slug ${JSON.stringify(bad)} is refused and writes nothing`, () => {
      const root = repo();
      v3(root, ID);
      const before = fs.readdirSync(path.join(work(root), ID)).sort();
      for (const args of [['start', bad], ['show', bad, '--json'], ['end', bad, 'ship'], ['wave', bad, '1']]) {
        const r = go(root, args);
        assert.equal(r.code, 2, args.join(' '));
        assert.match(r.out, /^refused: /);
      }
      assert.deepEqual(fs.readdirSync(path.join(work(root), ID)).sort(), before);
      assert.deepEqual(fs.readdirSync(work(root)), [ID]);
    });
  }

  test('a run folder that is a link out of work is not followed', t => {
    const root = repo();
    v3(root, ID, []);
    const out = path.join(base, `outside${n}`);
    fs.mkdirSync(out);
    try { fs.symlinkSync(out, path.join(work(root), ID, '01-feature'), 'junction'); } catch { t.skip('no link right'); return; }
    const r = go(root, ['start', SLUG]);
    assert.equal(r.code, 2);
    assert.deepEqual(fs.readdirSync(out), []);
  });

  test('a v2 slug still works as before', () => {
    const root = repo();
    const s = '2026-11-01 10.00 - Alpha Build';
    assert.equal(go(root, ['start', s]).code, 0);
    assert.equal(rs.show(root, s, { now: T0 }).state, 'running');
    assert.equal(fs.existsSync(stateFile(root, s)), true);
  });
});

describe('projects --json (AC1, AC10)', () => {
  test('exports projects and the command prints the same object', () => {
    assert.equal(typeof rs.projects, 'function');
    const root = repo();
    v3(root, ID);
    go(root, ['start', SLUG]);
    const r = rs.projects(root, { now: T0 + 1000 });
    assert.equal(r.v, 1);
    assert.deepEqual(ids(r), [ID]);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(JSON.parse(go(root, ['projects', '--json'], 1000).out), r);
  });

  test('works through the real CLI', () => {
    const root = repo();
    v3(root, ID);
    go(root, ['start', SLUG], Date.now() - T0); // the spawned CLI reads the real clock, so start the segment now
    const cp = spawnSync(process.execPath, [SCRIPT, 'projects', '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(cp.status, 0);
    assert.deepEqual(ids(JSON.parse(cp.stdout)), [ID]);
  });

  test('a project with an open segment is listed with its activity time and nothing else', () => {
    const root = repo();
    v3(root, ID);
    go(root, ['start', SLUG], -2 * H);
    const r = rs.projects(root, { now: T0 });
    assert.deepEqual(ids(r), [ID]);
    assert.deepEqual(Object.keys(r.projects[0]).sort(), ['activity', 'id']);
    assert.equal(typeof r.projects[0].activity, 'string');
    assert.equal(Date.parse(r.projects[0].activity), T0 - 2 * H);
    assert.equal(JSON.stringify(r).includes('Secret'), false);
    assert.equal(JSON.stringify(r).includes('feature'), false);
  });

  test('an ended project is not listed', () => {
    const root = repo();
    v3(root, ID);
    go(root, ['start', SLUG], -2 * H);
    go(root, ['end', SLUG, 'ship'], -1 * H);
    assert.deepEqual(ids(rs.projects(root, { now: T0 })), []);
  });

  test('a stale open segment (idle over 12 h) is not listed, one just inside is', () => {
    const root = repo();
    v3(root, ID);
    v3(root, ID2);
    go(root, ['start', `${ID}/01-feature`], -12 * H - 1000);
    go(root, ['start', `${ID2}/01-feature`], -12 * H + 1000);
    assert.deepEqual(ids(rs.projects(root, { now: T0 })), [ID2]);
  });

  test('a Step file keeps an open segment active past its last record', () => {
    const root = repo();
    v3(root, ID);
    go(root, ['start', SLUG], -13 * H);
    stepFile(root, SLUG, '03-qa.md', '03');
    touch(path.join(work(root), ID, '01-feature', '03-qa.md'), -1 * H);
    assert.deepEqual(ids(rs.projects(root, { now: T0 })), [ID]);
  });

  test('a run without run-state is active when its newest direct file is within 12 h', () => {
    const root = repo();
    v3(root, ID, ['01-feature'], -1 * H);
    v3(root, ID2, ['01-feature'], -13 * H);
    assert.deepEqual(ids(rs.projects(root, { now: T0 })), [ID]);
  });

  test('a run without run-state: only direct files count, not nested ones', () => {
    const root = repo();
    v3(root, ID, ['01-feature'], -13 * H);
    const deep = path.join(work(root), ID, '01-feature', 'sub');
    fs.mkdirSync(deep);
    fs.writeFileSync(path.join(deep, 'a.md'), 'x');
    touch(path.join(deep, 'a.md'), -1 * H);
    assert.deepEqual(ids(rs.projects(root, { now: T0 })), []);
  });

  test('a v2 project (`<ID>-HH.MM.SS` folder) is listed by the same rules', () => {
    const root = repo();
    v2(root, ID, -1 * H);
    v2(root, ID2, -20 * H);
    assert.deepEqual(ids(rs.projects(root, { now: T0 })), [ID]);
  });

  test('a v2 sibling folder `<ID>-HH.MM.SS` with an open segment lists the project ID', () => {
    const root = repo();
    const sib = `${ID}-10.30.00`;
    fs.mkdirSync(path.join(work(root), sib));
    fs.writeFileSync(path.join(work(root), sib, '00-summary.md'), 'Secret Project Description\n');
    touch(path.join(work(root), sib, '00-summary.md'), -24 * H);
    go(root, ['start', sib], -1 * H);
    assert.deepEqual(ids(rs.projects(root, { now: T0 })), [ID]);
  });

  test('a project with several active runs is listed once', () => {
    const root = repo();
    v3(root, ID, ['01-feature', '02-fix']);
    go(root, ['start', `${ID}/01-feature`], -3 * H);
    go(root, ['start', `${ID}/02-fix`], -1 * H);
    const r = rs.projects(root, { now: T0 });
    assert.deepEqual(ids(r), [ID]);
    assert.equal(Date.parse(r.projects[0].activity), T0 - 1 * H);
  });

  test('at most 3 projects, newest activity first', () => {
    const root = repo();
    for (const [id, ms] of [[ID, -4 * H], [ID2, -1 * H], [ID3, -3 * H], [ID4, -2 * H]]) {
      v3(root, id);
      go(root, ['start', `${id}/01-feature`], ms);
    }
    assert.deepEqual(ids(rs.projects(root, { now: T0 })), [ID2, ID4, ID3]);
  });

  test('empty, missing and non-project folders give an empty list', () => {
    const root = repo();
    assert.deepEqual(rs.projects(root, { now: T0 }), { v: 1, projects: [], warnings: [] });
    fs.mkdirSync(path.join(work(root), 'notes'));
    fs.writeFileSync(path.join(work(root), 'notes', 'a.md'), 'x');
    assert.deepEqual(ids(rs.projects(root, { now: T0 })), []);
    const bare = path.join(base, `bare${n++}`);
    fs.mkdirSync(bare);
    assert.deepEqual(ids(rs.projects(bare, { now: T0 })), []);
  });

  test('an unreadable (oversize) run-state does not throw and does not list the project', () => {
    const root = repo();
    v3(root, ID, ['01-feature'], -24 * H);
    fs.writeFileSync(stateFile(root, SLUG), 'x'.repeat(70 * 1024));
    assert.deepEqual(ids(rs.projects(root, { now: T0 })), []);
  });

  test('only the --json form is accepted', () => {
    const root = repo();
    assert.equal(go(root, ['projects']).code, 2);
    assert.equal(go(root, ['projects', '--json', 'x']).code, 2);
    assert.match(go(root, ['nope']).out, /projects/);
  });

  test('at most 200 runs are read: 205 old projects, the call still answers', () => {
    const root = repo();
    for (let i = 0; i < 205; i++) {
      const id = `P20261001.${String(i + 1).padStart(6, '0')}`;
      v3(root, id, ['01-feature'], -24 * H);
    }
    v3(root, ID, ['01-feature'], -1 * H);
    const r = rs.projects(root, { now: T0 });
    assert.ok(r.projects.length <= 3);
  });

  test('projects writes nothing', () => {
    const root = repo();
    v3(root, ID);
    go(root, ['start', SLUG]);
    const snap = () => JSON.stringify(fs.readdirSync(work(root), { recursive: true }).sort());
    const before = snap();
    rs.projects(root, { now: T0 });
    assert.equal(snap(), before);
  });
});

describe('list and active unchanged for top-level runs (AC7)', () => {
  const A = '2026-11-01 10.00 - Alpha Build';
  const B = '2026-11-02 10.00 - Beta Build';

  test('list keeps every old entry byte-identical when a v3 run is added (the v3 run is listed too, v2.0)', () => {
    const root = repo();
    go(root, ['start', A], -5 * H);
    go(root, ['start', B], -4 * H);
    go(root, ['end', B, 'ship'], -3 * H);
    const before = rs.list(root, { now: T0 });
    assert.deepEqual(before.runs.map(x => x.slug), [B, A]);
    v3(root, ID);
    go(root, ['start', SLUG], -1 * H);
    stepFile(root, SLUG, '03-qa.md', '03');
    const after = rs.list(root, { now: T0 });
    assert.deepEqual(after.runs.filter(x => x.slug !== SLUG), before.runs);
    assert.ok(after.runs.some(x => x.slug === SLUG));
    assert.deepEqual(JSON.parse(go(root, ['list', '--json']).out).runs.filter(x => x.slug !== SLUG), before.runs);
  });

  test('active still reports an old run when the v3 run is ended', () => {
    const root = repo();
    go(root, ['start', A], -2 * H);
    const before = rs.active(root, { now: T0 });
    assert.equal(before.slug, A);
    v3(root, ID);
    go(root, ['start', SLUG], -1 * H);
    go(root, ['end', SLUG, 'abort'], -30 * 60 * 1000);
    assert.deepEqual(rs.active(root, { now: T0 }), before);
  });

  test('a v2 project folder with state keeps its list entry and slug', () => {
    const root = repo();
    const name = v2(root, ID);
    go(root, ['start', name], -1 * H);
    const r = rs.list(root, { now: T0 });
    assert.deepEqual(r.runs.map(x => x.slug), [name]);
    assert.equal(rs.active(root, { now: T0 }).slug, name);
  });

  test('old folders stay byte-identical when v3 commands run', () => {
    const root = repo();
    go(root, ['start', A], -5 * H);
    const f = stateFile(root, A);
    const before = fs.readFileSync(f);
    v3(root, ID);
    go(root, ['start', SLUG]);
    rs.projects(root, { now: T0 });
    assert.deepEqual(fs.readFileSync(f), before);
  });
});

describe('hostile folders: links, files and a missing project (proj.M4)', () => {
  const outsideDir = () => fs.mkdtempSync(path.join(base, 'out-'));
  const link = (t, target, at) => {
    try {
      fs.symlinkSync(target, at, 'junction');
      return true;
    } catch {
      t.skip('no link right');
      return false;
    }
  };
  // A run-state file with an open run, made by the tool itself in a scratch repo.
  const openState = () => {
    const r = repo();
    v3(r, ID);
    go(r, ['start', SLUG], -1 * H);
    return fs.readFileSync(stateFile(r, SLUG), 'utf8');
  };
  const tree = dir => JSON.stringify(fs.readdirSync(dir, { recursive: true }).sort());

  test('start in a project folder that is missing is refused and creates nothing', () => {
    const root = repo();
    const r = go(root, ['start', SLUG]);
    assert.deepEqual(r, { out: 'refused: project folder is missing', code: 2 });
    assert.deepEqual(fs.readdirSync(work(root)), []);
  });

  test('a project folder that is a link out of work: start refuses, show and projects read nothing from the target', t => {
    const root = repo();
    const out = outsideDir();
    fs.mkdirSync(path.join(out, '01-feature'));
    fs.writeFileSync(path.join(out, '01-feature', 'run-state.jsonl'), openState());
    const before = tree(out);
    if (!link(t, out, path.join(work(root), ID))) return;
    assert.equal(go(root, ['start', `${ID}/02-fix`]).code, 2);
    assert.equal(go(root, ['start', SLUG]).code, 2);
    assert.equal(tree(out), before);
    assert.notEqual(rs.show(root, SLUG, { now: T0 }).state, 'running');
    assert.deepEqual(ids(rs.projects(root, { now: T0 })), []);
  });

  test('a project ID that is a plain file: start refuses, projects lists nothing, the file is untouched', () => {
    const root = repo();
    fs.writeFileSync(path.join(work(root), ID), 'not a folder');
    const r = go(root, ['start', SLUG]);
    assert.equal(r.code, 2);
    assert.match(r.out, /^refused: /);
    assert.equal(fs.readFileSync(path.join(work(root), ID), 'utf8'), 'not a folder');
    assert.deepEqual(ids(rs.projects(root, { now: T0 })), []);
  });

  for (const which of ['work', '.company']) {
    test(`${which} as a link out of the repo: start refuses, show and projects read nothing from the target (R-1)`, t => {
      const root = path.join(base, `linked${n++}`);
      fs.mkdirSync(root);
      const out = outsideDir();
      const inner = which === 'work' ? out : path.join(out, 'work');
      fs.mkdirSync(path.join(inner, ID, '01-feature'), { recursive: true });
      fs.writeFileSync(path.join(inner, ID, '00-project.md'), 'Secret Project Description\n');
      fs.writeFileSync(path.join(inner, ID, '01-feature', 'run-state.jsonl'), openState());
      if (which === 'work') fs.mkdirSync(path.join(root, '.company'));
      if (!link(t, out, which === 'work' ? path.join(root, '.company', 'work') : path.join(root, '.company'))) return;
      const before = tree(out);
      for (const slug of [SLUG, `${ID}/02-fix`]) {
        const r = go(root, ['start', slug]);
        assert.equal(r.code, 2, slug);
        assert.match(r.out, /^refused: /);
      }
      assert.equal(tree(out), before);
      assert.notEqual(rs.show(root, SLUG, { now: T0 }).state, 'running');
      assert.deepEqual(ids(rs.projects(root, { now: T0 })), []);
    });
  }
});

describe('projects run cap (R-4, R-5)', () => {
  const CAP = 'over 200 runs';
  const old = i => `P20261001.${String(i + 1).padStart(6, '0')}`;

  test('205 old projects: the recent one is listed and the cap warning shows exactly once', () => {
    const root = repo();
    for (let i = 0; i < 205; i++) v3(root, old(i), ['01-feature'], -24 * H);
    v3(root, ID, ['01-feature'], -1 * H);
    const r = rs.projects(root, { now: T0 });
    assert.deepEqual(ids(r), [ID]);
    assert.deepEqual(r.warnings, [CAP]);
  });

  test('inside one project: 205 projects with two runs each warn exactly once', () => {
    const root = repo();
    for (let i = 0; i < 205; i++) v3(root, old(i), ['01-feature', '02-fix'], -24 * H);
    const r = rs.projects(root, { now: T0 });
    assert.deepEqual(r.warnings, [CAP]);
  });

  test('exactly 200 runs, then a non-run name: no warning', () => {
    const root = repo();
    for (let i = 0; i < 200; i++) v3(root, old(i), ['01-feature'], -24 * H);
    fs.mkdirSync(path.join(work(root), 'A-notes'));
    assert.deepEqual(rs.projects(root, { now: T0 }).warnings, []);
  });

  test('201 runs: one run is skipped and the warning shows once', () => {
    const root = repo();
    for (let i = 0; i < 201; i++) v3(root, old(i), ['01-feature'], -24 * H);
    assert.deepEqual(rs.projects(root, { now: T0 }).warnings, [CAP]);
  });
});
