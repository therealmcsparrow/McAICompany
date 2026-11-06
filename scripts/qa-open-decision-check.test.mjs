// Acceptance tests for the open-decision check: the scanner, the pattern file, the per-run record and its reader,
// the plan-check CLI, the verdict and history CLI, and the skill texts that wire the check into the Gates.
// Every test works in a temp folder. Git tests use a per-test git config file, no system config and fixed committer
// names. HOME and the plugin home point at temp folders, never at the real ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const here = import.meta.dirname;
const repoRoot = path.join(here, '..');
const CHECK = path.join(here, 'plan-check.mjs');
const VERDICT = path.join(here, 'plan-check-verdict.mjs');
const LEDGER = path.join(here, 'ledger.mjs');
const PATTERN_FILE = path.join(here, 'plan-check-patterns.json');
const FIXTURES = path.join(here, 'fixtures', 'plan-check');
const LEDGER_FIXTURES = path.join(here, 'fixtures', 'ledger-v1');

const lib = () => import('./plan-check.mjs');
const verdictLib = () => import('./plan-check-verdict.mjs');

const DEFAULTS = {
  v: 1,
  patterns: [
    { id: 'tbd', re: '\\bTBD\\b', flags: '', why: 'a placeholder: the plan does not say what to build here' },
    { id: 'todo', re: '\\bTODO\\b', flags: '', why: 'work the plan has not settled' },
    { id: 'decide-later', re: '\\bdecide later\\b', flags: 'i', why: 'a choice put off past the Plan Gate' },
    { id: 'open-choice', re: '^.* or .*\\?\\s*$', flags: '', why: 'an open either-or question: the plan has not picked one' }
  ]
};
const WHY = Object.fromEntries(DEFAULTS.patterns.map((p) => [p.id, p.why]));
const FENCE_WHY = 'an unclosed code fence hides the rest of the plan from the check';

// ---------- helpers ----------

function tmp(t, name = 'qa-odc') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'root');
  const home = path.join(base, 'home');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { base, root, home };
}

function envFor(home, extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k === 'XDG_CONFIG_HOME') delete env[k];
  const gitConfig = path.join(home, 'gitconfig');
  fs.writeFileSync(gitConfig, '');
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    MCSPARROW_HOME: path.join(home, '.mcsparrow'),
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    ...extra
  };
}

function runNode(script, env, root, args) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env, timeout: 60000 });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const outLines = (s) => s.split('\n').filter((l) => l !== '');

function makeEnv(ctx) {
  const env = envFor(ctx.home);
  return {
    check: (...args) => runNode(CHECK, env, ctx.root, args),
    verdict: (...args) => runNode(VERDICT, env, ctx.root, args),
    ledger: (...args) => runNode(LEDGER, env, ctx.root, args),
    env
  };
}

function git(ctx, args, date) {
  const extra = {
    GIT_AUTHOR_NAME: 'QA Tester',
    GIT_AUTHOR_EMAIL: 'qa@example.invalid',
    GIT_COMMITTER_NAME: 'QA Tester',
    GIT_COMMITTER_EMAIL: 'qa@example.invalid'
  };
  if (date) {
    extra.GIT_AUTHOR_DATE = date;
    extra.GIT_COMMITTER_DATE = date;
  }
  const r = spawnSync('git', args, { cwd: ctx.root, encoding: 'utf8', env: envFor(ctx.home, extra) });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function gitInit(ctx) {
  git(ctx, ['init', '-q']);
}

function commitAll(ctx, date, msg = 'c') {
  git(ctx, ['add', '-A']);
  git(ctx, ['commit', '-q', '--no-gpg-sign', '-m', msg], date);
  return git(ctx, ['rev-parse', 'HEAD']).trim();
}

function put(root, rel, text) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

const runDir = (root, slug) => path.join(root, '.company', 'work', slug);
const recordFile = (root, slug) => path.join(runDir(root, slug), 'plan-check.jsonl');

function mkRun(root, slug, planText, planName = '02-plan.md') {
  fs.mkdirSync(runDir(root, slug), { recursive: true });
  if (planText !== undefined) fs.writeFileSync(path.join(runDir(root, slug), planName), planText);
}

function snapshot(dir, skip = ['.git']) {
  const out = {};
  const walk = (d, rel) => {
    for (const name of fs.readdirSync(d).sort()) {
      if (rel === '' && skip.includes(name)) continue;
      const full = path.join(d, name);
      const key = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(full, key);
      else if (st.isFile()) out[key] = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      else out[key] = 'link';
    }
  };
  walk(dir, '');
  return out;
}

const AT = '2026-10-28T10:00:00Z';
const HASH = '0123456789ab';
const R = {
  scan: (o = {}) => ({ v: 1, at: AT, ev: 'scan', policy: 'warn', plan: '02-plan.md', patterns: HASH, findings: 0, decided: 0, ...o }),
  off: (o = {}) => ({ v: 1, at: AT, ev: 'off', policy: 'off', ...o }),
  wave: (waved, o = {}) => ({ v: 1, at: AT, ev: 'wave', waved, ...o }),
  error: (o = {}) => ({ v: 1, at: AT, ev: 'error', policy: 'warn', reason: 'patterns', ...o })
};

function writeRecord(root, slug, lines) {
  mkRun(root, slug);
  const text = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
  fs.writeFileSync(recordFile(root, slug), text);
}

const readRecordLines = (root, slug) => fs.readFileSync(recordFile(root, slug), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function scan(text, patterns = DEFAULTS.patterns, file = '02-plan.md') {
  const { scanText } = await lib();
  return scanText(text, patterns, { file });
}

const SECTION = '## Steps\n';
const inSteps = (...lines) => `${SECTION}${lines.join('\n')}\n`;

function manyTbd(n) {
  return `# Plan\n\n## Tasks\n${Array.from({ length: n }, (_, i) => `- item ${i + 1} TBD`).join('\n')}\n`;
}

// ---------- module surface ----------

test('the scanner module exports its public interface', async () => {
  const m = await lib();
  for (const name of ['loadPatterns', 'scanText', 'readRecord', 'main']) assert.equal(typeof m[name], 'function', name);
  assert.equal(typeof m.PlanCheckRecordError, 'function');
  assert.ok(new m.PlanCheckRecordError('x') instanceof Error);
  const v = await verdictLib();
  assert.equal(typeof v.main, 'function');
});

// ---------- scan rules ----------

test('AC1 AC2 AC3 AC10 the mixed fixture plan gives exactly the expected findings', async () => {
  const text = fs.readFileSync(path.join(FIXTURES, 'mixed-plan.md'), 'utf8');
  const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'mixed-plan.expected.json'), 'utf8'));
  const r = await scan(text);
  assert.equal(r.decided, expected.decided);
  assert.deepEqual(r.findings.map((f) => ({ line: f.line, id: f.id, phrase: f.phrase })), expected.findings);
  for (const f of r.findings) {
    assert.equal(f.file, '02-plan.md');
    assert.equal(f.why, WHY[f.id]);
    assert.deepEqual(Object.keys(f).sort(), ['file', 'id', 'line', 'phrase', 'why']);
  }
});

test('AC1 only Steps, Tasks, Wave, Phase, Fix round, T<n> and M<n> sections count, at level 2 or 3, case-insensitive', async () => {
  const cases = [
    ['## Steps\nTBD', 1],
    ['### Tasks\nTBD', 1],
    ['## Wave 1\nTBD', 1],
    ['### phase B\nTBD', 1],
    ['## FIX ROUND 2\nTBD', 1],
    ['### T1 checker\nTBD', 1],
    ['## M3\nTBD', 1],
    ['# Wave 1\nTBD', 0],
    ['#### T1\nTBD', 0],
    ['## Test notes\nTBD', 0],
    ['## Fixes\nTBD', 0],
    ['## Overview\n**T1 build** TBD', 0],
    ['## tasks and more\nTBD', 1],
    ['### STEPS\nTBD', 1],
    ['# Steps\nTBD', 0],
    ['#### Steps\nTBD', 0],
    ['## Overview\nTBD', 0],
    ['TBD\n## Steps\n', 0],
    ['Steps\n=====\nTBD', 0]
  ];
  for (const [text, count] of cases) {
    const r = await scan(text);
    assert.equal(r.findings.length, count, JSON.stringify(text));
  }
});

test('AC1 a section ends at the next heading of the same or a lower level number; deeper headings are content', async () => {
  const text = [
    '## Steps', 'a TBD', '### Deeper', 'b TBD', '#### Deepest', 'c TBD', '## Next', 'd TBD',
    '### Tasks', 'e TBD', '# Top', 'f TBD', '### Tasks', 'g TODO', '### Other', 'h TODO'
  ].join('\n');
  const r = await scan(text);
  assert.deepEqual(r.findings.map((f) => f.line), [2, 4, 6, 10, 14]);
});

test('AC1 a setext underline is not a section boundary', async () => {
  const r = await scan('## Steps\na TBD\nTitle\n-----\nb TBD\n');
  assert.deepEqual(r.findings.map((f) => f.line), [2, 5]);
});

test('AC1 a plan with no section, and an empty plan, give no findings and no decided lines', async () => {
  for (const text of ['', '\n\n', '# Plan\nTBD\nDecided: x because y\n']) {
    const r = await scan(text);
    assert.deepEqual(r, { findings: [], decided: 0 });
  }
});

test('AC2 fences: backtick, tilde, longer fence, info string, and a fence that hides a heading', async () => {
  const cases = [
    ['```\nTBD\n```', 0],
    ['~~~\nTBD\n~~~', 0],
    ['```js\nTBD\n```', 0],
    ['   ```\nTBD\n   ```', 0],
    ['````\n```\nTBD\n```\n````', 0],
    ['~~~~\n~~~\nTBD\n~~~~', 0],
    ['~~~\n```\nTBD\n```\n~~~', 0],
    ['```\nTBD\n```\nTBD', 1],
    ['    ```\nTBD', 1],
    ['```\nx\n``` trailing\nTBD\n```', 0]
  ];
  for (const [body, count] of cases) {
    const r = await scan(inSteps(body));
    assert.equal(r.findings.filter((f) => f.id !== 'unclosed-fence').length, count, JSON.stringify(body));
    assert.equal(r.findings.filter((f) => f.id === 'unclosed-fence').length, 0, JSON.stringify(body));
  }
  const hidden = await scan('```\n## Steps\n```\nTBD\n');
  assert.deepEqual(hidden.findings, []);
});

