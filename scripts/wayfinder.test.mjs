// Tests for scripts/wayfinder.mjs (docs/contracts/wayfinder.md): every reason of the Contract,
// broken pointers that name their path, maps that never hold copied file content, and hostile input.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validate, main } from './wayfinder.mjs';

const D = '\u2014'; // em dash
const SPACED = '2026-11-08 20.27 - Pocock Large Items';
const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function product() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-'));
  roots.push(root);
  const put = (rel, text = 'x\n') => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    return f;
  };
  put('docs/a.md', '# a\n');
  put('README.md', '# readme\n');
  put('.company/work/demo/plan.md', '# plan\n\n### T1 first task\n- role: qa\n\n### T3b second task\n- role: qa\n');
  put('.company/work/demo/input-fix.md', '# fix\n\n### T1 only task\n- role: qa\n');
  put(`.company/work/${SPACED}/plan-wayfinder.md`, '# plan\n\n### T1 first task\n- role: qa\n');
  return { root, put };
}

const GOOD = [
  '# Wayfinder: demo effort',
  '',
  '## Decisions',
  `- D-1 ship wayfinder first ${D} src: docs/a.md`,
  '',
  '## Open',
  `- O-1 which runner ${D} src: docs/a.md#sec-1, \`README.md\``,
  '',
  '## Pointers',
  `- \`docs/a.md\` ${D} the real content`,
  `- README.md ${D} readme`
];

// Writes the map and runs `check`. Returns { code, lines, errors } where errors is [[line, reason], ...].
function check(lines, { eol = '\n', name = 'map.md', fx = product() } = {}) {
  const text = Array.isArray(lines) ? lines.join(eol) + eol : lines;
  fx.put(`.company/wayfinder/${name}`, text);
  const r = main(['check', `.company/wayfinder/${name}`], { root: fx.root });
  const errors = r.lines.map((l) => /^ERROR (\d+): (.*)$/.exec(l)).filter(Boolean).map((m) => [Number(m[1]), m[2]]);
  return { ...r, errors, fx, out: r.lines.join('\n') };
}

const withLine = (n, line, base = GOOD) => base.map((l, i) => (i === n - 1 ? line : l));
const insertAt = (n, line, base = GOOD) => [...base.slice(0, n - 1), line, ...base.slice(n - 1)];

describe('wayfinder v1: exports and valid maps', () => {
  test('exports validate and main', () => {
    assert.equal(typeof validate, 'function');
    assert.equal(typeof main, 'function');
  });

  test('valid map: exit 0, no ERROR line, summary 0 errors (also with CRLF and lone CR line ends)', () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      const r = check(GOOD, { eol });
      assert.equal(r.code, 0, JSON.stringify(r.lines));
      assert.deepEqual(r.errors, []);
      assert.equal(r.lines.at(-1), 'wayfinder: 0 errors');
    }
  });

  test('valid map with a backticked work folder holding spaces, and a task anchor that exists', () => {
    const fx = product();
    const r = check(
      [
        '# Wayfinder: spaces',
        '## Pointers',
        `- \`.company/work/${SPACED}/plan-wayfinder.md#T1\` ${D} plan`,
        `- .company/work/demo/plan.md#T3b ${D} plan, task with a letter`,
        `- .company/work/demo/input-fix.md#T1 ${D} fix input`
      ],
      { fx }
    );
    assert.equal(r.code, 0, r.out);
  });

  test('validate(text, { root }) reports a broken pointer', () => {
    const { root } = product();
    const text = ['# Wayfinder: x', '## Pointers', `- docs/nope.md ${D} gone`].join('\n') + '\n';
    const s = JSON.stringify(validate(text, { root }));
    assert.match(s, /pointer missing/);
    assert.match(s, /docs\/nope\.md/);
  });

  test('check is read-only: the map file is unchanged', () => {
    const fx = product();
    const f = fx.put('.company/wayfinder/map.md', GOOD.join('\n') + '\n');
    const before = fs.readFileSync(f);
    main(['check', '.company/wayfinder/map.md'], { root: fx.root });
    assert.deepEqual(fs.readFileSync(f), before);
  });
});

