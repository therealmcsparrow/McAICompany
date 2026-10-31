import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './draft-input.mjs';

const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function fixture(files = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-drafts-')));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) put(root, rel, body);
  return root;
}

function put(root, rel, body) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

const at = (h, m) => new Date(2026, 9, 31, h, m);
const NOW = at(9, 15);
const run = (root, now, ...args) => main(args, { root, now });
const exists = (root, rel) => fs.existsSync(path.join(root, ...rel.split('/')));
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

const LOGIN = '2026-10-30 22.42 - Login Idea';
const NOTE = '# Notes\nsome words\n';
const GRILL = '---\nformat: 1\n---\n## Log\n';
const topicFile = (root, id, text) => put(root, `.company/work-folder-topic-${id}.txt`, text);
const argFile = (root, id, text) => put(root, `.company/draft-input-arg-${id}.txt`, text);

describe('take under a new-name source', () => {
  test('a non-draft file gives a Draft helper at the run time, then Draft 2', () => {
    const root = fixture({ [`.company/work/${LOGIN}/notes.md`]: NOTE });
    const src = `.company/work/${LOGIN}/notes.md`;
    const a = run(root, at(23, 10), 'take', src, '--for', 'to-spec');
    assert.equal(a.code, 0);
    assert.equal(a.lines[0], 'slug: 2026-10-31 23.10 - Login Idea Draft');
    assert.equal(a.lines[1], 'input: .company/work/2026-10-31 23.10 - Login Idea Draft/input-to-spec.md');
    const b = run(root, at(23, 10), 'take', src, '--for', 'to-spec');
    assert.equal(b.lines[0], 'slug: 2026-10-31 23.10 - Login Idea Draft 2');
    assert.ok(exists(root, '.company/work/2026-10-31 23.10 - Login Idea Draft 2/input-to-spec.md'));
  });

  test('take --for feature on spec.md names a Draft at its own time', () => {
    const root = fixture({ [`.company/work/${LOGIN}/spec.md`]: NOTE });
    const src = `.company/work/${LOGIN}/spec.md`;
    assert.equal(run(root, NOW, 'take', src, '--for', 'feature').lines[0], 'slug: 2026-10-31 09.15 - Login Idea Draft');
    assert.equal(run(root, NOW, 'take', src, '--for', 'feature').lines[0], 'slug: 2026-10-31 09.15 - Login Idea Draft 2');
  });

  test('take --for fix on a Build helper plan gives a Draft', () => {
    const root = fixture({ [`.company/work/${LOGIN} Build/plan.md`]: NOTE });
    const r = run(root, NOW, 'take', `.company/work/${LOGIN} Build/plan.md`, '--for', 'fix');
    assert.equal(r.lines[0], 'slug: 2026-10-31 09.15 - Login Idea Draft');
  });

  test('take --for fix refuses the plan of a primary name', () => {
    const root = fixture({ [`.company/work/${LOGIN}/plan.md`]: NOTE });
    const before = tree(root);
    const r = run(root, NOW, 'take', `.company/work/${LOGIN}/plan.md`, '--for', 'fix');
    assert.deepEqual(r, { code: 3, lines: ['refused: not a build plan'] });
    assert.deepEqual(tree(root), before);
  });

  test('a Draft helper of a Draft keeps the stem', () => {
    const root = fixture({ [`.company/work/${LOGIN} Draft/grill.md`]: GRILL });
    const r = run(root, NOW, 'take', `.company/work/${LOGIN} Draft/grill.md`, '--for', 'feature');
    assert.equal(r.lines[0], 'slug: 2026-10-31 09.15 - Login Idea Draft');
  });

  test('to-spec on grill.md reuses a folder with draft files only', () => {
    const root = fixture({ [`.company/work/${LOGIN}/grill.md`]: GRILL });
    const r = run(root, NOW, 'take', `.company/work/${LOGIN}/grill.md`, '--for', 'to-spec');
    assert.equal(r.lines[0], `slug: ${LOGIN}`);
    assert.ok(exists(root, `.company/work/${LOGIN}/input-to-spec.md`));
  });

  test('to-spec on grill.md of a folder holding a Handoff gives a Draft at its own time', () => {
    const root = fixture({
      [`.company/work/${LOGIN}/grill.md`]: GRILL,
      [`.company/work/${LOGIN}/01-product-manager.md`]: 'x',
    });
    const r = run(root, NOW, 'take', `.company/work/${LOGIN}/grill.md`, '--for', 'to-spec');
    assert.equal(r.lines[0], 'slug: 2026-10-31 09.15 - Login Idea Draft');
    assert.ok(!exists(root, `.company/work/${LOGIN} 2`));
  });

  test('all nine Draft numbers taken is refused', () => {
    const files = { [`.company/work/${LOGIN}/notes.md`]: NOTE };
    const base = '2026-10-31 09.15 - Login Idea Draft';
    files[`.company/work/${base}/x`] = 'x';
    for (let n = 2; n <= 9; n++) files[`.company/work/${base} ${n}/x`] = 'x';
    const root = fixture(files);
    const r = run(root, NOW, 'take', `.company/work/${LOGIN}/notes.md`, '--for', 'grill');
    assert.deepEqual(r, { code: 3, lines: ['refused: too many runs this minute'] });
  });
});

