import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBrainstorm } from './check.mjs';

// Display names must not drift back into the places that store or carry a Role. The scan looks at positions, not
// prose: a Role-name word in a sentence is correct (a Dev dependency, a quoted name in a roadmap).
//   - dispatch blocks: fenced blocks of skills, agents and the dispatch-prompt Contract
//   - By: line of a Handoff that has a `contracts:` key or a Role-id By: line
//   - cue lines of a cooler file with `ids: role`
//   - reply headings, Dissent and Threads lines of a brainstorm file with `ids: role` (the positions checkBrainstorm reads)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'tests', 'fixtures', 'name-drift');
const COMPANY = join(ROOT, '.company');
const ROSTER = JSON.parse(readFileSync(join(ROOT, 'company', 'names.json'), 'utf8'));
const SLUGS = new Set(Object.keys(ROSTER));
const NAMES = Object.values(ROSTER);

// Folders of the proj.M14 Debt row (.company/standards.md), relative to .company. Fixed here and never read at run time.
const SKIP_WORK = Object.freeze([
  'cheaper-role-models', 'goldfish-roles', 'low-tier-path', 'open-decision-check', 'optimize-brainstorm',
  'parallel-cap', 'personalities-company-types', 'playbook-chain-handoff', 'reprompter-role', 'skill-researcher-scan',
  'speed-scorecard', 'triage-hardening', 'v020-gate-roadmap',
]);
const SKIP_DIRS = Object.freeze([...SKIP_WORK.map(f => `work/${f}`), 'archive/roadmap']);

const MAX_BYTES = 1024 * 1024;
const HEAD_BYTES = 8192;
const MAX_FILES = 20000;
const MAX_DEPTH = 16;
const MAX_HITS_PER_FILE = 50;

const KIND = Object.freeze({
  nameLine: 'Name: line in a dispatch block',
  nameInBlock: 'display name in a dispatch block',
  by: 'By: line of a v1.2 Handoff is not a Role id',
  heading: 'reply heading of an ids: role file is not a Role id',
  dissent: 'Dissent line of an ids: role file does not start with a Role id',
  threads: 'Threads line of an ids: role file does not name a Role id',
  cue: 'cue line of an ids: role cooler file is not a Role id',
  big: 'file too large to scan',
  link: 'symlink is not followed',
  deep: 'folder nested deeper than the scan cap',
  many: 'more files than the scan cap',
  unreadable: 'folder not readable',
});

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME_RE = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${NAMES.map(esc).join('|')})(?![\\p{L}\\p{N}_])`, 'u');
// Canonical form for matching: composed letters, no zero-width or other ignorable code points.
const fold = s => s.normalize('NFC').replace(/\p{Default_Ignorable_Code_Point}/gu, '');
const hasName = line => NAME_RE.test(fold(line));
const fmt = hits => hits.map(h => `${h.file}:${h.line}: ${h.kind}`);

// ---- scanner ----

function frontmatter(text) {
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const map = new Map();
  for (const line of lines.slice(1, end)) {
    const m = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
    if (m) map.set(m[1], m[2].replace(/^"(.*)"$/, '$1'));
  }
  return { lines, end, map };
}

function fencedBlocks(lines) {
  const blocks = [];
  let open = null;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!open) {
      const m = /^(`{3,}|~{3,})/.exec(t);
      if (m) open = { ch: m[1][0], len: m[1].length, line: i + 1, lines: [] };
    } else if (t.length >= open.len && t === open.ch.repeat(t.length)) {
      blocks.push(open);
      open = null;
    } else open.lines.push(line);
  });
  if (open) blocks.push(open);
  return blocks;
}

const DISPATCH_KEY = /^[ \t]*(?:Company profile|Project profile|Input Handoffs|Output|Task brief):/;

// Counts the dispatch blocks too, so a caller can prove the scan sees real ones.
function scanDispatch(text, file) {
  const hits = [];
  let blocks = 0;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (const b of fencedBlocks(lines)) {
    if (!b.lines.some(l => DISPATCH_KEY.test(l))) continue;
    blocks++;
    b.lines.forEach((l, k) => {
      if (/^[ \t]*Name:/.test(l)) hits.push({ file, line: b.line + 1 + k, kind: KIND.nameLine });
      else if (hasName(l)) hits.push({ file, line: b.line + 1 + k, kind: KIND.nameInBlock });
    });
  }
  return { hits: hits.slice(0, MAX_HITS_PER_FILE), blocks };
}

function scanHandoff(text, file) {
  const doc = frontmatter(text);
  if (!doc) return [];
  const idBy = doc.lines.slice(doc.end + 1, doc.end + 4).some(l => /^By: [a-z][a-z0-9-]*$/.test(l));
  if (!doc.map.has('contracts') && !idBy) return [];
  for (let i = doc.end + 1; i < Math.min(doc.lines.length, doc.end + 4); i++) {
    if (!doc.lines[i].startsWith('By:')) continue;
    const m = /^By: ([a-z][a-z0-9-]*)$/.exec(doc.lines[i]);
    return m && SLUGS.has(m[1]) ? [] : [{ file, line: i + 1, kind: KIND.by }];
  }
  return [];
}

