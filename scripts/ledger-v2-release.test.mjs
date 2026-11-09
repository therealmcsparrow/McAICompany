import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './ledger.mjs';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const FLOOR = { release: '0.16.0', floor: { architect: 'opus' }, protected: ['architect'], downgraded: [], warnings: [] };
const TAIL = 'after: insufficient (n=0)';

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-v2-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pluginRoot = path.join(dir, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'aico', version: '0.31.0' }));
  return { dir, pluginRoot };
}

const jl = (...recs) => `${recs.map(r => JSON.stringify(r)).join('\n')}\n`;
const report = sb => main(['qa-first-report'], { now: NOW, root: sb.dir, pluginRoot: sb.pluginRoot, loadFloor: () => FLOOR });
let counter = 0;

// A shipped run with its ledger file; `summary` is undefined (no 00-summary.md), text, or a function that receives the folder.
function addRun(sb, run, fixRounds, summary) {
  const ledgers = path.join(sb.dir, '.company', 'ledger');
  fs.mkdirSync(ledgers, { recursive: true });
  const rec = { v: 1, run, kind: 'ship', acs: 5, high_blockers: 0, path: 'full', raised: 0, tier: 'high', fix_rounds: fixRounds };
  fs.writeFileSync(path.join(ledgers, `${run}.jsonl`), jl(rec));
  const dir = path.join(sb.dir, '.company', 'work', run);
  fs.mkdirSync(dir, { recursive: true });
  if (typeof summary === 'string') fs.writeFileSync(path.join(dir, '00-summary.md'), summary);
  if (typeof summary === 'function') summary(dir);
}

const v2 = () => {
  counter += 1;
  return `P20261108.${String(counter).padStart(6, '0')}-22.25.${String(counter % 60).padStart(2, '0')}`;
};
const sum = runLine => `Demo project\n\nRun: ${runLine}\n`;

// ---------- hostile cases first ----------

test('a v2 run with no 00-summary.md is counted', t => {
  const sb = sandbox(t);
  addRun(sb, v2(), 3);
  assert.deepEqual(report(sb).lines, ['before: median 3 (n=1)', TAIL, 'excluded: 0']);
});

test('a v2 run whose 00-summary.md is a link is not followed and is counted', t => {
  const sb = sandbox(t);
  const outside = path.join(sb.dir, 'outside.md');
  fs.writeFileSync(outside, sum('first release'));
  addRun(sb, v2(), 3, dir => {
    try {
      fs.symlinkSync(outside, path.join(dir, '00-summary.md'));
    } catch {
      fs.linkSync(outside, path.join(dir, '00-summary.md'));
    }
  });
  assert.deepEqual(report(sb).lines, ['before: median 3 (n=1)', TAIL, 'excluded: 0']);
});

test('a v2 run whose summary has no Run line or a damaged one is counted', t => {
  const sb = sandbox(t);
  addRun(sb, v2(), 2, 'Demo project\n');
  addRun(sb, v2(), 2, 'Demo project\n\nRun: release\n');
  addRun(sb, v2(), 2, 'Demo project\n\nrun: first release\n');
  assert.deepEqual(report(sb).lines, ['before: median 2 (n=3)', TAIL, 'excluded: 0']);
});

test('a description that says release does not exclude a v2 run', t => {
  const sb = sandbox(t);
  addRun(sb, v2(), 4, 'Release the thing\n\nRun: first feature\n');
  assert.deepEqual(report(sb).lines, ['before: median 4 (n=1)', TAIL, 'excluded: 0']);
});

// ---------- v2 release filter ----------

test('a v2 run with Run: first release is left out, in any run kind', t => {
  const sb = sandbox(t);
  addRun(sb, v2(), 40, sum('first release'));
  addRun(sb, v2(), 40, sum('later release'));
  addRun(sb, v2(), 40, sum('draft release'));
  addRun(sb, v2(), 1, sum('first feature'));
  assert.deepEqual(report(sb).lines, ['before: median 1 (n=1)', TAIL, 'excluded: 3']);
});

test('a v2 run with another Playbook is counted, also one that starts with release', t => {
  const sb = sandbox(t);
  addRun(sb, v2(), 1, sum('first feature'));
  addRun(sb, v2(), 3, sum('later fix'));
  addRun(sb, v2(), 5, sum('first release-notes'));
  assert.deepEqual(report(sb).lines, ['before: median 3 (n=3)', TAIL, 'excluded: 0']);
});

test('a v2 release run with qa 1 is left out of the after group too', t => {
  const sb = sandbox(t);
  const run = v2();
  addRun(sb, run, 40, sum('first release'));
  const file = path.join(sb.dir, '.company', 'ledger', `${run}.jsonl`);
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, jl({ ...rec, qa: 1 }));
  assert.deepEqual(report(sb).lines, ['before: median ? (n=0)', TAIL, 'excluded: 1']);
});

// ---------- v1.1 names stay left out ----------

test('v1.1 release names are still left out and need no summary', t => {
  const sb = sandbox(t);
  addRun(sb, '2026-11-08 22.25 - Release Version 0 31 0', 40);
  addRun(sb, '2026-11-08 22.26 - Release', 40);
  addRun(sb, '2026-11-08 22.27 - Releasing Docs', 2);
  assert.deepEqual(report(sb).lines, ['before: median 2 (n=1)', TAIL, 'excluded: 2']);
});

test('a v1.1 release name with a v2-style summary on disk stays left out by name', t => {
  const sb = sandbox(t);
  addRun(sb, '2026-11-08 22.25 - Release Next', 40, sum('first feature'));
  assert.deepEqual(report(sb).lines, ['before: median ? (n=0)', TAIL, 'excluded: 1']);
});
