// Tests (draft-input v1.6, ticket-approval v1.6, intake-record v1.1): a later draft/build run of a
// v3 project is a sub folder of it, the parent is found by slug; a v2 parent keeps today's sibling
// `<ID>-HH.MM.SS` folder and its bytes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main as draft } from './draft-input.mjs';
import { main as approve } from './ticket-approval.mjs';
import { main as intake } from './intake.mjs';
import { makeProject, makeProjectV3, makeRunV3 } from '../mods/lib/work-folder.mjs';

const IO = { fs, path, platform: process.platform };
const NL = '\n';
const BASE = 'a'.repeat(40);
const T0 = new Date(2026, 10, 9, 9, 15, 7);
const T1 = new Date(2026, 10, 9, 10, 20, 30);
const T2 = new Date(2026, 10, 9, 11, 25, 41);

const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-build-v3-')));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'project.md'), '# Project profile\n\n## Core\n- skills/pipeline: x\n\n## Modules\n- skills/other: x\n');
  return root;
}
const work = (root) => path.join(root, '.company', 'work');
const put = (root, rel, body) => {
  const file = path.join(work(root), ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
const tops = (root) => fs.readdirSync(work(root)).sort();

// path -> base64 of bytes, for every file under the work folder
function snapshot(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.set(path.relative(work(root), full).replaceAll('\\', '/'), fs.readFileSync(full).toString('base64'));
    }
  };
  walk(work(root));
  return out;
}

const block = (n, id) => [`### ${id}-T${n} a task`, '- role: backend-engineer', `- files: src/t${n}.mjs`, '- depends-on: none', ''].join(NL);
const planText = (id, ...n) => ['# Plan: demo', '', `Base commit: ${BASE}`, '', '## Tasks', '', ...n.map((x) => block(x, id))].join(NL) + NL;
const BRIEF = 'Login brief\n\nAC1: accept an email\nAC2: refuse a bad password\n';
const esc = (id) => id.replace('.', '\\.');

// A v3 project P with run 01 (to-tickets) holding a plan and a brief.
function v3(root) {
  const { id, name } = makeProjectV3(IO, root, T0, 'Login page', 'to-tickets');
  put(root, `${name}/plan.md`, planText(id, 1, 2));
  put(root, `${name}/brief.md`, BRIEF);
  return { id, parent: name };
}
const SIB = (id) => new RegExp(`^${esc(id)}-\\d\\d\\.\\d\\d\\.\\d\\d$`);
const take = (root, rel, forWhat, now) => draft(['take', `.company/work/${rel}`, '--for', forWhat], { root, now });
const slugOf = (r) => r.lines.find((l) => l.startsWith('slug: '))?.slice(6);
// Every earlier file keeps its bytes; a file in `grown` may only have been appended to (the approval record).
const unchanged = (before, root, grown = []) => {
  const now = snapshot(root);
  for (const [file, bytes] of before) {
    if (grown.some((g) => file.endsWith(g))) assert.ok(now.get(file).length >= bytes.length && Buffer.from(now.get(file), 'base64').toString().startsWith(Buffer.from(bytes, 'base64').toString()), `${file} only appended`);
    else assert.equal(now.get(file), bytes, `${file} unchanged`);
  }
};

// ---- draft-input in a v3 project

test('draft-input: a later build (feature) run of a v3 project is a sub folder of it', () => {
  const root = fixture();
  const { id, parent } = v3(root);
  const before = snapshot(root);
  const r = take(root, `${parent}/plan.md`, 'feature', T1);
  assert.equal(r.code, 0, r.lines.join(NL));
  const slug = slugOf(r);
  assert.match(slug, new RegExp(`^${esc(id)}/02-[a-z0-9-]+$`));
  assert.ok(r.lines.includes(`input: .company/work/${slug}/input-feature.md`), r.lines.join(NL));
  assert.equal(fs.readFileSync(path.join(work(root), ...slug.split('/'), 'input-feature.md'), 'utf8'), planText(id, 1, 2));
  assert.deepEqual(tops(root), [id], 'no sibling <ID>-HH.MM.SS and no other top folder');
  unchanged(before, root);
});

test('draft-input: a later draft (to-tickets) run is a sub folder, and the next one is the next NN', () => {
  const root = fixture();
  const { id, parent } = v3(root);
  const a = take(root, `${parent}/brief.md`, 'to-tickets', T1);
  assert.equal(a.code, 0, a.lines.join(NL));
  const first = slugOf(a);
  assert.match(first, new RegExp(`^${esc(id)}/02-[a-z0-9-]+$`));
  const b = take(root, `${parent}/brief.md`, 'to-tickets', T2);
  assert.equal(b.code, 0, b.lines.join(NL));
  assert.match(slugOf(b), new RegExp(`^${esc(id)}/03-[a-z0-9-]+$`));
  assert.deepEqual(tops(root), [id]);
  assert.ok(fs.existsSync(path.join(work(root), ...first.split('/'), 'input-to-tickets.md')));
});

