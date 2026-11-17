// Tests for scripts/hook-check.mjs.
// Interface these tests assume (the check builds to it):
//   node hook-check.mjs ci|setup --root <plugin root>   exit 0 ok; exit 1 and one line per problem naming the file, mod or rule ID
//   node hook-check.mjs denies --session <key> --json    run from the project dir, MCSPARROW_HOME set; prints a JSON array
//   hooks/pins.json: flat map { "<posix path relative to the plugin root>": "<sha256 hex>" } over the pinned set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.join(import.meta.dirname, 'hook-check.mjs');
const made = [];
function tmp(name = 'hook-check-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  made.push(dir);
  return dir;
}
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function put(root, rel, content) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

const PURE_RULE = 'export function judge(event, snapshot) { return { v: \'allow\' }; }\n';
const GUARD = {
  v: 1, id: 'dotenv', kind: 'guard', title: 'dotenv deny', owner: 'backend-engineer', sessions: 'all',
  events: ['PreToolUse'], rules: ['dotenv.M-SEC1'], fail: 'closed', switch: null, lock: true, upstream: null,
};
const SAVER = {
  v: 1, id: 'cache-tax', kind: 'saver', title: 'Cache clock', owner: 'backend-engineer', sessions: 'lead',
  events: [], rules: [], fail: 'open', switch: 'mods.cache_tax.enabled', lock: false, upstream: null,
};
const ROW = {
  event: 'PreToolUse', matcher: ['Bash', 'PowerShell'], rule: 'dotenv.M-SEC1', module: 'dotenv.mjs', export: 'judge',
  fail: 'closed', timeoutMs: 300, message: 'aico guard dotenv.M-SEC1: no .env reads',
};
const LIBS = ['event', 'snapshot', 'cap-effects', 'paths', 'rule-id', 'rule-runner', 'deny-log'];

// Pinned set of mod-hook v1 step 2: computed from what is on disk, one hash per file.
function pinnedSet(root) {
  const out = ['scripts/hook-host.mjs', 'hooks/rules.json', 'hooks/hooks.json', 'hooks/schema/hook-fields.json', 'company/model-floor.json'];
  for (const [dir, ext] of [['hooks/lib', '.mjs'], ['hooks/rules', '.mjs'], ['hooks/manifests', '.json']]) {
    const d = path.join(root, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).sort()) if (f.endsWith(ext)) out.push(`${dir}/${f}`);
  }
  return out.filter((rel) => fs.existsSync(path.join(root, rel)));
}
function repin(root) {
  const pins = {};
  for (const rel of pinnedSet(root)) pins[rel] = sha(fs.readFileSync(path.join(root, rel)));
  put(root, 'hooks/pins.json', JSON.stringify(pins, null, 2));
}

// A valid minimal plugin root: one guard (dotenv), one saver mod (cache-tax), shared shell, all pinned.
function makeRoot(mutate) {
  const root = tmp('hook-check-root-');
  put(root, 'scripts/hook-host.mjs', '// host\n');
  for (const l of LIBS) put(root, `hooks/lib/${l}.mjs`, `export const ${l.replace(/-/g, '_')} = 1;\n`);
  put(root, 'hooks/rules/dotenv.mjs', PURE_RULE);
  put(root, 'hooks/rules.json', JSON.stringify([ROW], null, 2));
  put(root, 'hooks/hooks.json', JSON.stringify({
    modules: ['./register.tsx'],
    hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/hook-host.mjs" pre', timeout: 10, onFailure: 'block' }] }] },
  }, null, 2));
  put(root, 'hooks/schema/hook-fields.json', '{"v":1}\n');
  put(root, 'company/model-floor.json', '{"v":1}\n');
  put(root, 'hooks/manifests/dotenv.json', JSON.stringify(GUARD, null, 2));
  put(root, 'hooks/manifests/cache-tax.json', JSON.stringify(SAVER, null, 2));
  put(root, 'hooks/fixtures/dotenv.M-SEC1/pass-1.json', '{"v":1}\n');
  put(root, 'hooks/fixtures/dotenv.M-SEC1/block-1.json', '{"v":1}\n');
  put(root, 'mods/cache-tax.tsx', 'export function registerCacheTax() {}\n');
  put(root, 'mods/shared/shell.ts', 'export function registerShell() {}\n');
  put(root, 'hooks/register.tsx',
    "import { registerCacheTax } from '../mods/cache-tax'\nimport { registerShell } from '../mods/shared/shell'\nexport const register = on => { registerShell(on); registerCacheTax(on) }\n");
  if (mutate) mutate(root);
  repin(root);
  return root;
}
const json = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

