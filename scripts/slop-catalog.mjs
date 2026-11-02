// Slop catalog (contract: docs/contracts/slop-scan.md v1). Node built-ins only; data and matchers, no I/O.
// Each rule is { id, kind, label, re } or { id, kind, label, test }: exactly one matcher, a global RegExp or a function
// of the text returning a boolean. `unit` is 'paragraph' when absent, or 'line' for the tells that describe one written
// line (S05, S06, S09). A W rule built by `wordRule` also holds `terms`, the plain words and phrases its regex matches.
// Every regex here is linear: plain alternatives, bounded runs, no quantified group that holds a quantifier, no
// unbounded run. Tells that count things (S02, S03, S08, S09) use `testRule`, a plain loop in place of a regex.

const escapeRe = (s) => s.replace(/[\^$.*+?()[\]{}|/\\]/g, '\\$&');

// Prefix tree of the terms as nested alternations, so a word start picks its branch by first letter instead of trying
// every term, and the work stays linear in the text however long the list grows.
function trieSource(terms) {
  const root = { kids: new Map(), end: false };
  for (const term of terms) {
    let node = root;
    for (const ch of Array.from(term.toLowerCase())) {
      let kid = node.kids.get(ch);
      if (!kid) {
        kid = { kids: new Map(), end: false };
        node.kids.set(ch, kid);
      }
      node = kid;
    }
    node.end = true;
  }
  const emit = (node) => {
    const alts = [];
    for (const [ch, kid] of node.kids) alts.push(escapeRe(ch) + emit(kid));
    if (node.end && alts.length > 0) alts.push('');
    if (alts.length === 0) return '';
    return alts.length === 1 ? alts[0] : `(?:${alts.join('|')})`;
  };
  return emit(root);
}

// A whole-word, case-insensitive match of any of the plain terms.
export function wordRule(id, label, terms) {
  const src = `(?<![\\p{L}\\p{N}])${trieSource(terms)}(?![\\p{L}\\p{N}])`;
  return { id, kind: 'W', label, terms: [...terms], re: new RegExp(src, 'giu') };
}

// A rule decided by a plain function of one unit of text: true is one tell for that unit.
export function testRule(id, kind, label, test, unit = 'paragraph') {
  return { id, kind, label, unit, test };
}

// Adds the curly-apostrophe twin of every term that holds a straight one.
const withCurly = (terms) => terms.flatMap((t) => (t.includes("'") ? [t, t.replaceAll("'", '’')] : [t]));

const W01 = [
  'delve', 'delves', 'delved', 'delving',
  'leverage', 'leverages', 'leveraged', 'leveraging',
  'utilize', 'utilizes', 'utilized', 'utilizing',
  'showcase', 'showcases', 'showcased', 'showcasing',
  'underscores', 'underscored', 'underscoring',
  'foster', 'fosters', 'fostered', 'fostering',
  'elevate', 'elevates', 'elevating',
  'unlock', 'unlocks', 'unlocked', 'unlocking',
  'streamline', 'streamlines', 'streamlined', 'streamlining',
  'empower', 'empowers', 'empowered', 'empowering',
  'spearhead', 'spearheads', 'spearheaded', 'spearheading',
  'revolutionize', 'revolutionizes', 'revolutionized', 'revolutionizing',
  'embark', 'embarks', 'embarked', 'embarking',
  'orchestrate', 'orchestrates', 'orchestrated', 'orchestrating',
];

const W02 = [
  'tapestry', 'landscape', 'realm', 'testament', 'beacon', 'cornerstone',
  'pivotal', 'paramount', 'multifaceted', 'intricate', 'intricacies', 'nuanced',
  'holistic', 'synergy', 'synergies', 'paradigm', 'ecosystem', 'journey',
  'myriad', 'plethora', 'vibrant', 'bustling', 'seamless', 'seamlessly',
  'robust', 'comprehensive', 'crucial', 'vital', 'transformative', 'groundbreaking',
];

const W03 = [
  'game-changer', 'game changer', 'game-changing', 'cutting-edge', 'state-of-the-art',
  'world-class', 'best-in-class', 'next-level', 'next level', 'revolutionary',
  'unparalleled', 'unmatched', 'second to none', 'turnkey', 'supercharge',
  'supercharges', 'supercharged', 'blazing fast', 'blazing-fast', 'lightning fast',
  'lightning-fast', 'effortless', 'effortlessly', 'must-have', 'industry-leading',
];

