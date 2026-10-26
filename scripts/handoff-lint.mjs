#!/usr/bin/env node
// Lints a Handoff file (handoff v1.1): machine-read parts stay English whatever `Language:` is (dispatch-prompt v2).
// The input is written by an LLM, so it is size-capped and read with anchored, linear patterns only (proj.M1 to M4).
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_BYTES = 64 * 1024;
const MAX_LINE = 1000;
const STATUS = new Set(['done', 'blocked', 'needs-ceo', 'handover']);
const RISK = new Set(['low', 'medium', 'high']);
const DEPTH = new Set(['quick', 'deep']);
const TAGS = new Set(['contract', 'spec', 'security', 'test']);
const LEDGER_STATUS = new Set(['open', 'fixed', 'withdrawn']);
const KEYS = new Set(['step', 'role', 'task', 'status', 'round', 'base-commit', 'risk-tier', 'acceptance-ids',
  'files-touched', 'fetches', 'depth', 'degraded']);
const REQUIRED = ['step', 'role', 'task', 'status', 'round', 'base-commit', 'risk-tier'];
const REQUIRED_HEADINGS = ['Did', 'Blocking', 'Next'];
const LIST_KEYS = new Set(['acceptance-ids', 'files-touched']);
// The seven keys of the aico-top block, in their fixed order.
const TOP_KEYS = ['status', 'files', 'ac_ids', 'rule_ids', 'risks', 'read_next', 'tokens_used'];
const ID_RE = /^[RCT]-\d{1,4}$/;
const RULE_RE = /^[a-z][a-z0-9-]{0,30}\.(M|S|Y)(-SEC)?\d{1,3}$/;
const AC_RE = /^[A-Za-z0-9._-]{1,40}$/;
const PATH_RE = /^[^\s\x00-\x1f\x7f,]{1,260}$/;
const POINTER_RE = /^[^\s\x00-\x1f\x7f,]{1,200}$/;
const LOC_RE = /^([^\s:]{1,260})(?::(\d{1,6})(?:-(\d{1,6}))?)?$/;
const NONE_RE = /^(none|\(none[^)]{0,100}\))\.?$/i;
const ROW_SHAPED_RE = /^(\[[^\]\s]{1,40}\] )?[A-Za-z]{1,3}-[A-Za-z0-9]{1,6} \|/;
const ID_ERR = 'finding ID must be R-, C- or T-<n>';

function value(raw) {
  const i = raw.indexOf(' #');
  return (i < 0 ? raw : raw.slice(0, i)).trim();
}

// Lenient list for the frontmatter (v1.0 behaviour).
function list(v) {
  const m = /^\[(.*)\]$/.exec(v);
  if (!m) return null;
  return m[1].split(',').map(s => s.trim()).filter(Boolean);
}

// Strict list for the top block: an empty item is an error.
function strictList(v) {
  const m = /^\[(.*)\]$/.exec(v);
  if (!m) return null;
  if (m[1].trim() === '') return [];
  const items = m[1].split(',').map(s => s.trim());
  return items.some(s => s === '') ? null : items;
}

function sameSet(a, b) {
  const sa = new Set(a), sb = new Set(b);
  return sa.size === sb.size && [...sa].every(x => sb.has(x));
}

// Parses `ID-less` row fields after the tag; returns an error text or null. `parts` = [ID, loc, problem, why, fix].
function checkRow(parts, allowRange) {
  if (parts.length !== 5) return `row needs 5 fields: ID | file:line | problem | why | fix (got ${parts.length})`;
  const [id, loc, problem, why, fix] = parts;
  if (!ID_RE.test(id)) return ID_ERR;
  const m = LOC_RE.exec(loc);
  if (!m || (m[3] !== undefined && (!allowRange || Number(m[3]) < Number(m[2])))) {
    return allowRange ? 'bad location, expected file or file:line or file:line-line' : 'bad location, expected file or file:line';
  }
  if (!problem) return 'problem is empty';
  if (!why) return 'why is empty (a rule ID plus a few words, or a plain reason)';
  if (!fix) return 'fix is empty';
  return null;
}