function run(cmd, root, extra = []) {
  const r = spawnSync(process.execPath, [script, cmd, '--root', root, ...extra], { encoding: 'utf8', timeout: 30000 });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
function expectFail(cmd, root, needle) {
  const r = run(cmd, root);
  assert.equal(r.code, 1, `${cmd} must exit 1, got ${r.code}: ${r.out}`);
  assert.ok(r.out.includes(needle), `${cmd} output must name "${needle}", got: ${r.out}`);
  return r;
}

test('baseline root passes ci and setup (control)', () => {
  const root = makeRoot();
  for (const cmd of ['ci', 'setup']) {
    const r = run(cmd, root);
    assert.equal(r.code, 0, `${cmd}: ${r.out}`);
  }
});

// every mod has a manifest; mapping mods/<id>.ts(x) -> hooks/manifests/<id>.json.
test('AC2: mods/<id>.tsx imported by register without a manifest fails, naming the mod', () => {
  const root = makeRoot((r) => {
    put(r, 'mods/extra.tsx', 'export function registerExtra() {}\n');
    put(r, 'hooks/register.tsx', fs.readFileSync(path.join(r, 'hooks/register.tsx'), 'utf8')
      + "import { registerExtra } from '../mods/extra'\n");
  });
  expectFail('ci', root, 'extra');
});

test('AC2: mods/<id>.ts without a manifest fails too', () => {
  const root = makeRoot((r) => {
    put(r, 'mods/gate-x.ts', 'export function registerGateX() {}\n');
    put(r, 'hooks/register.tsx', fs.readFileSync(path.join(r, 'hooks/register.tsx'), 'utf8')
      + "import { registerGateX } from '../mods/gate-x'\n");
  });
  expectFail('ci', root, 'gate-x');
});

test('AC2: mods/shared/shell.ts registered in register.tsx passes with no manifest', () => {
  const root = makeRoot();
  assert.ok(!fs.existsSync(path.join(root, 'hooks/manifests/shell.json')));
  assert.equal(run('ci', root).code, 0);
});

test('AC2: mods/lib/ code needs no manifest', () => {
  const root = makeRoot((r) => {
    put(r, 'mods/lib/savings.mjs', 'export const GUARDS_SINCE = "0.40.0";\n');
    put(r, 'hooks/register.tsx', fs.readFileSync(path.join(r, 'hooks/register.tsx'), 'utf8')
      + "import { GUARDS_SINCE } from '../mods/lib/savings'\n");
  });
  assert.equal(run('ci', root).code, 0);
});

test('AC2: an invalid manifest (unknown key) fails, naming it', () => {
  const root = makeRoot((r) => {
    const m = json(r, 'hooks/manifests/cache-tax.json');
    m.extra = true;
    put(r, 'hooks/manifests/cache-tax.json', JSON.stringify(m));
  });
  expectFail('ci', root, 'cache-tax');
});

test('AC2: a manifest whose id differs from its file name fails', () => {
  const root = makeRoot((r) => {
    const m = json(r, 'hooks/manifests/cache-tax.json');
    m.id = 'other';
    put(r, 'hooks/manifests/cache-tax.json', JSON.stringify(m));
  });
  expectFail('ci', root, 'cache-tax');
});

test('AC2: a rule module with no rule-table row and no manifest fails, naming it', () => {
  const root = makeRoot((r) => put(r, 'hooks/rules/orphan.mjs', PURE_RULE));
  expectFail('ci', root, 'orphan');
});

test('AC2: a rule-table row whose rule ID is in no manifest fails, naming the rule ID', () => {
  const root = makeRoot((r) => {
    const rows = json(r, 'hooks/rules.json');
    rows.push({ ...ROW, rule: 'model-floor.M1', module: 'dotenv.mjs' });
    put(r, 'hooks/rules.json', JSON.stringify(rows));
  });
  expectFail('ci', root, 'model-floor.M1');
});

test('AC2: a manifest event that nothing wires fails', () => {
  const root = makeRoot((r) => {
    const m = json(r, 'hooks/manifests/dotenv.json');
    m.events = ['SubagentStop'];
    put(r, 'hooks/manifests/dotenv.json', JSON.stringify(m));
  });
  expectFail('ci', root, 'dotenv');
});

// a guard missing, off (not a locked guard) or hash-mismatched stops ci and setup.
test('AC4: a guard rule with no block fixture fails, naming the rule ID', () => {
  const root = makeRoot((r) => fs.rmSync(path.join(r, 'hooks/fixtures/dotenv.M-SEC1/block-1.json')));
  expectFail('ci', root, 'dotenv.M-SEC1');
});

test('AC4: a guard rule with no pass fixture fails, naming the rule ID', () => {
  const root = makeRoot((r) => fs.rmSync(path.join(r, 'hooks/fixtures/dotenv.M-SEC1/pass-1.json')));
  expectFail('ci', root, 'dotenv.M-SEC1');
});

test('AC14: a missing guard (manifest deleted) stops setup, naming the guard', () => {
  const root = makeRoot((r) => fs.rmSync(path.join(r, 'hooks/manifests/dotenv.json')));
  expectFail('setup', root, 'dotenv');
});

test('AC14: a missing guard (rule module deleted) stops setup, naming the guard', () => {
  const root = makeRoot((r) => fs.rmSync(path.join(r, 'hooks/rules/dotenv.mjs')));
  expectFail('setup', root, 'dotenv');
});

test('AC14: an off guard (switch set, lock false) stops setup, naming the guard', () => {
  const root = makeRoot((r) => {
    const m = json(r, 'hooks/manifests/dotenv.json');
    m.switch = 'mods.git_add.enabled';
    m.lock = false;
    put(r, 'hooks/manifests/dotenv.json', JSON.stringify(m));
  });
  expectFail('setup', root, 'dotenv');
});

test('AC14: a guard whose manifest fail differs from its table row stops setup', () => {
  const root = makeRoot((r) => {
    const rows = json(r, 'hooks/rules.json');
    rows[0].fail = 'open';
    put(r, 'hooks/rules.json', JSON.stringify(rows));
  });
  expectFail('setup', root, 'dotenv');
});

test('AC14: a hash-mismatched guard rule module stops setup, naming the file', () => {
  const root = makeRoot();
  fs.appendFileSync(path.join(root, 'hooks/rules/dotenv.mjs'), '// tampered\n');
  expectFail('setup', root, 'hooks/rules/dotenv.mjs');
});

// one pins mismatch per file of the pinned set; the output names that file.
const PINNED_SAMPLE = [
  'scripts/hook-host.mjs', ...LIBS.map((l) => `hooks/lib/${l}.mjs`), 'hooks/rules/dotenv.mjs',
  'hooks/manifests/dotenv.json', 'hooks/manifests/cache-tax.json', 'hooks/rules.json', 'hooks/hooks.json',
  'hooks/schema/hook-fields.json', 'company/model-floor.json',
];
for (const rel of PINNED_SAMPLE) {
  test(`AC19: changed ${rel} -> pins-mismatch naming it`, () => {
    const root = makeRoot();
    const f = path.join(root, rel);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8') + (rel.endsWith('.json') ? '\n' : '\n// x\n'));
    const r = run('ci', root);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes('pins-mismatch'), r.out);
    assert.ok(r.out.includes(rel), `must name ${rel}: ${r.out}`);
  });
}

