import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './idea-flow.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES = path.join(root, 'skills', 'idea', 'references', 'routes.md');
const LABEL_WORD = /\b(label|labels|option|options)\b/i;
const CODE_WORD = /\b(letter|letters|number|numbers|id|ids|code|codes)\b/gi;
const ORDER_WORD = /\b(first|before|prefix)\b/i;
const BOLD_FIRST = /\*\*[A-Za-z0-9]\*\*\s+[A-Za-z]/;

// Sentences the scan hits that are no option form, by exact path and sentence:
// a new or edited sentence fails closed.
const KNOWN_NON_FORM = [
  ['skills/help/SKILL.md', 'Keep the id from the first line (`company type: <id> (<label>)…`) and the `playbooks:` line (a comma list); list and explain only commands in `playbooks`.'],
  ['skills/brainstorm/references/format-2.md', 'Reply for its Round: and Pass:, one item per line, text in your Language, labels in English, no IDs or bullets before a label: I: <idea> (0–3 lines), Risk: <biggest risk or cost> (exactly 1; optional in pass full), Q [blocking|nice-to-have]: <one sentence> | options: <a> / <b> | default: <a> | why: <reason, 10–120 characters> (0–2 lines, only when the answer changes the plan, never one already under Questions:), Re: @<role> on I-<round>.<n>: agree|challenge|build-on — <at most 25 words> (an ID Input: shows for that Role, never your own).'],
];
const isKnown = (file, sentence) => KNOWN_NON_FORM.some(([f, s]) => f === file && s === sentence);

// Scan: a sentence that puts a letter, number, id or code before an option label.
function scanText(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const s of line.split(/(?<=[.!?])\s+/)) {
      let bad = BOLD_FIRST.test(s);
      if (!bad && LABEL_WORD.test(s)) {
        for (const m of s.matchAll(CODE_WORD)) {
          const win = s.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
          if (ORDER_WORD.test(win)) { bad = true; break; }
        }
      }
      if (bad) hits.push({ line: i + 1, text: s.trim() });
    }
  });
  return hits;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.md') ? [p] : [];
  });
}

const routesText = fs.readFileSync(ROUTES, 'utf8');
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

// route `x`: Label (Recommended). description
function routeLabels() {
  const map = new Map();
  for (const m of routesText.matchAll(/^- route `([a-z-]+)`: ([^.]+)\./gm)) map.set(m[1], m[2].trim());
  return map;
}
const plain = (l) => l.replace(/\s*\(Recommended\)\s*/, '').trim();
const formsRule = () => routesText.slice(routesText.indexOf('## Forms'), routesText.indexOf('## Inline steps'));
const answerRule = () => formsRule().split('\n').find((l) => l.startsWith("- The CEO's answer"));

const flow = (cwd, ...a) => main(a, cwd);
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'form-labels-')); tmps.push(d); return d; };
function opts(cwd, slug) {
  const r = flow(cwd, 'options', slug);
  return r.out.split('\n').filter((l) => l.startsWith('option ')).map((l) => l.split(' ').slice(1));
}
// Drive a fresh flow to the grill (0), routes (1) or tickets (2) form.
function toForm(cwd, depth) {
  flow(cwd, 'start', 's', '--kind', 'idea');
  if (depth >= 1) { flow(cwd, 'pick', 's', '1'); flow(cwd, 'done', 's', 'grilling'); flow(cwd, 'done', 's', 'reprompt'); }
  if (depth >= 2) { flow(cwd, 'pick', 's', 'D'); flow(cwd, 'done', 's', 'to-spec'); flow(cwd, 'done', 's', 'to-tickets'); }
}
const FORMS = [['grill', 0], ['routes', 1], ['tickets', 2]];
// Outside a software company, after Research: the form that holds Stop.
function stopFormOptions() {
  const c = tmp();
  fs.mkdirSync(path.join(c, '.company'), { recursive: true });
  fs.writeFileSync(path.join(c, '.company', 'project.md'), 'company_type: research\n');
  toForm(c, 1);
  flow(c, 'pick', 's', 'C'); flow(c, 'done', 's', 'research'); flow(c, 'done', 's', 'reprompt');
  return opts(c, 's');
}

test('plain labels: scan flags the old sentence, spares a plain one', () => {
  const old = 'Build the form from those lines only, the label from the `route` lines below, the letter first.';
  assert.ok(scanText(old).length > 0);
  assert.equal(scanText('Put the recommended one first.').length, 0);
});

test('plain labels: an exception needs the exact path and the exact sentence', () => {
  for (const [file, sentence] of KNOWN_NON_FORM) {
    assert.deepEqual(scanText(sentence).map((h) => h.text), [sentence], file);
    assert.ok(isKnown(file, sentence), file);
    assert.ok(!isKnown('skills/idea/references/routes.md', sentence), file);
    assert.ok(!isKnown(file, `${sentence} `), file);
    assert.ok(!isKnown(file, sentence.replace(/.$/, ', the letter first.')), file);
  }
});

test('plain labels: a far order word stays out of the window', () => {
  assert.equal(scanText('Each option id goes to the record file, and the ticket plan on disk is read first.').length, 0);
});

test('plain labels: scan still flags a code-first rule beside a code span or a forbidden code', () => {
  assert.ok(scanText('Each label comes from the `route` line, the number first.').length > 0);
  assert.ok(scanText('Show no bullets, each label with its id before it.').length > 0);
  assert.ok(scanText('**A** water cooler').length > 0);
});

