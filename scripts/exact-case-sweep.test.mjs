// AC5 sweep for exact letter case of work paths (ADR 0053, work-folder-name v1.1).
// Static scan of the real source files, no mocks. Fails on: a work-path case fold outside the allow-list,
// an in-scope script that does not call the one shared `exactWorkPath`, a Contract without `wrong letter case`,
// or ADR 0053 not `accepted (CEO, 2026-11-01)`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Scripts that take a typed work folder, file or path (T2-T12) plus the work-folder CLI.
const IN_SCOPE = [
  'draft-input', 'grill', 'spec-check', 'ticket-approval', 'plan-review', 'review-loop',
  'run-state', 'run-guard', 'lead-handover', 'handoff-lint', 'plan-check', 'plan-tasks',
  'tier-set', 'worktree', 'idea-flow', 'reflect', 'skillspector', 'skill-picks',
  'ledger', 'rule-check', 'drift-report', 'reprompt-check', 'work-folder',
].map((n) => `scripts/${n}.mjs`);

// Scanned for folds as well, but not required to call the check (no typed work name).
const NO_TYPED_NAME = ['scripts/cited.mjs'];
// Not scanned, by file, with the reason.
const FILE_ALLOW = {
  'mods/lib/reprompt-gate.mjs': 'hook allow-list over whole absolute paths incl. project and plugin roots; takes no typed work folder name',
};

const LIB = 'mods/lib/work-folder.mjs';

// A line that folds case: a case conversion, a case-insensitive regex literal, or a known old fold helper.
const FOLD_LINE = /toLowerCase|toUpperCase|toLocaleLowerCase|toLocaleUpperCase|localeCompare|\/[dgmsuvy]*i[dgmsuvy]*(?=[.),;\s]|$)|\bsameName\b|\bCASE_FOLD\b|\bCI_FS\b|\bsameReal\b|\bFOLD\b/;
// Old fold helpers that must be gone everywhere in scope.
const BANNED = /\b(sameName|CASE_FOLD|CI_FS|sameReal|FOLD)\b/;

