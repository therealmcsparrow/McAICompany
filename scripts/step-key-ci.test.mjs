// AC15: on a PR, CI replays the step-key key table, so a broken key fails the PR.
// Static reads of ci.yml plus diff-facts classify; no CI run is started.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './diff-facts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8').split('\r\n').join('\n');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const replay = readFileSync(join(root, 'scripts', 'step-key.test.mjs'), 'utf8');

const jobText = (name) => {
  const from = ci.indexOf(`\n  ${name}:\n`);
  if (from < 0) return '';
  const rest = ci.slice(from + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};
const stepOf = (job, name) => {
  const parts = job.split(/\n {6}- /).slice(1).map((s) => `- ${s}`);
  return parts.find((s) => s.includes(`name: ${name}`)) ?? '';
};
const ifOf = (s) => (s.match(/^\s*(?:- )?if:\s*(.+)$/m) ?? [, ''])[1];
const keyPaths = [
  'scripts/step-key.mjs',
  'scripts/step-key.test.mjs',
  'tests/contracts/step-key/key-table.json',
  'tests/contracts/step-key/version.txt',
  'scripts/check.mjs',
];

describe('AC15 CI replays the step-key key table', () => {
  test('the replay lives in a file the npm test glob selects', () => {
    assert.match(pkg.scripts.test, /"scripts\/\*\.test\.mjs"/);
    assert.ok(existsSync(join(root, 'scripts', 'step-key.test.mjs')));
    assert.ok(readdirSync(join(root, 'scripts')).includes('step-key.test.mjs'));
  });

  test('that file loads key-table.json and runs one test per row', () => {
    assert.match(replay, /loadGolden\('step-key'\)/);
    assert.match(replay, /g\.json\('key-table\.json'\)/);
    assert.match(replay, /for \(const row of table\.rows\)/);
  });

  test('the fixture exists and has rows', () => {
    const t = JSON.parse(readFileSync(join(root, 'tests', 'contracts', 'step-key', 'key-table.json'), 'utf8'));
    assert.ok(Array.isArray(t.rows) && t.rows.length > 0);
  });

  test('a PR runs npm test on every Windows shard, skipped only when docs_only is exactly true', () => {
    const step = stepOf(jobText('windows-test'), 'Test shard');
    assert.match(step, /run: npm test -- "--test-shard=\$AICO_TEST_SHARD"/);
    const cond = ifOf(step);
    assert.match(cond, /github\.event_name == 'pull_request'/);
    assert.match(cond, /steps\.facts\.outputs\.docs_only == 'true'/);
    assert.doesNotMatch(cond, /schedule|refs\/tags|ui_changed/);
  });

  test('the cover check turns red when a test file runs in no shard', () => {
    const step = stepOf(jobText('windows-check'), 'Cover check');
    assert.match(step, /--aico-cover=/);
    assert.match(ifOf(step), /always\(\)/);
  });

  test('windows-check is the required check name and reports red on a failed shard', () => {
    assert.match(jobText('windows-check'), /name: check \(windows-latest\)/);
    assert.match(jobText('windows-check'), /test "\$SHARDS_RESULT" = success/);
  });

  test('no PR step or job continues on error around the test run', () => {
    const win = jobText('windows-test');
    assert.doesNotMatch(win, /continue-on-error/);
    assert.doesNotMatch(jobText('windows-check'), /continue-on-error/);
  });

  for (const p of keyPaths) {
    test(`a PR changing ${p} is not docs_only, so the replay runs`, () => {
      for (const status of ['M', 'A', 'D']) {
        const f = classify([{ path: p, status, added: 1, removed: 1 }], { v: 1, not_docs: [] });
        assert.equal(f.docs_only, false, `${status} ${p}`);
        const g = classify([{ path: p, status, added: 1, removed: 1 }], null);
        assert.equal(g.docs_only, false, `${status} ${p} (no config)`);
      }
    });
  }

  test('a key change bundled with docs is not docs_only', () => {
    const f = classify([{ path: 'README.md', status: 'M', added: 1, removed: 1 }, { path: 'scripts/step-key.mjs', status: 'M', added: 1, removed: 1 }], { v: 1, not_docs: [] });
    assert.equal(f.docs_only, false);
  });

  test('control: a docs-only change is docs_only (the skip is real)', () => {
    assert.equal(classify([{ path: 'README.md', status: 'M', added: 1, removed: 1 }], { v: 1, not_docs: [] }).docs_only, true);
  });
});
