// Regression: plan-check.mjs loads settings.mjs via createRequire. Any
// top-level await in that graph (check.mjs -> route.mjs) makes require()
// throw ERR_REQUIRE_ASYNC_MODULE. Each load runs in a fresh process so the
// module cache of this test cannot mask the fault.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));

function requireInFreshProcess(file) {
  const code =
    "const { createRequire } = require('node:module');" +
    `const r = createRequire(${JSON.stringify(path.join(dir, 'plan-check.mjs'))});` +
    `r(${JSON.stringify('./' + file)});` +
    "process.stdout.write('loaded');";
  return spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
}

for (const file of ['settings.mjs', 'check.mjs']) {
  test(`require() of ${file} does not throw ERR_REQUIRE_ASYNC_MODULE`, () => {
    const r = requireInFreshProcess(file);
    assert.doesNotMatch(r.stderr, /ERR_REQUIRE_ASYNC_MODULE/, r.stderr);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'loaded');
  });
}
