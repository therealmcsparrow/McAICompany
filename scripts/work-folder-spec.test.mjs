import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './spec-check.mjs';

const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

const NEW = '2026-10-31 09.15 - Spec Folders';
const NEW2 = '2026-10-31 09.15 - Spec Folders 2';
const DRAFT = '2026-10-31 09.15 - Spec Folders Draft';
const BUILD = '2026-10-31 09.15 - Spec Folders Build';
const LEGACY = 'spec-folders';

const spec = (slug, version = 'pending', shipped = 'pending') =>
  [
    '---',
    `slug: ${slug}`,
    `version: ${version}`,
    `shipped: ${shipped}`,
    '---',
    '## Problem',
    'A plain problem.',
    '## Solution',
    'A plain solution.',
    '## User stories',
    '- As a user I read it.',
    '## Decisions',
    '- One decision.',
    '## Testing decisions',
    '- One test.',
    '## Out of scope',
    '- Nothing.',
    '',
  ].join('\n');

function fixture(files = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-spec-')));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

const check = (root, arg) => main(['check', arg], { root });
const OK = { code: 0, lines: ['spec-check: 0 errors'] };

describe('check on new and legacy names', () => {
  test('a draft under .company/work accepts new primary, number and Draft helper names', () => {
    const files = {};
    for (const n of [NEW, NEW2, DRAFT, BUILD, LEGACY]) files[`.company/work/${n}/spec.md`] = spec(n);
    const root = fixture(files);
    for (const n of [NEW, NEW2, DRAFT, BUILD, LEGACY]) assert.deepEqual(check(root, `.company/work/${n}/spec.md`), OK, n);
  });

  test('a shipped spec under docs/specs holds spaces in its file name', () => {
    const files = {};
    for (const n of [NEW, NEW2, LEGACY]) files[`docs/specs/${n}.md`] = spec(n, '1.2.3', '2026-10-31');
    const root = fixture(files);
    for (const n of [NEW, NEW2, LEGACY]) assert.deepEqual(check(root, `docs/specs/${n}.md`), OK, n);
  });

  test('an absolute path and a backslash path resolve to the same spec', () => {
    const root = fixture({ [`docs/specs/${NEW}.md`]: spec(NEW) });
    assert.deepEqual(check(root, path.join(root, 'docs', 'specs', `${NEW}.md`)), OK);
    assert.deepEqual(check(root, `docs\\specs\\${NEW}.md`), OK);
  });

  test('the frontmatter slug takes a new name or a legacy slug and nothing else', () => {
    const root = fixture({
      [`docs/specs/${NEW}.md`]: spec(LEGACY),
      '.company/work/other/spec.md': spec(DRAFT),
    });
    assert.equal(check(root, `docs/specs/${NEW}.md`).code, 0);
    assert.equal(check(root, '.company/work/other/spec.md').code, 0);
    for (const bad of ['Spec Folders', '2026-10-31 09.15 - spec folders', '2026-10-31 09.15 - Spec Folders Build 2', `${NEW} `, 'a/b', '..', '']) {
      const r = fixture({ '.company/work/x/spec.md': spec(bad) });
      const res = check(r, '.company/work/x/spec.md');
      assert.equal(res.code, 2, JSON.stringify(bad));
      assert.match(res.lines[0], /^ERROR line 1: bad frontmatter$/);
    }
  });
});

describe('refused names', () => {
  const BAD = [
    '2026-10-31 09.15 - Spec Folders Build 2',
    '2026-10-31 09.15 - spec folders',
    '2026-10-31 09.15 - Spec Folders ',
    '2026-10-31 09.15 - Spec Folders.',
    '2026-10-31 9.15 - Spec Folders',
    '2026-13-31 09.15 - Spec Folders',
    '2026-10-31 24.15 - Spec Folders',
    '2026-10-31 09.15 - Spec Folders Draft 1',
    '2026-10-31 09.15 - Spec Folders Draft 10',
    '2026-10-31 09.15 - Spec  Folders',
    '2026-10-31 09.15 - Spec_Folders',
    '2026-10-31 09.15 - Spec Folders‮',
    '2026-10-31 09.15 - $(whoami)',
    "2026-10-31 09.15 - Spec'Folders",
    'Spec Folders',
    'Spec-Folders',
    '-spec',
    '..',
    '.',
    '',
  ];

  test('a refused name in either place is refused before any file is read', () => {
    const root = fixture({ '.company/work/x/spec.md': spec(NEW), 'docs/specs/x.md': spec(NEW) });
    for (const n of BAD) {
      for (const rel of [`.company/work/${n}/spec.md`, `docs/specs/${n}.md`]) {
        const res = check(root, rel);
        assert.equal(res.code, 3, JSON.stringify(rel));
        assert.match(res.lines[0], /^refused: /);
        assert.ok(n.length < 4 || !res.lines[0].includes(n), 'output holds no argument text');
      }
    }
  });

  test('a name with a path piece, a wrong prefix or a wrong file name is refused', () => {
    const root = fixture({ [`.company/work/${NEW}/spec.md`]: spec(NEW), [`.company/work/${NEW}/plan.md`]: spec(NEW) });
    for (const rel of [
      `.company/work/${NEW}/sub/spec.md`,
      `.company/work/${NEW}/plan.md`,
      `.company/work/../docs/specs/${NEW}.md`,
      `docs/specs/${NEW}/spec.md`,
      `docs/specs/../${NEW}.md`,
      `.Company/Work/${NEW}/spec.md`,
      `.company/work/spec.md`,
      `docs/specs/.md`,
      `docs/spec/${NEW}.md`,
      `.company/work/${NEW}/spec.md.bak`,
    ]) {
      assert.equal(check(root, rel).code, 3, rel);
    }
  });

  test('a control character or a very long name is refused', () => {
    const root = fixture({});
    assert.equal(check(root, `.company/work/${NEW}\n/spec.md`).code, 3);
    assert.equal(check(root, `docs/specs/${'A'.repeat(5000)}.md`).code, 3);
    assert.equal(check(root, `docs/specs/2026-10-31 09.15 - ${'Abcdefgh '.repeat(20)}.md`).code, 3);
  });

  test('stamp refuses a refused name too', () => {
    const root = fixture({});
    const res = main(['stamp', '.company/work/2026-10-31 09.15 - Spec Folders Build 2/spec.md', '--version', '1.0.0', '--date', '2026-10-31'], { root });
    assert.equal(res.code, 3);
  });
});

describe('links and real paths', () => {
  test('a spec folder that is a junction or link is refused', () => {
    const root = fixture({ [`elsewhere/spec.md`]: spec(NEW) });
    fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
    try {
      fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, '.company', 'work', NEW), 'junction');
    } catch {
      return;
    }
    const res = check(root, `.company/work/${NEW}/spec.md`);
    assert.equal(res.code, 3);
  });

  test('a docs/specs folder that is a junction pointing outside the root is refused', () => {
    const outside = fixture({ [`${NEW}.md`]: spec(NEW) });
    const root = fixture({});
    try {
      fs.symlinkSync(outside, path.join(root, 'docs'), 'junction');
    } catch {
      return;
    }
    fs.mkdirSync(path.join(outside, 'specs'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'specs', `${NEW}.md`), spec(NEW));
    assert.equal(check(root, `docs/specs/${NEW}.md`).code, 3);
  });

  test('a hard-linked spec is refused', () => {
    const root = fixture({ [`docs/specs/${NEW}.md`]: spec(NEW) });
    const other = path.join(root, 'docs', 'specs', 'link.md');
    fs.linkSync(path.join(root, 'docs', 'specs', `${NEW}.md`), other);
    assert.equal(check(root, `docs/specs/${NEW}.md`).code, 3);
  });
});

