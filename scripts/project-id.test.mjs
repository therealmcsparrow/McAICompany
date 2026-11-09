import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isProjectId, nextProjectId, makeRun, parseProject, projectIdOf, checkDescription, summaryDescription, runOf,
  isBranchId, isWorkFolder, branchId, WorkFolderRefusal,
} from '../mods/lib/work-folder.mjs';
import { main } from './work-folder.mjs';

const io = { fs, path, platform: process.platform };
const ID1 = 'P20261108.000001';
const ID2 = 'P20261108.000002';
const ID3 = 'P20261108.000003';
const NOW = new Date(2026, 10, 8, 22, 25, 0);
const at = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s);

const dirs = [];
const saved = { MCSPARROW_HOME: process.env.MCSPARROW_HOME, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
before(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-id-home-'));
  dirs.push(home);
  process.env.MCSPARROW_HOME = home;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});
after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-id-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}
const work = root => path.join(root, '.company', 'work');
const folders = root => fs.readdirSync(work(root)).sort();
const run = (root, argv, now = NOW) => main(argv, { root, now });
const topicPath = (root, id = 'idea') => path.join(root, '.company', `work-folder-topic-${id}.txt`);
const writeTopic = (root, text, id = 'idea') => fs.writeFileSync(topicPath(root, id), text);
const summaryOf = (root, name) => fs.readFileSync(path.join(work(root), name, '00-summary.md'), 'utf8');
const lineOf = (text, n) => text.split('\n')[n - 1];
const plant = (root, name, text) => {
  fs.mkdirSync(path.join(work(root), name), { recursive: true });
  if (text !== undefined) fs.writeFileSync(path.join(work(root), name, '00-summary.md'), text);
};
const newProject = (root, desc = 'Fix login', now = NOW, playbook = 'idea') => {
  writeTopic(root, `${desc}\n`, playbook);
  return run(root, ['new', '--playbook', playbook, '--topic', 'file'], now);
};
const refusal = (fn, reason) => assert.throws(fn, e => e instanceof WorkFolderRefusal && (reason === undefined || e.message === reason));

// Hostile shapes first.

const BAD_IDS = [
  ['lowercase p', 'p20261108.000001'],
  ['doubled P', 'PP20261108.000001'],
  ['one digit n', 'P20261108.1'],
  ['five digit n', 'P20261108.00001'],
  ['all-zero n', 'P20261108.000000'],
  ['seven digits with a leading zero', 'P20261108.0000001'],
  ['ten digit n', 'P20261108.1234567890'],
  ['extra dot', 'P20261108.000001.1'],
  ['month 13', 'P20261308.000001'],
  ['30 February', 'P20260230.000001'],
  ['short date', 'P2026110.000001'],
  ['no dot', 'P20261108000001'],
  ['comma for dot', 'P20261108,000001'],
  ['over 20 characters', 'P20261108.0000011234567'],
  ['slash', 'P20261108/000001'],
  ['backslash', 'P20261108\\000001'],
  ['dot dot', '..'],
  ['colon', 'P20261108:000001'],
  ['NUL', 'P20261108.000001\0'],
  ['trailing LF', 'P20261108.000001\n'],
  ['trailing space', 'P20261108.000001 '],
  ['Kelvin sign tail', 'P20261108.000001K'],
  ['fullwidth digit', 'P20261108.00000１'],
  ['empty', ''],
];

describe('isProjectId refuses every bad shape', () => {
  for (const [label, text] of BAD_IDS) test(label, () => assert.equal(isProjectId(text), false));
  test('non-strings', () => {
    for (const v of [undefined, null, 42, {}, [ID1], true]) assert.equal(isProjectId(v), false);
  });
  test('a very long hostile input is capped and fast', () => {
    const t0 = Date.now();
    assert.equal(isProjectId(`P20261108.${'1'.repeat(200000)}`), false);
    assert.equal(isProjectId(`P${'2'.repeat(200000)}`), false);
    assert.ok(Date.now() - t0 < 500);
  });
});

describe('CLI: a bad project ID refuses, exit 3, nothing written', () => {
  for (const [label, text] of BAD_IDS) {
    test(`new --project: ${label}`, () => {
      const root = project();
      plant(root, `${ID1}-10.00.00`, 'Fix login\n\nRun: first idea\n');
      const before = folders(root);
      const r = run(root, ['new', '--playbook', 'idea', '--project', text]);
      assert.deepEqual(r, { code: 3, lines: ['refused: bad project'] });
      assert.deepEqual(folders(root), before);
    });
    test(`siblings: ${label}`, () => {
      const root = project();
      plant(root, `${ID1}-10.00.00`, 'Fix login\n\nRun: first idea\n');
      const before = summaryOf(root, `${ID1}-10.00.00`);
      const r = run(root, ['siblings', ID1, text]);
      assert.deepEqual(r, { code: 3, lines: ['refused: bad project'] });
      assert.equal(summaryOf(root, `${ID1}-10.00.00`), before);
    });
    test(`branch: ${label}`, () => {
      const root = project();
      const r = run(root, ['branch', text]);
      assert.equal(r.code, 3);
      assert.match(r.lines[0], /^refused: (bad name|unknown name)$/);
      assert.deepEqual(folders(root), []);
    });
  }
});

const BAD_FOLDERS = [
  `${ID1}`,
  `${ID1}-`,
  `${ID1}-22.25`,
  `${ID1}-22:25:00`,
  `${ID1}-24.00.00`,
  `${ID1}-22.60.00`,
  `${ID1}-22.25.60`,
  `${ID1}-2.25.00`,
  `${ID1}-22.25.00.`,
  `${ID1}-22.25.00 `,
  `${ID1}-22.25.00-x`,
  `${ID1}-22.25.00/..`,
  `${ID1}-22.25.00\\x`,
  `${ID1}-22.25.00\n`,
  `${ID1} - 22.25.00`,
  `p${ID1.slice(1)}-22.25.00`,
  `P20261108.000000-22.25.00`,
  `P20261108.00001-22.25.00`,
  `P20261308.000001-22.25.00`,
  `P20261108.0000001-22.25.00`,
  `${ID1}-22.25.00K`,
];

