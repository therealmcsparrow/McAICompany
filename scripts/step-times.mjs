#!/usr/bin/env node
// SubagentStart / SubagentStop adapter: appends one `sub` event to the active run through run-state.
// Every path ends in exit 0 with nothing on stdout or stderr; the time is the receipt time run-state stamps.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isWorkFolder } from '../mods/lib/work-folder.mjs';

const HERE = import.meta.dirname;
const MAX_INPUT = 64 * 1024;
const DEADLINE_MS = 4000;
const CALL_MS = 3000;
const PHASES = new Set(['start', 'stop']);
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Agent file names are role ids: lower-case words joined by single hyphens.
const AGENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_AGENT_NAME = 64;

function agentSlugs(dir) {
  try {
    return new Set(readdirSync(dir).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)).filter((s) => s.length <= MAX_AGENT_NAME && AGENT_RE.test(s)));
  } catch {
    return new Set();
  }
}

function field(obj, key) {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

// Reduces the hook payload to the allowed fields, or null when it has no usable agent id.
export function extract(text, slugs) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const agentId = field(data, 'agent_id');
  if (typeof agentId !== 'string' || agentId.length === 0 || agentId.length > 512) return null;
  const type = field(data, 'agent_type');
  const role = typeof type === 'string' && slugs.has(type) ? type : 'other';
  const sid = field(data, 'session_id');
  const out = { role, id: createHash('sha256').update(agentId).digest('hex').slice(0, 12) };
  if (typeof sid === 'string' && SESSION_RE.test(sid)) out.session = sid;
  return out;
}

function call(runStatePath, args, cwd, timeout) {
  return new Promise((resolve) => {
    if (timeout < 50) return resolve(null);
    try {
      execFile(process.execPath, [runStatePath, ...args], { cwd, timeout, windowsHide: true, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL' },
        (err, stdout) => resolve(err ? null : String(stdout)));
    } catch {
      resolve(null);
    }
  });
}

// Never throws; resolves when done or when nothing could be written.
export async function handle(text, phase, { runStatePath = join(HERE, 'run-state.mjs'), cwd = process.cwd(), agentsDir = join(HERE, '..', 'agents'), startedAt = Date.now() } = {}) {
  try {
    if (!PHASES.has(phase)) return;
    const rec = extract(text, agentSlugs(agentsDir));
    if (!rec) return;
    const left = () => Math.min(CALL_MS, DEADLINE_MS - (Date.now() - startedAt));
    const act = await call(runStatePath, ['active', '--json'], cwd, left());
    if (act === null) return;
    let slug;
    try { slug = JSON.parse(act).slug; } catch { return; }
    if (!isWorkFolder(slug)) return;
    const args = ['sub', slug, phase, rec.role, rec.id, ...(rec.session ? [rec.session] : [])];
    await call(runStatePath, args, cwd, left());
  } catch {
    // the hook never fails
  }
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    process.stdin.on('data', (c) => {
      size += c.length;
      if (size > MAX_INPUT) return finish(null);
      chunks.push(c);
    });
    process.stdin.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => finish(null));
  });
}

export async function main(phase, opts = {}) {
  const startedAt = Date.now();
  const timer = setTimeout(() => process.exit(0), DEADLINE_MS);
  try {
    const text = await readStdin();
    if (text !== null) await handle(text, phase, { ...opts, startedAt });
  } catch {
    // the hook never fails
  }
  clearTimeout(timer);
  process.exit(0);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main(process.argv[2]);
}
