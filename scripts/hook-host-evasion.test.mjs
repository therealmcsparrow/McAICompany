// Tests: evasion cases the shipped guards must deny through the real host, run against a copy of the plugin tree
// whose pins are rewritten (so a stale pin file cannot mask the verdict). The new block fixtures are replayed
// here, and the cases a fixture cannot hold (oversize or plugin-root cwd) are built in code.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fwd = (p) => p.split(String.fromCharCode(92)).join('/');
const FIXTURE_FILES = [
  ['dotenv.M-SEC1', 'block-bash-glob-sequence-brace.json'],
  ['dotenv.M-SEC1', 'block-bash-glob-variable-brace.json'],
  ['dotenv.M-SEC1', 'block-ps-get-content-star.json'],
  ['dotenv.M-SEC1', 'block-ps-get-content-star-local.json'],
  ['self-protect.M-SEC1', 'block-bash-settings-glob-question.json'],
  ['self-protect.M-SEC1', 'block-bash-settings-glob-posix-class.json'],
  ['git-add.M-SEC1', 'block-ps-push-location-add.json'],
];

let tmp, home, project, plugin;

function host(payload, cwd) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: plugin, MCSPARROW_HOME: home, HOME: tmp, USERPROFILE: tmp };
  delete env.AICO_GUARDS;
  const r = spawnSync(process.execPath, [path.join(plugin, 'scripts', 'hook-host.mjs')], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'evasion', transcript_path: 'evasion.jsonl', permission_mode: 'default', cwd: fwd(cwd), ...payload }),
    cwd, encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024, env,
  });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { /* left null */ }
  const d = json?.hookSpecificOutput;
  return { code: r.status, err: r.stderr, out: r.stdout, reason: d?.permissionDecision === 'deny' ? d.permissionDecisionReason : null };
}
const bash = (command, cwd = project) => host({ tool_name: 'Bash', tool_input: { command } }, cwd);

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aico-evasion-'));
  home = path.join(tmp, 'mcsparrow');
  project = path.join(tmp, 'proj');
  plugin = path.join(tmp, 'plugin');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  for (const d of ['hooks', 'scripts', 'mods', 'skills', 'docs', 'company']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(plugin, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(plugin, 'package.json'));
  const w = spawnSync(process.execPath, [path.join(plugin, 'scripts', 'hook-pins.mjs'), 'write'], { encoding: 'utf8' });
  assert.equal(w.status, 0, w.stderr);
  fs.writeFileSync(path.join(project, 'README.md'), '# demo\n');
  const s = host({ hook_event_name: 'SessionStart', source: 'startup' }, project);
  assert.equal(s.code, 0, s.err);
  const sp = host({ hook_event_name: 'SessionStart', source: 'startup' }, plugin);
  assert.equal(sp.code, 0, sp.err);
});
after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

describe('evasion block fixtures through the real host', () => {
  for (const [dir, name] of FIXTURE_FILES) {
    test(`${dir}/${name} is under 64 KiB and denies`, () => {
      const file = path.join(ROOT, 'hooks', 'fixtures', dir, name);
      assert.ok(fs.statSync(file).size < 65536);
      const { _synthetic, ...raw } = JSON.parse(fs.readFileSync(file, 'utf8'));
      const r = host({ ...raw, cwd: fwd(project) }, project);
      assert.equal(r.code, 0, r.err);
      assert.ok(r.reason, `expected a deny, got ${r.out}`);
      assert.ok(r.reason.startsWith(`aico guard ${dir}:`), `denied by another rule: ${r.reason}`);
    });
  }
});

describe('long command lists and long targets through the real host', () => {
  const junk = (n) => Array.from({ length: n }, (_, i) => `j${i}`).join(' ');

  test('64+ tokens with cwd in the plugin root: a redirect into hooks/rules denies', () => {
    const r = bash(`echo ${junk(70)} x >> hooks/rules/x.mjs`, plugin);
    assert.equal(r.code, 0, r.err);
    assert.match(r.reason ?? '', /^aico guard self-protect\.M-SEC1:/, r.out);
  });

  test('64+ tokens with cwd in the plugin root: a cp into hooks/rules denies', () => {
    const r = bash(`echo ${junk(70)}; cp /etc/hosts hooks/rules/dotenv.mjs`, plugin);
    assert.match(r.reason ?? '', /^aico guard self-protect\.M-SEC1:/, r.out);
  });

  test('the same plugin-root write with few tokens denies', () => {
    const r = bash('echo x >> hooks/rules/x.mjs', plugin);
    assert.match(r.reason ?? '', /^aico guard self-protect\.M-SEC1:/, r.out);
  });

  test('64+ tokens with cwd in the project: a settings write denies', () => {
    const r = bash(`echo ${junk(70)} x >> .claude/settings.json`);
    assert.match(r.reason ?? '', /^aico guard self-protect\.M-SEC1:/, r.out);
  });

  test('a target over 4096 chars that resolves to .claude/settings.json denies', () => {
    const pad = 'a=b/../'.repeat(600);
    const command = `echo y >> ${pad}${pad}.claude/settings.json`;
    assert.ok(command.length > 4096);
    const r = bash(command);
    assert.equal(r.code, 0, r.err);
    assert.match(r.reason ?? '', /^aico guard self-protect\.M-SEC1:/, r.out.slice(0, 200));
  });

  test('a target over 4096 chars that resolves into the run folder guard record denies', () => {
    const pad = 'a=b/../'.repeat(600);
    const r = bash(`echo y >> ${pad}.company/work/P1/01-feature/guard.jsonl`);
    assert.match(r.reason ?? '', /^aico guard self-protect\.M-SEC1:/, r.out.slice(0, 200));
  });

  test('a long harmless command with few protected-looking words still allows in the project', () => {
    const r = bash(`echo ${junk(70)} x >> out.txt`);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.reason, null, `unexpected deny: ${r.reason}`);
  });
});