test('draft-input: fix from a v3 build run plan makes a sub folder of the same project', () => {
  const root = fixture();
  const { id, parent } = v3(root);
  const build = makeRunV3(IO, root, id, T1, 'build');
  put(root, `${build}/plan.md`, planText(id, 1));
  const r = take(root, `${build}/plan.md`, 'fix', T2);
  assert.equal(r.code, 0, r.lines.join(NL));
  assert.match(slugOf(r), new RegExp(`^${esc(id)}/03-[a-z0-9-]+$`));
  assert.deepEqual(tops(root), [id]);
  assert.ok(fs.existsSync(path.join(work(root), parent, 'plan.md')));
});

// ---- a v2 parent keeps today's sibling folder

test('draft-input: a v2 parent gives a sibling <ID>-HH.MM.SS folder, no <ID>/ is made, old bytes are equal', () => {
  const root = fixture();
  const { name: parent } = makeProject(IO, root, T0, 'Login page', 'feature');
  const id = parent.slice(0, parent.indexOf('-'));
  put(root, `${parent}/plan.md`, planText(id, 1, 2));
  const before = snapshot(root);
  const r = take(root, `${parent}/plan.md`, 'feature', T1);
  assert.equal(r.code, 0, r.lines.join(NL));
  const slug = slugOf(r);
  assert.match(slug, SIB(id));
  assert.notEqual(slug, parent);
  assert.ok(!tops(root).includes(id), 'no <ID>/ project folder');
  assert.ok(tops(root).every((n) => SIB(id).test(n)), tops(root).join(','));
  unchanged(before, root);
});

// ---- ticket-approval in a v3 run

function approveAll(root, slug, id) {
  const run = (...a) => approve(a, { root, now: T1.getTime() });
  assert.equal(run('tickets', slug, 'plan.md', '--phase', 'd').code, 0);
  for (const t of [`${id}-T1`, `${id}-T2`, 'S0']) assert.equal(run('ticket', slug, t, 'approve').code, 0, t);
  return run;
}

test('ticket-approval: the record sits in the v3 run folder and build-plan makes a sub folder', () => {
  const root = fixture();
  const { id, parent } = v3(root);
  const run = approveAll(root, parent, id);
  assert.ok(fs.existsSync(path.join(work(root), id, '01-to-tickets', 'tickets.jsonl')), 'record in the run folder');
  const read = run('read', parent);
  assert.equal(read.code, 0, read.lines.join(NL));
  assert.equal(read.lines[0], 'state on');
  const r = run('build-plan', parent);
  assert.equal(r.code, 0, r.lines.join(NL));
  const line = r.lines.find((l) => l.startsWith('plan: '));
  assert.match(line, new RegExp(`^plan: \\.company/work/${esc(id)}/0[2-9]-[a-z0-9-]+/plan\\.md$`));
  assert.ok(fs.existsSync(path.join(root, line.slice(6))));
  assert.deepEqual(tops(root), [id], 'no sibling folder');
});

test('ticket-approval: a v2 parent still builds into a sibling <ID>-HH.MM.SS, no <ID>/, old bytes equal', () => {
  const root = fixture();
  const { name: parent } = makeProject(IO, root, T0, 'Login page', 'feature');
  const id = parent.slice(0, parent.indexOf('-'));
  put(root, `${parent}/plan.md`, planText(id, 1, 2));
  const run = approveAll(root, parent, id);
  const before = snapshot(root);
  const r = run('build-plan', parent);
  assert.equal(r.code, 0, r.lines.join(NL));
  assert.ok(!tops(root).includes(id), 'no <ID>/ project folder');
  const made = tops(root).filter((n) => n !== parent);
  assert.equal(made.length, 1);
  assert.match(made[0], SIB(id));
  unchanged(before, root, ['tickets.jsonl']);
});

// ---- intake-record keeps a v3 run slug

test('intake: a v3 run slug is accepted on add and set, an old name too, a bad slug is refused', () => {
  const root = fixture();
  const { id, parent } = v3(root);
  const out = [];
  const io = { root, now: Date.parse('2026-11-09T10:00:00Z'), out: (s) => out.push(s) };
  assert.equal(intake(['add', 'intake', 'Login Page', parent], io), 0, out.join(''));
  const rid = /^id: ([0-9a-f]{12})$/m.exec(out.join(''))[1];
  out.length = 0;
  assert.equal(intake(['set', rid, 'needs-info', parent], io), 0, out.join(''));
  out.length = 0;
  assert.equal(intake(['add', 'intake', 'Older Run', `${id}-09.15.07`], io), 0, out.join(''));
  out.length = 0;
  for (const bad of [`${id}/00-x`, `${id}/01-x/extra`, `${id}/../x`, `${id}\\01-x`]) {
    assert.equal(intake(['add', 'intake', 'Bad Slug', bad], io), 2, bad);
  }
  out.length = 0;
  assert.equal(intake(['list', '--json'], io), 0);
  assert.ok(out.join('').includes(JSON.stringify(parent)), out.join(''));
});

