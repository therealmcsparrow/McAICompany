// Regression tests: the Lead snapshot must exist after a fresh start, and a guarded call
// with no valid snapshot rebuilds it instead of denying `snapshot-invalid` (mod-hook v1.1).
// Every case runs the real engine (scripts/hook-host.mjs) from a temp plugin root built and pinned by the engine
// harness, with a temp MCSPARROW_HOME, so nothing here reads the repo's hooks/pins.json.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeEnv, cleanup, startLead } from '../hooks/fixtures/engine/harness.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotLib = await import(pathToFileURL(path.join(REPO, 'hooks', 'lib', 'snapshot.mjs')).href);
const { validSnapshot } = snapshotLib;
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const repoJson = (...p) => readJson(path.join(REPO, ...p));

const FLOOR_MSG = 'snapshot rebuild failed: model floor file unreadable; fix: reinstall the aico plugin; escape: restart the Lead with AICO_GUARDS=off';
const SETTINGS_MSG = 'snapshot rebuild failed: settings invalid; fix: repair the aico settings files (config.json, .company/settings.json); escape: restart the Lead with AICO_GUARDS=off';
const STUB_DENY = 'stub guard says no';

after(() => cleanup());

const reasonOf = (env, r) => env.reason(r) ?? '';
const judged = (env, r) => {
  const reason = reasonOf(env, r);
  assert.ok(reason.includes(STUB_DENY), `expected the stub guard verdict, got: ${r.out.slice(0, 200)}`);
};
const allowed = (env, r) => assert.equal(env.reason(r), null, `expected no deny, got: ${r.out.slice(0, 200)}`);
const leadOk = (env) => validSnapshot(readJson(env.leadFile));
const dropLead = (env) => fs.rmSync(env.leadFile, { force: true });
const writeRaw = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// A plugin whose Lead SessionStart cannot finish inside the host deadline: the main thread loses 600 ms while
// the cap module loads (cold start under load), then 4 slow guard rules each hold the worker until its timeout.
function slowStartEnv() {
  const ids = [0, 1, 2, 3].map((i) => `slowr${i}.M1`);
  const rows = ids.map((rule) => ({ event: 'PreToolUse', matcher: ['*'], rule, module: 'slow.mjs', export: 'judge', fail: 'closed', timeoutMs: 1000, message: `aico guard ${rule}: slow` }));
  const manifests = ids.map((rule) => ({ v: 1, id: rule.split('.')[0], kind: 'guard', title: 'Slow', owner: 'backend-engineer', sessions: 'all', events: ['PreToolUse'], rules: [rule], fail: 'closed', switch: null, lock: true, upstream: null }));
  const env = makeEnv({ rows, manifests, noPins: true });
  fs.writeFileSync(path.join(env.plugin, 'hooks', 'rules', 'slow.mjs'),
    "export function judge(e) { const t = Date.now(); while (Date.now() - t < (e.tool && e.tool.command === 'slow' ? 2000 : 0)) { /* hold */ } return { v: 'allow' }; }\n");
  const cap = path.join(env.plugin, 'hooks', 'rules', 'cap.mjs');
  fs.writeFileSync(cap, `{ const t = Date.now(); while (Date.now() - t < 600) { /* slow module load */ } }\n${fs.readFileSync(cap, 'utf8')}`);
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'fixture', transcript_path: 'fixture.jsonl', cwd: '.', tool_name: 'Bash', tool_input: { command: 'slow' }, permission_mode: 'default' });
  for (const rule of ids) {
    const dir = path.join(env.plugin, 'hooks', 'fixtures', rule);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 24; i++) fs.writeFileSync(path.join(dir, `pass-${i}.json`), payload);
  }
  env.repin();
  return env;
}

describe('fresh start (H1: the session start check outlasts the host deadline)', () => {
  test('SessionStart that is cut by the host deadline still leaves a valid lead.json; the first call is judged by the rules', () => {
    const env = slowStartEnv();
    const start = env.run(env.event('SessionStart'));
    // The setup is only a repro when the host really ran into its own deadline.
    assert.ok(start.ms >= 3500, `the slow start did not reach the deadline (${start.ms} ms), the repro is void`);
    assert.ok(fs.existsSync(env.leadFile), `lead.json missing after SessionStart (${start.ms} ms): ${start.out.slice(0, 160)}`);
    assert.ok(leadOk(env));
    judged(env, env.run(env.pre('g:deny')));
  });

  test('the first guarded call after a cut SessionStart never denies snapshot-invalid', () => {
    const env = slowStartEnv();
    env.run(env.event('SessionStart'));
    const r = env.run(env.pre('ls'));
    assert.doesNotMatch(reasonOf(env, r), /snapshot-invalid/);
  });
});

