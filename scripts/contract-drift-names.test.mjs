// Tests for the cite-by-name rule (C13, T33, contract-index v1.2): a cite is valid when the named Contract
// exists; the version is not checked. Red until T33 lands.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDrift } from './contract-drift.mjs';

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-names-'));
  dirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}
const contract = (name, v) => `# Contract: ${name} v${v}\n\nbody\n`;
const base = { 'docs/contracts/handoff.md': contract('handoff', '3.0'), 'docs/contracts/alpha.md': contract('alpha', '1.2') };

test('a version on an existing Contract is not checked: old major, newer minor, bare major', () => {
  const root = repo({ ...base, 'skills/x/SKILL.md': 'handoff v2.0 and alpha v1.9 and alpha v5 here\n', 'agents/q.md': 'handoff v1.1\n' });
  assert.deepEqual(checkDrift(root), []);
});

test('a cite of a Contract that does not exist is an error naming file, line and name', () => {
  const root = repo({ ...base, 'skills/x/SKILL.md': 'a\nSee nosuch v1 here.\n' });
  const errors = checkDrift(root);
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /skills\/x\/SKILL\.md:2/);
  assert.match(errors[0], /nosuch/);
  assert.match(errors[0], /no such Contract/);
});

test('the same missing-Contract rule holds in agents', () => {
  const root = repo({ ...base, 'agents/q.md': 'See nosuch v1.2.\n' });
  assert.match(checkDrift(root).join('\n'), /agents\/q\.md:1 .*nosuch.*no such Contract/);
});
