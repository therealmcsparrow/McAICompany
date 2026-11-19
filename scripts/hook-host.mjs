#!/usr/bin/env node
// contract: docs/contracts/mod-hook.md v1.3
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
const SELF_EXIT_MS = 8500; // under the 10 s hook timeout; a CPU-loaded start must not deny a spawn at 3.8 s
const START_EXIT_MS = 9500;
const MAX_TOTAL_FIXTURES = 400;
const MAX_FIXTURE_DETAILS = 5;
const MAX_FIXTURES = 24;
const MAX_FIXTURE_BYTES = 64 * 1024;
const FIXED = ['hooks/rules.json', 'hooks/hooks.json', 'hooks/schema/hook-fields.json', 'company/model-floor.json'];
const FOLDERS = [['hooks/lib', /\.mjs$/], ['hooks/rules', /\.mjs$/], ['hooks/manifests', /\.json$/]];

const REBUILD_MSG = {
  floor: 'snapshot rebuild failed: model floor file unreadable; fix: reinstall the aico plugin; escape: restart the Lead with AICO_GUARDS=off',
  settings: 'snapshot rebuild failed: settings invalid; fix: repair the aico settings files (config.json, .company/settings.json); escape: restart the Lead with AICO_GUARDS=off'
};
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Hash input: line-ending-normalized bytes (CRLF read as LF) so a CRLF working copy and an LF clone pin alike; a buffer with a NUL byte is binary and hashed as is.
function pinBytes(buf) {
  if (buf.includes(0)) return buf;
  const out = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue;
    out[n++] = buf[i];
  }
  return out.subarray(0, n);
}
const sha = (file) => crypto.createHash('sha256').update(pinBytes(fs.readFileSync(file))).digest('hex');
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

// Past this nesting depth the strings are not read; the caller fails closed on `tooDeep`.
const MAX_DECODE_DEPTH = 20;
function decodedStrings(v, d = 0, state = { tooDeep: false, out: [] }) {
  if (d > MAX_DECODE_DEPTH) { state.tooDeep = true; return state; }
  if (typeof v === 'string') state.out.push(v);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { state.out.push(k); decodedStrings(x, d + 1, state); }
  return state;
}

const sysOf = (list) => { const t = list.filter(Boolean).join('\n'); return t.length > 0 ? t.slice(0, 2000) : null; };