describe('fresh start (H2: the snapshot key moves with cwd when no .company folder exists)', () => {
  test('SessionStart in the project root, first call from a subfolder: judged by the rules, no snapshot-invalid', () => {
    const env = makeEnv();
    fs.rmSync(path.join(env.project, '.company'), { recursive: true, force: true });
    env.run(env.event('SessionStart'));
    const sub = path.join(env.project, 'sub');
    fs.mkdirSync(sub);
    judged(env, env.run(env.pre('g:deny', { cwd: sub })));
  });

  test('the same first call from a subfolder is allowed when the rules allow it', () => {
    const env = makeEnv();
    fs.rmSync(path.join(env.project, '.company'), { recursive: true, force: true });
    env.run(env.event('SessionStart'));
    const sub = path.join(env.project, 'sub');
    fs.mkdirSync(sub);
    allowed(env, env.run(env.pre('ls', { cwd: sub })));
  });
});

describe('reload: the Lead snapshot is missing or invalid at the first guarded call', () => {
  const damage = {
    'no lead.json': (env) => dropLead(env),
    'truncated JSON': (env) => writeRaw(env.leadFile, '{"v":1,"at":"2026-11-14T00:'),
    'valid JSON that fails validSnapshot': (env) => writeRaw(env.leadFile, '{"v":1}'),
    'a snapshot over the size limit': (env) => writeRaw(env.leadFile, JSON.stringify({ v: 1, pad: 'x'.repeat(5000) }))
  };
  for (const [name, hurt] of Object.entries(damage)) {
    test(`${name}: the call is judged and lead.json is rewritten valid`, () => {
      const env = makeEnv();
      startLead(env);
      hurt(env);
      judged(env, env.run(env.pre('g:deny')));
      assert.ok(fs.existsSync(env.leadFile));
      assert.ok(leadOk(env));
    });
    test(`${name}: an allowed call is allowed`, () => {
      const env = makeEnv();
      startLead(env);
      hurt(env);
      allowed(env, env.run(env.pre('ls')));
      assert.ok(leadOk(env));
    });
  }

  test('a rebuilt Lead snapshot carries the threshold of the temp config.json', () => {
    const env = makeEnv();
    env.setConfig({ pipeline: { context_cap: 150000 } });
    startLead(env);
    dropLead(env);
    env.run(env.pre('ls'));
    assert.equal(readJson(env.leadFile).threshold, 150000);
  });

  test('a rebuilt snapshot has drift false', () => {
    const env = makeEnv();
    startLead(env);
    dropLead(env);
    env.run(env.pre('ls'));
    assert.equal(readJson(env.leadFile).drift, false);
  });

  test('a rebuilt snapshot still denies a cap.M1 Lead-agent call (never main) over the threshold set in config.json', async () => {
    const capRow = repoJson('hooks', 'rules.json').find((r) => r.rule === 'cap.M1' && r.event === 'PreToolUse');
    const env = makeEnv({ rows: [capRow], manifests: [repoJson('hooks', 'manifests', 'cap.json')] });
    env.setConfig({ pipeline: { context_cap: 60000 } });
    await env.startRun();
    startLead(env);
    dropLead(env);
    const t = env.transcript('over-cap', [{ type: 'assistant', isSidechain: false, message: { model: 'claude-opus-4', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 58000, output_tokens: 10 } } }]);
    // v3.0: main is never capped; only the Lead agent (agent_id, type aico:project-manager) is.
    allowed(env, env.run(env.pre('ls', { transcript_path: t })));
    const sub = path.join(t.slice(0, -'.jsonl'.length), 'subagents', 'agent-agent-lead-1.jsonl');
    fs.mkdirSync(path.dirname(sub), { recursive: true });
    fs.writeFileSync(sub, `${JSON.stringify({ type: 'assistant', isSidechain: true, message: { model: 'claude-opus-4', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 58000, output_tokens: 10 } } })}
`);
    const r = env.run(env.pre('ls', { transcript_path: t, agent_id: 'agent-lead-1', agent_type: 'aico:project-manager' }));
    assert.match(reasonOf(env, r), /cap\.M1|context cap|handover/);
    assert.equal(readJson(env.leadFile).threshold, 60000);
  });

  test('a rebuilt snapshot still denies a dotenv.M-SEC1 block fixture; git add -A and git commit -a pass (ADR 0079)', () => {
    const rows = repoJson('hooks', 'rules.json');
    assert.ok(!rows.some((r) => r.rule === 'git-add.M-SEC1'), 'git-add.M-SEC1 row removed');
    assert.ok(!fs.existsSync(path.join(REPO, 'hooks', 'manifests', 'git-add.json')), 'git-add manifest removed');
    const row = rows.find((r) => r.rule === 'dotenv.M-SEC1');
    const env = makeEnv({ rows: [row], manifests: [repoJson('hooks', 'manifests', 'dotenv.json')] });
    fs.copyFileSync(path.join(REPO, 'hooks', 'rules', 'dotenv.mjs'), path.join(env.plugin, 'hooks', 'rules', 'dotenv.mjs'));
    env.repin();
    startLead(env);
    dropLead(env);
    const base = { session_id: 'sess-lead-1', cwd: env.project, transcript_path: path.join(env.base, 'transcripts', 'none.jsonl') };
    const fx = repoJson('hooks', 'fixtures', 'dotenv.M-SEC1', 'block-bash-cat-env.json');
    assert.match(reasonOf(env, env.run({ ...fx, ...base })), /dotenv\.M-SEC1/);
    for (const command of ['git add -A', 'git commit -a']) {
      const r = env.run({ ...fx, ...base, tool_input: { command } });
      assert.doesNotMatch(r.out, /deny/i, command);
    }
  });
});

