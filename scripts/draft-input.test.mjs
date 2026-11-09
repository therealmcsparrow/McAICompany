import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main } from './draft-input.mjs';

const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function fixture(files = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-input-')));
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

const STAMP = '2026-10-31 09.15';
const PNAME = 'P20261031.000001-09.15.00'; // first project of the day, run at 09:15:00 (draft-input v1.5)
// draft-input v1.5: a fresh run is made by makeProject, which needs .company/work to exist (work-folder-name step 2).
const withWork = (root) => {
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  return root;
};
const run = (root, ...args) => main(args, { root, now: new Date(2026, 9, 31, 9, 15) });
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

const BRIEF = '# Idea\nWhat we want.\n\n- AC1: it does the thing\n- AC2: it fails safe\n';
const NO_CRITERIA = '# Idea\nA description with no criteria at all.\n';

describe('take --for to-tickets', () => {
  test('input without criteria names what is missing', () => {
    const root = fixture({ 'docs/idea.md': NO_CRITERIA });
    const before = tree(root);
    const r = run(root, 'take', 'docs/idea.md', '--for', 'to-tickets');
    assert.equal(r.code, 4);
    assert.deepEqual(r.lines, ['missing: a spec (## Problem, ## Solution) or a brief (AC<n>: lines)']);
    assert.deepEqual(tree(root), before);
  });

  test('a brief is copied and counted', () => {
    const root = withWork(fixture({ 'docs/idea.md': BRIEF }));
    const r = run(root, 'take', 'docs/idea.md', '--for', 'to-tickets');
    assert.equal(r.code, 0);
    const name = PNAME;
    assert.deepEqual(r.lines, [`slug: ${name}`, `input: .company/work/${name}/input-to-tickets.md`, 'kind: brief', 'brief: 2 criteria']);
    assert.equal(fs.readFileSync(path.join(root, '.company', 'work', name, 'input-to-tickets.md'), 'utf8'), BRIEF);
  });
});

const refused = (r, reason, code = 3) => {
  assert.equal(r.code, code);
  assert.deepEqual(r.lines, [`refused: ${reason}`]);
};

describe('read rule (hostile files)', () => {
  const take = (root, rel, f = 'to-spec') => run(root, 'take', rel, '--for', f);

  test('a missing file is refused and nothing is written', () => {
    const root = fixture();
    refused(take(root, 'docs/none.md'), 'missing');
    assert.deepEqual(tree(root), []);
  });

  test('a folder is not a regular file', () => {
    const root = fixture({ 'docs/dir.md/x.txt': 'x' });
    refused(take(root, 'docs/dir.md'), 'not a regular file');
  });

  test('a junction on the path is refused as link and writes nothing', () => {
    const root = fixture({ 'real/idea.md': BRIEF });
    fs.symlinkSync(path.join(root, 'real'), path.join(root, 'linked'), 'junction');
    const before = tree(root);
    refused(take(root, 'linked/idea.md'), 'link');
    assert.deepEqual(tree(root), before);
  });

  test('a file symlink is refused as link', (t) => {
    const root = fixture({ 'idea.md': BRIEF });
    try {
      fs.symlinkSync(path.join(root, 'idea.md'), path.join(root, 'alias.md'), 'file');
    } catch {
      t.skip('file symlinks need a privilege on this host');
      return;
    }
    refused(take(root, 'alias.md'), 'link');
  });

  test('a hard link is refused', () => {
    const root = fixture({ 'idea.md': BRIEF });
    fs.linkSync(path.join(root, 'idea.md'), path.join(root, 'twin.md'));
    refused(take(root, 'twin.md'), 'hard-linked');
    assert.ok(!fs.existsSync(path.join(root, '.company')));
  });

  test('a file outside the product root is refused', () => {
    const root = fixture();
    const other = fixture({ 'idea.md': BRIEF });
    refused(take(root, path.join(other, 'idea.md').split(path.sep).join('/')), 'path absolute');
    refused(take(root, '../idea.md'), 'path dot segment');
  });

  test('256 KiB is read, one byte more is too large', () => {
    const edge = `${BRIEF}${'a'.repeat(256 * 1024 - BRIEF.length)}`;
    const root = withWork(fixture({ 'ok.md': edge, 'big.md': `${edge}a` }));
    assert.equal(take(root, 'ok.md').code, 0);
    refused(take(root, 'big.md'), 'too large');
  });

  test('an upper-case PROMPT.md is refused as wrong letter case on every host', () => {
    const rel = '.company/work/2026-10-31 09.15 - Reprompt/prompt.md';
    const root = fixture({ [rel]: `${BRIEF}${'a'.repeat(16385 - BRIEF.length)}` });
    const before = tree(root);
    refused(take(root, rel.replace('prompt.md', 'PROMPT.md')), 'wrong letter case');
    assert.deepEqual(tree(root), before, 'nothing written');
  });

  test('bad UTF-8 and a NUL byte are not UTF-8', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'bad.md'), Buffer.from([0x41, 0xc3, 0x28]));
    fs.writeFileSync(path.join(root, 'zero.md'), Buffer.from('AC1: a\0b'));
    refused(take(root, 'bad.md'), 'not UTF-8');
    refused(take(root, 'zero.md'), 'not UTF-8');
    assert.ok(!fs.existsSync(path.join(root, '.company')));
  });
});