const HEADING_RE = /^#### ([a-z][a-z0-9-]*)(?: — (?:full pass|crossfire))?$/;
const DISSENT_RE = /^- ([a-z][a-z0-9-]*) — /;
const THREADS_RE = /^- I-\d{1,6}\.\d{1,6} ← ([a-z][a-z0-9-]*) (?:agree|challenge|build-on): /;

// `force` reads a file without `ids: role` by the same positions, to count old named files as Debt.
function scanBrainstorm(text, file, { force = false } = {}) {
  const doc = frontmatter(text);
  if (!doc || doc.map.get('format') !== '2' || doc.map.has('kind')) return [];
  if (doc.map.get('ids') !== 'role' && !force) return [];
  const hits = [];
  let section = '';
  let part = '';
  const bad = (re, line) => { const m = re.exec(line); return !m || !SLUGS.has(m[1]); };
  doc.lines.forEach((line, i) => {
    if (i <= doc.end) return;
    const h2 = /^## (.+)$/.exec(line);
    if (h2) { section = h2[1].trim(); part = ''; return; }
    if (section === 'Digest') {
      const h3 = /^### (.+)$/.exec(line);
      if (h3) { part = h3[1].trim(); return; }
      if (part === 'Dissent' && line.startsWith('- ') && bad(DISSENT_RE, line)) hits.push({ file, line: i + 1, kind: KIND.dissent });
      if (part === 'Threads' && line.startsWith('- ') && bad(THREADS_RE, line)) hits.push({ file, line: i + 1, kind: KIND.threads });
    } else if (section === 'Rounds' && line.startsWith('#### ') && bad(HEADING_RE, line)) hits.push({ file, line: i + 1, kind: KIND.heading });
  });
  return hits.slice(0, MAX_HITS_PER_FILE);
}

function scanCooler(text, file) {
  const doc = frontmatter(text);
  if (!doc || doc.map.get('ids') !== 'role' || doc.map.has('format') || doc.map.has('kind')) return [];
  const hits = [];
  for (let i = doc.end + 1; i < doc.lines.length; i++) {
    const m = /^\*\*(.+)\*\*$/.exec(doc.lines[i].trim());
    if (!m) continue;
    let j = i + 1;
    while (j < doc.lines.length && doc.lines[j].trim() === '') j++;
    const next = doc.lines[j] ?? '';
    if (!next.startsWith('> ') && !next.startsWith('*(')) continue;
    if (!SLUGS.has(m[1]) && m[1] !== 'CEO') hits.push({ file, line: i + 1, kind: KIND.cue });
  }
  return hits.slice(0, MAX_HITS_PER_FILE);
}

const scanDocument = (text, file) => [...scanHandoff(text, file), ...scanBrainstorm(text, file), ...scanCooler(text, file)];
const qualifies = doc => !!doc && (doc.map.has('contracts') || doc.map.get('ids') === 'role');

// A file over the cap is read for its frontmatter only: one that would be scanned is a hit (fail closed), any other is skipped.
function readCapped(abs) {
  const st = lstatSync(abs);
  if (st.size <= MAX_BYTES) return { text: readFileSync(abs, 'utf8') };
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    return { head: buf.subarray(0, readSync(fd, buf, 0, HEAD_BYTES, 0)).toString('utf8') };
  } finally { closeSync(fd); }
}

function scanCompanyFile(abs, file) {
  const r = readCapped(abs);
  if (r.head !== undefined) return qualifies(frontmatter(r.head)) ? [{ file, line: 1, kind: KIND.big }] : [];
  return scanDocument(r.text, file);
}

// Lists the .md files under `base` without following links. Files under a skip folder are returned apart, for the Debt count.
function listTree(base, skipDirs) {
  const files = [];
  const skipped = Object.fromEntries(skipDirs.map(d => [d, []]));
  const hits = [];
  let seen = 0;
  const visit = (abs, rel, depth, inSkip) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { hits.push({ file: rel || '.', line: 1, kind: KIND.unreadable }); return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const here = inSkip ?? (skipDirs.includes(r) ? r : null);
      if (e.isSymbolicLink()) { if (!here) hits.push({ file: r, line: 1, kind: KIND.link }); continue; }
      if (e.isDirectory()) {
        if (depth >= MAX_DEPTH) { if (!here) hits.push({ file: r, line: 1, kind: KIND.deep }); continue; }
        visit(join(abs, e.name), r, depth + 1, here);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        if (++seen > MAX_FILES) { if (seen === MAX_FILES + 1) hits.push({ file: r, line: 1, kind: KIND.many }); continue; }
        (here ? skipped[here] : files).push({ abs: join(abs, e.name), rel: r });
      }
    }
  };
  visit(base, '', 0, null);
  return { files, skipped, hits };
}

