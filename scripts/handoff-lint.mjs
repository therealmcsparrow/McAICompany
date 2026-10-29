#!/usr/bin/env node
// Lints a Handoff file (contract: docs/contracts/handoff.md v1.2): machine-read parts stay English whatever `Language:` is.
// uses: docs/contracts/contract-index.md v1
// The input is written by an LLM, so it is size-capped and read with anchored, linear patterns only.
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, parseVersion } from './contract-drift.mjs';

export const MAX_BYTES = 64 * 1024;
const MAX_LINE = 1000;
const STATUS = new Set(['done', 'blocked', 'needs-ceo', 'handover']);
const RISK = new Set(['low', 'medium', 'high']);
const DEPTH = new Set(['quick', 'deep']);
const TAGS = new Set(['contract', 'spec', 'security', 'test']);
const LEDGER_STATUS = new Set(['open', 'fixed', 'withdrawn']);
const KEYS = new Set(['step', 'role', 'task', 'status', 'round', 'base-commit', 'risk-tier', 'acceptance-ids',
  'files-touched', 'fetches', 'depth', 'degraded', 'contracts']);
const REVIEWERS = new Set(['code-reviewer', 'security', 'pentester', 'vuln-scanner']);
// Roles whose findings never close by contest (a security finding closes by a fix or a CEO exception only).
const SECURITY_ROLES = new Set(['security', 'pentester', 'vuln-scanner']);
const KEY_PART = '\\d{2,3}-[a-z][a-z0-9-]{0,40}:R-\\d{1,4}';
const KEY_RE = /^(\d{2,3})-([a-z][a-z0-9-]{0,40}):R-(\d{1,4})$/;
const CONTESTED_RE = new RegExp(`^(${KEY_PART}) — (\\S.{0,500})$`);
const CONTESTS_RE = new RegExp(`^(${KEY_PART}) (accepted|rejected) — (\\S.{0,500})$`);
const CITE_RE = /^([a-z][a-z0-9-]{0,40}) v(\d{1,3})(?:\.(\d{1,3}))?$/;
const BYLINE_ID_RE = /^By: [a-z][a-z0-9-]{0,40}$/;
const SEC_CITE_RE = /(?:^|[^A-Za-z0-9_.-])(?:[a-z][a-z0-9-]{0,30}\.[MSY]-SEC\d{1,3}|proj\.M[1-4])(?![\w-])/;
const MAX_RUN_FILES = 500;
const MAX_STANDARDS = 256 * 1024;
const REQUIRED = ['step', 'role', 'task', 'status', 'round', 'base-commit', 'risk-tier'];
const REQUIRED_HEADINGS = ['Did', 'Blocking', 'Next'];
const LIST_KEYS = new Set(['acceptance-ids', 'files-touched']);
// The seven keys of the aico-top block, in their fixed order.
const TOP_KEYS = ['status', 'files', 'ac_ids', 'rule_ids', 'risks', 'read_next', 'tokens_used'];
const ID_RE = /^[RCT]-\d{1,4}$/;
const RULE_RE = /^[a-z][a-z0-9-]{0,30}\.(M|S|Y)(-SEC)?\d{1,3}$/;
const AC_RE = /^[A-Za-z0-9._-]{1,40}$/;
const PATH_RE = /^[^\s\x00-\x1f\x7f,]{1,260}$/;
// path or R-n: no whitespace; path#heading: only the heading may hold spaces. No commas, no control characters, 200 at most.
const POINTER_RE = /^(?=[^\x00-\x1f\x7f]{1,200}$)[^\s\x00-\x1f\x7f,#]+(?:#[^\x00-\x1f\x7f,]+)?$/;
const LOC_RE = /^([^\s:]{1,260})(?::(\d{1,6})(?:-(\d{1,6}))?)?$/;
const NONE_RE = /^(none|\(none[^)]{0,100}\))\.?$/i;
const ROW_SHAPED_RE = /^(\[[^\]\s]{1,40}\] )?[A-Za-z]{1,3}-[A-Za-z0-9]{1,6} \|/;
// Hints (handoff v1.1): static text, they echo nothing from the Handoff.
const PIPE_HINT = '; a | inside a field splits it, write it without |';
const PROSE_HINT = '; every bullet here is a finding row, put prose in ## Did or ## Next';
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
  if (parts.length !== 5) {
    const hint = parts.length > 5 ? PIPE_HINT : '';
    return `row needs 5 fields: ID | file:line | problem | why | fix (got ${parts.length})${hint}`;
  }
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

