#!/usr/bin/env node
// contract: docs/contracts/lead-relay.md v1
// uses: docs/contracts/lead-handoff.md v3.0 docs/contracts/run-state.md v3.1
// Lead relay: CLI words `open`, `again`, `read` for the Lead, plus the hook adapters `answer` (PostToolUse, records the CEO's pick
// from tool_response.answers) and `preset` (PreToolUse, denies a pre-filled form). Every stdin field, argument and record line is
// untrusted: sizes are capped before parsing, every field is matched against an allow-list, and a shape that is not pinned in
// tests/lead-relay writes nothing (fail closed). The CEO's Other text lives only in the forms.jsonl answer row and `read --json`.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as handover, workDir, openRegular, readSmall, lstatOrNull, iso } from './lead-handover.mjs';
import { runSlugs, show, MAX_FORMS } from './run-state.mjs';
import { isRunSlug, exactWorkPath } from '../mods/lib/work-folder.mjs';

const FORMS = 'forms.jsonl';
const RESULT = 'lead-result.txt';
const LEAD_TYPE = 'aico:project-manager';
const MAX_RESULT_LINES = 40;
const MAX_RESULT_BYTES = 8192;
const MAX_ARG = 4096;
const MAX_STDIN = 64 * 1024;
const MAX_INPUT = 64 * 1024;
const MAX_OTHER = 2000;
const MAX_TEXT = 500;
const MAX_RUNS = 200;
const SELF_EXIT_MS = 1000;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const BAD_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const ID_RE = /^f(0[1-9]|[1-9]\d)$/;
const RESULT_RE = /^[a-z]{1,20}$/;
const KIND_RE = /^(gate:(brief|plan|ship)|idea|ask|step:[a-z][a-z0-9-]{0,30})$/;
const DENY = 'aico: AskUserQuestion with preset answers is refused';

class Refusal extends Error {}
const refuse = (why) => { throw new Refusal(why); };
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const sha8 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);
const shown = (s) => `other (${s.length} chars, sha256:${sha8(s)})`;

// ---- form record -------------------------------------------------------------------------------------------------

function formsPath(root, slug) {
  const dir = workDir(root, slug);
  if (!dir) refuse('no run');
  if (!lstatOrNull(path.join(dir, 'run-state.jsonl'))?.isFile()) refuse('no run');
  return path.join(dir, FORMS);
}

// Rows of forms.jsonl; a missing file is empty; an unreadable or malformed file throws (fail closed).
function loadRows(file) {
  const st = lstatOrNull(file);
  if (!st) return [];
  const text = readSmall(file, MAX_FORMS);
  if (text === null || !text.endsWith('\n')) throw new Error('forms record unreadable');
  const rows = [];
  for (const line of text.slice(0, -1).split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { throw new Error('forms record unreadable'); }
    if (!isObj(o) || o.v !== 1 || (o.ev !== 'open' && o.ev !== 'answer') || typeof o.id !== 'string' || !ID_RE.test(o.id)) throw new Error('forms record unreadable');
    rows.push(o);
  }
  return rows;
}

const openForms = (rows) => rows.filter((r) => r.ev === 'open' && !rows.some((a) => a.ev === 'answer' && a.id === r.id));

function appendRow(file, row) {
  const line = `${JSON.stringify(row)}\n`;
  const cur = lstatOrNull(file);
  if ((cur ? cur.size : 0) + Buffer.byteLength(line) > MAX_FORMS) throw new Error('forms record full');
  if (!cur) {
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o644);
    try { fs.writeSync(fd, line); } finally { fs.closeSync(fd); }
    return;
  }
  const h = openRegular(file, fs.constants.O_WRONLY | fs.constants.O_APPEND);
  if (!h) throw new Error('forms record not a regular file');
  try { fs.writeSync(h.fd, line); } finally { fs.closeSync(h.fd); }
}

// ---- open --------------------------------------------------------------------------------------------------------

const clean = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && !/[\r\n]/.test(s) && !BAD_CHAR.test(s);