describe('take under a legacy source', () => {
  test('feature on grill.md gives a new-form Draft from the slug words', () => {
    const root = fixture({ '.company/work/login-page/grill.md': GRILL });
    const r = run(root, NOW, 'take', '.company/work/login-page/grill.md', '--for', 'feature');
    assert.equal(r.lines[0], 'slug: 2026-10-31 09.15 - Login Page Draft');
  });

  test('fix on a legacy build plan whose stem fails gives the fallback word', () => {
    const slug = 'bug-fix-login-page-crash-on-save-build';
    const root = fixture({ [`.company/work/${slug}/plan.md`]: NOTE });
    const r = run(root, at(23, 10), 'take', `.company/work/${slug}/plan.md`, '--for', 'fix');
    assert.equal(r.lines[0], 'slug: 2026-10-31 23.10 - Fix Draft');
  });

  test('grill on a legacy source that is not free keeps -2', () => {
    const root = fixture({
      '.company/work/login-page/grill.md': GRILL,
      '.company/work/login-page/01-product-manager.md': 'x',
    });
    const r = run(root, NOW, 'take', '.company/work/login-page/grill.md', '--for', 'grill');
    assert.equal(r.lines[0], 'slug: login-page-2');
  });

  test('grill on a legacy grill.md reuses the slug', () => {
    const root = fixture({ '.company/work/login-page/grill.md': GRILL });
    const r = run(root, NOW, 'take', '.company/work/login-page/grill.md', '--for', 'to-spec');
    assert.equal(r.lines[0], 'slug: login-page');
  });

  test('another file under a legacy folder gives a new-form Draft', () => {
    const root = fixture({ '.company/work/login-page/plan.md': NOTE });
    const r = run(root, NOW, 'take', '.company/work/login-page/plan.md', '--for', 'to-spec');
    assert.equal(r.lines[0], 'slug: 2026-10-31 09.15 - Login Page Draft');
  });
});

