// Wiring checks that no other suite pins (registration, Savvy bars, settings page row).
// The deep suites live in skillspector.test.mjs, skill-picks.test.mjs, settings.test.mjs,
// mods-lib.test.mjs (bars) and install-skills-skills.test.mjs (skills-section parser).
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

// ---------- registration and check.mjs ----------
test('AC7 skill-researcher is registered in names.json and scripts/check.mjs passes', () => {
  assert.equal(JSON.parse(read('company/names.json'))['skill-researcher'], 'Selin');
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
  for (const f of ['mods/shared/status.ts', 'mods/lib/status.mjs']) assert.doesNotMatch(read(f), /progressRows|Gates \[/, f);
});

// ---------- aico-settings v1.2 ----------
test('aico-settings: the plugin default and the page row are in place', () => {
  assert.match(read('scripts/settings.mjs'), /SKILLSPECTOR_DEFAULTS/);
  assert.match(read('scripts/settings-page.html'), /Scan mode/);
});
