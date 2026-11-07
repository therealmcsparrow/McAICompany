import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, loadRegistry } from './company-type.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const manifest = JSON.parse(read('company/types/design.json'));
const skill = read('skills/design/SKILL.md');

const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
function projectWith(text) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'type-design-'));
  temps.push(cwd);
  fs.mkdirSync(path.join(cwd, '.company'));
  fs.writeFileSync(path.join(cwd, '.company', 'project.md'), text);
  return cwd;
}
const exec = (args, cwd) => run(args, { cwd, pluginRoot: root });

test('manifest: ship fields, lanes and checks', () => {
  assert.equal(manifest.v, 1);
  assert.equal(manifest.id, 'design');
  assert.equal(manifest.ship.kind, 'design-handoff');
  assert.deepEqual(manifest.ship.lanes, ['legal', 'accessibility', 'security']);
  assert.deepEqual(manifest.ship.checks, ['ai-disclosure', 'asset-licences', 'handoff-package']);
  assert.ok(manifest.ship.meaning.length <= 240);
  assert.match(manifest.ship.meaning, /files, specs, tokens/);
});

test('manifest: the roles and Playbooks of the contract', () => {
  assert.deepEqual(manifest.playbooks, ['design', 'research', 'client', 'feedback', 'brainstorm', 'cooler', 'dashboard', 'grill', 'grill-me', 'grill-with-docs', 'idea']);
  for (const r of ['ui-ux-designer', 'code-reviewer', 'security', 'legal', 'skill-researcher', 'frontend-engineer']) {
    assert.ok(manifest.roles.includes(r), r);
  }
  for (const r of ['editor', 'localizer', 'marketer']) assert.ok(!manifest.roles.includes(r), r);
  assert.equal(new Set(manifest.roles).size, manifest.roles.length);
});

test('the registry accepts the manifest', () => {
  const reg = loadRegistry(root);
  assert.equal(reg.design.id, 'design');
});

test('a design project resolves to the design company', () => {
  const cwd = projectWith('# Project profile\n\ncompany_type: design\nproduct_type: web\n');
  const res = exec(['resolve', '--json'], cwd);
  assert.equal(res.code, 0);
  const out = JSON.parse(res.out);
  assert.equal(out.id, 'design');
  assert.equal(out.source, 'project');
  assert.equal(out.ship.kind, 'design-handoff');
  assert.ok(out.playbooks.includes('design'));
  assert.ok(out.playbooks.includes('help'));
});

test('design Playbook is allowed, a software Playbook is refused', () => {
  const cwd = projectWith('# Project profile\n\ncompany_type: design\n');
  assert.equal(exec(['check-playbook', 'design'], cwd).code, 0);
  const refused = exec(['check-playbook', 'fix'], cwd);
  assert.equal(refused.code, 2);
  assert.match(refused.out, /^refused: fix is not part of the design company; allowed: /);
});

test('design Roles are allowed, the editor is refused', () => {
  const cwd = projectWith('# Project profile\n\ncompany_type: design\n');
  assert.equal(exec(['check-role', 'ui-ux-designer'], cwd).code, 0);
  assert.equal(exec(['check-role', 'editor'], cwd).code, 2);
});

test('the software company does not get the design Playbook', () => {
  const cwd = projectWith('# Project profile\n\nproduct_type: web\n');
  assert.equal(exec(['check-playbook', 'design'], cwd).code, 2);
});

test('SKILL.md: frontmatter, size, Help and Type lines', () => {
  const lines = skill.split('\n');
  assert.equal(lines[0], '---');
  assert.ok(lines.length <= 126, `${lines.length} lines`);
  assert.match(skill, /^name: design$/m);
  assert.match(skill, /^argument-hint:[ \t]*\S/m);
  assert.doesNotMatch(skill, /^disable-model-invocation:/m);
  const desc = skill.match(/^description: (.*)$/m)[1];
  assert.ok(desc.length > 0 && desc.length <= 1024);
  const i = lines.findIndex((l) => l.startsWith('**Help:**'));
  assert.ok(i > 0);
  assert.equal(lines[i + 1], '');
  assert.equal(lines[i + 2], '**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" company-type check-playbook design` first; exit not 0 → show its output line and stop.');
  assert.equal(lines.filter((l) => l.startsWith('**Type:**')).length, 1);
});

test('SKILL.md: pipeline, stages in order, checks and review lanes', () => {
  assert.match(skill, /aico:pipeline/);
  const heads = ['## 1. Brief', '## 2. Research', '## 3. Concepts', '## 4. Critique', '## 5. Prototype review', '## 6. Legal', '## 7. Handoff package', '## 8. Ship Gate'];
  let at = -1;
  for (const h of heads) {
    const next = skill.indexOf(h);
    assert.ok(next > at, h);
    at = next;
  }
  assert.match(skill, /usability/);
  for (const c of ['handoff-package', 'ai-disclosure', 'asset-licences']) assert.ok(skill.includes(c), c);
  assert.match(skill, /`deepfake: yes` or `deepfake: no`/);
  assert.ok(skill.includes('ai-disclosure: none (no AI-generated assets)'));
  const review = skill.slice(skill.indexOf('## 5. Prototype review'), skill.indexOf('## 6. Legal'));
  assert.match(review, /aico:code-reviewer/);
  assert.match(review, /aico:security/);
  assert.match(skill, /Ship means: <ship\.meaning>/);
  const legal = skill.slice(skill.indexOf('## 6. Legal'), skill.indexOf('## 7. Handoff package'));
  assert.match(legal, /art\. 50 duty that applies and how it is met, or why none applies/);
  assert.match(skill.slice(skill.indexOf('## 7. Handoff package')), /AI flag[^\n]*tool, prompt and date[^\n]*copyright/);
});

test('every Playbook that dispatches the design researcher gives it the Area line', () => {
  for (const rel of ['skills/design/SKILL.md', 'skills/feature/SKILL.md', 'skills/research/SKILL.md']) {
    const hit = read(rel).split('\n').filter((l) => l.includes('design-researcher'));
    assert.ok(hit.length > 0, rel);
    assert.ok(hit.some((l) => l.includes('Area: design')), rel);
  }
});

test('the design researcher judges the resolved selections and the catalog', () => {
  const agent = read('agents/design-researcher.md');
  assert.match(agent, /Judge the resolved selections and the catalog:[^\n]*`design` entries[^\n]*as read at Start/);
});

test('files are LF only', () => {
  for (const rel of ['company/types/design.json', 'skills/design/SKILL.md', 'scripts/type-design.test.mjs']) {
    assert.ok(!read(rel).includes('\r'), rel);
  }
});
