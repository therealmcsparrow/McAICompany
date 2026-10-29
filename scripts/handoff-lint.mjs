#!/usr/bin/env node
// Lints a Handoff file (contract: docs/contracts/handoff.md v1.3): machine-read parts stay English whatever `Language:` is.
// uses: docs/contracts/contract-index.md v1
// The input is written by an LLM, so it is size-capped and read with anchored, linear patterns only.
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, parseVersion } from './contract-drift.mjs';
import { show as showRun } from './run-state.mjs';

export const MAX_BYTES = 64 * 1024;
const MAX_LINE = 1000;
const STATUS = new Set(['done', 'blocked', 'needs-ceo', 'handover']);
const RISK = new Set(['low', 'medium', 'high']);
const DEPTH = new Set(['quick', 'deep']);
const TAGS = new Set(['contract', 'spec', 'security', 'test']);
const BLOCK_TAGS = new Set([...TAGS, 'comprehension']);
const LEDGER_STATUS = new Set(['open', 'fixed', 'withdrawn']);
const KEYS = new Set(['step', 'role', 'task', 'status', 'round', 'base-commit', 'risk-tier', 'acceptance-ids',
  'files-touched', 'fetches', 'depth', 'degraded', 'contracts', 'review-mode', 'model']);
const REVIEW_MODES = new Set(['plan', 'code']);
const MODELS = new Set(['opus', 'sonnet', 'haiku', 'fable']);
const MODEL_RANK = { haiku: 1, sonnet: 2, opus: 3 };
const MAX_FLOOR_FILE = 16 * 1024;
const MAX_EVIDENCE = 1024 * 1024;
const MAX_RULINGS = 64 * 1024;
const MAX_EVIDENCE_READS = 100;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLAN_NAME_RE = /^(\d{2,3}-)?(architect-)?plan(-[a-z0-9]+)?\.md$/;
const RUN_NAME_TOKEN_RE = /\d{2,3}-[a-z][a-z0-9-]{0,40}\.md/g;
const REVIEWERS = new Set(['code-reviewer', 'security', 'pentester', 'vuln-scanner', 'fresh-reviewer']);
// Roles whose findings never close by contest (a security finding closes by a fix or a CEO exception only).
const SECURITY_ROLES = new Set(['security', 'pentester', 'vuln-scanner']);
const KEY_PART = '\\d{2,3}-[a-z][a-z0-9-]{0,40}:R-\\d{1,4}';
const KEY_RE = /^(\d{2,3})-([a-z][a-z0-9-]{0,40}):R-(\d{1,4})$/;
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
  const at = Object.create(null);
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (line.length > MAX_LINE) { errors.push(`line ${i + 1}: frontmatter line too long`); continue; }
    const m = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
    if (!m) { errors.push(`line ${i + 1}: not a key: value line`); continue; }
    if (!keys.has(m[1])) { errors.push(`line ${i + 1}: unknown frontmatter key (keys are English)`); continue; }
    fm[m[1]] = value(m[2]);
    at[m[1]] = i + 1;
  }
  for (const k of required) if (!(k in fm)) errors.push(`frontmatter: missing ${k}`);
  return { fm, end, at };
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
  Contested: 'contest line must be "- <NN>-<role>:R-<n> — <reason> — evidence: <ref>" or "- <NN>-<role>:R-<n> — escalate — <reason>"',
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

const SIDE_SECTIONS = new Set(['Paraphrase', 'First pass', 'Decisions', 'Sources', 'Glossary', 'ADR drafts', 'Prototype question']);

// The model of a code-mode fresh reviewer is self-declared; the lint checks the key and warns below the code-reviewer floor.
let floorCache;
function codeReviewerFloor() {
  if (floorCache === undefined) {
    floorCache = MODEL_RANK.opus;
    try {
      const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'company', 'model-floor.json');
      if (statSync(file).size <= MAX_FLOOR_FILE) {
        const rank = MODEL_RANK[JSON.parse(readFileSync(file, 'utf8'))?.floor?.['code-reviewer']];
        if (rank) floorCache = rank;
      }
    } catch { floorCache = MODEL_RANK.opus; }
  }
  return floorCache;
}

function checkModeKeys(fm, at, fresh, errors, warnings) {
  if ('review-mode' in fm) {
    if (!fresh) errors.push(`line ${at['review-mode']}: review-mode key is for fresh-reviewer only`);
    else if (!REVIEW_MODES.has(fm['review-mode'])) errors.push(`line ${at['review-mode']}: review-mode must be plan|code`);
  } else if (fresh) {
    errors.push('frontmatter: missing review-mode');
  }
  const code = fresh && fm['review-mode'] === 'code';
  if ('model' in fm) {
    if (!code) errors.push(`line ${at.model}: model key is for fresh-reviewer code mode only`);
    else if (!MODELS.has(fm.model)) errors.push(`line ${at.model}: model must be opus|sonnet|haiku|fable`);
    else if ((MODEL_RANK[fm.model] ?? 0) < codeReviewerFloor()) warnings.push(`warning line ${at.model}: model ${fm.model} below the code-reviewer floor`);
  } else if (code) {
    errors.push('frontmatter: missing model (required for fresh-reviewer code mode)');
  }
}

