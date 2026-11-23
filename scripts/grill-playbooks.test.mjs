import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

// Runs scripts/grill.mjs over a file shaped as each grill Playbook writes it.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = ['grill', 'grill-me', 'grill-with-docs'];

const GRILL = (extra) => `---
slug: demo-idea
started: 2026-10-30 14:05
status: done
format: 1
---
## Idea
A small idea.
## Open branches
## Closed branches
- B-1 — who uses it — closed by Q-1
- B-2 — where it lives — closed by ${extra.ref}
## Log
### Q-1 — B-1
- Question: Who uses it?
- Options: The CEO (recommended: the only user so far) | A team
- Answer: The CEO
- Decision: One user
- Opens: B-2
- Closes: B-1
${extra.entry}## Proposals
${extra.proposals}`;

const FIXTURES = {
  grill: {
    ref: 'F-1',
    entry: '### F-1 — B-2\n- Fact: The store is a folder.\n- Source: https://example.com/doc\n- Closes: B-2\n',
    proposals: '- GLOSSARY: idea — a rough thought\n',
  },
  'grill-me': {
    ref: 'Q-2',
    entry: '### Q-2 — B-2\n- Question: Where does it live?\n- Options: A folder (recommended: simplest) | A database\n- Answer: A folder\n- Decision: Folder\n- Opens: none\n- Closes: B-2\n',
    proposals: '',
  },
  'grill-with-docs': {
    ref: 'F-1',
    entry: '### F-1 — B-2\n- Fact: Docs say the store is a folder.\n- Source: docs/spec.md:12\n- Closes: B-2\n',
    proposals: '- GLOSSARY: store — the work folder\n- ADR: Folder store — keep files in .company/work\n',
  },
};

test('each grill playbook writes grill-file v1: grill status accepts its file', () => {
  for (const name of NAMES) {
    const dir = mkdtempSync(join(tmpdir(), 'grill-fix-'));
    try {
      mkdirSync(join(dir, '.company/work/demo-idea'), { recursive: true });
      writeFileSync(join(dir, '.company/work/demo-idea/grill.md'), GRILL(FIXTURES[name]));
      const r = spawnSync(process.execPath, [join(root, 'scripts/grill.mjs'), 'status', 'demo-idea'], { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
      assert.ok(r.stdout.includes('grill: ') && r.stdout.includes('status: done'), name);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
