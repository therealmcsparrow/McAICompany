import test from 'node:test';
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
      if (bad) hits.push({ line: i + 1, text: s.trim().slice(0, 120) });
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

const flow = (cwd, ...a) => main(a, cwd);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'form-labels-'));
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

test('plain labels: scan flags the old sentence, spares a plain one', () => {
  const old = 'Build the form from those lines only, the label from the `route` lines below, the letter first.';
  assert.ok(scanText(old).length > 0);
  assert.equal(scanText('Put the recommended one first.').length, 0);
});

test('plain labels: no form rule in skills/ puts a code before a label (T1, all hits listed)', () => {
  const all = [];
  for (const f of walk(path.join(root, 'skills'))) {
    for (const h of scanText(fs.readFileSync(f, 'utf8'))) all.push(`${rel(f)}:${h.line} ${h.text}`);
  }
  assert.deepEqual(all, [], `scan hits:\n${all.join('\n')}`);
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
  for (const w of ['Approve', 'Change', 'Park']) assert.ok(routesText.includes(w), w);
});

test('plain labels: labels in each form are distinct, Stop and Park the idea included (AC7)', () => {
  const labels = routeLabels();
  const forms = { stopForm: [['E', 'park-idea'], ['S', 'stop']] };
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
  assert.match(f, /\(Recommended\)[^.]*removed|removed[^.]*\(Recommended\)/i);
  assert.match(f, /"Other" text[^.]*no pick[^.]*ask again/i);
  assert.match(f, /another form[^.]*no letter/i);
  assert.match(f, /not an allowed pick/);
});

test('pick mapping: a label or Other text is never an allowed pick of the open form (AC6)', () => {
  const c = tmp();
  toForm(c, 0);
  for (const bad of ['Grill me', 'Other', 'Build', 'F', 'A']) assert.equal(flow(c, 'pick', 's', bad).code, 3, bad);
});
