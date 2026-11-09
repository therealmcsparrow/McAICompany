import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, symlinkSync, linkSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wordRule, wordTerms } from './slop-catalog.mjs';
import { scan, main, walk, readInput, mask, countWords, cmp, MAX_BYTES } from './slop-scan.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'slop-scan-')));
  dirs.push(d);
  return d;
};
const put = (root, rel, text) => {
  const full = join(root, ...rel.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// Rules of the tests: the shipped catalog is never used, so filling it cannot break a case here.
const TEST_RULES = [
  wordRule('W90', 'test word', ['plantword']),
  { id: 'S90', kind: 'S', label: 'test shout', re: /SHOUT/g },
];
const run = (root, args) => main(args, { cwd: root, rules: TEST_RULES });

test('reports a tell with line and rule id', () => {
  const root = tmp();
  put(root, 'a.md', 'first line\nsecond plantword here\n');
  const r = run(root, ['a.md']);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, 'a.md:2 W90 test word\nslop-scan: 1 tells, 5 words, 200.0 per 1000 words\n');
});

test('code spans, fences, frontmatter, comments and link targets are ignored', () => {
  const root = tmp();
  put(root, 'a.md', [
    '---', 'title: plantword', '---',
    'ok `plantword` ok',
    '```js', 'plantword', '```',
    '~~~', 'plantword', '~~~',
    '<!-- plantword', 'plantword -->',
    '[link](http://plantword.example) text',
    'plantword real',
  ].join('\n'));
  const r = run(root, ['--json', 'a.md']);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.tells, [{ path: 'a.md', line: 14, rule: 'W90' }]);
});

test('a link text whose ) is on a later line stays scanned', () => {
  assert.equal(scan('a](plantword\nb) c', 'x.md', TEST_RULES).tells.length, 1);
});

test('line numbers survive masking', () => {
  const text = '---\na: b\n---\n```\nx\n```\n\n<!--\nc\n-->\nplantword\n';
  assert.equal(mask(text).split('\n').length, text.split('\n').length);
  assert.deepEqual(scan(text, 'x.md', TEST_RULES).tells.map((t) => t.line), [11]);
});

test('words count tokens with a letter or digit, after masking', () => {
  assert.equal(countWords('a -- b 12 ... ! c3'), 4);
  assert.equal(scan('one `two three` four', 'x.md', TEST_RULES).words, 2);
  assert.equal(scan('', 'x.md', TEST_RULES).words, 0);
});

test('R-11: words count letters and digits of any script, not only ASCII', () => {
  assert.equal(countWords('één 日本語 ٣'), 3);
  assert.equal(countWords('日本語 ... ٣ — Ωmega'), 3);
});

test('R-12: every match is one tell, also two on the same line', () => {
  assert.equal(scan('plantword plantword', 'x.md', TEST_RULES).tells.length, 2);
  assert.deepEqual(scan('plantword and plantword\nplantword', 'x.md', TEST_RULES).tells.map((t) => t.line), [1, 1, 2]);
});

test('R-13: CRLF text gets the same masking, paragraphs, tells and words as LF text', () => {
  const crlf = (x) => x.replace(/\n/g, '\r\n');
  const rules = [...TEST_RULES, { id: 'W91', kind: 'W', label: 'pair', re: /alpha beta/g }];
  const texts = [
    '---\ntitle: plantword\n---\nplantword real\n',
    '---\ntitle: plantword\nbody\n',
    'a\n```js\nplantword\n```\nplantword after\n',
    '~~~\nplantword\n~~~  \nok\n',
    'a\n```js\nplantword one\n``` trailing\nplantword\n',
    'a `plantword b\n\nc` d plantword\n',
    'a `x\nplantword` b\n',
    'alpha\n\nbeta\n',
    'alpha\nbeta\n',
    '> alpha\n> beta\n\n> alpha\n>\n> beta\n',
    '# alpha\nbeta\n',
    'a <!-- plantword\nb -->\nplantword\n',
    'a](plantword\nb) c\n',
  ];
  for (const lf of texts) {
    const a = scan(lf, 'x.md', rules);
    const b = scan(crlf(lf), 'x.md', rules);
    assert.deepEqual(b, a, JSON.stringify(lf));
  }
  // the cases are not all empty: a closed fence hides its tell, a broken one does not
  assert.equal(scan(crlf('a\n```js\nplantword\n```\nplantword after\n'), 'x.md', rules).tells.length, 1);
  assert.equal(scan(crlf('alpha\n\nbeta\n'), 'x.md', rules).tells.length, 0);
  assert.equal(scan(crlf('alpha\nbeta\n'), 'x.md', rules).tells.length, 1);
});

