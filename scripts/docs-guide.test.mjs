// Pins the plain-language guide, concepts, getting-started, README and GLOSSARY for the idea flow (T16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const FILES = ['documentation/idea-to-ship.md', 'documentation/concepts.md', 'documentation/getting-started.md', 'README.md', 'GLOSSARY.md'];

test('guide has overview, one route table, a section per step', () => {
  const g = read('documentation/idea-to-ship.md');
  assert.match(g, /^## Overview$/m);
  assert.match(g, /^## The route$/m);
  const tableRows = g.split('\n').filter(l => /^\|---/.test(l));
  assert.equal(tableRows.length, 1, 'exactly one table');
  for (const l of 'ABCDEFG') assert.match(g, new RegExp(`^\\| ${l} \\|`, 'm'), `route ${l}`);
  for (let i = 1; i <= 8; i++) assert.match(g, new RegExp(`^## Step ${i}: `, 'm'), `step ${i}`);
  assert.match(g, /`\/aico:feature`/);
  assert.match(g, /`\/aico:fix`/);
  assert.match(g, /no Brief Gate and no Plan Gate/);
  assert.match(g, /Only the Ship Gate is left/);
});

test('cap text reads 95000 and 85500 everywhere, no old cap', () => {
  for (const f of ['documentation/concepts.md', 'GLOSSARY.md', 'README.md', 'documentation/getting-started.md']) {
    const t = read(f);
    assert.ok(t.includes('95000'), `${f} 95000`);
    assert.ok(t.includes('85500'), `${f} 85500`);
    assert.doesNotMatch(t, /150000|150k|120000/, `${f} old cap`);
  }
});

test('getting-started pins the one-time setup name and value', () => {
  const t = read('documentation/getting-started.md');
  assert.match(t, /^## One-time setup: the compaction point$/m);
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
  const c = read('documentation/concepts.md');
  const sec = c.split('## Where your words go')[1].split('\n## ')[0];
  for (const s of ['Claude model', 'web search tool', '/aico:grill-me', '/aico:grill-with-docs', '.company/work/<slug>/', '.company/draft-input-arg-', '.company/ideas/<name>/', '.company/roadmap/', 'token counts', 'aico writes no ignore rule'])
    assert.ok(sec.includes(s), s);
  assert.match(sec, /Nothing in the idea flow is pushed or published/);
  for (const f of FILES) assert.doesNotMatch(read(f), /nothing leaves/i, f);
});

test('concepts and README keep the Ship-Gate-only wording', () => {
  assert.match(read('documentation/concepts.md'), /keep only the Ship Gate/);
  assert.match(read('README.md'), /keep only the Ship Gate/);
  assert.match(read('documentation/getting-started.md'), /no Brief Gate and no Plan Gate/);
});

test('files are LF only', () => {
  for (const f of [...FILES, 'scripts/docs-guide.test.mjs']) assert.ok(!read(f).includes('\r'), f);
});