describe('folder names: every bad shape is not a work folder and `branch` refuses it', () => {
  for (const name of BAD_FOLDERS) {
    test(JSON.stringify(name), () => {
      assert.equal(isWorkFolder(name), false);
      assert.equal(parseProject(name), null);
      assert.equal(projectIdOf(name), null);
      const root = project();
      const r = run(root, ['branch', name]);
      assert.deepEqual(r, { code: 3, lines: ['refused: bad name'] });
      assert.deepEqual(folders(root), []);
    });
  }
});

describe('isProjectId accepts the good shapes', () => {
  for (const id of [ID1, 'P20261108.999999', 'P20261108.1000000', 'P20261108.123456789', 'P20240229.000001', 'P20261231.000042']) {
    test(id, () => assert.equal(isProjectId(id), true));
  }
});

describe('nextProjectId', () => {
  const day = at(2026, 11, 8, 22, 25);
  test('no names: the first of the day', () => assert.equal(nextProjectId(day, []), ID1));
  test('one project today: the second', () => assert.equal(nextProjectId(day, [`${ID1}-22.25.00`]), ID2));
  test('the next day starts again at 000001', () => {
    assert.equal(nextProjectId(at(2026, 11, 9, 0, 5), [`${ID1}-22.25.00`, 'P20261108.000002-23.00.00']), 'P20261109.000001');
  });
  test('other days, v1.1 names and legacy slugs do not count', () => {
    const names = ['P20261107.000009-10.00.00', '2026-11-08 22.25 - Fix Login', 'idea-20261108-2225', 'junk', 'p20261108.000009-10.00.00'];
    assert.equal(nextProjectId(day, names), ID1);
  });
  test('highest plus one, not the first gap', () => {
    assert.equal(nextProjectId(day, [`${ID1}-10.00.00`, `${ID3}-10.00.00`]), 'P20261108.000004');
  });
  test('several folders of one project count once', () => {
    assert.equal(nextProjectId(day, [`${ID1}-10.00.00`, `${ID1}-11.00.00`, `${ID1}-12.00.00`]), ID2);
  });
  test('after 999999 comes 1000000, then 1000001', () => {
    assert.equal(nextProjectId(day, ['P20261108.999999-10.00.00']), 'P20261108.1000000');
    assert.equal(nextProjectId(day, ['P20261108.1000000-10.00.00']), 'P20261108.1000001');
  });
  test('the result is a project ID', () => {
    assert.equal(isProjectId(nextProjectId(day, [])), true);
    assert.equal(isProjectId(nextProjectId(at(2026, 1, 5, 3, 7), [])), true);
  });
  test('a hostile name list gives no crash and no wrong count', () => {
    const names = ['P20261108.000000-10.00.00', 'P20261108.00001-10.00.00', `${'a'.repeat(100000)}`, `${ID1}-25.00.00`];
    assert.equal(nextProjectId(day, names), ID1);
  });
});

describe('parseProject, projectIdOf, branchId', () => {
  test('a v2 name parses to id and time', () => {
    const p = parseProject(`${ID1}-22.25.07`);
    assert.equal(p.id, ID1);
    assert.equal(p.time, '22.25.07');
    assert.equal(projectIdOf(`${ID1}-22.25.07`), ID1);
  });
  test('the time may be midnight and the second may be 59', () => {
    assert.equal(parseProject(`${ID1}-00.00.00`).time, '00.00.00');
    assert.equal(parseProject(`${ID1}-23.59.59`).time, '23.59.59');
  });
  test('v1.1 names, legacy slugs and the bare ID are not v2 folder names', () => {
    for (const n of ['2026-10-30 23.45 - Fix Login', 'idea-20261030-2242-build-draft', ID1]) {
      assert.equal(parseProject(n), null);
      assert.equal(projectIdOf(n), null);
    }
  });
  test('isWorkFolder takes v2, v1.1 and legacy', () => {
    assert.equal(isWorkFolder(`${ID1}-22.25.00`), true);
    assert.equal(isWorkFolder('P20261108.1000000-22.25.00'), true);
    assert.equal(isWorkFolder('2026-10-30 23.45 - Fix Login'), true);
    assert.equal(isWorkFolder('2026-10-30 23.45 - Fix Login Build'), true);
    assert.equal(isWorkFolder('idea-20261030-2242-build-draft'), true);
  });
  test('branchId of a v2 name is the project ID, whatever the run', () => {
    assert.equal(branchId(`${ID1}-22.25.00`), ID1);
    assert.equal(branchId(`${ID1}-09.01.59`), ID1);
    assert.equal(branchId('P20261108.1000000-01.00.00'), 'P20261108.1000000');
  });
  test('v1.1 and legacy branch ids are unchanged', () => {
    assert.equal(branchId('2026-10-30 23.45 - Fix Login'), '2026-10-30-2345-fix-login');
    assert.equal(branchId('2026-10-30 23.45 - Fix Login Draft 2'), '2026-10-30-2345-fix-login-draft-2');
    assert.equal(branchId('reprompt-20261030-2247'), 'reprompt-20261030-2247');
  });
  test('a bad v2 name has no branch id', () => {
    for (const n of BAD_FOLDERS) assert.equal(branchId(n), null, JSON.stringify(n));
  });
});