function scanTree(base, { label = '.company', skipDirs = SKIP_DIRS } = {}) {
  const listed = listTree(base, skipDirs);
  const { files, skipped } = listed;
  const hits = listed.hits.map(h => ({ ...h, file: `${label}/${h.file}` }));
  for (const f of files) hits.push(...scanCompanyFile(f.abs, `${label}/${f.rel}`));
  return { hits, skipped, scanned: files.length };
}

// Debt: name positions inside skipped folders, as counts per folder.
function debtCounts(base, skipped, label = '.company') {
  const out = {};
  for (const [dir, list] of Object.entries(skipped)) {
    let bylines = 0, brainstorm = 0;
    for (const f of list) {
      const r = readCapped(f.abs);
      if (r.text === undefined) continue;
      const doc = frontmatter(r.text);
      const by = doc && doc.lines.slice(doc.end + 1, doc.end + 4).find(l => l.startsWith('By:'));
      if (by && hasName(by)) bylines++;
      brainstorm += scanBrainstorm(r.text, `${label}/${f.rel}`, { force: true }).length;
    }
    out[dir] = { files: list.length, bylines, brainstorm };
  }
  return out;
}

function dispatchFiles(root) {
  const out = [];
  const visit = (abs, rel, depth) => {
    if (depth > MAX_DEPTH) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) visit(join(abs, e.name), `${rel}/${e.name}`, depth + 1);
      else if (e.isFile() && e.name.endsWith('.md')) out.push({ abs: join(abs, e.name), rel: `${rel}/${e.name}` });
    }
  };
  for (const d of ['skills', 'agents']) if (existsSync(join(root, d))) visit(join(root, d), d, 0);
  const contract = join(root, 'docs', 'contracts', 'dispatch-prompt.md');
  if (existsSync(contract)) out.push({ abs: contract, rel: 'docs/contracts/dispatch-prompt.md' });
  return out;
}

function scanDispatchFiles(files) {
  const hits = [];
  let blocks = 0;
  for (const f of files) {
    const r = readCapped(f.abs);
    if (r.head !== undefined) { hits.push({ file: f.rel, line: 1, kind: KIND.big }); continue; }
    const s = scanDispatch(r.text, f.rel);
    hits.push(...s.hits);
    blocks += s.blocks;
  }
  return { hits, blocks };
}

// ---- helpers ----

const tempDirs = [];
after(() => { for (const d of tempDirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'name-drift-')); tempDirs.push(d); return d; };
const put = (dir, rel, text) => { const f = join(dir, ...rel.split('/')); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); return f; };
const fx = n => readFileSync(join(FIX, n), 'utf8');
const at = n => `tests/fixtures/name-drift/${n}`;
const block = lines => ['```', 'Project profile: .company/project.md', 'Company profile: PROFILE.md', 'Language: en', ...lines, 'Output: .company/work/x/01-qa.md', '```', ''].join('\n');
const kinds = hits => hits.map(h => h.kind);
const errs = (text, re) => checkBrainstorm(text, { file: 'x.md' }).filter(e => re.test(e));
const OK_BRAINSTORM = fx('brainstorm-ids-ok.md');
const DISSENT_OK = '- architect — "A theme switch touches every component, so it is not small." — src: R2';
const THREADS_OK = '- I-1.2 ← writer challenge: "Copy must survive both themes." — src: R2';
const withLine = (text, from, to) => { assert.ok(text.includes(from), 'fixture line present'); return text.replace(from, to); };

// ---- hostile cases first ----

test('a dispatch block cannot hide a name: unclosed fence, tilde fence, indent, CRLF, NFD letters, zero-width characters', () => {
  const unclosed = '```\nCompany profile: PROFILE.md\nName: Nora\n';
  assert.deepEqual(kinds(scanDispatch(unclosed, 'a.md').hits), [KIND.nameLine]);
  const tilde = '~~~\nCompany profile: PROFILE.md\nGoal: ask Ava\n~~~\n';
  assert.deepEqual(kinds(scanDispatch(tilde, 'a.md').hits), [KIND.nameInBlock]);
  assert.deepEqual(kinds(scanDispatch(block(['  Name: demo']), 'a.md').hits), [KIND.nameLine]);
  assert.deepEqual(kinds(scanDispatch(block(['Goal: ask Nora']).replace(/\n/g, '\r\n'), 'a.md').hits), [KIND.nameInBlock]);
  assert.deepEqual(kinds(scanDispatch(block([`Goal: ask ${'Lucía'}`]), 'a.md').hits), [KIND.nameInBlock], 'decomposed accent');
  assert.deepEqual(kinds(scanDispatch(block(['Goal: ask No​ra']), 'a.md').hits), [KIND.nameInBlock], 'zero-width space');
  assert.deepEqual(kinds(scanDispatch(block(['Goal: ask Ava-based']), 'a.md').hits), [KIND.nameInBlock], 'hyphen is not a letter');
});

