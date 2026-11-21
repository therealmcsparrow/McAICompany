// proj.M-SEC7: the ledger reader and the hook write refuse a hard-linked or linked ledger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ledger from './ledger.mjs';

const RUN = 'p20261120-nolink';
const row = { v: 1, run: RUN, kind: 'step', id: '07', role: 'qa', agent: 'a1', src: 'hook', ctx_end: 100 };

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ledger-nolink-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.company', 'ledger'), { recursive: true });
  return dir;
}
const file = (dir) => path.join(dir, '.company', 'ledger', `${RUN}.jsonl`);

test('hasHookRow is false for a hard-linked ledger that holds the row', (t) => {
  const dir = sandbox(t);
  const outside = path.join(dir, 'outside.jsonl');
  fs.writeFileSync(outside, `${JSON.stringify(row)}\n`);
  fs.linkSync(outside, file(dir));
  assert.equal(ledger.hasHookRow('07', 'qa', { root: dir, run: RUN }), false);
});

test('hasHookRow stays true for a plain ledger (control)', (t) => {
  const dir = sandbox(t);
  fs.writeFileSync(file(dir), `${JSON.stringify(row)}\n`);
  assert.equal(ledger.hasHookRow('07', 'qa', { root: dir, run: RUN }), true);
});

test('addFromHook does not append through a hard link', (t) => {
  const dir = sandbox(t);
  const outside = path.join(dir, 'outside.jsonl');
  fs.writeFileSync(outside, '');
  fs.linkSync(outside, file(dir));
  const r = ledger.addFromHook({ run: RUN, kind: 'step', id: '07', role: 'qa', agent: 'a1', ctx_end: 100 }, { root: dir });
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(outside, 'utf8'), '');
});

test('a symlinked .company/ledger is not read or written', (t) => {
  const dir = sandbox(t);
  const real = path.join(dir, 'elsewhere');
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, `${RUN}.jsonl`), `${JSON.stringify(row)}\n`);
  fs.rmSync(path.join(dir, '.company', 'ledger'), { recursive: true });
  try {
    fs.symlinkSync(real, path.join(dir, '.company', 'ledger'), 'junction');
  } catch (error) {
    t.skip(`cannot link: ${error.code}`);
    return;
  }
  assert.equal(ledger.hasHookRow('07', 'qa', { root: dir, run: RUN }), false);
  const r = ledger.addFromHook({ run: RUN, kind: 'step', id: '08', role: 'qa', agent: 'a2', ctx_end: 100 }, { root: dir });
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(path.join(real, `${RUN}.jsonl`), 'utf8').split('\n').filter(Boolean).length, 1);
});