describe('arguments', () => {
  test('control characters, bidi marks and over-long arguments are refused before any command', () => {
    const root = fixture({ 'idea.md': BRIEF });
    for (const bad of ['idea.md\n', 'idea‮.md', 'a b', 'x'.repeat(4097)]) {
      refused(run(root, 'take', bad, '--for', 'grill'), 'argument is not accepted');
    }
  });

  test('--for takes exactly one known word', () => {
    const root = fixture({ 'idea.md': BRIEF });
    refused(run(root, 'take', 'idea.md'), 'usage');
    refused(run(root, 'take', 'idea.md', '--for', 'other'), 'usage');
    refused(run(root, 'take', 'idea.md', '--for', 'grill', '--for', 'grill'), 'usage');
    refused(run(root, 'frob'), 'usage');
    refused(run(root), 'usage');
  });
});

const HEADS = ['## Problem', '## Solution', '## User stories', '## Decisions', '## Testing decisions', '## Out of scope'];
function spec({ skip = [], blank = [], extra = '' } = {}) {
  const parts = ['---', 'slug: demo', 'version: pending', 'shipped: pending', '---', ''];
  for (const h of HEADS) {
    if (skip.includes(h)) continue;
    parts.push(h, blank.includes(h) ? '' : 'Plain words about the result.', '');
  }
  return parts.join('\n') + extra;
}