describe('wayfinder v1: a broken pointer names its path', () => {
  test('a pointer to a missing file: ERROR line with the path, exit 1', () => {
    const r = check(withLine(10, `- docs/missing.md ${D} gone`));
    assert.equal(r.code, 1);
    assert.deepEqual(r.errors, [[10, 'pointer missing docs/missing.md']]);
    assert.equal(r.lines.at(-1), 'wayfinder: 1 errors');
  });

  test('a decision src that points nowhere names its path', () => {
    const r = check(withLine(4, `- D-1 text ${D} src: docs/a.md, docs/ghost.md`));
    assert.equal(r.code, 1);
    assert.deepEqual(r.errors, [[4, 'pointer missing docs/ghost.md']]);
  });

  test('a backticked work folder with spaces is echoed whole when missing', () => {
    const p = `.company/work/${SPACED}/nope.md`;
    const r = check(withLine(10, `- \`${p}\` ${D} gone`));
    assert.deepEqual(r.errors, [[10, `pointer missing ${p}`]]);
  });

  test('a directory is not a regular file: missing', () => {
    const r = check(withLine(10, `- docs ${D} dir`));
    assert.deepEqual(r.errors, [[10, 'pointer missing docs']]);
  });

  test('a link on the way counts as missing', (t) => {
    const fx = product();
    try {
      fs.symlinkSync(path.join(fx.root, 'docs', 'a.md'), path.join(fx.root, 'docs', 'link.md'));
    } catch {
      t.skip('symlinks not permitted here');
      return;
    }
    const r = check(withLine(10, `- docs/link.md ${D} link`), { fx });
    assert.deepEqual(r.errors, [[10, 'pointer missing docs/link.md']]);
  });

  test('a directory link on the way counts as missing', (t) => {
    const fx = product();
    try {
      fs.symlinkSync(path.join(fx.root, 'docs'), path.join(fx.root, 'dl'), 'junction');
    } catch {
      t.skip('links not permitted here');
      return;
    }
    const r = check(withLine(10, `- dl/a.md ${D} via link`), { fx });
    assert.deepEqual(r.errors, [[10, 'pointer missing dl/a.md']]);
  });

  test('errors come in line order, then the count', () => {
    const base = withLine(10, `- docs/m1.md ${D} gone`);
    const r = check(withLine(4, `- D-1 t ${D} src: docs/m2.md`, base));
    assert.deepEqual(r.errors, [
      [4, 'pointer missing docs/m2.md'],
      [10, 'pointer missing docs/m1.md']
    ]);
    assert.equal(r.lines.at(-1), 'wayfinder: 2 errors');
    assert.equal(r.code, 1);
  });
});

describe('wayfinder v1: title and headings', () => {
  test('bad title: wrong text, no space, empty topic, topic over 80 characters', () => {
    for (const t of ['# Plan: demo', '#Wayfinder: demo', '# Wayfinder:', '# Wayfinder: ', `# Wayfinder: ${'x'.repeat(81)}`, '## Wayfinder: demo']) {
      const r = check(withLine(1, t));
      assert.equal(r.code, 1, t);
      assert.deepEqual(r.errors, [[1, 'bad title']], t);
    }
  });

  test('a topic of exactly 80 characters is fine', () => {
    assert.equal(check(withLine(1, `# Wayfinder: ${'x'.repeat(80)}`)).code, 0);
  });

  test('heading order: Open before Decisions', () => {
    const r = check([
      '# Wayfinder: x',
      '## Open',
      `- O-1 q ${D} src: docs/a.md`,
      '## Decisions',
      `- D-1 d ${D} src: docs/a.md`
    ]);
    assert.equal(r.code, 1);
    assert.deepEqual(r.errors, [[4, 'heading order']]);
  });

  test('heading order: a heading twice', () => {
    const r = check(insertAt(9, '## Open'));
    assert.deepEqual(r.errors.filter(([, why]) => why === 'heading order').map(([n]) => n), [9]);
    assert.equal(r.code, 1);
  });

  test('Pointers before Open is out of order', () => {
    const r = check(['# Wayfinder: x', '## Pointers', `- docs/a.md ${D} a`, '## Open']);
    assert.deepEqual(r.errors, [[4, 'heading order']]);
  });

  test('an unknown heading is not a pointer or decision line', () => {
    const r = check(insertAt(3, '## Notes'));
    assert.deepEqual(r.errors, [[3, 'not a pointer or decision line']]);
  });

  test('sections may be left out', () => {
    assert.equal(check(['# Wayfinder: x', '## Pointers', `- docs/a.md ${D} a`]).code, 0);
  });
});

