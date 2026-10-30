import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Type gating: every software Playbook runs the type check first, the Core names the type
// steps, the front doors filter by type, and the software Ship Gate text is untouched.

const root = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const script = path.join(root, 'scripts', 'company-type.mjs');
const haveScript = fs.existsSync(script);

const SOFTWARE = ['audit', 'brainstorm', 'client', 'cooler', 'feature', 'feedback', 'fix', 'incident',
  'launch', 'maintain', 'pentest', 'refactor', 'research', 'standards', 'usability-test', 'vulnscan'];
const ALWAYS = ['help', 'version', 'language', 'settings', 'setup', 'lead', 'triage', 'skillspector'];

const SHIP_GATE = '- **Ship Gate** comes before any push, merge, deploy, publish or message to a client, user or authority. '
  + 'Its summary names every optional lane the settings turned off ("skipped by settings: accessibility").';

const typeLine = (name) => `**Type:** run \`node "\${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" company-type check-playbook ${name}\` first; exit not 0 → show its output line and stop.`;

for (const name of SOFTWARE) {
  test(`${name}: Type line one empty line after the Help line`, () => {
    const lines = read(`skills/${name}/SKILL.md`).split('\n');
    const i = lines.findIndex((l) => l.startsWith('**Help:**'));
    assert.ok(i > 0);
    assert.equal(lines[i + 1], '');
    assert.equal(lines[i + 2], typeLine(name));
    assert.equal(lines.filter((l) => l.startsWith('**Type:**')).length, 1);
  });
}

test('always-on commands carry no Type line', () => {
  for (const name of ALWAYS) {
    const file = path.join(root, 'skills', name, 'SKILL.md');
    if (fs.existsSync(file)) assert.ok(!/^\*\*Type:\*\*/m.test(fs.readFileSync(file, 'utf8')), name);
  }
});

test('pipeline: type check first, Role check before dispatch, Ship Gate text unchanged', () => {
  const t = read('skills/pipeline/SKILL.md');
  const setup = t.indexOf('## 1. Setup');
  const zero = t.indexOf('0. **Company type (§1.0)**');
  const one = t.indexOf('1. **Task slug**');
  assert.ok(setup < zero && zero < one);
  assert.match(t.slice(zero, one), /run\.mjs" company-type resolve/);
  assert.match(t.slice(zero, one), /Exit not 0, no output or a first line that starts with neither `ok: ` nor `company type: `/);
  assert.match(t, /run\.mjs" company-type check-role <role>/);
  assert.ok(t.includes(SHIP_GATE));
  const ship = t.split('\n').find((l) => l.startsWith('- **Ship Gate, company types other than `software`**'));
  assert.ok(ship);
  assert.match(ship, /first line is `Ship means: <ship\.meaning>`/);
  assert.match(ship, /`ship\.lanes` runs whatever `pipeline\.lanes` says|in `ship\.lanes` runs whatever `pipeline\.lanes` says/);
  assert.match(ship, /open blocker/);
  assert.match(ship, /§1\.0 type lines/);
  assert.doesNotMatch(t.slice(zero, one), /JSON/);
});

test('help lists only the type\'s Playbooks and names the allowed ones on refusal', () => {
  const t = read('skills/help/SKILL.md');
  assert.match(t, /run\.mjs" company-type resolve/);
  assert.match(t, /only commands in `playbooks`/);
  assert.match(t, /`playbooks:` line/);
  assert.doesNotMatch(t.split('\n').find((l) => l.includes('Company type:')), /JSON/);
  assert.match(t, /is not part of your `<id>` company/);
});

test('lead and triage filter by the type', () => {
  assert.match(read('skills/lead/SKILL.md'), /Route only to Playbooks in its `playbooks`[^\n]*Roles in its `roles`/);
  assert.match(read('skills/triage/SKILL.md'), /Recommend only Playbooks in its `playbooks`/);
});

test('cooler and brainstorm pick Roles from company-type roles', () => {
  for (const name of ['cooler', 'brainstorm']) {
    assert.match(read(`skills/${name}/SKILL.md`), /run\.mjs" company-type roles/, name);
  }
  assert.ok(!read('skills/cooler/SKILL.md').includes('<plugin root>/agents/'));
});

test('no gating skill grants tools or uses a placeholder root', () => {
  for (const name of [...SOFTWARE, 'pipeline', 'help', 'lead', 'triage']) {
    const t = read(`skills/${name}/SKILL.md`);
    assert.ok(!/^allowed-tools:/m.test(t), name);
    assert.ok(!t.includes('\r'), name);
    assert.ok(t.split('\n').length <= 125, name);
    for (const m of t.matchAll(/company-type\.mjs/g)) {
      assert.ok(t.slice(Math.max(0, m.index - 40), m.index).endsWith('${CLAUDE_PLUGIN_ROOT}/scripts/'), name);
    }
  }
});

test('software company allows exactly the 16 Playbooks (needs company-type.mjs)', { skip: !haveScript }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'type-gating-'));
  try {
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: home, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home } });
    for (const name of SOFTWARE) assert.equal(run('check-playbook', name).status, 0, name);
    for (const name of ['report', 'campaign', 'content', 'design']) {
      const r = run('check-playbook', name);
      assert.equal(r.status, 2, name);
      assert.match(r.stdout, /^refused: .* is not part of the software company; allowed: /);
      assert.ok(r.stdout.includes('feature'));
    }
    assert.equal(run('check-role', 'editor').status, 2);
    assert.equal(run('check-role', 'backend-engineer').status, 0);
    assert.match(run('check-playbook', 'fix').stdout, /^ok: fix is part of the software company\ncompany type: software \(Software company\), default: no company_type line\n/);
    assert.equal(JSON.parse(run('check-playbook', 'fix', '--json').stdout).id, 'software');
    assert.equal(run('pick', 'architect', 'product-manager').stdout, 'architect\n');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