describe('take of a file outside the work folder', () => {
  test('the Topic file names the run, then the number', () => {
    const root = fixture({ 'docs/idea.md': NOTE });
    topicFile(root, 'to-spec', 'Login Page\n');
    fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
    const a = run(root, NOW, 'take', 'docs/idea.md', '--for', 'to-spec');
    assert.equal(a.lines[0], 'slug: 2026-10-31 09.15 - Login Page');
    assert.ok(!exists(root, '.company/work-folder-topic-to-spec.txt'));
    topicFile(root, 'to-spec', 'Login Page');
    const b = run(root, NOW, 'take', 'docs/idea.md', '--for', 'to-spec');
    assert.equal(b.lines[0], 'slug: 2026-10-31 09.15 - Login Page 2');
  });

  test('no Topic file gives the fallback for --for', () => {
    const root = fixture({ 'docs/idea.md': NOTE });
    const r = run(root, NOW, 'take', 'docs/idea.md', '--for', 'to-tickets');
    assert.equal(r.code, 4);
    const ok = fixture({ 'docs/idea.md': '- AC1: a\n' });
    assert.equal(run(ok, NOW, 'take', 'docs/idea.md', '--for', 'to-tickets').lines[0], 'slug: 2026-10-31 09.15 - To-Tickets');
  });

  test('a bad Topic falls back and the file is removed', () => {
    const root = fixture({ 'docs/idea.md': NOTE });
    topicFile(root, 'grill', 'login page\n');
    const r = run(root, NOW, 'take', 'docs/idea.md', '--for', 'grill');
    assert.equal(r.lines[0], 'slug: 2026-10-31 09.15 - Grill');
    assert.ok(!exists(root, '.company/work-folder-topic-grill.txt'));
  });

  test('a hard-linked Topic file is not read', () => {
    const root = fixture({ 'docs/idea.md': NOTE });
    const t = topicFile(root, 'grill', 'Login Page\n');
    fs.linkSync(t, path.join(root, 'other.txt'));
    const r = run(root, NOW, 'take', 'docs/idea.md', '--for', 'grill');
    assert.equal(r.lines[0], 'slug: 2026-10-31 09.15 - Grill');
    assert.ok(exists(root, 'other.txt'));
  });

  test('an existing run name is never reused', () => {
    const root = fixture({ 'docs/idea.md': NOTE, '.company/work/2026-10-31 09.15 - Grill/grill.md': GRILL });
    const r = run(root, NOW, 'take', 'docs/idea.md', '--for', 'grill');
    assert.equal(r.lines[0], 'slug: 2026-10-31 09.15 - Grill 2');
  });

  test('a path with spaces outside the work folder is refused', () => {
    const root = fixture({ 'docs/my idea.md': NOTE });
    const r = run(root, NOW, 'take', 'docs/my idea.md', '--for', 'grill');
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: path /);
  });
});

