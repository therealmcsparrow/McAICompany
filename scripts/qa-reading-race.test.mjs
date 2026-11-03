import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { measure, start } from './lead-handover.mjs';

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-race-'));
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const dir = path.join(root, '.company', 'work', 'demo-run');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'projects', 'p1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now() - 60000), ev: 'start' })}\n`);
  return { base, root, claudeDir, dir, file: path.join(dir, 'lead-context.json') };
}

function transcript(fx, total) {
  const file = path.join(fx.claudeDir, 'projects', 'p1', 'session.jsonl');
  const usage = { input_tokens: 1000, cache_read_input_tokens: total - 1500, output_tokens: 500 };
  const row = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage } };
  fs.writeFileSync(file, `${JSON.stringify(row)}\n`);
  return file;
}

const stopBody = (file) => JSON.stringify({ hook_event_name: 'Stop', transcript_path: file });
const startBody = JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'sess-b' });

// Runs `inner` once, in the gap between the outer writer reading the old reading and writing its own:
// the moment the outer writer opens its temp file.
function interleave(inner, outer) {
  const real = fs.openSync;
  let fired = false;
  fs.openSync = function patched(p, ...rest) {
    if (!fired && typeof p === 'string' && path.basename(p).startsWith('.lead-context.json.')) {
      fired = true;
      fs.openSync = real;
      inner();
    }
    return real.call(this, p, ...rest);
  };
  try { outer(); } finally { fs.openSync = real; }
  assert.ok(fired, 'the outer writer reached its write');
}

test('start between a measure read and write keeps the newer peak', () => {
  const fx = fixture();
  try {
    const opts = { root: fx.root, claudeDir: fx.claudeDir, env: {} };
    measure(stopBody(transcript(fx, 10000)), opts);
    interleave(
      () => measure(stopBody(transcript(fx, 70000)), opts),
      () => start(startBody, opts),
    );
    assert.equal(JSON.parse(fs.readFileSync(fx.file, 'utf8')).peak, 70000);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('measure between another measure read and write keeps the newer peak', () => {
  const fx = fixture();
  try {
    const opts = { root: fx.root, claudeDir: fx.claudeDir, env: {} };
    measure(stopBody(transcript(fx, 10000)), opts);
    interleave(
      () => measure(stopBody(transcript(fx, 70000)), opts),
      () => measure(stopBody(transcript(fx, 30000)), opts),
    );
    assert.equal(JSON.parse(fs.readFileSync(fx.file, 'utf8')).peak, 70000);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});