// ---- a second build-plan of a v3 project, and the cleanup of a build folder whose plan write failed

test('ticket-approval: a second build-plan of the same v3 project is refused with file exists and names the first plan', () => {
  const root = fixture();
  const { id, parent } = v3(root);
  const run = approveAll(root, parent, id);
  const first = run('build-plan', parent);
  assert.equal(first.code, 0, first.lines.join(NL));
  const firstPlan = first.lines.find((l) => l.startsWith('plan: '));
  const before = snapshot(root);
  const second = run('build-plan', parent);
  assert.notEqual(second.code, 0, second.lines.join(NL));
  assert.ok(second.lines.some((l) => /file exists/.test(l)), second.lines.join(NL));
  assert.ok(second.lines.includes(firstPlan), `names the earlier plan: ${second.lines.join(NL)}`);
  assert.deepEqual([...snapshot(root).keys()].sort(), [...before.keys()].sort(), 'no new folder or file');
  const builds = fs.readdirSync(path.join(work(root), id)).filter((n) => /-build$/.test(n));
  assert.equal(builds.length, 1, builds.join(','));
});

test('ticket-approval: a plan write that cannot create the file removes the fresh build folder of a v3 project', (t) => {
  const root = fixture();
  const { id, parent } = v3(root);
  const run = approveAll(root, parent, id);
  const before = fs.readdirSync(path.join(work(root), id)).sort();
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (file, ...rest) => {
    if (/-build[\\/]plan\.md$/.test(String(file))) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return open(file, ...rest);
  });
  const r = run('build-plan', parent);
  t.mock.restoreAll();
  assert.notEqual(r.code, 0, r.lines.join(NL));
  assert.deepEqual(fs.readdirSync(path.join(work(root), id)).sort(), before, 'the fresh <NN>-build folder is gone');
  assert.deepEqual(tops(root), [id]);
});

test('ticket-approval: dropFreshRun removes a v3 build folder holding only its summary, and nothing more', async () => {
  const { dropFreshRun } = await import('./ticket-approval.mjs');
  const root = fixture();
  const { id } = v3(root);
  const slug = makeRunV3(IO, root, id, T1, 'build');
  const dir = path.join(work(root), ...slug.split('/'));
  assert.deepEqual(fs.readdirSync(dir), ['00-summary.md']);
  dropFreshRun(root, slug);
  assert.ok(!fs.existsSync(dir), 'folder removed');
  assert.ok(fs.existsSync(path.join(work(root), id, '00-project.md')), 'the project folder stays');
  const kept = makeRunV3(IO, root, id, T2, 'build');
  const keptDir = path.join(work(root), ...kept.split('/'));
  fs.writeFileSync(path.join(keptDir, 'notes.md'), 'x');
  dropFreshRun(root, kept);
  assert.ok(fs.existsSync(path.join(keptDir, 'notes.md')), 'a folder with another file stays');
  for (const bad of [id, `${id}/..`, `${id}/01-to-tickets/x`, '../x']) assert.doesNotThrow(() => dropFreshRun(root, bad), bad);
  assert.ok(fs.existsSync(path.join(work(root), id, '01-to-tickets')), 'a run that was never named stays');
});

test('ticket-approval: a plan write that fails after the file was created leaves no build folder of a v3 project', (t) => {
  const root = fixture();
  const { id, parent } = v3(root);
  const run = approveAll(root, parent, id);
  const before = fs.readdirSync(path.join(work(root), id)).sort();
  const write = fs.writeSync;
  const open = fs.openSync;
  const planFds = new Set();
  t.mock.method(fs, 'openSync', (file, ...rest) => {
    const fd = open(file, ...rest);
    if (/-build[\\/]plan\.md$/.test(String(file))) planFds.add(fd);
    return fd;
  });
  t.mock.method(fs, 'writeSync', (fd, ...rest) => {
    if (planFds.has(fd)) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return write(fd, ...rest);
  });
  let thrown = null;
  let r = null;
  try { r = run('build-plan', parent); } catch (error) { thrown = error; }
  t.mock.restoreAll();
  assert.ok(thrown !== null || r.code !== 0, 'the write failure is reported');
  assert.deepEqual(fs.readdirSync(path.join(work(root), id)).sort(), before, 'the fresh <NN>-build folder is gone');
});
