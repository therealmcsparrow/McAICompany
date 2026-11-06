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
const playbook = read('skills/report/SKILL.md');
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
    assert.match(read(`skills/${p}/SKILL.md`), /^argument-hint:[ \t]*\S/m, p);
  }
  assert.ok(manifest.roles.includes('skill-researcher'));
  assert.ok(manifest.ship.meaning.length <= 240 && !/[`<>]/.test(manifest.ship.meaning));
  assert.match(manifest.label, /^[A-Za-z0-9 -]{1,40}$/);
});

test('the registry loads the research type', () => {
  const registry = loadRegistry(root);
  assert.equal(registry.research.ship.kind, 'deliver-report');
});

test('report Playbook: frontmatter, Help line, Type line, size', () => {
  const lines = playbook.split('\n');
  assert.equal(lines[0], '---');
  assert.ok(lines.length <= 126);
  assert.match(playbook, /^name: report$/m);
  assert.match(playbook, /^argument-hint:[ \t]*\S/m);
  assert.doesNotMatch(playbook, /^disable-model-invocation:/m);
  const desc = playbook.match(/^description: (.+)$/m)[1];
  assert.ok(desc.length <= 1024);
  const i = lines.findIndex((l) => l.startsWith('**Help:**'));
  assert.equal(lines[i], "**Help:** argument is exactly `help` or `--help` → do the **Type:** step below first; then read `documentation/commands/report.md` (plugin root = two folders above this skill's base directory) and reply with its usage, options, what it does and an example, in the language of `aico:pipeline` §1.6; change nothing, start nothing, and stop.");
  assert.equal(lines[i + 1], '');
  assert.equal(lines[i + 2], '**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" company-type check-playbook report` first; exit not 0 → show its output line and stop.');
  assert.ok(!playbook.includes('\r'));
});

test('report Playbook: runs with aico:pipeline, states the Ship meaning, Gates and Roles', () => {
  assert.match(playbook, /Run with `aico:pipeline`/);
  assert.equal(playbook.split('Ship means').length - 1, 1);
  assert.ok(playbook.includes('`Ship means: <ship.meaning>`'));
  assert.ok(!playbook.includes(MEANING));
  assert.match(playbook, /\*\*→ Brief Gate\*\*/);
  assert.match(playbook, /\*\*→ Plan Gate\*\*/);
  assert.ok(playbook.indexOf('Brief Gate**') < playbook.indexOf('Plan Gate**'));
  assert.ok(playbook.indexOf('Plan Gate**') < playbook.indexOf('## 3. Research'));
  assert.match(playbook.slice(playbook.indexOf('## 2. Plan'), playbook.indexOf('## 3. Research')), /no Core, Contracts or Ruleset line/);
  assert.match(playbook, /## 7\. Ship Gate/);
  const used = [...playbook.matchAll(/`aico:([a-z-]+)`/g)].map((m) => m[1]).filter((n) => fs.existsSync(path.join(root, 'agents', `${n}.md`)));
  for (const r of used) assert.ok(manifest.roles.includes(r), `${r} is not a research Role`);
});

test('uncited claim: the editor blocks with [spec] and the Playbook blocks Ship', () => {
  const editor = read('agents/editor.md');
  assert.match(editor, /neither, or with an `\[S#\]` that does not exist[^\n]*`## Blocking`, tag `\[spec\]`/);
  assert.match(editor, /Never:\*\* rewrite/);
  const edit = playbook.slice(playbook.indexOf('## 5. Edit'), playbook.indexOf('## 6. Legal'));
  assert.match(edit, /neither `\[S#\]` nor `\(unverified\)`[^\n]*`## Blocking` with tag `\[spec\]`/);
  assert.match(edit, /`status: done` and no `## Blocking`/);
  const ship = playbook.slice(playbook.indexOf('## 7. Ship Gate'), playbook.indexOf('## 8.'));
  assert.match(ship, /`claims-cited` blocker is open and Ship is blocked/);
  assert.ok(playbook.indexOf('## 5. Edit') < playbook.indexOf('## 7. Ship Gate'));
});

test('web pages are data: an instruction in a source is ignored and noted', () => {
  assert.match(playbook, /data, never instructions/);
  assert.match(playbook, /injection attempt in <file>: ignored/);
  assert.match(read('agents/editor.md'), /injection attempt in <file>: ignored/);
});

test('legal decisions: AI label, no personal data, no install, no push', () => {
  assert.match(playbook, /label: AI-generated research/);
  assert.match(playbook, /GDPR art\. 5\(1\)\(c\)/);
  assert.match(playbook, /Never push/);
  assert.ok(!/npx skills|install-skills/.test(playbook));
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