// Allow-list of the folds that remain: [file, snippet in the line, reason]. A fold is allowed only if it never
// grants access to a work path: it picks a refusal word, or it works on a non-work path or a storage key.
const ALLOW = [
  ['scripts/draft-input.mjs', ".replace(/[A-Z]/g, (c) => c.toLowerCase()) === WORK_PREFIX", 'ASCII fold that only picks the refusal wording (wrong letter case); never grants access'],
  ['scripts/draft-input.mjs', '/^GIT_/i', 'environment variable names'],
  ['scripts/grill.mjs', '/^grill\\.md$/i', 'recognises a grill.md variant so readGrill refuses it with wrong letter case'],
  ['scripts/grill.mjs', ".replace(/[A-Z]/g, (c) => c.toLowerCase()) === WORK_PREFIX", 'ASCII fold that only picks the refusal wording (wrong letter case); never grants access'],
  ['scripts/spec-check.mjs', ".replace(/[A-Z]/g, (c) => c.toLowerCase()) === WORK_DIR", 'ASCII fold that only picks the refusal wording (wrong letter case); never grants access'],
  ['scripts/reflect.mjs', 'const ascii = x => x.replace(/[A-Z]/g, c => c.toLowerCase());', 'ASCII fold helper that only picks the refusal wording (wrong letter case); never grants access'],
  ['scripts/spec-check.mjs', 'EXTENSIONS.has(', 'file extension list'],
  ['scripts/ticket-approval.mjs', '/^(?:con|prn|aux|nul', 'Windows device names'],
  ['scripts/ticket-approval.mjs', 'TASKS_TITLE =', 'plan heading text'],
  ['scripts/ticket-approval.mjs', 'return p.toLowerCase();', 'repo path key for ticket file lists, outside the work folder name rule'],
  ['scripts/plan-review.mjs', "trimAlias(first).toLowerCase() === '.company'", 'detects a case variant of .company so it is refused'],
  ['scripts/plan-review.mjs', '/^none\\b/i', 'Blocking row text'],
  ['scripts/review-loop.mjs', '/^GIT_/i', 'environment variable names'],
  ['scripts/handoff-lint.mjs', 'NONE_RE =', 'Handoff section text'],
  ['scripts/handoff-lint.mjs', "DEVICE_RE.test(", 'Windows device names'],
  ['scripts/handoff-lint.mjs', "=== '.git'", '.git/.env guard, not a work path'],
  ['scripts/handoff-lint.mjs', 'const fold = x => x.toLowerCase();', 'wrongWorkCase: finds a typed .company/work pair in any case so it is refused'],
  ['scripts/plan-check.mjs', 'SECTION_TITLE =', 'plan heading text'],
  ['scripts/plan-tasks.mjs', 'CONTRACTS_TITLE =', 'plan heading text'],
  ['scripts/plan-tasks.mjs', "=== '.git'", '.git guard, not a work path'],
  ['scripts/plan-tasks.mjs', "startsWith('.env')", '.env guard, not a work path'],
  ['scripts/plan-tasks.mjs', 'DEVICE.test(', 'Windows device names'],
  ['scripts/plan-tasks.mjs', ".join('/').toLowerCase()", 'keyOf: repo path key for task file scopes; the run folder prefix compares exact (inRunFolder)'],
  ['scripts/plan-tasks.mjs', 'behaviour.toLowerCase()', 'words of ticket text'],
  ['scripts/tier-set.mjs', ".join('/').toLowerCase()", 'repo path key for file scopes outside .company/work'],
  ['scripts/tier-set.mjs', '    .toLowerCase()', 'repo path key for file scopes outside .company/work'],
  ['scripts/tier-set.mjs', '/^GIT_/i', 'environment variable names'],
  ['scripts/tier-set.mjs', ".at(-1)).toLowerCase()", '.env guard on a repo path'],
  ['scripts/worktree.mjs', "r.toLowerCase() : r", 'sameKey: compares repo and worktree paths (git output), not a typed work folder'],
  ['scripts/worktree.mjs', "key.toUpperCase().startsWith('GIT_')", 'environment variable names'],
  ['scripts/worktree.mjs', "base.slice(0, end).toLowerCase()", 'attrAlias: .gitattributes alias guard'],
  ['scripts/worktree.mjs', 'ID_.toLowerCase()', 'git ref id'],
  ['scripts/worktree.mjs', "seg.toLowerCase().startsWith('.env')", '.env guard on a repo path'],
  ['scripts/skillspector.mjs', 'k.toUpperCase() === want.toUpperCase()', 'environment variable names on win32'],
  ['scripts/skillspector.mjs', 'i.severity.toLowerCase()', 'scanner severity'],
  ['scripts/skillspector.mjs', "n.toLowerCase() === 'skill.md'", 'skill file name, not a work path'],
  ['scripts/skillspector.mjs', 'f.declared.toLowerCase()', 'skill name'],
  ['scripts/skillspector.mjs', 'a.relativePath.localeCompare', 'sort order'],
  ['scripts/skillspector.mjs', 'String(r.stdout).trim().toLowerCase()', 'scanner output'],
  ['scripts/rule-check.mjs', "c.toLowerCase()", 'file extension'],
  ['scripts/rule-check.mjs', '/^GIT_/i', 'environment variable names'],
  ['scripts/rule-check.mjs', '/^\\.company$/i.test(segs[0])', 'detects a case variant of .company/work so it is refused'],
  ['scripts/drift-report.mjs', "=== '.git'", '.git/.env guard, not a work path'],
  ['scripts/drift-report.mjs', '/^\\.company\\/work\\//i', 'detects a case variant of the work prefix so it is refused'],
  ['scripts/reprompt-check.mjs', 'toString(16).toUpperCase()', 'hex digits of a code point'],
  ['scripts/reprompt-check.mjs', 'const fold = s =>', 'recordFile: run-record storage key hash, kept so live records are not orphaned; the name has already passed exactWorkPath'],
  ['scripts/reprompt-check.mjs', 'const foldCase =', 'plugin cache path compare, outside the work folder'],
  ['scripts/reprompt-check.mjs', 'const TRIAGE_RE =', 'prompt text pattern'],
  ['scripts/reprompt-check.mjs', '(nl < 0 ? entry : entry.slice(0, nl)).toLowerCase()', 'run-record entry key, not a path'],
  ['scripts/reprompt-check.mjs', '/^en(-|$)/i', 'language tag'],
  [LIB, 'isSuffixWord', 'folder name suffix words'],
  [LIB, 'part[0].toUpperCase()', 'builds a new folder name'],
  [LIB, '.slice(19).toLowerCase()', 'git ref part of a name'],
];

function foldLines(rel) {
  const found = [];
  read(rel).split(/\r?\n/).forEach((line, i) => {
    const code = line.trim();
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
    if (FOLD_LINE.test(line)) found.push({ no: i + 1, line });
  });
  return found;
}

const SCANNED = [...IN_SCOPE, ...NO_TYPED_NAME, LIB];

test('AC5 every case fold left in a work-path script is on the allow-list', () => {
  const stray = [];
  for (const rel of SCANNED) {
    for (const { no, line } of foldLines(rel)) {
      if (!ALLOW.some(([file, snippet]) => file === rel && line.includes(snippet))) stray.push(`${rel}:${no}: ${line.trim()}`);
    }
  }
  assert.deepEqual(stray, [], `case fold outside exactWorkPath and the allow-list:\n${stray.join('\n')}`);
});

