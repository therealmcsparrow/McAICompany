#!/usr/bin/env node
// Deterministic reflection on a run: a check of one Step and a retrospective of the whole run.
// No model call and no write. Spend and time numbers come from the ledger report, never recomputed.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lint } from './handoff-lint.mjs';
import { main as ledgerMain } from './ledger.mjs';
import { checkText, ROLE_RE } from './lessons.mjs';
import { isWorkFolder, exactWorkPath, WorkFolderRefusal } from '../mods/lib/work-folder.mjs';

const MAX_BYTES = 64 * 1024;
const MAX_STEPS = 200;
const FILE_RE = /^(\d{2,3})-[a-z0-9-]+\.md$/;
const TAGS = ['contract', 'spec', 'security', 'test'];
const STATUSES = new Set(['done', 'blocked', 'needs-ceo', 'handover']);
const REVIEW_ROLES = new Set(['code-reviewer', 'qa', 'security', 'compliance', 'accessibility-tester']);
const USAGE = 'usage: reflect.mjs step <slug> <file> --json | retro <slug> --json';
const CONTROL = /[\p{C}\p{Zl}\p{Zp}]/gu;

class Refusal extends Error {}

const cut = (text, n) => [...text].slice(0, n).join('').trimEnd();
const plain = (text) => text.replace(CONTROL, ' ');

// ---------- reading a Handoff ----------

