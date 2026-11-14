#!/usr/bin/env node
// contract: docs/contracts/mod-hook.md v1
// The hook engine: one process per hook call. Reads one hook payload on stdin, checks the pins, normalizes the
// event, runs the rule table in one worker and prints one verdict. This file reads nothing from hooks/lib until
// the pins match, so a changed engine file is never loaded.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MAX_INPUT = 4 * 1024 * 1024;
const SELF_EXIT_MS = 3800;
const FIXTURE_BUDGET_MS = 2000;
const MAX_FIXTURES = 24;
const MAX_FIXTURE_BYTES = 64 * 1024;
const FIXED = ['hooks/rules.json', 'hooks/hooks.json', 'hooks/schema/hook-fields.json', 'company/model-floor.json'];
const FOLDERS = [['hooks/lib', /\.mjs$/], ['hooks/rules', /\.mjs$/], ['hooks/manifests', /\.json$/]];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// Every file the pins cover, as plugin-relative paths with forward slashes. A directory or a file of another
// kind inside a pinned folder is listed too, so it shows up as an extra.
export function pinSet(root) {
  const out = [];
  if (fs.existsSync(path.join(root, 'scripts', 'hook-host.mjs'))) out.push('scripts/hook-host.mjs');
  for (const [dir, re] of FOLDERS) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { /* folder absent */ }
    for (const e of names.sort((a, b) => (a.name < b.name ? -1 : 1))) if (!e.isFile() || re.test(e.name)) out.push(`${dir}/${e.name}`);
  }
  for (const rel of FIXED) if (fs.existsSync(path.join(root, rel))) out.push(rel);
  return out;
}

export function pinHashes(root) {
  const files = {};
  for (const rel of pinSet(root)) files[rel] = sha(path.join(root, rel));
  return { v: 1, files };
}

// { ok: true } or { ok: false, files: [relative paths] }.
export function checkPins(root) {
  let pins;
  try { pins = readJson(path.join(root, 'hooks', 'pins.json')); } catch { return { ok: false, files: ['hooks/pins.json'] }; }
  if (!isObj(pins) || pins.v !== 1 || !isObj(pins.files)) return { ok: false, files: ['hooks/pins.json'] };
  const bad = [];
  const actual = new Set(pinSet(root));
  for (const [rel, hash] of Object.entries(pins.files)) {
    if (!actual.has(rel)) { bad.push(rel); continue; }
    try { if (sha(path.join(root, rel)) !== hash) bad.push(rel); } catch { bad.push(rel); }
  }
  for (const rel of actual) if (!Object.hasOwn(pins.files, rel)) bad.push(rel);
  return bad.length === 0 ? { ok: true } : { ok: false, files: [...new Set(bad)] };
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    process.stdin.on('data', (c) => { total += c.length; if (total <= MAX_INPUT + 16) chunks.push(c); });
    const done = () => resolve({ text: Buffer.concat(chunks).toString('utf8'), over: total > MAX_INPUT });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

function finish(obj) {
  const text = obj ? `${JSON.stringify(obj)}\n` : '';
  const go = () => process.exit(0);
  if (text) process.stdout.write(text, go); else go();
}

const preDeny = (rule, message, extra = {}) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `aico guard ${rule}: ${message}` },
  ...extra
});

// A deny shaped for the event it answers; events that cannot be blocked get the CEO message only.
function denyOut(name, stopActive, rule, message, extra = {}) {
  if (name === 'SessionStart' || name === 'SubagentStart') return extra.systemMessage ? { systemMessage: extra.systemMessage } : null;
  if (name === 'SubagentStop') return stopActive ? null : { decision: 'block', reason: `aico guard ${rule}: ${message}`, ...extra };
  return preDeny(rule, message, extra);
}

const sysOf = (list) => { const t = list.filter(Boolean).join('\n'); return t.length > 0 ? t.slice(0, 2000) : null; };

