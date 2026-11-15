import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-main-'));
const link = path.join(tmp, 'link');
fs.symlinkSync(scripts, link, 'junction');

function run(name, args, input) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [path.join(link, name), ...args], { encoding: 'utf8', input: input ?? '', env, timeout: 60000 });
}

test('hook-pins runs as main through a symlinked path', () => {
  const r = run('hook-pins.mjs', ['bogus']);
  assert.match(r.stdout, /usage: hook-pins/);
  assert.equal(r.status, 2);
});

test('hook-host runs as main through a symlinked path', () => {
  const r = run('hook-host.mjs', [], '{}');
  assert.notEqual(r.stdout + r.stderr, '', 'host must produce output, not exit silently');
});
