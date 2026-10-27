// Wiring and Contract-level checks that no other suite pins (Role report layout, approve and install forms, skill-recommendation, registration, Savvy bars), plus the
// checks for skill-recommendation v1, skills-section v1 and aico-mods v1.1.
// The deep suites live in skillspector.test.mjs (skillspector-scan v1), skill-picks.test.mjs, settings.test.mjs
// (aico-settings v1.2), mods-lib.test.mjs (bars) and install-skills-skills.test.mjs (skills-section parser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { progressRows } from '../mods/lib/bars.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const order = (text, parts) => {
  let at = -1;
  for (const p of parts) {
    const i = text.indexOf(p, at + 1);
    assert.ok(i > at, `missing or out of order: ${p}`);
    at = i;
  }
};

// ---------- report layout: Candidates, Recommended set, Rejected ----------
test('AC1 Contract and Role agree: Candidates, Recommended set, Rejected, in order, at most 5, never ranked by stars', () => {
  const contract = read('docs/contracts/skill-recommendation.md');
  order(contract, ['## Candidates', '## Recommended set', '## Rejected']);
  assert.match(contract, /at most 5/);
  assert.match(contract, /never used to rank/);
  const agent = read('agents/skill-researcher.md');
  assert.match(agent, /`## Candidates`, `## Recommended set`, `## Rejected`/);
  assert.match(agent, /at most 5/);
  assert.match(agent, /never by downloads or stars/);
  assert.match(agent, /Every candidate is in the set or in Rejected/);
  for (const area of ['stack', 'product-type', 'company-type', 'design']) assert.ok(agent.includes(area), area);
});

// ---------- form order: approve before install ----------
test('AC5 the Lead asks the approve form before the Install / Skip form; Skip installs nothing; both must be yes', () => {
  const t = read('skills/lead/references/skill-picks.md');
  order(t, ['**Approve form** (never auto)', '**Install / Skip form**']);
  assert.match(t, /Skip writes nothing/);
  assert.match(t, /--dry-run/);
  assert.match(t, /only after approval/i);
  assert.match(read('docs/contracts/skill-recommendation.md'), /Nothing installs unless the approve form says yes and the Install form says yes/);
});

// ---------- skill-recommendation v1 ----------
test('AC6 skill-recommendation v1 names area, keeps the source/name allow-list by reusing the design-skills-section parser', () => {
  const c = read('docs/contracts/skill-recommendation.md');
  assert.match(c, /^# Contract: skill-recommendation v1/);
  assert.match(c, /area: \(stack\|product-type\|company-type\|design\)/);
  assert.match(c, /parseDesignSkills/);
  assert.match(c, /\| `vet <handoff> --json` \|/);
  assert.match(c, /commit: \(\[\^;\]\+\)/);
  assert.ok(read('docs/contracts/design-skills-section.md').includes('# Contract: design-skills-section v1'), 'v1 not bumped');
});

// ---------- skills-section v1 ----------
test('skills-section v1: Contract, project template and installer agree on the ## Skills section', () => {
  const c = read('docs/contracts/skills-section.md');
  assert.match(c, /^# Contract: skills-section v1/);
  assert.match(c, /area: \(stack\|product-type\|company-type\)/);
  assert.match(c, /At most 5 lines per area, 15 in all/);
  assert.match(read('skills/lead/references/project-template.md'), /^## Skills$/m);
  assert.match(read('scripts/install-skills.mjs'), /parseSkillsSection/);
});

// ---------- registration and check.mjs ----------
test('AC7 skill-researcher is registered everywhere and scripts/check.mjs passes', () => {
  assert.equal(JSON.parse(read('company/names.json'))['skill-researcher'], 'Selin');
  for (const f of ['documentation/roles.md', 'README.md', 'documentation/concepts.md']) assert.match(read(f), /skill-researcher/, f);
  assert.match(read('documentation/commands.md'), /\/aico:skillspector/);
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'check.mjs')], { cwd: root, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ---------- aico-mods v1.1 progress bars ----------
const gate = (g, result = 'passed') => ({ gate: g, result, at: '2026-01-01T10:00:00Z' });
const base = { v: 1, slug: 'demo', started: '2026-01-01T10:00:00Z', ended: null, outcome: null, wave: 1, round: 0, tier: 'medium', warnings: [] };
test('aico-mods v1.1 bars: the Contract example rows, ended ship run, unknown, mod off', () => {
  const steps = (done) => Array.from({ length: 8 }, (_, i) => ({ step: String(i + 1).padStart(2, '0'), role: 'architect', round: 0, file: `${String(i + 1).padStart(2, '0')}-architect.md`, mtime: '2026-01-01T10:00:00Z', status: i < done ? 'done' : 'unknown' }));
  const view = { ...base, state: 'running', gates: [gate('brief')], steps: steps(5) };
  const rows = progressRows(view, 40);
  assert.match(rows[0], /^Gates 1\/3 \[#+-+\] last: brief$/);
  assert.match(rows[1], /^Steps 5\/8 \[#+-+\]$/);
  const cells = (r) => r.slice(r.indexOf('[') + 1, r.indexOf(']')).length;
  assert.equal(cells(rows[0]), cells(rows[1]), 'one cell count for both rows');
  const empty = progressRows({ ...base, state: 'running', gates: [], steps: [] }, 40);
  assert.match(empty[0], /^Gates 0\/3 \[-+\] last: none$/);
  assert.equal(empty[1], 'Steps 0/0');
  assert.deepEqual(progressRows(null, 40).map((r) => r.replace(/\s+/g, ' ')), ['Gates ?', 'Steps ?']);
  const ended = progressRows({ ...base, state: 'ended', outcome: 'ship', gates: [gate('brief'), gate('plan'), gate('ship')], steps: steps(8) }, 40);
  assert.match(ended[0], /^Gates 3\/3 \[#+\] last: ship$/);
  assert.match(ended[1], /^Steps 8\/8 \[#+\]$/);
});
test('aico-mods v1.1: only the pane draws bars; the status part and the off switch are untouched', () => {
  const savvy = read('mods/savvy.tsx');
  assert.equal((savvy.match(/progressRows\(/g) ?? []).length, 1, 'one call site');
  order(savvy, ['labelled(\'Elapsed\'', '...progressRows(model.view, width)', 'No subagent running.']);
  assert.match(savvy, /savvy is off; switch it on in \/aico:settings/);
  assert.doesNotMatch(read('mods/lib/bars.mjs'), /[^\x00-\x7f]/, 'ASCII only');
  assert.match(read('docs/contracts/aico-mods.md'), /^# Contract: aico-mods v1\.1/);
  for (const f of ['mods/shared/status.ts', 'mods/lib/status.mjs']) assert.doesNotMatch(read(f), /progressRows|Gates \[/, f);
});

// ---------- aico-settings v1.2 ----------
test('aico-settings v1.2: Contract version, plugin default and the page row are in place', () => {
  // v1.2 or later (later versions are additive)
  const m = read('docs/contracts/aico-settings.md').match(/^# Contract: aico-settings v(\d+)\.(\d+)/);
  assert.ok(m, 'Contract header present');
  assert.ok(Number(m[1]) > 1 || Number(m[2]) >= 2, `Contract is v1.2 or later, got v${m && m[1]}.${m && m[2]}`);
  assert.match(read('scripts/settings.mjs'), /SKILLSPECTOR_DEFAULTS/);
  assert.match(read('scripts/settings-page.html'), /Scan mode/);
});