describe('isBranchId', () => {
  test('true for a project ID, a v1.1 branch id and a legacy slug', () => {
    for (const t of [ID1, 'P20261108.1000000', '2026-10-30-2345-fix-login', 'idea-20261030-2242-build-draft', 'a', 'a'.repeat(128)]) {
      assert.equal(isBranchId(t), true, t);
    }
  });
  test('false for bad ones', () => {
    for (const t of ['', '..', 'a/b', 'a\\b', '-a', 'a'.repeat(129), 'p20261108.000001', 'P20261108.1', 'P20261108.000000', 'A', 'a b', 'a\n', null, 7]) {
      assert.equal(isBranchId(t), false, String(t));
    }
  });
});

describe('checkDescription', () => {
  test('120 characters pass, 121 fail', () => {
    assert.ok(checkDescription('a'.repeat(120)));
    assert.ok(!checkDescription('a'.repeat(121)));
  });
  test('good descriptions, also non-ASCII and punctuation', () => {
    for (const t of ['Fix login', 'fix the login bug, now', 'Fix Lögin', 'a', 'Add (x) & y: done.']) assert.ok(checkDescription(t), t);
  });
  const bad = [
    ['empty', ''],
    ['only spaces', '   '],
    ['CR', 'Fix\rlogin'],
    ['CRLF', 'Fix login\r\n'],
    ['LF', 'Fix\nlogin'],
    ['final LF', 'Fix login\n'],
    ['tab', 'Fix\tlogin'],
    ['NUL', 'Fix\0login'],
    ['U+2028', 'Fix login'],
    ['U+2029', 'Fix login'],
    ['U+202E', 'Fix‮login'],
    ['U+200B', 'Fix​login'],
    ['U+FEFF', '﻿Fix login'],
    ['U+180E', 'Fix᠎login'],
    ['U+2065', 'Fix⁥login'],
    ['U+E0000', 'Fix\u{E0000}login'],
    ['U+E0001', 'Fix\u{E0001}login'],
    ['U+E0020', 'Fix\u{E0020}login'],
    ['U+E007F', 'Fix\u{E007F}login'],
  ];
  for (const [label, text] of bad) test(`refused: ${label}`, () => assert.ok(!checkDescription(text)));
  test('non-strings', () => {
    for (const v of [undefined, null, 7, {}, ['a']]) assert.ok(!checkDescription(v));
  });
  test('a 200000 character input is rejected fast', () => {
    const t0 = Date.now();
    assert.ok(!checkDescription('a'.repeat(200000)));
    assert.ok(Date.now() - t0 < 500);
  });
});

describe('summaryDescription and runOf', () => {
  test('line 1 is the description', () => {
    assert.deepEqual(summaryDescription('Fix login\n\nRun: first idea\n'), { description: 'Fix login' });
    assert.deepEqual(summaryDescription('Fix login'), { description: 'Fix login' });
    assert.deepEqual(summaryDescription('Fix login\n\nRun: first idea\nSiblings: P20261108.000002\nfree text\n'), { description: 'Fix login' });
  });
  test('missing description', () => {
    for (const t of ['', '\n', '\n\nRun: first idea\n', '   \n\nRun: first idea\n']) assert.deepEqual(summaryDescription(t), { error: 'missing description' }, JSON.stringify(t));
  });
  test('multi-line description: line 2 not empty', () => {
    assert.deepEqual(summaryDescription('Fix login\nmore\n\nRun: first idea\n'), { error: 'multi-line description' });
    assert.deepEqual(summaryDescription('Fix login\nRun: first idea\n'), { error: 'multi-line description' });
  });
  test('never echoes the text in an error', () => {
    assert.equal(JSON.stringify(summaryDescription('Secret words\nmore\n')).includes('Secret'), false);
  });
  test('runOf reads line 3', () => {
    assert.deepEqual(runOf('d\n\nRun: first idea\n'), { kind: 'first', playbook: 'idea' });
    assert.deepEqual(runOf('d\n\nRun: later usability-test\n'), { kind: 'later', playbook: 'usability-test' });
    assert.deepEqual(runOf('d\n\nRun: build feature\nSiblings: P20261108.000002\n'), { kind: 'build', playbook: 'feature' });
    assert.deepEqual(runOf('d\n\nRun: draft fix\n'), { kind: 'draft', playbook: 'fix' });
  });
  test('runOf is null for anything else', () => {
    for (const t of ['', 'd', 'd\n\n', 'd\n\nRun: bogus idea\n', 'd\n\nRun: first\n', 'd\n\nRun: first ../x\n', 'd\n\nRun: first A\n', 'd\n\nrun: first idea\n', 'Run: first idea\n\n\n', 'd\n\n Run: first idea\n']) {
      assert.equal(runOf(t), null, JSON.stringify(t));
    }
  });
});

