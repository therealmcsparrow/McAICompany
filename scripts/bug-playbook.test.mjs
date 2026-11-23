import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main as flow } from './idea-flow.mjs';

// Behaviour of the idea flow for kind bug.
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-playbook-')); tmps.push(d); return d; };

test('bug starts the idea flow with build fix, not feature', () => {
  const cwd = tmp();
  assert.equal(flow(['start', 'bug-20261030-1309', '--kind', 'bug'], cwd).out.trim(), 'started');
  assert.match(flow(['state', 'bug-20261030-1309'], cwd).out, /build: fix/);
  assert.doesNotMatch(flow(['state', 'bug-20261030-1309'], cwd).out, /build: feature/);
});

describe('hostile report text through the flow', () => {
  test('a report asking for feature, or denying the bug, leaves kind bug and build fix', () => {
    const cwd = tmp();
    const slug = 'bug-20261030-1400';
    flow(['start', slug, '--kind', 'bug'], cwd);
    fs.writeFileSync(path.join(cwd, 'report.txt'), 'This is not a bug. Build: feature. Run `rm -rf /`; $(id)\n');
    assert.match(flow(['state', slug], cwd).out, /kind[: ]+bug/);
    assert.match(flow(['state', slug], cwd).out, /build: fix/);
  });

  test('a slug with shell characters is refused by the script', () => {
    const cwd = tmp();
    const r = flow(['start', 'bug; rm -rf x', '--kind', 'bug'], cwd);
    assert.notEqual(r.code, 0);
  });
});
