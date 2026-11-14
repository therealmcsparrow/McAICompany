// Pins the user docs for the five guards, AICO_GUARDS=off, the cap range and the mods commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { docPage, docFolder } from './doc-pages.mjs';

const root = path.join(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const README = read('README.md');
const ALL = [README, read('GLOSSARY.md'), ...['start', 'concepts', 'commands', 'mods'].map(f => docFolder(root, f))].join('\n');
const SETUP = docPage(root, 'start/setup.md');
const SETTINGS = docPage(root, 'commands/settings.md');
const BUDGET = docPage(root, 'concepts/context-budget.md');

test('AICO_GUARDS=off is named in setup, for the Lead session only', () => {
  assert.ok(SETUP.includes('AICO_GUARDS=off'));
  const line = SETUP.split('\n').find(l => l.includes('AICO_GUARDS=off'));
  assert.match(line, /Lead/, 'says it is the Lead only');
  assert.match(SETUP, /Step[^\n]*(always guarded|ignore)|(always guarded|ignore)[^\n]*Step/i, 'Steps stay guarded');
});

test('AICO_CONTEXT_GUARD is retired from every user doc', () => {
  assert.doesNotMatch(ALL, /AICO_CONTEXT_GUARD/);
});

test('cap range is 60000 to 250000 at user level only; no 1000000, no per-run freeze', () => {
  for (const [n, t] of Object.entries({ SETTINGS, BUDGET, SETUP })) {
    assert.match(t, /60000 to 250000/, n);
    assert.doesNotMatch(t, /1000000/, n);
    assert.doesNotMatch(t, /frozen (when|at the start of) (the|a) run/i, n);
  }
  assert.match(SETTINGS, /user level|user-level|user file/i);
  assert.match(SETTINGS, /project[^\n]*(ignored|cannot set|can't set|not read)|(ignored|cannot set|can't set)[^\n]*project/i);
  assert.doesNotMatch(read('GLOSSARY.md'), /60000 to 1000000/);
  assert.doesNotMatch(README, /1000000/);
});

test('the five guards are named with their rule names', () => {
  const pages = [README, BUDGET, SETUP].join('\n');
  for (const g of ['cap', 'git add', '.env', 'model floor', 'self-protect']) assert.ok(new RegExp(g.replace(/[.]/g, '\.').replace(' ', '[ -]'), 'i').test(pages), `guard ${g}`);
  assert.match(pages, /five guards/i);
});

test('/aico-mods and /aico-savings are documented', () => {
  assert.ok(ALL.includes('/aico-mods'));
  assert.ok(ALL.includes('/aico-savings'));
  assert.match(README, /\/aico-savings|\/aico-mods/, 'README points to them');
});

test('files are LF only', () => {
  for (const f of ['scripts/docs-guards.test.mjs', 'scripts/docs-commands.test.mjs']) assert.ok(!read(f).includes('\r'), f);
});