describe('work-folder new', () => {
  test('a new project at 22:25:00 makes the folder and the summary and prints three lines', () => {
    const root = project();
    const r = newProject(root);
    assert.deepEqual(r, { code: 0, lines: [`id: ${ID1}`, `name: ${ID1}-22.25.00`, `branch: aico/${ID1}`] });
    assert.deepEqual(folders(root), [`${ID1}-22.25.00`]);
    assert.equal(fs.statSync(path.join(work(root), `${ID1}-22.25.00`, '00-summary.md')).isFile(), true);
    assert.equal(fs.existsSync(topicPath(root)), false);
  });
  test('the clock is zero padded', () => {
    const root = project();
    const r = newProject(root, 'Fix login', at(2026, 1, 5, 3, 7, 9));
    assert.deepEqual(r.lines, ['id: P20260105.000001', 'name: P20260105.000001-03.07.09', 'branch: aico/P20260105.000001']);
  });
  test('midnight is 00.00.00', () => {
    const root = project();
    assert.equal(newProject(root, 'Fix login', at(2026, 11, 8, 0, 0, 0)).lines[1], `name: ${ID1}-00.00.00`);
  });
  test('the creator is not recursive and writes only the folder', () => {
    const root = project();
    newProject(root);
    assert.deepEqual(fs.readdirSync(path.join(root, '.company')).sort(), ['work']);
    assert.deepEqual(fs.readdirSync(path.join(work(root), `${ID1}-22.25.00`)), ['00-summary.md']);
  });
  test('--topic none uses the fallback description', () => {
    const root = project();
    const r = run(root, ['new', '--playbook', 'usability-test', '--topic', 'none']);
    assert.equal(r.code, 0);
    assert.equal(lineOf(summaryOf(root, `${ID1}-22.25.00`), 1), 'Usability-Test');
  });
  test('no topic file with --topic file refuses, nothing created', () => {
    const root = project();
    assert.deepEqual(run(root, ['new', '--playbook', 'idea', '--topic', 'file']), { code: 3, lines: ['refused: no topic file'] });
    assert.deepEqual(folders(root), []);
  });
  test('a v1.1 folder with the same minute is not in the way', () => {
    const root = project();
    plant(root, '2026-11-08 22.25 - Fix Login');
    assert.equal(newProject(root).lines[0], `id: ${ID1}`);
  });
});

describe('second project, next day, big numbers, archive', () => {
  test('a second project the same day gets 000002', () => {
    const root = project();
    newProject(root);
    const r = newProject(root, 'Other', at(2026, 11, 8, 22, 26, 0));
    assert.deepEqual(r.lines, [`id: ${ID2}`, `name: ${ID2}-22.26.00`, `branch: aico/${ID2}`]);
  });
  test('a second project in the very same second is a different project, not a clash', () => {
    const root = project();
    newProject(root);
    const r = newProject(root, 'Other');
    assert.equal(r.code, 0);
    assert.equal(r.lines[1], `name: ${ID2}-22.25.00`);
    assert.deepEqual(folders(root), [`${ID1}-22.25.00`, `${ID2}-22.25.00`]);
  });
  test('the next day starts at 000001', () => {
    const root = project();
    newProject(root);
    const r = newProject(root, 'Other', at(2026, 11, 9, 8, 0, 0));
    assert.equal(r.lines[0], 'id: P20261109.000001');
  });
  test('after .999999 comes .1000000', () => {
    const root = project();
    plant(root, 'P20261108.999999-01.00.00', 'x\n\nRun: first idea\n');
    const r = newProject(root);
    assert.deepEqual(r.lines, ['id: P20261108.1000000', `name: P20261108.1000000-22.25.00`, 'branch: aico/P20261108.1000000']);
  });
  test('an archived highest folder still counts', () => {
    const root = project();
    plant(root, `${ID1}-10.00.00`, 'x\n\nRun: first idea\n');
    fs.mkdirSync(path.join(root, '.company', 'archive', 'P20261108.000005-10.00.00'), { recursive: true });
    assert.equal(newProject(root).lines[0], 'id: P20261108.000006');
  });
  test('a folder one level below .company/archive still counts', () => {
    const root = project();
    fs.mkdirSync(path.join(root, '.company', 'archive', 'old-runs', 'P20261108.000007-10.00.00'), { recursive: true });
    assert.equal(newProject(root).lines[0], 'id: P20261108.000008');
  });
  test('two levels below .company/archive are not read', () => {
    const root = project();
    fs.mkdirSync(path.join(root, '.company', 'archive', 'a', 'b', 'P20261108.000009-10.00.00'), { recursive: true });
    assert.equal(newProject(root).lines[0], `id: ${ID1}`);
  });
  test('a link below .company/archive is skipped, never followed', () => {
    const root = project();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'project-id-target-'));
    dirs.push(target);
    fs.mkdirSync(path.join(target, 'P20261108.000009-10.00.00'));
    fs.mkdirSync(path.join(root, '.company', 'archive'), { recursive: true });
    fs.symlinkSync(target, path.join(root, '.company', 'archive', 'linked'), 'junction');
    assert.equal(newProject(root).lines[0], `id: ${ID1}`);
    assert.deepEqual(fs.readdirSync(target), ['P20261108.000009-10.00.00']);
    fs.unlinkSync(path.join(root, '.company', 'archive', 'linked'));
  });
  test('a missing archive folder is fine', () => {
    const root = project();
    assert.equal(fs.existsSync(path.join(root, '.company', 'archive')), false);
    assert.equal(newProject(root).code, 0);
    assert.equal(fs.existsSync(path.join(root, '.company', 'archive')), false);
  });
});

