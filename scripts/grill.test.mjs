import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main, parseGrill } from './grill.mjs';

const SCRIPT = fileURLToPath(new URL('./grill.mjs', import.meta.url));
const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

const REC = '(recommended: it is the smaller change)';

function qEntry(n, branch, { opens = 'none', closes = `B-${branch}` } = {}) {
  return [
    `### Q-${n} — B-${branch}`,
    `- Question: Which way for part ${n}?`,
    `- Options: First ${REC} | Second`,
    '- Answer: First',
    `- Decision: Take the first way for part ${n}.`,
    `- Opens: ${opens}`,
    `- Closes: ${closes}`,
    '',
  ].join('\n');
}

const DEMO_LOG = [
  qEntry(1, 1, { opens: 'B-4, B-5' }),
  qEntry(2, 2),
  qEntry(3, 3),
].join('\n');

function grillText({
  status = 'open',
  open = [[4, 'Which store holds it'], [5, 'Who may read it']],
  closed = [[1, 'Scope', 'Q-1'], [2, 'Name', 'Q-2'], [3, 'Order', 'Q-3']],
  log = DEMO_LOG,
  fm = `---\nslug: demo\nstarted: 2026-10-30 09:15\nstatus: ${status}\nformat: 1\n---`,
} = {}) {
  return [
    fm,
    '## Idea',
    'A plain idea.',
    '',
    '## Open branches',
    ...open.map(([n, t]) => `- B-${n} — ${t}`),
    '',
    '## Closed branches',
    ...closed.map(([n, t, r]) => `- B-${n} — ${t} — closed by ${r}`),
    '',
    '## Log',
    log,
    '## Proposals',
    '- GLOSSARY: Grill — a decision interview',
    '',
  ].join('\n');
}