describe('stamp on new names', () => {
  test('stamps a draft under a new name once and keeps every other byte', () => {
    const body = spec(NEW);
    const root = fixture({ [`.company/work/${NEW}/spec.md`]: body });
    const rel = `.company/work/${NEW}/spec.md`;
    const res = main(['stamp', rel, '--version', '1.0.0', '--date', '2026-10-31'], { root });
    assert.deepEqual(res, { code: 0, lines: [`stamped ${rel} 1.0.0 2026-10-31`] });
    const after = fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
    assert.equal(after, body.replace('version: pending', 'version: 1.0.0').replace('shipped: pending', 'shipped: 2026-10-31'));
    assert.equal(main(['stamp', rel, '--version', '1.0.1', '--date', '2026-10-31'], { root }).code, 3);
    assert.deepEqual(
      fs.readdirSync(path.dirname(path.join(root, ...rel.split('/')))).sort(),
      ['spec.md'],
    );
  });

  test('stamps a spec in docs/specs whose file name holds spaces', () => {
    const root = fixture({ [`docs/specs/${NEW}.md`]: spec(NEW) });
    const rel = `docs/specs/${NEW}.md`;
    assert.equal(main(['stamp', rel, '--version', '2.0.0', '--date', '2026-10-31'], { root }).code, 0);
    assert.deepEqual(check(root, rel), OK);
  });
});