test('malformed: fence with no closing fence is scanned and counted', () => {
  const t = 'intro\n```js\nplantword one two\n``` trailing\n';
  const r = scan(t, 'x.md', TEST_RULES);
  assert.deepEqual(r.tells.map((x) => x.line), [3]);
  assert.equal(r.words, 6);
  // a shorter closing fence does not close, a longer one does
  assert.equal(scan('````\nplantword\n```\nx\n', 'x.md', TEST_RULES).tells.length, 1);
  assert.equal(scan('```\nplantword\n`````\nx\n', 'x.md', TEST_RULES).tells.length, 0);
  // a tilde fence is not closed by backticks
  assert.equal(scan('~~~\nplantword\n```\n', 'x.md', TEST_RULES).tells.length, 1);
});

test('malformed: inline span with no closing run before a blank line is scanned', () => {
  const r = scan('a `plantword b\n\nc` d\n', 'x.md', TEST_RULES);
  assert.equal(r.tells.length, 1);
  assert.equal(r.words, 5);
  // a closing run of another length does not close
  assert.equal(scan('a ``plantword` b', 'x.md', TEST_RULES).tells.length, 1);
  // a span may cross a line inside one paragraph
  assert.equal(scan('a `x\nplantword` b', 'x.md', TEST_RULES).tells.length, 0);
});

test('malformed: <!-- with no --> is scanned and counted', () => {
  const r = scan('a <!-- plantword b\nc\n', 'x.md', TEST_RULES);
  assert.equal(r.tells.length, 1);
  assert.equal(r.words, 4);
});

test('malformed: frontmatter with no closing --- is scanned and counted', () => {
  const r = scan('---\ntitle: plantword\nbody\n', 'x.md', TEST_RULES);
  assert.equal(r.tells.length, 1);
  assert.equal(r.words, 3);
  assert.equal(scan('text\n---\nplantword\n---\n', 'x.md', TEST_RULES).tells.length, 1);
});

test('malformed files still exit 0 with no ERROR', () => {
  const root = tmp();
  put(root, 'a.md', '```\nplantword\n');
  const r = run(root, ['a.md']);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
});

test('exit 2 on bad usage: one stderr line, nothing on stdout', () => {
  const root = tmp();
  for (const args of [[], ['--json'], ['--nope', 'a.md'], ['-x']]) {
    const r = run(root, args);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr.split('\n').filter(Boolean).length, 1);
    assert.ok(!r.stderr.includes('nope'));
  }
});

test('an empty folder is scanned: exit 0, zero figures', () => {
  const root = tmp();
  mkdirSync(join(root, 'empty'));
  const r = run(root, ['empty']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'slop-scan: 0 tells, 0 words, 0.0 per 1000 words\n');
});

test('json output has the contract shape and number per_1000', () => {
  const root = tmp();
  put(root, 'a.md', 'plantword b c d\n');
  const j = JSON.parse(run(root, ['--json', 'a.md']).stdout);
  assert.deepEqual(j, { v: 1, files: 1, words: 4, tells: [{ path: 'a.md', line: 1, rule: 'W90' }], per_1000: 250, errors: [] });
  // one decimal, rounded
  put(root, 'b.md', 'plantword b c\n');
  assert.equal(JSON.parse(run(root, ['--json', 'b.md']).stdout).per_1000, 333.3);
});

