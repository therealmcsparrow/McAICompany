import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Manifest checks: every listed Playbook exists and every work entry is a listed Playbook.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const manifests = readdirSync(join(root, 'company', 'types')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(read(`company/types/${f}`)));
const isPlaybook = (n) => existsSync(join(root, 'skills', n, 'SKILL.md'));

test('every manifest lists only Playbooks that exist', () => {
  for (const m of manifests) for (const p of m.playbooks) assert.ok(isPlaybook(p), `${m.id}: ${p} is not a Playbook`);
});

test('every manifest work list names Playbooks of that manifest', () => {
  for (const m of manifests) for (const w of m.work ?? []) assert.ok(m.playbooks.includes(w), `${m.id}: work ${w}`);
});