describe('kind and summary line', () => {
  const takeFor = (files, f = 'to-spec', rel = 'in.md') => {
    const root = withWork(fixture(files));
    return { root, r: run(root, 'take', rel, '--for', f) };
  };

  test('a clean spec is kind spec and ready', () => {
    const { r } = takeFor({ 'in.md': spec() });
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines.slice(2), ['kind: spec', 'spec: ready']);
  });

  test('a spec with a code block is not ready and counts errors', () => {
    const { r } = takeFor({ 'in.md': spec({ extra: '\n```\ncode\n```\n' }) });
    assert.equal(r.code, 0);
    assert.match(r.lines[3], /^spec: not ready, [1-9]\d* errors$/);
  });

  test('a spec over 64 KiB is not ready without running the check', () => {
    const { r } = takeFor({ 'in.md': spec({ extra: 'x'.repeat(64 * 1024) }) });
    assert.equal(r.lines[3], 'spec: not ready, over 64 KiB');
  });

  test('a spec at exactly 64 KiB still gets the shape check', () => {
    const body = spec();
    const pad = 'x'.repeat(64 * 1024 - Buffer.byteLength(body));
    const { r } = takeFor({ 'in.md': body + pad });
    assert.equal(r.lines[3], 'spec: ready');
  });

  test('frontmatter with other keys is not a spec', () => {
    const { r } = takeFor({ 'in.md': spec().replace('shipped: pending', 'other: pending') });
    assert.equal(r.lines[2], 'kind: text');
  });

  test('a grill file is kind grill with answered and open counts', () => {
    const grill = [
      '---', 'slug: demo', 'started: 2026-10-30 09:15', 'status: open', 'format: 1', '---',
      '## Idea', 'x', '', '## Open branches', '- B-2 — Which store', '', '## Closed branches',
      '- B-1 — Scope — closed by Q-1', '', '## Log', '### Q-1 — B-1',
      '- Question: Q?', '- Options: A (recommended: small) | B', '- Answer: A', '- Decision: A.',
      '- Opens: B-2', '- Closes: B-1', '', '## Proposals', '',
    ].join('\n');
    const { r } = takeFor({ 'in.md': grill });
    assert.deepEqual(r.lines.slice(2), ['kind: grill', 'grill: 1 answered, 1 open']);
  });

  test('a plan is kind plan with its task count', () => {
    const plan = '# Plan\n\n## Tasks\n\n### T1 first\n- role: x\n\n### T2 second\n- role: y\n';
    const { r } = takeFor({ 'in.md': plan });
    assert.deepEqual(r.lines.slice(2), ['kind: plan', 'plan: 2 tasks']);
  });

  test('a ## Tasks heading without a task heading is text', () => {
    const { r } = takeFor({ 'in.md': '## Tasks\n\nnothing\n' });
    assert.deepEqual(r.lines.slice(2), ['kind: text', 'text: 3 lines']);
  });

  test('AC lines in bullet, bold and plain forms count; AC without a colon does not', () => {
    const body = 'AC1: a\n- AC2: b\n* **AC3**: c\n  - AC4: d\n- AC5 no colon\nAC1234: x\n';
    const { r } = takeFor({ 'in.md': body });
    assert.deepEqual(r.lines.slice(2), ['kind: brief', 'brief: 4 criteria']);
  });

  test('CRLF input still classifies, and the copy keeps the original bytes', () => {
    const body = '# T\r\nAC1: a\r\n';
    const { root, r } = takeFor({ 'in.md': body });
    assert.equal(r.lines[2], 'kind: brief');
    assert.equal(fs.readFileSync(path.join(root, '.company', 'work', PNAME, 'input-to-spec.md'), 'utf8'), body);
  });

  test('a very long line of one repeated class is classified in linear time', () => {
    const t0 = Date.now();
    const { r } = takeFor({ 'in.md': `${'*'.repeat(200000)}AC1\n` }, 'grill');
    assert.equal(r.code, 0);
    assert.ok(Date.now() - t0 < 2000);
  });
});

describe('take --for to-tickets needs', () => {
  const need = (files) => {
    const root = fixture(files);
    return run(root, 'take', 'in.md', '--for', 'to-tickets');
  };

  test('a ready spec passes', () => {
    const root = withWork(fixture({ 'in.md': spec() }));
    assert.equal(run(root, 'take', 'in.md', '--for', 'to-tickets').code, 0);
  });

  test('an empty Problem and Solution are each named, nothing is written', () => {
    const root = fixture({ 'in.md': spec({ blank: ['## Problem', '## Solution'] }) });
    const r = run(root, 'take', 'in.md', '--for', 'to-tickets');
    assert.equal(r.code, 4);
    assert.deepEqual(r.lines, ['missing: ## Problem', 'missing: ## Solution']);
    assert.ok(!fs.existsSync(path.join(root, '.company')));
  });

  test('a spec without the Solution heading names it', () => {
    const r = need({ 'in.md': spec({ skip: ['## Solution'] }) });
    assert.deepEqual(r.lines, ['missing: ## Solution']);
  });

  test('a grill file or a plain text is not enough', () => {
    assert.equal(need({ 'in.md': 'just words\n' }).code, 4);
  });
});

const slugOf = (r) => r.lines.find((l) => l.startsWith('slug: '));