// A fresh-reviewer Handoff opens with ## Paraphrase then ## First pass, and cites no run Handoff before the first pass ends.
function checkFreshShape(lines, end, order, side, errors) {
  if (order[0]?.name !== 'Paraphrase') {
    errors.push(order.some(o => o.name === 'Paraphrase')
      ? 'fresh-reviewer Handoff needs ## Paraphrase as its first heading, then ## First pass'
      : 'missing English heading ## Paraphrase');
  } else {
    const chars = Array.from((side.Paraphrase ?? []).map(x => x.line.trim()).join('\n')).length;
    if (chars < 200 || chars > 1200) errors.push(`line ${order[0].i + 1}: paraphrase must be 200-1200 characters (got ${chars})`);
    if (order[1]?.name !== 'First pass') errors.push('fresh-reviewer Handoff needs ## First pass directly after ## Paraphrase');
  }
  const fp = order.findIndex(o => o.name === 'First pass');
  if (fp < 0) {
    if (order[1]?.name !== 'First pass') errors.push('missing English heading ## First pass');
    return;
  }
  for (const { i, line } of side['First pass'] ?? []) {
    if (!/^- (?:none|R-\d{1,4}(?: .*)?)$/.test(line)) errors.push(`line ${i + 1}: first pass line must be "- R-<n> …" or "- none"`);
  }
  const stop = order[fp + 1]?.i ?? lines.length;
  for (let i = end + 1; i < stop; i++) {
    for (const m of lines[i].matchAll(RUN_NAME_TOKEN_RE)) {
      if (!PLAN_NAME_RE.test(m[0])) { errors.push(`line ${i + 1}: Handoff cited before the first pass ends`); break; }
    }
  }
}

// Research reports: a source needs its date, and a claim resting only on such a source ends with (unverified).
function checkSources(items, side, errors) {
  if (!side.Sources) return;
  const research = new Set();
  for (const { i, line } of side.Sources) {
    const text = line.trim();
    if (!text.endsWith(' — research-report')) continue;
    const dated = /^(?:- )?\[S(\d{1,3})\] \S{1,260} — report (\d{4})-(\d{2})-(\d{2}) — research-report$/.exec(text);
    const undated = /^(?:- )?\[S(\d{1,3})\] \S{1,260} — report undated — research-report$/.exec(text);
    if (undated) research.add(undated[1]);
    else if (dated && realDate(Number(dated[2]), Number(dated[3]), Number(dated[4]))) research.add(dated[1]);
    else errors.push(`line ${i + 1}: research report source needs its date`);
  }
  if (research.size === 0) return;
  const claims = [
    ...items.filter(it => it.section === 'Blocking' && !NONE_RE.test(it.body)).map(it => ({ i: it.i, text: it.body })),
    ...(side.Decisions ?? []).filter(x => x.line.startsWith('- ')).map(x => ({ i: x.i, text: x.line.slice(2) })),
  ];
  for (const { i, text } of claims) {
    const cites = new Set();
    for (const m of text.matchAll(/\[S(\d{1,3})\]/g)) cites.add(m[1]);
    if (cites.size > 0 && [...cites].every(id => research.has(id)) && !text.trimEnd().endsWith('(unverified)')) {
      errors.push(`line ${i + 1}: claim rests only on an earlier research report; re-check it or mark (unverified)`);
    }
  }
}

const ADR_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,50}$/;

function badGlossary(line) {
  if (!line.startsWith('- ')) return true;
  const rest = line.slice(2);
  const cut = rest.indexOf(' — ');
  if (cut < 0) return true;
  const def = rest.slice(cut + 3);
  return cut < 1 || cut > 60 || def.length < 10 || def.length > 300;
}

function badAdr(line) {
  if (!line.startsWith('- ')) return true;
  const rest = line.slice(2);
  const cut = rest.indexOf(' — ');
  const why = rest.lastIndexOf(' — why: ');
  if (cut < 0 || why < cut + 3) return true;
  const decision = rest.slice(cut + 3, why);
  const reason = rest.slice(why + ' — why: '.length);
  return !ADR_SLUG_RE.test(rest.slice(0, cut)) || decision.length < 10 || decision.length > 200 || reason.length < 10 || reason.length > 300;
}

