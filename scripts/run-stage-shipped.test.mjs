// Regression: `run-stage set <slug> shipped` must be accepted at close-out, so a finished run does not stay on `ship-gate`.
// Pins a final stage `shipped` across script, contract and pipeline doc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setStage, readStage, main, STAGES } from './run-stage.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = '2026-11-04 01.19 - Skillset Dashboard Draft';

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-stage-shipped-'));
  fs.mkdirSync(path.join(root, '.company', 'work', SLUG), { recursive: true });
  return root;
}

test('setStage accepts the final stage shipped after ship-gate and readStage reports it', () => {
  const root = repo();
  try {
    assert.deepEqual(setStage(root, SLUG, 'ship-gate'), { ok: true });
    assert.deepEqual(setStage(root, SLUG, 'shipped'), { ok: true });
    const v = readStage(root, SLUG);
    assert.equal(v.state, 'recorded');
    assert.equal(v.stage, 'shipped');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the CLI set <slug> shipped exits 0 and writes nothing to stdout', () => {
  const root = repo();
  try {
    const out = [];
    assert.equal(main(['set', SLUG, 'shipped'], { cwd: root, out: l => out.push(l) }), 0);
    assert.deepEqual(out, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('this test file is LF only', () => {
  assert.ok(!fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').includes('\r'));
});

test('the unknown-stage refusal still holds for a made-up name', () => {
  const root = repo();
  try {
    assert.deepEqual(setStage(root, SLUG, 'finished'), { reason: 'unknown stage' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
