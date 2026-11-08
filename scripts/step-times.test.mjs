import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const dir = import.meta.dirname;
const script = path.join(dir, 'step-times.mjs');
const runState = path.join(dir, 'run-state.mjs');
const repo = path.join(dir, '..');
const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const SESSION = '3f2a9c1e-7b4d-4e0a-9c55-0a1b2c3d4e5f';
const AGENT_ID = 'a1b2c3d4e5f60718';
const DIGEST = crypto.createHash('sha256').update(AGENT_ID).digest('hex').slice(0, 12);

function tmp(name) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), name));
  roots.push(d);
  return d;
}

function makeRoot({ withRun = true } = {}) {
  const root = tmp('step-times-');
  if (withRun) {
    const r = spawnSync(process.execPath, [runState, 'start', 'demo'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  return root;
}

function payload(extra = {}) {
  return JSON.stringify({
    session_id: SESSION,
    transcript_path: '/home/someone/secret/transcript.jsonl',
    cwd: '/home/someone/project',
    hook_event_name: 'SubagentStart',
    agent_id: AGENT_ID,
    agent_type: 'backend-engineer',
    last_assistant_message: 'LEAK-ME-NOT',
    ...extra,
  });
}

function hook(root, phase, input) {
  const home = tmp('step-times-home-');
  const started = Date.now();
  const r = spawnSync(process.execPath, [script, phase], {
    cwd: root, input, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, MCSPARROW_HOME: home, HOME: home, USERPROFILE: home },
  });
  return { code: r.status, out: r.stdout, err: r.stderr, ms: Date.now() - started };
}

const recordFile = (root) => path.join(root, '.company', 'work', 'demo', 'run-state.jsonl');
const subs = (root) => fs.readFileSync(recordFile(root), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.ev === 'sub');

test('start and stop payloads write two sub lines with the session', () => {
  const root = makeRoot();
  const a = hook(root, 'start', payload());
  const b = hook(root, 'stop', payload({ hook_event_name: 'SubagentStop' }));
  for (const r of [a, b]) { assert.equal(r.code, 0); assert.equal(r.out, ''); assert.equal(r.err, ''); }
  const s = subs(root);
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.phase), ['start', 'stop']);
  for (const x of s) {
    assert.equal(x.role, 'backend-engineer');
    assert.equal(x.id, DIGEST);
    assert.equal(x.session, SESSION);
  }
});

test('an agent id is never stored in clear and other payload fields never reach the record', () => {
  const root = makeRoot();
  hook(root, 'start', payload());
  const raw = fs.readFileSync(recordFile(root), 'utf8');
  for (const bad of [AGENT_ID, 'LEAK-ME-NOT', 'secret', '/home/someone', 'transcript']) assert.ok(!raw.includes(bad), bad);
});

test('unknown agent type becomes other; a bad session is left out', () => {
  const root = makeRoot();
  hook(root, 'start', payload({ agent_type: 'evil; rm -rf /', session_id: SESSION.toUpperCase() }));
  hook(root, 'start', payload({ agent_type: '__proto__', session_id: 5, agent_id: 'second' }));
  const s = subs(root);
  assert.equal(s.length, 2);
  for (const x of s) { assert.equal(x.role, 'other'); assert.ok(!('session' in x)); }
});

test('an inherited key in the payload is not read', () => {
  const root = makeRoot();
  const r = hook(root, 'start', '{"__proto__":{"agent_id":"x","agent_type":"qa"}}');
  assert.equal(r.code, 0);
  assert.equal(subs(root).length, 0);
});

test('a payload without an agent id writes nothing', () => {
  const root = makeRoot();
  const r = hook(root, 'start', JSON.stringify({ agent_type: 'qa', session_id: SESSION }));
  assert.equal(r.code, 0);
  assert.equal(subs(root).length, 0);
});

const hostile = {
  'empty stdin': '',
  'bad json': '{not json',
  'json array': '[1,2]',
  'json null': 'null',
  'stdin over 64 KiB': payload({ pad: 'x'.repeat(70 * 1024) }),
};
for (const [name, input] of Object.entries(hostile)) {
  test(`hostile input: ${name} exits 0, silent, in time, writes nothing`, () => {
    const root = makeRoot();
    const r = hook(root, 'start', input);
    assert.equal(r.code, 0);
    assert.equal(r.out, '');
    assert.equal(r.err, '');
    assert.ok(r.ms < 8000, `${r.ms} ms`);
    assert.equal(subs(root).length, 0);
  });
}

