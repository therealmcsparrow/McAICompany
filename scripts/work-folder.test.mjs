import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  checkTopic, parseName, isWorkFolder, newName, helperName, branchId, stampOf,
  checkPlaybookId, fallbackTopic, readTopicFile, WorkFolderRefusal, makeProject, checkDescription,
} from '../mods/lib/work-folder.mjs';
import { main } from './work-folder.mjs';

// Resolve a usable bash. On Windows a bare `bash` can be the WSL stub, so prefer Git Bash.
function findBash() {
  const cands = [];
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
      if (base) cands.push(path.join(base, 'Git', 'bin', 'bash.exe'), path.join(base, 'Git', 'usr', 'bin', 'bash.exe'));
    }
    const g = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
    if (g.status === 0) cands.push(path.resolve(g.stdout.trim(), '..', '..', '..', 'bin', 'bash.exe'));
  }
  cands.push('bash');
  for (const c of cands) {
    if (c !== 'bash' && !fs.existsSync(c)) continue;
    const r = spawnSync(c, ['-c', 'printf ok'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout === 'ok') return c;
  }
  return 'bash';
}
const BASH = findBash();

const SCRIPT = fileURLToPath(new URL('./work-folder.mjs', import.meta.url));
const NOW = new Date(2026, 9, 30, 23, 45);
const STAMP = '2026-10-30 23.45';
const ID = 'P20261030.000001';
const NAME = `${ID}-23.45.00`;
const io = { fs, path, platform: process.platform };

const dirs = [];
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
}
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const topicPath = (root, id = 'idea') => path.join(root, '.company', `work-folder-topic-${id}.txt`);
const writeTopic = (root, text, id = 'idea') => fs.writeFileSync(topicPath(root, id), text);
const run = (root, argv, now = NOW) => main(argv, { root, now });
// Builds a v2 project the way `work-folder new --topic <mode>` did before the v3 flip: topic read, then the v2 maker.
// Tests that read v2 names back use this, so they stay green when `new` makes only v3 (work-folder-name v3.0).
const makeV2 = (root, argv, now = NOW) => {
  const flag = name => argv[argv.indexOf(name) + 1];
  const playbook = flag('--playbook');
  const { topic } = readTopicFile(io, root, playbook, flag('--topic'), checkDescription);
  const made = makeProject(io, root, now, topic ?? fallbackTopic(playbook), playbook);
  return { code: 0, lines: [`id: ${made.id}`, `name: ${made.name}`, `branch: aico/${branchId(made.name)}`] };
};
const summaryLine = (root, name, n) => fs.readFileSync(path.join(root, '.company', 'work', name, '00-summary.md'), 'utf8').split('\n')[n - 1];
const folders = root => fs.readdirSync(path.join(root, '.company', 'work')).sort();

describe('security: playbook id shape and path checks come first', () => {
  const bad = ['x/../../../y', '..', 'a/b', 'A', 'a--b', 'a'.repeat(65), '', '-a', 'a-', 'a b', 'a\\b', 'a.b'];
  for (const id of bad) {
    for (const verb of [['new', '--topic', 'file'], ['new', '--topic', 'none'], ['clear']]) {
      test(`${verb[0]} ${verb[2] ?? ''} refuses id ${JSON.stringify(id).slice(0, 20)}`, () => {
        const root = project();
        const outside = path.join(path.dirname(root), 'y.txt');
        fs.mkdirSync(path.join(root, '.company', 'work-folder-topic-x'), { recursive: true });
        fs.writeFileSync(outside, 'decoy');
        writeTopic(root, 'Fix Login');
        const r = run(root, [verb[0], '--playbook', id, ...verb.slice(1)]);
        assert.equal(r.code, 3);
        assert.deepEqual(r.lines, ['refused: bad playbook']);
        assert.equal(fs.readFileSync(outside, 'utf8'), 'decoy');
        assert.equal(fs.readFileSync(topicPath(root), 'utf8'), 'Fix Login');
        assert.deepEqual(folders(root), []);
        fs.rmSync(outside);
      });
    }
  }

  test('an id with no skills/<id>/SKILL.md refuses, creates nothing', () => {
    const root = project();
    const r = run(root, ['new', '--playbook', 'no-such-playbook', '--topic', 'none']);
    assert.equal(r.code, 3);
    assert.deepEqual(r.lines, ['refused: bad playbook']);
    assert.deepEqual(folders(root), []);
  });

  test('checkPlaybookId is anchored and capped at 64', () => {
    assert.equal(checkPlaybookId('usability-test'), true);
    assert.equal(checkPlaybookId('a'.repeat(64)), true);
    assert.equal(checkPlaybookId('a'.repeat(65)), false);
    assert.equal(checkPlaybookId('ok\nbad'), false);
    assert.equal(checkPlaybookId('ok/'), false);
  });

  test('--topic with another word, a missing flag or extra arguments is a usage refusal', () => {
    const root = project();
    for (const argv of [
      ['new', '--playbook', 'idea'],
      ['new', '--playbook', 'idea', '--topic', 'Fix'],
      ['new', '--playbook', 'idea', '--topic', 'file', '--suffix', 'Build'],
      ['new', '--playbook', 'idea', '--topic', 'file', '--parent', 'x'],
      ['frob'],
      [],
    ]) {
      const r = run(root, argv);
      assert.equal(r.code, 3, argv.join(' '));
      assert.match(r.lines[0], /^refused: /);
    }
    assert.deepEqual(folders(root), []);
  });
});

