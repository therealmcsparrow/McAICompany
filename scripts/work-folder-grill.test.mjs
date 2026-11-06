import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main, parseGrill } from './grill.mjs';

const SCRIPT = fileURLToPath(new URL('./grill.mjs', import.meta.url));
const ROOT = path.join(path.dirname(SCRIPT), '..');
const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

const NEW = '2026-10-31 09.15 - Grill Folders';
const NEW2 = '2026-10-31 09.15 - Grill Folders 2';
const DRAFT = '2026-10-31 09.15 - Grill Folders Draft';

const grill = (slug, status = 'open') => [
  '---',
  `slug: ${slug}`,
  'started: 2026-10-31 09:15',
  `status: ${status}`,
  'format: 1',
  '---',
  '## Idea',
  'A plain idea.',
  '',
  '## Open branches',
  '- B-1 — Which store holds it',
  '',
  '## Closed branches',
  '## Log',
  '## Proposals',
  '',
].join('\n');

function fixture(folders = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-grill-')));
  made.push(root);
  for (const [name, body] of Object.entries(folders)) {
    const dir = path.join(root, '.company', 'work', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'grill.md'), body);
  }
  return root;
}

const check = (root, arg) => main(['check', arg], { root });
const status = (root, arg) => main(['status', arg], { root });

describe('grill file in a new-name folder', () => {
  test('check accepts the new primary name, a number and a Draft helper', () => {
    const root = fixture({ [NEW]: grill(NEW), [NEW2]: grill(NEW2), [DRAFT]: grill(DRAFT) });
    for (const n of [NEW, NEW2, DRAFT]) {
      assert.deepEqual(check(root, `.company/work/${n}/grill.md`), { code: 0, lines: ['grill-check: 0 errors'] });
    }
  });

  test('check reads a backslash path and an absolute path', () => {
    const root = fixture({ [NEW]: grill(NEW) });
    assert.equal(check(root, `.company\\work\\${NEW}\\grill.md`).code, 0);
    assert.equal(check(root, path.join(root, '.company', 'work', NEW, 'grill.md')).code, 0);
  });

  test('status prints the counts for a new name', () => {
    const root = fixture({ [NEW]: grill(NEW) });
    assert.deepEqual(status(root, NEW), {
      code: 0,
      lines: ['grill: 0 answered, 1 open', 'open B-1 — Which store holds it', 'status: open'],
    });
  });

  test('frontmatter slug takes the work folder name or a legacy slug', () => {
    assert.deepEqual(parseGrill(grill(NEW)).errors, []);
    assert.deepEqual(parseGrill(grill(DRAFT)).errors, []);
    assert.deepEqual(parseGrill(grill('demo-idea')).errors, []);
  });
});

describe('legacy grill still resumes (AC9)', () => {
  test('check and status on a legacy slug', () => {
    const root = fixture({ 'demo-idea': grill('demo-idea') });
    assert.equal(check(root, '.company/work/demo-idea/grill.md').code, 0);
    assert.equal(status(root, 'demo-idea').code, 0);
  });
});

describe('refused names (AC11, AC12)', () => {
  const bad = [
    '2026-10-31 09.15 - grill folders',
    '2026-10-31 09.15 - Grill  Folders',
    '2026-10-31 09.15 - Grill Folders Build 2',
    '2026-10-31 09.15 - Grill Folders ',
    '2026-10-31 09.15 - Grill Folders.',
    '2026-13-31 09.15 - Grill Folders',
    '2026-10-31 09.15 - Grill $(x)',
    "2026-10-31 09.15 - Grill ' x",
    '2026-10-31 09.15 - Grill ..',
    '..',
    '.',
    'Demo Idea',
    'a/b',
    `${NEW}/../x`,
  ];
  for (const name of bad) {
    test(`status refuses ${JSON.stringify(name)}`, () => {
      const root = fixture();
      assert.deepEqual(status(root, name), { code: 3, lines: ['refused: bad slug'] });
    });
    test(`check refuses ${JSON.stringify(name)}`, () => {
      const root = fixture();
      const r = check(root, `.company/work/${name}/grill.md`);
      assert.equal(r.code, 3);
      assert.equal(r.lines.length, 1);
    });
  }

  test('a wrong-case work prefix and a deeper path are refused', () => {
    const root = fixture({ [NEW]: grill(NEW) });
    assert.equal(check(root, `.Company/work/${NEW}/grill.md`).code, 3);
    assert.equal(check(root, `.company/work/${NEW}/sub/grill.md`).code, 3);
    assert.equal(check(root, `.company/work/${NEW}/GRILL.md`).code, 3);
    assert.equal(check(root, `.company/work/${NEW}/grill.md/`).code, 3);
  });

  test('refusal lines never echo the argument', () => {
    const root = fixture();
    const r = status(root, "x'; rm -rf /");
    assert.deepEqual(r, { code: 3, lines: ['refused: bad slug'] });
  });

  test('a long name is refused fast', () => {
    const root = fixture();
    const name = `${NEW} ${'Aa '.repeat(1300)}`;
    const t = Date.now();
    assert.equal(status(root, name).code, 3);
    assert.ok(Date.now() - t < 1000);
  });

  test('a missing folder with a good name says missing', () => {
    const root = fixture();
    assert.deepEqual(status(root, NEW), { code: 3, lines: ['refused: missing'] });
  });
});

