// Regression: the helper's async spawn `error` must not leave the arm file behind (lead-session-mcp v2.1).
// The real startHelper runs (no deps.start seam); process.execPath points at a missing file so spawn emits `error` after newSession returned.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newSession } from './lead-launch-mcp.mjs';

const ID = 'P20261109.000001';
const SLUG = `${ID}/01-feature`;
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-mcp-spawn-'));
  tmps.push(root);
  const work = path.join(root, '.company', 'work');
  const dir = path.join(work, ID, '01-feature');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(work, ID, '00-project.md'), 'Demo project\n');
  const now = Date.now();
  const id = '000000000001';
  const rows = [{ v: 1, at: iso(now - 60000), ev: 'start' }, { v: 1, at: iso(now - 50000), ev: 'sub', role: 'backend-engineer', id, phase: 'start' },
    { v: 1, at: iso(now - 40000), ev: 'sub', role: 'backend-engineer', id, phase: 'stop' }];
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const ev = { v: 1, n: 1, at: iso(now - 1000), ev: 'handover', file: 'lead-handoff-1.md', tokens: 85600, window: null, trigger: 'context', session: 'abcdef012345' };
  fs.writeFileSync(path.join(dir, 'lead-handover.jsonl'), `${JSON.stringify(ev)}\n`);
  return { root, dir, now };
}

test('S-5: helper fails to start (async spawn error) -> arm file removed so a retry can arm again', async () => {
  const { root, dir, now } = fixture();
  const plat = Object.getOwnPropertyDescriptor(process, 'platform');
  const exec = Object.getOwnPropertyDescriptor(process, 'execPath');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  Object.defineProperty(process, 'execPath', { value: path.join(root, 'no-such-node.exe'), configurable: true, writable: true });
  try {
    newSession(root, now);
    await new Promise((r) => setTimeout(r, 500)); // let the async spawn `error` fire
    assert.equal(fs.existsSync(path.join(dir, 'lead-replace.json')), false, 'arm file must be removed after the helper failed to start');
  } finally {
    Object.defineProperty(process, 'platform', plat);
    Object.defineProperty(process, 'execPath', exec);
  }
});
