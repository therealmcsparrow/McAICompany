import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pins that the Lead, triage and run-state texts tell the Lead to write stage and intake records.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');
const ref = read('skills/pipeline/references/run-state.md');
const lead = read('skills/lead/SKILL.md');
const triage = read('skills/triage/SKILL.md');
const SCRIPT = '${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs';

test('run-state reference names run-stage set with every stage and when to write it', () => {
  assert.ok(ref.includes(`node "${SCRIPT}" run-stage set '<slug>' '<brief|plan|build|review|ship-gate>'`));
  assert.match(ref, /run-stage set[^\n]*\n[\s\S]*\bbuild\b/);
  assert.match(ref, /never blocks/i);
});

test('lead text writes stage records and intake records through the scripts', () => {
  assert.ok(/run-stage set/.test(lead));
  assert.ok(lead.includes(`node "${SCRIPT}" intake`));
  assert.ok(/intake set/.test(lead));
  assert.ok(/intake list --json/.test(lead));
  assert.ok(/needs-info/.test(lead));
});

test('topic rule: the subject, never a person, client or company', () => {
  for (const [name, text] of [['lead', lead], ['triage', triage]]) {
    assert.match(text, /Topic/, name);
    assert.match(text, /never a person, client or company/, name);
  }
});

test('id rule: the id stays in the session context and intake.jsonl only', () => {
  for (const [name, text] of [['lead', lead], ['triage', triage]]) {
    assert.match(text, /intake\.jsonl/, name);
    assert.match(text, /never (in|into|written to) a (file|Handoff)/i, name);
  }
});

test('triage writes intake add; lead finds a held request by exact Topic', () => {
  assert.ok(triage.includes(`node "${SCRIPT}" intake add`));
  assert.match(lead, /exact(ly)? (the )?Topic|Topic[^.\n]*exact/i);
  assert.match(lead, /no match[^.\n]*intake add|new `intake add`/i);
});

test('skill files stay LF and within 125 lines', () => {
  for (const t of [lead, triage, ref]) assert.ok(!t.includes('\r'));
  for (const t of [lead, triage]) assert.ok(t.split('\n').length - 1 <= 125);
});