const CONTEST_HINT = {
  Contested: 'contest line must be "- <NN>-<role>:R-<n> — <reason>"',
  Contests: 'answer line must be "- <NN>-<role>:R-<n> accepted|rejected — <reason>"',
};

// A reviewer row (a Blocking bullet, or a Nit that starts with a tag) must carry an R-, C- or T- ID after its tag.
function needsId(it, body) {
  if (it.section === 'Nits' && (!/^\[[^\]\s]{1,40}\] /.test(it.body) || it.body.startsWith('[open-decision]'))) return false;
  if (it.section === 'Nits') body = body.replace(/^\[[^\]\s]{1,40}\] /, '');
  return !/^[RCT]-\d{1,4}(?: |$)/.test(body);
}

function checkContracts(raw, index, errors) {
  const items = strictList(raw);
  if (items === null) { errors.push('frontmatter: contracts must be a [list] of "<contract> v<x>[.<y>]" with no empty items'); return; }
  for (const item of items) {
    const m = CITE_RE.exec(item);
    if (!m) { errors.push('frontmatter: contracts item must look like "<contract> v<x>[.<y>]"'); continue; }
    if (!index) continue;
    const cur = index.get(m[1]);
    const v = parseVersion(m[3] === undefined ? m[2] : `${m[2]}.${m[3]}`);
    if (!cur) errors.push(`frontmatter: contracts cite ${m[1]} is not a Contract`);
    else if (v.major !== cur.major || v.minor > cur.minor) {
      errors.push(`frontmatter: contracts cite ${m[1]} v${m[2]}${m[3] === undefined ? '' : `.${m[3]}`} is stale, current v${cur.major}.${cur.minor}`);
    }
  }
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
  if ('contracts' in fm) checkContracts(fm.contracts, opts.index, errors);
  const roleIdBy = BYLINE_ID_RE.test(lines[end + 1] ?? '');
  if (roleIdBy && !('contracts' in fm)) errors.push('frontmatter: missing contracts (required under a Role id byline, handoff v1.2)');

  // One pass: sections, bullets of ## Blocking and ## Nits, and aico-top fences. Text inside any other fence is
  // data, so a quoted aico-top block is not a block (parse like the reader).
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
    if (section === 'Blocking' || section === 'Nits' || section === 'Contested' || section === 'Contests') {
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
    if (it.section === 'Contested' || it.section === 'Contests') {
      if (!(it.section === 'Contested' ? CONTESTED_RE : CONTESTS_RE).test(body)) errors.push(`line ${n}: ${CONTEST_HINT[it.section]}`);
      continue;
    }
    if (it.section === 'Blocking') {
      const t = /^\[([^\]\s]{1,40})\]/.exec(body);
      if (!t || !TAGS.has(t[1])) {
        errors.push(`line ${n}: blocking item needs a [contract|spec|security|test] tag`);
        continue;
      }
      tags.push(t[1]);
      body = body.slice(t[0].length).trimStart();
    }
    if (roleIdBy && REVIEWERS.has(fm.role) && needsId(it, body)) {
      errors.push(`line ${n}: reviewer row needs R-<n> after the tag`);
      continue;
    }
    if (!rowMode && !ROW_SHAPED_RE.test(it.body)) continue;
    const parts = body.split('|').map(s => s.trim());
    const bad = checkRow(parts, it.section === 'Blocking');
    if (bad) { errors.push(`line ${n}: ${bad}${parts.length === 1 ? PROSE_HINT : ''}`); continue; }
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
    if (p.length !== 7) { errors.push(`line ${n}: row needs 7 fields: ID | status | [tag] | file:line | problem | why | fix (got ${p.length})${p.length > 7 ? PIPE_HINT : ''}`); continue; }
    const [id, status, tag, ...rest] = p;
    if (!ID_RE.test(id)) { errors.push(`line ${n}: ${ID_ERR}`); continue; }
    if (!LEDGER_STATUS.has(status)) { errors.push(`line ${n}: status must be open|fixed|withdrawn`); continue; }
    const t = /^\[([^\]\s]{1,40})\]$/.exec(tag);
    if (!t || !(TAGS.has(t[1]) || t[1] === 'nit')) { errors.push(`line ${n}: row needs a [contract|spec|security|test] tag, or [nit] for a Nit`); continue; }
    const bad = checkRow([id, ...rest], true);
    if (bad) { errors.push(`line ${n}: ${bad}`); continue; }
    if (seen.has(id)) { errors.push(`line ${n}: duplicate finding ID ${id}`); continue; }
    seen.add(id);
    findings.push({ id, status });
  }
  for (const h of ['Checked', 'Findings']) if (!headings.has(h)) errors.push(`missing heading ## ${h}`);
  return { errors, ledger: { checked, findings } };
}

