// Pins the plain-language guide, concepts, getting-started, README and GLOSSARY for the idea flow (T16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { docPage, docFolder } from './doc-pages.mjs';

const root = path.join(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const START = docFolder(root, 'start');
const CONCEPTS = docFolder(root, 'concepts');
const FILES = ['documentation/start/idea-to-ship.md', 'documentation/start/getting-started.md', 'documentation/start/setup.md', 'README.md', 'GLOSSARY.md'];
const CONCEPT_FILES = fs.readdirSync(path.join(root, 'documentation/concepts')).filter(f => f.endsWith('.md')).map(f => 'documentation/concepts/' + f);

test('guide has overview, one route table, a section per step', () => {
  const g = read('documentation/start/idea-to-ship.md');
  assert.match(g, /^## In short$/m);
  assert.match(g, /^### The route$/m);
  const tableRows = g.split('\n').filter(l => /^\|---/.test(l));
  assert.equal(tableRows.length, 1, 'exactly one table');
  for (const r of ['Water cooler', 'Brainstorm', 'Research', 'Spec and tickets', 'Park the idea', 'Build', 'Park all tickets']) assert.match(g, new RegExp(`^\| ${r} \|`, 'm'), `route ${r}`);
  for (let i = 1; i <= 8; i++) assert.match(g, new RegExp(`^### Step ${i}: `, 'm'), `step ${i}`);
  assert.match(g, /`\/aico:feature`/);
  assert.match(g, /`\/aico:fix`/);
  assert.match(g, /no Brief Gate and no Plan Gate/);
  assert.match(g, /Only the Ship Gate is left/);
});

test('cap text reads 95000 and 85500 in every place, no old cap', () => {
  const groups = { 'documentation/start': START, 'documentation/concepts': CONCEPTS, 'GLOSSARY.md': read('GLOSSARY.md'), 'README.md': read('README.md') };
  for (const [f, t] of Object.entries(groups)) {
    assert.ok(t.includes('95000'), `${f} 95000`);
    assert.ok(t.includes('85500'), `${f} 85500`);
  }
  for (const f of [...FILES, ...CONCEPT_FILES]) assert.doesNotMatch(read(f), /150000|150k|120000/, `${f} old cap`);
});

test('setup page pins the one-time setup name and value', () => {
  const t = read('documentation/start/setup.md');
  assert.match(t, /^# One-time setup: the compaction point$/m);
  assert.ok(t.includes('"CLAUDE_CODE_AUTO_COMPACT_WINDOW": "98500"'));
  assert.ok(t.includes('~/.claude/settings.json'));
  assert.match(t, /`env` block/);
  assert.match(t, /Restart Claude Code/);
});

test('GLOSSARY has Idea flow, Ticket approval, Lead Handoff', () => {
  const t = read('GLOSSARY.md');
  for (const term of ['Idea flow', 'Ticket approval', 'Lead Handoff']) assert.ok(t.includes(`**${term}** — `), term);
});

test('data destinations are named and no nothing-leaves claim', () => {
  const sec = docPage(root, 'concepts/where-your-words-go.md');
  for (const s of ['Claude model', 'web search tool', '/aico:grill-me', '/aico:grill-with-docs', '.company/work/<slug>/', '.company/draft-input-arg-', '.company/ideas/<name>/', '.company/roadmap/', 'token counts', 'aico writes no ignore rule'])
    assert.ok(sec.includes(s), s);
  assert.match(sec, /Nothing in the idea flow is pushed or published/);
  for (const f of FILES) assert.doesNotMatch(read(f), /nothing leaves/i, f);
});

test('concepts and README keep the Ship-Gate-only wording', () => {
  assert.match(CONCEPTS, /keep only the Ship Gate/);
  assert.match(read('README.md'), /keep only the Ship Gate/);
  assert.match(read('documentation/start/getting-started.md'), /no Brief Gate and no Plan Gate/);
});

test('files are LF only', () => {
  for (const f of [...FILES, ...CONCEPT_FILES, 'scripts/docs-guide.test.mjs']) assert.ok(!read(f).includes('\r'), f);
});