test('tells sort by path, line, rule id; paths use /', () => {
  const root = tmp();
  put(root, 'z.md', 'SHOUT plantword\n');
  put(root, 'docs/b.md', 'x\nplantword SHOUT\n');
  put(root, 'docs/a.md', 'plantword\n');
  const lines = run(root, ['z.md', 'docs']).stdout.split('\n');
  assert.deepEqual(lines.slice(0, 5), [
    'docs/a.md:1 W90 test word',
    'docs/b.md:2 S90 test shout',
    'docs/b.md:2 W90 test word',
    'z.md:1 S90 test shout',
    'z.md:1 W90 test word',
  ]);
});

test('paths sort by code point, not UTF-16 unit', () => {
  assert.equal(cmp('～', '\u{10000}'), -1);
  assert.equal(cmp('a', 'ab'), -1);
  const root = tmp();
  put(root, '～.md', 'plantword\n');
  put(root, '\u{10000}.md', 'plantword\n');
  const lines = run(root, ['.']).stdout.split('\n');
  assert.equal(lines[0].startsWith('～.md:1'), true);
  assert.equal(lines[1].startsWith('\u{10000}.md:1'), true);
});

test('two runs are byte-equal', () => {
  const root = tmp();
  put(root, 'a.md', 'plantword SHOUT\n');
  put(root, 'sub/b.txt', 'plantword\n');
  put(root, 'sub/c.markdown', 'nothing\n');
  const a = run(root, ['--json', '.']);
  const b = run(root, ['--json', '.']);
  assert.deepEqual(a, b);
  assert.equal(JSON.parse(a.stdout).files, 3);
});

test('a file reached by two named paths is scanned once', () => {
  const root = tmp();
  put(root, 'd/a.md', 'plantword\n');
  const j = JSON.parse(run(root, ['--json', 'd/a.md', 'd', './d/../d/a.md']).stdout);
  assert.equal(j.files, 1);
  assert.equal(j.tells.length, 1);
});

test('missing, type, too large, not utf-8: exit 1, ERROR lines, rest still scanned', () => {
  const root = tmp();
  put(root, 'ok.md', 'plantword\n');
  put(root, 'a.png', 'x');
  put(root, 'big.md', 'a'.repeat(MAX_BYTES + 1));
  writeFileSync(join(root, 'bin.md'), Buffer.from([0x61, 0xff, 0xfe, 0x62]));
  const r = run(root, ['ok.md', 'nope.md', 'a.png', 'big.md', 'bin.md']);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'ERROR a.png: type\nERROR big.md: too large\nERROR bin.md: not utf-8\nERROR nope.md: missing\n');
  assert.match(r.stdout, /^ok\.md:1 W90 test word\nslop-scan: 1 tells, 1 words/);
  const j = JSON.parse(run(root, ['--json', 'ok.md', 'nope.md']).stdout);
  assert.deepEqual(j.errors, [{ path: 'nope.md', reason: 'missing' }]);
  assert.equal(j.files, 1);
  // the contract prints ERROR on stderr in both modes
  assert.equal(run(root, ['--json', 'ok.md', 'nope.md']).stderr, 'ERROR nope.md: missing\n');
});

test('a wrong-case spelling below .company/work is missing, not a link', () => {
  const root = tmp();
  put(root, '.company/work/x.md', 'plantword\n');
  const r = run(root, ['.company/work/X.md']);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'ERROR .company/work/X.md: missing\n');
  assert.equal(run(root, ['.company/work/x.md']).code, 0);
});

test('a wrong-case .company or work folder spelling is missing, not a link', () => {
  const root = tmp();
  put(root, '.company/work/x.md', 'plantword\n');
  for (const arg of ['.company/WORK/x.md', '.COMPANY/work/x.md']) {
    const r = run(root, [arg]);
    assert.equal(r.code, 1, arg);
    assert.equal(r.stderr, `ERROR ${arg}: missing\n`, arg);
  }
});