test('no active run exits 0 and silent', () => {
  const root = makeRoot({ withRun: false });
  const r = hook(root, 'start', payload());
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.equal(r.err, '');
  assert.ok(!fs.existsSync(path.join(root, '.company', 'work', 'demo')));
});

test('a bad phase argument exits 0 and silent', () => {
  const root = makeRoot();
  const r = hook(root, 'explode', payload());
  assert.equal(r.code, 0);
  assert.equal(r.out + r.err, '');
  assert.equal(subs(root).length, 0);
});

test('a failing run-state resolves quietly', async () => {
  const { handle } = await import('./step-times.mjs');
  const root = makeRoot();
  const fake = path.join(root, 'fail.mjs');
  fs.writeFileSync(fake, 'process.stderr.write("boom"); process.exit(1);');
  const started = Date.now();
  await handle(payload(), 'start', { runStatePath: fake, cwd: root });
  assert.ok(Date.now() - started < 8000);
});

test('a hanging run-state is cut before the deadline', async () => {
  const { handle } = await import('./step-times.mjs');
  const root = makeRoot();
  const fake = path.join(root, 'hang.mjs');
  fs.writeFileSync(fake, 'setTimeout(() => {}, 60000);');
  const started = Date.now();
  await handle(payload(), 'start', { runStatePath: fake, cwd: root });
  const ms = Date.now() - started;
  assert.ok(ms < 8000, `${ms} ms`);
});

test('the whole process exits 0 in time with a hanging run-state', async () => {
  const root = makeRoot();
  const wrapper = path.join(root, 'wrap.mjs');
  fs.writeFileSync(path.join(root, 'hang.mjs'), 'setTimeout(() => {}, 60000);');
  fs.writeFileSync(wrapper, [
    `import { main } from ${JSON.stringify(pathToFileURL(script).href)};`,
    `main('start', { runStatePath: ${JSON.stringify(path.join(root, 'hang.mjs'))} });`,
    '',
  ].join('\n'));
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const c = spawn(process.execPath, [wrapper], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    c.stdin.end(payload());
    c.on('exit', resolve);
  });
  assert.equal(code, 0);
  assert.ok(Date.now() - started < 8000);
});

test('source: no exit 2, no non-zero exit, no shell', () => {
  const src = fs.readFileSync(script, 'utf8');
  assert.ok(!/exit\(\s*2\s*\)/.test(src));
  assert.ok(!/exitCode\s*=\s*2/.test(src));
  assert.ok(!/exit\(\s*[1-9]/.test(src));
  assert.ok(!/exitCode\s*=\s*[1-9]/.test(src));
  assert.ok(!/\bexec\(|execSync|spawnSync|shell\s*:\s*true/.test(src));
  assert.ok(/execFile\(\s*process\.execPath/.test(src));
  assert.ok(!/OTEL_/.test(src));
  assert.ok(!src.includes('\r'));
});

test('hooks.json entries carry timeout 5 and only the plugin root variable', () => {
  const raw = fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8');
  assert.ok(!raw.includes('\r'));
  const cfg = JSON.parse(raw);
  assert.ok(Array.isArray(cfg.modules));
  assert.deepEqual(Object.keys(cfg.hooks).sort(), ['PreCompact', 'PreToolUse', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop']);
  for (const [event, phase] of [['SubagentStart', 'start'], ['SubagentStop', 'stop']]) {
    const groups = cfg.hooks[event].filter((g) => g.hooks.some((x) => x.command.includes('step-times.mjs')));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].hooks.length, 1);
    const h = groups[0].hooks[0];
    assert.equal(h.type, 'command');
    assert.equal(h.timeout, 5);
    assert.equal(h.command, `node "\${CLAUDE_PLUGIN_ROOT}/scripts/step-times.mjs" ${phase}`);
    assert.deepEqual(Object.keys(h).sort(), ['command', 'timeout', 'type']);
  }
});

const hasClaude = spawnSync('claude', ['--version'], { shell: process.platform === 'win32' }).status === 0;
test('claude plugin validate --strict passes', { skip: !hasClaude }, () => {
  const r = spawnSync('claude', ['plugin', 'validate', '--strict', '.'], { cwd: repo, encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