describe('free', () => {
  const free = (root, slug, f = 'to-spec') => run(root, 'free', slug, '--for', f);

  test('an unused slug is returned and nothing is written', () => {
    const root = fixture();
    assert.deepEqual(free(root, 'demo'), { code: 0, lines: ['slug: demo'] });
    assert.deepEqual(tree(root), []);
  });

  test('a bad slug is refused', () => {
    const root = fixture();
    for (const bad of ['Demo', '-demo', 'a'.repeat(65), 'a b', '']) refused(free(root, bad), 'bad slug');
  });

  test('a folder holding only drafts stays free for another output', () => {
    const root = fixture({ '.company/work/demo/grill.md': 'g', '.company/work/demo/input-grill.md': 'g' });
    assert.equal(slugOf(free(root, 'demo', 'to-spec')), 'slug: demo');
    assert.equal(slugOf(free(root, 'demo', 'to-tickets')), 'slug: demo');
  });

  test('the output file or the same input copy makes it not free', () => {
    const root = fixture({ '.company/work/demo/grill.md': 'g', '.company/work/other/input-to-spec.md': 'x' });
    assert.equal(slugOf(free(root, 'demo', 'grill')), 'slug: demo-2');
    assert.equal(slugOf(free(root, 'other', 'to-spec')), 'slug: other-2');
    assert.equal(slugOf(free(root, 'other', 'to-tickets')), 'slug: other');
  });

  test('any other entry makes it not free: handoff, summary, architect plan, subfolder', () => {
    for (const entry of ['01-product-manager.md', '00-summary.md', '03-architect-plan.md', 'sub/x.md', 'notes.md']) {
      const root = fixture({ [`.company/work/demo/${entry}`]: 'x' });
      assert.equal(slugOf(free(root, 'demo')), 'slug: demo-2', entry);
    }
  });

  test('feature takes only a folder that did not exist', () => {
    const root = fixture({ '.company/work/demo/grill.md': 'g' });
    assert.equal(slugOf(free(root, 'demo', 'feature')), 'slug: demo-2');
    assert.equal(slugOf(free(root, 'fresh', 'feature')), 'slug: fresh');
  });

  test('a junction or a file in place of the folder is not free', () => {
    const root = fixture({ 'elsewhere/x.txt': 'x', '.company/work/file': 'plain' });
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, '.company/work/linked'), 'junction');
    assert.equal(slugOf(free(root, 'linked')), 'slug: linked-2');
    assert.equal(slugOf(free(root, 'file')), 'slug: file-2');
  });

  test('a 64-character slug is cut to 62 before the suffix, and -9 is the last', () => {
    const long = 'a'.repeat(64);
    const cut = 'a'.repeat(62);
    const used = (n) => `.company/work/${cut}-${n}/01-x.md`;
    const files = { [`.company/work/${long}/01-x.md`]: 'x' };
    for (let n = 2; n <= 8; n++) files[used(n)] = 'x';
    const root = fixture(files);
    const r = free(root, long);
    assert.equal(slugOf(r), `slug: ${cut}-9`);
    assert.equal(slugOf(r).length - 'slug: '.length, 64);
    put(root, used(9), 'x');
    refused(free(root, long), 'no free slug');
  });

  test('a trailing dash left by the cut is removed', () => {
    const slug = `${'a'.repeat(61)}-bc`;
    const root = fixture({ [`.company/work/${slug}/01-x.md`]: 'x' });
    assert.equal(slugOf(free(root, slug)), `slug: ${'a'.repeat(61)}-2`);
  });
});

