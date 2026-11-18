// T7 (AC11): no new dependencies, every bumped Contract named on an ADR Contracts: line, check.mjs clean. Green from T15.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = rel => readFileSync(join(root, rel), 'utf8');

test('AC11: plugin.json dependencies stay exactly superpowers@claude-plugins-official', () => {
  assert.deepEqual(JSON.parse(read('.claude-plugin/plugin.json')).dependencies, ['superpowers@claude-plugins-official']);
});

test('AC11: package.json has no dependency keys', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) assert.ok(!(k in pkg), k);
});

test('AC11: every bumped Contract is on a Contracts: line of ADR 0077, 0078 or 0079', () => {
  const lines = ['0077-lead-as-subagent', '0078-ceo-answer-from-hook', '0079-guards-leave-shell-alone']
    .map(n => read(`docs/adr/${n}.md`).split('\n').find(l => l.includes('Contracts:')) || '').join('\n');
  const need = [
    [/`hook-event` v1\.4/, 'hook-event 1.4'],
    [/`context-guard` v3\.0/, 'context-guard 3.0'],
    [/`lead-handoff` v3\.0/, 'lead-handoff 3.0'],
    [/`run-state` v3\.1/, 'run-state 3.1'],
    [/`step-times` v1\.3/, 'step-times 1.3'],
    [/lead-relay\.md` v1/, 'lead-relay 1'],
    [/`mod-hook` v1\.2/, 'mod-hook 1.2'],
    [/`mod-manifest` v1\.1/, 'mod-manifest 1.1'],
    [/retires `lead-session-mcp`/, 'lead-session-mcp retired'],
  ];
  for (const [re, label] of need) assert.match(lines, re, label);
});

test('AC11: node scripts/check.mjs exits 0', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts/check.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
});
