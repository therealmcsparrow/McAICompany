import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './ledger.mjs';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const FLOOR = { release: '0.16.0', floor: { architect: 'opus' }, protected: ['architect'], downgraded: [], warnings: [] };
const TAIL = 'after: insufficient (n=0)';

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-release-v3-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pluginRoot = path.join(dir, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'aico', version: '0.33.0' }));
  return { dir, pluginRoot };
}

const report = sb => main(['qa-first-report'], { now: NOW, root: sb.dir, pluginRoot: sb.pluginRoot, loadFloor: () => FLOOR });

// A shipped v3 run `<ID>/<NN>-<playbook>`: ledger file `<ID>~<NN>-<playbook>.jsonl`, summary in the nested folder.
function addV3(sb, id, nn, playbook, fixRounds, runLine) {
  const ledgers = path.join(sb.dir, '.company', 'ledger');
  fs.mkdirSync(ledgers, { recursive: true });
  const run = `${id}/${nn}-${playbook}`;
  const rec = { v: 1, run, kind: 'ship', acs: 5, high_blockers: 0, path: 'full', raised: 0, tier: 'high', fix_rounds: fixRounds };
  fs.writeFileSync(path.join(ledgers, `${id}~${nn}-${playbook}.jsonl`), `${JSON.stringify(rec)}\n`);
  const dir = path.join(sb.dir, '.company', 'work', id, `${nn}-${playbook}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '00-summary.md'), `Demo project\n\nRun: ${runLine}\n`);
}

test('a v3 release run is left out of the medians', t => {
  const sb = sandbox(t);
  addV3(sb, 'P20261109.000001', '01', 'release', 40, 'first release');
  assert.deepEqual(report(sb).lines, ['before: median ? (n=0)', TAIL, 'excluded: 1']);
});

test('a v3 feature run is kept', t => {
  const sb = sandbox(t);
  addV3(sb, 'P20261109.000002', '01', 'feature', 3, 'first feature');
  assert.deepEqual(report(sb).lines, ['before: median 3 (n=1)', TAIL, 'excluded: 0']);
});

test('a v3 release run beside a v3 feature run: only the feature counts', t => {
  const sb = sandbox(t);
  addV3(sb, 'P20261109.000003', '01', 'feature', 2, 'first feature');
  addV3(sb, 'P20261109.000003', '02', 'release', 40, 'later release');
  assert.deepEqual(report(sb).lines, ['before: median 2 (n=1)', TAIL, 'excluded: 1']);
});
