import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pins how the pipeline skill points at run-state and that the reference names all five write commands.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skill = readFileSync(join(root, 'skills/pipeline/SKILL.md'), 'utf8');
const refPath = join(root, 'skills/pipeline/references/run-state.md');
const SCRIPT = '${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs';

test('SKILL.md points at the reference with exactly one line and stays within 125 lines', () => {
  assert.ok(!skill.includes('\r'));
  assert.ok(skill.split('\n').length - 1 <= 125, 'pipeline skill over 125 lines');
  const lines = skill.split('\n').filter(l => l.includes('references/run-state.md'));
  assert.equal(lines.length, 1);
  assert.ok(/when|once|each/i.test(lines[0]), 'pointer says when to load');
  assert.ok(!/^\s*!/.test(lines[0]), 'no bang command');
  assert.ok(!/allowed-tools/.test(skill));
});

test('reference exists, is LF and names the five commands with the plugin-root script path', () => {
  assert.ok(existsSync(refPath), 'references/run-state.md missing');
  const ref = readFileSync(refPath, 'utf8');
  assert.ok(!ref.includes('\r'));
  for (const c of [
    `node "${SCRIPT}" run-state start '<slug>'`,
    `node "${SCRIPT}" run-state wave '<slug>' '<n>'`,
    `node "${SCRIPT}" run-state gate '<slug>' '<brief|plan|ship>' '<passed|changed|stopped>'`,
    `node "${SCRIPT}" run-state ask '<slug>' '<brief|plan|ship>'`,
    `node "${SCRIPT}" run-state end '<slug>' '<ship|abort>'`,
  ]) assert.ok(ref.includes(c), `missing command: ${c}`);
  assert.ok(!/<plugin root>/.test(ref));
  assert.ok(!/^\s*!/m.test(ref), 'no bang command');
});

test('the pipeline runs ask directly before each Gate form and names five commands', () => {
  assert.ok(/Directly before each Gate form run `run-state.mjs ask /.test(skill));
  assert.ok(skill.includes('five `run-state.mjs` commands (start, wave, ask, gate, end)'));
});

test('reference states when each command runs and that run-state never blocks', () => {
  const ref = readFileSync(refPath, 'utf8');
  for (const n of [/Setup/, /wave/i, /auto/i, /resume/i, /never blocks/i, /never edit/i, /Gate summary/, /directly before/i]) {
    assert.ok(n.test(ref), `missing: ${n}`);
  }
});
