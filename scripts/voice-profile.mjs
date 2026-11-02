#!/usr/bin/env node
// Voice profile (contract: docs/contracts/voice-profile.md v1). Learns style figures from README.md and the docs folder; stores nothing, no network, no child process.
// uses: docs/contracts/slop-scan.md v1
// Text is untrusted: sources pass the slop-scan checks (link, size, UTF-8), only counts and common words leave, never a name or a sentence.
import { pathToFileURL } from 'node:url';
import { countWords, mask, paragraphs, readInput, walk, wordTerms } from './slop-scan.mjs';

const USAGE = 'ERROR bad usage: voice-profile [--json] [--voice-line <text>]\n';
const BAD_VOICE = 'ERROR bad voice line\n';
const VOICE_RE = /^(clear|bold|technical)( \+ (clear|bold|technical))*$/;
const MD_RE = /\.md$/i;
const TOTAL_MAX = 16777216;
// A whitespace-delimited chunk that holds an address or a link: its parts are never terms.
// A slash or backslash marks a path; a dot or colon between two letters or digits marks a bare domain, an IP or a host with port.
const ADDRESS_RE = /@|[/\\]|(?:^|[^\p{L}\p{N}])www\.|[\p{L}\p{N}][.:][\p{L}\p{N}]/iu;
// Linear edge-quote strip; a regex on a long interior run is quadratic.
function trimQuotes(s) {
  let a = 0;
  let b = s.length;
  while (a < b && (s[a] === '\'' || s[a] === '’')) a++;
  while (b > a && (s[b - 1] === '\'' || s[b - 1] === '’')) b--;
  return s.slice(a, b);
}
const POSSESSIVE_RE = /['’]s$/i;
const LETTERS_RE = /^\p{L}{4,30}$/u;
const LIST_MAX = 15;
const WORD_MAX = 30;
const CONTRACTION_RE = /(?:n['’]t|['’](?:re|ve|ll|d|m))$/i;
const WORD_TOKEN_RE = /[\p{L}\p{N}'’]+/gu;
const HEADING_RE = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
const ITEM_RE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const SETEXT_RE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const PERSON = {
  i: new Set(['i', 'me', 'my', 'mine']),
  we: new Set(['we', 'us', 'our', 'ours']),
  you: new Set(['you', 'your', 'yours']),
};

// Common English function words; never a preferred term.
export const STOP_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'also', 'always', 'among', 'another', 'because', 'been', 'before',
  'being', 'below', 'between', 'both', 'cannot', 'could', 'does', 'doing', 'down', 'during', 'each', 'either',
  'else', 'even', 'ever', 'every', 'from', 'further', 'gets', 'give', 'given', 'goes', 'going', 'have', 'having',
  'here', 'herself', 'himself', 'however', 'into', 'itself', 'just', 'keep', 'like', 'make', 'many', 'might',
  'more', 'most', 'much', 'must', 'myself', 'need', 'needs', 'never', 'next', 'once', 'only', 'onto', 'other',
  'ours', 'ourselves', 'over', 'perhaps', 'rather', 'really', 'same', 'shall', 'should', 'since', 'some', 'still',
  'such', 'take', 'than', 'that', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they',
  'thing', 'things', 'this', 'those', 'though', 'through', 'thus', 'under', 'until', 'upon', 'very', 'want',
  'wants', 'were', 'what', 'whatever', 'when', 'whenever', 'where', 'whether', 'which', 'while', 'whom', 'whose',
  'will', 'with', 'within', 'without', 'would', 'yours', 'yourself', 'yourselves', 'your',
]);

// Order by code point, not by UTF-16 unit.
function cmp(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i);
    const y = b.codePointAt(j);
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  if (i < a.length) return 1;
  return j < b.length ? -1 : 0;
}

const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';

// Splits one block of masked text into sentences: [{ text, end }] with end '.', '!', '?' or null.
function splitSentences(buf, out) {
  let from = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if ((c === '.' || c === '!' || c === '?') && (i + 1 === buf.length || isWs(buf[i + 1]))) {
      out.push({ text: buf.slice(from, i + 1), end: c });
      from = i + 1;
    }
  }
  if (from < buf.length) out.push({ text: buf.slice(from), end: null });
}

