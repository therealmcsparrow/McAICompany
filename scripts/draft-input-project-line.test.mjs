// draft-input v1.7: a last `project:` line in the argument file, and `take --project`.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './draft-input.mjs';
import { makeProjectV3 } from '../mods/lib/work-folder.mjs';
import { loadGolden } from './contract-fixtures.mjs';

const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

test('the fixture stamp matches the draft-input Contract header (v1.7)', () => {
  assert.equal(loadGolden('draft-input').version, '1.7');
  assert.match(fs.readFileSync(new URL('./draft-input.mjs', import.meta.url), 'utf8').split('\n')[1], /draft-input\.md v1\.7\)/);
});

const IO = { fs, path, platform: process.platform };
const NOW = new Date();
const DAY = 24 * 3600 * 1000;

function put(root, rel, body) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function age(dir, ms) {
  const when = new Date(NOW.getTime() - ms);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) age(p, ms);
    else fs.utimesSync(p, when, when);
  }
}

// An active v3 project (recent files) and an inactive one (every file older than 12 h).
function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-line-')));
  made.push(root);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  const live = makeProjectV3(IO, root, NOW, 'Login page', 'to-spec');
  const old = makeProjectV3(IO, root, NOW, 'Old page', 'to-spec');
  age(path.join(root, '.company', 'work', old.id), 2 * DAY);
  return { root, A: live.id, runA: live.name, B: old.id };
}

const run = (root, ...args) => main(args, { root, now: NOW });
const arg = (root, f, text, topic) => {
  put(root, `.company/draft-input-arg-${f}.txt`, text);
  if (topic !== undefined) put(root, `.company/work-folder-topic-${f}.txt`, topic);
  return run(root, 'arg', '--for', f);
};
const tops = (root) => fs.readdirSync(path.join(root, '.company', 'work')).sort();
const exists = (root, rel) => fs.existsSync(path.join(root, ...rel.split('/')));
const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p, base) : [`${path.relative(base, p)}:${fs.readFileSync(p, 'base64')}`];
}).sort();

describe('arg with a joined project line', () => {
  for (const f of ['grill', 'to-spec']) {
    test(`${f} idea makes a v3 run of the project, no new top-level entry`, () => {
      const { root, A } = fixture();
      const before = tops(root);
      const r = arg(root, f, `Build a login page\nproject: ${A}`, 'Some Topic');
      assert.equal(r.code, 0);
      assert.deepEqual(r.lines, ['arg: idea', `slug: ${A}/02-${f}`, `project: ${A}`]);
      assert.deepEqual(tops(root), before);
      assert.ok(exists(root, `.company/work/${A}/02-${f}/00-summary.md`));
      assert.ok(!exists(root, `.company/draft-input-arg-${f}.txt`), 'argument file gone');
      assert.ok(!exists(root, `.company/work-folder-topic-${f}.txt`), 'Topic file gone');
    });
  }

  test('fix bug text keeps arg: idea and prints the project', () => {
    const { root, A } = fixture();
    assert.deepEqual(arg(root, 'fix', `Login fails on an empty password\nproject: ${A}`).lines, ['arg: idea', `project: ${A}`]);
    assert.deepEqual(arg(root, 'feature', `Add a logout button\nproject: ${A}`).lines, ['arg: idea', `project: ${A}`]);
  });

  test('draft, build-plan and spec file paths print arg: file and the project', () => {
    const { root, A, runA } = fixture();
    const cases = [
      ['feature', `.company/work/${runA}/spec.md`],
      ['feature', `.company/work/${runA}/grill.md`],
      ['fix', `.company/work/${runA}/plan.md`],
      ['to-tickets', `.company/work/${runA}/spec.md`],
      ['to-spec', `.company/work/${runA}/grill.md`],
      ['to-spec', `.company/work/${runA}/prompt.md`],
      ['to-spec', 'notes/idea.md'],
    ];
    for (const [f, p] of cases) {
      assert.deepEqual(arg(root, f, `${p}\nproject: ${A}`).lines, [`arg: file ${p}`, `project: ${A}`], `${f} ${p}`);
    }
  });

  test('grill resume prints only the resume line', () => {
    const { root, A, runA } = fixture();
    const slug = `${A}/01-grill`;
    assert.deepEqual(arg(root, 'grill', `resume ${slug}\nproject: ${A}`).lines, [`arg: resume ${slug}`]);
    assert.deepEqual(arg(root, 'grill', `.company/work/${slug}/grill.md\nproject: ${A}`).lines, [`arg: resume ${slug}`]);
    assert.ok(runA);
  });

  test('CRLF line ends are accepted', () => {
    const { root, A } = fixture();
    const r = arg(root, 'fix', `Login fails\r\nproject: ${A}\r\n`);
    assert.deepEqual(r.lines, ['arg: idea', `project: ${A}`]);
  });
});