test('AC19: a pinned file missing from disk -> pins-mismatch naming it', () => {
  const root = makeRoot();
  fs.rmSync(path.join(root, 'hooks/lib/deny-log.mjs'));
  const r = run('ci', root);
  assert.equal(r.code, 1, r.out);
  assert.ok(r.out.includes('pins-mismatch') && r.out.includes('hooks/lib/deny-log.mjs'), r.out);
});

test('AC19: an extra file in a pinned folder -> pins-mismatch naming it', () => {
  for (const rel of ['hooks/lib/extra.mjs', 'hooks/rules/extra.mjs', 'hooks/manifests/extra.json']) {
    const root = makeRoot();
    put(root, rel, rel.endsWith('.json') ? '{}\n' : PURE_RULE);
    const r = run('ci', root);
    assert.equal(r.code, 1, `${rel}: ${r.out}`);
    assert.ok(r.out.includes('pins-mismatch') && r.out.includes(rel), `${rel}: ${r.out}`);
  }
});

test('AC19: a missing hooks/pins.json fails', () => {
  const root = makeRoot();
  fs.rmSync(path.join(root, 'hooks/pins.json'));
  const r = run('ci', root);
  assert.equal(r.code, 1, r.out);
  assert.ok(r.out.includes('pins'), r.out);
});

test('AC19: two changed files give one line each', () => {
  const root = makeRoot();
  fs.appendFileSync(path.join(root, 'scripts/hook-host.mjs'), '// a\n');
  fs.appendFileSync(path.join(root, 'hooks/lib/paths.mjs'), '// b\n');
  const r = run('ci', root);
  assert.equal(r.code, 1);
  const lines = r.out.split(/\r?\n/);
  assert.equal(lines.filter((l) => l.includes('scripts/hook-host.mjs')).length, 1, r.out);
  assert.equal(lines.filter((l) => l.includes('hooks/lib/paths.mjs')).length, 1, r.out);
});

