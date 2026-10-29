import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main } from './spec-check.mjs';

const SCRIPT = fileURLToPath(new URL('./spec-check.mjs', import.meta.url));
const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

const HEADINGS = ['## Problem', '## Solution', '## User stories', '## Decisions', '## Testing decisions', '## Out of scope'];

function spec({ version = 'pending', shipped = 'pending', slug = 'demo', extra = {}, order = HEADINGS } = {}) {
  const parts = [`---\nslug: ${slug}\nversion: ${version}\nshipped: ${shipped}\n---`];
  for (const h of order) parts.push(`${h}\n${extra[h] ?? 'Plain words about the result.'}\n`);
  return `${parts.join('\n')}`;
}

function fixture(body = spec(), rel = 'docs/specs/demo.md') {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'spec-check-')));
  made.push(root);
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (body !== null) fs.writeFileSync(file, body);
  return { root, file, rel };
}

const errorsOf = (r) => r.lines.filter((l) => l.startsWith('ERROR'));

describe('check: clean and shape', () => {
  test('a clean spec passes', () => {
    const fx = fixture();
    const r = main(['check', fx.rel], { root: fx.root });
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, ['spec-check: 0 errors']);
  });

  test('a clean spec in a run folder passes, by absolute path too', () => {
    const fx = fixture(spec(), '.company/work/demo/spec.md');
    assert.equal(main(['check', fx.rel], { root: fx.root }).code, 0);
    assert.equal(main(['check', fx.file], { root: fx.root }).code, 0);
  });

  test('a missing heading is an ERROR', () => {
    const fx = fixture(spec({ order: HEADINGS.filter((h) => h !== '## Decisions') }));
    const r = main(['check', fx.rel], { root: fx.root });
    assert.equal(r.code, 2);
    assert.ok(errorsOf(r).some((l) => l.endsWith('missing heading ## Decisions')), r.lines.join('\n'));
  });

  test('a reordered heading is an ERROR', () => {
    const order = [HEADINGS[1], HEADINGS[0], ...HEADINGS.slice(2)];
    const fx = fixture(spec({ order }));
    const r = main(['check', fx.rel], { root: fx.root });
    assert.equal(r.code, 2);
    assert.ok(errorsOf(r).some((l) => l.includes('heading out of order ## Problem') || l.includes('heading out of order ## Solution')));
  });

  test('frontmatter must be exactly slug, version, shipped', () => {
    for (const body of [
      spec().replace('shipped: pending\n', ''),
      spec().replace('version: pending', 'version: soon'),
      spec().replace('shipped: pending', 'shipped: 2026-13-45'),
      spec().replace('slug: demo\n', 'slug: demo\nowner: me\n'),
      spec().replace('---\n', ''),
    ]) {
      const fx = fixture(body);
      const r = main(['check', fx.rel], { root: fx.root });
      assert.equal(r.code, 2, body);
      assert.ok(errorsOf(r).some((l) => l.endsWith('bad frontmatter')), r.lines.join('\n'));
    }
  });

  test('stamped values are accepted', () => {
    const fx = fixture(spec({ version: '1.2.3', shipped: '2026-10-29' }));
    assert.equal(main(['check', fx.rel], { root: fx.root }).code, 0);
  });
});