// A handover Handoff needs its sibling ledger <NN>-<role>.findings.md (handoff v1.1 part 3).
// The ledger path is built from the checked file name only, inside the Handoff's own folder.
const HANDOFF_NAME = /^(\d{2,3}-[a-z][a-z0-9-]{0,40})\.md$/;

export function checkLedger(file, findingIds) {
  const m = HANDOFF_NAME.exec(basename(file));
  if (!m) return ['cannot locate ledger'];
  const ledger = join(dirname(resolve(file)), `${m[1]}.findings.md`);
  let st;
  try {
    st = lstatSync(ledger);
  } catch (e) {
    return e.code === 'ENOENT' ? ['handover without findings ledger'] : ['cannot locate ledger'];
  }
  if (!st.isFile()) return ['cannot locate ledger'];
  if (st.size > MAX_BYTES) return ['ledger: file too large'];
  let text;
  try {
    text = readFileSync(ledger, 'utf8');
  } catch {
    return ['cannot locate ledger'];
  }
  const r = lintFindings(text);
  if (r.errors.length) return r.errors.map(e => `ledger: ${e}`);
  const have = new Set(r.ledger.findings.map(x => x.id));
  return findingIds.filter(id => !have.has(id)).map(id => `finding ${id} missing from ledger`);
}

// ---- contested findings (handoff v1.2) ----
const RUN_FILE = /^(\d{2,3})-([a-z][a-z0-9-]{0,40})\.md$/;
const EXCEPTION_RE = new RegExp(`^- (${KEY_PART}) — .{1,600} — approved: (\\d{4})-(\\d{2})-(\\d{2}) \\(CEO\\)\\s*$`);