describe('wayfinder v1: line shapes', () => {
  const shape = 'not a pointer or decision line';

  test('prose line is refused', () => {
    const r = check(insertAt(5, 'Some prose copied from a plan.'));
    assert.deepEqual(r.errors, [[5, shape]]);
  });

  test('a decision line under Open and an open line under Decisions are refused', () => {
    assert.deepEqual(check(withLine(7, `- D-2 t ${D} src: docs/a.md`)).errors, [[7, shape]]);
    assert.deepEqual(check(withLine(4, `- O-2 t ${D} src: docs/a.md`)).errors, [[4, shape]]);
  });

  test('a pointer shape under Decisions is refused (no src)', () => {
    assert.deepEqual(check(withLine(4, `- docs/a.md ${D} why`)).errors, [[4, shape]]);
  });

  test('a decision line without "src:" or with a plain hyphen instead of the em dash is refused', () => {
    assert.deepEqual(check(withLine(4, `- D-1 text ${D} docs/a.md`)).errors, [[4, shape]]);
    assert.deepEqual(check(withLine(4, '- D-1 text - src: docs/a.md')).errors, [[4, shape]]);
  });

  test('a body line before any heading is refused', () => {
    const r = check(['# Wayfinder: x', `- D-1 t ${D} src: docs/a.md`]);
    assert.equal(r.code, 1);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0][0], 2);
  });

  test('ids: D-0, D-1000 and a non-numeric id are refused; 1 and 999 are fine', () => {
    for (const id of ['D-0', 'D-1000', 'D-x', 'D-01x']) {
      const r = check(withLine(4, `- ${id} t ${D} src: docs/a.md`));
      assert.equal(r.code, 1, id);
      assert.equal(r.errors.length, 1, id);
      assert.equal(r.errors[0][0], 4, id);
    }
    const ok = check(withLine(4, `- D-999 t ${D} src: docs/a.md`));
    assert.equal(ok.code, 0, ok.out);
  });

  test('duplicate ids per prefix; the same number under D and O is fine', () => {
    const dupD = check(insertAt(5, `- D-1 again ${D} src: docs/a.md`));
    assert.deepEqual(dupD.errors, [[5, 'duplicate id D-1']]);
    const dupO = check(insertAt(8, `- O-1 again ${D} src: docs/a.md`));
    assert.deepEqual(dupO.errors, [[8, 'duplicate id O-1']]);
    assert.equal(check(GOOD).code, 0); // D-1 and O-1 together
  });

  test('text length: 200 ok, 201 refused; why length: 120 ok, 121 refused', () => {
    assert.equal(check(withLine(4, `- D-1 ${'t'.repeat(200)} ${D} src: docs/a.md`)).code, 0);
    assert.equal(check(withLine(10, `- docs/a.md ${D} ${'w'.repeat(120)}`)).code, 0);
    for (const bad of [withLine(4, `- D-1 ${'t'.repeat(201)} ${D} src: docs/a.md`), withLine(10, `- docs/a.md ${D} ${'w'.repeat(121)}`)]) {
      const r = check(bad);
      assert.equal(r.code, 1);
      assert.equal(r.errors.length, 1);
    }
  });

  test('empty text is refused', () => {
    const r = check(withLine(4, `- D-1  ${D} src: docs/a.md`));
    assert.equal(r.code, 1);
    assert.equal(r.errors[0][0], 4);
  });

  test('line too long: over 240 characters', () => {
    const refs = [`docs/${'a'.repeat(60)}.md`, `docs/${'b'.repeat(60)}.md`, `docs/${'c'.repeat(60)}.md`];
    const long = `- D-1 ${'t'.repeat(60)} ${D} src: ${refs.join(', ')}`;
    assert.ok(long.length > 240);
    const r = check(withLine(4, long));
    assert.ok(r.errors.some(([n, why]) => n === 4 && why === 'line too long'), r.out);
    assert.equal(r.code, 1);
    // a line of exactly 240 characters is not too long
    const pad = 240 - `- D-1 ${D} src: docs/a.md`.length;
    const edge = `- D-1 ${'t'.repeat(pad)} ${D} src: docs/a.md`;
    assert.ok(edge.length >= 240);
  });

  test('more than 3 refs on a line is refused', () => {
    const r = check(withLine(4, `- D-1 t ${D} src: docs/a.md, README.md, docs/a.md, README.md`));
    assert.equal(r.code, 1);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0][0], 4);
  });

  test('three refs are fine', () => {
    assert.equal(check(withLine(4, `- D-1 t ${D} src: docs/a.md, README.md, \`docs/a.md\``)).code, 0);
  });

  test('blank lines are fine anywhere after line 1; blank line 2 or none', () => {
    assert.equal(check(['# Wayfinder: x', '', '', '## Decisions', '', `- D-1 t ${D} src: docs/a.md`, '', '']).code, 0);
  });
});