describe('summary written by new', () => {
  test('line 1 description, line 2 empty, line 3 Run: first <playbook>', () => {
    const root = project();
    newProject(root, 'Fix the login bug');
    const text = summaryOf(root, `${ID1}-22.25.00`);
    assert.equal(lineOf(text, 1), 'Fix the login bug');
    assert.equal(lineOf(text, 2), '');
    assert.equal(lineOf(text, 3), 'Run: first idea');
    assert.deepEqual(summaryDescription(text), { description: 'Fix the login bug' });
    assert.deepEqual(runOf(text), { kind: 'first', playbook: 'idea' });
    assert.equal(text.includes('\r'), false);
  });
  test('a description is not a Topic: lower case, punctuation and non-ASCII pass', () => {
    const root = project();
    newProject(root, 'fix the login, Lögin & more.');
    assert.equal(lineOf(summaryOf(root, `${ID1}-22.25.00`), 1), 'fix the login, Lögin & more.');
  });
  test('120 characters pass', () => {
    const root = project();
    const d = 'a'.repeat(120);
    newProject(root, d);
    assert.equal(lineOf(summaryOf(root, `${ID1}-22.25.00`), 1), d);
  });
  const hostile = [
    ['121 characters', 'a'.repeat(121)],
    ['inner CR', 'Fix\rlogin'],
    ['CRLF', 'Fix login\r\n'],
    ['inner LF', 'Fix\nlogin'],
    ['two final LFs', 'Fix login\n\n'],
    ['U+2028', 'Fix login'],
    ['U+202E', 'Fix‮login'],
    ['U+200B', 'Fix​login'],
    ['U+180E', 'Fix᠎login'],
    ['U+2065', 'Fix⁥login'],
    ['U+E0001', 'Fix\u{E0001}login'],
    ['NUL', 'Fix\0login'],
    ['tab', 'Fix\tlogin'],
    ['BOM', '﻿Fix login'],
    ['empty', ''],
    ['only LF', '\n'],
  ];
  for (const [label, text] of hostile) {
    test(`hostile description falls back, never echoed: ${label}`, () => {
      const root = project();
      writeTopic(root, text);
      const r = run(root, ['new', '--playbook', 'idea', '--topic', 'file']);
      assert.equal(r.code, 0);
      const summary = summaryOf(root, `${ID1}-22.25.00`);
      assert.equal(lineOf(summary, 1), 'Idea');
      assert.deepEqual(runOf(summary), { kind: 'first', playbook: 'idea' });
      assert.equal(fs.existsSync(topicPath(root)), false);
      const probe = text.trim().slice(0, 12);
      if (probe) assert.equal(r.lines.join('\n').includes(probe), false);
      assert.equal(r.lines.some(l => l.includes('‮') || l.includes('\0')), false);
    });
  }
  test('invalid UTF-8 falls back', () => {
    const root = project();
    fs.writeFileSync(topicPath(root), Buffer.from([0x46, 0xff, 0xfe]));
    run(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.equal(lineOf(summaryOf(root, `${ID1}-22.25.00`), 1), 'Idea');
  });
});

describe('a later run through --project', () => {
  const later = (root, now, extra = []) => run(root, ['new', '--playbook', 'fix', '--project', ID1, ...extra], now);
  test('same minute, another second: a new folder with the same ID', () => {
    const root = project();
    newProject(root);
    const r = later(root, at(2026, 11, 8, 22, 25, 30));
    assert.deepEqual(r, { code: 0, lines: [`id: ${ID1}`, `name: ${ID1}-22.25.30`, `branch: aico/${ID1}`] });
    assert.deepEqual(folders(root), [`${ID1}-22.25.00`, `${ID1}-22.25.30`]);
  });
  test('a later minute or hour', () => {
    const root = project();
    newProject(root);
    assert.equal(later(root, at(2026, 11, 8, 23, 2, 3)).lines[1], `name: ${ID1}-23.02.03`);
  });
  test('the summary has the same description and Run: later <playbook>', () => {
    const root = project();
    newProject(root, 'Fix login');
    later(root, at(2026, 11, 8, 22, 40, 5));
    const text = summaryOf(root, `${ID1}-22.40.05`);
    assert.equal(lineOf(text, 1), 'Fix login');
    assert.equal(lineOf(text, 2), '');
    assert.equal(lineOf(text, 3), 'Run: later fix');
    assert.deepEqual(runOf(text), { kind: 'later', playbook: 'fix' });
    assert.deepEqual(fs.readdirSync(path.join(work(root), `${ID1}-22.40.05`)), ['00-summary.md']);
  });
  test('the original folder is untouched', () => {
    const root = project();
    newProject(root);
    const before = summaryOf(root, `${ID1}-22.25.00`);
    later(root, at(2026, 11, 8, 22, 40, 5));
    assert.equal(summaryOf(root, `${ID1}-22.25.00`), before);
  });
  test('an exact same-second clash is refused, nothing created, no other time tried', () => {
    const root = project();
    newProject(root);
    const before = folders(root);
    const r = later(root, NOW);
    assert.deepEqual(r, { code: 3, lines: ['refused: too many runs this second'] });
    assert.deepEqual(folders(root), before);
    assert.deepEqual(fs.readdirSync(path.join(work(root), `${ID1}-22.25.00`)), ['00-summary.md']);
  });
  test('the same HH.MM.SS on another day is refused too', () => {
    const root = project();
    newProject(root);
    const before = folders(root);
    const r = later(root, at(2026, 11, 9, 22, 25, 0));
    assert.deepEqual(r, { code: 3, lines: ['refused: too many runs this second'] });
    assert.deepEqual(folders(root), before);
  });
  test('a different second on another day passes and keeps the project day in the ID', () => {
    const root = project();
    newProject(root);
    const r = later(root, at(2026, 11, 9, 22, 25, 1));
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, [`id: ${ID1}`, `name: ${ID1}-22.25.01`, `branch: aico/${ID1}`]);
  });
  test('an unknown project is refused, nothing created', () => {
    const root = project();
    newProject(root);
    const before = folders(root);
    assert.deepEqual(run(root, ['new', '--playbook', 'fix', '--project', ID2]), { code: 3, lines: ['refused: unknown project'] });
    assert.deepEqual(folders(root), before);
  });
  test('a project found only in the archive is unknown', () => {
    const root = project();
    fs.mkdirSync(path.join(root, '.company', 'archive', `${ID1}-10.00.00`), { recursive: true });
    assert.deepEqual(run(root, ['new', '--playbook', 'fix', '--project', ID1]), { code: 3, lines: ['refused: unknown project'] });
    assert.deepEqual(folders(root), []);
  });
  test('a v1.1 folder is not a project', () => {
    const root = project();
    plant(root, '2026-11-08 22.25 - Fix Login');
    assert.equal(run(root, ['new', '--playbook', 'fix', '--project', ID1]).code, 3);
    assert.deepEqual(folders(root), ['2026-11-08 22.25 - Fix Login']);
  });
  test('a bad playbook is refused before anything is made', () => {
    const root = project();
    newProject(root);
    const before = folders(root);
    for (const id of ['../x', 'A', 'no-such-playbook', '']) {
      const r = run(root, ['new', '--playbook', id, '--project', ID1], at(2026, 11, 8, 23, 0, 0));
      assert.deepEqual(r, { code: 3, lines: ['refused: bad playbook'] }, id);
    }
    assert.deepEqual(folders(root), before);
  });
  test('the project link folder is not followed', () => {
    const root = project();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'project-id-target-'));
    dirs.push(target);
    fs.writeFileSync(path.join(target, '00-summary.md'), 'Secret\n\nRun: first idea\n');
    fs.symlinkSync(target, path.join(work(root), `${ID1}-10.00.00`), 'junction');
    const r = later(root, at(2026, 11, 8, 23, 0, 0));
    assert.equal(r.code, 3);
    assert.deepEqual(fs.readdirSync(target), ['00-summary.md']);
    fs.unlinkSync(path.join(work(root), `${ID1}-10.00.00`));
  });
});