describe('check: code and paths', () => {
  const withText = (text) => fixture(spec({ extra: { '## Solution': text } }));

  for (const fence of ['```', '~~~', '````js', '   ```']) {
    test(`a fence opener ${JSON.stringify(fence)} is an ERROR`, () => {
      const fx = withText(`${fence}\ncode\n${fence.trim()}`);
      const r = main(['check', fx.rel], { root: fx.root });
      assert.equal(r.code, 2);
      assert.ok(errorsOf(r).some((l) => l.endsWith('code block')));
    });
  }

  test('four spaces before a fence is not an opener', () => {
    const fx = withText('    ```');
    assert.ok(!errorsOf(main(['check', fx.rel], { root: fx.root })).some((l) => l.endsWith('code block')));
  });

  for (const bad of ['scripts/x.mjs', 'check.mjs', './run', 'C:\\x', '`scripts/x.mjs`', '(see src\\a\\b.ts)', '../up', '~/notes', '/etc/hosts', 'dir/README.md.', '**check.mjs**', 'x.JSON', 'a/b.py,']) {
    test(`a file path ${JSON.stringify(bad)} is an ERROR`, () => {
      const fx = withText(`It uses ${bad} today.`);
      const r = main(['check', fx.rel], { root: fx.root });
      assert.equal(r.code, 2, r.lines.join('\n'));
      assert.ok(errorsOf(r).some((l) => l.endsWith('file path in spec')), r.lines.join('\n'));
    });
  }

  for (const ok of ['https://example.com/a.md', 'v1.2', 'and/or', 'TCP/IP', '8.5', 'input / output', 'see https://example.com/dir/file.json?x=1.', 'e.g. a thing', '1/2', 'http://x.test/a.py and v2.0']) {
    test(`plain text ${JSON.stringify(ok)} is not an ERROR`, () => {
      const fx = withText(`It says ${ok} here.`);
      const r = main(['check', fx.rel], { root: fx.root });
      assert.equal(r.code, 0, r.lines.join('\n'));
    });
  }

  test('the ERROR names the line', () => {
    const fx = withText('one\ntwo scripts/x.mjs');
    const r = main(['check', fx.rel], { root: fx.root });
    const lineNo = fs.readFileSync(fx.file, 'utf8').split('\n').findIndex((l) => l.includes('scripts/x.mjs')) + 1;
    assert.ok(r.lines.includes(`ERROR line ${lineNo}: file path in spec`), r.lines.join('\n'));
  });

  test('output holds no spec text', () => {
    const fx = withText('secret-token scripts/leak-me.mjs');
    assert.ok(!main(['check', fx.rel], { root: fx.root }).lines.join('\n').includes('leak-me'));
  });
});

describe('check: hostile input', () => {
  test('a 64 KiB line of separators and dots stays fast', () => {
    const lines = [
      '/'.repeat(60000),
      'a/'.repeat(30000),
      'a.'.repeat(30000),
      '://'.repeat(20000),
      `${'a'.repeat(30000)}://`,
      '.'.repeat(60000) + 'x',
      '`'.repeat(60000),
    ];
    for (const text of lines) {
      const fx = fixture(spec({ extra: { '## Solution': text } }));
      const t0 = process.hrtime.bigint();
      main(['check', fx.rel], { root: fx.root });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      assert.ok(ms < 1500, `${ms} ms`);
    }
  });

  test('a file over 64 KiB is refused before parsing', () => {
    const fx = fixture(spec({ extra: { '## Solution': 'a '.repeat(33000) } }));
    const r = main(['check', fx.rel], { root: fx.root });
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: /);
  });

  test('a file that is not UTF-8 is refused', () => {
    const fx = fixture(null);
    fs.writeFileSync(fx.file, Buffer.from([0xff, 0xfe, 0x00, 0x41]));
    assert.equal(main(['check', fx.rel], { root: fx.root }).code, 3);
  });

  test('a path outside docs/specs and the run folder spec is refused', () => {
    for (const rel of ['README.md', 'docs/other/demo.md', 'docs/specs/sub/demo.md', 'docs/specs/Demo.md', '.company/work/demo/notes.md', '.company/work/demo/spec.md.bak', 'docs/specs/demo.txt', '../x/docs/specs/demo.md']) {
      const fx = fixture(spec(), rel.startsWith('..') ? 'docs/specs/demo.md' : rel);
      const r = main(['check', rel], { root: fx.root });
      assert.equal(r.code, 3, rel);
      assert.match(r.lines[0], /^refused: /);
    }
  });

  test('a path with a control character or over 4096 characters is refused', () => {
    const fx = fixture();
    assert.equal(main(['check', 'docs/specs/demo.md\n'], { root: fx.root }).code, 3);
    assert.equal(main(['check', `docs/specs/${'a'.repeat(5000)}.md`], { root: fx.root }).code, 3);
  });

  test('a missing file and a bad command are refused', () => {
    const fx = fixture(null);
    assert.equal(main(['check', 'docs/specs/none.md'], { root: fx.root }).code, 3);
    assert.equal(main([], { root: fx.root }).code, 3);
    assert.equal(main(['frob', 'docs/specs/demo.md'], { root: fx.root }).code, 3);
    assert.equal(main(['check'], { root: fx.root }).code, 3);
  });

  test('check writes nothing', () => {
    const fx = fixture();
    const before = fs.readdirSync(fx.root, { recursive: true }).sort();
    const body = fs.readFileSync(fx.file, 'utf8');
    main(['check', fx.rel], { root: fx.root });
    assert.deepEqual(fs.readdirSync(fx.root, { recursive: true }).sort(), before);
    assert.equal(fs.readFileSync(fx.file, 'utf8'), body);
  });
});