test('plain labels: scan flags a rule word inside a code span or after "no"', () => {
  assert.ok(scanText('Put `<letter>` first in each option label.').length > 0);
  assert.ok(scanText('Build each `label` from the route line, the letter first.').length > 0);
  assert.ok(scanText('A label with no letter first is refused.').length > 0);
});

test('plain labels: no form rule in skills/ puts a code before a label (all hits listed)', () => {
  const all = [];
  const seen = new Set();
  for (const f of walk(path.join(root, 'skills'))) {
    for (const h of scanText(fs.readFileSync(f, 'utf8'))) {
      if (isKnown(rel(f), h.text)) seen.add(`${rel(f)} ${h.text}`);
      else all.push(`${rel(f)}:${h.line} ${h.text}`);
    }
  }
  assert.deepEqual(all, [], `scan hits:\n${all.join('\n')}`);
  assert.equal(seen.size, KNOWN_NON_FORM.length, 'an exception no longer matches its sentence');
});

test('plain labels: route lines hold the words alone (AC1, AC2)', () => {
  const labels = routeLabels();
  assert.ok(labels.size >= 11);
  for (const [r, l] of labels) assert.match(plain(l), /^[A-Z][a-z]/, `${r}: ${l}`);
});

test('plain labels: tickets and approval labels (AC3)', () => {
  const labels = routeLabels();
  assert.equal(plain(labels.get('build')), 'Build');
  assert.equal(plain(labels.get('park-roadmap')), 'Park all tickets');
  for (const w of ['Approve (Recommended) / Change', 'Approve (Recommended) / Park / Change']) assert.ok(routesText.includes(w), w);
});

test('plain labels: labels in each form are distinct, Stop and Park the idea included (AC7)', () => {
  const labels = routeLabels();
  const forms = { stopForm: stopFormOptions() };
  assert.deepEqual(forms.stopForm.map(([, r]) => r), ['park-idea', 'stop']);
  for (const [name, depth] of FORMS) { const c = tmp(); toForm(c, depth); forms[name] = opts(c, 's'); }
  for (const [name, list] of Object.entries(forms)) {
    const ls = list.map(([, r]) => { assert.ok(labels.has(r), `${name}: no label for ${r}`); return plain(labels.get(r)); });
    assert.equal(new Set(ls).size, ls.length, `${name}: ${ls.join(', ')}`);
  }
});

test('plain labels: the Forms rule states one marked option, first (AC8)', () => {
  assert.match(formsRule(), /exactly one[^.]*\(Recommended\)[^.]*first/i);
});

test('plain labels: the Forms rule says what a label holds and where the letter is used', () => {
  const f = formsRule();
  assert.match(f, /route's words alone/);
  assert.match(f, /only in `pick`/);
});

test('plain labels: a route line holds no Lead note, the notes stay in Forms', () => {
  const lines = formsRule().split('\n').filter((l) => l.startsWith('- route `'));
  assert.ok(lines.length >= 11);
  for (const l of lines) assert.doesNotMatch(l, /`pick`|→|the script|Offered only|a pick of it/i, l);
  const notes = formsRule().split('\n').find((l) => l.startsWith('Lead notes'));
  assert.ok(notes);
  assert.match(notes, /Offered only in a software company/);
  assert.match(notes, /Stop → `pick` its letter/);
});

test('pick mapping: label to route to letter runs the one letter (AC5)', () => {
  const labels = routeLabels();
  for (const [name, depth] of FORMS) {
    const c0 = tmp(); toForm(c0, depth);
    const list = opts(c0, 's');
    assert.ok(list.length >= 2, name);
    for (const [letter, route] of list) {
      const label = plain(labels.get(route));
      const c = tmp(); toForm(c, depth);
      const hits = opts(c, 's').filter(([, r]) => plain(labels.get(r)) === label);
      assert.equal(hits.length, 1, `${name} ${label}`);
      assert.equal(flow(c, 'pick', 's', hits[0][0]).out.trim(), `picked ${letter} ${route}`, `${name} ${label}`);
    }
  }
});

test('pick mapping: the Forms rule maps a label, and Other or an unshown label asks again (AC6)', () => {
  const f = formsRule();
  assert.match(f, /answer is a label/i);
  assert.match(f, /"Other" text[^.]*no pick[^.]*ask again/i);
  assert.match(f, /a label not in the open form/);
  assert.doesNotMatch(f, /another form/);
  assert.match(f, /not an allowed pick/);
});

test('pick mapping: the whole answer must equal one shown label, marker removed', () => {
  const a = answerRule();
  assert.match(a, /whole answer[^.]*recommended marker removed[^.]*exactly equal to a shown label/i);
  assert.doesNotMatch(a, /\(Recommended\)/);
});

test('pick mapping: an answer that matches two labels asks again with distinct labels', () => {
  assert.match(answerRule(), /matches two labels is no pick: make them distinct and ask again/);
});

test('pick mapping: a label or Other text is never an allowed pick of the open form (AC6)', () => {
  const c = tmp();
  toForm(c, 0);
  for (const bad of ['Grill me', 'Other', 'Build', 'F', 'A']) assert.equal(flow(c, 'pick', 's', bad).code, 3, bad);
});