describe('take refuses hostile paths', () => {
  const bad = [
    '.company/work/bad name/spec.md',
    '.company/work/2026-13-30 22.42 - Login Idea/spec.md',
    '.company/work/2026-10-30 22.42 - login idea/spec.md',
    '.company/work/2026-10-30 22.42 - Login Idea Build 2/plan.md',
    `.company/work/${LOGIN}/../../x.md`,
    `.company/work/${LOGIN}/my notes.md`,
    `.company/work/${LOGIN}/.git/config`,
    `.company/work/${LOGIN}/`,
    `.company/work/${LOGIN}`,
    '.company/work//spec.md',
    `.company/work/${LOGIN}'/spec.md`,
    `.company/work/${LOGIN}$(x)/spec.md`,
    `.company/work/${LOGIN} /spec.md`,
    '.company/work/2026-10-30 22.42 - Login Idea./spec.md',
  ];
  for (const p of bad) {
    test(`refused: ${p}`, () => {
      const root = fixture({ [`.company/work/${LOGIN}/spec.md`]: NOTE });
      const before = tree(root);
      const r = run(root, NOW, 'take', p, '--for', 'to-spec');
      assert.equal(r.code, 3);
      assert.ok(r.lines.length === 1 && r.lines[0].startsWith('refused: '));
      assert.ok(!r.lines[0].includes('$('));
      assert.deepEqual(tree(root), before);
    });
  }

  test('backslashes read as slashes', () => {
    const root = fixture({ [`.company/work/${LOGIN}/spec.md`]: NOTE });
    const r = run(root, NOW, 'take', `.company\\work\\${LOGIN}\\spec.md`, '--for', 'feature');
    assert.equal(r.code, 0);
    assert.equal(r.lines[0], 'slug: 2026-10-31 09.15 - Login Idea Draft');
  });

  test('a linked source folder is refused', () => {
    const root = fixture({ 'elsewhere/spec.md': NOTE });
    fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, '.company', 'work', LOGIN), 'junction');
    const r = run(root, NOW, 'take', `.company/work/${LOGIN}/spec.md`, '--for', 'feature');
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: (link|outside the product root)$/);
    assert.deepEqual(fs.readdirSync(path.join(root, 'elsewhere')), ['spec.md']);
  });

  test('a linked work folder is refused and nothing is created inside it', () => {
    const root = fixture({ 'docs/idea.md': NOTE, 'elsewhere/keep.txt': 'k' });
    fs.mkdirSync(path.join(root, '.company'), { recursive: true });
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, '.company', 'work'), 'junction');
    const r = run(root, NOW, 'take', 'docs/idea.md', '--for', 'grill');
    assert.equal(r.code, 3);
    assert.deepEqual(fs.readdirSync(path.join(root, 'elsewhere')), ['keep.txt']);
  });

  test('a hard-linked source is refused', () => {
    const root = fixture({ [`.company/work/${LOGIN}/spec.md`]: NOTE });
    fs.linkSync(path.join(root, '.company', 'work', LOGIN, 'spec.md'), path.join(root, 'twin.md'));
    const r = run(root, NOW, 'take', `.company/work/${LOGIN}/spec.md`, '--for', 'feature');
    assert.deepEqual(r, { code: 3, lines: ['refused: hard-linked'] });
  });

  test('a feature take of a non-draft file under a work folder is refused', () => {
    const root = fixture({ [`.company/work/${LOGIN}/notes.md`]: NOTE });
    const r = run(root, NOW, 'take', `.company/work/${LOGIN}/notes.md`, '--for', 'feature');
    assert.deepEqual(r, { code: 3, lines: ['refused: not a draft file'] });
  });
});

describe('Topic file consumption', () => {
  test('removed unread on take of a path under .company/work', () => {
    const root = fixture({ [`.company/work/${LOGIN}/notes.md`]: NOTE });
    topicFile(root, 'to-spec', 'Other Topic\n');
    const r = run(root, NOW, 'take', `.company/work/${LOGIN}/notes.md`, '--for', 'to-spec');
    assert.equal(r.lines[0], 'slug: 2026-10-31 09.15 - Login Idea Draft');
    assert.ok(!exists(root, '.company/work-folder-topic-to-spec.txt'));
  });

  test('removed unread on arg: resume', () => {
    const root = fixture({});
    argFile(root, 'grill', `resume ${LOGIN}`);
    topicFile(root, 'grill', 'Login Page\n');
    const r = run(root, NOW, 'arg', '--for', 'grill');
    assert.deepEqual(r, { code: 0, lines: [`arg: resume ${LOGIN}`] });
    assert.ok(!exists(root, '.company/work-folder-topic-grill.txt'));
    assert.ok(!exists(root, '.company/draft-input-arg-grill.txt'));
  });

  test('kept after arg: file outside .company/work, read by the take', () => {
    const root = fixture({ 'docs/idea.md': '- AC1: a\n' });
    argFile(root, 'to-tickets', 'docs/idea.md');
    topicFile(root, 'to-tickets', 'Login Page\n');
    assert.deepEqual(run(root, NOW, 'arg', '--for', 'to-tickets'), { code: 0, lines: ['arg: file docs/idea.md'] });
    assert.ok(exists(root, '.company/work-folder-topic-to-tickets.txt'));
    const r = run(root, NOW, 'take', 'docs/idea.md', '--for', 'to-tickets');
    assert.equal(r.lines[0], 'slug: 2026-10-31 09.15 - Login Page');
    assert.ok(!exists(root, '.company/work-folder-topic-to-tickets.txt'));
  });

  test('removed unread after arg: file under .company/work', () => {
    const root = fixture({});
    argFile(root, 'feature', `.company/work/${LOGIN}/spec.md`);
    topicFile(root, 'feature', 'Login Page\n');
    run(root, NOW, 'arg', '--for', 'feature');
    assert.ok(!exists(root, '.company/work-folder-topic-feature.txt'));
  });

  test('read by arg idea for grill', () => {
    const root = fixture({});
    argFile(root, 'grill', 'make the login page better');
    topicFile(root, 'grill', 'Login Page\n');
    const r = run(root, NOW, 'arg', '--for', 'grill');
    assert.deepEqual(r, { code: 0, lines: ['arg: idea', 'slug: 2026-10-31 09.15 - Login Page'] });
    assert.ok(!exists(root, '.company/work-folder-topic-grill.txt'));
  });

  test('arg idea for grill with no Topic file gives the fallback', () => {
    const root = fixture({});
    argFile(root, 'to-spec', 'make the login page better');
    const r = run(root, NOW, 'arg', '--for', 'to-spec');
    assert.deepEqual(r.lines, ['arg: idea', 'slug: 2026-10-31 09.15 - To-Spec']);
  });

  test('arg idea for feature prints no slug and removes the Topic file', () => {
    const root = fixture({});
    argFile(root, 'feature', 'make the login page better');
    topicFile(root, 'feature', 'Login Page\n');
    assert.deepEqual(run(root, NOW, 'arg', '--for', 'feature'), { code: 0, lines: ['arg: idea'] });
    assert.ok(!exists(root, '.company/work-folder-topic-feature.txt'));
  });

  test('a refused path still removes the Topic file', () => {
    const root = fixture({});
    argFile(root, 'grill', '../secret.md');
    topicFile(root, 'grill', 'Login Page\n');
    const r = run(root, NOW, 'arg', '--for', 'grill');
    assert.equal(r.code, 3);
    assert.ok(!exists(root, '.company/work-folder-topic-grill.txt'));
  });
});

