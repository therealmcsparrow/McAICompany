import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadRegistry, ALWAYS } from './company-type.mjs';

// The research consultancy type: manifest, the report Playbook and the claims-cited block.

const root = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const manifest = JSON.parse(read('company/types/research.json'));
const MEANING = 'The final report goes to the client or is published, with every claim cited [S#] or marked (unverified).';

test('manifest has the contract values', () => {
  assert.equal(manifest.v, 1);
  assert.equal(manifest.id, 'research');
  assert.deepEqual(manifest.roles, ['product-manager', 'account-manager', 'market-researcher', 'tech-researcher',
    'ux-researcher', 'writer', 'legal', 'localizer', 'editor', 'skill-researcher', 'reprompter']);
  assert.deepEqual(manifest.playbooks, ['research', 'client', 'report', 'feedback', 'brainstorm', 'cooler', 'dashboard', 'grill', 'grill-me', 'grill-with-docs', 'idea']);
  assert.deepEqual(manifest.ship, { kind: 'deliver-report', meaning: MEANING, lanes: ['legal'], checks: ['claims-cited'] });
  assert.deepEqual(Object.keys(manifest).sort(), ['id', 'label', 'playbooks', 'roles', 'ship', 'skill_search', 'v', 'work']);
  assert.deepEqual(manifest.work, ['report']);
  for (const h of manifest.skill_search.hints) assert.match(h, /^[a-z0-9][a-z0-9 -]{0,59}$/);
});

test('manifest links: every Role and Playbook exists, none from ALWAYS', () => {
  for (const r of manifest.roles) assert.ok(fs.existsSync(path.join(root, 'agents', `${r}.md`)), r);
  for (const p of manifest.playbooks) {
    assert.ok(!ALWAYS.includes(p), p);
  }
  assert.ok(manifest.roles.includes('skill-researcher'));
  assert.ok(manifest.ship.meaning.length <= 240 && !/[`<>]/.test(manifest.ship.meaning));
  assert.match(manifest.label, /^[A-Za-z0-9 -]{1,40}$/);
});

test('the registry loads the research type', () => {
  const registry = loadRegistry(root);
  assert.equal(registry.research.ship.kind, 'deliver-report');
});

test('the Playbook is in the type and passes the type CLI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'type-research-'));
  try {
    fs.mkdirSync(path.join(dir, '.company'));
    fs.writeFileSync(path.join(dir, '.company', 'project.md'), 'company_type: research\n');
    const env = { ...process.env, MCSPARROW_HOME: dir, HOME: dir, USERPROFILE: dir };
    const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts', 'company-type.mjs'), ...args], { cwd: dir, env, encoding: 'utf8' });
    const ok = run('check-playbook', 'report', '--json');
    assert.equal(ok.status, 0);
    assert.equal(JSON.parse(ok.stdout).ship.kind, 'deliver-report');
    assert.match(run('check-playbook', 'report').stdout, /^ok: report is part of the research company/);
    assert.equal(run('check-playbook', 'audit').status, 2);
    assert.equal(run('check-role', 'editor').status, 0);
    assert.equal(run('check-role', 'backend-engineer').status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