describe('take slug and folders', () => {
  const take = (root, rel, f) => run(root, 'take', rel, '--for', f);

  test('a file outside the work folder gets the fallback name of its --for word, whatever its own name', () => {
    const root = withWork(fixture({ 'docs/My.Big_Idea.for.the.new.thing.md': BRIEF, [`docs/${'b'.repeat(64)}.md`]: BRIEF }));
    const first = slugOf(take(root, 'docs/My.Big_Idea.for.the.new.thing.md', 'grill'));
    assert.equal(first, `slug: ${PNAME}`);
    assert.equal(fs.readFileSync(path.join(root, '.company', 'work', PNAME, '00-summary.md'), 'utf8').split('\n')[0], 'Grill');
    assert.equal(slugOf(take(root, `docs/${'b'.repeat(64)}.md`, 'grill')), 'slug: P20261031.000002-09.15.00');
  });

  test('a grill.md or spec.md file uses its folder, other files give a Draft helper', () => {
    const root = fixture({
      '.company/work/alpha/grill.md': BRIEF,
      '.company/work/beta/spec.md': BRIEF,
      '.company/work/gamma/01-product-manager.md': BRIEF,
    });
    assert.equal(slugOf(take(root, '.company/work/alpha/grill.md', 'to-spec')), 'slug: alpha');
    assert.equal(slugOf(take(root, '.company/work/beta/spec.md', 'to-tickets')), 'slug: beta');
    assert.equal(slugOf(take(root, '.company/work/gamma/01-product-manager.md', 'grill')), `slug: ${STAMP} - Gamma Draft`);
  });

  test('a shipped spec in docs/specs gets a new primary name, nothing lands in a run folder', () => {
    const root = fixture({ 'docs/specs/run.md': spec(), '.company/work/run/01-product-manager.md': 'x' });
    const r = take(root, 'docs/specs/run.md', 'to-spec');
    assert.equal(slugOf(r), `slug: ${PNAME}`);
    assert.deepEqual(fs.readdirSync(path.join(root, '.company/work/run')), ['01-product-manager.md']);
    assert.ok(fs.existsSync(path.join(root, '.company', 'work', PNAME, 'input-to-spec.md')));
  });

  test('a client run spec in a run folder with a summary and an architect plan gets <run>-2', () => {
    const root = fixture({
      '.company/work/run/spec.md': spec(),
      '.company/work/run/00-summary.md': 's',
      '.company/work/run/05-architect-plan.md': 'p',
    });
    const r = take(root, '.company/work/run/spec.md', 'to-tickets');
    assert.equal(slugOf(r), 'slug: run-2');
    assert.deepEqual(fs.readdirSync(path.join(root, '.company/work/run')).sort(), ['00-summary.md', '05-architect-plan.md', 'spec.md']);
  });

  test('a draft folder holding only drafts and no output stays the target', () => {
    const root = fixture({ '.company/work/run/grill.md': BRIEF });
    const r = take(root, '.company/work/run/grill.md', 'to-spec');
    assert.equal(slugOf(r), 'slug: run');
    assert.ok(fs.existsSync(path.join(root, '.company/work/run/input-to-spec.md')));
  });

  test('take for feature never uses the draft folder and refuses non-draft paths', () => {
    const root = fixture({ '.company/work/run/spec.md': spec(), 'docs/idea.md': BRIEF, '.company/work/run/01-x.md': 'x' });
    assert.equal(slugOf(take(root, '.company/work/run/spec.md', 'feature')), `slug: ${STAMP} - Run Draft`);
    refused(take(root, 'docs/idea.md', 'feature'), 'not a draft file');
    refused(take(root, '.company/work/run/01-x.md', 'feature'), 'not a draft file');
    assert.equal(slugOf(take(root, '.company/work/run/spec.md', 'feature')), `slug: ${STAMP} - Run Draft 2`);
  });

  test('a junction in place of .company is refused and nothing lands behind it', () => {
    const root = fixture({ 'docs/idea.md': BRIEF, 'elsewhere/x.txt': 'x' });
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, '.company'), 'junction');
    assert.equal(take(root, 'docs/idea.md', 'grill').code, 3);
    assert.deepEqual(fs.readdirSync(path.join(root, 'elsewhere')), ['x.txt']);
  });

  test('a junction as .company/work is refused too', () => {
    const root = fixture({ 'docs/idea.md': BRIEF, 'elsewhere/x.txt': 'x', '.company/keep.txt': 'k' });
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, '.company/work'), 'junction');
    assert.equal(take(root, 'docs/idea.md', 'grill').code, 3);
    assert.deepEqual(fs.readdirSync(path.join(root, 'elsewhere')), ['x.txt']);
  });
});

