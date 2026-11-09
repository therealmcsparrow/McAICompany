// Pure logic of the Blast Radius mod: hits from a `review-depth --json` answer, the ask/warn/deny decision,
// the reason text and the script arguments. No engine object, no Node import, no npm package.
import { cleanText, parseOutputLine } from './guard.mjs';
import { isRunSlug } from './work-folder.mjs';

export const MAX_REASON = 600;
export const NOBODY = 'nobody can be asked; commit refused';

const CATEGORIES = ['core', 'contract', 'security'];
const NAMES = { core: 'Core', contract: 'Contract', security: 'Security' };
const MAX_PROMPT = 65536;
const MAX_LINE = 300;
const MAX_REPO = 4096;
const MAX_LISTING = 8000;
const MAX_PATH_IN_REASON = 120;
const MAX_MODULES_IN_REASON = 120;
const MAX_LABEL = 60;
const MORE_ROOM = 14;

const BASE = /^Base commit: ([0-9a-f]{40}|[0-9a-f]{64})$/;
const TIER = /^Risk tier: (low|medium|high)$/;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

// The prompt lines Blast Radius reads, from the first 64 KiB. A missing or odd line is null.
export function parseSpawnLines(prompt) {
  const out = { slug: null, step: null, role: null, base: null, tier: null };
  if (typeof prompt !== 'string') return out;
  const cutOff = prompt.length > MAX_PROMPT;
  const lines = (cutOff ? prompt.slice(0, MAX_PROMPT) : prompt).split('\n');
  if (cutOff) lines.pop();
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.length > MAX_LINE) continue;
    let m;
    const output = out.step === null ? parseOutputLine(line) : null;
    if (output !== null) {
      out.slug = output.slug;
      out.step = output.step;
      out.role = output.role;
    } else if (out.base === null && (m = BASE.exec(line)) !== null) out.base = m[1];
    else if (out.tier === null && (m = TIER.exec(line)) !== null) out.tier = m[1];
  }
  return out;
}

// `<Step> <role>` of a subagent, or null when either part is not what the dispatch line allows.
export function agentLabel(step, role) {
  if (typeof step !== 'string' || typeof role !== 'string') return null;
  return /^\d{2,3}$/.test(step) && /^[a-z][a-z0-9-]{0,40}$/.test(role) ? `${step} ${role}` : null;
}

// Arguments after the script name for `review-depth.mjs`, or null when a part is not safe to pass.
// A commit is always read as worktree + staged + untracked; there is no staged-only source.
export function reviewArgs(spec) {
  if (spec === null || typeof spec !== 'object') return null;
  let args;
  if (spec.source === 'worktree') args = ['--worktree', '--json'];
  else if (spec.source === 'base' && typeof spec.base === 'string' && SHA.test(spec.base) && isRunSlug(spec.slug)) args = [spec.base, '--run', spec.slug, '--json'];
  else return null;
  if (spec.risk === 'low' || spec.risk === 'medium' || spec.risk === 'high') args.push('--risk', spec.risk);
  const repo = spec.repo;
  if (repo !== undefined && repo !== null) {
    if (typeof repo !== 'string' || repo.length < 1 || repo.length > MAX_REPO || repo.startsWith('-') || CONTROL.test(repo)) return null;
    args.push('--repo', repo);
  }
  return args;
}

function unique(list, max) {
  const seen = new Set();
  for (const item of list) {
    if (item === null || item === undefined || seen.has(item)) continue;
    seen.add(item);
    if (seen.size >= max) break;
  }
  return [...seen];
}

// Hits of a guarded `review-depth --json` value. The tier and depth are the script's own words.
export function hitsFromDepth(depth) {
  const hits = { core: [], contract: [], security: [], modules: [], tier: depth.tier, depth: depth.depth, files: depth.paths.length };
  for (const p of depth.paths) {
    for (const c of CATEGORIES) if (p.categories.includes(c)) hits[c].push(p.path);
  }
  hits.modules = unique(depth.paths.map((p) => p.module), 20);
  const reasons = Array.isArray(depth.reasons) ? depth.reasons : [];
  // Any answer the script gave up on (not the tier reason) leaves the diff unjudged, so it counts as an unknown hit.
  for (const r of reasons) if (r.path === '*' && r.rule !== 'risk tier — high') hits.security.push(`unknown (${r.rule})`);
  if (depth.truncated === true) hits.security.push('unknown (list truncated)');
  return hits;
}

// The script failed or could not run: one security hit, so the gate fails closed.
export function unknownHits() {
  return { core: [], contract: [], security: ['unknown'], modules: [], tier: 'unknown', depth: 'full', files: 0 };
}

function levelOf(gate, category) {
  if (gate === null || typeof gate !== 'object' || !Object.hasOwn(gate, category)) return 'ask';
  return gate[category] === 'warn' ? 'warn' : 'ask';
}

// { action: 'none' | 'warn' | 'ask' | 'deny', warn }. Never allow; a level that is not exactly `warn` asks.
export function decide(hits, gate, approver) {
  const active = CATEGORIES.filter((c) => hits[c].length > 0);
  if (active.length === 0) return { action: 'none', warn: null };
  if (active.every((c) => levelOf(gate, c) === 'warn')) {
    return { action: 'warn', warn: { category: active[0], count: hits[active[0]].length } };
  }
  return { action: approver === 'person' || approver === 'host' ? 'ask' : 'deny', warn: null };
}

// The text for the model (deny) and the person's dialog (ask). At most 600 characters; the refusal sentence is kept.
export function buildReason(hits, action, label) {
  const clean = typeof label === 'string' && label !== '' ? cleanText(label, MAX_LABEL) : undefined;
  const prefix = clean === undefined ? '' : `From subagent ${clean}: `;
  const modules = cleanText(hits.modules.length > 0 ? hits.modules.join(', ') : 'none', MAX_MODULES_IN_REASON);
  const tail = ` Tier ${hits.tier}, review depth ${hits.depth}. Modules: ${modules}.` + (action === 'deny' ? ` Refusing here: ${NOBODY}.` : '');
  const lead = 'Blast Radius: ';
  let room = MAX_REASON - prefix.length - lead.length - tail.length - MORE_ROOM;
  const shown = { core: [], contract: [], security: [] };
  let hidden = 0;
  let isFull = false;
  for (const c of CATEGORIES) {
    for (const p of hits[c]) {
      const item = cleanText(p, MAX_PATH_IN_REASON);
      const cost = item.length + 2 + (shown[c].length === 0 ? NAMES[c].length + 4 : 0);
      if (isFull || cost > room) {
        isFull = true;
        hidden++;
      } else {
        shown[c].push(item);
        room -= cost;
      }
    }
  }
  const sections = CATEGORIES.filter((c) => shown[c].length > 0).map((c) => `${NAMES[c]}: ${shown[c].join(', ')}`);
  let body = sections.join('; ');
  if (hidden > 0) body += `${body === '' ? '' : ' '}(+${hidden} more)`;
  if (body === '') body = 'no hits';
  return cleanText(prefix + lead + body + '.' + tail, MAX_REASON);
}

// The full list for the log: files, Modules, Contracts, Core items, tier and depth.
export function listing(hits) {
  const lines = [`Blast Radius: ${hits.files} files. Tier ${hits.tier}, review depth ${hits.depth}.`];
  for (const c of CATEGORIES) if (hits[c].length > 0) lines.push(`${NAMES[c]}: ${hits[c].join(', ')}`);
  lines.push(`Modules: ${hits.modules.length > 0 ? hits.modules.join(', ') : 'none'}`);
  return lines.join('\n').slice(0, MAX_LISTING);
}