function frontmatterOf(lines, errors, keys, required) {
  const end = lines.indexOf('---', 1);
  const fm = Object.create(null);
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (line.length > MAX_LINE) { errors.push(`line ${i + 1}: frontmatter line too long`); continue; }
    const m = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
    if (!m) { errors.push(`line ${i + 1}: not a key: value line`); continue; }
    if (!keys.has(m[1])) { errors.push(`line ${i + 1}: unknown frontmatter key (keys are English)`); continue; }
    fm[m[1]] = value(m[2]);
  }
  for (const k of required) if (!(k in fm)) errors.push(`frontmatter: missing ${k}`);
  return { fm, end };
}

// Checks the first aico-top block against the frontmatter. Returns the parsed top or null.
function checkTop(block, lines, byEnd, fm, findingIds, errors) {
  const e = msg => errors.push(`aico-top: ${msg}`);
  const before = errors.length;
  if (block.close === null) { e('unclosed aico-top block'); return null; }
  if (block.open !== byEnd + 1 || !/^By: \S/.test(lines[byEnd] ?? '')) {
    e(`block must come directly after the By line (line ${block.open + 1})`);
  }
  const seen = new Map();
  const order = [];
  block.lines.forEach((line, k) => {
    const n = block.open + 2 + k;
    if (line.length > MAX_LINE) { e(`line ${n} too long (over ${MAX_LINE} characters)`); return; }
    const m = /^([a-z_]{1,20}):[ \t]+(\S.*)$/.exec(line) ?? /^([a-z_]{1,20}):[ \t]*()$/.exec(line);
    if (!m) { e(`line ${n} is not a key: value line`); return; }
    order.push(m[1]);
    if (seen.has(m[1])) { e(`line ${n}: repeated key ${m[1]}`); return; }
    if (!TOP_KEYS.includes(m[1])) { e(`line ${n}: extra key (allowed: ${TOP_KEYS.join(', ')})`); return; }
    seen.set(m[1], m[2].trim());
  });
  for (const k of TOP_KEYS) if (!seen.has(k)) e(`missing key ${k}`);
  if (errors.length === before && order.join() !== TOP_KEYS.join()) e(`expected keys in this order: ${TOP_KEYS.join(', ')}`);
  if (errors.length > before) return null;

  const top = Object.create(null);
  const bad = (k, why) => e(`${k} ${why}`);
  const parsed = k => {
    const l = strictList(seen.get(k));
    if (l === null) bad(k, 'must be a [list] with no empty items');
    return l;
  };
  const st = seen.get('status');
  if (!STATUS.has(st)) bad('status', 'must be done|blocked|needs-ceo|handover');
  else if (st !== fm.status) bad('status', 'must equal frontmatter status');
  top.status = st;

  const files = parsed('files');
  if (files) {
    if (!files.every(f => PATH_RE.test(f))) bad('files', 'has a bad path');
    else if (!sameSet(files, list(fm['files-touched'] ?? '') ?? [])) bad('files', 'must equal frontmatter files-touched (same set)');
  }
  top.files = files;
  const ac = parsed('ac_ids');
  if (ac) {
    if (!ac.every(a => AC_RE.test(a))) bad('ac_ids', 'has a bad ID');
    else if (!sameSet(ac, list(fm['acceptance-ids'] ?? '') ?? [])) bad('ac_ids', 'must equal frontmatter acceptance-ids (same set)');
  }
  top.ac_ids = ac;
  const rules = parsed('rule_ids');
  if (rules && !rules.every(r => RULE_RE.test(r))) bad('rule_ids', 'has an ID that is not <pack>.<M|S|Y><n>');
  top.rule_ids = rules;
  const risks = parsed('risks');
  if (risks) {
    for (const r of risks) {
      if (!ID_RE.test(r)) bad('risks', `${r.slice(0, 40)} is not a finding ID`);
      else if (!findingIds.includes(r)) bad('risks', `${r} has no finding row in ## Blocking or ## Nits`);
    }
  }
  top.risks = risks;
  const next = parsed('read_next');
  if (next) {
    if (next.length > 5) bad('read_next', 'has more than 5 pointers');
    else if (!next.every(p => POINTER_RE.test(p))) bad('read_next', 'must hold pointers (path, path#heading, R-n), never text');
  }
  top.read_next = next;
  const tk = seen.get('tokens_used');
  if (tk === 'unknown') top.tokens_used = 'unknown';
  else if (/^(0|[1-9]\d{0,11})$/.test(tk)) top.tokens_used = Number(tk);
  else bad('tokens_used', 'must be an integer or unknown');
  return errors.length > before ? null : top;
}