// Product-manager sections: ## Glossary, ## ADR drafts and ## Prototype question, before ## Next.
function checkProductManager(isPm, order, side, errors) {
  const next = order.findIndex(o => o.name === 'Next');
  for (const name of ['Glossary', 'ADR drafts', 'Prototype question']) {
    const at = order.findIndex(o => o.name === name);
    if (at < 0) continue;
    const heading = order[at].i + 1;
    if (!isPm) { errors.push(`line ${heading}: ${name} is for product-manager only`); continue; }
    if (next >= 0 && next < at) errors.push(`line ${heading}: ${name} must come before ## Next`);
    const rows = side[name] ?? [];
    if (name === 'Prototype question') {
      const len = rows.length === 1 ? rows[0].line.trim().length : 0;
      if (len < 10 || len > 200) errors.push(`line ${heading}: ${name} line shape`);
      continue;
    }
    for (const { i, line } of rows) {
      if (name === 'Glossary' ? badGlossary(line) : badAdr(line)) errors.push(`line ${i + 1}: ${name} line shape`);
    }
  }
}

// Returns { errors, warnings, routing }. `routing` holds only the fields later Steps and the Lead read.
export function lint(text, opts = {}) {
  const errors = [];
  const warnings = [];
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { errors: ['file too large'], warnings, routing: null };
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return { errors: ['missing frontmatter'], warnings, routing: null };
  if (lines.indexOf('---', 1) < 0) return { errors: ['unterminated frontmatter'], warnings, routing: null };

  const { fm, end, at } = frontmatterOf(lines, errors, KEYS, REQUIRED);
  if ('status' in fm && !STATUS.has(fm.status)) errors.push('frontmatter: status must be done|blocked|needs-ceo|handover');
  if ('risk-tier' in fm && !RISK.has(fm['risk-tier'])) errors.push('frontmatter: risk-tier must be low|medium|high');
  if ('depth' in fm && !DEPTH.has(fm.depth)) errors.push('frontmatter: depth must be quick|deep');
  if ('round' in fm && !/^\d{1,3}$/.test(fm.round)) errors.push('frontmatter: round must be a number');
  for (const k of LIST_KEYS) if (k in fm && list(fm[k]) === null) errors.push(`frontmatter: ${k} must be a [list]`);
  if ('contracts' in fm) checkContracts(fm.contracts, opts.index, errors);
  const roleIdBy = BYLINE_ID_RE.test(lines[end + 1] ?? '');
  if (roleIdBy && !('contracts' in fm)) errors.push('frontmatter: missing contracts (required under a Role id byline, handoff v1.2)');
  const fresh = fm.role === 'fresh-reviewer';
  checkModeKeys(fm, at, fresh, errors, warnings);

  // One pass: sections, bullets of ## Blocking and ## Nits, and aico-top fences. Text inside any other fence is
  // data, so a quoted aico-top block is not a block (parse like the reader).
  const headings = new Set();
  const order = []; // { name, i } of every heading outside a fence, in order
  const side = Object.create(null); // section -> [{ i, line }] of the sections whose lines are checked as written
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
    if (h) { section = h[1].trim(); headings.add(section); order.push({ name: section, i }); continue; }
    if (SIDE_SECTIONS.has(section) && line.trim() !== '') (side[section] ??= []).push({ i, line });
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
      if (it.section === 'Contests') {
        if (!CONTESTS_RE.test(body)) errors.push(`line ${n}: ${CONTEST_HINT.Contests}`);
        continue;
      }
      const c = parseContest(body);
      if (!c) errors.push(`line ${n}: ${CONTEST_HINT.Contested}`);
      else if (c.kind === 'none') errors.push(`line ${n}: contest of ${c.key} has no checkable evidence`);
      continue;
    }
    if (it.section === 'Blocking') {
      const t = /^\[([^\]\s]{1,40})\]/.exec(body);
      if (!t || !BLOCK_TAGS.has(t[1])) {
        errors.push(`line ${n}: blocking item needs a [contract|spec|security|test] tag`);
        continue;
      }
      if (t[1] === 'comprehension' && !fresh) {
        errors.push(`line ${n}: comprehension tag is for fresh-reviewer only`);
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

  if (fresh) checkFreshShape(lines, end, order, side, errors);
  checkSources(items, side, errors);
  checkProductManager(fm.role === 'product-manager', order, side, errors);

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
  return { errors, warnings, routing };
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

// ---- evidence refs and real-path reads (handoff v1.3) ----
// The path rule of `plan-tasks` v1 (a repo-relative path of safe characters), kept here so the lint has no dependency on the
// scheduler; a test holds both in step.
const DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const PATH_SHAPE_RE = /^[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*\/?$/;
const MAX_PATH_CHARS = 200;

function trimAlias(segment) {
  let end = segment.length;
  while (end > 0 && (segment[end - 1] === '.' || segment[end - 1] === ' ')) end--;
  return end === 0 ? segment : segment.slice(0, end);
}

function isDeviceName(segment) {
  const name = trimAlias(segment);
  const dot = name.indexOf('.');
  return DEVICE_RE.test((dot === -1 ? name : name.slice(0, dot)).replace(/ +$/, '').toLowerCase());
}

export function evidencePath(item) {
  if (typeof item !== 'string') return { ok: false };
  const p = item.replaceAll('\\', '/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || /[*?[\]{}]/.test(p) || p.length > MAX_PATH_CHARS) return { ok: false };
  const segments = p.split('/');
  if (segments.at(-1) === '' && segments.length > 1) segments.pop();
  if (segments.some(s => s === '.' || s === '..')) return { ok: false };
  if (segments.some(s => trimAlias(s).toLowerCase() === '.git' || s.toLowerCase().startsWith('.env') || isDeviceName(s))) return { ok: false };
  if (!PATH_SHAPE_RE.test(p) || segments.some(s => s.startsWith('-') || s.endsWith('.') || s.endsWith(' '))) return { ok: false };
  return { ok: true, path: p, dir: p.endsWith('/') };
}

const REF_RE = /^([^:#]{1,300})(?::(\d{1,6})(?:-(\d{1,6}))?)?$/;
const CONTEST_HEAD_RE = new RegExp(`^(${KEY_PART}) — (\\S.*)$`);
const CI_FS = process.platform === 'win32' || process.platform === 'darwin';
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

// `<path>[:<n>[-<n>]]` or `<path>#<test name>`, 1 to 3 refs joined by `;`. Returns null when any ref is malformed.
function parseRefs(text) {
  const parts = text.split(';');
  if (parts.length > 3) return null;
  const refs = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (p.length === 0 || p.length > 500) return null;
    const hash = p.indexOf('#');
    if (hash >= 0) {
      const path = p.slice(0, hash);
      const name = p.slice(hash + 1);
      if (!path || name.length < 1 || name.length > 120 || name.includes('#') || CONTROL_RE.test(name)) return null;
      refs.push({ path, name });
      continue;
    }
    const m = REF_RE.exec(p);
    if (!m) return null;
    const from = m[2] === undefined ? null : Number(m[2]);
    const to = m[3] === undefined ? from : Number(m[3]);
    if (from !== null && (from < 1 || to < from)) return null;
    refs.push({ path: m[1], from, to });
  }
  return refs;
}

// A contest line: `<key> — <reason> — evidence: <refs>` or `<key> — escalate — <reason>`.
// Returns null when the line does not start with a finding key; `kind` is none when it has neither form.
function parseContest(body) {
  const m = CONTEST_HEAD_RE.exec(body);
  if (!m) return null;
  const rest = m[2];
  if (rest.startsWith('escalate — ')) {
    const reason = rest.slice('escalate — '.length);
    return { key: m[1], kind: reason.length >= 20 && reason.length <= 500 ? 'escalate' : 'none' };
  }
  const at = rest.lastIndexOf(' — evidence:');
  if (at < 1 || at > 500) return { key: m[1], kind: 'none' };
  const refs = parseRefs(rest.slice(at + ' — evidence:'.length));
  return refs ? { key: m[1], kind: 'evidence', refs } : { key: m[1], kind: 'none' };
}

const sameReal = (a, b) => (CI_FS ? a.toLowerCase() === b.toLowerCase() : a === b);

// Reads a regular file below `realRoot`. The real path of the lexical path must equal it, the file must have one link and
// the opened handle must be the file that was checked. A miss is refused; the lexical path is never read as a fallback.
function readInside(realRoot, segments, cap) {
  const lexical = join(realRoot, ...segments);
  let lst;
  try {
    lst = lstatSync(lexical);
  } catch (e) {
    return { status: e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 'missing' : 'error' };
  }
  let real;
  try { real = realpathSync.native(lexical); } catch { return { status: 'refused' }; }
  const inside = CI_FS ? real.toLowerCase().startsWith((realRoot + sep).toLowerCase()) : real.startsWith(realRoot + sep);
  if (!sameReal(real, lexical) || !inside) return { status: 'refused' };
  if (!lst.isFile() || lst.nlink !== 1 || lst.size > cap) return { status: 'refused' };
  let fd;
  try {
    fd = openSync(lexical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > cap || (lst.ino !== 0 && (st.ino !== lst.ino || st.dev !== lst.dev))) return { status: 'refused' };
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = readSync(fd, buf, off, st.size - off, off);
      if (n === 0) break;
      off += n;
    }
    return { status: 'ok', text: buf.toString('utf8', 0, off) };
  } catch {
    return { status: 'error' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// The product root of a run folder `<root>/.company/work/<slug>`, or null when the folder has another shape.
function runContext(runAbs) {
  const work = dirname(runAbs);
  const company = dirname(work);
  if (basename(work) !== 'work' || basename(company) !== '.company') return null;
  const root = dirname(company);
  try { return { root, realRoot: realpathSync.native(root), reads: 0, cache: new Map() }; } catch { return null; }
}

function lineCount(text) {
  let n = 0;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++;
  return text.length > 0 && !text.endsWith('\n') ? n + 1 : n;
}

// True when every ref names a regular file inside the root that holds the cited lines or test name.
function evidenceOk(ctx, refs) {
  if (!ctx) return false;
  for (const r of refs) {
    const n = evidencePath(r.path);
    if (!n.ok || n.dir) return false;
    let hit = ctx.cache.get(n.path);
    if (hit === undefined) {
      if (ctx.reads >= MAX_EVIDENCE_READS) return false;
      ctx.reads++;
      const got = readInside(ctx.realRoot, n.path.split('/'), MAX_EVIDENCE);
      hit = got.status === 'ok' ? { text: got.text, lines: lineCount(got.text) } : null;
      ctx.cache.set(n.path, hit);
    }
    if (!hit) return false;
    if (r.name !== undefined) {
      if (!hit.text.includes(r.name)) return false;
    } else if (r.from !== null && r.to > hit.lines) {
      return false;
    }
  }
  return true;
}

// ---- locations of a finding row ----
const LOC_PATH_RE = /^([A-Za-z0-9._@+\\/-]{1,260})(?::(\d{1,6})(?:-(\d{1,6}))?)?$/;
const LOC_BARE_RE = /^:?(\d{1,6})(?:-(\d{1,6}))?$/;
const MAX_LOC_PART = 8192;

function trimEndPunct(s) {
  let end = s.length;
  while (end > 0 && (s[end - 1] === '.' || s[end - 1] === ';')) end--;
  return s.slice(0, end);
}

// Every `<path>[:<n>[-<n>]][,<n>[-<n>]…]` in the location part of a row (before the first ` — `, or the second field of a
// pipe row), plus a bare `:<n>[-<n>]` that binds to the path before it. `from` and `to` are null for a whole file.
export function parseLocations(text) {
  if (typeof text !== 'string') return [];
  const dash = text.indexOf(' — ');
  let part = dash < 0 ? text : text.slice(0, dash);
  if (part.length > MAX_LOC_PART) part = part.slice(0, MAX_LOC_PART);
  if (part.includes('|')) part = part.split('|')[1] ?? '';
  const out = [];
  let last = null;
  for (const word of part.split(/\s+/)) {
    if (word === '') continue;
    const pieces = word.split(',');
    let chained = false;
    for (let k = 0; k < pieces.length; k++) {
      const piece = k === pieces.length - 1 ? trimEndPunct(pieces[k]) : pieces[k];
      if (piece === '') { chained = false; continue; }
      const bare = LOC_BARE_RE.exec(piece);
      if (bare && (piece.startsWith(':') || chained) && last !== null) {
        const from = Number(bare[1]);
        const to = bare[2] === undefined ? from : Number(bare[2]);
        if (to >= from) out.push({ path: last, from, to });
        chained = true;
        continue;
      }
      const m = LOC_PATH_RE.exec(piece);
      if (!m || !/[./]/.test(m[1])) { chained = false; continue; }
      const path = m[1].replaceAll('\\', '/');
      const from = m[2] === undefined ? null : Number(m[2]);
      const to = m[3] === undefined ? from : Number(m[3]);
      if (from !== null && to < from) { chained = false; continue; }
      out.push({ path, from, to });
      last = path;
      chained = from !== null;
    }
  }
  return out;
}

// ---- contested findings (handoff v1.3) ----
const RUN_FILE = /^(\d{2,3})-([a-z][a-z0-9-]{0,40})\.md$/;
// `- <slug>/<NN>-<role>:R-<n> — … — approved: <date> (CEO)`; the slug is the run folder name. A line without a slug names no run.
const EXC_TAIL = ' — .{1,600} — approved: (\\d{4})-(\\d{2})-(\\d{2}) \\(CEO\\)\\s*$';
const EXCEPTION_RE = new RegExp(`^- ([a-z0-9][a-z0-9-]{0,63})/(${KEY_PART})${EXC_TAIL}`);
const UNSLUGGED_RE = new RegExp(`^- (${KEY_PART})${EXC_TAIL}`);
const RULING_RE = new RegExp(`^- (${KEY_PART}) — (upheld|overruled) — (.{1,600}) — ruled: (\\d{4})-(\\d{2})-(\\d{2}) \\(CEO\\)\\s*$`);

// Reads one Handoff of a run folder: its Blocking rows with an R-ID, and its Contested and Contests lines.
function scanRunFile(text, file, nn, role, errors, warnings) {
  const lines = text.split(/\r?\n/);
  const info = { file, nn, role, round: 0, status: '', mode: '', rows: [], contested: [], answers: [] };
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  for (let i = 1; i < end; i++) {
    const m = /^(round|status|review-mode):[ \t]*(\S{1,20})/.exec(lines[i]);
    if (m && m[1] === 'round' && /^\d{1,3}$/.test(m[2])) info.round = Number(m[2]);
    if (m && m[1] === 'status') info.status = m[2];
    if (m && m[1] === 'review-mode' && REVIEW_MODES.has(m[2])) info.mode = m[2];
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
      if (!t) continue;
      let tag = t[1] ?? '';
      if (tag === 'comprehension' && role !== 'fresh-reviewer') {
        errors.push(`${at}: comprehension tag is for fresh-reviewer only`);
        tag = '';
      }
      info.rows.push({ n: Number(t[2]), tag, secure: SEC_CITE_RE.test(b[1]), text: b[1] });
    } else if (section === 'Contested') {
      const c = parseContest(b[1]);
      if (c) info.contested.push({ ...c, at }); else errors.push(`${at}: ${CONTEST_HINT.Contested}`);
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

// The lines of `## Exceptions` outside code fences: { slug, key, date }, slug null for a v1.2 line without a run.
function exceptionLines(text) {
  const out = [];
  let section = '';
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^`{3,}/.test(line)) { fence = !fence; continue; }
    if (fence || line.length > MAX_LINE) continue;
    const h = /^## (.*)$/.exec(line);
    if (h) { section = h[1].trim(); continue; }
    if (section !== 'Exceptions') continue;
    const m = EXCEPTION_RE.exec(line);
    if (m) {
      if (realDate(Number(m[3]), Number(m[4]), Number(m[5]))) out.push({ slug: m[1], key: m[2], date: `${m[3]}-${m[4]}-${m[5]}`, line });
      continue;
    }
    const u = UNSLUGGED_RE.exec(line);
    if (u && realDate(Number(u[2]), Number(u[3]), Number(u[4]))) out.push({ slug: null, key: u[1], date: `${u[2]}-${u[3]}-${u[4]}`, line });
  }
  return out;
}

// CEO exceptions: `## Exceptions` of .company/standards.md. Handoff text never counts. A line counts only for this run, on or
// after the UTC date of the run's latest start; no readable start means no exception.
// `sink`, when given, collects the applied lines for `applied()` and notes a file that exists but cannot be read.
function readExceptions(ctx, slug, warnings, sink = null) {
  const found = new Set();
  if (!ctx || !SLUG_RE.test(slug)) return found;
  const got = readInside(ctx.realRoot, ['.company', 'standards.md'], MAX_STANDARDS);
  if (got.status === 'missing') return found;
  if (got.status !== 'ok' && sink) sink.failed = sink.failed ?? 'cannot read standards.md';
  if (got.status === 'refused') {
    warnings.push('warning: standards.md is a link, not a plain file or over 256 KiB; no exceptions applied');
    return found;
  }
  if (got.status === 'error') {
    warnings.push('warning: standards.md could not be read; no exceptions applied');
    return found;
  }
  let started;
  const startDate = () => {
    if (started === undefined) {
      started = null;
      try {
        const s = showRun(ctx.root, slug).started;
        if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(s)) started = s.slice(0, 10);
      } catch { started = null; }
      if (started === null) warnings.push(`warning: run ${slug} has no start; no exceptions applied`);
    }
    return started;
  };
  const unslugged = new Set();
  for (const e of exceptionLines(got.text)) {
    if (e.slug === null) {
      if (!unslugged.has(e.key)) {
        unslugged.add(e.key);
        warnings.push(`warning: exception ${e.key} names no run; not applied`);
      }
    } else if (e.slug === slug) {
      const from = startDate();
      if (from !== null && e.date >= from) { found.add(e.key); sink?.exceptions.push(e.line); }
    }
  }
  return found;
}

// CEO rulings: `## Rulings` of .company/work/<slug>/rulings.md. The last line for a key counts. Returns Map key -> { verb, at }.
function readRulings(ctx, slug, warnings, sink = null) {
  const rulings = new Map();
  if (!ctx || !SLUG_RE.test(slug)) return rulings;
  const got = readInside(ctx.realRoot, ['.company', 'work', slug, 'rulings.md'], MAX_RULINGS);
  if (got.status === 'missing') return rulings;
  if (got.status !== 'ok') {
    if (sink) sink.failed = sink.failed ?? 'cannot read rulings.md';
    warnings.push('warning: rulings.md is a link, not a plain file, over 64 KiB or unreadable; no rulings applied');
    return rulings;
  }
  let section = '';
  let fence = false;
  const lines = got.text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^`{3,}/.test(line)) { fence = !fence; continue; }
    if (fence || line.length > MAX_LINE) continue;
    const h = /^## (.*)$/.exec(line);
    if (h) { section = h[1].trim(); continue; }
    if (section !== 'Rulings') continue;
    const m = RULING_RE.exec(line);
    if (m && realDate(Number(m[4]), Number(m[5]), Number(m[6]))) rulings.set(m[1], { verb: m[2], at: `rulings.md line ${i + 1}`, no: i, line });
  }
  return rulings;
}

// The number of `## Exceptions` lines that name `<slug>/`, any date. Returns { code, line }.
export function exceptionsFor(root, slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return { code: 2, line: 'ERROR slug must match ^[a-z0-9][a-z0-9-]{0,63}$' };
  let realRoot;
  try { realRoot = realpathSync.native(root); } catch { return { code: 1, line: 'ERROR cannot read standards.md' }; }
  const got = readInside(realRoot, ['.company', 'standards.md'], MAX_STANDARDS);
  if (got.status === 'missing') return { code: 0, line: 'exceptions on file: 0' };
  if (got.status !== 'ok') return { code: 1, line: 'ERROR cannot read standards.md' };
  return { code: 0, line: `exceptions on file: ${exceptionLines(got.text).filter(e => e.slug === slug).length}` };
}

// The state table of a run folder: { states: Map key -> state, unresolved, escalated, ruled, excepted, lineages, warnings, errors }.
export function contests(runFolder, sink = null) {
  const out = { states: new Map(), unresolved: [], escalated: [], ruled: [], excepted: [], lineages: [], warnings: [], errors: [] };
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

  // One finding followed through the Handoffs of its Role; the fresh reviewer's plan and code modes are separate lineages.
  const lineages = new Map();
  const byRoleN = new Map();
  for (const f of files) {
    for (const r of f.rows) {
      const mode = f.role === 'fresh-reviewer' ? f.mode : '';
      const id = `${f.role}:${mode}:${r.n}`;
      if (!lineages.has(id)) {
        const l = { role: f.role, mode, n: r.n, holders: [], contest: null, answer: null, answeredIn: new Set() };
        lineages.set(id, l);
        const slot = `${f.role}:${r.n}`;
        byRoleN.set(slot, [...(byRoleN.get(slot) ?? []), l]);
      }
      lineages.get(id).holders.push({ f, tag: r.tag, secure: r.secure, text: r.text });
    }
  }
  const find = key => {
    const m = KEY_RE.exec(key);
    const l = m && (byRoleN.get(`${m[2]}:${Number(m[3])}`) ?? []).find(x => x.holders.some(h => h.f.nn === Number(m[1])));
    return l ? { l, nn: Number(m[1]) } : null;
  };
  const keyOf = l => `${l.holders[0].f.prefix}-${l.role}:R-${l.n}`;
  const isSecure = l => SECURITY_ROLES.has(l.role) || l.holders.some(h => h.tag === 'security' || h.secure);
  const isComprehension = l => l.holders.some(h => h.tag === 'comprehension');
  const ctx = runContext(runAbs);

  for (const f of files) {
    for (const c of f.contested) {
      const hit = find(c.key);
      if (!hit) { err(`${c.at}: contest of ${c.key}, which no Handoff holds as a Blocking finding`); continue; }
      if (f.nn <= hit.nn) { err(`${c.at}: a contest must come from a Handoff above ${c.key}`); continue; }
      if (f.role === hit.l.role || REVIEWERS.has(f.role)) { err(`${c.at}: ${c.key} is contested by a builder, not by a reviewer`); continue; }
      if (isComprehension(hit.l)) { err(`${c.at}: comprehension finding ${c.key} cannot be contested; change the text`); continue; }
      if (hit.l.contest) { err(`${c.at}: second contest on ${keyOf(hit.l)}; one contest per finding`); continue; }
      if (c.kind === 'escalate') hit.l.contest = { nn: f.nn, escalate: true };
      else if (c.kind === 'evidence' && evidenceOk(ctx, c.refs)) hit.l.contest = { nn: f.nn, escalate: false };
      else err(`${c.at}: contest of ${c.key} has no checkable evidence`);
    }
  }
  for (const f of files) {
    for (const a of f.answers) {
      const hit = find(a.key);
      if (!hit) { err(`${a.at}: answer to ${a.key}, which no Handoff holds as a Blocking finding`); continue; }
      hit.l.answeredIn.add(f.file);
      if (f.role !== hit.l.role || (f.role === 'fresh-reviewer' && f.mode !== hit.l.mode)) { err(`${a.at}: only the Role that raised ${a.key} may answer its contest`); continue; }
      if (!hit.l.contest) { err(`${a.at}: ${a.key} has no contest to answer`); continue; }
      if (f.nn <= hit.l.contest.nn) { err(`${a.at}: an answer must come from a Handoff after the contest`); continue; }
      if (hit.l.contest.escalate) { err(`${a.at}: ${a.key} is escalated; only a CEO ruling closes it`); continue; }
      if (a.verb === 'accepted' && isSecure(hit.l)) {
        err(`${a.at}: security finding ${a.key} never closes by contest; fix it or ask the CEO for an exception`);
        continue;
      }
      hit.l.answer = a.verb;
    }
  }

  const slug = basename(runAbs);
  const excepts = readExceptions(ctx, slug, out.warnings, sink);
  const rulings = readRulings(ctx, slug, out.warnings, sink);
  const keyed = [...lineages.values()].map(l => [keyOf(l), l]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [key, l] of keyed) {
    const r = l.contest?.escalate ? rulings.get(key) : undefined;
    if (r && r.verb === 'overruled' && isSecure(l)) {
      err(`${r.at}: ruling on security finding ${key} is refused; fix it or ask the CEO for an exception`);
    } else if (r) {
      l.ruling = r.verb;
      sink?.rulings.push(r);
    }
  }
  for (const [key, l] of keyed) {
    const last = l.holders[l.holders.length - 1].f;
    const fixed = files.some(f => f.role === l.role && f.mode === last.mode && f.nn > last.nn && f.round > last.round && f.status === 'done'
      && !l.holders.some(h => h.f === f) && !l.answeredIn.has(f.file));
    let state = 'open';
    if (excepts.has(key)) state = 'excepted';
    else if (l.answer === 'accepted') state = 'accepted';
    else if (fixed) state = 'fixed';
    else if (l.ruling === 'overruled') state = 'overruled';
    else if (l.ruling === 'upheld') state = 'upheld';
    else if (l.contest?.escalate) state = 'escalated';
    else if (l.answer === 'rejected') state = 'rejected';
    else if (l.contest) state = 'contested';
    out.states.set(key, state);
    if (state === 'contested') out.unresolved.push(key);
    if (state === 'escalated') out.escalated.push(key);
    if (l.ruling && state === l.ruling) out.ruled.push(`${key} ${l.ruling}`);
    if (state === 'excepted') out.excepted.push(key);
    out.lineages.push({
      key, role: l.role, mode: l.mode, n: l.n, state,
      holders: l.holders.map(h => ({ file: h.f.file, nn: h.f.nn, round: h.f.round, tag: h.tag, text: h.text })),
    });
  }
  return out;
}

const MAX_PRINT = 1000;
const UNSAFE_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

// One listed line: "> " plus the line, cut at 1000 characters, control, format and line-separator characters as \u{hex}.
export function printLine(line) {
  const cut = line.length > MAX_PRINT ? line.slice(0, MAX_PRINT) : line;
  const out = ['> ' + cut.replace(UNSAFE_CHAR, c => '\\u{' + c.codePointAt(0).toString(16) + '}')];
  if (line.length > MAX_PRINT) out.push('> … (' + (line.length - MAX_PRINT) + ' more characters)');
  return out;
}

// The rulings and exceptions that apply to a run, as the lint counts them: { code, lines }. Code 2 is a bad run folder.
export function applied(runFolder) {
  const runAbs = resolve(runFolder);
  const ctx = runContext(runAbs);
  const slug = basename(runAbs);
  if (!ctx || !SLUG_RE.test(slug)) return { code: 2, lines: [] };
  const sink = { rulings: [], exceptions: [], failed: null };
  const r = contests(runAbs, sink);
  if (sink.failed) return { code: 1, lines: ['ERROR ' + sink.failed] };
  const rulings = [...sink.rulings].sort((a, b) => a.no - b.no);
  const lines = ['rulings on file: confirm each is yours (' + rulings.length + ')'];
  rulings.forEach(x => lines.push(...printLine(x.line)));
  lines.push('exceptions on file for ' + slug + ': confirm each is yours (' + sink.exceptions.length + ')');
  sink.exceptions.forEach(x => lines.push(...printLine(x)));
  r.warnings.filter(w => w.startsWith('warning: run ') || w.startsWith('warning: exception ')).forEach(w => lines.push(w));
  return { code: 0, lines };
}

function main(argv) {
  const USAGE = 'usage: node scripts/handoff-lint.mjs <handoff.md> [--require-top] | --findings <ledger.md> | --contests <run folder> | --applied <run folder> | --exceptions-for <slug>';
  const args = argv.slice(2);
  if (args[0] === '--applied') {
    if (args.length !== 2 || args[1].startsWith('--')) { console.log(USAGE); return 2; }
    const r = applied(args[1]);
    if (r.code === 2) { console.log(USAGE); return 2; }
    r.lines.forEach(l => console.log(l));
    return r.code;
  }
  if (args[0] === '--exceptions-for') {
    if (args.length !== 2) { console.log(USAGE); return 2; }
    const r = exceptionsFor(process.cwd(), args[1]);
    console.log(r.line);
    return r.code;
  }
  if (args[0] === '--contests') {
    if (args.length !== 2 || args[1].startsWith('--')) { console.log(USAGE); return 2; }
    const r = contests(args[1]);
    r.errors.forEach(e => console.log(`ERROR ${e}`));
    r.warnings.forEach(w => console.log(w));
    for (const [k, v] of r.states) console.log(`state ${k} ${v}`);
    r.unresolved.forEach(k => console.log(`unresolved ${k}`));
    r.escalated.forEach(k => console.log(`escalated ${k}`));
    r.ruled.forEach(k => console.log(`ruled ${k}`));
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
  (r.warnings ?? []).forEach(w => console.log(w));
  if (!r.errors.length) console.log(JSON.stringify(wantLedger ? r.ledger : r.routing));
  return r.errors.length ? 1 : 0;
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) process.exit(main(process.argv));