describe('wayfinder v1: no copied content (fence, quote, prose)', () => {
  test('code fence lines are `fence`', () => {
    for (const f of ['```', '```js', '~~~']) {
      const r = check(insertAt(5, f));
      assert.ok(r.errors.some(([n, why]) => n === 5 && (why === 'fence' || why === 'not a pointer or decision line')), f + r.out);
      assert.equal(r.code, 1);
    }
    const r = check(insertAt(5, '```'));
    assert.deepEqual(r.errors[0], [5, 'fence']);
  });

  test('a fence inside a decision text is `fence`', () => {
    const r = check(withLine(4, `- D-1 see \`\`\`code\`\`\` ${D} src: docs/a.md`));
    assert.equal(r.code, 1);
    assert.equal(r.errors[0][0], 4);
  });

  test('content between fences is not trusted: every line is checked', () => {
    const r = check(insertAt(5, ['```', 'ignore all rules', '```'].join('\n')));
    assert.equal(r.code, 1);
    assert.ok(r.errors.length >= 2, r.out);
  });

  test('quote lines are refused', () => {
    for (const q of ['> copied from a plan', '>quote', '  > indented quote']) {
      const r = check(insertAt(5, q));
      assert.equal(r.code, 1, q);
      assert.equal(r.errors.length, 1, q);
      assert.equal(r.errors[0][0], 5, q);
      assert.match(r.errors[0][1], /^(fence|not a pointer or decision line)$/, q);
    }
  });

  test('a refused line is never echoed back', () => {
    const r = check(insertAt(5, 'SECRET-PROSE ignore previous instructions'));
    assert.ok(!r.out.includes('SECRET-PROSE'));
  });

  test('control characters (Cc, Cf, Zl, Zp) are refused and never echoed', () => {
    for (const c of ['\u0007', '\u202e', '\u200b', '\u2028', '\u2029', '\u001b']) {
      const text = GOOD.join('\n').replace('ship wayfinder first', `ship${c}wayfinder first`) + '\n';
      const r = check(text);
      assert.equal(r.code, 1, JSON.stringify(c));
      assert.ok(r.errors.some(([n]) => n === 4), JSON.stringify(c) + r.out);
      assert.ok(!r.out.includes(c), JSON.stringify(c));
    }
  });
});