function checkQuestions(kind, qs) {
  if (!KIND_RE.test(kind)) refuse('unknown kind');
  if (!Array.isArray(qs) || qs.length < 1 || qs.length > 4) refuse('1-4 questions');
  const gate = kind.startsWith('gate:');
  const seen = new Set();
  const out = [];
  for (const q of qs) {
    if (!isObj(q) || !clean(q.q, MAX_TEXT)) refuse('bad question');
    if (!clean(q.header, 12) || q.header.includes(']')) refuse('bad header');
    if (typeof q.multi !== 'boolean') refuse('multi must be true or false');
    if (gate && q.multi) refuse('a Gate form is single-select');
    if (seen.has(q.q)) refuse('duplicate question text');
    seen.add(q.q);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) refuse('2-4 options');
    const labels = new Set();
    const options = q.options.map((o) => {
      if (!isObj(o) || !clean(o.label, MAX_TEXT) || !clean(o.description, MAX_TEXT)) refuse('bad option');
      if (o.label.includes(',') || o.label.includes(' — ')) refuse('option label holds a comma or " — "');
      if (labels.has(o.label)) refuse('duplicate option label');
      labels.add(o.label);
      const opt = { label: o.label, description: o.description };
      if (gate) {
        if (typeof o.result !== 'string' || !RESULT_RE.test(o.result)) refuse('a Gate option needs a result');
        opt.result = o.result;
      } else if (o.result !== undefined) refuse('result is for Gate forms only');
      return opt;
    });
    out.push({ q: q.q, header: q.header, multi: q.multi, options });
  }
  return out;
}

function statusBlock(slug, handoff, row) {
  const lines = ['STATUS: needs-ceo', `run: .company/work/${slug}`, `handoff: ${handoff}`, `form: ${row.id}`];
  row.questions.forEach((q, i) => {
    lines.push(`Q${i + 1} [${q.header}]${q.multi ? ' (multi)' : ''}: ${q.q}`);
    for (const o of q.options) lines.push(`- ${o.label} — ${o.description}`);
  });
  return `${lines.join('\n')}\n`;
}

function lastHandoff(root, slug) {
  const r = handover(['read', slug], root);
  return /^last (lead-handoff-\d+\.md)$/m.exec(r.out)?.[1] ?? 'none';
}

// proj.M-SEC7: the questions file's native real path must equal its typed absolute path (letter case may differ on win32/darwin,
// never under .company/work/) and lie inside the native real root; under .company/ only .company/work/ is allowed, by exactWorkPath.
export function confined(root, file, io = { fs, path, realpath: fs.realpathSync.native }) {
  const sep = path.sep;
  const fold = process.platform === 'win32' || process.platform === 'darwin';
  const lexical = path.resolve(root, file);
  let real;
  let base;
  try { real = io.realpath(lexical); base = io.realpath(path.resolve(root)); } catch { return refuse('questions file unreadable'); }
  const outside = (rel) => rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || path.isAbsolute(rel);
  const typed = path.relative(path.resolve(root), lexical);
  if (outside(typed)) refuse('questions file is outside the repo');
  const rel = path.relative(base, real);
  if (outside(rel)) refuse('questions file is outside the repo');
  const parts = typed.split(sep);
  const inCompany = parts[0].toLowerCase() === '.company';
  const inWork = inCompany && parts[0] === '.company' && parts[1] === 'work';
  if (inCompany && !inWork) refuse('questions file is under .company');
  const want = path.join(base, typed);
  const same = inWork || !fold ? real === want : real.toLowerCase() === want.toLowerCase();
  if (!same) refuse('questions file path differs from its real path');
  if (inWork) {
    let r;
    try { r = exactWorkPath({ fs: io.fs, path: io.path }, base, parts.slice(2)); } catch { refuse('questions file path letter case'); }
    if (r !== 'exact') refuse('questions file path is not an exact work path');
  }
  return real;
}

// A form of an ended run gets no reply recorded (the hook skips ended runs), so `open` and `again` refuse it.
function refuseEnded(root, slug) {
  if (show(root, slug).state === 'ended') refuse('run ended');
}

