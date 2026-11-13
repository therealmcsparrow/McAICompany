import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

const MAX_FILE_BYTES = 1024 * 1024;
const PROGRESS_EVERY = 250;
const WORD = /blast/i;

// Exact path allow-list: a hit anywhere else is a leftover.
const ANY_HIT = new Set([
  'CHANGELOG.md',
  'docs/adr/0016-run-state-record.md',
  'docs/adr/0017-blast-radius-fail-closed.md',
  'docs/adr/0068-remove-blast-radius.md',
  'mods/test/no-commit-gate.test.tsx',
  'scripts/mods-removal-sweep.test.mjs',
  'scripts/settings-retired-keys.test.mjs'
]);
const CONTRACT_HEADER_ONLY = new Set(['docs/contracts/aico-mods.md', 'docs/contracts/aico-settings.md']);
const RETIRED_KEY_RULE = 'scripts/settings.mjs';
const GENERIC_PHRASE = new Set(['agents/product-manager.md', 'tests/golden/product-manager.md']);
const DATED_SPEC = /^docs\/specs\/[^/]+\.md$/;

const DELETED = [
  'mods/blast-radius.ts',
  'mods/lib/blast.mjs',
  'mods/test/blast-radius.test.tsx',
  'scripts/blast-drift.test.mjs',
  'documentation/mods/blast-radius.md'
];

function importPattern(name) {
  return new RegExp(`(?:\\bimport\\b|\\brequire\\b|\\bfrom\\b)[^\\n]*${name}(?:\\.mjs)?['"\`]`);
}

function progress(line) {
  fs.writeSync(2, `mods-removal-sweep: ${line}\n`);
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter((f) => f && !f.startsWith('.company/') && exists(f));
}

function headerEnd(lines) {
  const at = lines.findIndex((l) => l.startsWith('## '));
  return at < 0 ? lines.length : at;
}

function lineHits(rel, text) {
  const lines = text.split('\n');
  const bad = [];
  const limit = CONTRACT_HEADER_ONLY.has(rel) ? headerEnd(lines) : -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!WORD.test(line)) continue;
    if (rel === RETIRED_KEY_RULE) {
      if (WORD.test(line.replaceAll('blast_radius', ''))) bad.push(i + 1);
      continue;
    }
    if (GENERIC_PHRASE.has(rel) || DATED_SPEC.test(rel)) {
      if (WORD.test(line.replaceAll('blast radius', ''))) bad.push(i + 1);
      continue;
    }
    if (limit >= 0 && i < limit) continue;
    bad.push(i + 1);
  }
  return bad;
}

function sweep() {
  const files = trackedFiles();
  progress(`start, ${files.length} tracked files`);
  const found = [];
  let skipped = 0;
  files.forEach((rel, n) => {
    if ((n + 1) % PROGRESS_EVERY === 0) progress(`${n + 1}/${files.length} files`);
    if (WORD.test(rel) && !ANY_HIT.has(rel)) found.push(`${rel} (file name)`);
    if (ANY_HIT.has(rel)) return;
    const full = path.join(root, rel);
    if (fs.statSync(full).size > MAX_FILE_BYTES) {
      skipped++;
      return;
    }
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) return;
    const hits = lineHits(rel, buf.toString('utf8'));
    if (hits.length > 0) found.push(`${rel}:${hits.slice(0, 5).join(',')}`);
  });
  progress(`done, ${found.length} leftover files, ${skipped} skipped for size`);
  return found;
}

const section = (text, startRe, endRe) => {
  const m = startRe.exec(text);
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length);
  const end = rest.search(endRe);
  return end < 0 ? rest : rest.slice(0, end);
};

const body = (rel) => {
  const lines = read(rel).split('\n');
  return lines.slice(headerEnd(lines)).join('\n');
};

describe('leftover sweep over tracked files', () => {
  test('AC2: a case-insensitive search finds the word only on the exact allow-list', () => {
    const found = sweep();
    assert.deepEqual(found, [], `leftovers: ${found.slice(0, 40).join(' | ')}`);
  });

  for (const rel of DELETED) {
    test(`AC2: ${rel} is deleted`, () => {
      assert.equal(exists(rel), false);
    });
  }

  test('AC2: the allow-list holds no wildcard and every listed file exists', () => {
    for (const rel of [...ANY_HIT, ...CONTRACT_HEADER_ONLY, RETIRED_KEY_RULE, ...GENERIC_PHRASE]) assert.ok(exists(rel), rel);
  });
});

