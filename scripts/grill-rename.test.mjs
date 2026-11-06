import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// End-state tests for scope (d) of the skill audit run: the old aico:grill skill is removed and aico:grilling is
// renamed to aico:grill. The command /aico:grilling stops existing; skills/grilling and its references/grill-loop.md
// move to skills/grill. Historic CHANGELOG entries stay. Each test fails on base commit 8df1228.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const exists = (p) => existsSync(join(root, p));

const LOOP_NEW = '${CLAUDE_PLUGIN_ROOT}/skills/grill/references/grill-loop.md';
const WEB_NOTICE = '- Web search: yes, because the idea and the CEO\'s answers may become web search queries sent to the web search tool. Keep a query to the fact needed; put no personal data in one.';
// A leftover reference to the old name: the skill id, a path, the command or the Playbook title.
const OLD_NAME = /aico:grilling|\/aico:grilling|skills\/grilling|commands\/grilling|name: grilling|Playbook: grilling|`grilling`|\bgrilling\.md/;

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    if (name === 'node_modules' || name === '.git') continue;
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out); else out.push(rel);
  }
  return out;
}

test('skills/grilling is gone', () => {
  assert.ok(!exists('skills/grilling'), 'skills/grilling still exists');
  assert.ok(!exists('skills/grilling/SKILL.md'));
  assert.ok(!exists('skills/grilling/references/grill-loop.md'));
});

test('skills/grill holds today\'s grilling Playbook, including the web search notice', () => {
  const t = read('skills/grill/SKILL.md');
  assert.match(t, /^name: grill$/m);
  assert.ok(t.includes('# Playbook: grill\n'));
  assert.ok(t.includes('Facts the repo or the web can answer are looked up, the rest is asked.'), 'description of the lookup grill');
  assert.ok(t.includes(WEB_NOTICE), 'web search notice');
  assert.ok(t.includes('## 2. Answer source'));
  assert.ok(t.includes('Mode `lookup`'));
  assert.ok(t.includes('- aico:grill-me never searches; aico:grill-with-docs reads repo docs only.'));
  assert.ok(t.includes(`Read \`${LOOP_NEW}\` now.`));
  assert.ok(t.includes('follow it with mode `lookup`'));
  assert.ok(t.includes('`documentation/commands/grill.md`'), 'Help line');
  assert.ok(t.includes('company-type check-playbook grill`'), 'type check names grill');
  assert.ok(t.includes('draft-input arg --for grill'));
  assert.ok(t.includes('.company/work-folder-topic-grill.txt'));
  assert.ok(!OLD_NAME.test(t), `old name left: ${t.match(OLD_NAME)?.[0]}`);
});

test('skills/grill holds the moved loop file', () => {
  assert.ok(exists('skills/grill/references/grill-loop.md'), 'loop file moved');
  const t = read('skills/grill/references/grill-loop.md');
  assert.ok(t.startsWith('# Grill loop (shared by aico:grill, aico:grill-me, aico:grill-with-docs)'));
  assert.ok(t.includes('- `lookup` (aico:grill):'));
  assert.ok(t.includes('- `ask-all` (aico:grill-me)'));
  assert.ok(t.includes('- `docs` (aico:grill-with-docs)'));
  assert.ok(t.includes('draft-input arg --for grill'));
  assert.ok(!OLD_NAME.test(t), `old name left: ${t.match(OLD_NAME)?.[0]}`);
});

test('grill-me and grill-with-docs read the moved loop file', () => {
  for (const [n, mode] of [['grill-me', 'ask-all'], ['grill-with-docs', 'docs']]) {
    const t = read(`skills/${n}/SKILL.md`);
    assert.ok(t.includes(`Read \`${LOOP_NEW}\` now.`), n);
    assert.ok(t.includes(`follow it with mode \`${mode}\``), n);
    assert.ok(!t.includes('skills/grilling'), n);
    assert.ok(!OLD_NAME.test(t), `${n}: ${t.match(OLD_NAME)?.[0]}`);
  }
});

test('idea and bug route to grill, not grilling', () => {
  const routes = read('skills/idea/references/routes.md');
  assert.ok(/^- route `grill`: /m.test(routes), 'route grill');
  assert.ok(/^- step `grill`: skill `grill`; stop at `## 4. End form`$/m.test(routes), 'step grill runs skill grill');
  assert.ok(!/grilling/i.test(routes), 'routes.md still says grilling');
  for (const f of ['skills/idea/SKILL.md', 'skills/bug/SKILL.md']) {
    const t = read(f);
    assert.ok(t.includes('grill-me') && t.includes('grill-with-docs'), `${f} names the other grills`);
    assert.ok(!/grilling/i.test(t), `${f} still says grilling`);
  }
});

test('flow scripts, check and Lead name grill, not grilling', () => {
  for (const f of ['scripts/idea-flow.mjs', 'scripts/lead-handover.mjs', 'scripts/check.mjs', 'scripts/company-type.mjs', 'skills/lead/SKILL.md']) {
    assert.ok(!/grilling/.test(read(f)), `${f} still says grilling`);
  }
});

test('company types list grill once and no grilling', () => {
  for (const id of ['software', 'research', 'marketing', 'design']) {
    const m = JSON.parse(read(`company/types/${id}.json`));
    const n = m.playbooks.filter((p) => p === 'grill').length;
    assert.equal(n, 1, `${id}: grill listed ${n} times`);
    assert.ok(!m.playbooks.includes('grilling'), `${id}: grilling listed`);
    assert.ok(m.playbooks.includes('grill-me') && m.playbooks.includes('grill-with-docs'), id);
  }
});

test('docs name no live /aico:grilling outside the CHANGELOG', () => {
  assert.ok(!exists('documentation/commands/grilling.md'), 'command page grilling.md still exists');
  const files = ['README.md', ...walk('documentation'), ...walk('docs'), ...walk('skills')].filter((f) => f.endsWith('.md'));
  const hits = files.filter((f) => read(f).includes('/aico:grilling'));
  assert.deepEqual(hits, [], `live /aico:grilling in ${hits.join(', ')}`);
  const page = read('documentation/commands/grill.md');
  assert.ok(page.startsWith('# `/aico:grill`\n'));
  assert.ok(/web search queries/.test(page), 'command page keeps the web search notice');
  assert.ok(page.includes('Facts the repo or the web can answer are looked up'), 'command page describes the lookup grill');
  for (const n of ['grill-me', 'grill-with-docs']) {
    const t = read(`documentation/commands/${n}.md`);
    assert.ok(t.includes('[`/aico:grill`](grill.md)'), `${n}.md links the moved page`);
    assert.ok(!/grilling\.md/.test(t), n);
  }
  assert.ok(read('CHANGELOG.md').includes('/aico:grilling'), 'historic CHANGELOG entry stays');
});
