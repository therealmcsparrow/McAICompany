// Tests: evasion cases the shipped guards must deny through the real host, run against a copy of the plugin tree
// whose pins are rewritten (so a stale pin file cannot mask the verdict). The new block fixtures are replayed
// here, and the cases a fixture cannot hold (oversize or plugin-root cwd) are built in code. Shell writes to
// plugin, settings or home files pass in every session; shell writes to a run record deny.
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
];
const SP_DIR = 'self-protect.M-SEC1';
const SP_FIXTURES = fs.readdirSync(path.join(ROOT, 'hooks', 'fixtures', SP_DIR)).filter((n) => /^(?:block|pass)-(?:bash|ps)-.+\.json$/.test(n));
const WHO = {
  main: {},
  lead: { agent_id: 'lead1', agent_type: 'aico:project-manager' },
  role: { agent_id: 'role1', agent_type: 'aico:backend-engineer' },
};

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

describe('self-protect shell fixtures through the real host in main, the Lead and a Role', () => {
  const replay = (name, who) => {
    const { _synthetic, ...raw } = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'fixtures', SP_DIR, name), 'utf8'));
    return host({ ...raw, ...WHO[who], cwd: fwd(project) }, project);
  };
  for (const name of SP_FIXTURES) {
    for (const who of Object.keys(WHO)) {
      if (name.startsWith('block-')) {
        test(`${name} denies for ${who}`, () => {
          const r = replay(name, who);
          assert.equal(r.code, 0, r.err);
          assert.ok(r.reason, `expected a deny, got ${r.out}`);
          assert.ok(r.reason.startsWith(`aico guard ${SP_DIR}:`), `denied by another rule: ${r.reason}`);
        });
      } else {
        test(`${name} passes for ${who}`, () => {
          const r = replay(name, who);
          assert.equal(r.code, 0, r.err);
          assert.equal(r.reason, null, `unexpected deny: ${r.reason}`);
        });
      }
    }
  }

  test('every shell block fixture names a run record', () => {
    for (const name of SP_FIXTURES.filter((n) => n.startsWith('block-'))) {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'fixtures', SP_DIR, name), 'utf8'));
      assert.match(j.tool_input.command, /(?:guard|forms|run-state)\.jsonl|-EncodedCommand/, name);
    }
  });

  test('block-bash-guard-record-two-level is still a block fixture', () => {
    assert.ok(SP_FIXTURES.includes('block-bash-guard-record-two-level.json'));
  });
});

describe('long command lists and long targets through the real host', () => {
  const junk = (n) => Array.from({ length: n }, (_, i) => `j${i}`).join(' ');
  const REC = '.company/work/P1/01-feature';
  const asWho = (who, command, cwd = project) => host({ tool_name: 'Bash', tool_input: { command }, ...WHO[who] }, cwd);

  for (const who of Object.keys(WHO)) {
    test(`64+ tokens then a forms.jsonl redirect denies for ${who}`, () => {
      const r = asWho(who, `echo ${junk(70)} x >> ${REC}/forms.jsonl`);
      assert.equal(r.code, 0, r.err);
      assert.match(r.reason ?? '', /^aico guard self-protect\.M-SEC1:/, r.out);
    });

    test(`64+ tokens then a run-state.jsonl cp denies for ${who}`, () => {
      const r = asWho(who, `echo ${junk(70)}; cp x ${REC}/run-state.jsonl`);
      assert.match(r.reason ?? '', /^aico guard self-protect\.M-SEC1:/, r.out);
    });

    test(`a relative write into the plugin tree with cwd in the plugin root passes for ${who}`, () => {
      const r = asWho(who, 'echo x >> hooks/rules/x.mjs', plugin);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.reason, null, `unexpected deny: ${r.reason}`);
    });

    test(`64+ tokens then a settings write passes for ${who}`, () => {
      const r = asWho(who, `echo ${junk(70)} x >> .claude/settings.json`);
      assert.equal(r.reason, null, `unexpected deny: ${r.reason}`);
    });

    test(`a command naming hook-pins or set-mod passes for ${who}`, () => {
      assert.equal(asWho(who, 'node scripts/hook-pins.mjs check').reason, null);
      assert.equal(asWho(who, 'node scripts/settings.mjs set-mod switchboard enabled false').reason, null);
    });

    test(`a command over 200000 chars denies for ${who}`, () => {
      const r = asWho(who, `echo ${'a'.repeat(200001)}`);
      assert.equal(r.code, 0, r.err);
      assert.match(r.reason ?? '', /^aico guard self-protect\.M-SEC1:/, r.out.slice(0, 200));
    });
  }

  test('Write of a plugin file still denies', () => {
    const r = host({ tool_name: 'Write', tool_input: { file_path: fwd(path.join(plugin, 'hooks', 'rules', 'x.mjs')), content: 'x' } }, project);
    assert.match(r.reason ?? '', /^aico guard self-protect\.M-SEC1:/, r.out);
  });

  test('Edit of a settings file still denies', () => {
    const r = host({ tool_name: 'Edit', tool_input: { file_path: fwd(path.join(project, '.claude', 'settings.json')), old_string: 'a', new_string: 'b' } }, project);
    assert.match(r.reason ?? '', /^aico guard self-protect\.M-SEC1:/, r.out);
  });

  test('a target over 4096 chars that resolves to a run folder record denies', () => {
    const pad = 'a=b/../'.repeat(600);
    for (const rec of ['guard', 'forms', 'run-state']) {
      const r = bash(`echo y >> ${pad}${REC}/${rec}.jsonl`);
      assert.equal(r.code, 0, r.err);
      assert.match(r.reason ?? '', /^aico guard self-protect\.M-SEC1:/, `${rec}: ${r.out.slice(0, 200)}`);
    }
  });

  test('a target over 4096 chars that resolves to .claude/settings.json passes', () => {
    const pad = 'a=b/../'.repeat(600);
    const r = bash(`echo y >> ${pad}${pad}.claude/settings.json`);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.reason, null, `unexpected deny: ${r.reason}`);
  });

  test('a long harmless command with few protected-looking words still allows in the project', () => {
    const r = bash(`echo ${junk(70)} x >> out.txt`);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.reason, null, `unexpected deny: ${r.reason}`);
  });
});

