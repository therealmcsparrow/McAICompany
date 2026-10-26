#!/usr/bin/env node
// Provider CLI for brainstorm-file v2 and brainstorm-reply v1. Node built-ins only; every
// mutation is parsed, rebuilt and re-validated with checkBrainstorm before an atomic write.
import { readFileSync, writeFileSync, renameSync, rmSync, statSync, readSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBrainstorm } from './check.mjs';

const MAX_FILE = 1024 * 1024;
const MAX_INPUT = 256 * 1024;
const MAX_REPLY_INPUT = 64 * 1024;
const MAX_REPLY = 4096;
const MAX_LINE = 1000;
const MAX_LEAD = 3500;
const WORD_LIMIT = { ideas: 150, full: 100, crossfire: 80 };
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
  return { pass, skip: true, ideas: [], risk: null, questions: [], reply_to: null, replies_to: [], estimate: null };
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

function parseRe(line, n, round, known, reasons) {
  const m = /^Re: @([a-z][a-z0-9-]{0,39}) on I-([1-9]\d{0,5})\.([1-9]\d{0,5}): ([a-z-]{1,20}) — (.*)$/.exec(line);
  if (!m) { reasons.push(`line ${n}: Re line is not a template line`); return null; }
  const idea = `I-${m[2]}.${m[3]}`;
  if (!['agree', 'challenge', 'build-on'].includes(m[4])) { reasons.push(`line ${n}: unknown stance ${short(m[4])}`); return null; }
  if (Number(m[2]) > round || (known && !known.has(idea))) { reasons.push(`line ${n}: Re names ${idea}, which does not exist`); return null; }
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

// Returns { ok: true, reply } or { ok: false, reasons }. `known` is the set of existing idea IDs (or null to skip that check).
export function parseReply(input, { pass = 'ideas', role = '', round = 1, known = null } = {}) {
  const bad = reasons => ({ ok: false, reasons });
  if (typeof input !== 'string') return bad(['reply is not text']);
  if (!PASSES.includes(pass)) return bad([`unknown pass ${short(String(pass))}`]);
  if (Buffer.byteLength(input) > MAX_REPLY) return bad(['reply is longer than 4 KiB']);
  const text = norm(input);
  if (CONTROL.test(text)) return bad(['control character in the reply']);
  if (!text.trim()) return bad(['empty reply']);
  if (/^skip$/i.test(text.trim())) return { ok: true, reply: skipReply(pass) };

  const reasons = [], ideas = [], questions = [], res = [], risks = [], estimates = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd(), n = i + 1;
    if (!line) return;
    if (line.length > MAX_LINE) { reasons.push(`line ${n}: longer than ${MAX_LINE} characters`); return; }
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
      const r = parseRe(line, n, round, known, reasons);
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
  const words = wordCount(text);
  if (words > WORD_LIMIT[pass]) reasons.push(`reply has ${words} words, the limit for the ${pass} pass is ${WORD_LIMIT[pass]}`);
  if (reasons.length) return bad(reasons);
  return {
    ok: true,
    reply: { pass, skip: false, ideas, risk: risks[0] ?? null, questions, reply_to: res[0] ?? null, replies_to: res, estimate: estimates[0] ?? null },
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
  return { L, roster, ...readRounds(L) };
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

export function queue(text) {
  const { L } = loadDoc(text);
  const open = questionsOf(L).map(x => x.q).filter(q => q.status === 'open')
    .sort((a, b) => (a.tag === b.tag ? 0 : a.tag === 'blocking' ? -1 : 1) || b.votes - a.votes || a.id - b.id)
    .map(q => ({ id: `Q-${q.id}`, tag: q.tag, votes: q.votes, text: q.text, options: q.options, default: q.default }));
  return { ask: open.slice(0, 3), next_up: open[3] ?? null };
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
  for (const x of [a, b]) if (x.q.status !== 'open') throw new Refused(`Q-${x.q.id} is not open`);
  a.q.votes = Math.min(a.q.votes + b.q.votes, 999999);
  b.q.votes = 0; b.q.status = 'parked'; b.q.text = `merged into Q-${k} (${b.q.text})`;
  doc.L[a.i] = fmtQ(a.q); doc.L[b.i] = fmtQ(b.q);
  return finish(doc.L, file);
}

export function answerQuestion(text, qid, answer, { file } = {}) {
  const id = qId(qid);
  const doc = loadDoc(text, file);
  const L = doc.L;
  const found = questionsOf(L).find(x => x.q.id === id);
  if (!found) throw new Refused(`no such question Q-${id}`);
  if (found.q.status !== 'open') throw new Refused(`Q-${id} is not open`);
  const round = doc.rounds.at(-1);
  if (!round) throw new Refused('there is no round to answer in');
  if (round.leadAt === null) throw new Refused(`round ${round.n} has no **Lead:** line yet`);
  let a = null;
  if (answer !== null) {
    if (typeof answer !== 'string') throw new Refused('answer is not text');
    a = norm(answer).replace(/\n+$/, '').trim();
    if (!a) throw new Refused('answer is empty');
    if (a.includes('\n')) throw new Refused('answer must be one line');
    if (CONTROL.test(a)) throw new Refused('control character in the answer');
    if (a.length > 1000) throw new Refused('answer is longer than 1000 characters');
    if (STRUCTURE.test(a)) throw new Refused('answer starts like file structure');
  }
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
function rawPair(doc, n) {
  const r = doc.rounds.find(x => x.n === n);
  if (!r || !r.mode.startsWith('debate:')) return null;
  const votes = new Map(), challenges = [];
  for (const rep of r.replies) {
    if (rep.pass === 'crossfire' || rep.status !== 'ok') continue;
    for (const re of rep.parsed.replies_to) {
      if (re.stance === 'challenge') challenges.push({ by: rep, idea: re.idea });
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
    if (!best || score > best.score) best = { score, pair: [c.by.role, owner.role] };
  }
  return best ? best.pair : null;
}

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
  const allowed = pass === 'ideas' || (existing && (pass === 'full' ? roundMode === 'debate: full_pass' : roundMode.startsWith('debate:')));
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

  const known = new Set(doc.owners.keys());
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

  const allIdeas = new Set([...known, ...ideaIds]);
  for (const a of added) {
    if (!a.parsed || a.parsed.skip) continue;
    for (const re of a.parsed.replies_to) addToPart(L, 'Threads', `- ${re.idea} ← ${a.who.key} ${re.stance}: "${re.text}" — src: R${round}`);
    for (const q of a.parsed.questions) addQuestion(L, q, round, false);
    if (a.parsed.estimate) {
      const { size, low, high } = a.parsed.estimate;
      removeFromPart(L, 'Estimate', l => l === '- not estimated' || l.endsWith(` — src: R${round}`));
      addToPart(L, 'Estimate', `- ${size}, ${low === high ? low : `${low}–${high}`} d — src: R${round}`);
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
  return { text: finish(L, file), malformed, ideas: ideaIds };
}

// ---- prompts ----
function digestOf(L) {
  const [s, e] = secRange(L, 'Digest');
  const d = L.slice(s, e);
  while (d.length && d.at(-1) === '') d.pop();
  return d.join('\n');
}

const headingOf = rep => `#### ${rep.key}${rep.pass === 'full' ? ' — full pass' : rep.pass === 'crossfire' ? ' — crossfire' : ''}`;
const shown = rep => (rep.status === 'malformed' ? '(malformed)' : rep.body);

export function promptFor(text, role, { pass, round, file = '' } = {}) {
  const doc = loadDoc(text, file || undefined);
  if (typeof role !== 'string' || !doc.roster.includes(role)) throw new Refused(`${short(String(role))} is not in the roster`);
  const head = `Digest:\n${digestOf(doc.L)}\n`;
  const tail = `Full file: ${file}\n`;
  if (pass === undefined || pass === 'ideas') {
    let own = '(none)';
    const mine = doc.rounds.flatMap(r => r.replies).filter(r => r.role === role);
    if (mine.length) own = mine.at(-1).body;
    const heads = [];
    for (const other of doc.roster.filter(r => r !== role)) {
      const rep = doc.rounds.flatMap(r => r.replies).filter(r => r.role === other && r.status === 'ok' && r.parsed.ideas.length).at(-1);
      if (rep && heads.length < 5) heads.push(`- ${rep.key}: ${rep.parsed.ideas[0].slice(0, 120)}`);
    }
    return `${head}Your last reply:\n${own}\nOthers said:\n${heads.join('\n') || '(none)'}\n${tail}`;
  }
  const r = doc.rounds.find(x => x.n === round);
  if (!r) throw new Refused(`no round ${round}`);
  if (pass === 'full') {
    if (r.mode !== 'debate: full_pass') throw new Refused(`pass full not allowed in round ${round}`);
    const ideasOf = who => r.replies.filter(x => x.role === who && x.pass === 'ideas').at(-1);
    const mine = ideasOf(role);
    const blocks = [];
    for (const other of doc.roster.filter(x => x !== role)) {
      const rep = ideasOf(other);
      if (rep && rep.status !== 'skip') blocks.push(`#### ${rep.key}\n${shown(rep)}`);
    }
    return `${head}Your ideas-pass reply of round ${round}:\n${mine ? shown(mine) : '(none)'}\nOther Roles:\n${blocks.join('\n') || '(none)'}\n${tail}`;
  }
  if (pass !== 'crossfire') throw new Refused('pass must be ideas, full or crossfire');
  if (!r.mode.startsWith('debate:')) throw new Refused(`pass crossfire not allowed in round ${round}`);
  const pair = rawPair(doc, round);
  if (!pair) throw new Refused(`no crossfire pair in round ${round}`);
  if (!pair.includes(role)) throw new Refused(`${role} is not in the crossfire pair of round ${round}`);
  const opponent = pair.find(x => x !== role);
  const render = who => r.replies.filter(x => x.role === who).map(x => `${headingOf(x)}\n${shown(x)}`).join('\n') || '(none)';
  return `${head}Your replies of round ${round}:\n${render(role)}\nOpponent:\n${render(opponent)}\n${tail}`;
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

const FLAGS = new Map([['--pass', true], ['--mode', true], ['--options', true], ['--default', true], ['--tag', true], ['--file', true], ['--skip', false], ['--ceo', false]]);
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
      arity(pos, 3, 4, 'new <file> <topic> <roles> [mode]');
      if (pos[3] !== undefined) oneOf(pos[3], FILE_MODES, 'mode');
      const text = newFile({ topic: pos[1], roles: pos[2], mode: pos[3] });
      try { writeFileSync(f, text, { flag: 'wx' }); } catch (e) { throw new Refused(e.code === 'EEXIST' ? `${short(f)} already exists` : `cannot write ${short(f)}`); }
      out.push(`created ${f}`);
      break;
    }
    case 'parse': {
      arity(pos, 2, 2, 'parse <round> <role> [--pass ideas|full|crossfire] [--file <file>]');
      const round = intArg(f, 'round'), role = roleArg(pos[1]);
      const pass = flags.has('--pass') ? oneOf(flags.get('--pass'), PASSES, '--pass') : 'ideas';
      const known = flags.has('--file') ? new Set(loadDoc(readFileText(flags.get('--file'))).owners.keys()) : null;
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
    case 'ask': {
      arity(pos, 2, 2, 'ask <file> <text> --options a|b --default a --tag blocking|nice-to-have [--ceo]');
      for (const k of ['--options', '--default', '--tag']) if (!flags.has(k)) throw new Usage(`ask needs ${k}`);
      const tag = oneOf(flags.get('--tag'), TAGS, '--tag');
      mutate(f, text => askQuestion(text, { text: pos[1], options: flags.get('--options').split('|'), default: flags.get('--default'), tag, ceo: flags.has('--ceo') }, { file: f }));
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
      return { code: 0, out: promptFor(readFileText(f), roleArg(pos[1]), { pass, round, file: resolve(f) }), err: '' };
    }
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
      throw new Usage('usage: brainstorm.mjs new|parse|apply|answer|ask|merge|queue|prompt|crossfire|film|check');
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