describe('both Contracts', () => {
  for (const [rel, name] of [['docs/contracts/aico-mods.md', 'aico-mods'], ['docs/contracts/aico-settings.md', 'aico-settings']]) {
    test(`${name} is at v2.0 with a v2.0 line in its history`, () => {
      const text = read(rel);
      assert.match(text, new RegExp(`^# Contract: ${name} v2\\.0$`, 'm'));
      const lines = text.split('\n');
      const header = lines.slice(0, headerEnd(lines)).join('\n');
      assert.match(header, /^v2\.0\b/m);
    });

    test(`AC8: the ${name} body from the first section heading on holds no removed-mod text`, () => {
      assert.doesNotMatch(body(rel), WORD);
    });
  }

  test('AC8: aico-mods no longer lists a commit gate rule, state key or status part in its body', () => {
    const text = body('docs/contracts/aico-mods.md');
    assert.doesNotMatch(text, /commit gate|tool\.check[^\n]*git commit/i);
    assert.doesNotMatch(text, /<savvy> · <\w+> · <cost> · <reflect>/);
  });

  test('AC8: the consumer lines of review-depth and run-state name no removed mod', () => {
    for (const rel of ['docs/contracts/review-depth.md', 'docs/contracts/run-state.md']) assert.doesNotMatch(read(rel), WORD, rel);
  });

  test('AC8: aico-settings keeps the retired-key rule in words without a key name in its body', () => {
    const text = body('docs/contracts/aico-settings.md');
    assert.match(text, /retired/i);
    assert.match(text, /dropped on read/i);
    assert.match(text, /refused on write/i);
  });
});

describe('release note and docs', () => {
  const log = read('CHANGELOG.md');
  const release = section(log, /^## \[0\.37\.0\][^\n]*\n/m, /^## \[/m);
  const removed = section(release, /^### Removed[^\n]*\n/m, /^### /m);

  test('AC9: CHANGELOG 0.37.0 has a Removed note', () => {
    assert.ok(release.length > 0, 'no 0.37.0 section');
    assert.ok(removed.trim().length > 0, 'no ### Removed under 0.37.0');
  });

  test('AC9: the note says the mod is removed and old keys are ignored then refused on save', () => {
    assert.match(removed, /Blast Radius/);
    assert.match(removed, /removed/i);
    assert.match(removed, /mods\.blast_radius/);
    assert.match(removed, /ignored/i);
    assert.match(removed, /refus/i);
  });

  test('AC9: the note says git commit is no longer asked, warned or refused', () => {
    assert.match(removed, /git commit/);
    assert.match(removed, /no longer/i);
    assert.match(removed, /\bask/i);
    assert.match(removed, /\bwarn/i);
  });

  test('AC9: the note says the guard now runs in review and names the three skills', () => {
    for (const skill of ['aico:review', 'aico:contracts', 'aico:security-check']) assert.ok(removed.includes(skill), skill);
    assert.match(removed, /Blocking/);
  });

  test('AC9: the note points to a repo git hook and names both Contract majors', () => {
    assert.match(removed, /git hook/i);
    assert.match(removed, /`?aico-mods`? v2\.0/);
    assert.match(removed, /`?aico-settings`? v2\.0/);
  });

  const docs = ['README.md', 'GLOSSARY.md', 'docs/spec.md', 'documentation/README.md', 'documentation/mods/README.md'];
  for (const rel of docs) {
    test(`AC9: ${rel} says three mods and no file says four`, () => {
      const lines = read(rel).split('\n');
      // documentation/mods/README.md names the mods in a table, so "three small add-ons" alone counts there.
      const names = rel === 'documentation/mods/README.md' ? /\b(?:mods|add-ons)\b/i : /(?=.*Savvy)(?=.*Reflect)/;
      assert.ok(lines.some((l) => /\bthree\b/i.test(l) && names.test(l)), 'no line names three mods');
      assert.equal(lines.filter((l) => /\bfour (?:mods|add-ons)\b|There are four\b/i.test(l)).length, 0);
    });
  }
});

describe('git-commit detector removal', () => {
  test('mods/lib/git-commit.mjs does not exist', () => {
    assert.equal(exists('mods/lib/git-commit.mjs'), false);
  });

  test('no tracked file outside CHANGELOG and Contract headers imports git-commit', () => {
    const name = ['git', 'commit'].join('-');
    const importer = importPattern(name);
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
      .toString('utf8').split('\0').filter(Boolean)
      .filter((rel) => rel !== 'CHANGELOG.md' && !rel.startsWith('docs/contracts/'));
    progress(`import walk start, ${files.length} tracked files`);
    const hits = [];
    for (const [n, rel] of files.entries()) {
      if ((n + 1) % PROGRESS_EVERY === 0) progress(`import walk ${n + 1}/${files.length} files`);
      if (!exists(rel)) continue;
      const abs = path.join(root, rel);
      if (fs.statSync(abs).size > MAX_FILE_BYTES) continue;
      if (importer.test(fs.readFileSync(abs, 'utf8'))) hits.push(rel);
    }
    progress(`import walk done, ${hits.length} importing files`);
    assert.deepEqual(hits, []);
  });

  test('the import pattern matches real import, require and from lines', () => {
    const name = ['git', 'commit'].join('-');
    const importer = importPattern(name);
    assert.match(`import { x } from './lib/${name}.mjs';`, importer);
    assert.match(`const x = require('../${name}');`, importer);
    assert.doesNotMatch(`// the ${name} detector is gone`, importer);
  });
});
