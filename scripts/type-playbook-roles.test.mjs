import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Naming rule (docs/contracts/company-type.md, "How consumers use it"): in a Playbook's SKILL.md and
// references, `aico:<role>` names a Role in the roles of every manifest listing the Playbook, and
// `aico:<name>` names a Playbook in ALWAYS or in the playbooks of every such manifest.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const ALWAYS = ['help', 'version', 'language', 'settings', 'setup', 'lead', 'triage', 'skillspector'];

const manifests = readdirSync(join(root, 'company', 'types')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(read(`company/types/${f}`)));
const agents = new Set(readdirSync(join(root, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
const isPlaybook = (n) => existsSync(join(root, 'skills', n, 'SKILL.md'))
  && /^disable-model-invocation:\s*true\s*$/m.test(read(`skills/${n}/SKILL.md`));

function files(playbook) {
  const dir = join(root, 'skills', playbook, 'references');
  const refs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => `skills/${playbook}/references/${f}`) : [];
  return [`skills/${playbook}/SKILL.md`, ...refs];
}

test('every manifest lists only Playbooks that exist', () => {
  for (const m of manifests) for (const p of m.playbooks) assert.ok(isPlaybook(p), `${m.id}: ${p} is not a Playbook`);
});

for (const m of manifests) {
  for (const playbook of m.playbooks) {
    test(`${m.id}: ${playbook} names only Roles and Playbooks of the type`, () => {
      const listing = manifests.filter((x) => x.playbooks.includes(playbook));
      for (const f of files(playbook)) {
        for (const [, name] of read(f).matchAll(/aico:([a-z][a-z0-9-]*)/g)) {
          if (agents.has(name)) {
            for (const x of listing) assert.ok(x.roles.includes(name), `${f}: aico:${name} is not a Role of ${x.id}`);
          } else if (isPlaybook(name) || ALWAYS.includes(name)) {
            if (ALWAYS.includes(name)) continue;
            for (const x of listing) assert.ok(x.playbooks.includes(name), `${f}: aico:${name} is not a Playbook of ${x.id}`);
          }
        }
      }
    });
  }
}

test('every manifest work list names Playbooks of that manifest', () => {
  for (const m of manifests) for (const w of m.work ?? []) assert.ok(m.playbooks.includes(w), `${m.id}: work ${w}`);
});
