// Pins the docs for grill, to-spec and to-tickets: entries, README rows, counts, changelog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const commands = read('documentation/commands.md');
const readme = read('README.md');
const NAMES = ['grill', 'to-spec', 'to-tickets'];

test('each command has entry and README row', () => {
  for (const n of NAMES) {
    assert.ok(commands.includes(`### \`/aico:${n}\``), `entry ${n}`);
    assert.ok(readme.includes(`| \`/aico:${n} `), `README row ${n}`);
  }
});

test('privacy line names the argument file path and no false gitignore claim', () => {
  assert.ok(commands.includes('.company/draft-input-arg-'));
  assert.doesNotMatch(commands, /which the repo `\.gitignore` covers/);
  assert.doesNotMatch(commands, /`\.company\/work\/`[^.]*\.gitignore. covers/);
});

test('feature entry names draft inputs', () => {
  const feature = commands.split('### `/aico:feature`')[1].split('\n### ')[0];
  assert.match(feature, /draft file/);
  for (const f of ['grill.md', 'spec.md', 'plan.md']) assert.ok(feature.includes(f), f);
  assert.match(feature, /Blocking/);
});

test('ten commands only you start', () => {
  assert.match(commands, /Ten commands are never started/);
  const line = commands.split('\n').find(l => l.startsWith('**Commands only you start.**'));
  for (const n of ['help', 'version', 'language', 'settings', 'setup', 'skillspector', 'pentest', ...NAMES]) {
    assert.ok(line.includes(`\`${n}\``), n);
  }
});

test('privacy clause covers the draft files', () => {
  assert.match(commands, /grill\.md/);
  assert.match(commands, /Art\. 5\(1\)\(c\)/);
});

test('privacy text names real destinations', () => {
  const changelog = read('CHANGELOG.md');
  for (const t of [commands, changelog]) {
    assert.doesNotMatch(t, /never committed or sent/);
    assert.doesNotMatch(t, /git-ignored `\.company\/` folder/);
  }
  assert.match(commands, /web searches/);
  assert.match(commands, /erasure/);
  assert.match(changelog, /web searches/);
});

test('company types table lists the new commands', () => {
  const concepts = read('documentation/concepts.md');
  const rows = concepts.split('\n').filter(l => /^\| `(software|research|marketing|design)` \(/.test(l));
  assert.equal(rows.length, 4);
  for (const r of rows) assert.ok(r.includes('grill'), r.slice(0, 20));
  const sw = rows.find(r => r.startsWith('| `software`'));
  assert.ok(sw.includes('to-spec') && sw.includes('to-tickets'));
  for (const r of rows.filter(r => !r.startsWith('| `software`'))) {
    assert.ok(!r.includes('to-spec') && !r.includes('to-tickets'));
  }
});

test('changelog Unreleased mentions the commands', () => {
  const unreleased = read('CHANGELOG.md').split('## [Unreleased]')[1].split('\n## [')[0];
  for (const n of NAMES) assert.ok(unreleased.includes(`/aico:${n}`), n);
  assert.ok(!/\r/.test(unreleased));
});

test('spec.md mentions the drafts', () => {
  const spec = read('docs/spec.md');
  for (const n of NAMES) assert.ok(spec.includes(`/aico:${n}`), n);
  assert.ok(!/git-ignored/i.test(spec), 'no git-ignored claim');
  assert.ok(!/never sent/i.test(spec), 'no never-sent claim');
  assert.ok(spec.includes('grill-file v1 Personal data'), 'points to Personal data');
});

// Regression: the release moves Unreleased to the newest version section before npm test runs.
// Runs a copy of this file against a fixture root so the real changelog check is what is judged.
function runChangelogCheck(changelog) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grill-cl-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'));
    fs.mkdirSync(path.join(tmp, 'documentation'));
    fs.copyFileSync(path.join(root, 'scripts/grill-spec-docs.test.mjs'), path.join(tmp, 'scripts/grill-spec-docs.test.mjs'));
    fs.copyFileSync(path.join(root, 'documentation/commands.md'), path.join(tmp, 'documentation/commands.md'));
    fs.copyFileSync(path.join(root, 'README.md'), path.join(tmp, 'README.md'));
    fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), changelog);
    return spawnSync(process.execPath, ['--test', '--test-name-pattern=changelog Unreleased mentions the commands',
      path.join(tmp, 'scripts/grill-spec-docs.test.mjs')], { encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
const ENTRY = '- **Grill, spec and tickets.** `/aico:grill`, `/aico:to-spec`, `/aico:to-tickets`.\n';

test('regression: changelog check passes after release (commands under newest version, Unreleased empty)', () => {
  const r = runChangelogCheck(`# Changelog\n\n## [Unreleased]\n\n## [0.22.0] - 2026-10-30\n\n### Added\n${ENTRY}\n## [0.21.0] - 2026-10-29\n\n- old\n`);
  assert.equal(r.status, 0, r.stdout.slice(-800));
});

test('control: changelog check passes before release (commands under Unreleased)', () => {
  const r = runChangelogCheck(`# Changelog\n\n## [Unreleased]\n\n### Added\n${ENTRY}\n## [0.21.0] - 2026-10-29\n\n- old\n`);
  assert.equal(r.status, 0, r.stdout.slice(-800));
});
