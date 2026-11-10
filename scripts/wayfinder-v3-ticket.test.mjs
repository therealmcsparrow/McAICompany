// A pointer into a v3 run folder (.company/work/<ID>/<NN>-<playbook>/plan.md) is checked against that
// run's own tickets: a plan heading with another project's ticket ID does not count as a task.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './wayfinder.mjs';

const D = '—';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-v3-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

function put(rel, text) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

function run(folder, anchor) {
  put(`.company/work/${folder}/plan.md`,
    '# plan\n\n### P20261109.000009-T1 own task\n- role: qa\n\n### P20261110.000001-T2 other project task\n- role: qa\n');
  put('.company/wayfinder/m.md', [
    '# Wayfinder: demo',
    '',
    '## Pointers',
    `- .company/work/${folder}/plan.md#${anchor} ${D} the plan`,
    ''
  ].join('\n'));
  const r = main(['check', '.company/wayfinder/m.md'], { root });
  return r.lines.join('\n');
}

test('v3 folder: own ticket resolves', () => {
  assert.doesNotMatch(run('P20261109.000009/02-feature', 'P20261109.000009-T1'), /task missing/);
});

test('v3 folder: another project ticket ID gives task missing', () => {
  assert.match(run('P20261109.000009/03-feature', 'P20261110.000001-T2'), /task missing P20261110\.000001-T2/);
});
