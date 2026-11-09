// Tests for the work-folder v3 layout (work-folder-name v2.1, opt-in `--layout v3`).
// Path-shape checks stay drive-agnostic: temp dirs only, no Z:/UNC assumption.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as lib from '../mods/lib/work-folder.mjs';
import { main } from './work-folder.mjs';

const { parseRun, isRunSlug, workParts, runKey, isWorkFolder, projectIdOf, branchId } = lib;
const SCRIPT = fileURLToPath(new URL('./work-folder.mjs', import.meta.url));
const NOW = new Date(2026, 9, 30, 23, 45);
const ID = 'P20261030.000001';
const ID2 = 'P20261030.000002';

const dirs = [];
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-v3-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const work = root => path.join(root, '.company', 'work');
const top = root => fs.readdirSync(work(root)).sort();
const sub = (root, id) => fs.readdirSync(path.join(work(root), id)).sort();
const read = (root, ...parts) => fs.readFileSync(path.join(work(root), ...parts), 'utf8');
const run = (root, argv, now = NOW) => main(argv, { root, now });
const writeTopic = (root, text, id = 'idea') => fs.writeFileSync(path.join(root, '.company', `work-folder-topic-${id}.txt`), text);
const newV3 = (root, playbook = 'idea', now = NOW) => {
  writeTopic(root, 'Fix Login', playbook);
  return run(root, ['new', '--playbook', playbook, '--topic', 'file', '--layout', 'v3'], now);
};
const joinV3 = (root, id, playbook = 'fix', now = NOW) =>
  run(root, ['new', '--playbook', playbook, '--project', id, '--layout', 'v3'], now);
const mkV2 = (root, name, lines) => {
  fs.mkdirSync(path.join(work(root), name));
  fs.writeFileSync(path.join(work(root), name, '00-summary.md'), lines.join('\n') + '\n');
};
// name -> file contents, recursive, to prove old folders stay byte-identical.
function snapshot(dir, rel = '') {
  const out = {};
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) Object.assign(out, { [r + '/']: '' }, snapshot(dir, r));
    else out[r] = fs.readFileSync(path.join(dir, r), 'utf8');
  }
  return out;
}

