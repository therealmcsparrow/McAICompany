// Round 2 fixes for lead-relay v1: R-1 `preset` fails closed (oversize payload, stalled stdin), R-2 `open` reads only inside the repo.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'lead-relay.mjs');
const ID = 'P20261117.000001';
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const mk = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); tmps.push(d); return d; };

function fixture() {
  const root = mk('confine-');
  const dir = path.join(root, '.company', 'work', ID, '01-feature');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'work', ID, '00-project.md'), 'Demo\n');
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), ev: 'start' })}\n`);
  return { root, dir };
}
const Q = JSON.stringify([{ q: 'Which way?', header: 'Way', multi: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }]);
const open = (fx, file) => spawnSync(process.execPath, [SCRIPT, 'open', `${ID}/01-feature`, 'ask', file], { cwd: fx.root, encoding: 'utf8', timeout: 20000 });
const formsExist = (fx) => fs.existsSync(path.join(fx.dir, 'forms.jsonl'));

const denied = (out) => {
  const o = JSON.parse(out);
  assert.equal(o.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(o.hookSpecificOutput.permissionDecision, 'deny');
};

describe('R-2: open confines the questions file to the repo', () => {
  test('a file inside the repo is read', () => {
    const fx = fixture();
    const f = path.join(fx.root, 'q.json');
    fs.writeFileSync(f, Q);
    assert.equal(open(fx, f).status, 0);
    assert.equal(open(fx, 'q.json').status, 1);
  });

  test('an absolute path outside the repo is refused, nothing recorded', () => {
    const fx = fixture();
    const outside = path.join(mk('outside-'), 'q.json');
    fs.writeFileSync(outside, Q);
    const r = open(fx, outside);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /refused/);
    assert.ok(!formsExist(fx));
  });

  test('a .. escape is refused', () => {
    const fx = fixture();
    const outside = mk('outside-');
    fs.writeFileSync(path.join(outside, 'q.json'), Q);
    const rel = path.relative(fx.root, path.join(outside, 'q.json'));
    assert.ok(rel.startsWith('..'));
    assert.equal(open(fx, rel).status, 1);
    assert.ok(!formsExist(fx));
  });

  test('a symlink inside the repo that points outside is refused', (t) => {
    const fx = fixture();
    const outside = path.join(mk('outside-'), 'q.json');
    fs.writeFileSync(outside, Q);
    const link = path.join(fx.root, 'link.json');
    try { fs.symlinkSync(outside, link); } catch { t.skip('no symlink right'); return; }
    assert.equal(open(fx, link).status, 1);
    assert.ok(!formsExist(fx));
  });
});

describe('R-1: preset fails closed', () => {
  test('an oversize payload is denied', () => {
    const big = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [], answers: { a: 'x'.repeat(70 * 1024) } } });
    const r = spawnSync(process.execPath, [SCRIPT, 'preset'], { input: big, encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 0);
    denied(r.stdout);
  });

  test('stdin that never ends is denied by the self-exit', async () => {
    const out = await new Promise((resolve) => {
      const c = spawn(process.execPath, [SCRIPT, 'preset'], { stdio: ['pipe', 'pipe', 'ignore'] });
      let s = '';
      c.stdout.on('data', (d) => { s += d; });
      c.stdin.write('{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_input":{"answers":');
      c.on('close', (code) => resolve({ code, s }));
    });
    assert.equal(out.code, 0);
    denied(out.s);
  });

  test('a normal call without answers still gets no output', () => {
    const ok = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [] } });
    const r = spawnSync(process.execPath, [SCRIPT, 'preset'], { input: ok, encoding: 'utf8', timeout: 20000 });
    assert.deepEqual([r.status, r.stdout], [0, '']);
  });
});