// Link tests: both commands must refuse, and the target must stay unchanged.
describe('links and hard links are refused by check and stamp', () => {
  const STAMP = (rel) => ['stamp', rel, '--version', '1.2.3', '--date', '2026-10-29'];

  test('a spec folder reached through a junction', () => {
    const fx = fixture(null);
    const outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'spec-out-')));
    made.push(outside);
    fs.writeFileSync(path.join(outside, 'demo.md'), spec());
    fs.rmSync(path.join(fx.root, 'docs', 'specs'), { recursive: true });
    fs.symlinkSync(outside, path.join(fx.root, 'docs', 'specs'), 'junction');
    assert.equal(main(['check', fx.rel], { root: fx.root }).code, 3);
    assert.equal(main(STAMP(fx.rel), { root: fx.root }).code, 3);
    assert.equal(fs.readFileSync(path.join(outside, 'demo.md'), 'utf8'), spec());
    assert.deepEqual(fs.readdirSync(outside), ['demo.md']);
  });

  test('the docs folder is a junction', () => {
    const fx = fixture(null);
    const outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'spec-out-')));
    made.push(outside);
    fs.mkdirSync(path.join(outside, 'specs'));
    fs.writeFileSync(path.join(outside, 'specs', 'demo.md'), spec());
    fs.rmSync(path.join(fx.root, 'docs'), { recursive: true });
    fs.symlinkSync(outside, path.join(fx.root, 'docs'), 'junction');
    assert.equal(main(['check', fx.rel], { root: fx.root }).code, 3);
    assert.equal(main(STAMP(fx.rel), { root: fx.root }).code, 3);
    assert.equal(fs.readFileSync(path.join(outside, 'specs', 'demo.md'), 'utf8'), spec());
  });

  test('the run folder is a junction', () => {
    const fx = fixture(null, '.company/work/other/x');
    const outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'spec-out-')));
    made.push(outside);
    fs.writeFileSync(path.join(outside, 'spec.md'), spec());
    fs.symlinkSync(outside, path.join(fx.root, '.company', 'work', 'demo'), 'junction');
    const rel = '.company/work/demo/spec.md';
    assert.equal(main(['check', rel], { root: fx.root }).code, 3);
    assert.equal(main(STAMP(rel), { root: fx.root }).code, 3);
    assert.equal(fs.readFileSync(path.join(outside, 'spec.md'), 'utf8'), spec());
  });

  test('a hard-linked spec', () => {
    const fx = fixture();
    const twin = path.join(fx.root, 'twin.md');
    fs.linkSync(fx.file, twin);
    assert.equal(main(['check', fx.rel], { root: fx.root }).code, 3);
    assert.equal(main(STAMP(fx.rel), { root: fx.root }).code, 3);
    assert.equal(fs.readFileSync(fx.file, 'utf8'), spec());
    assert.equal(fs.readFileSync(twin, 'utf8'), spec());
    assert.deepEqual(fs.readdirSync(path.dirname(fx.file)), ['demo.md']);
  });

  test('a file symlink as the spec', (t) => {
    const fx = fixture(null);
    const target = path.join(fx.root, 'real.md');
    fs.writeFileSync(target, spec());
    try {
      fs.symlinkSync(target, fx.file, 'file');
    } catch {
      t.skip('symlink needs a privilege here');
      return;
    }
    assert.equal(main(['check', fx.rel], { root: fx.root }).code, 3);
    assert.equal(main(STAMP(fx.rel), { root: fx.root }).code, 3);
    assert.equal(fs.readFileSync(target, 'utf8'), spec());
  });

  test('a spec folder that is itself a file or a spec that is a folder', () => {
    const fx = fixture(null);
    fs.mkdirSync(fx.file, { recursive: true });
    assert.equal(main(['check', fx.rel], { root: fx.root }).code, 3);
    assert.equal(main(STAMP(fx.rel), { root: fx.root }).code, 3);
  });

  test('an absolute path outside the root is refused', () => {
    const fx = fixture();
    const other = fixture();
    assert.equal(main(['check', other.file], { root: fx.root }).code, 3);
  });
});

