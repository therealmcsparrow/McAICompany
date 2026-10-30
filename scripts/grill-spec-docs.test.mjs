// Pins the docs for grill, to-spec and to-tickets: entries, README rows, counts, changelog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { docFolder, commandPage } from './doc-pages.mjs';

const root = path.join(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const commands = docFolder(root, 'commands');
const readme = read('README.md');
const NAMES = ['grill', 'to-spec', 'to-tickets'];

test('each command has entry and README row', () => {
  for (const n of NAMES) {
    assert.ok(fs.existsSync(path.join(root, `documentation/commands/${n}.md`)), `command page ${n}`);
    assert.ok(readme.includes(`| \`/aico:${n} `), `README row ${n}`);
  }
});

test('privacy line names the argument file path and no false gitignore claim', () => {
  assert.ok(commands.includes('.company/draft-input-arg-'));
  assert.doesNotMatch(commands, /which the repo `\.gitignore` covers/);
  assert.doesNotMatch(commands, /`\.company\/work\/`[^.]*\.gitignore. covers/);
});

test('feature entry names draft inputs', () => {
  const feature = commandPage(root, 'feature');
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
  const concepts = docFolder(root, 'concepts');
  const rows = concepts.split('\n').filter(l => /^\| `(software|research|marketing|design)` \(/.test(l));
  assert.equal(rows.length, 4);
  for (const r of rows) assert.ok(r.includes('grill'), r.slice(0, 20));
  const sw = rows.find(r => r.startsWith('| `software`'));
  assert.ok(sw.includes('to-spec') && sw.includes('to-tickets'));
  for (const r of rows.filter(r => !r.startsWith('| `software`'))) {
    assert.ok(!r.includes('to-spec') && !r.includes('to-tickets'));
  }
});

const CHECK = 'changelog Unreleased or 0.22.0 mentions the commands';
test(CHECK, () => {
  // Pinned release: the entry sits in Unreleased until 0.22.0 ships, then in the 0.22.0 section for good.
  const sections = read('CHANGELOG.md').split('\n## [').slice(1);
  const candidates = ['Unreleased]', '0.22.0]'].map(h => sections.find(s => s.startsWith(h)) ?? '');
  const section = candidates.find(c => NAMES.every(n => c.includes(`/aico:${n}`)));
  assert.ok(section, 'commands in neither Unreleased nor 0.22.0');
  assert.ok(!/\r/.test(section));
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
    fs.copyFileSync(path.join(root, 'scripts/doc-pages.mjs'), path.join(tmp, 'scripts/doc-pages.mjs'));
    fs.copyFileSync(path.join(root, 'scripts/grill-spec-docs.test.mjs'), path.join(tmp, 'scripts/grill-spec-docs.test.mjs'));
    fs.cpSync(path.join(root, 'documentation/commands'), path.join(tmp, 'documentation/commands'), { recursive: true });
    fs.copyFileSync(path.join(root, 'README.md'), path.join(tmp, 'README.md'));
    fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), changelog);
    return spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=${CHECK}`,
      path.join(tmp, 'scripts/grill-spec-docs.test.mjs')], { encoding: 'utf8', timeout: 30000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
const ENTRY = '- **Grill, spec and tickets.** `/aico:grill`, `/aico:to-spec`, `/aico:to-tickets`.\n';

const mk = (unreleased, ...versions) => `# Changelog\n\n## [Unreleased]\n${unreleased}\n${versions.join('\n')}`;
const V22 = `## [0.22.0] - 2026-10-30\n\n### Added\n${ENTRY}\n`;
const V21 = '## [0.21.0] - 2026-10-29\n\n- old\n';
const OTHER = '\n### Added\n- **Other.** Unrelated entry.\n';
// Asserts the check itself ran (tap line for its name), so a renamed check cannot pass vacuously.
const ran = (r, ok) => {
  assert.ok(r.stdout.includes(`${ok ? 'ok' : 'not ok'} 1 - ${CHECK}`), `check did not run: ${r.stdout.slice(-800)}`);
  assert.equal(r.status === 0, ok, r.stdout.slice(-800));
};

test('regression: passes after release (commands under 0.22.0, Unreleased empty)', () => ran(runChangelogCheck(mk('', V22, V21)), true));
test('control: passes before release (commands under Unreleased)', () => ran(runChangelogCheck(mk(`\n### Added\n${ENTRY}`, V21)), true));
test('regression: passes with an unrelated Unreleased entry after 0.22.0', () => ran(runChangelogCheck(mk(OTHER, V22, V21)), true));
test('regression: passes after 0.23.0 is released on top', () => ran(runChangelogCheck(mk('', '## [0.23.0] - 2026-11-01\n\n- other\n', V22, V21)), true));
test('negative: fails when the commands are in neither Unreleased nor 0.22.0', () => {
  ran(runChangelogCheck(mk(OTHER, '## [0.22.0] - 2026-10-30\n\n- other\n', `## [0.21.0] - 2026-10-29\n\n${ENTRY}`)), false);
});