describe('arg with a project line that does not join', () => {
  const bad = (f) => [f.B, 'P20261109.000099', 'P20261399.000001', '../x', 'notanid'];

  test('inactive, unknown or malformed IDs are cut; output equals the body alone', () => {
    const f = fixture();
    for (const word of ['fix', 'feature']) {
      const plain = arg(f.root, word, 'Login fails on an empty password');
      for (const id of bad(f)) assert.deepEqual(arg(f.root, word, `Login fails on an empty password\nproject: ${id}`), plain, `${word} ${id}`);
    }
    const p = `.company/work/${f.runA}/spec.md`;
    const plain = arg(f.root, 'to-tickets', p);
    for (const id of bad(f)) assert.deepEqual(arg(f.root, 'to-tickets', `${p}\nproject: ${id}`), plain, id);
  });

  test('a grill idea with a bad ID makes the same new project as without the line', () => {
    for (const mk of [(f) => f.B, () => 'P20261109.000099', () => '../x']) {
      const a = fixture();
      const b = fixture();
      const without = arg(a.root, 'grill', 'Build a login page', 'Some Topic');
      const withLine = arg(b.root, 'grill', `Build a login page\nproject: ${mk(b)}`, 'Some Topic');
      assert.deepEqual(withLine, without);
      assert.match(without.lines[1], /^slug: P\d{8}\.\d{6}-\d\d\.\d\d\.\d\d$/);
      assert.equal(tops(b.root).length, tops(a.root).length);
      assert.ok(!exists(b.root, '.company/work-folder-topic-grill.txt'));
    }
  });
});

describe('arg refusals stay refusals', () => {
  const WORD = 'refused: argument has a line break or control character';

  test('two body lines, the line not last, two project lines', () => {
    const { root, A } = fixture();
    assert.deepEqual(arg(root, 'fix', `one\ntwo\nproject: ${A}`), { code: 3, lines: [WORD] });
    assert.deepEqual(arg(root, 'fix', `project: ${A}\nbody`), { code: 3, lines: [WORD] });
    assert.deepEqual(arg(root, 'fix', `body\nproject: ${A}\nproject: ${A}`), { code: 3, lines: [WORD] });
    assert.ok(!exists(root, '.company/draft-input-arg-fix.txt'), 'argument file removed');
  });

  test('a line that is not exactly project: <printable> is not cut', () => {
    const { root, A } = fixture();
    assert.equal(arg(root, 'fix', `body\nproject:  ${A}`).code, 3);
    assert.equal(arg(root, 'fix', `body\nproject: ${A} x`).code, 3);
    assert.equal(arg(root, 'fix', `body\nProject: ${A}`).code, 3);
    assert.equal(arg(root, 'fix', `body\nproject: ${'a'.repeat(65)}`).code, 3);
  });

  test('a body that is empty or a to-tickets idea is still refused', () => {
    const { root, A } = fixture();
    assert.deepEqual(arg(root, 'fix', `\nproject: ${A}`), { code: 3, lines: ['refused: no argument'] });
    assert.deepEqual(arg(root, 'to-tickets', `build a thing\nproject: ${A}`), { code: 3, lines: ['refused: needs a file'] });
  });

  test('a control character in the body is refused', () => {
    const { root, A } = fixture();
    assert.deepEqual(arg(root, 'fix', `bo\u0007dy\nproject: ${A}`), { code: 3, lines: [WORD] });
  });
});

