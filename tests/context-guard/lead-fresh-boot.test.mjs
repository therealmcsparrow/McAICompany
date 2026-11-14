// A fresh Lead session holds about 55k tokens before it reads anything (system prompt, tools, skill and agent listings),
// and the cap guard (cap.M1, `context-guard` v2.0) freezes the Lead at 90% of the snapshot threshold. The boot path (new-session command, resume line,
// header) must therefore point to the short skills/pipeline/references/lead-resume.md, and what that path loads must stay
// small enough to leave real headroom below the point.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { capEnv, cleanup } from './cap-engine.mjs';
import { newSessionCommand, HEADER, resume } from '../../scripts/lead-handover.mjs';

// The freeze checks run through the engine (scripts/hook-host.mjs, real cap.M1 rule);
// the threshold is the user setting `pipeline.context_cap` read into the snapshot at SessionStart, never a value
// recorded on the run's start line (run-state v3.0). The boot-budget tests below are unchanged.
const SLUG = 'P20261114.000099/01-feature';
after(cleanup);

// A run, a snapshot taken with `cap` (undefined = the default) and the Lead's call at the last reading.
async function fixture(readings, cap) {
  const fx = await capEnv({ cap });
  fx.bootLead();
  return { fx, call: () => fx.lead(readings[readings.length - 1], { rows: readings }), root: fx.env.project };
}

const repo = path.join(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(repo, ...p), 'utf8');

const BASELINE = 55600;      // measured first reading of a fresh Lead session
const BYTES_PER_TOKEN = 3;   // conservative: real text is nearer 4
const BOOT_HEADROOM_AT = 71000;

describe('Lead hand-over loop: lean boot path', () => {
  test('what the resume path loads (resume file plus pipeline skill) keeps the boot reading near 71k', () => {
    const bytes = ['skills/pipeline/references/lead-resume.md', 'skills/pipeline/SKILL.md']
      .reduce((n, f) => n + Buffer.byteLength(read(...f.split('/'))), 0);
    const tokens = BASELINE + Math.ceil(bytes / BYTES_PER_TOKEN);
    assert.ok(tokens <= BOOT_HEADROOM_AT, `boot reading ${tokens} must stay at or below ${BOOT_HEADROOM_AT} (${bytes} bytes loaded)`);
  });

  test('the resume file tells the Lead not to load the Playbook skill or the full reference', () => {
    const t = read('skills', 'pipeline', 'references', 'lead-resume.md');
    assert.match(t, /## Do not load at boot/);
    assert.match(t, /Playbook skill/);
  });

  test('the new-session command names the resume file, not the full reference', () => {
    const c = newSessionCommand(SLUG);
    assert.match(c, /references\/lead-resume\.md/);
    assert.ok(!c.includes('lead-handover.md'));
  });

  test('HEADER names the resume file, not the full reference', () => {
    assert.match(HEADER, /skills\/pipeline\/references\/lead-resume\.md/);
    assert.ok(!HEADER.includes('lead-handover.md'));
  });

  test('resume() output after a compact names the resume file', async () => {
    const f = await fixture([55558]);
    const payload = JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', session_id: 'sess-fresh-lead-1' });
    const r = resume(payload, { root: f.root, now: Date.now() });
    const ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext;
    assert.match(ctx, /references\/lead-resume\.md/);
    assert.ok(!ctx.includes('lead-handover.md'));
  });
});

describe('Lead hand-over loop: the guard still freezes a session over the point', () => {
  test('control: a session far over the handover (55558 -> 150000, threshold 120000) is frozen, one handover recorded', async () => {
    const f = await fixture([55558, 100000, 150000], 120000);
    const r = f.call();
    assert.ok(f.fx.isDeny(r), r.out);
    assert.equal(f.fx.handovers().length, 1);
  });

  test('a fresh session below the point is not frozen: 108000 at threshold 130000 is allowed, 117000 is frozen', async () => {
    const low = await fixture([55558, 100000, 108000], 130000);
    low.fx.quiet(low.call());
    assert.deepEqual(low.fx.handovers(), []);
    const hi = await fixture([55558, 100000, 117000], 130000);
    assert.ok(hi.fx.isDeny(hi.call()));
  });

  test('without a stored threshold the same session freezes at 162000, not at 150000', async () => {
    const low = await fixture([55558, 100000, 150000]);
    low.fx.quiet(low.call());
    const hi = await fixture([55558, 100000, 162000]);
    assert.ok(hi.fx.isDeny(hi.call()));
  });

  test('the smallest threshold hands over below a fresh session reading: a boot at 55558 with 60000 is frozen', async () => {
    const f = await fixture([55558], 60000);
    assert.ok(f.fx.isDeny(f.call()));
  });

  test('a cap recorded on the run start line is ignored: the snapshot threshold decides (run-state v3.0)', async () => {
    const f = await fixture([55558, 100000, 110000], 130000);
    const file = path.join(f.fx.runDir, 'run-state.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ v: 1, at: new Date(Date.now() - 60000).toISOString().replace(/\.\d{3}Z$/, 'Z'), ev: 'start', cap: 60000 })}
`);
    f.fx.quiet(f.call());
  });
});
