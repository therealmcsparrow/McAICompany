// Threshold tests of the cap guard, run through the engine.
// Was: context-guard v1.2, the hand-over point is the run's recorded cap. Now: the threshold T is the snapshot's
// `threshold` (`aico-settings` v3.0 `pipeline.context_cap`, user level, 60000-250000, default 180000), the
// freeze point is F = floor(T * 0.9) (`context-guard` v2.0). Runs scripts/hook-host.mjs with the real cap.M1 rule.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { capEnv, cleanup } from '../tests/context-guard/cap-engine.mjs';

after(cleanup);

async function booted(cap, opts = {}) {
  const fx = await capEnv({ cap, ...opts });
  fx.boot();
  return fx;
}
const stepAt = async (cap, n) => { const fx = await booted(cap); return fx.capDeny(fx.step(n)); };
const leadAt = async (cap, n) => { const fx = await booted(cap); return fx.capDeny(fx.lead(n)); };

describe('AC11 the freeze point is floor(threshold x 0.9)', () => {
  const TABLE = [
    [120000, 108000], [100001, 90000], [60000, 54000], [250000, 225000], [200000, 180000], [123457, 111111], [undefined, 162000]
  ];
  for (const [cap, F] of TABLE) {
    test(`threshold ${cap ?? 'unset'}: a Step at ${F - 1} passes, at ${F} is refused`, async () => {
      assert.equal(await stepAt(cap, F - 1), false, 'below F');
      assert.equal(await stepAt(cap, F), true, 'at F');
    });
    test(`threshold ${cap ?? 'unset'}: the Lead at ${F - 1} passes, at ${F} freezes`, async () => {
      assert.equal(await leadAt(cap, F - 1), false, 'below F');
      assert.equal(await leadAt(cap, F), true, 'at F');
    });
  }

  test('the Lead freeze at 108000 (threshold 120000) records one handover; at 100000 nothing happens', async () => {
    const hi = await booted(120000);
    assert.ok(hi.capDeny(hi.lead(108000)));
    const hs = hi.handovers();
    assert.equal(hs.length, 1);
    assert.equal(hs[0].trigger, 'context');
    assert.equal(hs[0].tokens, 108000);
    const lo = await booted(120000);
    lo.quiet(lo.lead(100000));
    assert.deepEqual(lo.handovers(), []);
  });

  test('hand over at T: the Lead turn ends at the threshold, not before (threshold 120000)', async () => {
    const fx = await booted(120000);
    assert.equal(fx.lead(119999).json.continue, undefined);
    assert.equal(fx.lead(120000).json.continue, false);
  });
});

describe('AC12 a bad threshold gives 180000 and one warning naming the value', () => {
  const BAD = ['120000', '200k', 0, -1, 59999, 250001, 1e9, 2e9, 120000.5, null, true, [120000], { n: 1 }, 'x'.repeat(300)];
  for (const bad of BAD) {
    const label = JSON.stringify(bad).slice(0, 30);
    test(`threshold ${label}: a Step is refused at 162000 and allowed at 150000`, async () => {
      assert.equal(await stepAt(bad, 162000), true);
      assert.equal(await stepAt(bad, 150000), false);
    });
  }

  test('the snapshot holds exactly one warning naming the bad value, cut to 35 characters', async () => {
    for (const bad of ['200k', 250001, 59999]) {
      const fx = await booted(bad);
      const snap = JSON.parse(fs.readFileSync(fx.env.leadFile, 'utf8'));
      assert.equal(snap.threshold, 180000);
      assert.equal(snap.settingsWarnings.length, 1, JSON.stringify(snap.settingsWarnings));
      assert.ok(snap.settingsWarnings[0].includes(String(bad)), snap.settingsWarnings[0]);
    }
    const long = await booted('x'.repeat(300));
    const w = JSON.parse(fs.readFileSync(long.env.leadFile, 'utf8')).settingsWarnings;
    assert.equal(w.length, 1);
    assert.ok(!w[0].includes('x'.repeat(36)), 'the value is cut to 35 characters');
  });

  test('the bounds 60000 and 250000 are valid and give no warning', async () => {
    for (const ok of [60000, 250000]) {
      const fx = await booted(ok);
      const snap = JSON.parse(fs.readFileSync(fx.env.leadFile, 'utf8'));
      assert.equal(snap.threshold, ok);
      assert.deepEqual(snap.settingsWarnings, []);
    }
  });

  test('a project-level threshold is ignored: the guard threshold is user level only', async () => {
    const fx = await capEnv({});
    fs.writeFileSync(path.join(fx.env.project, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, pipeline: { context_cap: 100000 } } }));
    fx.boot();
    assert.equal(JSON.parse(fs.readFileSync(fx.env.leadFile, 'utf8')).threshold, 180000);
    fx.quiet(fx.step(150000));
  });
});

describe('AC17 a settings edit applies at the next Step dispatch, never mid-Step', () => {
  test('the running Step keeps the threshold of its dispatch; the next Step gets the new one', async () => {
    const fx = await booted(120000);
    fx.env.setConfig({ pipeline: { context_cap: 200000 } });
    assert.ok(fx.capDeny(fx.step(110000)), 'agent-a1 still works to 120000');
    fx.env.run(fx.env.event('SubagentStart', { agent_id: 'agent-b2' }));
    fx.quiet(fx.step(110000, { agent: 'agent-b2' }), 'agent-b2 works to 200000');
    assert.ok(fx.capDeny(fx.step(180000, { agent: 'agent-b2' })));
  });

  test('a resumed Step keeps its file (cch.M15): a second SubagentStart of the same agent does not re-read settings', async () => {
    const fx = await booted(120000);
    fx.env.setConfig({ pipeline: { context_cap: 200000 } });
    fx.env.run(fx.env.event('SubagentStart', { agent_id: 'agent-a1' }));
    assert.ok(fx.capDeny(fx.step(110000)));
  });
});

describe('the fast path: below floor(60000 x 0.9) = 54000 nothing can trigger', () => {
  test('a Step and a Lead at 53999 pass with threshold 60000 and record nothing; at 54000 both are refused', async () => {
    const fx = await booted(60000);
    fx.quiet(fx.step(53999));
    fx.quiet(fx.lead(53999));
    assert.deepEqual(fx.handovers(), []);
    assert.deepEqual(fx.guardRecord(), []);
    assert.ok(fx.capDeny(fx.step(54000)));
    assert.ok(fx.capDeny(fx.lead(54000)));
  });
});

describe('no active run is a no-op', () => {
  test('a Step and a Lead far over any threshold pass and write nothing', async () => {
    const fx = await booted(120000, { run: false });
    fx.quiet(fx.step(900000));
    fx.quiet(fx.lead(900000));
    assert.deepEqual(fx.handovers(fx.env.project), []);
  });
});
