// Tests: the SubagentStart/Stop hook records a `sub` event against the active v3 run.
// run-state is a stub that reports the active slug and logs its calls, so the test isolates step-times.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handle } from './step-times.mjs';

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const ID = 'P20261109.000009';
const AGENT = 'a1b2c3d4e5f60718';
const payload = JSON.stringify({ session_id: '3f2a9c1e-7b4d-4e0a-9c55-0a1b2c3d4e5f', hook_event_name: 'SubagentStart', agent_id: AGENT, agent_type: 'backend-engineer' });

const STUB = `import fs from 'node:fs';
import path from 'node:path';
const here = import.meta.dirname;
const a = process.argv.slice(2);
if (a[0] === 'active') process.stdout.write(JSON.stringify({ slug: fs.readFileSync(path.join(here, 'slug.txt'), 'utf8') }));
else fs.appendFileSync(path.join(here, 'calls.jsonl'), JSON.stringify(a) + '\\n');
`;

// A stand-in run-state: `active --json` prints the slug in slug.txt, any other call is appended to calls.jsonl.
function stub(slug) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'st-v3-'));
  roots.push(d);
  fs.writeFileSync(path.join(d, 'slug.txt'), slug);
  fs.writeFileSync(path.join(d, 'run-state.mjs'), STUB);
  const calls = () => {
    const f = path.join(d, 'calls.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  return { file: path.join(d, 'run-state.mjs'), calls, cwd: d };
}

async function run(slug, phase = 'start') {
  const s = stub(slug);
  await handle(payload, phase, { runStatePath: s.file, cwd: s.cwd });
  return s.calls();
}

test('an active v3 run gets the sub event under its slug', async () => {
  for (const phase of ['start', 'stop']) {
    const calls = await run(`${ID}/01-feature`, phase);
    assert.equal(calls.length, 1, phase);
    assert.deepEqual(calls[0].slice(0, 3), ['sub', `${ID}/01-feature`, phase]);
    assert.equal(calls[0][3], 'backend-engineer');
    assert.match(calls[0][4], /^[0-9a-f]{12}$/);
  }
});

test('a v2 slug is still recorded exactly as before', async () => {
  const calls = await run(`${ID}-10.00.00`);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ['sub', `${ID}-10.00.00`, 'start']);
});

test('a slug that is not a run slug is never passed on', async () => {
  assert.equal((await run(`${ID}/01-feature`)).length, 1);
  for (const bad of [ID, `${ID}/01-feature/x`, `${ID}/../x`, `${ID}/1-feature`, '../x', `${ID}\\01-feature`, `${ID}//01-feature`]) {
    assert.deepEqual(await run(bad), [], bad);
  }
});
