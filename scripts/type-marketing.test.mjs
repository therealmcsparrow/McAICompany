import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// The marketing company type: manifest and the company-type CLI.

const root = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const manifest = JSON.parse(read('company/types/marketing.json'));
const script = path.join(root, 'scripts', 'company-type.mjs');

const ROLES = ['product-manager', 'account-manager', 'marketer', 'writer', 'brand-artist', 'prompt-artist',
  'motion-artist', 'localizer', 'market-researcher', 'persona-tester', 'accessibility-tester', 'legal', 'editor', 'skill-researcher', 'reprompter'];
const PLAYBOOKS = ['campaign', 'content', 'research', 'client', 'feedback', 'brainstorm', 'cooler', 'dashboard', 'grill', 'grill-me', 'grill-with-docs', 'idea'];

const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

function marketingProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'type-marketing-'));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, '.company'));
  fs.writeFileSync(path.join(dir, '.company', 'project.md'), '# Project\ncompany_type: marketing\nproduct_type: web\n');
  return dir;
}
function cli(cwd, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: cwd, HOME: cwd, USERPROFILE: cwd }
  });
}

test('manifest: roles, playbooks and Ship definition', () => {
  assert.deepEqual(manifest.roles, ROLES);
  assert.deepEqual(manifest.playbooks, PLAYBOOKS);
  assert.equal(manifest.id, 'marketing');
  assert.equal(manifest.ship.kind, 'publish');
  assert.deepEqual(manifest.ship.lanes, ['legal', 'accessibility']);
  assert.deepEqual(manifest.ship.checks, ['claims-cited', 'ai-disclosure', 'asset-licences']);
  assert.ok(manifest.ship.meaning.length <= 240 && !/[`<>]/.test(manifest.ship.meaning));
  assert.ok(manifest.skill_search.hints.length <= 5);
  for (const h of manifest.skill_search.hints) assert.match(h, /^[a-z0-9][a-z0-9 -]{0,59}$/);
});

test('manifest: every Role exists', () => {
  for (const r of manifest.roles) assert.ok(fs.existsSync(path.join(root, 'agents', `${r}.md`)), r);
});

test('resolve for a marketing project returns the manifest data', () => {
  const r = cli(marketingProject(), 'resolve', '--json');
  assert.equal(r.status, 0, r.stdout);
  const j = JSON.parse(r.stdout);
  assert.equal(j.id, 'marketing');
  assert.equal(j.source, 'project');
  assert.deepEqual(j.ship.lanes, ['legal', 'accessibility']);
  assert.deepEqual(j.ship.checks, ['claims-cited', 'ai-disclosure', 'asset-licences']);
  for (const p of PLAYBOOKS) assert.ok(j.playbooks.includes(p), p);
});

test('marketing company allows its Playbooks and Roles, refuses software ones', () => {
  const dir = marketingProject();
  for (const p of PLAYBOOKS) assert.equal(cli(dir, 'check-playbook', p).status, 0, p);
  for (const p of ['feature', 'fix', 'launch']) {
    const r = cli(dir, 'check-playbook', p);
    assert.equal(r.status, 2, p);
    assert.match(r.stdout, /^refused: .* is not part of the marketing company; allowed: /);
  }
  assert.equal(cli(dir, 'check-role', 'editor').status, 0);
  assert.equal(cli(dir, 'check-role', 'legal').status, 0);
  assert.equal(cli(dir, 'check-role', 'backend-engineer').status, 2);
});
