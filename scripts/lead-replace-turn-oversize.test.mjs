import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

// R-13 (Step 39): a Lead hook payload over 64 KiB must still leave a turn mark that makes lead-replace refuse to type (fail closed).
// Runs the real `lead-handover.mjs turn` hook (stdin path), then typeInto against the product folder.

const here = path.dirname(fileURLToPath(import.meta.url));
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const FROZEN = 'abcdef012345';
const PROMPT = 'aico lead hand-over: run lead-handover read first.';

function product() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-oversize-'));
  tmps.push(root);
  const dir = path.join(root, '.company', 'work', 'demo-run');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now() - 60000), ev: 'start' })}\n`);
  return { root, dir };
}

const payload = (name, big) => JSON.stringify({
  hook_event_name: name,
  session_id: 'lead-session-1',
  ...(name === 'UserPromptSubmit' ? { prompt: big } : { tool_name: 'Bash', tool_input: { command: big } }),
});

for (const name of ['UserPromptSubmit', 'PreToolUse']) {
  test(`oversize (>64 KiB) ${name} payload -> lead-replace types nothing`, async () => {
    const p = product();
    const text = payload(name, 'x'.repeat(70 * 1024));
    assert.ok(Buffer.byteLength(text) > 64 * 1024);
    const h = spawnSync(process.execPath, [path.join(here, 'lead-handover.mjs'), 'turn'], { cwd: p.root, input: text, encoding: 'utf8', timeout: 20000 });
    assert.equal(h.status, 0);

    const { typeInto } = await import(pathToFileURL(path.join(here, 'lead-replace.mjs')).href);
    // The Stop reading the wait accepted, well before the oversize turn began.
    const stopAt = Math.floor((Date.now() - 30000) / 1000) * 1000;
    fs.writeFileSync(path.join(p.dir, 'lead-context.json'),
      `${JSON.stringify({ v: 1, session: FROZEN, ctx: 1000, peak: 170000, at: iso(stopAt), ttl: null })}\n`);
    const calls = [];
    const t = { t: Date.now() };
    const result = await typeInto(PROMPT, {
      platform: 'win32', dir: p.dir, session: FROZEN, claudePid: 4242,
      run: async (argv, input) => { calls.push(input.toString('utf8')); return { status: 0 }; },
      now: () => t.t, sleep: async (ms) => { t.t += ms; },
      accepted: { session: FROZEN, at: iso(stopAt) },
    });
    assert.deepEqual(calls, [], 'nothing may be typed into a turn whose hook payload was oversize');
    assert.match(result, /^failed: /);
  });
}