describe('slug helpers (exports of mods/lib/work-folder.mjs)', () => {
  test('the four v3 helpers are exported', () => {
    for (const fn of ['parseRun', 'isRunSlug', 'workParts', 'runKey']) assert.equal(typeof lib[fn], 'function', fn);
  });

  test('parseRun returns { id, nn, playbook } for a v3 slug', () => {
    const r = parseRun(`${ID}/01-idea`);
    assert.equal(r.id, ID);
    assert.equal(r.playbook, 'idea');
    assert.equal(Number(r.nn), 1);
    const r2 = parseRun(`${ID}/123-usability-test`);
    assert.equal(r2.playbook, 'usability-test');
    assert.equal(Number(r2.nn), 123);
  });

  const badSlugs = [
    ['backslash', `${ID}\\01-idea`],
    ['two slashes', `${ID}/01-idea/x`],
    ['trailing slash', `${ID}/01-idea/`],
    ['leading slash', `/${ID}/01-idea`],
    ['NN 00', `${ID}/00-idea`],
    ['NN 000', `${ID}/000-idea`],
    ['NN one digit', `${ID}/1-idea`],
    ['NN four digits', `${ID}/1000-idea`],
    ['no playbook', `${ID}/01-`],
    ['no NN', `${ID}/idea`],
    ['bad playbook id', `${ID}/01-Idea`],
    ['playbook with double dash', `${ID}/01-a--b`],
    ['bad project id', 'P20261308.000001/01-idea'],
    ['traversal id', '../01-idea'],
    ['traversal run', `${ID}/..`],
    ['dot run', `${ID}/.`],
    ['v2 name', `${ID}-23.45.00`],
    ['over 80 chars', `${ID}/01-${'a'.repeat(61)}`],
    ['not a string', 42],
    ['empty', ''],
  ];
  for (const [label, slug] of badSlugs) {
    test(`parseRun, workParts and isRunSlug-as-v3 refuse: ${label}`, () => {
      assert.equal(parseRun(slug), null);
      if (label !== 'v2 name') assert.equal(isRunSlug(slug), false);
      if (label !== 'v2 name') assert.equal(workParts(slug), null);
    });
  }

  test('a slug of exactly 80 characters is accepted', () => {
    const slug = `${ID}/01-${'a'.repeat(60)}`;
    assert.equal(slug.length, 80);
    assert.notEqual(parseRun(slug), null);
  });

  test('NN 01 and 999 are the bounds', () => {
    assert.notEqual(parseRun(`${ID}/01-idea`), null);
    assert.notEqual(parseRun(`${ID}/999-idea`), null);
  });

  test('isRunSlug accepts a v3 slug and every v2, v1.1 and legacy top-level name', () => {
    assert.equal(isRunSlug(`${ID}/01-idea`), true);
    assert.equal(isRunSlug(`${ID}-23.45.00`), true);
    assert.equal(isRunSlug('2026-10-30 23.45 - Fix Login'), true);
    assert.equal(isRunSlug('some-legacy-slug'), true);
  });

  test('isWorkFolder keeps its v2 meaning: a v3 slug is refused (fail closed)', () => {
    assert.equal(isWorkFolder(`${ID}/01-idea`), false);
    assert.equal(isWorkFolder(`${ID}-23.45.00`), true);
  });

  test('workParts: two parts for v3, one for a v2 name, null for neither', () => {
    assert.deepEqual(workParts(`${ID}/02-fix`), [ID, '02-fix']);
    assert.deepEqual(workParts(`${ID}-23.45.00`), [`${ID}-23.45.00`]);
    assert.deepEqual(workParts('some-legacy-slug'), ['some-legacy-slug']);
    assert.equal(workParts('a/b'), null);
    assert.equal(workParts('..'), null);
  });

  test('runKey is flat: ID~NN-playbook for v3, the name itself otherwise', () => {
    assert.equal(runKey(`${ID}/02-fix`), `${ID}~02-fix`);
    assert.equal(runKey(`${ID}-23.45.00`), `${ID}-23.45.00`);
    assert.equal(runKey('some-legacy-slug'), 'some-legacy-slug');
    assert.ok(!runKey(`${ID}/02-fix`).includes('/'));
  });

  test('projectIdOf and branchId return the project ID for a v3 slug', () => {
    assert.equal(projectIdOf(`${ID}/03-fix`), ID);
    assert.equal(branchId(`${ID}/03-fix`), ID);
    assert.equal(projectIdOf(`${ID}-23.45.00`), ID);
  });
});