describe('read rule holds for a new name', () => {
  test('a symlinked folder is refused', (t) => {
    const root = fixture({ '2026-10-31 09.15 - Real Folder': grill(NEW) });
    const link = path.join(root, '.company', 'work', NEW);
    try {
      fs.symlinkSync(path.join(root, '.company', 'work', '2026-10-31 09.15 - Real Folder'), link, 'junction');
    } catch {
      t.skip('no link rights');
      return;
    }
    assert.equal(status(root, NEW).code, 3);
  });

  test('a hard-linked grill.md is refused', () => {
    const root = fixture({ [NEW]: grill(NEW) });
    const dir = path.join(root, '.company', 'work', NEW);
    fs.linkSync(path.join(dir, 'grill.md'), path.join(dir, 'other.md'));
    assert.deepEqual(status(root, NEW), { code: 3, lines: ['refused: hard-linked'] });
  });
});

describe('command line', () => {
  test('status runs with a name that holds spaces', () => {
    const root = fixture({ [NEW]: grill(NEW) });
    const r = spawnSync(process.execPath, [SCRIPT, 'status', NEW], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^grill: 0 answered, 1 open\n/);
  });
});

describe('grill Playbook text', () => {
  const FILES = [
    'skills/grill/SKILL.md',
    'skills/grill-me/SKILL.md',
    'skills/grill-with-docs/SKILL.md',
    'skills/grill/references/grill-loop.md',
  ];
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const TOPIC = '.company/work-folder-topic-grill.txt';
  const CLEAR = "work-folder clear --playbook 'grill'";

  test('each file is LF only and each SKILL.md is at most 125 lines', () => {
    for (const f of FILES) {
      const text = read(f);
      assert.ok(!text.includes('\r'), f);
      if (f.endsWith('SKILL.md')) assert.ok(text.split('\n').length - 1 <= 125, f);
    }
  });

  test('the Topic file is written before arg and named by the --for word', () => {
    for (const f of ['skills/grill/SKILL.md', 'skills/grill/references/grill-loop.md']) {
      const text = read(f);
      assert.ok(text.includes(TOPIC), f);
      // the first shell command, not the first mention of it in the sentence that orders the Topic write
      assert.ok(text.indexOf(TOPIC) < text.indexOf('run.mjs" draft-input arg --for grill'), f);
      assert.ok(text.includes(CLEAR), f);
    }
    for (const f of FILES) {
      assert.ok(!/work-folder-topic-(?!grill\.txt)/.test(read(f)), `${f} names another id`);
    }
  });

  test('the three loop Playbooks point at the loop file and the Topic rule', () => {
    for (const f of ['skills/grill/SKILL.md', 'skills/grill-me/SKILL.md', 'skills/grill-with-docs/SKILL.md']) {
      const text = read(f);
      assert.ok(text.includes(TOPIC), f);
      assert.ok(text.includes(CLEAR), f);
      assert.ok(text.includes('grill-loop.md'), f);
    }
  });

  test('the Topic is the Lead summary, never the idea text, never on a shell line', () => {
    for (const f of FILES) {
      const text = read(f);
      assert.ok(/never the idea text/.test(text), f);
      assert.ok(!/--topic none/.test(text.replace(/never use `--topic none`/g, '')), f);
    }
  });

  test('every shell line single-quotes the name and resume takes a name', () => {
    for (const f of FILES) {
      const text = read(f);
      for (const m of text.matchAll(/`(node [^`]+)`/g)) {
        const span = m[1];
        let quoted = false;
        for (let i = 0; i < span.length; i++) {
          if (span[i] === "'") quoted = !quoted;
          else if (!quoted && (span.startsWith('<slug>', i) || span.startsWith('<name>', i))) {
            assert.fail(`${f}: unquoted placeholder in ${span}`);
          }
        }
      }
      assert.ok(/resume <name>/.test(text), f);
      assert.ok(!/resume <slug>/.test(text), f);
    }
  });

  test('argument-hint names resume <name>; no allowed-tools', () => {
    for (const f of FILES.filter((x) => x.endsWith('SKILL.md'))) {
      const text = read(f);
      assert.ok(text.includes('argument-hint: <idea | file> | resume <name>'), f);
      assert.ok(!/^allowed-tools:/m.test(text), f);
    }
  });

  test('the contract is v1.4 in the script and the doc; the Playbooks cite v1.4', () => {
    assert.match(fs.readFileSync(SCRIPT, 'utf8'), /grill-file\.md v1\.4/);
    assert.match(read('docs/contracts/grill-file.md'), /^# Contract: grill-file v1\.4$/m);
    for (const f of FILES.filter((x) => x.endsWith('SKILL.md'))) assert.ok(read(f).includes('`grill-file` v1.4'), f);
  });
});
