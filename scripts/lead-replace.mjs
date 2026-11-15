#!/usr/bin/env node
// contract: docs/contracts/lead-session-mcp.md v2.1
// Helper started by the lead-session server: waits for background tasks and the end of the turn, then types /clear and the hand-over
// prompt into the claude console. Usage: lead-replace.mjs <slug> <claudePid>. Exit 0 typed, 1 failed, 2 bad arguments.
// The state is in lead-replace.json of the run folder (atomic rename); phase lines go to stderr. Only two fixed texts are ever typed.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { env, platform as osPlatform, stderr, exit, argv as processArgv, cwd } from 'node:process';
import { pathToFileURL } from 'node:url';
import { readSmall, workDir, newSessionCommand } from './lead-handover.mjs';
import { isRunSlug } from '../mods/lib/work-folder.mjs';
import { typer } from './lib/lead-typer.mjs';

const PID_RE = /^[1-9][0-9]{0,9}$/;
const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const POLL_MS = 2000;
const TURN_MS = 10 * 60 * 1000;
const CLEAR_MS = 15 * 1000;
const CLEAR_POLL_MS = 500;
const SETTLE_MS = 2000;
const MAX_FILE = 16 * 1024 * 1024;
const MAX_SMALL = 64 * 1024;
const SHELLS = new Set(['bash', 'sh', 'pwsh', 'powershell', 'cmd']);

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isShell = (image) => typeof image === 'string' && SHELLS.has(image.toLowerCase().replace(/\.exe$/, ''));

function jsonRows(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    try { const o = JSON.parse(line); if (o && typeof o === 'object') rows.push(o); } catch { /* skip a broken line */ }
  }
  return rows;
}

// Epoch ms of the `at` of the first background-launch row of `session`, or null when the session launched none.
function firstBackground(dir, session) {
  const text = readSmall(path.join(dir, 'guard.jsonl'), MAX_FILE);
  if (text === null) return null;
  for (const o of jsonRows(text)) {
    if (o.ev === 'bg' && o.session === session) {
      const t = Date.parse(o.at);
      if (Number.isFinite(t)) return t;
    }
  }
  return null;
}

// 'done' once no background shell of the claude process lives (onLive(t) gets the start time of each poll that saw one), 'failed: session gone' when claude ends first.
export async function backgroundDone({ dir, session, claudePid, list, alive, now = Date.now, sleep = realSleep, onLive }) {
  const cutoff = firstBackground(dir, session);
  if (cutoff === null) return 'done';
  let prev = new Set();
  const live = new Map();   // pid -> polls in a row it has been missing; a pid is live once seen in two polls in a row
  let idle = 0;
  for (;;) {
    if (!alive(claudePid)) return 'failed: session gone';
    const t = now();
    const rows = await list(claudePid);
    const cur = new Set();
    for (const r of rows) {
      if (r && isShell(r.image) && Number.isFinite(r.created) && r.created >= cutoff) cur.add(r.pid);
    }
    for (const p of cur) if (prev.has(p)) live.set(p, 0);
    for (const [p, missed] of [...live]) {
      if (cur.has(p)) continue;
      if (missed + 1 >= 2) live.delete(p); else live.set(p, missed + 1);
    }
    if (onLive && cur.size > 0 && [...cur].some((p) => live.has(p))) onLive(t);
    idle = live.size === 0 ? idle + 1 : 0;
    if (idle >= 2) return 'done';
    prev = cur;
    await sleep(POLL_MS);
  }
}

function readReading(dir) {
  const text = readSmall(path.join(dir, 'lead-context.json'), MAX_SMALL);
  if (text === null) return null;
  try {
    const o = JSON.parse(text);
    return o && typeof o === 'object' && typeof o.session === 'string' ? o : null;
  } catch { return null; }
}

// 'done' once the Stop reading of `session` is at or after armAt and at or after idleAt (epoch ms, the start of the last poll that saw a live
// background task, so the task ended later): a turn that began after that moment is the one to wait for. 'failed: turn' after 10 minutes. `onAccept(reading)` gets the reading that was accepted.
export async function turnOver({ dir, session, armAt, idleAt = 0, claudePid, alive = () => true, now = Date.now, sleep = realSleep, onAccept }) {
  // Readings keep whole seconds, so the arm time is compared at whole seconds too.
  const arm = Math.max(Math.floor(Date.parse(armAt) / 1000) * 1000, Math.floor(idleAt / 1000) * 1000);
  if (!Number.isFinite(arm)) return 'failed: turn';
  const start = now();
  for (;;) {
    if (!alive(claudePid)) return 'failed: session gone';
    const o = readReading(dir);
    if (o && o.session === session && Date.parse(o.at) >= arm) { if (onAccept) onAccept(o); return 'done'; }
    if (now() - start >= TURN_MS) return 'failed: turn';
    await sleep(POLL_MS);
  }
}

