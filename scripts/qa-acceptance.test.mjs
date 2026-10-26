// QA net for acceptance criteria that no other suite pins from the outside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// The files this branch changed against the merge base with origin/main, or null when no such base exists
// (a shallow CI checkout): older files may predate the LF rule, so without a base the check is skipped, not widened.
function changedFiles() {
  try {
    const base = git('merge-base', 'origin/main', 'HEAD').trim();
    return git('diff', '--name-only', '-z', '--diff-filter=AM', base, 'HEAD').split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

const changed = changedFiles();
test('AC33 every text file this branch added or changed is LF only', { skip: changed === null && 'no merge base with origin/main (shallow checkout)' }, () => {
  const text = /\.(md|mjs|json|html|txt|yml|yaml)$/;
  const bad = changed.filter(f => text.test(f) && fs.existsSync(path.join(root, f)) && read(f).includes('\r'));
  assert.deepEqual(bad, []);
});

test('AC31 CHANGELOG, GLOSSARY, spec and README name every shipped script and setting', () => {
  const docs = ['CHANGELOG.md', 'GLOSSARY.md', 'docs/spec.md', 'README.md'].map(read).join('\n').toLowerCase();
  for (const item of ['brainstorm.mjs', 'ledger.mjs', 'rule-check', 'review-depth', 'release', 'film_script', 'context_cap', 'crossfire', 'golden', 'aico-top', '--packs']) {
    assert.ok(docs.includes(item.toLowerCase()), `docs never mention ${item}`);
  }
});

test('AC31 the Contract docs for dispatch-prompt, aico-settings and handoff carry the bumped versions', () => {
  assert.match(read('docs/contracts/dispatch-prompt.md'), /v3\.1/);
  assert.match(read('docs/contracts/aico-settings.md'), /v1\.1/);
  assert.match(read('docs/contracts/handoff.md'), /v1\.1/);
});

test('AC31/AC17 the CHANGELOG agrees with dispatch-prompt v3.1: no Playbook is exempt from Context cap:', () => {
  const log = read('CHANGELOG.md').split(/^## \[0\.10\.0\]/m)[0];
  assert.ok(!/research is exempt/i.test(log), 'CHANGELOG still says research is exempt');
  assert.match(read('docs/contracts/dispatch-prompt.md'), /No Playbook is exempt/);
});

test('AC31 every new Contract has a docs file and an ADR exists for the minor-version policy', () => {
  for (const c of ['brainstorm-file', 'brainstorm-reply', 'token-ledger', 'rule-check', 'review-depth', 'rule-pack']) {
    assert.ok(fs.existsSync(path.join(root, 'docs/contracts', `${c}.md`)), c);
  }
  assert.ok(fs.readdirSync(path.join(root, 'docs/adr')).some(f => f.startsWith('0007-')));
});