async function main() {
  const exitTimer = setTimeout(() => finish(preDeny('host', 'timeout')), SELF_EXIT_MS);
  exitTimer.unref();
  const { text, over } = await readStdin();
  let peek = null;
  try { peek = JSON.parse(text); } catch { /* malformed below */ }
  const name = isObj(peek) && typeof peek.hook_event_name === 'string' ? peek.hook_event_name : null;
  const peekLead = isObj(peek) && (name !== 'PreToolUse' || !Object.hasOwn(peek, 'agent_id')) && name !== 'SubagentStop';
  // The session start replay is bounded by its fixture count, so it gets its own, longer self-exit (the hook timeout is 10 s).
  if (name === 'SessionStart') { clearTimeout(exitTimer); setTimeout(() => finish(null), START_EXIT_MS).unref(); }
  const guardsOff = process.env.AICO_GUARDS === 'off';

  let pins = checkPins(ROOT);
  if (pins.ok) {
    // The pinned folders match, so the dependency pins module is safe to load; it covers the scripts the engine imports.
    try {
      const deps = await import(pathToFileURL(path.join(ROOT, 'hooks', 'lib', 'dep-pins.mjs')).href);
      const badDeps = deps.verifyDeps(ROOT);
      if (badDeps.length > 0) pins = { ok: false, files: badDeps };
    } catch { pins = { ok: false, files: ['hooks/lib/dep-pins.mjs'] }; }
  }
  if (!pins.ok) {
    const msg = `pins-mismatch: ${pins.files.slice(0, 5).join(', ')}`;
    if (name === 'SessionStart') return finish({ systemMessage: `aico guards: ${msg}; guards deny until the plugin is reinstalled` });
    if (guardsOff && peekLead) {
      // The pinned rule cannot be trusted, so a call that names a run record is denied by text alone.
      // JSON escapes (unicode escapes) hide words in the raw text, so these checks run on the raw text plus every decoded string.
      const decoded = decodedStrings(peek);
      // Input nested past the limit cannot be read in full, so it is denied (fail closed).
      if (name === 'PreToolUse' && decoded.tooDeep) return finish(preDeny('self-protect.M-SEC1', 'input is nested too deep to read'));
      const scan = `${text}\n${decoded.out.join('\n')}`;
      if (name === 'PreToolUse' && /(?:(?:forms|run-state|guard)\.jsonl|lead-result\.txt)/i.test(scan)) return finish(preDeny('self-protect.M-SEC1', 'run records are written by aico scripts only'));
      // The same holds for the .env read check and the answer shell block: text only, no pinned module.
      if (name === 'PreToolUse') {
        const envHit = [...scan.matchAll(/\.env(?:\.[\w.-]*)?(?![\w])/gi)].some((m) => !/^\.env\.(?:example|sample|template)$/i.test(m[0]));
        if (envHit) return finish(preDeny('dotenv.M-SEC1', '.env files are not read or written'));
        if (/lead-relay/i.test(scan) && /\b(?:answer|leadstart|leadstop|leadreset)\b/i.test(scan)) return finish(preDeny('self-protect.M-SEC1', 'answers are recorded by the CEO form only'));
        // An encoded PowerShell program hides its words, so any prefix of -EncodedCommand after any dash-like lead (-, --, /, Unicode dash) is denied here (fail closed).
        if (/pwsh|powershell/i.test(scan) && /[-\/\p{Pd}−]+(?:ec|e(?:n(?:c(?:o(?:d(?:e(?:d(?:c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?)?)?)?)?)?)?)?)(?![\p{L}\p{N}])/iu.test(scan)) return finish(preDeny('self-protect.M-SEC1', 'encoded PowerShell commands are not run without the pinned guards'));
      }
      return finish(null);
    }
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
  if (raw.hook_event_name === 'PostToolUse') return finish(null);

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
  // Lead result record (lead-relay v1.1): the relay script is loaded only after its import graph matches the pins; any failure records nothing.
  // Only a Lead's own start/stop, or main's spawn of a Lead, loads the script (no load for another Role).
  const leadResult = async (fn) => {
    if (fn === 'leadReset' ? !(event.session === 'lead' && !event.agentKey && event.tool?.leadTarget === true) : peek?.agent_type !== 'aico:project-manager') return;
    try {
      const deps = await import(pathToFileURL(path.join(ROOT, 'hooks', 'lib', 'dep-pins.mjs')).href);
      const relay = await deps.importPinned(ROOT, 'scripts/lead-relay.mjs');
      relay[fn](text, root, snap.denyDir(mcsHome, root));
    } catch { /* nothing recorded */ }
  };

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
    // The snapshot is written before the fixture check, so a self-exit mid-check leaves a valid file, not none.
    if (prov) snap.writeLead(snapCtx, drift ? { ...prov, drift: true } : prov);
    if (prov && !tableError) {
      const replay = runnerLib.createRunner(ROOT, { deadlineMs: MAX_TOTAL_FIXTURES * runnerLib.ROW_TIMEOUT_MAX_MS });
      const replayRun = (r, e, s) => replay.run({ module: r.module, export: r.export, event: e, snapshot: s, timeoutMs: r.timeoutMs });
      let failed;
      try { failed = await checkFixtures({ rows, prov, ctx, run: replayRun, ev }); } finally { replay.close(); }
      if (failed.rules.length > 0) {
        drift = true;
        const more = failed.details.length > 0 ? ` (${failed.details.join('; ')})` : '';
        notices.push(`aico guards: fixture check failed for ${failed.rules.join(', ')}${more}; guards deny, savers are off`);
      }
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
    await leadResult('leadStart');
  }

  // Run records are shielded for every session, before the off branch, with no snapshot or rule table.
  if (evName === 'PreToolUse' && event.tool) {
    let rec = null;
    try {
      const sp = await import(pathToFileURL(path.join(ROOT, 'hooks', 'rules', 'self-protect.mjs')).href);
      rec = sp.judgeRecord(event);
    } catch { rec = { v: 'deny', message: 'run records are written by aico scripts only' }; }
    if (rec && rec.v === 'deny') {
      log.appendDeny(snap.denyDir(mcsHome, root), { rule: 'self-protect.M-SEC1', kind: 'deny', session: event.sessionKey, agent: event.agentKey });
      return done(denyOut(evName, stopActive, 'self-protect.M-SEC1', rec.message, {}));
    }
  }

  // With guards off the .env read check still runs for the Lead session, before the off branch, with no snapshot or rule table.
  if (guardsOff && event.session === 'lead' && evName === 'PreToolUse' && event.tool) {
    let env = null;
    try {
      const de = await import(pathToFileURL(path.join(ROOT, 'hooks', 'rules', 'dotenv.mjs')).href);
      env = de.judge(event);
    } catch { env = { v: 'deny', message: '.env files are not read or written' }; }
    if (env && env.v === 'deny') {
      log.appendDeny(snap.denyDir(mcsHome, root), { rule: 'dotenv.M-SEC1', kind: 'deny', session: event.sessionKey, agent: event.agentKey });
      return done(denyOut(evName, stopActive, 'dotenv.M-SEC1', env.message, {}));
    }
  }

  // Engine, per hook call (mod-hook v1).
  const off = guardsOff && event.session === 'lead';
  if (off) await eff.recordGuardsOff(event, root);
  const guardRows = tableError ? [] : rows.filter((r) => r.kind === 'guard' && applies(r, event));
  let s = snap.readSnapshot(snapCtx, event);
  let rebuildCause = null;
  if (!off && !tableError && guardRows.length > 0 && !s.ok) {
    const rb = snap.rebuildSnapshot(snapCtx, event, { pluginRoot: ROOT, manifests });
    if (rb.ok) s = { ok: true, snapshot: rb.snapshot }; else rebuildCause = rb.cause;
  }
  const notes = [];
  let denied = null;
  const extra = {};
  const fail = (rule, kind, message) => { denied = { rule, kind, message }; };

  if (!off) {
    if (tableError) fail('table-invalid', 'deny', 'the rule table cannot be read');
    else if (guardRows.length > 0 && !s.ok) fail('snapshot-invalid', 'deny', REBUILD_MSG[rebuildCause] ?? REBUILD_MSG.settings);
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
    if (entry.first) {
      toast = denied.rule === 'cap.M1'
        ? 'aico cap: this session reached the context cap; later denies are only counted (see the deny log)'
        : `aico guard ${denied.rule} denied a call; later denies of this rule are only counted (see the deny log)`;
    }
    if (evName === 'SubagentStop' && !stopActive && denied.rule === 'cap.M1' && denied.kind === 'deny') eff.recordStopBlock(event);
  }
  // The Lead's final STATUS block is kept only when this stop is not blocked (lead-relay v1.1).
  if (evName === 'SubagentStop' && (!denied || stopActive)) await leadResult('leadStop');
  if (evName === 'PreToolUse' && !denied) await leadResult('leadReset');
  const msg = sysOf([...notes, extra.systemMessage, toast]);
  const rest = { ...extra };
  delete rest.systemMessage;
  delete rest.reasonSuffix;
  if (denied) {
    const full = extra.reasonSuffix ? `${denied.message} ${extra.reasonSuffix}` : denied.message;
    return done(denyOut(evName, stopActive, denied.rule, full, { ...rest, ...(msg ? { systemMessage: msg } : {}) }));
  }
  const out = { ...rest, ...(msg ? { systemMessage: msg } : {}) };
  return done(Object.keys(out).length > 0 ? out : null);
}

// Runs hooks/fixtures/<rule>/pass-*.json and block-*.json against the rule; returns the rule IDs that failed.
// The budget counts fixtures, not time, so machine load never reads as drift; a runaway set still fails closed.
async function checkFixtures({ rows, prov, ctx, run, ev }) {
  const failed = new Set();
  const details = [];
  // Only a short lowercase word is echoed; fixture names already match a strict pattern. Never free text.
  const note = (rule, name, word) => {
    if (details.length < MAX_FIXTURE_DETAILS) details.push(`${rule}/${name}: ${typeof word === 'string' && /^[a-z-]{1,16}$/.test(word) ? word : 'error'}`);
  };
  let seen = 0;
  const memo = new Map();
  for (const r of rows.filter((x) => x.kind === 'guard')) {
    const dir = path.join(ROOT, 'hooks', 'fixtures', r.rule);
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => /^(pass|block)-[A-Za-z0-9._-]+\.json$/.test(n)).sort().slice(0, MAX_FIXTURES); } catch { continue; }
    for (const n of names) {
      if (++seen > MAX_TOTAL_FIXTURES) { failed.add('fixture-budget'); return { rules: [...failed], details }; }
      const wantDeny = n.startsWith('block-');
      let verdictDeny = false;
      let verdictWord = 'verdict';
      try {
        const f = path.join(dir, n);
        if (fs.statSync(f).size > MAX_FIXTURE_BYTES) throw Object.assign(new Error('large'), { word: 'large' });
        // `_synthetic` is the fixtures' own channel for state the host reads from disk (session, tokens, run);
        // it is stripped before normalize, so a renamed real field still drifts.
        const { _synthetic: syn, ...payload } = JSON.parse(fs.readFileSync(f, 'utf8'));
        const norm = await ev.normalize(payload, { ...ctx, resolveRun: null, memo });
        if (!norm.ok || norm.event.drift.length > 0) throw Object.assign(new Error('payload'), { word: 'payload' });
        let fe = norm.event;
        if (syn && typeof syn === 'object') {
          fe = { ...fe };
          if (syn.session === 'lead' || syn.session === 'step') fe.session = syn.session;
          if (syn.tokens && typeof syn.tokens === 'object') fe.tokens = { state: syn.tokens.state, total: syn.tokens.total };
          // A relative fixture run folder is resolved against the payload cwd the way its paths are, so the same fixture
          // reads alike on every host (no drive letter in the data).
          const rf = syn.run && typeof syn.run.folder === 'string' && !path.isAbsolute(syn.run.folder) ? ev.realOf(syn.run.folder, norm.cwd) : null;
          if (syn.run !== undefined) fe.run = rf ? { ...syn.run, folder: rf } : syn.run;
          fe = Object.freeze(fe);
        }
        // A rule may have several rows (one per event); a fixture is judged only by the row(s) of its own event.
        if (r.event !== fe.event && rows.some((x) => x.rule === r.rule && x.event === fe.event)) continue;
        if (r.event === fe.event && (fe.tool === null || r.matcher.includes('*') || r.matcher.includes(fe.tool.name))) {
          const out = await run(r, fe, prov);
          verdictDeny = !out.ok || out.verdict.v === 'deny';
          if (!out.ok) verdictWord = out.word;
          if (!out.ok && wantDeny === false) throw Object.assign(new Error('failed'), { word: out.word });
        }
      } catch (e) { failed.add(r.rule); note(r.rule, n, e && e.word); continue; }
      if (verdictDeny !== wantDeny) { failed.add(r.rule); note(r.rule, n, verdictWord); }
    }
  }
  return { rules: [...failed], details };
}

// Compare realpaths: a symlinked or 8.3 short path must not turn the guard into a silent no-op.
function isMain() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] && isMain()) {
  main().catch(() => finish(preDeny('host', 'crash')));
}
