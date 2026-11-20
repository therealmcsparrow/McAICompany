import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, loadRegistry } from './company-type.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const manifest = JSON.parse(read('company/types/design.json'));

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

test('files are LF only', () => {
  for (const rel of ['company/types/design.json', 'scripts/type-design.test.mjs']) {
    assert.ok(!read(rel).includes('\r'), rel);
  }
});
