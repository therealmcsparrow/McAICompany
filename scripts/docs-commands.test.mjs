// Pins the plain-language command reference: overview, route table, one entry per new command.
import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { docFolder, commandPage } from './doc-pages.mjs';

const root = path.join(import.meta.dirname, '..');
const text = docFolder(root, 'commands');
const NEW = ['idea', 'bug', 'grilling', 'grill-me', 'grill-with-docs'];
const entry = name => commandPage(root, name);

describe('reference', () => {
  it('has an overview heading, a jargon list and a route table', async () => {
    assert.match(text, /^## In short$/m);
    assert.match(text, /^\*\*Words used on this page\.\*\*$/m);
    for (const w of ['Playbook', 'Role', 'Lead', 'Gate', 'Handoff', 'Slug', 'Context cap', 'Ticket']) {
      assert.ok(text.includes(`- **${w}**`) || text.includes(`**${w}**:`) , w);
    }
    assert.match(text, /^\| You have \| Start with \| What you get \|$/m);
    assert.match(text, /^\*\*What each route does, in words\.\*\*$/m);
  });

  it('has an entry per new command', async () => {
    for (const n of NEW) {
      const e = entry(n);
      assert.match(e, /\*\*Help:\*\*/, n);
      assert.match(e, /\*\*Example\.\*\*/, n);
      assert.ok(e.includes('Only you start this command'), n);
    }
  });

  it('route table names every new command', async () => {
    const rows = text.split('\n').filter(l => l.startsWith('| ') && l.includes('/aico:'));
    for (const n of NEW) assert.ok(rows.some(r => r.includes(`/aico:${n}`)), n);
  });

  it('feature and fix say they keep only the Ship Gate', async () => {
    for (const n of ['feature', 'fix']) {
      const e = entry(n);
      assert.match(e, /keeps only the Ship Gate/, n);
      assert.match(e, /no Brief Gate and no Plan Gate/, n);
      assert.doesNotMatch(e, /→ Plan Gate|→ Brief Gate/, n);
    }
  });

  it('data destinations: grill-me and grill-with-docs never search the web, grilling may', async () => {
    assert.match(entry('grill-me'), /No web search ever/);
    assert.match(entry('grill-with-docs'), /No web search/);
    assert.match(entry('grilling'), /web search queries/);
    assert.match(text, /^\*\*Where your text goes\.\*\*/m);
    assert.match(text, /store none of its text|They store none of its text/);
    assert.doesNotMatch(text, /nothing leaves/i);
  });

  it('context cap is fixed at 95000 and 85500', async () => {
    assert.match(text, /fixed at 95000/);
    assert.ok(text.includes('85500'));
    assert.doesNotMatch(text, /Default 150000/);
  });

  it('LF only', async () => {
    assert.ok(!text.includes('\r'));
  });
});