test('R-14: a path holding NUL is unreadable', () => {
  const root = tmp();
  const r = run(root, ['a\0b.md']);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'ERROR a?b.md: unreadable\n');
  assert.deepEqual(JSON.parse(run(root, ['--json', 'a\0b.md']).stdout).errors, [{ path: 'a?b.md', reason: 'unreadable' }]);
});

test('a file of exactly 1 MiB is read', () => {
  assert.equal(MAX_BYTES, 1048576);
  const root = tmp();
  put(root, 'm.md', 'a'.repeat(MAX_BYTES));
  assert.equal(run(root, ['m.md']).code, 0);
});

test('a path outside the root and a hard link are link errors', () => {
  const root = tmp();
  const other = tmp();
  put(other, 'x.md', 'plantword\n');
  put(root, 'h.md', 'plantword\n');
  linkSync(join(root, 'h.md'), join(root, 'h2.md'));
  const r = run(root, [join(other, 'x.md'), '../x.md', 'h.md']);
  assert.equal(r.code, 1);
  assert.equal(r.stdout.includes('plantword'), false);
  const reasons = r.stderr.split('\n').filter(Boolean).map((l) => l.split(': ').pop());
  assert.deepEqual(reasons, ['link', 'link', 'link']);
});

test('a junction or symlink, named or in the path, is a link error; one in a walk is skipped silently', () => {
  const root = tmp();
  put(root, 'real/a.md', 'plantword\n');
  symlinkSync(join(root, 'real'), join(root, 'dirlink'), 'junction');
  const args = ['dirlink', 'dirlink/a.md'];
  try {
    symlinkSync(join(root, 'real', 'a.md'), join(root, 'filelink.md'), 'file');
    args.push('filelink.md');
  } catch { /* file links need rights on some systems */ }
  const named = run(root, args);
  assert.equal(named.code, 1);
  assert.deepEqual(named.stderr.split('\n').filter(Boolean).map((l) => l.split(': ').pop()), args.map(() => 'link'));
  assert.equal(named.stdout.includes('W90'), false);
  const walked = run(root, ['.']);
  assert.equal(walked.code, 0);
  assert.equal(walked.stdout.split('\n').filter((l) => l.includes('W90')).length, 1);
});

test('control characters in a name are never printed raw', () => {
  const root = tmp();
  const bad = ['\u009b', '\u2028', '\u2029', '\u2066', '\u2069', '\u200e', '\u200f', '\u202a', '\u0085'];
  const outside = join(tmp(), 'o\u009b\u2028\u001b.md');
  const r = run(root, ['a\nb\u001b[31m.md', 'c\u202ed.md', ...bad.map((c, i) => `e${i}${c}f.md`), outside, `../x${bad[0]}${bad[1]}.md`]);
  assert.equal(r.code, 1);
  // eslint-disable-next-line no-control-regex
  assert.equal(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(r.stderr), false);
  assert.equal(r.stderr.split('\n').filter(Boolean).length, 2 + bad.length + 2);
  assert.match(r.stderr, /^ERROR \.\.\/x\?\?\.md: link$/m);
  assert.equal(r.stderr.includes('o??'), true);
  assert.match(r.stderr, /^ERROR a\?b\?\[31m\.md: missing$/m);
  const j = run(root, ['--json', 'a\nb.md']);
  assert.equal(JSON.parse(j.stdout).errors[0].path, 'a?b.md');
});

test('dot-named entries below a named folder are skipped; a named file may sit in a dot folder', () => {
  const root = tmp();
  put(root, 'd/.hidden/a.md', 'plantword\n');
  put(root, 'd/.dot.md', 'plantword\n');
  put(root, 'd/ok.md', 'x\n');
  put(root, '.git/n.md', 'plantword\n');
  const walked = run(root, ['d']);
  assert.equal(walked.code, 0);
  assert.equal(walked.stdout.includes('W90'), false);
  const named = run(root, ['.git/n.md', 'd/.hidden']);
  assert.equal(named.stdout.includes('.git/n.md:1 W90'), true);
  assert.equal(named.stdout.includes('.hidden'), true);
});

test('walk: depth 6 below the named folder is allowed, depth 7 reports limit and keeps what was walked', () => {
  const root = tmp();
  put(root, 'd/a.md', 'plantword\n');
  put(root, 'd/1/2/3/4/5/6/deep.md', 'plantword\n');
  put(root, 'd/1/2/3/4/5/6/7/toodeep.md', 'plantword\n');
  const r = run(root, ['d']);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'ERROR d: limit\n');
  assert.equal(r.stdout.includes('d/1/2/3/4/5/6/deep.md:1'), true);
  assert.equal(r.stdout.includes('toodeep'), false);
  assert.equal(r.stdout.includes('d/a.md:1'), true);
});

