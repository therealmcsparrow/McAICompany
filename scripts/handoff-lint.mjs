#!/usr/bin/env node
// Lints a Handoff file: machine-read parts stay English whatever `Language:` is (dispatch-prompt v2).
// The input is written by an LLM, so it is size-capped and read with anchored, linear patterns only.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_BYTES = 64 * 1024;
const MAX_FM_LINE = 1000;
const STATUS = new Set(['done', 'blocked', 'needs-ceo', 'handover']);
const RISK = new Set(['low', 'medium', 'high']);
const DEPTH = new Set(['quick', 'deep']);
const TAGS = new Set(['contract', 'spec', 'security', 'test']);
const KEYS = new Set(['step', 'role', 'task', 'status', 'round', 'base-commit', 'risk-tier', 'acceptance-ids',
  'files-touched', 'fetches', 'depth', 'degraded']);
const REQUIRED = ['step', 'role', 'task', 'status', 'round', 'base-commit', 'risk-tier'];
const REQUIRED_HEADINGS = ['Did', 'Blocking', 'Next'];
const LIST_KEYS = new Set(['acceptance-ids', 'files-touched']);

function value(raw) {
  const i = raw.indexOf(' #');
  return (i < 0 ? raw : raw.slice(0, i)).trim();
}

function list(v) {
  const m = /^\[(.*)\]$/.exec(v);
  if (!m) return null;
  return m[1].split(',').map(s => s.trim()).filter(Boolean);
}

// Returns { errors, routing }. `routing` holds only the fields later Steps and the Lead read.
export function lint(text) {
  const errors = [];
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { errors: ['file too large'], routing: null };
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return { errors: ['missing frontmatter'], routing: null };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { errors: ['unterminated frontmatter'], routing: null };

  const fm = Object.create(null);
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (line.length > MAX_FM_LINE) { errors.push(`line ${i + 1}: frontmatter line too long`); continue; }
    const m = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
    if (!m) { errors.push(`line ${i + 1}: not a key: value line`); continue; }
    if (!KEYS.has(m[1])) { errors.push(`line ${i + 1}: unknown frontmatter key (keys are English)`); continue; }
    fm[m[1]] = value(m[2]);
  }
  for (const k of REQUIRED) if (!(k in fm)) errors.push(`frontmatter: missing ${k}`);
  if ('status' in fm && !STATUS.has(fm.status)) errors.push('frontmatter: status must be done|blocked|needs-ceo|handover');
  if ('risk-tier' in fm && !RISK.has(fm['risk-tier'])) errors.push('frontmatter: risk-tier must be low|medium|high');
  if ('depth' in fm && !DEPTH.has(fm.depth)) errors.push('frontmatter: depth must be quick|deep');
  if ('round' in fm && !/^\d{1,3}$/.test(fm.round)) errors.push('frontmatter: round must be a number');
  for (const k of LIST_KEYS) if (k in fm && list(fm[k]) === null) errors.push(`frontmatter: ${k} must be a [list]`);

  const headings = new Set();
  const tags = [];
  let section = '';
  for (let i = end + 1; i < lines.length; i++) {
    const line = lines[i];
    const h = /^## (.*)$/.exec(line);
    if (h) { section = h[1].trim(); headings.add(section); continue; }
    if (section === 'Blocking') {
      const b = /^- (.*)$/.exec(line);
      if (!b) continue;
      const body = b[1];
      if (body === 'none' || body.startsWith('(none')) continue;
      const t = /^\[([^\]\s]{1,40})\]/.exec(body);
      if (!t || !TAGS.has(t[1])) errors.push(`line ${i + 1}: blocking item needs a [contract|spec|security|test] tag`);
      else tags.push(t[1]);
    }
  }
  for (const h of REQUIRED_HEADINGS) if (!headings.has(h)) errors.push(`missing English heading ## ${h}`);

  const routing = {
    status: fm.status ?? null,
    round: fm.round ?? null,
    'base-commit': fm['base-commit'] ?? null,
    'risk-tier': fm['risk-tier'] ?? null,
    'acceptance-ids': list(fm['acceptance-ids'] ?? '') ?? [],
    'files-touched': list(fm['files-touched'] ?? '') ?? [],
    blocking: tags,
  };
  return { errors, routing };
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const file = process.argv[2];
  if (!file) { console.log('usage: node scripts/handoff-lint.mjs <handoff.md>'); process.exit(2); }
  if (statSync(file).size > MAX_BYTES) { console.log('ERROR file too large'); process.exit(1); }
  const { errors, routing } = lint(readFileSync(file, 'utf8'));
  errors.forEach(e => console.log(`ERROR ${e}`));
  if (!errors.length) console.log(JSON.stringify(routing));
  process.exit(errors.length ? 1 : 0);
}
