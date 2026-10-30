import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Naming rule (docs/contracts/company-type.md, "How consumers use it"): in a Playbook's SKILL.md and
// references, `aico:<role>` names a Role in the roles of every manifest listing the Playbook, and
// `aico:<name>` names a Playbook in ALWAYS or in the playbooks of every such manifest. Gated name: on a line
// holding the exact text (gated: `playbooks:` lists <name>), `aico:<name>` may name a Playbook that some of
// those manifests lack.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const ALWAYS = ['help', 'version', 'language', 'settings', 'setup', 'lead', 'triage', 'skillspector'];

const manifests = readdirSync(join(root, 'company', 'types')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(read(`company/types/${f}`)));
const agents = new Set(readdirSync(join(root, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
const isPlaybook = (n) => existsSync(join(root, 'skills', n, 'SKILL.md'))
  && /^argument-hint:[ \t]*\S/m.test(read(`skills/${n}/SKILL.md`));

const gatedExempt = (line, name) => /^[a-z][a-z0-9-]*$/.test(name)
  && line.includes('(gated: `playbooks:` lists ' + name + ')');

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
        for (const line of read(f).split('\n')) for (const [, name] of line.matchAll(/aico:([a-z][a-z0-9-]*)/g)) {
          if (agents.has(name)) {
            for (const x of listing) assert.ok(x.roles.includes(name), `${f}: aico:${name} is not a Role of ${x.id}`);
          } else if (isPlaybook(name) || ALWAYS.includes(name)) {
            if (ALWAYS.includes(name) || gatedExempt(line, name)) continue;
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

test('gated name: only the exact line text exempts, and only the name it holds', () => {
  const marker = (name) => '(gated: `playbooks:` lists ' + name + ')';
  assert.ok(gatedExempt('1. Told command /aico:to-spec x. ' + marker('to-spec') + ' Print it.', 'to-spec'));
  assert.ok(!gatedExempt('1. aico:to-spec ' + marker('feature'), 'to-spec'), 'another name');
  assert.ok(!gatedExempt('aico:to-spec (gated: playbooks: lists to-spec)', 'to-spec'), 'no backticks');
  assert.ok(!gatedExempt('aico:to-spec (Gated: `playbooks:` lists to-spec)', 'to-spec'), 'case');
  assert.ok(!gatedExempt('aico:to-spec (gated: `playbooks:` lists to-spec', 'to-spec'), 'no closing paren');
  assert.ok(!gatedExempt('aico:to-spec (gated: `playbooks:`  lists to-spec)', 'to-spec'), 'extra space');
  assert.ok(!gatedExempt('aico:__proto__ ' + marker('__proto__'), '__proto__'), 'not a slug');
  assert.ok(!gatedExempt('aico:to-spec', 'to-spec'), 'no marker');
});

test('gated names are Playbooks that exist, never a Role', () => {
  for (const m of manifests) for (const playbook of m.playbooks) for (const f of files(playbook)) {
    for (const line of read(f).split('\n')) for (const [, name] of line.matchAll(/aico:([a-z][a-z0-9-]*)/g)) {
      if (gatedExempt(line, name)) assert.ok(isPlaybook(name) && !agents.has(name), `${f}: gated aico:${name}`);
    }
  }
});