// An open form with the same questions in another unended run would make `answer` match twice and drop the answer.
function refuseSharedForm(root, slug, questions) {
  // Same comparison `answer` uses (sameQuestions): a Gate option's `result` is not compared.
  const want = questions.map((q) => ({ question: q.q, header: q.header, multiSelect: q.multi, options: q.options.map((o) => ({ label: o.label, description: o.description })) }));
  for (const other of runSlugs(root, { max: MAX_RUNS }).slugs) {
    if (other === slug) continue;
    try {
      const st = show(root, other).state;
      if (st !== 'running' && st !== 'stale') continue;
      const dir = workDir(root, other);
      if (!dir) continue;
      for (const r of openForms(loadRows(path.join(dir, FORMS)))) if (sameQuestions(r.questions, want)) refuse(`same questions open in run ${other}`);
    } catch (e) { if (e instanceof Refusal) throw e; /* a broken run is skipped */ }
  }
}

function cmdOpen(root, [slug, kind, file, ...more]) {
  if (typeof file !== 'string' || more.length) refuse('usage');
  if (!isRunSlug(slug)) refuse('bad slug');
  const f = formsPath(root, slug);
  refuseEnded(root, slug);
  const text = readSmall(confined(root, file), MAX_INPUT);
  if (text === null) refuse('questions file unreadable');
  let parsed;
  try { parsed = JSON.parse(text); } catch { refuse('questions file is not JSON'); }
  const questions = checkQuestions(kind, parsed);
  const rows = loadRows(f);
  const open = openForms(rows);
  if (open.length) refuse(`open form ${open[0].id}`);
  refuseSharedForm(root, slug, questions);
  const used = new Set(rows.map((r) => r.id));
  let n = 1;
  while (n < 100 && used.has(`f${String(n).padStart(2, '0')}`)) n++;
  if (n > 99) refuse('no free form id');
  const row = { v: 1, at: iso(Date.now()), ev: 'open', id: `f${String(n).padStart(2, '0')}`, kind, questions };
  appendRow(f, row);
  const w = handover(['write', slug], root);
  const m = /^wrote (.+)$/m.exec(w.out);
  if (w.code !== 0 || !m) throw new Error('lead handoff not written');
  return statusBlock(slug, path.basename(m[1].trim()), row);
}

function cmdAgain(root, [slug, id, ...more]) {
  if (typeof id !== 'string' || more.length) refuse('usage');
  if (!isRunSlug(slug)) refuse('bad slug');
  const rows = loadRows(formsPath(root, slug));
  const row = openForms(rows).find((r) => r.id === id);
  if (!row) refuse('no open form with that id');
  refuseEnded(root, slug);
  refuseSharedForm(root, slug, row.questions);
  return statusBlock(slug, lastHandoff(root, slug), row);
}

function cmdRead(root, args) {
  const json = args[args.length - 1] === '--json';
  const [slug, id, ...more] = json ? args.slice(0, -1) : args;
  if (more.length || (id !== undefined && !ID_RE.test(id))) refuse('usage');
  if (!isRunSlug(slug)) refuse('bad slug');
  const rows = loadRows(formsPath(root, slug));
  const opens = rows.filter((r) => r.ev === 'open');
  const form = id === undefined ? opens[opens.length - 1] : opens.find((r) => r.id === id);
  if (!form) refuse('no such form');
  const ans = rows.filter((r) => r.ev === 'answer' && r.id === form.id).pop();
  const view = !ans ? null : json ? ans : { ...ans, answers: ans.answers.map((a) => ({ labels: a.labels, other: a.other === null ? null : shown(a.other) })) };
  return `${JSON.stringify(form)}\n${view ? `answer: ${JSON.stringify(view)}` : 'answer: none'}\n`;
}

// ---- hook adapters -----------------------------------------------------------------------------------------------