// Reads one Handoff of a run folder: its Blocking rows with an R-ID, and its Contested and Contests lines.
function scanRunFile(text, file, nn, role, errors, warnings) {
  const lines = text.split(/\r?\n/);
  const info = { file, nn, role, round: 0, status: '', rows: [], contested: [], answers: [] };
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  for (let i = 1; i < end; i++) {
    const m = /^(round|status):[ \t]*(\S{1,20})/.exec(lines[i]);
    if (m && m[1] === 'round' && /^\d{1,3}$/.test(m[2])) info.round = Number(m[2]);
    if (m && m[1] === 'status') info.status = m[2];
  }
  let section = '';
  let fence = null;
  for (let i = end + 1; i < lines.length && end > 0; i++) {
    const line = lines[i];
    if (fence) {
      const c = /^(`{3,})[ \t]*$/.exec(line);
      if (c && c[1].length >= fence) fence = null;
      continue;
    }
    const f = /^(`{3,})[^`]*$/.exec(line);
    if (f) { fence = f[1].length; continue; }
    const h = /^## (.*)$/.exec(line);
    if (h) { section = h[1].trim(); continue; }
    if (!['Blocking', 'Contested', 'Contests'].includes(section)) continue;
    const b = /^- (.*)$/.exec(line);
    if (!b || NONE_RE.test(b[1])) continue;
    const at = `${file} line ${i + 1}`;
    if (line.length > MAX_LINE) { warnings.push(`warning: ${at} is over ${MAX_LINE} characters, ignored`); continue; }
    if (section === 'Blocking') {
      const t = /^(?:\[([^\]\s]{1,40})\] )?R-(\d{1,4})(?: |$)/.exec(b[1]);
      if (t) info.rows.push({ n: Number(t[2]), tag: t[1] ?? '', secure: SEC_CITE_RE.test(b[1]) });
    } else if (section === 'Contested') {
      const m = CONTESTED_RE.exec(b[1]);
      if (m) info.contested.push({ key: m[1], at }); else errors.push(`${at}: ${CONTEST_HINT.Contested}`);
    } else {
      const m = CONTESTS_RE.exec(b[1]);
      if (m) info.answers.push({ key: m[1], verb: m[2], at }); else errors.push(`${at}: ${CONTEST_HINT.Contests}`);
    }
  }
  return info;
}

function realDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// CEO exceptions: `## Exceptions` of .company/standards.md, joined lexically from the run folder. Handoff text never counts.
function readExceptions(runAbs, warnings) {
  const dir = resolve(runAbs, '..', '..');
  const file = join(dir, 'standards.md');
  const found = new Set();
  const unreadable = () => warnings.push('warning: standards.md could not be read; no exceptions applied');
  if (!file.startsWith(resolve(dir, '..') + sep)) return found;
  let st;
  try {
    if (!lstatSync(dir).isDirectory()) return found;
    st = lstatSync(file);
  } catch (e) {
    if (e.code !== 'ENOENT') unreadable();
    return found;
  }
  if (!st.isFile() || st.size > MAX_STANDARDS) {
    warnings.push('warning: standards.md is a link, not a plain file or over 256 KiB; no exceptions applied');
    return found;
  }
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { unreadable(); return found; }
  let section = '';
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^`{3,}/.test(line)) { fence = !fence; continue; }
    if (fence || line.length > MAX_LINE) continue;
    const h = /^## (.*)$/.exec(line);
    if (h) { section = h[1].trim(); continue; }
    if (section !== 'Exceptions') continue;
    const m = EXCEPTION_RE.exec(line);
    if (m && realDate(Number(m[2]), Number(m[3]), Number(m[4]))) found.add(m[1]);
  }
  return found;
}

// The state table of a run folder: { states: Map key -> state, unresolved, excepted, warnings, errors }.
export function contests(runFolder) {
  const out = { states: new Map(), unresolved: [], excepted: [], warnings: [], errors: [] };
  const err = m => out.errors.push(m);
  const runAbs = resolve(runFolder);
  let names;
  try {
    if (!lstatSync(runAbs).isDirectory()) throw new Error('not a folder');
    names = readdirSync(runAbs);
  } catch {
    err('cannot read run folder');
    return out;
  }
  if (names.length > MAX_RUN_FILES) { err(`run folder has more than ${MAX_RUN_FILES} entries`); names = names.slice(0, MAX_RUN_FILES); }
  const files = [];
  for (const name of names.sort()) {
    const m = RUN_FILE.exec(name);
    if (!m) continue;
    try {
      const st = lstatSync(join(runAbs, name));
      if (!st.isFile()) { out.warnings.push(`warning: ${name} is not a plain file, ignored`); continue; }
      if (st.size > MAX_BYTES) { out.warnings.push(`warning: ${name} is over 64 KiB, ignored`); continue; }
      const info = scanRunFile(readFileSync(join(runAbs, name), 'utf8'), name, Number(m[1]), m[2], out.errors, out.warnings);
      info.prefix = m[1];
      files.push(info);
    } catch { err(`${name}: cannot read, ignored`); }
  }
  files.sort((a, b) => a.nn - b.nn || (a.file < b.file ? -1 : 1));

  const lineages = new Map(); // `${role}:${n}` -> one finding followed through the Handoffs of its Role
  for (const f of files) {
    for (const r of f.rows) {
      const id = `${f.role}:${r.n}`;
      if (!lineages.has(id)) lineages.set(id, { role: f.role, n: r.n, holders: [], contest: null, answer: null, answeredIn: new Set() });
      lineages.get(id).holders.push({ f, tag: r.tag, secure: r.secure });
    }
  }
  const find = key => {
    const m = KEY_RE.exec(key);
    const l = m && lineages.get(`${m[2]}:${Number(m[3])}`);
    return l && l.holders.some(h => h.f.nn === Number(m[1])) ? { l, nn: Number(m[1]) } : null;
  };
  const keyOf = l => `${l.holders[0].f.prefix}-${l.role}:R-${l.n}`;
  const isSecure = l => SECURITY_ROLES.has(l.role) || l.holders.some(h => h.tag === 'security' || h.secure);

  for (const f of files) {
    for (const c of f.contested) {
      const hit = find(c.key);
      if (!hit) { err(`${c.at}: contest of ${c.key}, which no Handoff holds as a Blocking finding`); continue; }
      if (f.nn <= hit.nn) { err(`${c.at}: a contest must come from a Handoff above ${c.key}`); continue; }
      if (f.role === hit.l.role || REVIEWERS.has(f.role)) { err(`${c.at}: ${c.key} is contested by a builder, not by a reviewer`); continue; }
      if (hit.l.contest) { err(`${c.at}: second contest on ${keyOf(hit.l)}; one contest per finding`); continue; }
      hit.l.contest = { nn: f.nn };
    }
  }
  for (const f of files) {
    for (const a of f.answers) {
      const hit = find(a.key);
      if (!hit) { err(`${a.at}: answer to ${a.key}, which no Handoff holds as a Blocking finding`); continue; }
      hit.l.answeredIn.add(f.file);
      if (f.role !== hit.l.role) { err(`${a.at}: only the Role that raised ${a.key} may answer its contest`); continue; }
      if (!hit.l.contest) { err(`${a.at}: ${a.key} has no contest to answer`); continue; }
      if (f.nn <= hit.l.contest.nn) { err(`${a.at}: an answer must come from a Handoff after the contest`); continue; }
      if (a.verb === 'accepted' && isSecure(hit.l)) {
        err(`${a.at}: security finding ${a.key} never closes by contest; fix it or ask the CEO for an exception`);
        continue;
      }
      hit.l.answer = a.verb;
    }
  }

  const excepts = readExceptions(runAbs, out.warnings);
  const keyed = [...lineages.values()].map(l => [keyOf(l), l]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [key, l] of keyed) {
    const last = l.holders[l.holders.length - 1].f;
    const fixed = files.some(f => f.role === l.role && f.nn > last.nn && f.round > last.round && f.status === 'done'
      && !l.holders.some(h => h.f === f) && !l.answeredIn.has(f.file));
    let state = 'open';
    if (excepts.has(key)) state = 'excepted';
    else if (l.answer === 'accepted') state = 'accepted';
    else if (fixed) state = 'fixed';
    else if (l.answer === 'rejected') state = 'rejected';
    else if (l.contest) state = 'contested';
    out.states.set(key, state);
    if (state === 'contested') out.unresolved.push(key);
    if (state === 'excepted') out.excepted.push(key);
  }
  return out;
}

function main(argv) {
  const USAGE = 'usage: node scripts/handoff-lint.mjs <handoff.md> [--require-top] | --findings <ledger.md> | --contests <run folder>';
  const args = argv.slice(2);
  if (args[0] === '--contests') {
    if (args.length !== 2 || args[1].startsWith('--')) { console.log(USAGE); return 2; }
    const r = contests(args[1]);
    r.errors.forEach(e => console.log(`ERROR ${e}`));
    r.warnings.forEach(w => console.log(w));
    for (const [k, v] of r.states) console.log(`state ${k} ${v}`);
    r.unresolved.forEach(k => console.log(`unresolved ${k}`));
    r.excepted.forEach(k => console.log(`excepted ${k}`));
    return r.errors.length ? 1 : 0;
  }
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
  const index = !wantLedger && /^contracts:/m.test(text) ? buildIndex(resolve(dirname(fileURLToPath(import.meta.url)), '..')) : undefined;
  const r = wantLedger ? lintFindings(text) : lint(text, { requireTop, index });
  if (!wantLedger && requireTop && r.routing?.status === 'handover') r.errors.push(...checkLedger(file, r.routing.findings));
  r.errors.forEach(e => console.log(`ERROR ${e}`));
  if (!r.errors.length) console.log(JSON.stringify(wantLedger ? r.ledger : r.routing));
  return r.errors.length ? 1 : 0;
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) process.exit(main(process.argv));