describe('makeRun (exported)', () => {
  const t = at(2026, 11, 8, 22, 40, 5);
  test('returns the name and writes the summary', () => {
    const root = project();
    plant(root, `${ID1}-22.25.00`, 'Fix login\n\nRun: first idea\n');
    const name = makeRun(io, root, ID1, t, 'later', 'idea');
    assert.equal(name, `${ID1}-22.40.05`);
    assert.equal(lineOf(summaryOf(root, name), 3), 'Run: later idea');
  });
  test('each kind writes its own line 3', () => {
    const root = project();
    plant(root, `${ID1}-22.25.00`, 'Fix login\n\nRun: first idea\n');
    let s = 1;
    for (const kind of ['later', 'build', 'draft']) {
      const name = makeRun(io, root, ID1, at(2026, 11, 8, 23, 0, s++), kind, 'feature');
      assert.deepEqual(runOf(summaryOf(root, name)), { kind, playbook: 'feature' });
    }
  });
  test('an unknown project writes nothing', () => {
    const root = project();
    refusal(() => makeRun(io, root, ID1, t, 'later', 'idea'), 'unknown project');
    assert.deepEqual(folders(root), []);
  });
  test('a same-second clash writes nothing and tries no other time', () => {
    const root = project();
    plant(root, `${ID1}-22.40.05`, 'Fix login\n\nRun: first idea\n');
    const before = summaryOf(root, `${ID1}-22.40.05`);
    refusal(() => makeRun(io, root, ID1, t, 'later', 'idea'), 'too many runs this second');
    assert.deepEqual(folders(root), [`${ID1}-22.40.05`]);
    assert.equal(summaryOf(root, `${ID1}-22.40.05`), before);
  });
  test('bad id, kind or playbook are refusals and write nothing', () => {
    const root = project();
    plant(root, `${ID1}-22.25.00`, 'Fix login\n\nRun: first idea\n');
    refusal(() => makeRun(io, root, 'p20261108.000001', t, 'later', 'idea'));
    refusal(() => makeRun(io, root, ID1, t, 'bogus', 'idea'));
    refusal(() => makeRun(io, root, ID1, t, 'later', '../x'));
    refusal(() => makeRun(io, root, ID1, t, 'later', ''));
    assert.deepEqual(folders(root), [`${ID1}-22.25.00`]);
  });
  test('it never makes parents', () => {
    const root = project();
    fs.rmdirSync(work(root));
    refusal(() => makeRun(io, root, ID1, t, 'later', 'idea'));
    assert.deepEqual(fs.readdirSync(path.join(root, '.company')), []);
  });
  test('lines 1 and 4 are copied whatever the folder name order or creation order', () => {
    const lines = 'Shared one\n\nRun: first idea\nSiblings: P20261108.000002 P20261108.000003\nFinish words\n';
    for (const order of [['22.00.00', '09.00.00'], ['09.00.00', '22.00.00']]) {
      const root = project();
      for (const time of order) plant(root, `${ID1}-${time}`, lines);
      const name = makeRun(io, root, ID1, t, 'build', 'feature');
      const text = summaryOf(root, name);
      assert.equal(lineOf(text, 1), 'Shared one');
      assert.equal(lineOf(text, 3), 'Run: build feature');
      assert.equal(lineOf(text, 4), 'Siblings: P20261108.000002 P20261108.000003');
      assert.equal(text.includes('Finish words'), false);
    }
  });
  test('no Siblings line in the source: none in the new summary', () => {
    const root = project();
    plant(root, `${ID1}-22.25.00`, 'Fix login\n\nRun: first idea\nnot a siblings line\n');
    const text = summaryOf(root, makeRun(io, root, ID1, t, 'later', 'idea'));
    assert.equal(text.includes('not a siblings'), false);
    assert.equal(text.includes('Siblings:'), false);
  });
  test('a hostile line 1 in the first folder (name order) is skipped for the next good one', () => {
    const root = project();
    plant(root, `${ID1}-09.00.00`, 'Evil‮text\n\nRun: first idea\n');
    plant(root, `${ID1}-10.00.00`, 'Good one\n\nRun: first idea\n');
    assert.equal(lineOf(summaryOf(root, makeRun(io, root, ID1, t, 'later', 'idea')), 1), 'Good one');
  });
  test('a hostile line 4 is skipped for the next good one', () => {
    const root = project();
    plant(root, `${ID1}-09.00.00`, 'Good one\n\nRun: first idea\nSiblings: P20261108.000002‮\n');
    plant(root, `${ID1}-10.00.00`, 'Good one\n\nRun: first idea\nSiblings: P20261108.000002\n');
    const text = summaryOf(root, makeRun(io, root, ID1, t, 'later', 'idea'));
    assert.equal(text.includes('‮'), false);
    assert.equal(lineOf(text, 4), 'Siblings: P20261108.000002');
  });
  test('every line 1 hostile: the fallback description, still valid, no hostile text', () => {
    const root = project();
    plant(root, `${ID1}-09.00.00`, 'Evil‮text\n\nRun: first idea\nSiblings: P20261108.000002\n');
    plant(root, `${ID1}-10.00.00`, `${'a'.repeat(121)}\n\nRun: first idea\n`);
    const text = summaryOf(root, makeRun(io, root, ID1, t, 'later', 'idea'));
    assert.ok(summaryDescription(text).description);
    assert.equal(text.includes('‮'), false);
    assert.equal(text.includes('aaaa'), false);
  });
  test('a summary that is a multi-line description is not copied', () => {
    const root = project();
    plant(root, `${ID1}-09.00.00`, 'Line one\nLine two\n\nRun: first idea\n');
    const text = summaryOf(root, makeRun(io, root, ID1, t, 'later', 'idea'));
    assert.equal(text.includes('Line two'), false);
    assert.ok(summaryDescription(text).description);
  });
  test('a hard-linked source summary is not read', () => {
    const root = project();
    plant(root, `${ID1}-09.00.00`, 'Secret\n\nRun: first idea\n');
    fs.linkSync(path.join(work(root), `${ID1}-09.00.00`, '00-summary.md'), path.join(root, 'other-link.md'));
    const text = summaryOf(root, makeRun(io, root, ID1, t, 'later', 'idea'));
    assert.equal(text.includes('Secret'), false);
    assert.ok(summaryDescription(text).description);
  });
  test('a linked source summary is not followed', () => {
    const root = project();
    const outside = path.join(root, 'outside.md');
    fs.writeFileSync(outside, 'Secret\n\nRun: first idea\n');
    plant(root, `${ID1}-09.00.00`);
    let linked = true;
    try {
      fs.symlinkSync(outside, path.join(work(root), `${ID1}-09.00.00`, '00-summary.md'));
    } catch {
      linked = false;
    }
    const text = summaryOf(root, makeRun(io, root, ID1, t, 'later', 'idea'));
    assert.equal(text.includes('Secret'), false);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'Secret\n\nRun: first idea\n');
    assert.ok(linked || fs.existsSync(path.join(work(root), `${ID1}-09.00.00`)));
  });
  test('a missing or empty source summary gives the fallback', () => {
    const root = project();
    plant(root, `${ID1}-09.00.00`);
    plant(root, `${ID1}-10.00.00`, '');
    assert.ok(summaryDescription(summaryOf(root, makeRun(io, root, ID1, t, 'later', 'idea'))).description);
  });
  test('an oversized source summary is not read whole', () => {
    const root = project();
    plant(root, `${ID1}-09.00.00`, `Fine\n\nRun: first idea\n${'x'.repeat(5 * 1024 * 1024)}`);
    const text = summaryOf(root, makeRun(io, root, ID1, t, 'later', 'idea'));
    assert.ok(text.length < 1024);
  });
  test('the new summary is not overwritten when it exists: wx', () => {
    const root = project();
    plant(root, `${ID1}-22.25.00`, 'Fix login\n\nRun: first idea\n');
    makeRun(io, root, ID1, t, 'later', 'idea');
    refusal(() => makeRun(io, root, ID1, t, 'later', 'idea'), 'too many runs this second');
  });
});

