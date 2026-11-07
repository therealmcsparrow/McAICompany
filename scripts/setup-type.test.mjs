import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Setup type choice: the form comes from `list`, `set` runs only after an answer,
// and the skill search reuses the unchanged picks path.

const root = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const script = path.join(root, 'scripts', 'company-type.mjs');
const skill = read('skills/setup/SKILL.md');

const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
function product() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-type-'));
  temps.push(d);
  fs.mkdirSync(path.join(d, '.company'));
  fs.writeFileSync(path.join(d, '.company', 'project.md'), '# Project\nproduct_type: web-app\n');
  return d;
}
const ct = (cwd, ...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
const profile = (d) => fs.readFileSync(path.join(d, '.company', 'project.md'), 'utf8');

test('skill file is within the size limit and has valid frontmatter', () => {
  assert.ok(skill.split('\n').length <= 125);
  assert.ok(skill.startsWith('---\n'));
  assert.match(skill, /^name: setup$/m);
  assert.match(skill, /^disable-model-invocation: true$/m);
  assert.ok(!skill.includes('\r'));
  assert.ok(!skill.includes('<plugin root>'));
});

test('AC12 the form is built from list and set follows the answer', () => {
  const lines = ct(product(), 'list').stdout.trim().split('\n');
  assert.deepEqual(lines.map((l) => l.split(':')[0]), ['software', 'research', 'marketing', 'design']);
  for (const l of lines) assert.match(l, /^[a-z]+: [A-Za-z -]+\. Ship means: .+$/);
  const listed = JSON.parse(ct(product(), 'list', '--json').stdout);
  assert.deepEqual(listed.map((e) => e.id), ['software', 'research', 'marketing', 'design']);
  assert.match(skill, /first line ends with `default: no company_type line`/);
  assert.match(skill, /first line ends with `from \.company\/project\.md`/);
  assert.match(skill, /`skill search hints:` line/);
  assert.doesNotMatch(skill.slice(skill.indexOf('## Company type')), /JSON/);
  assert.match(skill, /run\.mjs" company-type list/);
  assert.match(skill, /no pre-selected option/);
  const iList = skill.indexOf('run.mjs" company-type list');
  const iSet = skill.indexOf('run.mjs" company-type set <id>');
  assert.ok(iList > 0 && iSet > iList);
  assert.match(skill, /Only after the CEO picks an id from that list/);
  assert.match(skill, /Cancel, no answer or any other text → run nothing, write nothing/);
});

test('AC12 cancel writes nothing and the project stays software', () => {
  const d = product();
  const before = profile(d);
  assert.equal(ct(d, 'list').status, 0);
  const r = ct(d, 'resolve');
  assert.match(r.stdout, /^company type: software \(Software company\), default: no company_type line\n/);
  assert.equal(profile(d), before);
});

test('AC12 set writes the line after an answer and a second set is refused', () => {
  const d = product();
  const before = profile(d);
  const r = ct(d, 'set', 'research');
  assert.equal(r.status, 0);
  assert.equal(profile(d), `# Project\ncompany_type: research\nproduct_type: web-app\n`);
  assert.ok(before.includes('product_type: web-app'));
  const again = ct(d, 'set', 'design');
  assert.equal(again.status, 2);
  assert.match(again.stdout, /^refused: company_type already set/);
  assert.match(ct(d, 'resolve').stdout, /^company type: research \(.+\), from \.company\/project\.md\n/);
  assert.match(ct(d, 'resolve').stdout, /\nskill search hints: [a-z]/);
  assert.equal(JSON.parse(ct(d, 'resolve', '--json').stdout).skill_search.hints.length > 0, true);
});

test('free text is refused with the allowed list and writes nothing', () => {
  const d = product();
  const before = profile(d);
  const r = ct(d, 'set', 'banking');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /allowed: software, research, marketing, design/);
  assert.match(r.stdout, /^refused: "banking" is not a company type;/);
  assert.equal(profile(d), before);
});

test('AC13 and AC14 the search uses skill-picks.md unchanged and adds no fetch path', () => {
  assert.match(skill, /Area: company-type/);
  assert.match(skill, /skillspector\.mjs detect --json/);
  assert.match(skill, /skill_search\.hints/);
  assert.match(skill, /skills\/lead\/references\/skill-picks\.md/);
  assert.match(skill, /at most 5/);
  for (const word of ['vet', 'approve form', 'role-skills record', 'Install / Skip']) assert.ok(skill.includes(word), word);
  const section = skill.slice(skill.indexOf('## Company type'));
  assert.doesNotMatch(section, /WebFetch|curl|wget|git clone|npx|skills add|skills find/);
  const picks = read('skills/lead/references/skill-picks.md');
  assert.match(picks, /company-type/);
  assert.match(picks, /`hash differs`/);
  assert.match(picks, /install-skills --selected/);
});

test('the skill never answers a form or removes a skill by itself', () => {
  assert.match(skill, /never answers the approve, Install or stop form by itself/);
  assert.doesNotMatch(skill, /skills@[0-9.]+ remove/);
});