function sameQuestions(form, input) {
  if (!Array.isArray(input) || input.length !== form.length) return false;
  return form.every((q, i) => {
    const p = input[i];
    if (!isObj(p) || p.question !== q.q || p.header !== q.header) return false;
    if (p.multiSelect !== undefined && typeof p.multiSelect !== 'boolean') return false;
    if ((p.multiSelect === true) !== q.multi) return false;
    if (!Array.isArray(p.options) || p.options.length !== q.options.length) return false;
    return q.options.every((o, j) => isObj(p.options[j]) && p.options[j].label === o.label && p.options[j].description === o.description);
  });
}

// One `answers` entry per question, or null when the map is not the pinned shape (cch.M20).
function mapAnswers(form, map) {
  if (!isObj(map) || Object.keys(map).length !== form.length) return null;
  const out = [];
  for (const q of form) {
    if (!Object.hasOwn(map, q.q)) return null;
    const v = map[q.q];
    if (typeof v !== 'string' || v.length === 0 || v.length > 4 * MAX_OTHER + 4 * MAX_TEXT) return null;
    const labels = q.options.map((o) => o.label);
    const trim = (s) => (s.length > MAX_OTHER ? s.slice(0, MAX_OTHER) : s);
    if (labels.includes(v)) { out.push({ labels: [v], other: null }); continue; }
    if (!q.multi) { out.push({ labels: [], other: trim(v) }); continue; }
    const hit = [];
    const rest = [];
    for (const part of v.split(', ')) (labels.includes(part) ? hit : rest).push(part);
    out.push({ labels: hit, other: rest.length ? trim(rest.join(', ')) : null });
  }
  return out;
}

export function answer(text, root = process.cwd()) {
  let p;
  try { p = JSON.parse(text); } catch { return; }
  if (!isObj(p) || p.hook_event_name !== 'PostToolUse' || p.tool_name !== 'AskUserQuestion') return;
  if (Object.hasOwn(p, 'agent_id') || Object.hasOwn(p, 'agent_type')) return;
  if (!isObj(p.tool_input) || !isObj(p.tool_response)) return;
  const hits = [];
  for (const slug of runSlugs(root, { max: MAX_RUNS }).slugs) {
    try {
      const st = show(root, slug).state;
      if (st !== 'running' && st !== 'stale') continue; // a form waits past the 12 h stale mark; only ended/none runs are skipped
      const file = path.join(workDir(root, slug) ?? '', FORMS);
      if (!workDir(root, slug)) continue;
      const open = openForms(loadRows(file));
      if (open.length > 1) { hits.push(null, null); continue; }
      if (open.length === 1 && sameQuestions(open[0].questions, p.tool_input.questions)) hits.push({ file, form: open[0] });
    } catch { /* a broken run is skipped */ }
  }
  if (hits.length !== 1 || hits[0] === null) return;
  const answers = mapAnswers(hits[0].form.questions, p.tool_response.answers);
  if (!answers) return;
  try { appendRow(hits[0].file, { v: 1, at: iso(Date.now()), ev: 'answer', id: hits[0].form.id, src: 'hook', answers }); } catch { /* nothing recorded */ }
}

// SubagentStop adapter: keeps the final STATUS block of a Lead in the run folder, so main can poll `result` when the
// platform backgrounds the spawn and drops the task-notification. The run comes from the block's own `run:` line.
export function record(text, root = process.cwd()) {
  let p;
  try { p = JSON.parse(text); } catch { return; }
  if (!isObj(p) || p.hook_event_name !== 'SubagentStop' || p.agent_type !== LEAD_TYPE || typeof p.last_assistant_message !== 'string') return;
  const lines = p.last_assistant_message.trim().split(/\r?\n/).slice(0, MAX_RESULT_LINES);
  if (!/^STATUS: (needs-ceo|handover|done|blocked)\s*$/.test(lines[0])) return;
  const m = lines.map((l) => /^run: \.company\/work\/(\S+)\s*$/.exec(l)).find(Boolean);
  if (!m || !isRunSlug(m[1])) return;
  try {
    const dir = workDir(root, m[1]);
    if (!dir || !lstatOrNull(path.join(dir, 'run-state.jsonl'))?.isFile()) return;
    const tmp = path.join(dir, `${RESULT}.tmp`);
    fs.writeFileSync(tmp, `${lines.join('\n').slice(0, MAX_RESULT_BYTES)}\n`);
    fs.renameSync(tmp, path.join(dir, RESULT));
  } catch { /* nothing recorded */ }
}