test('walk: more than 2000 files in a run reports limit; the first 2000 stay', () => {
  const root = tmp();
  for (let i = 0; i < 2001; i++) put(root, `f/${String(i).padStart(4, '0')}.md`, 'a\n');
  const w = walk(join(root, 'f'));
  assert.equal(w.files.length, 2000);
  assert.deepEqual(w.errors, [{ reason: 'limit' }]);
  // code point order of the walk decides which 2000 stay
  assert.equal(w.files[0].endsWith('0000.md'), true);
  assert.equal(w.files[1999].endsWith('1999.md'), true);
  const r = run(root, ['--json', 'f']);
  assert.equal(r.code, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j.files, 2000);
  assert.deepEqual(j.errors, [{ path: 'f', reason: 'limit' }]);
  // exactly 2000 is fine
  const root2 = tmp();
  for (let i = 0; i < 2000; i++) put(root2, `f/${i}.md`, 'a\n');
  assert.equal(run(root2, ['f']).code, 0);
});

test('walk: the 2000 file limit counts all named folders together', () => {
  const root = tmp();
  for (let i = 0; i < 1000; i++) put(root, `a/${i}.md`, 'a\n');
  for (let i = 0; i < 1001; i++) put(root, `b/${i}.md`, 'a\n');
  const r = run(root, ['--json', 'a', 'b']);
  assert.equal(r.code, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j.files, 2000);
  assert.deepEqual(j.errors, [{ path: 'b', reason: 'limit' }]);
});

test('walk: hard links, other extensions and links are skipped silently below a named folder', () => {
  const root = tmp();
  put(root, 'd/ok.md', 'plantword\n');
  put(root, 'd/h.md', 'plantword\n');
  linkSync(join(root, 'd', 'h.md'), join(root, 'd', 'h2.md'));
  put(root, 'd/pic.png', 'x');
  const w = walk(join(root, 'd'));
  assert.deepEqual(w.files.map((f) => f.split(/[\\/]/).pop()), ['ok.md']);
  assert.equal(w.links, 2);
  const r = run(root, ['d']);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout.includes('d/ok.md:1 W90'), true);
  assert.equal(r.stdout.includes('png'), false);
});

test('a walked file gets the same too large, not utf-8 errors as a named one', () => {
  const root = tmp();
  put(root, 'd/big.md', 'a'.repeat(MAX_BYTES + 1));
  writeFileSync(join(root, 'd', 'bad.txt'), Buffer.from([0xc3, 0x28]));
  put(root, 'd/ok.md', 'plantword\n');
  const r = run(root, ['d']);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'ERROR d/bad.txt: not utf-8\nERROR d/big.md: too large\n');
  assert.equal(r.stdout.includes('d/ok.md:1 W90'), true);
});