// A sentence ends at . ! ? before whitespace or the end, at a blank line, and at the end of a heading or list item.
function sentencesOf(masked) {
  const out = [];
  let buf = [];
  const flush = () => {
    if (buf.length) splitSentences(buf.join(' '), out);
    buf = [];
  };
  for (const line of masked.split('\n')) {
    if (line.trim() === '') { flush(); continue; }
    if (SETEXT_RE.test(line)) {
      flush();
    } else if (HEADING_RE.test(line)) {
      flush();
      buf.push(line.replace(HEADING_RE, ''));
      flush();
    } else if (ITEM_RE.test(line)) {
      flush();
      buf.push(line.replace(ITEM_RE, ''));
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

// Nearest-rank percentile of an ascending list.
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const fix = (x) => x.toFixed(1);
const num = (x) => Number(x.toFixed(1));
const pct = (n, base) => (base === 0 ? 0 : (n * 100) / base);

// Reads the sources in order; returns { texts, skipped }.
function gather(env, log) {
  const note = (name) => { if (log) log.push(name); };
  let skipped = 0;
  let held = 0;
  let full = false;
  const texts = [];
  const take = (arg) => {
    const input = readInput(arg, env);
    note(input.name);
    if (input.reason) {
      if (input.reason !== 'missing' && input.reason !== 'type') skipped++;
      return null;
    }
    if (input.dir) return input;
    if (held + input.text.length > TOTAL_MAX) {
      if (!full) skipped++;
      full = true;
      return null;
    }
    held += input.text.length;
    return input.text;
  };
  const readFolder = (name) => {
    const found = [];
    const input = take(name);
    if (!input || typeof input === 'string') return found;
    const walked = walk(input.abs, env, { count: 0 });
    skipped += walked.errors.length + walked.links;
    for (const f of walked.files) {
      if (!MD_RE.test(f)) continue;
      const text = take(f);
      if (typeof text === 'string') found.push(text);
    }
    return found;
  };
  const readme = take('README.md');
  if (typeof readme === 'string') texts.push(readme);
  let docs = readFolder('documentation');
  if (!docs.some((t) => countWords(mask(t)) > 0)) docs = readFolder('docs');
  texts.push(...docs);
  return { texts, skipped };
}

// buildProfile(texts, opts): style figures only. opts.terms replaces the catalog word terms.
export function buildProfile(texts, opts = {}) {
  const terms = opts.terms ?? wordTerms();
  const lengths = [];
  let words = 0;
  let sentences = 0;
  let questions = 0;
  let exclamations = 0;
  let contractions = 0;
  const person = { i: 0, we: 0, you: 0 };
  const lower = new Map();
  const capital = new Set();
  const fileCount = new Map();
  const pending = new Set([...terms].map((t) => String(t).toLowerCase()).filter((t) => t !== ''));
  let filled = 0;
  for (const text of texts) {
    const masked = mask(text);
    const nWords = countWords(masked);
    if (nWords > 0) filled++;
    words += nWords;
    const seenHere = new Set();
    for (const s of sentencesOf(masked)) {
      const len = countWords(s.text);
      if (len === 0) continue;
      sentences++;
      lengths.push(len);
      if (s.end === '?') questions++;
      if (s.end === '!') exclamations++;
      const kept = s.text.split(/\s+/).filter((c) => c !== '' && !ADDRESS_RE.test(c)).join(' ');
      const toks = kept.match(WORD_TOKEN_RE) ?? [];
      for (let k = 0; k < toks.length; k++) {
        const tok = trimQuotes(toks[k]);
        const low = tok.toLowerCase();
        if (CONTRACTION_RE.test(tok)) contractions++;
        for (const key of Object.keys(PERSON)) if (PERSON[key].has(low)) person[key]++;
        if (POSSESSIVE_RE.test(tok)) {
          const stem = low.slice(0, -2);
          if (LETTERS_RE.test(stem)) capital.add(stem);
          continue;
        }
        if (!LETTERS_RE.test(tok)) continue;
        if (tok === low) {
          lower.set(low, (lower.get(low) ?? 0) + 1);
          seenHere.add(low);
        } else if (k > 0) {
          capital.add(low);
        }
      }
    }
    for (const w of seenHere) fileCount.set(w, (fileCount.get(w) ?? 0) + 1);
    if (pending.size > 0) {
      const flat = paragraphs(text, masked).map((p) => p.text).join('\n').toLowerCase();
      for (const t of pending) if (hasTerm(flat, t)) pending.delete(t);
    }
  }
  lengths.sort((a, b) => a - b);
  const sum = lengths.reduce((a, b) => a + b, 0);
  const personBase = person.i + person.we + person.you;
  const termSet = new Set(terms);
  const preferred = [...lower.entries()]
    .filter(([w]) => (fileCount.get(w) ?? 0) >= 2 && !capital.has(w) && !termSet.has(w) && !STOP_WORDS.has(w))
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
    .slice(0, LIST_MAX)
    .map(([w]) => w);
  const avoided = [...new Set(terms)]
    .filter((t) => pending.has(String(t).toLowerCase()))
    .sort(cmp)
    .slice(0, LIST_MAX);
  return {
    files: filled,
    words,
    sentence: { mean: sentences ? sum / sentences : 0, p50: percentile(lengths, 50), p90: percentile(lengths, 90) },
    person: { i: pct(person.i, personBase), we: pct(person.we, personBase), you: pct(person.you, personBase) },
    tone: {
      contractions: words ? (contractions * 1000) / words : 0,
      questions: pct(questions, sentences),
      exclamations: pct(exclamations, sentences),
    },
    preferred,
    avoided,
  };
}

const isLetterNum = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

// True when the lowercase term occurs in the lowercase text with no letter or digit next to it.
function hasTerm(haystack, term) {
  const t = String(term).toLowerCase();
  if (t === '') return false;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(t, from);
    if (at < 0) return false;
    const prev = at > 0 ? haystack[at - 1] : undefined;
    const next = haystack[at + t.length];
    if (!isLetterNum(prev) && !isLetterNum(next)) return true;
    from = at + 1;
  }
}

function parseArgs(args) {
  let json = false;
  let voice = null;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--json') json = true;
    else if (a === '--voice-line') {
      const v = args[k + 1];
      if (typeof v !== 'string' || !VOICE_RE.test(v)) return { code: 2, stderr: BAD_VOICE };
      voice = v;
      k++;
    } else return { code: 2, stderr: USAGE };
  }
  return { json, voice };
}

// main(args, env): { code, stdout, stderr }. env.cwd is the product root, env.log collects read paths, env.terms replaces the catalog terms.
export function main(args, env = {}) {
  const parsed = parseArgs(args);
  if (parsed.code) return { code: 2, stdout: '', stderr: parsed.stderr };
  const { json, voice } = parsed;
  const { texts, skipped } = gather(env, env.log);
  const profile = buildProfile(texts, { terms: env.terms });
  if (profile.words === 0) {
    const stdout = json
      ? `${JSON.stringify({ v: 1, source: 'fallback', voice })}\n`
      : `voice profile: no doc text in README or docs folder; ${voice === null ? 'no voice line given' : `using the project voice line: ${voice}`}\n`;
    return { code: 0, stdout, stderr: '' };
  }
  if (json) {
    const out = {
      v: 1,
      source: 'docs',
      files: profile.files,
      words: profile.words,
      skipped,
      sentence: { mean: num(profile.sentence.mean), p50: num(profile.sentence.p50), p90: num(profile.sentence.p90) },
      person: { i: num(profile.person.i), we: num(profile.person.we), you: num(profile.person.you) },
      tone: { contractions: num(profile.tone.contractions), questions: num(profile.tone.questions), exclamations: num(profile.tone.exclamations) },
      preferred: profile.preferred,
      avoided: profile.avoided,
    };
    return { code: 0, stdout: `${JSON.stringify(out)}\n`, stderr: '' };
  }
  const list = (a) => (a.length ? a.join(', ') : 'none');
  const lines = [`voice profile: ${profile.files} files, ${profile.words} words`];
  if (skipped > 0) lines.push(`skipped: ${skipped}`);
  lines.push(
    `sentence length: mean ${fix(profile.sentence.mean)}, median ${fix(profile.sentence.p50)}, p90 ${fix(profile.sentence.p90)}`,
    `person: I ${fix(profile.person.i)}%, we ${fix(profile.person.we)}%, you ${fix(profile.person.you)}%`,
    `tone: contractions ${fix(profile.tone.contractions)} per 1000 words, questions ${fix(profile.tone.questions)}%, exclamations ${fix(profile.tone.exclamations)}%`,
    `preferred terms: ${list(profile.preferred)}`,
    `avoided terms: ${list(profile.avoided)}`,
  );
  return { code: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const res = main(process.argv.slice(2), {});
  process.stdout.write(res.stdout);
  process.stderr.write(res.stderr);
  process.exitCode = res.code;
}
