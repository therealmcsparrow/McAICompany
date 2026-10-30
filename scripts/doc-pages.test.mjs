import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docPage, docFolder, commandPage } from './doc-pages.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aico-docs-'));
  mkdirSync(join(root, 'documentation', 'commands'), { recursive: true });
  for (const [f, t] of Object.entries({ 'b.md': 'B', 'README.md': 'R', 'a.md': 'A', 'x.txt': 'no' }))
    writeFileSync(join(root, 'documentation', 'commands', f), t);
  return root;
}

test('docPage and commandPage read one page', () => {
  const root = fixture();
  try {
    assert.equal(docPage(root, 'commands/a.md'), 'A');
    assert.equal(commandPage(root, 'b'), 'B');
    assert.throws(() => commandPage(root, 'nope'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('docFolder puts README.md first, sorts the rest and skips non-markdown', () => {
  const root = fixture();
  try { assert.equal(docFolder(root, 'commands'), 'R\nA\nB'); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
