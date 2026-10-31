import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const HOME_FILE = 'mods/lib/work-folder.mjs';
const MAX_FILE = 1024 * 1024;
const SNIP = 100;

// The legacy work folder slug source with an upper bound of 55 to 65.
const LEGACY_SOURCE = /\[a-z0-9\]\[a-z0-9-\]\{\d{1,3},(?:5[5-9]|6[0-5])\}/;

// Each key is `<file>#<CONSTANT>`; only the line declaring that constant is exempt.
export const ALLOW = [
  'scripts/check.mjs#MANIFEST_NAME_RE',
  'scripts/install-skills.mjs#NAME_RE',
  'scripts/install-skills.mjs#MANIFEST_NAME_RE',
  'scripts/install-skills.mjs#PLUGIN_RE',
  'scripts/skillspector.mjs#NAME_RE',
  'scripts/plan-review.mjs#CASE_NAME',
  'scripts/qa-timing.mjs#STEM',
  'scripts/idea-flow.mjs#NAME',
  'scripts/idea-flow.mjs#FINAL_NAME',
  'scripts/lessons.mjs#STANDARD_TARGET_RE',
];

const PLACEHOLDERS = ['<slug>', '<name>', '<run>', '<task>', '<build>', '<parent>'];
const SCRIPT_NAMES = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
  .flatMap((f) => [f, f.slice(0, -4)]);
const FIRST_WORDS = new Set(['node', 'git', 'bash', ...SCRIPT_NAMES]);

const snip = (s) => s.trim().slice(0, SNIP);

function declares(line, constant) {
  return new RegExp(`^\\s*(?:export\\s+)?const ${constant}\\s*=`).test(line);
}

// One hit per line holding the legacy slug source, outside the allow-listed declarations.
export function oneHomeHits(rel, text) {
  if (rel === HOME_FILE) return [];
  const exempt = ALLOW.filter((k) => k.startsWith(`${rel}#`)).map((k) => k.slice(rel.length + 1));
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!LEGACY_SOURCE.test(line)) return;
    if (exempt.some((c) => declares(line, c))) return;
    hits.push(`${rel}:${i + 1} — ${snip(line)}`);
  });
  return hits;
}