test('a dispatch block keeps its words: a name inside a longer word, other case, or outside a block is not a hit', () => {
  for (const goal of ['ask Avalon', 'ask Devon', 'the dev dependencies', 'Dev2 branch', 'ask nora', 'ask NORA']) {
    assert.deepEqual(scanDispatch(block([`Goal: ${goal}`]), 'a.md').hits, [], goal);
  }
  assert.deepEqual(scanDispatch(`Nora wrote it.\n\n${block(['Goal: write it'])}\nName: Ava\n`, 'a.md').hits, [], 'prose after the block');
});

test('every roster name is found as a whole word in a dispatch block', () => {
  assert.ok(NAMES.length >= 30);
  for (const n of NAMES) assert.deepEqual(kinds(scanDispatch(block([`Goal: ask ${n}`]), 'a.md').hits), [KIND.nameInBlock], 'one roster name');
});

test('a v1.2 Handoff byline must be exactly a roster Role id: other shapes, extra space, a stray word and a blank line before By', () => {
  const ok = fx('handoff-v12-ok.md');
  assert.deepEqual(scanHandoff(ok, 'h.md'), []);
  for (const by of ['By: Nora', 'By: Nora (product-manager)', 'By: product-manager ', 'By:  product-manager', 'By: Product-manager', 'By: nobody', 'By: product-manager (Nora)', 'By: ']) {
    assert.deepEqual(kinds(scanHandoff(ok.replace('By: product-manager\n', `${by}\n`), 'h.md')), [KIND.by], JSON.stringify(by));
  }
  assert.deepEqual(kinds(scanHandoff(ok.replace('---\nBy: product-manager\n', '---\n\nBy: Nora\n'), 'h.md')), [KIND.by], 'blank line before By');
  assert.deepEqual(kinds(scanHandoff(ok.replace(/\n/g, '\r\n').replace('product-manager\r\n## Did', 'Nora\r\n## Did'), 'h.md')), [KIND.by], 'CRLF');
  assert.deepEqual(kinds(scanHandoff(`﻿${fx('handoff-v12-name.md')}`, 'h.md')), [KIND.by], 'BOM');
});

test('a Handoff is v1.2 only by a contracts: key in its frontmatter', () => {
  const body = fx('handoff-old.md');
  assert.deepEqual(scanHandoff(body, 'h.md'), []);
  assert.deepEqual(scanHandoff(body.replace('## Next', 'contracts: [handoff v2.0]\n## Next'), 'h.md'), [], 'key in the body');
  assert.deepEqual(scanHandoff(body.replace('risk-tier: low\n---', 'risk-tier: low\ncontracts: [handoff v2.0]\n---'), 'h.md').length, 1);
  assert.deepEqual(scanHandoff(body.replace('risk-tier: low\n---', 'risk-tier: low\nnocontracts: x\n---'), 'h.md'), [], 'another key');
  assert.deepEqual(scanHandoff('By: Nora\n## Did\n', 'h.md'), [], 'no frontmatter');
  assert.deepEqual(scanHandoff('---\ncontracts: [x]\nBy: Nora\n', 'h.md'), [], 'frontmatter never closed');
});

test('a Handoff with a Role id byline is scanned even without contracts:; a name byline without the key is not', () => {
  const bare = fx('handoff-v12-ok.md').replace('contracts: [handoff v2.0]\n', '');
  assert.deepEqual(scanHandoff(bare, 'h.md'), []);
  assert.deepEqual(kinds(scanHandoff(bare.replace('By: product-manager', 'By: nobody'), 'h.md')), [KIND.by]);
  assert.deepEqual(scanHandoff(bare.replace('By: product-manager', 'By: Nora'), 'h.md'), []);
  assert.deepEqual(scanHandoff(bare.replace('By: product-manager', 'By: Nora (product-manager)'), 'h.md'), []);
});

test('brainstorm positions: only an ids: role file with format 2 is scanned, by exact frontmatter', () => {
  const bad = fx('brainstorm-ids-heading.md');
  assert.equal(scanBrainstorm(bad, 'b.md').length, 1);
  for (const v of ['name', 'Role', 'role ', 'roles', '']) {
    assert.deepEqual(scanBrainstorm(bad.replace('ids: role\n', `ids: ${v}\n`), 'b.md'), [], JSON.stringify(v));
  }
  assert.deepEqual(scanBrainstorm(bad.replace('ids: role\n', ''), 'b.md'), [], 'no ids');
  assert.deepEqual(scanBrainstorm(bad.replace('format: 2\n', ''), 'b.md'), [], 'no format');
  assert.deepEqual(scanBrainstorm(bad.replace('## Summary', 'ids: role\n## Summary').replace('ids: role\nmode', 'mode'), 'b.md'), [], 'ids in the body only');
  assert.deepEqual(scanBrainstorm(bad.replace('format: 2\n', 'format: 2\nkind: film\n'), 'b.md'), [], 'film file');
  assert.equal(scanBrainstorm(bad.replace(/\n/g, '\r\n'), 'b.md').length, 1, 'CRLF');
  assert.equal(scanBrainstorm(`﻿${bad}`, 'b.md').length, 1, 'BOM');
  assert.equal(scanBrainstorm(bad.replace('ids: role', 'ids:    role'), 'b.md').length, 1, 'space after the colon');
});