describe('arg', () => {
  const argFile = (root, f, text) => put(root, `.company/draft-input-arg-${f}.txt`, text);
  const arg = (root, f, text) => {
    if (text !== undefined) argFile(root, f, text);
    return run(root, 'arg', '--for', f);
  };
  const argPath = (root, f) => path.join(root, '.company', `draft-input-arg-${f}.txt`);

  test('no argument file is refused', () => {
    refused(arg(fixture(), 'grill'), 'no argument file');
  });

  test('empty and blank arguments are refused', () => {
    for (const text of ['', '\n', '   \n', '  ']) {
      const root = fixture();
      refused(arg(root, 'grill', text), 'no argument');
    }
  });

  test('the file is removed after every outcome, so it is never read twice', () => {
    for (const text of ['an idea here', '', 'docs/idea.md', '../x.md', 'a\tb']) {
      const root = fixture();
      arg(root, 'to-spec', text);
      assert.ok(!fs.existsSync(argPath(root, 'to-spec')), JSON.stringify(text));
      refused(run(root, 'arg', '--for', 'to-spec'), 'no argument file');
    }
  });

  test('a hard-linked argument file is refused, its entry is removed, the other name stays', () => {
    const root = fixture();
    const twin = path.join(root, 'twin.txt');
    argFile(root, 'grill', 'an idea');
    fs.linkSync(argPath(root, 'grill'), twin);
    refused(run(root, 'arg', '--for', 'grill'), 'hard-linked');
    assert.ok(!fs.existsSync(argPath(root, 'grill')));
    assert.equal(fs.readFileSync(twin, 'utf8'), 'an idea');
  });

  test('a file symlink at the argument path is removed, never its target', (t) => {
    const root = fixture({ 'target.txt': 'keep me' });
    fs.mkdirSync(path.join(root, '.company'), { recursive: true });
    try {
      fs.symlinkSync(path.join(root, 'target.txt'), argPath(root, 'grill'), 'file');
    } catch {
      t.skip('file symlinks need a privilege on this host');
      return;
    }
    refused(run(root, 'arg', '--for', 'grill'), 'link');
    assert.ok(!fs.existsSync(argPath(root, 'grill')));
    assert.equal(fs.readFileSync(path.join(root, 'target.txt'), 'utf8'), 'keep me');
  });

  test('a junction in place of .company is refused and the target keeps its file', () => {
    const root = fixture({ 'elsewhere/draft-input-arg-grill.txt': 'an idea' });
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, '.company'), 'junction');
    assert.equal(run(root, 'arg', '--for', 'grill').code, 3);
    assert.ok(fs.existsSync(path.join(root, 'elsewhere/draft-input-arg-grill.txt')));
  });

  test('each --for reads only its own file', () => {
    const root = fixture();
    argFile(root, 'to-spec', 'an idea');
    refused(run(root, 'arg', '--for', 'grill'), 'no argument file');
    assert.ok(fs.existsSync(argPath(root, 'to-spec')));
  });

  test('control characters, bidi marks, a second LF and over 4096 bytes are refused', () => {
    for (const text of ['a\tb', 'a\rb', 'a\u202eb', 'a\u2028b', 'one\n\n', 'one\ntwo']) {
      const root = fixture();
      refused(arg(root, 'grill', text), 'argument has a line break or control character');
    }
    for (const text of ['x'.repeat(4097), '\u00e9'.repeat(2049)]) {
      const root = fixture();
      refused(arg(root, 'grill', text), 'argument too large');
    }
  });

  test('typed text over 4096 bytes is refused as argument too large', () => {
    for (const text of ['x'.repeat(4097), `${'x'.repeat(4096)}\n`]) {
      const root = fixture();
      refused(arg(root, 'grill', text), 'argument too large');
      assert.ok(!fs.existsSync(argPath(root, 'grill')));
    }
  });

  test('typed text with a line break or control character is refused by its own message', () => {
    for (const text of ['one\ntwo', 'a\rb', 'a\tb', 'a\u0085b', 'a\u200fb', 'a\u2028b', 'a\u2029b']) {
      const root = fixture();
      refused(arg(root, 'grill', text), 'argument has a line break or control character');
      assert.ok(!fs.existsSync(argPath(root, 'grill')), JSON.stringify(text));
    }
  });

  test('text over the limit with a line break gets the size message', () => {
    const root = fixture();
    refused(arg(root, 'grill', `${'x'.repeat(4100)}\nsecond`), 'argument too large');
  });

  test('a NUL byte in the argument file is not UTF-8', () => {
    refused(arg(fixture(), 'grill', 'a\u0000b'), 'not UTF-8');
  });

  test('exactly 4096 bytes and one final LF are accepted', () => {
    const root = fixture();
    assert.equal(arg(root, 'feature', `${'x'.repeat(4095)}\n`).code, 0);
  });

  test('bad UTF-8 in the argument file is refused', () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, '.company'));
    fs.writeFileSync(argPath(root, 'grill'), Buffer.from([0x61, 0xc3, 0x28]));
    refused(run(root, 'arg', '--for', 'grill'), 'not UTF-8');
  });

  test('hostile idea text never reaches the output: quote, $(, backtick, semicolon, space, absolute path', () => {
    const cases = ['say "hello" now', 'run $(whoami) please', 'use `ls` here', 'a; b', 'two words', 'x"y', '$(id)', 'a`b'];
    for (const text of cases) {
      const root = withWork(fixture());
      const r = arg(root, 'to-spec', text);
      assert.equal(r.code, 0, text);
      assert.equal(r.lines[0], 'arg: idea');
      assert.equal(r.lines[1], `slug: ${PNAME}`);
      assert.equal(r.lines.length, 2);
    }
    for (const text of ['/etc/passwd.md', 'C:\\Users\\x\\idea.md', '/abs/dir/']) {
      const root = fixture();
      const r = arg(root, 'to-spec', text);
      refused(r, 'path absolute');
    }
  });

  test('a path with a quote, dollar or semicolon is refused as a path, never echoed', () => {
    for (const text of ['a"b.md', 'a$(x).md', 'a;b.md', 'a`b`.md']) {
      const root = fixture();
      refused(arg(root, 'to-tickets', text), 'path bad character');
    }
  });

  test('a one-token file argument becomes arg: file with slashes normalised', () => {
    const cases = [['docs/idea.md', 'docs/idea.md'], ['docs\\idea.md', 'docs/idea.md'], ['notes.txt', 'notes.txt'], ['idea.md', 'idea.md']];
    for (const [text, want] of cases) {
      assert.deepEqual(arg(fixture(), 'to-tickets', text), { code: 0, lines: [`arg: file ${want}`] }, text);
    }
  });

  test('path rule failures name the rule word', () => {
    const cases = [['../x.md', 'dot segment'], ['docs/.git/x.md', 'git'], ['docs/.env', 'env'], ['docs/con.md', 'device name'], ['docs/*.md', 'glob']];
    for (const [text, why] of cases) refused(arg(fixture(), 'grill', text), `path ${why}`);
  });

  test('resume forms: a slug or the canonical grill path, only for grill', () => {
    assert.deepEqual(arg(fixture(), 'grill', 'resume my-idea'), { code: 0, lines: ['arg: resume my-idea'] });
    assert.deepEqual(arg(fixture(), 'grill', '.company/work/my-idea/grill.md'), { code: 0, lines: ['arg: resume my-idea'] });
    assert.deepEqual(arg(fixture(), 'grill', '.company\\work\\my-idea\\grill.md'), { code: 0, lines: ['arg: resume my-idea'] });
    assert.deepEqual(arg(fixture(), 'grill', 'resume my-idea\n'), { code: 0, lines: ['arg: resume my-idea'] });
    assert.deepEqual(arg(fixture(), 'to-spec', '.company/work/my-idea/grill.md'), { code: 0, lines: ['arg: file .company/work/my-idea/grill.md'] });
    assert.deepEqual(arg(withWork(fixture()), 'to-spec', 'resume my-idea'), { code: 0, lines: ['arg: idea', `slug: ${PNAME}`] });
  });

  test('resume with an invalid slug is an idea; a non-canonical grill path is a file', () => {
    assert.deepEqual(arg(withWork(fixture()), 'grill', 'resume Bad_Slug'), { code: 0, lines: ['arg: idea', `slug: ${PNAME}`] });
    assert.deepEqual(arg(fixture(), 'grill', 'docs/grill.md'), { code: 0, lines: ['arg: file docs/grill.md'] });
  });

  test('without a file: to-tickets needs one, feature has no slug, grill and to-spec pick a free slug', () => {
    refused(arg(fixture(), 'to-tickets', 'make it faster'), 'needs a file');
    assert.deepEqual(arg(fixture(), 'feature', 'make it faster'), { code: 0, lines: ['arg: idea'] });
    assert.deepEqual(arg(withWork(fixture()), 'grill', 'make it faster'), { code: 0, lines: ['arg: idea', `slug: ${PNAME}`] });
    // A v1.1 folder of the same stamp is not a project: it does not take the ID (draft-input v1.5).
    const root = fixture({ [`.company/work/${STAMP} - To-Spec/01-product-manager.md`]: 'x' });
    assert.deepEqual(arg(root, 'to-spec', 'make it faster'), { code: 0, lines: ['arg: idea', `slug: ${PNAME}`] });
    assert.deepEqual(arg(root, 'to-spec', 'make it faster again'), { code: 0, lines: ['arg: idea', 'slug: P20261031.000002-09.15.00'] });
  });

  test('the idea text never builds the name', () => {
    const slug = (text) => arg(withWork(fixture()), 'grill', text).lines[1];
    for (const text of ['One TWO three four five six seven', '!!! ???', '\u65e5\u672c\u8a9e \u30c6\u30b9\u30c8', 'a'.repeat(70)]) {
      assert.equal(slug(text), `slug: ${PNAME}`);
    }
  });

  test('usage: --for is required, one word, nothing else', () => {
    const root = fixture();
    refused(run(root, 'arg'), 'usage');
    refused(run(root, 'arg', '--for', 'other'), 'usage');
    refused(run(root, 'arg', 'extra', '--for', 'grill'), 'usage');
  });
});