describe('arg paths and names', () => {
  const arg = (text, id = 'to-spec') => {
    const root = fixture({});
    argFile(root, id, text);
    return run(root, NOW, 'arg', '--for', id);
  };

  test('resume takes a new name with spaces', () => {
    assert.deepEqual(arg(`resume ${LOGIN}`, 'grill'), { code: 0, lines: [`arg: resume ${LOGIN}`] });
    assert.deepEqual(arg(`resume ${LOGIN} Draft 2`, 'grill').lines, [`arg: resume ${LOGIN} Draft 2`]);
    assert.deepEqual(arg('resume login-page', 'grill').lines, ['arg: resume login-page']);
  });

  test('resume refuses names outside the allow-list', () => {
    for (const text of ['resume bad name', `resume ${LOGIN}x'`, 'resume ../x', 'resume 2026-10-30 22.42 - login']) {
      const r = arg(text, 'grill');
      assert.notEqual(r.lines[0].slice(0, 12), 'arg: resume ', text);
    }
  });

  test('the grill.md path of a new name is a resume for grill', () => {
    assert.deepEqual(arg(`.company\\work\\${LOGIN}\\grill.md`, 'grill').lines, [`arg: resume ${LOGIN}`]);
    assert.deepEqual(arg(`  .company/work/${LOGIN}/grill.md  `, 'grill').lines, [`arg: resume ${LOGIN}`]);
  });

  test('a draft file path with spaces in the name is arg: file', () => {
    for (const f of ['grill.md', 'spec.md', 'plan.md']) {
      assert.deepEqual(arg(`.company/work/${LOGIN}/${f}`, 'feature').lines, [`arg: file .company/work/${LOGIN}/${f}`]);
    }
    assert.deepEqual(arg(`.company\\work\\${LOGIN} Build\\plan.md`, 'to-tickets').lines, [`arg: file .company/work/${LOGIN} Build/plan.md`]);
  });

  test('spaces are allowed only inside the name', () => {
    const r = arg(`.company/work/${LOGIN}/my notes.md`, 'feature');
    assert.deepEqual(r.lines, ['arg: idea']);
    assert.deepEqual(arg('docs/my plan.md', 'feature').lines, ['arg: idea']);
  });

  test('a work path with a bad name is not arg: file', () => {
    for (const text of ['.company/work/bad name/spec.md', '.company/work/2026-10-30 22.42 - login idea/spec.md']) {
      const r = arg(text, 'feature');
      assert.ok(!r.lines[0].startsWith('arg: file'), text);
    }
  });

  test('a one-token path under a work folder is checked by name and path rule', () => {
    assert.deepEqual(arg('.company/work/Bad/notes.md', 'feature'), { code: 3, lines: ['refused: path bad character'] });
    assert.deepEqual(arg('.company/work/login-page/../x.md', 'feature'), { code: 3, lines: ['refused: path dot segment'] });
    assert.deepEqual(arg(`.company/work/${LOGIN}/../x.md`, 'feature').lines, ['arg: idea']);
    assert.equal(arg('.company/work/login-page/notes.md', 'feature').lines[0], 'arg: file .company/work/login-page/notes.md');
  });

  test('never prints the argument text', () => {
    const r = arg(`.company/work/${LOGIN}$(rm)/spec.md`, 'feature');
    assert.ok(!r.lines.join('\n').includes('$(rm)'));
  });
});