test('brainstorm positions: headings are read in Rounds only, Dissent and Threads in Digest only, and every part occurrence counts', () => {
  const named = '#### Ava (architect)';
  assert.deepEqual(scanBrainstorm(withLine(OK_BRAINSTORM, '## Questions', `## Questions\n${named}`), 'b.md'), [], 'a heading outside Rounds is not a reply');
  assert.deepEqual(scanBrainstorm(withLine(OK_BRAINSTORM, '### Round 1 — ideas', `### Round 1 — ideas\n${named}`), 'b.md').map(h => h.kind), [KIND.heading]);
  const twice = withLine(OK_BRAINSTORM, '### Threads', `### Dissent\n- Ava (architect) — "x" — src: R2\n### Threads`);
  assert.equal(scanBrainstorm(twice, 'b.md').length, 1, 'a second Dissent part is scanned');
  const wrongPart = withLine(OK_BRAINSTORM, '### Estimate', '### Estimate\n- Ava (architect) — "x" — src: R2');
  assert.deepEqual(scanBrainstorm(wrongPart, 'b.md'), [], 'a line in another part is not a Dissent line');
  const prose = withLine(OK_BRAINSTORM, '### Dissent', '### Dissent\nAva (architect) said no.');
  assert.deepEqual(scanBrainstorm(prose, 'b.md'), [], 'only bullet lines are Dissent items, like the checker');
});

test('brainstorm positions agree with checkBrainstorm: the same heading, Dissent and Threads variants fail in both', () => {
  assert.deepEqual(checkBrainstorm(OK_BRAINSTORM, { file: 'x.md' }), []);
  assert.deepEqual(scanBrainstorm(OK_BRAINSTORM, 'x.md'), []);
  for (const h of ['#### Ava (architect)', '#### architect (architect)', '#### architect extra', '#### architect — fullpass', '#### architect — full pass extra', '####  architect', '#### Architect', '#### stranger']) {
    const t = withLine(OK_BRAINSTORM, '#### architect\nIdea: CSS', `${h}\nIdea: CSS`);
    assert.ok(errs(t, /rule 8:/).length, `checker: ${h}`);
    assert.equal(scanBrainstorm(t, 'x.md').length, 1, `scan: ${h}`);
  }
  for (const d of ['- Ava (architect) — "q"', '- architect (architect) — "q"', '- stranger — "q"', '- architect "q"']) {
    const t = withLine(OK_BRAINSTORM, DISSENT_OK, `${d} — src: R2`);
    assert.ok(errs(t, /rule 6:/).length, `checker: ${d}`);
    assert.deepEqual(kinds(scanBrainstorm(t, 'x.md')), [KIND.dissent], `scan: ${d}`);
  }
  for (const d of ['- I-1.2 ← Ava (architect) challenge: "q"', '- I-1.2 ← writer (writer) challenge: "q"', '- I-1.2 ← stranger challenge: "q"', '- I-1.2 ← writer "q"']) {
    const t = withLine(OK_BRAINSTORM, THREADS_OK, `${d} — src: R2`);
    assert.ok(errs(t, /rule 5:/).length, `checker: ${d}`);
    assert.deepEqual(kinds(scanBrainstorm(t, 'x.md')), [KIND.threads], `scan: ${d}`);
  }
  for (const n of ['v22-ids-role.md']) {
    const t = readFileSync(join(ROOT, 'tests', 'fixtures', 'brainstorm', n), 'utf8');
    assert.deepEqual(checkBrainstorm(t, { file: n }), []);
    assert.deepEqual(scanBrainstorm(t, n), []);
  }
});

test('cooler cues: a name, a stray bold word or a non-roster cue fails; a Role id, CEO and script elements pass', () => {
  const ok = fx('cooler-ids-ok.md');
  assert.deepEqual(scanCooler(ok, 'c.md'), []);
  for (const cue of ['**Ava (architect)**', '**Ava**', '**stranger**', '**Architect**', '**architect (architect)**', '**architect, qa**']) {
    assert.deepEqual(kinds(scanCooler(ok.replace('**architect**\n>', `${cue}\n>`), 'c.md')), [KIND.cue], cue);
  }
  assert.deepEqual(kinds(scanCooler(ok.replace('**architect**\n>', '**Ava**\n\n>'), 'c.md')), [KIND.cue], 'blank line between cue and quote');
  assert.deepEqual(kinds(scanCooler(ok.replace('**qa**\n*(leaning', '**Quinn**\n*(leaning'), 'c.md')), [KIND.cue], 'cue before a parenthetical');
  assert.deepEqual(scanCooler(ok.replace('**FADE OUT.**', '**Nora**'), 'c.md'), [], 'a bold line that no quote follows is not a cue');
  assert.deepEqual(kinds(scanCooler(ok.replace(/\n/g, '\r\n').replace('**qa**', '**Quinn**'), 'c.md')), [KIND.cue], 'CRLF');
  for (const v of ['name', 'roles', 'role ']) assert.deepEqual(scanCooler(fx('cooler-ids-name-cue.md').replace('ids: role\n', `ids: ${v}\n`), 'c.md'), [], `ids: ${v}`);
  assert.deepEqual(scanCooler(fx('cooler-ids-name-cue.md').replace('mode: natural\n', 'mode: natural\nformat: 2\n'), 'c.md'), [], 'a format file is a brainstorm file');
});

