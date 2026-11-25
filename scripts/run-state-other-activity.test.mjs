// A `sub` row of a non-aico agent (role `other`) is not run activity. Every subagent of every
// session stops through the step-times hook while a run is active, so counting those rows kept
// a dead run active forever, and with it the cap guard's "main spawns only the Lead" rule.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, active } from './run-state.mjs';

const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'run-state-other-'));
const isoHome = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cap-home-'));
const saved = { MCSPARROW_HOME: process.env.MCSPARROW_HOME, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.MCSPARROW_HOME = path.join(isoHome, '.mcsparrow');
process.env.HOME = isoHome;
process.env.USERPROFILE = isoHome;
after(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(isoHome, { recursive: true, force: true });
});

const H = 60 * 60 * 1000;
const T0 = Date.parse('2026-10-26T10:00:00Z');
let n = 0;
function started() {
  const root = path.join(base, `r${n++}`);
  fs.mkdirSync(path.join(root, '.company', 'work'), { recursive: true });
  assert.equal(run(['start', 'x'], { root, now: T0 }).code, 0);
  return root;
}
const go = (root, args, ms) => assert.equal(run(args, { root, now: T0 + ms }).code, 0);

test('role other sub rows do not keep a run active past 12 h', () => {
  const root = started();
  for (let h = 2; h <= 20; h += 2) go(root, ['sub', 'x', 'stop', 'other', `${String(h).padStart(12, '0')}`], h * H);
  assert.equal(active(root, { now: T0 + 13 * H }).slug, null);
});

test('an aico Role sub row still counts as activity', () => {
  const root = started();
  go(root, ['sub', 'x', 'stop', 'qa', 'a1b2c3d4e5f6'], 10 * H);
  assert.equal(active(root, { now: T0 + 13 * H }).slug, 'x');
});

test('a fresh run is active on its start row alone', () => {
  const root = started();
  go(root, ['sub', 'x', 'stop', 'other', 'a1b2c3d4e5f6'], 1 * H);
  assert.equal(active(root, { now: T0 + 2 * H }).slug, 'x');
});