describe('free with new names', () => {
  test('a new primary name that is free is printed as given', () => {
    const root = fixture({});
    const r = run(root, NOW, 'free', '2026-10-31 09.15 - Login Page', '--for', 'grill');
    assert.deepEqual(r, { code: 0, lines: ['slug: 2026-10-31 09.15 - Login Page'] });
  });

  test('a taken name gets the next number', () => {
    const root = fixture({
      '.company/work/2026-10-31 09.15 - Login Page/01-product-manager.md': 'x',
      '.company/work/2026-10-31 09.15 - Login Page 2/01-product-manager.md': 'x',
    });
    const r = run(root, NOW, 'free', '2026-10-31 09.15 - Login Page', '--for', 'feature');
    assert.equal(r.lines[0], 'slug: 2026-10-31 09.15 - Login Page 3');
  });

  test('a draft-only folder is reused for grill, never for feature', () => {
    const root = fixture({ '.company/work/2026-10-31 09.15 - Login Page/spec.md': NOTE });
    assert.equal(run(root, NOW, 'free', '2026-10-31 09.15 - Login Page', '--for', 'grill').lines[0], 'slug: 2026-10-31 09.15 - Login Page');
    assert.equal(run(root, NOW, 'free', '2026-10-31 09.15 - Login Page', '--for', 'feature').lines[0], 'slug: 2026-10-31 09.15 - Login Page 2');
  });

  test('a legacy slug keeps -2', () => {
    const root = fixture({ '.company/work/login/01-product-manager.md': 'x' });
    assert.equal(run(root, NOW, 'free', 'login', '--for', 'grill').lines[0], 'slug: login-2');
  });

  test('names outside the allow-list are refused', () => {
    const root = fixture({});
    for (const name of ['2026-10-31 09.15 - login page', '2026-10-31 09.15 - Login Page Build', '../x', "2026-10-31 09.15 - Login'", 'Bad Name']) {
      assert.deepEqual(run(root, NOW, 'free', name, '--for', 'grill'), { code: 3, lines: ['refused: bad slug'] }, name);
    }
  });

  test('nine taken numbers are refused with the minute message', () => {
    const files = { '.company/work/2026-10-31 09.15 - Login Page/x': 'x' };
    for (let n = 2; n <= 9; n++) files[`.company/work/2026-10-31 09.15 - Login Page ${n}/x`] = 'x';
    const root = fixture(files);
    const r = run(root, NOW, 'free', '2026-10-31 09.15 - Login Page', '--for', 'feature');
    assert.deepEqual(r, { code: 3, lines: ['refused: too many runs this minute'] });
  });
});
