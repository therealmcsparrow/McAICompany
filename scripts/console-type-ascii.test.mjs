// Regression for S-3: console-type.ps1 must refuse non-ASCII text, never strip it silently.
// A bogus PID makes a typed attempt exit 1 (attach failed); a refusal must exit 2 before any attach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ps1 = fileURLToPath(new URL('./lib/console-type.ps1', import.meta.url));
const BOGUS_PID = '4000000000';
const probe = process.platform === 'win32' ? spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0']) : null;
const skip = !probe || probe.status !== 0 ? 'needs Windows PowerShell' : false;

function run(text) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '--pid', BOGUS_PID], {
    input: Buffer.from(text, 'utf8'),
    timeout: 60000,
  });
  return r.status;
}

test('S-3 control: pure ASCII text reaches the attach step (exit 1)', { skip }, () => {
  assert.equal(run('run-abc123\r'), 1);
});

test('S-3 mixed ASCII and non-ASCII text is refused (exit 2), not stripped and typed', { skip }, () => {
  assert.equal(run('P20261115-café\r'), 2);
});

test('S-3 non-ASCII outside the BMP is refused (exit 2)', { skip }, () => {
  assert.equal(run('run-\u{1F600}-1\r'), 2);
});

test('S-3 control characters other than CR are refused (exit 2)', { skip }, () => {
  assert.equal(run('run\t1\r'), 2);
});