describe('siblings', () => {
  function three(root) {
    newProject(root, 'First task');
    newProject(root, 'Second task', at(2026, 11, 8, 22, 26, 0));
    newProject(root, 'Third task', at(2026, 11, 8, 22, 27, 0));
  }
  const nameOf = (root, id) => folders(root).filter(n => n.startsWith(`${id}-`));
  test('line 4 holds the other IDs, sorted, own ID left out', () => {
    const root = project();
    three(root);
    const r = run(root, ['siblings', ID3, ID1, ID2]);
    assert.equal(r.code, 0);
    assert.equal(r.lines.length, 1);
    assert.match(r.lines[0], /^linked: /);
    assert.equal(lineOf(summaryOf(root, nameOf(root, ID1)[0]), 4), `Siblings: ${ID2} ${ID3}`);
    assert.equal(lineOf(summaryOf(root, nameOf(root, ID2)[0]), 4), `Siblings: ${ID1} ${ID3}`);
    assert.equal(lineOf(summaryOf(root, nameOf(root, ID3)[0]), 4), `Siblings: ${ID1} ${ID2}`);
  });
  test('lines 1 to 3 stay, a later line moves down', () => {
    const root = project();
    three(root);
    const n1 = nameOf(root, ID1)[0];
    fs.appendFileSync(path.join(work(root), n1, '00-summary.md'), 'Finish words\n');
    run(root, ['siblings', ID1, ID2]);
    const text = summaryOf(root, n1);
    assert.equal(lineOf(text, 1), 'First task');
    assert.equal(lineOf(text, 3), 'Run: first idea');
    assert.equal(lineOf(text, 4), `Siblings: ${ID2}`);
    assert.equal(lineOf(text, 5), 'Finish words');
    assert.deepEqual(summaryDescription(text), { description: 'First task' });
  });
  test('a second call replaces line 4, never repeats it', () => {
    const root = project();
    three(root);
    run(root, ['siblings', ID1, ID2, ID3]);
    run(root, ['siblings', ID1, ID2]);
    const text = summaryOf(root, nameOf(root, ID1)[0]);
    assert.equal(lineOf(text, 4), `Siblings: ${ID2}`);
    assert.equal(text.split('\n').filter(l => l.startsWith('Siblings:')).length, 1);
    assert.equal(fs.readFileSync(path.join(work(root), nameOf(root, ID3)[0], '00-summary.md'), 'utf8').includes('Siblings:'), true);
  });
  test('every folder of a listed project is linked', () => {
    const root = project();
    three(root);
    run(root, ['new', '--playbook', 'fix', '--project', ID1], at(2026, 11, 8, 23, 0, 0));
    run(root, ['siblings', ID1, ID2]);
    for (const n of nameOf(root, ID1)) assert.equal(lineOf(summaryOf(root, n), 4), `Siblings: ${ID2}`, n);
  });
  test('a later run of a linked project copies the Siblings line', () => {
    const root = project();
    three(root);
    run(root, ['siblings', ID1, ID2, ID3]);
    const r = run(root, ['new', '--playbook', 'fix', '--project', ID2], at(2026, 11, 8, 23, 0, 0));
    assert.equal(lineOf(summaryOf(root, r.lines[1].slice(6)), 4), `Siblings: ${ID1} ${ID3}`);
  });
  test('the sibling summaries pass the description check', () => {
    const root = project();
    three(root);
    run(root, ['siblings', ID1, ID2, ID3]);
    for (const n of folders(root)) assert.ok(summaryDescription(summaryOf(root, n)).description, n);
  });
  test('an unknown project refuses and writes nothing', () => {
    const root = project();
    three(root);
    const before = folders(root).map(n => summaryOf(root, n));
    const r = run(root, ['siblings', ID1, 'P20261108.000009']);
    assert.deepEqual(r, { code: 3, lines: ['refused: unknown project'] });
    assert.deepEqual(folders(root).map(n => summaryOf(root, n)), before);
  });
  test('fewer than 2, a repeat or more than 20 IDs refuse and write nothing', () => {
    const root = project();
    three(root);
    const before = folders(root).map(n => summaryOf(root, n));
    const many = Array.from({ length: 21 }, (_, i) => `P20261108.${String(i + 1).padStart(6, '0')}`);
    for (const argv of [['siblings'], ['siblings', ID1], ['siblings', ID1, ID1], ['siblings', ID1, ID2, ID1], ['siblings', ...many]]) {
      const r = run(root, argv);
      assert.equal(r.code, 3, argv.join(' '));
      assert.match(r.lines[0], /^refused: /);
    }
    assert.deepEqual(folders(root).map(n => summaryOf(root, n)), before);
  });
  test('20 IDs are allowed', () => {
    const root = project();
    const ids = [];
    for (let i = 0; i < 20; i++) {
      newProject(root, `Task ${i}`, at(2026, 11, 8, 10, i, 0));
      ids.push(`P20261108.${String(i + 1).padStart(6, '0')}`);
    }
    assert.equal(run(root, ['siblings', ...ids]).code, 0);
  });
  test('a project that is a link is refused and its target untouched', () => {
    const root = project();
    newProject(root);
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'project-id-target-'));
    dirs.push(target);
    fs.writeFileSync(path.join(target, '00-summary.md'), 'Outside\n\nRun: first idea\n');
    fs.symlinkSync(target, path.join(work(root), `${ID2}-10.00.00`), 'junction');
    const r = run(root, ['siblings', ID1, ID2]);
    assert.equal(r.code, 3);
    assert.equal(fs.readFileSync(path.join(target, '00-summary.md'), 'utf8'), 'Outside\n\nRun: first idea\n');
    assert.equal(lineOf(summaryOf(root, `${ID1}-22.25.00`), 4) ?? '', '');
    fs.unlinkSync(path.join(work(root), `${ID2}-10.00.00`));
  });
});