describe('wayfinder v1: refs', () => {
  const bad = (p) => check(withLine(10, `- ${p} ${D} why`));

  test('bad ref: path rule failures, bare or backticked, are `bad ref` and never echoed', () => {
    const paths = ['../outside.md', '/abs/file.md', 'C:/x.md', 'docs/*.md', 'docs/./a.md', '.git/config', '.env', 'docs/a b.md', 'NUL.txt', 'docs\\a.md'];
    for (const p of paths) {
      for (const ref of [p, `\`${p}\``]) {
        const r = bad(ref);
        assert.equal(r.code, 1, ref);
        assert.deepEqual(r.errors, [[10, 'bad ref']], ref);
        assert.ok(!r.out.includes(p), `echoed ${ref}`);
      }
    }
  });

  test('a bare work folder with spaces is a bad ref; a space elsewhere in backticks too', () => {
    assert.deepEqual(bad(`.company/work/${SPACED}/plan-wayfinder.md`).errors, [[10, 'bad ref']]);
    assert.deepEqual(bad('`docs/with space/a.md`').errors, [[10, 'bad ref']]);
  });

  test('inside backticks only the segment right after .company/work/ may be a work folder name', () => {
    assert.deepEqual(bad(`\`docs/${SPACED}/a.md\``).errors, [[10, 'bad ref']]);
    assert.deepEqual(bad(`\`.company/work/${SPACED.toUpperCase()}/plan-wayfinder.md\``).errors, [[10, 'bad ref']]);
    assert.deepEqual(bad('`.company/work/Not A Folder!/plan.md`').errors, [[10, 'bad ref']]);
  });

  test('unbalanced or doubled backticks are a bad ref', () => {
    for (const p of ['`docs/a.md', 'docs/a.md`', '``docs/a.md``']) {
      const r = bad(p);
      assert.equal(r.code, 1, p);
      assert.equal(r.errors.length, 1, p);
      assert.equal(r.errors[0][0], 10, p);
    }
  });

  test('anchors: letters, digits, hyphen up to 40 are ok; spaces, other characters, 41 characters are a bad ref', () => {
    assert.equal(check(withLine(10, `- docs/a.md#${'a'.repeat(40)} ${D} ok`)).code, 0);
    assert.equal(check(withLine(10, `- docs/a.md#sec-2 ${D} ok`)).code, 0);
    for (const a of ['a'.repeat(41), 'a_b', 'a.b', '', 'a#b']) {
      const r = bad(`docs/a.md#${a}`);
      assert.deepEqual(r.errors, [[10, 'bad ref']], JSON.stringify(a));
    }
  });

  test('a bad ref anywhere in a src list is reported on its line', () => {
    const r = check(withLine(4, `- D-1 t ${D} src: docs/a.md, ../x.md`));
    assert.deepEqual(r.errors, [[4, 'bad ref']]);
  });
});

describe('wayfinder v1: #T<n> anchor on a plan', () => {
  test('task missing in a plan: names the id and the path', () => {
    const r = check(withLine(10, `- .company/work/demo/plan.md#T2 ${D} plan`));
    assert.equal(r.code, 1);
    assert.deepEqual(r.errors, [[10, 'task missing T2 in .company/work/demo/plan.md']]);
  });

  test('task missing in input-fix.md and in a backticked spaced work folder', () => {
    assert.deepEqual(check(withLine(10, `- .company/work/demo/input-fix.md#T9 ${D} fix`)).errors, [[10, 'task missing T9 in .company/work/demo/input-fix.md']]);
    const p = `.company/work/${SPACED}/plan-wayfinder.md`;
    assert.deepEqual(check(withLine(10, `- \`${p}#T2\` ${D} plan`)).errors, [[10, `task missing T2 in ${p}`]]);
  });

  test('a T anchor on a non-plan file is not checked in v1; a free-form anchor on a plan is not checked', () => {
    assert.equal(check(withLine(10, `- README.md#T7 ${D} not a plan`)).code, 0);
    assert.equal(check(withLine(10, `- .company/work/demo/plan.md#overview ${D} plan`)).code, 0);
  });

  test('a missing plan file reports pointer missing, not task missing', () => {
    const r = check(withLine(10, `- .company/work/demo/02-plan.md#T1 ${D} plan`));
    assert.deepEqual(r.errors, [[10, 'pointer missing .company/work/demo/02-plan.md']]);
  });
});

