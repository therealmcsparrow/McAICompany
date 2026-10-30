import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// The marketing company type: manifest, its two Playbooks, and the Ship checks they rely on.

const root = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const manifest = JSON.parse(read('company/types/marketing.json'));
const script = path.join(root, 'scripts', 'company-type.mjs');

const ROLES = ['product-manager', 'account-manager', 'marketer', 'writer', 'brand-artist', 'prompt-artist',
  'motion-artist', 'localizer', 'market-researcher', 'persona-tester', 'accessibility-tester', 'legal', 'editor', 'skill-researcher', 'reprompter'];
const PLAYBOOKS = ['campaign', 'content', 'research', 'client', 'feedback', 'brainstorm', 'cooler', 'grill'];

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

test('manifest: every Role and Playbook exists, Playbooks carry an argument hint', () => {
  for (const r of manifest.roles) assert.ok(fs.existsSync(path.join(root, 'agents', `${r}.md`)), r);
  for (const p of manifest.playbooks) assert.match(read(`skills/${p}/SKILL.md`), /^argument-hint:[ \t]*\S/m, p);
});

for (const name of ['campaign', 'content']) {
  test(`${name}: frontmatter, size, Help and Type lines, pipeline`, () => {
    const t = read(`skills/${name}/SKILL.md`);
    const lines = t.split('\n');
    assert.ok(!t.includes('\r'));
    assert.ok(lines.length <= 125);
    assert.equal(lines[0], '---');
    assert.match(t, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(t, /^description: .+/m);
    assert.match(t, /^argument-hint:[ \t]*\S/m);
    assert.doesNotMatch(t, /^disable-model-invocation:/m);
    assert.ok(!/^allowed-tools:/m.test(t));
    const i = lines.findIndex((l) => l.startsWith('**Help:**'));
    assert.ok(i > 0);
    assert.equal(lines[i + 1], '');
    assert.equal(lines[i + 2], `**Type:** run \`node "\${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" company-type check-playbook ${name}\` first; exit not 0 → show its output line and stop.`);
    assert.ok(t.includes('aico:pipeline'));
  });

  test(`${name}: names every check, forced lanes, Ship Gate and only type Roles`, () => {
    const t = read(`skills/${name}/SKILL.md`);
    for (const needle of ['claims-cited', 'ai-disclosure', 'asset-licences', 'aico:editor', 'aico:legal', 'aico:accessibility-tester', 'Ship Gate', 'Ship means']) {
      assert.ok(t.includes(needle), needle);
    }
    assert.match(t, /art\. 50 duty that applies and how it is met, or why none applies/);
    assert.match(t, /`deepfake: yes` or `deepfake: no`/);
    assert.ok(t.includes('ai-disclosure: none (no AI-generated assets)'));
    assert.match(t, /\*\*→ Plan Gate\*\*/);
    assert.ok(t.indexOf('Brief Gate**') < t.indexOf('Plan Gate**'));
    assert.ok(!/No Plan Gate/.test(t));
    for (const n of ['testimonials or reviews', 'sponsored-content labels', 'price and green claims', '2024/825', 'comparative advertising']) assert.ok(t.includes(n), n);
    const used = new Set([...t.matchAll(/`aico:([a-z-]+)`/g)].map((m) => m[1]));
    const allowed = new Set([...manifest.roles, ...manifest.playbooks, 'pipeline', 'writing', 'eu-compliance', 'art-direction', 'help']);
    for (const u of used) assert.ok(allowed.has(u), `${name} dispatches ${u}, not in the marketing company`);
  });
}

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