// Returns { errors, routing }. `routing` holds only the fields later Steps and the Lead read.
export function lint(text, opts = {}) {
  const errors = [];
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { errors: ['file too large'], routing: null };
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return { errors: ['missing frontmatter'], routing: null };
  if (lines.indexOf('---', 1) < 0) return { errors: ['unterminated frontmatter'], routing: null };

  const { fm, end } = frontmatterOf(lines, errors, KEYS, REQUIRED);
  if ('status' in fm && !STATUS.has(fm.status)) errors.push('frontmatter: status must be done|blocked|needs-ceo|handover');
  if ('risk-tier' in fm && !RISK.has(fm['risk-tier'])) errors.push('frontmatter: risk-tier must be low|medium|high');
  if ('depth' in fm && !DEPTH.has(fm.depth)) errors.push('frontmatter: depth must be quick|deep');
  if ('round' in fm && !/^\d{1,3}$/.test(fm.round)) errors.push('frontmatter: round must be a number');
  for (const k of LIST_KEYS) if (k in fm && list(fm[k]) === null) errors.push(`frontmatter: ${k} must be a [list]`);

  // One pass: sections, bullets of ## Blocking and ## Nits, and aico-top fences. Text inside any other fence is
  // data, so a quoted aico-top block is not a block (parse like the reader, proj.M2).
  const headings = new Set();
  const items = []; // { i, section, body }
  const blocks = [];
  let section = '';
  let fence = null;
  for (let i = end + 1; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      const c = /^(`{3,})[ \t]*$/.exec(line);
      if (c && c[1].length >= fence.len) { if (fence.block) fence.block.close = i; fence = null; }
      else if (fence.block) fence.block.lines.push(line);
      continue;
    }
    const f = /^(`{3,})([^`]*)$/.exec(line);
    if (f) {
      const info = f[2].trim().split(/\s/)[0];
      const block = info === 'aico-top' ? { open: i, close: null, lines: [] } : null;
      if (block) blocks.push(block);
      fence = { len: f[1].length, block };
      continue;
    }
    const h = /^## (.*)$/.exec(line);
    if (h) { section = h[1].trim(); headings.add(section); continue; }
    if (section === 'Blocking' || section === 'Nits') {
      const b = /^- (.*)$/.exec(line);
      if (b) items.push({ i, section, body: b[1] });
    }
  }
  for (const h of REQUIRED_HEADINGS) if (!headings.has(h)) errors.push(`missing English heading ## ${h}`);

  const rowMode = blocks.length > 0 || opts.requireTop === true;
  const tags = [];
  const findingIds = [];
  for (const it of items) {
    const n = it.i + 1;
    let body = it.body;
    if (NONE_RE.test(body)) continue;
    if (it.section === 'Blocking') {
      const t = /^\[([^\]\s]{1,40})\]/.exec(body);
      if (!t || !TAGS.has(t[1])) {
        errors.push(`line ${n}: blocking item needs a [contract|spec|security|test] tag`);
        continue;
      }
      tags.push(t[1]);
      body = body.slice(t[0].length).trimStart();
    }
    if (!rowMode && !ROW_SHAPED_RE.test(it.body)) continue;
    const parts = body.split('|').map(s => s.trim());
    const bad = checkRow(parts, it.section === 'Blocking');
    if (bad) { errors.push(`line ${n}: ${bad}`); continue; }
    if (findingIds.includes(parts[0])) errors.push(`line ${n}: duplicate finding ID ${parts[0]}`);
    else findingIds.push(parts[0]);
  }

  let top = null;
  if (blocks.length === 0) {
    if (opts.requireTop === true) errors.push('missing aico-top block');
  } else {
    if (blocks.length > 1) errors.push(`aico-top: second aico-top block (line ${blocks[1].open + 1}); only one is allowed`);
    top = checkTop(blocks[0], lines, end + 1, fm, findingIds, errors);
  }

  const routing = {
    status: fm.status ?? null,
    round: fm.round ?? null,
    'base-commit': fm['base-commit'] ?? null,
    'risk-tier': fm['risk-tier'] ?? null,
    'acceptance-ids': list(fm['acceptance-ids'] ?? '') ?? [],
    'files-touched': list(fm['files-touched'] ?? '') ?? [],
    blocking: tags,
    top,
    findings: findingIds,
  };
  return { errors, routing };
}

// Validates a findings ledger (`<NN>-<role>.findings.md`).
export function lintFindings(text) {
  const errors = [];
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { errors: ['file too large'], ledger: null };
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return { errors: ['missing frontmatter'], ledger: null };
  if (lines.indexOf('---', 1) < 0) return { errors: ['unterminated frontmatter'], ledger: null };
  const { fm, end } = frontmatterOf(lines, errors, new Set(['step', 'role', 'base-commit']), ['step', 'role', 'base-commit']);
  if ('base-commit' in fm && !/^[0-9a-f]{7,40}$/.test(fm['base-commit'])) errors.push('frontmatter: base-commit must be a hex sha');

  const headings = new Set();
  const checked = [];
  const findings = [];
  const seen = new Set();
  let section = '';
  for (let i = end + 1; i < lines.length; i++) {
    const line = lines[i];
    const h = /^## (.*)$/.exec(line);
    if (h) { section = h[1].trim(); headings.add(section); continue; }
    const b = /^- (.*)$/.exec(line);
    if (!b) continue;
    const n = i + 1;
    if (section === 'Checked') { checked.push(b[1].trim()); continue; }
    if (section !== 'Findings' || NONE_RE.test(b[1])) continue;
    const p = b[1].split('|').map(s => s.trim());
    if (p.length !== 7) { errors.push(`line ${n}: row needs 7 fields: ID | status | [tag] | file:line | problem | why | fix (got ${p.length})`); continue; }
    const [id, status, tag, ...rest] = p;
    if (!ID_RE.test(id)) { errors.push(`line ${n}: ${ID_ERR}`); continue; }
    if (!LEDGER_STATUS.has(status)) { errors.push(`line ${n}: status must be open|fixed|withdrawn`); continue; }
    const t = /^\[([^\]\s]{1,40})\]$/.exec(tag);
    if (!t || !TAGS.has(t[1])) { errors.push(`line ${n}: row needs a [contract|spec|security|test] tag`); continue; }
    const bad = checkRow([id, ...rest], true);
    if (bad) { errors.push(`line ${n}: ${bad}`); continue; }
    if (seen.has(id)) { errors.push(`line ${n}: duplicate finding ID ${id}`); continue; }
    seen.add(id);
    findings.push({ id, status });
  }
  for (const h of ['Checked', 'Findings']) if (!headings.has(h)) errors.push(`missing heading ## ${h}`);
  return { errors, ledger: { checked, findings } };
}

function main(argv) {
  const USAGE = 'usage: node scripts/handoff-lint.mjs <handoff.md> [--require-top] | --findings <ledger.md>';
  const args = argv.slice(2);
  const requireTop = args.includes('--require-top');
  const wantLedger = args.includes('--findings');
  const files = args.filter(a => !a.startsWith('--'));
  const flags = args.filter(a => a.startsWith('--'));
  if (files.length !== 1 || flags.some(f => f !== '--require-top' && f !== '--findings')
    || (wantLedger && requireTop)) { console.log(USAGE); return 2; }
  const file = files[0];
  let text;
  try {
    if (statSync(file).size > MAX_BYTES) { console.log('ERROR file too large'); return 1; }
    text = readFileSync(file, 'utf8');
  } catch {
    console.log('ERROR cannot read file');
    return 1;
  }
  const r = wantLedger ? lintFindings(text) : lint(text, { requireTop });
  r.errors.forEach(e => console.log(`ERROR ${e}`));
  if (!r.errors.length) console.log(JSON.stringify(wantLedger ? r.ledger : r.routing));
  return r.errors.length ? 1 : 0;
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) process.exit(main(process.argv));
