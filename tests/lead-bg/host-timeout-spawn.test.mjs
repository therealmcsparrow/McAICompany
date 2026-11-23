// Bug P20261119.000001 (b): hook-host self-exits at 3.8 s with deny "aico guard host: timeout" while the hook allows 10 s;
// under CPU load a slow stdin/pin read hard-blocks an Agent spawn. A slow (not hostile) host must not deny a spawn
// that has no verdict yet. Module: scripts/hook-host.mjs (SELF_EXIT_MS), wiring hooks/hooks.json (timeout 10, onFailure block).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'hook-host.mjs');

test('a stalled stdin of 4.5 s on an Agent spawn is not denied with "host: timeout"', async () => {
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'aico:qa', prompt: 'x' }, cwd: process.cwd(), session_id: 's' });
  const child = spawn(process.execPath, [HOST], { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise((r) => child.on('close', r));
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stdin.write(payload);
  await new Promise((r) => setTimeout(r, 4500)); // simulated CPU stall, still under the 10 s hook timeout
  child.stdin.end();
  await closed;
  assert.doesNotMatch(out, /host: timeout/, out);
});
