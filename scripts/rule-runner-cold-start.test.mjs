// R-31 (192): worker start-up must not eat the rule row's budget; the row clock starts after ready.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const LIB = path.join(ROOT, 'hooks', 'lib');

// Copy of the runner with a test hook before the worker posts ready: delay or die, set by env.
function makePlugin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-cold-'));
  fs.mkdirSync(path.join(dir, 'hooks', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'hooks', 'rules'), { recursive: true });
  fs.copyFileSync(path.join(LIB, 'rule-id.mjs'), path.join(dir, 'hooks', 'lib', 'rule-id.mjs'));
  let src = fs.readFileSync(path.join(LIB, 'rule-runner.mjs'), 'utf8');
  const marker = "if (!isMainThread && workerData && workerData.aicoRunner === true) {";
  assert.ok(src.includes(marker), 'worker block marker present');
  const hook = "if (!isMainThread && process.env.COLD_DIE === '1') process.exit(1);\n" +
    "if (!isMainThread && process.env.COLD_DELAY) await new Promise((r) => setTimeout(r, Number(process.env.COLD_DELAY)));\n";
  src = src.replace(marker, hook + marker);
  fs.writeFileSync(path.join(dir, 'hooks', 'lib', 'rule-runner.mjs'), src);
  fs.writeFileSync(path.join(dir, 'hooks', 'rules', 'ok.mjs'), "export const check = () => ({ v: 'allow' });\n");
  return dir;
}

test('R-31 cold start: row clock starts after ready; start-up past deadline times out; death before ready crashes', async () => {
  const dir = makePlugin();
  const { createRunner } = await import(pathToFileURL(path.join(dir, 'hooks', 'lib', 'rule-runner.mjs')).href);
  const job = (timeoutMs) => ({ module: 'ok.mjs', export: 'check', event: {}, snapshot: {}, timeoutMs });
  try {
    // 1. start-up (700 ms) longer than the row limit (300 ms) must still allow: the row clock starts after ready.
    process.env.COLD_DELAY = '700';
    let r = createRunner(dir, { deadlineMs: 5000 });
    try { assert.deepEqual(await r.run(job(300)), { ok: true, verdict: { v: 'allow' } }); } finally { r.close(); }

    // 2. start-up past the call deadline -> timeout.
    process.env.COLD_DELAY = '3000';
    r = createRunner(dir, { deadlineMs: 600 });
    try {
      const t0 = Date.now();
      assert.deepEqual(await r.run(job(300)), { ok: false, word: 'timeout' });
      assert.ok(Date.now() - t0 < 2500, 'gave up at the deadline, not after the full start-up');
    } finally { r.close(); }

    // 3. worker dies before ready -> crash.
    delete process.env.COLD_DELAY;
    process.env.COLD_DIE = '1';
    r = createRunner(dir, { deadlineMs: 5000 });
    try { assert.deepEqual(await r.run(job(300)), { ok: false, word: 'crash' }); } finally { r.close(); }
  } finally {
    delete process.env.COLD_DELAY; delete process.env.COLD_DIE;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