test('a hit names file, line and kind, never the matched name', () => {
  const hits = [
    ...scanDispatch(fx('dispatch-name-line.md'), at('dispatch-name-line.md')).hits,
    ...scanDispatch(fx('dispatch-effective-name.md'), at('dispatch-effective-name.md')).hits,
    ...scanHandoff(fx('handoff-v12-name.md'), at('handoff-v12-name.md')),
    ...scanBrainstorm(fx('brainstorm-ids-heading.md'), at('brainstorm-ids-heading.md')),
    ...scanBrainstorm(fx('brainstorm-ids-dissent.md'), at('brainstorm-ids-dissent.md')),
    ...scanBrainstorm(fx('brainstorm-ids-threads.md'), at('brainstorm-ids-threads.md')),
    ...scanCooler(fx('cooler-ids-name-cue.md'), at('cooler-ids-name-cue.md')),
  ];
  assert.equal(hits.length, 7);
  for (const line of fmt(hits)) {
    assert.match(line, /^tests\/fixtures\/name-drift\/[a-z0-9.-]+\.md:\d+: [A-Za-z:.0-9 -]+$/);
    assert.ok(!hasName(line), 'no roster name in the message');
  }
});

// ---- the cases of the brief, on the fixtures ----

test('a Name: line or an effective name in a dispatch block fails; prose names, Dev dependencies and a plain block pass', () => {
  assert.deepEqual(fmt(scanDispatch(fx('dispatch-name-line.md'), at('dispatch-name-line.md')).hits), [`${at('dispatch-name-line.md')}:9: ${KIND.nameLine}`]);
  assert.deepEqual(fmt(scanDispatch(fx('dispatch-effective-name.md'), at('dispatch-effective-name.md')).hits), [`${at('dispatch-effective-name.md')}:8: ${KIND.nameInBlock}`]);
  const clean = scanDispatch(fx('dispatch-clean.md'), at('dispatch-clean.md'));
  assert.deepEqual(clean.hits, []);
  assert.equal(clean.blocks, 1, 'the Name: block without dispatch keys is not a dispatch block');
});

test('a v1.2 Handoff with By: <Name> fails; an old Handoff with By: <Name> (<role>) and a v1.2 Handoff with a Role id pass', () => {
  assert.deepEqual(fmt(scanDocument(fx('handoff-v12-name.md'), at('handoff-v12-name.md'))), [`${at('handoff-v12-name.md')}:11: ${KIND.by}`]);
  assert.deepEqual(fmt(scanDocument(fx('handoff-v12-named-role.md'), at('handoff-v12-named-role.md'))), [`${at('handoff-v12-named-role.md')}:11: ${KIND.by}`]);
  assert.deepEqual(scanDocument(fx('handoff-old.md'), at('handoff-old.md')), []);
  assert.deepEqual(scanDocument(fx('handoff-v12-ok.md'), at('handoff-v12-ok.md')), [], 'Dev dependencies and a Lead paragraph with names are prose');
});

test('an ids: role brainstorm file fails on a named heading, a named Dissent line or a named Threads line; a v2.1 file with names passes', () => {
  const heading = scanDocument(fx('brainstorm-ids-heading.md'), 'f.md');
  const dissent = scanDocument(fx('brainstorm-ids-dissent.md'), 'f.md');
  const threads = scanDocument(fx('brainstorm-ids-threads.md'), 'f.md');
  assert.deepEqual([kinds(heading), kinds(dissent), kinds(threads)], [[KIND.heading], [KIND.dissent], [KIND.threads]]);
  assert.deepEqual(heading.map(h => h.line), [28]);
  assert.deepEqual(scanDocument(OK_BRAINSTORM, 'f.md'), [], 'names in the Summary and Lead lines are prose');
  const v21 = fx('brainstorm-v21-named.md');
  assert.deepEqual(scanDocument(v21, 'f.md'), []);
  assert.deepEqual(checkBrainstorm(v21, { file: 'f.md' }), [], 'the v2.1 fixture is a valid file');
  assert.ok(scanBrainstorm(v21, 'f.md', { force: true }).length >= 8, 'forced, the named positions are counted as Debt');
});

test('a cooler file with ids: role fails on a named cue; one without ids passes', () => {
  assert.deepEqual(fmt(scanDocument(fx('cooler-ids-name-cue.md'), 'f.md')), [`f.md:26: ${KIND.cue}`]);
  assert.deepEqual(scanDocument(fx('cooler-ids-ok.md'), 'f.md'), []);
  assert.deepEqual(scanDocument(fx('cooler-v1-named.md'), 'f.md'), []);
});

