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
  const list = JSON.parse(ct(product(), 'list').stdout);
  assert.deepEqual(list.map((e) => e.id), ['software', 'research', 'marketing', 'design']);
  assert.match(skill, /company-type\.mjs" list/);
  assert.match(skill, /no pre-selected option/);
  const iList = skill.indexOf('company-type.mjs" list');
  const iSet = skill.indexOf('company-type.mjs" set <id>');
  assert.ok(iList > 0 && iSet > iList);
  assert.match(skill, /Only after the CEO picks an id from that list/);
  assert.match(skill, /Cancel, no answer or any other text → run nothing, write nothing/);
});

test('AC12 cancel writes nothing and the project stays software', () => {
  const d = product();
  const before = profile(d);
  assert.equal(ct(d, 'list').status, 0);
  const r = ct(d, 'resolve');
  assert.equal(JSON.parse(r.stdout).id, 'software');
  assert.equal(JSON.parse(r.stdout).source, 'default');
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
  assert.equal(JSON.parse(ct(d, 'resolve').stdout).skill_search.hints.length > 0, true);
});

test('free text is refused with the allowed list and writes nothing', () => {
  const d = product();
  const before = profile(d);
  const r = ct(d, 'set', 'banking');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /allowed: software, research, marketing, design/);
  assert.equal(profile(d), before);
});

test('AC13 and AC14 the search uses skill-picks.md unchanged and adds no fetch path', () => {
  assert.match(skill, /Area: company-type/);
  assert.match(skill, /skillspector\.mjs detect --json/);
  assert.match(skill, /skill_search\.hints/);
  assert.match(skill, /skills\/lead\/references\/skill-picks\.md/);
  assert.match(skill, /at most 5/);
  for (const word of ['vet', 'approve form', 'check-install', 'Install / Skip']) assert.ok(skill.includes(word), word);
  const section = skill.slice(skill.indexOf('## Company type'));
  assert.doesNotMatch(section, /WebFetch|curl|wget|git clone|npx|skills add|skills find/);
  const picks = read('skills/lead/references/skill-picks.md');
  assert.match(picks, /company-type/);
  assert.match(picks, /`bound: false`/);
  assert.match(picks, /check-install/);
});

test('the skill never answers a form or removes a skill by itself', () => {
  assert.match(skill, /never answers the approve, Install or stop form by itself/);
  assert.doesNotMatch(skill, /skills@[0-9.]+ remove/);
});
