// Pins draft-input v1.3 in the Contract and in both guides that name its inputs and refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const CONTRACT = 'docs/contracts/draft-input.md';
const TO_SPEC = 'skills/to-spec/SKILL.md';
const ROUTES = 'skills/idea/references/routes.md';

const SHARED = [
  '.company/work/<name>/prompt.md',
  '16 KiB',
  'argument too large',
  'argument has a line break or control character',
];

test('contract and both guides name the same inputs and refusals', () => {
  for (const rel of [CONTRACT, TO_SPEC, ROUTES]) {
    const text = read(rel);
    for (const s of SHARED) assert.ok(text.includes(s), `${rel} names ${s}`);
  }
});

test('the contract is v1.5 with a history line', () => {
  const text = read(CONTRACT);
  assert.equal(text.split('\n')[0], '# Contract: draft-input v1.5');
  const compat = text.slice(text.indexOf('## Compatibility'));
  const lines = compat.split('\n');
  assert.ok(lines.some((l) => l.startsWith('v1.5 (minor')), 'a v1.5 (minor line');
  assert.ok(lines.some((l) => l.startsWith('v1.4 (minor')), 'the v1.4 line stays');
  assert.ok(lines.some((l) => l.startsWith('v1.3 (minor')), 'the v1.3 line stays');
  assert.ok(lines.some((l) => l.startsWith('v1.1 (minor')), 'the v1.1 line stays');
  assert.ok(text.includes('### take --for to-spec of a prompt file (v1.3)'), 'the take section');
  assert.ok(text.includes('argument is not accepted'), 'command-line arguments keep the old refusal');
});

test('to-spec cites draft-input v1.4', () => {
  const text = read(TO_SPEC);
  assert.match(text, /draft-input` v1\.3/);
  assert.doesNotMatch(text, /draft-input` v1\.2/);
  assert.ok(text.split('\n').length <= 125, 'to-spec SKILL.md stays at most 125 lines');
});

test('the idea route hands to-spec the prompt path, never the body', () => {
  const line = read(ROUTES).split('\n').find((l) => l.startsWith('- To-spec:'));
  assert.ok(line, 'a To-spec line');
  assert.ok(line.includes('.company/work/<reprompt slug>/prompt.md'), 'names the prompt path');
  assert.ok(line.includes('argument file'), 'the path goes to the argument file');
  assert.ok(line.includes('never the body'), 'never the body');
  assert.doesNotMatch(line, /the prompt as the idea text/);
});

test('the three files use LF line ends only', () => {
  for (const rel of [CONTRACT, TO_SPEC, ROUTES]) assert.ok(!read(rel).includes('\r'), `${rel} has no CR`);
});

// release.mjs rolls [Unreleased] into a new version section, and later releases push it further
// down, so the fix bullet may sit under ### Fixed of [Unreleased] or of any versioned section.
function sectionsToCheck(log) {
  return log.split(/^(?=## \[)/m).filter((p) => /^## \[(Unreleased|\d+\.\d+\.\d+)\]/.test(p));
}

function fixedBlock(section) {
  const at = section.indexOf('\n### Fixed');
  if (at === -1) return null;
  const after = section.slice(at + 1);
  const end = after.indexOf('\n### ', 1);
  return after.slice(0, end === -1 ? undefined : end);
}

function hasFix(log) {
  return sectionsToCheck(log).some((s) => {
    const fixed = fixedBlock(s);
    return fixed !== null && /draft-input` v1\.3/.test(fixed) && /prompt file/.test(fixed);
  });
}

test('the changelog lists the fix under Fixed of Unreleased or a versioned section', () => {
  assert.ok(hasFix(read('CHANGELOG.md')), 'draft-input v1.3 and prompt file under ### Fixed of [Unreleased] or the newest versioned section');
});

const FIX = '### Fixed\n- **The spec draft takes the reprompt prompt file whole.** Contract `draft-input` v1.3.\n';
const OLD = '## [0.24.0] - 2026-10-30\n\n### Added\n- Old.\n';
const mk = (unreleased, ...versions) => `# Changelog\n\n## [Unreleased]\n\n${unreleased}\n${versions.join('\n')}`;

test('changelog check: passes before release (fix under Unreleased)', () => {
  assert.equal(hasFix(mk(FIX, OLD)), true);
});

test('changelog check: passes after release (fix under the newest version, Unreleased empty)', () => {
  assert.equal(hasFix(mk('', `## [0.25.0] - 2026-10-31\n\nRollback: node scripts/stable.mjs 0.24.0\n\n${FIX}`, OLD)), true);
});

test('changelog check: passes when the fix sits in an older version', () => {
  assert.equal(hasFix(mk('', '## [0.25.0] - 2026-10-31\n\n### Added\n- x.\n', `## [0.24.0] - 2026-10-30\n\n${FIX}`)), true);
});

test('changelog check: fails when the bullet is not under Fixed', () => {
  assert.equal(hasFix(mk('### Added\n- The prompt file, Contract `draft-input` v1.3.\n', OLD)), false);
});

test('changelog check: fails when the fix is missing', () => {
  assert.equal(hasFix(mk('', OLD)), false);
});