describe('stamp', () => {
  const STAMP = (rel, v = '1.2.3', d = '2026-10-29') => ['stamp', rel, '--version', v, '--date', d];

  test('fills both pending values once and refuses a second time', () => {
    const fx = fixture();
    const r = main(STAMP(fx.rel), { root: fx.root });
    assert.equal(r.code, 0, r.lines.join('\n'));
    const text = fs.readFileSync(fx.file, 'utf8');
    assert.ok(text.includes('version: 1.2.3\n') && text.includes('shipped: 2026-10-29\n'));
    assert.equal(text, spec({ version: '1.2.3', shipped: '2026-10-29' }));
    assert.equal(main(['check', fx.rel], { root: fx.root }).code, 0);
    const again = main(STAMP(fx.rel, '9.9.9', '2027-01-01'), { root: fx.root });
    assert.equal(again.code, 3);
    assert.match(again.lines[0], /^refused: /);
    assert.equal(fs.readFileSync(fx.file, 'utf8'), text);
  });

  test('refuses when only one value is pending', () => {
    for (const body of [spec({ version: '1.0.0' }), spec({ shipped: '2026-01-01' })]) {
      const fx = fixture(body);
      assert.equal(main(STAMP(fx.rel), { root: fx.root }).code, 3);
      assert.equal(fs.readFileSync(fx.file, 'utf8'), body);
    }
  });

  test('stamps a run folder spec', () => {
    const fx = fixture(spec(), '.company/work/demo/spec.md');
    assert.equal(main(STAMP(fx.rel), { root: fx.root }).code, 0);
    assert.ok(fs.readFileSync(fx.file, 'utf8').includes('version: 1.2.3'));
  });

  test('bad versions, dates and flags are refused and change nothing', () => {
    const fx = fixture();
    const body = fs.readFileSync(fx.file, 'utf8');
    const bad = [
      STAMP(fx.rel, '1.2', '2026-10-29'),
      STAMP(fx.rel, 'v1.2.3', '2026-10-29'),
      STAMP(fx.rel, '1.2.3\n', '2026-10-29'),
      STAMP(fx.rel, '1.2.3', '2026-02-30'),
      STAMP(fx.rel, '1.2.3', '2026-2-3'),
      STAMP(fx.rel, 'pending', '2026-10-29'),
      STAMP(fx.rel, '1.2.3', 'pending'),
      ['stamp', fx.rel, '--version', '1.2.3'],
      ['stamp', fx.rel, '--date', '2026-10-29', '--version'],
      ['stamp', fx.rel, '--version', '1.2.3', '--date', '2026-10-29', '--force'],
      ['stamp', fx.rel, '--version', '1.2.3', '--version', '1.2.4', '--date', '2026-10-29'],
      ['stamp', '--version', '1.2.3', '--date', '2026-10-29'],
    ];
    for (const a of bad) {
      const r = main(a, { root: fx.root });
      assert.equal(r.code, 3, a.join(' '));
    }
    assert.equal(fs.readFileSync(fx.file, 'utf8'), body);
    assert.deepEqual(fs.readdirSync(path.dirname(fx.file)), ['demo.md']);
  });

  test('refuses a spec with a bad frontmatter or outside the allowed paths', () => {
    const fx = fixture(spec().replace('slug: demo\n', ''));
    assert.equal(main(STAMP(fx.rel), { root: fx.root }).code, 3);
    const fx2 = fixture(spec(), 'docs/other/demo.md');
    assert.equal(main(STAMP('docs/other/demo.md'), { root: fx2.root }).code, 3);
  });

  test('leaves no temp file and keeps the body bytes besides the two values', () => {
    const body = spec({ extra: { '## Solution': 'Line one.\n\nLine two with trailing space. ' } });
    const fx = fixture(body);
    assert.equal(main(STAMP(fx.rel), { root: fx.root }).code, 0);
    assert.deepEqual(fs.readdirSync(path.dirname(fx.file)), ['demo.md']);
    assert.equal(fs.readFileSync(fx.file, 'utf8'), body.replace('version: pending', 'version: 1.2.3').replace('shipped: pending', 'shipped: 2026-10-29'));
  });

  test('stamp text outside the frontmatter is never changed', () => {
    const body = spec({ extra: { '## Decisions': 'We say version: pending in prose.' } });
    const fx = fixture(body);
    main(STAMP(fx.rel), { root: fx.root });
    assert.ok(fs.readFileSync(fx.file, 'utf8').includes('We say version: pending in prose.'));
  });
});

describe('command line', () => {
  test('check exits 0, 2 and 3', () => {
    const fx = fixture();
    const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: fx.root, encoding: 'utf8' });
    assert.equal(run('check', fx.rel).status, 0);
    fs.writeFileSync(fx.file, spec({ extra: { '## Solution': 'scripts/x.mjs' } }));
    const bad = run('check', fx.rel);
    assert.equal(bad.status, 2);
    assert.match(bad.stdout, /ERROR line \d+: file path in spec/);
    assert.equal(run('check', 'README.md').status, 3);
  });
});
