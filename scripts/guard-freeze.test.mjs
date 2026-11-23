// Tests for the guard freeze (C9, T28): the rule table keeps cap, dotenv and self-protect; the
// model-floor and browser rows, their rule files, manifests and pins are gone. Red until T28 lands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));
const rows = () => read('hooks/rules.json');

test('the rule table holds exactly the four kept guard rows', () => {
  const ids = rows().map((r) => `${r.event}:${r.rule}`).sort();
  assert.deepEqual(ids, [
    'PreToolUse:cap.M1',
    'PreToolUse:dotenv.M-SEC1',
    'PreToolUse:self-protect.M-SEC1',
    'SubagentStop:cap.M1'
  ]);
});

test('no row names the model-floor or browser rule or module', () => {
  const text = JSON.stringify(rows());
  assert.ok(!/model-floor|browser/.test(text));
});

test('self-protect.M-SEC1 is frozen: same matcher, closed, Write/Edit plus the shell tools', () => {
  const r = rows().find((x) => x.rule === 'self-protect.M-SEC1');
  assert.ok(r, 'row present');
  assert.equal(r.fail, 'closed');
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell']) assert.ok(r.matcher.includes(tool), tool);
});

test('the dropped rule modules and manifests are deleted', () => {
  for (const rel of ['hooks/rules/model-floor.mjs', 'hooks/rules/browser.mjs', 'hooks/manifests/model-floor.json', 'hooks/manifests/efficient-browser-use.json']) {
    assert.equal(fs.existsSync(path.join(REPO, rel)), false, rel);
  }
});

test('the kept rule modules and manifests are still there', () => {
  for (const rel of ['hooks/rules/cap.mjs', 'hooks/rules/dotenv.mjs', 'hooks/rules/self-protect.mjs', 'hooks/manifests/cap.json', 'hooks/manifests/dotenv.json', 'hooks/manifests/self-protect.json']) {
    assert.equal(fs.existsSync(path.join(REPO, rel)), true, rel);
  }
});

test('hooks/pins.json pins no dropped file', () => {
  const files = Object.keys(read('hooks/pins.json').files);
  // company/model-floor.json is data the dispatch rule keeps (plan Decisions); only the hook files are dropped.
  assert.deepEqual(files.filter((f) => /model-floor|browser/.test(f) && f !== 'company/model-floor.json'), []);
  assert.ok(files.includes('hooks/rules/self-protect.mjs'));
});

test('hook-check setup passes on the new rule table', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'hook-check.mjs'), 'setup', '--root', REPO], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('the model floor data stays: security and architect remain protected', () => {
  const f = read('company/model-floor.json');
  assert.ok(f.protected.includes('security'));
  assert.ok(f.protected.includes('architect'));
});