test('fixtures use only roster pseudonyms (proj.S3) and are LF only (proj.M11)', () => {
  const names = readdirSync(FIX).filter(f => f.endsWith('.md'));
  assert.ok(names.length >= 15);
  for (const n of names) {
    const t = fx(n);
    assert.ok(!t.includes('\r'), `${n}: LF`);
    for (const m of t.matchAll(/(?<![\p{L}\p{N}_])(\p{Lu}[\p{L}]*) \(([a-z][a-z0-9-]*)\)/gu)) {
      if (SLUGS.has(m[2])) assert.equal(m[1], ROSTER[m[2]], `${n}: the name of a Role comes from names.json`);
    }
    for (const m of t.matchAll(/^(?:By|Name): (\p{Lu}[\p{L}]*)/gmu)) assert.ok(NAMES.includes(m[1]), `${n}: a name in a byline is a roster name`);
  }
  assert.ok(!readFileSync(fileURLToPath(import.meta.url), 'utf8').includes('\r'), 'this test file is LF');
});

// ---- tree scans and the skip list ----

test('the fixture folder is scanned and never skipped: every drift fixture is a hit, every clean one is not', () => {
  const { hits, scanned } = scanTree(FIX, { label: 'tests/fixtures/name-drift' });
  assert.equal(scanned, readdirSync(FIX).filter(f => f.endsWith('.md')).length, 'every fixture is read');
  assert.deepEqual(hits.map(h => h.file).sort(), ['handoff-v12-name.md', 'handoff-v12-named-role.md', 'brainstorm-ids-heading.md', 'brainstorm-ids-dissent.md', 'brainstorm-ids-threads.md', 'cooler-ids-name-cue.md'].map(at).sort());
  assert.ok(!SKIP_DIRS.some(d => d.startsWith('tests') || at('x').startsWith(d)), 'no skip entry covers the fixtures');
  const d = scanDispatchFiles(readdirSync(FIX).filter(f => f.endsWith('.md')).map(f => ({ abs: join(FIX, f), rel: at(f) })));
  assert.deepEqual(d.hits.map(h => h.file).sort(), [at('dispatch-effective-name.md'), at('dispatch-name-line.md')]);
  assert.equal(d.blocks, 3);
});

test('the skip list is frozen, holds only plain folder names and the archived roadmap', () => {
  assert.ok(Object.isFrozen(SKIP_WORK) && Object.isFrozen(SKIP_DIRS));
  assert.equal(SKIP_WORK.length, 13);
  assert.equal(new Set(SKIP_WORK).size, SKIP_WORK.length);
  for (const f of SKIP_WORK) assert.match(f, /^[a-z0-9][a-z0-9-]*$/);
  assert.deepEqual([...SKIP_DIRS].filter(d => !d.startsWith('work/')), ['archive/roadmap']);
});

const NAMED_HANDOFF = fx('handoff-v12-name.md');
const NAMED_BRAINSTORM = fx('brainstorm-ids-heading.md');

test('a skipped folder is not a failure and is counted as Debt; every other folder is scanned', () => {
  const dir = tmp();
  const c = join(dir, '.company');
  put(c, 'work/v020-gate-roadmap/01-pm.md', NAMED_HANDOFF);
  put(c, 'work/optimize-brainstorm/b.md', NAMED_BRAINSTORM);
  put(c, 'archive/roadmap/b.md', fx('brainstorm-v21-named.md'));
  const r = scanTree(c);
  assert.deepEqual(r.hits, [], 'skipped folders hold no failure');
  const debt = debtCounts(c, r.skipped);
  assert.equal(debt['work/v020-gate-roadmap'].bylines, 1);
  assert.equal(debt['work/optimize-brainstorm'].brainstorm, 1);
  assert.ok(debt['archive/roadmap'].brainstorm >= 8);
  put(c, 'work/research-team/01-pm.md', NAMED_HANDOFF);
  put(c, 'work/new-run/02-architect.md', NAMED_HANDOFF);
  put(c, 'work/v020-gate-roadmap-2/03-qa.md', NAMED_HANDOFF);
  put(c, 'archive/other/b.md', NAMED_BRAINSTORM);
  put(c, 'roadmap/2026-10-29 - idea.md', NAMED_BRAINSTORM);
  put(c, 'brainstorm-input/x.md', NAMED_BRAINSTORM);
  put(c, 'cooler/c.md', fx('cooler-ids-name-cue.md'));
  put(c, 'work/v020-gate-roadmap/sub/deeper/02-qa.md', NAMED_HANDOFF);
  const after = scanTree(c);
  assert.deepEqual(after.hits.map(h => h.file).sort(), [
    '.company/archive/other/b.md', '.company/brainstorm-input/x.md', '.company/cooler/c.md', '.company/roadmap/2026-10-29 - idea.md',
    '.company/work/new-run/02-architect.md', '.company/work/research-team/01-pm.md', '.company/work/v020-gate-roadmap-2/03-qa.md',
  ]);
  assert.equal(debtCounts(c, after.skipped)['work/v020-gate-roadmap'].bylines, 2, 'a nested file of a skipped folder is Debt too');
});