// a rule must be pure.
const IMPURE = [
  ['fs', "import fs from 'node:fs';\nexport function judge() { return { v: 'allow' }; }\n"],
  ['fs (bare)', "import { readFileSync } from 'fs';\nexport function judge() { return { v: 'allow' }; }\n"],
  ['net', "import net from 'node:net';\nexport function judge() { return { v: 'allow' }; }\n"],
  ['child_process', "import { spawnSync } from 'node:child_process';\nexport function judge() { return { v: 'allow' }; }\n"],
  ['process.env', "export function judge() { return process.env.X ? { v: 'deny' } : { v: 'allow' }; }\n"],
  ['require', "const fs = require('fs');\nexport function judge() { return { v: 'allow' }; }\n"],
  ['dynamic import', "export async function judge() { await import('node:fs'); return { v: 'allow' }; }\n"],
  ['fetch', "export function judge() { fetch('http://x'); return { v: 'allow' }; }\n"],
];
for (const [name, src] of IMPURE) {
  test(`AC21: rule importing or reading ${name} fails the purity scan, naming the module`, () => {
    const root = makeRoot((r) => put(r, 'hooks/rules/dotenv.mjs', src));
    const r = run('ci', root);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes('hooks/rules/dotenv.mjs') || r.out.includes('dotenv.mjs'), r.out);
    assert.ok(!r.out.includes('pins-mismatch'), `pins are rewritten, only purity may fail: ${r.out}`);
  });
}

test('AC21: the shared path module is scanned too', () => {
  const root = makeRoot((r) => put(r, 'hooks/lib/paths.mjs', "import fs from 'node:fs';\nexport const x = fs;\n"));
  const r = run('ci', root);
  assert.equal(r.code, 1, r.out);
  assert.ok(r.out.includes('paths.mjs'), r.out);
});

test('AC21: a pure rule passes', () => {
  assert.equal(run('ci', makeRoot()).code, 0);
});

// denies --session <key> --json: newest 5 rows of that session, read-only, empty log -> [].
function denyEnv() {
  const home = tmp('hook-check-home-');
  const project = tmp('hook-check-proj-');
  fs.mkdirSync(path.join(project, '.company'));
  const root12 = sha(fs.realpathSync(project)).slice(0, 12);
  const dir = path.join(home, 'hook-snapshots', root12);
  fs.mkdirSync(dir, { recursive: true });
  return { home, project, log: path.join(dir, 'denies.jsonl') };
}
function denies(env, session) {
  const r = spawnSync(process.execPath, [script, 'denies', '--session', session, '--json'], {
    cwd: env.project, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, MCSPARROW_HOME: env.home },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const row = (n, session, rule = 'cap.M1') => JSON.stringify({ v: 1, at: `2026-11-14T10:00:${String(n).padStart(2, '0')}Z`, rule, kind: 'deny', session, agent: null });

test('denies: an empty or missing log prints []', () => {
  const env = denyEnv();
  const a = denies(env, 's1');
  assert.equal(a.code, 0, a.err);
  assert.deepEqual(JSON.parse(a.out), []);
  fs.writeFileSync(env.log, '');
  assert.deepEqual(JSON.parse(denies(env, 's1').out), []);
});

test('denies: newest 5 rows of that session only', () => {
  const env = denyEnv();
  const lines = [];
  for (let i = 0; i < 8; i++) lines.push(row(i, 's1'));
  lines.splice(3, 0, row(30, 's2', 'dotenv.M-SEC1'), row(31, 's2', 'dotenv.M-SEC1'));
  fs.writeFileSync(env.log, lines.join('\n') + '\n');
  const r = denies(env, 's1');
  assert.equal(r.code, 0, r.err);
  const rows = JSON.parse(r.out);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((x) => x.session === 's1'));
  const ats = rows.map((x) => x.at).sort();
  assert.deepEqual(ats, [3, 4, 5, 6, 7].map((i) => `2026-11-14T10:00:0${i}Z`));
});

test('denies: a session with no rows prints []', () => {
  const env = denyEnv();
  fs.writeFileSync(env.log, row(1, 's1') + '\n');
  assert.deepEqual(JSON.parse(denies(env, 'other').out), []);
});

test('denies: read-only, the log file is byte-identical afterwards', () => {
  const env = denyEnv();
  const body = [row(1, 's1'), 'not json', row(2, 's1')].join('\n') + '\n';
  fs.writeFileSync(env.log, body);
  const before = fs.statSync(env.log).mtimeMs;
  const r = denies(env, 's1');
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(env.log, 'utf8'), body);
  assert.equal(fs.statSync(env.log).mtimeMs, before);
  assert.equal(JSON.parse(r.out).length, 2, 'a malformed line is skipped, not fatal');
});

test('denies: does not create the log or folder when absent', () => {
  const env = denyEnv();
  fs.rmSync(path.dirname(env.log), { recursive: true });
  const r = denies(env, 's1');
  assert.deepEqual(JSON.parse(r.out), []);
  assert.ok(!fs.existsSync(path.dirname(env.log)));
});
