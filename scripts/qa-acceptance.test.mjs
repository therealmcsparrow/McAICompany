// QA net for acceptance criteria that no other suite pins from the outside (AC31, AC33, AC34).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('AC33 every text file this branch added or changed is LF only', () => {
  const files = execFileSync('git', ['diff', '--name-only', '-z', '--diff-filter=AM', 'bea3242', 'HEAD'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const text = /\.(md|mjs|json|html|txt|yml|yaml)$/;
  const bad = files.filter(f => text.test(f) && fs.existsSync(path.join(root, f)) && read(f).includes('\r'));
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