// Code spans and fenced code lines; a fenced line ending in a backslash joins the next one.
export function codeSpans(text) {
  const out = [];
  let fenced = false;
  let carry = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      carry = null;
      continue;
    }
    if (fenced) {
      const t = line.trim();
      const joined = carry === null ? t : `${carry} ${t}`;
      if (t.endsWith('\\')) carry = joined.slice(0, -1);
      else {
        carry = null;
        out.push(joined);
      }
      continue;
    }
    for (const m of line.matchAll(/`([^`]+)`/g)) out.push(m[1]);
  }
  if (carry !== null) out.push(carry);
  return out;
}

const isShell = (span) => FIRST_WORDS.has(span.trim().split(/\s+/)[0]);

// Placeholders outside single quotes on a shell line, whatever they stand for.
export function unquotedPlaceholders(span) {
  if (!isShell(span)) return [];
  const hits = [];
  let inQuote = false;
  for (let i = 0; i < span.length; i++) {
    if (span[i] === "'") inQuote = !inQuote;
    else if (!inQuote) {
      for (const p of PLACEHOLDERS) if (span.startsWith(p, i)) hits.push(p);
    }
  }
  return hits;
}

// A `work-folder new` call whose --topic is not file or none.
export function badTopic(span) {
  if (!isShell(span)) return false;
  if (!/(?:^|[\s'"/])work-folder(?:\.mjs)?['"]?\s+new(?:\s|$)/.test(span)) return false;
  const m = span.match(/--topic\s+(?:'([^']*)'|"([^"]*)"|(\S+))/);
  if (!m) return /--playbook/.test(span);
  const value = m[1] ?? m[2] ?? m[3];
  return value !== 'file' && value !== 'none';
}

export function markdownHits(rel, text) {
  const hits = [];
  for (const span of codeSpans(text)) {
    for (const p of unquotedPlaceholders(span)) hits.push(`${rel} — ${p} unquoted in: ${snip(span)}`);
    if (badTopic(span)) hits.push(`${rel} — bad work-folder new --topic in: ${snip(span)}`);
  }
  return hits;
}

// Fixed roots, no links followed, .company and node_modules skipped.
export function walk(root, dir, accept) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let names;
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (name === '.company' || name === 'node_modules') continue;
      const full = join(d, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) stack.push(full);
      else if (st.isFile()) {
        const rel = relative(root, full).split('\\').join('/');
        if (accept(rel)) out.push(rel);
      }
    }
  }
  return out.sort();
}

const isTest = (rel) => /\.test\.(mjs|tsx?)$/.test(rel) || rel.startsWith('mods/test/');
const oneHomeFile = (rel) =>
  (rel.startsWith('scripts/') && !rel.slice(8).includes('/') && rel.endsWith('.mjs') && !isTest(rel)) ||
  (rel.startsWith('mods/') && /\.(mjs|tsx?)$/.test(rel) && !isTest(rel));

function readCapped(root, rel) {
  const full = join(root, rel);
  if (lstatSync(full).size > MAX_FILE) return null;
  return readFileSync(full, 'utf8');
}

export function scanOneHome(root) {
  const hits = [];
  const files = [...walk(root, join(root, 'scripts'), oneHomeFile), ...walk(root, join(root, 'mods'), oneHomeFile)];
  for (const rel of files) {
    const text = readCapped(root, rel);
    if (text === null) hits.push(`${rel} — over 1 MiB, not scanned`);
    else hits.push(...oneHomeHits(rel, text));
  }
  return hits;
}

export function scanMarkdown(root) {
  const hits = [];
  const files = [
    ...walk(root, join(root, 'skills'), (rel) => rel.endsWith('.md')),
    ...walk(root, join(root, 'agents'), (rel) => rel.endsWith('.md') && rel.split('/').length === 2),
  ];
  for (const rel of files) {
    const text = readCapped(root, rel);
    if (text === null) hits.push(`${rel} — over 1 MiB, not scanned`);
    else hits.push(...markdownHits(rel, text));
  }
  return hits;
}

// Hostile and plan fixtures first.

test('one-home: a legacy slug pattern in a new script is one hit', () => {
  const hits = oneHomeHits('scripts/x.mjs', 'const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;\n');
  assert.equal(hits.length, 1);
  assert.match(hits[0], /^scripts\/x\.mjs:1 /);
});

test('one-home: the same pattern declared as an allow-listed constant is allowed', () => {
  assert.deepEqual(oneHomeHits('scripts/skillspector.mjs', 'export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;\n'), []);
  assert.deepEqual(oneHomeHits('scripts/install-skills.mjs', 'const PLUGIN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;\n'), []);
});

test('one-home: the allow-list is keyed by file and constant, not by constant alone', () => {
  assert.equal(oneHomeHits('scripts/x.mjs', 'const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;\n').length, 1);
  assert.equal(oneHomeHits('scripts/skillspector.mjs', 'const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;\n').length, 1);
  assert.equal(oneHomeHits('scripts/skillspector.mjs', 'let NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;\n').length, 1);
});

test('one-home: the allow-list exempts only the declaring line', () => {
  const text = [
    'const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;',
    "const msg = 'name must match ^[a-z0-9][a-z0-9-]{0,63}$';",
    'const OTHER = /^[a-z0-9][a-z0-9-]{0,63}$/;',
  ].join('\n');
  const hits = oneHomeHits('scripts/skillspector.mjs', text);
  assert.equal(hits.length, 2);
  assert.match(hits[0], /:2 /);
  assert.match(hits[1], /:3 /);
});

test('one-home: every bound from 55 to 65 is caught in a regex, a string and a message', () => {
  for (const n of [55, 57, 60, 61, 63, 64, 65]) {
    assert.equal(oneHomeHits('scripts/x.mjs', `const A = /^[a-z0-9][a-z0-9-]{0,${n}}$/;`).length, 1, `{0,${n}}`);
    assert.equal(oneHomeHits('mods/lib/x.mjs', `const A = new RegExp('^[a-z0-9][a-z0-9-]{2,${n}}$');`).length, 1, `{2,${n}}`);
    assert.equal(oneHomeHits('scripts/x.mjs', `fail('slug must match [a-z0-9][a-z0-9-]{0,${n}}');`).length, 1, `msg ${n}`);
  }
});

test('one-home: bounds outside 55 to 65 and other classes are not the legacy source', () => {
  assert.deepEqual(oneHomeHits('scripts/x.mjs', 'const A = /^[a-z0-9][a-z0-9-]{0,40}$/;'), []);
  assert.deepEqual(oneHomeHits('scripts/x.mjs', 'const A = /^[a-z0-9][a-z0-9-]{0,66}$/;'), []);
  assert.deepEqual(oneHomeHits('scripts/x.mjs', 'const A = /^[a-z][a-z0-9-]{0,63}$/;'), []);
});

test('one-home: the one home file is skipped and CRLF text is still scanned line by line', () => {
  assert.deepEqual(oneHomeHits(HOME_FILE, 'const LEGACY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;'), []);
  const hits = oneHomeHits('scripts/x.mjs', 'a\r\nconst S = /^[a-z0-9][a-z0-9-]{0,63}$/;\r\n');
  assert.equal(hits.length, 1);
  assert.match(hits[0], /:2 /);
});

test('one-home: a very long line is scanned in linear time and the report is capped', () => {
  const line = `${'a'.repeat(200000)} [a-z0-9][a-z0-9-]{0,63} ${'['.repeat(50000)}`;
  const start = Date.now();
  const hits = oneHomeHits('scripts/x.mjs', line);
  assert.ok(Date.now() - start < 2000);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].length < 200);
});

test('placeholders: an unquoted name on a shell line is a hit', () => {
  assert.deepEqual(unquotedPlaceholders('node x.mjs run <slug>'), ['<slug>']);
  assert.deepEqual(unquotedPlaceholders('rule-check.mjs run <name> --x <task>'), ['<name>', '<task>']);
  assert.deepEqual(unquotedPlaceholders('ledger report <run>'), ['<run>']);
  assert.deepEqual(unquotedPlaceholders('git add <build> <parent>'), ['<build>', '<parent>']);
  assert.deepEqual(unquotedPlaceholders('bash -c "x <slug>"'), ['<slug>']);
});

test('placeholders: single-quoted and non-shell uses pass', () => {
  assert.deepEqual(unquotedPlaceholders("node x.mjs run '<slug>'"), []);
  assert.deepEqual(unquotedPlaceholders("node x.mjs run '.company/work/<name>/a.md'"), []);
  assert.deepEqual(unquotedPlaceholders('/aico:fix <slug>'), []);
  assert.deepEqual(unquotedPlaceholders('.company/work/<slug>/plan.md'), []);
});

test('placeholders: a double-quoted name is still a hit, a quote after the name does not hide it', () => {
  assert.deepEqual(unquotedPlaceholders('node x.mjs run "<slug>"'), ['<slug>']);
  assert.deepEqual(unquotedPlaceholders("node x.mjs run <slug> 'a'"), ['<slug>']);
});

test('placeholders: fenced lines and backslash continuations are shell lines', () => {
  const text = ['```bash', 'node x.mjs run \\', '  --run <slug>', '```', 'prose `node y.mjs <task>`'].join('\n');
  assert.deepEqual(markdownHits('skills/a/SKILL.md', text).map((h) => h.split(' — ')[1].split(' ')[0]), ['<slug>', '<task>']);
});

test('placeholders: scripts named with or without the extension count as shell lines', () => {
  assert.deepEqual(unquotedPlaceholders('work-folder new --name <name>'), ['<name>']);
  assert.deepEqual(unquotedPlaceholders('work-folder.mjs branch <name>'), ['<name>']);
});

test('topic: work-folder new with a --topic other than file or none is a hit', () => {
  const run = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" work-folder new --playbook';
  assert.equal(badTopic(`${run} 'fix' --topic file`), false);
  assert.equal(badTopic(`${run} 'fix' --topic none`), false);
  assert.equal(badTopic(`${run} 'fix' --topic 'file'`), false);
  assert.equal(badTopic(`${run} 'fix' --topic 'Login Bug'`), true);
  assert.equal(badTopic(`${run} 'fix' --topic Login`), true);
  assert.equal(badTopic(`${run} 'fix' --topic "$(cat x)"`), true);
  assert.equal(badTopic(`${run} 'fix' --topic filex`), true);
  assert.equal(badTopic(`${run} 'fix'`), true);
});

test('topic: a prose mention and other commands are not a call', () => {
  assert.equal(badTopic('work-folder new'), false);
  assert.equal(badTopic('work-folder clear --playbook x'), false);
  assert.equal(badTopic('node x.mjs other --topic Foo'), false);
  assert.equal(badTopic('not-work-folder new --playbook x --topic Foo'), false);
});

// Walk behaviour.

test('walk: skips .company and node_modules and never follows a link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-guard-'));
  try {
    mkdirSync(join(dir, 'scripts', 'sub'), { recursive: true });
    mkdirSync(join(dir, 'scripts', 'node_modules'), { recursive: true });
    mkdirSync(join(dir, 'scripts', '.company'), { recursive: true });
    mkdirSync(join(dir, 'outside'), { recursive: true });
    for (const f of ['scripts/a.mjs', 'scripts/sub/b.mjs', 'scripts/node_modules/c.mjs', 'scripts/.company/d.mjs', 'outside/e.mjs']) {
      writeFileSync(join(dir, f), 'x\n');
    }
    let linked = false;
    try {
      symlinkSync(join(dir, 'outside'), join(dir, 'scripts', 'link'), 'junction');
      linked = true;
    } catch {
      linked = false;
    }
    const found = walk(dir, join(dir, 'scripts'), (rel) => rel.endsWith('.mjs'));
    assert.deepEqual(found, ['scripts/a.mjs', 'scripts/sub/b.mjs']);
    assert.ok(linked || found.length === 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scan: the roots hold the files the guard is meant to read', () => {
  const files = [...walk(ROOT, join(ROOT, 'scripts'), oneHomeFile), ...walk(ROOT, join(ROOT, 'mods'), oneHomeFile)];
  assert.ok(files.includes('scripts/check.mjs'));
  assert.ok(files.includes('mods/lib/plan-gate.mjs'));
  assert.ok(files.includes('mods/reflect.tsx'));
  assert.ok(!files.some((f) => f.endsWith('.test.mjs') || f.startsWith('mods/test/')));
});

// The repo.

test('allow-list: exactly the ten keys, each still declared in its file', () => {
  assert.equal(ALLOW.length, 10);
  assert.equal(new Set(ALLOW).size, 10);
  for (const key of ALLOW) {
    const [file, constant] = key.split('#');
    const text = readFileSync(join(ROOT, file), 'utf8');
    const line = text.split(/\r?\n/).find((l) => declares(l, constant));
    assert.ok(line, `${key} has no declaring line`);
    assert.ok(LEGACY_SOURCE.test(line), `${key} no longer holds the legacy source`);
  }
});

test('the one home exists and holds the legacy slug source', () => {
  assert.match(readFileSync(join(ROOT, HOME_FILE), 'utf8'), LEGACY_SOURCE);
});

test('one-home: no work folder check outside mods/lib/work-folder.mjs', () => {
  assert.deepEqual(scanOneHome(ROOT), []);
});

test('skills and agents: every placeholder on a shell line is single-quoted and every work-folder new takes --topic file or none', () => {
  assert.deepEqual(scanMarkdown(ROOT), []);
});

test('this file is LF only', () => {
  assert.ok(!readFileSync(import.meta.filename, 'utf8').includes('\r'));
});
