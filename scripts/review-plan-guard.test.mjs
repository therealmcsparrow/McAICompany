import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const fixtures = path.join(root, 'tests', 'fixtures', 'review-plan-guard');

const RULE = '**Unplanned Core, Contract or security change.** A diff that changes a Core item (`.company/project.md` `## Core`), a Contract file or a security-relevant file is `## Blocking` (`contract`, or `security` for a security-relevant file) unless the plan names that change (its Core and Contracts list or a task\'s `files:`). Security-relevant: code or config that handles auth, permissions, secrets, payments, personal data or crypto; hook, sandbox and permission settings; CI and release workflows; dependency manifests and lockfiles.';

const CATEGORIES = [
  'auth', 'permissions', 'secrets', 'payments', 'personal data', 'crypto',
  'hook, sandbox and permission settings', 'CI and release workflows',
  'dependency manifests and lockfiles'
];

const SKILLS = ['review', 'contracts', 'security-check'];

function skill(name) {
  return fs.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

for (const name of SKILLS) {
  test(`AC10: skills/${name} holds the rule text verbatim, exactly once`, () => {
    assert.equal(count(skill(name), RULE), 1);
  });

  test(`AC10: skills/${name} rule names Core, Contract, security-relevant, ## Blocking and the plan exception`, () => {
    const text = skill(name);
    assert.ok(text.includes(RULE), 'rule text present');
    for (const word of ['Core', 'Contract', 'security-relevant', '## Blocking', 'unless the plan names']) {
      assert.ok(RULE.includes(word), word);
    }
  });

  test(`AC10: skills/${name} security-relevant definition lists every category`, () => {
    const text = skill(name);
    const at = text.indexOf('Security-relevant:');
    assert.ok(at >= 0, 'definition present');
    const def = text.slice(at, text.indexOf('\n', at));
    for (const c of CATEGORIES) assert.ok(def.includes(c), c);
  });

  test(`AC2: skills/${name} has no blast text`, () => {
    assert.doesNotMatch(skill(name), /blast/i);
  });
}

test('AC10: skills/contracts holds the rule as a list bullet', () => {
  assert.ok(skill('contracts').includes(`- ${RULE}`));
});

test('AC10: skills/contracts places the rule under ## Review blockers', () => {
  const text = skill('contracts');
  const head = text.indexOf('## Review blockers');
  assert.ok(head >= 0, 'heading present');
  assert.ok(text.indexOf(RULE) > head);
});

test('AC10: both fixtures exist and are LF only', () => {
  for (const f of ['plan.md', 'change.diff']) {
    const p = path.join(fixtures, f);
    assert.ok(fs.existsSync(p), f);
    assert.ok(!fs.readFileSync(p, 'utf8').includes('\r'), `${f} has CR`);
  }
});

test('AC10: the diff fixture is a unified diff touching exactly three files', () => {
  const diff = fs.readFileSync(path.join(fixtures, 'change.diff'), 'utf8');
  const headers = [...diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)];
  assert.deepEqual(headers.map(m => m[2]).sort(), [
    '.github/workflows/release.yml', 'docs/contracts/example.md', 'docs/contracts/other.md'
  ]);
  for (const m of headers) assert.equal(m[1], m[2]);
  assert.equal(count(diff, '\n--- a/'), 3);
  assert.equal(count(diff, '\n+++ b/'), 3);
  assert.equal(count(diff, '\n@@ '), 3);
});

test('AC10: the fixture plan names docs/contracts/example.md only in a task files line', () => {
  const plan = fs.readFileSync(path.join(fixtures, 'plan.md'), 'utf8');
  const lines = plan.split('\n').filter(l => /^- files:/.test(l));
  assert.equal(lines.length, 1);
  const files = lines[0].replace(/^- files:\s*/, '').split(',').map(s => s.trim());
  assert.deepEqual(files, ['docs/contracts/example.md']);
});

test('AC10: the fixtures state neither a planned change nor a verdict', () => {
  for (const f of ['plan.md', 'change.diff']) {
    const text = fs.readFileSync(path.join(fixtures, f), 'utf8');
    assert.doesNotMatch(text, /planned|unplanned|blocking|verdict|expect|nit/i, f);
    assert.doesNotMatch(text, /blast/i, f);
  }
  const plan = fs.readFileSync(path.join(fixtures, 'plan.md'), 'utf8');
  assert.ok(!plan.includes('other.md') && !plan.includes('release.yml'));
});