test('AC2 inline code spans are removed before matching', async () => {
  const cases = [
    ['use `TBD` here', 0],
    ['use ``a ` TBD`` here', 0],
    ['use ```TODO``` here', 0],
    ['`decide later` and `TODO`', 0],
    ['`x` TBD', 1],
    ['an open ` TBD without a closing run', 1],
    ['`one` and ``two`` then TODO', 1],
    ['pick `A` or `B`?', 1]
  ];
  for (const [line, count] of cases) {
    const r = await scan(inSteps(line));
    assert.equal(r.findings.length, count, line);
  }
});

test('AC2 a blockquote line is skipped, however it is indented', async () => {
  const r = await scan(inSteps('> TBD', '   > TODO', '>decide later', '- > TBD'));
  assert.deepEqual(r.findings.map((f) => f.line), [5]);
});

test('AC2 AC10 a full Decided line is skipped and counted; the broken shapes are scanned', async () => {
  const text = inSteps(
    'Decided: use TBD because we said so',
    '- Decided: A or B? because speed',
    '  1. Decided: x because TODO later',
    '2) Decided: y because z',
    'Decided: A or B?',
    'Decided: x because',
    'Decided:  because y TBD',
    'decided: x because TBD',
    '* Decided TBD because y'
  );
  const r = await scan(text);
  assert.equal(r.decided, 4);
  assert.deepEqual(r.findings.map((f) => f.line), [6, 8, 9, 10]);
});

test('AC10 Decided lines outside every section are not counted', async () => {
  const r = await scan('Decided: a because b\n## Steps\nDecided: c because d\n## Other\nDecided: e because f\n');
  assert.equal(r.decided, 1);
});

test('AC3 each default pattern gives one finding with file, line, phrase and why', async () => {
  const cases = [
    ['Pick the store, TBD', 'tbd', 'TBD'],
    ['Finish TODO soon', 'todo', 'TODO'],
    ['We will decide later.', 'decide-later', 'decide later'],
    ['We Will DECIDE LATER.', 'decide-later', 'DECIDE LATER'],
    ['Files or SQLite?', 'open-choice', 'Files or SQLite?'],
    ['Files or SQLite?   ', 'open-choice', 'Files or SQLite?']
  ];
  for (const [line, id, phrase] of cases) {
    const r = await scan(inSteps(line));
    assert.equal(r.findings.length, 1, line);
    assert.deepEqual(r.findings[0], { file: '02-plan.md', line: 2, id, phrase, why: WHY[id] });
  }
});

test('AC3 near misses give no finding', async () => {
  const lines = ['tbd', 'Tbd', 'TBDX', 'XTBD', 'TBD_1', 'todo', 'TODOS', 'decided later', 'decide  later now', 'Is it ready?', 'Files or SQLite', 'Files or? SQLite', 'Files orSQLite?', 'Anchor?', '?'];
  const r = await scan(inSteps(...lines));
  assert.deepEqual(r.findings, []);
});

test('AC3 a line with several matches gives exactly one finding, the first pattern in file order', async () => {
  const r = await scan(inSteps('TBD and TODO and decide later or not?'));
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'tbd');
  const reversed = await scan(inSteps('TBD and TODO and decide later or not?'), [...DEFAULTS.patterns].reverse());
  assert.equal(reversed.findings.length, 1);
  assert.equal(reversed.findings[0].id, 'open-choice');
});

test('AC3 a deeper heading inside a section is scanned as a content line', async () => {
  const r = await scan(inSteps('#### Pick A or B?'));
  assert.deepEqual(r.findings.map((f) => [f.line, f.id]), [[2, 'open-choice']]);
});

test('AC3 line numbers are 1-based; CR LF and a lone CR each count as one line break', async () => {
  const lf = await scan('## Steps\na\nTBD\n');
  const crlf = await scan('## Steps\r\na\r\nTBD\r\n');
  const cr = await scan('## Steps\ra\rTBD\r');
  const mixed = await scan('## Steps\r\na\nb\rTBD');
  assert.deepEqual(lf.findings.map((f) => f.line), [3]);
  assert.deepEqual(crlf.findings.map((f) => f.line), [3]);
  assert.deepEqual(cr.findings.map((f) => f.line), [3]);
  assert.deepEqual(mixed.findings.map((f) => f.line), [4]);
  assert.equal(crlf.findings[0].phrase, 'TBD');
});

test('AC3 phrase: control characters and backticks out, bar to slash, spaces collapsed, cut at 60 code points', async () => {
  const bell = String.fromCharCode(7);
  const esc = String.fromCharCode(27);
  const cases = [
    [`- pick${bell} A | B or ${esc}C?`, '- pick A / B or C?'],
    ['- a ` or b?', '- a or b?'],
    ['-   many     spaces   and more or x?', '- many spaces and more or x?'],
    ['- use `x` or y?', '- use or y?']
  ];
  for (const [line, phrase] of cases) {
    const r = await scan(inSteps(line));
    assert.equal(r.findings.length, 1, line);
    assert.equal(r.findings[0].phrase, phrase);
  }
  const long = `- ${'\u{1F600}'.repeat(70)} or x?`;
  const cut = await scan(inSteps(long));
  assert.equal(cut.findings[0].phrase, `- ${'\u{1F600}'.repeat(58)}…`);
  const exact = await scan(inSteps(`- ${'a'.repeat(52)} or x?`));
  assert.equal([...exact.findings[0].phrase].length, 60);
  assert.ok(!exact.findings[0].phrase.endsWith('…'));
});

test('AC3 findings are sorted by line', async () => {
  const many = await scan(inSteps('TBD', 'TODO', 'x or y?', 'decide later'));
  const lines = many.findings.map((f) => f.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
});

test('a line over 4000 characters gives one long-line finding and is not matched; 4000 is scanned', async () => {
  const long = `TBD ${'x'.repeat(4000)}`;
  const r = await scan(inSteps(long));
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].file, '02-plan.md');
  assert.equal(r.findings[0].line, 2);
  assert.equal(r.findings[0].id, 'long-line');
  assert.equal(r.findings[0].why, 'line too long to check');
  const edge = await scan(inSteps(`TBD ${'x'.repeat(3996)}`));
  assert.equal(edge.findings.length, 1);
  assert.equal(edge.findings[0].id, 'tbd');
  const outside = await scan(`${'y'.repeat(5000)}\n${SECTION}ok\n`);
  assert.deepEqual(outside.findings, []);
});

test('an unclosed fence gives one finding at its opening line, wherever it opened', async () => {
  const inside = await scan('## Steps\nTBD\n```\nTBD\nTODO\n');
  assert.deepEqual(inside.findings.map((f) => [f.line, f.id]), [[2, 'tbd'], [3, 'unclosed-fence']]);
  assert.equal(inside.findings[1].why, FENCE_WHY);
  const outside = await scan('# Plan\n~~~\n## Steps\nTBD\n');
  assert.deepEqual(outside.findings.map((f) => [f.line, f.id]), [[2, 'unclosed-fence']]);
  const short = await scan('## Steps\n````\n```\nTBD\n');
  assert.deepEqual(short.findings.map((f) => [f.line, f.id]), [[2, 'unclosed-fence']]);
});

test('hostile text: a megabyte of one line, a thousand open fences and odd bytes finish at once', async () => {
  const started = performance.now();
  const a = await scan(inSteps('x'.repeat(1_000_000)));
  assert.equal(a.findings[0].id, 'long-line');
  const b = await scan(inSteps(...Array.from({ length: 2000 }, () => '````')));
  assert.ok(b.findings.length <= 2000);
  const c = await scan(inSteps('\u0000\u0001 TBD ￿', '‮ TODO'));
  assert.deepEqual(c.findings.map((f) => f.id), ['tbd', 'todo']);
  assert.ok(performance.now() - started < 3000);
});

test('every default pattern runs in under 50 ms on a 4000-character adversarial line', async () => {
  const { loadPatterns } = await lib();
  const { patterns } = loadPatterns(PATTERN_FILE);
  const lines = [
    'a'.repeat(4000),
    ' or '.repeat(1000),
    `${' or '.repeat(999)}x`,
    `?${' '.repeat(3998)}x`,
    `${'x or '.repeat(790)}${' '.repeat(40)}`,
    'TBD'.repeat(1333),
    `${'decide '.repeat(570)}later`,
    '\t'.repeat(4000)
  ];
  for (const p of patterns) {
    for (const line of lines) {
      assert.ok(line.length <= 4000);
      const started = performance.now();
      await scan(inSteps(line), [p]);
      const ms = performance.now() - started;
      assert.ok(ms < 50, `${p.id} took ${ms.toFixed(1)} ms`);
    }
  }
});

// ---------- pattern file ----------

test('AC4 the shipped pattern file holds the four default entries and loads with a 12-hex hash of its bytes', async () => {
  const { loadPatterns } = await lib();
  const raw = JSON.parse(fs.readFileSync(PATTERN_FILE, 'utf8'));
  assert.equal(raw.v, 1);
  assert.deepEqual(raw.patterns.map((p) => [p.id, p.re, p.flags ?? '', p.why]), DEFAULTS.patterns.map((p) => [p.id, p.re, p.flags, p.why]));
  assert.ok(fs.statSync(PATTERN_FILE).size <= 16 * 1024);
  const loaded = loadPatterns();
  assert.equal(loaded.patterns.length, 4);
  assert.match(loaded.hash, /^[0-9a-f]{12}$/);
  assert.equal(loaded.hash, createHash('sha256').update(fs.readFileSync(PATTERN_FILE)).digest('hex').slice(0, 12));
  assert.equal(loadPatterns(PATTERN_FILE).hash, loaded.hash);
});

test('AC4 a valid file with ten entries loads; the hash follows the file bytes', async (t) => {
  const c = tmp(t);
  const { loadPatterns } = await lib();
  const entries = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, re: `word${i}`, why: `reason ${i}` }));
  const file = put(c.base, 'ten.json', JSON.stringify({ v: 1, patterns: entries }));
  const a = loadPatterns(file);
  assert.equal(a.patterns.length, 10);
  const file2 = put(c.base, 'ten2.json', JSON.stringify({ v: 1, patterns: entries }, null, 2));
  assert.notEqual(loadPatterns(file2).hash, a.hash);
  const withFlag = put(c.base, 'flag.json', JSON.stringify({ v: 1, patterns: [{ id: 'a', re: 'x', flags: 'i', why: 'w' }, { id: 'b', re: 'y', flags: '', why: 'w' }] }));
  assert.equal(loadPatterns(withFlag).patterns.length, 2);
});

