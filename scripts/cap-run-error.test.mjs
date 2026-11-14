// cap.M1 R-8: a run-lookup error is not "no active run"; at the hand-over point it fails closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judge, freezeAt } from '../hooks/rules/cap.mjs';
import { resolveRun } from '../hooks/lib/cap-effects.mjs';

const snap = { threshold: 180000 };
const over = freezeAt(180000);
const ev = (run, total, session = 'lead') => ({
  run, session, tokens: { state: 'read', total }, tool: { name: 'Bash', paths: [] }
});

test('lookup error at or over the freeze point denies and names the fix', () => {
  for (const session of ['lead', 'step']) {
    const v = judge(ev({ error: true, slug: 'x', folder: null }, over, session), snap);
    assert.equal(v.v, 'deny');
    assert.equal(v.rule, 'cap.M1');
    assert.match(v.message, /unreadable/);
    assert.match(v.message, /lead-handover\.jsonl|run state/);
  }
});

test('lookup error below the freeze point still allows', () => {
  assert.equal(judge(ev({ error: true, slug: 'x', folder: null }, over - 1), snap).v, 'allow');
});

test('no active run (null) still allows over the cap', () => {
  assert.equal(judge(ev(null, over + 5000), snap).v, 'allow');
});

test('resolveRun marks a malformed lead-handover record as an error, not null', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caperr-'));
  try {
    const dir = path.join(root, '.company', 'work', 'P20261114.000001', '01-feature');
    fs.mkdirSync(dir, { recursive: true });
    const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at, ev: 'start', cap: 180000 })}\n`);
    fs.writeFileSync(path.join(dir, 'lead-handover.jsonl'), 'not json\n');
    const run = await resolveRun({ sessionKey: 's1', agentKey: null }, root, Date.now());
    assert.ok(run && run.error === true, `got ${JSON.stringify(run)}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