test('a skip entry matches a whole path, not a prefix or a nested folder of the same name', () => {
  const c = join(tmp(), '.company');
  put(c, 'work/goldfish-roles-2/01-pm.md', NAMED_HANDOFF);
  put(c, 'work/x/work/goldfish-roles/01-pm.md', NAMED_HANDOFF);
  put(c, 'archive/roadmap-old/b.md', NAMED_BRAINSTORM);
  put(c, 'goldfish-roles/01-pm.md', NAMED_HANDOFF);
  assert.equal(scanTree(c).hits.length, 4);
});

test('the scan is bounded: a big file that would be scanned is a hit, a big file that would not is skipped, links are not followed', () => {
  const c = join(tmp(), '.company');
  const pad = `${'x'.repeat(99)}\n`.repeat(11000);
  put(c, 'work/a/01-pm.md', `${NAMED_HANDOFF}${pad}`);
  put(c, 'work/b/notes.md', `# Notes\n${pad}`);
  put(c, 'work/c/01-pm.md', `${fx('handoff-v12-ok.md')}${pad}`);
  const r = scanTree(c);
  assert.deepEqual(fmt(r.hits), [`.company/work/a/01-pm.md:1: ${KIND.big}`, `.company/work/c/01-pm.md:1: ${KIND.big}`]);
  const d = tmp();
  put(d, 'real/outside.md', NAMED_HANDOFF);
  mkdirSync(join(d, 'c'));
  let linked = true;
  try { symlinkSync(join(d, 'real'), join(d, 'c', 'link'), 'junction'); } catch { linked = false; }
  if (linked) assert.deepEqual(fmt(scanTree(join(d, 'c')).hits), [`.company/link:1: ${KIND.link}`]);
  const deep = join(tmp(), '.company');
  put(deep, `${Array.from({ length: MAX_DEPTH + 2 }, (_, i) => `d${i}`).join('/')}/01-pm.md`, NAMED_HANDOFF);
  assert.deepEqual(kinds(scanTree(deep).hits), [KIND.deep]);
});

// ---- the real repository ----

const NO_COMPANY = !existsSync(COMPANY) && '.company is absent (CI)';

test('dispatch blocks of skills, agents and the dispatch-prompt Contract hold no Name: line and no name', () => {
  const r = scanDispatchFiles(dispatchFiles(ROOT));
  assert.ok(r.blocks > 0, 'the scan reads real dispatch blocks');
  assert.deepEqual(fmt(r.hits), []);
});

test('the real .company tree holds no name in a scanned position', { skip: NO_COMPANY }, () => {
  const r = scanTree(COMPANY);
  assert.ok(r.scanned > 0, 'files are read');
  assert.deepEqual(fmt(r.hits), []);
});

test('the skip list names exactly the folders of the proj.M14 Debt row', { skip: NO_COMPANY || (!existsSync(join(COMPANY, 'standards.md')) && '.company/standards.md is absent') }, () => {
  const rows = readFileSync(join(COMPANY, 'standards.md'), 'utf8').replace(/\r\n/g, '\n').split('\n').filter(l => l.startsWith('- proj.M14 — .company/work/ folders '));
  assert.equal(rows.length, 1, 'one Debt row lists the work folders');
  const m = /^- proj\.M14 — \.company\/work\/ folders ([a-z0-9-]+(?:, [a-z0-9-]+)*) \(/.exec(rows[0]);
  assert.ok(m, 'the row has the shape "folders a, b, c ("');
  assert.deepEqual(m[1].split(', ').sort(), [...SKIP_WORK].sort());
  assert.ok(rows[0].includes('.company/archive/roadmap/ ('), 'the row lists the archived roadmap folder');
  assert.ok(SKIP_DIRS.includes('archive/roadmap'));
});

test('Debt in skipped folders of the real tree is reported as counts and never fails', { skip: NO_COMPANY }, t => {
  const { skipped } = listTree(COMPANY, SKIP_DIRS);
  const debt = debtCounts(COMPANY, skipped);
  assert.deepEqual(Object.keys(debt).sort(), [...SKIP_DIRS].sort());
  for (const [dir, c] of Object.entries(debt)) t.diagnostic(`debt ${dir}: files=${c.files} bylines=${c.bylines} brainstorm-positions=${c.brainstorm}`);
  const folders = existsSync(join(COMPANY, 'work')) ? readdirSync(join(COMPANY, 'work'), { withFileTypes: true }).filter(e => e.isDirectory() && !SKIP_WORK.includes(e.name)).map(e => e.name) : [];
  t.diagnostic(`scanned work folders: ${folders.join(', ') || 'none'}`);
});