// With no slug (a first Lead, whose run main does not know yet) the newest recorded result of the project.
function cmdResult(root, [slug, ...more]) {
  if (more.length) refuse('usage');
  let files;
  if (slug === undefined) {
    files = runSlugs(root, { max: MAX_RUNS }).slugs.map((s) => path.join(workDir(root, s) ?? '', RESULT));
  } else {
    if (!isRunSlug(slug)) refuse('bad slug');
    const dir = workDir(root, slug);
    if (!dir || !lstatOrNull(path.join(dir, 'run-state.jsonl'))?.isFile()) refuse('no run');
    files = [path.join(dir, RESULT)];
  }
  const hits = files.map((f) => ({ f, st: lstatOrNull(f) })).filter((h) => h.st?.isFile()).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  const text = hits.length ? readSmall(hits[0].f, MAX_RESULT_BYTES + 16) : null;
  return text === null ? 'result: none\n' : `recorded: ${iso(hits[0].st.mtimeMs)}\n${text}`;
}

export function preset(text) {
  let p;
  try { p = JSON.parse(text); } catch { return { code: 0 }; }
  if (!isObj(p)) return { code: 0 };
  if (p.tool_name === 'AskUserQuestion' && isObj(p.tool_input) && Object.hasOwn(p.tool_input, 'answers')) {
    return { code: 0, out: `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: DENY } })}\n` };
  }
  return { code: 0 };
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let over = false;
    process.stdin.on('data', (c) => { total += c.length; if (total > MAX_STDIN) over = true; else chunks.push(c); });
    const done = () => resolve(over ? null : Buffer.concat(chunks).toString('utf8'));
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    process.stdin.on('close', done);
  });
}

async function hook(kind) {
  // preset fails closed: a payload that is oversize or stalls past the self-exit cannot be judged, so it is denied.
  const failClosed = () => `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: DENY } })}\n`;
  let decided = false;
  setTimeout(() => {
    if (kind === 'preset' && !decided) { decided = true; fs.writeSync(1, failClosed()); }
    process.exit(0);
  }, SELF_EXIT_MS).unref();
  const raw = await readStdin();
  if (kind === 'record') {
    if (raw !== null) record(raw);
    process.exitCode = 0;
    return;
  }
  if (kind === 'answer') {
    if (raw !== null) answer(raw);
    process.exitCode = 0;
    return;
  }
  if (decided) return;
  decided = true;
  const out = raw === null ? failClosed() : preset(raw).out;
  if (out) fs.writeSync(1, out);
  process.exitCode = 0;
}

export function main(argv, root = process.cwd()) {
  try {
    for (const a of argv) if (typeof a !== 'string' || a.length > MAX_ARG || BAD_CHAR.test(a)) refuse('argument is not accepted');
    const [cmd, ...rest] = argv;
    if (cmd === 'open') return { code: 0, out: cmdOpen(root, rest) };
    if (cmd === 'again') return { code: 0, out: cmdAgain(root, rest) };
    if (cmd === 'read') return { code: 0, out: cmdRead(root, rest) };
    if (cmd === 'result') return { code: 0, out: cmdResult(root, rest) };
    return refuse('usage: open <slug> <kind> <json-file> | again <slug> <id> | read <slug> [<id>] --json | result <slug>');
  } catch (e) {
    if (e instanceof Refusal) return { code: 1, out: `refused: ${e.message}\n` };
    return { code: 1, out: 'error: failed\n' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [cmd] = process.argv.slice(2);
  if ((cmd === 'answer' || cmd === 'preset' || cmd === 'record') && process.argv.length === 3) {
    hook(cmd).catch(() => { process.exitCode = 0; });
  } else {
    const r = main(process.argv.slice(2));
    (r.code === 0 ? process.stdout : process.stderr).write(r.out);
    process.exitCode = r.code;
  }
}