function frontmatter(lines) {
  const fm = Object.create(null);
  if (lines[0] !== '---') return fm;
  for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
    const m = /^([a-z-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}

// Lines of each `## ` section, outside code fences. Text inside a fence is data.
function sectionsOf(lines) {
  const out = new Map();
  let end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  let section = null;
  let fence = 0;
  for (let i = end + 1; i < lines.length; i++) {
    const line = lines[i];
    const f = /^(`{3,})/.exec(line);
    if (fence) {
      if (f && f[1].length >= fence && /^`+[ \t]*$/.test(line)) fence = 0;
      continue;
    }
    if (f) { fence = f[1].length; continue; }
    const h = /^## (.*)$/.exec(line);
    if (h) { section = h[1].trim(); if (!out.has(section)) out.set(section, []); continue; }
    if (section !== null) out.get(section).push(line);
  }
  return out;
}

const firstBullet = (lines) => {
  for (const line of lines ?? []) {
    const m = /^- (.*)$/.exec(line);
    if (m) return m[1].trim();
  }
  return null;
};

function blockingByTag(lines) {
  const counts = Object.fromEntries(TAGS.map((t) => [t, 0]));
  const first = {};
  for (const line of lines ?? []) {
    const m = /^- \[(contract|spec|security|test)\][ \t]*(.*)$/.exec(line);
    if (!m) continue;
    counts[m[1]] += 1;
    if (!(m[1] in first)) first[m[1]] = m[2].trim();
  }
  return { counts, first };
}

// Everything one Step says about itself: fields, the wrong items and the lesson candidates.
function analyze(text, nn, rows) {
  const lines = text.split(/\r?\n/);
  const fm = frontmatter(lines);
  const sections = sectionsOf(lines);
  const role = ROLE_RE.test(fm.role ?? '') ? fm.role : 'unknown';
  const status = STATUSES.has(fm.status) ? fm.status : 'unknown';
  const did = firstBullet(sections.get('Did'));
  const decision = firstBullet(sections.get('Decisions'));
  const { counts, first } = blockingByTag(sections.get('Blocking'));
  const lintError = lint(text).errors[0] ?? null;
  const dispatches = (rows ?? []).filter((r) => r.id === nn).length;

  const wrong = [];
  for (const tag of TAGS) if (counts[tag] > 0) wrong.push(`${tag} blocker: ${counts[tag]}`);
  if (lintError) wrong.push(`lint: ${cut(lintError, 160)}`);
  if (dispatches > 1) wrong.push(`re-dispatch: ${dispatches}`);
  if (status === 'handover') wrong.push('handover');

  const byTag = TAGS.filter((t) => counts[t] > 0).map((t) => `${t} finding in Step ${nn}: ${cut(first[t], 160)}`);
  const extra = [];
  if (status === 'handover') extra.push(`Step ${nn} reached its context cap; split the task or raise the cap`);
  if (lintError) extra.push(`Handoff failed lint: ${cut(lintError, 120)}`);
  return { fm, role, status, did, decision, counts, wrong, byTag, extra };
}

const asLessons = (role, texts) =>
  role === 'unknown' ? [] : texts.filter((t) => checkText(t) === null).map((t) => ({ role, text: t }));

export function checkStep(text, nn, ctx = {}) {
  const a = analyze(text, nn, ctx.rows);
  return {
    v: 1,
    step: nn,
    role: a.role,
    status: a.status,
    did: a.did === null ? 'no Did section' : cut(a.did, 160),
    wrong: a.wrong,
    remember: a.decision === null ? null : cut(a.decision, 160),
    lessons: asLessons(a.role, [...a.byTag, ...a.extra]).slice(0, 3)
  };
}

// The rendered check: at most 5 lines, one line each. Lessons are labelled suggested until accepted.
export function renderStep(check) {
  const lines = [
    `Did: ${plain(check.did)}`,
    `Went wrong: ${check.wrong.length ? plain(check.wrong.join('; ')) : 'nothing'}`,
    `Remember: ${check.remember === null ? 'nothing' : plain(check.remember)}`
  ];
  if (check.lessons.length) {
    lines.push(`Suggested lessons: ${plain(check.lessons.map((l) => l.text).join(' / '))}`);
    lines.push('These are suggested only; nothing is saved until you accept each one.');
  }
  return lines;
}

// ---------- retrospective ----------

function topBy(rows, key, shape) {
  return rows
    .filter((r) => /^\d{2,3}$/.test(r.id ?? '') && Number.isInteger(r[key]))
    .sort((a, b) => b[key] - a[key] || parseInt(a.id, 10) - parseInt(b.id, 10))
    .slice(0, 3)
    .map(shape);
}

export function buildRetro(slug, steps, report, outcome, warnings = []) {
  const out = [...warnings];
  const rows = report ? report.rows : [];
  if (!report || (Array.isArray(report.warnings) && report.warnings.includes('no ledger'))) out.push('no ledger');
  const fixCauses = Object.fromEntries(TAGS.map((t) => [t, 0]));
  const lessons = [];
  const stepLessons = [];
  for (const s of steps) {
    const a = analyze(s.text, s.nn, rows);
    if (REVIEW_ROLES.has(a.role)) for (const t of TAGS) fixCauses[t] += a.counts[t];
    stepLessons.push(...asLessons(a.role, a.extra));
  }
  let topTag = null;
  for (const t of TAGS) if (fixCauses[t] > 0 && (topTag === null || fixCauses[t] > fixCauses[topTag])) topTag = t;
  if (topTag) {
    lessons.push(...asLessons('lead', [`${topTag} findings caused ${fixCauses[topTag]} Fix-round items; check the ${topTag} rules before review`]));
  }
  lessons.push(...stepLessons);
  return {
    v: 1,
    slug,
    outcome,
    top_spend: topBy(rows, 'spend', (r) => ({ step: r.id, role: r.role, spend: r.spend })),
    top_time: topBy(rows, 'ms', (r) => ({ step: r.id, role: r.role, ms: r.ms })),
    fix_causes: fixCauses,
    lessons: lessons.slice(0, 3),
    warnings: out
  };
}

// ---------- files ----------

function plainDir(p) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    return false;
  }
  return st.isDirectory();
}

function workDir(slug) {
  if (!isWorkFolder(slug)) throw new Refusal('run must be a work folder name');
  const company = path.join(process.cwd(), '.company');
  const work = path.join(company, 'work');
  const dir = path.join(work, slug);
  // Exact letter case first; a missing folder keeps the `no run folder` refusal below.
  try {
    exactWorkPath({ fs, path }, process.cwd(), [slug]);
  } catch (error) {
    if (error instanceof WorkFolderRefusal) throw new Refusal(error.message);
    throw error;
  }
  if (!plainDir(company) || !plainDir(work) || !plainDir(dir)) throw new Refusal(`no run folder for ${slug}`);
  return dir;
}

// Returns the text, or null when the file is missing, not a plain file, or over the limit.
function readSmall(file) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function runOutcome(dir) {
  const text = readSmall(path.join(dir, 'run-state.jsonl'));
  if (text === null) return 'unknown';
  let outcome = 'unknown';
  for (const line of text.split('\n')) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec === null || typeof rec !== 'object') continue;
    if (rec.ev === 'start') outcome = 'unknown';
    else if (rec.ev === 'end' && (rec.outcome === 'ship' || rec.outcome === 'abort')) outcome = rec.outcome;
  }
  return outcome;
}