// The turn mark written at the start of a Lead turn or tool call: null when there is none, 'bad' when the file cannot be read.
function readMark(dir) {
  const text = readSmall(path.join(dir, 'lead-turn.json'), MAX_SMALL);
  if (text === null) return null;
  try {
    const o = JSON.parse(text);
    return o && typeof o === 'object' && typeof o.session === 'string' && Number.isFinite(Date.parse(o.at)) ? o : 'bad';
  } catch { return 'bad'; }
}

// True when the mark of any main session is newer than the Stop reading `since` (readings keep whole seconds, so the mark is cut to whole seconds).
// The single mark file holds only the last writer, so another session's mark could hide the Lead's turn: any newer mark fails closed.
function turnSince(dir, since) {
  const m = readMark(dir);
  if (m === null) return false;
  if (m === 'bad') return true;
  return Math.floor(Date.parse(m.at) / 1000) * 1000 > Date.parse(since.at);
}

function powershellPath() {
  const root = typeof env.SystemRoot === 'string' && /^[A-Za-z]:\\[^"<>|?*\r\n]*$/.test(env.SystemRoot) ? env.SystemRoot : 'C:\\Windows';
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function defaultRun(argv, input) {
  const r = spawnSync(argv[0], argv.slice(1), { input, shell: false, windowsHide: true, timeout: 30000, stdio: ['pipe', 'ignore', 'ignore'] });
  return { status: r.status };
}

const typedStatus = (status) => (status === 0 ? 'typed' : status === 1 || status === null || status === undefined ? 'failed: attach' : 'failed: type');

// Types /clear + Enter, waits for a new session, then types the text + Enter. Windows only.
// Before each send the pid must still live and, when `identify` is given, still be the process seen at start (`baseline` {image, created}); else nothing is typed.
export async function typeInto(text, { platform = osPlatform, run = defaultRun, dir, session, claudePid, alive = () => true, identify = null, baseline = null, accepted = null, now = Date.now, sleep = realSleep }) {
  const build = typer(platform);
  if (build === null) return 'unsupported';
  const argv = [powershellPath(), ...build(claudePid)];
  const same = async () => {
    if (!alive(claudePid)) return false;
    if (identify === null) return true;
    try {
      const cur = await identify(claudePid);
      return Boolean(baseline && cur && cur.image === baseline.image && cur.created === baseline.created);
    } catch { return false; }
  };
  // ok() re-reads lead-context.json right before the send; false means a new turn started, so nothing is typed.
  const send = async (s, ok) => {
    if (!(await same())) return 'failed: session gone';
    if (!ok()) return 'failed: turn changed';
    return typedStatus((await run(argv, Buffer.from(`${s}\r`, 'utf8'))).status);
  };
  // The Stop reading the turn-over wait accepted; without one, the reading found now.
  const stop = accepted ?? readReading(dir);
  const first = await send('/clear', () => {
    const o = readReading(dir);
    return Boolean(stop) && Boolean(o) && o.session === session && stop.session === session && o.at === stop.at && !turnSince(dir, stop);
  });
  if (first !== 'typed') return first;
  const start = now();
  let seen;
  for (;;) {
    const o = readReading(dir);
    if (o && o.session !== session) { seen = o; break; }
    if (now() - start >= CLEAR_MS) return 'failed: clear';
    await sleep(CLEAR_POLL_MS);
  }
  await sleep(SETTLE_MS);
  return send(text, () => {
    const o = readReading(dir);
    return Boolean(o) && o.session === seen.session && o.at === seen.at && !turnSince(dir, seen);
  });
}

// Direct children of the claude process: [{ pid, image, created }], created in epoch ms.
function listChildren(claudePid) {
  const script = `$ErrorActionPreference='Stop'; ConvertTo-Json -Compress @(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${claudePid}' | ForEach-Object { @{ pid=[int]$_.ProcessId; image=[string]$_.Name; created=[int64]([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } })`;
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script];
  return new Promise((resolve, reject) => {
    execFile(powershellPath(), args, { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, shell: false }, (err, out) => {
      if (err) { reject(err); return; }
      try {
        const v = JSON.parse(String(out).trim() || '[]');
        resolve(Array.isArray(v) ? v : [v]);
      } catch (e) { reject(e); }
    });
  });
}

// { image, created } of one process, or null when it is gone. Windows only (CIM, like listChildren).
function identifyPid(pid) {
  const script = `$ErrorActionPreference='Stop'; $p = Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}'; if ($p) { ConvertTo-Json -Compress @{ image=[string]$p.Name; created=[int64]([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() } }`;
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script];
  return new Promise((resolve, reject) => {
    execFile(powershellPath(), args, { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, shell: false }, (err, out) => {
      if (err) { reject(err); return; }
      try { const t = String(out).trim(); resolve(t ? JSON.parse(t) : null); } catch (e) { reject(e); }
    });
  });
}