test('AC4 a bad file is rejected whole and the error names the entry', async (t) => {
  const c = tmp(t);
  const { loadPatterns } = await lib();
  const good = (id) => ({ id, re: 'x', why: 'a reason' });
  const bad = (entry) => JSON.stringify({ v: 1, patterns: [good('first'), entry, good('third')] });
  const cases = [
    ['a missing why', bad({ id: 'second', re: 'x' }), /^patterns entry \d+ \(second\): /],
    ['a blank why', bad({ id: 'second', re: 'x', why: '   ' }), /^patterns entry \d+ \(second\): /],
    ['an empty why', bad({ id: 'second', re: 'x', why: '' }), /^patterns entry \d+ \(second\): /],
    ['a multi-line why', bad({ id: 'second', re: 'x', why: 'a\nb' }), /^patterns entry \d+ \(second\): /],
    ['a why of 121 characters', bad({ id: 'second', re: 'x', why: 'w'.repeat(121) }), /^patterns entry \d+ \(second\): /],
    ['a missing re', bad({ id: 'second', why: 'w' }), /^patterns entry \d+ \(second\): /],
    ['an empty re', bad({ id: 'second', re: '', why: 'w' }), /^patterns entry \d+ \(second\): /],
    ['a re of 201 characters', bad({ id: 'second', re: 'x'.repeat(201), why: 'w' }), /^patterns entry \d+ \(second\): /],
    ['a bad regex', bad({ id: 'second', re: '(unclosed', why: 'w' }), /^patterns entry \d+ \(second\): /],
    ['a re that is not a string', bad({ id: 'second', re: 5, why: 'w' }), /^patterns entry \d+ \(second\): /],
    ['flags g', bad({ id: 'second', re: 'x', flags: 'g', why: 'w' }), /^patterns entry \d+ \(second\): /],
    ['flags ii', bad({ id: 'second', re: 'x', flags: 'ii', why: 'w' }), /^patterns entry \d+ \(second\): /],
    ['flags that are not a string', bad({ id: 'second', re: 'x', flags: 1, why: 'w' }), /^patterns entry \d+ \(second\): /],
    ['an unknown key', bad({ id: 'second', re: 'x', why: 'w', extra: 1 }), /^patterns entry \d+ \(second\): /],
    ['a reserved id long-line', bad({ id: 'long-line', re: 'x', why: 'w' }), /^patterns entry \d+ \(long-line\): /],
    ['a reserved id unclosed-fence', bad({ id: 'unclosed-fence', re: 'x', why: 'w' }), /^patterns entry \d+ \(unclosed-fence\): /],
    ['a duplicate id', bad({ id: 'first', re: 'x', why: 'w' }), /^patterns entry \d+ \(first\): /],
    ['an uppercase id', bad({ id: 'Second', re: 'x', why: 'w' }), /^patterns entry \d+ \(\?\): /],
    ['an id with a path', bad({ id: '../x', re: 'x', why: 'w' }), /^patterns entry \d+ \(\?\): /],
    ['an id of 33 characters', bad({ id: 'a'.repeat(33), re: 'x', why: 'w' }), /^patterns entry \d+ \(\?\): /],
    ['no id', bad({ re: 'x', why: 'w' }), /^patterns entry \d+ \(\?\): /],
    ['an entry that is not an object', bad('text'), /^patterns entry \d+ \(\?\): /]
  ];
  for (const [name, text, re] of cases) {
    const file = put(c.base, 'bad.json', text);
    assert.throws(() => loadPatterns(file), (e) => re.test(e.message), `${name}`);
  }
});

test('AC4 the entry index in the error counts the entry that is bad', async (t) => {
  const c = tmp(t);
  const { loadPatterns } = await lib();
  const entries = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, re: 'x', why: 'w' }));
  const list = entries(4);
  delete list[3].why;
  const file = put(c.base, 'idx.json', JSON.stringify({ v: 1, patterns: list }));
  assert.throws(() => loadPatterns(file), (e) => /^patterns entry [34] \(p3\): /.test(e.message));
  const list2 = entries(4);
  delete list2[0].why;
  const file2 = put(c.base, 'idx2.json', JSON.stringify({ v: 1, patterns: list2 }));
  assert.throws(() => loadPatterns(file2), (e) => /^patterns entry [01] \(p0\): /.test(e.message));
});

test('AC4 more than ten entries, a wrong v, a file over 16 KiB and unparseable files are rejected', async (t) => {
  const c = tmp(t);
  const { loadPatterns } = await lib();
  const entries = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, re: 'x', why: 'w' }));
  const f11 = put(c.base, 'e11.json', JSON.stringify({ v: 1, patterns: entries(11) }));
  assert.throws(() => loadPatterns(f11), (e) => e.message === 'patterns: 11 entries, at most 10');
  const fileProblems = [
    JSON.stringify({ v: 2, patterns: entries(1) }),
    JSON.stringify({ patterns: entries(1) }),
    JSON.stringify({ v: '1', patterns: entries(1) }),
    JSON.stringify({ v: 1 }),
    JSON.stringify({ v: 1, patterns: 'x' }),
    JSON.stringify({ v: 1, patterns: entries(1), extra: true }),
    JSON.stringify([]),
    'null',
    '{not json',
    '',
    JSON.stringify({ v: 1, patterns: [{ id: 'big', re: 'x', why: 'w', pad: 'p'.repeat(17 * 1024) }] })
  ];
  for (const text of fileProblems) {
    const file = put(c.base, 'file.json', text);
    assert.throws(() => loadPatterns(file), (e) => /^patterns/.test(e.message), text.slice(0, 40));
  }
  assert.throws(() => loadPatterns(path.join(c.base, 'missing.json')), Error);
});

test('AC4 a bad pattern file in the plugin folder gives an error record, exit 1, and scans nothing', async (t) => {
  const c = tmp(t);
  const copy = path.join(c.base, 'plugin', 'scripts');
  fs.mkdirSync(copy, { recursive: true });
  for (const name of fs.readdirSync(here)) {
    if (/^(plan-check|plan-markdown|run-state|ledger|handoff-lint)[a-z-]*\.mjs$/.test(name) && !name.endsWith('.test.mjs')) fs.copyFileSync(path.join(here, name), path.join(copy, name));
  }
  fs.mkdirSync(path.join(c.base, 'plugin', 'mods', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(here, '..', 'mods', 'lib', 'work-folder.mjs'), path.join(c.base, 'plugin', 'mods', 'lib', 'work-folder.mjs'));
  fs.writeFileSync(path.join(copy, 'plan-check-patterns.json'), JSON.stringify({ v: 1, patterns: [{ id: 'a', re: 'x' }] }));
  mkRun(c.root, 'demo', inSteps('TBD'));
  const env = envFor(c.home);
  const r = runNode(path.join(copy, 'plan-check.mjs'), env, c.root, ['gate', 'demo', '02-plan.md', '--policy', 'warn']);
  assert.equal(r.status, 1, r.all);
  assert.match(r.out.trim(), /^plan-check \(warn\): error patterns: patterns entry \d+ \(a\): /);
  const recs = readRecordLines(c.root, 'demo');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].ev, 'error');
  assert.equal(recs[0].reason, 'patterns');
  assert.equal(recs[0].policy, 'warn');
});

// ---------- the gate command ----------

test('AC5 an empty plan and a zero-hit plan each write a scan record with findings 0', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  for (const [slug, text] of [['empty', ''], ['clean', '# Plan\n\n## Steps\n- build it\n- Decided: json because built in\n']]) {
    mkRun(c.root, slug, text);
    const r = k.check('gate', slug, '02-plan.md', '--policy', 'warn');
    assert.equal(r.status, 0, r.all);
    assert.equal(r.out, `plan-check (warn): 0 open decisions, ${slug === 'empty' ? 0 : 1} decided\n`);
    const recs = readRecordLines(c.root, slug);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].ev, 'scan');
    assert.equal(recs[0].findings, 0);
    assert.equal(recs[0].decided, slug === 'empty' ? 0 : 1);
  }
});

test('AC5 AC11 a scan record has exactly its keys, an LF line of at most 256 bytes, and no plan text', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'demo', '## Steps\n- secretphrase TBD for Jane Doe\n- Decided: pick a because b\n');
  assert.equal(k.check('gate', 'demo', '02-plan.md', '--policy', 'warn').status, 0);
  const raw = fs.readFileSync(recordFile(c.root, 'demo'), 'utf8');
  assert.ok(raw.endsWith('\n') && !raw.includes('\r'));
  assert.equal(raw.split('\n').length, 2);
  assert.ok(Buffer.byteLength(raw.trimEnd()) <= 256);
  assert.ok(!raw.includes('secretphrase') && !raw.includes('Jane'));
  const rec = JSON.parse(raw);
  assert.deepEqual(Object.keys(rec).sort(), ['at', 'decided', 'ev', 'findings', 'patterns', 'plan', 'policy', 'v']);
  assert.equal(rec.v, 1);
  assert.match(rec.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(rec.policy, 'warn');
  assert.equal(rec.plan, '02-plan.md');
  assert.match(rec.patterns, /^[0-9a-f]{12}$/);
  assert.equal(rec.findings, 1);
  assert.equal(rec.decided, 1);
});

test('AC7 seven findings show the first five rows then +2 more, exit 0 under warn', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'demo', manyTbd(7));
  const r = k.check('gate', 'demo', '02-plan.md', '--policy', 'warn');
  assert.equal(r.status, 0, r.all);
  const why = WHY.tbd;
  const expected = [
    'plan-check (warn): 7 open decisions, 0 decided',
    ...[4, 5, 6, 7, 8].map((n) => `02-plan.md:${n} | TBD | ${why}`),
    '+2 more'
  ];
  assert.equal(r.out, `${expected.join('\n')}\n`);
  assert.equal(readRecordLines(c.root, 'demo')[0].findings, 7);
});

test('AC7 the block shows no more line at five findings, one more at six, and the singular for one', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'five', manyTbd(5));
  mkRun(c.root, 'six', manyTbd(6));
  mkRun(c.root, 'one', manyTbd(1));
  const five = outLines(k.check('gate', 'five', '02-plan.md', '--policy', 'warn').out);
  assert.equal(five.length, 6);
  assert.ok(!five.some((l) => l.startsWith('+')));
  const six = outLines(k.check('gate', 'six', '02-plan.md', '--policy', 'warn').out);
  assert.equal(six.length, 7);
  assert.equal(six[6], '+1 more');
  const one = outLines(k.check('gate', 'one', '02-plan.md', '--policy', 'warn').out);
  assert.equal(one[0], 'plan-check (warn): 1 open decision, 0 decided');
});

test('AC7 --json prints every finding instead of the block', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'demo', manyTbd(7));
  const r = k.check('gate', 'demo', '02-plan.md', '--policy', 'warn', '--json');
  assert.equal(r.status, 0, r.all);
  const o = JSON.parse(r.out);
  assert.deepEqual(Object.keys(o).sort(), ['count', 'decided', 'findings', 'policy', 'v']);
  assert.equal(o.v, 1);
  assert.equal(o.policy, 'warn');
  assert.equal(o.count, 7);
  assert.equal(o.findings.length, 7);
  assert.deepEqual(o.findings[6], { file: '02-plan.md', line: 10, id: 'tbd', phrase: 'TBD', why: WHY.tbd });
  assert.equal(readRecordLines(c.root, 'demo').length, 1);
});

