// The cap guard finds the active v3 run `<ID>/<NN>-<pb>`, keeps its record in that run folder and allows a new
// Handoff written directly in it. Rewritten red-first for the engine (T20, P20261114.000001; AC13, `context-guard`
// v2.0: record file is guard.jsonl, was context-guard.jsonl). v2 (flat) cases stay in tests/context-guard/guard.test.mjs.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { capEnv, cleanup, SLUG } from '../tests/context-guard/cap-engine.mjs';

after(cleanup);
const ID = SLUG.split('/')[0];
const F = 162000;

async function booted() {
  const fx = await capEnv();
  fx.boot();
  return fx;
}
const writeAt = (fx, file, over = {}) => fx.step(F, { tool: 'Write', input: { file_path: file, content: 'x' }, ...over });

describe('v3 run folder', () => {
  test('below the freeze point stays silent with no record', async () => {
    const fx = await booted();
    fx.quiet(fx.step(F - 1));
    assert.deepEqual(fx.guardRecord(), []);
  });

  test('at the freeze point a tool is denied and the deny is recorded in guard.jsonl of the v3 run folder', async () => {
    const fx = await booted();
    assert.match(fx.denyOf(fx.step(F)), /cap\.M1/);
    assert.deepEqual(fx.guardRecord().map((l) => l.ev), ['deny']);
    assert.ok(fs.existsSync(path.join(fx.runDir, 'guard.jsonl')));
    assert.equal(fs.existsSync(path.join(fx.runDir, 'context-guard.jsonl')), false, 'the v1 record name is not written');
  });

  test('a Write of a new Handoff directly in the v3 run folder is allowed and recorded with its name', async () => {
    const fx = await booted();
    fx.quiet(writeAt(fx, path.join(fx.runDir, '04-backend-engineer.md')));
    assert.deepEqual(fx.guardRecord().map((l) => [l.ev, l.file]), [['handoff', '04-backend-engineer.md']]);
  });

  test('a findings ledger in the v3 run folder is allowed once, recorded as a ledger', async () => {
    const fx = await booted();
    fx.quiet(writeAt(fx, path.join(fx.runDir, '04-code-reviewer.findings.md')));
    assert.match(fx.denyOf(writeAt(fx, path.join(fx.runDir, '04-other.findings.md'))), /cap\.M1/);
  });

  test('a Write in the project folder, a sibling run folder or a deeper path is denied', async () => {
    const fx = await booted();
    const work = path.join(fx.env.project, '.company', 'work', ID);
    fs.mkdirSync(path.join(work, '02-fix'), { recursive: true });
    for (const file of [path.join(work, '04-x.md'), path.join(work, '02-fix', '04-x.md'), path.join(fx.runDir, 'sub', '04-x.md')]) {
      assert.match(fx.denyOf(writeAt(fx, file)), /cap\.M1/, file);
    }
    assert.ok(fx.guardRecord().every((l) => l.ev === 'deny'));
  });

  test('SubagentStop blocks once after a deny with no Handoff, and lets a Step that wrote one end', async () => {
    const fx = await booted();
    fx.step(F);
    assert.equal(fx.stop().json.decision, 'block');
    const fy = await booted();
    const file = path.join(fy.runDir, '04-backend-engineer.md');
    fy.step(F);
    writeAt(fy, file);
    fs.writeFileSync(file, 'x');
    fy.quiet(fy.stop());
  });
});