describe('Step session', () => {
  const dispatch = (env) => {
    startLead(env);
    const r = env.run(env.event('SubagentStart'));
    assert.ok(fs.existsSync(env.stepFile('agent-a1')), `SubagentStart wrote no Step file: ${r.out.slice(0, 160)}`);
  };

  test('own Step file invalid: the call is judged and the own file is replaced by a valid one', () => {
    const env = makeEnv();
    dispatch(env);
    writeRaw(env.stepFile('agent-a1'), '{"v":1,"at":');
    judged(env, env.run(env.stepPre('g:deny')));
    assert.ok(validSnapshot(readJson(env.stepFile('agent-a1'))));
  });

  test('own Step file missing and root lead.json missing: lead.json is rebuilt', () => {
    const env = makeEnv();
    startLead(env);
    dropLead(env);
    judged(env, env.run(env.stepPre('g:deny')));
    assert.ok(leadOk(env));
  });

  test('own Step file missing and lead.json valid: unchanged, no Step file is created', () => {
    const env = makeEnv();
    startLead(env);
    const before = fs.readFileSync(env.leadFile, 'utf8');
    judged(env, env.run(env.stepPre('g:deny')));
    assert.equal(fs.readFileSync(env.leadFile, 'utf8'), before);
    assert.equal(fs.existsSync(env.stepFile('agent-a1')), false);
  });

  test('a valid own Step file is kept byte for byte (keep-file rule)', () => {
    const env = makeEnv();
    dispatch(env);
    const before = fs.readFileSync(env.stepFile('agent-a1'), 'utf8');
    judged(env, env.run(env.stepPre('g:deny')));
    assert.equal(fs.readFileSync(env.stepFile('agent-a1'), 'utf8'), before);
  });
});

