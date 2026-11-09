// Tests for run-guard v1.3 and run-stage v1.1 on a v3 run slug `<ProjectID>/<NN>-<playbook>` (AC21, AC7, AC12).
// Read side: run-guard `gate` and run-stage `show`; write side: run-stage `set`. Old names stay byte-identical (AC7).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main as guard } from './run-guard.mjs';
import { main as stageMain, readStage, setStage, MAX_LINES } from './run-stage.mjs';

const GUARD = fileURLToPath(new URL('./run-guard.mjs', import.meta.url));
const STAGE = fileURLToPath(new URL('./run-stage.mjs', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-stage-v3-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const ID = 'P20261109.000001';
const ID2 = 'P20261109.000002';
const SLUG = `${ID}/01-feature`;
const SLUG2 = `${ID}/02-fix`;
const V2 = `${ID2}-10.00.00`;
const AT = '2026-11-09T10:00:00Z';
const ID40 = 'a'.repeat(40);
const ZERO = ['guardrail files: 0 sibling, 0 extra, 0 archived, 0 conflicts', 'guardrail handover: 0 of 0 Steps'];

let n = 0;
function repo() {
  const root = path.join(base, `r${n++}`);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}
const dirOf = (root, slug) => path.join(root, '.company', 'work', ...slug.split('/'));
function mk(root, slug) {
  fs.mkdirSync(dirOf(root, slug), { recursive: true });
  return dirOf(root, slug);
}
const jsonl = events => events.map(e => JSON.stringify({ v: 1, at: AT, ...e })).join('\n') + '\n';
const put = (root, slug, name, text) => fs.writeFileSync(path.join(dirOf(root, slug), name), text);
function handoff(root, slug, name, step, status) {
  put(root, slug, name, `---\nstep: ${step}\nrole: backend-engineer\ntask: ${slug}\nstatus: ${status}\nround: 0\nbase-commit: 922f4ef\nrisk-tier: high\n---\nBy: backend-engineer\n## Did\n- x\n## Next\n- y\n`);
}
function records(root, slug) {
  put(root, slug, 'parallel.jsonl', jsonl([
    { ev: 'begin', plan: '03-plan.md', hash: '0123456789ab', cap: 3, mode: 'waves', tasks: 2, ow: [] },
    { ev: 'start', task: `${ID}-T1`, round: 0, ow: [] },
    { ev: 'out', task: `${ID}-T1`, round: 0, extra: ['src/a.mjs'], sibling: ['src/b.mjs', 'src/c.mjs'] }
  ]));
  put(root, slug, 'worktrees.jsonl', jsonl([
    { ev: 'add', task: 't1', base: ID40 },
    { ev: 'conflict', task: 't1', paths: ['src/a.mjs'] },
    { ev: 'archive', task: 't1', commit: ID40, patch: 't1-20261109T100000Z.patch' }
  ]));
}
// A junction (directory link) needs no privilege on Windows; the test fails, never skips, when it cannot be made.
const junction = (target, link) => fs.symlinkSync(target, link, 'junction');

const BAD_SHAPES = [
  ID, // a bare project folder is not a run
  `${ID}/`, `${ID}/01`, `${ID}/1-feature`, `${ID}/00-feature`, `${ID}/01-Feature`, `${ID}/01-feature/x`,
  `${ID}/..`, `${ID}/../${ID2}/01-feature`, `../${ID}/01-feature`, `${ID}\\01-feature`, `${ID}%2F01-feature`,
  `${ID}~01-feature`, `/${SLUG}`, `${SLUG}/`, `${ID}//01-feature`, `${ID}/01-${'a'.repeat(70)}`
];

describe('run-guard gate on a v3 slug (run-guard v1.3, AC21)', () => {
  test('an empty v3 run folder: zeros, exit 0', () => {
    const root = repo();
    mk(root, SLUG);
    assert.deepEqual(guard(['gate', SLUG], { root }), { code: 0, lines: ZERO });
  });

  test('no project folder at all: zeros, exit 0', () => {
    assert.deepEqual(guard(['gate', SLUG], { root: repo() }), { code: 0, lines: ZERO });
  });

  test('counts come from the records inside <ID>/<NN>-<pb>/ and its Handoffs', () => {
    const root = repo();
    mk(root, SLUG);
    records(root, SLUG);
    handoff(root, SLUG, '10-backend-engineer.md', '10', 'handover');
    handoff(root, SLUG, '11-backend-engineer.md', '11', 'done');
    const r = guard(['gate', SLUG], { root });
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, [
      'guardrail files: 2 sibling, 1 extra, 1 archived, 1 conflicts',
      'guardrail handover: 1 of 2 Steps'
    ]);
  });

  test('a sibling run of the same project is never counted', () => {
    const root = repo();
    mk(root, SLUG);
    mk(root, SLUG2);
    records(root, SLUG2);
    handoff(root, SLUG2, '10-backend-engineer.md', '10', 'handover');
    handoff(root, SLUG2, '11-backend-engineer.md', '11', 'handover');
    assert.deepEqual(guard(['gate', SLUG], { root }).lines, ZERO);
    assert.equal(guard(['gate', SLUG2], { root }).lines[1], 'guardrail handover: 2 of 2 Steps');
  });

  test('a broken record in a v3 run prints unknown for files and still exits 0', () => {
    const root = repo();
    mk(root, SLUG);
    put(root, SLUG, 'worktrees.jsonl', 'x'.repeat(70 * 1024));
    handoff(root, SLUG, '10-backend-engineer.md', '10', 'handover');
    const r = guard(['gate', SLUG], { root });
    assert.equal(r.code, 0);
    assert.match(r.lines[0], /^guardrail files: unknown \(/);
    assert.equal(r.lines[1], 'guardrail handover: 1 of 1 Steps');
  });

  test('a run folder that is a file prints unknown for files and exits 0', () => {
    const root = repo();
    mk(root, ID);
    fs.writeFileSync(dirOf(root, SLUG), 'not a folder');
    const r = guard(['gate', SLUG], { root });
    assert.equal(r.code, 0);
    assert.match(r.lines[0], /^guardrail files: unknown \(/);
  });

  test('refused shapes: exit 3, one `refused: bad slug` line, nothing read', () => {
    const root = repo();
    mk(root, SLUG);
    for (const bad of BAD_SHAPES) {
      const r = guard(['gate', bad], { root });
      assert.deepEqual(r, { code: 3, lines: ['refused: bad slug'] }, JSON.stringify(bad));
    }
  });

  test('a run folder spelled in another letter case is `wrong letter case`, exit 3, nothing read', () => {
    const root = repo();
    mk(root, `${ID}/01-FEATURE`);
    put(root, `${ID}/01-FEATURE`, 'worktrees.jsonl', jsonl([{ ev: 'add', task: 't1', base: ID40 }]));
    assert.deepEqual(guard(['gate', SLUG], { root }), { code: 3, lines: ['refused: wrong letter case'] });
  });

  test('a v3 slug of an ID with other letters is not folded onto a sibling project', () => {
    const root = repo();
    mk(root, `${ID2}/01-feature`);
    assert.deepEqual(guard(['gate', SLUG], { root }).lines, ZERO);
  });

  test('a project folder that is a junction to outside the work folder is never read', () => {
    const root = repo();
    const outside = path.join(base, `outside${n++}`);
    fs.mkdirSync(path.join(outside, '01-feature'), { recursive: true });
    fs.writeFileSync(path.join(outside, '01-feature', 'worktrees.jsonl'), jsonl([{ ev: 'add', task: 't1', base: ID40 }, { ev: 'archive', task: 't1', commit: ID40, patch: 't1-20261109T100000Z.patch' }]));
    junction(outside, path.join(root, '.company', 'work', ID));
    const r = guard(['gate', SLUG], { root });
    assert.equal(r.code, 0);
    assert.ok(!r.lines.some(l => /1 archived/.test(l)), r.lines.join('|'));
  });

  test('CLI: a v3 slug prints the two lines, exit 0; a bad shape exits 3', () => {
    const root = repo();
    mk(root, SLUG);
    handoff(root, SLUG, '10-backend-engineer.md', '10', 'handover');
    const ok = spawnSync(process.execPath, [GUARD, 'gate', SLUG], { cwd: root, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, 'guardrail files: 0 sibling, 0 extra, 0 archived, 0 conflicts\nguardrail handover: 1 of 1 Steps\n');
    const bad = spawnSync(process.execPath, [GUARD, 'gate', `${SLUG}/x`], { cwd: root, encoding: 'utf8' });
    assert.equal(bad.status, 3);
    assert.equal(bad.stdout, 'refused: bad slug\n');
  });

  test('v2 and legacy names give today\'s output unchanged (AC7)', () => {
    const root = repo();
    mk(root, V2);
    handoff(root, V2, '10-backend-engineer.md', '10', 'handover');
    assert.deepEqual(guard(['gate', V2], { root }).lines, ['guardrail files: 0 sibling, 0 extra, 0 archived, 0 conflicts', 'guardrail handover: 1 of 1 Steps']);
    mk(root, 'demo-run');
    assert.deepEqual(guard(['gate', 'demo-run'], { root }), { code: 0, lines: ZERO });
    assert.deepEqual(guard(['gate', 'a/b'], { root }), { code: 3, lines: ['refused: bad slug'] });
  });
});

describe('run-stage on a v3 slug (run-stage v1.1, AC21)', () => {
  const stageFile = (root, slug) => path.join(dirOf(root, slug), 'stage.jsonl');

  test('set writes stage.jsonl inside <ID>/<NN>-<pb>/ and nowhere else', () => {
    const root = repo();
    mk(root, SLUG);
    assert.deepEqual(setStage(root, SLUG, 'build', new Date('2026-11-09T10:00:00Z')), { ok: true });
    assert.equal(fs.readFileSync(stageFile(root, SLUG), 'utf8'), `{"v":1,"at":"${AT}","stage":"build"}\n`);
    assert.ok(!fs.existsSync(path.join(root, '.company', 'work', ID, 'stage.jsonl')));
    assert.deepEqual(fs.readdirSync(path.join(root, '.company', 'work')), [ID]);
  });

  test('show echoes the slug with its slash and reports the last stage', () => {
    const root = repo();
    mk(root, SLUG);
    setStage(root, SLUG, 'plan');
    setStage(root, SLUG, 'review');
    const v = readStage(root, SLUG);
    assert.equal(v.slug, SLUG);
    assert.equal(v.stage, 'review');
    assert.equal(v.state, 'recorded');
    assert.match(v.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.deepEqual(Object.keys(v), ['v', 'slug', 'stage', 'at', 'state']);
  });

  test('two runs of one project keep separate stages', () => {
    const root = repo();
    mk(root, SLUG);
    mk(root, SLUG2);
    setStage(root, SLUG, 'build');
    setStage(root, SLUG2, 'ship-gate');
    assert.equal(readStage(root, SLUG).stage, 'build');
    assert.equal(readStage(root, SLUG2).stage, 'ship-gate');
  });

  test('a v3 run with no stage file: state none, slug echoed', () => {
    const root = repo();
    mk(root, SLUG);
    assert.deepEqual(readStage(root, SLUG), { v: 1, slug: SLUG, stage: null, at: null, state: 'none' });
  });

  test('no run folder and no project folder: set refuses `no run folder`, show gives none', () => {
    const root = repo();
    assert.deepEqual(setStage(root, SLUG, 'build'), { reason: 'no run folder' });
    assert.deepEqual(readStage(root, SLUG), { v: 1, slug: SLUG, stage: null, at: null, state: 'none' });
    mk(root, ID);
    assert.deepEqual(setStage(root, SLUG, 'build'), { reason: 'no run folder' });
    assert.ok(!fs.existsSync(stageFile(root, SLUG)));
  });

  test('set on a project folder with no run folder creates nothing', () => {
    const root = repo();
    mk(root, ID);
    assert.deepEqual(setStage(root, SLUG, 'build'), { reason: 'no run folder' });
    assert.deepEqual(fs.readdirSync(path.join(root, '.company', 'work', ID)), []);
  });

  test('refused shapes: set says `bad slug`, show prints slug null and state none', () => {
    const root = repo();
    mk(root, SLUG);
    for (const bad of BAD_SHAPES) {
      assert.deepEqual(setStage(root, bad, 'build'), { reason: 'bad slug' }, JSON.stringify(bad));
      assert.deepEqual(readStage(root, bad), { v: 1, slug: null, stage: null, at: null, state: 'none' }, JSON.stringify(bad));
    }
    assert.ok(!fs.existsSync(stageFile(root, SLUG)));
  });

  test('unknown stage on a v3 run is refused, nothing written', () => {
    const root = repo();
    mk(root, SLUG);
    assert.deepEqual(setStage(root, SLUG, 'done'), { reason: 'unknown stage' });
    assert.ok(!fs.existsSync(stageFile(root, SLUG)));
  });

  test('a run folder spelled in another case is `wrong letter case` and nothing is written', () => {
    const root = repo();
    fs.mkdirSync(path.join(root, '.company', 'work', ID, '01-FEATURE'), { recursive: true });
    assert.deepEqual(setStage(root, SLUG, 'build'), { reason: 'wrong letter case' });
    assert.deepEqual(readStage(root, SLUG), { v: 1, slug: null, stage: null, at: null, state: 'none' });
    assert.deepEqual(fs.readdirSync(path.join(root, '.company', 'work', ID, '01-FEATURE')), []);
  });

  test('a run folder that is a junction is refused and its target untouched', () => {
    const root = repo();
    const outside = path.join(base, `outside${n++}`);
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(root, '.company', 'work', ID));
    junction(outside, dirOf(root, SLUG));
    assert.deepEqual(setStage(root, SLUG, 'build'), { reason: 'no run folder' });
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal(readStage(root, SLUG).state, 'none');
  });

  test('a project folder that is a junction is refused and its target untouched', () => {
    const root = repo();
    const outside = path.join(base, `outside${n++}`);
    fs.mkdirSync(path.join(outside, '01-feature'), { recursive: true });
    fs.writeFileSync(path.join(outside, '01-feature', 'stage.jsonl'), `{"v":1,"at":"${AT}","stage":"plan"}\n`);
    junction(outside, path.join(root, '.company', 'work', ID));
    assert.deepEqual(setStage(root, SLUG, 'build'), { reason: 'no run folder' });
    assert.equal(fs.readFileSync(path.join(outside, '01-feature', 'stage.jsonl'), 'utf8'), `{"v":1,"at":"${AT}","stage":"plan"}\n`);
    assert.equal(readStage(root, SLUG).state, 'none');
  });

  test('a hard-linked stage file in a v3 run is unreadable and refused for set', () => {
    const root = repo();
    mk(root, SLUG);
    const other = path.join(base, `other${n++}.jsonl`);
    fs.writeFileSync(other, `{"v":1,"at":"${AT}","stage":"plan"}\n`);
    fs.linkSync(other, stageFile(root, SLUG));
    assert.equal(readStage(root, SLUG).state, 'unreadable');
    assert.deepEqual(setStage(root, SLUG, 'build'), { reason: 'stage file unreadable' });
    assert.equal(fs.readFileSync(other, 'utf8'), `{"v":1,"at":"${AT}","stage":"plan"}\n`);
  });

  test('an unparsable last line in a v3 run is unreadable; the slug is echoed', () => {
    const root = repo();
    mk(root, SLUG);
    fs.writeFileSync(stageFile(root, SLUG), 'not json\n');
    assert.deepEqual(readStage(root, SLUG), { v: 1, slug: SLUG, stage: null, at: null, state: 'unreadable' });
  });

  test('the 200 line cap holds in a v3 run', () => {
    const root = repo();
    mk(root, SLUG);
    fs.writeFileSync(stageFile(root, SLUG), `{"v":1,"at":"${AT}","stage":"plan"}\n`.repeat(MAX_LINES));
    assert.deepEqual(setStage(root, SLUG, 'build'), { reason: 'stage file full' });
  });

  test('CLI: set then show --json with a v3 slug; refusals print one line, exit 2', () => {
    const root = repo();
    mk(root, SLUG);
    const run = (...args) => spawnSync(process.execPath, [STAGE, ...args], { cwd: root, encoding: 'utf8' });
    const set = run('set', SLUG, 'review');
    assert.equal(set.status, 0, set.stderr);
    assert.equal(set.stdout, '');
    const show = run('show', SLUG, '--json');
    assert.equal(show.status, 0);
    const v = JSON.parse(show.stdout);
    assert.equal(v.slug, SLUG);
    assert.equal(v.stage, 'review');
    const bad = run('set', `${SLUG}/x`, 'review');
    assert.equal(bad.status, 2);
    assert.equal(bad.stdout, 'refused: bad slug\n');
    const lines = [];
    assert.equal(stageMain(['set', `${ID}/09-none`, 'build'], { cwd: root, out: l => lines.push(l) }), 2);
    assert.deepEqual(lines, ['refused: no run folder']);
  });

  test('v2 and legacy names behave as today (AC7)', () => {
    const root = repo();
    mk(root, V2);
    mk(root, 'demo-run');
    assert.deepEqual(setStage(root, V2, 'plan', new Date('2026-11-09T10:00:00Z')), { ok: true });
    assert.equal(fs.readFileSync(path.join(root, '.company', 'work', V2, 'stage.jsonl'), 'utf8'), `{"v":1,"at":"${AT}","stage":"plan"}\n`);
    assert.deepEqual(readStage(root, V2), { v: 1, slug: V2, stage: 'plan', at: AT, state: 'recorded' });
    assert.deepEqual(setStage(root, 'demo-run', 'build'), { ok: true });
    assert.deepEqual(setStage(root, 'a/b', 'build'), { reason: 'bad slug' });
  });
});
