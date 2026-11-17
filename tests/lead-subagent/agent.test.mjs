import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = rel => readFileSync(join(root, rel), 'utf8');
const AGENT = 'agents/project-manager.md';

function parse() {
  assert.ok(existsSync(join(root, AGENT)), `${AGENT} exists`);
  const text = read(AGENT);
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, 'frontmatter');
  const fm = Object.fromEntries(m[1].split('\n').map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
  return { text, fm, body: m[2] };
}

test('lead agent: name, description, model, effort and at most 50 lines (cc.M3, proj.M5)', () => {
  const { text, fm } = parse();
  assert.equal(fm.name, 'project-manager');
  assert.ok(fm.description && fm.description.length > 10);
  assert.match(fm.model, /^(sonnet|opus|haiku|inherit|claude-[\w.-]+)$/);
  assert.match(fm.effort, /^(low|medium|high|xhigh|max)$/);
  assert.ok(text.trimEnd().split('\n').length <= 50);
});

test('lead agent: tools are exactly Agent, Bash, PowerShell, Read, Write, Edit, Grep, Glob, Skill; no AskUserQuestion (cc.M-SEC1, cc.M8)', () => {
  const { fm } = parse();
  const tools = fm.tools.split(',').map(s => s.trim()).sort();
  assert.deepEqual(tools, ['Agent', 'Bash', 'Edit', 'Glob', 'Grep', 'PowerShell', 'Read', 'Skill', 'Write']);
  assert.ok(!tools.includes('AskUserQuestion'));
});

test('lead agent: no Role agent lists Agent or AskUserQuestion (cc.M-SEC4)', () => {
  for (const f of readdirSync(join(root, 'agents')).filter(f => f.endsWith('.md') && f !== 'project-manager.md')) {
    const tools = (/^tools:\s*(.*)$/m.exec(read(`agents/${f}`)) ?? [, ''])[1].split(',').map(s => s.trim());
    assert.ok(!tools.includes('Agent'), `${f} lists Agent`);
  }
});

test('lead agent: checks for Agent before its first dispatch and ends STATUS: blocked, reason: Agent withheld, never doing a Role\'s work (cc.M7)', () => {
  const { body } = parse();
  assert.match(body, /before (its|the) first dispatch/i);
  assert.match(body, /`?Agent`?[^\n]*(withheld|missing|not (in|among|listed))|(withheld|missing)[^\n]*`?Agent`?/i);
  assert.match(body, /STATUS: blocked/);
  assert.match(body, /reason: Agent withheld/);
  assert.match(body, /never[^\n]*(a Role's work|Role's work|work of a Role|Roles' work)/i);
});

test('lead agent: a helper Lead needs-ceo is passed up by the spawning Lead, which ends its own turn with that block (lead-relay v1 Helper Lead)', () => {
  const { body } = parse();
  assert.match(body, /helper Lead/i);
  assert.match(body, /needs-ceo/);
  assert.match(body, /`again`/);
  assert.match(body, /ends? (its|your) own turn/i);
});

test('lead agent: names, personalities and model-floor each have a project-manager entry', () => {
  const names = JSON.parse(read('company/names.json'));
  assert.equal(typeof names['project-manager'], 'string');
  const pers = JSON.parse(read('company/personalities.json'));
  assert.deepEqual(Object.keys(pers['project-manager'] ?? {}).sort(), ['creativity', 'intelligence', 'talk', 'temperament', 'topic']);
  const floor = JSON.parse(read('company/model-floor.json'));
  assert.ok(['sonnet', 'opus', 'haiku'].includes(floor.floor['project-manager']));
});

test('lead agent: 37 agent files but 36 Roles; the Lead is in no company type and not on the roles page', () => {
  const agents = readdirSync(join(root, 'agents')).filter(f => f.endsWith('.md'));
  assert.equal(agents.length, 37);
  assert.equal(agents.filter(f => f !== 'project-manager.md').length, 36);
  for (const f of readdirSync(join(root, 'company', 'types'))) assert.ok(!read(`company/types/${f}`).includes('project-manager'), f);
  const page = read('documentation/roles/README.md');
  assert.match(page, /36 Role agents/);
  assert.match(page, /not counted among the 36/);
});