describe('take --project', () => {
  const NOTE = 'Login notes\n\nAC1: accept an email\n';

  test('a file outside .company/work and a prompt file make the next run of the project', () => {
    const { root, A } = fixture();
    put(root, 'notes.md', NOTE);
    put(root, `.company/work/${A}/01-to-spec/prompt.md`, 'Write a spec for login');
    put(root, '.company/work-folder-topic-to-spec.txt', 'Ignored Topic');
    const r = run(root, 'take', 'notes.md', '--project', A, '--for', 'to-spec');
    assert.equal(r.code, 0);
    assert.equal(r.lines[0], `slug: ${A}/02-to-spec`);
    assert.equal(r.lines[1], `input: .company/work/${A}/02-to-spec/input-to-spec.md`);
    assert.equal(r.lines.at(-1), `project: ${A}`);
    assert.ok(exists(root, `.company/work/${A}/02-to-spec/input-to-spec.md`));
    assert.ok(!exists(root, '.company/work-folder-topic-to-spec.txt'), 'Topic consumed');
    assert.equal(tops(root).length, 2);
    const p = run(root, 'take', `.company/work/${A}/01-to-spec/prompt.md`, '--project', A, '--for', 'to-spec');
    assert.equal(p.lines[0], `slug: ${A}/03-to-spec`);
    assert.equal(p.lines.at(-1), `project: ${A}`);
  });

  test('a bad, inactive or unknown ID is refused and nothing is written', () => {
    const f = fixture();
    put(f.root, 'notes.md', NOTE);
    put(f.root, '.company/work-folder-topic-to-spec.txt', 'Topic');
    const before = walk(path.join(f.root, '.company', 'work'));
    for (const id of [f.B, 'P20261109.000099', 'P20261399.000001', '../x']) {
      const r = run(f.root, 'take', 'notes.md', '--project', id, '--for', 'to-spec');
      assert.deepEqual(r, { code: 3, lines: ['refused: bad project'] }, id);
      assert.deepEqual(walk(path.join(f.root, '.company', 'work')), before);
      put(f.root, '.company/work-folder-topic-to-spec.txt', 'Topic');
    }
    run(f.root, 'take', 'notes.md', '--project', f.B, '--for', 'to-spec');
    assert.ok(!exists(f.root, '.company/work-folder-topic-to-spec.txt'), 'Topic dropped');
  });

  test('a work-folder source keeps its own rule', () => {
    const mk = () => {
      const f = fixture();
      put(f.root, `.company/work/${f.runA}/grill.md`, '---\nformat: 1\n---\n## Log\n');
      return f;
    };
    const a = mk();
    const b = mk();
    const without = run(a.root, 'take', `.company/work/${a.runA}/grill.md`, '--for', 'to-spec');
    const withFlag = run(b.root, 'take', `.company/work/${b.runA}/grill.md`, '--project', b.A, '--for', 'to-spec');
    assert.equal(without.code, 0);
    assert.deepEqual(withFlag.lines.slice(0, -1), without.lines);
    assert.equal(withFlag.lines.at(-1), `project: ${b.A}`);
    assert.deepEqual(tops(b.root), tops(a.root));
  });

  test('the flag shape: only <path> --project <id> before --for', () => {
    const { root, A } = fixture();
    put(root, 'notes.md', NOTE);
    for (const args of [
      ['take', 'notes.md', '--project', '--for', 'to-spec'],
      ['take', '--project', A, 'notes.md', '--for', 'to-spec'],
      ['take', 'notes.md', 'x', A, '--for', 'to-spec'],
      ['take', 'notes.md', '--project', A, A, '--for', 'to-spec'],
    ]) assert.deepEqual(run(root, ...args), { code: 3, lines: ['refused: usage'] }, args.join(' '));
  });

  test('without the flag the output is the v1.6 shape (no project line)', () => {
    const { root } = fixture();
    put(root, 'notes.md', NOTE);
    const r = run(root, 'take', 'notes.md', '--for', 'to-spec');
    assert.equal(r.code, 0);
    assert.ok(!r.lines.some((l) => l.startsWith('project:')));
  });
});
