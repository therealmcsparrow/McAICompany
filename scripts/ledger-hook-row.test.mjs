// Tests for token-ledger v1.15 (C10, T29): rows with source `hook` and kind `lead`; `add` stays as fallback.
// Assumed interface (the builder may adjust, tell QA):
//   addFromHook(rec, { root, now })  rec = { run, kind, id, role, agent, ctx_end, tool_uses?, ms? }; kind `step` or `lead`
//   hasHookRow(step, role, { root, run }) -> boolean
// Red until T29 lands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ledger from './ledger.mjs';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const RUN = 'p20261120-hook';

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ledger-hook-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const rows = (dir, run = RUN) => {
  const f = path.join(dir, '.company', 'ledger', `${run}.jsonl`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const step = { run: RUN, kind: 'step', id: '07', role: 'qa', agent: 'a99810bc7fa401597', ctx_end: 115158, tool_uses: 163, ms: 90000 };

test('the module exports addFromHook and hasHookRow', () => {
  assert.equal(typeof ledger.addFromHook, 'function');
  assert.equal(typeof ledger.hasHookRow, 'function');
});

test('addFromHook with a step id, role and usage writes one row with source hook', (t) => {
  const dir = sandbox(t);
  ledger.addFromHook(step, { root: dir, now: NOW });
  const r = rows(dir);
  assert.equal(r.length, 1);
  assert.equal(r[0].src, 'hook');
  assert.equal(r[0].kind, 'step');
  assert.equal(r[0].id, '07');
  assert.equal(r[0].role, 'qa');
  assert.equal(r[0].ctx_end, 115158);
  assert.equal(r[0].tool_uses, 163);
});

test('the same step id and role again writes no duplicate', (t) => {
  const dir = sandbox(t);
  ledger.addFromHook(step, { root: dir, now: NOW });
  ledger.addFromHook({ ...step, agent: 'other-agent' }, { root: dir, now: NOW + 1000 });
  assert.equal(rows(dir).length, 1);
});

test('the same step id with another role is a second row', (t) => {
  const dir = sandbox(t);
  ledger.addFromHook(step, { root: dir, now: NOW });
  ledger.addFromHook({ ...step, role: 'code-reviewer', agent: 'b1' }, { root: dir, now: NOW });
  assert.equal(rows(dir).length, 2);
});

test('hasHookRow is false before and true after the row', (t) => {
  const dir = sandbox(t);
  assert.equal(ledger.hasHookRow('07', 'qa', { root: dir, run: RUN }), false);
  ledger.addFromHook(step, { root: dir, now: NOW });
  assert.equal(ledger.hasHookRow('07', 'qa', { root: dir, run: RUN }), true);
  assert.equal(ledger.hasHookRow('07', 'code-reviewer', { root: dir, run: RUN }), false);
  assert.equal(ledger.hasHookRow('08', 'qa', { root: dir, run: RUN }), false);
});

test('a Lead row has kind lead, role lead, source hook and no step', (t) => {
  const dir = sandbox(t);
  const lead = { run: RUN, kind: 'lead', id: 'a1b2c3d4e5f6', role: 'lead', agent: 'lead-agent-1', ctx_end: 90000 };
  ledger.addFromHook(lead, { root: dir, now: NOW });
  const r = rows(dir);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'lead');
  assert.equal(r[0].role, 'lead');
  assert.equal(r[0].src, 'hook');
  assert.equal(r[0].agent, 'lead-agent-1');
});

test('the Lead row is keyed by agent id: the same agent twice is one row, another agent is a second', (t) => {
  const dir = sandbox(t);
  const lead = { run: RUN, kind: 'lead', id: 'a1b2c3d4e5f6', role: 'lead', agent: 'lead-agent-1', ctx_end: 90000 };
  ledger.addFromHook(lead, { root: dir, now: NOW });
  ledger.addFromHook({ ...lead, ctx_end: 95000 }, { root: dir, now: NOW + 1000 });
  assert.equal(rows(dir).length, 1);
  ledger.addFromHook({ ...lead, agent: 'lead-agent-2', id: 'ffffffffffff' }, { root: dir, now: NOW + 2000 });
  assert.equal(rows(dir).length, 2);
});

test('validateRecord accepts a hook step row and a lead row, and refuses an unknown source', () => {
  const base = { v: 1, run: RUN, kind: 'step', id: '07', role: 'qa', agent: 'a1', ctx_end: 10 };
  assert.equal(ledger.validateRecord({ ...base, src: 'hook' }).ok, true);
  assert.equal(ledger.validateRecord({ ...base, kind: 'lead', role: 'lead', id: 'abcdef123456', src: 'hook' }).ok, true);
  assert.equal(ledger.validateRecord({ ...base, src: 'bogus' }).ok, false);
});

test('add stays as the fallback: a notification row still writes', (t) => {
  const dir = sandbox(t);
  const code = ledger.main(['add', RUN, 'step', '08', 'qa', 'a1', '1000'], { now: NOW, root: dir });
  assert.ok(code === undefined || Array.isArray(code) || code.code === undefined || code.code === 0);
  const r = rows(dir);
  assert.equal(r.length, 1);
  assert.equal(r[0].src, 'notification');
});