const W04 = withCurly([
  "it's worth noting that", 'it is worth noting that', "it's important to note that",
  'it is important to note that', 'it should be noted that', 'it bears mentioning',
  'needless to say', "let's dive in", "let's dive into", "let's explore",
  'when it comes to', "in today's fast-paced world", "in today's digital age",
  'in the world of', 'in an era of', 'have you ever wondered', 'imagine a world where',
]);

const W05 = [
  'might perhaps', 'could possibly', 'may potentially', 'could potentially',
  'might potentially', 'could perhaps', 'might possibly', 'may possibly',
  'may perhaps', 'perhaps maybe', 'maybe perhaps', 'possibly perhaps',
  'somewhat perhaps', 'arguably perhaps', 'tends to generally', 'might somewhat',
  'may sometimes potentially', 'can sometimes potentially', 'seems to possibly',
  'it seems that perhaps', 'sort of perhaps', 'kind of maybe',
];

const W06 = withCurly([
  'i hope this helps', 'hope this helps', 'hope that helps', 'let me know if',
  'feel free to ask', 'feel free to reach out', 'happy to help', "i'd be happy to",
  'i would be happy to', 'as an ai', 'as a language model', 'great question',
  'good question', 'excellent question', 'is there anything else',
  "don't hesitate to", 'do not hesitate to', 'sure, here is', 'sure, here are',
  'certainly, here is', 'certainly, here are',
]);

const W07 = [
  'very', 'really', 'extremely', 'incredibly', 'truly', 'highly', 'absolutely',
  'literally', 'deeply', 'genuinely', 'remarkably', 'undeniably', 'utterly',
  'totally', 'profoundly', 'quite',
];

const W08 = withCurly([
  'in conclusion', 'in summary', 'to summarize', 'to sum up', 'in a nutshell',
  'in short', 'all in all', 'to recap', 'to wrap up', 'the bottom line',
  'as we have seen', 'as discussed above', 'as mentioned earlier',
  "let's break it down", 'let us break this down', "here's the thing",
  'without further ado', 'moving on to', 'in this article we will',
  'in this post we will', 'in this guide we will', 'the key takeaway', 'key takeaways',
]);

const LIST_ITEM_START = /^[ \t]{0,3}(?:#{1,6}|[-*+]|\d{1,3}[.)])[ \t]/;
const EMOJI = /\p{Emoji_Presentation}|\p{Emoji}️/u;
const EM_DASH = 0x2014;

function countOf(line, code) {
  let n = 0;
  for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) === code) n++;
  return n;
}