const BS = String.fromCharCode(92);
const ps = (command, cwd = project) => host({ tool_name: 'PowerShell', tool_input: { command } }, cwd);
const grep = (glob) => host({ tool_name: 'Grep', tool_input: { pattern: 'x', glob } }, project);
const globTool = (pattern) => host({ tool_name: 'Glob', tool_input: { pattern } }, project);
const denyBy = (r, rule) => {
  assert.equal(r.code, 0, r.err);
  assert.ok(r.reason, `expected a deny, got ${r.out.slice(0, 200)}`);
  assert.ok(r.reason.startsWith(`aico guard ${rule}:`), `denied by another rule: ${r.reason}`);
};

describe('dotenv wildcard forms through the real host', () => {
  for (const g of ['*env', '?env', '**/*env', '*nv.local']) {
    test(`Grep glob ${g} denies`, () => denyBy(grep(g), 'dotenv.M-SEC1'));
    test(`Glob pattern ${g} denies`, () => denyBy(globTool(g), 'dotenv.M-SEC1'));
  }

  test('powershell named from Bash with a leading star denies', () => {
    denyBy(bash('powershell -c "Get-Content *env"'), 'dotenv.M-SEC1');
  });

  test('a shell variable joined to nv.local denies in Bash', () => {
    denyBy(bash('cat ${x}nv.local'), 'dotenv.M-SEC1');
  });

  test('a shell variable joined to nv.local denies in PowerShell', () => {
    denyBy(ps('Get-Content ${x}nv.local'), 'dotenv.M-SEC1');
  });

  test('Bash cat * still allows', () => {
    const r = bash('cat *');
    assert.equal(r.code, 0, r.err);
    assert.equal(r.reason, null, `unexpected deny: ${r.reason}`);
  });
});

describe('quoted text piped to an interpreter keeps denying through the real host', () => {
  const payloads = [
    [`printf '%s${BS}n' '#${BS}' 'open(".company/work/p1/01-feature/forms.jsonl","a").write("{}")' | python`, 'hash-backslash'],
    [`printf '%s${BS}n' '#${BS}' 'open(".company/work/p1/01-feature/for"+"ms.jsonl","a").write("{}")' | python`, 'split-literal'],
    [`echo 'x${BS}' 'open(".company/work/p1/01-feature/run-state.jsonl","a")' | node`, 'echo-node'],
  ];
  for (const [command, name] of payloads) {
    test(`${name} denies`, () => {
      assert.ok(command.includes(BS), 'payload keeps its backslash');
      denyBy(bash(command), 'self-protect.M-SEC1');
    });
  }
});

describe('hostile long input stays fast through the real host', () => {
  const timed = (command) => {
    const t = process.hrtime.bigint();
    const r = bash(command);
    return { r, ms: Number(process.hrtime.bigint() - t) / 1e6 };
  };

  test('an unclosed sequence brace over long dotted words scales linearly', () => {
    const unit = `${'.'.repeat(4000)}=`;
    const run = (n) => timed(`echo {${unit.repeat(n)}`);
    run(2);
    const small = run(8);
    const large = run(64);
    assert.notEqual(large.r.code, null, 'host timed out');
    assert.ok(large.ms < 8000, `took ${large.ms} ms`);
    assert.ok(large.ms < Math.max(small.ms, 300) * 25, `${small.ms} ms -> ${large.ms} ms for 8x the input`);
  });

  test('words of 4096 characters scale linearly and finish well inside the hook timeout', () => {
    const word = 'a'.repeat(4096);
    const run = (bytes) => timed(`echo ${Array.from({ length: Math.floor(bytes / 4097) }, () => word).join(' ')}`);
    run(65536);
    const small = run(1 << 20);
    const large = run(3 << 20);
    assert.notEqual(large.r.code, null, 'host timed out');
    assert.ok(large.ms < 8000, `took ${large.ms} ms`);
    assert.ok(large.ms < Math.max(small.ms, 300) * 12, `${small.ms} ms -> ${large.ms} ms for 3x the input`);
  });
});