describe('new --layout v3: first run of a new project (AC2, AC6)', () => {
  test('makes one project folder with 00-project.md and 01-<playbook>, prints id, run slug, branch', () => {
    const root = project();
    const r = newV3(root);
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, [`id: ${ID}`, `name: ${ID}/01-idea`, `branch: aico/${ID}`]);
    assert.deepEqual(top(root), [ID]);
    assert.deepEqual(sub(root, ID), ['00-project.md', '01-idea']);
    assert.deepEqual(sub(root, `${ID}/01-idea`), ['00-summary.md']);
  });

  test('printed name is a run slug that parseRun reads', () => {
    const root = project();
    const slug = newV3(root).lines[1].slice('name: '.length);
    assert.deepEqual(parseRun(slug) && { id: parseRun(slug).id, playbook: parseRun(slug).playbook }, { id: ID, playbook: 'idea' });
    assert.ok(!slug.includes('\\'));
  });

  test('00-project.md: line 1 description, line 2 empty, no siblings line', () => {
    const root = project();
    newV3(root);
    const lines = read(root, ID, '00-project.md').split('\n');
    assert.equal(lines[0], 'Fix Login');
    assert.equal(lines[1], '');
    assert.ok(!lines.slice(2).some(l => l.startsWith('Siblings:')));
  });

  test('run 00-summary.md has the v2 shape: description, empty, Run: first <playbook>, no line 4', () => {
    const root = project();
    newV3(root);
    const lines = read(root, ID, '01-idea', '00-summary.md').split('\n');
    assert.equal(lines[0], 'Fix Login');
    assert.equal(lines[1], '');
    assert.equal(lines[2], 'Run: first idea');
    assert.ok(!lines[3]);
  });

  test('--topic none uses the fallback description', () => {
    const root = project();
    const r = run(root, ['new', '--playbook', 'idea', '--topic', 'none', '--layout', 'v3']);
    assert.equal(r.code, 0);
    const first = read(root, ID, '00-project.md').split('\n')[0];
    assert.ok(first.length > 0);
    assert.equal(read(root, ID, '01-idea', '00-summary.md').split('\n')[0], first);
  });

  test('the Topic file is consumed as in v2 (one-shot)', () => {
    const root = project();
    newV3(root);
    assert.equal(fs.existsSync(path.join(root, '.company', 'work-folder-topic-idea.txt')), false);
  });

  test('second new on the same day takes the next ID; counts bare v3 folders', () => {
    const root = project();
    newV3(root);
    const r = newV3(root, 'reprompt', new Date(2026, 9, 30, 23, 46));
    assert.deepEqual(r.lines, [`id: ${ID2}`, `name: ${ID2}/01-reprompt`, `branch: aico/${ID2}`]);
    assert.deepEqual(top(root), [ID, ID2]);
  });

  test('a v2 folder of the same day counts toward the next ID', () => {
    const root = project();
    mkV2(root, `${ID}-10.00.00`, ['Old', '', 'Run: first idea']);
    const r = newV3(root);
    assert.equal(r.lines[0], `id: ${ID2}`);
  });

  test('an archived bare project folder counts toward the next ID', () => {
    const root = project();
    fs.mkdirSync(path.join(root, '.company', 'archive', ID), { recursive: true });
    const r = newV3(root);
    assert.equal(r.lines[0], `id: ${ID2}`);
  });

  test('bad playbook refuses and creates nothing', () => {
    const root = project();
    const r = run(root, ['new', '--playbook', '../x', '--topic', 'none', '--layout', 'v3']);
    assert.equal(r.code, 3);
    assert.deepEqual(r.lines, ['refused: bad playbook']);
    assert.deepEqual(top(root), []);
  });

  for (const bad of ['v2', 'v4', 'V3', '', '3']) {
    test(`--layout ${JSON.stringify(bad)} refuses (usage), creates nothing; v3 itself is accepted`, () => {
      assert.equal(newV3(project()).code, 0);
      const root = project();
      const r = run(root, ['new', '--playbook', 'idea', '--topic', 'none', '--layout', bad]);
      assert.equal(r.code, 3);
      assert.deepEqual(r.lines, ['refused: usage']);
      assert.deepEqual(top(root), []);
    });
  }

  test('--layout given twice or without a value refuses (usage); v3 itself is accepted', () => {
    assert.equal(newV3(project()).code, 0);
    const root = project();
    for (const argv of [
      ['new', '--playbook', 'idea', '--topic', 'none', '--layout', 'v3', '--layout', 'v3'],
      ['new', '--playbook', 'idea', '--topic', 'none', '--layout'],
    ]) {
      const r = run(root, argv);
      assert.equal(r.code, 3);
      assert.deepEqual(r.lines, ['refused: usage']);
    }
    assert.deepEqual(top(root), []);
  });

  test('CLI process prints the three lines to stdout and exits 0', () => {
    const root = project();
    const res = spawnSync(process.execPath, [SCRIPT, 'new', '--playbook', 'idea', '--topic', 'none', '--layout', 'v3'], { cwd: root, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    const lines = res.stdout.trim().split('\n');
    assert.match(lines[0], /^id: P\d{8}\.\d{6}$/);
    assert.match(lines[1], /^name: P\d{8}\.\d{6}\/01-idea$/);
    assert.equal(lines[2], `branch: aico/${lines[0].slice(4)}`);
  });
});

describe('new --layout v3 --project: later run in a v3 project (AC5, AC9)', () => {
  test('makes the next NN as a sub folder, never a top-level entry', () => {
    const root = project();
    newV3(root);
    const r = joinV3(root, ID, 'fix');
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, [`id: ${ID}`, `name: ${ID}/02-fix`, `branch: aico/${ID}`]);
    assert.deepEqual(top(root), [ID]);
    assert.deepEqual(sub(root, ID), ['00-project.md', '01-idea', '02-fix']);
  });

  test('summary: description copied from 00-project.md, Run: later <playbook>', () => {
    const root = project();
    newV3(root);
    joinV3(root, ID, 'fix');
    const lines = read(root, ID, '02-fix', '00-summary.md').split('\n');
    assert.equal(lines[0], 'Fix Login');
    assert.equal(lines[1], '');
    assert.equal(lines[2], 'Run: later fix');
    assert.ok(!lines[3]);
  });

  test('two runs of the same kind get distinct sub paths and neither is overwritten (AC5)', () => {
    const root = project();
    newV3(root, 'reprompt');
    fs.writeFileSync(path.join(work(root), ID, '01-reprompt', 'note.txt'), 'first');
    const a = joinV3(root, ID, 'reprompt');
    fs.writeFileSync(path.join(work(root), ID, '02-reprompt', 'note.txt'), 'second');
    const b = joinV3(root, ID, 'reprompt');
    assert.equal(a.lines[1], `name: ${ID}/02-reprompt`);
    assert.equal(b.lines[1], `name: ${ID}/03-reprompt`);
    assert.equal(read(root, ID, '01-reprompt', 'note.txt'), 'first');
    assert.equal(read(root, ID, '02-reprompt', 'note.txt'), 'second');
    assert.deepEqual(top(root), [ID]);
  });

  test('NN is 1 plus the highest, gaps are not refilled, files and 00-project.md are skipped', () => {
    const root = project();
    newV3(root);
    fs.mkdirSync(path.join(work(root), ID, '05-bug'));
    fs.writeFileSync(path.join(work(root), ID, '09-file'), 'not a folder');
    const r = joinV3(root, ID, 'fix');
    assert.equal(r.lines[1], `name: ${ID}/06-fix`);
  });

  test('NN reaches three digits', () => {
    const root = project();
    newV3(root);
    fs.mkdirSync(path.join(work(root), ID, '99-bug'));
    assert.equal(joinV3(root, ID, 'fix').lines[1], `name: ${ID}/100-fix`);
  });

  test('past 999 refuses (too many runs), creates nothing', () => {
    const root = project();
    newV3(root);
    fs.mkdirSync(path.join(work(root), ID, '999-bug'));
    const before = sub(root, ID);
    const r = joinV3(root, ID, 'fix');
    assert.equal(r.code, 3);
    assert.deepEqual(r.lines, ['refused: too many runs']);
    assert.deepEqual(sub(root, ID), before);
  });

  test('another project is untouched', () => {
    const root = project();
    newV3(root);
    newV3(root, 'reprompt', new Date(2026, 9, 30, 23, 46));
    joinV3(root, ID, 'fix');
    assert.deepEqual(sub(root, ID2), ['00-project.md', '01-reprompt']);
  });

  test('unknown project refuses, creates nothing', () => {
    const root = project();
    const r = joinV3(root, ID, 'fix');
    assert.equal(r.code, 3);
    assert.deepEqual(r.lines, ['refused: unknown project']);
    assert.deepEqual(top(root), []);
  });

  for (const bad of ['../x', 'P20261030.000001/01-idea', 'p20261030.000001', 'P20261308.000001', '', '.']) {
    test(`bad project ${JSON.stringify(bad)} refuses (bad project)`, () => {
      const root = project();
      newV3(root);
      const before = snapshot(work(root));
      const r = joinV3(root, bad, 'fix');
      assert.equal(r.code, 3);
      assert.deepEqual(r.lines, ['refused: bad project']);
      assert.deepEqual(snapshot(work(root)), before);
    });
  }

  test('bad playbook refuses before anything is made', () => {
    const root = project();
    newV3(root);
    const before = snapshot(work(root));
    const r = joinV3(root, ID, 'no-such-playbook');
    assert.equal(r.code, 3);
    assert.deepEqual(r.lines, ['refused: bad playbook']);
    assert.deepEqual(snapshot(work(root)), before);
  });
});