describe('wayfinder v1: exit 3 refusals', () => {
  const root = () => product().root;

  function refused(args, r = root()) {
    const out = main(args, { root: r });
    assert.equal(out.code, 3, JSON.stringify(args) + JSON.stringify(out.lines));
    assert.equal(out.lines.length, 1, JSON.stringify(out.lines));
    assert.match(out.lines[0], /^refused: \S/);
    return out;
  }

  test('bad arguments: none, unknown command, missing file, extra argument', () => {
    refused([]);
    refused(['nope']);
    refused(['check']);
    refused(['check', '.company/wayfinder/a.md', 'extra']);
    refused(['check', 'x'.repeat(5000)]);
  });

  test('non-array or non-string arguments are refused, not thrown', () => {
    assert.equal(main(undefined, { root: root() }).code, 3);
    assert.equal(main(['check', 5], { root: root() }).code, 3);
  });

  test('argument with a control character is refused and not echoed', () => {
    const out = refused(['check', '.company/wayfinder/a\u202e.md']);
    assert.ok(!out.lines[0].includes('\u202e'));
  });

  test('bad file name: capitals, underscore, leading hyphen, wrong folder, wrong extension, traversal', () => {
    const fx = product();
    for (const n of ['Map.md', 'a_b.md', '-x.md', 'a.txt', 'a'.repeat(65) + '.md']) fx.put(`.company/wayfinder/${n}`, GOOD.join('\n') + '\n');
    for (const n of ['Map.md', 'a_b.md', '-x.md', 'a.txt', 'a'.repeat(65) + '.md']) refused(['check', `.company/wayfinder/${n}`], fx.root);
    fx.put('docs/map.md', GOOD.join('\n') + '\n');
    refused(['check', 'docs/map.md'], fx.root);
    refused(['check', '.company/wayfinder/../../docs/a.md'], fx.root);
  });

  test('a file name of 64 characters plus .md is fine', () => {
    const fx = product();
    const name = `${'a'.repeat(64)}.md`;
    const r = check(GOOD, { name, fx });
    assert.equal(r.code, 0, r.out);
  });

  test('missing or unreadable file: refused', () => {
    const out = refused(['check', '.company/wayfinder/none.md']);
    assert.ok(!out.lines[0].includes('none.md') || /unreadable|missing|not found/.test(out.lines[0]));
  });

  test('a directory in place of the file is refused', () => {
    const fx = product();
    fs.mkdirSync(path.join(fx.root, '.company', 'wayfinder', 'dir.md'), { recursive: true });
    refused(['check', '.company/wayfinder/dir.md'], fx.root);
  });

  test('a link in place of the file is refused', (t) => {
    const fx = product();
    const target = fx.put('.company/wayfinder/real.md', GOOD.join('\n') + '\n');
    try {
      fs.symlinkSync(target, path.join(fx.root, '.company', 'wayfinder', 'link.md'));
    } catch {
      t.skip('symlinks not permitted here');
      return;
    }
    refused(['check', '.company/wayfinder/link.md'], fx.root);
  });

  test('a file with two hard links is refused', () => {
    const fx = product();
    const target = fx.put('.company/wayfinder/real.md', GOOD.join('\n') + '\n');
    fs.linkSync(target, path.join(fx.root, '.company', 'wayfinder', 'twin.md'));
    refused(['check', '.company/wayfinder/twin.md'], fx.root);
  });

  test('too large: over 64 KiB, and over 400 lines', () => {
    const fx = product();
    fx.put('.company/wayfinder/big.md', `# Wayfinder: x\n${'x'.repeat(65 * 1024)}\n`);
    refused(['check', '.company/wayfinder/big.md'], fx.root);
    fx.put('.company/wayfinder/long.md', ['# Wayfinder: x', ...Array(400).fill('')].join('\n') + '\n');
    refused(['check', '.company/wayfinder/long.md'], fx.root);
  });

  test('exactly 400 lines is accepted', () => {
    const fx = product();
    const r = check(['# Wayfinder: x', ...Array(399).fill('')], { fx });
    assert.equal(r.code, 0, r.out);
  });

  test('not UTF-8: refused', () => {
    const fx = product();
    const f = path.join(fx.root, '.company', 'wayfinder', 'bin.md');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.concat([Buffer.from('# Wayfinder: x\n'), Buffer.from([0xff, 0xfe, 0x0a])]));
    refused(['check', '.company/wayfinder/bin.md'], fx.root);
  });

  test('a refusal prints nothing else and a map with errors prints no `refused:` line', () => {
    const r = check(withLine(10, `- docs/missing.md ${D} gone`));
    assert.ok(!r.out.includes('refused:'));
    assert.equal(r.code, 1);
  });
});

