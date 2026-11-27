// Test harness for the hook engine (scripts/hook-host.mjs). Builds a throw-away plugin root
// from the real host and lib plus the stub rules of this folder, writes matching pins, and runs
// the host as a process: synthetic event on stdin -> verdict on stdout.
//
// Shapes this harness assumes (change them here in one place):
//   hooks/rules.json  = JSON array of rule rows (`mod-hook` v1 "Rule table")
//   hooks/pins.json   = { "v": 1, "files": { "<relative path, forward slashes>": "<sha256 hex>" } }
//   host invocation   = `node <root>/scripts/hook-host.mjs`, event JSON on stdin, no arguments
//   settings          = <MCSPARROW_HOME>/config.json, key aico_settings (`aico-settings`)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..', '..');
export const LIB_FILES = ['event', 'snapshot', 'cap-effects', 'paths', 'rule-id', 'rule-runner', 'deny-log'].map((n) => `hooks/lib/${n}.mjs`);

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const key12 = (id) => sha256(id).slice(0, 12);
export const slash = (p) => p.replace(/\\/g, '/');
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const bases = [];
export function cleanup() { for (const b of bases.splice(0)) fs.rmSync(b, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }

// One template per test file; each case copies it.
let template = null;
function buildTemplate() {
  if (template) return template;
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-tpl-')));
  bases.push(base);
  const t = path.join(base, 'tpl');
  fs.mkdirSync(path.join(t, 'scripts'), { recursive: true });
  // Host-side imports may reach any plain script or mods/lib module: copy them (tests excluded).
  for (const f of fs.readdirSync(path.join(REPO, 'scripts'))) {
    const src = path.join(REPO, 'scripts', f);
    if (/\.mjs$/.test(f) && !/\.test\./.test(f) && fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(t, 'scripts', f));
  }
  if (fs.existsSync(path.join(REPO, 'mods', 'lib'))) fs.cpSync(path.join(REPO, 'mods', 'lib'), path.join(t, 'mods', 'lib'), { recursive: true });
  if (fs.existsSync(path.join(REPO, 'hooks', 'lib'))) fs.cpSync(path.join(REPO, 'hooks', 'lib'), path.join(t, 'hooks', 'lib'), { recursive: true });
  // mods/lib/context-cap.mjs imports the cap rule.
  if (fs.existsSync(path.join(REPO, 'hooks', 'rules', 'cap.mjs'))) {
    fs.mkdirSync(path.join(t, 'hooks', 'rules'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'hooks', 'rules', 'cap.mjs'), path.join(t, 'hooks', 'rules', 'cap.mjs'));
  }
  // The host imports hooks/rules/self-protect.mjs from the plugin root and fails closed without it.
  if (fs.existsSync(path.join(REPO, 'hooks', 'rules', 'self-protect.mjs'))) {
    fs.mkdirSync(path.join(t, 'hooks', 'rules'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'hooks', 'rules', 'self-protect.mjs'), path.join(t, 'hooks', 'rules', 'self-protect.mjs'));
  }
  // The guards-off host path imports hooks/rules/dotenv.mjs and fails closed without it.
  if (fs.existsSync(path.join(REPO, 'hooks', 'rules', 'dotenv.mjs'))) {
    fs.mkdirSync(path.join(t, 'hooks', 'rules'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'hooks', 'rules', 'dotenv.mjs'), path.join(t, 'hooks', 'rules', 'dotenv.mjs'));
  }
  fs.mkdirSync(path.join(t, 'company'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'company', 'model-floor.json'), path.join(t, 'company', 'model-floor.json'));
  template = t;
  return t;
}

export function pinnedFiles(plugin) {
  const out = [];
  const add = (rel) => { if (fs.existsSync(path.join(plugin, rel))) out.push(rel); };
  add('scripts/hook-host.mjs');
  const list = (dir, re) => (fs.existsSync(path.join(plugin, dir)) ? fs.readdirSync(path.join(plugin, dir)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`) : []);
  out.push(...list('hooks/lib', /\.mjs$/), ...list('hooks/rules', /\.mjs$/), ...list('hooks/manifests', /\.json$/));
  for (const rel of ['hooks/rules.json', 'hooks/hooks.json', 'hooks/schema/hook-fields.json', 'company/model-floor.json']) add(rel);
  return out;
}

export function writePins(plugin) {
  const files = {};
  // The host hashes line-ending-normalized bytes (CRLF read as LF, binary as is); match it so a CRLF working copy pins alike.
  const pinBytes = (b) => (b.includes(0) ? b : Buffer.from(b.toString('latin1').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)), 'latin1'));
  for (const rel of pinnedFiles(plugin)) files[rel] = sha256(pinBytes(fs.readFileSync(path.join(plugin, rel))));
  writeJson(path.join(plugin, 'hooks', 'pins.json'), { v: 1, files });
}

// opts: { probe, rows (extra rule rows), manifests (extra manifest objects), noPins }
export function makeEnv(opts = {}) {
  const tpl = buildTemplate();
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-env-')));
  bases.push(base);
  const plugin = path.join(base, 'plugin');
  fs.cpSync(tpl, plugin, { recursive: true });
  if (!fs.existsSync(path.join(plugin, 'scripts', 'hook-host.mjs'))) {
    throw new Error('scripts/hook-host.mjs is missing in the repo (T5 not built yet)');
  }
  const fx = HERE;
  const put = (rel, from) => { fs.mkdirSync(path.dirname(path.join(plugin, rel)), { recursive: true }); fs.cpSync(path.join(fx, from), path.join(plugin, rel), { recursive: true }); };
  put('hooks/rules/stub-guard.mjs', 'rules/stub-guard.mjs');
  put('hooks/rules/stub-saver.mjs', 'rules/stub-saver.mjs');
  put('hooks/manifests/stub-guard.json', 'manifests/stub-guard.json');
  put('hooks/manifests/cache-tax.json', 'manifests/cache-tax.json');
  put('hooks/hooks.json', 'hooks.json');
  put('hooks/schema/hook-fields.json', 'schema/hook-fields.json');
  put('hooks/fixtures/stub-guard.M1', 'fixtures/stub-guard.M1');
  let rows = readJson(path.join(fx, 'rules.json'));
  if (opts.probe) {
    put('hooks/rules/probe.mjs', 'rules/probe.mjs');
    put('hooks/manifests/probe.json', 'manifests/probe.json');
    rows = rows.concat(readJson(path.join(fx, 'rules.probe.json')));
  }
  if (opts.rows) rows = rows.concat(opts.rows);
  for (const m of opts.manifests ?? []) writeJson(path.join(plugin, 'hooks', 'manifests', `${m.id}.json`), m);
  writeJson(path.join(plugin, 'hooks', 'rules.json'), rows);
  if (!opts.noPins) writePins(plugin);

  const home = path.join(base, 'mcsparrow');
  const userHome = path.join(base, 'userhome');
  const project = path.join(base, 'project');
  fs.mkdirSync(path.join(project, '.company'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(userHome, { recursive: true });
  const snapDir = path.join(home, 'hook-snapshots');
  const root12 = key12(project);

  const env = {
    base, plugin, home, userHome, project, snapDir, root12,
    leadFile: path.join(snapDir, root12, 'lead.json'),
    stepFile: (agentId) => path.join(snapDir, 'steps', `step-${key12(agentId)}.json`),
    deniesFile: path.join(snapDir, root12, 'denies.jsonl'),
    setConfig(aico_settings) { writeJson(path.join(home, 'config.json'), { aico_settings: { version: 1, ...aico_settings } }); },
    repin() { writePins(plugin); },
    transcript(name, rows) {
      const f = path.join(base, 'transcripts', `${name}.jsonl`);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
      return f;
    },
    // Build a raw payload; a key set to undefined in `over` is removed.
    event(name, over = {}) {
      const common = { hook_event_name: name, session_id: 'sess-lead-1', transcript_path: path.join(base, 'transcripts', 'none.jsonl'), cwd: project };
      const per = {
        SessionStart: { source: 'startup' },
        PreToolUse: { tool_name: 'Bash', tool_input: { command: 'ls' }, permission_mode: 'default' },
        SubagentStart: { agent_id: 'agent-a1', agent_type: 'aico:qa' },
        SubagentStop: { agent_id: 'agent-a1', agent_type: 'aico:qa', agent_transcript_path: path.join(base, 'transcripts', 'none-step.jsonl'), stop_hook_active: false }
      }[name];
      const o = { ...common, ...per, ...over };
      for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
      return o;
    },
    pre(command, over = {}) { return env.event('PreToolUse', { tool_input: { command }, ...over }); },
    stepPre(command, over = {}) { return env.event('PreToolUse', { tool_input: { command }, session_id: 'sess-lead-1', agent_id: 'agent-a1', agent_type: 'aico:qa', ...over }); },
    // Run the host. `payload` is an object (JSON-encoded) or a string (sent as is).
    run(payload, { env: extra = {}, cwd = project } = {}) {
      const e = { ...process.env, CLAUDE_PLUGIN_ROOT: plugin, MCSPARROW_HOME: home, HOME: userHome, USERPROFILE: userHome };
      for (const k of ['AICO_GUARDS', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE', 'AICO_CONTEXT_GUARD']) delete e[k];
      Object.assign(e, extra);
      const t0 = Date.now();
      const r = spawnSync(process.execPath, [path.join(plugin, 'scripts', 'hook-host.mjs')], {
        input: typeof payload === 'string' ? payload : JSON.stringify(payload), env: e, cwd, encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024
      });
      const out = r.stdout ?? '';
      let json = null;
      try { json = out.trim() ? JSON.parse(out) : null; } catch { json = undefined; }
      return { code: r.status, out, err: r.stderr ?? '', ms: Date.now() - t0, json, signal: r.signal };
    },
    // Deny reason of a PreToolUse deny (null when not a deny).
    reason(r) { return r.json?.hookSpecificOutput?.permissionDecision === 'deny' ? r.json.hookSpecificOutput.permissionDecisionReason : null; },
    denies() { return fs.existsSync(env.deniesFile) ? fs.readFileSync(env.deniesFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; },
    // An active run in the project, for the guard record.
    async startRun(slug = 'P20261114.000099/01-feature') {
      const dir = path.join(project, '.company', 'work', slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(project, '.company', 'work', slug.split('/')[0], '00-project.md'), 'A demo project\n');
      const { append } = await import(new URL('../../../scripts/run-state.mjs', import.meta.url));
      append(project, slug, { ev: 'start' }, { now: Date.now() - 60000 });
      return dir;
    }
  };
  return env;
}

// Session start for the lead so that lead.json exists.
export function startLead(env) {
  const r = env.run(env.event('SessionStart'));
  if (!fs.existsSync(env.leadFile)) throw new Error(`lead.json not written by SessionStart: ${r.out} ${r.err}`);
  return r;
}