// The ledger's own report, parsed. null when the run has no usable ledger.
function ledgerReport(slug) {
  let result;
  try {
    result = ledgerMain(['report', slug, '--json', '--live']);
  } catch {
    return null;
  }
  if (result.code !== 0) return null;
  try {
    const data = JSON.parse(result.lines.join('\n'));
    return data && Array.isArray(data.rows) ? data : null;
  } catch {
    return null;
  }
}

// An absolute path may reach the run folder through a symlinked parent (macOS /var -> /private/var); compare real paths.
function realOr(p) {
  try { return fs.realpathSync(p); } catch { throw new Refusal('file must be in the run folder'); }
}

function resolveStepFile(dir, file) {
  if (typeof file !== 'string' || file === '') throw new Refusal(USAGE);
  const abs = path.resolve(process.cwd(), file);
  const name = path.basename(abs);
  const bare = !file.includes('/') && !file.includes('\\');
  if (!bare) {
    // A path into the work folder root must keep the exact letter case of every segment.
    // path.relative ignores case on win32, so the .company/work pair is checked first (ASCII fold only, as handoff-lint does).
    const top = path.relative(process.cwd(), abs).split(path.sep);
    const ascii = x => x.replace(/[A-Z]/g, c => c.toLowerCase());
    if (ascii(top[0]) === '.company' && ascii(top[1] ?? '') === 'work' && (top[0] !== '.company' || top[1] !== 'work')) {
      throw new Refusal('wrong letter case');
    }
    const parts = path.relative(path.join(process.cwd(), '.company', 'work'), abs).split(path.sep);
    if (parts[0] !== '..' && !path.isAbsolute(parts[0])) {
      // path.relative folds with toLowerCase on win32 (U+212A becomes k), so inside means nothing until the typed spelling is exact.
      if (top[0] !== '.company' || top[1] !== 'work') throw new Refusal('file must be in the run folder');
      try {
        // The slug segment must be listed as typed; 'missing' (a look-alike such as U+212A) is refused.
        if (exactWorkPath({ fs, path }, process.cwd(), parts.slice(0, 1)) !== 'exact') throw new Refusal('file must be in the run folder');
        exactWorkPath({ fs, path }, process.cwd(), parts);
      } catch (error) {
        if (error instanceof WorkFolderRefusal) throw new Refusal(error.message);
        throw error;
      }
    }
  }
  if (!bare && path.relative(realOr(dir), realOr(path.dirname(abs))) !== '') throw new Refusal('file must be in the run folder');
  if (!FILE_RE.test(name)) throw new Refusal('file must match ^\\d{2,3}-[a-z0-9-]+\\.md$');
  return { name, full: path.join(dir, name) };
}

function cmdStep(args) {
  if (args.length !== 3 || args[2] !== '--json') throw new Refusal(USAGE);
  const dir = workDir(args[0]);
  const { name, full } = resolveStepFile(dir, args[1]);
  const text = readSmall(full);
  if (text === null) throw new Refusal(`${name} is missing, not a plain file or over 64 KiB`);
  const report = ledgerReport(args[0]);
  return checkStep(text, FILE_RE.exec(name)[1], { rows: report ? report.rows : [] });
}

function cmdRetro(args) {
  if (args.length !== 2 || args[1] !== '--json') throw new Refusal(USAGE);
  const slug = args[0];
  const dir = workDir(slug);
  const warnings = [];
  const steps = [];
  const all = fs.readdirSync(dir).filter((n) => FILE_RE.test(n)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || (a < b ? -1 : a > b ? 1 : 0));
  if (all.length > MAX_STEPS) warnings.push(`only ${MAX_STEPS} Step files read`);
  const names = all.slice(-MAX_STEPS);
  for (const name of names) {
    const text = readSmall(path.join(dir, name));
    if (text === null) warnings.push(`${name} skipped`);
    else steps.push({ nn: FILE_RE.exec(name)[1], text });
  }
  return buildRetro(slug, steps, ledgerReport(slug), runOutcome(dir), warnings);
}

export function main(args) {
  const [command, ...rest] = args;
  try {
    if (command === 'step') return { code: 0, lines: [JSON.stringify(cmdStep(rest))] };
    if (command === 'retro') return { code: 0, lines: [JSON.stringify(cmdRetro(rest))] };
    throw new Refusal(USAGE);
  } catch (error) {
    if (error instanceof Refusal) return { code: 2, lines: [`refused: ${error.message}`] };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, lines } = main(process.argv.slice(2));
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
