import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source of the old qa id `By:` drift: a Role file whose display title does not equal its file name gives the Role no
// id to copy into `By:` and `role:`, so it slugifies the title. Each such file must state `Role id: <file stem>`.

const ROOT = join(import.meta.dirname, '..');
const AGENTS = join(ROOT, 'agents');
const files = readdirSync(AGENTS).filter(f => f.endsWith('.md')).sort();
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const parse = f => {
  const text = readFileSync(join(AGENTS, f), 'utf8').replace(/\r\n/g, '\n');
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  return {
    stem: f.replace(/\.md$/, ''),
    title: (/^# (.+)$/m.exec(body) ?? [])[1] ?? '',
    ids: [...body.matchAll(/^Role id: (\S+)\s*$/gm)].map(m => m[1]),
  };
};

test('the qa Role file states Role id: qa, so By: and role: never become the old id', () => {
  const qa = parse('qa.md');
  assert.deepEqual(qa.ids, ['qa']);
});

test('every Role file whose title slug differs from its file name carries exactly one matching Role id line', () => {
  const missing = [];
  for (const f of files) {
    const a = parse(f);
    assert.ok(a.title, `${f}: has a # title`);
    if (slug(a.title) === a.stem) continue;
    if (a.ids.length !== 1 || a.ids[0] !== a.stem) missing.push(`agents/${f}: title "${a.title}" needs "Role id: ${a.stem}"`);
  }
  assert.deepEqual(missing, []);
});

test('a Role id line, where present, equals the file name and sits before the Mission', () => {
  for (const f of files) {
    const a = parse(f);
    if (!a.ids.length) continue;
    assert.deepEqual(a.ids, [a.stem], `${f}: Role id is the file name`);
    const text = readFileSync(join(AGENTS, f), 'utf8');
    assert.ok(text.indexOf('Role id:') < text.indexOf('**Mission'), `${f}: Role id before Mission`);
  }
});

test('the handoff skill tells a Role its By: is the agent file name', () => {
  const t = readFileSync(join(ROOT, 'skills', 'handoff', 'SKILL.md'), 'utf8');
  assert.match(t, /`By:` is (?:your Role id, )?the agent file name \(e\.g\. `By: qa`\)/);
});