describe('command line', () => {
  test('prints the lines and sets the exit code, with the product root as cwd', () => {
    const root = fixture({ 'idea.md': NO_CRITERIA });
    const script = fileURLToPath(new URL('./draft-input.mjs', import.meta.url));
    const r = spawnSync(process.execPath, [script, 'take', 'idea.md', '--for', 'to-tickets'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 4);
    assert.equal(r.stdout, 'missing: a spec (## Problem, ## Solution) or a brief (AC<n>: lines)\n');
    assert.ok(!fs.existsSync(path.join(root, '.company')));
  });
});

describe('--for fix (a flow build plan)', () => {
  const PLAN = '# Build plan\n\n## Tasks\n\n### T1 First ticket\nfiles: a.mjs\n';
  const BUILD = '.company/work/flow-build/plan.md';
  const ARG = '.company/draft-input-arg-fix.txt';
  const argFix = (root, text) => {
    put(root, ARG, text);
    return run(root, 'arg', '--for', 'fix');
  };

  test('arg --for fix names a path token as a file and anything else as the bug report', () => {
    const root = fixture();
    assert.deepEqual(argFix(root, `${BUILD}\n`).lines, [`arg: file ${BUILD}`]);
    assert.deepEqual(argFix(root, 'The login button crashes').lines, ['arg: idea']);
    assert.ok(!fs.existsSync(path.join(root, ARG)));
  });

  test('take --for fix copies only the exact build plan path and Roles read the copy', () => {
    const root = fixture({ [BUILD]: PLAN });
    const r = run(root, 'take', BUILD, '--for', 'fix');
    assert.equal(r.code, 0);
    assert.equal(r.lines[0], `slug: ${STAMP} - Flow Draft`);
    assert.equal(r.lines[1], `input: .company/work/${STAMP} - Flow Draft/input-fix.md`);
    assert.equal(fs.readFileSync(path.join(root, '.company', 'work', `${STAMP} - Flow Draft`, 'input-fix.md'), 'utf8'), PLAN);
    assert.equal(run(root, 'take', BUILD, '--for', 'fix').lines[0], `slug: ${STAMP} - Flow Draft 2`);
  });

  test('take --for fix refuses every other path', () => {
    const root = fixture({
      [BUILD]: PLAN, '.company/work/flow/plan.md': PLAN, '.company/work/flow-build/grill.md': PLAN,
      '.company/work/flow-build/sub/plan.md': PLAN, 'docs/plan.md': PLAN, '.company/work/Flow-build/plan.md': PLAN
    });
    const before = tree(root);
    for (const p of ['.company/work/flow/plan.md', '.company/work/flow-build/grill.md', '.company/work/flow-build/sub/plan.md', 'docs/plan.md']) {
      refused(run(root, 'take', p, '--for', 'fix'), 'not a build plan');
    }
    refused(run(root, 'take', '.company/work/Flow-build/plan.md', '--for', 'fix'), 'path bad character');
    assert.deepEqual(tree(root), before);
  });

  test('take --for fix refuses a link, a hard link and an outside file like every read', () => {
    const root = fixture({ [BUILD]: PLAN });
    const outside = fixture({ 'secret.md': PLAN });
    const dir = path.join(root, '.company/work/other-build');
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.symlinkSync(path.join(outside, 'secret.md'), path.join(dir, 'plan.md'));
      const r = run(root, 'take', '.company/work/other-build/plan.md', '--for', 'fix');
      assert.equal(r.code, 3);
    } catch (error) {
      if (!error || (error.code !== 'EPERM' && error.code !== 'EACCES')) throw error;
    }
    fs.linkSync(path.join(root, BUILD), path.join(root, '.company/work/third-build-plan.md'));
    refused(run(root, 'take', BUILD, '--for', 'fix'), 'hard-linked');
  });

  test('--for fix is valid for arg, take and free only; stale still takes none', () => {
    const root = fixture();
    assert.deepEqual(run(root, 'free', 'x', '--for', 'fix').lines, ['slug: x']);
    refused(run(root, 'stale', BUILD, '--for', 'fix'), 'usage');
  });
});
