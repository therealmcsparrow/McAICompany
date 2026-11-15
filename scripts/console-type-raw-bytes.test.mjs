// console-type.ps1 must judge the raw stdin bytes, not text decoded with the console code page.
// A bogus PID makes a typed attempt exit 1 (attach failed); a refusal must exit 2 before any attach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ps1 = fileURLToPath(new URL('./lib/console-type.ps1', import.meta.url)).replace(/\\/g, '/');
const probe = process.platform === 'win32' ? spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0']) : null;
const skip = !probe || probe.status !== 0 ? 'needs Windows PowerShell' : false;

function run(bytes, codePage) {
  const cmd = `chcp ${codePage} >nul & powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${ps1} --pid 4000000000`;
  return spawnSync('cmd.exe', ['/d', '/c', cmd], { input: Buffer.from(bytes), timeout: 60000 }).status;
}

for (const cp of ['437', '932', '936', '949', '950']) {
  test(`cp ${cp}: pure ASCII bytes reach the attach step (exit 1)`, { skip }, () => {
    assert.equal(run([0x61, 0x62, 0x31, 0x0d], cp), 1);
  });
  test(`cp ${cp}: invalid UTF-8 lead and trail bytes are refused (exit 2)`, { skip }, () => {
    assert.equal(run([0x61, 0x81, 0x20, 0x62, 0x0d], cp), 2);
    assert.equal(run([0x61, 0xff, 0x62, 0x0d], cp), 2);
  });
  test(`cp ${cp}: UTF-8 multibyte text is refused (exit 2)`, { skip }, () => {
    assert.equal(run([0x61, 0xc3, 0xa9, 0x0d], cp), 2);
  });
  test(`cp ${cp}: DEL, NUL and LF are refused (exit 2)`, { skip }, () => {
    assert.equal(run([0x61, 0x7f, 0x0d], cp), 2);
    assert.equal(run([0x61, 0x00, 0x0d], cp), 2);
    assert.equal(run([0x61, 0x0a, 0x0d], cp), 2);
  });
}
