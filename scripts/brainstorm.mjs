#!/usr/bin/env node
// Provider CLI for brainstorm-file v2 and brainstorm-reply v1. Node built-ins only; every
// mutation is parsed, rebuilt and re-validated with checkBrainstorm before an atomic write.
import { readFileSync, writeFileSync, renameSync, rmSync, rmdirSync, statSync, lstatSync, readdirSync, mkdirSync, readSync } from 'node:fs';
import { dirname, basename, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBrainstorm } from './check.mjs';

const MAX_FILE = 1024 * 1024;
const MAX_INPUT = 256 * 1024;
const MAX_REPLY_INPUT = 64 * 1024;
const MAX_REPLY = 4096;
const MAX_LINE = 1000;
const MAX_LEAD = 3500;
export const WORD_LIMIT = { ideas: 150, full: 100, crossfire: 80 };
const PASSES = ['ideas', 'full', 'crossfire'];
const MODES = ['ideas', 'moderated', 'debate:crossfire', 'debate:full_pass'];
const FILE_MODES = ['ideas', 'debate', 'moderated'];
const TAGS = ['blocking', 'nice-to-have'];
const ROLE = '[a-z][a-z0-9-]*';
const ROLE_RE = new RegExp(`^${ROLE}$`);
const KEY_RE = new RegExp(`^([^()]{1,40}) \\((${ROLE})\\)$`);
const IDEA_RE = /^I-[1-9]\d{0,5}\.[1-9]\d{0,5}$/;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const STRUCTURE = /^(?:#|\*\*Lead:\*\*|\*\*CEO:\*\*)/;
const MARKERS = [' — src: R', ' — default: ', ' — options: '];

export class Refused extends Error {
  constructor(message) { super(`refused: ${message}`); this.name = 'Refused'; }
}
class Usage extends Error {
  constructor(message) { super(message); this.name = 'Usage'; }
}

const norm = s => s.replace(/\r\n/g, '\n');
const short = s => (s.length > 60 ? `${s.slice(0, 60)}…` : s);
const wordCount = s => (s.match(/\S+/g) ?? []).length;
const hasMarker = s => MARKERS.some(m => s.includes(m));
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sanitize = s => s.replace(new RegExp(CONTROL.source, 'g'), '?');
const normQ = s => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

// ---- brainstorm-reply v1 ----
function skipReply(pass) {
  return { pass, skip: true, ideas: [], risk: null, questions: [], reply_to: null, replies_to: [], estimate: null, lenient: [] };
}

// Lenient labels (brainstorm-reply v1): a stray `I-<r>.<k>: ` reads as `I: `, and a `- ` or `* ` before a template label is
// dropped. Anchored patterns of bounded length only. `found` collects the entries used.
const BULLET_RE = /^[-*] (?=(?:I: |I-\d{1,3}\.\d{1,3}: |Risk: |Q \[|Re: |Estimate: ))/;
const STRAY_RE = /^I-\d{1,3}\.\d{1,3}: /;
const LENIENT_ORDER = ['idea label', 'bullet'];
function lenientLine(line, found = new Set()) {
  let l = line;
  if (BULLET_RE.test(l)) { l = l.slice(2); found.add('bullet'); }
  if (STRAY_RE.test(l)) { l = `I: ${l.replace(STRAY_RE, '')}`; found.add('idea label'); }
  return l;
}

function parseQuestion(line, n, reasons) {
  const m = /^Q \[(blocking|nice-to-have)\]: (.*)$/.exec(line);
  if (!m) { reasons.push(`line ${n}: question tag must be [blocking] or [nice-to-have]`); return null; }
  const rest = m[2];
  const di = rest.lastIndexOf(' | default: ');
  const oi = di < 0 ? -1 : rest.lastIndexOf(' | options: ', di);
  if (oi < 0) { reasons.push(`line ${n}: a question needs options and a default`); return null; }
  const text = rest.slice(0, oi).trim();
  const options = rest.slice(oi + 12, di).split(' / ').map(s => s.trim());
  const def = rest.slice(di + 12).trim();
  if ([text, def, ...options].some(hasMarker)) { reasons.push(`line ${n}: reserved marker inside a question`); return null; }
  if (!text || text.length > 300) { reasons.push(`line ${n}: question text must be 1 to 300 characters`); return null; }
  if (options.length < 2 || options.length > 3 || options.some(o => !o || o.length > 80 || o.includes('|'))) {
    reasons.push(`line ${n}: a question needs 2 or 3 options`); return null;
  }
  if (!options.includes(def)) { reasons.push(`line ${n}: the default must be one of the options`); return null; }
  return { tag: m[1], text, options, default: def };
}

function parseRe(line, n, round, known, role, reasons) {
  const m = /^Re: @([a-z][a-z0-9-]{0,39}) on I-([1-9]\d{0,5})\.([1-9]\d{0,5}): ([a-z-]{1,20}) — (.*)$/.exec(line);
  if (!m) { reasons.push(`line ${n}: Re line is not a template line`); return null; }
  const idea = `I-${m[2]}.${m[3]}`;
  if (!['agree', 'challenge', 'build-on'].includes(m[4])) { reasons.push(`line ${n}: unknown stance ${short(m[4])}`); return null; }
  if (Number(m[2]) > round || (known && !known.has(idea))) { reasons.push(`line ${n}: Re names ${idea}, which does not exist`); return null; }
  if (known instanceof Map) {
    if (role && m[1] === role) { reasons.push(`line ${n}: Re: names your own Role`); return null; }
    if (known.get(idea) !== m[1]) { reasons.push(`line ${n}: Re: ${idea} is not an idea of @${m[1]}`); return null; }
  }
  const text = m[5].trim();
  if (!text) { reasons.push(`line ${n}: Re needs a text`); return null; }
  if (wordCount(text) > 25) { reasons.push(`line ${n}: Re text is longer than 25 words`); return null; }
  return { role: m[1], idea, stance: m[4], text };
}

function parseEstimate(line, n, reasons) {
  const m = /^Estimate: ([SML]), (\d{1,4}(?:\.\d)?)(?:[–-](\d{1,4}(?:\.\d)?))? d$/.exec(line);
  if (!m) { reasons.push(`line ${n}: Estimate must be "S|M|L, <low>–<high> d"`); return null; }
  const low = Number(m[2]), high = m[3] === undefined ? low : Number(m[3]);
  if (low > high) { reasons.push(`line ${n}: Estimate range is reversed`); return null; }
  return { size: m[1], low, high };
}

// Returns { ok: true, reply } or { ok: false, reasons }. `known` is the set of existing idea IDs, or a Map of idea ID to
// author role (adds the owner and own-Role checks), or null to skip those checks.
export function parseReply(input, { pass = 'ideas', role = '', round = 1, known = null } = {}) {
  const bad = reasons => ({ ok: false, reasons });
  if (typeof input !== 'string') return bad(['reply is not text']);
  if (!PASSES.includes(pass)) return bad([`unknown pass ${short(String(pass))}`]);
  if (Buffer.byteLength(input) > MAX_REPLY) return bad(['reply is longer than 4 KiB']);
  const text = norm(input);
  if (CONTROL.test(text)) return bad(['control character in the reply']);
  if (!text.trim()) return bad(['empty reply']);
  if (/^skip$/i.test(text.trim())) return { ok: true, reply: skipReply(pass) };

  const reasons = [], ideas = [], questions = [], res = [], risks = [], estimates = [], found = new Set(), read = [];
  text.split('\n').forEach((raw, i) => {
    const trimmed = raw.trimEnd(), n = i + 1;
    if (!trimmed) return;
    if (trimmed.length > MAX_LINE) { reasons.push(`line ${n}: longer than ${MAX_LINE} characters`); return; }
    const line = lenientLine(trimmed, found);
    read.push(line);
    if (line.startsWith('I: ')) {
      const t = line.slice(3).trim();
      if (t) ideas.push(t); else reasons.push(`line ${n}: empty idea`);
    } else if (line.startsWith('Risk: ')) {
      const t = line.slice(6).trim();
      if (t) risks.push(t); else reasons.push(`line ${n}: empty Risk`);
    } else if (line.startsWith('Q ')) {
      const q = parseQuestion(line, n, reasons);
      if (q) questions.push(q);
    } else if (line.startsWith('Re: ')) {
      const r = parseRe(line, n, round, known, role, reasons);
      if (r) res.push(r);
    } else if (line.startsWith('Estimate: ')) {
      const e = parseEstimate(line, n, reasons);
      if (e) estimates.push(e);
    } else reasons.push(`line ${n}: not a template line`);
  });

  if (ideas.length > 3) reasons.push('more than 3 ideas');
  if (questions.length > 2) reasons.push('more than 2 questions');
  if (risks.length > 1) reasons.push('more than one Risk line');
  else if (risks.length === 0 && pass !== 'full') reasons.push('missing Risk line');
  if (pass === 'full') {
    if (res.length < 1) reasons.push('a full-pass reply needs 1 to 3 Re lines');
    if (res.length > 3) reasons.push('more than 3 Re lines');
  } else if (res.length > 1) reasons.push('more than 1 Re line');
  const mustEstimate = pass === 'ideas' && role === 'architect';
  if (estimates.length > 1) reasons.push('more than one Estimate line');
  if (estimates.length && !mustEstimate) reasons.push(`Estimate is not allowed for ${role || 'this Role'} in the ${pass} pass`);
  if (!estimates.length && mustEstimate) reasons.push('the architect needs an Estimate line');
  const words = wordCount(read.join('\n'));
  if (words > WORD_LIMIT[pass]) reasons.push(`reply has ${words} words, the limit for the ${pass} pass is ${WORD_LIMIT[pass]}`);
  if (reasons.length) return bad(reasons);
  return {
    ok: true,
    reply: { pass, skip: false, ideas, risk: risks[0] ?? null, questions, reply_to: res[0] ?? null, replies_to: res, estimate: estimates[0] ?? null, lenient: LENIENT_ORDER.filter(x => found.has(x)) },
  };
}

// Stored form of a malformed reply: marked, bounded, and unable to forge file structure.
function storeMalformed(raw) {
  let t = sanitize(norm(raw)), cut = false;
  if (t.length > MAX_REPLY) { t = t.slice(0, MAX_REPLY); cut = true; }
  const out = ['(malformed)'];
  if (t.trim()) {
    for (const l of t.trimEnd().split('\n')) {
      const x = l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}…` : l;
      out.push(STRUCTURE.test(x) ? `> ${x}` : x);
    }
  }
  if (cut) out.push('(truncated)');
  return out.join('\n');
}

// ---- file model ----
function parseFront(lines) {
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const fm = new Map();
  for (const l of lines.slice(1, end)) {
    const m = /^([a-zA-Z_-]+):\s*(.*)$/.exec(l);
    if (m) fm.set(m[1], m[2]);
  }
  return { fm, end };
}

function secRange(L, name) {
  const s = L.findIndex(l => /^## (.+)$/.test(l) && l.slice(3).trim() === name);
  let e = L.length;
  for (let i = s + 1; i < L.length; i++) if (/^## /.test(L[i])) { e = i; break; }
  return [s + 1, e];
}

function readRounds(L) {
  const [s, e] = secRange(L, 'Rounds');
  const rounds = [];
  let cur = null, rep = null, region = null;
  for (let i = s; i < e; i++) {
    const line = L[i];
    let m;
    if (line.startsWith('### ')) {
      m = /^### Round (\d{1,6}) — (.*)$/.exec(line);
      cur = { n: Number(m[1]), mode: m[2], at: i, end: i + 1, replies: [], leadAt: null, leadLines: [], ceoAt: null, ceoLines: [] };
      rounds.push(cur); rep = null; region = null;
    } else if (!cur) continue;
    else if (line.startsWith('#### ')) {
      m = /^#### ([^()]+) \((.+?)\)(?: — (full pass|crossfire))?$/.exec(line);
      rep = { name: m[1], role: m[2], key: `${m[1]} (${m[2]})`, pass: m[3] === 'full pass' ? 'full' : m[3] === 'crossfire' ? 'crossfire' : 'ideas', at: i, lines: [] };
      cur.replies.push(rep); region = null;
    } else if (line.startsWith('**Lead:**')) { cur.leadAt = i; cur.leadLines = [line.slice(9).trim()]; rep = null; region = 'lead'; }
    else if (line.startsWith('**CEO:**')) { cur.ceoAt = i; cur.ceoLines = [line.slice(8).trim()]; rep = null; region = 'ceo'; }
    else if (rep) rep.lines.push(line);
    else if (region) cur[`${region}Lines`].push(line);
    if (cur && line !== '') cur.end = i + 1;
  }
  const owners = new Map(), texts = new Map();
  for (const r of rounds) {
    let k = 0;
    for (const rep2 of r.replies) {
      rep2.body = rep2.lines.join('\n').trim();
      rep2.status = rep2.body === 'skip' ? 'skip' : rep2.body.startsWith('(malformed)') ? 'malformed' : 'ok';
      if (rep2.status === 'ok') {
        const p = parseReply(rep2.body, { pass: rep2.pass, role: rep2.role, round: r.n });
        if (p.ok) rep2.parsed = p.reply; else rep2.status = 'malformed';
      }
      rep2.ids = [];
      if (rep2.status === 'ok') for (const t of rep2.parsed.ideas) {
        const id = `I-${r.n}.${++k}`;
        rep2.ids.push(id); owners.set(id, rep2); texts.set(id, t);
      }
    }
    r.ideaCount = k;
    r.closed = r.leadAt !== null || r.ceoAt !== null;
  }
  return { rounds, owners, texts };
}

function loadDoc(text, file = 'brainstorm') {
  if (typeof text !== 'string') throw new Refused('input is not text');
  const lf = norm(text);
  const L = lf.split('\n');
  while (L.length && L.at(-1) === '') L.pop();
  const front = parseFront(L);
  if (front?.fm.get('kind') === 'film') throw new Refused(`${file} is a film script, not a brainstorm`);
  if (front && !front.fm.has('format')) throw new Refused(`${file} is a v1 brainstorm file, which is never rewritten`);
  const errors = checkBrainstorm(lf, { file });
  if (errors.length) throw new Refused(`the file fails the check: ${errors.join('; ')}`);
  const roster = front.fm.get('roles').split(',').map(s => s.trim());
  return { L, roster, topic: front.fm.get('topic') ?? '', ...readRounds(L) };
}

const finish = (L, file) => {
  const out = `${L.join('\n')}\n`;
  const errors = checkBrainstorm(out, { file });
  if (errors.length) throw new Refused(errors.join('; '));
  return out;
};

function addToPart(L, part, item) {
  const [s, e] = secRange(L, 'Digest');
  let h = -1;
  for (let i = s; i < e; i++) if (L[i] === `### ${part}`) { h = i; break; }
  if (h < 0) {
    let at = e;
    while (at > s && L[at - 1] === '') at--;
    L.splice(at, 0, `### ${part}`, item);
    return;
  }
  let last = h;
  for (let i = h + 1; i < e && !L[i].startsWith('### '); i++) if (L[i] !== '') last = i;
  L.splice(last + 1, 0, item);
}

function removeFromPart(L, part, pred) {
  const [s, e] = secRange(L, 'Digest');
  const h = L.findIndex((l, i) => i >= s && i < e && l === `### ${part}`);
  if (h < 0) return;
  let end = e;
  for (let i = h + 1; i < e; i++) if (L[i].startsWith('### ')) { end = i; break; }
  for (let i = end - 1; i > h; i--) if (pred(L[i])) L.splice(i, 1);
}

const ownerMap = doc => new Map([...doc.owners].map(([id, rep]) => [id, rep.role]));

const nextId = (L, prefix) => {
  const [s, e] = secRange(L, 'Digest');
  let max = 0;
  for (let i = s; i < e; i++) {
    const m = new RegExp(`^- ${prefix}-(\\d{1,6}) `).exec(L[i]);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
};

// ---- questions ----
function parseQ(line) {
  const m = /^- Q-(\d{1,6}) \[(blocking|nice-to-have)\] votes:(\d{1,6}) status:(open|answered|parked) — (.*)$/.exec(line);
  if (!m) return null;
  const rest = m[5];
  const si = rest.lastIndexOf(' — src: R');
  const di = si < 0 ? -1 : rest.lastIndexOf(' — default: ', si);
  const oi = di < 0 ? -1 : rest.lastIndexOf(' — options: ', di);
  if (oi < 0) return null;
  return {
    id: Number(m[1]), tag: m[2], votes: Number(m[3]), status: m[4], text: rest.slice(0, oi),
    options: rest.slice(oi + 12, di).split(' | '), default: rest.slice(di + 12, si), src: rest.slice(si + 9),
  };
}
const fmtQ = q => `- Q-${q.id} [${q.tag}] votes:${q.votes} status:${q.status} — ${q.text} — options: ${q.options.join(' | ')} — default: ${q.default} — src: R${q.src}`;
const questionsOf = L => {
  const [s, e] = secRange(L, 'Questions');
  const out = [];
  for (let i = s; i < e; i++) { const q = parseQ(L[i]); if (q) out.push({ i, q }); }
  return out;
};

function checkQuestion({ text, options, default: def, tag }) {
  if (!TAGS.includes(tag)) throw new Refused('tag must be blocking or nice-to-have');
  if (typeof text !== 'string' || CONTROL.test(text) || text.includes('\n')) throw new Refused('question text must be one line of plain text');
  const t = text.trim();
  if (!t || t.length > 300) throw new Refused('question text must be 1 to 300 characters');
  if (hasMarker(t)) throw new Refused('question text holds a reserved marker');
  if (!Array.isArray(options) || options.length < 2 || options.length > 6
    || options.some(o => typeof o !== 'string' || !o.trim() || o.length > 80 || /[|\n]/.test(o) || CONTROL.test(o) || hasMarker(o)))
    throw new Refused('options must be 2 to 6 short texts without "|"');
  const opts = options.map(o => o.trim());
  if (typeof def !== 'string' || !opts.includes(def.trim())) throw new Refused('default must be one of the options');
  return { text: t, options: opts, default: def.trim(), tag };
}

function addQuestion(L, q, round, ceo) {
  const all = questionsOf(L);
  const key = normQ(q.text);
  const dup = all.find(x => normQ(x.q.text) === key);
  if (dup) { dup.q.votes = Math.min(dup.q.votes + 1, 999999); L[dup.i] = fmtQ(dup.q); return; }
  const id = all.reduce((m, x) => Math.max(m, x.q.id), 0) + 1;
  const [, e] = secRange(L, 'Questions');
  let at = e;
  while (at > 0 && L[at - 1] === '') at--;
  L.splice(at, 0, fmtQ({ id, tag: q.tag, votes: 1, status: 'open', text: q.text, options: q.options, default: q.default, src: `${round}${ceo ? ' CEO' : ''}` }));
}

const qId = s => {
  const m = /^Q-([1-9]\d{0,5})$/.exec(String(s));
  if (!m) throw new Refused(`${short(String(s))} is not a question ID`);
  return Number(m[1]);
};

// Open questions in the order they are asked: blocking first, then votes, then oldest.
const openQuestions = L => questionsOf(L).map(x => x.q).filter(q => q.status === 'open')
  .sort((a, b) => (a.tag === b.tag ? 0 : a.tag === 'blocking' ? -1 : 1) || b.votes - a.votes || a.id - b.id);

export function queue(text) {
  const { L } = loadDoc(text);
  const open = openQuestions(L)
    .map(q => ({ id: `Q-${q.id}`, tag: q.tag, votes: q.votes, text: q.text, options: q.options, default: q.default }));
  const answered = questionsOf(L).map(x => x.q).filter(q => q.status === 'answered').sort((a, b) => a.id - b.id)
    .map(q => ({ id: `Q-${q.id}`, text: q.text }));
  return { ask: open.slice(0, 3), next_up: open[3] ?? null, answered };
}

export function askQuestion(text, input, { file } = {}) {
  const doc = loadDoc(text, file);
  const q = checkQuestion(isPlain(input) ? input : {});
  addQuestion(doc.L, q, Math.max(1, doc.rounds.at(-1)?.n ?? 1), input.ceo === true);
  return finish(doc.L, file);
}

export function mergeQuestions(text, keep, drop, { file } = {}) {
  const doc = loadDoc(text, file);
  const k = qId(keep), d = qId(drop);
  if (k === d) throw new Refused('cannot merge a question into the same one');
  const all = questionsOf(doc.L);
  const a = all.find(x => x.q.id === k), b = all.find(x => x.q.id === d);
  if (!a) throw new Refused(`no such question Q-${k}`);
  if (!b) throw new Refused(`no such question Q-${d}`);
  if (a.q.status !== 'open' && a.q.status !== 'answered') throw new Refused(`Q-${k} is not open or answered`);
  if (b.q.status !== 'open') throw new Refused(`Q-${d} is not open`);
  a.q.votes = Math.min(a.q.votes + b.q.votes, 999999);
  b.q.votes = 0; b.q.status = 'parked'; b.q.text = `merged into Q-${k} (${b.q.text})`;
  doc.L[a.i] = fmtQ(a.q); doc.L[b.i] = fmtQ(b.q);
  return finish(doc.L, file);
}

// One CEO line of 1 to 1000 characters, trimmed; shared by `answer` and `decide`.
function checkCeoText(answer, what) {
  if (typeof answer !== 'string') throw new Refused(`${what} is not text`);
  const a = norm(answer).replace(/\n+$/, '').trim();
  if (!a) throw new Refused(`${what} is empty`);
  if (a.includes('\n')) throw new Refused(`${what} must be one line`);
  if (CONTROL.test(a)) throw new Refused(`control character in the ${what}`);
  if (a.length > 1000) throw new Refused(`${what} is longer than 1000 characters`);
  if (STRUCTURE.test(a)) throw new Refused(`${what} starts like file structure`);
  return a;
}

function ceoRound(doc) {
  const round = doc.rounds.at(-1);
  if (!round) throw new Refused('there is no round to answer in');
  if (round.leadAt === null) throw new Refused(`round ${round.n} has no **Lead:** line yet`);
  return round;
}

// A CEO ruling that answers no queued question: link `none`, no question changes status.
export function decideRuling(text, ruling, { file } = {}) {
  const doc = loadDoc(text, file);
  const L = doc.L;
  const round = ceoRound(doc);
  const a = checkCeoText(ruling, 'ruling');
  if (round.ceoAt === null) L.splice(round.end, 0, `**CEO:** ${a}`);
  else if (!round.ceoLines.join('\n').includes(a)) L.splice(round.end, 0, a);
  addToPart(L, 'Decisions', `- D-${nextId(L, 'D')} — none — "${a}" — src: R${round.n}`);
  return finish(L, file);
}

export function answerQuestion(text, qid, answer, { file } = {}) {
  const id = qId(qid);
  const doc = loadDoc(text, file);
  const L = doc.L;
  const found = questionsOf(L).find(x => x.q.id === id);
  if (!found) throw new Refused(`no such question Q-${id}`);
  if (found.q.status !== 'open') throw new Refused(`Q-${id} is not open`);
  const round = ceoRound(doc);
  const a = answer === null ? null : checkCeoText(answer, 'answer');
  const decision = a === null
    ? `- D-${nextId(L, 'D')} — Q-${id} — default: ${found.q.default} (CEO skipped) — src: R${round.n}`
    : `- D-${nextId(L, 'D')} — Q-${id} — "${a}" — src: R${round.n}`;
  if (round.ceoAt === null) L.splice(round.end, 0, `**CEO:** ${a ?? '(skipped)'}`);
  else if (a !== null && !round.ceoLines.join('\n').includes(a)) L.splice(round.end, 0, a);
  found.q.status = 'answered';
  L[found.i] = fmtQ(found.q);
  addToPart(L, 'Decisions', decision);
  return finish(L, file);
}

// ---- crossfire ----
function rawChallenge(doc, n) {
  const r = doc.rounds.find(x => x.n === n);
  if (!r || !r.mode.startsWith('debate:')) return null;
  const votes = new Map(), challenges = [];
  for (const rep of r.replies) {
    if (rep.pass === 'crossfire' || rep.status !== 'ok') continue;
    for (const re of rep.parsed.replies_to) {
      if (re.stance === 'challenge') challenges.push({ by: rep, idea: re.idea, text: re.text });
      else {
        if (!votes.has(re.idea)) votes.set(re.idea, new Set());
        votes.get(re.idea).add(rep.key);
      }
    }
  }
  let best = null;
  for (const c of challenges) {
    const owner = doc.owners.get(c.idea);
    if (!owner || owner.role === c.by.role) continue;
    const score = votes.get(c.idea)?.size ?? 0;
    if (!best || score > best.score) best = { score, pair: [c.by.role, owner.role], idea: c.idea, text: c.text };
  }
  return best;
}
const rawPair = (doc, n) => rawChallenge(doc, n)?.pair ?? null;

export function crossfirePair(text, round, { file } = {}) {
  const doc = loadDoc(text, file);
  const r = doc.rounds.find(x => x.n === round);
  if (!r || r.closed || r.replies.some(x => x.pass === 'crossfire')) return null;
  return rawPair(doc, round);
}

// ---- apply ----
function resolveKey(k, doc, names, what) {
  if (typeof k !== 'string') throw new Refused(`${what} is not text`);
  let name, role;
  const m = KEY_RE.exec(k);
  if (m) { name = m[1].trim(); role = m[2]; }
  else if (ROLE_RE.test(k)) role = k;
  else throw new Refused(`${what} ${short(k)} is not a role name in the form "Name (role)" or a role`);
  if (!doc.roster.includes(role)) throw new Refused(`${role} is not in the roster`);
  const known = names.get(role);
  if (name === undefined) {
    if (!known) throw new Refused(`no name known for role ${role}: use "Name (role)"`);
    name = known;
  } else if (!name || CONTROL.test(name) || STRUCTURE.test(name)) throw new Refused(`name ${short(name)} is not allowed`);
  else if (known && known !== name) throw new Refused(`name clash: ${role} is ${known}, not ${name}`);
  names.set(role, name);
  return { name, role, key: `${name} (${role})` };
}

function checkApplyInput(input) {
  if (!isPlain(input)) throw new Refused('input must be a JSON object');
  for (const k of Object.keys(input)) if (!['replies', 'lead', 'dissent', 'open_threads'].includes(k)) throw new Refused(`unknown key ${short(k)}`);
  if (!isPlain(input.replies)) throw new Refused('replies must be an object of Role to text');
  const keys = Object.keys(input.replies);
  if (keys.length > 20) throw new Refused('more than 20 replies');
  for (const k of keys) {
    if (typeof input.replies[k] !== 'string') throw new Refused(`reply of ${short(k)} is not text`);
    if (input.replies[k].length > MAX_REPLY_INPUT) throw new Refused(`reply of ${short(k)} is too large`);
  }
  let lead = input.lead ?? '';
  if (typeof lead !== 'string') throw new Refused('lead is not text');
  if (CONTROL.test(norm(lead))) throw new Refused('control character in the lead');
  lead = lead.replace(/\s+/g, ' ').trim();
  if (lead.length > MAX_LEAD) throw new Refused('lead is too long');
  const list = (v, what) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > 20) throw new Refused(`${what} must be a list of at most 20`);
    return v;
  };
  const dissent = list(input.dissent, 'dissent').map(d => {
    if (!isPlain(d) || Object.keys(d).sort().join() !== 'quote,role' || typeof d.quote !== 'string' || typeof d.role !== 'string')
      throw new Refused('dissent entries need exactly role and quote');
    if (!d.quote || d.quote.length > 1000 || /[\n\r]/.test(d.quote) || CONTROL.test(d.quote)) throw new Refused('dissent quote must be one plain line of 1 to 1000 characters');
    return d;
  });
  const open = list(input.open_threads, 'open_threads').map(o => {
    if (!isPlain(o) || typeof o.text !== 'string' || !Array.isArray(o.ideas ?? []) || Object.keys(o).some(k => k !== 'text' && k !== 'ideas'))
      throw new Refused('open_threads entries need text and ideas');
    const t = o.text.trim();
    if (!t || t.length > 300 || /[\n\r]/.test(t) || CONTROL.test(t) || t.includes(' — src: R')) throw new Refused('open thread text must be one plain line of 1 to 300 characters');
    const ideas = o.ideas ?? [];
    if (ideas.length > 10 || ideas.some(i => typeof i !== 'string' || !IDEA_RE.test(i))) throw new Refused('open thread ideas must be idea IDs');
    return { text: t, ideas };
  });
  return { replies: input.replies, lead, dissent, open };
}

// The Lead's `Open:` sentence must name a Q-<n> or O-<n> of the file, or read `none`.
function checkLeadOpen(lead, L) {
  const at = lead.indexOf('Open:');
  if (at < 0) return;
  const rest = lead.slice(at + 5);
  const end = /[.!?](?:\s|$)/.exec(rest);
  const sentence = (end ? rest.slice(0, end.index) : rest).trim();
  if (/^none$/i.test(sentence)) return;
  const ids = new Set(questionsOf(L).map(x => `Q-${x.q.id}`));
  for (const l of L) { const m = /^- (O-\d+) — /.exec(l); if (m) ids.add(m[1]); }
  for (const m of sentence.matchAll(/\b([QO]-\d{1,6})\b/g)) if (ids.has(m[1])) return;
  throw new Refused('lead Open: names no Q-<n> or O-<n>; add open_threads or ask');
}

export function applyReplies(text, input, { round, mode, pass = 'ideas', file } = {}) {
  if (!Number.isInteger(round) || round < 1 || round > 999999) throw new Refused('round must be a positive integer');
  if (!PASSES.includes(pass)) throw new Refused('pass must be ideas, full or crossfire');
  if (mode !== undefined && !MODES.includes(mode)) throw new Refused(`mode must be one of ${MODES.join(', ')}`);
  const inp = checkApplyInput(input);
  const doc = loadDoc(text, file);
  const L = doc.L;
  const names = new Map();
  for (const r of doc.rounds) for (const rep of r.replies) names.set(rep.role, rep.name);

  const last = doc.rounds.at(-1);
  const existing = doc.rounds.find(r => r.n === round);
  const heading = mode === undefined ? 'ideas' : mode.replace('debate:', 'debate: ');
  let roundMode;
  if (existing) {
    if (existing !== last || existing.closed) throw new Refused(`round ${round} is closed`);
    if (mode !== undefined && existing.mode !== heading) throw new Refused(`round ${round} is ${existing.mode}, not ${heading}`);
    roundMode = existing.mode;
  } else {
    const expected = (last?.n ?? 0) + 1;
    if (round !== expected) throw new Refused(`round ${round} is not next (expected ${expected})`);
    if (last && !last.closed) throw new Refused(`round ${last.n} is still open (no **Lead:** line)`);
    roundMode = heading;
  }
  const allowed = pass === 'ideas' || (existing && roundMode === 'debate: full_pass');
  if (!allowed) throw new Refused(`pass ${pass} not allowed in round ${round}`);
  const entries = Object.entries(inp.replies);
  if (!entries.length && !inp.lead) throw new Refused('nothing to apply');

  const resolved = new Map();
  for (const [k, v] of entries) {
    const who = resolveKey(k, doc, names, 'reply key');
    if (resolved.has(who.role)) throw new Refused(`two replies for ${who.role}`);
    resolved.set(who.role, { ...who, text: v });
  }
  let order = doc.roster.filter(r => resolved.has(r));
  if (pass === 'crossfire' && entries.length) {
    const pair = rawPair(doc, round);
    if (!pair) throw new Refused(`no crossfire pair in round ${round}`);
    if (order.length !== 2 || !pair.every(r => resolved.has(r))) throw new Refused(`crossfire replies must come from ${pair[0]} and ${pair[1]}`);
    order = pair;
  }
  for (const role of order) {
    const before = (existing?.replies ?? []).filter(r => r.role === role && r.pass === pass);
    if (pass === 'ideas' ? before.some(r => r.status !== 'malformed') : before.length)
      throw new Refused(`${resolved.get(role).key} already replied in pass ${pass} of round ${round}`);
  }

  const known = ownerMap(doc);
  let counter = existing?.ideaCount ?? 0;
  const added = [], malformed = [], ideaIds = [];
  const block = [];
  for (const role of order) {
    const who = resolved.get(role);
    const p = parseReply(who.text, { pass, role, round, known });
    let body, status;
    if (!p.ok) { body = storeMalformed(who.text); status = 'malformed'; malformed.push({ key: who.key, reasons: p.reasons }); }
    else if (p.reply.skip) { body = 'skip'; status = 'skip'; }
    else {
      body = norm(who.text).trim(); status = 'ok';
      p.reply.ideas.forEach(() => ideaIds.push(`I-${round}.${++counter}`));
    }
    block.push(`#### ${who.key}${pass === 'full' ? ' — full pass' : pass === 'crossfire' ? ' — crossfire' : ''}`, ...body.split('\n'));
    added.push({ who, parsed: p.ok ? p.reply : null, status });
  }
  if (inp.lead) block.push(`**Lead:** ${inp.lead}`);

  if (existing) L.splice(existing.end, 0, ...block);
  else {
    const [rs, re] = secRange(L, 'Rounds');
    let at = re;
    while (at > rs && L[at - 1] === '') at--;
    L.splice(at, 0, `### Round ${round} — ${roundMode}`, ...block);
  }

  const allIdeas = new Set([...known.keys(), ...ideaIds]);
  for (const a of added) {
    if (!a.parsed || a.parsed.skip) continue;
    for (const re of a.parsed.replies_to) addToPart(L, 'Threads', `- ${re.idea} ← ${a.who.key} ${re.stance}: "${re.text}" — src: R${round}`);
    for (const q of a.parsed.questions) addQuestion(L, q, round, false);
    if (a.parsed.estimate) {
      const { size, low, high } = a.parsed.estimate;
      removeFromPart(L, 'Estimate', l => l === '- not estimated' || l.endsWith(` — src: R${round}`));
      addToPart(L, 'Estimate', `- ${fmtEstimate({ size, low, high })} — src: R${round}`);
    }
  }
  for (const d of inp.dissent) {
    const who = resolveKey(d.role, doc, names, 'dissent role');
    addToPart(L, 'Dissent', `- ${who.key} — "${d.quote}" — src: R${round}`);
  }
  for (const o of inp.open) {
    for (const i of o.ideas) if (!allIdeas.has(i)) throw new Refused(`open thread names ${i}, which does not exist`);
    const tail = o.ideas.length ? ` — ideas: ${o.ideas.join(', ')}` : '';
    addToPart(L, 'Open threads', `- O-${nextId(L, 'O')} — ${o.text}${tail} — src: R${round}`);
  }
  if (inp.lead && !inp.open.length) checkLeadOpen(inp.lead, L);
  return { text: finish(L, file), malformed, ideas: ideaIds };
}

// ---- round input (brainstorm-file v2, "Round input") ----
const FOLDERS = ['brainstorms', 'roadmap', 'nice-to-have', 'parked'];
const INPUT_DIR = 'brainstorm-input';
const ENTRY_RE = /^(?:[a-z][a-z0-9-]*\.md|\.[a-z][a-z0-9-]*\.md\.\d+\.tmp)$/;
const ANSWERED_CAP = 4, OPEN_CAP = 4, TEXT_CAP = 100, QUOTE_CAP = 160, IDEA_CAP = 100, MAL_CAP = 1000, REASON_CAP = 10;

// At most `n` characters, cut on a word boundary, then an ellipsis.
function cut(s, n) {
  if (s.length <= n) return s;
  let c = s.slice(0, n);
  const sp = c.lastIndexOf(' ');
  if (s[n] !== ' ' && sp > 0) c = c.slice(0, sp);
  return `${c.trimEnd()}…`;
}
const quoted = s => s.split('\n').map(l => `> ${l}`).join('\n');
const headingOf = rep => `#### ${rep.key}${rep.pass === 'full' ? ' — full pass' : rep.pass === 'crossfire' ? ' — crossfire' : ''}`;

// Shown form of a reply: `I: <idea>` becomes `I-<r>.<k>: <idea>`; the IDs exist only in this view.
function shownLines(rep) {
  if (rep.status === 'malformed') return ['(malformed)'];
  if (rep.status === 'skip') return ['skip'];
  let k = 0;
  return rep.body.split('\n').map(l => l.trimEnd()).filter(Boolean).map(l => lenientLine(l)).map(l => (l.startsWith('I: ') ? `${rep.ids[k++]}: ${l.slice(3)}` : l));
}

function summaryOf(L) {
  const [s, e] = secRange(L, 'Summary');
  const text = L.slice(s, e).join('\n').trim();
  return text && text !== '(written at close)' ? text : '';
}

function questionLines(L) {
  const [s, e] = secRange(L, 'Digest');
  const decisions = new Map();
  let inDecisions = false;
  for (let i = s; i < e; i++) {
    if (L[i].startsWith('### ')) inDecisions = L[i] === '### Decisions';
    else if (inDecisions) {
      const m = /^- D-\d+ — Q-(\d+) — (.*) — src: R\d+$/.exec(L[i]);
      if (m) decisions.set(Number(m[1]), m[2]);
    }
  }
  const all = questionsOf(L).map(x => x.q);
  const done = all.filter(q => q.status === 'answered').sort((a, b) => a.id - b.id).slice(-ANSWERED_CAP).map(q => {
    const d = decisions.get(q.id);
    let tail = '';
    if (d !== undefined) {
      const quote = d.startsWith('"') && d.endsWith('"') && d.length >= 2 ? d.slice(1, -1) : null;
      tail = quote === null ? ` → ${d}` : ` → "${cut(quote, QUOTE_CAP)}"`;
    }
    return `- Q-${q.id} answered: ${cut(q.text, TEXT_CAP)}${tail}`;
  });
  const open = openQuestions(L).slice(0, OPEN_CAP).map(q => `- Q-${q.id} open: ${cut(q.text, TEXT_CAP)}`);
  const both = [...done, ...open];
  return both.length ? both : ['(none)'];
}

function stageRound(doc, round, pass) {
  const last = doc.rounds.at(-1);
  const cannot = n => new Refused(`round ${n} cannot be staged`);
  if (pass === 'ideas') {
    const next = (last?.n ?? 0) + 1;
    const open = last && !last.closed;
    const n = round ?? (open ? last.n : next);
    if (n !== (open ? last.n : next)) throw cannot(n);
    return n;
  }
  const n = round ?? last?.n;
  if (!last || n !== last.n || last.closed) throw cannot(n);
  if (last.mode !== 'debate: full_pass') throw cannot(n);
  return n;
}

function reaskParts(doc, role, round) {
  const r = doc.rounds.find(x => x.n === round);
  const mine = r?.replies.filter(x => x.role === role).at(-1);
  if (!mine || mine.pass !== 'ideas' || mine.status !== 'malformed') throw new Refused(`${role} has no malformed reply in round ${round}`);
  if (r.closed) throw new Refused(`round ${round} cannot be staged`);
  const stored = mine.lines.join('\n').trim().split('\n').slice(1).join('\n');
  const again = parseReply(stored, { pass: 'ideas', role, round, known: ownerMap(doc) });
  const reasons = again.ok ? ['the reply was malformed'] : again.reasons.slice(0, REASON_CAP);
  return { reasons: reasons.join('; '), reply: stored.slice(0, MAL_CAP) };
}

const fmtEstimate = ({ size, low, high }) => `${size}, ${low === high ? low : `${low}–${high}`} d`;

// "Challenge to you:" (FR4): in the round after a closed `debate: crossfire` round, for the author of its challenged idea.
function challengeLines(doc, role, n) {
  const prev = doc.rounds.find(x => x.n === n - 1);
  if (!prev || !prev.closed || prev.mode !== 'debate: crossfire') return [];
  const c = rawChallenge(doc, prev.n);
  if (!c || c.pair[1] !== role) return [];
  return ['Challenge to you:', `- your idea: ${cut(doc.texts.get(c.idea) ?? '', IDEA_CAP)}`, `- @${c.pair[0]} (challenge): ${c.text}`];
}

// Pure: the text of one Role's round input file for a loaded document.
function renderInput(doc, role, { round, pass = 'ideas', reask = false, projectFile = null } = {}) {
  if (typeof role !== 'string' || !doc.roster.includes(role)) throw new Refused(`${short(String(role))} is not in the roster`);
  if (!PASSES.includes(pass)) throw new Refused('pass must be ideas, full or crossfire');
  if (projectFile !== null && (typeof projectFile !== 'string' || /[\n\r]/.test(projectFile))) throw new Refused('project file must be a one-line path');
  let n, re = null;
  if (reask) {
    if (pass !== 'ideas') throw new Refused('re-ask works in the ideas pass only');
    n = round ?? doc.rounds.at(-1)?.n;
    re = reaskParts(doc, role, n);
  } else n = stageRound(doc, round, pass);
  const all = doc.rounds.flatMap(r => r.replies);
  const out = [`Round: ${n}`, `Pass: ${pass}`, 'Topic:', quoted(doc.topic)];
  if (projectFile && !all.some(r => r.role === role)) out.push(`Read also: ${projectFile}`);
  const summary = summaryOf(doc.L);
  if (summary) out.push('Summary:', quoted(summary));
  if (re) out.push('Re-ask:', quoted(re.reasons), 'Your malformed reply:', quoted(re.reply));
  out.push('Questions:', ...questionLines(doc.L));

  const others = doc.roster.filter(r => r !== role);
  if (pass === 'ideas') {
    const mine = all.filter(r => r.role === role && r.status === 'ok' && (r.parsed.ideas.length || r.parsed.estimate)).at(-1);
    const own = mine ? [...mine.parsed.ideas.map(i => `- ${cut(i, IDEA_CAP)}`), ...(mine.parsed.estimate ? [`- your estimate was ${fmtEstimate(mine.parsed.estimate)}`] : [])] : [];
    out.push('Your last ideas:', ...(own.length ? own : ['(none)']), ...challengeLines(doc, role, n));
    const said = [];
    for (const other of others) {
      const rep = all.filter(r => r.role === other && r.status === 'ok' && r.parsed.ideas.length).at(-1);
      if (rep) rep.parsed.ideas.forEach((idea, k) => said.push(`- ${rep.ids[k]} (${rep.role}): ${cut(idea, IDEA_CAP)}`));
    }
    out.push('Others said:', ...(said.length ? said : ['(none)']));
  } else {
    const r = doc.rounds.find(x => x.n === n);
    if (pass === 'full') {
      const ideasOf = who => r.replies.filter(x => x.role === who && x.pass === 'ideas').at(-1);
      const mine = ideasOf(role);
      out.push(`Your ideas-pass reply of round ${n}:`, ...(mine ? shownLines(mine) : ['(none)']));
      const blocks = [];
      for (const other of others) {
        const rep = ideasOf(other);
        if (rep && rep.status !== 'skip') blocks.push(headingOf(rep), ...shownLines(rep));
      }
      out.push('Other Roles:', ...(blocks.length ? blocks : ['(none)']));
    } else {
      const pair = r.replies.some(x => x.pass === 'crossfire') ? null : rawPair(doc, n);
      if (!pair) throw new Refused(`no crossfire pair in round ${n}`);
      if (!pair.includes(role)) throw new Refused(`${role} is not in the crossfire pair of round ${n}`);
      const render = who => {
        const l = r.replies.filter(x => x.role === who).flatMap(x => [headingOf(x), ...shownLines(x)]);
        return l.length ? l : ['(none)'];
      };
      out.push(`Your replies of round ${n}:`, ...render(role), 'Opponent:', ...render(pair.find(x => x !== role)));
    }
  }
  return `${out.join('\n')}\n`;
}

export function inputFor(text, role, opts = {}) {
  return renderInput(loadDoc(text, opts.file), role, opts);
}

// ---- stage and clean: the files on disk ----
const lst = p => { try { return lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

function inputLocation(file) {
  const abs = resolve(file);
  const folder = dirname(abs);
  if (!FOLDERS.includes(basename(folder))) throw new Refused(`${short(file)} is not in a brainstorm folder`);
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2}) - /.exec(basename(abs));
  if (!m) throw new Refused('no time stamp in the file name');
  const company = dirname(folder);
  const run = `brainstorm-${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}`;
  return { company, base: join(company, INPUT_DIR), dir: join(company, INPUT_DIR, run), run, projectFile: join(company, 'project.md') };
}

const projectFileOf = loc => (lst(loc.projectFile)?.isFile() ? loc.projectFile : null);

// Validates the input folders and returns the run folder's entry names; refuses links and strangers.
function runEntries(loc) {
  const base = lst(loc.base);
  if (base && (base.isSymbolicLink() || !base.isDirectory())) throw new Refused(`unexpected entry in ${INPUT_DIR}`);
  const dir = lst(loc.dir);
  if (!dir) return [];
  if (dir.isSymbolicLink() || !dir.isDirectory()) throw new Refused(`unexpected entry in ${loc.run}`);
  const names = readdirSync(loc.dir);
  for (const name of names) {
    const p = join(loc.dir, name);
    const rel = relative(loc.base, p);
    if (!ENTRY_RE.test(name) || rel.startsWith('..') || isAbsolute(rel) || !lst(p)?.isFile()) throw new Refused(`unexpected entry in ${loc.run}`);
  }
  return names;
}

export function stageFiles(file, text, { round, pass = 'ideas', roles, reask } = {}) {
  const loc = inputLocation(file);
  const doc = loadDoc(text, file);
  let who;
  if (reask !== undefined) who = [reask];
  else if (pass === 'crossfire') {
    if (roles !== undefined) throw new Refused('--roles is not allowed with --pass crossfire');
    const n = stageRound(doc, round, pass);
    const r = doc.rounds.find(x => x.n === n);
    who = r.replies.some(x => x.pass === 'crossfire') ? null : rawPair(doc, n);
    if (!who) throw new Refused(`no crossfire pair in round ${n}`);
  } else {
    for (const slug of roles ?? []) if (!doc.roster.includes(slug)) throw new Refused(`${short(slug)} is not in the roster`);
    who = roles === undefined ? doc.roster : doc.roster.filter(r => roles.includes(r));
  }
  const projectFile = projectFileOf(loc);
  const texts = who.map(role => [role, renderInput(doc, role, { round, pass, reask: reask !== undefined, projectFile })]);
  const names = runEntries(loc);
  mkdirSync(loc.dir, { recursive: true });
  const ignore = join(loc.base, '.gitignore');
  const ig = lst(ignore);
  if (!ig) writeAtomic(ignore, '*\n');
  else if (!ig.isFile()) throw new Refused(`unexpected entry in ${INPUT_DIR}`);
  for (const name of names) rmSync(join(loc.dir, name), { force: true });
  const files = {};
  for (const [role, body] of texts) {
    files[role] = join(loc.dir, `${role}.md`);
    writeAtomic(files[role], body);
  }
  return { run: loc.run, files };
}

export function cleanRun(file) {
  const loc = inputLocation(file);
  const names = runEntries(loc);
  for (const name of names) rmSync(join(loc.dir, name), { force: true });
  if (lst(loc.dir)) rmdirSync(loc.dir);
  return `cleaned ${loc.run}`;
}

// ---- film script ----
export function renderFilm(text, { source = 'brainstorm.md', file } = {}) {
  const doc = loadDoc(text, file);
  if (/[\n\r]/.test(source)) throw new Refused('source name must be one line');
  const out = ['---', 'kind: film', `source: ${source}`, 'label: rendered from stored replies; no invented lines', '---'];
  for (const r of doc.rounds) {
    out.push(`### Round ${r.n} — ${r.mode}`);
    for (const rep of r.replies) {
      if (rep.status !== 'ok') continue;
      for (const l of rep.body.split('\n')) if (l.trim()) out.push(`${rep.key}: ${l}`);
    }
    for (const l of r.leadLines) if (l) out.push(`Lead: ${l}`);
    for (const l of r.ceoLines) if (l) out.push(`CEO: ${l}`);
  }
  return `${out.join('\n')}\n`;
}

// ---- new file ----
export function newFile({ topic, roles, mode, now = new Date() } = {}) {
  const t = typeof topic === 'string' ? topic.trim() : '';
  if (!t || t.length > 200 || /[\n\r]/.test(t) || CONTROL.test(t)) throw new Refused('topic must be one plain line of 1 to 200 characters');
  const list = typeof roles === 'string' ? roles.split(',').map(s => s.trim()) : roles;
  if (!Array.isArray(list) || !list.length || list.length > 20 || list.some(r => typeof r !== 'string' || !ROLE_RE.test(r)) || new Set(list).size !== list.length)
    throw new Refused('roles must be 1 to 20 distinct role slugs');
  if (mode !== undefined && !FILE_MODES.includes(mode)) throw new Refused(`mode must be one of ${FILE_MODES.join(', ')}`);
  const p = n => String(n).padStart(2, '0');
  const started = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}.${p(now.getMinutes())}`;
  return [
    '---', `topic: ${t}`, `started: ${started}`, 'status: open', `roles: ${list.join(', ')}`, 'format: 2', ...(mode ? [`mode: ${mode}`] : []), '---',
    '## Summary', '(written at close)', '## Digest', '### Decisions', '### Open threads', '### Dissent', '### Threads', '### Estimate', '- not estimated',
    '## Questions', '## Rounds', '',
  ].join('\n');
}

// ---- CLI ----
function readStdin() {
  const chunks = [], buf = Buffer.alloc(65536);
  let total = 0;
  for (;;) {
    let n;
    try { n = readSync(0, buf, 0, buf.length, null); } catch (e) {
      if (e.code === 'EOF') break;
      if (e.code === 'EAGAIN') { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); continue; }
      throw e;
    }
    if (n === 0) break;
    total += n;
    if (total > MAX_INPUT) throw new Refused('input too large (limit 256 KiB)');
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function readFileText(file) {
  let size;
  try { size = statSync(file).size; } catch { throw new Refused(`cannot read ${short(file)}`); }
  if (size > MAX_FILE) throw new Refused(`${short(file)} is larger than 1 MiB`);
  return readFileSync(file, 'utf8');
}

function writeAtomic(file, text) {
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
  try { writeFileSync(tmp, text); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}

const FLAGS = new Map([['--pass', true], ['--mode', true], ['--file', true], ['--roles', true], ['--reask', true], ['--skip', false]]);
function parseArgs(argv) {
  const pos = [], flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    if (!FLAGS.has(a)) throw new Usage(`unknown option ${short(a)}`);
    if (flags.has(a)) throw new Usage(`${a} given twice`);
    if (FLAGS.get(a)) {
      if (i + 1 >= argv.length) throw new Usage(`${a} needs a value`);
      flags.set(a, argv[++i]);
    } else flags.set(a, true);
  }
  return { pos, flags };
}

const oneOf = (v, list, what) => { if (!list.includes(v)) throw new Usage(`${what} must be one of ${list.join(', ')}`); return v; };
const intArg = (v, what) => { if (!/^[1-9]\d{0,5}$/.test(String(v))) throw new Usage(`${what} must be a positive whole number`); return Number(v); };
const roleArg = v => { if (!ROLE_RE.test(String(v))) throw new Usage('role must be a lowercase slug'); return v; };
const arity = (pos, min, max, usage) => { if (pos.length < min || pos.length > max) throw new Usage(usage); };

function mutate(file, fn) {
  writeAtomic(file, fn(readFileText(file)));
}

function jsonIn() {
  try { return JSON.parse(readStdin()); } catch (e) {
    if (e.name === 'Refused') throw e;
    throw new Refused('input is not valid JSON');
  }
}

export function run(argv) {
  const [cmd, ...rest] = argv;
  const { pos, flags } = parseArgs(rest);
  const f = pos[0];
  const out = [];
  switch (cmd) {
    case 'new': {
      arity(pos, 1, 1, 'new <file> (JSON on stdin: { topic, roles, mode? })');
      const input = jsonIn();
      if (!isPlain(input)) throw new Refused('input must be a JSON object');
      for (const k of Object.keys(input)) if (!['topic', 'roles', 'mode'].includes(k)) throw new Refused(`unknown key ${short(k)}`);
      const text = newFile({ topic: input.topic, roles: input.roles, mode: input.mode });
      try { writeFileSync(f, text, { flag: 'wx' }); } catch (e) { throw new Refused(e.code === 'EEXIST' ? `${short(f)} already exists` : `cannot write ${short(f)}`); }
      out.push(`created ${f}`);
      break;
    }
    case 'parse': {
      arity(pos, 2, 2, 'parse <round> <role> [--pass ideas|full|crossfire] [--file <file>]');
      const round = intArg(f, 'round'), role = roleArg(pos[1]);
      const pass = flags.has('--pass') ? oneOf(flags.get('--pass'), PASSES, '--pass') : 'ideas';
      const known = flags.has('--file') ? ownerMap(loadDoc(readFileText(flags.get('--file')))) : null;
      const r = parseReply(readStdin(), { pass, role, round, known });
      if (!r.ok) return { code: 1, out: `malformed: ${r.reasons.join('; ')}\n`, err: '' };
      out.push(JSON.stringify(r.reply));
      break;
    }
    case 'apply': {
      arity(pos, 2, 2, 'apply <file> <round> [--mode …] [--pass …]');
      const round = intArg(pos[1], 'round');
      const mode = flags.has('--mode') ? oneOf(flags.get('--mode'), MODES, '--mode') : undefined;
      const pass = flags.has('--pass') ? oneOf(flags.get('--pass'), PASSES, '--pass') : 'ideas';
      const input = jsonIn();
      let result;
      mutate(f, text => { result = applyReplies(text, input, { round, mode, pass, file: f }); return result.text; });
      out.push(JSON.stringify({ ideas: result.ideas, malformed: result.malformed }));
      break;
    }
    case 'answer': {
      arity(pos, 2, 2, 'answer <file> <Q-id> [--skip]');
      const answer = flags.has('--skip') ? null : readStdin();
      mutate(f, text => answerQuestion(text, pos[1], answer, { file: f }));
      out.push('ok');
      break;
    }
    case 'decide':
      arity(pos, 1, 1, 'decide <file> (ruling on stdin)');
      mutate(f, text => decideRuling(text, readStdin(), { file: f }));
      out.push('ok');
      break;
    case 'ask': {
      arity(pos, 1, 1, 'ask <file> (JSON on stdin: { text, options, default, tag, ceo? })');
      const input = jsonIn();
      if (!isPlain(input)) throw new Refused('input must be a JSON object');
      for (const k of Object.keys(input)) if (!['text', 'options', 'default', 'tag', 'ceo'].includes(k)) throw new Refused(`unknown key ${short(k)}`);
      if (input.ceo !== undefined && typeof input.ceo !== 'boolean') throw new Refused('ceo must be true or false');
      mutate(f, text => askQuestion(text, input, { file: f }));
      out.push('ok');
      break;
    }
    case 'merge':
      arity(pos, 3, 3, 'merge <file> <Q-keep> <Q-drop>');
      mutate(f, text => mergeQuestions(text, pos[1], pos[2], { file: f }));
      out.push('ok');
      break;
    case 'queue':
      arity(pos, 1, 1, 'queue <file>');
      out.push(JSON.stringify(queue(readFileText(f))));
      break;
    case 'prompt': {
      arity(pos, 2, 3, 'prompt <file> <role> [--pass full|crossfire <round>]');
      const pass = flags.has('--pass') ? oneOf(flags.get('--pass'), ['full', 'crossfire'], '--pass') : undefined;
      if ((pass === undefined) !== (pos[2] === undefined)) throw new Usage('--pass and <round> go together');
      const round = pos[2] === undefined ? undefined : intArg(pos[2], 'round');
      let projectFile = null;
      try { projectFile = projectFileOf(inputLocation(f)); } catch (e) { if (e.name !== 'Refused') throw e; }
      return { code: 0, out: inputFor(readFileText(f), roleArg(pos[1]), { pass, round, file: f, projectFile }), err: '' };
    }
    case 'stage': {
      arity(pos, 2, 2, 'stage <file> <round> [--pass ideas|full|crossfire] [--roles <slug>,<slug>] [--reask <role>]');
      const round = intArg(pos[1], 'round');
      const pass = flags.has('--pass') ? oneOf(flags.get('--pass'), PASSES, '--pass') : 'ideas';
      const roles = flags.has('--roles') ? flags.get('--roles').split(',').map(roleArg) : undefined;
      const reask = flags.has('--reask') ? roleArg(flags.get('--reask')) : undefined;
      if (reask !== undefined && (roles !== undefined || pass !== 'ideas')) throw new Usage('--reask goes with the ideas pass alone, without --roles');
      out.push(JSON.stringify(stageFiles(f, readFileText(f), { round, pass, roles, reask })));
      break;
    }
    case 'clean':
      arity(pos, 1, 1, 'clean <file>');
      out.push(cleanRun(f));
      break;
    case 'crossfire':
      arity(pos, 2, 2, 'crossfire <file> <round>');
      out.push(JSON.stringify(crossfirePair(readFileText(f), intArg(pos[1], 'round'))));
      break;
    case 'film': {
      arity(pos, 1, 1, 'film <file>');
      if (basename(f).endsWith(' - film.md')) throw new Refused('this is already a film script');
      const target = join(dirname(f), `${basename(f).replace(/\.md$/, '')} - film.md`);
      writeAtomic(target, renderFilm(readFileText(f), { source: basename(f), file: f }));
      out.push(target);
      break;
    }
    case 'check': {
      arity(pos, 1, 1, 'check <file>');
      const errors = checkBrainstorm(readFileText(f), { file: f });
      if (errors.length) return { code: 1, out: '', err: `${errors.join('\n')}\n` };
      out.push('ok');
      break;
    }
    default:
      throw new Usage('usage: brainstorm.mjs new|parse|apply|answer|decide|ask|merge|queue|stage|prompt|clean|crossfire|film|check');
  }
  return { code: 0, out: `${out.join('\n')}\n`, err: '' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let r;
  try { r = run(process.argv.slice(2)); } catch (e) {
    if (e.name === 'Usage') r = { code: 2, out: '', err: `${e.message}\n` };
    else if (e.name === 'Refused') r = { code: 1, out: '', err: `${e.message}\n` };
    else r = { code: 1, out: '', err: `error: ${short(String(e.message))}\n` };
  }
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exitCode = r.code;
}