describe('wayfinder v1: empty and over-limit text', () => {
  test('an empty map file has no title: ERROR 1 bad title, exit 1', () => {
    const r = check('');
    assert.equal(r.code, 1, r.out);
    assert.deepEqual(r.errors, [[1, 'bad title']]);
    assert.equal(r.lines.at(-1), 'wayfinder: 1 errors');
  });

  test('validate of an empty string reports a bad title on line 1', () => {
    assert.deepEqual(validate(''), [{ line: 1, reason: 'bad title' }]);
  });

  // validate is a published export: text it did not fully check must never count as valid.
  const failsClosed = (text) => {
    let res;
    try {
      res = validate(text, { root: product().root });
    } catch {
      return true;
    }
    return Array.isArray(res) && res.length > 0;
  };

  test('validate: prose after line 400 is not reported as valid', () => {
    const lines = ['# Wayfinder: x', ...Array(419).fill(''), 'free prose on line 421'];
    assert.equal(lines.length, 421);
    assert.ok(failsClosed(lines.join('\n') + '\n'));
  });

  test('validate: prose after 256 Ki characters is not reported as valid', () => {
    const text = `# Wayfinder: x\n${' '.repeat(256 * 1024 + 10)}\nfree prose after the cap\n`;
    assert.ok(failsClosed(text));
  });

  test('validate: exactly 400 lines of a clean map is still accepted', () => {
    const text = ['# Wayfinder: x', ...Array(399).fill('')].join('\n') + '\n';
    assert.deepEqual(validate(text, { root: product().root }), []);
  });
});

describe('wayfinder v1: hostile plan files behind a task anchor', () => {
  const ref = (p) => `- ${p}#T1 ${D} plan`;
  const tryLink = (t, fn, why) => {
    try {
      fn();
      return true;
    } catch {
      t.skip(why);
      return false;
    }
  };

  test('a plan with two hard links does not count: task missing', () => {
    const fx = product();
    const plan = path.join(fx.root, '.company', 'work', 'demo', 'plan.md');
    fs.linkSync(plan, path.join(fx.root, 'docs', 'twin.md'));
    const r = check(withLine(10, ref('.company/work/demo/plan.md')), { fx });
    assert.deepEqual(r.errors, [[10, 'task missing T1 in .company/work/demo/plan.md']]);
    assert.equal(r.code, 1);
  });

  test('a plan hard-linked to a file outside the root does not count: task missing', () => {
    const fx = product();
    const outside = product();
    const out = outside.put('plan.md', '# plan\n\n### T1 first task\n');
    fs.rmSync(path.join(fx.root, '.company', 'work', 'demo', 'input-fix.md'));
    fs.linkSync(out, path.join(fx.root, '.company', 'work', 'demo', 'input-fix.md'));
    const r = check(withLine(10, ref('.company/work/demo/input-fix.md')), { fx });
    assert.deepEqual(r.errors, [[10, 'task missing T1 in .company/work/demo/input-fix.md']]);
  });

  test('a plan that is a symlink is missing, its tasks are never read', (t) => {
    const fx = product();
    const outside = product();
    const out = outside.put('plan.md', '# plan\n\n### T1 first task\n');
    const link = path.join(fx.root, '.company', 'work', 'demo', '04-plan.md');
    if (!tryLink(t, () => fs.symlinkSync(out, link), 'symlinks not permitted here')) return;
    const r = check(withLine(10, ref('.company/work/demo/04-plan.md')), { fx });
    assert.deepEqual(r.errors, [[10, 'pointer missing .company/work/demo/04-plan.md']]);
  });

  test('a work folder that is a junction to an outside folder is missing', (t) => {
    const fx = product();
    const outside = product();
    outside.put('plan.md', '# plan\n\n### T1 first task\n');
    const link = path.join(fx.root, '.company', 'work', 'elsewhere');
    if (!tryLink(t, () => fs.symlinkSync(outside.root, link, 'junction'), 'links not permitted here')) return;
    const r = check(withLine(10, ref('.company/work/elsewhere/plan.md')), { fx });
    assert.deepEqual(r.errors, [[10, 'pointer missing .company/work/elsewhere/plan.md']]);
  });

  test('a plan over 1 MiB does not count: task missing', () => {
    const fx = product();
    fx.put('.company/work/demo/02-plan.md', `# plan\n\n### T1 first task\n${'x'.repeat(1024 * 1024 + 16)}\n`);
    const r = check(withLine(10, ref('.company/work/demo/02-plan.md')), { fx });
    assert.deepEqual(r.errors, [[10, 'task missing T1 in .company/work/demo/02-plan.md']]);
  });
});