function fixture(body = grillText(), slug = 'demo') {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grill-')));
  made.push(root);
  const file = path.join(root, '.company', 'work', slug, 'grill.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (body !== null) fs.writeFileSync(file, body);
  return { root, file, rel: `.company/work/${slug}/grill.md` };
}

const reasons = (text) => parseGrill(text).errors.map((e) => e.reason);

describe('refusals (hostile cases first)', () => {
  test('a junction on the path is refused as link', () => {
    const fx = fixture();
    const elsewhere = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grill-out-')));
    made.push(elsewhere);
    fs.writeFileSync(path.join(elsewhere, 'grill.md'), grillText());
    const linked = path.join(fx.root, '.company', 'work', 'evil');
    fs.symlinkSync(elsewhere, linked, 'junction');
    const r = main(['status', 'evil'], { root: fx.root });
    assert.deepEqual(r, { code: 3, lines: ['refused: link'] });
  });

  test('a link to the file is refused as link', (t) => {
    const fx = fixture();
    const linked = path.join(fx.root, '.company', 'work', 'other');
    fs.mkdirSync(linked);
    try {
      fs.symlinkSync(fx.file, path.join(linked, 'grill.md'), 'file');
    } catch (error) {
      if (error.code === 'EPERM') return t.skip('file links need a privilege here');
      throw error;
    }
    assert.deepEqual(main(['status', 'other'], { root: fx.root }), { code: 3, lines: ['refused: link'] });
  });

  test('a hard link is refused as hard-linked', () => {
    const fx = fixture();
    const dir = path.join(fx.root, '.company', 'work', 'twin');
    fs.mkdirSync(dir);
    fs.linkSync(fx.file, path.join(dir, 'grill.md'));
    assert.deepEqual(main(['status', 'twin'], { root: fx.root }), { code: 3, lines: ['refused: hard-linked'] });
    assert.deepEqual(main(['status', 'demo'], { root: fx.root }), { code: 3, lines: ['refused: hard-linked'] });
  });

  test('an absolute path outside the root is refused', () => {
    const fx = fixture();
    const other = fixture();
    const r = main(['check', other.file], { root: fx.root });
    assert.deepEqual(r, { code: 3, lines: ['refused: outside the product root'] });
  });

  test('an absolute path inside the root is accepted', () => {
    const fx = fixture();
    assert.equal(main(['check', fx.file], { root: fx.root }).code, 0);
  });

  test('a file of 256 KiB + 1 is too large, 256 KiB is read', () => {
    const pad = (n) => grillText().replace('A plain idea.', 'x'.repeat(n));
    const base = Buffer.byteLength(pad(0));
    const fits = fixture(pad(256 * 1024 - base + 'x'.length * 0));
    assert.equal(fs.statSync(fits.file).size, 256 * 1024);
    assert.equal(main(['check', fits.rel], { root: fits.root }).code, 0);
    const big = fixture(pad(256 * 1024 - base + 1));
    assert.equal(fs.statSync(big.file).size, 256 * 1024 + 1);
    assert.deepEqual(main(['check', big.rel], { root: big.root }), { code: 3, lines: ['refused: too large'] });
  });

  test('bytes that are not UTF-8 are refused', () => {
    const fx = fixture(Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe]));
    assert.deepEqual(main(['check', fx.rel], { root: fx.root }), { code: 3, lines: ['refused: not UTF-8'] });
  });

  test('a folder named grill.md, a missing file, a bad slug and a wrong path are refused', () => {
    const fx = fixture(null);
    fs.mkdirSync(path.join(fx.root, '.company', 'work', 'demo', 'grill.md'));
    assert.deepEqual(main(['status', 'demo'], { root: fx.root }), { code: 3, lines: ['refused: not a regular file'] });
    assert.deepEqual(main(['status', 'nope'], { root: fx.root }), { code: 3, lines: ['refused: missing'] });
    assert.deepEqual(main(['status', '../demo'], { root: fx.root }), { code: 3, lines: ['refused: bad slug'] });
    assert.deepEqual(main(['status', 'Demo'], { root: fx.root }), { code: 3, lines: ['refused: bad slug'] });
    assert.deepEqual(main(['check', 'docs/specs/demo.md'], { root: fx.root }), { code: 3, lines: ['refused: not a grill path'] });
    assert.deepEqual(main(['check', '.company/work/demo/../demo/grill.md'], { root: fx.root }), {
      code: 3,
      lines: ['refused: not a grill path'],
    });
  });

  test('arguments with control or format characters, or over 4096 characters, are not accepted', () => {
    const fx = fixture();
    const refused = { code: 3, lines: ['refused: argument is not accepted'] };
    for (const arg of ['demo\n', 'de\u0000mo', 'de‮mo', 'de mo', 'de​mo', 'a'.repeat(4097)]) {
      assert.deepEqual(main(['status', arg], { root: fx.root }), refused);
    }
    assert.deepEqual(main(['check', '.company/work/demo/grill.md\r'], { root: fx.root }), refused);
  });

  test('usage refusals', () => {
    const fx = fixture();
    const usage = { code: 3, lines: ['refused: usage: grill.mjs check <file> | status <slug>'] };
    assert.deepEqual(main([], { root: fx.root }), usage);
    assert.deepEqual(main(['bogus'], { root: fx.root }), usage);
    assert.deepEqual(main(['status'], { root: fx.root }), usage);
    assert.deepEqual(main(['check', 'a', 'b'], { root: fx.root }), usage);
  });

  test('a refusal writes nothing', () => {
    const fx = fixture();
    const before = fs.readdirSync(fx.root, { recursive: true }).sort();
    main(['status', 'nope'], { root: fx.root });
    main(['check', 'docs/x.md'], { root: fx.root });
    assert.deepEqual(fs.readdirSync(fx.root, { recursive: true }).sort(), before);
  });
});

describe('branch text', () => {
  const hostile = {
    CR: 'bad\rtext',
    'U+2028': 'bad text',
    'U+2029': 'bad text',
    'U+202E': 'bad‮text',
    'zero width space (Cf)': 'bad​text',
    tab: 'bad\ttext',
    'NUL': 'bad\u0000text',
    'trailing U+2028': 'bad text ',
    '201 characters': 'x'.repeat(201),
    'only spaces': '   ',
  };
  for (const [name, text] of Object.entries(hostile)) {
    test(`${name} in an open branch is a bad branch line and no open line is printed`, () => {
      const fx = fixture(grillText({ open: [[4, text], [5, 'Fine']] }));
      assert.deepEqual(reasons(grillText({ open: [[4, text], [5, 'Fine']] })), ['bad branch line']);
      const r = main(['status', 'demo'], { root: fx.root });
      assert.equal(r.code, 2);
      assert.deepEqual(r.lines, ['ERROR line 11: bad branch line', 'grill-check: 1 errors']);
      assert.ok(!r.lines.some((l) => l.startsWith('open ') || l.startsWith('status:')));
      const c = main(['check', fx.rel], { root: fx.root });
      assert.equal(c.code, 2);
    });
  }

  test('the same text in a closed branch is a bad branch line', () => {
    const closed = [[1, 'a‮b', 'Q-1'], [2, 'Name', 'Q-2'], [3, 'Order', 'Q-3']];
    assert.deepEqual(reasons(grillText({ closed })), ['bad branch line']);
  });

  test('200 characters and a dash inside the text are fine', () => {
    assert.deepEqual(reasons(grillText({ open: [[4, 'x'.repeat(200)], [5, 'a — b']] })), []);
    assert.deepEqual(reasons(grillText({ open: [[4, '\u{1F600}'.repeat(200)], [5, 'b']] })), []);
  });

  test('the last " — closed by " splits the closed line', () => {
    const closed = [[1, 'about — closed by Q-9 text', 'Q-1'], [2, 'Name', 'Q-2'], [3, 'Order', 'Q-3']];
    assert.deepEqual(reasons(grillText({ closed })), []);
  });
});