async function main() {
  setTimeout(() => finish(preDeny('host', 'timeout')), SELF_EXIT_MS).unref();
  const { text, over } = await readStdin();
  let peek = null;
  try { peek = JSON.parse(text); } catch { /* malformed below */ }
  const name = isObj(peek) && typeof peek.hook_event_name === 'string' ? peek.hook_event_name : null;
  const peekLead = isObj(peek) && (name !== 'PreToolUse' || !Object.hasOwn(peek, 'agent_id')) && name !== 'SubagentStop';
  const guardsOff = process.env.AICO_GUARDS === 'off';

  const pins = checkPins(ROOT);
  if (!pins.ok) {
    const msg = `pins-mismatch: ${pins.files.slice(0, 5).join(', ')}`;
    if (name === 'SessionStart') return finish({ systemMessage: `aico guards: ${msg}; guards deny until the plugin is reinstalled` });
    if (guardsOff && peekLead) return finish(null);
    if (name === 'SubagentStart' || name === 'SubagentStop') return finish(null);
    return finish(preDeny('pins-mismatch', pins.files.slice(0, 5).join(', ')));
  }

  const lib = (n) => import(pathToFileURL(path.join(ROOT, 'hooks', 'lib', `${n}.mjs`)).href);
  let ev; let snap; let runnerLib; let log; let eff;
  try { [ev, snap, runnerLib, log, eff] = await Promise.all([lib('event'), lib('snapshot'), lib('rule-runner'), lib('deny-log'), lib('cap-effects')]); } catch {
    return finish(preDeny('host', 'crash'));
  }

  if (over) return finish(preDeny('malformed', 'input over the size limit'));
  const raw = ev.parseInput(text);
  if (!raw) return finish(preDeny('malformed', 'input is not a hook event'));

  const mcsHome = process.env.MCSPARROW_HOME || path.join(process.env.USERPROFILE || process.env.HOME || (await import('node:os')).homedir(), '.mcsparrow');
  let schema = null;
  try { schema = readJson(path.join(ROOT, 'hooks', 'schema', 'hook-fields.json')); } catch { /* no schema, no drift */ }
  const ctx = { env: process.env, schema, pluginRoot: ROOT, mcsHome, resolveRun: (e, r) => eff.resolveRun(e, r) };
  const norm = await ev.normalize(raw, ctx);
  if (!norm.ok) return finish(preDeny('malformed', norm.why));
  const { event, cwd } = norm;
  const root = norm.root ?? cwd;
  const evName = event.event;
  const stopActive = event.stopHookActive === true;
  const snapCtx = { mcsHome, root };
  const runner = runnerLib.createRunner(ROOT);
  const done = (obj) => { runner.close(); finish(obj); };

  // Rule table and manifests.
  let table = null;
  let tableError = false;
  const manifests = [];
  try {
    for (const n of fs.readdirSync(path.join(ROOT, 'hooks', 'manifests'))) {
      if (!n.endsWith('.json')) continue;
      try {
        const m = readJson(path.join(ROOT, 'hooks', 'manifests', n));
        if (isObj(m) && typeof m.id === 'string' && (m.kind === 'guard' || m.kind === 'saver') && Array.isArray(m.rules)) manifests.push(m);
      } catch { /* an unreadable manifest leaves its rows unused */ }
    }
  } catch { /* no manifests */ }
  try {
    const t = readJson(path.join(ROOT, 'hooks', 'rules.json'));
    if (!Array.isArray(t)) throw new Error('not a table');
    table = t;
  } catch { tableError = true; }
  const rows = [];
  for (const r of table ?? []) {
    if (!isObj(r) || typeof r.rule !== 'string' || typeof r.module !== 'string' || typeof r.export !== 'string' || !Array.isArray(r.matcher)) continue;
    if (!['PreToolUse', 'SessionStart', 'SubagentStart', 'SubagentStop'].includes(r.event) || (r.fail !== 'closed' && r.fail !== 'open')) continue;
    const m = manifests.find((x) => x.rules.includes(r.rule));
    if (!m || m.fail !== r.fail || (m.kind === 'guard') !== (r.fail === 'closed')) continue;
    rows.push({ ...r, kind: m.kind, id: m.id });
  }
  const applies = (r, e) => r.event === e.event && (e.tool === null || r.matcher.includes('*') || r.matcher.includes(e.tool.name));
  const run = (r, e, s) => runner.run({ module: r.module, export: r.export, event: e, snapshot: s, timeoutMs: r.timeoutMs });

  // Session start: fixtures, drift, the Lead snapshot.
  const notices = [];
  if (evName === 'SessionStart') {
    let drift = event.drift.length > 0;
    if (drift) notices.push(`aico guards: hook payload changed: ${event.drift.join(', ')}; guards deny, savers are off`);
    const prov = snap.buildSnapshot({ pluginRoot: ROOT, mcsHome, root, manifests, drift: false });
    if (prov && !tableError) {
      const failed = await checkFixtures({ rows, prov, ctx, run, ev });
      if (failed.length > 0) { drift = true; notices.push(`aico guards: fixture check failed for ${failed.join(', ')}; guards deny, savers are off`); }
    }
    const full = snap.buildSnapshot({ pluginRoot: ROOT, mcsHome, root, manifests, drift });
    if (full) {
      snap.writeLead(snapCtx, full);
      for (const w of full.settingsWarnings) notices.push(`aico settings: ${w}`);
    }
    return done(sysOf(notices) ? { systemMessage: sysOf(notices) } : null);
  }

  // Dispatch: the Lead snapshot is renewed, the Step file written once.
  if (evName === 'SubagentStart') {
    const prev = snap.readSnapshot(snapCtx, { session: 'lead', agentKey: null });
    const full = snap.buildSnapshot({ pluginRoot: ROOT, mcsHome, root, manifests, drift: prev.ok ? prev.snapshot.drift : false });
    if (full) {
      snap.writeLead(snapCtx, full);
      if (event.agentKey) snap.writeStepOnce(snapCtx, event.agentKey, full);
    }
  }

  // Engine, per hook call (mod-hook v1).
  const off = guardsOff && event.session === 'lead';
  if (off) await eff.recordGuardsOff(event, root);
  const guardRows = tableError ? [] : rows.filter((r) => r.kind === 'guard' && applies(r, event));
  const s = snap.readSnapshot(snapCtx, event);
  const notes = [];
  let denied = null;
  const extra = {};
  const fail = (rule, kind, message) => { denied = { rule, kind, message }; };

  if (!off) {
    if (tableError) fail('table-invalid', 'deny', 'the rule table cannot be read');
    else if (guardRows.length > 0 && !s.ok) fail('snapshot-invalid', 'deny', 'no valid settings snapshot');
    else if (guardRows.length > 0 && (s.snapshot.drift || event.drift.length > 0)) fail('hook-payload-changed', 'deny', event.drift.length > 0 ? event.drift.join(', ') : 'the session start check failed');
  }
  const applyEff = async (v) => { if (v.effect) Object.assign(extra, (await eff.applyEffect(v, event, root)).extra); };
  if (!denied) {
    for (const r of guardRows) {
      if (off && !s.ok) break;
      const out = await run(r, event, s.snapshot);
      if (off) { if (out.ok && out.verdict.v === 'note') notes.push(out.verdict.message); continue; }
      if (!out.ok) { fail(r.rule, out.word, out.word === 'invalid' ? 'invalid verdict' : out.word); break; }
      const v = out.verdict;
      await applyEff(v);
      if (v.v === 'deny') { fail(r.rule, 'deny', v.message); break; }
      if (v.v === 'note') notes.push(v.message);
    }
  }
  if (!denied && s.ok && event.session === 'lead' && !s.snapshot.drift && event.drift.length === 0) {
    for (const r of rows.filter((x) => x.kind === 'saver' && applies(x, event) && s.snapshot.savers[x.id] === true)) {
      const out = await run(r, event, s.snapshot);
      if (out.ok && out.verdict.v === 'note') notes.push(out.verdict.message);
    }
  }

  let toast = null;
  if (denied) {
    const entry = log.appendDeny(snap.denyDir(mcsHome, root), { rule: denied.rule, kind: denied.kind, session: event.sessionKey, agent: event.agentKey });
    if (entry.first) toast = `aico guard ${denied.rule} denied a call; later denies of this rule are only counted (see the deny log)`;
  }
  const msg = sysOf([...notes, extra.systemMessage, toast]);
  const rest = { ...extra };
  delete rest.systemMessage;
  if (denied) return done(denyOut(evName, stopActive, denied.rule, denied.message, { ...rest, ...(msg ? { systemMessage: msg } : {}) }));
  const out = { ...rest, ...(msg ? { systemMessage: msg } : {}) };
  return done(Object.keys(out).length > 0 ? out : null);
}