describe('the branch command on a v2 folder', () => {
  test('prints aico/<ProjectID> and writes nothing', () => {
    const root = project();
    newProject(root);
    run(root, ['new', '--playbook', 'fix', '--project', ID1], at(2026, 11, 8, 23, 0, 0));
    const before = folders(root);
    assert.deepEqual(run(root, ['branch', `${ID1}-22.25.00`]), { code: 0, lines: [`branch: aico/${ID1}`] });
    assert.deepEqual(run(root, ['branch', `${ID1}-23.00.00`]), { code: 0, lines: [`branch: aico/${ID1}`] });
    assert.deepEqual(folders(root), before);
  });
  test('an unknown v2 folder is refused', () => {
    const root = project();
    assert.deepEqual(run(root, ['branch', `${ID1}-22.25.00`]), { code: 3, lines: ['refused: unknown name'] });
  });
  test('a link named like a v2 folder is refused', () => {
    const root = project();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'project-id-target-'));
    dirs.push(target);
    fs.symlinkSync(target, path.join(work(root), `${ID1}-22.25.00`), 'junction');
    assert.equal(run(root, ['branch', `${ID1}-22.25.00`]).code, 3);
    fs.unlinkSync(path.join(work(root), `${ID1}-22.25.00`));
  });
  test('every run of one project reports the same branch as new', () => {
    const root = project();
    const a = newProject(root);
    const b = run(root, ['new', '--playbook', 'fix', '--project', ID1], at(2026, 11, 8, 23, 0, 0));
    assert.equal(a.lines[2], b.lines[2]);
  });
});

describe('usage', () => {
  test('a missing flag or extras with --project is a refusal and creates nothing', () => {
    const root = project();
    newProject(root);
    const before = folders(root);
    for (const argv of [
      ['new', '--playbook', 'idea', '--project'],
      ['new', '--project', ID1],
      ['new', '--playbook', 'idea', '--project', ID1, '--project', ID1],
      ['new', '--playbook', 'idea', '--project', ID1, '--parent', 'x'],
    ]) {
      const r = run(root, argv, at(2026, 11, 8, 23, 0, 0));
      assert.equal(r.code, 3, argv.join(' '));
      assert.match(r.lines[0], /^refused: /);
    }
    assert.deepEqual(folders(root), before);
  });
});