describe('security: .company links and topic entry links', () => {
  test('.company as a link refuses with bad topic path and removes nothing', () => {
    const root = project();
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-real-'));
    dirs.push(real);
    fs.mkdirSync(path.join(real, 'work'));
    fs.writeFileSync(path.join(real, 'work-folder-topic-idea.txt'), 'Fix Login');
    fs.rmSync(path.join(root, '.company'), { recursive: true });
    fs.symlinkSync(real, path.join(root, '.company'), 'junction');
    const r = run(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.equal(r.code, 3);
    assert.deepEqual(r.lines, ['refused: bad topic path']);
    assert.equal(fs.readFileSync(path.join(real, 'work-folder-topic-idea.txt'), 'utf8'), 'Fix Login');
    assert.deepEqual(fs.readdirSync(path.join(real, 'work')), []);
    const c = run(root, ['clear', '--playbook', 'idea']);
    assert.deepEqual(c.lines, ['refused: bad topic path']);
    assert.equal(fs.existsSync(path.join(real, 'work-folder-topic-idea.txt')), true);
    fs.unlinkSync(path.join(root, '.company'));
  });

  test('.company/work as a link refuses', () => {
    const root = project();
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-real-'));
    dirs.push(real);
    fs.rmSync(path.join(root, '.company', 'work'), { recursive: true });
    fs.symlinkSync(real, path.join(root, '.company', 'work'), 'junction');
    writeTopic(root, 'Fix Login');
    const r = run(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.deepEqual(r.lines, ['refused: bad topic path']);
    assert.deepEqual(fs.readdirSync(real), []);
    assert.equal(fs.existsSync(topicPath(root)), true);
    fs.unlinkSync(path.join(root, '.company', 'work'));
  });

  test('missing .company/work refuses', () => {
    const root = project();
    fs.rmdirSync(path.join(root, '.company', 'work'));
    const r = run(root, ['new', '--playbook', 'idea', '--topic', 'none']);
    assert.deepEqual(r.lines, ['refused: bad topic path']);
  });

  test('the topic entry as a link: link removed, target untouched, fallback', () => {
    const root = project();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-target-'));
    dirs.push(target);
    fs.writeFileSync(path.join(target, 'keep.txt'), 'Fix Login');
    fs.symlinkSync(target, topicPath(root), 'junction');
    const r = makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.equal(r.code, 0);
    assert.equal(r.lines[1], `name: ${NAME}`);
    assert.equal(summaryLine(root, NAME, 1), 'Idea');
    assert.equal(fs.existsSync(topicPath(root)), false);
    assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'Fix Login');
  });

  test('a topic file with two links is not read, removed, fallback', () => {
    const root = project();
    writeTopic(root, 'Fix Login');
    const other = path.join(root, 'second-link.txt');
    fs.linkSync(topicPath(root), other);
    const r = makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.equal(r.lines[1], `name: ${NAME}`);
    assert.equal(summaryLine(root, NAME, 1), 'Idea');
    assert.equal(fs.existsSync(topicPath(root)), false);
    assert.equal(fs.readFileSync(other, 'utf8'), 'Fix Login');
  });

  test('a topic entry that is a folder is not read, cannot be unlinked: refused, nothing created', () => {
    const root = project();
    fs.mkdirSync(topicPath(root));
    fs.writeFileSync(path.join(topicPath(root), 'keep.txt'), 'x');
    const r = run(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.deepEqual(r, { code: 3, lines: ['refused: bad topic path'] });
    assert.equal(fs.readFileSync(path.join(topicPath(root), 'keep.txt'), 'utf8'), 'x');
    assert.deepEqual(folders(root), []);
  });

  test('a topic file over 4096 bytes is not read, removed, fallback', () => {
    const root = project();
    writeTopic(root, `Fix${' a'.repeat(3000)}`);
    const r = makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.equal(r.lines[1], `name: ${NAME}`);
    assert.equal(summaryLine(root, NAME, 1), 'Idea');
    assert.equal(fs.existsSync(topicPath(root)), false);
  });
});

describe('topic file: read steps and fallback', () => {
  test('a good topic is used and the file is removed', () => {
    const root = project();
    writeTopic(root, 'Fix Login\n');
    const r = makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.deepEqual(r.lines, [`id: ${ID}`, `name: ${NAME}`, `branch: aico/${ID}`]);
    assert.deepEqual(folders(root), [NAME]);
    assert.equal(summaryLine(root, NAME, 1), 'Fix Login');
    assert.equal(summaryLine(root, NAME, 3), 'Run: first idea');
    assert.equal(fs.existsSync(topicPath(root)), false);
  });

  test('no final LF is fine too', () => {
    const root = project();
    writeTopic(root, 'Fix Login');
    assert.equal(makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']).lines[1], `name: ${NAME}`);
    assert.equal(summaryLine(root, NAME, 1), 'Fix Login');
  });

  test('--topic file with no file refuses, exit 3, creates nothing', () => {
    const root = project();
    const r = run(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.equal(r.code, 3);
    assert.deepEqual(r.lines, ['refused: no topic file']);
    assert.deepEqual(folders(root), []);
  });

  test('--topic none uses the fallback and removes a stale file', () => {
    const root = project();
    writeTopic(root, 'Fix Login');
    const r = makeV2(root, ['new', '--playbook', 'usability-test', '--topic', 'none']);
    assert.equal(r.lines[1], `name: ${NAME}`);
    assert.equal(r.lines[2], `branch: aico/${ID}`);
    assert.equal(summaryLine(root, NAME, 1), 'Usability-Test');
    writeTopic(root, 'Fix Login', 'idea');
    assert.equal(makeV2(root, ['new', '--playbook', 'idea', '--topic', 'none']).lines[0], 'id: P20261030.000002');
    assert.equal(fs.existsSync(topicPath(root)), false);
  });

  test('a topic file ending CRLF falls back', () => {
    const root = project();
    writeTopic(root, 'Fix Login\r\n');
    makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.equal(summaryLine(root, NAME, 1), 'Idea');
    assert.equal(fs.existsSync(topicPath(root)), false);
  });

  const hostile = [
    ['two final LFs', 'Fix Login\n\n'],
    ['inner LF', 'Fix\nLogin'],
    ['tab', 'Fix\tLogin'],
    ['zero width', 'Fix\u200BLogin'],
    ['line separator', 'Fix\u2028Login'],
    ['bidi override', 'Fix\u202ELogin'],
    ['BOM', '\uFEFFFix Login'],
    ['NUL', 'Fix\0Login'],
    ['121 characters', 'a'.repeat(121)],
    ['empty', ''],
    ['only LF', '\n'],
  ];
  for (const [label, text] of hostile) {
    test(`hostile topic falls back: ${label}`, () => {
      const root = project();
      writeTopic(root, text);
      const r = makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']);
      assert.equal(r.code, 0);
      assert.equal(r.lines[1], `name: ${NAME}`);
    assert.equal(summaryLine(root, NAME, 1), 'Idea');
      assert.equal(fs.existsSync(topicPath(root)), false);
      assert.equal(r.lines.join('\n').includes(text.trim()) && text.trim() !== '', false);
    });
  }

  test('invalid UTF-8 falls back', () => {
    const root = project();
    fs.writeFileSync(topicPath(root), Buffer.from([0x46, 0xff, 0xfe]));
    makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.equal(summaryLine(root, NAME, 1), 'Idea');
  });

  test('a rejected topic text is never echoed', () => {
    const root = project();
    writeTopic(root, 'Evil $(rm -rf x)');
    const r = makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.equal(r.lines.join('\n').includes('Evil'), false);
  });

  test('readTopicFile (exported) runs steps 2-7', () => {
    const root = project();
    writeTopic(root, 'Fix Login\n');
    assert.deepEqual(readTopicFile(io, root, 'idea', 'file'), { topic: 'Fix Login' });
    assert.equal(fs.existsSync(topicPath(root)), false);
    assert.deepEqual(readTopicFile(io, root, 'idea', 'none'), { topic: null });
    assert.throws(() => readTopicFile(io, root, 'idea', 'file'), e => e instanceof WorkFolderRefusal && e.message === 'no topic file');
    writeTopic(root, 'bad\ntext');
    assert.deepEqual(readTopicFile(io, root, 'idea', 'file'), { topic: null });
    fs.rmSync(path.join(root, '.company', 'work'), { recursive: true });
    assert.throws(() => readTopicFile(io, root, 'idea', 'file'), e => e instanceof WorkFolderRefusal && e.message === 'bad topic path');
  });

  test('readTopicFile checks the id before touching the file system', () => {
    const calls = [];
    const spy = new Proxy(fs, { get: (t, k) => (typeof t[k] === 'function' ? (...a) => { calls.push(k); return t[k](...a); } : t[k]) });
    assert.throws(() => readTopicFile({ ...io, fs: spy }, '/nowhere', '../x', 'file'), e => e.message === 'bad playbook');
    assert.deepEqual(calls, []);
  });
});

describe('clear', () => {
  test('removes a stale file, prints cleared, creates no folder', () => {
    const root = project();
    writeTopic(root, 'Fix Login');
    const r = run(root, ['clear', '--playbook', 'idea']);
    assert.deepEqual(r, { code: 0, lines: ['cleared'] });
    assert.equal(fs.existsSync(topicPath(root)), false);
    assert.deepEqual(folders(root), []);
  });

  test('prints no topic file when none exists', () => {
    const root = project();
    assert.deepEqual(run(root, ['clear', '--playbook', 'idea']), { code: 0, lines: ['no topic file'] });
    assert.deepEqual(folders(root), []);
  });

  test('works for a draft-input word that is not a work-folder playbook shape check only', () => {
    const root = project();
    writeTopic(root, 'x', 'to-spec');
    assert.deepEqual(run(root, ['clear', '--playbook', 'to-spec']).lines, ['cleared']);
  });
});

describe('creator: collisions and branch ids', () => {
  test('same second: each run is a new project with the next number, first untouched', () => {
    const root = project();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      writeTopic(root, 'Fix');
      ids.push(makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']).lines[0]);
    }
    assert.deepEqual(ids, ['id: P20261030.000001', 'id: P20261030.000002', 'id: P20261030.000003']);
    fs.writeFileSync(path.join(root, '.company', 'work', NAME, 'keep.md'), 'x');
    writeTopic(root, 'Fix');
    makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.equal(fs.readFileSync(path.join(root, '.company', 'work', NAME, 'keep.md'), 'utf8'), 'x');
  });

  test('nine projects in one second make nine folders, the tenth too (the number runs on)', () => {
    const root = project();
    for (let i = 0; i < 10; i++) {
      writeTopic(root, 'Fix');
      assert.equal(makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']).code, 0);
    }
    assert.equal(folders(root).length, 10);
  });

  test('a different second does not collide', () => {
    const root = project();
    writeTopic(root, 'Fix');
    makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    writeTopic(root, 'Fix');
    const r = makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file'], new Date(2026, 9, 30, 23, 45, 1));
    assert.deepEqual(r.lines, ['id: P20261030.000002', 'name: P20261030.000002-23.45.01', 'branch: aico/P20261030.000002']);
  });

  test('a v1.1 or legacy folder of the same branch id does not take the ID', () => {
    const root = project();
    fs.mkdirSync(path.join(root, '.company', 'work', '2026-10-30-2345-fix-login'));
    fs.mkdirSync(path.join(root, '.company', 'work', `${STAMP} - Fix Login`));
    writeTopic(root, 'Fix Login');
    const r = makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.equal(r.lines[0], `id: ${ID}`);
  });

  test('the creator is not recursive: it never makes parents', () => {
    const root = project();
    writeTopic(root, 'Fix');
    makeV2(root, ['new', '--playbook', 'idea', '--topic', 'file']);
    assert.deepEqual(fs.readdirSync(path.join(root, '.company')).sort(), ['work']);
  });
});

describe('checkTopic', () => {
  for (const t of ['Fix-login', 'Fix Login Build', 'Fix Login draft', 'Fix Draft 2', 'fix', 'Fix  Login', 'Fix-', 'Fix.Login', 'Fix Login 2 Build 3']) {
    test(`fails: ${t}`, () => assert.equal(checkTopic(t), false));
  }
  for (const t of ['Release 2', 'Build Pipeline Fix', 'Fix', 'Usability-Test', 'To-Spec', '2 Fix', 'One Two Three Four Five']) {
    test(`passes: ${t}`, () => assert.equal(checkTopic(t), true));
  }
  test('limits: 60 characters, 5 words, string only', () => {
    assert.equal(checkTopic('A'.repeat(60)), true);
    assert.equal(checkTopic('A'.repeat(61)), false);
    assert.equal(checkTopic('A B C D E F'), false);
    assert.equal(checkTopic(`${'A'.repeat(29)} ${'B'.repeat(30)}`), true);
    assert.equal(checkTopic(`${'A'.repeat(30)} ${'B'.repeat(30)}`), false);
    assert.equal(checkTopic(null), false);
    assert.equal(checkTopic('Fix\n'), false);
  });
  test('linear time on a long hostile input', () => {
    const t0 = Date.now();
    checkTopic(`${'A-'.repeat(50000)}!`);
    checkTopic('A '.repeat(50000));
    assert.ok(Date.now() - t0 < 500);
  });
  test('fallbackTopic capitalises each hyphen part', () => {
    assert.equal(fallbackTopic('usability-test'), 'Usability-Test');
    assert.equal(fallbackTopic('idea'), 'Idea');
    assert.equal(fallbackTopic('to-spec'), 'To-Spec');
    assert.equal(fallbackTopic('a1-2b'), 'A1-2b');
  });
});

describe('parseName and isWorkFolder', () => {
  test('primary, collision, helper and numbered helper', () => {
    assert.deepEqual(parseName('2026-10-30 23.45 - Fix Login'), { stamp: STAMP, stem: 'Fix Login', suffix: null, number: null });
    assert.deepEqual(parseName('2026-10-30 23.45 - Fix Login 2'), { stamp: STAMP, stem: 'Fix Login 2', suffix: null, number: null });
    assert.deepEqual(parseName('2026-10-30 23.45 - Fix Login Build'), { stamp: STAMP, stem: 'Fix Login', suffix: 'Build', number: null });
    assert.deepEqual(parseName('2026-10-30 23.45 - Fix Login Draft'), { stamp: STAMP, stem: 'Fix Login', suffix: 'Draft', number: null });
    assert.deepEqual(parseName('2026-10-30 23.45 - Fix Login Draft 2'), { stamp: STAMP, stem: 'Fix Login', suffix: 'Draft', number: 2 });
    assert.deepEqual(parseName('2026-10-30 23.45 - Login Idea 2 Build'), { stamp: STAMP, stem: 'Login Idea 2', suffix: 'Build', number: null });
    assert.deepEqual(parseName('2026-10-30 23.45 - Release 2 Draft 3'), { stamp: STAMP, stem: 'Release 2', suffix: 'Draft', number: 3 });
  });
  test('null for a numbered Build and for bad shapes', () => {
    for (const n of [
      '2026-10-30 23.45 - Login Idea Build 2',
      '2026-10-30 23.45 - ',
      '2026-10-30 23.45 -  Fix',
      '2026-10-30 23.45 - Fix  Login',
      '2026-13-30 23.45 - Fix',
      '2026-02-30 23.45 - Fix',
      '2026-10-30 24.00 - Fix',
      '2026-10-30 23.60 - Fix',
      '2026-10-30 23.45 - Fix.Login',
      '2026-10-30 23.45 - Fix Login.',
      '2026-10-30 23.45 - Fix/Login',
      '2026-10-30 23.45 - Fix\\Login',
      "2026-10-30 23.45 - Fix 'Login",
      '2026-10-30 23.45 - Fix $x',
      '2026-10-30 23.45 - Fix `x`',
      '2026-10-30 23.45 - ..',
      '2026-10-30 23.45 - One Two Three Four Five Six',
      '2026-10-30 23.45 - fix',
      '2026-10-30 23.45 - Fix Login Draft 10',
      '2026-10-30 23.45 - Fix Login Draft 1',
      '2026-10-30 23.45 - Fix Login draft',
      '2026-10-30 23.45 - Fix Login\n',
      '2026-10-30 23.45 -Fix',
      'fix-login ',
      '..',
      'a/b',
      '',
    ]) {
      assert.equal(parseName(n), null, n);
      assert.equal(isWorkFolder(n), false, n);
    }
  });
  test('isWorkFolder accepts new names (also with a 5-word topic and a number) and legacy slugs', () => {
    assert.equal(isWorkFolder('2026-10-30 23.45 - Fix Login'), true);
    assert.equal(isWorkFolder('2026-10-30 23.45 - One Two Three Four Five Draft'), true);
    assert.equal(isWorkFolder('2026-10-30 23.45 - One Two Three Four Five 2'), true);
    assert.equal(isWorkFolder('2026-10-30 23.45 - One Two Three Four Five 2 Build'), true);
    assert.equal(isWorkFolder('idea-20261030-2242-build-draft'), true);
    assert.equal(isWorkFolder('reprompt-20261030-2247'), true);
    assert.equal(isWorkFolder('a'.repeat(64)), true);
    assert.equal(isWorkFolder('a'.repeat(65)), false);
    assert.equal(isWorkFolder('Fix-Login'), false);
    assert.equal(isWorkFolder('a..b'), false);
    assert.equal(isWorkFolder('-a'), false);
    assert.equal(isWorkFolder(42), false);
  });
  test('legacy names have no parsed parts', () => {
    assert.equal(parseName('idea-20261030-2242-build-draft'), null);
  });
});

describe('newName and stampOf', () => {
  test('stampOf uses local time, zero padded', () => {
    assert.equal(stampOf(new Date(2026, 0, 5, 3, 7)), '2026-01-05 03.07');
  });
  test('newName gives the first free number', () => {
    const taken = new Set([`${STAMP} - Fix`, `${STAMP} - Fix 2`]);
    assert.equal(newName(STAMP, 'Fix', n => taken.has(n)), `${STAMP} - Fix 3`);
    assert.equal(newName(STAMP, 'Fix', () => false), `${STAMP} - Fix`);
    assert.equal(newName(STAMP, 'Fix', () => true), null);
    assert.equal(newName(STAMP, 'bad topic', () => false), null);
  });
  test('a 5-word topic still takes a number', () => {
    assert.equal(newName(STAMP, 'One Two Three Four Five', n => n.endsWith('Five')), `${STAMP} - One Two Three Four Five 2`);
  });
});

describe('helperName', () => {
  const none = () => false;
  const own = '2026-10-31 09.15';
  test('flow Build helper keeps the parent date-time', () => {
    assert.equal(helperName('2026-10-30 22.42 - Login Idea', 'Build', { stamp: own, isTaken: none }), '2026-10-30 22.42 - Login Idea Build');
  });
  test('same-minute pair gives two different Build helpers', () => {
    const a = helperName('2026-10-30 22.42 - Login Idea', 'Build', { stamp: own, isTaken: none });
    const b = helperName('2026-10-30 22.42 - Login Idea 2', 'Build', { stamp: own, isTaken: none });
    assert.equal(b, '2026-10-30 22.42 - Login Idea 2 Build');
    assert.notEqual(a, b);
  });
  test('topic number word stays', () => {
    assert.equal(helperName('2026-10-30 22.42 - Release 2', 'Build', { stamp: own, isTaken: none }), '2026-10-30 22.42 - Release 2 Build');
  });
  test('a Draft is named at its own time, second one numbered', () => {
    const parent = '2026-10-30 22.42 - Login Idea Build';
    const d1 = helperName(parent, 'Draft', { stamp: '2026-10-30 23.10', isTaken: none });
    assert.equal(d1, '2026-10-30 23.10 - Login Idea Draft');
    assert.equal(helperName(parent, 'Draft', { stamp: '2026-10-30 23.10', isTaken: n => n === d1 }), '2026-10-30 23.10 - Login Idea Draft 2');
  });
  test('Draft numbers run to 9 then null', () => {
    const taken = new Set();
    let last;
    for (let i = 0; i < 9; i++) {
      last = helperName('2026-10-30 22.42 - Login Idea', 'Draft', { stamp: own, isTaken: n => taken.has(n) });
      taken.add(last);
    }
    assert.equal(last, `${own} - Login Idea Draft 9`);
    assert.equal(helperName('2026-10-30 22.42 - Login Idea', 'Draft', { stamp: own, isTaken: n => taken.has(n) }), null);
  });
  test('a Draft of a Draft strips one suffix and one number', () => {
    assert.equal(helperName('2026-10-30 23.10 - Login Idea Draft 2', 'Draft', { stamp: own, isTaken: none }), `${own} - Login Idea Draft`);
  });
  test('a 5-word topic with collision number 2 keeps its stem', () => {
    assert.equal(
      helperName('2026-10-30 22.42 - One Two Three Four Five 2', 'Draft', { stamp: own, isTaken: none }),
      `${own} - One Two Three Four Five 2 Draft`,
    );
  });
  test('a Build helper never takes a number and ignores isTaken', () => {
    assert.equal(helperName('2026-10-30 22.42 - Login Idea', 'Build', { stamp: own, isTaken: () => true }), '2026-10-30 22.42 - Login Idea Build');
  });
  test('a legacy flow keeps <slug>-build', () => {
    assert.equal(helperName('bug-fix-login', 'Build', { stamp: own, isTaken: none }), 'bug-fix-login-build');
  });
  test('a legacy parent Draft helper is a new name from its slug words', () => {
    assert.equal(helperName('login-idea-build', 'Draft', { stamp: own, fallback: 'fix', isTaken: none }), `${own} - Login Idea Draft`);
    assert.equal(helperName('login-idea-draft-3', 'Draft', { stamp: own, fallback: 'fix', isTaken: none }), `${own} - Login Idea Draft`);
    assert.equal(helperName('login-idea', 'Draft', { stamp: own, fallback: 'fix', isTaken: none }), `${own} - Login Idea Draft`);
  });
  test('R-26 fallback: legacy parent with a stem that fails', () => {
    assert.equal(
      helperName('bug-fix-login-page-crash-on-save-build', 'Draft', { stamp: '2026-10-30 23.10', fallback: 'fix', isTaken: none }),
      '2026-10-30 23.10 - Fix Draft',
    );
    assert.equal(
      helperName('idea-20261030-2242-build-draft', 'Draft', { stamp: '2026-10-30 23.10', fallback: 'to-spec', isTaken: none }),
      '2026-10-30 23.10 - To-Spec Draft',
    );
    assert.deepEqual(parseName('2026-10-30 23.10 - Fix Draft'), { stamp: '2026-10-30 23.10', stem: 'Fix', suffix: 'Draft', number: null });
  });
  test('a legacy stem that fails with no fallback word gives null', () => {
    assert.equal(helperName('bug-fix-login-page-crash-on-save-build', 'Draft', { stamp: own, isTaken: none }), null);
  });
  test('suffix and number sit outside the topic cap', () => {
    const parent = '2026-10-30 22.42 - One Two Three Four Five';
    assert.equal(helperName(parent, 'Build', { stamp: own, isTaken: none }), `${parent} Build`);
    assert.equal(isWorkFolder(`${parent} Build`), true);
    assert.equal(helperName(parent, 'Draft', { stamp: own, isTaken: n => n === `${own} - One Two Three Four Five Draft` }), `${own} - One Two Three Four Five Draft 2`);
  });
  test('bad parent, bad suffix, bad stamp give null', () => {
    assert.equal(helperName('../x', 'Draft', { stamp: own, isTaken: none }), null);
    assert.equal(helperName('2026-10-30 22.42 - Login Idea', 'Review', { stamp: own, isTaken: none }), null);
    assert.equal(helperName('2026-10-30 22.42 - Login Idea', 'Draft', { stamp: '../x', isTaken: none }), null);
    assert.equal(helperName('2026-10-30 22.42 - Login Idea Build 2', 'Draft', { stamp: own, isTaken: none }), null);
  });
});

describe('branchId', () => {
  const cases = [
    ['2026-10-30 23.45 - Fix Login', '2026-10-30-2345-fix-login'],
    ['2026-10-30 23.45 - Fix Login 2', '2026-10-30-2345-fix-login-2'],
    ['2026-10-30 23.45 - Fix Login Draft', '2026-10-30-2345-fix-login-draft'],
    ['2026-10-30 23.45 - Fix Login Draft 2', '2026-10-30-2345-fix-login-draft-2'],
    ['2026-10-30 23.45 - Usability-Test', '2026-10-30-2345-usability-test'],
    ['idea-20261030-2242-build-draft', 'idea-20261030-2242-build-draft'],
    ['reprompt-20261030-2247', 'reprompt-20261030-2247'],
  ];
  for (const [name, id] of cases) test(`${name} -> ${id}`, () => assert.equal(branchId(name), id));
  test('a bad name has no branch id', () => {
    assert.equal(branchId('../x'), null);
    assert.equal(branchId('2026-10-30 23.45 - Fix Login Build 2'), null);
  });
});

describe('branch command', () => {
  test('prints the branch for an existing new or legacy folder and writes nothing', () => {
    const root = project();
    const name = `${STAMP} - Fix Login`;
    fs.mkdirSync(path.join(root, '.company', 'work', name));
    fs.mkdirSync(path.join(root, '.company', 'work', 'old-slug-build'));
    const before = folders(root);
    assert.deepEqual(run(root, ['branch', name]), { code: 0, lines: ['branch: aico/2026-10-30-2345-fix-login'] });
    assert.deepEqual(run(root, ['branch', 'old-slug-build']), { code: 0, lines: ['branch: aico/old-slug-build'] });
    assert.deepEqual(folders(root), before);
  });
  test('refuses a bad name and an unknown folder, exit 3', () => {
    const root = project();
    for (const n of ['../x', 'a/b', "2026-10-30 23.45 - Fix 'x", `${STAMP} - Fix Login`]) {
      const r = run(root, ['branch', n]);
      assert.equal(r.code, 3, n);
      assert.match(r.lines[0], /^refused: (bad name|unknown name)$/);
    }
    assert.deepEqual(folders(root), []);
  });
  test('a link named like a work folder is refused', () => {
    const root = project();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-target-'));
    dirs.push(target);
    const name = `${STAMP} - Fix Login`;
    fs.symlinkSync(target, path.join(root, '.company', 'work', name), 'junction');
    assert.equal(run(root, ['branch', name]).code, 3);
    fs.unlinkSync(path.join(root, '.company', 'work', name));
  });
});

describe('real shell calls', () => {
  let bashOk;
  before(() => {
    bashOk = spawnSync(BASH, ['-c', 'exit 0']).status === 0;
  });
  test('bash exists (no bash is a failure, not a skip)', () => assert.equal(bashOk, true));

  test('work-folder branch on a new name with a space and a dot, single quoted', () => {
    const root = project();
    const name = '2026-10-30 23.45 - Fix Login';
    fs.mkdirSync(path.join(root, '.company', 'work', name));
    const r = spawnSync(BASH, ['-c', `"$1" "$2" branch '${name}'`, 'bash', process.execPath, SCRIPT], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'branch: aico/2026-10-30-2345-fix-login\n');
  });

  test('work-folder new through bash prints id, name and branch, exit 0', () => {
    const root = project();
    writeTopic(root, 'Fix Login\n');
    const r = spawnSync(BASH, ['-c', `"$1" "$2" new --playbook 'idea' --topic file`, 'bash', process.execPath, SCRIPT], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const [i, n, b] = r.stdout.trimEnd().split('\n');
    assert.equal(r.stdout.trimEnd().split('\n').length, 3);
    assert.match(i, /^id: P\d{8}\.000001$/);
    assert.match(n, /^name: P\d{8}\.000001(-\d{2}\.\d{2}\.\d{2}|\/01-idea)$/);
    assert.equal(b, `branch: aico/${i.slice(4)}`);
    assert.equal(folders(root).length, 1);
    assert.equal(summaryLine(root, n.slice(6), 1), 'Fix Login');
  });

  test('a refusal exits 3 on the process level', () => {
    const root = project();
    const r = spawnSync(process.execPath, [SCRIPT, 'new', '--playbook', '../x', '--topic', 'none'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 3);
    assert.equal(r.stdout, 'refused: bad playbook\n');
  });

  test('a topic holding a quote and $( never reaches a shell', () => {
    const root = project();
    const marker = path.join(root, 'pwned');
    writeTopic(root, `Fix '$(touch ${marker.replaceAll('\\', '/')})'`);
    const r = spawnSync(BASH, ['-c', `"$1" "$2" new --playbook 'idea' --topic file`, 'bash', process.execPath, SCRIPT], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(marker), false);
    assert.match(r.stdout, /^id: P\d{8}\.000001\nname: /);
  });
});