test('AC8 off writes the off record and scans nothing, even with no plan file', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'demo');
  const r = k.check('off', 'demo');
  assert.equal(r.status, 0, r.all);
  assert.equal(r.out, 'plan-check: off\n');
  const recs = readRecordLines(c.root, 'demo');
  assert.equal(recs.length, 1);
  assert.deepEqual(Object.keys(recs[0]).sort(), ['at', 'ev', 'policy', 'v']);
  assert.equal(recs[0].ev, 'off');
  assert.equal(recs[0].policy, 'off');
  const { readRecord } = await lib();
  const view = readRecord(c.root, 'demo');
  assert.equal(view.state, 'off');
  assert.equal(view.policy, 'off');
});

test('AC8 block with findings exits 2 and still writes the scan record; block without findings exits 0', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'hit', manyTbd(2));
  mkRun(c.root, 'clean', '## Steps\n- fine\n');
  const hit = k.check('gate', 'hit', '02-plan.md', '--policy', 'block');
  assert.equal(hit.status, 2, hit.all);
  assert.equal(outLines(hit.out)[0], 'plan-check (block): 2 open decisions, 0 decided');
  const recs = readRecordLines(c.root, 'hit');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].ev, 'scan');
  assert.equal(recs[0].policy, 'block');
  assert.equal(recs[0].findings, 2);
  const clean = k.check('gate', 'clean', '02-plan.md', '--policy', 'block');
  assert.equal(clean.status, 0, clean.all);
  assert.equal(readRecordLines(c.root, 'clean')[0].findings, 0);
});

test('AC8 the pipeline text says exit 2 (block) makes the scripts refuse the Plan Gate, not that it is treated like warn', () => {
  const ref = fs.readFileSync(path.join(repoRoot, 'skills', 'pipeline', 'references', 'plan-check.md'), 'utf8');
  assert.match(ref, /Exit 2 \(`block`\) means the scripts refuse the Plan Gate/);
  assert.doesNotMatch(ref, /shown like `warn`|Gate can be approved/);
});

test('the gate command refuses bad arguments with exit 3 and writes nothing', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'demo', manyTbd(1));
  const before = snapshot(c.base);
  const bad = [
    ['gate', 'demo', '02-plan.md'],
    ['gate', 'demo', '02-plan.md', '--policy', 'off'],
    ['gate', 'demo', '02-plan.md', '--policy', 'strict'],
    ['gate', 'demo', '02-plan.md', '--policy'],
    ['gate', 'demo', '--policy', 'warn'],
    ['gate', '../demo', '02-plan.md', '--policy', 'warn'],
    ['gate', 'Demo', '02-plan.md', '--policy', 'warn'],
    ['gate', '', '02-plan.md', '--policy', 'warn'],
    ['gate', 'demo/../demo', '02-plan.md', '--policy', 'warn'],
    ['gate', 'demo', '02-plan.md', '--policy', 'warn', '--extra'],
    ['gate', 'absent', '02-plan.md', '--policy', 'warn'],
    ['off'],
    ['off', '../demo'],
    ['off', 'demo', 'extra'],
    ['nonsense', 'demo'],
    []
  ];
  for (const args of bad) {
    const r = k.check(...args);
    assert.equal(r.status, 3, `${JSON.stringify(args)}: ${r.all}`);
    assert.match(r.all, /refused: /, JSON.stringify(args));
  }
  assert.deepEqual(snapshot(c.base), before);
});

test('a plan name that is not a plan file name gives an error record with reason plan-name and no plan key', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'demo', 'x');
  fs.writeFileSync(path.join(runDir(c.root, 'demo'), 'notes.md'), 'x');
  const names = ['notes.md', '../02-plan.md', '..\\02-plan.md', '02-plan.md/../notes.md', 'plan.txt', 'PLAN.md', '2-plan.md', '02-plan.md ', '/etc/passwd'];
  for (const name of names) {
    const r = k.check('gate', 'demo', name, '--policy', 'warn');
    assert.equal(r.status, 1, `${name}: ${r.all}`);
    assert.match(r.out.trim(), /^plan-check \(warn\): error plan-name: /, name);
  }
  const recs = readRecordLines(c.root, 'demo');
  assert.equal(recs.length, names.length);
  for (const rec of recs) {
    assert.equal(rec.ev, 'error');
    assert.equal(rec.reason, 'plan-name');
    assert.ok(!Object.hasOwn(rec, 'plan'));
  }
});

test('the accepted plan names all scan', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  for (const name of ['02-plan.md', '02-architect-plan.md', '55-architect-plan-m.md', 'plan.md', '123-plan.md', 'architect-plan.md', '02-plan-v2.md']) {
    mkRun(c.root, 'demo', '## Steps\nTBD\n', name);
    const r = k.check('gate', 'demo', name, '--policy', 'warn');
    assert.equal(r.status, 0, `${name}: ${r.all}`);
    assert.equal(readRecordLines(c.root, 'demo').at(-1).plan, name);
  }
});

test('a missing, too large, linked, folder or non-UTF-8 plan gives an error record and exit 1', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'demo');
  const dir = runDir(c.root, 'demo');
  const reasons = [];
  const attempt = (name, reason) => {
    const r = k.check('gate', 'demo', name, '--policy', 'warn');
    assert.equal(r.status, 1, `${name}: ${r.all}`);
    assert.match(r.out.trim(), new RegExp(`^plan-check \\(warn\\): error ${reason}: `), name);
    reasons.push(reason);
  };
  attempt('02-plan.md', 'plan-missing');
  fs.writeFileSync(path.join(dir, '03-plan.md'), Buffer.alloc(256 * 1024 + 1, 0x61));
  attempt('03-plan.md', 'plan-too-large');
  fs.writeFileSync(path.join(dir, '04-plan.md'), Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]));
  attempt('04-plan.md', 'plan-unreadable');
  fs.mkdirSync(path.join(dir, '05-plan.md'));
  attempt('05-plan.md', 'plan-unreadable');
  fs.writeFileSync(path.join(dir, 'real.txt'), '## Steps\nTBD\n');
  let linked = true;
  try {
    fs.symlinkSync(path.join(dir, 'real.txt'), path.join(dir, '06-plan.md'));
  } catch {
    linked = false;
  }
  if (linked) attempt('06-plan.md', 'plan-unreadable');
  const recs = readRecordLines(c.root, 'demo');
  assert.deepEqual(recs.map((r) => r.reason), reasons);
  fs.writeFileSync(path.join(dir, '07-plan.md'), Buffer.alloc(256 * 1024, 0x61));
  assert.equal(k.check('gate', 'demo', '07-plan.md', '--policy', 'warn').status, 0);
});

test('the record is refused, not written, when it is a link, full, or its run folder is missing', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'full', '## Steps\nTBD\n');
  const lines = Array.from({ length: 1000 }, () => JSON.stringify(R.off()));
  fs.writeFileSync(recordFile(c.root, 'full'), `${lines.join('\n')}\n`);
  const before = fs.readFileSync(recordFile(c.root, 'full'), 'utf8');
  for (const args of [['off', 'full'], ['gate', 'full', '02-plan.md', '--policy', 'warn']]) {
    const r = k.check(...args);
    assert.equal(r.status, 3, r.all);
    assert.match(r.all, /refused: /);
  }
  assert.equal(fs.readFileSync(recordFile(c.root, 'full'), 'utf8'), before);
  const none = k.check('off', 'nofolder');
  assert.equal(none.status, 3, none.all);
  assert.ok(!fs.existsSync(runDir(c.root, 'nofolder')));
  mkRun(c.root, 'linked', '## Steps\nTBD\n');
  fs.writeFileSync(path.join(c.base, 'target.jsonl'), '');
  let linked = true;
  try {
    fs.symlinkSync(path.join(c.base, 'target.jsonl'), recordFile(c.root, 'linked'));
  } catch {
    linked = false;
  }
  if (linked) {
    const r = k.check('off', 'linked');
    assert.equal(r.status, 3, r.all);
    assert.equal(fs.readFileSync(path.join(c.base, 'target.jsonl'), 'utf8'), '');
  }
});

test('the record is append-only: each command adds one line and leaves the earlier lines as they were', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'demo', manyTbd(3));
  k.check('gate', 'demo', '02-plan.md', '--policy', 'warn');
  const first = fs.readFileSync(recordFile(c.root, 'demo'), 'utf8');
  k.check('wave', 'demo', '2');
  k.check('gate', 'demo', '02-plan.md', '--policy', 'warn');
  const all = fs.readFileSync(recordFile(c.root, 'demo'), 'utf8');
  assert.ok(all.startsWith(first));
  assert.equal(all.split('\n').filter(Boolean).length, 3);
});

// ---------- wave ----------

test('wave records the count, and is refused with no scan, a count above the findings, or a count that is not digits', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'demo', manyTbd(4));
  const early = k.check('wave', 'demo', '1');
  assert.equal(early.status, 3, early.all);
  assert.match(early.all, /refused: /);
  k.check('gate', 'demo', '02-plan.md', '--policy', 'warn');
  const before = fs.readFileSync(recordFile(c.root, 'demo'), 'utf8');
  for (const n of ['5', '99', '-1', '1.5', '1e1', 'abc', '', ' 1', '1 ', '0x1', '١', '../1', '1;2', '00000000000000000000000000001']) {
    const r = k.check('wave', 'demo', n);
    assert.equal(r.status, 3, `${JSON.stringify(n)}: ${r.all}`);
    assert.match(r.all, /refused: /);
  }
  assert.equal(k.check('wave', 'demo').status, 3);
  assert.equal(k.check('wave', '../demo', '1').status, 3);
  assert.equal(fs.readFileSync(recordFile(c.root, 'demo'), 'utf8'), before);
  const ok = k.check('wave', 'demo', '3');
  assert.equal(ok.status, 0, ok.all);
  assert.equal(ok.out, 'plan-check: waved 3 of 4\n');
  const last = readRecordLines(c.root, 'demo').at(-1);
  assert.deepEqual(Object.keys(last).sort(), ['at', 'ev', 'v', 'waved']);
  assert.equal(last.ev, 'wave');
  assert.equal(last.waved, 3);
  assert.equal(k.check('wave', 'demo', '0').status, 0);
  assert.equal(k.check('wave', 'demo', '4').status, 0);
});

// ---------- reader ----------

test('AC6 no record file reads as state none', async (t) => {
  const c = tmp(t);
  const { readRecord } = await lib();
  mkRun(c.root, 'demo');
  assert.deepEqual(readRecord(c.root, 'demo'), { v: 1, slug: 'demo', state: 'none' });
});