const alivePid = (pid) => {
  try { process.kill(Number(pid), 0); return true; } catch (e) { return Boolean(e && e.code === 'EPERM'); }
};

function readArm(dir) {
  const text = readSmall(path.join(dir, 'lead-replace.json'), MAX_SMALL);
  if (text === null) return null;
  try {
    const o = JSON.parse(text);
    if (!o || o.v !== 1 || typeof o.session !== 'string' || !SESSION_RE.test(o.session)) return null;
    if (typeof o.armAt !== 'string' || !Number.isFinite(Date.parse(o.armAt))) return null;
    return o;
  } catch { return null; }
}

function writeState(dir, arm, state) {
  const file = path.join(dir, 'lead-replace.json');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ v: 1, session: arm.session, armAt: arm.armAt, state })}\n`);
  try { fs.renameSync(tmp, file); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}

export function checkArgs(args) {
  if (args.length !== 2) return null;
  const [slug, pid] = args;
  if (typeof slug !== 'string' || slug.length > 200 || !isRunSlug(slug) || !PID_RE.test(pid)) return null;
  return { slug, pid };
}

export async function main(args, root = cwd(), deps = {}) {
  const { list = listChildren, alive = alivePid, now = Date.now, sleep = realSleep, type = typeInto, identify = identifyPid } = deps;
  const a = checkArgs(args);
  if (a === null) { stderr.write('usage: lead-replace.mjs <slug> <claudePid>\n'); return 2; }
  const dir = workDir(root, a.slug);
  if (dir === null) { stderr.write('lead-replace: no such run folder\n'); return 2; }
  const arm = readArm(dir);
  if (arm === null) { stderr.write('lead-replace: no valid arm file\n'); return 1; }
  const text = newSessionCommand(a.slug)?.match(/^claude "(.*)"$/s)?.[1];
  if (!text) { stderr.write('lead-replace: bad slug\n'); return 1; }
  const t0 = Date.now();
  let phase = 'waiting-background';
  const beat = setInterval(() => stderr.write(`lead-replace: ${phase} ${Math.round((Date.now() - t0) / 1000)}s\n`), 10000);
  const step = (state) => { phase = state; stderr.write(`lead-replace: ${state}\n`); writeState(dir, arm, state); };
  try {
    stderr.write('lead-replace: start, 3 phases (background, turn, type)\n');
    step('waiting-background');
    const pid = Number(a.pid);
    let baseline = null;
    try { baseline = await identify(pid); } catch { /* no baseline: typeInto then refuses to type */ }
    let idleAt = 0;
    const bg = await backgroundDone({ dir, session: arm.session, claudePid: pid, list, alive, now, sleep, onLive: (t) => { idleAt = t; } });
    if (bg !== 'done') { step(bg); return 1; }
    step('waiting-turn');
    let accepted = null;
    const turn = await turnOver({ dir, session: arm.session, armAt: arm.armAt, idleAt, claudePid: pid, alive, now, sleep, onAccept: (o) => { accepted = o; } });
    if (turn !== 'done') { step(turn); return 1; }
    step('typing');
    const out = await type(text, { dir, session: arm.session, claudePid: pid, alive, identify, baseline, accepted });
    step(out === 'typed' ? 'typed' : out === 'unsupported' ? 'failed: unsupported terminal' : out);
    stderr.write(`lead-replace: end ${out}, ${Math.round((Date.now() - t0) / 1000)}s\n`);
    return out === 'typed' ? 0 : 1;
  } catch {
    try { writeState(dir, arm, 'failed: error'); } catch { /* state is best effort here */ }
    return 1;
  } finally {
    clearInterval(beat);
  }
}

if (processArgv[1] && import.meta.url === pathToFileURL(processArgv[1]).href) {
  exit(await main(processArgv.slice(2)));
}