describe('rebuildSnapshot (hooks/lib/snapshot.mjs)', () => {
  const setup = () => {
    const env = makeEnv();
    return { env, ctx: { mcsHome: env.home, root: env.project }, manifests: [], pluginRoot: env.plugin };
  };

  test('is exported', () => {
    assert.equal(typeof snapshotLib.rebuildSnapshot, 'function');
  });

  test('Lead with no file: { ok: true, snapshot } and lead.json saved', () => {
    const { env, ctx, manifests, pluginRoot } = setup();
    const r = snapshotLib.rebuildSnapshot(ctx, { session: 'lead', agentKey: null }, { pluginRoot, manifests });
    assert.equal(r.ok, true);
    assert.ok(validSnapshot(r.snapshot));
    assert.deepEqual(readJson(env.leadFile), r.snapshot);
  });

  test('Step with own file invalid: own file replaced, drift follows a valid lead.json', () => {
    const { env, ctx, manifests, pluginRoot } = setup();
    snapshotLib.writeLead(ctx, snapshotLib.buildSnapshot({ pluginRoot, mcsHome: env.home, root: env.project, manifests, drift: true }));
    const agentKey = 'abcdef123456';
    writeRaw(snapshotLib.stepFile(env.home, agentKey), 'not json');
    const r = snapshotLib.rebuildSnapshot(ctx, { session: 'step', agentKey }, { pluginRoot, manifests });
    assert.equal(r.ok, true);
    assert.equal(r.snapshot.drift, true);
    assert.ok(validSnapshot(readJson(snapshotLib.stepFile(env.home, agentKey))));
  });

  test('Step with own and lead.json missing: lead.json is rebuilt with drift false', () => {
    const { env, ctx, manifests, pluginRoot } = setup();
    const r = snapshotLib.rebuildSnapshot(ctx, { session: 'step', agentKey: 'abcdef123456' }, { pluginRoot, manifests });
    assert.equal(r.ok, true);
    assert.equal(r.snapshot.drift, false);
    assert.ok(fs.existsSync(env.leadFile));
  });

  test('model-floor.json without a floor object: { ok: false, cause: "floor" }', () => {
    const { env, ctx, manifests, pluginRoot } = setup();
    fs.writeFileSync(path.join(env.plugin, 'company', 'model-floor.json'), '{}');
    assert.deepEqual(snapshotLib.rebuildSnapshot(ctx, { session: 'lead', agentKey: null }, { pluginRoot, manifests }), { ok: false, cause: 'floor' });
  });

  test('a snapshot over MAX_BYTES: { ok: false, cause: "settings" }', () => {
    const { ctx, pluginRoot } = setup();
    const manifests = oversizeManifests();
    assert.deepEqual(snapshotLib.rebuildSnapshot(ctx, { session: 'lead', agentKey: null }, { pluginRoot, manifests }), { ok: false, cause: 'settings' });
  });

  test('a rebuild that cannot save (lead folder is a file) still returns the snapshot', () => {
    const { env, ctx, manifests, pluginRoot } = setup();
    writeRaw(path.dirname(env.leadFile), 'a file where the folder should be');
    const r = snapshotLib.rebuildSnapshot(ctx, { session: 'lead', agentKey: null }, { pluginRoot, manifests });
    assert.equal(r.ok, true);
    assert.ok(validSnapshot(r.snapshot));
  });
});

function oversizeManifests() {
  return Array.from({ length: 140 }, (_, i) => ({
    v: 1, id: `oversize-saver-${i}-padding`, kind: 'saver', title: 'Pad', owner: 'backend-engineer', sessions: 'lead', events: ['PreToolUse'],
    rules: [`oversize-saver-${i}.Y1`], fail: 'open', switch: `mods.pad${i}.enabled`, lock: false, upstream: null
  }));
}

describe('failed rebuild: one short snapshot-invalid deny', () => {
  const check = (env, r, msg) => {
    assert.equal(reasonOf(env, r), `aico guard snapshot-invalid: ${msg}`);
    assert.ok(msg.length <= 200);
    assert.doesNotMatch(r.out, /\n {4}at /);
    assert.equal(r.out.includes(env.base), false, 'the verdict names a temp path');
    assert.equal(r.out.includes(path.basename(env.base)), false);
  };

  test('pinned model-floor.json of {}: the floor text', () => {
    const env = makeEnv({ noPins: true });
    fs.writeFileSync(path.join(env.plugin, 'company', 'model-floor.json'), '{}');
    env.repin();
    env.run(env.event('SessionStart'));
    check(env, env.run(env.pre('ls')), FLOOR_MSG);
  });

  test('an oversize snapshot (140 stub saver manifests): the settings text', () => {
    const env = makeEnv({ manifests: oversizeManifests() });
    env.run(env.event('SessionStart'));
    check(env, env.run(env.pre('ls')), SETTINGS_MSG);
  });

  test('a failed rebuild is denied again on the next call and counted in the deny log', () => {
    const env = makeEnv({ noPins: true });
    fs.writeFileSync(path.join(env.plugin, 'company', 'model-floor.json'), '{}');
    env.repin();
    env.run(env.event('SessionStart'));
    env.run(env.pre('ls'));
    check(env, env.run(env.pre('ls')), FLOOR_MSG);
    assert.equal(env.denies().filter((d) => d.rule === 'snapshot-invalid').length, 2);
  });
});

describe('AICO_GUARDS=off (characterization: green before and after the fix)', () => {
  test('a Lead call with no snapshot is not denied, lead.json is not rebuilt', () => {
    const env = makeEnv();
    const r = env.run(env.pre('g:deny'), { env: { AICO_GUARDS: 'off' } });
    assert.equal(env.reason(r), null);
    assert.equal(fs.existsSync(env.leadFile), false);
  });
});