describe('status counts answers and open branches', () => {
  test('3 answers and 2 open branches', () => {
    const fx = fixture();
    const r = main(['status', 'demo'], { root: fx.root });
    assert.deepEqual(r, {
      code: 0,
      lines: ['grill: 3 answered, 2 open', 'open B-4 — Which store holds it', 'open B-5 — Who may read it', 'status: open'],
    });
  });

  test('fact entries do not count as answers', () => {
    const fact = ['### F-1 — B-4', '- Fact: It is stored in one folder.', '- Source: scripts/run.mjs:10', '- Closes: B-4', ''].join('\n');
    const text = grillText({ log: `${DEMO_LOG}\n${fact}`, open: [[5, 'Who may read it']], closed: [[1, 'Scope', 'Q-1'], [2, 'Name', 'Q-2'], [3, 'Order', 'Q-3'], [4, 'Store', 'F-1']] });
    const p = parseGrill(text);
    assert.deepEqual(p.errors, []);
    assert.equal(p.answered, 3);
    assert.deepEqual(p.open, [{ id: 'B-5', text: 'Who may read it' }]);
    assert.deepEqual(p.closed, ['B-1', 'B-2', 'B-3', 'B-4']);
  });

  test('a clean file with no open branches', () => {
    const fx = fixture(grillText({ status: 'done', open: [], closed: [[1, 'Scope', 'Q-1'], [2, 'Name', 'Q-2'], [3, 'Order', 'Q-3']], log: [qEntry(1, 1), qEntry(2, 2), qEntry(3, 3)].join('\n') }));
    assert.deepEqual(main(['status', 'demo'], { root: fx.root }).lines, ['grill: 3 answered, 0 open', 'status: done']);
  });

  test('the CLI prints the same through a process, exit 0', () => {
    const fx = fixture();
    const r = spawnSync(process.execPath, [SCRIPT, 'status', 'demo'], { cwd: fx.root, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'grill: 3 answered, 2 open\nopen B-4 — Which store holds it\nopen B-5 — Who may read it\nstatus: open\n');
  });

  test('a shape error through a process exits 2', () => {
    const fx = fixture(grillText({ fm: '---\nslug: demo\n---' }));
    const r = spawnSync(process.execPath, [SCRIPT, 'status', 'demo'], { cwd: fx.root, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /^ERROR line 1: bad frontmatter\n/);
    assert.doesNotMatch(r.stdout, /open B-|status:/);
  });

});

describe('check reasons', () => {
  test('a clean file', () => {
    const fx = fixture();
    assert.deepEqual(main(['check', fx.rel], { root: fx.root }), { code: 0, lines: ['grill-check: 0 errors'] });
    assert.deepEqual(main(['check', fx.rel.replaceAll('/', '\\')], { root: fx.root }), { code: 0, lines: ['grill-check: 0 errors'] });
  });

  test('bad frontmatter variants', () => {
    const variants = [
      '---\nslug: demo\nstarted: 2026-10-30 09:15\nstatus: open\nformat: 2\n---',
      '---\nslug: Demo\nstarted: 2026-10-30 09:15\nstatus: open\nformat: 1\n---',
      '---\nslug: demo\nstarted: 2026-02-30 09:15\nstatus: open\nformat: 1\n---',
      '---\nslug: demo\nstarted: 2026-10-30 24:15\nstatus: open\nformat: 1\n---',
      '---\nslug: demo\nstarted: 2026-10-30 09:15\nstatus: paused\nformat: 1\n---',
      '---\nstarted: 2026-10-30 09:15\nslug: demo\nstatus: open\nformat: 1\n---',
      '---\nslug: demo\nstarted: 2026-10-30 09:15\nstatus: open\nformat: 1\nextra: 1\n---',
    ];
    for (const fm of variants) {
      const p = parseGrill(grillText({ fm }));
      assert.equal(p.errors[0].reason, 'bad frontmatter', fm);
      assert.equal(p.errors[0].line, 1);
      assert.equal(p.status, null);
    }
  });

  test('a missing section is reported on the last line', () => {
    const text = grillText().replace('## Proposals\n- GLOSSARY: Grill — a decision interview\n', '');
    const p = parseGrill(text);
    assert.deepEqual(p.errors.map((e) => e.reason), ['missing section ## Proposals']);
    assert.equal(p.errors[0].line, text.split('\n').length - 1);
  });

  test('sections out of order or repeated', () => {
    const swapped = grillText().replace('## Open branches', '## TMP').replace('## Closed branches', '## Open branches').replace('## TMP', '## Closed branches');
    assert.ok(reasons(swapped).includes('section out of order ## Open branches'));
    const twice = `${grillText()}## Idea\nagain\n`;
    assert.deepEqual(reasons(twice), ['section out of order ## Idea']);
  });

  test('duplicate branch and branch open and closed', () => {
    assert.deepEqual(reasons(grillText({ open: [[4, 'a'], [4, 'b'], [5, 'c']] })), ['duplicate branch B-4']);
    assert.deepEqual(reasons(grillText({ open: [[4, 'a'], [5, 'c']], closed: [[1, 'Scope', 'Q-1'], [1, 'Again', 'Q-1'], [2, 'Name', 'Q-2'], [3, 'Order', 'Q-3']] })), ['duplicate branch B-1']);
    assert.deepEqual(reasons(grillText({ open: [[1, 'a'], [4, 'x'], [5, 'c']] })), ['branch open and closed B-1']);
  });

  test('other lines in the branch sections are bad branch lines', () => {
    assert.deepEqual(reasons(grillText().replace('- B-4 — Which store holds it', 'B-4 Which store')), ['bad branch line', 'unknown branch B-4']);
    assert.deepEqual(reasons(grillText().replace('- B-1 — Scope — closed by Q-1', '- B-1 — Scope')), ['bad branch line']);
    assert.deepEqual(reasons(grillText().replace('closed by Q-1', 'closed by maybe')), ['bad branch line']);
    assert.deepEqual(reasons(grillText().replace('- B-4 —', '- B-04 —')), ['bad branch line', 'unknown branch B-4']);
  });

  test('closed by an entry that is not in the Log is a bad branch line', () => {
    assert.deepEqual(reasons(grillText().replace('closed by Q-3', 'closed by Q-7')), ['bad branch line']);
    assert.deepEqual(reasons(grillText().replace('closed by Q-3', 'closed by stop')), []);
  });

  test('unknown branch in a heading, Opens or Closes', () => {
    assert.deepEqual(reasons(grillText({ log: DEMO_LOG.replace('### Q-2 — B-2', '### Q-2 — B-9') })), ['unknown branch B-9']);
    assert.deepEqual(reasons(grillText({ log: DEMO_LOG.replace('Opens: B-4, B-5', 'Opens: B-4, B-8') })), ['unknown branch B-8']);
    assert.deepEqual(reasons(grillText({ log: DEMO_LOG.replace('Closes: B-3', 'Closes: B-6') })), ['unknown branch B-6']);
  });

  test('entry out of sequence', () => {
    assert.deepEqual(reasons(grillText({ log: DEMO_LOG.replace('### Q-2 — B-2', '### Q-3 — B-2') })), ['bad branch line', 'entry out of sequence Q-3']);
    assert.deepEqual(reasons(grillText({ log: DEMO_LOG.replace('### Q-1 — B-1', '### Q-2 — B-1') })), ['bad branch line', 'entry out of sequence Q-2']);
  });

  test('options count', () => {
    assert.deepEqual(reasons(grillText({ log: DEMO_LOG.replace(`- Options: First ${REC} | Second`, `- Options: First ${REC}`) })).slice(0, 1), ['options count']);
    const five = `First ${REC} | b | c | d | e`;
    assert.ok(reasons(grillText({ log: DEMO_LOG.replace(`First ${REC} | Second`, five) })).includes('options count'));
    assert.deepEqual(reasons(grillText({ log: DEMO_LOG.replace(`First ${REC} | Second`, `First ${REC} | b | c | d`) })), []);
  });

  test('a first option without a recommendation', () => {
    assert.deepEqual(reasons(grillText({ log: DEMO_LOG.replace(` ${REC}`, '') })), ['missing field recommended']);
    assert.deepEqual(reasons(grillText({ log: DEMO_LOG.replace(REC, '(recommended: )') })), ['missing field recommended']);
  });

  test('missing, empty or out of order fields', () => {
    assert.deepEqual(reasons(grillText({ log: DEMO_LOG.replace('- Answer: First\n', '') })), ['missing field Answer']);
    assert.deepEqual(reasons(grillText({ log: DEMO_LOG.replace('- Answer: First\n', '- Answer:\n') })), ['missing field Answer']);
    assert.deepEqual(
      reasons(grillText({ log: DEMO_LOG.replace('- Answer: First\n- Decision: Take the first way for part 1.', '- Decision: Take the first way for part 1.\n- Answer: First') })),
      ['missing field Answer'],
    );
    assert.deepEqual(reasons(grillText({ log: DEMO_LOG.replace('- Opens: B-4, B-5', '- Opens: maybe') })), ['missing field Opens']);
    const fact = '### F-1 — B-4\n- Fact: A fact.\n- Closes: B-4\n';
    assert.deepEqual(reasons(grillText({ log: `${DEMO_LOG}\n${fact}`, closed: [[1, 's', 'Q-1'], [2, 'n', 'Q-2'], [3, 'o', 'Q-3'], [4, 'f', 'F-1']], open: [[5, 'w']] })), ['missing field Source']);
  });

  test('done with open branches is on the status line', () => {
    const p = parseGrill(grillText({ status: 'done' }));
    assert.deepEqual(p.errors, [{ line: 4, reason: 'done with open branches' }]);
    assert.deepEqual(reasons(grillText({ status: 'stopped' })), []);
  });

  test('errors are sorted by line and at most 50 are shown', () => {
    const open = Array.from({ length: 60 }, (_, i) => [i + 4, 'a\rb']);
    const fx = fixture(grillText({ open, closed: [[1, 'Scope', 'Q-1'], [2, 'Name', 'Q-2'], [3, 'Order', 'Q-3']] }));
    const r = main(['check', fx.rel], { root: fx.root });
    assert.equal(r.code, 2);
    assert.equal(r.lines.length, 51);
    assert.equal(r.lines.at(-1), 'grill-check: 60 errors');
    const lineNos = parseGrill(grillText({ open })).errors.map((e) => e.line);
    assert.deepEqual(lineNos, [...lineNos].sort((a, b) => a - b));
  });

  test('error lines hold only fixed words, ids and numbers', () => {
    const fx = fixture(grillText({ log: DEMO_LOG.replace('Which way for part 1?', 'SECRET-TEXT') }).replace('Which store holds it', 'SECRET\rTEXT'));
    const r = main(['check', fx.rel], { root: fx.root });
    assert.doesNotMatch(r.lines.join('\n'), /SECRET/);
  });
});

describe('line endings and odd input', () => {
  test('CRLF input gives the same result and line numbers', () => {
    const lf = grillText({ open: [[4, 'a\rb'], [5, 'c']] });
    const crlf = lf.replace(/\n/g, '\r\n');
    assert.deepEqual(parseGrill(crlf), parseGrill(lf));
    const clean = grillText();
    const p = parseGrill(clean.replace(/\n/g, '\r\n'));
    assert.deepEqual(p.errors, []);
    assert.equal(p.answered, 3);
    const fx = fixture(clean.replace(/\n/g, '\r\n'));
    assert.equal(main(['status', 'demo'], { root: fx.root }).code, 0);
  });

  test('parseGrill never throws on odd strings', () => {
    const odd = ['', '\n', '---', '---\n', '\u0000'.repeat(10), '## Idea\n'.repeat(5), '- B-1 — x\n'.repeat(100), '### Q-1 — B-1\n'.repeat(5), 'x'.repeat(300000), '\r\r\r', ' '];
    for (const text of odd) {
      const p = parseGrill(text);
      assert.ok(Array.isArray(p.errors) && p.errors.length > 0);
      assert.equal(p.status, null);
    }
  });

  test('a long line stays fast', () => {
    const start = Date.now();
    parseGrill(grillText({ open: [[4, ' '.repeat(100000)], [5, 'x']] }));
    parseGrill(`## Open branches\n- B-1 — ${'— '.repeat(50000)}\n`);
    assert.ok(Date.now() - start < 2000);
  });

  test('ids named like object keys are not special', () => {
    const p = parseGrill(grillText().replace('B-4', 'B-__proto__'));
    assert.ok(p.errors.some((e) => e.reason === 'bad branch line'));
  });
});