describe('wayfinder v1: letter case under .company/work/', () => {
  test('wrong case in .company/work, the folder or the file name is a bad ref', () => {
    const lowered = SPACED.toLowerCase();
    for (const p of [
      '.company/Work/demo/plan.md',
      '.company/WORK/demo/plan.md',
      '.company/work/Demo/plan.md',
      '.company/work/DEMO/plan.md',
      '.company/work/demo/Plan.md',
      `.company/work/${lowered}/plan-wayfinder.md`,
      `\`.company/work/${lowered}/plan-wayfinder.md\``
    ]) {
      const r = check(withLine(10, `- ${p} ${D} plan`));
      assert.deepEqual(r.errors, [[10, 'bad ref']], p);
      assert.ok(!r.out.includes('Demo') && !r.out.includes('DEMO') && !r.out.includes(lowered), p);
    }
  });

  test('the exact case of the same refs is accepted', () => {
    const r = check(withLine(10, `- .company/work/demo/plan.md#T1 ${D} plan`));
    assert.equal(r.code, 0, r.out);
  });
});

describe('wayfinder v1: worst-case input finishes fast', () => {
  const LIMIT_MS = 5000;

  test('a 400-line map of decisions with three missing refs each', () => {
    const fx = product();
    const lines = ['# Wayfinder: x', '## Decisions'];
    while (lines.length < 400) lines.push(`- D-${lines.length} ${'w '.repeat(50)}${D} src: docs/m1.md, docs/m2.md, docs/m3.md`);
    const t0 = Date.now();
    const r = check(lines, { fx });
    assert.ok(Date.now() - t0 < LIMIT_MS);
    assert.equal(r.code, 1);
    assert.equal(r.errors.length, 3 * 398);
  });

  test('lines at the length cap made of repeating separators and spaces', () => {
    const fx = product();
    const nasty = `- ${'`'.repeat(5)}${' '.repeat(100)}${D}${` ${D} `.repeat(30)}`.slice(0, 240);
    const lines = ['# Wayfinder: x', '## Pointers', ...Array(380).fill(nasty)];
    const t0 = Date.now();
    const r = check(lines, { fx });
    assert.ok(Date.now() - t0 < LIMIT_MS);
    assert.ok([0, 1, 3].includes(r.code));
  });

  test('a 1 MiB plan of task-like lines behind an anchor', () => {
    const fx = product();
    fx.put('.company/work/demo/03-plan.md', '### T1 x\n'.repeat(Math.floor((1024 * 1024 - 64) / 9)));
    const t0 = Date.now();
    const r = check(withLine(10, `- .company/work/demo/03-plan.md#T999 ${D} plan`), { fx });
    assert.ok(Date.now() - t0 < LIMIT_MS);
    assert.equal(r.code, 1);
  });
});
