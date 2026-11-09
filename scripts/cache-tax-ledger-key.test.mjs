// Cache Tax stamps the ledger file named by runKey(slug), so a v3 run's growing ledger refreshes the pane.
// mods/test/cache-tax.test.tsx needs the plugin harness; this pins the path in plain node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runKey } from '../mods/lib/work-folder.mjs';

const src = readFileSync(new URL('../mods/cache-tax.tsx', import.meta.url), 'utf8');

test('runKey maps a v3 slug to the flat ledger file key', () => {
  assert.equal(runKey('P20261109.000009/15-fix'), 'P20261109.000009~15-fix');
  assert.equal(runKey('2026-11-09 10.00 - Thing'), '2026-11-09 10.00 - Thing');
});

test('cache-tax stamps .company/ledger/<runKey(slug)>.jsonl, never the raw slug', () => {
  assert.match(src, /import \{[^}]*\brunKey\b[^}]*\} from '\.\/lib\/work-folder\.mjs'/);
  assert.match(src, /stamp\(\$, `\$\{root\}\/\.company\/ledger\/\$\{runKey\(slug\) \?\? slug\}\.jsonl`\)/);
  assert.doesNotMatch(src, /ledger\/\$\{slug\}\.jsonl/);
});