test('R-15: the CLI exits 1 with the stderr line and exits 2 on bad usage', () => {
  const root = tmp();
  put(root, 'ok.md', 'plantword here\n');
  const cli = join(dirname(fileURLToPath(import.meta.url)), 'slop-scan.mjs');
  const spawn = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  const one = spawn(['ok.md', 'nope.md']);
  assert.equal(one.status, 1);
  assert.equal(one.stderr, 'ERROR nope.md: missing\n');
  assert.match(one.stdout, /^slop-scan: \d+ tells, 2 words, [\d.]+ per 1000 words\n$/);
  const two = spawn([]);
  assert.equal(two.status, 2);
  assert.equal(two.stdout, '');
  assert.equal(two.stderr.split('\n').filter(Boolean).length, 1);
  assert.equal(spawn(['ok.md']).status, 0);
});

test('readInput never rewrites the file', () => {
  const root = tmp();
  put(root, 'a.md', 'plantword\r\nline\r\n');
  const before = readFileSync(join(root, 'a.md'));
  const r = readInput('a.md', { cwd: root });
  assert.equal(r.text, 'plantword\r\nline\r\n');
  run(root, ['a.md']);
  assert.deepEqual(readFileSync(join(root, 'a.md')), before);
});

test('R-18: a run writes nothing: no file, folder or metadata changes, and the provider calls no fs write', () => {
  const root = tmp();
  put(root, 'a.md', 'plantword\n');
  put(root, 'd/b.txt', 'plantword\n');
  put(root, 'd/big.md', 'a'.repeat(MAX_BYTES + 1));
  put(root, 'd/pic.png', 'x');
  const listing = () => {
    const out = [];
    const visit = (dir) => {
      for (const n of readdirSync(dir).sort()) {
        const full = join(dir, n);
        const st = statSync(full);
        out.push(`${full} ${st.isDirectory() ? 'dir' : st.size} ${st.mtimeMs}`);
        if (st.isDirectory()) visit(full);
      }
    };
    visit(root);
    return out;
  };
  const before = listing();
  run(root, ['a.md', 'd', 'nope.md']);
  run(root, ['--json', '.']);
  assert.deepEqual(listing(), before);
  const here = dirname(fileURLToPath(import.meta.url));
  const banned = /\bfs\.(?:write|append|mkdir|mkdtemp|rm|rmdir|unlink|rename|copyFile|cp|truncate|ftruncate|chmod|chown|lchown|fchmod|fchown|utimes|futimes|lutimes|symlink|link|createWriteStream|promises)/;
  for (const file of ['slop-scan.mjs', 'slop-catalog.mjs']) {
    const src = readFileSync(join(here, file), 'utf8');
    assert.equal(banned.test(src), false, `${file} calls an fs write`);
    assert.equal(/import\s*\{[^}]*\}\s*from\s*['"](?:node:)?fs(?:\/promises)?['"]/.test(src), false, `${file} imports fs names`);
    assert.equal(/O_(?:WRONLY|RDWR|CREAT|APPEND|TRUNC)|node:fs\/promises/.test(src), false, `${file} opens for writing`);
  }
});

test('a rule id outside ^[WS]\\d{2}$ is refused', () => {
  assert.throws(() => scan('x', 'a.md', [{ id: 'X01', kind: 'W', label: 'x', re: /x/g }]), /bad rule id/);
});

test('wordTerms lists the plain terms of the rules it is given', () => {
  assert.deepEqual(wordTerms(TEST_RULES), ['plantword']);
});

test('hostile: 1 MiB single-line adversarial text goes through scan in under 5 seconds', () => {
  const rules = [...TEST_RULES, wordRule('W91', 'prefix', ['delve', 'delving', 'plantwords'])];
  const unit = '` `` ``` ```` <!-- ](  delv delvin plantwor plantword' + ' '.repeat(20);
  const shapes = [
    unit.repeat(Math.ceil(MAX_BYTES / unit.length)),
    '<!--'.repeat(MAX_BYTES / 4),
    '`'.repeat(MAX_BYTES),
    '` '.repeat(MAX_BYTES / 2),
    '](`'.repeat(MAX_BYTES / 3),
    ' '.repeat(MAX_BYTES - 1) + 'x',
    'delvedelvedelv'.repeat(Math.ceil(MAX_BYTES / 14)),
    Array.from({ length: 1400 }, (_, i) => '`'.repeat(i + 1)).join(' '),
  ].map((s) => s.slice(0, MAX_BYTES));
  for (const text of shapes) {
    const t0 = Date.now();
    scan(text, 'x.md', rules);
    assert.ok(Date.now() - t0 < 5000, `slow shape: ${text.slice(0, 20)}`);
  }
});

test('hostile: descending unclosed fence lengths cost one pass, not one pass per length', () => {
  let text = '';
  for (let n = 1400; n >= 3; n--) text += `${'`'.repeat(n)}\n`;
  text = (text + 'a\n'.repeat(400000)).slice(0, MAX_BYTES);
  const t0 = Date.now();
  const out = mask(text);
  assert.ok(Date.now() - t0 < 400, `slow mask: ${Date.now() - t0} ms`);
  assert.match(out, /^`{1400}\n/, 'unclosed fence text stays');
});

test('R-16: unclosable openers cost one pass, not one pass per opener', () => {
  // 30000 openers that can never close (an info string) before 120000 plain lines: a search from each opener is 3.6e9 steps
  const text = '```x\n'.repeat(30000) + 'a\n'.repeat(120000);
  assert.ok(text.length < MAX_BYTES);
  const t0 = Date.now();
  const out = mask(text);
  assert.ok(Date.now() - t0 < 750, `slow mask: ${Date.now() - t0} ms`);
  assert.equal(out, text, 'unclosed fence text stays');
});

test('hostile: mask is linear on many lines and unclosed fences', () => {
  const shapes = [
    '```x\n'.repeat(200000),
    Array.from({ length: 1400 }, (_, i) => '`'.repeat(i + 3)).join('\n'),
    'a `b\nc\n'.repeat(100000),
    '<!--\n'.repeat(200000),
  ].map((s) => s.slice(0, MAX_BYTES));
  for (const text of shapes) {
    const t0 = Date.now();
    mask(text);
    assert.ok(Date.now() - t0 < 5000, `slow mask: ${text.slice(0, 12)}`);
  }
});

test('R-17: the provider imports no network, process or other unlisted module and calls no fetch', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const allowed = new Set(['node:fs', 'node:path', 'node:url', './slop-catalog.mjs', '../mods/lib/work-folder.mjs']);
  // every specifier: `from '...'` (also across lines and in export-from) and a side-effect `import '...'`
  const specsOf = (src) => [...src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g), ...src.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const file of ['slop-scan.mjs', 'slop-catalog.mjs']) {
    const src = readFileSync(join(here, file), 'utf8');
    for (const spec of specsOf(src)) assert.ok(allowed.has(spec), `${file} imports ${spec}`);
    assert.equal(/\bimport\s*\(/.test(src), false);
    assert.equal(/\brequire\s*\(/.test(src), false);
    assert.equal(/getBuiltinModule|createRequire|process\.binding|\bmodule\.require/.test(src), false, `${file} loads a module by other means`);
    assert.equal(/\bfetch\s*\(|child_process|XMLHttpRequest|WebSocket/.test(src), false);
  }
  // the check sees what it claims to
  assert.deepEqual(specsOf("import {\n  connect,\n} from\n 'net';\nimport 'net';"), ['net', 'net']);
});

test('line 2 holds the contract header', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const file of ['slop-scan.mjs']) {
    const line2 = readFileSync(join(here, file), 'utf8').split('\n')[1];
    assert.match(line2, /^\/\/ Slop scan \(contract: docs\/contracts\/slop-scan\.md v1.1\)\./);
  }
});