test('AC6 the reader gives the view of the last scan, off or error record', async (t) => {
  const c = tmp(t);
  const { readRecord } = await lib();
  const view = (lines) => {
    writeRecord(c.root, 'demo', lines);
    return readRecord(c.root, 'demo');
  };
  assert.deepEqual(view([R.scan({ findings: 3, decided: 1 })]), {
    v: 1, slug: 'demo', state: 'on', policy: 'warn', plan: '02-plan.md', patterns: HASH, findings: 3, decided: 1, waved: 0, scans: 1
  });
  assert.equal(view([R.scan({ findings: 3 }), R.wave(1), R.wave(2)]).waved, 2);
  const rescan = view([R.scan({ findings: 3 }), R.wave(2), R.scan({ findings: 1 })]);
  assert.equal(rescan.waved, 0);
  assert.equal(rescan.scans, 2);
  assert.equal(rescan.findings, 1);
  const off = view([R.scan({ findings: 3 }), R.off()]);
  assert.equal(off.state, 'off');
  assert.equal(off.policy, 'off');
  assert.equal(off.scans, 1);
  for (const key of ['plan', 'patterns', 'findings', 'decided']) assert.equal(off[key], null, key);
  const back = view([R.off(), R.scan({ policy: 'block', findings: 2 })]);
  assert.equal(back.state, 'on');
  assert.equal(back.policy, 'block');
  const err = view([R.scan({ findings: 3 }), R.error({ reason: 'plan-missing' })]);
  assert.equal(err.state, 'error');
  assert.equal(err.policy, 'warn');
  for (const key of ['findings', 'decided', 'patterns']) assert.equal(err[key], null, key);
  assert.equal(view([R.error({ reason: 'plan-name' })]).plan, null);
  assert.equal(view([R.error({ reason: 'plan-too-large', plan: '02-plan.md' })]).plan, '02-plan.md');
});

const BAD_RECORDS = [
  ['v 2', [R.off({ v: 2 })], 1],
  ['v as text', [R.off({ v: '1' })], 1],
  ['a missing findings', [(() => { const o = R.scan(); delete o.findings; return o; })()], 1],
  ['a missing decided', [(() => { const o = R.scan(); delete o.decided; return o; })()], 1],
  ['a missing plan on scan', [(() => { const o = R.scan(); delete o.plan; return o; })()], 1],
  ['a missing at', [(() => { const o = R.off(); delete o.at; return o; })()], 1],
  ['an unknown key', [R.off({ note: 'x' })], 1],
  ['an unknown key on scan', [R.scan({ phrase: 'TBD' })], 1],
  ['a bad json line after a good one', [R.off(), '{not json'], 2],
  ['a blank line between records', [R.off(), '', R.off()], 2],
  ['a wave before any scan', [R.wave(0)], 1],
  ['a wave after only an off record', [R.off(), R.wave(0)], 2],
  ['a waved above the findings of its scan', [R.scan({ findings: 2 }), R.wave(3)], 2],
  ['a waved above the latest scan', [R.scan({ findings: 5 }), R.scan({ findings: 1 }), R.wave(2)], 3],
  ['a bad time', [R.off({ at: 'yesterday' })], 1],
  ['a time with milliseconds', [R.off({ at: '2026-10-28T10:00:00.000Z' })], 1],
  ['a bad ev', [R.off({ ev: 'start' })], 1],
  ['policy warn on an off record', [R.off({ policy: 'warn' })], 1],
  ['policy off on a scan record', [R.scan({ policy: 'off' })], 1],
  ['a bad policy', [R.scan({ policy: 'strict' })], 1],
  ['an upper-case hash', [R.scan({ patterns: 'ABCDEF012345' })], 1],
  ['a short hash', [R.scan({ patterns: 'abc' })], 1],
  ['findings above 10000', [R.scan({ findings: 10001 })], 1],
  ['negative findings', [R.scan({ findings: -1 })], 1],
  ['findings as text', [R.scan({ findings: '3' })], 1],
  ['a fractional decided', [R.scan({ decided: 1.5 })], 1],
  ['a bad reason', [R.error({ reason: 'because' })], 1],
  ['a bad plan name on scan', [R.scan({ plan: '../02-plan.md' })], 1],
  ['a bad plan name on error', [R.error({ plan: 'notes.md' })], 1],
  ['a key from another event', [R.wave(0, { findings: 1 })], 1],
  ['a record that is an array', ['[]'], 1],
  ['a record that is null', ['null'], 1],
  ['a line over 256 bytes', [R.off(), `${JSON.stringify(R.off())}${' '.repeat(300)}`], 2]
];

for (const [name, lines, lineNo] of BAD_RECORDS) {
  test(`AC6 the reader throws on ${name}, naming the line`, async (t) => {
    const c = tmp(t);
    const { readRecord, PlanCheckRecordError } = await lib();
    writeRecord(c.root, 'demo', lines);
    assert.throws(() => readRecord(c.root, 'demo'), (e) => e instanceof PlanCheckRecordError && e.message.startsWith(`plan-check record demo line ${lineNo}: `) && e.message.length > `plan-check record demo line ${lineNo}: `.length, name);
    const k = makeEnv(c);
    const r = k.check('read', 'demo');
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, new RegExp(`plan-check record demo line ${lineNo}: `));
  });
}

test('AC6 a record file over 1000 lines or over 64 KiB, or a record that is a link, throws with line 0', async (t) => {
  const c = tmp(t);
  const { readRecord, PlanCheckRecordError } = await lib();
  const check = () => assert.throws(() => readRecord(c.root, 'demo'), (e) => e instanceof PlanCheckRecordError && e.message.startsWith('plan-check record demo line 0: '));
  writeRecord(c.root, 'demo', Array.from({ length: 1001 }, () => R.off()));
  check();
  const name = `02-architect-plan-${'a'.repeat(60)}.md`;
  writeRecord(c.root, 'demo', Array.from({ length: 800 }, () => R.scan({ plan: name })));
  assert.ok(fs.statSync(recordFile(c.root, 'demo')).size > 64 * 1024);
  check();
  fs.rmSync(recordFile(c.root, 'demo'));
  fs.writeFileSync(path.join(c.base, 'target.jsonl'), `${JSON.stringify(R.off())}\n`);
  try {
    fs.symlinkSync(path.join(c.base, 'target.jsonl'), recordFile(c.root, 'demo'));
    check();
  } catch (e) {
    if (e instanceof assert.AssertionError) throw e;
  }
});

test('AC6 read prints the view as JSON and exits 0; a missing record is state none', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'demo');
  const none = k.check('read', 'demo');
  assert.equal(none.status, 0, none.all);
  assert.deepEqual(JSON.parse(none.out), { v: 1, slug: 'demo', state: 'none' });
  writeRecord(c.root, 'demo', [R.scan({ findings: 2 }), R.wave(1)]);
  const on = k.check('read', 'demo');
  assert.equal(on.status, 0, on.all);
  assert.equal(JSON.parse(on.out).waved, 1);
  for (const slug of ['../demo', 'Demo', '']) assert.equal(k.check('read', slug).status, 3, slug);
});

test('AC6 the check and the verdict write nothing under .company/ledger and no Step Handoff', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  gitInit(c);
  mkRun(c.root, 'demo', manyTbd(3));
  put(c.root, '.company/work/demo/00-summary.md', '# demo\n');
  put(c.root, '.company/work/demo/01-product-manager.md', '---\nstep: 01\nrole: product-manager\ntask: demo\nstatus: done\nround: 0\n---\nBy: x\n');
  fs.mkdirSync(path.join(c.root, '.company', 'ledger'), { recursive: true });
  for (const f of fs.readdirSync(LEDGER_FIXTURES).filter((n) => n.endsWith('.jsonl'))) fs.copyFileSync(path.join(LEDGER_FIXTURES, f), path.join(c.root, '.company', 'ledger', f));
  commitAll(c, '2026-10-20T10:00:00Z');
  const watched = () => {
    const snap = snapshot(c.root);
    return Object.fromEntries(Object.entries(snap).filter(([key]) => key.startsWith('.company/ledger/') || /\/\d{2}-[a-z-]+\.md$/.test(key)));
  };
  const before = watched();
  assert.ok(Object.keys(before).length > 5);
  const outcomes = [
    k.check('gate', 'demo', '02-plan.md', '--policy', 'warn'),
    k.check('wave', 'demo', '1'),
    k.check('read', 'demo'),
    k.check('off', 'demo'),
    k.verdict('verdict'),
    k.verdict('history')
  ];
  for (const o of outcomes) assert.ok(o.status !== null, o.all);
  assert.deepEqual(watched(), before);
});

test('AC6 the v0.15 ledger fixtures report the same text before and after the check and the verdict run', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  gitInit(c);
  fs.mkdirSync(path.join(c.root, '.company', 'ledger'), { recursive: true });
  for (const f of fs.readdirSync(LEDGER_FIXTURES).filter((n) => n.endsWith('.jsonl'))) fs.copyFileSync(path.join(LEDGER_FIXTURES, f), path.join(c.root, '.company', 'ledger', f));
  mkRun(c.root, 'triage-hardening', manyTbd(2));
  commitAll(c, '2026-10-20T10:00:00Z');
  const expected = fs.readFileSync(path.join(LEDGER_FIXTURES, 'expected', 'triage-hardening.report.txt'), 'utf8');
  const report = () => k.ledger('report', 'triage-hardening');
  assert.equal(report().out, expected);
  k.check('gate', 'triage-hardening', '02-plan.md', '--policy', 'warn');
  k.check('off', 'triage-hardening');
  k.verdict('verdict', '--runs', '3');
  k.verdict('history');
  const after = report();
  assert.equal(after.status, 0, after.all);
  assert.equal(after.out, expected);
});

// ---------- skill texts ----------