describe('new --layout v3 --project on a v2-only project (AC7, AC9)', () => {
  const v2 = `${ID}-10.00.00`;

  test('makes a v3 project folder with 01-<playbook>; v2 folder stays byte-identical', () => {
    const root = project();
    mkV2(root, v2, ['Old work', '', 'Run: first idea']);
    const before = snapshot(path.join(work(root), v2));
    const r = joinV3(root, ID, 'fix');
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, [`id: ${ID}`, `name: ${ID}/01-fix`, `branch: aico/${ID}`]);
    assert.deepEqual(top(root), [ID, v2].sort());
    assert.deepEqual(sub(root, ID), ['00-project.md', '01-fix']);
    assert.deepEqual(snapshot(path.join(work(root), v2)), before);
  });

  test('00-project.md copies the description and the Siblings line from the v2 folder', () => {
    const root = project();
    mkV2(root, v2, ['Old work', '', 'Run: first idea', `Siblings: ${ID2}`]);
    joinV3(root, ID, 'fix');
    const lines = read(root, ID, '00-project.md').split('\n');
    assert.equal(lines[0], 'Old work');
    assert.equal(lines[1], '');
    assert.equal(lines[2], `Siblings: ${ID2}`);
    const sum = read(root, ID, '01-fix', '00-summary.md').split('\n');
    assert.equal(sum[0], 'Old work');
    assert.equal(sum[2], 'Run: later fix');
    assert.ok(!sum[3]);
  });

  test('two v2 folders of the project: still one v3 folder, v2 folders untouched', () => {
    const root = project();
    mkV2(root, v2, ['Old work', '', 'Run: first idea']);
    mkV2(root, `${ID}-11.00.00`, ['Old work', '', 'Run: later fix']);
    const before = snapshot(work(root));
    joinV3(root, ID, 'feature');
    const after2 = snapshot(work(root));
    for (const k of Object.keys(before)) assert.equal(after2[k], before[k], k);
    assert.deepEqual(sub(root, ID), ['00-project.md', '01-feature']);
  });

  test('next join in that project then makes 02', () => {
    const root = project();
    mkV2(root, v2, ['Old work', '', 'Run: first idea']);
    joinV3(root, ID, 'fix');
    assert.equal(joinV3(root, ID, 'reprompt').lines[1], `name: ${ID}/02-reprompt`);
  });
});

