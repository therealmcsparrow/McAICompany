import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, wordTerms, wordRule, testRule } from './slop-catalog.mjs';
import { main, scan, walk, paragraphs, MAX_BYTES } from './slop-scan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLANTED = 'tests/slop-scan/planted.md';
const CLEAN = 'tests/slop-scan/clean.md';
const IDS = [
  ...Array.from({ length: 8 }, (_, i) => `W0${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `S0${i + 1}`),
];

// True when a regex source has a quantified group whose body holds a quantifier (nested or inside).
function nestedQuantifier(source) {
  const stack = [];
  let i = 0;
  const isQuant = (k) => '*+?'.includes(source[k]) || source[k] === '{';
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      i += (source[i + 1] === 'p' || source[i + 1] === 'P') && source[i + 2] === '{' ? source.indexOf('}', i) - i + 1 : 2;
      continue;
    }
    if (c === '[') {
      i++;
      while (i < source.length && source[i] !== ']') i += source[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '(') {
      stack.push({ quant: false });
      i++;
      if (source[i] === '?') i += source[i + 1] === '<' && (source[i + 2] === '=' || source[i + 2] === '!') ? 3 : 2;
      continue;
    }
    if (c === ')') {
      const group = stack.pop();
      i++;
      if (i < source.length && isQuant(i)) {
        if (group.quant) return true;
        if (stack.length) stack[stack.length - 1].quant = true;
      } else if (group.quant && stack.length) {
        stack[stack.length - 1].quant = true;
      }
      continue;
    }
    if ((c === '*' || c === '+' || c === '?' || c === '{') && stack.length) stack[stack.length - 1].quant = true;
    i++;
  }
  return false;
}

test('the nested quantifier check catches the shapes it should', () => {
  assert.equal(nestedQuantifier('(a+)+'), true);
  assert.equal(nestedQuantifier('(?:a{1,3} )*'), true);
  assert.equal(nestedQuantifier('(?:a|b+)?'), true);
  assert.equal(nestedQuantifier('(?:a(?:b)?)?'), true);
  assert.equal(nestedQuantifier('(?:just |only )?x[ab]{1,5}'), false);
  assert.equal(nestedQuantifier('(?<![\\p{L}])(?:a|b)(?![\\p{L}])'), false);
});

test('the catalog holds W01-W08 and S01-S09 once each, with short labels', () => {
  assert.deepEqual(RULES.map((r) => r.id), IDS);
  for (const r of RULES) {
    assert.equal(r.kind, r.id[0]);
    assert.ok(r.label.length > 0 && r.label.length <= 60, `${r.id} label length ${r.label.length}`);
  }
  assert.ok(wordTerms().length >= 200);
  assert.equal(new Set(wordTerms().map((t) => t.toLowerCase())).size, wordTerms().length, 'a term sits in one rule only');
});

test('R-19: the shipped catalog has valid unique ids, a kind per id, a label and plain word terms', () => {
  const ids = RULES.map((r) => r.id);
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of RULES) {
    assert.match(r.id, /^[WS]\d{2}$/);
    assert.equal(r.kind, r.id[0]);
    assert.equal(typeof r.label, 'string');
  }
  assert.ok(wordTerms().length > 0);
});

test('no regex source in RULES holds a quantified group with a quantifier inside', () => {
  for (const r of RULES) {
    if (r.re instanceof RegExp) assert.equal(nestedQuantifier(r.re.source), false, `${r.id}: ${r.re.source}`);
  }
});

test('wordRule matches whole words only, any case, and escapes its terms', () => {
  const rule = wordRule('W99', 'x', ['a.b', 'game-changer']);
  const hits = (s) => scan(s, 'x.md', [rule]).tells.length;
  assert.equal(hits('see A.B here'), 1);
  assert.equal(hits('see axb here'), 0);
  assert.equal(hits('A Game-Changer arrives'), 1);
  assert.equal(hits('xa.b and a.bx'), 0);
});

test('testRule answers once per unit: per paragraph by default, per line when asked', () => {
  const para = testRule('S99', 'S', 'x', (t) => t.includes('z'));
  assert.deepEqual(scan('z\nzz\n\nq\n\nzz\n', 'x.md', [para]).tells.map((t) => t.line), [1, 6]);
  const line = testRule('S99', 'S', 'x', (t) => t.includes('z'), 'line');
  assert.deepEqual(scan('z\nq\nzz\n', 'x.md', [line]).tells.map((t) => t.line), [1, 3]);
  assert.equal(para.unit, 'paragraph');
  assert.equal(Object.hasOwn(para, 're'), false);
});

test('every rule holds exactly one matcher, a real RegExp or a function; scan refuses anything else', () => {
  for (const r of RULES) {
    assert.ok((r.re instanceof RegExp) !== (typeof r.test === 'function'), r.id);
    assert.ok(r.unit === undefined || r.unit === 'paragraph' || r.unit === 'line', r.id);
    if (r.re) assert.equal(r.re.global, true, r.id);
  }
  assert.deepEqual(RULES.filter((r) => r.unit === 'line').map((r) => r.id), ['S05', 'S06', 'S09']);
  const base = { id: 'S99', kind: 'S', label: 'x' };
  assert.throws(() => scan('a', 'x.md', [{ ...base }]), /bad rule/);
  assert.throws(() => scan('a', 'x.md', [{ ...base, re: /a/g, test: () => true }]), /bad rule/);
  assert.throws(() => scan('a', 'x.md', [{ ...base, re: { exec: () => null } }]), /bad rule/);
  assert.throws(() => scan('a', 'x.md', [{ ...base, test: () => true, unit: 'page' }]), /bad rule/);
  assert.equal(scan('a', 'x.md', [{ ...base, re: /a/ }]).tells.length, 1, 'a non-global regex still works');
});

// True when a regex source holds a quantifier with no upper bound outside a class or an escape: *, + or {n,}.
function unboundedRun(source) {
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      i += (source[i + 1] === 'p' || source[i + 1] === 'P') && source[i + 2] === '{' ? source.indexOf('}', i) - i + 1 : 2;
      continue;
    }
    if (c === '[') {
      i++;
      while (i < source.length && source[i] !== ']') i += source[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '*' || c === '+') return true;
    if (c === '{') {
      const end = source.indexOf('}', i);
      if (/^\{\d+,\}$/.test(source.slice(i, end + 1))) return true;
    }
    i++;
  }
  return false;
}

test('no regex in RULES holds an unbounded run, and the check sees one', () => {
  assert.equal(unboundedRun('^[ \\t]+x'), true);
  assert.equal(unboundedRun('^ +x'), true);
  assert.equal(unboundedRun('a{2,}'), true);
  assert.equal(unboundedRun('[ \\t]{1,8}\\*\\*[^*\\n]{1,40}'), false);
  for (const r of RULES) if (r.re) assert.equal(unboundedRun(r.re.source), false, `${r.id}: ${r.re.source}`);
});

test('no regex literal in the catalog source behind a test-style rule holds an unbounded run', () => {
  const src = readFileSync(join(root, 'scripts', 'slop-catalog.mjs'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const lit = /(?:^|[=(,:!&|?{};\s])\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+)\/[a-z]*/g;
  const found = [...src.matchAll(lit)].map((m) => m[1]);
  assert.ok(found.length > 5, 'the literal finder sees the catalog regexes');
  assert.equal(unboundedRun('a+'), true);
  for (const source of found) assert.equal(unboundedRun(source), false, source);
});

const lineHits = (text, id) => scan(text, 'x.md').tells.filter((t) => t.rule === id).map((t) => t.line);

test('each rule fires on its own shape and stays quiet on the near miss', () => {
  const cases = [
    ['W01', 'Teams leverage tools.', 'Teams lever tools.'],
    ['W02', 'A rich tapestry.', 'A rich carpet.'],
    ['W03', 'A game-changer.', 'A change of game.'],
    ['W04', 'Needless to say, hi.', 'Say it plainly.'],
    ['W05', 'It could possibly work.', 'It could work.'],
    ['W06', 'I hope this helps.', 'I wrote this.'],
    ['W07', 'It is very small.', 'It is small.'],
    ['W08', 'In summary, it works.', 'It works.'],
    ['S01', 'It is not fast but safe.', 'It is not fast.'],
    ['S01', "This isn't a bug, it's a feature.", "This isn't a bug."],
    ['S02', 'a — b — c — d', 'a — b — c'],
    ['S01', 'This isn’t a bug—it’s a feature.', 'This isn’t a bug—fix it.'],
    ['S01', 'This isn’t a bug — it’s a feature.', 'This isn’t a bug — fix it.'],
    ['S03', 'ax, bx, and cx; dx, ex, or fx', 'ax, bx, and cx'],
    ['S03', 'faster builds, cleaner code, and happier teams; clear goals, tight scope, and honest review', 'faster builds, cleaner code, and happier teams'],
    ['S03', 'We tested speed, cost, and risk, and the team reads logs, tests, or notes.', 'We tested speed, cost, and risk, and then went home.'],
    ['S05', 'In the end, we shipped.\r', 'In the end we shipped it and then went on to write more of the notes for the team.'],
    ['S05', 'In the end, we shipped.  ', 'In the end we shipped it and then went on to write more of the notes for the team.'],
    ['S04', 'The catch? Time.', 'The catch is time.'],
    ['S05', 'In the end, we shipped.', 'In the end we shipped it and then went on to write more of the notes for the team.'],
    ['S06', '- **Note:** hi', '**Note:** hi'],
    ['S07', 'Why is it slow? Because of disks.', 'Why is it slow? Disks.'],
    ['S08', 'One two three four. One two three four. One two three four. One two three four.', 'One two three four. One two three four. One two three four. One.'],
    ['S09', '## Hello 🚀', 'Hello 🚀'],
    ['S09', '- ✅ done', '- done'],
  ];
  for (const [id, hit, miss] of cases) {
    assert.deepEqual(lineHits(hit, id), [1], `${id} hit: ${hit}`);
    assert.deepEqual(lineHits(miss, id), [], `${id} miss: ${miss}`);
  }
});

test('S08 needs four sentences within 3 words, each of 3 words or more', () => {
  assert.deepEqual(lineHits('One two three. Four five six. Seven eight nine. Ten eleven twelve.', 'S08'), [1]);
  assert.deepEqual(lineHits('One two. Four five. Seven eight. Ten eleven.', 'S08'), []);
  assert.deepEqual(lineHits('A b c d e f g. A b c. A b c d e f g. A b c.', 'S08'), []);
  assert.deepEqual(lineHits('One two three. Four five six. Seven eight nine.', 'S08'), []);
});

test('a wrapped paragraph is judged as one, and a hit reports the line it starts on', () => {
  assert.deepEqual(lineHits('a — b —\nc — d', 'S02'), [1]);
  assert.deepEqual(lineHits('Intro line here.\na — b —\nc — d', 'S02'), [1]);
  assert.deepEqual(lineHits('ax, bx, and cx;\ndx, ex, or fx', 'S03'), [1]);
  assert.deepEqual(lineHits('faster builds, cleaner code,\nand happier teams; clear goals,\ntight scope, and honest review', 'S03'), [1]);
  assert.deepEqual(lineHits('One two three four.\nOne two three four. One two three four.\nOne two three four.', 'S08'), [1]);
  assert.deepEqual(lineHits('Intro.\n\nIt is worth\nnoting that we ship.', 'W04'), [3]);
  assert.deepEqual(lineHits('One.\nIt is worth\nnoting that we ship.\nIt is worth noting that we ship.', 'W04'), [2, 4]);
  assert.deepEqual(lineHits('It is not fast\nbut safe.', 'S01'), [1]);
  assert.deepEqual(lineHits('Filler words here.\nIt is not fast\nbut safe.', 'S01'), [2]);
  assert.deepEqual(lineHits('> a — b —\n> c — d', 'S02'), [1]);
});

test('paragraphs do not join across a blank line, heading, table row, list item, fence, quote or a bare marker', () => {
  const none = (text, id) => assert.deepEqual(lineHits(text, id), [], JSON.stringify(text));
  none('a — b —\n\nc — d', 'S02');
  none('a — b —\n# c — d', 'S02');
  none('a — b —\n| c — d |', 'S02');
  none('a — b —\n- c — d', 'S02');
  none('a — b —\n1. c — d', 'S02');
  none('a — b —\n```\nx\n```\nc — d', 'S02');
  none('a — b —\n> c — d', 'S02');
  none('> a — b —\n>\n> c — d', 'S02');
  none('It is worth\n\nnoting that', 'W04');
  none('It is worth\n- noting that', 'W04');
  none('---\nname: x\n---\nIt is worth\nnoting that', 'S02');
  none('It is\n`code`\nworth noting that', 'W04');
  assert.deepEqual(lineHits('a — b —\n`x`\nc — d', 'S02'), [1], 'a line of masked text keeps the paragraph open');
});

test('paragraphs returns text, offsets, lines and the first line', () => {
  const t = 'one two\nthree\n\n- item a\n  more\n## head\n> q one\n> q two\nplain';
  const ps = paragraphs(t);
  assert.deepEqual(ps.map((p) => p.text), ['one two three', '- item a more', '## head', 'q one q two', 'plain']);
  assert.deepEqual(ps.map((p) => p.first), [1, 4, 6, 7, 9]);
  assert.deepEqual(ps[0].starts, [0, 8]);
  assert.deepEqual(ps[0].lines, [1, 2]);
  assert.deepEqual(paragraphs('\n\n  \n'), []);
});

test('rewrapping a paragraph at single spaces changes line numbers, never the tells', () => {
  const words = ('Teams leverage tools. The build is very small — fast — cheap — done. It is not fast but safe. '
    + 'We list speed, cost, and risk, then goals, scope, or review. It is worth noting that we ship. '
    + 'One two three. Four five six. Seven eight nine. Ten eleven twelve.').split(' ');
  const shape = (width) => {
    const lines = [];
    let cur = '';
    for (const w of words) {
      if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    lines.push(cur);
    return scan(lines.join('\n'), 'x.md').tells.map((t) => t.rule).sort().join(',');
  };
  const one = shape(100000);
  assert.ok(one.includes('S02') && one.includes('S03') && one.includes('S08') && one.includes('W04') && one.includes('S01'), one);
  for (const w of [12, 20, 33, 47, 80]) assert.equal(shape(w), one, `width ${w}`);
});

test('S05 and S06 stay per line and ignore the end of the line', () => {
  assert.deepEqual(lineHits('Intro words here.\nIn the end, we shipped.\r\nMore.', 'S05'), [2]);
  assert.deepEqual(lineHits('Some text\nIn the end,\nwe shipped.', 'S05'), []);
  assert.deepEqual(lineHits('text\n- **Note:** one\n- **Hint:** two', 'S06'), [2, 3]);
});

test('planted fixture: every tell reported with line and id, the same twice', () => {
  const a = main([PLANTED], { cwd: root });
  const b = main([PLANTED], { cwd: root });
  assert.equal(a.code, 0);
  assert.equal(a.stderr, '');
  assert.equal(a.stdout, b.stdout);
  assert.equal(a.stdout, readFileSync(join(root, 'tests/slop-scan/planted.expected.txt'), 'utf8'));
  for (const id of IDS) assert.match(a.stdout, new RegExp(`^${PLANTED}:\\d+ ${id} `, 'm'), `${id} missing`);
  const json = JSON.parse(main(['--json', PLANTED], { cwd: root }).stdout);
  assert.deepEqual([...new Set(json.tells.map((t) => t.rule))].sort(), [...IDS].sort());
});

test('planted fixture: masked text reports nothing', () => {
  const lines = readFileSync(join(root, PLANTED), 'utf8').split('\n');
  const from = lines.indexOf('Masked text below must report nothing.') + 1;
  const reported = scan(lines.join('\n'), PLANTED).tells.filter((t) => t.line > from);
  assert.deepEqual(reported, []);
});

test('clean fixture: zero tells, exit 0', () => {
  const r = main([CLEAN], { cwd: root });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /^slop-scan: 0 tells, \d+ words, 0\.0 per 1000 words\n$/);
});

test('fixtures are LF only', () => {
  for (const f of [PLANTED, CLEAN, 'tests/slop-scan/planted.expected.txt', 'scripts/slop-catalog.mjs', 'scripts/slop-catalog.test.mjs']) {
    assert.equal(readFileSync(join(root, f)).includes(13), false, f);
  }
});

function timed(text) {
  const t0 = Date.now();
  scan(text, 'x.md');
  return Date.now() - t0;
}

test('hostile: 1 MiB over the full catalog stays under 5 seconds per shape', () => {
  const terms = wordTerms();
  const prefixes = terms.map((t) => t.slice(0, Math.max(1, t.length - 1))).join(' ');
  const rep = (unit) => unit.repeat(Math.ceil(MAX_BYTES / unit.length)).slice(0, MAX_BYTES);
  const shapes = {
    prefixesOneLine: rep(`${prefixes} `),
    prefixesLines: rep(`${prefixes}\n`),
    termsOneLine: rep(`${terms.join(' ')} `),
    dashes: rep('— '),
    dashWords: rep('a—'),
    lists: rep('ab, cd, and ef '),
    listsBroken: rep('ab, cd, and '),
    commas: rep(', '),
    not: rep('not '),
    notBut: rep('not a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f g h i j k l m n o p q r s '),
    isnt: rep("isn't a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f g h i j k l m n o p q r s "),
    colons: rep('here’s the a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f '),
    questions: rep('why a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f g h i j k l m n o p q r s t u v w x y z? '),
    question: rep('? '),
    closers: rep('in the end '),
    bold: rep('- ** **:** '),
    boldLines: rep('- **a**\n'),
    sentences: rep('a b c. '),
    stops: rep('. '),
    emoji: rep('- \u{1F680}\n'),
    emojiBeyond: `- ${'a'.repeat(MAX_BYTES - 8)} \u{1F680}`,
    spaces: `${' '.repeat(MAX_BYTES - 1)}x`,
    listSpaces: `- ${' '.repeat(MAX_BYTES - 3)}x`,
    listCommas: rep('a, '),
    listHyphens: `- ${'-'.repeat(MAX_BYTES - 2)}`,
  };
  for (const [name, text] of Object.entries(shapes)) {
    const ms = timed(text);
    assert.ok(ms < 5000, `${name}: ${ms} ms`);
  }
});

test('hostile: a 1 MiB paragraph, 1 MiB of list items and 1 MiB of quote markers stay under 5 seconds', () => {
  const rep = (unit) => unit.repeat(Math.ceil(MAX_BYTES / unit.length)).slice(0, MAX_BYTES);
  const shapes = {
    wrapped: rep(`${'word '.repeat(11)}end\n`),
    wrappedDashes: rep('a — b — c —\n'),
    wrappedLists: rep('ab, cd, and ef,\n'),
    listItems: rep('- x\n'),
    quotes: '>'.repeat(MAX_BYTES),
    quoteLines: rep('> a\n'),
    quoteSpaces: rep('> '),
  };
  for (const [name, text] of Object.entries(shapes)) {
    const ms = timed(text);
    assert.ok(ms < 5000, `${name}: ${ms} ms`);
  }
});

function tmp(files) {
  const dir = mkdtempSync(join(tmpdir(), 'slop-cat-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

test('main keeps every tell of a file with 200k tells and exits 0', () => {
  const dir = tmp({ 'big.md': 'x\n'.repeat(250000) });
  try {
    const rule = { id: 'S99', kind: 'S', label: 'x', re: /^x$/g, unit: 'line' };
    const r = main(['big.md'], { cwd: dir, rules: [rule] });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /slop-scan: 250000 tells, /);
    const walked = main(['.'], { cwd: dir, rules: [rule] });
    assert.equal(walked.code, 0);
    assert.match(walked.stdout, /slop-scan: 250000 tells, /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the root path is shown as a dot in text and json errors', () => {
  const deep = 'a/b/c/d/e/f/g/h/x.md';
  const dir = tmp({ [deep]: 'Fine.\n' });
  try {
    const r = main(['.'], { cwd: dir });
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'ERROR .: limit\n');
    assert.deepEqual(JSON.parse(main(['--json', '.'], { cwd: dir }).stdout).errors, [{ path: '.', reason: 'limit' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('walk reports the links it passes over: symlinks, folder links and hard links', (t) => {
  const dir = tmp({ 'docs/a.md': 'Fine.\n', 'docs/sub/b.md': 'Fine.\n', 'orig.txt': 'x', 'other/c.md': 'Fine.\n', 'docs/pic.png': 'x' });
  try {
    assert.equal(walk(join(dir, 'docs')).links, 0);
    linkSync(join(dir, 'orig.txt'), join(dir, 'docs', 'twin.md'));
    assert.equal(walk(join(dir, 'docs')).links, 1);
    let more = 0;
    try {
      symlinkSync(join(dir, 'other'), join(dir, 'docs', 'linked'), 'junction');
      more++;
    } catch { /* links need rights on some systems */ }
    try {
      symlinkSync(join(dir, 'other', 'c.md'), join(dir, 'docs', 'c-link.md'), 'file');
      more++;
    } catch { /* same */ }
    if (more === 0) return t.skip('links need rights on this system');
    const w = walk(join(dir, 'docs'));
    assert.equal(w.links, 1 + more);
    assert.deepEqual(w.files.map((f) => f.slice(dir.length + 1).replaceAll(String.fromCharCode(92), '/')), ['docs/a.md', 'docs/sub/b.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('walk counts every symlink from lstat alone and never follows one to an unreachable target', (t) => {
  const dir = tmp({ 'docs/a.md': 'Fine.\n' });
  try {
    const target = process.platform === 'win32' ? '\\\\192.0.2.1\\share\\gone' : join(dir, 'nowhere', 'gone');
    let made = 0;
    for (const [name, type] of [['plain', 'file'], ['dirlike', 'junction'], ['doc.md', 'file'], ['pic.png', 'file']]) {
      try {
        symlinkSync(type === 'junction' ? join(dir, 'nowhere') : target, join(dir, 'docs', name), type);
        made++;
      } catch { /* links need rights on some systems */ }
    }
    if (made === 0) return t.skip('links need rights on this system');
    const t0 = Date.now();
    const w = walk(join(dir, 'docs'));
    assert.ok(Date.now() - t0 < 3000, 'no target is touched');
    assert.equal(w.links, made);
    assert.deepEqual(w.errors, []);
    assert.equal(w.files.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the walk of a folder without links reports a count of zero', () => {
  assert.equal(walk(join(root, 'tests', 'slop-scan')).links, 0);
});