test('AC9 the review skill names the open-decision tag under Nits and never under Blocking', () => {
  const text = fs.readFileSync(path.join(repoRoot, 'skills', 'review', 'SKILL.md'), 'utf8');
  const tagged = text.split('\n').filter((l) => l.includes('[open-decision]'));
  assert.ok(tagged.length >= 1);
  for (const line of tagged) assert.match(line, /Nit/);
  assert.ok(tagged.some((l) => /(never|not)[^\n]*Blocking|Blocking[^\n]*(never|not)/.test(l)));
  const afterBlocking = text.split('\n').filter((l) => /^#{1,4} .*Blocking/.test(l));
  assert.equal(afterBlocking.filter((l) => l.includes('open-decision')).length, 0);
});

test('AC10 the planning skill asks for Decided lines and no open words under Steps and Tasks', () => {
  const text = fs.readFileSync(path.join(repoRoot, 'skills', 'planning', 'SKILL.md'), 'utf8');
  assert.match(text, /Decided: <choice> because <reason>/);
  assert.match(text, /TBD/);
  assert.match(text, /decide later/i);
});

test('AC11 the pipeline reference runs gate or off at every Plan Gate and read before the Ship Gate', () => {
  const ref = fs.readFileSync(path.join(repoRoot, 'skills', 'pipeline', 'references', 'plan-check.md'), 'utf8');
  const gate = ref.indexOf('run.mjs" plan-check gate');
  const off = ref.indexOf('run.mjs" plan-check off');
  const read = ref.indexOf('run.mjs" plan-check read');
  assert.ok(gate >= 0 && off >= 0 && read >= 0, 'gate, off and read commands');
  assert.ok(read > gate);
  const readLine = ref.slice(Math.max(0, ref.lastIndexOf('\n', read)), ref.indexOf('\n', read));
  assert.match(ref.slice(read - 400, read + 400), /Ship Gate/);
  assert.match(readLine, /read/);
  assert.match(ref, /every Plan Gate|each Plan Gate|At each Plan Gate/i);
  assert.match(ref, /wave/);
  const skill = fs.readFileSync(path.join(repoRoot, 'skills', 'pipeline', 'SKILL.md'), 'utf8');
  assert.match(skill, /references\/plan-check\.md/);
  assert.ok(skill.split('\n').length <= 125);
});

test('AC11 the marker tells whether the check ran: gate gives on, off gives off, the last record wins', async (t) => {
  const c = tmp(t);
  const k = makeEnv(c);
  mkRun(c.root, 'a', '## Steps\nok\n');
  mkRun(c.root, 'b', '## Steps\nok\n');
  mkRun(c.root, 'c');
  assert.equal(JSON.parse(k.check('read', 'c').out).state, 'none');
  k.check('gate', 'a', '02-plan.md', '--policy', 'warn');
  assert.equal(JSON.parse(k.check('read', 'a').out).state, 'on');
  k.check('off', 'b');
  assert.equal(JSON.parse(k.check('read', 'b').out).state, 'off');
  k.check('off', 'a');
  assert.equal(JSON.parse(k.check('read', 'a').out).state, 'off');
  k.check('gate', 'a', '02-plan.md', '--policy', 'warn');
  assert.equal(JSON.parse(k.check('read', 'a').out).state, 'on');
  k.check('gate', 'a', 'notes.md', '--policy', 'warn');
  assert.equal(JSON.parse(k.check('read', 'a').out).state, 'error');
});

// ---------- verdict fixtures ----------

const DAY = 86400000;
const isoAt = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// A run folder committed at day `day`. fix = recorded ledger value (undefined: no ledger file). rounds = the round values
// of the step files in the first commit. late = rounds of step files added in a later commit, after the ship Gate answer.
function addRun(c, slug, o) {
  const { day, fix, rounds = fix === undefined ? [0] : Array.from({ length: fix + 1 }, (_, i) => i), late = [], mode = 'none', findings = 0, waved = 0, ledgerLines, noShipGate = false } = o;
  const start = Date.UTC(2026, 8, 1 + day, 10, 0, 0);
  put(c.root, `.company/work/${slug}/00-summary.md`, `# ${slug}\n`);
  put(c.root, `.company/work/${slug}/02-plan.md`, '## Steps\n- build\n');
  const step = (n, round) => put(c.root, `.company/work/${slug}/${String(n).padStart(2, '0')}-backend-engineer.md`, `---\nstep: ${String(n).padStart(2, '0')}\nrole: backend-engineer\ntask: ${slug}\nstatus: done\nround: ${round}\nbase-commit: abc1234\nrisk-tier: medium\n---\nBy: x\n`);
  rounds.forEach((r, i) => step(10 + i, r));
  const gates = [
    { v: 1, at: isoAt(start - 3000), ev: 'start' },
    { v: 1, at: isoAt(start - 2000), ev: 'gate', gate: 'brief', result: 'passed' },
    { v: 1, at: isoAt(start - 1000), ev: 'gate', gate: 'plan', result: 'passed' }
  ];
  if (!noShipGate) gates.push({ v: 1, at: isoAt(start + 60000), ev: 'gate', gate: 'ship', result: 'passed' });
  put(c.root, `.company/work/${slug}/run-state.jsonl`, `${gates.map((g) => JSON.stringify(g)).join('\n')}\n`);
  if (mode === 'on') {
    const lines = [R.scan({ findings, decided: 0 })];
    if (waved > 0) lines.push(R.wave(waved));
    put(c.root, `.company/work/${slug}/plan-check.jsonl`, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  } else if (mode === 'off') {
    put(c.root, `.company/work/${slug}/plan-check.jsonl`, `${JSON.stringify(R.off())}\n`);
  } else if (mode === 'error') {
    put(c.root, `.company/work/${slug}/plan-check.jsonl`, `${JSON.stringify(R.error())}\n`);
  } else if (mode === 'broken') {
    put(c.root, `.company/work/${slug}/plan-check.jsonl`, `${JSON.stringify(R.off({ v: 2 }))}\n`);
  }
  if (ledgerLines) {
    put(c.root, `.company/ledger/${slug}.jsonl`, `${ledgerLines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`);
  } else if (fix !== undefined) {
    put(c.root, `.company/ledger/${slug}.jsonl`, `${JSON.stringify({ v: 1, run: slug, kind: 'ship', acs: 3, fix_rounds: fix, high_blockers: 0 })}\n`);
  }
  commitAll(c, isoAt(start));
  if (late.length > 0) {
    late.forEach((r, i) => step(30 + i, r));
    commitAll(c, isoAt(start + 2 * DAY));
  }
}

function verdictRepo(t, runs) {
  const c = tmp(t, 'qa-odc-verdict');
  gitInit(c);
  for (const [slug, o] of Object.entries(runs)) addRun(c, slug, o);
  return { c, k: makeEnv(c) };
}

const sideRuns = (prefix, mode, fixes, startDay, extra = {}) =>
  Object.fromEntries(fixes.map((fix, i) => [`${prefix}${i}`, { day: startDay + i, fix, mode, ...(typeof extra === 'function' ? extra(i) : extra) }]));

const verdictLine = (r) => {
  assert.equal(r.status, 0, r.all);
  const lines = outLines(r.out);
  assert.equal(lines.length, 1, r.out);
  return lines[0];
};

// ---------- verdict ----------

test('AC13 AC14 pass at a drop of exactly 1, with the waved-off share', async (t) => {
  const { k } = verdictRepo(t, {
    ...sideRuns('base', 'none', [2, 2, 2], 0),
    ...sideRuns('on', 'on', [1, 1, 1], 10, (i) => ({ findings: 4, waved: i === 0 ? 0 : 1 }))
  });
  const r = k.verdict('verdict', '--runs', '3');
  assert.equal(verdictLine(r), 'plan-check verdict: pass | check on: median 1.0 (n=3) | baseline: median 2.0 (n=3) | waved off 17%');
});

test('AC13 fail at a drop of 0.5 says the default should become off; the medians use the middle-two mean', async (t) => {
  const { k } = verdictRepo(t, {
    ...sideRuns('base', 'none', [2, 2, 2, 2], 0),
    ...sideRuns('on', 'on', [1, 1, 2, 2], 10)
  });
  const r = k.verdict('verdict', '--runs', '4');
  assert.equal(verdictLine(r), 'plan-check verdict: fail | check on: median 1.5 (n=4) | baseline: median 2.0 (n=4) | waved off n/a | default should become off');
});

test('AC13 the drop is judged on unrounded medians: 2.5 against 1.5 passes, 2.0 against 1.5 does not', async (t) => {
  const pass = verdictRepo(t, {
    ...sideRuns('base', 'none', [2, 2, 3, 3], 0),
    ...sideRuns('on', 'on', [1, 1, 2, 2], 10)
  });
  assert.match(verdictLine(pass.k.verdict('verdict', '--runs', '4')), /^plan-check verdict: pass \| check on: median 1\.5 \(n=4\) \| baseline: median 2\.5 \(n=4\)/);
});

test('AC13 a drop of zero or a rise fails', async (t) => {
  const same = verdictRepo(t, { ...sideRuns('base', 'none', [2, 2, 2], 0), ...sideRuns('on', 'on', [2, 2, 2], 10) });
  assert.match(verdictLine(same.k.verdict('verdict', '--runs', '3')), /^plan-check verdict: fail \|.*\| default should become off$/);
  const worse = verdictRepo(t, { ...sideRuns('base', 'none', [1, 1, 1], 0), ...sideRuns('on', 'on', [3, 3, 3], 10) });
  assert.match(verdictLine(worse.k.verdict('verdict', '--runs', '3')), /^plan-check verdict: fail \|/);
});

test('AC13 a side with fewer runs than N reports insufficient with the size of the smaller side', async (t) => {
  const { k } = verdictRepo(t, { ...sideRuns('base', 'none', [2, 2], 0), ...sideRuns('on', 'on', [1, 1, 1], 10) });
  const line = verdictLine(k.verdict('verdict', '--runs', '3'));
  assert.match(line, /^plan-check verdict: insufficient \(n=2\) \| check on: median 1\.0 \(n=3\) \| baseline: median 2\.0 \(n=2\)/);
  assert.ok(!line.includes('default should become off'));
  const swapped = verdictRepo(t, { ...sideRuns('base', 'none', [2, 2, 2], 0), ...sideRuns('on', 'on', [1], 10) });
  assert.match(verdictLine(swapped.k.verdict('verdict', '--runs', '3')), /^plan-check verdict: insufficient \(n=1\) \|/);
});

test('AC13 an empty side shows a question mark for its median', async (t) => {
  const { k } = verdictRepo(t, { ...sideRuns('base', 'none', [2, 2, 2], 0) });
  const line = verdictLine(k.verdict('verdict', '--runs', '3'));
  assert.match(line, /^plan-check verdict: insufficient \(n=0\) \| check on: median \? \(n=0\) \| baseline: median 2\.0 \(n=3\)/);
});

test('AC13 the default N is 5: three runs a side is insufficient without --runs', async (t) => {
  const { k } = verdictRepo(t, { ...sideRuns('base', 'none', [2, 2, 2], 0), ...sideRuns('on', 'on', [1, 1, 1], 10) });
  assert.match(verdictLine(k.verdict('verdict')), /^plan-check verdict: insufficient \(n=3\) \|/);
});

test('AC13 each side takes its newest N counted runs', async (t) => {
  const runs = {
    old0: { day: 0, fix: 9, mode: 'none' },
    old1: { day: 1, fix: 9, mode: 'off' },
    ...sideRuns('base', 'none', [2, 2, 2], 5),
    oldon: { day: 6, fix: 9, mode: 'on', findings: 1 },
    ...sideRuns('on', 'on', [1, 1, 1], 10)
  };
  const { k } = verdictRepo(t, runs);
  assert.match(verdictLine(k.verdict('verdict', '--runs', '3')), /^plan-check verdict: pass \| check on: median 1\.0 \(n=3\) \| baseline: median 2\.0 \(n=3\)/);
});

test('AC13 --runs takes a whole number from 3 to 50 and nothing else', async (t) => {
  const { c, k } = verdictRepo(t, { ...sideRuns('base', 'none', [2, 2, 2], 0) });
  const before = snapshot(c.base);
  for (const n of ['2', '51', '0', '-3', '3.5', 'abc', '', '1e1', '03x']) {
    const r = k.verdict('verdict', '--runs', n);
    assert.equal(r.status, 3, `${JSON.stringify(n)}: ${r.all}`);
    assert.match(r.all, /refused: /);
  }
  assert.equal(k.verdict('verdict', '--runs').status, 3);
  assert.equal(k.verdict('verdict', '--runs', '3', '--runs', '4').status, 3);
  assert.equal(k.verdict('verdict', '--bogus').status, 3);
  assert.equal(k.verdict('nonsense').status, 3);
  assert.equal(k.verdict('verdict', '--runs', '50').status, 0);
  assert.equal(k.verdict('verdict', '--runs', '3').status, 0);
  assert.deepEqual(snapshot(c.base), before);
});

test('AC13 runs with the check off, or with no record, are the baseline; a run with an error record is left out with a warning', async (t) => {
  const { k } = verdictRepo(t, {
    b0: { day: 0, fix: 2, mode: 'none' },
    b1: { day: 1, fix: 2, mode: 'off' },
    b2: { day: 2, fix: 2, mode: 'none' },
    broken: { day: 3, fix: 9, mode: 'error' },
    ...sideRuns('on', 'on', [1, 1, 1], 10)
  });
  const r = k.verdict('verdict', '--runs', '3');
  const line = verdictLine(r);
  assert.match(line, /^plan-check verdict: pass \| check on: median 1\.0 \(n=3\) \| baseline: median 2\.0 \(n=3\)/);
  assert.match(line, /\| warnings: 1$/);
});

test('AC13 a run whose recorded value differs from its Handoffs is left out with the warning naming both', async (t) => {
  const { k } = verdictRepo(t, {
    ...sideRuns('base', 'none', [2, 2, 2], 0),
    mismatch: { day: 5, fix: 1, rounds: [0, 1, 2], mode: 'none' },
    ...sideRuns('on', 'on', [1, 1, 1], 10)
  });
  const r = k.verdict('verdict', '--runs', '3');
  const line = verdictLine(r);
  assert.match(line, /^plan-check verdict: pass \| check on: median 1\.0 \(n=3\) \| baseline: median 2\.0 \(n=3\)/);
  assert.match(line, /\| warnings: 1$/);
  assert.match(r.all, /mismatch: fix rounds 1 vs handoffs 2/);
});

test('AC13 a Step added after the first ship Gate entry does not raise the Handoff value', async (t) => {
  const { k } = verdictRepo(t, {
    ...sideRuns('base', 'none', [2, 2], 0),
    late: { day: 4, fix: 1, late: [2, 3], mode: 'none' },
    ...sideRuns('on', 'on', [1, 1, 1], 10)
  });
  const r = k.verdict('verdict', '--runs', '3');
  const line = verdictLine(r);
  assert.match(line, /^plan-check verdict: pass \| check on: median 1\.0 \(n=3\) \| baseline: median 2\.0 \(n=3\) \| waved off n\/a$/);
  assert.ok(!r.all.includes('late: fix rounds'));
});

test('AC13 a run with no ledger value is left out: no file, no ship line, no fix_rounds key, an unreadable line', async (t) => {
  const ship = (slug, extra = {}) => ({ v: 1, run: slug, kind: 'ship', acs: 3, high_blockers: 0, ...extra });
  const { k } = verdictRepo(t, {
    ...sideRuns('base', 'none', [2, 2, 2], 0),
    nofile: { day: 5, rounds: [0, 1], mode: 'none' },
    noship: { day: 6, rounds: [0, 1], mode: 'none', ledgerLines: [{ v: 1, run: 'noship', kind: 'step', id: '01', role: 'qa', agent: 'a1', src: 'notification', ctx_end: 5 }] },
    nokey: { day: 7, rounds: [0, 1], mode: 'none', ledgerLines: [ship('nokey')] },
    garbage: { day: 8, rounds: [0, 1], mode: 'none', ledgerLines: ['{not json', JSON.stringify(ship('garbage', { fix_rounds: 1, bogus: 1 }))] },
    ...sideRuns('on', 'on', [1, 1, 1], 10)
  });
  const r = k.verdict('verdict', '--runs', '3');
  const line = verdictLine(r);
  assert.match(line, /^plan-check verdict: pass \| check on: median 1\.0 \(n=3\) \| baseline: median 2\.0 \(n=3\) \| waved off n\/a \| warnings: 4$/);
  for (const slug of ['nofile', 'noship', 'nokey', 'garbage']) assert.match(r.all, new RegExp(`${slug}: fix rounds none vs handoffs 1`));
});

test('AC13 the recorded value is the last valid ship line; an invalid later line is skipped', async (t) => {
  const ship = (slug, fix, extra = {}) => ({ v: 1, run: slug, kind: 'ship', acs: 3, fix_rounds: fix, high_blockers: 0, ...extra });
  const { k } = verdictRepo(t, {
    ...sideRuns('base', 'none', [2, 2], 0),
    tail: { day: 4, rounds: [0, 1, 2], mode: 'none', ledgerLines: [ship('tail', 1), ship('tail', 2), ship('tail', 7, { bogus: true }), '{broken'] },
    ...sideRuns('on', 'on', [1, 1, 1], 10)
  });
  const r = k.verdict('verdict', '--runs', '3');
  assert.match(verdictLine(r), /^plan-check verdict: pass \| check on: median 1\.0 \(n=3\) \| baseline: median 2\.0 \(n=3\) \| waved off n\/a$/);
});

test('AC13 a ledger file over 1 MiB, or a line over 512 bytes, gives no recorded value', async (t) => {
  const ship = (slug) => ({ v: 1, run: slug, kind: 'ship', acs: 3, fix_rounds: 1, high_blockers: 0 });
  const filler = JSON.stringify({ v: 1, run: 'big', kind: 'step', id: '01', role: 'qa', agent: 'a1', src: 'notification', ctx_end: 5 });
  const big = Array.from({ length: Math.ceil((1024 * 1024) / (filler.length + 1)) + 5 }, () => filler);
  const { k } = verdictRepo(t, {
    ...sideRuns('base', 'none', [2, 2, 2], 0),
    big: { day: 5, rounds: [0, 1], mode: 'none', ledgerLines: [...big, ship('big')] },
    wide: { day: 6, rounds: [0, 1], mode: 'none', ledgerLines: [`${JSON.stringify(ship('wide'))}${' '.repeat(600)}`] },
    ...sideRuns('on', 'on', [1, 1, 1], 10)
  });
  const r = k.verdict('verdict', '--runs', '3');
  assert.match(verdictLine(r), /\| warnings: 2$/);
  assert.match(r.all, /big: fix rounds none vs handoffs 1/);
  assert.match(r.all, /wide: fix rounds none vs handoffs 1/);
});

test('AC13 a run with no ship Gate entry counts every Step: a phased run with extra rounds is left out', async (t) => {
  const { k } = verdictRepo(t, {
    ...sideRuns('base', 'none', [2, 2, 2], 0),
    phased: { day: 5, fix: 1, rounds: [0, 1, 2, 3], noShipGate: true, mode: 'none' },
    ...sideRuns('on', 'on', [1, 1, 1], 10)
  });
  const r = k.verdict('verdict', '--runs', '3');
  assert.match(verdictLine(r), /\| warnings: 1$/);
  assert.match(r.all, /phased: fix rounds 1 vs handoffs 3/);
});

test('AC13 a broken plan-check record stops the verdict with an error line and exit 1', async (t) => {
  const { k } = verdictRepo(t, {
    ...sideRuns('base', 'none', [2, 2, 2], 0),
    ...sideRuns('on', 'on', [1, 1, 1], 10),
    wrecked: { day: 20, fix: 1, mode: 'broken' }
  });
  const r = k.verdict('verdict', '--runs', '3');
  assert.equal(r.status, 1, r.all);
  const lines = outLines(r.out);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^plan-check verdict: error \(plan-check record wrecked line 1: .+\)$/);
});

test('AC13 the verdict ignores run folders with a bad slug, no summary, or no plan file', async (t) => {
  const c = tmp(t, 'qa-odc-verdict');
  gitInit(c);
  for (const [slug, o] of Object.entries({ ...sideRuns('base', 'none', [2, 2, 2], 0), ...sideRuns('on', 'on', [1, 1, 1], 10) })) addRun(c, slug, o);
  put(c.root, '.company/work/Bad_Slug/00-summary.md', '# x\n');
  put(c.root, '.company/work/Bad_Slug/02-plan.md', '## Steps\n');
  put(c.root, '.company/work/nosummary/02-plan.md', '## Steps\n');
  put(c.root, '.company/work/noplan/00-summary.md', '# x\n');
  commitAll(c, '2026-10-25T10:00:00Z');
  const r = makeEnv(c).verdict('verdict', '--runs', '3');
  assert.equal(verdictLine(r), 'plan-check verdict: pass | check on: median 1.0 (n=3) | baseline: median 2.0 (n=3) | waved off n/a');
});

test('AC14 the waved-off share flags retune above 30% and not at 30%', async (t) => {
  const make = (waved) => ({
    ...sideRuns('base', 'none', [2, 2, 2], 0),
    ...sideRuns('on', 'on', [1, 1, 1], 10, (i) => ({ findings: [40, 30, 30][i], waved: waved[i] }))
  });
  const over = verdictRepo(t, make([13, 9, 9]));
  assert.equal(verdictLine(over.k.verdict('verdict', '--runs', '3')), 'plan-check verdict: pass | check on: median 1.0 (n=3) | baseline: median 2.0 (n=3) | waved off 31% retune');
  const at = verdictRepo(t, make([12, 9, 9]));
  assert.equal(verdictLine(at.k.verdict('verdict', '--runs', '3')), 'plan-check verdict: pass | check on: median 1.0 (n=3) | baseline: median 2.0 (n=3) | waved off 30%');
  const none = verdictRepo(t, make([0, 0, 0]));
  assert.match(verdictLine(none.k.verdict('verdict', '--runs', '3')), /\| waved off 0%$/);
});

test('AC14 the waved-off share counts only the check-on side and rounds to a whole percent', async (t) => {
  const runs = {
    ...sideRuns('base', 'none', [2, 2, 2], 0),
    ...sideRuns('on', 'on', [1, 1, 1], 10, (i) => ({ findings: 3, waved: [1, 0, 0][i] }))
  };
  const { k } = verdictRepo(t, runs);
  assert.match(verdictLine(k.verdict('verdict', '--runs', '3')), /\| waved off 11%$/);
});

test('AC12 the verdict writes nothing: no file under the root changes and git status stays as it was', async (t) => {
  const { c, k } = verdictRepo(t, { ...sideRuns('base', 'none', [2, 2, 2], 0), ...sideRuns('on', 'on', [1, 1, 1], 10) });
  const before = snapshot(c.root);
  const status = git(c, ['status', '--porcelain']);
  const r = k.verdict('verdict', '--runs', '3');
  assert.equal(r.status, 0, r.all);
  assert.deepEqual(snapshot(c.root), before);
  assert.equal(git(c, ['status', '--porcelain']), status);
});

// ---------- history ----------

function historyRepo(t) {
  const c = tmp(t, 'qa-odc-history');
  gitInit(c);
  put(c.root, '.company/work/alpha/00-summary.md', '# alpha\n');
  put(c.root, '.company/work/alpha/02-plan.md', '## Steps\n- first TBD\n- second TODO\n');
  put(c.root, '.company/work/alpha/notes.md', '## Steps\nTBD\n');
  put(c.root, '.company/work/Bad_Slug/02-plan.md', '## Steps\nTBD\n');
  put(c.root, '.company/work/alpha/deeper/02-plan.md', '## Steps\nTBD\n');
  const shaA = commitAll(c, '2026-10-10T10:00:00Z', 'alpha');
  put(c.root, '.company/work/beta/00-summary.md', '# beta\n');
  put(c.root, '.company/work/beta/02-architect-plan.md', '## Tasks\n- one TBD\n- two or three?\n- decide later\n');
  const shaB = commitAll(c, '2026-10-12T10:00:00Z', 'beta');
  put(c.root, '.company/work/alpha/02-plan.md', '## Steps\n- first is settled\n');
  commitAll(c, '2026-10-14T10:00:00Z', 'alpha fixed');
  return { c, k: makeEnv(c), shaA, shaB };
}

test('AC12 history lists every plan at its oldest adding commit, newest first, and writes nothing', async (t) => {
  const { c, k, shaA, shaB } = historyRepo(t);
  const before = snapshot(c.root);
  const status = git(c, ['status', '--porcelain']);
  const r = k.verdict('history');
  assert.equal(r.status, 0, r.all);
  const lines = outLines(r.out);
  assert.deepEqual(lines, [
    `.company/work/beta/02-architect-plan.md@${shaB.slice(0, 7)}: 3 findings`,
    `  2 | TBD | ${WHY.tbd} | unlabeled`,
    `  3 | - two or three? | ${WHY['open-choice']} | unlabeled`,
    `  4 | decide later | ${WHY['decide-later']} | unlabeled`,
    `.company/work/alpha/02-plan.md@${shaA.slice(0, 7)}: 2 findings`,
    `  2 | TBD | ${WHY.tbd} | unlabeled`,
    `  3 | TODO | ${WHY.todo} | unlabeled`,
    lines.at(-1)
  ]);
  assert.match(lines.at(-1), /^(history: 2 plans, 5 findings, )?false-positive rate: no labels$/);
  assert.deepEqual(snapshot(c.root), before);
  assert.equal(git(c, ['status', '--porcelain']), status);
});

test('AC12 history applies the labels file and prints the rate', async (t) => {
  const { c, k, shaA, shaB } = historyRepo(t);
  const labels = put(c.base, 'labels.json', JSON.stringify({
    v: 1,
    labels: [
      { path: '.company/work/alpha/02-plan.md', sha: shaA.slice(0, 7), line: 2, label: 'fp' },
      { path: '.company/work/alpha/02-plan.md', sha: shaA, line: 3, label: 'tp' },
      { path: '.company/work/beta/02-architect-plan.md', sha: shaB.slice(0, 10), line: 3, label: 'fp' },
      { path: '.company/work/beta/02-architect-plan.md', sha: 'deadbeef', line: 4, label: 'fp' },
      { path: '.company/work/gamma/02-plan.md', sha: shaB.slice(0, 7), line: 4, label: 'fp' }
    ]
  }));
  const before = snapshot(c.root);
  const r = k.verdict('history', '--labels', labels);
  assert.equal(r.status, 0, r.all);
  const lines = outLines(r.out);
  assert.ok(lines.includes(`  2 | TBD | ${WHY.tbd} | fp`));
  assert.ok(lines.includes(`  3 | TODO | ${WHY.todo} | tp`));
  assert.ok(lines.includes(`  3 | - two or three? | ${WHY['open-choice']} | fp`));
  assert.ok(lines.includes(`  4 | decide later | ${WHY['decide-later']} | unlabeled`));
  assert.equal(lines.at(-1), 'history: 2 plans, 5 findings, labeled 3, false positives 2 (67%)');
  assert.deepEqual(snapshot(c.root), before);
});

test('AC12 history --limit keeps the newest plans, --json prints one object', async (t) => {
  const { k } = historyRepo(t);
  const one = outLines(k.verdict('history', '--limit', '1').out);
  assert.ok(one[0].startsWith('.company/work/beta/02-architect-plan.md@'));
  assert.ok(!one.some((l) => l.includes('alpha')));
  assert.match(one.at(-1), /^history: 1 plans?, 3 findings|^false-positive rate: no labels/);
  const json = k.verdict('history', '--json');
  assert.equal(json.status, 0, json.all);
  const o = JSON.parse(json.out);
  assert.equal(typeof o, 'object');
  const text = JSON.stringify(o);
  assert.ok(text.includes('.company/work/alpha/02-plan.md') && text.includes('.company/work/beta/02-architect-plan.md'));
  for (const n of ['0', '201', '-1', 'x', '1.5', '']) {
    const r = k.verdict('history', '--limit', n);
    assert.equal(r.status, 3, `${JSON.stringify(n)}: ${r.all}`);
    assert.match(r.all, /refused: /);
  }
});

test('AC12 a bad labels file is refused with exit 3 and the entry named', async (t) => {
  const { c, k } = historyRepo(t);
  const good = { path: '.company/work/alpha/02-plan.md', sha: 'abcdef1', line: 2, label: 'fp' };
  const before = snapshot(c.root);
  const bad = [
    { v: 1, labels: [good, { ...good, label: 'maybe' }] },
    { v: 1, labels: [good, { ...good, sha: 'xyz' }] },
    { v: 1, labels: [good, { ...good, sha: 'abc' }] },
    { v: 1, labels: [good, { ...good, line: 'two' }] },
    { v: 1, labels: [good, { ...good, line: 0 }] },
    { v: 1, labels: [good, { ...good, extra: 1 }] },
    { v: 1, labels: [good, { path: good.path, sha: good.sha, line: 2 }] },
    { v: 1, labels: [good, 'text'] },
    { v: 1, labels: [good], extra: true },
    { v: 2, labels: [good] },
    { labels: [good] },
    { v: 1, labels: 'x' }
  ];
  for (const labels of bad) {
    const file = put(c.base, 'bad-labels.json', JSON.stringify(labels));
    const r = k.verdict('history', '--labels', file);
    assert.equal(r.status, 3, `${JSON.stringify(labels)}: ${r.all}`);
    assert.match(r.all, /refused: labels/);
  }
  const entry = put(c.base, 'entry-labels.json', JSON.stringify({ v: 1, labels: [good, { ...good, label: 'maybe' }] }));
  assert.match(k.verdict('history', '--labels', entry).all, /refused: labels entry \d+: /);
  const notJson = put(c.base, 'text-labels.json', '{nope');
  assert.equal(k.verdict('history', '--labels', notJson).status, 3);
  const huge = put(c.base, 'huge-labels.json', JSON.stringify({ v: 1, labels: [good], pad: 'x'.repeat(70 * 1024) }));
  assert.equal(k.verdict('history', '--labels', huge).status, 3);
  assert.equal(k.verdict('history', '--labels', path.join(c.base, 'missing.json')).status, 3);
  assert.equal(k.verdict('history', '--labels').status, 3);
  assert.deepEqual(snapshot(c.root), before);
});

test('AC12 history of a plan with a hostile line reports it without failing, and skips a plan over 256 KiB with a warning', async (t) => {
  const c = tmp(t, 'qa-odc-history');
  gitInit(c);
  put(c.root, '.company/work/hostile/00-summary.md', '# x\n');
  put(c.root, '.company/work/hostile/02-plan.md', `## Steps\n${'z'.repeat(5000)}\n\`\`\`\nTBD\n`);
  put(c.root, '.company/work/huge/00-summary.md', '# x\n');
  put(c.root, '.company/work/huge/02-plan.md', `## Steps\n${'TBD\n'.repeat(70000)}`);
  commitAll(c, '2026-10-10T10:00:00Z');
  const r = makeEnv(c).verdict('history');
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /hostile\/02-plan\.md@[0-9a-f]{7}: 2 findings/);
  assert.match(r.out, /\| line too long to check \|/);
  assert.match(r.out, new RegExp(`\\| ${FENCE_WHY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`));
  assert.ok(!r.out.includes('huge/02-plan.md@'));
  assert.match(r.all, /huge/);
});

test('AC12 history with git missing and a plan on disk scans the working tree only, warns once and exits 0', async (t) => {
  const c = tmp(t, 'qa-odc-history');
  mkRun(c.root, 'demo', '## Steps\nTBD\n');
  const r = makeEnv(c).verdict('history');
  assert.equal(r.status, 0, r.all);
  assert.match(r.all, /git unavailable: working tree only/);
  assert.match(r.out, /demo\/02-plan\.md@[0-9a-f]{7} \(working tree\): 1 finding/);
});

test('AC12 history with git missing and no plan on disk exits 1', async (t) => {
  const c = tmp(t, 'qa-odc-history');
  const r = makeEnv(c).verdict('history');
  assert.equal(r.status, 1, r.all);
  assert.match(r.all, /history: git unavailable/);
});

test('hostile slugs and arguments in the verdict commands are refused', async (t) => {
  const { c, k } = historyRepo(t);
  const before = snapshot(c.root);
  for (const args of [['history', '../x'], ['history', '--labels', '--limit', '1'], ['verdict', 'extra']]) {
    const r = k.verdict(...args);
    assert.ok(r.status === 3, `${JSON.stringify(args)}: ${r.all}`);
  }
  assert.deepEqual(snapshot(c.root), before);
});