// Lists of three: two items, then "and" or "or" and a third, joined by ", ". An item is 1 to 3 words; the words around a list
// count as the first or the last item, so a lead-in or a lead-out does not hide it.
// Any other character (a stop, colon, digit, dash) ends the chain. Plain loops over the characters, linear in the text.
const LIST_CHAR = /[\p{L}'’ \t,-]/u;
function listSegments(text) {
  const segs = [];
  let from = 0;
  let i = 0;
  while (i < text.length) {
    const width = text.codePointAt(i) > 0xffff ? 2 : 1;
    if (!LIST_CHAR.test(text.slice(i, i + width))) {
      if (i > from) segs.push(text.slice(from, i));
      from = i + width;
    }
    i += width;
  }
  if (from < text.length) segs.push(text.slice(from));
  return segs;
}
function wordTokens(part) {
  const tokens = [];
  let from = -1;
  for (let i = 0; i <= part.length; i++) {
    const c = i < part.length ? part.charCodeAt(i) : 32;
    if (c === 32 || c === 9) {
      if (from >= 0) tokens.push(part.slice(from, i));
      from = -1;
    } else if (from < 0) from = i;
  }
  return tokens;
}
function listsOfThree(text) {
  let n = 0;
  for (const seg of listSegments(text)) {
    if (seg.length < 8) continue;
    let run = 0;
    for (const part of seg.split(', ')) {
      const tokens = wordTokens(part);
      if (tokens.length === 0 || tokens.some((t) => t.includes(','))) { run = 0; continue; }
      let ci = -1;
      for (let k = 0; k < tokens.length && ci < 0; k++) {
        const w = tokens[k].toLowerCase();
        if (w === 'and' || w === 'or') ci = k;
      }
      if (ci < 0) {
        run = tokens.length <= 3 ? run + 1 : 1;
        continue;
      }
      const right = tokens.length - ci - 1;
      if (ci <= 3 && right >= 1 && right <= 8 && run >= (ci === 0 ? 2 : 1)) n++;
      run = right > 0 ? 1 : 0;
    }
  }
  return n;
}

// Word counts of the sentences in a paragraph; a sentence ends at . ! or ? before a space or the end of the text.
function sentenceLengths(line) {
  const lens = [];
  let words = 0;
  let inWord = false;
  for (let i = 0; i <= line.length; i++) {
    const c = i < line.length ? line[i] : ' ';
    const end = (c === '.' || c === '!' || c === '?') && (i + 1 === line.length || line[i + 1] === ' ');
    if (c === ' ' || c === '\t') {
      inWord = false;
    } else if (!end && !inWord) {
      inWord = true;
      words++;
    }
    if (end || i === line.length) {
      if (words > 0) lens.push(words);
      words = 0;
      inWord = false;
    }
  }
  return lens;
}

// Four sentences in a row whose lengths sit within 3 words of each other, each at least 3 words long.
function flatRhythm(line) {
  const lens = sentenceLengths(line);
  for (let i = 0; i + 3 < lens.length; i++) {
    const a = lens[i];
    const b = lens[i + 1];
    const c = lens[i + 2];
    const d = lens[i + 3];
    const lo = Math.min(a, b, c, d);
    if (lo >= 3 && Math.max(a, b, c, d) - lo <= 3) return true;
  }
  return false;
}

export const RULES = [
  wordRule('W01', 'inflated verb: leverage, delve, showcase', W01),
  wordRule('W02', 'grand abstract word: tapestry, landscape, pivotal', W02),
  wordRule('W03', 'sales hype: game-changer, cutting-edge', W03),
  wordRule('W04', 'filler opener that announces a point', W04),
  wordRule('W05', 'stacked hedge: might perhaps, could possibly', W05),
  wordRule('W06', 'chat residue: offer, praise, sign-off', W06),
  wordRule('W07', 'empty intensifier: very, really, truly', W07),
  wordRule('W08', 'signpost or summary announcer', W08),
  {
    id: 'S01',
    kind: 'S',
    label: 'contrast: not X but Y, isn’t X it’s Y',
    re: /\bnot [\p{L}' -]{1,60},? but\b|\b(?:isn['’]t|is not|aren['’]t|are not|wasn['’]t|was not|doesn['’]t|does not) [^.,!?;—\n]{1,60}(?:[.,;] |[ ]?—[ ]?)(?:it['’]s|it is|they['’]re|they are|this is|that['’]s|that is|rather)\b/giu,
  },
  testRule('S02', 'S', 'dash-heavy paragraph: more than 2 em dashes', (text) => countOf(text, EM_DASH) > 2),
  testRule('S03', 'S', 'two or more lists of three in one paragraph', (text) => listsOfThree(text) >= 2),
  {
    id: 'S04',
    kind: 'S',
    label: 'staged reveal: short tease, then the answer',
    re: /\bthe (?:result|catch|answer|truth|secret|kicker|twist|best part|problem|upside|downside|real reason)[?:]|\bhere['’]s (?:the|what|why|how)[^.!?:\n]{0,30}:|\bwhat if i told you\b/giu,
  },
  {
    id: 'S05',
    kind: 'S',
    label: 'one-line closer that restates the paragraph',
    unit: 'line',
    re: /^[ \t]{0,3}(?:in the end|at the end of the day|simply put|the takeaway|and that['’]s (?:it|the point)|that['’]s the whole point|and just like that|so there you have it|now you know)\b[^.!?\n]{0,60}[.!]$/giu,
  },
  {
    id: 'S06',
    kind: 'S',
    label: 'bold label opens a list item',
    unit: 'line',
    re: /^[ \t]{0,3}(?:[-*+]|\d{1,3}[.)])[ \t]{1,8}\*\*[^*\n]{1,40}(?::\*\*|\*\*:)/g,
  },
  {
    id: 'S07',
    kind: 'S',
    label: 'question asked and answered at once',
    re: /\b(?:why|what|how|who|where|when|can|could|should|is|are|do|does)\b[^.!?\n]{2,50}\? (?:because|simply|the answer|short answer|yes|no|it['’]s|it is|they|that['’]s)\b/giu,
  },
  testRule('S08', 'S', 'flat rhythm: 4 sentences of near-equal length', flatRhythm),
  testRule('S09', 'S', 'emoji in a heading or list item', (line) => LIST_ITEM_START.test(line) && EMOJI.test(line), 'line'),
];

// The plain terms of the W rules, in catalog order.
export function wordTerms(rules = RULES) {
  const out = [];
  for (const rule of rules) if (rule.kind === 'W' && Array.isArray(rule.terms)) out.push(...rule.terms);
  return out;
}