test('AC5 the allow-list has no stale entry', () => {
  const stale = ALLOW.filter(([file, snippet]) => !foldLines(file).some(({ line }) => line.includes(snippet)));
  assert.deepEqual(stale.map(([f, s]) => `${f}: ${s}`), []);
});

test('AC5 the old fold helpers are gone from every in-scope script', () => {
  const left = [];
  for (const rel of SCANNED) {
    read(rel).split(/\r?\n/).forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith('//')) return;
      if (BANNED.test(line)) left.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(left, []);
});

test('AC5 every in-scope script calls the one shared check', () => {
  const missing = [];
  for (const rel of IN_SCOPE) {
    const src = read(rel);
    const importsIt = /import\s*\{[^}]*\bexactWorkPath\b[^}]*\}\s*from\s*'\.\.\/mods\/lib\/work-folder\.mjs'/.test(src);
    const calls = src.split(/\r?\n/).some((l) => !l.trim().startsWith('//') && /\bexactWorkPath\s*\(/.test(l) && !/\b(function|const|let)\s+exactWorkPath\b/.test(l));
    if (!importsIt || !calls) missing.push(`${rel} (import ${importsIt}, call ${calls})`);
  }
  assert.deepEqual(missing, []);
});

test('AC5 exactWorkPath has one definition, in the library, and no script copies it', () => {
  const defs = [];
  for (const rel of [...IN_SCOPE, ...NO_TYPED_NAME, LIB]) {
    if (/(function|const|let|var)\s+exactWorkPath\b/.test(read(rel))) defs.push(rel);
  }
  assert.deepEqual(defs, [LIB]);
  // The library's own ASCII fold is used only inside exactWorkPath.
  const lib = read(LIB);
  const start = lib.indexOf('export function exactWorkPath');
  const end = lib.indexOf('\n}\n', start);
  assert.ok(start > 0 && end > start, 'exactWorkPath body found');
  const outside = lib.slice(0, start) + lib.slice(end);
  const uses = outside.split(/\r?\n/).filter((l) => /\basciiFold\b/.test(l) && !/const asciiFold\b/.test(l));
  assert.deepEqual(uses, []);
});

test('AC5 the allow-listed hook file is not an in-scope script and is named with a reason', () => {
  for (const [file, why] of Object.entries(FILE_ALLOW)) {
    assert.ok(why.length > 10, `${file} needs a reason`);
    assert.ok(!SCANNED.includes(file));
    read(file); // exists
  }
});

// Contracts of the in-scope scripts, plus the shared one. cited-report takes no typed name (it only lost a fold
// dedupe), so it carries no refusal.
const CONTRACTS = [
  'work-folder-name', 'draft-input', 'grill-file', 'destination-spec', 'ticket-approval', 'plan-review',
  'review-loop', 'run-state', 'run-guard', 'lead-handoff', 'handoff', 'plan-check', 'plan-tasks',
  'tier-sets', 'worktree', 'idea-flow', 'reflect', 'skillspector-scan', 'skill-recommendation',
  'token-ledger', 'rule-check', 'drift-report', 'reprompt',
];

test('AC5 every Contract of an in-scope script names `wrong letter case`', () => {
  const lacking = CONTRACTS.filter((c) => !/wrong letter case/.test(read(`docs/contracts/${c}.md`)));
  assert.deepEqual(lacking, []);
});

test('AC5 ADR 0053 exists with status accepted', () => {
  const adr = read('docs/adr/0053-exact-letter-case-work-paths.md');
  assert.match(adr, /^# Exact letter case for work folder paths\r?$/m);
  assert.match(adr, /^Status: accepted \(CEO, 2026-11-01\)\r?$/m);
});

// True when any `### Security` block, in any release section, names the refusal.
function hasSecurityRefusal(log) {
  const blocks = log.split(/\r?\n(?=#{2,3} )/).filter((b) => /^### Security\b/.test(b));
  return blocks.some((b) => /wrong letter case/.test(b));
}

test('AC5 the CHANGELOG has a Security entry naming the refusal, before or after a release rolls it', () => {
  const log = read('CHANGELOG.md');
  assert.ok(log.includes('## [Unreleased]'), 'Unreleased heading');
  assert.ok(hasSecurityRefusal(log), 'Security entry naming wrong letter case');
  // A release moves the entry under a version heading; the check must still find it.
  const rolled = log.replace('## [Unreleased]', '## [Unreleased]\n\n## [9.9.9] - 2099-01-01');
  assert.ok(hasSecurityRefusal(rolled), 'found after the release roll');
  // Removing the entry must still fail.
  assert.ok(!hasSecurityRefusal(rolled.replace(/wrong letter case/g, 'x')), 'missing entry is detected');
  assert.ok(!hasSecurityRefusal(rolled.replace(/^### Security\r?$/gm, '### Fixed')), 'missing heading is detected');
});