// Runs hooks/fixtures/<rule>/pass-*.json and block-*.json against the rule; returns the rule IDs that failed.
async function checkFixtures({ rows, prov, ctx, run, ev }) {
  const failed = new Set();
  const t0 = Date.now();
  for (const r of rows.filter((x) => x.kind === 'guard')) {
    const dir = path.join(ROOT, 'hooks', 'fixtures', r.rule);
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => /^(pass|block)-[A-Za-z0-9._-]+\.json$/.test(n)).sort().slice(0, MAX_FIXTURES); } catch { continue; }
    for (const n of names) {
      if (Date.now() - t0 > FIXTURE_BUDGET_MS) { failed.add('fixture-budget'); return [...failed]; }
      const wantDeny = n.startsWith('block-');
      let verdictDeny = false;
      try {
        const f = path.join(dir, n);
        if (fs.statSync(f).size > MAX_FIXTURE_BYTES) throw new Error('large');
        const norm = await ev.normalize(JSON.parse(fs.readFileSync(f, 'utf8')), { ...ctx, resolveRun: null });
        if (!norm.ok || norm.event.drift.length > 0) throw new Error('payload');
        if (r.event === norm.event.event && (norm.event.tool === null || r.matcher.includes('*') || r.matcher.includes(norm.event.tool.name))) {
          const out = await run(r, norm.event, prov);
          verdictDeny = !out.ok || out.verdict.v === 'deny';
          if (!out.ok && wantDeny === false) throw new Error('failed');
        }
      } catch { failed.add(r.rule); continue; }
      if (verdictDeny !== wantDeny) failed.add(r.rule);
    }
  }
  return [...failed];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => finish(preDeny('host', 'crash')));
}