describe('default output unchanged without --layout (AC6, AC7)', () => {
  test('new --topic prints a v2 name, no sub folder', () => {
    const root = project();
    writeTopic(root, 'Fix Login');
    const r = run(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.deepEqual(r.lines, [`id: ${ID}`, `name: ${ID}-23.45.00`, `branch: aico/${ID}`]);
    assert.deepEqual(top(root), [`${ID}-23.45.00`]);
    assert.deepEqual(sub(root, `${ID}-23.45.00`), ['00-summary.md']);
  });

  test('new --project without --layout still makes a sibling <ID>-HH.MM.SS folder', () => {
    const root = project();
    mkV2(root, `${ID}-10.00.00`, ['Old work', '', 'Run: first idea']);
    const r = run(root, ['new', '--playbook', 'fix', '--project', ID]);
    assert.deepEqual(r.lines, [`id: ${ID}`, `name: ${ID}-23.45.00`, `branch: aico/${ID}`]);
    assert.deepEqual(top(root), [`${ID}-10.00.00`, `${ID}-23.45.00`]);
  });

  test('a v2 run still works when a v3 project of the same day exists', () => {
    const root = project();
    newV3(root);
    writeTopic(root, 'Other');
    const r = run(root, ['new', '--playbook', 'idea', '--topic', 'file'], new Date(2026, 9, 30, 23, 50));
    assert.equal(r.code, 0);
    assert.equal(r.lines[0], `id: ${ID2}`);
    assert.equal(r.lines[1], `name: ${ID2}-23.50.00`);
  });
});

describe('hostile folders: links, files and case variants (proj.M4)', () => {
  const outsideDir = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-v3-out-'));
    dirs.push(d);
    return d;
  };
  // Makes a link, or skips the test when the platform refuses it. Returns false when skipped.
  const link = (t, target, at, type) => {
    try {
      fs.symlinkSync(target, at, type);
      return true;
    } catch {
      t.skip('no link right');
      return false;
    }
  };
  const SECRET = 'TOP SECRET DESCRIPTION';

  test('a project folder that is a link out of work is refused, nothing is written there', t => {
    const root = project();
    const out = outsideDir();
    fs.writeFileSync(path.join(out, '00-project.md'), `${SECRET}\n`);
    fs.mkdirSync(path.join(out, '01-idea'));
    const before = snapshot(out);
    if (!link(t, out, path.join(work(root), ID), 'junction')) return;
    const r = joinV3(root, ID, 'fix');
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: /);
    assert.deepEqual(snapshot(out), before);
    assert.deepEqual(top(root), [ID]);
  });

  test('a project ID that is a plain file is refused, the file is untouched', () => {
    const root = project();
    fs.writeFileSync(path.join(work(root), ID), 'not a folder');
    const r = joinV3(root, ID, 'fix');
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: /);
    assert.equal(read(root, ID), 'not a folder');
    assert.deepEqual(top(root), [ID]);
  });

  test('00-project.md as a symlink to a file outside: its text is never copied into the new run', t => {
    const root = project();
    newV3(root);
    const out = outsideDir();
    const secret = path.join(out, 'secret.txt');
    fs.writeFileSync(secret, `${SECRET}\n\nbody\n`);
    const file = path.join(work(root), ID, '00-project.md');
    fs.rmSync(file);
    if (!link(t, secret, file, 'file')) return;
    const r = joinV3(root, ID, 'fix');
    assert.ok(r.code === 0 || r.code === 3);
    assert.equal(fs.readFileSync(secret, 'utf8'), `${SECRET}\n\nbody\n`);
    for (const f of fs.readdirSync(path.join(work(root), ID), { recursive: true })) {
      const p = path.join(work(root), ID, f);
      if (fs.lstatSync(p).isFile() && !fs.lstatSync(p).isSymbolicLink()) assert.ok(!fs.readFileSync(p, 'utf8').includes(SECRET), f);
    }
    assert.deepEqual(fs.readdirSync(out), ['secret.txt']);
  });

  test('00-project.md as a hard link to a file outside: its text is never copied into the new run', () => {
    const root = project();
    newV3(root);
    const out = outsideDir();
    const secret = path.join(out, 'secret.txt');
    fs.writeFileSync(secret, `${SECRET}\n\nbody\n`);
    const file = path.join(work(root), ID, '00-project.md');
    fs.rmSync(file);
    fs.linkSync(secret, file);
    const r = joinV3(root, ID, 'fix');
    assert.ok(r.code === 0 || r.code === 3);
    assert.equal(fs.readFileSync(secret, 'utf8'), `${SECRET}\n\nbody\n`);
    for (const run of fs.readdirSync(path.join(work(root), ID)).filter(n => /^\d\d-/.test(n) && n !== '00-project.md')) {
      assert.ok(!read(root, ID, run, '00-summary.md').includes(SECRET), run);
    }
  });

  test('a project folder whose name differs only by case is not the project: refused, nothing created', () => {
    const root = project();
    const lower = ID.toLowerCase();
    fs.mkdirSync(path.join(work(root), lower));
    fs.writeFileSync(path.join(work(root), lower, '00-project.md'), 'Lower\n');
    const before = snapshot(work(root));
    const r = joinV3(root, ID, 'fix');
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: /);
    assert.deepEqual(snapshot(work(root)), before);
  });

  for (const which of ['work', '.company']) {
    test(`${which} as a link out of the repo: new and join are refused, nothing is written outside (R-1)`, t => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-v3-'));
      dirs.push(root);
      const out = outsideDir();
      fs.mkdirSync(path.join(out, which === 'work' ? ID : path.join('work', ID)), { recursive: true });
      fs.writeFileSync(path.join(out, which === 'work' ? ID : path.join('work', ID), '00-project.md'), `${SECRET}\n`);
      const at = which === 'work' ? path.join(root, '.company', 'work') : path.join(root, '.company');
      if (which === 'work') fs.mkdirSync(path.join(root, '.company'));
      if (!link(t, out, at, 'junction')) return;
      const before = snapshot(out);
      const a = run(root, ['new', '--playbook', 'idea', '--topic', 'none', '--layout', 'v3']);
      assert.notEqual(a.code, 0);
      const b = joinV3(root, ID, 'fix');
      assert.equal(b.code, 3);
      assert.match(b.lines[0], /^refused: /);
      assert.deepEqual(snapshot(out), before);
    });
  }
});
