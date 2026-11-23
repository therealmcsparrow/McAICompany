#!/usr/bin/env node
// contract: docs/contracts/step-times.md v1.4
// SubagentStart / SubagentStop adapter: appends one `sub` event to the active run through run-state.
// Every path ends in exit 0 with nothing on stdout or stderr; the time is the receipt time run-state stamps.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isRunSlug } from '../mods/lib/work-folder.mjs';

const HERE = import.meta.dirname;
const MAX_INPUT = 64 * 1024;
const DEADLINE_MS = 4000;
const CALL_MS = 3000;
const PHASES = new Set(['start', 'stop']);
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Agent file names are role ids: lower-case words joined by single hyphens.
const AGENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_AGENT_NAME = 64;
const LEAD_TYPE = 'aico:project-manager';
const MAX_TRANSCRIPT = 64 * 1024 * 1024;
const LEDGER_AGENT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OUTPUT_RE = /^Output:[ \t]*(\S+)[ \t]*$/m;
const STEP_FILE_RE = /^(\d{2,3})-([a-z][a-z0-9-]{0,40})\.md$/;

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
  if (type === LEAD_TYPE) return null; // v1.3: the Lead agent has no sub row and no step file
  const role = typeof type === 'string' && slugs.has(type) ? type : 'other';
  const sid = field(data, 'session_id');
  const out = { role, id: createHash('sha256').update(agentId).digest('hex').slice(0, 12) };
  if (typeof sid === 'string' && SESSION_RE.test(sid)) out.session = sid;
  return out;
}

// Reads the Step transcript: the dispatch Output line (first user row), the last context size and the tool_use count.
function readTranscript(file) {
  if (typeof file !== 'string' || !isAbsolute(file) || !file.endsWith('.jsonl')) return null;
  const st = statSync(file);
  if (!st.isFile() || st.size > MAX_TRANSCRIPT) return null;
  let output = null;
  let ctx = null;
  let tools = 0;
  let sawUser = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row === null || typeof row !== 'object') continue;
    const msg = row.message;
    if (row.type === 'user' && !sawUser) {
      sawUser = true;
      const c = msg?.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('\n') : '';
      const m = text.match(OUTPUT_RE);
      if (m) output = m[1];
    } else if (row.type === 'assistant' && msg && typeof msg === 'object') {
      const u = msg.usage;
      if (u && typeof u === 'object') {
        const n = (k) => (Number.isSafeInteger(u[k]) && u[k] >= 0 ? u[k] : 0);
        ctx = n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens') + n('output_tokens');
      }
      if (Array.isArray(msg.content)) tools += msg.content.filter((b) => b?.type === 'tool_use').length;
    }
  }
  return { output, ctx, tools };
}

// { id, role } from an Output path whose file name is <NN>-<role>.md and that has no `..` segment, else null.
function stepOf(output) {
  if (typeof output !== 'string') return null;
  const parts = output.split(/[\\/]/);
  if (parts.includes('..')) return null;
  const m = parts[parts.length - 1].match(STEP_FILE_RE);
  return m ? { id: m[1], role: m[2] } : null;
}

// SubagentStop: one ledger row for the Step (Output line) or the Lead. Never throws, writes nothing on any failure.
async function writeLedger(data, slug, root) {
  try {
    const agent = Object.hasOwn(data, 'agent_id') ? data.agent_id : undefined;
    if (typeof agent !== 'string' || !LEDGER_AGENT_RE.test(agent)) return;
    const t = readTranscript(Object.hasOwn(data, 'agent_transcript_path') ? data.agent_transcript_path : undefined);
    if (!t || t.ctx === null) return;
    const lead = Object.hasOwn(data, 'agent_type') && data.agent_type === LEAD_TYPE;
    const step = lead ? null : stepOf(t.output);
    if (!lead && !step) return;
    const { addFromHook } = await import('./ledger.mjs');
    addFromHook(lead
      ? { run: slug, kind: 'lead', role: 'lead', agent, ctx_end: t.ctx, tool_uses: t.tools }
      : { run: slug, kind: 'step', id: step.id, role: step.role, agent, ctx_end: t.ctx, tool_uses: t.tools }, { root });
  } catch {
    // no row on any failure
  }
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
    let data = null;
    try { data = JSON.parse(text); } catch { /* no row below */ }
    const isObj = data !== null && typeof data === 'object' && !Array.isArray(data);
    const lead = phase === 'stop' && isObj && Object.hasOwn(data, 'agent_type') && data.agent_type === LEAD_TYPE;
    if (!rec && !lead) return;
    const left = () => Math.min(CALL_MS, DEADLINE_MS - (Date.now() - startedAt));
    const act = await call(runStatePath, ['active', '--json'], cwd, left());
    if (act === null) return;
    let slug;
    try { slug = JSON.parse(act).slug; } catch { return; }
    if (!isRunSlug(slug)) return;
    if (rec) {
      const args = ['sub', slug, phase, rec.role, rec.id, ...(rec.session ? [rec.session] : [])];
      await call(runStatePath, args, cwd, left());
    }
    if (phase === 'stop' && isObj && left() > 200) await writeLedger(data, slug, cwd);
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
